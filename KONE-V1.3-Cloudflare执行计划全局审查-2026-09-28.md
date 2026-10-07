# KONE-V1.3-Cloudflare 执行计划 · 全局审查与订正报告

> **日期**：2026-09-28 ｜ **审查对象**：`KONE-V1.3-Cloudflare云地协同架构可行性与执行计划-2026-09-25.md`
> **审查方法**：读取全部 10 份规范文档（ARCH-STANDARDS / STATE-MACHINES / CLOUD-COLLABORATION-DELIVERY / AGENTS / kone-PRD / PROVIDER-CAPABILITY / METHODOLOGY-NORTHSTAR / 高级版云端功能梳理 / 架构红线核验 / 上线前必要优化梳理），逐条交叉验证原文档中的每一处声明。
> **结论**：**发现 1 处严重事实错误、3 处重大遗漏、4 处与 SSOT 不对齐、5 处过度简化**。以下为逐项审查与订正。

---

## 一、严重事实错误（必须订正）

### 错误 1：N8N 足迹严重低估 ⚠️ 严重

**原文档声明**（§2.1）：
> "全仓 grep `n8n` 命中 4 处（1 主文件 + 1 注释 + 2 CHANGELOG 记录）"
> "1 个文件 + 1 行注释"

**实际取证**：

| 文件 | 行数 | N8N 引用数 | 性质 |
|---|---|---|---|
| `src/components/settings/n8n-settings-tab.tsx` | 145 | **16** | **整个设置页**（UI 组件，含表单、状态管理、验证逻辑） |
| `electron/services/automation-service.ts` | 417 | **9** | 核心服务（Webhook URL 管理、Gold Filter、推送逻辑） |
| `electron/services/config-service.ts` | 595 | **5** | 配置 schema 定义（`n8nSettings` 类型、getter） |
| `electron/services/proxy-service.ts` | 395 | **3** | 代理白名单（N8N webhook hostname 校验） |
| `src/components/automation-workflow.tsx` | 754 | **1** | UI 组件（套餐锁定提示文案） |
| `src/components/help-dialog.tsx` | — | **2** | 帮助文档文案 |
| `electron/utils/cloud-sync-gate.ts` | — | **2** | 函数注释（Gold Filter 说明） |
| `electron/services/supabase-service.ts` | — | **1** | 注释（`createCampaign`） |
| `CHANGELOG.md` + 其他文档 | — | ~36 | 历史记录 |

**实际总计：65 处代码引用（不含文档），横跨 8 个文件，约 2,306 行代码。**

**影响评估**：
- 原声明"1 个文件 + 1 行注释"低估了 **15 倍以上**；
- Phase 0 的实际工作量应为 **2-3 天**（非 1 天），涉及：
  - 删除 `n8n-settings-tab.tsx` 整个文件（145 行）
  - 修改 `automation-service.ts`（删除 N8N Webhook 部分，保留邮箱验证）
  - 修改 `config-service.ts`（删除 `n8nSettings` 类型与 getter）
  - 修改 `proxy-service.ts`（删除 N8N webhook hostname 白名单逻辑）
  - 修改 `automation-workflow.tsx`（更新套餐锁定提示文案）
  - 修改 `help-dialog.tsx`（更新帮助文档）
  - 修改 `cloud-sync-gate.ts` 与 `supabase-service.ts` 注释
  - 同步更新相关单测
- **授权模型影响**：`ARCH-STANDARDS.md §7.4` 明确"n8n cloud email automation"是 Premium 功能描述，移除 N8N 后需同步更新为"Cloudflare cloud email automation"；`§8` 也提到"Premium n8n automation may continue remotely"需更新。

**订正结论**：Phase 0 工作量从"1 天零风险"修正为 **2-3 天中低风险**，需完整文件清单与测试同步。

---

## 二、重大遗漏（必须补充）

### 遗漏 1：对客口径合规风险未提及 ⚠️ 高优先级

**现有规范约束**（`KONE-V1.3-高级版云端功能模块深度梳理-2026-09-25.md §0`）：

