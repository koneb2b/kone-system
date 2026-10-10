# 智能获客组件深度自查与优化报告

## TL;DR
> **Summary**: 当前“查看分析”抽屉报错与“伴随式后台巡航 0/0 未响应”并非单点 UI 缺陷，而是由 **环境模式差异、IPC/错误语义不完整、主进程降级语义缺失、巡航状态契约过弱** 共同造成的业务链路断层。
> **Overall Severity**: High
> **Confidence**: Medium-High
> **Primary Fault Domains**:
> - AI 分析链路：主进程 `analysis:generate` 缺少可恢复降级语义，前端只能通过文本正则猜测错误类别。
> - 巡航链路：状态由 renderer store + runner 驱动，但缺少强契约化进度/不可用语义；dev shell 与真实 Electron 运行态行为差异会制造伪症状。
> - 环境模式：`src/main.tsx` 纯前端 dev shell 下，`analysis.generate` 返回 mock 成功，而 `autopilot.getState` 返回 `null`、`search.execute` 返回空结果，天然可能造成“分析看起来应可用但巡航显示 0/0”的错觉。
> **Decision Recommendation**: 优先完成“环境分诊 + 主进程语义分层 + 巡航状态契约化 + dev-only mock fallback 设计”，再进入实现。

## Scope Boundary
### In Scope
- 智能分析抽屉报错链路的前后端审计
- 分析 IPC 契约与主进程 handler 容错语义审计
- 本地开发环境无 LLM/API Key 时的 mock fallback 方案设计
- 伴随式后台巡航 0/0 / 未响应链路审计
- 巡航 store / runner / main-process state service 的状态语义审计
- 环境模式差异（纯 dev shell vs Electron dev vs packaged）的风险说明
- 优化方案、风险矩阵、实施建议、验证计划

### Out of Scope
- 直接改代码
- 搜索排序算法/并发策略重构
- 商业套餐/授权模型重构
- N8N / 团队协作 / Premium 远程链路改造
- 打包/构建流程重构
- 大范围 UI 重设计

## Environment Matrix
| Environment | 特征 | 分析行为 | 巡航行为 | 结论 |
|---|---|---|---|---|
| 纯前端 dev shell (`src/main.tsx` fallback) | `window.electronAPI` 缺失时注入 mock API | `analysis.generate` 直接返回 mock 成功 | `autopilot.getState -> null`，`search.execute -> []` | **高风险环境伪阳性来源** |
| Electron dev（真实主进程） | Vite + Electron 主进程真实 IPC | 走 `analysis:generate` -> `search-service.ts` | 走 Zustand + `autopilot-runner.ts` + `autopilot-state-service.ts` | **本次真实业务诊断应优先基于此环境** |
| Packaged desktop runtime | 打包后本地运行 | 与主进程一致，但更严格受配置/授权影响 | 同上 | **生产/交付态验证基线** |

## Evidence Confidence Matrix
| Finding | Confidence | Basis |
|---|---|---|
| 前端通用分析报错文案来自 `src/components/analysis-drawer.tsx` | Confirmed | 直接代码证据 |
| `analysis:generate` handler 位于 `electron/services/search-service.ts` | Confirmed | 直接代码证据 |
| 后端在分析链路最终 catch 中回退到“当前智能分析服务暂不可用” | Confirmed | 直接代码证据 |
| 前端对分析错误采用文本正则分类而非结构化错误码 | Confirmed | 直接代码证据 |
| 巡航 0/0 UI 来自 `search-engine.tsx` 中 runtime totals 渲染 | Confirmed | 直接代码证据 |
| 巡航 start 依赖 `addBatchJobs` 解析成功或已有 pending jobs | Confirmed | 直接代码证据 |
| `autopilot.getState` 在纯 dev shell 下恒为 `null` | Confirmed | 直接代码证据 |
| 纯 dev shell 可能制造巡航 0/0 伪症状 | Strong Inference | 代码路径 + 状态渲染逻辑 |
| 当前分析失败可能由缺失 LLM key/baseUrl/ICP 触发 | Confirmed | handler 调用 `getAnalysisConfigError(...)` 语义 + Oracle 审查 |
| 巡航未响应可能由 hydration/解析/runner 启动/配置致命错误任一导致 | Likely | renderer store + runner 代码综合推断 |
| 目前无法通过 explore 任务补全更多仓内调用图 | Caveated | 背景任务因 API key 失败 |

