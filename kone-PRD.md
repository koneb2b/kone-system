# 📑 Kone AI (V1.3) 二次开发与 OMO/CodeNomad 高顺畅迭代规范法典

## ⚖️ 一、 核心商业法典与套餐能力边界 (Commercial Law)
### 1. 商业套餐梯队三级结构
- **7天限时试用版 (Trial)**
  - 属性定义：属于 `plan: 'trial'` 且 `tier: 'basic'`，即基础版本地重计算能力集合的 7 天限时体验，绝非永久免费层。
  - 加密双锚点防线：通过 `AnchorPayload` 记录 `firstTrialAt`、`expiresAt` 与 `lastCheckDate`。同步物理写入系统注册表与底层隐藏系统目录。即使本地主配置文件 `kone-config.json` 被手动清空或删除，初始化时仍能跨渠道强制恢复真实历史试用记录，彻底防范白嫖重置期。
  - 反篡改惩罚机制：优先调取网络标准时间接口；断网离线时自动回退至本地最近一次可信时间锚点。一旦 `lastCheckDate` 校验检测到用户人为手动回拨系统时间，主进程防卫机制立即切断所有核心功能，将 `lockedReason` 强行标记为 `'time_rollback'`，直接将应用阻断并重定向至 `locked` 黑牢页。
  - V1.3 融合性限制：解锁基础级 AnySearch 自然语言多源检索能力，但在单线索 AI 深度分析抽屉中，**限制生成与下载高价值 PDF 客户全景白皮书的次数（全局上限硬编码为 3 次）**，作为 PLG 漏斗的核心逼单卡点。
- **付费基础版 (Paid Basic)**
  - 属性定义：面向单兵作战、外贸独立业务员开发的本地重计算生产力全量套件。
  - 燃料自理与 0 算力垫资：采用 **“客户自带密钥 (LLM / SerpApi / AnySearch)”** 模式。用户运行软件产生的大模型 Token 消耗与搜索额度由其自行与第三方供应商直接结算。这种设计确保了 Kone 软件方的服务器运营成本、算力垫资风险与代理 IP 维护成本永远保持在 **0 状态**，具备无限的规模化边际效益。
  - 核心能力集 (Feature Aliases)：基于 `src/lib/feature-gate.ts` 的硬性映射，完整解锁本地闭环获客场景所需的全部特权：
    - `search_basic`：全量搜索引擎与单次最高 100 条（`maxResults: 100`）的搜索候选集。
    - `search_deep`：企业官网与二级页面的本地深度爬取与信号富化。
    - `analysis_basic` / `analysis_advanced`：AI 深度分析抽屉、场景化开发信生成与结构化回信拆解（`reply_coach`）。
    - `lead_export` / `export_full`：本地线索池生命周期管理、标记与全量 Excel/CSV 导出。
    - `local_autopilot`：本地伴随式后台巡航管理队列。
- **付费高级版/企业版 (Paid Premium/Enterprise)**
  - 属性定义：面向团队资产沉淀、多渠道矩阵运营与云端脱机全自动协同的高级企业版本。
  - 核心能力集 (Feature Aliases)：独占 `cloud_send` 与 `team_collaboration` 核心特权，包含：
    - **N8N 云端邮件自动化序列**：将格式化报文加密交接至远程 Webhook，执行脱机多轮营销。
    - **发信人域名信誉防火墙 (Deliverability Shield)**：集成类似于 mailX 的发信基础设施实时 DNS 检阅引擎。
    - **云端实时防撞单引擎 (`team_collaboration`)**：实时在 Supabase 云端核对清洗目标域名，强行拦截内部业务员撞单内耗。
    - **团队看板与状态订阅**：支持下辖全员线索大盘合并统览与 Supabase Realtime 状态流双向联动。
### 2. 权限阻断守卫 (Fail-Closed)
- 主进程前置拦截：任何具备商业溢价的特权操作，在主进程 handler 响应前，必须强行通过 `registerSecureFeatureIpc` 或 `licenseGuard.requireFeature` 执行物理鉴权。
- Fail-Closed 默认阻断：鉴权未命中或 Trial 授权过期时，主进程必须返回显式的结构化错误负载（如 `FEATURE_DENIED` 或 `TRIAL_EXPIRED`），默认 Fail-Closed 强制拦截，绝对禁止在渲染端（Renderer）或预加载脚本（Preload）中编写任何形式的 Optimistic（乐观路由）绕过逻辑。

