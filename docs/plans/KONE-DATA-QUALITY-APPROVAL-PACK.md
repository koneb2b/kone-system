# Kone Phase 2A — B2B 数据质量试验审批方案（Approval Pack）

> **状态**：草案 · **待项目负责人审核批准** · 本文件**不授权任何真实付费调用**。
> **日期**：2026-10-17
> **审计基线**：`main` @ `ef2badd10b4a747d8eeff75264cc6753d55395a3`（`v1.4.36`）
> **工作区**：8 个已修改（Phase 1 代码/测试）+ 6 个未跟踪（4 篇文档 + `src/shared/email-availability.ts` + `tests/business-logic/contact-cache-isolation.business.test.js`）。**这 8+6 项均为 Phase 1 已完成、随工作区带入本阶段的改动**；**Phase 2A / 2A.1 / 2A.2 本身只在 `docs/plans/` 下新增或修改文档，未改动业务代码、配置或 IPC**。
> **本阶段（2A.2）**：在 2A.1 的 Serper 候选评估基础上，**收口 Go/No-Go 前置条件**——证据状态图例（§1.6）/ 负责人待办速览（见开头）/ 现有本地历史数据审计（§1.7）/ Serper 定位与 2B 可执行性分析（§4.5）/ 供应商确认问题草稿（附录 A）/ 工作区处置选项（§10.2）。**Serper 仍仅为候选，未集成、未调用、未入注册表**。
> **设计详版**：`docs/plans/KONE-DATA-QUALITY-PILOT.md`（本文**引用**其设计，不复制为第二权威源）
> **本文与详版的关系**：详版 = 试验**设计**；本文 = 可供负责人**批准**的**执行+授权+预算+Go/No-Go** 清单。冲突时以本文的审批口径为准，设计细节回指详版。

---

## 负责人待办速览（先看这一页）

> 目的：让负责人**一页即可决策**。以下四组事项任一组未决，结论保持 **No-Go**；**免费额度不改变门禁状态**。

| # | 待办事项（问题） | 影响 | 谁能回答 | 未答默认 |
|---|---|---|---|---|
| A | **ICP 待确认**：目标国家/地区、目标行业、目标公司类型及规模、工作邮箱最低质量、手机是否必需、单公司最大补全预算（详见 §2.2） | 无法确定样本地域/行业与「有效邮箱」分母；样本不具可比性 | 项目负责人 | **No-Go** |
| B | **供应商授权**：SerpApi / Prospeo / Apollo 三家「集成进商业软件 + 向终端客户交付结果」是否取得**书面授权**；候选 Serper 的授权是否明确 | 三家官方 ToS 均构成限制或**明文需授权**；未授权不得集成/交付 | 项目负责人 / 法务 | **No-Go** |
| C | **计费规则**：各供应商套餐单价 / credit 单价（多为 **UNCONFIRMED**）须先书面确认 | 未知费用不得按 0 计，无法编制预算与停止条件 | 项目负责人 / 供应商 | **No-Go** |
| D | **预算与批准**：签署 §6.2 全表（允许的供应商/端点/数据类型/样本数/预算上限/停止条件/删除要求） | 无签字预算则无法启动受控试验 | 项目负责人 | **No-Go** |

> **一句话**：先补齐 A/B/C/D，再按 §十 复核门禁；**不得因免费额度、高评分或试验紧迫而豁免授权**。

---

## 一、当前基线及引用文档

### 1.1 基线事实（本阶段只读核实）
| 项 | 值 | 来源 |
|---|---|---|
| 分支 / HEAD | `main` / `ef2badd10b4a747d8eeff75264cc6753d55395a3` | `git rev-parse` |
| 版本 | `1.4.36` | `package.json` |
| 工作区 | 8 modified + 6 untracked（均为 Phase 1 已完成、随工作区带入的改动） | `git status` |
| 技术栈 | Electron + React + TypeScript（本地优先，数据默认不出本机） | `README.md` |

> 组成：6 个未跟踪 = 4 篇文档（`KONE-DATA-QUALITY-APPROVAL-PACK.md`(本文) / `KONE-DATA-QUALITY-PILOT.md` / `KONE-ENRICHMENT-PHASE1-FIX.md` / `KONE-ENRICHMENT-REVIEW-1436.md`）+ `src/shared/email-availability.ts` + `tests/business-logic/contact-cache-isolation.business.test.js`；8 个修改为 Phase 1 代码/测试改动。**Phase 2A/2A.1/2A.2 未新增业务改动。**

### 1.2 引用文档（按权威层级）
| 文档 | 角色 | 本文引用方式 |
|---|---|---|
| `kone-PRD.md` | 全局唯一权威需求主源（§零.3 宪法常量、§四.2 数据主权、§0.8 Provider 契约） | 指针引用，不复制数值 |
| `PROVIDER-CAPABILITY.md` | **采集 Provider** 真实能力唯一事实源 | 直接引用；**对 Prospeo/Apollo 零覆盖**（见 §1.3） |
| `CLOUD-COLLABORATION-DELIVERY.md` | 云端协同/投递/审批领域唯一事实源（当前发布判定 `NO-GO`） | 本文不涉投递 |
| `docs/plans/KONE-ENRICHMENT-REVIEW-1436.md` | Phase 1 前审计（R1–R5 / D-1..D-6） | 引用 |
| `docs/plans/KONE-ENRICHMENT-PHASE1-FIX.md` | Phase 1 修复报告（已验收） | 引用 |
| `docs/plans/KONE-DATA-QUALITY-PILOT.md` | 本试验设计详版 | 引用 |

### 1.3 关键结构性结论：**两类 Provider 必须分开讨论**
1. **公司发现 Provider（采集层）** —— `electron/services/providers/*`，实现 `SearchProvider`，注册于 `providers/index.ts:11-24`（8 个：`serpapi-maps` / `serpapi-organic` / `anysearch` / `linkedin-search` / `customs-shipment` / `trade-show` / `yellow-pages`（已弃用）/ `facebook-search`）。
2. **联系人补全适配器（富化层）** —— `electron/services/search/enrich-prospeo.ts` / `enrich-apollo.ts`，**不属于**采集 Provider，`PROVIDER-CAPABILITY.md` 对其**完全未覆盖**（审计 D-6）。
> 本审批方案对二者分别列表，禁止混读能力与成本。

