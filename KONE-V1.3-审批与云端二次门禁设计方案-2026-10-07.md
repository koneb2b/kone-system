# KONE V1.3 · 审批 → 云端二次门禁 设计方案

> 文档性质：**设计方案（待确认，未实现）**。本文件不含任何代码改动。
> 日期：2026-10-07 ｜ 状态：**草案 v1，待评审**
> 依据协议：`AGENTS.md`「Local-Cloud Collaboration Change Protocol」第 1–9 条
> 领域真相：`CLOUD-COLLABORATION-DELIVERY.md`（§2/§5/§6/§7/§8/§9）
> 产品真相：`kone-PRD.md §5.1`、`§5.1.1`、`§5.1.2`
> 宪法依据：`AGENTS.md` 第 5 条 —— *"A high score, staged Agent task or `cloud_send` feature never authorizes delivery. Approval plus server-side second-gate success is mandatory."*

---

## 一、问题陈述

### 1.1 缺口
`AGENTS.md` 宪法第 5 条要求「审批 + 服务端二次门禁」是投递的**必要条件**。
但现状是：**这条宪法级约束在代码中无实现**——高分线索可经 `queueOutreach` 直达投递队列，
中间没有任何审批记录校验，也没有服务端二次门禁的 ⑤⑥⑦⑧⑨ 步。

这属于**合规性缺陷**而非普通功能缺失：它意味着「宪法写了、代码没做」，属于纸面合规。

### 1.2 为什么现在必须补
- `kone-PRD §5.1` 第 3/4 条把「有效审批记录 + 草稿版本」定义为云端发送的**硬前提**；
- `CLOUD-COLLABORATION-DELIVERY.md §8` 把审批校验列为云端 10 步 Fail-Closed 门禁的第 7 步；
- 当前 `queueOutreach` 仅校验 `lead.status ∈ {approved, queued}`（`worker.ts:588`），
  而 `approved` 在本地**无任何设置点**（本地 status 枚举根本不含该值）——
  即该分支实际是**死代码**，真实路径依赖 `queued` 的宽松放行。

---

## 二、现状基线（代码取证）

> 调研结论：**schema 层已按规范预留，业务逻辑层几乎全缺**。这显著降低了实现风险——
> 无需新建表，只需补逻辑与契约。

### 2.1 已具备（可复用，勿重建）

| 能力 | 位置 |
|---|---|
| `approvals` 表（含 `decision CHECK(approved\|rejected\|needs_revision)`） | `kone-cloud/migrations/001_init.sql:89-103` |
| `leads.approval_id` / `leads.draft_version` 列 | `001_init.sql:74-75` |
| `events.type` 已含 `approval.created` / `lead.approved` / `lead.rejected` | `001_init.sql:147-151` |
| `delivery_quota` / `sync_tokens` 表 | `001_init.sql:185` / `:198` |
| 云端门禁 ①身份鉴权 ②租户过滤 ③Schema ④幂等 ⑩建队列+审计 | `worker.ts:171` / `:568,581` / `:178` / `:566` / `:621` |
| 撞单/抑制校验逻辑（现仅用于 `createLead`） | `worker.ts:285-305` |
| 本地熔断（按 host） | `electron/utils/http-client.ts:19-86` |
| 本地日配额 | `electron/services/agent-service.ts:953,1297` |
| 云端看板已能展示 `pending_approval` 标签 | `kone-cloud/pages/src/components/LeadTable.tsx:6` |

### 2.2 需新建

