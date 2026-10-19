# KONE V1.3 · 账号管理与 AI 销售团队 严谨规范性审计

> 审计日期：2026-10-09 ｜ 审计范围：账号管理（AccountService）、AI 销售团队（本地 Autopilot Agent 矩阵）、授权分层
> 依据：`AGENTS.md`「本地 Autopilot 伴随巡航运行规范」+「Agent 双管道数据流宪法」、`kone-PRD §6.0`
> 方法：逐条对照宪法条文 → 代码取证（文件:行号）→ 判定「符合 / 违反 / 无法判断」

---

## 〇、结论摘要

| 维度 | 结论 |
|---|---|
| **账号管理** | 整体**规范**。真实健康检测（读 Electron 分区 cookie）、凭据 `safeStorage` 加密、UI 无硬编码假数据。**1 项半真实**（见 D-1）。 |
| **AI 销售团队** | 三个 Agent **均未用 setTimeout 模拟**；日频读 `userConfig`；LinkedIn 真只读；WhatsApp 真检测 session；Email 有 DNS 健康门禁。**双管道回写与 taskRunId 校验均已实现**。 |
| **授权分层** | 🔴 **发现严重缺陷**：主进程 Trial 门禁缺口（商业泄漏）+ `AGENT.LIST` 无门禁。**已修复**。 |

**本次共发现 3 个缺陷，全部已修复并提交**（`6fb6f0b`）。
另记录 1 项待确认项（`CONNECT` 语义）。

---

## 一、账号管理（AccountService）

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 服务位置 | 无独立 `account-service.ts`，逻辑在 `sandbox-service.ts` | `sandbox-service.ts:14` |
| 2 | 账号类型 | `email_smtp / email_imap / linkedin / facebook / whatsapp` | `sandbox-service.ts:14` |
| 3 | **真实状态校验** | ✅ 读 Electron 分区 cookie 判定（`li_at` / `c_user` / `WAToken1`+过期时间），**非只读配置** | `sandbox-service.ts:56-103` |
| 4 | `ACCOUNT.GET_LIST` | ✅ 已注册，`status` 来自真实健康检测 | `sandbox-service.ts:305,323-338` |
| 5 | `ACCOUNT.DISCONNECT` | ✅ 真实清空 session storage | `sandbox-service.ts:261,286` |
| 6 | UI 无假数据 | ✅ 经 `accountGetList` 渲染真实列表；空态为引导卡 | `accounts-management.tsx:152-164,352-365` |
| 7 | 凭据加密 | ✅ SMTP/IMAP 密码经 `safeStorage`；cookie 存 Electron 持久分区 | `secret-manager.ts:24-65`；`sandbox-service.ts:24,38` |

### ✅ D-1（已修复）：`ACCOUNT.CONNECT` 不再谎报状态

**初判**：`CONNECT` 仅创建内存条目并直接置 `status:'connected'`，无真实登录流程。

**复核后确认这确实是个缺陷（而非仅语义模糊）**：
- 轮询间隔 `HEALTH_POLL_INTERVAL_MS = 30_000` → 注册后**最长 30 秒**内，
  账号列表会显示一个**未经任何验证**的"已连接"。
- 且邮箱类型在健康检查里走 `else { entry.status = 'connected' }` ——
  **无条件置 connected**，即便 SMTP/IMAP 从未配置也显示"已连接"。

这违反宪法「不得假成功」。

**修复**（`sandbox-service.ts`）：
1. **CONNECT 初始状态改为 `disconnected`**，并**立即执行一次 `performHealthCheck`**
   （不再等 30s 轮询），使返回值反映真实情况；同时回传 `errorMessage` 供 UI 提示。
2. **邮箱类型的健康检查不再无条件置 connected**：改为校验
   `user_config.smtpHost` / `imapHost` 是否已配置（Fail-Closed）；
   未配置 → `disconnected` + 可行动提示（"请在「邮箱」设置中补全后重试"）。
   注：此处只校验配置**存在性**；真实连通性由「测试连接」与 Email Agent
   执行前的 DNS 健康检查（`email-agent.ts:91-163`）负责。