### 1.4 已由代码证实的补全链事实（只读核实）
- **BYOK（客户自带密钥）**：Prospeo/Apollo 密钥经 `secret-manager` 加密落盘（`SECRET_KEYS.PROSPEO_API_KEY='secrets.prospeo.apiKey'`、`SECRET_KEYS.APOLLO_API_KEY='secrets.apollo.apiKey'`；`enrich-prospeo.ts:43-49`、`enrich-apollo.ts:36-42`）。与 PRD §1「客户自带密钥（LLM/SerpApi/AnySearch）」的燃料自理模型一致。（`CODE_VERIFIED`）
- **默认策略**：`DEFAULT_ENRICHMENT_OPTIONS = { email: true, mobile: false }`（`enrichment-cost.ts:88`）→ **手机默认关闭**。（`CODE_VERIFIED`）
- **回退链**：免费官网提取 → **Prospeo**（低成本前置）→ **Apollo**（有人员标识时）。终止条件 = 拿到 `VERIFIED` 邮箱（`email-availability.ts:38`）。（`CODE_VERIFIED`）
- **Apollo 无公司级找人**：`people/match` 缺人员标识即 `skipped_no_identifier`，不发起（`enrich-apollo.ts:169-174`）。（`CODE_VERIFIED`）
- **Apollo 手机需异步通道**：`reveal_phone_number` 同步端点会被官方 `400 WEBHOOK_URL_REQUIRED` 拒绝 → 当前**恒为 false、功能不可用**（`enrich-apollo.ts:145-150,181-183`）。（`CODE_VERIFIED` + 官方限制作依据）
- **预算护栏（每轮搜索）**：`ENRICH_LOOKUP_BUDGET=20`（Apollo，仅 `matchScore>=60`）、`PROSPEO_EMAIL_BUDGET=10`、`PROSPEO_MOBILE_BUDGET=2`（`search/constants.ts:71,83,91`）。（`CODE_VERIFIED`）
- **并发红线**：`SEARCH_LLM_CONCURRENCY=SEARCH_ENRICH_CONCURRENCY=2`、`SEARCH_FANOUT_CONCURRENCY=3`（`constants.ts:22-29`，PRD §零.3）。（`CODE_VERIFIED`）
- **账本缺口**：`getEnrichmentLedger()`/`summarizeEnrichmentLedger()` 已导出但**无消费方**；仅 `recordEnrichmentCall` 被 import（`search-service.ts:22`）→ 运行时记录了但**不可读/未落盘**。（`CODE_VERIFIED`）

### 1.5 已实现 vs 候选（严格区分，禁止混淆）
| 类别 | 对象 | 状态 | 证据 |
|---|---|---|---|
| **已实现（运行时注册表内）** | SerpApi Organic（`dataSourceType='google_organic'`，`engine=google`） | ✅ 生产可用 | `providers/index.ts:11-24`、`serpapi-organic-provider.ts`、`PROVIDER-CAPABILITY.md:18` |
| **候选（本阶段仅评估）** | **Serper**（`https://google.serper.dev`） | ⛔ **未集成 / 未验收 / 不在注册表 / 不在能力 SSOT** | 本文 §四.4 / §五.2 / §六（仅评估） |

> **红线**：Serper 当前**不是**已实现 Provider，**不得**写入 `providers/index.ts`、`PROVIDER-CAPABILITY.md` 或任何运行时注册表；其能力仅为**候选评估结论**。

### 1.6 证据状态图例
本审批包内每项关键主张按下述六类状态标注；**未标注即视为待核**。
| 状态标签 | 含义 |
|---|---|
| `CODE_VERIFIED` | 有代码事实支撑（附 `file:line`），可复现。 |
| `OFFICIAL_VERIFIED` | 官方一手页面已证实（附 URL + 核实日期 2026-10-17）。 |
| `NEEDS_WRITTEN_CONFIRMATION` | 须先取得书面授权 / DPA / 协议方能放行。 |
| `OWNER_INPUT` | 只能由项目负责人提供（如 ICP、预算）。 |
| `UNCONFIRMED` | 未能从官方一手页面确证，**不得按已知计、不得按 0 计**。 |
| `NOT_MEASURED` | 只有真实试验完成后才可能产生的数据，**当前一律不得填数**。 |

### 1.7 现有本地历史数据审计（只读·聚合）
> **本节只写聚合统计，不写入任何联系人明细 / PII，不上传，不调用 API。**

