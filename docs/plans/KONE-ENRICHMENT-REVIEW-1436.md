# KONE 1.4.36 联系人分级补全提交专项复核

> **报告性质**：只读代码审查 + 测试设计。本轮**未修改任何业务代码、依赖或配置**，**未进行任何真实外发**，**未调用任何付费 API**。
> **复核对象**：提交 `ef2badd`（feat(enrichment): 分级 B2B 联系人补全 Step 1-5 最小完整链路，版本 1.4.35 → 1.4.36）。
> **代码基线**：`main` @ `ef2badd`（工作区干净）。
> **证据规则**：每条结论标注 `文件:行`。区分 `[已证实-代码]`（代码直接证据）、`[已复现]`（本轮实际运行复现）、`[已证实-官方文档]`、`[待实测]`（需真实响应样本或账单）。
> **未做假设**：不假定 BYOK / 普通订阅自动获得转售权；不臆造成本数字。

---

## 0. 结论速览

| # | 风险项 | 结论 | 严重度 | 是否复现 |
|---|---|---|---|---|
| R1 | 字段级缓存未区分联系人 | **成立**：缓存键为 `provider\|domain\|field`，但写入的是**联系人级**结果（含邮箱/手机），且**整对象存于 `identity` 键** → ① 同域名不同联系人**互相串值**；② 邮箱/手机**继承 identity 的 30 天 TTL**（应为 14 天），TTL 分型失效 | 高 | ✅ 本轮已复现 |
| R2 | 邮箱回退条件 | **成立**：回退仅判 `Boolean(prospeo.email)`，**不判质量**——`UNKNOWN/RISKY/CATCH_ALL` 等非 `INVALID` 邮箱会**阻断 Apollo 回退**；且 Apollo 请求体**恒发 `reveal_phone_number:true` 且无 webhook/poll**，按官方契约会被 `400 WEBHOOK_URL_REQUIRED` 拒绝 → 回退目标**结构性失效** | 高 | 代码静态成立；Apollo 400 为 `[已证实-官方文档]`（未真实出网） |
| R3 | `confidenceScore` 恒 0 语义 | **部分成立**：0 已**不影响排序/评分/门禁**（佐证见 §1.3）；但 `0` 承载「未评估」而非「评估为最低分」，**导出显示 `0 / 100` 会误读**；需向后兼容的显式表达 | 中 | 代码静态成立 |
| R4 | 成本账本与额度门禁 | **部分成立**：`cost=null` **未被当作零成本**（正确）；但**超时被记为 `miss`**、`error` 分支**实际不可达**、`skipped_not_opted_in` 被误用于「密钥未配置」、账本粒度在「缓存命中 vs 真实调用」间**不一致**；全局账本**无消费方**且**仅本会话内存** | 中 | 代码静态成立 + 相关测试通过 |
| R5 | 联系人来源与状态映射 | **部分成立**：邮箱档位已按自报状态如实映射（正确）；但**手机档位仍被无条件标 `verified`**（Apollo 未读任何状态）、手机选择**不按档位排序**（低可信可压高可信）、手机**不保留冲突证据**；`verifiedAt` 记为合并时刻而非验证时刻 | 中高 | 代码静态成立 |

**一句话**：本轮把**邮箱**的可信度与诚实口径修对了，但**缓存的安全边界（联系人隔离 / TTL 分型）**、**回退的质量判定**、**手机链路的可信与账本一致性**仍是缺口；且 Apollo 手机在**当前请求参数下结构性拿不到**（官方契约），使新增的「第二供应商回退」在真实链路上近乎空转。

---

## 1. 五项风险逐项核验

### R1 字段级缓存未区分联系人

#### 1.1 现状与证据

- 缓存键构造：`electron/services/search/enrichment-cache.ts:55-66`
  ```ts
  return `${provider}|${normalized}|${field}`   // normalized = 域（或公司名小写回退）
  ```
- TTL 分型定义：`enrichment-cache.ts:38-42` → `identity: 30d`、`email: 14d`、`mobile: 14d`。
- 调用方**在 `search-service.ts` 把整个 `ProspeoEnrichResult` / `ApolloEnrichResult`（含 email/phone/身份）写入 `identity` 键**：
  - Prospeo：`search-service.ts:1184-1212`（`identityCacheKey` + `setEnrichmentCached(identityCacheKey, result)`）
  - Apollo：`search-service.ts:1278-1303`（`apolloCacheKey` + `setEnrichmentCached(apolloCacheKey, result)`）

#### 1.2 字段归属判定（公司级 vs 联系人级）

