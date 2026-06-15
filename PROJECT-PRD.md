# Kone 终极全景 PRD 与开发白皮书

> 📌 **V1.3 最新需求与架构扩展请参见:** `kone-PRD.md` — 该文档是 V1.3 的唯一权威开发需求来源，包含 AnySearch 四级弹性搜索协议、决策人穿透数据结构、智能体本地多开矩阵及 DNS 防火墙等全新功能模块。

## 0. 文档说明

本文档基于本地代码扫描自动生成，扫描范围覆盖：

- `.clinerules`
- `ARCH-STANDARDS.md`
- `.opencode/agents/ui-agent.md`
- `.opencode/agents/ipc-agent.md`
- `.opencode/agents/system-blueprint.md`
- `.opencode/agents/build-agent.md`
- `src/store/leads-store.ts`
- `src/lib/lead-mappers.ts`
- `src/lib/electron-api.ts`
- `src/lib/feature-gate.ts`
- `src/components/search-engine.tsx`
- `src/components/analysis-drawer.tsx`
- `src/components/automation-workflow.tsx`
- `src/components/dashboard-page.tsx`
- `preload/index.ts`
- `electron/ipc/channels.ts`
- `electron/services/search-service.ts`
- `electron/services/automation-service.ts`
- `electron/services/license-service.ts`
- `src/shared/ipc-contracts.ts`
- `src/lib/autopilot-runner.ts`

本文只描述代码中真实存在的变量、字段、IPC 通道、权限特性、异常处理与交互流程；未扫描到的内容不做臆测。

## 宪法级强制协议：四级弹性搜索协议

任何后续需求、实现、UI 提示、IPC 契约与文档更新，均不得违背以下降级链路：

0. 第零级（AnySearch 多源穿透）：V1.3 新增，优先调用 AnySearch 垂直 B2B 实体 API 解析自然语言输入，全网检索海关、展会名录、行业黄页、LinkedIn、Facebook 等多源库，返回公司主体与决策人造网络图谱。
1. 第一级（精准地理）：若零级超时/429失效，降级使用 `location` 独立参数请求 Google Maps。
2. 第二级（参数容错）：若一级返回 `400` 且属于 location 拒绝，必须立即自动重试，改为 `location: null`，并把地理信息拼入关键词 `q`，例如 `Golf Cart Battery Dealer in San Francisco`。
3. 第三级（无感补位）：若二级返回 `localCount === 0`，必须自动切换到 `google` Organic 网页搜索引擎，并将结果归一化为 Scout 可消费的线索对象。

该协议属于系统韧性红线：禁止以后续优化、提示文案或局部重构为由跳过任一级降级。

### 强制降级透明化与 IPC 闭环

四级弹性搜索协议不仅是后端请求链路，也必须在状态与体验层面完全闭环：

1. `search:stage` 或等价流式状态通道必须能表达 AnySearch 第零级多源穿透、正常抓取、二级关键词容错、三级 Organic 补位等差异状态。
2. 第零级 AnySearch 穿透时前端必须显示：`🤖 AnySearch 正在通过全网海关数据、全球展会名录及社媒多渠道深度穿透高管决策人...`
3. 二级容错时前端必须显示：`地图定位受限，正在尝试扩大识别范围...`
4. 三级补位时前端必须显示：`未发现地图商户，已自动为您补位全局网页线索...`
5. 缺失 AI 评分密钥属于可恢复降级状态，必须通过单独 IPC 语义或字段告知前端，并以非阻塞方式展示。
6. 任何搜索流无论成功、降级、部分成功或失败，都必须以明确的 complete 或错误闭环收尾，防止 UI 白屏、假死或 loading 悬挂。

---

## 一、项目定位与核心商业闭环

### 1.1 产品定位

Kone 是一个面向 B2B 出海场景的 Electron 桌面应用，核心定位不是通用 CRM，而是“本地重计算、云端轻交接”的精细化获客工作台。其业务主线由以下几层组成：

1. Scout 模块：围绕 `search_basic` 能力，执行基础线索抓取与首轮候选整理。
2. Brain 模块：围绕 ICP 与 LLM，对候选客户执行渐进式评分、角色推断、风险标注、销售建议生成。
3. Leads 模块：将高价值结果写入 Zustand 内存态线索池，作为本地工作现场的单一事实源。
4. Analysis 模块：基于 `analysis_advanced`，结合 `knowledgeBase.entries`、官网内容与线索信息生成深度分析、开发信、回信拆解。
5. Commercial / Automation 模块：围绕 `cloud_send` 与高级版授权，执行邮箱验证、Webhook 裁剪推送、团队防撞单与云端协同。

### 1.2 架构哲学

从 `ARCH-STANDARDS.md`、`.clinerules` 与 `system-blueprint.md` 可确认，Kone 的底层哲学是：

- `src/` 仅负责渲染与状态编排，不承担特权业务执行。
- `electron/` 主进程负责外部 API、授权、网络、Webhook 与高成本计算。
- 通道名称以 `electron/ipc/channels.ts` 为单一事实源。
- 动态业务数据不能写入长期配置；线索与搜索结果保留在 Zustand 内存态。
- 所有高商业价值 IPC 默认走 Fail-Closed 授权校验。
- 上云前必须做 Gold Filter 与 Payload 裁剪，不能把未经筛选的海量原始数据直接推送到云端。
- 所有本地重计算能力必须默认兼容 `4G-8G RAM`、低功耗 CPU、集成显卡的办公环境。

### 1.3 商业闭环

#### 1.3.1 ICP 目标设定

搜索与 AI 分析均依赖 `user_config` 中的 `icpProfile`。在代码里，ICP 核心字段真实存在于多个路径：

- `targetProduct`
- `buyerPersona`
- `coreAdvantage`
- `negativeIcp`

这些字段被注入：

- `buildSearchScoringPrompt(...)`
- `buildUniversalIcpPrompt(...)`
- `buildAnalysisPrompt(...)`
- `buildReplyCoachPrompt(...)`
- `automation-workflow.tsx` 中的 `userSettings.icpProfile`

#### 1.3.2 基础线索提取

基础提取从 `searchExecute({ keyword, country, city })` 开始，主进程 handler 位于：

- `IPC_CHANNELS.SEARCH.EXECUTE = 'search:execute'`
- 注册点：`registerSecureFeatureIpc(..., IPC_CHANNELS.SEARCH.EXECUTE, ..., 'search_basic', ...)`

基础结果来源支持：

- SerpApi `google_maps` 搜索
- 非 SerpApi 的 POST 搜索代理

结果先被标准化为候选，再通过 `emitBasicResults(...)` 发送到前端，保证列表先出、评分后补。

在 Scout 与 Brain 之间，预筛漏斗属于强制前置步骤，而非可选优化：

- 必须基于正向词根、负向词根、关键词上下文与商业角色信号做动态权重预筛。
- `汽修店`、`body shop`、`mechanic`、`tire`、`car wash` 等典型杂讯必须在 Scout 阶段静默剔除。
- 预筛的目标同时包括：提升线索纯度、降低本地算力消耗、降低 Token 成本。
- 预筛结果必须通过探针保留观测点，至少可追踪保留数量、剔除数量与主要原因类别。

高级质量控制模块属于搜索确定性的核心组成部分：

- 如 `优先官网`、`优先本土域名`、`高相关优先`、`B2B 角色优先` 等开关，必须作为契约入参透传到主进程。
- 主进程必须依据这些配置在 Scout 阶段执行真实过滤与排序，确保所见即所得。
- 若前端可见但后端未挂载逻辑，属于严重规范违例。

#### 1.3.3 AI 渐进式深度评分

在 `electron/services/search-service.ts` 中，候选结果进入两段 AI 增强：

1. `scoring`：通过 `buildSearchScoringPrompt(...)` + LLM 输出 `matchScore`、`matchReasons`、`riskFlags`、`inferredRole`、`salesStrategy`、`isB2B`
2. `enriching`：通过 `enrichLeadWithDeepProbe(...)` 抓官网、联系页、正文与直出邮箱电话，再补强 `contact`、`contactTitle`、`email`、`phone`、`snippet`、`salesStrategy`

这不是一次性全量渲染，而是流式逐条更新：

- 先发基础列表
- 再逐条发评分结果
- 最后发 complete

性能守卫属于本地商业 SaaS 的硬红线：

- 搜索评分与官网富化并发上限严格固定为 `2`
- 发送给 LLM 的网站正文必须经过 HTML 去噪，并严格截断至不超过 `3000` 字符
- 任何突破上述限制的代码提交都应被视为架构违例

#### 1.3.4 高级版 n8n 自动化隔离

云端自动化与本地获客被代码严格隔离：

- 本地搜索能力依赖 `search_basic`
- 深度分析依赖 `analysis_advanced`
- 邮箱验证与发信依赖 `cloud_send`

`automation-service.ts` 中：

- `automation:verify-emails` 使用 `registerSecureFeatureIpc(..., 'cloud_send', ...)`
- `automation:start-campaign` 先走 `ensureTrialAccess(...)`，再走 `licenseGuard.requireFeature('cloud_send', '自动化发信')`

这意味着：

- Trial 过期立即拒绝
- 无 `cloud_send` 特性立即拒绝
- 即使前端误调用，也由主进程做 Fail-Closed 拦截

### 1.3.5 V1.3 多源融合层（已落地 / 边界说明）

V1.3 扩展层已在 UI 层面落地多源字段展示与覆盖率统计，但不改变 V1.2 的搜索韧性基线与商业授权边界。

已验证落地项：

