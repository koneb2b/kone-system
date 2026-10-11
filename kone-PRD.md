# 📑 Kone AI (V1.3) 二次开发与 OMO/CodeNomad 高顺畅迭代规范法典

## 📌 零、 版本真相与文档权威 (Version Truth & Document Authority)

> 本节为文档链的顶层裁决锚点，用于消除历史版本标签混乱与规范漂移。任何 Agent 在读链后如遇冲突，一律以本节裁决。

### 0.1 版本真相 (Single Version State)
- **当前发布版本 = `1.3.0`**（以 `package.json` `version` 字段为唯一事实源）。
- 本仓库文档存在 V1.2 / V1.3 / V1.4 三代历史标签，统一含义如下，不得再产生歧义：
  - **V1.2**：已交付的商业闭环基线（授权防线、防白嫖、断网容错、本地重计算）。`ARCH-STANDARDS.md`、`PROJECT-PRD.md`、`V1.2-商业版交付与运维手册.md` 的 "V1.2" 表述均指此基线，**其规则在 V1.3 仍然生效**。
  - **V1.3**：当前主线（AnySearch 四级弹性搜索、决策人穿透、多源融合、本地智能体矩阵、DNS 防火墙、Search-to-Agent 管道）。
  - **V1.4**：已随 V1.3 主线一并落地的**增量生产强化**（Provider 注册表、HTTP 熔断器、Crash Reporter、自动备份、Auto-Update 骨架）。凡标注 "V1.4 已落地" 者，均为**当前代码中已存在**的能力，不是未来计划。
- 结论：**不存在"尚未发布的 V1.4"**；"V1.4" 仅是 V1.3 内部的增量强化批次标签。

### 0.2 文档权威链与单一事实源 (Authority & SSOT)
- **需求权威**：本文件 `kone-PRD.md` 是 V1.3 全局唯一权威需求主源头。
- **能力真相**：各 Provider 的真实可用状态以 `PROVIDER-CAPABILITY.md` 为唯一事实源。
- **契约真相**：IPC 通道/类型以 `src/shared/ipc-contracts.ts` + `electron/ipc/channels.ts` 为运行时事实源。
- **方法论参考**：`METHODOLOGY-NORTHSTAR.md` 是通用获客方法论北极星（愿景/SOP），**非实装规格**；凡其内容（评分模型、技术栈、算力选型）与本文件冲突，一律以本文件为准。
- **云端协同与投递真相**：`CLOUD-COLLABORATION-DELIVERY.md` 是审批后上云、云端二次门禁、团队防撞、投递、抑制、Webhook、回复、配额、熔断与租户隔离的领域唯一事实源。本文只定义产品定位、用户旅程和业务验收，不复制其字段级契约。
- **治理件真相（2026-09-22 新增）**：术语以 `GLOSSARY.md` 为准；状态机**层级映射**以 `STATE-MACHINES.md` 为准（各状态机语义仍归本文件与云端协同文档）；字段形状以代码 `src/shared/ipc-contracts.ts` 为准，人类可读索引见 `FIELD-DICTIONARY.md`；"实现变更 → 规范回写"时间线以 `CHANGELOG.md` 为准。四者均不得反向改写本文件 §零.3 的宪法常量。
- **时点快照（非活规范）**：`archive/KONE-V1.3-对齐审计分析报告.md`、`KONE-V1.3-优化计划.md`、`archive/KONE-V1.3-商用上线就绪度审计报告.md`、`KONE-V1.3-深度审计报告与优化执行计划.md` 为特定 commit 的治理/审计快照，仅供追溯，**不得作为当前规范裁决依据**。（历史上曾存在的两份文档——KONE-商用成熟度深度审计报告.md 与 V1.2-to-V1.3-alignment.md——已于文档治理轮清除：内容分别并入对齐审计报告 §6/§8/§10 与本文件 §三，两份墓碑桩文件已物理删除，不再作为可引用文档。另见 `archive/KONE-V1.3-商用就绪度终审报告-2026-09-24.md` 亦已归档。）
- **现行梳理报告（可作决策依据）**：`archive/KONE-V1.3-规范文档与架构数据交互深度梳理报告.md` 为 2026-09-22 的治理级审计结论，用于消解本文档体系内的冲突与歧义，**不改变本文件的权威地位**。

### 0.3 宪法常量单一源 (Constitutional Constants — 只此一份)
以下硬性常量**只在本节定义一次**；其余所有文档（ARCH-STANDARDS、.clinerules、agent 蓝图、PROJECT-PRD 等）如需引用，**只能指针引用本节，不得改写数值**。任何与本节数值不一致的表述均视为文档缺陷：