- **位置**：`C:\Users\Administrator\AppData\Roaming\kone-system\`。
- **规模**：`backups\` 共 **7 份** JSON（2026-09-27 → 2026-10-16，每份约 70–72 KB）；同目录另有 `kone-config.json`（约 55.8 KB）、`kone-secrets.json`（约 1 KB，`{v:1, encrypted:true}`，**密文**）、`logs\`、`Cache\` 等。
- **可用字段**：每条 `leads` 含 `id/company/contact/contactTitle/email/phone/country/countryCode/industry/source/matchScore/scoreSource/status/followUp/starred/lastActivity/addedDate/tags/unlocked/website/estimatedValue/address/snippet/matchReasons/riskFlags/dataSourceType/exhibitionFootprints/agentStatus`（个别条目另有 `customsData` / `generatedStrategies` / `analysisCache`）。

**每份备份内 `leads` 条目数恒为 17（7 份一致）。最新一份（`backup-2026-10-16T15-53-59-954Z.json`）聚合：**
| 维度 | 分布 |
|---|---|
| `dataSourceType` | google_maps 15 / google_organic 2 |
| `source`（原始字符串） | "Google Maps" 14 / "google_maps" 1 / "google_organic" 2 |
| `countryCode` | GL 9 / US 7 / UN 1 |
| `status` | new 14 / replied 2 / archived 1 |
| `scoreSource` | **deterministic 17（100%）** |
| 有邮箱 | **0 / 17** |
| 有电话 | 15 / 17 |
| 有联系人姓名 | **0 / 17** |
| 有职位 | **0 / 17** |
| 有 `linkedinUrl` | **0 / 17** |
| `matchScore` 分布 | ≥80 = 9 / 60–79 = 3 / 40–59 = 5（**≥60 者 12 / 17**） |
| `agentStatus.whatsappSent` | false 17 / 17 |
| `agentStatus.linkedinContacted` | false 17 / 17 |
| `exhibitionFootprints` 非空 | 7 / 17 |
| `customsData.lastShipmentDate` 存在 | 7 / 17 |
| `decisionMakers` 字段 | 不存在（0 / 17） |
| `addedDate` 范围 | 2026-09-07 → 2026-09-14 |

> ⚠️ **诚实性提示（`NOT_MEASURED`）**：该历史集合**没有任何工作邮箱、联系人姓名、职位或 LinkedIn URL**，且**全部为 `scoreSource=deterministic`（AI 评分未生效）**。因此它**不能作为富化链（邮箱/手机补全）有效性的验证依据**，仅用于说明**数据规模与可用字段**。
> ℹ️ **数据卫生观察**：备份为「整包快照」，随附**加密**的凭据副本（`kone-secrets.json`，`v:1` 密文）与设备锚点文件；**本审批包不记录任何凭据值**。

---

## 二、已确认的 ICP 与待确认字段

> **来源原则**：只从现有 PRD 与产品配置中提取；**不足即标「待负责人确认」**，并说明对试验的影响。**不虚构目标市场/行业/客户类型。**

### 2.1 已确认（代码/PRD 中存在）
| 字段 | 已确认值 | 来源 |
|---|---|---|
| 目标产品 | `icpProfile.targetProduct`（用户自填，默认空串） | `config-store.ts:6-11,39-44` |
| 买方角色 | `icpProfile.buyerPersona ∈ {distributor, integrator, brand_owner, oem, wholesaler, ''}` | `config-store.ts:4-9` |
| 核心优势 | `icpProfile.coreAdvantage` | 同上 |
| 负向 ICP（须排除） | `icpProfile.negativeIcp` | 同上 |
| 必须排除的公司（结构化） | B2C/零售终端、Repair 维修、Used 二手翻新、电商平台卖家（Amazon/eBay/AliExpress/Shopee）、纯博客/资讯站 | PRD §0.5.1 Stage 0.5（`computeEligibilityVeto`，已落地） |
| 评分权重 | ICP 匹配 40/30/20/10（域名/产品词/B2B信号/联系人） | PRD §零.3 |
| 必须获得的联系人字段（触发下游） | `matchScore>=60` 且 `email\|phone\|linkedinUrl` 任一 | PRD §零.3 |

### 2.2 待负责人确认（当前资料不足）
| 字段 | 现状 | 若不确认对试验的影响 |
|---|---|---|
| **目标国家 / 地区** | **未持久化**（仅每次搜索入参 `country/city`） | 无法确定样本地域；本地语言变体、SerpApi/可发现性均随国家变化 |
| **目标行业** | **未持久化**（仅搜索入参 `industry`） | 无法界定 `search-person`/官网命中率，样本不具可比性 |
| **目标公司类型及规模** | **无字段** | 无法判定 "distributor vs 大型进口商" 的命中率差异 |
| **工作邮箱的最低质量要求** | 代码口径 = `VERIFIED` 才终止回退；产品口径未签 | 影响「有效邮箱」分母定义 |
| **手机是否为必需字段** | 代码默认 `false`（非必需） | 决定 Apollo/Prospeo 手机（高成本）是否纳入 |
| **每家公司的最大补全预算** | **未设定** | 无法计算单位成本与停止条件 |

> ⚠️ **红线**：在 §2.2 全部确认前，**不得**为自动补全文档而虚构 ICP，**不得**假定样本分布具代表性。

---

## 三、30 家样本矩阵模板

> **抽样规则**（详版 §三）：ICP 驱动、真实来源、按域名去重、首轮 30 家、**不预填公司名单**。

### 3.1 抽样规则（执行前需负责人确认 ICP 后生效）
1. 用**已确认的 ICP** 发起受控搜索；记录 keyword/country/city/时间/`myJobId`。
2. 取前 30 家「有可解析官网」的公司，按注册域名去重。
3. 一公司一行，逐字段留痕（空值写「待核/无」，不留空白）。

### 3.2 空白模板（供人工填写）
| 样本ID | 公司名称 | 域名 | 国家 | 行业 | 公司类型 | 纳入理由 | 人工核验来源(URL) | 决策人姓名 | 决策人职位 | 已知工作邮箱 | 公开电话 | 字段核验状态(邮箱) | 字段核验状态(电话) | 冲突/缺失说明 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S01 | | | | | | | | | | | | | | |
| S02 | | | | | | | | | | | | | | |
| … | | | | | | | | | | | | | | |
| S30 | | | | | | | | | | | | | | |

---

## 四、Provider 能力与调用条件核对表

> **本表 = 我们代码中的真实行为（内部事实）** + **待官方核对的字段**。官方条款引文见 §五（已回填官方 URL + 核实日期 2026-10-17）。

### 4.1 公司发现 Provider（采集层）
| Provider | 公司发现 | 目标联系人发现 | 工作邮箱补全 | 手机补全 | 手机异步 | 返回状态 | 计费单位（代码口径） |
|---|---|---|---|---|---|---|---|
| SerpApi Maps/Organic/LinkedIn/Customs/Trade/Facebook | ✅ 是 | 仅 LinkedIn 检索含有限公开信息 | ❌ | ❌ | — | 原生字段归一 | `request` |
| AnySearch | ✅ 是（多源聚合） | 是（含 `decisionMakers` 字段） | 视上游 | 视上游 | — | 归一为 `SearchExecuteResult` | 未知（第三方） |

### 4.2 联系人补全适配器（富化层）
| 适配器 | 公司发现 | 目标公司内找人 | 补全工作邮箱 | 补全手机 | 手机异步 | 返回状态 | 计费单位 |
|---|---|---|---|---|---|---|---|
| **Prospeo** | ❌（非发现源） | ✅ `search-person`（按域名，最多 500 域名/次） | ✅ `enrich-person`（`only_verified_email:true`） | ✅ `enrich_mobile` | ❌ 同步 | 邮箱 `VERIFIED/UNKNOWN/RISKY/CATCH_ALL/INVALID…`；手机号定义上为 mobile | `credit` |
| **Apollo** | ❌（非发现源） | ❌ `people/match` **需人员标识**，无公司级找人（Phase 1 明确） | ✅ 有标识时补全 | ⚠️ **当前不可用**（需 `webhook_url`，未实现，恒 false） | ✅（设计上异步） | 邮箱 `verified/guessed/unavailable/bounced/locked`；`match_confidence: none` 视为未命中 | `credit` |

### 4.3 失败原因类别（Fail-Closed 细分，代码事实）
- Prospeo：`missing_key | invalid_target | http_error | api_error | no_match | network_error`（`enrich-prospeo.ts:95-101`）。
- Apollo：`missing_key | no_target | insufficient_identifier | http_error | api_error | no_match | network_error`（`enrich-apollo.ts:84-91`）。

### 4.4 候选供应商评估（**未集成**）—— Serper
> 仅作候选评估；**未写入注册表 / 能力 SSOT / 运行时**。端点/参数/错误语义以 Serper 官方 Playground 为准（官方无公开 docs 站，标 **UNCONFIRMED**）。
> **证据状态**：本表标 **UNCONFIRMED** 项 = `UNCONFIRMED`；「设计推断 / 预期 / 未实测」项 = `NOT_MEASURED`；「Serper 未集成」本身 = `CODE_VERIFIED`（见 §1.5 红线）。标签含义见 §1.6。
| 项 | 评估结论 | 状态 / 来源 |
|---|---|---|
| 资源类型 | `google_organic` 等价（Google Organic SERP） | 候选映射，**未接线** |
| 端点 / 方法 | `POST https://google.serper.dev/search`（亦可 GET `?apiKey=`） | 官方站点 + 社区引用（**UNCONFIRMED**） |
| 认证 | `X-API-KEY: <key>` 头（或 `apiKey` 查询参数） | 同上 |
| 参数 | `q`；`gl`(国家 2 位)；`hl`(语言)；`num`(10/100)；`page`(1-based)；`tbs`(`qdr:h/d/w/m/y`)；`location`；`autocorrect` | 同上 |
| 返回字段 | `organic[]`(`title/link/snippet/position`)、`knowledgeGraph`、`peopleAlsoAsk`、`relatedSearches`、`answerBox` 等（**非固定每查必有**） | 同上 |
| 与 SerpApi Organic 等价性 | **高**：同为 Google Organic JSON；SerpApi 用 `organic_results[]`，Serper 用 `organic[]` → 仅需一层 `title/link/snippet/position` 字段映射 | 设计推断，**未实测** |
| 分页 | `page` 1-based；`num` 默认 10、可选 100；**请求 100/页会使该次计费翻倍** | 社区引用（**UNCONFIRMED**） |
| 计费 | 每次 `/search` = **1 credit**；**结果不缓存** → 重复同查询**仍计费**（与 SerpApi 相反） | §六.1 |
| 限流（QPS） | Starter 50 / Standard 100 / Scale 200 / Ultimate 300；**Free 档 QPS UNCONFIRMED** | 官方定价页 |
| 失败语义 | 批量项内错误可能 **HTTP 200 + 逐项 error 对象** → 必须**检查 body**，不得以 HTTP 200 判成功 | 社区引用（**UNCONFIRMED**） |
| 与现有 SerpApi 重合度 | **预期高**（同 Google 源），增量可能主要是**排名/覆盖微差**，**未实测** | 待 §七 对照 |
| 预期改动范围 | 若采纳：新增 `serper-provider.ts` + 注册 + 字段映射 + 独立 Key 配置项（`X-API-KEY`，与 `googleKey` **不同密钥**）；**本阶段一律不做** | 设计估算 |