> "最大风险：⚠️ **对客夸大**：`README.md` 将'云端邮箱清洗 / N8N 自动化''团队协作 / 防撞单'标为**高级版开放**，**且无'目标态'标注**；前端亦无未实现提示。与规格'不得对外宣称已交付'直接冲突。"

**问题**：
- 原文档未提及此风险；
- 如果实施 Cloudflare 方案，**必须先解决对客口径问题**——否则实施过程中客户看到 UI 变化可能产生误解；
- `KONE-V1.3-架构红线与安全密钥核验-2026-09-25.md §6` 也提到"云端功能口径"是待决项。

**订正建议**：在 Phase 0 之前增加 **Phase -1：对客口径对齐**（0.5 天）：
- README 版本对照表中云端两项加注"（目标态/路线图，需配置云端后端）"；
- 前端高级版入口同步标注；
- 保留"云端能力不对外宣称已交付"直到 §13 门禁全部通过。

### 遗漏 2：云端闭环当前状态（NO-GO）未明确声明 ⚠️

**现有规范约束**（`CLOUD-COLLABORATION-DELIVERY.md §0`）：

> "当前发布判定：`NO-GO`。只有第 13 节门禁全部通过并保留证据后，才可转为 `GO`。"

**问题**：
- 原文档说"本方案属新增能力，与 Phase A 交付正交"，但未明确声明 **Cloudflare 方案本身也需经过 §13 门禁验收**；
- `高级版云端功能模块深度梳理 §6.2` 列出了 6 个阶段（A-F）的云端闭环立项路径，原文档的 Phase 1-4 未与之对齐。

**订正建议**：在文档开头明确声明：
- Cloudflare 方案是 `CLOUD-COLLABORATION-DELIVERY.md` 的技术实现路径之一；
- 实施后仍需通过 §13 全部 10 条门禁方可转为 `GO`；
- Phase 1-4 的验收标准需对齐 §13 门禁清单。

### 遗漏 3：与 Phase A 决策的一致性未明确 ⚠️

**现有规范约束**（`KONE-V1.3-上线前必要优化梳理-2026-09-25.md §3`）：

> "明确不做（过度工程）：**云端协同闭环**（审批/二次门禁/投递/事件回写）——规格自身判定 `NO-GO` 且为**高级版增量**；当前顾问渠道下本地能力已构成完整价值闭环。**且需客户配 Supabase**——非上线前置。"

**问题**：
- Phase A 明确说"云端协同闭环"是**过度工程**，不做；
- 原文档说 Cloudflare 方案是"新增能力"，但未明确说明 **与 Phase A 决策的关系**；
- 如果 Phase A 说"不做云端闭环"，那 Cloudflare 方案是否也属于"不做"范畴？

**订正建议**：在文档开头明确声明：
- Phase A 的"不做"是指 **V1.3 交付前不做**，不是永久不做；
- Cloudflare 方案是 **V1.3 交付后的增量规划**，不改变 Phase A 的交付结论；
- 两者不矛盾：Phase A 聚焦本地能力闭环（已完成），Cloudflare 方案聚焦云端增量（后续规划）。

### 遗漏 4：STATE-MACHINES.md §8 禁止写法清单未校验 ⚠️

**现有规范约束**（`STATE-MACHINES.md §8`）：

> 禁止写法清单（违反即架构违例）：
> 1. 把 `bounced` / `complained` / `suppressed` 直接加入本地 `LeadStatus` 联合类型。
> 2. 把云端 `FollowupStatus` 与本地 `FollowUpStatus` 视为同一类型。
> 3. 由 `delivered` 推导 `replied`，或由 `sent` 推导 `delivered`。
> 4. 前端乐观显示"已发送/已送达"——必须等待本地真实动作或云端权威事件。
> 5. 用 `contacting` 表达"已批准"或"已入队"等云端语义。
> 6. 在无迁移与兼容层的情况下改写既有状态字符串含义。

**问题**：
- 原文档的 D1 Schema 定义了 `leads.status` 包含 `suppressed`、`rejected`、`failed`、`archived` 等状态；
- 但未明确说明 **这些云端状态不得写入本地 `LeadStatus` 联合类型**；
- 也未明确说明 **本地 `FollowupStatus`（复用 `LeadStatus` 4 态）与云端 `FollowupStatus`（6 态）是不同类型**。