| 缺口 | 位置 |
|---|---|
| 本地 leads 状态机扩展 + `draftVersion` 字段 | `src/store/leads-store.ts:25`（状态枚举）、`:51-99`（LeadItem） |
| 本地审批 UI（待审批队列 / 批准 / 驳回） | `src/components/` 下无 |
| 审批 IPC 通道 + 契约 + preload | `channels.ts` / `ipc-contracts.ts` / `preload/index.ts` 三处均无 |
| `ApprovalRecord` 本地实体 | 无 |
| 上云载荷补 `approvalId` / 审批人 / 审批时间 / `draftVersion` / `emailVerificationGrade` / `campaignId` | `cloudflare-service.ts:355`（现仅 5 字段） |
| 云端门禁 ⑤撞单 ⑥抑制 ⑦审批 ⑧邮箱等级 ⑨配额熔断 | `worker.ts:549-648` |
| 云端 `approvals` 写入 + `approval.created` 事件写入 | 无代码 |
| `delivery_quota` 配额/熔断**执行** | 表已建，`worker.ts` 未引用 |
| 云端将 lead 置为 `pending_approval` 的流转 | 现仅插 `'scored'`（`worker.ts:343`） |

---

## 三、核心设计

### 3.1 三态分离模型（对齐 `kone-PRD §5.1` 第 5 条）

规范要求「业务状态、投递状态、跟进状态必须分离」。现状是本地用**一个** `status` 字段
兼表三者，这是必须先解耦的结构性问题。

```
LeadItem
├── status          : LeadStatus        // 业务状态（本方案扩展）
├── deliveryStatus  : OutreachStatus    // 投递状态（由云端事件回写，新增）
└── followupStatus  : FollowupStatus    // 跟进状态（新增，V1.4 可延后）
```

**设计取舍**：本轮**只落地前两个**，`followupStatus` 标记为后续增量。
理由：跟进状态与投递链路无耦合，不阻塞宪法第 5 条的合规闭环；
一次性引入三维度会让状态机复杂度过高，违反"最小安全变更"。

### 3.2 本地 `LeadStatus` 渐进扩展（向后兼容）

```
现有（保留，语义不变）: new | contacting | replied | archived
新增（仅高级版云端流程使用）:
    scored | pending_approval | approved | queued | sent | rejected | failed | suppressed
```

**兼容规则**：
- 旧值语义**零变化**——`contacting` 仍是「本地人工跟进中」，不参与云端审批链；
- 新增值是**纯增量**，旧数据不需要迁移（不存在的状态不会被读取）；
- 迁移映射表（写入 `STATE-MACHINES.md`）：

| 旧值 | 新值 | 说明 |
|---|---|---|
| `new` | `new` | 不变 |
| `contacting` | `contacting` | 保留为**纯本地**语义，不映射为 `approved` |
| `replied` | `replied` | 不变 |
| `archived` | `archived` | 不变 |
| —（新增） | `scored` | 搜索完成、已评分 |
| —（新增） | `pending_approval` | 满足 `§5` 七项准入条件，进入待审批队列 |
| —（新增） | `approved` / `rejected` | 人工决策结果 |
| —（新增） | `queued` / `sent` | 云端二次门禁通过后回写 |

> ⚠️ **关键约束**：`approved` 只表示「人工批准」，**不表示云端已接受**（规范 §2.1）。
> 因此 `approved` 不得作为投递放行条件——投递必须依赖云端门禁第 ⑦ 步的审批记录校验。

### 3.3 契约边界（三个独立版本化边界）

规范要求「local IPC and cloud API/Event Schema are separate versioned boundaries」。据此设计：

**边界 1 · 本地 IPC**（renderer ↔ main）
```ts
// 新增通道（命名遵循既有 SSOT channels.ts 规范）
APPROVAL.LIST_PENDING   : 'approval:list-pending'    // 待审批队列
APPROVAL.GET_RECORD     : 'approval:get-record'      // 单条审批记录
APPROVAL.SUBMIT_DECISION: 'approval:submit-decision' // 批准/驳回/退回修订
APPROVAL.LIST_HISTORY   : 'approval:list-history'    // 历史审批（不可覆盖）
```