## 🌐 二、 AnySearch 决策人双轨穿透与多维数据源融合 (Data Source Integration)
### 1. 攻克三大核心短板
- 🧠 语义具象化：彻底打破传统“死关键词”及复杂的特定搜索语法，像素级致敬 Revor.ai 内部简洁的自然语言输入框，允许外贸用户直接输入纯自然语言进行多维深度检索。
- 🕵️ 穿透决策人 (Decision Makers)：数据挖掘直接从“公司主体”向下渗透至“组织架构关键高管”，高保密解密并抓取掌握采购权和财政大权的决策人（CEO、采购总监、Sourcing Manager、Founder）的真实姓名、具体职称、领英主页、直连联系电话及加密个人邮箱。
- 📦 多维数据富集：无缝打通 AnySearch 垂直 B2B 实体级接口，将传统的地图商户搜索与**海关进出口提单数据、全球头部展会参展名录、行业专属黄页数据库**进行大维度融合，彻底消灭本地数据稀疏与盲区。
### 2. 扩充宪法级“4级弹性搜索协议” (Scout Engine)
- **【第 0 级（AnySearch 特种穿透雷达）】**：优先调用 AnySearch 垂直 B2B 实体 API 解析自然语言输入，全网检索多源库，返回标准结构化的公司主体及决策人多渠道网络图谱。
- **【第 1 级（精准地理定位）】**：若 0 级因网络超时/429异常失效，自动无感降级使用 `location` 独立参数请求 Google Maps API 搜寻地图目标。
- **【第 2 级（参数容错降级）】**：若 1 级因地理边界限制返回 400，自动将地理参数拼入关键词 `q`，清空 `location` 执行重试。
- **【第 3 级（无感网页补位）】**：若地图彻底无数据，自动降级切换至 Google Organic 网页搜索引擎，抓取全网网页元数据归一化为线索骨架，触发轻量级“Snippet 盲评”打分容错（`fallbackStatus: 'social_blind_score'`）。
- **降级状态透明化体验规范**：主进程在各级降级流转时必须实时通过 `search:stage` 流式通道向渲染端推送当前执行进度。前端 `search-engine.tsx` 页面必须根据事件实时流式渲染文本提示：
  - 处于第 0 级时提示：`"🤖 AnySearch 正在通过全网海关数据、全球展会名录及社媒多渠道深度穿透高管决策人..."`
  - 降级至第 2 级时提示：`"地图定位受限，正在尝试扩大识别范围..."`
  - 降级至第 3 级盲评时提示：`"未发现地图商户，已自动为您补位全局网页线索，启用基于简介的轻量评估..."`
- **生命周期强制闭环**：任何搜索和穿透流，无论最终处于哪一级降级或因网络彻底中断失败，主进程**都必须以明确的 complete（`search:stream-complete`）或 error-close 信号收尾**，绝对禁止产生 silent termination（静默终止），彻底解锁渲染端的 UI Loading 挂起状态。

### 3. Omni-Search 大一统智能盲搜大坝规范

- **前端零渠道选择**：移除旧版"搜索数据源"渠道下拉选择器。用户仅输入自然语言关键词 + 国家/城市，系统在后台自动执行全渠道 Blind Search。后端内部仍保留 `DataSourceType` 7 个变体作为线索溯源标记，但不再暴露为 UI 手动选择项。
- **前置意图离散矩阵化**：通过 LLM 将自然语言解析为结构体 `{ country, countryOfficialLanguages: string[], pureEnglishProducts: string[], localizedProducts: { language: string; terms: string[] }[], b2bAttributes: string[] }`。`pureEnglishProducts` 是多值数组（如 `["Golf Cart Battery","car monitor"]`），禁止将多个产品词拼接为单串垃圾命令。LLM 不可达时走 `fallbackMutateB2BKeywords()` 兜底。
- **目标国官方语言搜索宪法**：只要自然语言或 `country` 字段限定了国家，LLM 必须补全该国主要官方语言，并生成本地语言产品词变体。例如 `Germany` 必须额外生成德语变体（如 `Golfwagen Batterie`、`Golfcart Akku`）并与英文变体并行搜索。英文变体始终保留为主干，本地语言变体作为增量扩面，不得替代英文主干。
- **离散产品词交叉相乘矩阵算法**：将 `pureEnglishProducts[]` 与 `localizedProducts[].terms[]` 合并为 `allSearchProducts[]`，再与 `B2B_ROLE_TERMS = ['dealer','distributor','importer','wholesaler','supplier','manufacturer']` 前 4 个角色逐一交叉相乘，生成独立的高阶布尔组合（如 `"Golf Cart Battery dealer Germany"`, `"Golfwagen Batterie Händler Deutschland"`, `"car monitor distributor Germany"` 等）。每组变体必须携带 `{ language, sourceProduct, b2bRole }` 元数据，经 `search:stage` 推送至前端展示为专业、简体中文的执行状态。
- **连续搜索时空隔离（JobID 钢印）**：每次搜索入口生成 `crypto.randomUUID()`，所有异步回调携带 myJobId 入参，回调入口检测 `myJobId !== currentActiveJobId` 则就地粉碎。新搜索覆写 `currentActiveJobId` 自动废弃旧回调。
- **海量并发吞吐与成本透明**：多语言搜索会使 SerpApi/AnySearch 调用量扩大至约 `2x`。这是被批准的高价值 B2B 扩面策略，但必须通过 `Promise.allSettled` 防止单语言/单变体失败导致全队列熔断。`MAX_SEARCH_CANDIDATES = 200` 仍为候选上限，进入 LLM 评分与官网富化的并发上限仍严格锁死为 `2`。
- **ICP 结构化评分算法**：`computeIcpMatchScore` 确定性地在 40/30/20/10 权重下对所有候选评分：
  - Domain 存在（官网域名）— 40%
  - 行业词匹配（产品关键词命中 snippet/company）— 30%
  - B2B 信号词命中（dealer/distributor 等角色词）— 20%
  - 联系人资产（email/phone 非空）— 10%