## Symptom Reproduction Context
### Observed Symptoms
1. 点击“查看分析”打开抽屉后，AI 挖掘与转化动作均报错：`当前智能分析服务暂不可用`。
2. 伴随式后台巡航显示 `0/0`，且整体未响应。

### Reproduction Context Classification
- **Confirmed from code**: 报错文案、前端 handler、IPC wrapper、主进程 handler、巡航渲染点、巡航状态 store/runner/state-service。
- **Likely runtime contributors**: 缺失 LLM key / baseUrl / ICP；巡航任务输入未成功转为 jobs；searchExecute 致命错误后 runner 进入 error/paused。
- **Environment artifact caveat**: 若运行于纯 dev shell，分析会 mock 成功而巡航状态为 `null`/0/0，这是环境伪差异，不应直接当作真实 Electron 主进程缺陷。

## Issue A — 智能分析抽屉报错：`当前智能分析服务暂不可用`

### A1. 真实调用链
#### Renderer path
- `src/components/analysis-drawer.tsx:16-23`
  - `formatErrorMessage(...)` 将错误按文本正则归类：授权 / 网络 / 配置 / 通用不可用。
- `src/components/analysis-drawer.tsx:224-242`
  - `handleGenerate()` 调用 `analysisGenerate({ lead, scenario })`。
- `src/components/analysis-drawer.tsx:326-344`
  - reply coach 也走 `analysisGenerate(...)`，只是 `scenario: 'reply_coach'`。
- `src/components/leads-management.tsx:455`
  - 另一处分析调用入口也使用 `analysisGenerate(...)`。

#### IPC wrapper path
- `src/lib/electron-api.ts:150-154`
  - `analysisGenerate()` 使用 `withTimeout(..., 60000)` + `unwrapIpc(...)`。
  - 任意 `{ success: false }` 都会抛 `ElectronApiError(response.error || 'AI 分析失败')`。

#### Main-process path
- `electron/ipc/channels.ts:43`
  - 通道名为 `analysis:generate`。
- `electron/services/search-service.ts:1672+`
  - `scenario` 允许：`direct_quote | competitor_switch | factory_strength | reply_coach`。
- `electron/services/search-service.ts:1737-1779`
  - 抓官网文本，拼接知识库与 ICP，向 LLM 发起请求。
- `electron/services/search-service.ts:1778-1805`
  - 统一 catch：
    - circuit breaker -> 特定提示
    - timeout -> `AI 数据流连接异常，请稍后重试`
    - 其他 -> `error?.message || '当前智能分析服务暂不可用，请稍后重试'`

### A2. 当前契约缺口
#### Problem 1 — 前后端错误语义不结构化
- 后端只返回字符串 `error`，前端只能在 `analysis-drawer.tsx:19-22` 用正则匹配：
  - `/403|401|授权|license|无权/`
  - `/network|timeout|fetch|socket|econn|enet|数据流/`
  - `/config|base url|key|配置/`
- 这意味着：
  - 同一类根因可能因措辞不同落入错误分类错误桶。
  - 文案变化本身就会改变前端行为。
  - 无法在 UI 中稳定区分“缺 key / 缺 baseUrl / 缺 ICP / provider 失败 / parse 失败 / dev mock 激活”。

**Severity**: High  
**Confidence**: Confirmed  
**Blast Radius**: `analysis-drawer.tsx`, `leads-management.tsx`, 所有 `analysisGenerate()` 调用方

#### Problem 2 — 主进程分析链路是 fail-hard，而不是 degraded-state aware
- Oracle 指出：搜索链路对无 LLM 已有较柔和降级；分析链路没有。
- `search-service.ts` 中分析 handler 一旦 `getAnalysisConfigError(...)` 或 LLM 请求失败，最终走统一 `success:false` 返回。
- 对本地 Basic/开发场景而言，缺失 LLM key 应被视为**可恢复降级状态**，而不是与 provider 崩溃、解析异常统一落成“暂不可用”。

**Severity**: High  
**Confidence**: Confirmed / Strong Inference  
**Blast Radius**: 所有深度分析入口

#### Problem 3 — 缺少开发环境 dev-only mock fallback 语义
- 纯 dev shell 中 `src/main.tsx:219-232` 已为 `analysis.generate` 提供 mock 成功路径。
- 但真实 Electron dev 主进程下，`analysis:generate` 并没有等价的 dev-only mock fallback。
- 结果是：
  - 前端 dev shell 与真实主进程 dev 行为不一致；
  - 本地无 key 时 UI 在一种环境可用，在另一种环境直接报错。