### 4.5 Serper 定位与 Phase 2B 可执行性分析（未集成）
> 分析性附录；**不改变任何现状**（Serper 仍为候选，未集成、未入注册表）。

1. **技术可适配性（预期高）**：Serper `organic[]` 与 SerpApi `organic_results[]` 同为 Google Organic JSON，仅需一层 `title/link/snippet/position` 字段映射（`NOT_MEASURED`，未实测）。
2. **许可明确性（当前不足）**：Serper ToS **未明确**是否允许「集成进商业软件 / 本地缓存 / 向终端客户展示 / CSV 导出 / 团队共享 / 转售」→ 全部 `UNCONFIRMED`，须书面确认（见 §5.2）。
3. **增量价值（预期有限）**：与现有 SerpApi Organic 同为 Google 源，增量可能主要是**排名/覆盖微差**（`NOT_MEASURED`）。
4. **最小适配范围（若采纳）**：新增 `serper-provider.ts` + 注册 + 字段映射 + 独立 Key 配置（`X-API-KEY`，与 `googleKey` **不同密钥**）。**本阶段一律不做。**
5. **三种候选角色各能证明什么**：
   | 角色 | 能证明 | 不能证明 |
   |---|---|---|
   | **替代** | Serper 单独能否达到 SerpApi 的发现覆盖 | 成本 / 许可是否更优（未确证） |
   | **回退** | 单一源故障时能否顶上（可用性） | 结果质量是否等价（未实测） |
   | **增量补充** | 去重后能带来多少**独立新增**合格域名（指标 #10/#11） | 单位成本是否更低（未对账） |
6. **指标 A–F 在「不改代码」前提下的可记录性**：§七 指标 #1–#9 中，#1/#2/#3/#6 依赖人工核验（**可记录**）；#4/#5/#7/#9 依赖 provenance / 缓存键 / 账单 / `failureKind`（**部分可记录**，账本当前无消费方 → 见 §1.4 账本缺口）；#10–#12（双源对照）**当前不可记录**（需对照表与账单）。**缺口补齐方案仅为提议**：启用账本落盘 / 导出、建立双源对照表——**须另行批准，本阶段不做**。

---

## 五、商业授权与数据留存核查表

> **核实要求**：仅采信**官方** API 文档 / 定价页 / 服务条款 / 书面授权；第三方文章仅供参考。**未核实一律标「UNCONFIRMED」，不得猜授权。**
> **状态**：官方条款**已检索并回填**（见 §5.2 引用区；统一核实日期 **2026-10-17**）。三方 `librarian` 后台任务超时失败（`bg_5dcf0128` / `bg_ab62645b` / `bg_76b5a769`），已改由直接 `websearch` / `webfetch` 抓取官方一手页面补齐。