- **前端刚性截断与 Local Pagination**：后端返回 `candidates.slice(0, 50)` 给前端；前端 `SEARCH_PAGE_SIZE = 30` 循环分页（首页↔末页双向环绕）。
- **四级弹性搜索协议保留**：Omni-Search 作为第 0 级（AnySearch 特种穿透雷达）的升级形态，完整保留原有 4 级降级链路不变。

### 4. 多源数据融合与高价值线索过滤法

- **多源并行优先级**：同一轮搜索必须同时尝试 `google_maps`、`google_organic`、AnySearch 实体穿透，以及可用的 `linkedin_search`、`customs_shipment`、`trade_show`、`yellow_pages`、`facebook_search` Provider。缺失某个 Provider 或某个 Provider 失败时，只能降级为空结果，不得中断主搜索。
- **统一归一化**：所有 Provider 必须输出统一 `SearchExecuteResult`，并保留 `dataSourceType`。前端不得按 Provider 私有字段渲染，避免后续扩源造成 UI 分叉。
- **Gold Filter 最小闭环**：只有完成去重、相关度预筛、`computeIcpMatchScore`、可选 LLM 评分后的结果才允许进入高潜推荐区。`matchScore >= 60` 且具备 `email`、`phone`、`linkedinUrl` 任一触达资产时，才允许进入 Agent Pipeline。
- **多源增强不改变核心权重**：`customsData`、`exhibitionFootprints`、`decisionMakers` 属于高价值增强信号，可作为同分排序、前端徽标和 LLM 解释输入，但不得私自改变 `computeIcpMatchScore` 的 40/30/20/10 宪法权重，除非另行通过架构变更。

## ⚙️ 三、 核心数据字典与内存态资产扩展 (Data Architecture)
### 1. 权威通信契约层同步扩充 (`src/shared/ipc-contracts.ts`)
- 强制要求：所有 V1.3 实体及扩展属性必须在本文件建立唯一事实源，供主进程与渲染端 import。
- `DataSourceType` 契约定义（内部溯源标记，前端不再暴露为手动选择渠道）：
  - `export type DataSourceType = 'google_maps' | 'google_organic' | 'customs_shipment' | 'trade_show' | 'yellow_pages' | 'linkedin_search' | 'facebook_search'`
- `DecisionMaker` 结构体契约定义：
  - `name: string` (高管姓名)
  - `title: string` (高管详细职称，包含 Purchasing/CEO 等采购信号)
  - `email: string` (高保密直连电子邮箱)
  - `phone: string` (联系电话/Mobile直连号)
  - `linkedinUrl?: string` (领英主页)
  - `source: string` (决策人信息来源路径)
  - `confidenceScore: number` (AI 抽取可信度得分 0-100)
- `CustomsData` 结构体契约定义：
  - `annualImportVolume?: string` (年进口量级如 "450 TEU/Year")
  - `topSuppliers?: string[]` (核心供应商数组)
  - `originCountries?: string[]` (核心采购来源国)
  - `lastShipmentDate?: string` (最近一次海关报关报关提单日期)
- `AgentStatus` 结构体契约定义：
  - `whatsappSent: boolean` (是否触发过本地 Web WA 自动触达)
  - `whatsappStatus?: 'pending' | 'delivered' | 'replied' | 'failed'` (本地WA投递状态)
  - `linkedinContacted: boolean` (是否已完成经批准的 LinkedIn 触达动作；V1.3 只读 Profile 辅助阶段必须保持 `false`，不得因浏览 Profile 写成 `true`)
  - `emailSequenceStage: number` (本地发信长周期跟进所处轮次 0-3轮)
- 通讯接口增量绑定：
  - `SearchExecuteRequest` 追加 `dataSourceType?: DataSourceType` 与 `filterOptions?: Record<string, unknown>`。
  - `SearchExecuteResult` 挂载 `dataSourceType`, `exhibitionFootprints`, `customsData`, `decisionMakers`, `agentStatus` 全量增量属性。
