# Kone V1.4 Multi-Agent Anti-Regression Protocol

This repository uses Oh My OpenCode Flow Engineering as a mandatory working model for non-trivial changes.

## Scope Guard

- 变更须限定在任务声明的范围内，不得以工作流/配置任务为由扩展修改业务代码；需要修改 `electron/` 或 `src/` 时必须由任务明确授权。

## Mandatory Document Chain

Before analyzing, planning, or modifying existing logic, every agent must read these 10 documents in order. `kone-PRD.md` is the global authoritative requirements source (全局唯一权威需求主源头):

1. `kone-PRD.md` — V1.4 全局唯一权威需求主源头 (Global Authoritative Requirements Source)
2. `PROJECT-PRD.md`
3. `ARCH-STANDARDS.md`
4. `.opencode/agents/ui-agent.md`
5. `.opencode/agents/ipc-agent.md`
6. `.opencode/agents/system-blueprint.md`
7. `.opencode/agents/build-agent.md`
8. `V1.2-商业版交付与运维手册.md`
9. `PROVIDER-CAPABILITY.md` — Provider 真实能力与宣传口径唯一事实源
10. `CLOUD-COLLABORATION-DELIVERY.md` — 云端协同/投递/抑制/Webhook 领域唯一事实源

Skipping any document in this chain is a protocol violation.

> 说明：第 9、10 项为 2026-09-22 补入。此前本链仅列 8 份，却要求"在强制文档链之后"另行阅读云端协同文档，造成链外补充与治理面不一致。任何涉及 Provider 能力或云端投递的变更，必须先读第 9、10 项。

## Plan-First Rule

- Any task touching more than 1 file or involving complex business logic must start with Prometheus, the planning agent.
- Prometheus must output a concrete execution checklist before any code or configuration is changed.
- Direct implementation without a planning pass is forbidden for multi-file or complex work.

## Multi-Agent Collaboration Rule

- Prometheus owns planning and decomposition.
- Specialized agents execute only after the plan is approved by workflow order.
- Execution must follow the checklist sequence and keep changes scoped to the stated task.
- If new risk appears during execution, stop implementation, update the plan, and continue only from the revised checklist.

## Anti-Regression Protocol

- Read the full 10-document chain before changing existing logic.
- Preserve all validated behavior, especially the mandatory `四级弹性搜索协议`.
- Never fix a new bug by breaking a previously working path.
- Any change that may affect existing logic must be verified with local test scripts after modification.
- A task is not complete until the relevant local verification passes.

## Test Discipline

- Use local test scripts defined in `package.json` as the required verification entrypoints.
- Prefer `node --test` based execution for scripts under `tests/`.
- Add or extend tests under `tests/` and `tests/e2e/` when workflow coverage needs to grow.

## Change Safety

- Default to the smallest safe change.
- Do not expand scope from workflow/configuration tasks into product code.
- Keep repository rules, billing boundaries, and fallback resilience guarantees intact.

## 本地 Autopilot 伴随巡航运行规范

- 侧边栏 `💎 Kone AI 自航拓客特权港` 分区必须按授权层级展示真实能力：Trial 显示升级引导；Paid Basic 可使用低量本地 Email 与 WhatsApp Web 能力；Premium/Enterprise 解锁 WhatsApp Cloud API、LinkedIn Profile 只读辅助、账号多开与团队协作。
- 任何 Agent 实施重构或维护前端时，必须强制实施 License 级别前置拦截与 AccountService 真实状态校验。
- Trial 用户访问 `/agents` 路由时，必须熔断拦截并替换渲染升级推介海报与激活入口，严禁渲染任何智能体卡片或暴露运行指标。Paid Basic 用户若开放本地低量 Agent，则卡片必须清楚标注低频、本地、需账号配置和平台风控边界。
- 高级版放行后，Agent 卡片中央的"执行进度"必须通过 `accountGetList()` 拉取真实账号绑定元数据后动态渲染。凡检测到某项渠道未配置（Cookie 为空、Token 不存在），卡片进度必须硬编码清零为 `0/0`，状态标签显示 `未连接 / 待配置`。**严禁写入任何硬编码假数据污染指标**。
- `[查看运行日志]` 按钮通过 `agent:get-log` IPC 调取后端 `AgentLogEntry[]` 记录；若无历史记录渲染 `暂无本地沙箱运行记录，请先激活启动`。

