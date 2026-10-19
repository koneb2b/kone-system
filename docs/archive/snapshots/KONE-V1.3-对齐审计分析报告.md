# Kone V1.3 规范-功能-UI/UX-数据链路全面对齐审计报告

> 🗄️ **时点静态快照（非活规范）**：本报告为某次会话的静态分析结论（审计时 shell 不可用，未跑构建/测试）。**不得作为当前规范裁决依据**；权威以 `kone-PRD.md` 与代码现状为准。注意：报告内引用的 `PROJECT-PRD.md`/`kone-PRD.md` 行号已因后续文档治理编辑而位移，`file:line` 仅供追溯。其列出的 P0/P1（Email 配置链路、LinkedIn 断链、双管道读端、IPC 注册中心等）属**代码层待办**，与本次文档对齐无关，须在可执行环境另行复核。

> 审计对象：`C:\Users\Administrator\Kone-System`（Kone AI V1.3，Electron 33 + React 19 + Vite 7 + Tailwind 4 + Zustand 5）
> 审计方法：静态全量阅读（read/grep/glob）——8 份宪法文档、`electron/` 主进程、`src/` 渲染进程、`preload`、`tests/`、`scripts/`、CI 配置。
> 审计日期：本次会话；**环境约束披露**：本会话 shell 执行环境不可用（pwsh 全部返回 STATUS_DLL_INIT_FAILED），**无法运行 `npm run build` / `test:*` / `tsc` / `eslint`**，本报告所有结论均为**静态分析证据**，构建与测试绿灯需在可执行环境中复核。
> 审计范围护栏（AGENTS.md Scope Guard）：本任务仅审计与分析，**未修改** `electron/`、`src/` 任何业务代码。

---

## 0. 结论摘要

Kone V1.3 的**核心宪法（四级弹性搜索、JobID 时空隔离、Gold Filter 上云裁剪、3000 字截断、商业诚实性、人工闸门）在代码层面基本落地且质量较高**，与上一轮 `KONE-商用成熟度深度审计报告.md`（8.5/10）结论一致。

但本次深度对齐审计发现 **4 项 P0（严重契约违例/失效）**、**23 项 P1（重要偏差）**、**26 项 P2（文档与卫生）**（第二轮补充验证新增 N1-N9，并对首轮结论做了两处修正，见 §9），集中在五类问题：

1. **双管道写回宪法失效**：`agentStatus`（线索态管道 A）持久化后**无任何生产消费方**，UI 无触达徽标；且 `PROJECT-PRD §3.7.4` 声称的"通过 ipcMain 直接操作 Zustand 线索池"实现方式并不存在（P0-1）。
2. **IPC 注册中心形同虚设**：`ARCH-STANDARDS §3` 强制"全部 IPC 必须经 `registry.ts` 注册"，但生产代码全部绕过（P0-2）。
3. **Email Agent 全链路不可配置**：后端读 `user_config.accounts.email.smtp*`，前端无任何 UI/契约写入该字段（P0-3）。
4. **LinkedIn 管道数据断链**：`SearchExecuteResult` 无顶层 `linkedinUrl`，`buildAgentTaskQueue` 永远收不到 LinkedIn 任务（P0-4）。
5. **Agent 面板授权分层违例（替代首轮 P0-5，已修正）**：`PROJECT-PRD §1.4.2 L230` 与 AGENTS.md 明确"Paid Basic 可使用 Email 与低量 WhatsApp Web 本地能力"，但 `agents-panel.tsx` 把**所有非 Premium 用户**整体拦截；而 `Trial==Basic 能力集` 经复核为 `kone-PRD §一.1` 与 `PROJECT-PRD §1.4.1/§7.2` 的**一致设计**，不属于违例（详见 §9-N0 修正说明）。

以下按「规范文档 ↔ 功能模块 ↔ UI/UX ↔ 逻辑与数据链路」四个维度给出逐条证据。

---

## 1. 规范文档链自身一致性（文档 ↔ 文档）

宪法链：`kone-PRD.md`（全局权威）→ `PROJECT-PRD.md` → `ARCH-STANDARDS.md` → `.opencode/agents/ui-agent.md` → `ipc-agent.md` → `system-blueprint.md` → `build-agent.md` → `V1.2-商业版交付与运维手册.md`。