- `src/store/leads-store.ts` 定义 `DataSourceType`、`DecisionMaker`、`CustomsData`、`AgentStatus`、`fallbackStatus` 类型；`LeadItem` 与 `LeadSearchResult` 均已追加 V1.3 可选字段（`dataSourceType`、`decisionMakers`、`customsData`、`exhibitionFootprints`、`agentStatus`）。这些是 UI 专用类型，不跨 IPC 边界，因此不放在 `ipc-contracts.ts`。
- `analysis-drawer.tsx`：线索头部展示 `dataSourceType` 彩色徽标、决策人数量徽标、海关数据徽标、展会足迹数量徽标。
- `data-center.tsx`：概览统计新增"海关数据覆盖"和"决策人覆盖"统计卡；新增"多源数据覆盖"面板，包含海关数据、决策人信息、展会足迹 3 个覆盖指标卡片及来源分布水平条形图。
- `search-engine.tsx`：已下线"搜索数据源"渠道下拉选择器，改为 Omni-Search 盲搜模型。搜索按钮文案改为 `正在搜索...`，知识库切换标签改为 `企业知识库`。前端实现循环分页（SEARCH_PAGE_SIZE=30），`intentMutatedKeywordsRef` 持有 B2B 纯净英文变种词替代用户原始 keyword 映射至 industry 字段。
- `leads-table.tsx`：线索推荐区域标题改为 `已评分高潜线索推荐`，描述改为 `仅展示已完成评分且最值得优先跟进的线索`。
- `app-sidebar.tsx`：`canAccessPremiumWorkspace` 包含 `enterprise` 判定；Pro 徽标已中文化为 `高级`。
- `google_organic` 已作为 AnySearch 的 Organic-only 路径具备回归测试：不触发 Maps 请求，仍返回 Scout 基础候选并完整 stream close。

仍为占位或受限项：

- `customs_shipment`、`trade_show`、`yellow_pages`、`linkedin_search`、`facebook_search` 目前部分由 AnySearch 路由承载，正在逐步落地完整 provider。
- LinkedIn / Facebook 搜索入口属于基于搜索语法的站点限定，不等同于官方数据库接入。
- AnySearch 已作为第零级整合进四级弹性搜索协议，不能以多源名义跳过原有降级链路。
- `file:export-pdf` IPC 合约：该功能为 V1.3 高级版核心待恢复/待实现功能。本期仅预留契约定义（IPC channels、preload、shared contract、renderer wrapper 均已闭环），不激活主进程实现（V1.2 revert 移除后尚未恢复）。

### 1.4 套餐与功能边界

Kone V1.2 的商业模式已经校准为明确的三级结构：`7天试用 -> 基础版(收费) -> 高级版(收费/企业延展)`。

#### 1.4.1 试用版（Trial）

从 `electron/services/license-service.ts` 可确认：

- `TRIAL_DURATION_DAYS = 7`
- `TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * DAY_MS`
- 试用申请成功文案为：`7 天试用已开启`
- 试用锚点通过 `AnchorPayload` 记录 `firstTrialAt`、`expiresAt`、`lastCheckDate`
- 一旦检测到时间回拨，`lockedReason` 会被打为 `time_rollback`
- `ensureTrialAccess(...)` 在试用过期后统一返回 `TRIAL_EXPIRED` 或 `SYSTEM_TIME_ABNORMAL`

试用版在代码中的计划字段已经校准为：

- `plan: 'trial'`
- `tier: 'basic'`

这表示 Trial 仅是 Basic 能力集的 7 天时效性试用，而不是永久免费层级。

#### 1.4.2 基础版（Paid Basic）

基础版是 Kone 的单兵作战收费版本，核心价值是“本地闭环获客 + AI 深度分析 + 伴随式后台巡航”。

基于 `src/lib/feature-gate.ts` 与 `electron/security/license-guard.ts`，Basic 真实能力边界已统一为：

- `search_basic`
- `search_deep`
- `analysis_basic`
- `analysis_advanced`
- `lead_export`
- `export_full`

对应产品价值：

- 全量搜索与高上限结果集
- 网页深度分析与 ICP 深度判断
- AI 深度分析抽屉、开发信生成、回信拆解
- 数据中心（线索大盘、多源覆盖率统计、来源分布图表）
- 后台伴随式巡航数据抓取队列（Autopilot Scout + Brain 管道）
- 本地导出闭环

> ⚠️ **V1.3 变更**：左侧导航栏下方 `💎 Kone AI 自航拓客特权港` 分区按授权层级展示真实能力。Trial 只显示升级引导；Paid Basic 可使用 Email 与低量 WhatsApp Web 本地能力；Premium/Enterprise 解锁 WhatsApp Cloud API、LinkedIn Profile 只读辅助、账号多开与团队协作。任何层级都不得展示虚假运行指标。

前端搜索限制也已与 Basic 对齐：

- `cooldownMs: 0`
- `maxResults: 100`
- `allowDeepAnalysis: true`

#### 1.4.3 高级版（Paid Premium）

高级版是 Kone 的团队资产与自动化引擎版本，严格承载“云端自动化 + 团队协同”价值。

基于 `src/lib/feature-gate.ts`、`electron/security/license-guard.ts`、`electron/services/automation-service.ts`、`electron/services/supabase-service.ts`、`electron/services/agent-service.ts`，Premium/Enterprise 独占能力已经校准为：

- `cloud_send`
- `team_collaboration`
- `local_autopilot`（V1.3 起按授权层级开放：Basic 低量本地 Agent，Premium/Enterprise 全量沙箱与云端能力）

对应产品价值：

- N8N 云端自动化序列
- 邮箱验证、云端发送队列、Webhook 触发
- 团队实时防撞单
- 团队线索拉取与跟进大盘
- Realtime 订阅与团队状态联动
- **账号管理多开沙箱**：LinkedIn、Facebook、WhatsApp 独立 `session.fromPartition` 持久化隔离沙箱
- **AI 销售团队**：WhatsApp 拓客猎手、LinkedIn Profile 只读辅助、邮件跟进助理三大本地智能体持久化沙箱多开与实时启动控制；LinkedIn 不包含自动 Connect 或自动私信
- **自动化序列**：N8N 云端自动化邮件序列、邮箱验证、Webhook 触发
- **团队协作**：实时防撞单、线索拉取与跟进大盘、Realtime 订阅与团队状态联动

代码层面的严格隔离点包括：

- `automation:verify-emails` -> `cloud_send`
- `automation:start-campaign` -> `ensureTrialAccess(...)` + `licenseGuard.requireFeature('cloud_send', '自动化发信')`
- `cloud:check-collision` / `cloud:fetch-team-leads` / `cloud:fetch-tracking` / `cloud:fetch-claimed-domains` / `cloud:subscribe-realtime` 等全部走 `cloud_send`
- 前端团队页和自动化页仍由 `tier === "premium" || plan === "enterprise"` 控制进入

#### 1.4.4 当前商业边界结论

因此，Kone V1.2 的正式商业策略可以准确描述为：

- `Trial`：7 天限时试用，只提供 Basic 能力集合的临时体验
- `Basic`：面向单兵销售/外贸业务员的本地获客生产力套件
- `Premium`：面向团队资产沉淀与自动化协同的高级版本
- `Enterprise`：在当前代码中沿用 Premium 的能力全集，并作为企业级计划入口

---

## 二、核心数据字典 (Data Dictionary)

## 2.1 Zustand Store：`src/store/leads-store.ts`

### 2.1.1 `LeadAnalysisCacheEntry`

```ts
export type LeadAnalysisCacheEntry = {
  companyProfile?: string
  painPoints?: string
  valueMapping?: string
  emailSubject?: string
  emailBody?: string
  confidence?: number
  rawContent?: string
  parseFallback?: boolean
  usedKnowledgeTitles?: string[]
  usedFallback?: boolean
  source?: string
  updatedAt?: string
  replyCoaching?: {
    customerText: string
    negotiationRisk: string
    pricingAdvice: string
    replyTemplate: string
    nextAction: string
    timestamp: number
  }
}
```

含义：

- 存放 AI 深度分析缓存。
- 同时承载三类策略场景缓存：`direct_quote`、`competitor_switch`、`factory_strength`。
- `replyCoaching` 是 `reply_coach` 场景的结构化回信拆解结果。
- `parseFallback` 表示 LLM 返回值没能被标准 JSON 解析，只能按降级逻辑拆解。
- `usedKnowledgeTitles` 记录命中的知识库条目标题。
- `usedFallback` 标识本轮分析是否主要依赖 snippet 或弱上下文，而非完整官网文本。
- `source` 在代码中可出现 `website`、`snippet`、`reply_coach` 等。

### 2.1.2 `LeadItem`

```ts
export type LeadItem = {
  id: number
  company: string
  contact: string
  contactTitle: string
  email: string
  phone: string
  country: string
  countryCode: string
  industry: string
  source: string
  matchScore?: number | null
  fallbackStatus?: 'social_blind_score'
  status: LeadStatus
  followUp: FollowUpStatus
  starred: boolean
  lastActivity: string
  addedDate: string
  tags: string[]
  unlocked: boolean
  website: string
  estimatedValue: string
  address?: string
  snippet?: string
  matchReasons?: string[]
  riskFlags?: string[]
  inferredRole?: string
  salesStrategy?: string
  analysisCache?: Record<string, LeadAnalysisCacheEntry>
  generatedStrategies?: Record<string, string>
  /* V1.3 多源融合字段 */
  dataSourceType?: DataSourceType
  exhibitionFootprints?: string[]
  customsData?: CustomsData
  decisionMakers?: DecisionMaker[]
  agentStatus?: AgentStatus
}
```

字段语义：

- `matchScore`：AI 综合匹配度分值，允许 `undefined | null | number`
- `status` / `followUp`：生命周期与跟进状态，均收敛到 `LeadStatus`
- `unlocked`：是否解锁完整线索信息
- `analysisCache`：结构化分析缓存
- `generatedStrategies`：按场景缓存开发信正文字符串
- `inferredRole`：AI 推断的买方角色/组织角色
- `salesStrategy`：AI 给出的简短跟进策略
- `snippet`：搜索摘要或官网抓取精简文本
- `matchReasons`：命中理由，通常 1-2 条
- `riskFlags`：风险标签，通常 1 条
- `fallbackStatus`：盲评标记，值为 `'social_blind_score'` 时表示官网无法访问，基于 snippet 轻量评估
- `dataSourceType`：数据来源类型（`google_maps` | `google_organic` | `customs_shipment` | `trade_show` | `yellow_pages` | `linkedin_search` | `facebook_search`）— 内部溯源标记，前端不再暴露为手动选择渠道
- `exhibitionFootprints`：展会足迹名单，字符串数组
- `customsData`：海关提单数据，包含 `annualImportVolume`、`topSuppliers`、`originCountries`、`lastShipmentDate`
- `decisionMakers`：决策人列表，每个含 `name`、`title`、`email`、`phone`、`linkedinUrl`、`source`、`confidenceScore`
- `agentStatus`：多渠道智能体触达状态结构体，包含 `whatsappSent`、`whatsappStatus`、`linkedinContacted`、`emailSequenceStage`。V1.3 LinkedIn 只读辅助不得把 Profile 浏览写成 `linkedinContacted = true`。