| 常量 | 权威值 | 语义 |
|---|---|---|
| 搜索评分/官网富化并发上限 | **`2`**（`SEARCH_LLM_CONCURRENCY` / `SEARCH_ENRICH_CONCURRENCY`，`runLimitedConcurrency(..., 2, ...)`） | 4G-8G 办公机性能红线，多语言扩面不得突破。**仅约束 LLM 评分与官网富化这两个域** |
| **搜索扇出**（关键词变体）并发上限 | **`3`**（`SEARCH_FANOUT_CONCURRENCY`，`mapLimitedConcurrency(..., 3, ...)`） | **与上一行是两个独立并发域**：评分/富化的 `2` 是算力红线；扇出是"同时打多少个上游搜索请求"，原先无界（英文变体 ≤4 + 各本地语言 ≤4/语言），多语言扩面时可能一次性十几个并发请求，触发限流或 socket 耗尽。设闸为 `3`，不得与 `2` 混读 |
| 送入 LLM 的官网正文截断 | **`3000` 字符**（`MAX_WEBSITE_TEXT_FOR_LLM`） | 去噪瘦身后硬截断 |
| ICP 确定性评分权重 | **域名 40 / 产品词 30 / B2B 信号 20 / 联系人 10**（满分 100） | `computeIcpMatchScore`，宪法权重不得增删维度 |
| 搜索韧性 | **四级弹性搜索协议**（第 0 级 AnySearch → 第 1 级 Maps → 第 2 级参数容错 → 第 3 级 Organic 补位） | 详见 §二.2 |
| 试用期时长 | **`7` 天**（`TRIAL_DURATION_DAYS = 7`） | Trial = `plan:'trial'` + `tier:'basic'` |
| 高潜线索进 Agent 管道阈值 | **`matchScore >= 60`** 且含 `email\|phone\|linkedinUrl` 任一 | 详见 §五 |
| LLM 评分 / 官网富化条数上限 | **`50`**（`SEARCH_LLM_SCORE_LIMIT = SEARCH_TARGETED_LEAD_LIMIT = 50`） | 全部展示线索均获 LLM 评分与富化；**并发上限仍为 2，条数上限不改变并发**（2026-09-22 裁定：早期审计快照中的 `20` 为过时值，以 `50` 为准） |
| 搜索候选池上限 | **`200`**（`MAX_SEARCH_CANDIDATES`） | Scout 归一化后候选池硬上限 |
| 单渠道抓取上限 | **`100`**（`SEARCH_CHANNEL_FETCH_LIMIT`） | 单个 Provider 单次最多抓取条数（对应 `search_basic` 的 `maxResults: 100`） |
| 前端截断与本地分页 | 后端 `candidates.slice(0, 50)`；前端 `SEARCH_PAGE_SIZE = 30` | 首页↔末页双向环绕分页 |
| LLM 评分超时 / 官网探测超时 | **`20s` / `15s`**（`SEARCH_LLM_TIMEOUT_MS` / `WEBSITE_PROBE_TIMEOUT_MS`） | 单请求超时上限 |
| **单次搜索关键词变体总数上限** | **`12`**（`SEARCH_VARIANT_LIMIT`） | **总量域**（与"扇出并发域 `3`"是两个不同维度，**不得混读**）。多语言扩面的**绝对上限**，防「变体 × Provider」乘数爆炸烧光用户额度。**2026-10-11 新增**：此前宪法只约束了**并发**（防打爆上游），未约束**总量**（防烧光用户额度），实测单次搜索派发 17 个变体 → SerpApi 53 次调用 → 免费额度 2 次搜索即耗尽。<br>**2026-10-11 校准**：初版定为 `8`，经产品判定**偏紧**（2 产品词 × 4 角色词即用满，本地语言变体全被砍，损害覆盖深度）→ 放宽至 `12`。**成本控制优先靠「产品词清洗」与缓存复用，不得以压低覆盖为代价。** |
| **参与变体生成的产品词上限** | **`2`**（`SEARCH_PRODUCT_TERM_LIMIT`） | `pureEnglishProducts[0..SEARCH_PRODUCT_TERM_LIMIT-1]`。2 产品词 × 4 角色词（`B2B_ROLE_TERMS[0..3]`）= 8，与上一行变体上限自洽。**2026-10-11 新增**：此前 `pureEnglishProducts[]` 无数量上限，而同段的 `keywords` 有 `slice(0,4)`，属实现不对称 |
| HTTP 熔断 | **连续 3 次失败 → 断开 60 秒** | 触发条件为**暂时性失败**（`429` 限流 / `5xx` / 网络异常）。**`400/401/403` 属确定性配置错误，须 fail-fast 且不计入开路**（防用户反复输错密钥后整体锁死服务地址）。<br>**2026-10-11 订正**：原文将 `429` 与 `400/401/403` 并列为"配置错误"**有误** —— `429` 是**上游限流**，属暂时性、可恢复，与"密钥错误"性质完全不同。若 `429` 不熔断，搜索会在限流下反复重试，**加剧**配额消耗。故 `429` **应计入熔断**（实现 `FAILURE_STATUSES = new Set([429])` 为准）。 |
| Agent 默认日频 | WhatsApp **3-5/day** · LinkedIn **≤30 profile view/day** · Email **20/day**（Basic） | 以 `userConfig.agentDailyLimits` 为准，代码不得硬编码（仅允许默认值兜底） |
| Trial 高价值 PDF 白皮书导出上限 | **`3` 次**（全局硬编码） | PLG 逼单卡点 |

