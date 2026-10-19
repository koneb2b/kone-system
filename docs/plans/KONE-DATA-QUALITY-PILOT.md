# Kone 数据质量试点方案（Phase 2 · 只读审计 + 试验设计）

> **状态**：草案 — **本文件不授权任何真实付费 API 调用**。执行真实采样前，须由人工在「§六 预算与批准」中明确 **供应商 / 调用范围 / 预算上限** 三项后放行。
> **日期**：2026-10-17
> **审计基线**：commit `ef2badd10b4a747d8eeff75264cc6753d55395a3`（`main`，`v1.4.36`）
> **工作区状态**：8 个已修改文件 + 4 个未跟踪文件（**均为 Phase 1 已验收产物，本阶段只读、不得改动**）
> **权威文档链**：`kone-PRD.md §0.8 / §零.3`、`PROVIDER-CAPABILITY.md`、`CLOUD-COLLABORATION-DELIVERY.md`、`docs/plans/KONE-ENRICHMENT-REVIEW-1436.md`

---

## 一、背景与目标

### 1.1 为什么做这个试点
Phase 1（R1 缓存隔离 + R2 Apollo 标识门控 + 邮箱质量回退）已验收通过（全部门禁绿：4 套业务测试 69/69、`test:unit` 581/581、`typecheck`/`verify:consistency`/ESLint/Prettier/`git diff --check` 均通过）。但**代码正确性 ≠ 数据质量**。审计 `KONE-ENRICHMENT-REVIEW-1436.md` 反复指出：真实匹配率、邮箱有效率、单位成本**从来没有被实测过**（D-6：`PROVIDER-CAPABILITY.md` 只覆盖采集 Provider，对 Prospeo/Apollo 富化适配器**零覆盖**）。

### 1.2 本阶段目标
1. **只读审计**：把「联系方式从采集到落库」的完整数据链用 `file:line` 证据钉死（§二）。
2. **设计一个可重复、低成本、小样本**的数据质量验证流程（§三–§五）。
3. **产出本方案**，作为人工批准后执行的唯一依据。
4. **绝不**在本阶段发起真实付费请求、不开启手机补全、不进行任何真实触达、不上传真实客户联系人。

### 1.3 非目标（本阶段明确不做）
- 不重构 Provider 系统、不新增数据供应商、不迁移数据库。
- 不开发 Apollo 手机轮询/webhook、不开发新多 Agent 编排。
- 不实现完整 SaaS/多租户/RBAC。
- 不自动 commit、不自动发布安装包。
- 不修改 Phase 1 已验收实现（除非发现会**阻止本试验**的明确缺陷，且须单独说明并回滚）。

---

## 二、Step 1 只读审计结论（7 问 + 证据）

> 关键区分：**采集 Provider**（`electron/services/providers/*`，实现 `SearchProvider` 接口）≠ **富化适配器**（Prospeo/Apollo，位于 `electron/services/search/*`）。前者产出候选线索，后者补联系方式。二者混淆是历史文档缺口（D-6）的根因。

### Q1 单次搜索会调用哪些 Provider？
- 注册表 `electron/services/providers/index.ts:11-24` 注册 **8 个**：`serpapi-maps`(google_maps)、`serpapi-organic`(google_organic)、`anysearch`、`linkedin-search`、`customs-shipment`、`trade-show`、`yellow-pages`、`facebook-search`。
- 派发逻辑 `electron/services/provider-registry.ts:110-147` `executeAll()`：**按 `isAvailable(config)` 过滤后并行执行**（`Promise.allSettled`，**单源失败互相隔离**）。
- 选择律 `electron/services/search-service.ts:2292-2300`：盲搜 → 全部可用源；调用方显式选 `google_organic` → **仅 Organic**（ARCH-STANDARDS §9.4）。
- 可用性门控：SerpApi 系需 `googleKey`；AnySearch 需 `anysearchApiKey + anysearchBaseUrl`（`provider-registry.ts:111-118`）。
- **真实可用清单以 `PROVIDER-CAPABILITY.md` 为准**；其中 customs/trade 为「web 近似」而非官方库直连。