### 2.1.3 `LeadSearchResult`

```ts
export type LeadSearchResult = {
  id: number
  company: string
  industry: string
  matchScore?: number
  fallbackStatus?: 'social_blind_score'
  contact: string
  contactTitle: string
  email: string
  phone: string
  unlocked: boolean
  address?: string
  matchReasons?: string[]
  riskFlags?: string[]
  isB2B?: boolean | null
  source?: string
  country?: string
  countryCode?: string
  website?: string
  snippet?: string
  inferredRole?: string
  salesStrategy?: string
  status?: LeadStatus
  analysisCache?: Record<string, LeadAnalysisCacheEntry>
  /* V1.3 多源融合字段 */
  dataSourceType?: DataSourceType
  exhibitionFootprints?: string[]
  customsData?: CustomsData
  decisionMakers?: DecisionMaker[]
  agentStatus?: AgentStatus
}
```

用途：

- 存放搜索页的候选与评分结果。
- 是 `searchResults` 状态数组的元素类型。
- 比 `LeadItem` 更轻，不含 `tags`、`starred`、`generatedStrategies`、`estimatedValue` 等线索库字段。

### 2.1.4 `LeadsState`

```ts
type LeadsState = {
  leads: LeadItem[]
  searchResults: LeadSearchResult[]
  hydrated: boolean
  teamClaimedDomains: Set<string>
  hydrateFromConfig: () => Promise<void>
  saveLeads: (leads: LeadItem[]) => Promise<LeadItem[]>
  mergeLeads: (leads: LeadItem[]) => Promise<LeadItem[]>
  addLead: (lead: LeadItem) => Promise<LeadItem[]>
  updateLead: (id: number, patch: Partial<LeadItem>) => Promise<LeadItem[]>
  deleteLead: (id: number) => Promise<LeadItem[]>
  setSearchResults: (results: LeadSearchResult[]) => Promise<void>
  refreshTeamClaimedDomains: () => Promise<void>
  refreshCollisionsForDomains: (domains: string[]) => Promise<void>
  isDomainClaimed: (domain: string) => boolean
}
```

状态含义：

- `leads`：本地线索主池
- `searchResults`：搜索工作台当前候选池
- `hydrated`：当前 store 是否已初始化
- `teamClaimedDomains`：团队已占用域名集合，用于防撞单

### 2.1.5 Store Action 逻辑摘要

#### `hydrateFromConfig`

- 当前实现只执行 `set({ hydrated: true })`
- 不从磁盘回灌业务数据
- 调用 `probeLeadStore(get().leads.length)`

#### `saveLeads`

- 全量替换 `leads`
- 对每条 `LeadItem` 走 `normalizeLeadItem`
- 强制校正 `status` / `followUp`

#### `mergeLeads`

- 使用 `getLeadUniqueKey(...)` 做唯一键：
  - 优先 `website:${normalizedWebsite}`
  - 否则 `company:${normalizedCompany}`
- 已有线索与新线索合并时：
  - 保留原 `id`
  - 用新值覆盖大部分字段
  - `generatedStrategies` 做浅合并
  - `tags` 在 incoming 有值时覆盖
- 最终排序：
  1. `addedDate` 降序
  2. `matchScore` 降序，未评分按 `-1`

#### `addLead`

- 实际调用 `mergeLeads([lead])`

#### `updateLead`

- 根据 `id` 定位
- 将 `patch` 与原 lead 合并
- 再走 `normalizeLeadItem`

#### `deleteLead`

- 根据 `id` 删除

#### `setSearchResults`

- 直接整体替换 `searchResults`

#### `refreshTeamClaimedDomains`

- 调 `fetchClaimedDomainsApi()`
- 成功后写入小写域名 `Set`
- 失败则保持当前状态，不抛出 UI 错误

#### `refreshCollisionsForDomains`

- 调 `checkDomainsCollision(domains)`
- 若 `data.offline` 为真，则直接返回
- 成功后将 `claimedDomains` 增量合并进 `teamClaimedDomains`
- 异常时静默降级

#### `isDomainClaimed`

- 统一做 trim、小写、去 `www.`、去协议、去尾斜杠
- 然后在 `teamClaimedDomains` 查询

## 2.2 线索状态枚举

```ts
export type LeadStatus = "new" | "contacting" | "replied" | "archived"
export type FollowUpStatus = LeadStatus
```

### 2.2.1 状态归一逻辑

`normalizeLeadStatus(status?: string): LeadStatus`

映射规则：

- `contacted` / `qualified` / `negotiation` -> `contacting`
- `closed` -> `replied`
- `lost` -> `archived`
- 其他未知值 -> `new`

## 2.3 `matchScore` 的真实流转语义

这是当前系统中最关键的字段之一。

### 2.3.1 数据类型

- `LeadItem.matchScore?: number | null`
- `LeadSearchResult.matchScore?: number`
- `SearchExecuteResult.matchScore?: number | null`

### 2.3.2 生命周期

#### 阶段 A：基础结果返回

在 `search-service.ts`：

- `emitBasicResults(...)` 中对候选执行：`applySchemaDefaults({ ...item, matchScore: undefined })`
- 因此基础搜索结果进入前端时，`matchScore` 显式处于 `undefined`

前端 UI 语义：

- `typeof lead.matchScore === 'number'` 为假
- 显示“待评估”或“AI 正在分析该线索...”

#### 阶段 B：流式评分中

- `onSearchLeadScored(...)` 逐条收到评分结果
- 对命中的 lead 执行：
  - `matchScore: typeof scoredLead.matchScore === 'number' ? scoredLead.matchScore : lead.matchScore`
- 即：只有新值是数字才覆盖旧值

前端语义：

- `undefined` -> 数字，代表已完成评分
- 若评分失败，则 fallback result 可能继续保留 `undefined`

#### 阶段 C：保存进线索池

`mapSearchResultToLeadItem(...)` 中：

```ts
matchScore: typeof result.matchScore === 'number' ? result.matchScore : undefined
```

这意味着：

- 搜索页未评分 lead 存入线索库后仍是 `undefined`
- 不会被写成 0
- UI 中继续视为“待评估”

#### 阶段 D：后续展示与排序

排序和过滤普遍采用：

- `typeof matchScore === 'number'`
- 未评分项通常按 `-1` 或 0 参与兜底比较

真实表现包括：

- 搜索页排序：已评分项优先，未评分项靠后
- 质量过滤：未评分视为低分，例如高相关筛选用 `typeof lead.matchScore === 'number' ? lead.matchScore : 0`
- Leads 表 / Kanban / Drawer 中，未评分统一显示“待评估”

### 2.3.3 `isB2B` 流转语义

`isB2B?: boolean | null` 只在搜索结果层存在，当前不进入 `LeadItem`。其来源：

- LLM 在 `buildUniversalIcpPrompt(...)` 输出结构中返回 `isB2B`
- `extractLlmResults(...)` 中解析为布尔值
- 搜索页 UI 用它展示 `B2B` / `B2C` 标签

这说明当前 `isB2B` 更偏搜索态判断信号，而不是线索库长期字段。

---

## 三、模块功能与前后端交互时序 (Workflow Details)

## 3.1 通信总线总览

### 3.1.1 真实 IPC 通道

#### Search

- `api:test-connection`
- `api:proxy`
- `search:execute`
- `search:stream-start`
- `search:stage`
- `search:basic-results`
- `search:lead-scored`
- `search:stream-complete`
- `search:stream-error`
- `analysis:generate`

#### Automation

- `automation:verify-emails`
- `automation:start-campaign`

#### Cloud

- `cloud:check-collision`
- `cloud:sync-lead`
- `cloud:upsert-lead`
- `cloud:check-domains`
- `cloud:create-campaign`
- `cloud:fetch-team-leads`
- `cloud:fetch-tracking`
- `cloud:subscribe-realtime`
- `cloud:unsubscribe-realtime`
- `cloud:realtime-lead-event`
- `cloud:fetch-claimed-domains`

### 3.1.2 Preload 暴露接口

`preload/index.ts` 通过 `contextBridge.exposeInMainWorld('electronAPI', electronAPI)` 暴露最小桥接，关键包括：

- `window.electronAPI.search.execute(...)`
- `window.electronAPI.onSearchStreamStart(...)`
- `window.electronAPI.onSearchStage(...)`
- `window.electronAPI.onSearchBasicResults(...)`
- `window.electronAPI.onSearchLeadScored(...)`
- `window.electronAPI.onSearchStreamComplete(...)`
- `window.electronAPI.onSearchStreamError(...)`
- `window.electronAPI.analysis.generate(...)`
- `window.electronAPI.automation.verifyEmails(...)`
- `window.electronAPI.automation.startCampaign(...)`

前端封装位于 `src/lib/electron-api.ts`。

---

## 3.2 Scout 模块 (基础采集)

目标：从前端输入搜索词，到主进程抓取候选客户，再到前端“秒出骨架/列表”，确保用户先看到基础结果，再等待 AI 评分。

### 3.2.1 前端输入阶段（Omni-Search 大一统盲搜）

入口组件：`src/components/search-engine.tsx`

用户输入字段：

- `searchKeyword`（自然语言，中英文均可）
- `searchCountry`
- `searchCity`

取消了旧版 `searchDataSource` 渠道选择器。系统在后台自动执行全渠道 Blind Search：

1. 入口对用户自然语言输入执行意图突变（见 3.2.1.a），提取英文产品词、目标国官方语言产品词、地区、B2B 属性词，并与 B2B_ROLE_TERMS 交叉生成多语言查询变体。
2. 英文变体与目标国官方语言变体并行向 SerpApi/AnySearch/Provider Registry 发送。此策略会扩大约 `2x` API 调用量，属于已批准的高价值 B2B 扩面成本。
3. 后端对汇聚候选执行 ICP 结构化评分（Domain 40%/行业词 30%/B端信号 20%/联系人 10%），再经 .slice(0,50) 刚性截断返回前端。
4. 前端 30 条循环分页（SEARCH_PAGE_SIZE=30），本地缓存全量 50 条。