**Severity**: High  
**Confidence**: Confirmed  
**Blast Radius**: 本地开发者体验、调试稳定性

### A3. Payload / Type 契约检查
#### Frontend request shape
- `src/components/analysis-drawer.tsx:224-242`
  - `lead` 传入字段：`company, industry, country, website, address, phone, contact, contactTitle, snippet, matchReasons, riskFlags, inferredRole, source, salesStrategy`
- `reply_coach` 额外传入 `customerText`

#### Shared wrapper / contract layer
- `src/lib/electron-api.ts:150-154`
  - 使用 `AnalysisGenerateRequest` / `AnalysisGenerateData`
- 本轮直接搜索没有展开 `src/shared/ipc-contracts.ts` 的具体类型定义，但从调用链与 handler 使用看，字段名整体是一致的。
- **真正风险不在字段名明显错位，而在 response error semantics 太弱**。

**Conclusion**: 当前未发现“前端字段名与 handler 读取字段完全不对位”的直接证据；高优先级问题是**错误语义与降级语义**，不是明显的 payload 结构爆裂。

### A4. 根因分级
#### Confirmed Root Causes
1. 后端错误语义过于扁平，只返回字符串，前端只能用正则分类。  
2. 分析 handler 缺少缺 key / 缺配置场景的显式 degraded contract。  
3. dev shell 与真实 Electron dev 的分析 fallback 行为不一致。

#### Likely Contributors
1. 本地缺失 LLM key / baseUrl / ICP 配置。  
2. 官网抓取失败后没有清晰区分“可降级使用 snippet”与“真正服务不可用”。

#### Caveated / Needs Runtime Validation
1. `getAnalysisConfigError(...)` 的精确返回集合需要实现阶段核实。  
2. 不同 provider 失败是否都会稳定命中前端预期分类，需要运行验证。

### A5. 推荐优化方案
#### Minimal safe remediation
- 在 `analysis:generate` response 中引入结构化字段：
  - `errorCode`
  - `degraded`
  - `degradedReason`
  - `mockMode`
  - `source`
- 前端停止仅靠正则猜错误，改为优先消费结构化错误码。

#### Preferred long-term remediation
- 为主进程分析链路增加 dev-only mock fallback：
  - 激活条件：`!app.isPackaged` + 缺失 LLM key/baseUrl（必要时也包括 ICP 缺失）
  - 授权前置：正常跑 feature/license 校验，不能借 mock 越权
  - 作用域：仅 `analysis_advanced` 本地分析类功能，绝不扩展到 `cloud_send` / team / remote 路径
  - 返回数据：基于 `company / snippet / website / scenario / customerText` 生成逼真假分析数据
  - 明确打标：`mockMode: true`, `source: 'dev_mock'`, `usedFallback: true`
  - UI 提示：非红色致命态，而是“开发模式：未配置 AI 密钥，已使用本地模拟分析结果”

#### Regression watchpoints
- 不能让 dev mock 泄漏到 packaged runtime
- 不能把生产无 key 的正式行为静默伪装成成功
- 不能让 mock 输出看起来像真实 provider 结果却无标记

## Issue B — 伴随式后台巡航显示 0/0、未响应

### B1. 真实调用链
#### Renderer panel
- `src/components/search-engine.tsx:1288-1416`
  - 巡航 UI 在搜索页 Accordion 中渲染。
- `src/components/search-engine.tsx:1365`
  - 任务进度直接显示：`{autopilotCompletedOrFailed} / {autopilotRuntime.totalJobs}`。
- `src/components/search-engine.tsx:1382-1415`
  - 当前任务、发现/命中/已存、lastError 都来自 renderer store。

#### Renderer state sources
- `src/components/search-engine.tsx:401-410`
  - `useAutopilotStore` 读取 `draftText/jobs/runtime/hydrated` 与行为函数。
- `src/components/search-engine.tsx:688-692`
  - 若未 hydrated，则执行 `hydrateAutopilot()`。
- `src/components/search-engine.tsx:716-720`
  - 任何 lifecycle 变化都调用 `autopilotSyncLifecycle(...)` 同步到 main tray。
