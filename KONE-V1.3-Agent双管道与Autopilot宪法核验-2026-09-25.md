# KONE Agent 双管道数据流 & 本地 Autopilot 巡航宪法 · 核验报告

> **日期**：2026-09-25 ｜ **基线**：HEAD `14762e8`
> **依据**：`AGENTS.md`「Agent 双管道数据流宪法」+「本地 Autopilot 伴随巡航运行规范」+ `kone-PRD.md §6.0`
> **方法**：逐条抽取宪法条款 → 逐条对照实现取证 → 记录证据位置与结论。

---

## 0. 结论

| 项 | 结论 |
|---|---|
| 核验条款数 | **10 条** |
| **合规** | **10 / 10** ✅ |
| 发现缺陷 | **0 个** |
| 发现文档瑕疵 | **1 处**（`app-sidebar.tsx` 注释与事实不符，**已订正**） |

> **一句话**：Agent 双管道与 Autopilot 巡航的宪法约束**全部落实**，本轮无功能缺陷。

---

## 1. 逐条核验

### 1.1 Agent 双管道数据流宪法

| # | 宪法条款 | 结论 | 证据 |
|---|---|---|---|
| ① | Agent 消费 `AgentTask` 时必须验证 `taskRunId !== currentPipelineRunId`，丢弃旧管道的过期任务 | ✅ | `agent-pipeline.ts`：`currentPipelineRunId` / `isStaleTask` / `withPipelineIsolation`；`taskRunId: currentPipelineRunId ?? undefined`（L115）。**注**：源码注释记录了此前"`isStaleTask` 恒返回 false"的缺陷已修复 |
| ② | `writeBackAgentStatus` 必须**同时**更新 `agentStatus`（持久化）与 `AgentState`（内存运行态），二者不可偏废 | ✅ | `agent-service.ts:269-302`：`agentStatusStore.set` + `persistAgentStatuses()`（**管道 A 持久化**）；`AGENT.LEAD_STATUS_UPDATED`（per-lead 实时）；`emitAgentStatus` → `AGENT.STATUS_CHANGED`（**管道 B 运行态**） |
| ③ | 任何 Agent 不得以 `setTimeout` 模拟替代真实 HTTP 请求或浏览器自动化 | ✅ | 全仓 grep `setTimeout.*(模拟|mock|fake|simulate)` → **0 命中** |
| ④ | 各 Agent 日频上限必须参考 `userConfig`，不得硬编码（默认值除外） | ✅ | `agent-service.ts`：`dailyLimit: state.dailyLimit \|\| DEFAULT_AGENT_DAILY_LIMITS.<type>.basic`（默认仅兜底）；`dailyUsed >= dailyLimit` 前置拦截（L585/L665）。L1-4 已由 `applyLicenseLimits` 读 `user_config.agentDailyLimits` |
| ⑤ | LinkedIn Agent **严禁**自动好友申请/私信/批量 Connect；只读 Profile 成功**不得**写 `linkedinContacted = true` | ✅ | `linkedin-agent.ts` 的 `connect()` 为**会话连接**（`sessionState`），非好友申请；`agent-service.ts:688` **显式** `writeBackAgentStatus(..., 'linkedin', { linkedinContacted: false })` |
| ⑥ | WhatsApp Web Agent 必须**真实检测** session；断线/验证码/扫码过期/限流必须 `paused`/`error`，不得假成功 | ✅ | `agent-service.ts:563-564`：`const sessionOk = await instance.checkSession(); if (sessionOk !== 'connected')` → 进入非成功态 |
| ⑦ | Email Agent 必须先通过 SMTP/IMAP 配置与 **DNS 健康检查**；SPF/DKIM/DMARC 高危时**必须软锁定发送** | ✅ | `email-agent.ts:93-147`：解析 MX/TXT，检查 SPF(`v=spf1`)/DKIM(selector)/DMARC(`_dmarc`)/黑名单，返回 `risk: 'safe'\|'warning'\|'critical'`；注释明示 "critical SPF/DKIM records missing OR domain blacklisted → **soft-lock sends**"；`resolveDkimSelectors` + `user_config.dnsShield.dkimSelectors` 可配 |

### 1.2 本地 Autopilot 伴随巡航运行规范