| 字段 | 真实粒度 | 当前缓存归属 | 是否错配 |
|---|---|---|---|
| 公司名 / 域名 | 公司级 | 缓存键中的 domain 部分 | 否 |
| 决策人**姓名 / 职位 / LinkedIn** | **联系人级** | 存在 `identity` 字段键下 | **是**（`identity` 语义被当成公司级，实为联系人身份） |
| **邮箱** | **联系人级** | 随整对象存于 `identity` 键 | **是** |
| **手机** | **联系人级** | 随整对象存于 `identity` 键 | **是** |

> 关键点：Prospeo `search-person` / Apollo `people/match` 返回的是**某一个具体的人**，不是「公司级联系人字段」。因此**该缓存本质是「联系人级结果」却以「公司/域名级 + identity 型」为键**。

#### 1.3 已复现的两个后果

**（a）同域名不同联系人互相串值**（本轮实测）：

```
key(prospeo, acme.com, identity) = prospeo|acme.com|identity
same-domain two contacts share key: true
stored under identity key carries email/phone: {"contactName":"Jane","email":"jane@acme.com","phone":"+1..."}
```

即：同一域名的**两个不同联系人线索**会命中**同一缓存项**，得到**同一个（第一位的）人**的邮箱/手机。由于 `verified` 档在 `pickContactWithProvenance` 中**优先于**线索自带的 `extracted` 邮箱（`search-service.ts:1392-1401`），被缓存的**他人邮箱**会**压掉**本线索自己的邮箱。

**（b）邮箱/手机继承 identity 的 30 天 TTL**（本轮实测）：

```
identity TTL(ms)= 2592000000   email TTL(ms)= 1209600000
```

即「TTL 按数据类型区分」的设计被**整对象写入 `identity` 键**这一实现抵消——联系方式实际按 **30 天**缓存，而非声明的 14 天。

#### 1.4 影响程度

- **数据正确性**：跨联系人串值可导致「A 公司的邮箱被挂到 B 联系人名下」——对 B2B 触达是硬伤（发错人）。
- **合规/时效**：联系方式缓存期超设计值，违背「宁可少复用也不交付过期联系方式」的自述纪律（`enrichment-cache.ts:31-36`）。
- **可观测性**：缓存命中日志只记 `field:'identity'`（`search-service.ts:1192-1197`），无法据此区分命中的是邮箱还是手机。

#### 1.5 最小兼容修复方案（本轮不实施）

> 目标：**向后兼容**（域名级键不变时行为不变）、**联系人级数据不跨人共享**、**TTL 按字段生效**。

1. **引入联系人判别键（contactKey）**：在 `buildEnrichmentCacheKey` 增加可选第 4 段——
   - 当线索自带可识别联系人时（`candidate.email` 归一化，或 `candidate.contact` 归一化），`key = provider|domain|field|contactKey`；
   - 无线索级联系人信息时，**保持** `provider|domain|field`（域名级，兼容旧语义，且此时「域内最佳人」是唯一合理解）。
2. **按字段写键、不整对象落 `identity`**：Prospeo/Apollo 结果拆分为 `identity`（姓名/职位/LinkedIn）、`email`、`mobile` 三键分别写入，使 `email/mobile` 各按自身 14 天 TTL 生效；或保留整对象但以 `min(identityTTL, emailTTL, mobileTTL)` 作为该对象 TTL。
3. **命中计数按字段如实记录**：命中 `email` 键时记录 `field:'email'`，避免全部记成 `identity`。

> 方案 1 与 2 可独立，建议 2 先做（零调用方语义变更，仅拆分写入）；1 次之（需调用方在第 4 段传入 contactKey）。

#### 1.6 回归测试（设计）

- `同域名、不同邮箱的两个联系人 → 缓存不得互相命中/串值`（键含 contactKey 时）。
- `邮箱缓存 TTL === 14d，身份 TTL === 30d`，且**写入整对象后邮箱仍按 14d 过期**。
- `缓存命中记录的 field 与实际命中的字段一致`。

---

### R2 邮箱回退条件

#### 2.1 现状与证据

- 回退门禁：`search-service.ts:1258`
  ```ts
  const prospeoHasQualifyingEmail = Boolean(prospeo?.email)
  ```
  以及 `1268-1274`：`prospeoHasQualifyingEmail` 为真 → Apollo 记 `skipped_not_opted_in`，**不调用**。
- Prospeo 侧「邮箱可用」判定：`enrich-prospeo.ts:208`
  ```ts
  const email = emailRevealed && emailStatus !== 'INVALID' ? ... : ''
  ```
  → **`UNKNOWN` / `RISKY` / `CATCH_ALL` 均产出非空 `email`**（尽管请求带了 `only_verified_email: true`，该 flag 并非硬约束；测试 `Step4/D-4` 已证明 `UNKNOWN` 会返回）。