不再需要 `buildSearchKeyword` 或 `site:linkedin.com/company` 站点限定过滤——Omni-Search 通过 B2B 角色词矩阵天然锁定目标类型。

### 3.2.1.a 意图离散矩阵化与 B2B 关键词交叉相乘

每次搜索入口，主进程执行四步后台工程：

1. **前置意图离散矩阵化**：通过 LLM 将用户自然语言（如 `"帮我找 50 家德国做高尔夫球车电池的经销商，要求有采购邮箱"`）解析为 JSON：`{ country:"Germany", countryOfficialLanguages:["de"], pureEnglishProducts:["Golf Cart Battery"], localizedProducts:[{ language:"de", terms:["Golfwagen Batterie","Golfcart Akku"] }], b2bAttributes:["wholesaler","distributor","importer","dealer"] }`。LLM 不可达时走 `fallbackMutateB2BKeywords()` 确定性兜底，将剩余词拆为单一英文产品，并跳过本地语言扩展。

2. **多语言交叉相乘**：将 `pureEnglishProducts[]` 与 `localizedProducts[].terms[]` 合并为 `allSearchProducts[]`，每项与 `B2B_ROLE_TERMS` 前 4 个角色交叉相乘，生成独立查询变体（如 `"Golf Cart Battery dealer Germany"`, `"Golfwagen Batterie Händler Deutschland"`, `"Golfcart Akku Importeur Deutschland"` 等）。每个变体必须携带 `{ language, sourceProduct, b2bRole }` 元数据，用于 Provider Query、stage 文案和后续调试。

3. **多源 Provider 聚合**：采用 `Promise.allSettled` 驱动所有语言变体并行推送 SerpApi Maps、SerpApi Organic、AnySearch，以及已启用的 `linkedin_search`、`customs_shipment`、`trade_show`、`yellow_pages`、`facebook_search` Provider。任一 Provider 失败只返回空结果并记录日志，不得中断主链路。

4. **硬核 ICP 标准评分算法**：对合并后的候选集执行确定性权重评分——域名存在 40%、核心产品词命中 30%（匹配英文或本地语言产品词任意一项）、B2B 信号词 20%、联系人资产 10%。`customsData`、`exhibitionFootprints`、`decisionMakers` 只能作为同分排序、解释徽标和 LLM 输入，不得绕过 40/30/20/10 基线权重。

5. **局部渲染分页**：前端锁死 50 条限额，按 30 条 / 页 Local Pagination 平滑翻页，保障 4G-8G 轻量运行。

### 3.2.1.b 多语言搜索成本与体验边界

多语言扩展是明确批准的高价值搜索策略，但必须保持成本透明和体验稳定：

- 英文变体始终执行，不得被本地语言变体替换。
- 目标国家明确时，本地官方语言变体必须执行；国家未知时，不得臆造语言。
- `search:stage` 必须展示简体中文状态，例如：`正在追加德国本地语言搜索变体...`。
- 单个语言或单个 Provider 失败时，前端只显示降级提示，不清空现有结果。
- 多语言扩展不得提高 LLM 评分与官网富化并发上限，仍固定为 `2`。

### 3.2.2 前端触发阶段

`handleSearch()` 中的真实行为：

1. 检查 `autopilotBusy`
2. 检查 `featureGate.status !== 'active' || !featureGate.canAccess('search_basic')`
3. 检查关键词为空
4. 重置局部 UI 状态：
   - `setIsLoading(true)`
   - `setHasSearched(true)`
   - `setEmptyStateMessage("")`
   - `setSearchErrorMessage("")`
   - `setShowRetryHint(false)`
   - `setTrialExpired(false)`
   - `setStreamTotal(0)`
   - `setAnalyzedCount(0)`
   - `setStreamStage("")`
   - `setStreamStageMessage("")`
5. 调用：

```ts
searchExecute({
  keyword: searchKeywordForRequest,
  country: searchCountry,
  city: searchCity,
})
```

### 3.2.3 主进程执行阶段

handler 注册：

```ts
registerSecureFeatureIpc(
  ipcMain,
  IPC_CHANNELS.SEARCH.EXECUTE,
  store,
  licenseGuard,
  'search_basic',
  async (_event, payload: SearchExecutePayload) => { ... },
  '海外客户智能搜索'
)
```

这一步说明：

- Trial 过期会被 `ensureTrialAccess(...)` 在更外层拦截
- 即使 trial 未过期，也必须具备 `search_basic` 特性

### 3.2.4 主进程搜索参数组装

真实参数：

- `payload.keyword`
- `payload.country`
- `payload.city`
- `locationString = city && country ? "${city}, ${country}" : country || ''`
- `zoom = city && country ? 12 : 5`
- `effectiveKeyword = locationString ? "${keyword} in ${locationString}" : keyword`

SerpApi 模式 endpoint：

```ts
https://serpapi.com/search.json?engine=google_maps&type=search&q=...&location=...&z=...&api_key=...
```

### 3.2.5 基础结果标准化

抓取完成后，主进程执行：

- `normalizeSearchCandidates(...)`
- 去重规则：
  - 优先域名 `extractDomainFromUrl(normalizedWebsite)`
  - 其次 `company + address`
- 限制：`MAX_SEARCH_CANDIDATES = 200`（Omni-Search 迭代由 100 扩容至 200）

### 3.2.6 相关度预筛（Relevance Pre-filter）

在 Scout 与 Brain 之间，Kone 应增加一个轻量但强约束的“相关度预筛”节点，用于丢弃明显泛化、明显偏题、或明显不符合目标产业信号的候选。

设计原则：

- 只做轻量规则判断，不引入重型 NLP
- 优先使用 `company + reason + snippet + keyword` 做关键词正则匹配
- 对明显不相关的普通修理店、泛化门店、生活服务点做前置过滤
- 不阻塞 `emitBasicResults(...)` 的流式首屏原则

预筛目标：

- 降低 `Golf Cart Battery Dealer` 这类词的泛化误命中
- 减少不必要的 LLM 评分调用
- 在 `4G-8G RAM` 办公环境中节省 token、CPU 与内存消耗

### 3.2.7 基础结果流式首屏输出

主进程在基础列表阶段发出：

1. `emitStreamStart(_event.sender, candidates.length)` -> `search:stream-start`
2. `emitBasicResults(_event.sender, candidates)` -> `search:basic-results`

注意：`emitBasicResults(...)` 会强制把 `matchScore` 设为 `undefined`。

### 3.2.8 前端首屏渲染与骨架/进度状态

`search-engine.tsx` 中对应监听：

- `onSearchStreamStart(...)`
  - `setIsStreaming(true)`
  - `setStreamTotal(total)`
  - `setAnalyzedCount(0)`
  - `setIsLoading(true)`

- `onSearchBasicResults(...)`
  - 把结果转成 `LeadSearchResult[]`
  - 执行 `setSearchResults(normalizedResults)`

因此 UI 表现是：

- 用户点击搜索后立刻进入 loading
- 主进程返回基础结果后，列表马上可见
- 虽然 `matchScore` 尚未完成，但骨架式“空白等待”被替换成真实候选列表

这就是 Scout 模块的“先展示，再增强”的核心体验。

---

## 3.3 Brain 模块 (异步流式 ICP 评分)

目标：在不阻塞基础结果展示的前提下，逐条评分、逐条回传、逐条更新前端列表与进度条。

### 3.3.1 并发控制

主进程核心函数：

```ts
const runLimitedConcurrency = async <T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>)
```

真实逻辑：

- `normalizedLimit = Math.max(1, Math.min(limit, items.length || 1))`
- 创建多个 `runner()` 并行消费同一个 `currentIndex`
- 每个 `runner()` 不断递增 `currentIndex` 并执行 `worker(items[index], index)`
- 最终 `Promise.all(...)`

评分并发常量：

- `SEARCH_LLM_CONCURRENCY = 2`

它被用于：

- 初轮评分：`runLimitedConcurrency(candidates, SEARCH_LLM_CONCURRENCY, ...)`

深探补全并发常量：

- `SEARCH_ENRICH_CONCURRENCY = 2`

它被用于：

- 深探补全：`runLimitedConcurrency(baseResults, SEARCH_ENRICH_CONCURRENCY, ...)`

性能守卫要求：

- 面向 `4G-8G RAM`、低功耗 CPU 的办公电脑，评分与官网补全并发都必须保持极低
- 规范红线是：搜索评分与官网补全并发上限严格固定为 `2`
- 任何只在高配机器上稳定的实现都不符合 Kone 的生产标准

### 3.3.1.a JobID 时空隔离契约

每次 `handleSearchExecute` 入口生成 `crypto.randomUUID()` 写入模块级 `currentActiveJobId`。所有异步回调（`emitBasicResults`、`emitDecisionMakers`、`computeLeadScore`、`enrichLeadWebsite` 及每个 `.then()` / `await` 续传）入口均执行 `if (myJobId !== currentActiveJobId) return`。

- **同步洗舱**：新搜索立即覆写 `currentActiveJobId`，旧回调后续抵达时自动丢弃。
- **跨行业防护**：解决前一个搜索的慢回调污染后一个搜索结果的问题。
- **模块级单例**：当前适用于单窗口单用户。未来多窗口并发搜索需升级为 `Map<窗口ID, string>`。

### 3.3.1.b ICP 结构化预评分（computeIcpMatchScore）

在 `mergeLlmResultsWithCandidates` 之后、`emitLeadScored` 之前，对每个候选执行确定性预评分（无需 LLM 调用）：

- **权重分配（硬编码）**：
  - Domain 存在（website 非空，命中有效域名格式）— 40%
  - 行业词匹配（product 关键词在 snippet / company / website 中命中）— 30%
  - B2B 信号词（dealer/distributor/importer/wholesaler/supplier/manufacturer 在 snippet / snippet_lang 中命中）— 20%
  - 联系人资产（email 或 phone 非空）— 10%