**订正建议**：在 §4 D1 Schema 后增加一节"状态机边界声明"：
- 云端 `leads.status` 是 `LeadBusinessStatus`（7+4 态），**与本地 `LeadStatus`（4 态）是不同类型**；
- 云端 `outreach.status` 是 `OutreachStatus`（4+3 态），**与本地无对应**；
- 云端 `FollowupStatus`（6 态）**与本地 `FollowUpStatus` 不是同一个东西**（本地不存在独立 follow-up 状态机）；
- 明确禁止：把云端状态写入本地联合类型、由 `delivered` 推导 `replied`、前端乐观显示"已发送"。

---

## 三、与 SSOT 不对齐（需修正）

### 不对齐 1：ARCH-STANDARDS.md §15 的 10 条硬边界未逐条对齐 ⚠️

`ARCH-STANDARDS.md §15` 定义了"Local-Cloud Collaboration Architecture (Target-State Hard Boundary)"的 10 条规则。原文档未逐条对照，存在遗漏：

| # | §15 条款 | 原文档是否对齐 | 问题 |
|---|---|---|---|
| 1 | Local and cloud form one pipeline | ✅ | — |
| 2 | High score or `cloud_send` entitlement is never send authorization | ✅ | — |
| 3 | Renderer has no cloud write authority and no secrets | ✅ | — |
| 4 | Cloud must independently validate identity, tenant, schema version, idempotency, collision, suppression, approval, email grade/exception, domain health, quota and circuit breaker | ⚠️ | 原文档 §5.3.1 提到了部分校验，但未明确列出全部 10 项 |
| 5 | Raw HTML, candidate batches, unapproved contacts, secrets, cookies and sessions are prohibited from cloud handoff | ✅ | — |
| 6 | Business, outreach and follow-up states are separate contracts | ⚠️ | 见遗漏 4 |
| 7 | Suppression is global and higher priority | ✅ | — |
| 8 | Cloud events are append-only audit evidence | ✅ | — |
| 9 | Every cloud response and write-back failure must be observable and actionable | ⚠️ | 原文档提到了错误码，但未明确"silent downgrade is an architecture violation" |
| 10 | New cloud API/event schemas are independently versioned | ⚠️ | 原文档未明确 schema 版本化策略 |

**订正建议**：在 §5 Workers API 契约前增加一节"§15 对齐声明"，逐条说明本方案如何满足 10 条硬边界。

### 不对齐 2：CLOUD-COLLABORATION-DELIVERY.md §7 的载荷字段清单未完整对齐 ⚠️

`CLOUD-COLLABORATION-DELIVERY.md §7.1` 定义了必需字段，§7.2 定义了禁止字段。原文档 §5.3.1 的 `POST /leads` 请求体未完整列出所有必需字段：

| 字段 | SSOT 要求 | 原文档是否包含 |
|---|---|---|
| `schemaVersion` | 必需 | ❌ 未包含 |
| `idempotencyKey` | 必需 | ✅ |
| `workspaceId` | 必需 | ❌ 未包含（隐含在 Bearer token 中） |
| 本地稳定引用 ID | 必需 | ✅ (`localRefId`) |
| 公司、规范化域名 | 必需 | ✅ |
| 联系人、规范化邮箱 | 必需 | ✅ |
| 评分与证据摘要 | 必需 | ✅ |
| 邮箱验证等级及人工例外记录 | 必需 | ❌ 未包含 |
| `approvalId`、审批人、审批时间、`draftVersion` | 必需 | ❌ 未包含（这些应在 `/approve` 端点，但原文档未明确） |
| 经批准的主题和正文 | 必需 | ✅ (`aiEmail`) |
| `campaignId`、`sequenceStage` | 必需 | ❌ 未包含 |

**订正建议**：完善 §5.3.1 的请求体字段，确保与 SSOT §7.1 完全一致。