- 该邮箱的可信档：`search-service.ts:1388-1391`
  ```ts
  const prospeoEmailTier = emailStatus === 'VERIFIED' ? 'verified' : 'extracted'
  ```
  → 上述非 VERIFIED 邮箱档位为 `extracted`，**却仍阻断了可能给出 `verified` 的 Apollo 回退**。
- 缓存命中路径同样以 `prospeo.email` 阻断回退（`search-service.ts:1189-1197` 命中后 `1258` 判定）。

#### 2.2 各状态是否应继续回退

| 首选返回状态 | 当前行为 | 是否应回退 | 理由 |
|---|---|---|---|
| 无 email（空串） | 回退 | ✅ 是 | 无数据 |
| `emailStatus = INVALID` | 视为空（`email=''`）→ 回退 | ✅ 是 | 明确无效 |
| `emailStatus = RISKY` | **不回退** | ✅ 应回退 | 高风险地址，非可用 |
| `emailStatus = UNKNOWN` / 空 | **不回退** | ✅ 应回退 | 未验证，不应阻断更优来源 |
| `emailStatus = CATCH_ALL` | **不回退** | ⚠️ 视策略 | catch-all 有到达风险，宜降级/回退 |
| `VERIFIED` | 不回退 | ✅ 正确 | 已达可用标准 |
| Apollo `match_confidence = none` | 已置空（`enrich-apollo.ts:161-165`） | ✅ 正确 | 未匹配 |
| Apollo `match_confidence = low` + email | 产出 email（extracted） | 视策略 | 低匹配度，宜标注而非阻断 |

#### 2.3 统一「可用性判断规则」建议（设计，本轮不实施）

```
isUsableEmail(result, requirement):
  1. 无值 → 不可用（继续回退）
  2. status ∈ {invalid} → 不可用
  3. requirement = 'verified' 时：仅 status === 'verified'（大小写不敏感）算可用
     （risky / catch_all / unknown / guessed / extrapolated / 空）→ 不可用
  4. requirement = 'deliverable' 时：verified | probable | catch_all 算可用；risky/invalid 不可用
  5. 联系人不匹配（Apollo match_confidence=none，或未来比对不一致）→ 不可用，且不得标 verified
  6. 仍受**每供应商预算**约束：达到 limit 即停止（不得无边回退）
```

**预算结论（重要订正）**：当前回退**并非不受预算限制**——Prospeo 受 `prospeoEmailBudget`（`search-service.ts:1181`）、Apollo 受 `enrichBudget`（`search-service.ts:1276`）限制。缺的是**质量维度**，不是预算维度。

#### 2.4 结构性缺陷：Apollo 当前请求体使其回退近乎空转

- 请求体恒为 `enrich-apollo.ts:129-135`：
  ```ts
  { api_key, domain, company, reveal_personal_emails: true, reveal_phone_number: true }
  ```
  **恒发 `reveal_phone_number: true`，且从不携带 `webhook_url` 或 `poll_only`。**
- 官方契约（`docs.apollo.io/reference/people-enrichment` / `retrieve-mobile-phone-numbers`）：
  - `reveal_phone_number=true` **必须**提供 `webhook_url`，否则返回错误（示例 `{"error":"Please add a valid 'webhook_url' ..."}`；OpenAPI 错误码 `SEARCH.VALIDATION.WEBHOOK_URL_REQUIRED`）；
  - 或 `poll_only=true` 且**省略** `webhook_url`；两者同传会 `400 WEBHOOK_URL_WITH_POLL_ONLY`。
- 适配器将任何非 2xx 视为 `EMPTY_RESULT`（`enrich-apollo.ts:149-151`）→ **按契约，Apollo 分支在真实链路中恒返回空**（`[已证实-官方文档]` + `[待实测]`）。
- 结论：**Step 2D 的「第二供应商回退」在真实环境下很可能拿不到任何数据**；这是 1.4.15 引入的既有缺陷，被 `ef2badd` 的回退逻辑依赖但未修。

#### 2.5 最小修复方向（本轮不实施）

1. `reveal_phone_number` **改为条件发送**：仅在「用户授权手机 + 已配置 phone-reveal 通道（poll/webhook）」时为 `true`，否则为 `false`（或省略）。这是让 Apollo 重新可用的**前置必需项**。
2. 回退判定由「非空」升级为「`isUsableEmail` 达标」。
3. 保留预算护栏不变。

#### 2.6 回归测试（设计）

- `Prospeo 返回 UNKNOWN 邮箱 → 应继续调用 Apollo`（当前会失败）。
- `Prospeo 返回 VERIFIED 邮箱 → 不调用 Apollo`。
- `Prospeo 返回 INVALID → 回退`。
- `reveal_phone_number=false 时 Apollo 请求体不含 phone reveal`（源码/请求体断言）。
- `预算耗尽 → 停止回退`。

---

### R3 `confidenceScore` 恒 0 的语义审查