- `src/components/search-engine.tsx:1017-1048`
  - `handleStartAutopilot()`：
    1. 重写 draft
    2. `addBatchJobs(...)`
    3. 若没有 runnable jobs，toast 后 return
    4. `startAutopilot()`

#### Store layer
- `src/store/autopilot-store.ts:28-45`
  - `AutopilotRuntime` 定义：`totalJobs/completedJobs/failedJobs/totalDiscovered/totalQualified/totalSaved/totalDeduped/...`
- `src/store/autopilot-store.ts:89-101`
  - `defaultRuntime` 全部 totals 默认是 0。
- `src/store/autopilot-store.ts:174-184`
  - `recalculateRuntimeTotals(...)` 从 jobs 重算 totals。
- `src/store/autopilot-store.ts:265-302`
  - `hydrateFromStorage()` 读取 persisted state；失败时回退成空 runtime（仍然是 0 totals）。
- `src/store/autopilot-store.ts:334-368`
  - `start()` 在 `state.jobs.length === 0` 时直接 return。
- `src/store/autopilot-store.ts:311-331`
  - `addBatchJobs()` 若解析失败，可能返回空数组。

#### Runner layer
- `src/lib/autopilot-runner.ts:25-39`
  - `classifyError(...)` 将 `api key / missing config / 授权` 分类为 `fatal`。
- `src/lib/autopilot-runner.ts:296-360`
  - `runSingleJob()` 调 `searchExecute(...)`，再过滤、保存、冷却。
- `src/lib/autopilot-runner.ts:302-305`
  - 真正搜索调用只传 `keyword/country`。

#### Main-process state service
- `electron/services/autopilot-state-service.ts:17-31`
  - `readAutopilotState()` 读文件失败则直接返回 `null`。
- `electron/services/autopilot-state-service.ts:62-91`
  - 仅暴露 `GET_STATE / SET_STATE / CLEAR_LEGACY`。
- `electron/main.ts:173-180`
  - 主进程只处理 `AUTOPILOT.SYNC_STATE` 来更新 tray lifecycle，并没有更细粒度的 queue/progress IPC。

### B2. 当前契约缺口
#### Problem 1 — 0/0 是空 runtime totals 的可见症状，不是根因
- `defaultRuntime.totalJobs = 0`，且 hydrate 失败时也会回退到全 0。
- 因此 0/0 可能表示：
  1. 没有成功解析出任务；
  2. hydrate 失败或无 persisted state；
  3. 运行在纯 dev shell，`autopilot.getState -> null`；
  4. stopAndClear / reset 后的正常空状态；
  5. queue 尚未建立但 UI 未区分“空闲”与“不可用”。

**Severity**: High  
**Confidence**: Confirmed  
**Blast Radius**: 巡航面板整体 UX

#### Problem 2 — 巡航没有强契约化的进度/不可用语义
- 主进程只有 `AUTOPILOT.SYNC_STATE` 同步 lifecycle 给 tray。
- renderer 面板展示依赖本地 Zustand 计算值，而不是一个明确的“当前执行契约”。
- 所以“队列为空 / runner 未启动 / 读取失败 / dev shell null state / 已暂停无 currentJobId”都可能表现成相似的静态 UI。

**Severity**: High  
**Confidence**: Confirmed / Oracle corroborated  
**Blast Radius**: 巡航状态感知、排障能力

#### Problem 3 — start 链路对“无可运行任务”是静默退回式设计
- `src/store/autopilot-store.ts:334-338`
  - `start()` 如果 `jobs.length === 0` 直接 return。
- `src/components/search-engine.tsx:1021-1029`
  - `handleStartAutopilot()` 通过 `addBatchJobs(...)` 结果 + 现存 pending jobs 来决定是否 toast。
- 若输入解析失败、draft 未正确写入、hydrate 异常或 current store 状态和 UI 输入不同步，面板会保持 0/0，并让用户感知成“未响应”。

**Severity**: High  
**Confidence**: Confirmed  
**Blast Radius**: 启动体验、任务编排入口

#### Problem 4 — 巡航对 searchExecute / 配置致命错误极度敏感
- `autopilot-runner.ts:29-36` 把 `api key / missing config / 授权` 直接归为 `fatal`。
- 一旦搜索配置缺失，runner 会停止而不是给出温和的“配置未完成 / 无法启动本地巡航”语义。

**Severity**: High  
**Confidence**: Confirmed  
**Blast Radius**: 本地 Basic 静默获客主路径