---

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
    - **Cloudflare Workers 云端邮件自动化序列（目标态）**：将格式化报文加密交接至云端队列，执行脱机多轮营销。Phase 1 接入 Cloudflare Workers + Queue + Resend。
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
  - 降级至第 3 级盲评时提示：`"未发现地图商户，已自动为您补位全局网页线索..."`（**短版为权威文案**，与主进程 `search-service.ts` 及 `.opencode/agents/ui-agent.md` 一致；"基于简介的轻量评估" 属盲评 `matchReasons` 置信说明，写入线索理由而非 stage 文案）
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

- **多源并行优先级**：同一轮搜索必须同时尝试 `google_maps`、`google_organic`、AnySearch 实体穿透，以及可用的 `linkedin_search`、`customs_shipment`、`trade_show`、`facebook_search` Provider。缺失某个 Provider 或某个 Provider 失败时，只能降级为空结果，不得中断主搜索。（`yellow_pages` **已弃用**，`execute()` 返回 DEPRECATED 错误，黄页能力由 AnySearch 统一路由；真实可用状态一律以 `PROVIDER-CAPABILITY.md` 为唯一事实源。）
- **统一归一化**：所有 Provider 必须输出统一 `SearchExecuteResult`，并保留 `dataSourceType`。前端不得按 Provider 私有字段渲染，避免后续扩源造成 UI 分叉。
- **Gold Filter 最小闭环**：只有完成去重、相关度预筛、`computeIcpMatchScore`、可选 LLM 评分后的结果才允许进入高潜推荐区。`matchScore >= 60` 且具备 `email`、`phone`、`linkedinUrl` 任一触达资产时，才允许进入 Agent Pipeline。
- **多源增强不改变核心权重**：`customsData`、`exhibitionFootprints`、`decisionMakers` 属于高价值增强信号，可作为同分排序、前端徽标和 LLM 解释输入，但不得私自改变 `computeIcpMatchScore` 的 40/30/20/10 宪法权重，除非另行通过架构变更。

## ⚙️ 三、 核心数据字典与内存态资产扩展 (Data Architecture)
### 1. 权威通信契约层同步扩充 (`src/shared/ipc-contracts.ts`)
- 强制要求：所有 V1.3 实体及扩展属性必须在本文件建立唯一事实源，供主进程与渲染端 import。
- `DataSourceType` 契约定义（内部溯源标记，前端不再暴露为手动选择渠道）：
  - `export type DataSourceType = 'google_maps' | 'google_organic' | 'customs_shipment' | 'trade_show' | 'yellow_pages' | 'linkedin_search' | 'facebook_search' | 'anysearch'`（`anysearch` 为 AnySearch 独立溯源标记；`yellow_pages` 保留向后兼容但对应 Provider 已弃用——详见 `PROVIDER-CAPABILITY.md`）
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
- **`matchScore` 三态语义法典**（V1.2 不变红线，自历史台账移植固化）：`undefined` = 未评分（Scout 骨架态，严禁伪造成 0 分）；有效数字 = 已评分；`null` = 上游判定无效值。**任何映射层不得将 `undefined`/`null` 静默转换为 `0`**——0 分与未评分是两种完全不同的商业语义（前者是"评估过且极差"，后者是"尚未评估"），混淆即破坏高潜推荐漏斗的可信度。