| # | 宪法条款 | 结论 | 证据 |
|---|---|---|---|
| ⑧ | **Trial 访问 `/agents` 必须熔断拦截**，替换渲染升级推介海报与激活入口，**严禁渲染任何智能体卡片或暴露运行指标** | ✅ | `agents-panel.tsx:242-267`：`isTrialOrFree = !isPremium && !isPaidBasic` → **渲染升级墙**（含"[立即输入商业授信码激活]"入口），不渲染卡片 |
| ⑨ | 未配置渠道"执行进度"必须**硬编码清零 `0/0`**，状态标签显示 `未连接 / 待配置`；**严禁写入硬编码假数据污染指标** | ✅ | `agents-panel.tsx:354`：`displayProgress = connected ? agent.progress : 0`；L355 `notConfigured`；L391 `未连接 / 待配置`；L402 总数未配置时显示 `'0'` |
| ⑩ | `[查看运行日志]` 无历史记录时渲染 `暂无本地沙箱运行记录，请先激活启动` | ✅ | `agents-panel.tsx:533` 文案**逐字一致** |

---

## 2. 发现并订正的文档瑕疵

| 项 | 内容 |
|---|---|
| **位置** | `src/components/app-sidebar.tsx:45-49`（`premiumNavItems` 注释） |
| **原文** | "agents(AI 销售团队) 按 **README** 授权矩阵对 trial/basic/premium/enterprise **全开放**（仅日限额不同，由 agents-panel 强制）" |
| **问题** | 该表述**易被误读为"Trial 可直接使用智能体"**，与 `kone-PRD §6.0`（"Trial 仅展示升级引导"）及 `AGENTS.md`（"Trial 访问 /agents 必须熔断拦截，严禁渲染任何智能体卡片"）**相悖**。后续开发者若据此注释移除 `agents-panel` 的升级墙，将直接违宪。 |
| **订正** | 改为准确表述：**导航项对全层级可见，但内容准入由 `agents-panel` 强制熔断（`isTrialOrFree → 升级墙`）**，并显式标注不可理解为"Trial 可直接使用"。 |

> **说明**：实际**行为**本就合规（升级墙已实现）；订正的是**注释**，目的是**防止未来回归**。

---

## 3. 与 README 的口径一致性（附带发现）

`README.md` 版本能力对照表将「AI 销售团队智能体」标为：试用版 **"试用限额（每日 3 条）"**。

而 `kone-PRD §6.0` 与 `AGENTS.md` 均要求 **Trial 仅展示升级引导（熔断拦截）**。

| 来源 | 表述 | 权威级 |
|---|---|---|
| `kone-PRD.md §6.0` | Trial **仅展示升级引导** | **全局唯一权威需求主源头** |
| `AGENTS.md` | Trial 访问 `/agents` **必须熔断拦截** | 反回归协议 |
| `README.md` | 试用版"试用限额（每日 3 条）" | 对外文档（低） |
| **实现** | `agents-panel` 熔断 → **与 PRD/AGENTS.md 一致** ✅ | — |

> **建议**：README 该行与 PRD 不一致（对外宣称"试用可用 3 条"，实际试用被熔断）。**属对客口径偏差**，建议按 PRD 订正为"试用版：不开放（升级解锁）"。**本报告不擅自改动产品授权口径**，列为待决项。

---

## 4. 核验证据索引

| 证据 | 位置 |
|---|---|
| 双管道回写 | `electron/services/agent-service.ts:269-302` |
| 管道隔离 / 过期任务 | `electron/services/agent-pipeline.ts`（`isStaleTask` / `withPipelineIsolation` / `currentPipelineRunId`） |
| WhatsApp 会话检测 | `electron/services/agent-service.ts:563-564` |
| LinkedIn 只读 | `electron/services/agents/linkedin-agent.ts` + `agent-service.ts:688` |
| Email DNS 软锁 | `electron/services/agents/email-agent.ts:93-147` |
| Trial 熔断 / 0-0 硬编码 / 日志空态 | `src/components/agents-panel.tsx:242-267 / 354-402 / 533` |
| 日频上限 | `electron/services/agent-service.ts`（`DEFAULT_AGENT_DAILY_LIMITS` 兜底 + `state.dailyLimit`） |

---

*本报告为时点快照（2026-09-25，HEAD `14762e8`）。核验结论：Agent 双管道与 Autopilot 巡航宪法 **10/10 合规**。*