### 不对齐 3：AUTH-STANDARDS.md §7.4 的 Premium 功能描述需更新 ⚠️

`ARCH-STANDARDS.md §7.4` 明确列出：
> "Premium and Enterprise exclusively include remote commercial capabilities:
> - **n8n cloud email automation**
> - cloud send and verification chain
> - team collision detection
> - team dashboard and collaborative visibility"

**问题**：移除 N8N 后，第一条需更新为"Cloudflare cloud email automation"或"Cloudflare Workers email automation"。

**订正建议**：Phase 0 中增加"更新 ARCH-STANDARDS.md §7.4 与 §8"任务。

### 不对齐 4：高级版云端功能梳理的 6 阶段立项路径未对齐 ⚠️

`KONE-V1.3-高级版云端功能模块深度梳理-2026-09-25.md §6.2` 列出了 6 个阶段（A-F）：

| 阶段 | 内容 | 原文档对应 |
|---|---|---|
| A. 契约先行 | 三态字典 + 最小化载荷 schema + 幂等键 | §4 D1 Schema（部分） |
| B. 本地审批 | `pending_approval` 7 条件 + `ApprovalRecord` + 草稿版本 | Phase 3（P3-1/P3-2） |
| C. 云端门禁 | 10 步 Fail-Closed + 稳定错误码 | Phase 3（P3-1/P3-3） |
| D. 投递与事件 | 队列、provider 适配、Webhook 验签+时间窗+去重、事件审计表 | Phase 2（P2-1~P2-8） |
| E. 回写与 UI | 跨端状态回写 + UI 7 项必备状态 | Phase 1-2（部分） |
| F. 发布门禁 | §13 全部 10 条 + 制品证据 | 未明确对应 |

**问题**：原文档的 Phase 1-4 与 SSOT 的 6 阶段不完全对齐，存在跳跃和遗漏。

**订正建议**：重新映射原文档的 Phase 1-4 到 SSOT 的 6 阶段，确保每个 SSOT 阶段都有对应的实施任务。

---

## 四、过度简化（需细化）

### 简化 1：D1 无 Realtime 的替代方案过于简化 ⚠️

**原文档声明**（§2.3）：
> "Durable Object 是 Cloudflare 唯一能同时保证有序性和实时性的方案"

**问题**：
- Cloudflare 还有 **Websocket** API（Workers + `new WebSocket()`）和 **R2 + Object Notifications** 方案；
- Durable Object 的免费额度有限（每账户基础量 + 按用量付费），大规模场景可能成为成本瓶颈；
- 30 秒轮询作为兜底方案的延迟是否可接受？未评估。

**订正建议**：
- 补充对比 Durable Object vs Websocket vs 轮询的 trade-off；
- 明确免费额度限制（Workers Free: 100,000 DO invocations/day, 1 GB RAM/DO instance）；
- 给出明确的推荐方案与降级策略。

### 简化 2：Resend 集成复杂度低估 ⚠️

**原文档声明**（§7）：
> "Resend 作为可选通道"

**问题**：
- Resend 域名验证需要 SPF/DKIM/DMARC 配置（DNS 记录），不是简单的 API Key 配置；
- Resend Free Tier 的 100 封/日限制**不是团队级别的，而是发件域名级别的**——如果多个团队共用一个域名，配额共享；
- Resend 的 Webhook 需要 HTTPS 端点 + 签名验证，不是简单的 POST 接收；
- 原文档未提及 Resend 的 **bounce 分类**（temporary vs permanent）与 **complaint** 处理细节。

**订正建议**：
- 补充 Resend 域名验证步骤（SPF/DKIM/DMARC DNS 记录配置）；
- 明确配额是按发件域名计算，非团队级别；
- 补充 Webhook 签名验证的具体算法（HMAC-SHA256 with `X-Resend-Signature` header）。

### 简化 3：Phase 1 的时间估算可能偏短 ⚠️

**原文档声明**（§13 Phase 1）：
> "1-2 周"