### 2. 内存态线索池增量合并策略重构 (`src/store/leads-store.ts`)
- 引入深度增量去重追加（Upsert Append）算法，替代原有 `{ ...existing, ...lead }` 的粗暴覆盖逻辑。
- `decisionMakers` 合并机制：根据 `email` 或 `name + title` 的唯一组合进行遍历碰撞。若相同，则使用新数据的高置信度属性（`confidenceScore` 较高者）覆盖旧属性；若不存在，则作为新元素增量 push（追加）进数组。
- `exhibitionFootprints` 合并机制：执行并集去重处理：`Array.from(new Set([...existingFootprints, ...incomingFootprints]))`。
- 排序与状态归一稳定性：合并完成后，继续无条件锁死两项既有法典：
  - 排序法典：1. `addedDate` 降序；2. `matchScore` 降序，未评分项统一按 `-1` 兜底参与排序。
  - 归一法典：调用 `normalizeLeadStatus` 确保 `qualified` 等过渡态收敛为 `contacting`，未知值归一为 `new`。

## 🛡️ 四、 本地运行物理边界与性能控制红线 (Performance Guard)
### 1. 4G-8G 办公设备轻量计算高压线
- Hard 并发锁死上限：在主进程中，不管是 AnySearch 实体穿透、多维多渠道爬取、ICP 渐进式评分还是官网富化，**其在后台运行的最大并发 Job 数量强制且物理锁死为 `2`**。在代码层面必须严格通过 `runLimitedConcurrency(..., 2, ...)` 逻辑控制消费队列。任何试图调大并发上限以追求吞吐量的代码提交直接判定为严重架构违例。
- 文本去噪瘦身与 3000 字极限截断：AnySearch 或者是本地爬虫扒取到的官网 HTML，进入 LLM 前必须进行极限去噪瘦身（强力剔除所有的 Script 脚本、Style 样式、SVG 图片、导航栏垃圾、Cookie 隐私政策弹窗文本等）。在组装大模型 Prompt 前，**网站正文整体长度必须强制执行物理字符截断，最大不得超过 `3000` 个字符**。这从根本上控制了内存（RAM）和大模型 Token 的爆发式飙升。
### 2. 绝对的数据主权与上云裁剪隔离
- PDF 本地重计算生成：精美详细的客户调研全景白皮书 PDF 文档，**必须 100% 在用户本地机器上重计算完成**（利用主进程 `webContents.printToPDF` 在本地重计算完成）。直接写盘存入本机加密 AppData 路径。**严禁任何步骤将决策人的姓名、高保密邮箱、海关提单等敏感数据上传到第三方云端公有存储或服务器生成下载链接**，彻底捍卫外贸企业的私有客户资产金库。
- 上云 Payload 严苛裁剪 (Gold Filter)：高级版用户执行云端多轮 N8N 邮件营销时，线索上云前必须触发本地 Gold Filter 隐私过滤。系统强制剥离原始海量 HTML 网页文本，对其余字段执行严格的白名单裁剪和长度收缩（如域名、定制开发信正文硬截断）。只有 `email` 非空的合格黄金线索才放行单向交接，绝不允许 bulk-sync（批量同步）未经筛选的原始垃圾包上云。
### 3. Autopilot 伴随式后台巡航物理 Fact 边界
- 物理事实边界：本地 Autopilot 自动巡航纯粹依托用户本机的 Electron 进程资源、本地 Zustand 内存状态和本机当前网络环境。
- 开机运行红线：必须在产品白皮书和界面上清晰告知用户：**运行巡航期间，电脑设备必须保持开机、联网且系统不能进入休眠状态**。一旦设备关机或断网，Autopilot 本地队列将自动安全挂起。绝对禁止在宣传 copy 中将其伪装成“云端脱机机器人”，避免商业纠纷。

## 🤖 五、 智能获客模块后台数据交互汇总流 (Search-to-Agent Data Pipeline)
### 0. 数据管道总体架构图（宪法级契约）
智能获客模块的核心价值是：**搜索穿透产出线索 → 管道分发 → 智能体执行触达 → 结果写回线索状态**。整个管道由以下 4 层构成：

#### 0.1 数据源层 (Provider Plugin Layer)
- **Provider 抽象接口**：`SearchProvider` 定义标准契约 `{ execute(query): SearchExecuteResult[], name: string, id: DataSourceType, supportedLanguages(): string[] }`
- **Provider 注册表**：`provider-registry.ts` 集中管理所有已注册 Provider，支持运行时增删。
- **现有 Provider 清单**：SerpApi（`google_maps`/`google_organic`）、AnySearch（`anysearch`）、LinkedIn SerpApi（`linkedin_search` via `linkedin-search-provider.ts`，复用 SerpApi Key）——V1.3 已落地
- **待实现 Provider（P1 优先）**：
  - `customs_shipment`: 海关提单数据爬虫（3-5 天）
  - `facebook_search`: Facebook 站点限定搜索（1 天）
  - `trade_show`: 全球展会参展名录爬虫（2-3 天）
- **宪法约束**：每个 Provider 必须自包含、无状态、可独立测试。通过 `providerId` 字符串标识，配置来源于 `userConfig.providers` 数组。Provider 必须接收 `language`、`country`、`city`、`intentProducts` 与 `b2bAttributes` 参数，不得在 Provider 内重新臆造用户意图。