### Q2 搜索结果如何进入「联系人识别 + 邮箱富化」？
- **两波发射**：第一波 = SerpApi 主源（立即展示/评分）；第二波 = `anySearchPromise + providerPromise` 由 `lateSources` 在评分期间后台聚合（`search-service.ts:2324-2369`）。
- **免费优先**：官网深探从公开页面提取邮箱/电话 —— `contact-extract.ts`（`mailto:`/`tel:`/JSON-LD `organization|localbusiness` 节点/联系页候选 `/contact`…`/impressum`/`wa.me` 直链）。设计意图：**提升免费命中率以降低对付费富化（Apollo）的依赖**（`contact-extract.ts:1-8`）。
- **付费回退**：仅当免费路径未取得**已验证**邮箱时，才进入 Prospeo → Apollo 回退链（`search-service.ts` `enrichDomain`；预算常量 `:2740-2744`）。

### Q3 Apollo 何时被调用？是否拿到足够的人员标识？
- **Phase 1 / R2 硬门控**：Apollo `people/match` **必须**有人员标识（`person_id`/LinkedIn slug/邮箱等），否则记 `skipped_no_identifier`、**不发起调用**（`search-service.ts:1266-1273`）。
- 这修复了旧的「只要首选返回任意非空邮箱就停回退、完全不看验证状态」缺陷。
- 触发开关：手机补全 `enrichmentOptions.mobile === true`（**默认 false**）；邮箱富化 `enrichmentOptions.email !== false`（`search-service.ts`，见审计 §R3）。

### Q4 哪些邮箱状态会终止回退？
- **唯一终止档 = `VERIFIED`**。定义源 `src/shared/email-availability.ts:38`：`VERIFIED_EMAIL_STATES = new Set(['VERIFIED'])`。
- `INVALID/BOUNCED/UNAVAILABLE/NONE/LOCKED` → **不可用**（`email-availability.ts:31`，不入库、不展示）。
- **其余一切**（`UNKNOWN/PROBABLE/RISKY/CATCH_ALL/GUESSED/EXTRAPOLATED` 及 **`VALID`**）→ **可用但未验证**，按 `extracted` 档标注、**不终止回退**。`VALID` 因无任何供应商契约支撑而**刻意排除**（`email-availability.ts:17-24`）。

### Q5 缓存命中 / 跳过 / 无匹配 / 失败如何记录？
- **缓存**（`electron/services/search/enrichment-cache.ts`）：键 = `provider|domain|field|contactScope`；`contactScope` 由 `deriveContactScopeKey()` 派生，优先级 `pid: > li: > em: > nm: > -`（`src/shared/contact-provenance.ts:80-106`）。TTL 按字段：身份 30d / 邮箱 14d / 手机 14d。
- **账本**（`electron/services/search/enrichment-ledger.ts`）：内存态，`MAX_LEDGER_RECORDS=500`；状态枚举 `hit|miss|error|skipped_budget|skipped_not_opted_in|skipped_cache|skipped_not_high_value|skipped_no_identifier`。
  - ⚠️ **缺口**：全局账本当前**无消费方**（审计已记），即运行时记录了但**未对外暴露/未落盘**。
- **成本**（`src/shared/enrichment-cost.ts`）：产出 `EnrichmentCostSummary`（调用次数 / 可确认费用 / 未知计费数），挂到 `SearchExecuteResult.enrichmentCost` 与 `LeadItem.enrichmentCost`。

### Q6 可用于质量分析的现有字段有哪些？
- 线索级（`electron/services/search/types.ts:40-80`、`src/store/leads-store.ts:64-129`）：`company / website / contact / contactTitle / email / phone / phoneKind / contactProvenance / enrichmentCost / matchScore / scoreSource / opportunityScore / dataSourceType / dataSourceNote / decisionMakers[] / customsData / exhibitionFootprints / agentStatus / country / city / source`。
- 字段级溯源（`contact-provenance.ts:24-50`）：`ContactProvenance.email|phone|contact` 各含 `tier / source / grade / kind / verifiedAt / conflicts[]`。
- 决策人（`provider-registry.ts:32-40`）：`name/title/email/phone/linkedinUrl/source/confidenceScore`。
- **可用**：三档可信度分布、字段覆盖率、供应商贡献、成本。**注意**：`grade` 是**供应商自报**状态，**不等于独立验证**（见 §七 风险）。

### Q7 能否导出「每条线索的 Provider 来源 / 字段状态 / 调用记录」？
- **部分可以**：
  - CSV（`src/lib/lead-export.ts:113-146`）：导出 `数据来源 = dataSourceType ?? source`、`邮箱等级 = decisionMakers[0].emailGrade`、`可触达渠道`。→ **Provider 来源 = 可以**；**字段状态 = 仅邮箱等级（部分）**。
  - HTML（`electron/services/export-service.ts:315-352`）：含决策人 `confidenceScore` 与 `phoneValid` 徽标。