**问题**：
- Phase 1 涉及：新建 monorepo、D1 schema 实现、Worker API 实现、Pages 看板实现、本地 service 实现、设置 UI 实现、部署配置、端到端测试；
- 这是 **6 个独立任务**，每个都需要设计 + 实现 + 测试；
- 1-2 周（5-10 个工作日）对于一个人来说是 **极度紧张** 的；
- 如果需要 code review、文档编写、CI/CD 配置，实际可能需要 3-4 周。

**订正建议**：
- 将 Phase 1 时间估算修正为 **3-4 周**（单人）或 **2-3 周**（双人并行）；
- 明确每个子任务的时间估算（如 D1 schema: 2 天，Worker API: 5 天，Pages: 3 天等）。

### 简化 4：数据迁移策略过于简化 ⚠️

**原文档声明**（§12.2）：
> "提供一次性数据导出脚本（Supabase→D1）"

**问题**：
- Supabase 使用 Postgres，D1 使用 SQLite——**SQL 语法差异**需要处理；
- Supabase 有 RLS 策略，D1 没有——**权限模型迁移**需要设计；
- Supabase Realtime 有 WebSocket 连接，D1 没有——**实时连接迁移**需要处理；
- 迁移期间如何保证 **数据一致性**（不丢数据、不重复写入）？

**订正建议**：
- 补充迁移策略：双写期（同时写 Supabase 和 D1）→ 读切换 → 验证 → 清理；
- 明确 SQL 语法转换清单（Postgres → SQLite）；
- 明确迁移验证方法（行数对比、抽样校验、业务逻辑测试）。

### 简化 5：测试策略缺失 ⚠️

**原文档声明**：未提及测试策略。

**问题**：
- Cloudflare Workers 使用 Vitest 测试，与本地 Kone AI 的测试框架不同；
- D1 测试需要使用 `wrangler d1 execute --local` 或 miniflare；
- Webhook 测试需要 mock Resend API；
- 端到端测试需要完整的部署环境。

**订正建议**：在 §13 执行计划中增加测试策略：
- Worker 单测（Vitest + miniflare）；
- D1 集成测试（wrangler d1 execute --local）；
- Webhook mock 测试（nock 或 mock server）；
- 端到端冒烟测试（部署后验证）；
- 明确测试覆盖率目标（如 Worker 核心逻辑 ≥ 80%）。

---

## 五、逻辑一致性检查

### 一致性 1：Phase 0 的"零风险"声明与实际不符 ⚠️

**原文档声明**（§0）：
> "用户明确指令'完全放弃 N8N'落地成本极低（1 个文件 + 1 处注释）"

**实际**：如错误 1 所示，N8N 足迹横跨 8 个文件、2,306 行代码、65 处引用。**这不是"零风险"**——涉及 UI 组件删除、配置 schema 修改、代理逻辑修改、帮助文档更新、单测同步。

**订正建议**：将 Phase 0 风险从"零风险"修正为 **中低风险**，时间从"1-2 天"修正为 **2-3 天**。

### 一致性 2：本地 SMTP 保留与"云端发送"的关系未明确 ⚠️

**原文档声明**（§7.1）：
> "双通道设计（本地 SMTP 保留 + Resend 兜底）"

**问题**：
- 如果本地 SMTP 保留为主通道，那 Cloudflare Cron 发送的触发条件是什么？
- 什么时候走本地 SMTP，什么时候走 Resend？决策逻辑在哪里？
- 如果用户只配置了本地 SMTP，Cloudflare 层的 Cron 是否还需要发送？

**订正建议**：明确决策逻辑：
- 用户配置 `sendChannel='local_smtp'` → 本地 Email Agent 发送，Cloudflare 仅做台账记录；
- 用户配置 `sendChannel='resend'` → Cloudflare Cron 触发 Resend 发送；
- 用户配置 `sendChannel='auto'` → 优先本地 SMTP，失败时降级到 Resend；
- 明确决策点位置（本地 `email-agent.ts` vs Cloudflare Worker）。

### 一致性 3：审批流缺失阶段的处理未明确 ⚠️

**原文档声明**（§12.2）：
> "审批流缺失阶段（Phase A 已确认 P0 已清零，但云端审批是新能力）"