```ts
// 契约（src/shared/ipc-contracts.ts）
export type ApprovalDecision = 'approved' | 'rejected' | 'needs_revision'

export type ApprovalRecord = {          // 对齐 CLOUD §6 字段
  approvalId: string
  workspaceId: string
  leadId: string
  localRefId: string
  approverId: string
  decision: ApprovalDecision
  approvedAt: string
  draftVersion: number
  emailVerificationGrade: string
  manualExceptionReason?: string | null
  riskSnapshot: string
}

export type SubmitDecisionPayload = {
  leadId: string
  decision: ApprovalDecision
  draftVersion: number       // 必须回传当前草稿版本，防「旧批准授权新草稿」
  manualExceptionReason?: string
  approverId: string
}
```

**边界 2 · 云端 API**（main ↔ Worker）
```
POST /v1/approvals            # 写入审批记录（不可覆盖）
GET  /v1/approvals?leadId=    # 查询
POST /v1/outreach/queue       # 既有，载荷扩展（见 §3.5）
```

**边界 3 · Event Schema**（Worker → 本地回写）
```
approval.created   （枚举已存在，需补写入）
lead.approved      （枚举已存在，需补写入）
lead.rejected      （枚举已存在，需补写入）
```
事件载荷统一含 `workspaceId` / `leadId` / `approvalId` / `draftVersion` / `occurredAt`，
追加式写入、不可删除（规范 §9）。

### 3.4 云端二次门禁 10 步 —— 补齐方案

规范 §8 要求 Fail-Closed。现状 ①②③④⑩ 已有，需补 ⑤⑥⑦⑧⑨：

| 步 | 校验 | 实现要点 | 失败错误码 |
|---|---|---|---|
| ⑤ | 撞单 / 保护期 | 复用 `createLead` 的查询（`worker.ts:295-305`），改为按 `normalized_domain` + `workspace_id` 查 `companies.protection_until` | `COMPANY_CONFLICT` |
| ⑥ | 全局抑制 | 复用 `createLead` 的抑制查询（`:285-293`），按 `normalized_email` 匹配 `suppressions` | `SUPPRESSED` |
| ⑦ | **审批记录 + 审批人 + 草稿版本** | 查 `approvals` 表：存在 `decision='approved'` 且 `draft_version` **等于**载荷 `draftVersion` 的记录；否则拒绝 | `APPROVAL_REQUIRED` / `DRAFT_VERSION_MISMATCH` |
| ⑧ | 邮箱等级 / 人工例外 | 查 `contacts.email_verification_grade`；低等级需有 `manual_exception_reason` | `EMAIL_GRADE_INSUFFICIENT` |
| ⑨ | 域名健康 / 账户授权 / 日配额 / 熔断 | 读写 `delivery_quota`（表已建未用）；超配额返回可行动建议 | `QUOTA_EXCEEDED` |

**顺序不可调换**：⑦ 必须在 ⑤⑥ 之后（避免用无效审批做撞单探测）、在 ⑨ 之前（避免为无效请求消耗配额）。

**幂等交互**：门禁 ④ 的去重键（`outreach_${leadId}_stage${stage}`，见 `CHANGELOG [1.3.15]`）
必须保留 —— 门禁失败**不写入** `outreach`，故重试不会污染唯一键。

### 3.5 上云载荷扩展（对齐规范 §7.1）

现状仅 5 字段，需补齐至规范要求的必需字段集：

```ts
// 现状（cloudflare-service.ts:355）
{ leadId, subject, body, scheduledAt, sequenceStage }

// 目标
{
  schemaVersion,            // 新增，对齐云端 Schema 校验
  idempotencyKey,           // 新增
  workspaceId,              // 新增（云端现从 token 推导，改为显式校验）
  localRefId,               // 新增
  leadId, campaignId,       // campaignId 新增
  sequenceStage,
  subject, body,            // 经批准的主题与正文
  approvalId,               // 新增 —— 门禁 ⑦ 的依据
  approverId, approvedAt,   // 新增
  draftVersion,             // 新增 —— 门禁 ⑦ 的依据
  emailVerificationGrade,   // 新增 —— 门禁 ⑧ 的依据
  scheduledAt,
}
```

**禁止字段**（规范 §7.2，需在实现时加**负向断言测试**）：原始 HTML、未准入候选、
API Key/SMTP 密码/Cookie/Session、本地文件路径。