- **不能**：CSV/HTML **均不导出** `contactProvenance`（逐字段 tier/source/grade）、`phoneKind`、`enrichmentCost`、`confidenceScore`（CSV）、**账本调用记录**。
- **结论**：本试点若需「逐线索调用记录」，必须**在试验期人工从运行日志/内存账本旁路采集**，或列入后续「导出扩展」独立任务 —— **本阶段不改导出代码**。

---

## 三、Step 2 试验样本设计（30 家公司）

### 3.1 抽样原则
- **ICP 驱动，不臆造**：样本的 `国家 + 行业 + 目标职位` **必须**取自用户**已配置**的 ICP（`userConfig`）。**严禁**假定任何未配置的行业/国家/职位。
- **真实来源**：样本来自**真实搜索结果**中「有可解析官网」的公司；**不得虚构公司、联系人或验证结果**。
- **规模**：**30 家**为首轮样本。**除非**试点数据明确支持扩样，**不得**擅自扩到 50–100。
- **去重**：按注册域名（`website` 主机名）去重，一域名一家。

### 3.2 样本矩阵（待用户确认 ICP 后填充）
| 维度 | 取值 | 来源 |
|---|---|---|
| 目标国家 / 语言 | `__________________` | `userConfig` ICP |
| 目标行业 / 产品词 | `__________________` | `userConfig` ICP |
| 目标买方角色 | `__________________` | `userConfig` ICP |
| 单条线索是否开启邮箱富化 | 是（`email !== false`） | 试验变量 |
| 单条线索是否开启手机补全 | **否**（`mobile = false`，默认） | 试验变量 |

> **手机补全默认关闭**：首轮**只测邮箱**，避免引入 Apollo `reveal_phone_number` 的额外计费与合规面。

### 3.3 采集步骤（人工执行，逐条留痕）
1. 用已配置 ICP 发起**受控搜索**（记录 keyword / country / city / 时间 / `myJobId`）。
2. 在结果中取前 30 家「有官网」的公司，记录 `company / website / dataSourceType / source`。
3. 对每条线索记录**运行日志**（旁路）：免费提取命中字段、是否进入 Prospeo、是否进入 Apollo、账本状态、成本摘要。
4. 落表（CSV 或 Markdown 表），**一公司一行**，字段见 §五。

---

## 四、Step 3 指标定义（A–F，本方案为唯一权威定义）

> **口径铁律**：所有比率**必须用统一分母**；分母在表头显式标注。供应商**自报**状态与**独立验证**结果**分列**，不得混算。**无数据时留空或标注「待验证」，禁止用估算冒充实测。**

| 代号 | 指标 | 定义（分子 / 分母） | 数据来源 |
|---|---|---|---|
| **A** | 有效线索命中率 | 有官网且至少有 1 个可用联系方式的公司数 / 30 | `website` + `contactProvenance` |
| **B** | 联系方式字段覆盖率 | 各字段（email / phone）非空公司数 / 30（**分列**） | `LeadItem.email/phone` |
| **C** | 邮箱可用率与验证率 | 可用 = `assessEmailUsability().usable`；已验证 = `tier==='verified'`（**两者分开报**）/ 30 | `email-availability.ts` |
| **D** | 单位成本 | 可确认费用 / (可用联系方式数)；**分母同时报**经过认证邮箱数 | `EnrichmentCostSummary` + 供应商账单 |
| **E** | Provider / 来源贡献 | 每个来源贡献的可用联系人数字 / 总可用数（**含免费来源**：官网提取 vs Prospeo vs Apollo） | `contactProvenance.source` |
| **F** | 可信度分布与冲突率 | `verified/extracted/inferred` 三档占比；含 `conflicts[]` 的字段占比 / 30 | `contact-provenance.ts` |

**补充口径**：
- 未开手机补全时 **phone 覆盖率**主要反映**免费提取**能力，须在报告中注明。
- 「邮箱有效率」若未经独立 SMTP 验证，**只能**报 `grade` 分布，**不得**宣称「有效」。

---

## 五、Step 4 数据采集与记录表（逐公司一行）