## Agent 双管道数据流宪法

### 核心数据流路径
```
搜索穿透 → SearchExecuteResult
  ├─ decisionMakers[]     → 前端展示 + AI 分析
  ├─ customsData          → 线索详情面板
  ├─ exhibitionFootprints → 线索详情面板
  └─ agentStatus          → 智能体触达状态
         ↑
Agent 执行管道 (agent-pipeline.ts)
  └─ 拾取 matchScore >= 60 且含可触达资产的线索
  └─ 生成 AgentTask 队列
  └─ Agent 消费执行
  └─ writeBackAgentStatus → 更新 agentStatus (双管道)
         ├─ 管道 A: agentStatus → LeadItem.agentStatus (持久化)
         └─ 管道 B: AgentState → AGENT.STATUS_CHANGED IPC (运行时)
```

### Agent 类型与能力矩阵
| Agent | 消费字段 | 执行通道 | 日频上限 | 技术实现 |
|---|---|---|---|---|
| WhatsApp 拓客猎手 | `phone` | Puppeteer + Web WA DOM 自动化（实验性·Beta，Basic）/ Cloud API (Premium) | 见 `kone-PRD.md §零.3` | 本地扫码 + DOM `data-testid` 选择器 / 官方 Cloud API |
| LinkedIn 商务猎手 | `linkedinUrl` | 本地 Session Cookie 只读 Profile 辅助 | 见 `kone-PRD.md §零.3` | 公开资料提取 + AI 文案生成，人工触达 |
| 邮件长效跟随助理 | `email` | Nodemailer SMTP+IMAP (Basic) / Cloudflare Workers (Premium, 目标态) | 见 `kone-PRD.md §零.3` | 本地 SMTP 直连 / 云端队列 (Phase 1) |

### 宪法约束
- Agent 在消费 `AgentTask` 时必须验证 `taskRunId !== currentPipelineRunId`，丢弃来自旧管道的过期任务
- `writeBackAgentStatus` 必须同时更新 `agentStatus`（持久化线索态）和 `AgentState`（内存运行态），二者不可偏废
- 任何 Agent 的实现不得以 `setTimeout` 模拟替代真实 HTTP 请求或浏览器自动化
- 各 Agent 的日频上限必须参考 `userConfig` 中的配置，不得硬编码在实现中（除默认值外）
- LinkedIn Agent 严禁自动发送好友申请、严禁自动私信、严禁批量点击 Connect。只读 Profile 浏览成功不得写成 `linkedinContacted = true`，只能写运行日志和 AI 文案状态。
- WhatsApp Web Agent 必须真实检测 session 状态；断线、验证码、扫码过期、限流时必须进入 `paused` 或 `error`，不得假成功。
- Email Agent 必须先通过 SMTP/IMAP 配置与 DNS 健康检查；SPF/DKIM/DMARC 高危时必须软锁定发送。

## 多语言多源搜索执行宪法

- 当用户自然语言或 `country` 字段限定国家时，`mutateSearchIntent()` 必须通过 LLM 解析该国官方语言，并生成本地语言产品词变体；LLM 不可达时只能降级为英文变体，不得臆造语言。
- 搜索变体公式为：`(pureEnglishProducts[0..SEARCH_PRODUCT_TERM_LIMIT-1] + localizedProducts[].terms[]) × B2B_ROLE_TERMS[0..3] × country/city`。
  **产品词上限 `SEARCH_PRODUCT_TERM_LIMIT = 2`、单次派发变体总数上限 `SEARCH_VARIANT_LIMIT = 12`**，权威值见 `kone-PRD.md §零.3`（2026-10-11 新增，同日校准：初版 8 偏紧会砍掉本地语言变体，放宽至 12）。