| # | 级别 | 问题 | 证据（file:line） |
|---|---|---|---|
| D1 | P2 | 文档链数量自相矛盾：一处称"8 documents"，一处称"7-document chain" | `AGENTS.md:12`（8 documents）vs `AGENTS.md:40`（7-document chain） |
| D2 | P2 | `kone-PRD.md` 出现两个 `## 六、` 章节（编号重复） | `kone-PRD.md:258`（六、本地智能体多开矩阵）vs `kone-PRD.md:281`（六、OMO/CodeNomad DoD） |
| D3 | P2 | 权威文档含明显笔误：`item.decisionMagers`（应为 `decisionMakers`） | `kone-PRD.md:178`；代码正确拼写见 `search-service.ts:900` |
| D4 | P1 | PROJECT-PRD 多处"待实现/待恢复"与代码现状矛盾：`agent-pipeline.ts`（已实现 97 行）、Provider 注册表（已实现 `provider-registry.ts`）、`file:export-pdf`（已实现 `export-service.ts` L137/L187 + `printToPDF` L268 + 前端 `exportPdfFile`） | `PROJECT-PRD.md:184`（"待恢复/待实现"）、`PROJECT-PRD.md:1526`（"待实现"）、`PROJECT-PRD.md:1612`（"待实现 V1.3"） |
| D5 | P1 | 上一轮审计报告 `§2.2` 声称 ICP 权重"产品相关 40+B2B 属性 30+官网契合 20+决策人 10"，与 `kone-PRD §0.5`（域名 40/产品 30/B2B 20/联系人 10）**以及代码（L729-747）三重矛盾** | `KONE-商用成熟度深度审计报告.md:§2.2` vs `kone-PRD.md:152-158` vs `search-service.ts:729-747` |
| D6 | P2 | `AGENTS.md` 声称的 `emitDecisionMakers` 函数在代码库中**不存在**（仅文档提及） | `AGENTS.md:124`、`PROJECT-PRD.md:880`、`KONE-商用成熟度深度审计报告.md:90`；全库 grep 无实现 |
| D7 | P2 | L3 降级文案权威版本冲突：`kone-PRD.md:43` 要求"…补位全局网页线索，启用基于简介的轻量评估…"，而 `ui-agent.md:129`、`PROJECT-PRD.md:51`、测试与代码均为短版"…补位全局网页线索…" | `kone-PRD.md:43` vs `src/hooks/use-search-engine.ts:247`、`search-service.ts:836`、`tests/business-logic/search-fallback.business.test.js:88` |
| D8 | P2 | 权威文档宣称 Agent 能力实现方式与代码不符：WhatsApp 文档写 `whatsapp-web.js`，实际为 **Puppeteer + DOM `data-testid` 选择器**（无 `whatsapp-web.js` 依赖，见 `package.json:73-80`） | `kone-PRD.md:264`、`AGENTS.md:88`、`ARCH-STANDARDS.md:195`、`system-blueprint.md:249` vs `electron/services/agents/whatsapp-agent.ts:59-60,142,152` |
| D9 | P2 | `PROVIDER-CAPABILITY.md` 自述"最后核对：见 git 记录"无具体版本；且 kone-PRD §0.1 仍将 customs/facebook/trade_show 列为"待实现" | `PROVIDER-CAPABILITY.md:7` vs `kone-PRD.md:122-125`；实现见 `providers/index.ts:5-9,14-21` |

---

## 2. 功能模块对齐（规范 ↔ 实现）

### 2.1 搜索与 ICP 评分模块

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| S1 | P0 | **`SEARCH_LLM_SCORE_LIMIT = 20` 无任何文档说明**：`SEARCH_TARGETED_LEAD_LIMIT = 50` 条结果中仅前 20 条进入 LLM 评分与官网富化，其余 30 条永远保持确定性预评分；且 `emitBasicResults` 将全部 50 条的 `matchScore` 强制置为 `undefined`，导致 UI 上 30 条永远显示"待评估"（`leads-table.tsx:39-40`），但后端 `computeIcpMatchScore` 其实已算好分数。**同一批线索 UI 与后端评分状态不一致** | `search-service.ts:97-100,145-150,2272-2273`；`leads-table.tsx:39-40,87,95` |
| S2 | P1 | 并发宪法只约束了 LLM 评分/富化（`SEARCH_LLM_CONCURRENCY=2`、`SEARCH_ENRICH_CONCURRENCY=2`），但**关键词变体搜索层是无界 `Promise.all`**：`allSearchKeywords`（英语 ≤4 + 本地语言 ≤4/语言）每个变体同时触发 AnySearch + SerpApi + 全部 Provider，远超出"最大并发 Job=2"红线语义 | `search-service.ts:2038`（`Promise.all(allSearchKeywords.map...)`）、`search-service.ts:2163`（`Promise.allSettled` 第二路）、`search-service.ts:1933-1944`；`kone-PRD.md:105` |
| S3 | P1 | ICP 联系人维度未按 PRD 读取 `decisionMakers[].email/phone/linkedinUrl`，仅 `contact/email/phone` | `search-service.ts:744` vs `kone-PRD.md:157`（PRD 明确含 `decisionMakers[].email/phone/linkedinUrl`） |
| S4 | P1 | `applySchemaDefaults` 序列化时**丢弃** `inferredRole`、`salesStrategy`、`country`、`city`、`status` 等字段：前端 `use-search-engine.ts:552-559` 期待 `scoredLead.inferredRole/salesStrategy` 非空，实际恒为 undefined；搜索卡 `search-result-card.tsx:175-184`、线索管理 `leads-management.tsx:765` 的"跟进建议/角色"永远空白 | `search-service.ts:873-904`（返回对象无上述字段）vs `src/shared/ipc-contracts.ts:201-230`（类型含） |
| S5 | P1 | `ProviderQuery` 的 `intentProducts/b2bAttributes` 在调用点**硬编码为空数组**，且全部 8 个 Provider 的 `execute()` 从不消费 `language/intentProducts/b2bAttributes`——违反"Provider 必须接收并保留意图参数"宪法；`getAvailableForLanguage` 无生产调用（死代码） | `search-service.ts:2074-2075`；`providers/*.ts` 全部无 language 引用；`provider-registry.ts:91-95` |
| S6 | P1 | Provider 执行并发无上限（`registry.executeAll` 使用 `Promise.allSettled` 并发全部 Provider，无并发池）；YellowPagesProvider 虽 `isAvailable=false` 不会被执行，但仍注册在册（文档说"已弃用"一致，但枚举/UI 仍可展示） | `provider-registry.ts:110-147`；`providers/index.ts:20`；`PROVIDER-CAPABILITY.md:41` |
| S7 | P2 | 每个搜索关键字变体重复触发 LLM 意图解构/评分上下文放大，无缓存；`allSearchKeywords` 构建与 `localizedKeywordsMap` 叠加存在重复去重缺失（`Set` 仅用于 intentKeywords） | `search-service.ts:1919-1944` |

