# KONE 联系人补全链路 Phase 1 修复报告（R1 + R2）

- 版本基线：`package.json` **1.4.36**；执行前 HEAD = `ef2badd10b4a747d8eeff75264cc6753d55395a3`（**main**，工作区干净，仅审计报告为未跟踪）。
- 依据：`docs/plans/KONE-ENRICHMENT-REVIEW-1436.md`（审计 R1/R2）。
- 范围：**仅 R1（联系人缓存正确性）+ R2（Apollo 邮箱回退正确性）**。未触碰 R3/R4/R5、未实现 Apollo 手机异步轮询、未迁移数据库、未重构 Agent 系统。
- 微调（2026-10-17，已批准）：在 R2 范围内**移除未经证实的 `VALID → verified` 映射**（降档为 `extracted`，见 §5.2）；未改变 R1 缓存隔离、字段级 TTL、R2 人员标识门禁与邮箱质量回退逻辑。
- 未运行任何真实付费 API 请求；未做任何真实邮件/客户触达；未输出任何 API Key 或敏感凭据。
- 所有测试均在**本次构建产物**（`npm run build:electron:dev` 重新编译的 `dist-electron/`）上执行。

---

## 一、R1 —— 富化缓存未做联系人级隔离

### A1 机制确认（读源码，不臆断）
- 键构造：`electron/services/search/enrichment-cache.ts:55-66`，原为 `provider|domain|field`。
- TTL：`enrichment-cache.ts:38-42`（identity 30d / email 14d / mobile 14d）。
- 写入点（**修复前**）：`search-service.ts` 的 Prospeo / Apollo 富化分支—— 均把**整条 `ProspeoEnrichResult` / `ApolloEnrichResult`**（含个人 email/phone）写入 **`identity` 键**，从而：① 同域不同联系人共用同一键（串值）；② 邮箱/手机继承 identity 的 **30 天** TTL（而非 14 天）。

### A2 隔离设计
- 新增 `deriveContactScopeKey()`（`src/shared/contact-provenance.ts`）：值域优先级 **稳定人员 ID（`pid:`）> 标准化 LinkedIn（`li:`）> 邮箱（`em:`）> 来源提供的姓名（`nm:`）> `-`**；统一剔除 `|`（键分隔符）。
  - 说明（§要求三/四）：无稳定 ID 时优先用 **标准化 LinkedIn URL**；姓名仅作**分区**，**不使用可变的职位文本**、**不猜测身份**；「无任何联系人标识」→ `-`（**公司级候选**作用域，仅被同类无标识查询复用，绝不满足任何**指定联系人**）。
- 缓存键扩展为 `provider|domain|field|contactScope`（`buildEnrichmentCacheKey` 增加可选第 4 段；旧 3 段键不变、**不会被当作联系人级读取**）。
- 适配器出口新增供应商**稳定人员 ID**：Prospeo `contactId = person_id`、Apollo `contactId = person.id`（缺失不臆造）。

### A3 字段级 TTL 分离
- 同一联系人下**分别**写入三段：`identity`（30d，姓名/职位/ID/LinkedIn）、`email`（14d，含 `attempted` 标记）、`mobile`（14d，仅在用户授权揭示时）。
- 读取：`readCachedProspeo()` 需 `identity` **且** `email` 条目存在才命中（邮箱是核心交付物，14d 过期即触发刷新，避免把过期邮箱当有效身份继续用）；`needMobile` 时还需 mobile 条目。
- `email`/`mobile` 用 `attempted` 标记区分「曾尝试但无值」与「条目已过期」——前者命中身份即可避免重复付费，后者触发重取。

### A4 测试（新增 `tests/business-logic/contact-cache-isolation.business.test.js`）
- 同域不同联系人键不同、互不命中；联系人级键与公司级（`-`）互不命中；旧 3 段键与新 4 段键不冲突。
- 字段级 TTL：**注入时钟**（`getEnrichmentCached(key, nowMs)` / `setEnrichmentCached(key, value, ttlMs, nowMs)`）验证——第 15 天邮箱过期而身份仍在，第 31 天身份过期；不真等。
- 作用域派生优先级/归一（LinkedIn slug 提取、邮箱小写、剔除 `|`、非个人主页 → `-`）。
- 源码守卫：主进程确实以 `contactScope` 读写、**不存在**旧的 `identityCacheKey = buildEnrichmentCacheKey(...)` 共享键写法。