- 英文变体始终执行，本地语言变体并行补充。此策略允许约 `2x` API 调用量 —— **「2x」的基数是「单产品词的英文变体数（= `B2B_ROLE_TERMS[0..3]`，即 4 个）」**，而非无限膨胀。无论语言如何扩面，**单次搜索派发的变体总数不得超过 `SEARCH_VARIANT_LIMIT`**。该上限**不改变** LLM 评分与官网富化的并发上限（`2`），也**不改变**扇出并发上限（`3`）—— 三者是**不同维度**（总量 / 算力并发 / 扇出并发），**不得混读**。
- **产品词必须清洗**：进入变体生成的产品词须为**可检索的英文商品词**；含控制词（`请搜索`/`帮我找`/`要求…`）、中文原文或超长自然语言的条目**必须剔除**，不得直接作为查询派发（实测曾出现整句中文被当作关键词打给上游，纯属浪费配额）。
- 所有 Provider 必须通过统一 `ProviderQuery` 消费 `keyword`, `language`, `country`, `city`, `intentProducts`, `b2bAttributes`, `myJobId`。
- Provider 只负责采集与归一化，不得写 Zustand、不得发送 IPC、不得保存线索。
- `google_maps`、`google_organic`、AnySearch、`linkedin_search`、`customs_shipment`、`trade_show`、`facebook_search` 的失败必须互相隔离，任何单源失败不得中断整轮搜索。（`yellow_pages` 已弃用：`execute()` 直接返回 `DEPRECATED`、不发起采集，故不参与隔离断言；状态以 `PROVIDER-CAPABILITY.md` §已弃用为准。）

## Local-Cloud Collaboration Change Protocol

For any change involving approval, cloud handoff, delivery, suppression, webhook, reply, quota, events, workspace access or cross-device status:

1. Read `CLOUD-COLLABORATION-DELIVERY.md` after the mandatory document chain and before planning.
2. Treat `kone-PRD.md §5.1` as product truth and the cloud collaboration document as domain truth. Do not copy field-level rules into unrelated files.
3. Update contracts before implementation: local IPC and cloud API/Event Schema are separate versioned boundaries.
4. The implementation plan must list affected SSOTs, backward compatibility, migration, rollback, negative authorization tests, event/idempotency tests and acceptance evidence.
5. A high score, staged Agent task or `cloud_send` feature never authorizes delivery. Approval plus server-side second-gate success is mandatory.
6. Do not write cloud delivery semantics into existing `LeadStatus` or `AgentStatus` strings without an explicit migration and compatibility layer.
7. UI may show success only after a verified local action or authoritative cloud event. Optimistic send/delivery success is forbidden.
8. Any non-success CI result, including `timed_out`, `action_required` or missing result, must fail the release gate.
9. The change is incomplete until documentation, schema, tests, packaged smoke, release evidence and rollback conditions are aligned.

## Pre-Commit Hygiene

- Before committing, separate source/test/document changes from generated or local-only artifacts.
- Do not stage ignored runtime residue such as `.tmp-*`, `.playwright-mcp/`, `.codenomad/`, `.vite/`, `dist/`, logs, or accidental Windows redirection files like `$null`.
- `dist-electron/` and packaged build artifacts are **not tracked** in the current repository history (`.gitignore` excludes `dist-electron/`, `dist/` and `release/`); `tests/packaged-smoke-report.json` and `tests/packaged-smoke.png` are the tracked exceptions. Changing that policy requires an explicit cleanup task rather than an incidental feature commit.
- If tests or smoke scripts update tracked artifacts such as `tests/packaged-smoke-report.json` or `tests/packaged-smoke.png`, review whether those artifact diffs are intentional before staging.

## Secrets Whitelist

- `secrets.anysearch.apiKey` and `secrets.anysearch.baseUrl` are registered literal references in `search-service.ts`. They are re-exports of the user's own AnySearch endpoint configuration—not hardcoded secrets. Any agent modifying search-service.ts must preserve these references; replacing them with hardcoded values is a protocol violation.

## Continuous Search Temporal Isolation Contract