#### 3.1 现状与证据

- 富化决策人一律 `confidenceScore: 0`：`search-service.ts:1468`、`1481`（附注释「不臆造」）。
- `DecisionMaker.confidenceScore` 为**必填 number**：`src/shared/ipc-contracts.ts:434`。
- 静态验证层**不臆造** `confidenceScore`：`electron/utils/contact-validation.ts:1-9, 40-59`。

#### 3.2 上下游使用全景（本轮实测 grep）

| 使用点 | 位置 | 是否受影响 |
|---|---|---|
| 主进程决策人合并（同键取较高分） | `search-service.ts:492`（`>=` 比较；低分不覆盖高分） | 否——`0` 不会覆盖更高的既有分；仅当对方也为 `0` 时后到者胜（两侧同为「未知」，无害） |
| Store 合并（同键取较高分） | `src/store/leads-store.ts:267-285`（`incomingWins = incoming >= existing`，空值不覆盖） | 否——非空高置信资产不被空值抹除 |
| 结果卡片「未验证」徽标 | `src/components/search/search-result-card.tsx:349`（`confidenceScore > 0` 判定） | 是（展示）——`<=0` 显示「尚未独立验证」，与「未知」语义**一致**，无误导 |
| 分析抽屉「未验证」徽标 | `src/components/analysis-drawer.tsx:666` | 同上 |
| 导出显示 | `electron/services/export-service.ts:347`（`confidenceScore` + ` / 100`） | 是（误读风险）——显示 `0 / 100` **像「评估后极低分」**，实际是「未知」 |
| ICP 预评分 | `electron/services/search/scoring.ts:86-95`（仅判 `dm.email/phone/linkedinUrl` **是否存在**） | 否——**不读 confidenceScore** |
| Agent 管道门禁 | `electron/services/agent-pipeline.ts:129-152`（仅判 `dm.linkedinUrl` 存在） | 否——**不读 confidenceScore** |

#### 3.3 结论

- **不影响**排序、评分、回退、自动化门禁（关键负面结论被证伪：无影响）。
- **存在**语义歧义：`0` 同时可能是「未知」或「评估为最低分」。当前唯一真实的误读面是**导出 `0 / 100`**；未来若有代码按分值升序排序/设阈值，未知会被当成最差。

#### 3.4 向后兼容的显式表达（设计）

- **不改** `confidenceScore` 的 number 类型与 `0` 取值（保持旧数据/`deepEqual` 兼容）。
- **新增**可选字段表达来源：
  ```ts
  confidenceKnown?: boolean        // 缺省视为 false（历史/富化数据均为未评估）
  confidenceBasis?: 'scored' | 'unverified' | 'matched' | 'self_reported'
  ```
- UI/导出：当 `confidenceKnown !== true` 时显示「未评估 / 未独立验证」，**不再渲染 `0 / 100`**。
- 富化写入处显式补 `confidenceKnown: false`（与 `confidenceScore: 0` 并列），使「0 = 未知」自解释。

---

### R4 成本账本与额度门禁

#### 4.1 现状与证据

- 记录结构（六要素 + `fromCache`）：`src/shared/enrichment-cost.ts:41-53`；未知计费 `cost: null`：`enrichment-ledger.ts:57`（缺省即 null）。
- 汇总规则：`enrichment-cost.ts:101-121` —— `skipped_*` 不计 `calls`；`fromCache` 计 `calls` 不计费；`cost===null` 计 `unknownCostCalls`。
- 计费单位显式、不跨单位求和：`enrichment-cost.ts:20-23, 116-117`。

#### 4.2 `cost=null` 是否被当作零成本

**否。** 代码与测试一致：`cost===null` 走 `unknownCostCalls` 分支（`enrichment-cost.ts:112-115`），**不进入 `byUnit` 求和**。测试 `Step3: 未确认计费记为未知...` 断言 `unknownCostCalls===1` 通过。

> 附带事实：由于**所有调用点都传 `cost` 缺省（null）**，`byUnit` 在生产中**恒为空对象** → 结果卡片「可确认费用」分支（`search-result-card.tsx:368-375`）**永不显示**。这本身是诚实的（不伪造），但意味着「可确认费用」目前是**死分支**。

#### 4.3 账本记录一致性核查（命中 / 跳过 / 失败 / 超时 / 重复）