### 2.2 双管道 Agent 模块（P0 重灾区）

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| A1 | P0 | **管道 A（线索态 `agentStatus`）写而不读**：`writeBackAgentStatus` 写入 `agentStatusStore` 并持久化到 `agent_status` 配置键，但 `getAgentStatus` 无生产消费者（仅测试引用）；渲染进程没有任何 IPC 通道读取持久化 `agentStatus`；`leads-table.tsx` / `search-result-card.tsx` 均无触达徽标渲染。**且 `PROJECT-PRD §3.7.4 L1601` 声称"agentStatus 写入通过 ipcMain 直接操作 store（Zustand 线索池）"——主进程无法操作 Zustand，实际实现写的是 config 键，文档描述不实** | `agent-service.ts:207-236`（getAgentStatus 生产零调用）、`agent-service.ts:94-99`（实际持久化为 config 键）；`PROJECT-PRD.md:1601`；`tests/e2e/agent-persistence.test.js:82`、`tests/e2e/agent-pipeline-integration.test.js:153,162`、`tests/e2e/gate-e2e.test.js:257`；`kone-PRD.md:185-200`（宪法要求前端消费"线索表格/抽屉中的 Agent 触达状态徽标"） |
| A2 | P0 | **Email Agent 无法通过产品 UI 配置**：`getAgentInstanceForType('email')` 读 `user_config.accounts.email.smtpHost/smtpPort/smtpUser/smtpPass/senderEmail`，但前端全库无任何写入 `user_config.accounts.email` 的代码（`UserConfig` 类型也不含该边界）；`accounts-management.tsx` 的 `accountConnect` 传 `credentials: {}` 空对象。结论：Email Agent 在生产 UI 中**永远初始化失败**（"Email SMTP not configured"） | `agent-service.ts:243-263`；`src/lib/user-config.ts:3-50`（无 accounts 字段）；`accounts-management.tsx:85-89`；`agent-service.ts:477-482` |
| A3 | P0 | **LinkedIn 管道数据断链**：`SearchExecuteResult`（`ipc-contracts.ts:201-230`）**没有顶层 `linkedinUrl` 字段**，`buildAgentTaskQueue` 读取 `lead.linkedinUrl` 恒为 undefined → `queue.linkedin` 永远为空 → LinkedIn Agent 永远收不到任务；`agent-service.ts` 的 `stagedTargets` 又按 `t.linkedinUrl` 传递，同样恒空 | `agent-pipeline.ts:41-75`（读 `lead.linkedinUrl`）；`ipc-contracts.ts:201-230`（无此字段，仅 `DecisionMaker.linkedinUrl` L330）；`search-service.ts:1757`（仅 DM 层有 linkedinUrl） |
| A4 | P1 | **日频上限可被重启绕过 + 无日期归零**：`dailyUsed` 仅存在于内存 `SalesAgentState`，`agent_status`/`agent_logs` 持久化**不含** `dailyUsed`；重启后归零（可绕过 3-5/日 WhatsApp 限制）；同时无跨天归零逻辑，长跑进程内 `dailyUsed` 只增不减，会**永久锁死**后续触达 | `agent-service.ts:69-118`（持久化仅 logs+statuses）、`agent-service.ts:690`（仅 Trial 重置）；`whatsapp-agent.ts:129,164` |
| A5 | P1 | **计数双写导致指标虚高**：`SalesAgentState` 以引用传入 Agent 实例，`completedCount/failedCount` 在 `agent-service.ts`（L384-391/L449-455/L512-522）与 Agent 内部（`whatsapp-agent.ts:165-166,182`、`email-agent.ts:174,180`、`linkedin-agent.ts:124,130`）**各加一次** → 成功/失败计数 ×2，进度条可能 >100% | `agent-service.ts:384-391` + `whatsapp-agent.ts:164-166`；同模式 email/linkedin |
| A6 | P1 | **Agent 实例内日志与 `agent:get-log` 通道隔离**：WhatsApp/LinkedIn/Email 实例内部 `addLog` 写入私有数组，`AGENT.GET_LOG` 只读全局 `agentLogs`，二者永不合并 → UI 日志抽屉缺失真实的 `message_sent/rate_limited/profile_read` 明细 | `whatsapp-agent.ts:40-47`（实例私有日志）、`agent-service.ts:793-804`（只读全局 map）；`agents-panel.tsx:471-473`（空态文案） |
| A7 | P1 | **Agent 面板授权分层与宪法冲突（首轮结论经第二轮验证升级为直接违例）**：`PROJECT-PRD §1.4.2 L230` 与 `AGENTS.md`、`system-blueprint.md:266-269` 明确"Trial 仅升级引导；**Paid Basic 可使用 Email 与低量 WhatsApp Web 本地能力**；LinkedIn 需显式启用"，但 `agents-panel.tsx:212-214` 对**所有非 Premium/Enterprise 用户**渲染整页升级墙，Paid Basic 被完全剥夺本地 Agent（过度拦截，商业转化受损）；且 `isTrialLicense = totalLimit === 3`（L211）用魔法数判断试用、位于 premium-only 分支内为死代码 | `agents-panel.tsx:209-214,261-265` vs `PROJECT-PRD.md:230`、`AGENTS.md`（本地 Autopilot 规范）、`system-blueprint.md:266-269`、`kone-PRD.md:264` |
| A8 | P1 | **管道隔离在人工确认后失效**：`withPipelineIsolation` 在 stage 完成后将 `currentPipelineRunId` 置 null；用户稍后点击"开始触达"（`AGENT.CONTROL start`）时 `consumeStagedTargets` 不携带 runId，`startAgent` 以无 runId 执行 → `isStaleTask` 恒 false，**陈旧任务防重保护实际未生效** | `agent-pipeline.ts:84-97`、`agent-service.ts:760-766,877-878,366-374` |
| A9 | P2 | Agent 面板头部"今日配额"把三 Agent 的 `dailyUsed` 求和却只取 `agents[0]` 的限额，指标语义错误 | `agents-panel.tsx:209-210` |