**问题**：
- 如果 Phase 1 不实现审批流，那本地推送的线索状态是什么？
- `leads.status` 字段在 Phase 1 中是否直接设为 `'approved'`？
- 如果跳过审批直接入队，是否违反 `CLOUD-COLLABORATION-DELIVERY.md §5` 的"本地待审批准入"要求？

**订正建议**：明确 Phase 1 的审批策略：
- Phase 1：本地审批（现有 UI）→ 云端直接设为 `'approved'`（跳过云端二次审批）；
- Phase 3：实现云端审批流，`leads.status` 经历 `'pending_approval'` → `'approved'` 完整流程；
- 明确声明 Phase 1 的简化策略是**过渡方案**，最终需实现完整审批流。

---

## 六、审查结论

### 总体评估

| 维度 | 评级 | 说明 |
|---|---|---|
| **方向正确性** | ✅ 正确 | Cloudflare 迁移方向与 SSOT 一致，本地保留、云端增量的定位正确 |
| **事实准确性** | ⚠️ 有严重错误 | N8N 足迹低估 15 倍，Phase 0 工作量严重低估 |
| **SSOT 对齐** | ⚠️ 有遗漏 | 与 ARCH-STANDARDS §15、CLOUD-COLLABORATION §7、STATE-MACHINES §8 存在不对齐 |
| **完整性** | ⚠️ 有重大遗漏 | 对客口径风险、NO-GO 状态声明、测试策略、迁移策略缺失 |
| **可行性** | ✅ 可行 | 技术方案整体可行，但时间估算偏乐观 |
| **严谨性** | ⚠️ 需提升 | 多处过度简化，需细化到可执行级别 |

### 必须订正项（按优先级）

| # | 项 | 优先级 | 工作量 |
|---|---|---|---|
| 1 | N8N 足迹完整清单与 Phase 0 工作量修正 | P0 | 1 天 |
| 2 | 对客口径风险（Phase -1） | P0 | 0.5 天 |
| 3 | 云端闭环 NO-GO 状态声明 | P0 | 0.5 天 |
| 4 | STATE-MACHINES §8 禁止写法校验 | P0 | 0.5 天 |
| 5 | ARCH-STANDARDS §15 对齐声明 | P1 | 1 天 |
| 6 | CLOUD-COLLABORATION §7 载荷字段对齐 | P1 | 0.5 天 |
| 7 | ARCH-STANDARDS §7.4 更新任务 | P1 | 0.5 天 |
| 8 | 6 阶段立项路径对齐 | P1 | 1 天 |
| 9 | D1 Realtime 替代方案细化 | P2 | 0.5 天 |
| 10 | Resend 集成复杂度补充 | P2 | 0.5 天 |
| 11 | Phase 1 时间估算修正 | P2 | 0.5 天 |
| 12 | 数据迁移策略细化 | P2 | 1 天 |
| 13 | 测试策略补充 | P2 | 1 天 |

### 下一步建议

1. **立即执行**：订正 P0 项（1-4），确保基础事实准确；
2. **本周完成**：订正 P1 项（5-8），确保与 SSOT 完全对齐；
3. **实施前完成**：订正 P2 项（9-13），确保执行计划可落地；
4. **用户拍板**：订正后的文档需用户确认，方可进入实施阶段。

---

## 附录：审查方法论

1. **读取全部 10 份规范文档**：ARCH-STANDARDS、STATE-MACHINES、CLOUD-COLLABORATION-DELIVERY、AGENTS、kone-PRD、PROVIDER-CAPABILITY、METHODOLOGY-NORTHSTAR、高级版云端功能梳理、架构红线核验、上线前必要优化梳理；
2. **逐条交叉验证**：原文档的每处声明都需找到对应的规范依据；
3. **grep 取证**：N8N 足迹、代码行数、引用数等关键数据均通过 grep 统计；
4. **逻辑一致性检查**：检查各阶段之间的依赖关系、决策逻辑、状态转换是否自洽；
5. **完整性检查**：对照 SSOT 的完整约束，检查是否有遗漏。

---

*本报告为审查与订正建议，未改动原执行计划文档。订正需用户确认后执行。*