#### Problem 5 — 纯 dev shell 本身就会制造 0/0
- `src/main.tsx:190-195`
  - `autopilot.getState()` 返回 `null`
- `src/main.tsx:205-210`
  - `search.execute()` 返回空结果
- 这意味着如果当前不是通过真实 Electron 主进程链路启动，而是落在 dev shell 上，巡航显示 0/0 是环境层必然现象，不应直接视作业务逻辑独立故障。

**Severity**: High  
**Confidence**: Confirmed  
**Blast Radius**: 本地调试误判、排障时间浪费

### B3. 巡航状态语义表（建议）
| State Source | 当前表现 | 应有显式语义 |
|---|---|---|
| `null` persisted state | 0/0 | `uninitialized` / `empty_queue` |
| `jobs=[]` + `idle` | 0/0 | `empty_queue` |
| `jobs>0` + `idle` | 可能仍像未动 | `ready_to_start` |
| `running` + current job | 部分可见 | `running` |
| `paused` + no currentJobId | 易像卡死 | `paused_waiting_resume` |
| `error` + lastError | 仅红字 | `error_blocking` |
| dev shell | 0/0 + 无真实 runner | `environment_mock_mode` |

### B4. 根因分级
#### Confirmed Root Causes / Structural Defects
1. 巡航 UI 没有把 0/0 显式区分成“空队列 / 初始化失败 / dev shell / 无 persisted state”。  
2. 主进程没有暴露强进度契约，renderer 只能依赖 store 计算值和 tray lifecycle。  
3. dev shell 的 autopilot mock 返回 `null`，会制造环境伪症状。

#### Likely Contributors
1. 批量任务输入没有被正确解析为 jobs。  
2. hydrate 失败后回退成空 runtime，但 UI 没有暴露“读取失败 / 空状态”差异。  
3. `searchExecute` 配置缺失导致 runner fatal stop。

#### Caveated / Needs Runtime Validation
1. 用户当前看到 0/0 时是否运行在真实 Electron dev，而非纯 Vite shell。  
2. 当前 draftText 在点击启动前是否已真正持久化/进入 store。  
3. 是否已有 jobs 但因 lifecycle/currentJobId 不一致被 UI 渲染为“暂无执行中的任务”。

### B5. 推荐优化方案
#### Minimal safe remediation
- 给巡航状态增加显式语义字段（至少 renderer 侧）：
  - `stateKind: 'empty_queue' | 'ready' | 'running' | 'paused' | 'error' | 'environment_mock' | 'unavailable'`
  - `statusReason`
  - `source: 'persisted' | 'runner' | 'dev_shell'`
- 在 `handleStartAutopilot()` 里把“未识别到任务”“runner 启动失败”“配置缺失”“环境未连接主进程”区别提示，而不是统一表现成 0/0。

#### Preferred long-term remediation
- 为巡航建立真正的进度契约（不一定要大量新 IPC，但至少要语义化）：
  - queue size
  - current job metadata
  - discovered / qualified / saved / deduped
  - lifecycle reason
  - unavailable/degraded reason
- 将 dev shell 下 autopilot 行为显式标记为 mock / unavailable，而不是简单 `null`。
- 若长期目标是最小化后持续稳定巡航，应考虑把更多调度语义上移到 main process，而不只同步 tray lifecycle。

#### Regression watchpoints
- 不要把 0/0 一刀切改成“有问题”，空队列本身是合法状态。
- 不要只改显示文案，必须补契约语义。
- 不要把本地巡航改造成 cloud/premium 风格的远程执行错觉。

## Shared Architectural Defects
### 1. 缺少 degraded-state contract
- 分析与巡航都存在“可恢复 / 可解释状态”被压扁成 generic error/null/0 的问题。
- 这违背了系统规范里“异常与降级必须透明闭环”的要求。

### 2. 前后端过度依赖文本猜错误
- 分析抽屉靠正则分类错误；巡航 UI 靠 totals 猜状态。
- 两者都缺少结构化语义桥接。

### 3. 环境模式未在 UI/业务层明确揭示
- 纯 dev shell 与真实 Electron dev 行为差异巨大，但用户层没有明确显示“当前不在真实主进程链路”。
- 这是导致误诊的关键系统性缺陷。

