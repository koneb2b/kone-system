# Kone V1.3 P0 商用诚实化与触达通道硬化执行计划

> 目标定位：长期产品化。WhatsApp 通道定位为「实验性」。
> 本计划仅为规划文档，实施前须经 Momus 评审通过。
> 权威需求源：`kone-PRD.md`（全局唯一权威）。本计划所有改动不得违反 4 级弹性搜索协议、并发锁死 2、Fail-Closed 计费、数据主权红线。

## 0. 审计背景（代码级证据）

本计划源于一次工程级对齐审计。核心结论：Kone 是有真实骨架的准商用产品（搜索引擎、ICP 评分、计费鉴权、Email SMTP+DNS 均为生产级），但存在 4 处「货不对板」裂缝，直接阻断「可完全商用」。

已验证的真实部分（不改动，仅记录）：
- `electron/services/search-service.ts`（2588 行）：真实 SerpApi/AnySearch HTTP、4 级降级、流式 stage、JobID 时空隔离。
- `computeIcpMatchScore`：确定性 40/30/20/10 权重。
- 8/9 Provider 有真实 fetch。
- `electron/services/agents/email-agent.ts`：真实 nodemailer SMTP + 真实 dns.resolve（SPF/DKIM/DMARC/Spamhaus）。
- Agent 管道接线完整：`search-service.ts:2273/2406` → `buildAgentTaskQueue` → `dispatchAgentsFromPipeline`。
- 计费双层防护：主进程 Fail-Closed + UI `agents-panel.tsx` isPremium 拦截。
- 测试：35 文件、272 断言、0 skip/todo。

## 1. 待修复裂缝清单（P0）

| ID | 裂缝 | 证据 | 风险 |
|---|---|---|---|
| P0-1 | WhatsApp 用过时选择器 + 缺 `whatsapp-web.js` 依赖 + 假成功 | `electron/services/agents/whatsapp-agent.ts:58-141,148` | 用户点击大概率报错，货不对板 |
| P0-2 | Email「智能长效跟随」实际只发第一封，无多轮调度、无 IMAP 回复检测 | `agent-service.ts:391-402`（恒定 stage=0 / emailSequenceStage:1）；`email-agent.ts` imap 字段未用；package.json 无 IMAP 库 | 名不副实，可能骚扰已回复客户 |
| P0-3 | 文档三方进度口径冲突 | `kone-PRD.md §0.8`（「已落地」）vs `PROVIDER-CAPABILITY.md`（「placeholder 不可宣传」）vs 实际代码（已有真 fetch） | 商业交付/合规硬伤 |
| P0-4 | 搜索完成后自动派发 agent 触达，无人工闸门，与 UI「需人工确认发送」矛盾 | `search-service.ts:2273` 自动 dispatch；`agents-panel.tsx:222` 文案 | 自动骚扰真实客户，封号/法律风险 |

---

## 2. 执行 Checklist（按波次，每步含验证）

### 第一波：诚实化（低风险，优先消除货不对板）

**Step 1 — P0-4 加人工触达闸门（最高优先，安全红线）**
- 文件：`electron/services/search-service.ts:2273-2276, 2406-2409`
- 改动：`withPipelineIsolation` 内**只构建队列并持久化/推送到前端展示**，移除自动 `dispatchAgentsFromPipeline` 的即时触达调用；改为将队列存入待触达状态。
- 文件：`electron/services/agent-service.ts` — `dispatchAgentsFromPipeline` 拆分为 `stageAgentQueue`（暂存+推送 UI）与 `startAgent`（用户点击触发）。
- 前端：`src/components/agents-panel.tsx` 卡片「开始触达」按钮显式触发 `agentControl('start')`，展示待触达队列数量。
- 验证：`node --test tests/agent-pipeline-integration.test.js`；启动 Electron，搜索后确认 agent **不自动发送**，须点击才发。