3. `performHealthCheck` / `startHealthCheckPoller` 增加 `store` 参数
   （原为模块级函数，无法读取配置）。

**保留的既有优点**：`CONNECT` 本就有 license 门禁
（`team_collaboration` / `search_basic`）与基础版单邮箱限制，
且 LinkedIn/Facebook/WhatsApp 的健康检查本就查真实 cookie + 过期时间。

---

## 二、AI 销售团队（Autopilot Agent 矩阵）

| # | 宪法要求 | 结论 | 证据 |
|---|---|---|---|
| 8 | 三 Agent 实现 | `whatsapp-agent.ts` / `linkedin-agent.ts` / `email-agent.ts` | `electron/services/agents/` |
| 9 | **禁止 setTimeout 模拟** | ✅ 仅 3 处，均为**真实等待**（送达轮询 1s / 人工节奏 / 超时竞速），非模拟 | `whatsapp-agent.ts:217,227`；`agent-service.ts:56` |
| 10 | **日频读 userConfig** | ✅ `applyLicenseLimits` 优先读 `user_config.agentDailyLimits`，缺失才回退默认 | `agent-service.ts:1019-1032`；默认值 `:40-44` |
| 11 | **LinkedIn 只读** | ✅ 仅 `readProfile`；**无 connect/message/friend 代码**；回写 `linkedinContacted:false` | `linkedin-agent.ts:96-180`；`agent-service.ts:688` |
| 12 | **WhatsApp 真检测 session** | ✅ 检测 `chat-list`/二维码；失败置 `error`；未确认送达只写 `pending`，**不假成功** | `whatsapp-agent.ts:58-127,201-219`；`agent-service.ts:567-572` |
| 13 | **Email DNS 健康门禁** | ✅ `checkDnsHealth` 查 MX/SPF/DKIM/DMARC + Spamhaus；critical 软锁定 | `email-agent.ts:91-163,210-213` |
| 14 | **双管道回写** | ✅ `writeBackAgentStatus` 同时写持久化 `agentStatusStore` **与** `emitAgentStatus`(AgentState) | `agent-service.ts:269-302` |
| 15 | **taskRunId 校验** | ✅ `isStaleTask` 在各 `execute*` 与 `stageAgentsFromPipeline` 调用 | `agent-pipeline.ts:155-164`；`agent-service.ts:540,577,622,657,713,747,1081` |
| 16 | `agent:get-log` 真实返回 | ✅ 返回 `AgentLogEntry[]` | `agent-service.ts:1178-1190` |

**判定：B 节 9 项全部符合宪法。** 这一块实现质量高——尤其
「不用 setTimeout 假装执行」「LinkedIn 严格只读」「WhatsApp 不假成功」三条，
正是最容易偷工减料的地方，代码里都做实了。

---

## 三、授权分层（🔴 本次发现严重缺陷）

| # | 宪法要求 | 修复前 | 修复后 | 证据 |
|---|---|---|---|---|
| 17 | Trial 路由熔断 | ✅ 渲染层已熔断 | ✅ | `agents-panel.tsx:242-287` |
| 18 | **主进程 License 强制** | 🔴 **违反** | ✅ 已修 | `license-guard.ts:95` → 拆分支 |
| 19 | **AGENT.LIST 门禁** | 🔴 **缺失** | ✅ 已修 | `agent-service.ts:1163` 加 `requireFeature` |
| 20 | 进度经 `accountGetList` 动态渲染 | ✅ 无写死数值 | ✅ | `agents-panel.tsx:94-101,351-354` |
| 21 | 未配置渠道显示 `0/0` + 未连接 | ✅ | ✅ | `agents-panel.tsx:391,401-403` |

### 🔴 缺陷 1：Trial 获得全部 Basic 能力（**商业泄漏**）