#### 0.2 搜索与评分层 (Search & Scoring Layer)
- `handleSearchExecute` 统一入口，触发 4 级弹性搜索协议 + Omni-Search 盲搜大坝
- `computeIcpMatchScore` 确定性评分（40/30/20/10 权重）在无 LLM 场景下提供初始排序
- `emitBasicResults` → `search:basic-results`：先出骨架列表（`matchScore: undefined`），解锁 UI Loading
- LLM 评分阶段 `computeLeadScore` 异步流式逐条推送 `search:lead-scored`
- `enrichLeadWebsite` 深探补全阶段：官网抓取、联系人提取、LLM 全景白皮书生成
- 最终产出 `SearchExecuteResult`：含 `decisionMakers[]`、`customsData`、`exhibitionFootprints[]`、`agentStatus`

#### 0.3 管道分发层 (Agent Pipeline Layer) — **待实现（V1.3 规划）**
- **`agent-pipeline.ts`** 新文件：监听搜索完成事件，自动将合格线索注入 Agent 队列。
- **触发时机**：`search:stream-complete` 事件后，由 `pipeline-orchestrator` 自动拾取已评分线索。
- **管道过滤**：只将 `matchScore >= 60` 且拥有可触达资产（`phone` 或 `email` 或 `linkedinUrl` 任一非空）的线索加入 Agent 队列。
- **队列模型**：`AgentTask { leadId, company, phone?, email?, linkedinUrl?, preferredAgent?, createdAt, priority }` 作为最小任务单元。
- **宪法约束**：Agent 管道必须在主进程常驻运行，不得依赖前端状态。管道执行不得阻塞搜索流程。

#### 0.4 智能体执行层 (Agent Execution Layer)
- 三个 Agent 独立执行任务队列中的任务，各自消费 `AgentTask` 中对应字段（WhatsApp 消费 `phone`、LinkedIn 消费 `linkedinUrl`、Email 消费 `email`）
- 执行完成后，Agent 调用 `writeBackAgentStatus(leadId, agentType, result)` 将执行结果写回对应 `LeadItem.agentStatus` 字段
- 详细 Agent 架构见第 **六** 节

### 0.5 ICP 结构化评分宪法级算法（computeIcpMatchScore 确定性评分）

此为 `search-service.ts` 中 `computeIcpMatchScore` 函数的宪法级算法定义，任何修改不得改变权重结构：

| 维度 | 权重 | 前置条件 | 评分逻辑 | 判分值 |
|---|---|---|---|---|
| **域名存在度** | 40 分（有官网）<br>10 分（无官网） | `extractDomainFromUrl(website)` 返回值非空 | 域名通过正则提取有效格式 ≤ 10 分降级 | 40 or 10 |
| **产品词命中** | 30 分 | `coreProductTerms[]` 与 `company + snippet + reason + matchReasons` 拼接文本任意一词命中 | 大小写不敏感的 `includes` 匹配，命中即满分 | 30 or 0 |
| **B2B 信号词** | 20 分（≥3 信号词）<br>10 分（≥1 信号词）<br>0 分（无信号） | `[wholesale, distribute, import, b2b, shop, dealer, supplier, manufacturer]` 在拼接文本中命中数量 | 非逐词独立计分，三级阶梯制 | 20 or 10 or 0 |
| **联系人资产** | 10 分 | `contact \|\| email \|\| phone \|\| decisionMakers[].email \|\| decisionMakers[].phone \|\| decisionMakers[].linkedinUrl` 任一非空 | 纯存在性检查，不验真 | 10 or 0 |
| **总分上限** | **100** | `Math.min(100, Math.max(0, score))` 硬截断 | 输出范围 `[0, 100]` | 纯 `number` |

**宪法约束**：
- 此算法在 LLM 评分执行前必运行，为初始排序与预筛漏斗服务
- 后续 LLM 评分可能覆盖 `matchScore`，但 `computeIcpMatchScore` 的分数始终保留作为回退基线
- 任何试图增加权重维度、改变权重比例或引入动态权重的修改须经架构委员会审批
- 此算法为确定性纯函数，不得包含网络请求、LLM 调用或随机数
- 多源增强字段（海关、展会、黄页、社媒、决策人）只能作为解释、同分排序和 LLM 输入，不得绕过此确定性预评分直接进入高潜推荐

### 0.6 DecisionMaker 数据流出权威路径

`DecisionMaker` 数据从搜索穿透到线索状态的完整路径：

1. **数据源采集**：AnySearch API `/v1/search/entity` 返回原始决策人数据
2. **标准化**：`normalizeAnySearchDecisionMaker(dm: any)` 映射为 `{ name, title, email, phone, linkedinUrl, source: 'AnySearch', confidenceScore }`
3. **关联**：`normalizeAnySearchResult()` 将 `decisionMakers[]` 附加到每个 `SearchExecuteResult`
4. **合并与去重**：`mergeLeadFacts()` 调用 `mergeDecisionMakers(existing, incoming)`：
   - 唯一键：`email` 优先，回退为 `name|title` 组合
   - 冲突策略：保留 `confidenceScore` 较高的条目
   - 增量追加：新决策人若无冲突则 push 入数组