### 2.3 授权与许可模块

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| L1 | P2 | **Trial 与 Paid Basic 功能等价（设计内，非违例）**：`kone-PRD §一.1` 定义 Trial 为"`plan:'trial'` + `tier:'basic'` 的 7 天限时体验"，`PROJECT-PRD §1.4.1/§7.2` 亦明确"Trial 映射 Basic 别名"。主进程 `TRIAL_FEATURES` 含全套 basic features、`feature-gate.ts:119-121` 将 trial 并入 basic 别名——与权威文档一致，**非缺陷**。仅两点需关注：PDF 3 次为唯一硬卡点（export-service L8/L203-214）；`feature-gate DEFAULT_STATE`（12000ms/10 条）仅对**未授权**路径生效，与 Trial 实际 0ms/100 条存在落差，建议产品侧在文档中明示 | `license-service.ts:39-47`；`feature-gate.ts:118-125,173-177`；`kone-PRD.md:5-9`；`PROJECT-PRD.md:190-206,2050` |
| L2 | P1 | **Dev 全量放行过宽**：`shouldBypassFeatureGateInDev = () => !app.isPackaged`，`requireFeature` 在 dev 整体跳过（含云端/export 权限），`getDevMockClaims` 直接给 enterprise——打包前任何 dev 行为都不受授权约束 | `license-guard.ts:32-41,107-111` |
| L3 | P1 | `sandbox-service` 的账号连接仅 `hasFeature('search_basic')` 判定（email 单通道），且 `accounts` Map 为内存态**不持久化**——重启后账号全部消失，Agent 卡片回到"未连接/待配置"，puppeteer 会话目录却仍在，UI 状态与真实会话割裂 | `sandbox-service.ts:22,205-223`；`agents-panel.tsx:306-311` |
| L4 | P1 | `AUTOMATION.START_CAMPAIGN` 使用裸 `ipcMain.handle` + 手工 `requireFeature`（fail-open 风险：任何未来改动漏调即放行），与同文件 `VERIFY_EMAILS` 走 `registerSecureFeatureIpc` 不一致 | `automation-service.ts:302-327` vs `282-299`；`license-service.ts:523-546`（安全包装器） |

### 2.4 Provider 与云交接模块

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| P1 | P1 | Gold Filter 上云裁剪实际**未截断 HTML/正文**：`triggerN8nWorkflow` 仅对字段做 `slice`（公司 200、正文 2400 等），没有 PRD 要求的"剥离原始海量 HTML 网页文本"逻辑；`cloud-handoff` 测试与文档声称的过滤行为无法从主流程验证 | `automation-service.ts:164-231` vs `kone-PRD.md:109`；`tests/business-logic/cloud-handoff.business.test.js` |
| P2 | P2 | Provider 层无任何单测（`PROVIDER-CAPABILITY.md:47` 自认 P2 待办）；CI 也没有对应 job | `tests/` 41 个测试文件中无 provider 专项；`.github/workflows/ci.yml:12-94` |

---

## 3. UI/UX 交互对齐（规范 ↔ 界面）

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| U1 | P1 | **`confidenceScore` 宪法级 UI 要求未实现**：`kone-PRD.md:183` 明确"前端必须在 UI 中以视觉方式呈现（如置信度进度条）"；`lead-mappers.ts:56-57` 归一化、`leads-store.ts:179-184` 合并冲突，但全库无任何渲染 | `kone-PRD.md:183`；`lead-mappers.ts:56-57`；`leads-store.ts:179-184`；grep `confidenceScore` 无 JSX 渲染 |
| U2 | P1 | **`agentStatus` 已传至抽屉但从不显示**：`analysis-drawer.tsx:134` 组装 `leadMeta.agentStatus`，但后续渲染无触达状态徽标；与 `kone-PRD.md:195`（"线索表格/抽屉中的 Agent 触达状态徽标"）不符 | `analysis-drawer.tsx:131-134,490-533` |
| U3 | P1 | **降级文案/徽标颜色与宪法冲突**：`ui-agent.md:141` 规定海关 `emerald`、展会 `amber`、黄页 `purple`，`search-result-card.tsx:22-31` 实现为海关 `orange`、展会 `purple`、黄页 `amber`——**三处颜色对调**；且搜索卡头部（§5.4.3 要求的决策人/海关/展会徽标）仅 `dataSourceType` 徽章，无决策人/海关/展会徽标 | `search-result-card.tsx:22-31` vs `.opencode/agents/ui-agent.md:139-143` |
| U4 | P2 | 邮箱验证进度条使用 `Math.random()` 伪进度（与"严禁假数据"精神相悖，虽非业务数据） | `automation-workflow.tsx:93-95` |
| U5 | P2 | `leads-table.tsx:171` 导出 CSV 拼接 `${lead.matchScore}%`，未判空（undefined → `"undefined%"`） | `leads-table.tsx:171` vs `leads-table.tsx:39-40`（有判空组件） |
| U6 | P2 | 侧边栏将 `accounts`/`agents` 统一标 `premium: true`，但 dashboard 实际允许 basic/trial 进入 accounts——导航徽标与真实准入不一致 | `app-sidebar.tsx:43-44` vs `dashboard-page.tsx:176-179` |
| U7 | P2 | `agents-panel.tsx` 状态徽标颜色使用 `STATUS_META` 全映射，但 `error/rate_limited` 等状态与 Constitution 要求的"paused/error 显式区分"缺乏视觉层级验证（静态无法证明，列为待复核项） | `agents-panel.tsx:29-34` |

---