- **匹配逻辑**：`extractDomainFromUrl(website)` 判定 domain 有效性；`keyword 逐词匹配 snippet` 算行业词得分；`B2B_ROLE_TERMS.some(t => snippet.includes(t))` 算 B 端信号得分。
- **写入字段**：`lead.matchScore = computedScore`，在 `LEAD_BASIC_ARRIVED` 阶段即可排序展示。
- **低配友好**：纯字符串匹配，零 LLM 推理开销，4G-8G 机器无压力。

### 3.3.2 LLM 评分 Prompt 输入

评分阶段使用：

- `buildSearchScoringPrompt(...)`
- `buildUniversalIcpPrompt(...)`

真实动态输入包含：

- `keyword`
- `icpProfile.targetProduct`
- `icpProfile.buyerPersona`
- `icpProfile.coreAdvantage`
- `icpProfile.negativeIcp`
- `candidates`

LLM 约束要求输出：

- `company`
- `website`
- `address`
- `totalScore` 或 `matchScore`
- `inferredRole`
- `matchReason`
- `salesStrategy`
- `riskFlags`
- `isB2B`

### 3.3.3 LLM 结果解析

真实解析链：

1. 调用 LLM 接口
2. 从 `choices[0].message.content` 或 `choices[0].text` 提取文本
3. `extractLlmResults(llmPayload)`：
   - `JSON.parse(normalizeLlmJsonText(content))`
   - 兼容 `results / data.results / candidates / items / parsed` 等多层结构
4. 将：
   - `totalScore ?? matchScore` -> `matchScore`
   - `matchReason` -> `matchReasons`
5. 保留：
   - `inferredRole`
   - `salesStrategy`
   - `riskFlags`
   - `isB2B`

### 3.3.4 候选与评分结果合并

函数：`mergeLlmResultsWithCandidates(...)`

匹配规则：

- 优先域名相同
- 其次公司名相同
- 每个 LLM 结果只消费一次：`usedResultIndexes`

兜底行为：

- 若没匹配到，使用候选原始值
- `matchReasons` 退回到：
  - `candidate.reason`
  - `candidate.snippet`
  - `基础信息与搜索词存在一定相关性`
- `riskFlags` 退回到：
  - `需人工复核其 B2B 采购意图`

### 3.3.5 流式逐条推送

评分过程中，每处理完一个候选，主进程执行：

```ts
emitLeadScored(_event.sender, nextLead, completedCount, candidates.length)
```

实际通道：

- `IPC_CHANNELS.SEARCH.LEAD_SCORED = 'search:lead-scored'`

payload 结构：

```ts
{
  candidate: SearchExecuteResult,
  completedCount: number,
  totalCount: number,
}
```

### 3.3.6 前端局部更新

`search-engine.tsx` 中：

```ts
const unsubscribeScored = onSearchLeadScored((payload) => { ... })
```

真实更新逻辑：

- `setAnalyzedCount(payload.completedCount)`
- `setStreamTotal(payload.totalCount)`
- 从 `useLeadsStore.getState().searchResults` 取当前列表
- 用 `website` 或 `company` 做匹配
- 局部覆盖：
  - `matchScore`
  - `matchReasons`
  - `riskFlags`
  - `inferredRole`
  - `salesStrategy`
- 若 `autoSortEnabled` 打开，则调用：
  - `mergeTopRankedResults(currentResults, updatedResults, 8)`

### 3.3.7 进度条与阶段文案

主进程阶段事件：

- `fetching`
- `normalizing`
- `scoring`
- `enriching`
- `complete`

通过：

- `search:stage`
- payload: `{ stage, message }`

前端监听 `onSearchStage(...)` 后更新：

- `streamStage`
- `streamStageMessage`

UI 中真实显示：

- “🌐 正在抓取 Google Maps / SerpApi 搜索结果...”
- “🧩 正在整理候选客户并去重...”
- “🤖 正在进行 ICP 智能评估...”
- “🔎 正在补全官网与商业信号...”
- “✅ 分析完成，线索已更新”

进度数值来源：

- `analyzedCount / streamTotal`

### 3.3.8 官网深探补全

评分结束后，如果 `cleanedResults.length > 0`，主进程进入 `enriching` 阶段：

- `extractWebsiteContent(...)` 抓 homepage + `/contact` + `/contact-us`
- `extractContactCandidates(...)` 从 title / description / body / mailto / tel 中抽联系人、职位、邮箱、电话
- `buildDeepProbePrompt(...)` 调 LLM 生成 `outreachAngle`
- 回写：
  - `contact`
  - `contactTitle`
  - `email`
  - `phone`
  - `matchReasons += 网页深度探测判断：...`
  - `snippet`
  - `salesStrategy = outreachAngle`

### 3.3.9 HTML 极限瘦身与 Snippet 盲评

为适配低配办公环境并提升 ICP 成功率，Brain 模块必须遵守以下容错与性能规范：

- 官网抓取进入 LLM 前，HTML 必须极限瘦身
- 只保留高价值纯文本，不得把大段导航、脚本、样式、页脚、Cookie 弹窗内容直接送入模型
- 进入 LLM 前的网站正文必须经过 HTML 去噪，并严格截断至不超过 `3000` 字符

当官网抓取超时、被拦截、或文本价值极低时，Kone 不应直接放弃评分，而应切换到 Snippet 盲评：

- 使用 `company + title + snippet + keyword + icpProfile` 进行轻量评分
- `matchScore` 仍允许为有效数字
- `matchReasons` 中必须明确注明：`基于简介轻量评估（官网无法访问）`
- 风险提示应保留人工复核信号，而不是把该条线索直接视为系统错误

这使系统即使在弱网络、被防爬、或普通办公电脑环境下，也能维持更高的评分覆盖率。

### 3.3.10 完成信号

评分完成后主进程发：

- `search:stream-complete`

前端监听后：

- `setIsStreaming(false)`
- `setIsLoading(false)`
- 取 `searchResults` 最终排序
- `toast({ title: "分析完成", description: ... })`

### 3.3.11 `leads-table.tsx` 与搜索页的关系

用户需求中提到流式结果“推送到 `leads-table.tsx` 触发局部更新和进度条展示”。基于本地代码扫描，真实情况是：

- 流式监听与进度条展示都发生在 `src/components/search-engine.tsx`
- `src/components/leads-table.tsx` 展示的是 `useLeadsStore().leads`，即已保存线索池
- 它不会直接订阅 `search:lead-scored`

因此，真实链路是：

- `search-service.ts` -> `search-engine.tsx` (`searchResults` 局部更新)
- 用户执行保存后 -> `mapSearchResultToLeadItem(...)` -> `addLead(...)` -> `leads-table.tsx` 可见

---

## 3.4 Commercial 模块 (商业安全与云端联动)

目标：在付费权限、Fail-Closed 拦截、上云裁剪和自动化联动之间建立严格商业边界。

### 3.4.1 高级版拦截机制（Fail-Closed）

#### 入口 1：搜索 / 分析

- `search:execute` 由 `registerSecureFeatureIpc(..., 'search_basic', ...)` 保护
- `analysis:generate` 由 `registerSecureFeatureIpc(..., 'analysis_advanced', ...)` 保护

#### 入口 2：自动化验证

- `automation:verify-emails` 由 `registerSecureFeatureIpc(..., 'cloud_send', ...)` 保护

#### 入口 3：发信任务

`automation:start-campaign` 使用手动双层拦截：

1. `ensureTrialAccess(store, licenseGuard, '自动化发信')`
2. `licenseGuard.requireFeature('cloud_send', '自动化发信')`

失败时返回标准结构：

```ts
{
  success: false,
  error: 'FEATURE_DENIED',
  message: '当前授权无权执行自动化发信',
  operationName: '自动化发信',
  code: 403,
}
```

Trial 过期时还可能返回：

```ts
{
  success: false,
  error: 'TRIAL_EXPIRED' | 'SYSTEM_TIME_ABNORMAL',
  message: '...',
  operationName,
  code: 403,
}
```

### 3.4.2 前端商业拦截

#### 搜索页

- `featureGate.canAccess('search_basic')` 失败时直接 toast 拒绝
- `searchLimit.allowDeepAnalysis` 失败时锁定网页深度分析

#### 分析抽屉

- `analysisLocked = featureGate.loading || !featureGate.canAccess("analysis_advanced")`

#### 自动化工作流

- `canUseCloudSend` 失败时：
  - 打开升级弹窗
  - toast “高级发送能力未开通”

#### 路由级阻断

`dashboard-page.tsx` 中：

- `shouldBlockPremiumPage = (activeNav === "team-dashboard" || activeNav === "automation") && !loading && !canAccessPremiumWorkspace`
- 会渲染 `PremiumAccessBlocked`

### 3.4.3 上云前 Payload 裁剪

主进程函数：`triggerN8nWorkflow(store, leads, templateId?)`

真实裁剪后的 `compactLeads` 结构：

```ts
{
  lead_info: {
    email,
    company,
    domain,
    website,
    country,
    contact,
    contact_title,
    phone,
    address,
    source,
    inferred_role,
    match_reasons,
    risk_flags,
    snippet,
  },
  icp_match_score,
  ai_analysis: {
    companyProfile,
    painPoints,
    valueMapping,
    confidence,
    source,
  },
  ai_generated_pitch: {
    emailSubject,
    emailBody,
  },
  user_settings: {
    templateId,
    selectedModel,
    icpProfile,
  },
  verification_status,
}
```

裁剪策略非常明确：

- `company.slice(0, 200)`
- `country.slice(0, 50)`
- `contact.slice(0, 100)`
- `contact_title.slice(0, 120)`
- `phone.slice(0, 80)`
- `address.slice(0, 240)`
- `source.slice(0, 120)`
- `inferred_role.slice(0, 120)`
- `snippet.slice(0, 500)`
- `companyProfile.slice(0, 800)`
- `painPoints.slice(0, 800)`
- `valueMapping.slice(0, 1000)`
- `emailSubject.slice(0, 200)`
- `emailBody.slice(0, 2400)`
- `match_reasons.slice(0, 4)`
- `risk_flags.slice(0, 3)`