| 场景 | 当前记录 | 一致性问题 |
|---|---|---|
| Prospeo 真实调用成功 | 1 条 `identity:hit` + 有邮箱时 1 条 `email:hit` + 有手机时 1 条 `mobile:hit`（`search-service.ts:1213-1237`） | `calls` 计为 1~3，**非 HTTP 调用数**（实际 2 次 HTTP：search-person + enrich-person） |
| Prospeo **缓存命中** | **仅 1 条** `identity:hit, fromCache:true`（`1192-1197`） | 与真实调用的 `calls` 粒度**不一致**（同为「命中同一域」却 1 vs 2~3） |
| 跳过（未 opt-in / 超预算 / 非高价值） | `skipped_not_opted_in` / `skipped_budget` / `skipped_not_high_value` | 正确区分「未发生请求」 |
| **密钥未配置** | 记为 `skipped_not_opted_in`（`1167-1170`, `1262-1265`，detail 写「API key 未配置」） | **语义错误**：未配置 ≠ 未选择开启；且与「用户关闭补全」共用同一状态 |
| 无命中 / 请求失败 | `miss`（`1242`, `1312`） | — |
| **超时 / 网络异常** | 因适配器 **Fail-Closed 吞异常**（`enrich-prospeo.ts:241-244`, `enrich-apollo.ts:203-206`）→ 返回 `EMPTY_RESULT` → 记为 **`miss`** | 超时**被记为无命中**；可能已消耗供应商资源却无区分 |
| `error` 状态 | 仅在外层 `try` 抛出时记录（`1251`, `1318`） | 适配器永不抛 → **该分支实际不可达**（`error` 为死代码），失败与无命中**不可区分** |
| 重复请求 | 同域二次搜索 → 命中缓存（`fromCache:true`） | — |

#### 4.4 会话范围与「完整历史费用」口径

- 全局账本**仅内存、进程内、有界 500 条**：`enrichment-ledger.ts:14-18, 29, 61-62`。
- **全局账本无任何消费方**（本轮 grep：仅测试引用 `recordEnrichmentCall/getEnrichmentLedger/summarizeEnrichmentLedger`；UI/IPC 未调用）。
- 前端仅展示**单条线索**的 `enrichmentCost`（`search-result-card.tsx:358-380`），其含义是**本轮该线索的补全摘要**。
- **口径要求**：任何文档/UI **不得**把该内存账本描述为「完整历史费用 / 账户级累计消耗」。当前代码/注释已自述为内存态（`enrichment-ledger.ts:16-18`），**符合要求**；但需在 UI 文案中同样避免「总花费」措辞。

#### 4.5 最小修复方向（本轮不实施）

1. 适配器的超时/异常路径返回可辨识信号（如 `timedOut: true`），调用方据此记 `error`/新增 `'timeout'` 状态，使「失败 ≠ 无命中」。
2. 新增 `skipped_no_credentials` 状态（或修正 `skipped_not_opted_in` 的语义占用），区分「未配置」与「未开启」。
3. 统一 `calls` 口径（定义其为「逻辑供应商调用」并让缓存命中与真实调用的粒度一致），或分别暴露 `httpCalls` 与 `logicalHits`。
4. 结果卡片「可确认费用」在 `byUnit` 恒空时明确文案（或移除死分支），避免空展示。

---

### R5 联系人来源与状态映射

#### 5.1 邮箱：状态 → 档位映射（本轮修对的部分）

- Prospeo：`VERIFIED` → `verified`，否则 `extracted`（`search-service.ts:1388-1389`）；`grade` 如实回传（`1401`）。
- Apollo：`email_status==='verified'`（忽略大小写）→ `verified`，否则 `extracted`（`1390-1391`）。
- `pickContactWithProvenance` 改为**档位优先**（`src/shared/contact-provenance.ts:99-146`）：`verified` 必胜 `extracted`。
- 邮箱**冲突证据保留**：落选且取值不同者进 `provenance.conflicts`（`contact-provenance.ts:123-134, 143`）。

#### 5.2 邮箱验证状态 vs 联系人身份置信度：是否分离

**已分离**：
- 邮箱档位来自**邮箱状态**（§5.1）；
- 联系人身份档位**恒为 `extracted`**（`search-service.ts:1451-1454`，注释「供应商返回了某人 ≠ 已验证联系人」）——**未**把「匹配到人」等同「已验证」。

#### 5.3 仍存在的缺陷

**(a) 手机档位被无条件标 `verified`**：`search-service.ts:1059-1070`
```ts
if (prospeo?.phone) provenance: { tier: 'verified', source:'Prospeo' }   // 仅判 revealed，未读任何验证状态
if (apollo?.phone)  provenance: { tier: 'verified', source:'Apollo' }    // Apollo 完全没有 phone 状态字段被读取
```
→ 与 D-3/D-4 已修的**邮箱**同类问题，在**手机**上**仍未修复**（Apollo 手机无论来源/类型均标 verified）。