---

## 四、数据模型与迁移

### 4.1 云端 migration `005_approval_gate.sql`
- **无表结构变更**（`approvals` / `leads.approval_id` / `delivery_quota` 均已存在）；
- 仅补**索引**以支撑门禁查询性能：
  ```sql
  CREATE INDEX IF NOT EXISTS idx_approvals_lead_decision
    ON approvals(workspace_id, lead_id, decision, approved_at DESC);
  ```
- **无数据迁移**（现有 outreach 记录不回填审批 —— 它们是历史数据，回填会造成"伪造审批"）。

### 4.2 本地迁移
- `LeadItem` 新增字段全部为**可选**（`deliveryStatus?` / `approvalId?` / `draftVersion?`），
  旧持久化数据反序列化后为 `undefined`，不触发校验、不报错；
- `LeadStatus` 扩展为联合类型，**不改动既有值**；
- 迁移完成前，新增状态值仅由审批流写入，不参与既有 UI 分支。

### 4.3 向后兼容性声明
| 场景 | 行为 |
|---|---|
| 旧版本本地数据 | 正常读取，新字段 `undefined` |
| 旧版本调用新云端 | 云端门禁 ⑦ 拒绝（缺 `approvalId`）→ 需本地同步升级。**这是有意的 Fail-Closed** |
| 新版本本地调用旧云端 | 旧云端忽略未知字段，行为不变（但无门禁保护）→ 见 §7 灰度策略 |

---

## 五、回滚方案

| 层级 | 回滚动作 | 影响 |
|---|---|---|
| 本地 UI | 隐藏审批入口（feature flag） | 退回「无审批」状态，但**不影响既有搜索/草稿** |
| 本地 IPC | 通道保留、渲染层不调用 | 无副作用 |
| 云端门禁 | `env.APPROVAL_GATE_ENABLED=false` 短路 ⑦⑧⑨ | **风险**：等于关闭宪法约束，仅限紧急故障时使用，且**必须记审计事件** |
| 云端 schema | 005 只加索引，回滚 = `DROP INDEX` | 零数据风险 |

**回滚原则**：门禁是**加法**，回滚只应"关闭加法"，不得回滚已产生的审批记录（审计不可删）。

---

## 六、测试策略（Change Protocol 第 4 条要求）

### 6.1 负向授权测试（必做，这是本方案的核心防线）
| 用例 | 期望 |
|---|---|
| 无 `approvalId` 请求 queue | `APPROVAL_REQUIRED`，**不创建** outreach 行 |
| `approvalId` 存在但 `decision='rejected'` | `APPROVAL_REQUIRED` |
| `draftVersion` 与审批记录不一致（草稿已改） | `DRAFT_VERSION_MISMATCH` —— 覆盖规范"旧批准不得授权新草稿" |
| 命中抑制名单 | `SUPPRESSED`，优先级高于审批 |
| 撞单保护期内 | `COMPANY_CONFLICT` |
| 邮箱等级不足且无人工例外 | `EMAIL_GRADE_INSUFFICIENT` |
| 超日配额 | `QUOTA_EXCEEDED` |
| 跨 workspace 用他人 `leadId` | ②租户隔离拒绝，**不得泄露**该 lead 是否存在 |

### 6.2 事件与幂等测试
| 用例 | 期望 |
|---|---|
| 同一 `idempotencyKey` 重复 queue | 返回既有 id，`idempotent:true`，不重复建行 |
| 门禁失败后重试（修复后成功） | 可成功，不因失败残留而永久阻塞 |
| `approval.created` 事件写入 | 追加式，重复提交不产生重复事件 |
| 事件不可删除 | 无 DELETE 语句可作用于 `events`（配合新增门禁扫描） |

### 6.3 门禁顺序测试
- 构造「同时命中 ⑤⑥⑦」的请求，断言返回的是 **⑤** 的错误码（证明顺序不可调换）。