## 4. 逻辑与数据链路 / IPC 契约对齐

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| I1 | P0 | **`electron/ipc/registry.ts` 注册中心在生产中完全未启用**：`registerIpc` 仅被测试引用，全部 35 处 handler 注册点走裸 `ipcMain.handle` 或 `registerSecure*Ipc`；`ARCH-STANDARDS.md:47,61-66` 声称的"运行时白名单/合约校验/`dumpRegistry()`/`resetRegistry()`"全部落空（后两者函数**不存在**） | `ARCH-STANDARDS.md:38,47,61-66`；`electron/ipc/registry.ts:110-124`（仅 registry+registerIpc）；`tests/ipc-contracts-v2.test.ts`（唯一消费者）；`main.ts:75-89`（14 组 handler 全部直挂 ipcMain） |
| I2 | P1 | 主进程 `registerIpc` 即使被调用也**不会绑定 `ipcMain.handle`**（只存 Map），设计本身无法生效 | `electron/ipc/registry.ts:20-28,113-124` |
| I3 | P1 | **安全基线缺口**：`BrowserWindow` `sandbox: false`（虽 contextIsolation:true + nodeIntegration:false），且无 `setWindowOpenHandler` / `will-navigate` 拦截、`index.html` 无 CSP——渲染进程若被注入（如 puppeteer 外链）可任意开窗；`webRequest.onBeforeSendHeaders` 全局改写 UA 且无域名白名单 | `window-service.ts:24-29,44-47`；`index.html:1-4`（仅 charset meta）；`ARCH-STANDARDS.md` 未见 CSP 条款（规范空白） |
| I4 | P1 | **SMTP 密码明文入库**：Email Agent 从 `user_config` 明文读 `smtpPass`，未走 `secret-manager` 加密通道（对比 AnySearch/Google Key 均走 SECRET_KEYS） | `agent-service.ts:252-258` vs `config-service.ts:12-28,267-272` |
| I5 | P1 | 搜索回调里 `Promise.allSettled` 混用 `myJobId` 检查：L2106 合并三路结果时**未再次校验 job 一致性**（部分 provider 延迟返回仍会被合并）——时空隔离覆盖不完整 | `search-service.ts:2106-2110`（settled 后直接使用，无 myJobId 二次检查） |
| I6 | P2 | CI 无 lint/format/security-audit/前端构建 job；`test:unit` 的 glob（`tests/**/*.test.{js,ts}`）在 Windows cmd 下由 shell 展开，Node 20 的 `node --test` 不会自展开 glob——**存在静默零测试风险**，且 CI 无本地命令可比对 | `package.json:20`；`.github/workflows/ci.yml:12-94`（仅 unit/ipc/auth/build 四层） |
| I7 | P2 | `tests/packaged-smoke-report.json` 等产物与 `dist-electron/` 历史跟踪策略与 `.gitignore:4`（`dist-electron/`）冲突（AGENTS.md 允许但需明确策略） | `.gitignore:4` vs `AGENTS.md` Pre-Commit Hygiene |
| I8 | P2 | `.tmp-ipc-sweep-user-data/`、`.tmp-test-user-data/` 物理存在于仓库树（`.gitignore:6` 已忽略，但残留未清理） | 仓库根目录存在 `.tmp-ipc-sweep-user-data/.kone-anchor/anchor.bin`、`.tmp-ipc-sweep-user-data/autopilot_state.json`、`.tmp-test-user-data/kone-secrets.json` |

---

## 5. 合规确认（与宪法一致的正面结论）

以下条款经代码验证**真实落地**，应在优化中保持：

- ✅ 四级弹性搜索协议：`resolveSerpSearchPlan`（L1986-2037）+ AnySearch 盲搜（L2040-2048）+ Organic 补位（L2050-2110），`search-service.ts:836` 短版降级文案与 `ui-agent.md:129` 一致。
- ✅ JobID 时空隔离：`currentActiveJobId` L115/L1866，9 处 `myJobId !== currentActiveJobId` 守卫（L2039/2042/2060/2102/2113/2164/2186/2341/2413）。
- ✅ 双管道写入端：`writeBackAgentStatus` 同时写 `agentStatusStore`+持久化+`AGENT.STATUS_CHANGED`（`agent-service.ts:207-232`），缺的是**读端**（见 A1）。
- ✅ 3000 字截断：`MAX_WEBSITE_TEXT_FOR_LLM = 3000`（L113）+ `trimWebsiteTextForLlm`（L749-755）+ 去噪正则；测试 `html-truncate.business.test.js`。
- ✅ LLM 评分/富化并发锁死 2：`SEARCH_LLM_CONCURRENCY`/`SEARCH_ENRICH_CONCURRENCY = 2`（L106-107）+ `runLimitedConcurrency`（L2340/L2412）。
- ✅ LinkedIn 只读合规：`linkedin-agent.ts:85-142` 仅读 Profile，无 connect/DM；`linkedinContacted: false` 恒写（`agent-service.ts:452`）。
- ✅ Email 合规闸门：DNS 盾（MX/SPF/DKIM/DMARC/Spamhaus，`dns-service.ts:44-75`）+ 抑制名单（`email-agent.ts:144-148` + `email-suppression.ts`）+ 三轮跟进 3/4/7 天（`followup-scheduler.ts:22-27`）。
- ✅ Gold Filter 白名单字段与 `N8N_GOLD_FILTER_MIN_SCORE` 过滤（`automation-service.ts:231`）。
- ✅ 人工闸门：`stageAgentsFromPipeline` 只 stage 不发送，需 `AGENT.CONTROL 'start'` 显式确认（`agent-service.ts:698-757,867-878`）。
- ✅ 前端评分渲染纪律：`stats-cards.tsx:5-6`、`data-center.tsx:61,294` 均对 `matchScore` 判空；`leads-table.tsx:39-40` 待评估态存在。
- ✅ Provider 失败隔离：`registry.executeAll` 用 `Promise.allSettled`（`provider-registry.ts:128-146`）。

---

## 6. 与上一轮审计的衔接

> 🗑️ **归档说明**：`KONE-商用成熟度深度审计报告.md` 已于文档治理轮**清除归档**（内容含已知错误 §2.2 ICP 权重表述；其仍有效的勘误与遗留事项已并入本文 §8/§10 与《优化计划》P2-6），仓库中仅存重定向墓碑桩。下表为其遗留清单与本轮新增的对应关系（历史引用保留原文件名以便追溯）：