### 5.1 我方既有事实（代码/PRD）
| 项 | 事实 | 来源 |
|---|---|---|
| 集成形态 | 本地 Electron 桌面商业软件；密钥 BYOK（终端客户自备） | `README.md`、`secret-manager`、PRD §1 |
| 本地存储/缓存 | 有（富化缓存 `enrichment-cache.ts`，键 `provider|domain|field|contactScope`） | 代码 |
| 上云/外发 | **产品承诺本地优先**：PRD §四.2「严禁将决策人姓名/高保密邮箱/海关数据上传至第三方云端」；上云须 Gold Filter 白名单裁剪 | PRD §四.2 |
| 导出 | CSV 本地导出（`lead-export.ts`）；不含逐字段 provenance/账本 | 代码 |
| 数据流向供应商 | Prospeo/Apollo：发送**人员标识/域名**以换邮箱（属向第三方发送线索数据） | `enrich-*.ts` |

### 5.2 商业授权与留存核查（官方条款已回填）
| 供应商 | 集成于商业桌面软件 | 本地存储/缓存 | 向终端客户提供结果 | CSV 导出/团队共享 | 数据留存期限 | BYOK 要求 | 额外书面授权 |
|---|---|---|---|---|---|---|---|
| **SerpApi** | ⛔ **需书面许可**（ToS 禁未授权 reproduce/copy/sell/resell/exploit） | ⚠️ 客户端缓存授权 **UNCONFIRMED**；官方侧留 31 天 | ⛔ **需书面许可**（同再分发口径） | —（同再分发，UNCONFIRMED） | ✅ **31 天**后自动删除；ZeroTrace 可禁存 | ✅ API Key 客户自持 | ⛔ **需要** |
| **Prospeo** | ⛔ **需书面许可**（ToS 1.1 限"内部使用"） | ⚠️ **UNCONFIRMED**（见 DPA） | ⛔ **需书面许可**（ToS 1.2 禁转售） | ⚠️ **UNCONFIRMED** | ⚠️ 公开条款未给统一期限（见隐私政策） | ✅ `X-KEY` 客户自持 | ⛔ **需要** |
| **Apollo** | ⛔ **明文禁止**（除非获 Apollo 授权/批准） | ⚠️ **UNCONFIRMED** | ⛔ **明文禁止**（API ToS 禁 sublicense/sell/distribute；外部产品须另签协议） | ⚠️ 导出消耗 credit，对外分发仍属禁止项 | ⚠️ **UNCONFIRMED** | ⚠️ API 通常需 Custom/企业计划 | ⛔ **必需** |
| **Serper**（候选） | ⚠️ **UNCONFIRMED**（ToS **未明确**许可或禁止集成进商业软件） | ⚠️ **UNCONFIRMED**（ToS 未述本地缓存；"不缓存"指其服务侧） | ⚠️ **UNCONFIRMED**（ToS 未明确向终端客户展示） | ⚠️ **UNCONFIRMED** | ⚠️ 留存至账户存续 + 法定义务（**无固定期限**） | ✅ `X-API-KEY` 由客户自持（BYOK 一致） | ⚠️ **建议书面确认**（集成/再分发未明示） |

> **图例**：✅ = `OFFICIAL_VERIFIED`（官方一手页面已证实为允许 / 已核实事实）；⚠️ = `UNCONFIRMED`（未能从官方一手页面确证，须负责人/法务二次确认）；⛔ = `NEEDS_WRITTEN_CONFIRMATION`（官方条款构成限制或**明文需授权**）。标签含义见 §1.6。
>
> **引用区（官方文档，统一核实日期 2026-10-17）**：
> - **SerpApi**
>   - https://serpapi.com/legal （Terms of Service + Privacy）：ToS 明文 "You agree not to reproduce, duplicate, copy, sell, resell or exploit any portion of the Service … without express written permission by us"；**U.S. Legal Shield** 上限 $2M、**排除 Free / Starter / Developer 计划**、仅美国；搜索数据留存 **31 天**后自动删除，ZeroTrace Mode 可完全禁存；管辖法为 Texas。
>   - https://serpapi.com/pricing ：仅**成功**搜索计费；缓存/报错/失败**不计**；返回条数不影响计数。Free 计划配额页面标注**不一致（100 vs 250）→ UNCONFIRMED**。
>   - ⚠️ UNCONFIRMED：**空结果集是否按 1 次搜索计费**（博客口径 vs 定价页措辞），及"客户端本地缓存"的授权条款，须书面向 SerpApi 确认。
> - **Prospeo**
>   - https://prospeo.io/api-docs/search-person 、 https://prospeo.io/api-docs/enrich-person （计费口径见 §6）。
>   - https://prospeo.io/terms-of-service ：1.1 许可**仅限贵司内部** B2B 销售/营销/招聘/运营；1.2 **禁转售、禁用于构建竞争数据库**；credits 到期作废、售出概不退；DPA 见 https://prospeo.io/dpa 。
>   - https://prospeo.io/privacy-policy ：加拿大公司、对自有数据集为控制者；EU/EEA/UK/瑞士数据转移依赖**加拿大充分性认定（PIPEDA）**；主托管美国（AWS us-east-1）。
>   - ⚠️ **排除项**：检索命中的 `prospecco.com/*`（含 `/dpa`）为**另一家供应商 Prospecco**，**不得**作为 Prospeo 引用。
>   - ⚠️ https://prospeo.io/pricing 为 JS 渲染、正文不可抓取 → 套餐单价 **UNCONFIRMED**。
> - **Apollo**
>   - https://www.apollo.io/terms/api （Last Updated **2024-08-13**）：许可**仅限内部业务用途**；"You may not sublicense, sell, or distribute (including but not limited to sharing) the APIs"；"You may not … integrate the APIs with your product or services, unless Apollo has authorized or approved such access or integration."
>   - https://docs.apollo.io/docs/api-pricing （updated **2026-10-07**）：内部业务用途限定；用 Apollo 数据驱动**外部产品、与客户共享或转售须另签协议 + 自定义定价**；API 访问通常在 **Custom** 计划。
>   - https://www.apollo.io/pricing ：标准条款明确"internal business use only"。
> - **Serper**（候选；官方核实日期 **2026-10-17**）
>   - https://serper.dev/terms （Updated **2024-05-29**）：B2B 服务、**不面向终端消费者**；Usage License 禁止 modify/copy/decompile、移除版权标记、**多开账户**、**无增值原样镜像到其他服务器**、绕过限额；Data License 禁止 "misrepresent the ownership or the source / obscure, remove or change any copyright, trademark, or other proprietary notices / falsify or delete any author attributions"。**未提及**：集成进商业软件 / 本地缓存 / 向终端客户展示 / CSV 导出 / 团队共享 / 转售 → **全部 UNCONFIRMED**。管辖法 **UK**；退款须 7 天内且用量 <20%。"Serper 与 Google 无关联/背书。"
>   - https://serper.dev/privacy （Last Reviewed **2025-11-05**）：通常不处理个人数据；若处理，**客户为控制者、Serper 为处理者**；留存"至账户存续 + 法律/税务义务"，**无固定天数**。
>   - ⚠️ **UNCONFIRMED（须书面确认，不得套用 SerpApi/Prospeo/Apollo 结论）**：(a) 集成进第三方 Electron 商业软件是否许可；(b) BYOK 是否受限；(c) 本地缓存/持久化；(d) 向付费终端客户展示经标准化 + ICP 评分的结果；(e) CSV 导出；(f) 团队共享；(g) 是否需书面授权/DPA。联系渠道：**hello@serper.dev**（商务）/ **privacy@serper.dev**（隐私）。
>   - ⚠️ 官方**无公开 docs 站点**（`docs.serper.dev` 不解析）→ 端点/参数/错误语义以其官方 Playground 为准，标 **UNCONFIRMED**。