## 🛡️ 四、 本地运行物理边界与性能控制红线 (Performance Guard)
### 1. 4G-8G 办公设备轻量计算高压线
- Hard 并发锁死上限：在主进程中，**ICP 渐进式评分**与**官网富化**两类重活，其在后台运行的最大并发 Job 数量强制且物理锁死为 `2`。在代码层面必须严格通过 `runLimitedConcurrency(..., 2, ...)` 逻辑控制消费队列。任何试图调大并发上限以追求吞吐量的代码提交直接判定为严重架构违例。
- **并发域划分（防误读）**：搜索**扇出**（关键词变体并行）为独立域，上限 `SEARCH_FANOUT_CONCURRENCY = 3`，权威值见 §零.3。两者服务不同阶段（扇出在采集、评分/富化在打分），**不得互相套用**——把扇出按 2 限制会拖慢采集，把评分按 3 放开则违反本条硬约束。
- 文本去噪瘦身与 3000 字极限截断：AnySearch 或者是本地爬虫扒取到的官网 HTML，进入 LLM 前必须进行极限去噪瘦身（强力剔除所有的 Script 脚本、Style 样式、SVG 图片、导航栏垃圾、Cookie 隐私政策弹窗文本等）。在组装大模型 Prompt 前，**网站正文整体长度必须强制执行物理字符截断，最大不得超过 `3000` 个字符**。这从根本上控制了内存（RAM）和大模型 Token 的爆发式飙升。
### 2. 绝对的数据主权与上云裁剪隔离
- PDF 本地重计算生成：精美详细的客户调研全景白皮书 PDF 文档，**必须 100% 在用户本地机器上重计算完成**（利用主进程 `webContents.printToPDF` 在本地重计算完成）。直接写盘存入本机加密 AppData 路径。**严禁任何步骤将决策人的姓名、高保密邮箱、海关提单等敏感数据上传到第三方云端公有存储或服务器生成下载链接**，彻底捍卫外贸企业的私有客户资产金库。
- 上云 Payload 严苛裁剪 (Gold Filter)：高级版用户执行云端多轮邮件营销时，线索上云前必须触发本地 Gold Filter 隐私过滤。系统强制剥离原始海量 HTML 网页文本，对其余字段执行严格的白名单裁剪和长度收缩（如域名、定制开发信正文硬截断）。只有 `email` 非空的合格黄金线索才放行单向交接，绝不允许 bulk-sync（批量同步）未经筛选的原始垃圾包上云。
### 3. Autopilot 伴随式后台巡航物理 Fact 边界
- 物理事实边界：本地 Autopilot 自动巡航纯粹依托用户本机的 Electron 进程资源、本地 Zustand 内存状态和本机当前网络环境。
- 开机运行红线：必须在产品白皮书和界面上清晰告知用户：**运行巡航期间，电脑设备必须保持开机、联网且系统不能进入休眠状态**。一旦设备关机或断网，Autopilot 本地队列将自动安全挂起。绝对禁止在宣传 copy 中将其伪装成“云端脱机机器人”，避免商业纠纷。

## 🤖 五、 智能获客模块后台数据交互汇总流 (Search-to-Agent Data Pipeline)
### 0. 数据管道总体架构图（宪法级契约）
智能获客模块的核心价值是：**搜索穿透产出线索 → 管道分发 → 智能体执行触达 → 结果写回线索状态**。整个管道由以下 4 层构成：

#### 0.1 数据源层 (Provider Plugin Layer)
- **Provider 抽象接口**：`SearchProvider` 定义标准契约 `{ execute(query): SearchExecuteResult[], name: string, id: DataSourceType, supportedLanguages(): string[] }`
- **Provider 注册表**：`provider-registry.ts` 集中管理所有已注册 Provider，支持运行时增删。
- **Provider 清单（以 `PROVIDER-CAPABILITY.md` 为唯一事实源）**：
  - **✅ 真实可用**：SerpApi Maps（`google_maps`）、SerpApi Organic（`google_organic`）、LinkedIn SerpApi（`linkedin_search`）、海关网页补位（`customs_shipment`，基于公开网页的近似检索，非官方提单库直连）、展会网页补位（`trade_show`，同前）、Facebook 限定检索（`facebook_search`）——均已接入 `myJobId` 时空隔离与 retry/timeout
  - **⚠️ 实验性**：AnySearch（`anysearch`）垂直 B2B 实体 API，依赖第三方稳定性
  - **⛔ 已弃用**：`yellow_pages`（`execute()` 返回 DEPRECATED 错误，黄页由 AnySearch 统一路由）
  - **宣传口径约束**：`customs_shipment`/`trade_show` 对外只能使用「基于公开网页的海关/展会线索补位」措辞，严禁宣称官方数据库直连
- **宪法约束**：每个 Provider 必须自包含、无状态、可独立测试。通过 `providerId` 字符串标识，配置来源于 `userConfig.providers` 数组。Provider 必须接收 `language`、`country`、`city`、`intentProducts` 与 `b2bAttributes` 参数，不得在 Provider 内重新臆造用户意图。

#### 0.2 搜索与评分层 (Search & Scoring Layer)
- `handleSearchExecute` 统一入口，触发 4 级弹性搜索协议 + Omni-Search 盲搜大坝
- `computeIcpMatchScore` 确定性评分（40/30/20/10 权重）在无 LLM 场景下提供初始排序
- `emitBasicResults` → `search:basic-results`：先出骨架列表（`matchScore: undefined`），解锁 UI Loading
- LLM 评分阶段 `emitLeadScored` 异步流式逐条推送 `search:lead-scored`
- `enrichLeadWithDeepProbe` 深探补全阶段：官网抓取、联系人提取、LLM 全景白皮书生成
  > 勘误（2026-09-22）：本行早期版本写作 `computeLeadScore` / `enrichLeadWebsite`，这两个函数名在 `search-service.ts` 中**不存在**。真实函数名为 `emitLeadScored`（`search-service.ts`）与 `enrichLeadWithDeepProbe`。以本行为准。
- 最终产出 `SearchExecuteResult`：含 `decisionMakers[]`、`customsData`、`exhibitionFootprints[]`、`agentStatus`