只有 `entry.lead_info.email` 非空的 lead 才能进入最终推送数组。

### 3.4.4 渐进式开发 / 云端未配置降级

若 Webhook URL 是占位符，或不是 `https://` 开头，则：

- 不真正发送请求
- 返回：

```ts
{
  triggered: true,
  accepted,
  rejected,
  message: '渐进式开发模式：数据组装成功，云端 Webhook 暂未配置，已取消推送'
}
```

这是典型的“功能链路走通，但云端执行被软降级”的设计。

### 3.4.5 Dashboard 单线索交接

`dashboard-page.tsx` 中 `handleSendToCloud(lead)` 会把单条 `LeadItem` 包装成：

- `templateId: "single_lead_handoff"`
- `leads: [ ... ]`

然后调用 `startCampaign(...)`。

若响应：

- `triggered === false && response.error` -> 抛出 Error
- `triggered === false && !response.error` -> 返回 `{ skipped: true, reason }`
- 否则 `{ skipped: false }`

这使单条线索也能复用同一套商业云端交接机制。

---

## 3.5 伴随式后台巡航 (Autopilot)

伴随式后台巡航是 Basic 及以上套餐中的关键差异化能力，目标是把“批量搜索 + 静默筛选 + 持续入库”从人工重复操作中剥离出来，但依然保持在本地算力边界内运行。

### 3.5.1 真实数据结构

Autopilot 的状态中心位于 `src/store/autopilot-store.ts`。

#### `AutopilotJob`

```ts
export type AutopilotJob = {
  id: string
  keyword: string
  country: string
  targetLeads: number
  threshold: number
  attempts: number
  status: 'pending' | 'running' | 'cooldown' | 'completed' | 'failed'
  discoveredCount: number
  qualifiedCount: number
  savedCount: number
  dedupedCount: number
  failedCount: number
  lastError?: string
  startedAt?: number
  updatedAt?: number
  finishedAt?: number
  cooldownUntil?: number
}
```

#### `AutopilotRuntime`

```ts
export type AutopilotRuntime = {
  runId: string
  lifecycle: 'idle' | 'running' | 'paused' | 'completed' | 'error'
  currentJobId?: string
  totalJobs: number
  completedJobs: number
  failedJobs: number
  totalDiscovered: number
  totalQualified: number
  totalSaved: number
  totalDeduped: number
  abortRequested: boolean
  pauseRequested: boolean
  startedAt?: number
  updatedAt?: number
  finishedAt?: number
  lastError?: string
}
```

#### `AutopilotSettings`

```ts
export type AutopilotSettings = {
  cooldownMs: number
  scoreThreshold: number
  persistThrottleMs: number
}
```

默认值来自：

- `DEFAULT_COOLDOWN_MS = 30_000`
- `DEFAULT_SCORE_THRESHOLD = 60`
- `DEFAULT_PERSIST_THROTTLE_MS = 1_000`

### 3.5.2 交互流转

真实用户交互流是：

1. 用户在 `search-engine.tsx` 的巡航控制台批量输入任务草稿 `draftText`
2. 每一行被解析为 `country + keyword + targetLeads`
3. `addBatchJobs(rawText)` 生成 `AutopilotJob[]`
4. 用户点击“启动巡航”后进入本地后台任务队列
5. 运行时由 `src/lib/autopilot-runner.ts` 串行取出 `pending` 任务执行
6. 每个任务内部通过 `searchExecute({ keyword, country })` 触发主进程搜索
7. 搜索结果经过 `filterQualifiedResults(...)` 与阈值过滤后，仅高价值结果进入保存路径
8. 合格线索通过 `mapSearchResultToLeadItem(...)` + `addLead(...)` 写入本地 `leads`
9. UI 只展示运行进度、当前任务、发现数、命中数、已存数与错误信息，不强制打断主工作流

### 3.5.3 静默过滤 (Gold Filter)

Autopilot 并不是把所有搜索结果都写入线索池，而是遵循本地 Gold Filter：

- 只保留满足阈值的 `qualifiedResults`
- 默认阈值是 `scoreThreshold = 60`
- `dedupedCount` 记录去重数量
- `savedCount` 记录实际写入数量

这意味着巡航模式的价值不是“刷量”，而是：

- 后台持续搜索
- 后台静默打分
- 后台过滤低价值结果
- 只把高质量 B2B 线索沉淀进 `leads`

### 3.5.4 低并发与 429 防护

Autopilot 的工业级边界是“极低并发 + 冷却重试”。

在 `src/lib/autopilot-runner.ts` 中，关键防护包括：

- 逐任务执行，而不是大并发并发轰炸
- `computeBackoffMs(attempts, baseMs)` 指数退避
- 命中 `429|quota|rate limit|too many requests|额度` 时分类为 `rate_limit`
- 限流后：
  - `requeueJob(...)`
  - 写入 `lastError`
  - 进入冷却睡眠
- 触发连续失败上限后：
  - 自动 `pauseWithReason(...)`
  - 防止 API 熔断和网络信誉受损

因此可以把 Autopilot 的执行原则定义为：

- 后台静默
- 极低并发
- 分批节流
- 先保 API 安全，再追求任务持续性

### 3.5.5 物理运行边界（极其重要）

Autopilot 与云端自动化的最大区别，在于其运行物理边界完全不同。

#### Autopilot 的真实物理边界

Autopilot 依托以下本地资源：

- 本地 Electron 应用进程
- 本地 `useAutopilotStore` 运行态
- 本地网络连接
- 本地 `searchExecute(...)` 主进程调用
- 本地浏览器窗口/桌面会话存活

因此它必须满足：

- 电脑保持开机
- 应用保持运行
- 系统不能休眠
- 网络必须在线

只要本机休眠、关机、断网或应用被杀掉，巡航任务就无法继续推进。这是“伴随式后台巡航”的物理事实边界，必须在商业文档中明确声明，避免被误解为云端托管任务。

#### 与 Premium 云端自动化的差异

高级版 `cloud_send` / N8N 自动化在完成数据交接之后，执行主体转移到云端：

- `automation:start-campaign` 只负责把裁剪后的 Payload 交给 Webhook
- 一旦 `safeFetch(webhookUrl, ...)` 成功，后续自动化流程可以在云端 24 小时脱机运行
- 用户本地电脑此后即使关闭，也不影响已交接到 N8N 的邮件流程继续执行

因此，PRD 中必须把两者明确区分为：

- `Autopilot`：本地伴随式后台巡航，必须开机且不可休眠
- `N8N Automation`：云端脱机自动化，交接完成后可 24 小时持续运行

## 3.6 Analysis 模块（深度分析与开发信）

### 3.6.1 IPC 与授权

- 通道：`analysis:generate`
- handler：`IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE`
- 特性：`analysis_advanced`

### 3.6.2 场景枚举

真实场景：

- `direct_quote`
- `competitor_switch`
- `factory_strength`
- `reply_coach`

### 3.6.3 知识库参与方式

主进程从 `userConfig?.knowledgeBase?.entries` 读取知识库，结构抽取：

- `title`
- `content`
- `tags`

然后通过 `pickRelevantKnowledgeEntries(entries, scenario, 5)` 选出最多 5 条最相关知识条目。

输出附带：

- `usedKnowledgeTitles`
- `usedFallback`
- `source`

### 3.6.4 输出字段

普通分析返回：

- `content`
- `companyProfile`
- `painPoints`
- `valueMapping`
- `emailSubject`
- `emailBody`
- `confidence`
- `rawContent`
- `parseFallback`
- `usedKnowledgeTitles`
- `usedFallback`
- `source`

回信教练返回：

- `content`
- `analysis`
- `suggestion`
- `customerText`
- `negotiationRisk`
- `pricingAdvice`
- `replyTemplate`
- `nextAction`
- `rawContent`
- `parseFallback`
- `usedFallback`
- `source: 'reply_coach'`

### 3.6.5 前端状态驻留

`analysis-drawer.tsx` 中：

- `strategyData` 缓存三种策略结果
- `replyResult` 缓存 `reply_coach`
- 保存时通过 `updateLead(id, { analysisCache: ..., generatedStrategies: ... })` 写回线索池

说明当前 AI 分析不是临时弹窗态，而是长期附着在 `LeadItem` 上的可追溯资产。

---

## 3.7 Search-to-Agent 数据管道（V1.3 规划宪章）

目标：在搜索完成评分后，自动将高价值线索分发至各智能体（WhatsApp/LinkedIn/Email）执行触达，并将执行结果写回线索状态，形成"搜索→评分→触达→回写"的完整闭环。

### 3.7.1 管道架构总览

整个管道由四层构成：

| 层级 | 组件 | 职责 |
|---|---|---|
| L1 数据源层 | `Provider Plugin` 体系 | 统一 SearchProvider 接口 + registry，支持 `linkedin_search`/`customs_shipment`/`trade_show`/`facebook_search` 等扩展 |
| L2 搜索评分层 | `search-service.ts` | 执行 4 级弹性搜索协议 + Omni-Search + ICP 评分 + 官网深探，产出含 `decisionMakers[]`/`agentStatus` 的 `SearchExecuteResult` |
| L3 管道分发层 | `agent-pipeline.ts`（待实现） | 监听 `search:stream-complete`，过滤合格线索，生成 `AgentTask` 队列，分发至各 Agent |
| L4 智能体执行层 | `agent-service.ts` | 消费 `AgentTask`，执行真实触达（WhatsApp/LinkedIn/Email），写回 `agentStatus` |

### 3.7.2 管道触发与过滤规则（宪法级）

```
搜索完成 (`search:stream-complete`)
  │
  ▼
Pipeline-Orchestrator 拾取本次搜索的所有 `SearchExecuteResult`
  │
  ▼
过滤规则（同时满足）：
  1. `matchScore >= 60`（高价值线索阈值）
  2. 拥有至少一项可触达资产：`phone` 或 `email` 或 `linkedinUrl` 非空
  │
  ▼
生成 `AgentTask` 对象：
  { leadId, company, phone?, email?, linkedinUrl?, preferredAgent?, createdAt, priority }
  │
  ▼
按 Agent 类型分发（每个 Agent 消费对应字段）：
  - WhatsApp Agent → `phone`
  - LinkedIn Agent → `linkedinUrl`
  - Email Agent → `email`
  │
  ▼
Agent 执行完毕后调用 `writeBackAgentStatus(leadId, agentType, result)`
  写回路径：`SearchExecuteResult.agentStatus` → `LeadItem.agentStatus`
```