5. **Schema 默认值**：`applySchemaDefaults()` 中 `decisionMakers: item.decisionMagers || []`
6. **流式输出**：通过 `emitBasicResults`（`search:basic-results`）和 `emitLeadScored`（`search:lead-scored`）推送至前端

**宪法约束**：
- 决策人数据属于高价值线索资产，必须在 Gold Filter 中保留（上云前不剥离）
- `confidenceScore` 为 AI 抽取可信度评分，前端必须在 UI 中以视觉方式呈现（如置信度进度条）

### 0.7 AgentStatus 写回宪法与双管道隔离模型

`SearchExecuteResult.agentStatus` 与 `AgentState`（内存态）是**两条独立数据管道**：

| 特征 | `agentStatus`（线索态） | `AgentState`（运行态） |
|---|---|---|
| 存储位置 | `SearchExecuteResult.agentStatus` + `LeadItem.agentStatus` | `Map<string, AgentState>` 内存 |
| 生命周期 | 持久化，跟随线索 | 应用重启后重置 |
| 写入者 | Agent Pipeline（未来）+ AnySearch 输入（现在） | `agent-service.ts` 模拟函数 |
| 推送方式 | 随 `emitBasicResults`/`emitLeadScored` 发送 | `AGENT.STATUS_CHANGED` IPC |
| 前端消费 | 线索表格/抽屉中的 Agent 触达状态徽标 | `/agents` 面板卡片进度条 |

**宪法约束**：
- Active Agent 执行完毕后必须同时更新两管道：写回 `agentStatus` 至线索状态、推送 `AgentState` 变更至运行面板
- `agentStatus` 默认值：`{ whatsappSent: false, linkedinContacted: false, emailSequenceStage: 0 }`
- `whatsappStatus` 枚举值：`'pending' | 'delivered' | 'replied' | 'failed'`

### 0.8 Provider 注册表宪法（V1.4 已落地）

> **各 Provider 的真实可用状态、对外宣传边界，以 `PROVIDER-CAPABILITY.md` 为唯一事实源（single source of truth）。** 本节仅定义接口契约与注册模型，不再自行声明各 Provider 的落地进度；进度以代码 + `PROVIDER-CAPABILITY.md` 为准。

`electron/services/provider-registry.ts` 已实现并集成至应用程序生命周期：

```typescript
interface SearchProvider {
  id: DataSourceType            // 唯一标识，如 'linkedin_search' | 'customs_shipment'
  name: string                  // 人类可读名称
  readonly requiredConfigKeys: string[]  // 所需配置键，如 ['googleKey']
  supportedLanguages(): string[]
  execute(query: ProviderQuery): Promise<ProviderExecuteResult>
  isAvailable(config?: ProviderConfig): boolean  // 密钥/配置检查
}

// V1.4 新增 — ProviderConfig 用于运行时可用性判断
type ProviderConfig = {
  googleKey?: string
  anysearchApiKey?: string
  anysearchBaseUrl?: string
}

type ProviderQuery = {
  keyword: string
  language: string              // 'en'、'de'、'fr' 等，来自 LLM 国家语言解析
  country?: string
  city?: string
  intentProducts: string[]
  b2bAttributes: string[]
  myJobId: string
  googleKey?: string            // 运行时注入
  anysearchApiKey?: string
  anysearchBaseUrl?: string
}

class ProviderRegistry {
  register(provider: SearchProvider): void
  get(id: DataSourceType): SearchProvider | undefined
  getAll(): SearchProvider[]
  getAvailableProviders(config?: ProviderConfig): SearchProvider[]
  getProviderStatusList(config?: ProviderConfig): Array<{ id; name; available; requiredConfig }>
  executeAll(query: ProviderQuery, ids?: DataSourceType[]): Promise<Map<DataSourceType, ProviderExecuteResult>>
  executeOne(id: DataSourceType, query: ProviderQuery): Promise<ProviderExecuteResult>
}
```

**宪法约束**：
- 每个 Provider 文件存放于 `electron/services/providers/` 目录，如 `linkedin-search-provider.ts`
- Provider 必须无状态：所有配置通过构造函数注入，运行时不可变
- `execute()` 实现必须包含 `myJobId` 时空隔离检查
- `isAvailable()` 检查密钥配置，未配置密钥的 Provider 不会参与 `executeAll()`
- Provider 搜索失败不得导致全链路熔断：使用 `Promise.allSettled` 聚合结果
- Provider 不得直接操作 Zustand、不得发送 IPC、不得保存线索；它只负责采集与归一化，保存和展示由上层 pipeline 统一控制
- Provider 状态可通过 `provider:list` / `provider:status` IPC 通道查询