#### 0.3 管道分发层 (Agent Pipeline Layer) — **已落地（V1.3）**
- **`agent-pipeline.ts`**：核心模块 `buildAgentTaskQueue()` / `withPipelineIsolation()` / `isStaleTask()`；由 `search-service.ts` 在搜索流收尾处、以 `withPipelineIsolation(runId)` 包裹**直接同步调用**（`search-service.ts` 内联调用，**不是** `ipcMain.on('search:stream-complete')` 事件监听），将合格线索注入 Agent 队列（**先暂存供人工确认，绝不自动发送**）。
- **管道过滤**：只将 `matchScore >= 60` 且拥有可触达资产（`phone` / `email` / `linkedinUrl` / `decisionMakers[].linkedinUrl` 任一非空）的线索加入 Agent 队列。顶层无 `linkedinUrl` 时从 `decisionMakers[].linkedinUrl` 聚合回退（P0-3 修复）。
- **队列模型**：`AgentTask { id, taskRunId, leadId, leadKey, company, website, phone?, email?, linkedinUrl?, createdAt, priority }` 作为最小任务单元；`leadKey` 携带 `SearchExecuteResult.id` 稳定 UUID 供写回关联。
- **宪法约束**：Agent 管道在主进程常驻运行（`stageAgentsFromPipeline` 暂存 + `consumeStagedTargets` 消费），不依赖前端状态，不阻塞搜索流程。

#### 0.4 智能体执行层 (Agent Execution Layer)
- 三个 Agent 独立执行任务队列中的任务，各自消费 `AgentTask` 中对应字段（WhatsApp 消费 `phone`、LinkedIn 消费 `linkedinUrl`、Email 消费 `email`）
- 执行完成后，Agent 调用 `writeBackAgentStatus(leadKeyOrCompany, agentType, status)` 将执行结果写回：`agentStatusStore`（持久化，键为 `leadKey` 稳定 UUID，回退 `company`）+ `AGENT.STATUS_CHANGED` IPC 运行态双管道
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

### 0.5.1 双层机会分评分架构（吸收 `METHODOLOGY-NORTHSTAR.md` 机会分模型 · 分层增强）

> 经代码级复核，`METHODOLOGY-NORTHSTAR.md` 的机会分公式 `Eligibility Gate ×(ICP Fit 55% + Intent 35% + Evidence 10%) − Risk Penalty` **比当前实装更精细严谨**（尤其"采购意图 Why-Now"与"准入硬否决"两项，当前 `computeIcpMatchScore` 完全缺失）。它与 40/30/20/10 **不是冲突而是分层错配**：前者是需 LLM 语义判断的"机会分"，后者是纯函数"预筛分"。二者按下列**双层架构共存**，共同提升商用体验与转化质量。

**Stage 1 — 确定性预筛分（`[已落地]`，不变）**
- 即 §0.5 的 `computeIcpMatchScore` 40/30/20/10，纯函数、无 LLM、毫秒级。
- 职责：对 ≤200 候选做**免费初排 + 漏斗预筛**，为并发 2 的 LLM 预算做减负。**权重与纯函数性质受 §零.3 宪法保护，不得改动。**

**Stage 0.5 — Scout 准入硬门 Eligibility Gate（`[部分落地 2026-09]`，吸收自 METHODOLOGY-NORTHSTAR.md §二）**
- 已落地（`search-service.ts` `computeEligibilityVeto`，ARCH-STANDARDS §9.6）：在 `computeScoutRelevance` 软过滤之后执行**结构化 0/1 一票否决**，当前覆盖可从候选文本可靠判定的类目——B2C/Retail 零售终端、Repair 维修、Used 二手翻新、电商平台卖家（Amazon/eBay/AliExpress/Shopee 等）、纯博客/资讯站；命中即剔除，不进 ICP 评分与 Agent 管道（结构化探针记录 `准入硬否决:<类目>`）。同步修复产品词 `includes` 子串误伤（词边界正则）并纳入本地语言变体。
- 仍为 `[路线图]`：黑名单行业与被制裁国、CRM 保护期内重复企业——需候选文本之外的上下文数据，未落地前不得对外宣称。
- 价值：修复**假高分漏洞**——例如"有官网(40)+含产品词(30)+含 supplier(20)+有邮箱(10)=100 分"的电商卖家/维修点不再被误判为高潜。

**Stage 2 — LLM 机会分（`[部分落地 2026-09]`，吸收自 METHODOLOGY-NORTHSTAR.md §二）**
- 已落地：`buildUniversalIcpPrompt` 已升级为结构化机会分输出 `opportunityScore: { icpFit(0-55), intent(0-35, Why-Now 证据), evidence(0-10), riskPenalty(0-20), finalScore }`，`totalScore` 即重算后的 `finalScore`；`normalizeOpportunityScore` 纯函数钳制校验，非法/缺失输出 undefined（不臆造）。结构化分随 `SearchExecuteResult.opportunityScore` 透传至前端，线索表徽标 tooltip 展示分维度拆解。
- 仍为 `[路线图]`：Intent 的 Tier S/A/B 分级证据源扩展与商机卡装配范式。
- §0.5 宪法本就允许"后续 LLM 评分可覆盖 `matchScore`"；本层在该许可下运行：
  - **ICP Fit（55%）**：产品应用匹配 / 企业定位（分销·进口·EPC·OEM）/ 区域覆盖 / 采购承载力 / MOQ 对齐 / 触达可实现性。
  - **Intent 采购意图（35%）**：Tier S 购买邻近（RFQ·招标·在招采购总监·量产公告，权重最高）+ Tier A 产品信号（新产线·新认证·参展）+ Tier B 业务变化（高管变动·进新市场·研发扩招）。
  - **Evidence（10%）**：A/B/C/D 置信分级（见 §六.4），映射 `DecisionMaker.confidenceScore`。
  - **分级 Risk Penalty（0~20 扣分）**：仅公共邮箱(Gmail/Outlook)−10、仅通用前缀(info@/sales@)−5、未识别决策人−5、官网极简−5。