### 3.7.3 Agent Task 队列宪法

`AgentTask` 是管道最小任务单元：

```typescript
type AgentTask = {
  id: string                     // crypto.randomUUID()
  leadId: number                 // 关联的 LeadItem.id
  company: string                // 公司名（Agent 执行时用于消息模板）
  phone?: string                 // WhatsApp Agent 消费
  email?: string                 // Email Agent 消费
  linkedinUrl?: string           // LinkedIn Agent 消费
  preferredAgent?: 'whatsapp' | 'linkedin' | 'email'  // 人工指定优先渠道
  createdAt: number              // Date.now()
  priority: number               // 0-100，来自 matchScore
}
```

### 3.7.4 Agent 状态双管道写回模型

**管道 A — `agentStatus`（线索态）**：持久化写入 `SearchExecuteResult.agentStatus` → `LeadItem.agentStatus`

| Agent 类型 | 写入字段 | 值 |
|---|---|---|
| WhatsApp | `whatsappSent: boolean` | `true` 当发送完成 |
| WhatsApp | `whatsappStatus?: 'pending'\|'delivered'\|'replied'\|'failed'` | 投递状态 |
| LinkedIn | `linkedinContacted: boolean` | V1.3 只读 Profile 辅助阶段保持 `false`；仅未来明确批准真实触达动作后才可写 `true` |
| Email | `emailSequenceStage: 0\|1\|2\|3` | 当前触达轮次 |

**管道 B — `AgentState`（运行态）**：内存 `Map<string, AgentState>`，通过 `AGENT.STATUS_CHANGED` IPC 推送

```typescript
type AgentState = {
  id: string
  name: string
  type: 'whatsapp' | 'linkedin' | 'email'
  status: 'idle' | 'running' | 'paused' | 'error'
  progress: number          // 当前任务进度 0-100
  completedCount: number    // 已完成的触达次数
  failedCount: number       // 失败次数
  dailyUsed: number         // 今日已使用配额
}
```

**宪法约束**：Agent 执行完毕后必须同步更新两管道。`agentStatus` 写入通过 `ipcMain` 直接操作 `store`（Zustand 线索池）；`AgentState` 推送通过 `AGENT.STATUS_CHANGED` 发送至前端面板。

### 3.7.5 搜索 API 密钥提供方等级隔离

| 等级 | 提供方 | 密钥来源 | 适用场景 |
|---|---|---|---|
| P0 | AnySearch 垂直 B2B 实体 API | `userConfig.providers[anysearch]` | 全局搜 + 决策人穿透 + 海关/展会/社媒多源融合 |
| P1 | SerpApi LinkedIn Search | 复用 `userConfig.providers[google-maps]` 中同一 SerpApi Key | LinkedIn 公司/人物定向挖掘 |
| P2 | 海关数据爬虫 | 用户自备（如有） | 提单数据补充 |
| P3 | 展会名录爬虫 | 免费公开数据 | 展会足迹补充 |

### 3.7.6 Provider 注册表规范（待实现 V1.3）

`electron/services/provider-registry.ts` 负责统一管理 SearchProvider 枚举与调度：

```typescript
interface SearchProvider {
  id: DataSourceType                          // 'google_maps' | 'google_organic' | 'customs_shipment' | ...
  name: string                                // 人类可读标签
  execute(query: ProviderQuery): Promise<SearchExecuteResult[]>
  isAvailable(): boolean                      // 密钥/配置检查
}

type ProviderQuery = {
  keyword: string
  language: string
  country?: string
  city?: string
  intentProducts?: string[]                   // 来自 LLM 意图提取
  b2bAttributes?: string[]
  myJobId: string
}

class ProviderRegistry {
  register(provider: SearchProvider): void
  get(id: DataSourceType): SearchProvider | undefined
  getAll(): SearchProvider[]
  getAvailable(): SearchProvider[]
  executeAll(query: ProviderQuery): Promise<{ providerId: DataSourceType; results: SearchExecuteResult[] }[]>
}
```

**每个 Provider 实现以下行为契约**：
- 文件位置：`electron/services/providers/<id>-provider.ts`
- 构造函数注入所有配置（API Key、Base URL 等），运行期不可变
- `execute()` 内部必须执行 `myJobId !== currentActiveJobId` 时空隔离检查
- 失败时不得抛出异常：返回空数组 + 日志记录
- `isAvailable()` 返回 `false` 时，`executeAll()` 跳过该 Provider
- Provider 只负责采集和归一化，不得直接写 Zustand、不得发送 IPC、不得保存线索

### 3.7.7 Agent 真实执行与反爬边界

V1.3 三个智能体必须从模拟函数升级为真实本地执行，但必须遵守平台风控边界：

| Agent | 真实执行范围 | 明确禁止 | 默认频率 |
|---|---|---|---|
| WhatsApp | Basic: `whatsapp-web.js` 本地扫码 + Web WA 低量发送；Premium: WhatsApp Cloud API | 宣称绝对免风控；无间隔批量轰炸；session 失效后假成功 | Basic 3-5/day |
| LinkedIn | 导入用户授权 Session Cookie，Profile 只读浏览，公开信息提取，AI 破冰文案生成 | 自动 Connect、自动私信、批量点击、绕过验证码 | ≤30 profile view/day |
| Email | Nodemailer SMTP 真实发信 + IMAP 回复检测 + 3 轮序列 | DNS 不合格仍强制发送；无退订/无节流群发 | Basic 20/day |

实现约束：

- `agent-service.ts` 中任何 `setTimeout` 模拟成功逻辑必须被真实 HTTP、SMTP/IMAP 或浏览器自动化替换。
- 登录失效、验证码、平台限流、账号异常、网络超时必须写入 `AgentLogEntry[]` 并推送 `AGENT.STATUS_CHANGED`。
- WhatsApp Web session 通常可能在 1-2 小时内断开，断开后必须进入 `paused` 或 `error`，前端提示重新扫码。
- LinkedIn 只能提供半自动人工确认路径：AI 生成文案后，用户自行复制或确认，不允许无人值守发起社交动作。
- Email Agent 是最低风险主通道，必须优先保证可用性和 DNS 健康前置拦截。

### 3.7.8 `writeBackAgentStatus` 实现规范

`writeBackAgentStatus(leadId, agentType, result)` 是本地获客闭环的强制函数：

```typescript
type AgentExecutionResult = {
  ok: boolean
  status: 'pending' | 'delivered' | 'replied' | 'failed'
  detail?: string
  timestamp: number
}

async function writeBackAgentStatus(
  leadId: number,
  agentType: 'whatsapp' | 'linkedin' | 'email',
  result: AgentExecutionResult,
): Promise<void>
```

写回规则：

- WhatsApp 成功发送：`agentStatus.whatsappSent = true`，`agentStatus.whatsappStatus = result.status`。
- LinkedIn Profile 浏览成功：`agentStatus.linkedinContacted = false` 仍保持不变；必须新增日志说明 `Profile 已浏览，破冰文案已生成，等待人工触达`。除非未来明确批准自动 Connect，否则不得把只读浏览写成 `linkedinContacted = true`。
- Email 第 N 轮发送成功：`agentStatus.emailSequenceStage = N`。
- 任何失败必须写入运行态 `AgentState.failedCount`，并保留 `LeadItem.agentStatus` 的既有成功状态，不得用失败覆盖历史成功。

前后端一致性约束：

- 前端线索表/详情抽屉读取 `LeadItem.agentStatus` 展示持久化触达状态。
- `/agents` 面板读取 `SalesAgentState` 展示运行态进度。
- 二者都必须来自真实后端状态，不得硬编码假数据、不得前端自行推导成功。

### 3.7.9 Tier 隔离：Basic vs Premium

| 能力 | Basic | Premium |
|---|---|---|
| 搜索管道（Provider 体系） | `google_maps` + `google_organic` + 用户自带 SerpApi/AnySearch | 全量 Provider + 可配置自定义 Provider |
| Agent 管道 | Email + WhatsApp Web 低量本地执行；LinkedIn 只读辅助可按授权开放 | WhatsApp Cloud API + LinkedIn Profile 辅助 + Email/N8N 全渠道 |
| ICP 评分 | 确定性评分 + LLM 评分 | 同 Basic + 自定义评分权重 |
| Agent 写回 `agentStatus` | ✅（本地执行成功后必须写回） | ✅ |
---

## 四、异常处理与 UI 韧性规范

## 4.1 搜索主链路异常处理标准

### 4.1.1 主进程统一规则

`search-service.ts` 中：

- 异常时调用 `emitStreamError(_event.sender, error?.message || 'Search execute failed')`
- `emitStreamError(...)` 内部会先发：
  - `search:stream-error`
- 然后立刻补发：
  - `search:stream-complete`

这严格符合 `.clinerules` 与 `ipc-agent.md` 中“异常也必须 complete 收尾，防止 UI 永久 loading”的要求。

### 4.1.2 429 / 配额 / 网络错误

`mapHttpError(status, provider)` 中：

- `401 / 403` -> API 密钥无效或未授权
- `429` -> `${provider} API 调用额度已耗尽，请前往平台充值`
- `>=500` -> `${provider} 服务暂时拥堵，请稍后重试`

对前端的友好消息进一步通过：

- `formatErrorMessage(...)`
- `buildPersistentErrorMessage(...)`

进行加工。

### 4.1.3 前端对 429 / 网络异常的韧性处理

`search-engine.tsx` 中关键逻辑：

- `onSearchStreamError(...)`：
  - 若 `searchResults.length > 0`，toast 文案为：`AI 增强处理中断，已保留基础搜索结果。`
- `handleSearch().catch(...)`：
  - 若已有结果，toast 文案为：`已保留基础搜索结果，可稍后重试 AI 评分。`
  - 不会清空 `searchResults`

这是当前代码对“保留用户劳动成果”的直接实现。

### 4.1.4 Trial 过期处理

`handleSearch()` 的 catch 中：