## 🤖 六、 原生内置本地智能体多开矩阵 (Local Autopilot Agents)
### 0. 商业级权限与风险分层（V1.3 强约束）
- 侧边栏 `💎 Kone AI 自航拓客特权港` 分区必须按能力分层展示：Trial 仅展示升级引导；Paid Basic 可使用低量本地 Email 与 WhatsApp Web 能力；Paid Premium/Enterprise 解锁 WhatsApp Cloud API、LinkedIn Profile 只读辅助、账号多开与团队协作。
- 基础版/试用版不得看到任何虚假运行指标。若账号未配置或授权不足，Agent 卡片中央的"执行进度"必须硬编码清零为 `0/0`，状态标签显示 `未连接 / 待配置` 或 `升级解锁`。
- 高级版放行后，AI 销售团队卡片"执行进度"通过 `accountGetList()` 拉取真实绑定状态动态渲染。未配置渠道硬编码 `0/0`，状态标签显示 `未连接 / 待配置`。
### 1. AI 团队控制台原生路由面板 (`/agents`)
- WhatsApp 拓客猎手：Basic 路线使用 `whatsapp-web.js` + 本地扫码 + 本机住宅 IP + 低频发送（默认 3-5/day），session 断开时必须前端提示用户重新扫码；Premium 路线使用 WhatsApp Cloud API 官方通道。任何实现都不得宣称绝对免疫风控。
- LinkedIn 商务猎手：只允许读取用户授权的本地 Session Cookie 并执行 Profile 只读浏览、公开信息提取、AI 破冰文案生成。**严禁自动发送好友申请、严禁自动私信、严禁批量点击 Connect**。前端只能提供复制文案/人工确认入口，不能实现无人值守 LinkedIn 触达。
- 邮件长效跟随助理：通过本地封装的 `Nodemailer` + IMAP 模块，直连销售人员在设置中配置好的真实企业邮箱。后台异步运行多轮跟进触达序列：第一天发送首轮开发信；若 IMAP 状态检测到对方未回复，第三天自动补发追加信；第七天发送案例跟进。DNS 信誉检测不通过时必须软锁定发送。

### 1.1 社媒反封号与反爬现实边界（不得营销夸大）
- LinkedIn 属于高风控平台，Kone 仅交付 Profile 只读辅助与 AI 文案生成，不交付自动加好友/自动私信。任何后续实现若加入自动 Connect 或 Message，必须先更新本 PRD 并经人工批准。
- WhatsApp Web 自动化属于低量本地辅助能力，默认 3-5/day，必须加入随机间隔、失败停机、session 断线提示和人工扫码恢复。高频或稳定商业发送必须走 WhatsApp Cloud API。
- Email 是 V1.3 最稳定的本地真实执行通道，必须优先保证 SMTP 发信、IMAP 回复检测、DNS 健康检查和 `agentStatus.emailSequenceStage` 写回闭环。
- 所有 Agent 实现必须保留真实失败状态：登录失效、频率限制、验证码、账号异常、网络超时均须写入日志和前端状态，不得用 `setTimeout` 或假成功污染指标。
### 2. 发信人域名信誉检测防火墙 (mailX 级能力功能融合)
- 前置安全检阅：在本地 SMTP 发信序列启动前，系统在本地静默调用 DNS 解析引擎，对发信人企业邮箱的域名做一次深度的基础设施信誉检阅。
- 专业检测指标拦截：核驳域名的 MX 记录、SPF 发件人策略白名单 IP 覆盖率、DKIM 数字签名密钥有效性、DMARC 拦截策略强度，以及是否被全球主流反垃圾邮件黑名单库（如 Spamhaus）动态拉黑。
- 软锁定交互保护：若发现关键的 SPF/DKIM 配置缺失、或发信域名已进入拉黑高危期，前端发信控制台强制亮起红色高危阻断预警，**软锁定【执行群发】按钮**，阻止用户盲目群发，彻底针对性保护企业核心域名。
### 3. 本地独立进程 Session 沙箱隔离多开 (`/accounts`)
- 特权沙箱隔离：利用 Electron 核心的 `session.fromPartition('persist:account_id')` 物理隔离技术。
- 安全多开：外贸业务员可以在 Kone 客户端内同时安全登录 3 个不用的领英账号、5 个不同的 Facebook 账号及多个独立发信邮箱。每个账号在系统底层拥有完全独立的本地浏览器持久化沙箱实例（Cookie、LocalStorage、缓存彻底隔绝），配合本地住宅网络 IP，在官方防爬系统看来等同于完全独立的多台普通电脑在手动操作，安全系数拉满。