**分层宪法约束**
- Intent/Eligibility/ICP-Fit 子维度需语义判断，**只能置于 Stage 0.5 / Stage 2**，严禁塞进 Stage-1 纯函数（会破坏其确定性与零成本）。
- Stage 2 的 55/35/10 **不得改写 §零.3 的 40/30/20/10**——那是 Stage-1 独立常量；两套权重服务两个阶段，各自独立。
- 不得对外宣称已具备完整的 Tier S/A/B Intent 证据评分；落地须补回归测试并保持并发 2 / 3000 字红线。

### 0.6 DecisionMaker 数据流出权威路径

`DecisionMaker` 数据从搜索穿透到线索状态的完整路径：

1. **数据源采集**：AnySearch API `/v1/search/entity` 返回原始决策人数据
2. **标准化**：`normalizeAnySearchDecisionMaker(dm: any)` 映射为 `{ name, title, email, phone, linkedinUrl, source: 'AnySearch', confidenceScore }`
3. **关联**：`normalizeAnySearchResult()` 将 `decisionMakers[]` 附加到每个 `SearchExecuteResult`
4. **合并与去重**：`mergeLeadFacts()` 调用 `mergeDecisionMakers(existing, incoming)`：
   - 唯一键：`email` 优先，回退为 `name|title` 组合
   - 冲突策略：保留 `confidenceScore` 较高的条目
   - 增量追加：新决策人若无冲突则 push 入数组
5. **Schema 默认值**：`applySchemaDefaults()` 中 `decisionMakers: item.decisionMakers || []`
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

## 5.1 本地筛选到云端协同的一体化主链路（目标态）

> 本节是产品目标态裁决。审批、同步、投递、抑制、Webhook 和事件的字段级规则以 `CLOUD-COLLABORATION-DELIVERY.md` 为唯一事实源。新增能力未完成代码与验收前，必须标注为目标态，不得对外宣称已交付。

Kone 的完整业务闭环统一为：

`多源搜索与富化 -> Scout 准入 -> 确定性评分 -> LLM 机会分 -> 邮箱验证 -> 商机卡与草稿 -> pending_approval -> 人工批准 -> 最小化上云 -> 云端二次门禁 -> 队列/投递 -> Webhook/回复事件 -> 本地与团队状态回写`

产品规则：

1. 本地端负责商机发现、证据、评分、验证、草稿和人工决策；云端负责经批准后的协同、门禁、投递和审计。二者是一个系统，不是两套互相替代的发送方案。
2. `matchScore >= 60` 与可触达资产只表示“可进入候选/审批管道”，绝不等于允许自动发送。
3. 任何云端发送都必须具备有效审批记录和草稿版本；草稿变更后必须重新批准。
4. 云端必须重新检查身份、租户、Schema、幂等、撞单、抑制、审批、邮箱等级、域名健康、配额与熔断，客户端不得绕过。
5. 业务状态、投递状态和跟进状态必须分离；`delivered` 不等于 `replied`，回复后必须停止未来自动跟进。
6. 退订、投诉、永久硬退和人工抑制优先于重新导入、重新评分或重新批准。
7. 本地 Email Agent 的长期定位是草稿、验证、DNS 检查、审批辅助和受控跟进。任何真实发送路径都必须满足同一套审批、抑制、幂等、配额和审计规则；不得作为绕过云端控制面的平行批量通道。
8. 前端必须提供待审批队列、证据与风险、草稿版本、同步/投递状态、单线索事件时间线、团队冲突和回复接管入口。

### 5.1.1 权威状态语义

- 线索业务状态：`new -> scored -> pending_approval -> approved -> queued -> sent -> replied`；异常为 `rejected | suppressed | failed | archived`。
- 投递状态：`pending -> accepted -> sent -> delivered`；异常为 `bounced | complained | failed`。
- 跟进状态：`not_started -> pending_manual -> scheduled -> paused -> stopped -> completed`。

现有 `new | contacting | replied | archived` 属实现期简化状态；在迁移完成前不得隐式承载云端投递与跟进语义。迁移和兼容规则见 `CLOUD-COLLABORATION-DELIVERY.md`。

