---
title: KONE 字段字典
status: active
authoritative: false
ssotFor: []
codeSSOT: src/shared/ipc-contracts.ts
asOfCommit: ef2badd
lastVerifiedAt: 2026-10-19
---

# KONE 字段字典 (FIELD DICTIONARY)

> **文档角色：人类可读的字段索引。**
> **代码事实源**：`src/shared/ipc-contracts.ts`（类型与字段形状以该文件为准）。
> 本文件**不新定义任何字段**，只做索引与语义说明；若本文件与代码不一致，以代码为准并应在此提交勘误。
> 业务语义（状态、评分、门禁）见 `kone-PRD.md` 与 `STATE-MACHINES.md`；字段若涉及云端投递，其权威定义在 `CLOUD-COLLABORATION-DELIVERY.md`。

## 1. 搜索入参 `SearchExecuteRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `keyword` | `string` | ✅ | 自然语言或关键词 |
| `country` | `string?` | | 目标国家；限定后必须触发本地语言产品词变体 |
| `city` | `string?` | | 目标城市 |
| `dataSourceType` | `DataSourceType?` | | 指定数据源；缺省走多源并行 |
| `filterOptions.priorityWebsite` | `boolean?` | | 优先官网 |
| `filterOptions.localDomainOnly` | `boolean?` | | 优先本土域名 |
| `filterOptions.highRelevanceOnly` | `boolean?` | | 高相关优先（阈值 `matchScore >= 60`） |
| `filterOptions.b2bRoleOnly` | `boolean?` | | B2B 角色优先 |

> 四个质控开关是**契约级入参**：前端可见即必须由主进程真实执行 Scout 阶段过滤或排序；"前端可见但后端未挂载逻辑"属严重违例。

## 2. 搜索结果 `SearchExecuteResult`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string?` | 稳定 UUID；作为 `leadKey` 贯穿管道与写回 |
| `company` / `website` / `phone` / `address` | `string` | 基础主体信息 |
| `contact` / `contactTitle` / `email` | `string?` | 联系人信息 |
| `matchScore` | `number \| null?` | **三态语义**：`undefined`=未评分，数字=已评分；非法非数字必须被忽略，禁止转 0 |
| `scoreSource` | `'ai' \| 'deterministic'?` | 评分来源；UI 用于区分"AI"与"规则"精度层级 |
| `opportunityScore` | `{ icpFit, intent, evidence, riskPenalty, finalScore }?` | Stage-2 结构化机会分；缺失或非法一律为 `undefined`，**不得伪造** |
| `matchReasons` / `riskFlags` | `string[]?` | 匹配理由 / 风险标记 |
| `isB2B` | `boolean \| null?` | B2B 判定 |
| `inferredRole` / `salesStrategy` | `string?` | 推断角色 / 销售策略 |
| `snippet` | `string?` | 摘要；盲评时理由必须明示轻量判断 |
| `fallbackStatus` | `'social_blind_score'?` | 社交源盲评降级标记 |
| `status` | `'new' \| 'contacting' \| 'replied' \| 'archived'?` | 本地简化态，见 `STATE-MACHINES.md §2` |
| `dataSourceType` | `DataSourceType?` | 来源溯源；Provider 私有字段不得泄漏到渲染层 |
| `dataSourceNote` | `string?` | 来源口径说明（如海关/展会为公开网页近似检索） |
| `exhibitionFootprints` | `string[]?` | 展会足迹 |
| `customsData` | `CustomsData?` | 海关数据 |
| `decisionMakers` | `DecisionMaker[]?` | 决策人网络 |
| `agentStatus` | `AgentStatus?` | 智能体触达状态（持久化线索态） |
| `analysisCache` | `Record<string, unknown>?` | AI 深度分析缓存 |

## 3. `DataSourceType`（9 值，含向后兼容项）

`'google_maps' | 'google_organic' | 'customs_shipment' | 'trade_show' | 'yellow_pages' | 'linkedin_search' | 'facebook_search' | 'anysearch' | 'serper'`

> `yellow_pages` 保留枚举值以兼容历史数据，其 Provider **已弃用**（`execute()` 返回 `DEPRECATED`）。
> `serper` 为 BYOK 独立搜索源（用户自带 key，不消耗 SerpApi 配额，不参与多源并行），仅在用户显式选择「单源：Serper」时产生。
> 真实可用状态以 `PROVIDER-CAPABILITY.md` 为唯一事实源。