## Root Cause vs Contributor Table
| Symptom | Confirmed Root Cause | Likely Contributor | Environment Caveat | Needs Validation |
|---|---|---|---|---|
| 分析抽屉通用不可用 | 后端错误语义扁平 + 前端正则分类 | 缺 LLM key/baseUrl/ICP | dev shell 下分析其实会 mock 成功 | `getAnalysisConfigError` 精确分支 |
| 巡航 0/0 | runtime totals 默认值缺少状态语义 | 任务解析失败 / hydrate 失败 / fatal stop | dev shell autopilot state 恒为 null | 用户实际运行模式 |
| 巡航未响应 | renderer-local store/runner 契约太弱 | `searchExecute` 配置缺失后 fatal | dev shell 不存在真实 runner | runner 启动时真实错误日志 |

## Recommended Logging / Probe Points
### Analysis chain probes
- `[Probe-API] analysis.generate request`：scenario、lead 核心字段、是否 reply_coach
- `[Probe-Payload] analysis.generate config gate`：hasLlmKey、hasBaseUrl、hasIcpProfile、isDevMockCandidate
- `[Probe-API] analysis.generate provider response`：HTTP status、parse success、usedFallback/source
- `[Probe-API] analysis.generate failure`：errorCode、message、degraded/mock flags

### Autopilot probes
- `[Probe-Store] autopilot hydrate`：persisted exists / jobs count / runtime lifecycle / read error
- `[Probe-Store] autopilot addBatchJobs`：input line count / parsed jobs count / discarded lines count
- `[Probe-Store] autopilot start`：jobs length before start / pending count / generated runId
- `[Probe-API] autopilot searchExecute`：job id / keyword / country / error category
- `[Probe-Store] autopilot runtime recompute`：totalJobs/completed/failed/currentJobId/lifecycle/lastError
- `[Probe-Env] dev shell active`：whether `window.electronAPI` is mocked shell API

## Dev-Only Mock Fallback Design (LLM/API Key 缺失)
### Activation rule
- 仅在 **真实 Electron 主进程 dev**（`!app.isPackaged`）启用
- 仅在 **本地分析类功能** 缺少 LLM key/baseUrl/ICP 等配置时启用
- 先完成正常 feature/license/trial 校验，再决定是否 mock

### Scope rule
- 可用于：
  - `analysis:generate`
  - 本地 search scoring / 本地基础分析扩展（若后续需要）
- 不可用于：
  - `cloud_send`
  - `team_collaboration`
  - 任何 Premium 远程云能力

### Response rule
- 返回结构必须与正式 `AnalysisGenerateData` 对齐
- 必须带：
  - `mockMode: true`
  - `source: 'dev_mock'`
  - `usedFallback: true`
  - `degraded: true`
  - `degradedReason: 'missing_llm_key' | 'missing_llm_base_url' | 'missing_icp_profile'`
- 数据来源基于现有输入：`company / snippet / website / scenario / customerText`
- 内容要求“逼真但明确可识别”，避免误导成真实 provider 输出

### UX rule
- UI 不显示红色“服务不可用”，而显示温和 amber 提示：
  - `开发模式：未配置 AI 密钥，已使用本地模拟分析结果。`
- 仍允许用户继续查看 AI 挖掘结果与转化动作，避免抽屉整体崩溃

### Production guardrail
- packaged 下绝不激活 dev mock
- 生产无 key 仍应 fail-closed，但要返回结构化、可解释错误，而不是 generic unavailable

## Risk Classification
### Critical
1. 分析链路无结构化错误语义，导致前端无法稳定区分配置缺失与服务故障
2. 巡航状态缺少强契约，0/0 与未响应可由多种不同原因触发而无法区分
3. dev shell 行为与真实 Electron dev 差异过大，却没有显式环境提示

### Major
1. `analysis:generate` 缺少 dev-only mock fallback 设计
2. 巡航 start/queue/hydration 错误只在局部 toast 或 console 中存在，用户面板语义不足
3. 前端依赖文本正则而非错误码，维护脆弱

### Minor
1. 抽屉 fallback 文案还不够可操作
2. 巡航 panel 对空队列和异常状态的视觉分层不足

## Non-Goals / Must NOT Change
- 不更改授权模型和商业边界
- 不放宽 production 的 Fail-Closed 行为
- 不改搜索相关排序/并发/三级降级协议
- 不把本地巡航设计成云端托管任务
- 不在本报告阶段直接实施代码修复