- `electron/services/search-service.ts` implements JobID stamping for temporal isolation: every `handleSearchExecute` invocation generates `crypto.randomUUID()`. All async callbacks (SerpApi response, AnySearch mutate, LLM scoring, website enrichment) must compare `myJobId` against the owner-scoped active job (`activeJobIdFor()` → `activeJobIds: Map<senderId, jobId>`) at entry and silently discard if mismatched, preventing cross-industry race conditions.
- The contract applies to: `emitBasicResults`, `emitLeadScored`, `emitStreamComplete`, `enrichLeadWithDeepProbe`, and all `.then()` / `await` continuations in the search pipeline. (勘误：早期版本写作 `emitDecisionMakers` / `computeLeadScore` / `enrichLeadWebsite`，这三个函数名在代码中不存在；以本行为准。)
- **P3-2 升级（已落地）**：隔离结构已由模块级单例升级为 `Map<ownerKey, jobId>`（ownerKey = sender WebContents id），多窗口/多 Tab 并发搜索互不误杀。Provider 的陈旧检查统一使用导出的 `isKnownActiveJobId(myJobId)`（匹配任意活跃窗口的 job），`getCurrentActiveJobId()` 保留为全局最新回退（向后兼容）。

## Search-to-Agent Data Pipeline Contract

### Agent Task Queue Isolation
- `agent-pipeline.ts` generates `crypto.randomUUID()` per pipeline run via `withPipelineIsolation()` (`currentPipelineRunId`).
- All Agent task consumption and `writeBackAgentStatus` callbacks must check `taskRunId !== currentPipelineRunId` at entry; stale tasks from previous runs must be silently discarded.
- Agent pipeline isolation uses its own module-level runId guard (`currentPipelineRunId`), separate from the owner-scoped `Map<senderId, jobId>` Search Temporal Isolation.

### Provider Integration Contract
> 权威来源: `kone-PRD.md §0.8` — 以下为引用摘要，完整接口定义与实现规范以 kone-PRD.md 为准。

- All new data source providers must implement the `SearchProvider` interface defined in `kone-PRD.md §0.8`.
- Provider files must be placed under `electron/services/providers/<id>-provider.ts`.
- Each provider must be self-contained, stateless, with all configuration injected via constructor.
- `execute()` must include `myJobId` temporal isolation check.
- Provider failure must not break the full pipeline: use `Promise.allSettled` for aggregation.
- Provider implementations must accept and preserve the query `language`; country-specific local language expansion belongs in intent mutation, not inside individual providers.

### Agent Pipeline Execution Contract
- Pipeline is invoked **synchronously and directly** by `search-service.ts` after the stream completes (`withPipelineIsolation(...)`), not via an `ipcMain.on('search:stream-complete')` listener; the IPC event is only used to notify the UI. It automatically collects qualified leads (`matchScore >= 60` with reachable assets).
- `AgentTask` is the minimum work unit; tasks are queued per Agent type.
- Agent execution updates both `AgentState` (memory Map → `AGENT.STATUS_CHANGED` IPC) and `agentStatus` (persistent → `LeadItem.agentStatus`).
- The dual-channel write-back is mandatory: runtime state for UI panel, persistent status for lead timeline.
- Daily limits must be enforced per Agent (WhatsApp: 3-5/day, LinkedIn: ≤30 profile view/day, Email: 20/day for Basic). 数值以 `kone-PRD.md §零.3` 宪法常量表为唯一权威源，实现须优先读取 `userConfig.agentDailyLimits`，仅在缺失时回落默认值。
- Agent execution must not fake completion. Real external effects or real platform state changes are required before incrementing `completedCount` or writing `agentStatus`.

### Provider Expansion Priority
> 状态更新：下表 P1-P4 中的 `linkedin_search`/`customs_shipment`/`trade_show`/`facebook_search` **已在代码中落地**（真实能力与宣传边界详见 `PROVIDER-CAPABILITY.md`，唯一事实源）。本表保留为历史优先级参考，不代表待办项。
| Priority | Provider | Effort | Dependency |
|---|---|---|---|
| P1 | SerpApi LinkedIn Search | 1 day | Reuses existing SerpApi Key |
| P2 | Customs data crawler | 3-5 days | Public customs databases |
| P3 | Facebook Search | 1 day | Reuses existing SerpApi Key |
| P4 | Trade Show crawler | 2-3 days | Public exhibition databases |