- 若错误命中 `/TRIAL_EXPIRED/i`
- 执行：
  - `setTrialExpired(true)`
  - `setSearchErrorMessage("")`
  - `setShowRetryHint(false)`
- 并 toast 提示授权已失效
- 注释明确写着：
  - `// P1-1 fix: 严禁清空已有结果 (.clinerules §4.2)`

### 4.1.5 搜索页 UI 提示层

搜索页会根据状态展示：

- 顶部 `Alert`：显示当前搜索服务暂不可用 / 本次搜索出现网络异常
- `showRetryHint`：针对 `network|timeout|fetch|429` 之类错误显示“建议稍后重试”
- 若已有历史结果，则保留结果区，仅提示失败，不重置 Store

## 4.2 自动化链路异常处理

### 4.2.1 邮箱验证

- `verifyEmailsBatch(...)` 串行执行，避免 SMTP 端口爆发
- 单个邮箱错误会被转为：
  - `格式无效`
  - `域名 xxx 无 MX 记录`
  - `SMTP 连接超时`
  - `SMTP 连接失败`
  - `RCPT 拒绝`
  - `SMTP 验证异常`

### 4.2.2 云端发信

`triggerN8nWorkflow(...)` 返回的失败语义包括：

- `请选择至少一条线索`
- `选中线索均无有效邮箱`
- `云端发送失败（HTTP xxx）`
- `云端队列不可达，请检查网络连接`

前端 `automation-workflow.tsx`：

- 若 `startCampaign(...)` 抛错，则 toast `发送失败`
- 若 `data.triggered` 为假，则 toast destructive
- 若成功，则展示 `campaignResult` 并触发 tracking 拉取

## 4.3 Autopilot 韧性规范

虽然本次重点不是 Autopilot，但它体现了系统对限流与网络问题的韧性设计。

`src/lib/autopilot-runner.ts` 中：

- 对 429 / `quota` / `rate limit` 分类为 `rate_limit`
- 使用 `computeBackoffMs(attempts, baseMs)` 退避
- 超过阈值时：
  - `MAX_JOB_ATTEMPTS`
  - `MAX_CONSECUTIVE_FAILURES`
- 会自动：
  - `requeueJob(...)`
  - `pauseWithReason(...)`
  - `stopWithFatalError(...)`

这说明 Kone 在无人值守巡航场景下，已经实现了“限流冷却、自动暂停、保护信誉”的成本与风控机制。

---

## 五、关键前后端结构清单

## 5.1 Search 请求结构

```ts
type SearchExecutePayload = {
  keyword: string
  country?: string
  city?: string
  dataSourceType?: DataSourceType
  filterOptions?: {
    priorityWebsite?: boolean
    localDomainOnly?: boolean
    highRelevanceOnly?: boolean
    b2bRoleOnly?: boolean
  }
}
```

前端对应：

```ts
export type SearchExecuteRequest = {
  keyword: string
  country?: string
  city?: string
  dataSourceType?: DataSourceType
  filterOptions?: {
    priorityWebsite?: boolean
    localDomainOnly?: boolean
    highRelevanceOnly?: boolean
    b2bRoleOnly?: boolean
  }
}
```

## 5.2 Search 返回结构

```ts
type SearchExecuteResult = {
  id: string
  company: string
  website: string
  contact?: string
  contactTitle?: string
  email?: string
  phone: string
  address: string
  isB2B?: boolean | null
  source?: string
  matchReasons?: string[]
  riskFlags?: string[]
  matchScore?: number | null
  snippet?: string
  inferredRole?: string
  salesStrategy?: string
  fallbackStatus?: 'social_blind_score'
  dataSourceType?: DataSourceType
  exhibitionFootprints?: string[]
  customsData?: CustomsData
  decisionMakers?: DecisionMaker[]
  agentStatus?: AgentStatus
}
```

## 5.3 流式评分事件结构

```ts
export type SearchLeadScoredPayload = {
  candidate: SearchExecuteResult
  completedCount: number
  totalCount: number
}
```

## 5.4 阶段事件结构

```ts
export type SearchStagePayload = {
  stage: 'anysearch' | 'localized_search' | 'fetching' | 'normalizing' | 'prefiltering' | 'scoring' | 'blind_scoring' | 'enriching' | 'complete'
  message: string
}
```

阶段事件约束：多语言搜索、本地语言补充、Provider 降级、Snippet 盲评都必须通过后端 stage 事件向前端表达，前端不得自行根据国家字段猜测语言或阶段。

## 5.5 Analysis 请求结构

```ts
export type AnalysisGenerateRequest = {
  lead: {
    company: string
    industry?: string
    country?: string
    website?: string
    address?: string
    phone?: string
    contact?: string
    contactTitle?: string
    snippet?: string
    matchReasons?: string[]
    riskFlags?: string[]
    inferredRole?: string
    source?: string
    salesStrategy?: string
    customerText?: string
  }
  scenario: string
}
```

## 5.6 Automation 发信请求结构

```ts
export type CampaignStartRequest = {
  leads: Array<Record<string, unknown>>
  templateId?: string
}
```

在前端真实 payload 组装中，关键字段来源于：

- `email`
- `company`
- `website`
- `domain`
- `country`
- `contact`
- `contactTitle`
- `phone`
- `address`
- `source`
- `matchScore`
- `matchReasons`
- `riskFlags`
- `inferredRole`
- `salesStrategy`
- `snippet`
- `aiAnalysis`
- `aiGeneratedPitch`
- `verificationStatus`
- `userSettings`

---

## 六、真实页面模块对照

### 6.1 `search-engine.tsx`

职责：

- 发起搜索
- 订阅流式事件
- 维护 `searchResults`
- 执行筛选、自动排序、保存 lead
- 承担网页深度分析轻入口
- 承担官网直达跳转的前端交互闭环

### 6.2 `leads-table.tsx`

职责：

- 展示 `leads`
- 快速执行 `AI 深度分析`
- 支持导出与发送至云端
- 不直接处理流式评分事件

### 6.3 `analysis-drawer.tsx`

职责：

- 调用 `analysisGenerate(...)`
- 展示策略化分析结果
- 复制开发信、回信策略
- 将缓存写回 `analysisCache` / `generatedStrategies`
- V1.3 多源字段展示：在线索头部区域显示 `dataSourceType` 彩色徽标（海关提单-绿色、展会名录-琥珀色、行业黄页-紫色、LinkedIn-蓝色、网页搜索-灰色、Google Maps-蓝色）、决策人数量徽标、海关数据存在性徽标、展会足迹数量徽标

### 6.4 `data-center.tsx`

职责：

- 展示本地线索库的数据看板
- 概览统计：总线索数、已联系数、高评分线索数、今日新增数
- V1.3 多源 KPI：海关数据覆盖数（及百分比）、决策人覆盖数（及百分比）
- "多源数据覆盖"面板：包含海关数据、决策人信息、展会足迹 3 个覆盖指标卡片，以及来源分布水平条形图（按 `source` 字段聚合计数与占比）

### 6.5 `automation-workflow.tsx`

职责：

- 邮箱验证
- 清洗死邮箱
- 组装云端发送 payload
- 触发 `startCampaign(...)`
- 追踪打开状态

### 6.6 `dashboard-page.tsx`

职责：

- 作为总路由容器
- 管理 `AppSidebar`
- 管理 Premium 页面阻断
- 提供从搜索页到单线索云端交接的桥接逻辑

---

## 七、代码中已经落地的产品原则总结

### 7.1 已明确落地

- 线索与搜索结果驻留在 Zustand，不写入长期配置
- 搜索链路先基础结果，后 AI 增强
- 异常时通过 `stream:error + stream:complete` 解锁 UI
- 429 / 网络异常时保留历史结果，不重置 `searchResults`
- 官网深探与知识库分析都走主进程，不让前端直连外部网络
- 自动化发信前做 Fail-Closed 权限拦截
- 上云 payload 明显做了裁剪与字段白名单收缩
- 低配办公环境下必须优先保证稳定性，而不是盲目堆高并发
- V1.3 多源融合字段已在 `leads-store.ts` 中定义类型，在 `analysis-drawer.tsx` 和 `data-center.tsx` 中实现 UI 展示

### 7.2 当前代码中值得产品侧注意的现状

以下是"代码现状"，不是建议：

- `FEATURE_ALIASES.basic` 已正确限定为本地能力集合：`search_basic`、`search_deep`、`analysis_basic`、`analysis_advanced`、`lead_export`、`export_full`，不包含任何云端能力
- `cloud_send` 与 `team_collaboration` 严格限定在 `premium` / `enterprise` 别名中
- Trial plan 映射到 Basic 别名（获得 Basic 完整能力集的 7 天体验），与 PRD 描述一致

---

## 八、面向研发和产品的结论

Kone 当前已经形成一条较完整的 B2B 出海获客闭环：

1. 以前端 `searchKeyword/country/city` 发起本地搜索任务
2. 主进程通过 `search:execute` 调用搜索 API，返回基础候选
3. 通过 `search:basic-results` 让前端立即展示候选列表
4. 再通过 `search:lead-scored` 流式推送 `matchScore / inferredRole / salesStrategy / riskFlags / isB2B`
5. 前端局部更新 `searchResults`，驱动进度条、排序、标签、筛选
6. 用户把高价值结果通过 `mapSearchResultToLeadItem(...)` 写入 `leads`
7. 用户可进一步调用 `analysis:generate` 获得知识库增强分析和开发信
8. 高级商业动作则通过 `automation:verify-emails` 和 `automation:start-campaign` 进入云端协同链路
9. 整个过程中，授权、异常、限流、断网、回退都已具备明确的主进程守卫和 UI 韧性策略

这套实现最核心的价值，不是简单“搜出名单”，而是把：

- 搜索候选
- 关键词相关度预筛
- ICP 评分
- 角色推断
- 跟进策略
- Snippet 盲评容错
- 深度开发信
- 云端发信交接
- V1.3 多源数据融合展示（`analysis-drawer` 字段徽标 / `data-center` 覆盖 KPI 与来源分布）

串成了一条可渐进增强、可授权分层、可失败保底、可在低配办公电脑稳定运行的工业级 B2B 获客流水线。