---

## 六、费用与调用预算表

> **铁律**：未知费用一律 `null`，**不得视为 0**。批准前须先向供应商确认套餐权限与单价。**本阶段零调用。**
> **证据状态**：本表「内部观测值 / 我方口径」= `CODE_VERIFIED`；「官方单价」中标注 **UNCONFIRMED** 者 = `UNCONFIRMED`；真实单位成本须待试验后 = `NOT_MEASURED`。标签含义见 §1.6。

### 6.1 已知计费口径（我方）与官方待核
| 计费项 | 单位 | 内部观测值 | 官方单价 | 失败/无匹配计费 | 重复/缓存计费 | 手机单独费用 |
|---|---|---|---|---|---|---|
| SerpApi 搜索 | `request` | — | Free $0/250 · Starter $25/1,000 · Developer $75/5,000 · Production $150/15,000（USD/月，https://serpapi.com/pricing） | **不计**（报错/失败/缓存不计）；**空结果集按 1 次计（UNCONFIRMED）** | 缓存命中不计 | 不适用 |
| Prospeo `search-person` | `credit` | 1 credit | **UNCONFIRMED**（定价页 JS 渲染） | **无结果不计** | **同页 30 天内去重免费** | — |
| Prospeo `enrich-person`（邮箱） | `credit` | 1 credit | **UNCONFIRMED** | **无结果不计** | **同记录 90 天内重复免费** | — |
| Prospeo `enrich-person`（含手机） | `credit` | 10 credits | **UNCONFIRMED** | **无结果不计** | 90 天去重免费；**请求手机时邮箱免费** | **10 credits**（官方） |
| Apollo `people/match` | `credit` | 未知 | **UNCONFIRMED**（通常需 Custom 计划） | **无数据计 0** | **UNCONFIRMED** | 命中手机 **+8 credits**（官方）；**我方当前不可用** |
| Apollo `reveal_phone_number` | `credit` | 不可用（无异步通道） | **UNCONFIRMED** | — | — | 需 `webhook_url`；手机**单独计费**（官方） |
| Serper `search`（候选） | `credit` | — | **Free 2,500（一次性，非月度）**；Starter $50/50k($1.00/1k)·Standard $375/500k($0.75/1k)·Scale $1,250/2.5M($0.50/1k)·Ultimate $3,750/12.5M($0.30/1k)（**预付 top-up，非月订阅**） | **UNCONFIRMED**（官方 FAQ 称仅成功响应计费，措辞待官方页确认） | **不缓存 → 重复同查询仍计费**（官方称结果不缓存） | 不适用（`num=100` 使该次=2 credits，**UNCONFIRMED**） |
| 官网提取 / LLM | `free` / (`token`) | 0 | 本地 / 自有 | — | — | — |
> ⚠️ **内部观测值**取自 `enrich-prospeo.ts:9-17`（2026-10-13 内部测试，FREE 计划 100 credits/月），**非官方条款**，仅作量级参照，**不得**直接用于预算。
> **官方计费口径**（核实日期 **2026-10-17**）：
> - Prospeo：https://prospeo.io/api-docs/search-person （返回 ≥1 人的请求计 1 credit；≤25 结果/页；同页 30 天去重免费；上限 25,000 结果）与 https://prospeo.io/api-docs/enrich-person （邮箱 1 credit；手机 10 credits 且邮箱免费；无结果不计；同记录 90 天重复免费）。
> - Apollo：https://docs.apollo.io/docs/api-pricing （`people/match` 1–9 credits，命中才计；1 credit 基础/邮箱 +8 credits 手机；无数据计 0；限速 600 次/小时）。
> - SerpApi：https://serpapi.com/pricing 。
> - Serper（候选）：https://serper.dev/ （核实日期 2026-10-17）：**4 档预付 top-up（非月订阅）**，credits 有效期 **6 个月**；Free **2,500 一次性**、无需信用卡；价格排除 sales tax/VAT/GST。
> ⚠️ Serper 计费特殊性（与 SerpApi **方向相反**）：**无月度订阅额度**；**免费额度为一次性**（**严禁假设按月重置**）；**结果不缓存** → 重复同查询**仍计费**，而 SerpApi 同查询 1 小时内缓存免费。
> ⚠️ **仍待官方确认（列 UNCONFIRMED 不得按 0 计）**：Prospeo 三档**套餐单价**；Apollo **套餐/credit 单价**与是否强制 Custom 计划；SerpApi Free 计划配额（100 vs 250）与空结果计费。

### 6.2 预算与批准（空表，待负责人填写并签字）
| 项 | 值（待填） |
|---|---|
| 获准使用的供应商 | |
| 允许的 API 端点与字段 | |
| 允许提交的数据类型 | |
| 最大公司样本数 | 30（建议） |
| 每家公司调用次数上限 | |
| 每供应商预算上限 | |
| 整个试验最高货币成本 | |
| 手机补全是否允许 | 建议：否 |
| 是否允许保存/导出返回数据 | |
| 成本核算方式 | |
| 失败停止条件 | 见 §八 |
| 数据删除/保留要求 | |
| **负责人批准日期 / 签字** | |