**(b) 手机选择不按档位排序（低可信可压高可信）**：`pickBestPhoneForReach`（`search-service.ts:1036-1099`）
```ts
if (candidatePhone) ranked.push({ tier:'extracted', ... })   // 候选（extracted）先入队
if (prospeo?.phone) ranked.push({ tier:'verified', ... })
...
const mobile = ranked.find(r => r.kind === 'mobile')         // 取第一个 mobile
```
→ 若**候选自带手机**（`extracted`）而 Prospeo 也给手机（`verified`），`find` 会先命中**候选手机**——**低可信覆盖高可信**，与邮箱已修正的档位优先原则相悖。

**(c) 手机不保留冲突证据**：对比邮箱的 `conflicts`，`pickBestPhoneForReach` **不记录**落选手机候选 → 「无法确定时保留冲突和来源证据」**在手机上未落实**。

**(d) `verifiedAt` 记录的是合并时刻而非验证时刻**：`search-service.ts:1063, 1069`（`Date.now()`）；字段语义为「被取得/验证的时间」（`contact-provenance.ts:32-37`）。当前实为「进入线索的时刻」，属轻度语义夸大（不伪造，但名不副实）。

**(e) 顶层 contact 与 decisionMakers 语义重叠（既存 G2 未消解）**：`search-service.ts:1437-1454`（顶层 `contact` 仅在被占时填充）与 `1459-1486`（决策人数组仍追加富化人）。顶层未被富化覆盖时，富化人仍进入 `decisionMakers` → 两处来源可能不一致（非正确性 bug，但展示需一致）。

#### 5.4 最小修复方向（本轮不实施）

1. 手机档位：Apollo 手机仅在**能判定为已验证/权威 mobile** 时标 `verified`，否则 `extracted`；Prospeo 手机读其自报状态后再定档。
2. 手机选择改为**档位优先、同档位再按 mobile 优先**（与邮箱的 `CONTACT_TIER_RANK` 一致）。
3. 手机填充复用 `pickContactWithProvenance`（或等价逻辑）以**同时产出 conflicts**。
4. `verifiedAt` 语义厘清：改名为 `recordedAt`，或确实写入供应商返回的验证时间。

---

## 2. Apollo 手机补全（设计，本轮不实施）

> 依据：当前适配器实现（`enrich-apollo.ts:112-207`）+ Apollo 官方 People Enrichment / Poll Webhook Result 契约。
> **前置硬约束**：手机补全**未获用户授权（`enrichment.mobile !== true`）或功能开关关闭时，不得发送任何请求**。当前门控见 `search-service.ts:1149, 1162`。

### 2.1 官方契约要点（`[已证实-官方文档]`）

- `POST /api/v1/people/match`；手机揭示异步。
- 方式一 **webhook**：`reveal_phone_number=true` **必须**给 `webhook_url`（公开 HTTPS），否则报错 `SEARCH.VALIDATION.WEBHOOK_URL_REQUIRED`。
- 方式二 **poll_only**：`poll_only=true` 且**省略** `webhook_url` → 同步响应返回 `request_id`；用 `request_id` 轮询 `GET /api/v1/webhook_result/show`。
- `poll_only=true` 与 `webhook_url` 同传 → `400 WEBHOOK_URL_WITH_POLL_ONLY`。
- 轮询：处理中返回 `404 error_code: result_pending` + `retry_after_seconds`；**轮询端点 0 credits**；结果保留至 webhook 触发后 **30 天**。
- 计费：**返回数据才计费**；返回 mobile 额外 **8 credits**；`match_confidence=none` 不收人口统计 credit。
- 同步响应**不含**异步手机；可能含雇主座机（非手机）。

### 2.2 方案 A —— `poll_only` 轮询（**推荐**，适配本地桌面应用）

| 维度 | 设计 |
|---|---|
| 适用前提 | 应用为**本地 Electron**，**无公网 HTTPS 回调地址**；不愿引入公网中继 |
| 触发条件 | `enrichment.mobile === true` **且** 预算剩余 **且** 尚无可用 mobile **且** 已配置 Apollo Key |
| 异步状态机 | `idle → requested(拿到 request_id) → polling(pending) → ready(拿到手机) / exhausted(超时) / failed` |
| 超时 | **总轮询上限**（建议 90–120s，桌面场景不宜等官方「数分钟」）+ 单次请求超时（15s）；以 `retry_after_seconds` 为退避下限，设退避上限 | 
| 重试 | 仅在 `result_pending`（404）时按 `retry_after_seconds` 重试；其它错误不盲重试；网络抖动采用有限次指数退避 |
| 幂等 | `request_id` 为幂等键；同一 `(domain, person)` 在结果 TTL 内**不得重复发起 reveal**；轮询去重（并发同 request_id 只保留一个轮询器） |
| 预算 | 发起前**预留 8 credits**；结果返回后按 `credits_consumed` 核销；无数据（0 credits）释放预留 |
| 记账 | 以账本记录 `provider:'apollo', field:'mobile', status:'hit'/'miss'/'timeout'/'error'`，`cost:null`（除非拿到 `credits_consumed` 才写实数） |
| 落地 | 同步阶段拿到的 email/身份可即时落地；手机在轮询就绪后**二次回写**线索（需临时缓存候选上下文） |