## 🛠️ 六、 OMO / CodeNomad 插件工程协作迭代与自查自检规范 (DoD SOP)
### 1. CodeNomad Flow 协同开发六步法
- 第一步【强制读链】：在动任何代码前，AI 代理与人类开发者必须按顺序 Proactive 读完 kone-PRD.md -> PROJECT-PRD.md -> ARCH-STANDARDS.md -> 规则法典 -> `.opencode/agents/` 目录下的 4 个核心 Agent 蓝图文档，跳过其中任意一环直接判定为系统级协议违例。
- 第二步【意图声明】：动工编辑前，必须在 OMO / CodeNomad 对话框内向总指挥提交简短的《变更意图声明》。声明中必须强行交代：目标修改的文件与具体函数、变动属于 Basic 本地特性还是 Premium 云端特性、本次变动对用户的 API 额度及试用防线是否有弱化风险。
- 第三步【契约骨架优先】：严禁直接修改复杂的底层业务代码。必须首先对类型事实源文件 `src/shared/ipc-contracts.ts` 里的通道名称、Request/Response 结构体、以及 Zustand Store (`src/store/leads-store.ts`) 里的数据字典进行增量定义。契约和底层骨架对齐并经编译通过后，方可推进具体业务 Handler 的实现。
- 第四步【流式首屏原则 (Scout -> Brain)】】：在编写任何搜索和穿透逻辑时，必须坚守渐进式更新体验。主进程抓到 AnySearch 候选后，必须立即执行 `emitBasicResults` 返回基础骨架列表平铺在前端（此时 `matchScore` 强行初始化为 `undefined`），瞬间解锁前端的整体挂起 Loading 状态。随后，多渠道决策人穿透、ICP 细分打分在后台以并发 `2` 的性能守卫逐条推进，完成后通过 `search:lead-scored` 通道流式异步推送到前端刷新局部卡片。
- 第五步【异常闭环桥接】：如果 AnySearch 接口或本地社盟深探遇到 429 额度枯竭、网络超时崩溃或反爬强力拦截等突发灾难，主进程内部的 catch 块必须优雅捕获异常，将其转化为结构化的友好报错返回，并且**必须强制向前端补发 `stream:complete` 信号解锁界面**。绝对禁止中途产生静默死锁，同时必须完好保留 `searchResults` 状态池里已抓取到的历史线索资产，严禁发生毁灭性清空重置。
- 第六步【本地持久化双向容错自查】：涉及激活码校验、试用期流转等商业防御代码修改后，开发人员必须在打包前执行手动验证：强行手动删除本地配置文件 `kone-config.json`，冷启动应用，去日志和控制台中严格检查系统能否通过注册表和系统隐藏目录双锚点完美核对并无感恢复真实的激活状态与倒计时。
### 2. 生产包发版分发防泄密红线 (Operational Guard)
- 前置物理粉碎清理：每次在准备执行正式分发打包命令 `npm run dist` 前，运维和研发人员必须在内网环境执行清理指令：`npm run clean`。该命令将彻底、物理、强力销毁项目中的旧编译残留、临时测试缓存目录：`.vite/`、`dist/`、`dist-electron/` 以及旧的 `release/` 文件夹，确保发版包绝无历史脏数据污染。
- 核心离线签名私钥绝对隔离：用于签发正式离线激活码的核心非对称签名私钥文件 `scripts/kone-offline-private.pem` 属于公司最高商业机密。**严禁提交至公共 Git 仓库、严禁随安装包外发分发、严禁通过任何 IM 聊天工具或邮件直接传输给任何外部客户**。`package.json` 必须通过硬编码把私钥文件排除在外。
- 自动化一键验收网关：正式发放分包交付前，必须在终端通过测试脚手架跑通全量合规审计脚本：`npm run test:security-audit`。必须确保输出的 `tests/security-audit-report.json` 报告中所有合规防御指标结果**全部判定为全绿通过 (APPROVE)**，方可正式发版。

### 3. V1.4 生产环境强化扩展示

以下 V1.4 扩展已在代码层面落地，需在相关文档中同步对齐：

- **HTTP 熔断器**（`electron/utils/http-client.ts`）：每个外部 API host 独立熔断状态，3 次连续失败后断开 60 秒，由 `proxy-service.ts` 消费。
- **Crash Reporter**（`electron/services/crash-reporter.ts`）：捕获 `uncaughtException`/`unhandledRejection`，本地 dump + source-map + 可选远程上报，`main.ts` 启动入口。
- **自动备份**（`electron/services/backup-service.ts`）：每日自动备份，MD5 校验 + 7 文件轮换 + 50MB 上限。
- **Auto-Update**（`electron/services/auto-updater.ts`）：基于 `electron-updater` 的 Windows/Mac 自动更新，`main.ts` 初始化。需在打包环境中安装 `electron-updater` 依赖。
- **搜索防抖**（`src/components/search-engine.tsx`）：Enter 键触发 300ms 防抖防止重复提交。
- **electron-bridge fallback 硬化**：Electron 33+ `app.getPath('userData')` 不可用时，写磁盘日志 + 弹窗 + 5s 后 `process.exit(1)`，不再静默存活。