`license-guard.ts` 曾把两者合并：
```ts
} else if (plan === 'basic' || plan === 'trial') {
  BASIC_FEATURES.forEach((f) => normalized.add(f))   // 7 项全给
}
```
而 `BASIC_FEATURES` 含 `local_autopilot` / `search_deep` / `analysis_advanced` / `export_full`。

**后果**：Trial 用户**绕过渲染层升级墙，直连 IPC 启动付费智能体**。
渲染层的熔断形同虚设——**这正是宪法第 2 条"授权分层必须在主进程强制"要防的场景**。

**根因（值得记）**：能力集存在**三处 SSOT**：
| 位置 | 状态 |
|---|---|
| `license-service.ts` `TRIAL_FEATURES` | ✅ 早已正确（注释还写了修复原因） |
| `src/lib/feature-gate.ts` `FEATURE_ALIASES.trial` | ✅ 正确 |
| **`license-guard.ts`** | 🔴 **遗漏** |

`TRIAL_FEATURES` 的注释只提示"须同步 feature-gate.ts"，**没人注意到还有第三处**。

### 🔴 缺陷 2：`AGENT.LIST` 无 feature 门禁

宪法要求「严禁**暴露运行指标**」，但该通道直接返回全部智能体（含 `dailyLimit`/`status`）。

**注意**：`AGENT.CONTROL` 是有门禁的（`registerSecureFeatureIpc(..., 'local_autopilot', ...)`），
**只有 LIST 漏了** —— "用得了"被拦住，"看得到"却没人管。

### 🟡 缺陷 3：Basic 的 `export_full` 三处不一致

`feature-gate.ts` 注释明确「basic 仍无完整导出」，但 `license-guard.ts` 的
`BASIC_FEATURES` 含 `export_full` → Basic 用户实际拿到完整导出。

修复时**注意了连带影响**：`PREMIUM_FEATURES = [...BASIC_FEATURES, ...]` 会跟着丢，
故显式列出 `export_full` 避免 Premium 回归。

---

## 四、测试与宪法的冲突（重要发现）

两个既有 e2e 测试**固化了旧设计**，与宪法直接矛盾：

| 测试 | 原断言 | 问题 |
|---|---|---|
| `G3-L1` | "Trial 的 AGENT.LIST 返回 agents 且 dailyLimit=3" | 与「Trial 仅展示升级引导」冲突 |
| `G7-AFC` | "AGENT.CONTROL 强制 trial = 3/day 限额" | 同上 |

**测试在断言"Trial 可以用 Agent"**，而宪法说 Trial 不能用。

已更新为断言 **Fail-Closed 403**；`G3-L2`（Basic）保留不变（Basic 确实有该能力）。

> **这个现象本身值得警惕**：测试不仅没能拦住缺陷，反而**固化了错误行为**，
> 让后来者以为"Trial 有 3/day 额度"是设计意图。

---

## 五、遗留建议（未做，供决策）

| # | 建议 | 理由 |
|---|---|---|
| 1 | **能力集收敛为单一 SSOT** | 当前三处手写副本，已因此产生 2 次不一致。建议由一处导出、其余 import。 |
| 2 | **加门禁一致性校验脚本** | 遍历所有 `AGENT.*` 通道，断言"写通道与读通道的 feature 键一致"，防止再出现 LIST 漏门禁。 |
| 3 | 明确 `CONNECT` 语义 | 见 D-1。 |
| 4 | 把"Trial 能力集"纳入 `verify:consistency` | 三处比对，漂移即失败。 |

---

## 六、判定总表

| # | 项 | 判定 |
|---|---|---|
| 1–7 | 账号管理 | ✅ 符合（D-1 待确认语义） |
| 8–16 | AI 销售团队 | ✅ 全部符合 |
| 17,20,21 | 授权分层（渲染层） | ✅ 符合 |
| **18,19** | 授权分层（**主进程**） | 🔴 → ✅ **已修复** |
| **缺陷 3** | Basic `export_full` | 🟡 → ✅ **已修复** |

**修复提交**：`6fb6f0b`
**验证**：typecheck(src + electron) 0 error；单测 **324/324**。