### 2.3 方案 B —— `webhook`

| 维度 | 设计 |
|---|---|
| 适用前提 | 仅当存在**云端后端**（Premium，Cloudflare Workers）且用户配置了可达 HTTPS 端点时可行 |
| 代价 | 联系人手机将**投递到第三方端点**，与「本地优先、数据默认不出本机」的产品口径**冲突**，需要单独的合规与开关 |
| 异步状态机 | 同步响应 → 等待 webhook 事件 → 校验 → 回写；建议 `request_id` + 事件幂等键 |
| 超时/重试 | webhook 未达时用 **poll 兜底**（官方支持按 `request_id` 拉取）；失败可重放 |
| 幂等 | `request_id` + 事件去重；重复事件不得重复计 credit/重复回写 |
| 预算 | 同方案 A（返回才计费；8 credits/手机） |

### 2.4 两方案共同约束

- **授权门控不可绕过**：未授权/开关关闭 → **不发起请求**（沿用 `enrichment.mobile === true` 判定）。
- **不得以 `setTimeout` 假成功**（宪法约束）：轮询必须基于真实 `poll webhook result` 响应。
- **当前实现必须先修 §2.4 前置**：把 `reveal_phone_number` 改为**仅在真正具备 poll/webhook 通道时**发送，否则所有 Apollo 请求被 400 拒绝（见 §2.4 / R2）。

---

## 3. 商业使用边界审查

### 3.1 文档覆盖现状

| 文档 | 是否记录 Apollo/Prospeo 的 API 授权 / 商业集成 / 数据留存 | 证据 |
|---|---|---|
| `PROVIDER-CAPABILITY.md`（能力 SSOT） | **否**——全文**零** Prospeo/Apollo 提及（本轮计数 = 0） | D-6 仍未闭环 |
| `kone-PRD.md` | 仅提及 Apollo 预算常量（`ENRICH_LOOKUP_BUDGET=20`，§常量表），**无授权/留存条款** | `kone-PRD.md:44` |
| `docs/plans/KONE-DATA-PIPELINE-AUDIT.md §7.3` | 将三家供应商条款列为 **`[待验证]`**，明确「在确认前不得宣称获得商业使用授权」 | 该文 §7.3 |
| 其它 docs | 未发现 API 授权 / ToS / DPA / 数据留存专项记录 | 本轮全库 grep 无命中 |

### 3.2 结论（口径纪律）

- **未获书面授权前**，Apollo / Prospeo 的**对外商业分发资格一律标记为「待确认」**。
- **不得**在任何对外话术、宣传或 PRD 中宣称这两个数据源「已可商用 / 已授权嵌入付费产品分发」。
- 必须先由法务/商务核实三件事：① 是否允许将 API 返回**联系人数据嵌入商业产品**交付终端客户；② 是否允许**本地持久化 + 二次分发（CSV 导出）**；③ 是否要求终端客户 **BYOK**。
- 数据留存：本轮未发现任何 Prospeo/Apollo 的**留存期限**书面记录；**枚举见 R1.6** —— 缓存 TTL 属实现自定，**不等于**供应商条款允许的留存上限，需以条款为准。

---

## 4. 测试

### 4.1 本轮已运行的现有测试（不虚构结果）

命令：`node --test tests/business-logic/contact-enrichment-tiered.business.test.js tests/business-logic/enrich-apollo.business.test.js tests/business-logic/enrich-prospeo.business.test.js`

结果：**tests 52 / pass 52 / fail 0 / skip 0**（运行于已构建的 `dist-electron`，其 mtime 晚于源码，判定为 `ef2badd` 产物）。

> 说明：这三个文件覆盖 Step 2B/2E/3/4 与两个适配器。测试**全绿**与上文发现的缺口**并不矛盾**——缺口集中在「缓存跨联系人 / TTL 分型」「回退质量判定」「手机可信与账本一致性」，这些点**当前无守护测试**（如 §4.2）。测试本身无造假；但**测试覆盖面未覆盖已发现的缺陷**。
> 既有测试改动（`enrich-apollo` / `enrich-prospeo`）为**语义变更的同步**（如 `used:false → used:true` 因身份即产出），**未见放水**（断言更严，未删除对关键行为的断言）。

### 4.2 新增测试建议（设计，覆盖要求的六类）