### 5.1.2 套餐边界

- Trial/Basic：本地搜索、评分、分析、商机卡、草稿、审批和授权范围内的低量本地辅助。
- Premium/Enterprise：云端队列、远端自动化、团队防撞、团队看板和跨端事件协同。
- `cloud_send` 只是使用云端能力的必要授权条件，不等于审批通过，不得单独作为发送许可。

---

## 🤖 六、 原生内置本地智能体多开矩阵 (Local Autopilot Agents)
### 0. 商业级权限与风险分层（V1.3 强约束）
- 侧边栏 `💎 Kone AI 自航拓客特权港` 分区必须按能力分层展示：Trial 仅展示升级引导；Paid Basic 可使用低量本地 Email 与 WhatsApp Web 能力；Paid Premium/Enterprise 解锁 WhatsApp Cloud API、LinkedIn Profile 只读辅助、账号多开与团队协作。
- 基础版/试用版不得看到任何虚假运行指标。若账号未配置或授权不足，Agent 卡片中央的"执行进度"必须硬编码清零为 `0/0`，状态标签显示 `未连接 / 待配置` 或 `升级解锁`。
- 高级版放行后，AI 销售团队卡片"执行进度"通过 `accountGetList()` 拉取真实绑定状态动态渲染。未配置渠道硬编码 `0/0`，状态标签显示 `未连接 / 待配置`。
### 1. AI 团队控制台原生路由面板 (`/agents`)
- WhatsApp 拓客猎手：Basic 路线使用 **Puppeteer + Web WhatsApp DOM 自动化（`data-testid` 选择器，标注为「实验性 · Beta」）** + 本地扫码 + 本机住宅 IP + 低频发送（默认 3-5/day），session 断开时必须前端提示用户重新扫码；Premium 路线使用 WhatsApp Cloud API 官方通道。任何实现都不得宣称绝对免疫风控，并必须诚实标注 DOM 方案对 WhatsApp 前端改版的脆弱性（非 `whatsapp-web.js` 协议层实现）。
- LinkedIn 商务猎手：只允许读取用户授权的本地 Session Cookie 并执行 Profile 只读浏览、公开信息提取、AI 破冰文案生成。**严禁自动发送好友申请、严禁自动私信、严禁批量点击 Connect**。前端只能提供复制文案/人工确认入口，不能实现无人值守 LinkedIn 触达。
- 邮件长效跟随助理：通过本地封装的 `Nodemailer` + IMAP 模块，直连销售人员在设置中配置好的真实企业邮箱。后台异步运行多轮跟进触达序列：第一天发送首轮开发信；若 IMAP 状态检测到对方未回复，第三天自动补发追加信；第七天发送案例跟进。DNS 信誉检测不通过时必须软锁定发送。
- **跟进序列 IMAP 依赖（`[已落地 2026-09]`，ARCH-STANDARDS §9.6）**：IMAP 未配置属回复检测盲区，跟进序列不得按时间盲推——计划标记 `pendingManual` 暂停，前端徽标提示"邮件需人工确认"；IMAP 配置恢复后自动续推。
- **冷邮件时区窗口与节律抖动（`[已落地 2026-09]`，ARCH-STANDARDS §9.6）**：已知国家按收件人当地时间 09:00-18:00 窗口投递（窗口外延迟不消耗日频、不计失败）；时区未知的国家不拦截（诚实降级）。轮次间隔叠加 ±20% 随机抖动，避免整点节律指纹。
- **邮件内容差异化链（`[已落地 2026-09]`，ARCH-STANDARDS §9.6）**：本地 EmailAgent 序列的内容来源优先级为 `task.aiEmail`（线索 AI 定制开发信，首封专用）→ `emailContentProvider`（LLM 实时生成 150 词定制信，20s 超时）→ 阶段模板兜底；每次发送记录 `email_content_source` 供审计。内容层任何失败降级模板、不阻断发送；抑制清单、DNS 软锁、日频门禁顺序不变。硬编码通用模板不再是自动化链路的常规内容来源。