### 6.3 额度类型分离（禁止混读：免费 / 预购 / 月订阅）
| 供应商 | 免费额度 | 预购额度（top-up） | 月度订阅额度 | 有效期 |
|---|---|---|---|---|
| SerpApi | 有（页面口径 100 或 250/月，**UNCONFIRMED**） | — | 有（Free/Starter/Developer/Production…，月付） | 按订阅周期 |
| Prospeo | 有（FREE 计划；内部测试 100 credits/月，**非官方**） | — | 有（计划制，单价 **UNCONFIRMED**） | 按计费周期；credits 到期作废 |
| Apollo | ⚠️ **UNCONFIRMED** | — | 有（Custom 计划） | — |
| **Serper（候选）** | **2,500 一次性**（硬上限，**非月度重置**） | **有**（Starter/Standard/Scale/Ultimate，预付） | **无月订阅** | **credits 6 个月** |

> **口径**：免费额度、预购额度、月订阅额度**三者分开**；**不得**把一次性免费额度当作可持续的月度供给，也**不得**据此自动放行试验（见 §十）。

---

## 七、质量指标定义及验收办法

> 每个指标须含：分子 / 分母 / 人工核验标准 / 数据来源 / 样本不足如何报告 / 不可外推的结论。**自报状态与独立验证结果分列。**

| # | 指标 | 分子 / 分母（统一口径） | 人工核验标准 | 数据来源 | 样本不足时 |
|---|---|---|---|---|---|
| 1 | 公司匹配准确率 | 人工确认符合 ICP 的公司数 / 30 | 官网 + 公开资料人工判定 | 样本表 + `dataSourceType` | 标「样本不足」 |
| 2 | 决策人识别率 | 有≥1 真实决策人的公司数 / 30 | 人工比对 LinkedIn/官网 | `decisionMakers[]` | 同上 |
| 3 | 有效工作邮箱产出率 | 可用邮箱公司数 / 30（**验证档单列**） | `assessEmailUsability` + 独立验证另列 | `email-availability.ts` | 同上 |
| 4 | 各 Provider 新增有效联系人 | 每来源贡献的可用联系人数 / 总可用数 | `contactProvenance.source` | provenance | 标「无法归因」 |
| 5 | 重复数据比例 | 去重后重复条目数 / 原始条目数 | 域名/邮箱/人标识去重 | 缓存键 + 样本表 | 同上 |
| 6 | 人工核验准确率 | 人工判定正确数 / 抽检数 | 双人抽检 | 样本表 | 标「未抽检」 |
| 7 | 每个有效联系人的实际成本 | 可确认费用 / 有效联系人数（**分母同时报已验证邮箱数**） | 账单对账 | `EnrichmentCostSummary` + 账单 | 标「成本待对账」 |
| 8 | 手机补全新增价值 | 手机补全新增可用 WhatsApp 号 / 补全调用数 | 号码可达性核验 | Prospeo mobile 记录 | 当前 Apollo 不可用 → N/A |
| 9 | 各 Provider 失败/超时/无匹配比例 | 各 `failureKind` 计数 / 该源总调用数 | 日志计数 | `failureKind` 枚举 | 同上 |
| 10 | Serper vs SerpApi 增量结果 | Serper **独立发现**的合格域名数 / SerpApi **独立发现**的合格域名数 | 双源同查询对照 + 域名去重 | 对照表 | 标「未对照」 |
| 11 | 双源域名重复比例 | 两源共有域名数 / 两源并集域名数 | 域名精确去重 | 对照表 | 同上 |
| 12 | 每个新增合格公司域名的成本 | 该源可确认费用 / 该源**独立新增**合格域名数（**分母已减去两源重合**） | 账单 + 去重后样本 | 账单 + 对照表 | 标「成本待对账」 |

> **双 Provider 对照口径（铁律）**：不同供应商 **credits 禁止直接相加**；"增量"必须以**域名去重后的独立新增**为准。**Serper 不缓存**、重复查询仍计费 → 对照必须**串行且去重发起**（同一查询在该源**只发一次**），严禁双跑同一查询。**不得因存在免费额度而任意放大查询数或样本量**；任何跨提供商对照的真实调用须先走 §八/§九 预算门禁。

> **不可外推**：30 家小样本**不得**外推为整体匹配率/单位成本；供应商自报 `grade` **不得**当独立已验证结论。

---

## 八、试验执行步骤与停止条件

### 8.1 执行步骤（获批准后）
1. 确认 ICP（§二）→ 填 §三 样本矩阵表头。
2. 确认供应商计费/授权（§五、§六）→ 签字。
3. 受控搜索 → 采集 30 家 → 逐条旁路留痕（§三模板 + §六预算）。
4. 计算 §七 九项指标 → 出报告。

### 8.2 停止条件（任一触发即暂停）
- 实际成本达批准上限（或费用**不可确认**而无法对账）。
- 任一供应商返回鉴权/条款相关的禁止信号。
- 出现未授权数据外发风险。
- 样本出现虚构/无法核验条目。

---

## 九、需要负责人批准的所有事项

- [ ] **ICP 确认**：§2.2 六项（国家/行业/公司类型/邮箱最低质量/手机是否必需/单公司预算）。
- [ ] **供应商授权**：§5.2 各供应商授权与留存项全部核实为「允许」或给出书面许可。
- [ ] **费用与预算**：§6.2 全表签字；未知费用不得按 0 计。
- [ ] **样本规模**：30 家上限。
- [ ] **手机补全**：建议保持关闭（§一.4 默认 `mobile:false`；Apollo 手机当前不可用）。
- [ ] **数据保存/导出**：是否允许本地保存与 CSV 导出（默认均本地）。
- [ ] **停止条件**：认可 §8.2。
- [ ] **批准日期与签字**。

---

## 十、最终 Go / No-Go 决策表

> 所有阈值若无依据，标注 **「建议待批准」**，**不得**宣称其为既定业务指标。