| 用例 | 断言要点 | 目标风险 |
|---|---|---|
| 同域名两个不同联系人 | 缓存**不跨联系人**命中；邮箱不串值（键含 contactKey 时） | R1 |
| 缓存 TTL 分型 | 邮箱项 **14d** 过期；身份项 **30d**；整对象写入后邮箱仍按 14d | R1 |
| `Prospeo UNKNOWN/RISKY → 继续回退 Apollo` | `apollo` 分支被执行（非 `skipped`） | R2 |
| `Prospeo VERIFIED → 不回退` | Apollo 记 `skipped` | R2 |
| Apollo 请求体（未授权手机时） | **不含** `reveal_phone_number:true`；无 webhook/poll | R2/§2 |
| `confidenceScore=0` 的显式表达 | `confidenceKnown===false`；导出/UI 不渲染 `0 / 100` | R3 |
| `cost=null` 不等于零成本 | sum `unknownCostCalls` 计入、`byUnit` 不计入 | R4 |
| 超时 vs 无命中 | 超时记 `error/timeout`，**不记 miss** | R4 |
| 密钥未配置 vs 未开启 | 两种状态**可区分** | R4 |
| 手机档位与冲突保留 | Apollo 手机非 verified 时**不得**标 verified；落选手机进 `conflicts` | R5 |
| 手机档位优先 | 候选(extracted) mobile **不得**压过 Prospeo(verified) mobile | R5 |
| 冲突保留（邮箱）回归 | `conflicts` 含落选且不同值项 | R5（已有，保持） |

> 上述用例**本轮仅设计，未实现**（任务禁止修改业务代码与本任务范围外模块）。

---

## 5. 本轮明确未做 / 待核实

**未做**：
- 未修改任何业务代码、依赖或配置；未进行真实外发；未调用付费 API。
- 未实施 R1/R2/R5 的修复，未实施 §2 手机补全。
- 未新增测试文件（仅给出设计）。

**待核实（需真实样本/账单/法务）**：
- `[待实测]` Apollo 携带 `reveal_phone_number:true` 且无 webhook/poll 的真实响应码（官方契约判为 400，本轮未出网验证）。
- `[待实测]` Apollo 计费触发（「返回才计费」在含手机请求下的真实账单）。
- `[待核实]` Prospeo / Apollo 的 ToS、DPA、留存期限（§3）。
- `[待核实]` 生产 `byUnit` 恒空、全局账本无消费方是否为有意缺省（当前判定为「可观测性未接线」，非缺陷）。

---

## 附录：证据索引

| 主题 | 文件 | 关键位置 |
|---|---|---|
| 缓存键 / TTL / 读写 | `electron/services/search/enrichment-cache.ts` | `38-42`、`55-66`、`69-94` |
| 整对象写入 identity 键 | `electron/services/search-service.ts` | `1184-1212`（Prospeo）、`1278-1303`（Apollo） |
| 回退门禁 | 同上 | `1258`、`1268-1274` |
| Apollo 请求体（恒发手机 reveal） | `electron/services/search/enrich-apollo.ts` | `129-135` |
| Apollo Fail-Closed / match_confidence | 同上 | `149-151`、`156-176`、`203-206` |
| Prospeo 邮箱状态判定 | `electron/services/search/enrich-prospeo.ts` | `205-208`、`241-244` |
| 邮箱档位映射 / 取值 | `electron/services/search-service.ts` | `1388-1401` |
| 手机选择（未按档位） | 同上 | `1036-1099`（`verified` 在 `1059-1070`） |
| 富化决策人写入 / confidenceScore=0 | 同上 | `1437-1454`、`1459-1486` |
| 决策人合并（主进程 / Store） | `search-service.ts:486-497`；`src/store/leads-store.ts:243-293` | — |
| 成本记录 / 汇总 | `src/shared/enrichment-cost.ts` | `41-53`、`101-121` |
| 账本（内存/有界） | `electron/services/search/enrichment-ledger.ts` | `14-18`、`29`、`49-73` |
| 三档模型 / 档位优先 / 冲突 | `src/shared/contact-provenance.ts` | `22-50`、`81`、`99-146` |
| 静态验证不臆造 | `electron/utils/contact-validation.ts` | `1-9`、`40-59` |
| ICP 预评分（不读 confidenceScore） | `electron/services/search/scoring.ts` | `86-95` |
| Agent 管道门禁（仅判 linkedinUrl） | `electron/services/agent-pipeline.ts` | `129-152` |
| 导出显示 0/100 | `electron/services/export-service.ts` | `347` |
| 能力 SSOT（未含 Prospeo/Apollo） | `PROVIDER-CAPABILITY.md` | 全文（计数 0） |
| 供应商条款待核实 | `docs/plans/KONE-DATA-PIPELINE-AUDIT.md` | §7.3 |
| Apollo 手机契约 | `docs.apollo.io/reference/people-enrichment`、`retrieve-mobile-phone-numbers`、`poll-webhook-result` | — |