## Recommended Remediation Sequence
### Phase 1 — 最小诊断闭环
1. 给分析与巡航加 probes
2. 明确当前运行环境是否为 dev shell / Electron dev / packaged
3. 确认分析失败的精确配置缺失类型
4. 确认巡航 0/0 是空队列、null state、还是 fatal stop

### Phase 2 — 契约修复设计
1. 分析 handler 增加结构化错误码与 degraded/mock 语义
2. 巡航状态增加 stateKind/statusReason/source 语义
3. 前端停止只靠文本/数字猜状态

### Phase 3 — 开发体验修复
1. 真实 Electron dev 下增加 main-process dev-only analysis mock fallback
2. dev shell 明示“当前未连接真实主进程，巡航不可用 / 分析为模拟”
3. 巡航 UI 对空队列/环境 mock/配置缺失做分层提示

### Phase 4 — 验证与防回归
1. 添加分析契约测试：missing key / mock active / packaged fail-closed
2. 添加巡航契约测试：null state / empty queue / parsed queue / fatal search config
3. 验证搜索链路不受破坏

## Verification Plan Design
### Expected happy-path contracts
- Analysis happy path: 有配置时返回真实结构化分析结果
- Analysis degraded path: dev 无 key 时返回结构化 mock 结果
- Autopilot happy path: 有 jobs 时 totals > 0，currentJob/lifecycle 随 runner 变化
- Autopilot degraded path: 空队列/null state/dev shell/fatal config 都有明确 stateKind + reason

### Expected failure/degraded contracts
- Missing LLM key in dev -> `success:true` or `success:false but degraded-structured`（实施阶段需定型），绝不只是 generic unavailable
- Missing LLM key in packaged -> 保持 fail-closed，但返回精确错误码
- Autopilot no queue -> 明示 empty queue，不用 0/0 让用户猜
- Autopilot unavailable in dev shell -> 明示 environment_mock / main-process unavailable

## Acceptance Criteria (for this report file)
- [x] 报告明确区分 Issue A（分析）与 Issue B（巡航）
- [x] 报告包含 Scope Boundary / Environment Matrix / Evidence Confidence Matrix / Shared Architectural Defects / Non-Goals
- [x] 报告对以下链路均给出至少一个直接文件证据：
  - `analysis-drawer.tsx`
  - `electron-api.ts`
  - `search-service.ts`
  - `search-engine.tsx`
  - `autopilot-store.ts`
  - `autopilot-runner.ts`
  - `autopilot-state-service.ts`
  - `src/main.tsx` dev shell caveat
- [x] 每个主要发现都标注 Confirmed / Likely / Caveated / Needs Validation
- [x] 每个优化建议都说明 severity / confidence / blast radius / regression watchpoint
- [x] 报告明确写出 explore 背景任务失败带来的证据边界

## Evidence Gaps from Failed Explore Tasks
- 两个并行 explore 任务因 API key 无效失败，未能提供额外调用图或更广泛仓内引用统计。
- 因此本报告基于：
  - 直接 grep / read / AST 结果
  - Oracle 架构复核
  - Metis 结构性缺口审查
- 未获得 explore 支持的结论已在正文中以 `Likely / Caveated / Needs Validation` 标注，未被伪装成完全确认根因。

## Decision Log
### What is known
- 通用分析不可用文案来自前端兜底，但主因链在主进程 handler 语义不足
- 巡航 0/0 直接来自空 runtime totals 的显示
- 纯 dev shell 会放大/制造巡航伪症状

### What is unknown
- 用户当前是否确实运行在真实 Electron dev
- `getAnalysisConfigError(...)` 当前所有精确返回分支
- 巡航当前实际停止在 hydrate / parse / start / runner / config 哪一层

### What to fix first
1. 环境分诊（dev shell vs Electron dev）
2. 分析结构化错误语义
3. 巡航状态语义
4. dev-only analysis mock fallback

### What can wait
- 更长期的 main-process orchestration 重构
- 更复杂的 provider adapter 抽象

## Success Criteria for the Next Implementation Plan
- 分析失败不再只显示 generic unavailable，而能区分配置缺失 / 网络 / provider / mock
- 本地 dev 无 key 时，分析抽屉可展示逼真假结果且清晰标注 dev mock
- 巡航 0/0 不再是模糊症状，空队列/不可用/未初始化/异常中断都能被区分
- 所有改动不影响 production Fail-Closed 与商业边界