| # | company | website | dataSourceType | 免费命中(email/phone) | 进入 Prospeo(Y/N) | Prospeo 状态 | 进入 Apollo(Y/N) | Apollo 状态 | 账本状态 | 最终 email tier | email grade | phoneKind | 调用次数 | 可确认费用 | 未知计费数 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | | | | | | |
| … | | | | | | | | | | | | | | | | |

**留痕要求**：`myJobId` 与运行时间随批记一行，便于与日志对账。

---

## 六、预算与批准（执行前置门禁）

> **本阶段零调用。** 下表为**待批准清单**，**未获批准前一项都不得执行**。

| 计费项 | 触发条件 | 单次估算 | 30 条样本预估 | 是否本试点启用 | 批准状态 |
|---|---|---|---|---|---|
| Prospeo 邮箱富化 | 免费路径未命中已验证邮箱 | **未知 = `null`** | **`null`（待供应商确认）** | 是 | ☐ 待批 |
| Apollo `people/match` | Prospeo 未果且有人标识 | **未知 = `null`** | **`null`** | 是 | ☐ 待批 |
| Apollo `reveal_phone_number` | `mobile===true` | 未知 | — | **否** | ☐ 关闭 |
| AnySearch | `anysearchApiKey+baseUrl` 已配 | 未知 | 未知 | 视配置 | ☐ 待批 |
| SerpApi | `googleKey` 已配 | 未知 | 未知 | 是（已配） | ☐ 待批 |

- **成本未知一律记 `null`，绝不以 0 冒充**。批准前须先向供应商确认：**套餐权限、单价、是否含验证、数据留存政策**。
- **批准放行时必须点名**：供应商 + 调用范围（上限次数）+ 预算上限。

**批准签字**：`__________` 日期：`__________`

---

## 七、风险与合规边界

| 风险 | 说明 | 缓解 |
|---|---|---|
| 自报 ≠ 已验证 | 供应商 `grade` 可能为 `UNKNOWN/CATCH_ALL` | 一律按 `extracted` 标注，独立验证另列 |
| 成本不可预知 | 单价/权限未确认 | 未确认 = `null`，先问供应商再放行 |
| 频率/配额 | 触发限流或封禁 | 30 条上限、串行/低频、失败隔离 |
| PII 处理 | 样本含真实联系方式 | 仅本地留存，**不上传任何外部系统** |
| 样本偏差 | ICP 未确认会污染结论 | 样本严格来自已配置 ICP |
| 出口能力受限 | 导出不含逐字段溯源/账本 | 试验期**人工旁路留痕**，导出扩展列后续任务 |
| 不能宣称交付 | 未实测前无结论 | 未完成真实采样前，**不得**报告匹配率/有效率/单位成本 |

---

## 八、验收标准

试点**通过**当且仅当：
1. **30 家真实公司**（去重后）全部完成记录，无虚构条目。
2. §四 指标 A–F **全部**用统一分母算出，或明确标注「待验证/无数据」。
3. §五 逐公司表**无空缺**（空值须显式写「无/待验证」）。
4. 成本与供应商账单/控制台**对账一致**（或标注无法对账项）。
5. 全文**无**把自报状态当已验证、**无**用估算冒充实测。
6. 交付后**立即停止**，输出「已完成 / 未能验证 / 当前风险 / 建议下一步」，**不自动扩范围**。

---

## 九、下一步与待验证事项

### 9.1 执行前必须（人工）
1. 确认 ICP（国家/语言/行业/买方角色）→ 填充 §三 样本矩阵。
2. 向 Prospeo/Apollo 确认计费与权限 → 填充 §六 预算表。
3. 在 §六 签字批准 **供应商 + 调用范围 + 预算上限**。

### 9.2 待验证（当前无法给出结论）
- 真实邮箱匹配率 / 有效率 / 单位成本 —— **未实测**。
- 免费提取（官网）对总成本的削减幅度 —— **未实测**。
- `VALID→extracted` 微调对回退次数的实际影响 —— **未实测**。
- 逐字段溯源 / 账本能否导出 —— **当前不能**（§二 Q7），如需则单列任务。

### 9.3 已知缺口（不在本阶段修）
- 全局 enrichment ledger **无消费方**（记录了但不可读）。
- `PROVIDER-CAPABILITY.md` 对 Prospeo/Apollo **零覆盖**（D-6）。
- CSV/HTML 导出**不含**逐字段 provenance / cost / 账本。

---

*本文件为 Phase 2 交付物。未获 §六 明确批准前，不执行任何真实付费调用。*