| 上轮条目 | 本轮状态 |
|---|---|
| P0-R1 提交 WIP | 本会话无法执行 git（shell 不可用），未验证；仓库树存在 `.tmp-*` 残留（I8） |
| P1-R2 自动更新源 `publish: null` | **重新评估为设计如此**：`auto-updater.ts:112-119` 明确"无 feed → 走离线（顾问/微信）渠道"，与 `V1.2-商业版交付与运维手册.md` 一致，非缺陷；建议仅补充文档显式声明 |
| P1-R3 Provider 契约测试 | 仍未补（P2-3） |
| P1-R4 WhatsApp 实验性标注 | 已保留（`agents-panel.tsx:328-337` 实验性 Badge）✅ |
| P2-R5 search-engine WIP diff | 本会话静态未见问题扩散，保留"需逐段审查" |
| P2-R6 `.tmp-*` 残留 | 仍存在（I8） |
| P2-R7 PROJECT-PRD PDF 口径 | **仍矛盾**（D4） |

---

## 7. 严重度汇总

> 级别按各表「级别」列统计；第二轮补充见 §9（N0 为修正说明，N1-N9 为新增证据）。

| 级别 | 数量 | 编号 |
|---|---|---|
| **P0** | 4 | A1（双管道读端缺失+文档描述不实）、A2（Email 不可配置）、A3（LinkedIn 断链）、I1（IPC 注册中心失效） |
| **P1** | 23 | S1-S5、A4-A8、L2/L3/L4、P1、I3/I4/I5、U1/U2/U3、D4/D5、**N1**（优先本土域名/只看高相关主进程未挂载） |
| **P2** | 26 | D1/D2/D3/D6/D7/D8/D9、S6/S7、A9、P2、U4/U5/U6/U7、I6/I7/I8、**L1**（降级：Trial==Basic 为设计内）、**N2-N9** |

> 首轮 P0-5（Trial 授权口径）经第二轮复核**撤销**：`Trial==Basic` 是 `kone-PRD §一.1` / `PROJECT-PRD §1.4.1/§7.2` 的一致设计；真正违例是前端 Agent 面板分层拦截（A7，P1）。

---

## 8. 第二轮深化验证（补充发现与结论修正）

第二轮补读了 `V1.2-to-V1.3-alignment.md`、`ipc-agent.md`（全文）、`build-agent.md`（全文）、`V1.2-商业版交付与运维手册.md`、`PROJECT-PRD.md` 缺口章节（§1.4/§3.7.4-3.7.6/§7）、`preload/index.ts`（全文）、`export-service.ts`（全文）、`proxy-service.ts`、`secret-manager.ts`、`autopilot-state-service.ts`、`main.ts` 尾段，并对首轮疑点做了代码级核实。

### 8.0 结论修正（N0）

| 项 | 首轮结论 | 第二轮核实 | 修正 |
|---|---|---|---|
| N0-1 | P0-5：Trial 与 Basic 功能无差异视为违例 | `kone-PRD.md:5-9` 明确定义 Trial = `plan:'trial'`+`tier:'basic'` 的 7 天体验；`PROJECT-PRD.md:190-206,2050` 同样声明"Trial 映射 Basic 别名"——**权威文档一致设计** | 撤销 P0-5，L1 降级 P2；真正问题收敛到前端 Agent 面板分层拦截（A7） |
| N0-2 | S1 疑点：四个质量控制开关是否透传主进程 | 逐一核实：`priorityWebsite`（优先官网）与 `b2bRoleOnly`（B2B 角色）已在 Scout 预筛消费（L2225-2228）；但 `localDomainOnly`/`highRelevanceOnly` **未挂载**（见 N1） | S1 结论不变；新增 N1 精确边界 |