### 1.1 社媒反封号与反爬现实边界（不得营销夸大）
- LinkedIn 属于高风控平台，Kone 仅交付 Profile 只读辅助与 AI 文案生成，不交付自动加好友/自动私信。任何后续实现若加入自动 Connect 或 Message，必须先更新本 PRD 并经人工批准。
- WhatsApp Web 自动化属于低量本地辅助能力，默认 3-5/day，必须加入随机间隔、失败停机、session 断线提示和人工扫码恢复。高频或稳定商业发送必须走 WhatsApp Cloud API。
- Email 是 V1.3 最稳定的本地真实执行通道，必须优先保证 SMTP 发信、IMAP 回复检测、DNS 健康检查和 `agentStatus.emailSequenceStage` 写回闭环。
- 所有 Agent 实现必须保留真实失败状态：登录失效、频率限制、验证码、账号异常、网络超时均须写入日志和前端状态，不得用 `setTimeout` 或假成功污染指标。
### 2. 发信人域名信誉检测防火墙 (mailX 级能力功能融合)
- 前置安全检阅：在本地 SMTP 发信序列启动前，系统在本地静默调用 DNS 解析引擎，对发信人企业邮箱的域名做一次深度的基础设施信誉检阅。
- 专业检测指标拦截：核驳域名的 MX 记录、SPF 发件人策略白名单 IP 覆盖率、DKIM 数字签名密钥有效性、DMARC 拦截策略强度，以及是否被全球主流反垃圾邮件黑名单库（如 Spamhaus）动态拉黑。DKIM selector 支持用户自定义（`user_config.dnsShield.dkimSelectors`，设置页"协同引擎"DNS 卡片可配，与默认列表合并探测防止有限列表误报；`[已落地 2026-09]`）。
- 软锁定交互保护：若发现关键的 SPF/DKIM 配置缺失、或发信域名已进入拉黑高危期，前端发信控制台强制亮起红色高危阻断预警，**软锁定【执行群发】按钮**，阻止用户盲目群发，彻底针对性保护企业核心域名。
### 3. 本地独立进程 Session 沙箱隔离多开 (`/accounts`)
- 特权沙箱隔离：利用 Electron 核心的 `session.fromPartition('persist:account_id')` 物理隔离技术。
  - 安全多开：外贸业务员可以在 Kone 客户端内同时安全登录 3 个不用的领英账号、5 个不同的 Facebook 账号及多个独立发信邮箱。每个账号在系统底层拥有完全独立的本地浏览器持久化沙箱实例（Cookie、LocalStorage、缓存彻底隔绝），配合本地住宅网络 IP，在官方防爬系统看来等同于完全独立的多台普通电脑在手动操作，安全系数拉满。

### 4. 触达方法论增强基线（源自 `METHODOLOGY-NORTHSTAR.md` · 增量目标）

> 以下为吸收自方法论北极星 `METHODOLOGY-NORTHSTAR.md` 的**触达与送达率工程基线**。标注 `[已落地]` 者为当前代码已具备；标注 `[路线图]` 者为目标态增量，实现前不得对外宣称已完成，也不得改写 §零.3 的宪法常量。评分侧的机会分增强（Eligibility Gate / Intent 采购意图 / 分级 Risk Penalty）见 §0.5.1；本节聚焦触达执行节律与交付物。

- **14 天全渠道协同触达节律**（`[部分落地 2026-09]`，扩展现有 Email 3 轮 3/4/7 天序列）：邮件阶段推进日志已附带节律指引（`describeCadence`：Day0 邮件 → Day3-5 LinkedIn 人工交流 → Day7-10 FU1 → Day12-14 FU2）；**统一编排器**（商机卡 Day0 装配、LinkedIn 人工触点 UI、跨渠道队列调度）依赖产品面尚未存在的前端装配范式，保留 `[路线图]`。所有自动化动作须遵守目标客户时区 09:00-18:00 与随机节律抖动（均已落地，见 §三 Agent 边界）。
- **冷邮件域名矩阵与送达率红线**（`[路线图]`，强化现有 DNS 盾）：使用 2-3 个专用冷发辅助域名（严禁主品牌域名冷触达）；DKIM 2048 位签名 + SPF + DMARC + PTR/TLS 1.3；专业预热池 14-21 天；投诉率强制 < `0.1%`，达 `0.3%` 触发熔断停发。
- **邮箱有效性五级分级**（`[部分落地 2026-09]`，强化抑制清单）：五级引擎已在 `electron/utils/email-verification.ts` 落地并接入 `automation:verify-emails`（ARCH-STANDARDS §9.6）——RFC 深度格式校验、disposable 一次性域名 → `Risky`、role-account（info@/sales@）→ `Risky`、catch-all 域名诱饵探测 → `Catch_all`、灰名单（421/450）退避重试一次后仍 4xx → `Probable`、SMTP 无定论 → `Probable`（不假 Verified）。`valid` 映射：Verified/Probable/Catch_all 通过，Risky/Invalid 拦截。仍为 `[路线图]`：Verified 优先主队列 / Catch_all 限频靠内容 / Risky 降权加 Risk Penalty / Invalid 自动进抑制清单的差异化队列编排。
- **证据质量 A/B/C/D 置信分级**（`[路线图]`，映射 `DecisionMaker.confidenceScore` 的 UI 呈现）：A 官网原文/官方稿（100%）· B 权威第三方/协会名录（80%）· C 搜索聚合/社媒（50%）· D LLM 推论（20%，须显式标注 Hypothesis）。
- **商机智能卡标准结构**（`[已落地]` 字段 + `[路线图]` 装配范式）：企业画像与综合评级、Why Now 时机证据、Strategic Gap 战略缺口、推荐适配型号、150 词内定制开发信（Hook + Bridge + Value + Soft CTA）。

---

## 🛠️ 七、 OMO / CodeNomad 插件工程协作迭代与自查自检规范 (DoD SOP)
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