**Step 2 — P0-1A WhatsApp 诚实标注实验性**
- 文件：`src/components/agents-panel.tsx`
  - `AGENT_META`（第17行）为 whatsapp 增加 `experimental: true` 标记。
  - 卡片渲染区（第294行 `agents.map` 起）为 experimental agent 加橙色 `实验性 · Beta` Badge + tooltip：「WhatsApp Web 自动化受官方页面改版与风控影响，可能不稳定，请人工核对发送结果，风险自担」。
  - 移除/中性化第222行、263行对 WhatsApp 的效果承诺文案。
- 验证：`node --test tests/ui-contract-agents-panel.test.js`；启动 Electron 肉眼确认 Badge 与文案。

**Step 3 — P0-1A WhatsApp 消除假成功 + 加随机间隔**
- 文件：`electron/services/agents/whatsapp-agent.ts:148`
  - 发送后检测真实投递态（消息气泡 ✓/✓✓ 或 pending selector），检测不到写 `whatsappStatus: 'pending'`，绝不写 `delivered`。
  - 发送间隔改为可配置随机 30-90s（读 `userConfig`，默认值兜底，不硬编码上限）。
- 验证：单测覆盖「检测不到投递态 → pending」分支；不触真号（真号验证留第二波）。

**Step 4 — P0-2 兜底文案（若第二波未完成即需交付）**
- 文件：`src/components/agents-panel.tsx` — Email 卡片文案「智能长效跟随」→「多轮定时序列（回复检测即将支持）」。
- 验证：肉眼确认文案。

**Step 5 — P0-3 文档单一事实源**
- 重写 `PROVIDER-CAPABILITY.md` 为唯一能力事实源，逐 Provider 标注「真实可用/实验性/未接入」，注明「对外宣传仅可引用真实可用行」。
- `kone-PRD.md §0.8` 的「已落地」措辞改为指向 PROVIDER-CAPABILITY.md。
- 验证：三方口径一致性人工复核。

### 第二波：能力硬化（产品化阶段）

**Step 6 — P0-2 IMAP 回复检测**
- 依赖：新增 `imapflow`（pinned 版本）。
- 文件：`electron/services/agents/email-agent.ts` — 新增 `checkReply(senderDomain, sinceDate)`：连 IMAP，搜 `FROM=目标域名 SINCE=发信日`，命中标记已回复。
- 验证：本地测试 IMAP 账号，模拟回复命中/未命中两分支。

**Step 7 — P0-2 多轮序列调度（核心缺失）**
- 持久化跟进计划表（写入 config-service）：`{ leadId, email, stage, nextSendAt, repliedAt }`。
- 主进程定时器（每小时）：到期且未回复 → 发下一轮 → 更新 `emailSequenceStage`（真实 0→1→2→3）；已回复则停止序列。
- 文件：`agent-service.ts:391-402` — `executeSequence` 传入真实 stage，`writeBackAgentStatus` 写真实 stage。
- 验证：`tests/business-logic/` 新增序列推进单测；本地跑一轮 stage 推进 + 回复中断。

**Step 8 — P0-1B WhatsApp 选择器现代化**
- 迁移到 `whatsapp-web.js`（协议层，不依赖 DOM selector）或改用 role/文本定位；二维码事件桥接前端。
- 验证：`interactive_bash` 起真实 Electron，扫码连真号，发一条到测试号，肉眼确认送达。

---

## 3. 完成定义（DoD）

- 所有改动文件 `lsp_diagnostics` 干净。
- `npm run build:electron:dev` 退出码 0。
- 相关 `node --test` 通过；新增分支有测试覆盖。
- 第一波完成后：搜索不再自动触达（Step 1）、WhatsApp 有实验性标注（Step 2）、无假成功（Step 3）、文档口径一致（Step 5）。
- 不违反任何宪法红线（并发 2、4 级搜索、Fail-Closed、数据主权、LinkedIn 只读）。

## 4. 不做（Scope Guard）

- 不重构 search-service 核心搜索逻辑。
- 不改 computeIcpMatchScore 权重。
- 不改计费边界。
- 不碰与本计划无关的业务代码。