---

## 二、R2 —— Apollo 邮箱回退正确性

### B1 请求是否满足接口契约（先判断）
- 结论：**`people/match` 不是公司范围内「找人」接口**。原请求仅含 `domain`/`company` → **不满足契约**。
- 处置：`enrichFromApollo()` 现在要求**人员标识**（`email` / `name` / `linkedin_url` / `id` 至少其一）；缺失时**不发起请求**，返回 `used:false` + `failureKind:'insufficient_identifier'`。
  - 调用方（`search-service.ts`）在**无人员标识时跳过 Apollo**，账本记 `skipped_no_identifier`（新增状态），**不靠关闭手机揭示参数来伪装「已解决」**。
  - 域名 → 决策人 的已授权能力是 **Prospeo `search-person`**（既有链路）。公司级 Apollo 搜索属**独立后续设计**，不在本轮范围。
- 同时把线索已带的 `email`/`contact`（姓名）/首选 LinkedIn 作为匹配标识随请求下发（`body.email` / `body.name` / `body.linkedin_url`）。

### B2 请求参数修正
- `reveal_phone_number` 由**恒 true** 改为**由 `payload.revealPhone` 决定，默认 false**。理由：标准同步端点**不支持**手机揭示（需 `webhook_url`/`poll_only`），开启会被官方 `400 WEBHOOK_URL_REQUIRED` 拒绝 → 整个请求失败、邮箱等一并丢弃（1.4.15 起既有缺陷）。**无异步通道前恒为 false**；未来接入异步通道再显式开启。
- `reveal_personal_emails: true` 保持不变。