### 6.4 既有门禁不得回归
- `npm run verify:consistency`（含 `verify:cloud-safety` 危险 SQL 谓词检查）必须全绿；
- 新增的 `approvals` 写入语句必须带 `workspace_id` 谓词（否则被安全门禁拦截）。

---

## 七、验收证据清单

| # | 证据 | 形式 |
|---|---|---|
| 1 | 门禁 10 步逐条实现 | 代码 + 每条对应测试 |
| 2 | 负向授权测试 8 例全绿 | 测试报告 |
| 3 | 事件幂等测试 4 例全绿 | 测试报告 |
| 4 | 契约一致性 | `verify:consistency` 三子门禁全绿 |
| 5 | 上云载荷字段对齐 §7.1 | 契约测试（断言必需字段存在 + 禁止字段不存在） |
| 6 | 状态机文档同步 | `STATE-MACHINES.md` 更新 + `CLOUD-COLLABORATION-DELIVERY.md §13.1` 闭环记录 |
| 7 | 端到端 | 本地审批 → 上云 → 门禁 → 队列 的人工冒烟（干净机器） |

---

## 八、分阶段实施建议

> 原则：**每阶段可独立验收、可独立回滚**，不做一次性大爆炸。

**阶段 1（云端门禁 + 契约，无 UI）**
- 补门禁 ⑤⑥⑦⑧⑨；新增 `POST /v1/approvals`；补事件写入；`005` 索引。
- 验收：负向授权测试 8 例 + 门禁顺序测试。
- 风险：低（纯加法，旧客户端会被门禁拒绝 → 需与阶段 2 同步发布）。

**阶段 2（本地审批流 + 载荷补齐）**
- `LeadStatus` 扩展、`LeadItem` 加字段、审批 IPC 三件套、上云载荷补齐。
- 验收：契约测试 + 本地单测。
- 风险：中（触及本地状态机，需回归搜索/线索管理）。

**阶段 3（审批 UI）**
- 待审批队列、证据与风险展示、批准/驳回、草稿版本提示。
- 验收：UI 冒烟 + `kone-PRD §5.1` 第 8 条要求的入口完整性。

**阶段 4（配额/熔断执行）**
- 激活 `delivery_quota` 读写。
- 可延后：不阻塞宪法第 5 条合规闭环（⑦ 是核心）。

---

## 九、风险与取舍

| 风险 | 取舍 |
|---|---|
| **本地状态机扩展可能影响既有线索管理** | 采用纯增量（旧值语义零变化）+ 新状态仅审批流写入 |
| **云端门禁上线会拒绝旧客户端** | 这是**有意的 Fail-Closed**；须与本地同步发布，不可灰度放宽 |
| **`delivery_quota` 从未使用，首次激活需谨慎** | 放在阶段 4，先只读不拦截，观察一周再启用硬拦截 |
| **审批 UI 可能让用户觉得"多一步"** | 这是宪法要求的**用户可感知价值**（防误发），非工程洁癖；UI 需做到"一键批准"降低摩擦 |
| **`followupStatus` 暂不做** | 与宪法合规无关，避免一次引入三维度状态导致复杂度过高 |

---

## 十、待确认事项（请裁决）

1. **审批人身份**：`approverId` 取自本地登录态还是云端 workspace 成员？当前本地有 `AUTH.GET_SESSION`，
   云端有 workspace 概念——两者如何对齐？
2. **是否允许"批量批准"**：规范未禁止，但批量会削弱"逐条人工确认"的初衷。建议**不支持**。
3. **门禁 ⑨ 的配额来源**：按 workspace 日配额还是按发信账户？`delivery_quota` 表结构需确认。
4. **阶段 1 与阶段 2 是否必须同版本发布**：若允许分离，需提供临时兼容开关（有合规风险，不推荐）。
5. **本轮是否立即进入实现**：本方案为草案，请确认后再动代码。

---

> **本方案不改变任何现有行为**，仅作为实现前的评审基线。
> 确认后建议按阶段 1 → 4 顺序实施，每阶段独立提交、独立验收。