| 决策点 | 触发条件 | 阈值 | 依据状态 |
|---|---|---|---|
| **可以启动 30 家试验** | §九 全部批准 **且** SerpApi/Prospeo/Apollo（及纳入对照时的候选 Serper）"集成于商业软件 / 向终端客户提供结果"取得**书面授权** + §6.2 预算签字 | 全绿 | **当前不满足**（授权未决） |
| **暂停付费测试** | 达预算上限 / 费用不可对账 / 出现条款禁止信号 | 见 §8.2 | 建议待批准 |
| **必须先解决的授权问题** | §5.2 中 SerpApi / Prospeo / Apollo 的"集成于商业软件 / 向终端客户提供结果"项 | SerpApi/Prospeo/Apollo **均**标 ⛔（需书面授权/明文限制） | ✅ **已由官方 ToS 证实**（事实门禁） |
| **Serper 是否进入候选对照** | 官方能力/价格已核实 **且** 与 SerpApi 对照设计就绪 **且** Serper 授权书面确认 **且** 独立预算批准 | 全绿方测 | **仅候选**；授权 **UNCONFIRMED** → 暂不可测（**免费额度不构成放行**） |
| **支持扩大样本** | 30 家中 有效邮箱产出率与单位成本稳定且授权允许 | **待批准** | 建议待批准 |
| **调整 Provider 顺序** | Prospeo 命中率显著高于/低于 Apollo，或 Apollo 因缺标识大量 skip | **待批准** | 建议待批准 |
| **值得开发手机补全** | 手机字段为首要缺口 且 预算允许 且 Prospeo/Apollo 授权明确 | **待批准** | 建议待批准 |
| **停止追加数据成本** | 边际单位成本上升 且 有效联系人增量趋零 | **待批准** | 建议待批准 |

### 10.1 当前总判定
> **No-Go（尚未可启动试验）**：
> 1. **授权（决定性门禁）**——官方 ToS 已核实：**SerpApi** 禁未授权 reproduce/sell/resell/exploit（商业软件向终端客户交付结果落入该禁令，需书面许可）；**Prospeo** 授权仅限"内部使用"、禁转售（需书面许可）；**Apollo** **明文**禁止将 API 集成进第三方产品，除非获 Apollo 授权/批准。→ **三家均须先取得书面授权/商业协议**。
> 2. **费用（§6.2）**——三家套餐单价/credit 单价多为 **UNCONFIRMED**，预算表未签字。
> 3. **ICP（§2.2）**——国家/行业/公司类型/邮箱质量门槛/手机必要性/单公司预算六项**待负责人确认**。
> 4. **候选 Serper（§四.4 / §五.2）**——能力与价格已核实为**候选**，但**授权未明**（UNCONFIRMED）且**未集成**；**FREE 2,500 一次性额度不构成启动授权**，须独立走 §九 门禁。
> 在上述三项（+候选 Serper）全部转为「已批准」前，**不得**发起任何真实付费调用。**不因免费额度、高评分、试验紧迫或供应商宣传而豁免授权。**

### 10.2 未提交工作区的处置选项（三选一，待负责人决定）
> **本阶段不执行任何 git 提交或回滚。** 以下仅为选项陈列。

| 选项 | 内容 | 影响 / 前置条件 |
|---|---|---|
| **A** | 保持现状，不提交，等待 2B 决定 | 工作区继续保留 8+6 项未提交改动；无 git 风险，但变更长期悬置 |
| **B** | 分批提交 `docs/plans/` 文档与已验收的 Phase 1 改动 | 须先过预提交卫生检查（排除 `.tmp-*`、日志、`dist/`、构建产物等），并确认不误提交运行时残留 |
| **C** | 暂存 / 搁置，随试验结论一并处置 | 需明确搁置期限与责任人；搁置期间不得混入无关改动 |

---

## 附录 A：待发送的供应商确认问题草稿
> 本附录仅为**草稿**，**未发送**；发送前须负责人 / 法务批准。仅使用官方公开渠道。

**A.1 致 SerpApi**（渠道：官方支持页 / 账户后台）
1. 是否允许将 SerpApi 集成进我方销售的本地 Electron 商业软件，并由终端客户自带 Key（BYOK）使用？
2. 是否允许在客户端**本地缓存 / 持久化**返回数据？
3. 是否允许向付费终端客户**展示**经标准化与 ICP 评分后的结果，并支持 **CSV 导出**？
4. 是否允许**团队 / 多席位**共享结果？
5. 是否需要**书面授权 / DPA**？具体条款与费用如何？

**A.2 致 Serper**（渠道：`hello@serper.dev`（商务）/ `privacy@serper.dev`（隐私））
1. 是否允许将 Serper 集成进我方销售的本地 Electron 商业软件，并由终端客户自带 Key（BYOK）使用？
2. 是否允许本地缓存 / 持久化返回数据（ToS 未述）？
3. 是否允许向付费终端客户展示经标准化与 ICP 评分后的结果，并支持 CSV 导出？
4. 是否允许团队 / 多席位共享？
5. 是否需要书面授权 / DPA？具体条款如何？

**A.3 致 Prospeo**（渠道：待确认渠道（须经官方页面核实））
1. 是否允许将 Prospeo 集成进我方销售的本地 Electron 商业软件，并由终端客户自带 Key（BYOK）使用？
2. 是否允许客户端本地缓存 / 持久化返回数据（见 DPA）？
3. 是否允许向付费终端客户展示结果与 CSV 导出（ToS 1.2 禁转售，需澄清边界）？
4. 是否允许团队 / 多席位共享？
5. 是否需要书面授权 / DPA（`prospeo.io/dpa`）？具体条款如何？

**A.4 致 Apollo**（渠道：待确认渠道（须经官方页面核实））
1. 是否允许将 Apollo API 集成进我方销售的本地 Electron 商业软件（API ToS 明文要求「经 Apollo 授权或批准」）？
2. 是否允许客户端本地缓存 / 持久化返回数据？
3. 是否允许向付费终端客户展示结果与 CSV 导出（外部产品 / 转售须另签协议 + 自定义定价）？
4. 是否允许团队 / 多席位共享？
5. 书面授权 / 企业协议（Custom 计划）的条款与费用如何？

---

*本文件为 Phase 2A 交付物。未获 §九 明确批准前，不进入 Phase 2B，不执行任何真实调用，不提交 commit。*