### B3 回退终止判据（质量化）
- 新增双端 SSOT `src/shared/email-availability.ts`：`assessEmailUsability()` / `isVerifiedEmail()`。
  - `VERIFIED`/`verified` → tier `verified`；`INVALID`/`BOUNCED`/`UNAVAILABLE`/`NONE`/`LOCKED` → **不可用**；其余（`UNKNOWN`/`RISKY`/`CATCH_ALL`/`PROBABLE`/`GUESSED`/`EXTRAPOLATED`/**`VALID`**…）→ 可用但 tier `extracted`，**绝不冒认 verified**。
  - ✅ **微调（2026-10-17，已批准）**：**移除**未经证实的 `VALID → verified` 映射。现 `VALID` 归入 `extracted`（**保留非空邮箱取值、可用**），**不满足**回退终止判据（`.tier === 'verified'`）→ Apollo 回退**继续**。详见 §5.2。
- 回退门控由 `Boolean(prospeo?.email)` 收紧为 `assessEmailUsability(prospeo).tier === 'verified'`：**只有达到已验证标准的结果才能终止回退**；`UNKNOWN` 等不再「拿到就停」。
- 邮箱可信档（`search-service.ts` 的 `prospeoEmailTier`/`apolloEmailTier`）统一改由该 SSOT 判定。

### B4 错误语义（尽量区分，最小兼容方案）
- 适配器出口新增 `failureKind`：Prospeo `missing_key`/`invalid_target`/`http_error`/`api_error`/`no_match`/`network_error`；Apollo 另含 `insufficient_identifier`、`no_target`。
- 调用方据此记账：`no_match` → `miss`；其余失败 → `error`（`detail` 携带具体 `failureKind`）；无人员标识 → 新增 `skipped_no_identifier`。
- **保留的兼容性残留（如实说明）**：「未配置 API Key」与「用户未开启补全」仍共用 `skipped_not_opted_in`（以 `detail` 区分），因涉及账本枚举的完整改造属 **R4 范围**，本轮按最小兼容方案未改动（新增 `skipped_no_identifier` 为纯增量）。

### B5 测试
- `tests/business-logic/enrich-apollo.business.test.js`：新增「仅有域名、缺少人员标识 → 不发请求」「缺密钥 → failureKind=missing_key」「无目标 → failureKind=no_target」；命中用例断言请求体 `reveal_phone_number === false` 且 `email` 标识随请求下发；原「域内搜索」类用例改为携带人员标识（契约修正的必然结果）。
- `tests/business-logic/contact-enrichment-tiered.business.test.js`：Apollo 用例改携带人员标识。
- `tests/business-logic/contact-cache-isolation.business.test.js`：邮箱可用性 SSOT 全量策略用例（含 **`VALID` 不越级、邮箱取值保留、不终止回退**）+ 源码守卫（回退判据为 verified、Apollo 缺标识即 `skipped_no_identifier`）。

---

## 三、变更文件清单

| 文件 | 变更 |
|---|---|
| `src/shared/email-availability.ts` | **新增** 邮箱可用性 SSOT（纯函数）；微调后**仅 `VERIFIED`/`verified` 认证**，`VALID` 归 `extracted` |
| `src/shared/contact-provenance.ts` | 新增 `deriveContactScopeKey` / `normalizeLinkedInSlug` |
| `src/shared/enrichment-cost.ts` | 新增枚举 `skipped_no_identifier`（增量） |
| `electron/services/search/enrichment-cache.ts` | 键增可选第 4 段 `contactScope`；get/set 增可注入 `nowMs` |
| `electron/services/search/enrich-prospeo.ts` | 暴露 `contactId`；新增 `failureKind` |
| `electron/services/search/enrich-apollo.ts` | 要求人员标识；`reveal_phone_number` 默认 false；`failureKind`/`matchedPersonIdentity`；暴露 `contactId` |
| `electron/services/search-service.ts` | R1 联系人级/字段级缓存读写；R2 质量化回退门控 + Apollo 标识门控 + 账本状态 |
| `tests/business-logic/contact-cache-isolation.business.test.js` | **新增** A4 守护测试 |
| `tests/business-logic/enrich-apollo.business.test.js` | Apollo 契约/参数/失败语义测试 |
| `tests/business-logic/contact-enrichment-tiered.business.test.js` | Apollo 用例补人员标识 |

---

## 四、验收证据（本轮新构建产物）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 编译（主进程） | `npm run build:electron:dev` | 通过 |
| 类型检查 | `npm run typecheck` | 通过（无错误） |
| 目标业务测试 | `node --test …/contact-cache-isolation + contact-enrichment-tiered + enrich-apollo + enrich-prospeo` | **69 / 69 通过，0 失败** |
| 全量单元测试 | `npm run test:unit` | **581 / 581 通过，0 失败** |
| 规范一致性 | `npm run verify:consistency`（docs + ipc + cloud-safety） | 三项全部通过 |
| Lint（改动文件） | `npx eslint <changed>` | 0 error（警告为既有） |
| 格式（改动文件） | `npx prettier --check <changed>` | 通过（`All matched files use Prettier code style!`） |
| Diff 卫生 | `git diff --check` | exit 0（无空白错误） |
| 变更范围 | `git status` / `git diff --stat` | 仅 8 个预期修改文件（+427/−73）+ 3 个未跟踪新增文件；无 `.tmp-`/`dist`/`release`/密钥残留 |

> 上述全部门禁于**微调后最终验收轮（2026-10-17）**在**本轮重新构建的产物**上实测（非引用旧日志）：目标套件 **69/69**、`test:unit` **581/581**、`typecheck` exit 0、`verify:consistency` exit 0、ESLint 0 error、Prettier 通过、`git diff --check` exit 0。

---

## 五、边界复核（最终验收项）

### 5.1 同域「无联系人标识」跨任务共用 `-` scope —— 是否串值？
- **证据**：`contactScope` 仅由**线索自身标识**派生（`search-service.ts:1259-1263`：linkedin / email / contact 姓名），**不含**搜索意图（行业/关键词/角色）。富化请求本身也是**按域名**发起（`search-service.ts:1323-1329` 传 `domain/company/country/wantMobile`；`enrich-prospeo.ts:194-197` 请求体仅 `filters.company.websites.include=[domain]`），**不含**意图输入。Apollo 对匿名线索**直接跳过**（`hasApolloPersonIdentifier=false` → `skipped_no_identifier`），不会写入 `-` 桶。
- **结论**：Prospeo「按域找人」的输出是**域名的确定性函数**（域内最佳决策人），与搜索意图无关 → 两个不同意图、同域的匿名任务复用 `-` 桶时，命中的就是**第二次本会独立取到的同一结果**，**未观测到「不同意图的人被互相串值」**。`-` 桶语义即**公司级候选**（注释与 `matchedPersonIdentity=false` 已禁止其被当作「指定联系人」）。
- **残留（如实记录，非缺陷、不阻断验收）**：同一域名下**多个匿名线索**会共享 `-` 桶（后补者复用先补者的「域内最佳联系人」）。因底层富化本就是域级语义，二者取值一致，故非数据污染；但属**产品语义限制**，是否按线索分别富化留待后续产品决策（**不在本轮范围，未经批准不擅自扩大**）。
- **是否破坏 R1 验收条件**：**否**。R1 的验收点是「**有联系人标识时**按联系人隔离」，已满足；`-` 桶是显式的公司级分桶。

### 5.2 `VALID` → `verified` 是否有供应商契约支撑？—— **已修复（降档为 `extracted`）**
- **检查**：`VALID` 原本仅出现于 `email-availability.ts`；`contact-provenance.ts:28` 五级为 `verified/probable/catch_all/risky/invalid`（**无 `VALID`**）。Prospeo 仅文档化 `VERIFIED/UNKNOWN/RISKY/CATCH_ALL`；Apollo 仅文档化 `verified/guessed/unavailable/bounced/locked`。**无任何供应商契约把 `VALID` 定义为「已验证」。**
- **修复（已批准微调）**：`email-availability.ts` 的 `VERIFIED_EMAIL_STATES` 由 `['VERIFIED','VALID']` **收紧为 `['VERIFIED']`**（大小写归一后 `VERIFIED`/`verified` 仍认证）。`VALID` 落入默认未验证分支 → `usable:true` / `tier:'extracted'` / `reason:'unverified'`：**非空邮箱取值保留**（不丢值）、**绝不越级标 `verified`**、**不终止 Apollo 回退**。
- **回归锁定**：`tests/business-logic/contact-cache-isolation.business.test.js` 断言 `VALID`/`valid`/`Valid` 均 `tier==='extracted'`、`usable===true`、`isVerifiedEmail===false`；`VERIFIED`/`verified` 仍为 `verified`。
- **是否破坏 R2 验收条件**：**否**。回退判据（`.tier === 'verified'` + 预算门禁）未变，已知标签处理正确，`VALID` 不再越级 → **满足**。

---

## 六、回滚与残留

- **回滚**：本轮改动集中在 6 个既有源文件 + 3 个新增文件，未改 schema、未迁移数据；`git checkout -- <files>` 删除新增文件即可回到 `ef2badd` 行为。
- **供应商留存条款**：identity 30d / email 14d 仍为**项目设计目标**，**供应商留存策略状态维持「待核实」**（未取得商业授权确认）。
- **待后续（不在本轮）**：
  - **§5.2 `VALID → verified`**：**已修复**（移除，降档 `extracted`）；无遗留。
  - **§5.1 公司级 `-` 桶的产品语义**：同域多个匿名线索共享域内最佳联系人；非数据污染，属产品语义限制（**待产品决策**）。
  - R3/R4/R5；Apollo 手机**异步轮询**（需 webhook/poll 通道）；公司级 Apollo 搜索（独立设计任务）。
  - B4 残留：缺失密钥 vs 用户未开启的账本状态细分归入 **R4**。
  - `PROVIDER-CAPABILITY.md` 对 Prospeo/Apollo 仍为零覆盖（审计 D-6），需在允许改文档的任务中补齐。
- **未执行**：未自动开始 R3/R4/R5、未启动手机异步补全、未发布安装包（按指令在本轮结束处停止）。