### 8.1 新增发现

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| N1 | P1 | **`优先本土域名`（localDomainOnly）与 `只看高相关`（highRelevanceOnly）在 UI 可见但主进程未挂载真实过滤**：`filterOptions` 传入主进程（L1896-1897），但过滤路径（L2219-2235）只消费 `priorityWebsite`/`b2bRoleOnly`；前端只能靠 `use-search-engine.ts:369-373` 做**客户端二次过滤**，违反 `ui-agent.md:133-137`"若前端可见但后端未挂载逻辑，视为严重违例"；`COUNTRY_TLD_MAP`（L126）定义后**从未被使用**（死代码，疑似为本土域名过滤预留） | `search-service.ts:1895-1897,2219-2235`；`src/hooks/use-search-engine.ts:369-373`；`.opencode/agents/ui-agent.md:133-137` |
| N2 | P2 | `PROJECT-PRD §3.7.6` 的 `SearchProvider.execute` 契约返回 `SearchExecuteResult[]`，代码实际返回 `ProviderExecuteResult { results, error }`（provider-registry.ts:56-59）；`executeAll` 返回 `Map` 而非文档的数组——契约形状陈旧 | `PROJECT-PRD.md:1620,1639` vs `electron/services/provider-registry.ts:56-59,110-147` |
| N3 | P2 | `V1.2-to-V1.3-alignment.md` **整份过时**：L62-73 列为"⏳ 待实施"的 AnySearch handler、`localizedProducts`、Provider Registry 多源调度、`writeBackAgentStatus` 双管道、三 Agent 真实执行**均已实现**；L26 的 `DataSourceType` 列表缺 `anysearch` | `V1.2-to-V1.3-alignment.md:62-77` vs 代码（search-service.ts:1975/2038、agent-pipeline.ts、agents/*.ts） |
| N4 | P2 | `PROVIDER.STATUS` 通道有 handler（provider-service.ts:37-47）但 preload 未暴露绑定（preload/index.ts:181-183 仅 `getList`）——主进程死 handler | `electron/ipc/channels.ts:90-91` vs `preload/index.ts:181-183` |
| N5 | P2 | PDF 预览窗口 `previewWin` webPreferences 未设 `sandbox`（沿用主窗 `sandbox:false` 基线问题，见 I3） | `export-service.ts:259-264` |
| N6 | P2 | Trial PDF 计数落盘失败时**静默降级不阻断**（"本次不落盘，但不阻断导出主流程"）——极端磁盘保护环境下计数不递增可绕过 3 次上限 | `export-service.ts:26-32`（`setTrialPdfExportCount` 吞错） |
| N7 | P2 | `agent:get-log`/`agent:suppress-*` 等 handler 全部走裸 `ipcMain.handle`（agent-service.ts:778-838），未走 `registerSecureFeatureIpc`——本地低风险，但纳入"IPC 注册中心未落地"（I1）的迁移清单 | `agent-service.ts:778,793,808,816,831` |
| N8 | P2 | `V1.2-商业版交付与运维手册.md §8.3` 表述"Auto-Update：electron-updater 集成（Win/Mac 自动更新）"与 `publish:null` + 离线渠道实际行为并存，需补充一句"当前为离线（顾问/微信）渠道，`publish:null` 为有意配置" | `V1.2-商业版交付与运维手册.md:202` vs `electron/services/auto-updater.ts:112-119`、`package.json:71` |
| N9 | P2 | `main.ts` 启动序中 `migrateLegacySecretsFromConfig`/`clearLegacyAutopilotNode` 正常执行，但仓库树仍残留 `.tmp-*` 历史目录（与 I8 同类，非启动逻辑问题） | `main.ts:199-200`；仓库根 `.tmp-ipc-sweep-user-data/`、`.tmp-test-user-data/` |

### 8.2 第二轮验证确认（合规，无需改动）

- ✅ 四个质量控制开关契约完整：`SearchExecuteRequest.filterOptions` 四字段（ipc-contracts.ts:193-198）→ hook 透传（use-search-engine.ts:767-772）→ 主进程消费（其中两个已挂载，见 N1）。
- ✅ 汽车服务业噪声过滤已实现：`search-service.ts:108` 含 `auto repair/body shop/mechanic/tire/car wash/oil change/collision/tow/detailing/smog`，在 Scout 预筛消费（L2219-2235 `isTrashLead` + `computeScoutRelevance`），满足 `ipc-agent.md §4.6`。
- ✅ 盲评语义合规：`search-service.ts:1455` 输出"⚠️ 官网访问受限，基于简介轻量评估（官网无法访问）"，命中 `ui-agent.md:99` 许可文案；`matchReasons` 明示轻量判断（`ipc-agent.md §4.8`）。
- ✅ Proxy SSRF 防护完备：仅 https、禁止 URL 内嵌凭据、hostname 白名单（serpapi.com/api.openai.com/配置的 n8n webhook）、方法白名单、N8N 推送 Gold Filter 路由决策（proxy-service.ts:134-179）。
- ✅ 密钥体系：AnySearch/Google/LLM 均走 `safeStorage` 加密的 `secret-manager`（secret-manager.ts:39-65），SMTP 密码明文问题（I4）仍待修。
- ✅ `V1.2-商业版交付与运维手册.md §8` 的 LinkedIn Provider、熔断器、Crash Reporter、备份服务声明与代码一致。
- ✅ `ipc-agent.md §6` Autopilot 进度契约：`autopilot-state-service.ts` 持久化状态文件 + `sync-autopilot-state` 生命周期通道（main.ts:207-214）满足"持久化状态轮询"选项。

### 8.3 第二轮后的最终问题分布

| 类别 | P0 | P1 | P2 |
|---|---|---|---|
| 文档链一致性 | — | D4/D5 | D1/D2/D3/D6/D7/D8/D9、N2/N3/N8 |
| 功能模块（搜索/评分/Provider） | S1(评分截断一致性) | S2/S3/S4/S5、N1 | S6/S7、P2 |
| Agent 双管道 | A1/A2/A3 | A4/A5/A6/A7/A8 | A9、N7 |
| 授权与许可 | — | L2/L3/L4 | L1 |
| UI/UX | — | U1/U2/U3 | U4/U5/U6/U7 |
| IPC/安全/链路 | I1 | I3/I4/I5、P1 | I6/I7/I8、N4/N5/N6 |

---

## 9. 交付说明

- 本报告为**静态分析**结论；所有 `file:line` 证据可在仓库直接复核。
- 配套交付：《KONE-V1.3-优化计划.md》（P0/P1/P2 分级、负责人建议、验证方式、预计工作量）。
- 建议下一轮：在可执行 shell 环境运行 `npm run test:unit`、`npm run build`、`node ./scripts/security-audit.cjs` 复核本报告第 5 节结论与 I6 的 glob 风险。

## 10. 文档治理执行记录（第三轮 · 规范文档体系对齐）

用户指令："对项目所有规范文档内容进行全面深度严谨的对齐梳理汇总……该合并合并，该清除清除，该补充完善的要补强"。核心目的：消除商用歧义与执行隐患。执行结果（详见优化计划 P1-12 条目）：

### 10.1 本轮修正的实质性矛盾（会直接导致执行歧义的项）

| # | 文档 | 修正内容 | 隐患等级 |
|---|---|---|---|
| 1 | `PROJECT-PRD.md` §3.3.1.a / `AGENTS.md` | 时空隔离契约引用**三个代码中不存在的函数名**（`emitDecisionMakers`/`computeLeadScore`/`enrichLeadWebsite`），真实为 `emitLeadScored`/`enrichLeadWithDeepProbe`。已勘误并标注"严禁凭旧名臆造修复" | 🔴 极高——任何按文档找函数的维护者都会扑空并可能错误"补建"函数 |
| 2 | `kone-PRD.md` §0.3 | 管道分发层标"待实现（V1.3 规划）"，实际 `agent-pipeline.ts` 已落地。已改为已落地并对齐真实模块结构（含 P0-3 修复的 `decisionMakers[].linkedinUrl` 聚合） | 🔴 高——误导维护者重复建设 |
| 3 | `kone-PRD.md` §0.1 / `PROJECT-PRD.md` §3.7.5 | Provider 清单仍列"待实现爬虫"，与 `PROVIDER-CAPABILITY.md`（唯一事实源）冲突。已对齐：6 真实可用 + AnySearch 实验性 + yellow_pages 弃用；密钥表从 4 级收敛为 2 级（同一 SerpApi Key 全家桶） | 🟠 中高——商用宣传口径漂移 |
| 4 | `PROJECT-PRD.md` §3.7.2/3.7.3/3.7.4 | 管道 A 写回路径描述为直写 `LeadItem.agentStatus`（渲染端 Zustand），与 §3.7.4 宪法约束（主进程持久化 `agent_status` 键）自相矛盾。已统一为真实机制：`agentStatusStore` 持久化 + `agent:get-status` IPC 读端（P0-1）；`AgentTask` 类型补齐 `taskRunId`/`leadKey`/`website` 并标注 `leadId` 为占位 0 | 🟠 中高——双管道实现理解分裂 |
| 5 | `V1.2-商业版交付与运维手册.md` L202 | Auto-Update 表述"Win/Mac 自动更新"掩盖真相：默认 `publish: null` **无任何自动更新**，走离线顾问渠道；仅设 `KONE_UPDATE_FEED_URL` 后才启用。已补强并标注"严禁向客户宣称开箱即用自动更新" | 🔴 高——直接商用交付承诺失真 |
| 6 | `ARCH-STANDARDS.md` §registry | 文档要求"所有注册走 registry"但存量 handler 全部直挂 `ipcMain`。已补 `attach(ipcMain)` 职责说明 + P0-4 迁移状态注记，明确"目标态 vs 现状" | 🟡 中——避免误判迁移已完成 |

### 10.2 状态刷新类修正（消除"已完成 vs 待办"混乱）

- `V1.2-to-V1.3-alignment.md`：顶部横幅声称"Pending 均已落地"但表格仍标 ⏳ 待实施（自相矛盾）——表格已全量刷新为 ✅、`DataSourceType` 表格补 `anysearch`（8 值）；**刷新确认完毕后该台账已整体清除归档**，其唯一独有内容（`matchScore` 三态语义法典）已移植固化至 `kone-PRD.md §三`。
- `.opencode/agents/ipc-agent.md`：4 个 stage（`anysearch`/`localized_search`/`prefiltering`/`blind_scoring`）从"Recommended additions"改为已落地全集（对齐 `emitStage` 类型联合 9 值）。
- 手册运维注意 1/2：从"不要描述为已接入（除非补齐）"刷新为"已落地但严禁宣传官方数据库直连"（对齐事实源口径）。

### 10.3 经核对无需修改的项（外部前置更新已完成）

`kone-PRD.md` 降级文案/章节编号/`decisionMakers` 拼写、`whatsapp-web.js` 口径（5 处文档已统一为 Puppeteer DOM 方案）、商用成熟度报告 §2.2 ICP 权重勘误横幅、8 文档链统一——均已在外部更新中完成，本轮复核确认一致。

### 10.4 治理结论

- 文档链现与代码现状**无已知实质矛盾**；"待实现/规划中"字样仅存于 `ARCH-STANDARDS.md` registry 迁移注记（有意保留，因迁移确实未完成）与优化计划待办本身。
- 商用价值视角的三个关键"诚实性"承诺已在文档层闭环：Provider 能力宣传口径（事实源唯一）、Auto-Update 离线渠道真相、Agent 执行边界（LinkedIn 只读 / WhatsApp 实验性 / Email 合规前置）。
- 残余风险：文档-代码一致性目前靠人工维护，建议尽快落地 P2-8"文档链一致性护栏" CI 检查，防止下一轮迭代再度漂移。

### 10.5 归档清除记录（"该清除清除"执行结果）

**清除方式说明**：本会话 shell 持续损坏（`STATUS_DLL_INIT_FAILED`，多次复测），无法执行物理删除（`Remove-Item`）。故采用**内容清除 + 重定向墓碑桩**方式完成"清除"：文件正文已清空，仅保留指向继任文档的桩；物理删除命令已写入各桩内，待 shell 恢复或随下次提交 `git rm` 执行。

| 文件 | 处置 | 依据 |
|---|---|---|
| `V1.2-to-V1.3-alignment.md` | ✅ 内容清除（墓碑桩） | 纯历史台账，全部 Pending 已核实落地；唯一独有内容（matchScore 三态语义）已移植至 `kone-PRD.md §三` |
| `KONE-商用成熟度深度审计报告.md` | ✅ 内容清除（墓碑桩） | 已知含错快照（§2.2 ICP 权重）；有效遗留事项已并入本文 §6/§8 与《优化计划》P2-6 |
| `kone-.md` | ⛔ 保留（非垃圾） | 复核确认其为"外贸B2B 获客方法论北极星"文档（240 行，带规范定位横幅），被 `kone-PRD.md` 引用 7 处（§0.2/§0.5.1/§六.4）；仅文件名异常，建议后续 shell 恢复后 `git mv` 重命名为 `METHODOLOGY-NORTHSTAR.md` 并同步更新引用 |
| `.clinerules` | ⛔ 保留 | Cline 工具链配置（132 行宪法副本），属工具配置而非规范文档；若团队已全面切换 OpenCode 流，可另行评估归并 |

**清除后根目录文档终态（9 份活文件 + 2 个待物理删除的桩）**：`kone-PRD.md`（权威）、`PROJECT-PRD.md`、`ARCH-STANDARDS.md`、`AGENTS.md`、`V1.2-商业版交付与运维手册.md`、`PROVIDER-CAPABILITY.md`、`kone-.md`（方法论）、`KONE-V1.3-对齐审计分析报告.md`（现行审计）、`KONE-V1.3-优化计划.md`（现行计划）。