## 4. `DecisionMaker`

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` / `title` / `email` / `phone` / `source` | `string` | 基础信息 |
| `linkedinUrl` | `string?` | 顶层无 `linkedinUrl` 时管道从此字段聚合回退 |
| `confidenceScore` | `number` | 置信度；`<= 0` 时前端必须展示"AI 推测，未验证"降级徽标 |
| `emailGrade` | `string?` | 采集层零网络静态分级（实际只会出现 `risky` / `invalid`） |
| `phoneValid` | `boolean?` | E.164 格式静态校验 |

## 5. `CustomsData`

`annualImportVolume?: string` · `topSuppliers?: string[]` · `originCountries?: string[]` · `lastShipmentDate?: string`

> 宣传口径：`customs_shipment` 为**公开网页近似检索**，严禁宣称"官方海关提单数据库直连"。

## 6. `AgentStatus`（本地持久化线索态）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `whatsappSent` | `boolean` | `false` | 是否已真实发送 |
| `whatsappStatus` | `'pending' \| 'delivered' \| 'replied' \| 'failed'?` | — | 仅在探测到真实 tick 时才可置 `delivered` |
| `linkedinContacted` | `boolean` | `false` | **只读浏览不得置 true** |
| `emailSequenceStage` | `0 \| 1 \| 2 \| 3` | `0` | 邮件序列阶段 |
| `emailPendingManual` | `boolean?` | — | IMAP 未配置时的人工挂起标记 |

## 7. `AgentTask`（管道最小工作单元）

`id` · `taskRunId?` · `leadId` · `leadKey?` · `company` · `website` · `phone?` · `email?` · `linkedinUrl?` · `aiEmail?` · `country?` · `createdAt` · `priority`

> `taskRunId` 用于时空隔离：消费时必须校验其归属，来自旧管道的任务必须被丢弃。

## 8. `SalesAgentState`（运行时 Agent 状态）

`agentId` · `agentType` · `status('idle'|'running'|'paused'|'error')` · `label` · `description` · `progress` · `totalTargets` · `completedCount` · `failedCount` · `lastActivity?` · `errorMessage?` · `dailyLimit` · `dailyUsed` · `queuedCount?`

> 进度指标**禁止硬编码假数据**：渠道未配置时进度必须清零为 `0/0`，状态标签显示"未连接 / 待配置"。

## 9. `userConfig.agentDailyLimits`（此前未定义的配置 schema）

```ts
userConfig.agentDailyLimits?: Record<
  'whatsapp' | 'linkedin' | 'email',
  { trial: number; basic: number; premium: number }
>
```

内置默认值（仅作兜底，非权威上限）：

| Agent | trial | basic | premium |
|---|---|---|---|
| `whatsapp` | 3 | 5 | 100 |
| `linkedin` | 3 | 30 | 100 |
| `email` | 3 | 20 | 200 |

> 宪法要求：日频上限**必须优先读取 `userConfig.agentDailyLimits`**，仅在缺失时回落上表默认值。数值语义见 `kone-PRD.md §零.3`。

## 10. 其他关键类型索引

| 类型 | 用途 |
|---|---|
| `SearchStagePayload.stage` | 流式阶段：`anysearch` / `fetching` / `normalizing` / `prefiltering` / `scoring` / `blind_scoring` / `enriching` / `complete` / `localized_search` |
| `SearchLeadScoredPayload` | 逐条评分回填：`candidate` + `completedCount` + `totalCount` |
| `AutopilotLifecycle` | `idle` / `running` / `paused` / `completed` / `error` |
| `AgentControlRequest` | `agentId` + `action: 'start' \| 'stop' \| 'pause' \| 'resume'` |
| `SuppressionReason` | `unsubscribe` / `bounce` / `complaint` / `manual` |
| `DnsHealthCheckResult` | `hasMX` / `hasSPF` / `hasDKIM?` / `hasDMARC?` / `records` / `valid` / `error?` |
| `ProviderStatusEntry` | `id` + `name` + `available` + `requiredConfig` |
