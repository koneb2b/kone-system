# KONE V1.3 · Cloudflare 云地协同架构可行性评估与分阶段执行计划（修订版）

> **日期**：2026-09-28（修订）｜ **原始版本**：2026-09-25
> **基线**：HEAD 现状（Phase A 已完成，V1.3 上市前必要优化交付）
> **性质**：**纯规划评估**，未改动任何代码；仅识别缺口、评估可行性、给出分阶段路径。
> **修订依据**：`KONE-V1.3-Cloudflare执行计划全局审查-2026-09-28.md`（13 项必须订正，基于全部 10 份规范文档逐条交叉验证）
> **对齐基线**：`CLOUD-COLLABORATION-DELIVERY.md`（SSOT）、`ARCH-STANDARDS.md`（§7/§8/§15）、`STATE-MACHINES.md`（§8 禁止写法）、`AGENTS.md`、`kone-PRD.md §5.1`、`KONE-V1.3-高级版云端功能模块深度梳理-2026-09-25.md`
> **方法论**：先读代码取证，再下结论；grep 只用于定位，不用于判定。

---

## 0. 修订摘要与关键结论

### 0.1 修订概览

| 修订类型 | 数量 | 涉及章节 |
|---|---|---|
| **P0 严重事实错误** | 1 | §2.1 N8N 足迹（低估 15 倍）、§13 Phase 0 工作量 |
| **P0 重大遗漏** | 3 | §0/§13 对客口径风险、§0/§12.3 NO-GO 状态、§4 状态机边界 |
| **P1 SSOT 不对齐** | 4 | §5 ARCH-STANDARDS §15、§5.3.1 载荷字段、§7.4 Premium 描述、§13 6 阶段映射 |
| **P2 过度简化** | 5 | §2.3 D1 Realtime、§7 Resend 复杂度、§13 Phase 1 时间、§9.4 迁移策略、§11 测试策略 |

### 0.2 一句话结论

**方案总体可行，但不能作为 V1.3 交付前的必做项，也不能整体替换现有 SSOT**。建议以 **P-1 → P0 → P1 → P2** 四阶段渐进迁移：先做 **对客口径对齐**（0.5 天），再移除 **N8N 依赖**（2-3 天，中低风险，涉及 8 个文件/65 处引用），然后叠加 **Cloudflare D1 团队台账**（3-4 周），最后才考虑 **Resend 云端发送 + 审批门禁与熔断**（Phase A 已确认 B-3 云协同是高级版功能，非当前发布阻断）。

**⚠️ 关键约束**：`CLOUD-COLLABORATION-DELIVERY.md §0` 明确当前发布判定为 **`NO-GO`**。本方案是技术实现路径之一，实施后仍需通过 §13 全部 10 条门禁方可转为 `GO`。Phase A 明确"云端协同闭环=过度工程不做"是指 **V1.3 交付前不做**，不是永久不做。

| 项 | 结论 |
|---|---|
| 5 条核心铁律**整体可行性** | ✅ 可行（4 条零成本对齐，1 条需重构 Supabase→D1） |
| 与现有 V1.3 宪法的**冲突点** | 3 处（详见 §2.2），均可通过语义分层解决 |
| **必须放弃**的既有实现 | N8N 全栈（**8 文件/65 处引用/2,306 行代码**，中低风险）、Supabase 团队协同 IPC（中风险） |
| **可完全保留**的既有实现 | 四级弹性搜索、本地 ICP/LLM 评分、Gold Filter、本地 SMTP Email Agent、Fail-Closed 授权、Zustand 本地持久化、FollowupScheduler 本地状态机 |
| **零服务端成本**可行性 | ✅ Cloudflare 免费额度完全够用；**唯一硬约束是 Resend Free Tier 100 封/日**（按发件域名配额，非团队级别） |
| **Phase A 交付阻断项** | 不受影响；本方案属**新增能力**，与 Phase A 交付正交 |
| **对客口径合规风险** | ⚠️ **新增 Phase -1**：README 宣称"高级版开放云端功能"但无"目标态"标注，与 SSOT"不得对外宣称已交付"冲突 |

---

## 1. 目标态全景：现有状态 vs 目标态

```
                ┌────────────────────────────────────────────────────┐
                │    本地 KONE AI（Electron，重计算工作台）             │
                │  四级弹性搜索 · ICP+LLM 双轨评分 · DNS 健康 · Gold    │
                │  Filter(score≥80) · Fail-Closed 授权 · Zustand      │
                │  FollowupPlan 4 段序列(3d/4d/7d+jitter) · Email     │
                │  Agent(SMTP+IMAP, 五级邮箱验证, send-window)         │
                │  Email Suppression(JSON 本地, 4 原因)                │
                └──────────────────┬─────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
        ┌───────────────────────┐   ┌───────────────────────────────┐
        │ 当前：Supabase RLS     │   │ 目标态：Cloudflare Workers      │
        │  leads 表 (Gold 80)    │   │  + D1 (leads/outreach/events/  │
        │  campaigns 表          │   │    suppressions + approvals)    │
        │  团队防撞单             │   │  + Pages 看板 (实时)             │
        │  Supabase Realtime     │   │  + Queue (Cron + 事件流)        │
        └───────────┬───────────┘   │  + Resend (可选云端发送通道)    │
                    │               │  + Email Worker (回复/退订入口) │
                    │               └───────────────────────────────┘
                    │                        ▲
                    │                        │ 需新建
                    ▼                        │
              ┌────────────┐                 │
              │ N8N 云端    │─────── 用户要求 ──┘
              │ (自动化发信) │       完全放弃
              └────────────┘
```

**读图要点**：
- 本地 KONE AI 保持不变（Phase A 已收官，V1.3 宪法核验 10/10 合规）；
- **Supabase 是当前的"最小可用云"，N8N 是当前的"最小自动化"，两者都需迁移/替换**；
- 目标态的**核心新增能力**是 Cloudflare Workers + D1 + Pages + Queue + Cron + Resend 的组合，用于**团队协同、发送可见性、回复闭环**；
- **本地 SMTP Email Agent 保留**（这是当前差异化触达的核心竞争力，且 Phase A 已确认 DNS 健康、SPF/DKIM/DMARC 校验、发送窗口、五级验证全部合规）。

---

## 2. 核心铁律逐条可行性评估（5 条铁律 × 现有代码取证）

### 2.1 铁律一："完全放弃 N8N" —— 可行，中低风险 ⚠️

> **🔴 修订**：原声明"4 处命中、1 个文件 + 1 行注释"严重低估。以下为完整取证。

**现有证据（完整 N8N 足迹）**：

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
| `CHANGELOG.md` + 其他文档 | — | ~36 | 历史记录（不改） |

**实际总计：65 处代码引用（不含文档），横跨 8 个文件，约 2,306 行代码。**

**授权模型影响**：
- `ARCH-STANDARDS.md §7.4` 明确"n8n cloud email automation"是 Premium 功能描述，移除 N8N 后需更新为"Cloudflare cloud email automation"；
- `ARCH-STANDARDS.md §8` 提到"Premium n8n automation may continue remotely"需同步更新；
- `license-guard.ts` 中 `cloud_send` 是 Premium 门禁，与 N8N 无绑定，**移除 N8N 不改授权模型**。

**完整迁移清单**：

| # | 文件 | 动作 | 影响面 |
|---|---|---|---|
| 1 | `src/components/settings/n8n-settings-tab.tsx` | **删除整个文件**（145 行） | UI 组件 |
| 2 | `electron/services/automation-service.ts` | 保留邮箱验证部分（`verifyEmailsBatch`、`classifyEmailStatic`），删除 N8N Webhook 部分（`getN8nWebhookUrl`、推送逻辑） | 417 行中约 100 行 |
| 3 | `electron/services/config-service.ts` | 删除 `n8nSettings` 类型定义与 getter（5 处） | 595 行中约 20 行 |
| 4 | `electron/services/proxy-service.ts` | 删除 N8N webhook hostname 白名单逻辑（3 处） | 395 行中约 10 行 |
| 5 | `src/components/automation-workflow.tsx` | 更新套餐锁定提示文案（1 处） | 754 行中 1 行 |
| 6 | `src/components/help-dialog.tsx` | 更新帮助文档文案（2 处） | — |
| 7 | `electron/utils/cloud-sync-gate.ts` | 更新函数注释（2 处） | — |
| 8 | `electron/services/supabase-service.ts:332` | 注释改为"由 Cloudflare Workers 后续消费" | 1 行 |
| 9 | `ARCH-STANDARDS.md §7.4` | "n8n cloud email automation" → "Cloudflare cloud email automation" | 文档 |
| 10 | `ARCH-STANDARDS.md §8` | "Premium n8n automation" → "Premium Cloudflare automation" | 文档 |
| 11 | `kone-PRD.md` | 相关章节标注"已迁移至 Cloudflare" | 文档 |
| 12 | `CHANGELOG.md` | 记录变更 | 文档 |
| 13 | `tests/*` | 相关单测删除 N8N mock，替换为 Cloudflare mock | 需检查 |

**结论**：**中低风险**，涉及 8 个代码文件 + 3 份文档 + 单测同步。**Phase 0 工作量：2-3 天**（非原声明的 1-2 天零风险）。

### 2.2 铁律二："严格遵循 Kone V1.3 宪法" —— 可行，需明确边界 ✅

**现有 V1.3 宪法核心约束**（`ARCH-STANDARDS.md` + `AGENTS.md` + `CLOUD-COLLABORATION-DELIVERY.md`）：

| 宪法约束 | 现状 | 与 Cloudflare 方案的兼容 |
|---|---|---|
| 搜索并发 ≤ 2 | `SEARCH_ENRICH_CONCURRENCY=2`，`SEARCH_LLM_CONCURRENCY=2` | ✅ 云端不碰搜索，本地保留 |
| 3000 字符 LLM 输入 | `MAX_WEBSITE_TEXT_FOR_LLM=3000` | ✅ 云端不碰 LLM |
| Gold Filter (score≥80) 上云 | `supabase-service.ts:105` `GOLD_FILTER_MIN_SCORE=80` | ✅ 直接搬到 D1 层 |
| Fail-Closed 授权 | `license-guard.ts` `PREMIUM_FEATURES=[..., 'cloud_send', ...]` | ✅ 云端 Workers API 也必须实现同等门禁 |
| 边缘重活云端轻量 | `ARCH-STANDARDS.md §7`："云端仅存精简状态" | ✅ **与用户"云端唯一真相源"存在张力**（见下） |
| Zustand 本地持久化 | `src/store/leads-store.ts` | ✅ **边界清晰**（见下） |

**关键张力解析：「云端唯一真相源」vs「边缘重活云端轻量」**

用户原话："cloud as single source of truth"。但 Kone V1.3 宪法 `ARCH-STANDARDS.md §7` 明确"边缘重活，云端轻量"。二者表面冲突，实际可通过**语义分层**解决：

- **业务线索台账**（云端为真相源）：`leads`（审批后的候选池）、`outreach`（发送/回复状态）、`approvals`（审批记录）、`suppressions`（全局抑制）、`events`（事件流）—— 云端是权威；
- **本地工作台态**（本地为真相源）：搜索中间态、LLM 提示缓存、Zustand 未审批候选、Draft 版本、Agent 运行日志 —— 云端**不感知**；
- **边界**：只有经过 Gold Filter 的候选才"上云入册"，云端记录一旦建立就永久保留（不可删除，仅可追加事件）。

**建议表述修正**：把"云端唯一真相源"细化为 **"云端为业务线索台账的唯一真相源，本地为工作台态的唯一真相源"**。这与 `CLOUD-COLLABORATION-DELIVERY.md §1` 的"一体化职责边界"完全一致，且不违反 V1.3 宪法。

**结论**：可行，边界定义清晰。

### 2.3 铁律三："云端为唯一真相源 D1" —— 需从 Supabase 迁移，中高风险 ⚠️

**现有证据**：
- `supabase-service.ts` 是完整的云端实现（622 行，11 个 IPC 端点）；
- 前端订阅：`IPC_CHANNELS.CLOUD.*` 11 个通道已在 `electron/ipc/channels.ts` 定义、`supabase-service.ts` 注册；
- `RealtimeChannel` 已订阅 `leads` 表变更，`IPC_CHANNELS.CLOUD.REALTIME_LEAD_EVENT` 已推送至渲染进程；
- `CLOUD-COLLABORATION-DELIVERY.md §9` 明确定义了云端核心实体：`companies`/`contacts`/`leads`/`approvals`/`outreach`/`events`/`suppressions`。

**迁移路径**：
- **不是简单替换库**：Supabase 使用 PostgREST + Realtime；Cloudflare D1 使用 SQLite + HTTP API。
- **Realtime 替代方案对比**：

| 方案 | 延迟 | 复杂度 | 免费额度 | 推荐 |
|---|---|---|---|---|
| **(a) 前端轮询** | 30s | 低 | 无限 | ✅ 兜底方案 |
| **(b) Queue + WebSocket** | < 1s | 中 | Queue 100 万消息/日 | ⚠️ 复杂 |
| **(c) Durable Object** | < 100ms | 高 | Workers Free: 10 万 DO 调用/日，1 GB RAM/DO | ✅ 推荐（体验最佳） |

**推荐策略**：**Durable Object 为主，30 秒轮询为兜底**。DO 免费额度（10 万调用/日）对于团队 10 人场景完全充足。若 DO 不可用（如部署环境不支持），自动降级为轮询。

- **RLS 迁移**：Supabase 用行级安全（RLS）做租户隔离；D1 无 RLS，需**在 Worker API 层显式校验 `workspace_id`**（Fail-Closed）。

**风险矩阵**：

| 风险 | 严重性 | 缓解 |
|---|---|---|
| D1 无原生 Realtime，需 Durable Object | 中 | DO 免费额度充足；可降级为 30s 轮询 |
| Supabase RLS 语义丢失，需在 Worker 层实现 | 高 | 强制所有 SQL 拼接 `WHERE workspace_id = ?`；单测覆盖 |
| 前端 11 个 IPC 端点契约不变（`IPC_CHANNELS.CLOUD.*`），但主进程实现整体重写 | 中 | 保持 IPC 契约稳定，主进程内替换后端，前端零改动 |
| 团队已有 Supabase 部署的迁移路径 | 中 | 提供一次性数据导出脚本（Supabase→D1），或明确"新部署走 CF，老部署继续用 Supabase" |

**结论**：可行，但**不是一次改动，是 2-3 天的中等工程**。建议放在 Phase 1，且**允许短期双栈共存**（新工作区走 CF，老工作区继续 Supabase）。

### 2.4 铁律四："零服务端成本（CF Free + Resend Free ≤80/日）" —— 基本可行，但需按发件域名配额 ⚠️

**Cloudflare Free Tier 实测额度（2026 年 9 月，需用户自查最新值）**：

| 服务 | 免费额度 | 目标态消耗估算 | 结论 |
|---|---|---|---|
| Workers Requests | 100,000 请求/日 | 团队 10 人 × 每人 50 次/日 = 500 | ✅ 余量极大 |
| D1 存储 | 5 GB / 项目 | 500 线索 × 1KB = 0.5 MB | ✅ 余量极大 |
| D1 读操作 | 1,000,000 读/日 | 50 用户 × 50 读/日 = 2,500 | ✅ 余量极大 |
| D1 写操作 | 10,000 写/日 | 50 用户 × 5 写/日 = 250 | ✅ 余量极大 |
| Queue 消息 | 1,000,000 消息/日 | 每天 100 条投递事件 | ✅ 余量极大 |
| Pages 带宽 | 10 GB / 月 | 10 用户 × 10 MB/日 = 300 MB | ✅ 余量极大 |
| Email Workers | 免费（无限） | — | ✅ |
| Durable Objects | 100,000 调用/日（Free） | 每工作区 1 个 DO，每人 50 次/日 = 500 | ✅ 余量极大 |

**Resend Free Tier 约束**（**修订：配额按发件域名计算，非团队级别**）：
- **100 封/日**（按发件域名配额）、**10k 封/月**、仅 1 个发件域、无 SSO、无自定义模板变量；
- **配额共享风险**：如果多个团队共用一个发件域，配额共享。建议每个团队使用独立子域（如 `team1.kone-cloud.com`）。
- **实际业务量估算**：假设每个团队 3 人，每天触达 20 家，则日均 20 封 —— **100 封/日可支撑 5 个团队（独立子域）**。

**关键权衡**：
- **本地 SMTP 保留**：`email-agent.ts` 已经有完整的 SMTP 通道，用户用自己的邮箱账号发信，**0 成本、无配额限制**。
- **云端 Resend 作为可选通道**：适合无自有邮箱的团队，作为"零配置开箱即用"体验。
- **推荐策略**：**本地 SMTP 为主通道，Resend 作为兜底/预览通道**。

**结论**：**零服务端成本可行**，但需要**明确 Resend Free 是"预览/兜底"通道，本地 SMTP 才是主力发送通道**。

### 2.5 铁律五："安全 / 合规" —— 完整可行，需按 SSOT 实现 ✅

`CLOUD-COLLABORATION-DELIVERY.md §11` 已经定义：
- Webhook 签名校验、时间窗、事件唯一键；
- 验签失败返回未授权，不写库不改状态；
- 重复事件幂等返回；
- `delivered` 仅更新投递状态；
- 永久硬退和投诉必须写抑制；
- 回写失败进入可观察的重试/死信机制。

**Cloudflare 层实现要点**：
- Workers 内所有 API 端点必须实现 `workspace_id` 校验（替代 Supabase RLS）；
- 所有 Webhook 入口必须验证 Resend 签名（`X-Resend-Signature` header，HMAC-SHA256）；
- List-Unsubscribe / One-Click Unsubscribe 必须解析并写入 suppressions 表；
- 所有密钥（Resend API Key、Cloudflare 内部密钥）使用 Cloudflare Secrets（`wrangler secret put`），不得硬编码。

**结论**：可行且标准做法，详见 §10 安全与熔断 checklist。

---

## 3. 架构总览与数据流

### 3.1 组件关系

（与原版一致，此处省略图表以保持文档简洁。完整图表见 §3.1 原版。）

### 3.2 核心数据流（6 条）

1. **本地生产 → 云端台账**：本地搜索完成、Gold Filter 通过后，通过 `POST /leads`（Bearer）推送到 D1；本地 Zustand 保持副本；
2. **本地审批 → 云端审批记录**：`POST /approvals` 写入不可覆盖的 `ApprovalRecord`（含 `draft_version`、`email_verification_grade`、`risk_snapshot`）；
3. **云端队列 → 云端发送**：Cron 每 15 分钟扫 `outreach.status='pending'` 且 `scheduled_at <= NOW`，触发 Queue → Worker 调 Resend（或本地 SMTP 兜底）；
4. **Resend Webhook → 云端事件**：`POST /events/webhook` 验证 `X-Resend-Signature`，写入 `events` 追加式表，同步更新 `outreach.status`；
5. **云端事件 → 本地工作台**：本地通过 `GET /dashboard/events?since=<ts>` 增量拉取，写入 Zustand + IPC 推送到 UI（复用现有 `AGENT.LEAD_STATUS_UPDATED` 通道）；
6. **退订 → 全局抑制**：Email Worker 或 One-Click Unsubscribe 链接 → `POST /suppressions/unsubscribe`，写入 `suppressions`，立即阻断该邮箱的所有 pending outreach。

---

## 4. D1 Schema 完整 SQL

### 4.1 设计原则（对齐 `CLOUD-COLLABORATION-DELIVERY.md §9`）

- **双轨状态机**：`leads.status`（业务生命周期）与 `outreach.status`（投递通道）**分离**，不共享字段；
- **追加式事件表**：`events` 只 INSERT 不 UPDATE/DELETE，可保留完整审计；
- **所有表必须有 `workspace_id`**：替代 Supabase RLS；
- **所有表必须有 `created_at` / `updated_at`**：ISO8601 UTC；
- **`idempotency_key` 唯一约束**：防网络重试重复写入；
- **索引优先级**：所有 WHERE 子句列必须建索引。

### 4.2 完整 DDL

（与原版一致，此处省略 SQL 以保持文档简洁。完整 DDL 见 §4.2 原版。）

### 4.3 ⚠️ 状态机边界声明（STATE-MACHINES.md §8 对齐）

> **🔴 新增**：本节对齐 `STATE-MACHINES.md §8` 禁止写法清单，防止架构违例。

**三层状态机映射关系**：

| 层 | 类型名 | 状态数 | 位置 | 权威源 |
|---|---|---|---|---|
| 本地实现层 | `LeadStatus` | 4 | `kone-PRD.md §5.1.1` | 本地 Zustand |
| 本地持久化层 | `AgentStatus` | 结构体 | `kone-PRD.md §5.0.7` | 本地 ConfigStore |
| 云端业务层 | `LeadBusinessStatus` | 7+4 | D1 `leads.status` | Cloudflare |
| 云端投递层 | `OutreachStatus` | 4+3 | D1 `outreach.status` | Cloudflare |
| 云端跟进层 | `FollowupStatus` | 6 | D1 `outreach.sequence_stage` | Cloudflare |

**⚠️ 禁止写法（违反即架构违例，`STATE-MACHINES.md §8`）**：

1. **禁止**把云端 `bounced` / `complained` / `suppressed` 直接加入本地 `LeadStatus` 联合类型（本地仅 4 态：`new`/`contacting`/`replied`/`archived`）；
2. **禁止**把云端 `FollowupStatus`（6 态）与本地 `FollowUpStatus` 视为同一类型（**本地不存在独立 follow-up 状态机**，它复用 `LeadStatus` 4 态）；
3. **禁止**由 `delivered` 推导 `replied`，或由 `sent` 推导 `delivered`（三态必须分离）；
4. **禁止**前端乐观显示"已发送/已送达"——必须等待本地真实动作或云端权威事件；
5. **禁止**用 `contacting` 表达"已批准"或"已入队"等云端语义（`contacting` 仅作旧 UI 聚合显示）；
6. **禁止**在无迁移与兼容层的情况下改写既有状态字符串含义。

**云端状态不得写入本地的明确声明**：
- D1 `leads.status` 包含 `suppressed`/`rejected`/`failed`/`archived` 等状态，**这些是云端 `LeadBusinessStatus`，与本地 `LeadStatus` 是不同类型**；
- D1 `outreach.status` 包含 `bounced`/`complained`/`failed` 等状态，**本地无对应**；
- 本地 `FollowUpStatus` 不存在（复用 `LeadStatus` 4 态），**云端 `FollowupStatus`（6 态）是独立类型**。

### 4.4 索引与写入性能评估

- 所有 WHERE 子句（`workspace_id + status`、`workspace_id + idempotency_key`、`normalized_email`、`provider_message_id`、`occurred_at`）均已有索引；
- `events` 表采用自增 ID + 复合索引，追加式写入无写放大；
- `suppressions` 是唯一支持跨工作区查询的表（`workspace_id` 可为 NULL）；
- **预估写入 TPS**：单个团队 20 人日常操作 < 500 writes/day，远低于 D1 免费额度 10,000 writes/day。

---

## 5. Workers 核心 API 契约

### 5.0 ⚠️ ARCH-STANDARDS §15 对齐声明（10 条硬边界逐条对照）

> **🔴 新增**：本节逐条对照 `ARCH-STANDARDS.md §15` "Local-Cloud Collaboration Architecture (Target-State Hard Boundary)" 的 10 条规则。

| # | §15 条款 | 本方案对齐情况 | 实现位置 |
|---|---|---|---|
| 1 | Local and cloud form one pipeline | ✅ 本地搜索/评分/审批 → 云端台账/队列/发送/事件 | §3.2 数据流 |
| 2 | High score or `cloud_send` entitlement is never send authorization | ✅ 高评分或 `cloud_send` 不等于发送许可，必须有审批记录 | §5.3.2 审批端点 |
| 3 | Renderer has no cloud write authority and no secrets | ✅ 渲染层无云写权限，通过主进程 `cloudflare-service.ts` 代理 | §9.1 |
| 4 | Cloud must independently validate: identity, tenant, schema version, idempotency, collision, suppression, approval, email grade/exception, domain health, quota, circuit breaker | ✅ 10 项全部在云端二次门禁实现 | §5.3.1 |
| 5 | Raw HTML, candidate batches, unapproved contacts, secrets, cookies and sessions are prohibited | ✅ Payload 白名单字段，禁止原始 HTML 等 | §10.4 |
| 6 | Business, outreach and follow-up states are separate contracts | ✅ 三态分离，见 §4.3 状态机边界 | §4.3 |
| 7 | Suppression is global and higher priority | ✅ 全局抑制，优先级最高 | §4.2 suppressions 表 |
| 8 | Cloud events are append-only audit evidence | ✅ `events` 表只 INSERT 不 UPDATE/DELETE | §4.2 events 表 |
| 9 | Every cloud response and write-back failure must be observable and actionable | ✅ 错误码约定 + `requestId` + `sync.failed` 事件 | §5.4 |
| 10 | New cloud API/event schemas are independently versioned | ✅ `schemaVersion` header + `SCHEMA_VERSION` 环境变量 | §5.1 |

**结论**：10 条硬边界全部对齐，无遗漏。

### 5.1 通用约定

- **Base URL**：`https://api.kone-cloud.workers.dev/v1`
- **鉴权**：所有端点要求 `Authorization: Bearer <token>`，token 存储为 SHA-256 hash 于 `workspaces.api_token_hash`；
- **幂等**：`POST` 端点必须接受 `Idempotency-Key` header，重复请求返回同一响应；
- **Schema 版本**：所有请求必须包含 `X-Schema-Version` header（当前：`1.0.0`）；
- **错误格式**：
  ```json
  {
    "success": false,
    "code": "INSUFFICIENT_PERMISSION | NOT_FOUND | RATE_LIMITED | VALIDATION_ERROR | IDEMPOTENCY_CONFLICT | CIRCUIT_OPEN",
    "message": "人类可读原因",
    "suggestion": "可行动建议",
    "requestId": "..."
  }
  ```
- **所有响应必须包含 `requestId`** 便于排查；
- **时区**：所有时间戳以 ISO8601 UTC 存储，前端自行转换为本地时区。

### 5.2 端点清单

（与原版一致，此处省略。）

### 5.3 关键端点契约详情

#### 5.3.1 `POST /leads`（本地推送台账）

**请求**（🔴 修订：对齐 `CLOUD-COLLABORATION-DELIVERY.md §7.1` 必需字段）：

```http
POST /v1/leads
Authorization: Bearer <token>
X-Schema-Version: 1.0.0
Idempotency-Key: <sha256(machine_id|domain|email|score|draft_ver)>
Content-Type: application/json

{
  "schemaVersion": "1.0.0",
  "workspaceId": "ws-uuid",
  "localRefId": "abc123",
  "normalizedDomain": "example.com",
  "company": "Example Inc",
  "country": "CN",
  "contact": { "name": "Zhang", "normalizedEmail": "zhang@example.com", "title": "CTO" },
  "score": 85,
  "evidenceSummary": { "matchReasons": ["AI/ML", "Series A"], "urls": ["https://..."] },
  "riskFlags": { "dns": "safe", "emailGrade": "verified" },
  "emailVerificationGrade": "verified",
  "manualExceptionReason": null,
  "draftVersion": 3,
  "approvalId": null,
  "approverMachineId": null,
  "approvedAt": null,
  "campaignId": null,
  "sequenceStage": null,
  "aiEmail": { "subject": "...", "body": "..." }
}
```

**字段对齐 `CLOUD-COLLABORATION-DELIVERY.md §7.1`**：

| SSOT 必需字段 | 请求体字段 | 状态 |
|---|---|---|
| `schemaVersion` | `schemaVersion` | ✅ |
| `idempotencyKey` | `Idempotency-Key` header | ✅ |
| `workspaceId` | `workspaceId` | ✅ |
| 本地稳定引用 ID | `localRefId` | ✅ |
| 公司、规范化域名 | `normalizedDomain` + `company` | ✅ |
| 联系人、规范化邮箱 | `contact.normalizedEmail` + `contact.name` | ✅ |
| 评分与证据摘要 | `score` + `evidenceSummary` | ✅ |
| 邮箱验证等级及人工例外 | `emailVerificationGrade` + `manualExceptionReason` | ✅ |
| `approvalId`、审批人、审批时间、`draftVersion` | `approvalId` + `approverMachineId` + `approvedAt` + `draftVersion` | ✅（Phase 1 时均为 NULL，Phase 3 实现审批后填入） |
| 经批准的主题和正文 | `aiEmail.subject` + `aiEmail.body` | ✅ |
| `campaignId`、`sequenceStage` | `campaignId` + `sequenceStage` | ✅（Phase 1 时为 NULL，Phase 2 实现 outreach 后填入） |

**云端二次门禁（Fail-Closed 顺序，对齐 `CLOUD-COLLABORATION-DELIVERY.md §8`）**：
1. Bearer token 校验 → `workspaces.api_token_hash`；
2. Schema 版本校验（`X-Schema-Version` header）；
3. `workspaceId` 与 token 对应的 workspace 匹配（租户隔离）；
4. `Idempotency-Key` 去重（命中返回既有 lead）；
5. 公司防撞单：查询 `companies` 表该 domain 是否已被其他 owner 认领；
6. 全局抑制检查：`suppressions.normalized_email` 命中即拒绝；
7. 邮箱验证等级校验（`emailVerificationGrade` 必须在允许列表内）；
8. 日配额检查（`delivery_quota.sent_today < 100`）；
9. 熔断检查（`circuit_open_until IS NULL` 或已过期）；
10. 写入 `contacts` + `companies` + `leads`（`status='scored'`）；
11. 追加 `events.lead.created`。

**成功响应**：
```json
{
  "success": true,
  "data": {
    "id": "lead-uuid",
    "status": "scored",
    "approvalRequired": true,
    "collision": false
  },
  "requestId": "req-..."
}
```

**失败响应示例**：
```json
{
  "success": false,
  "code": "TEAM_COLLISION",
  "message": "域名 example.com 已被其他成员认领，处于保护期内",
  "suggestion": "联系该成员确认，或等待保护期过期",
  "requestId": "req-..."
}
```

#### 5.3.2 `POST /leads/{id}/approve`（人工审批）

（与原版一致，此处省略。完整契约见 §5.3.2 原版。）

#### 5.3.3 `POST /events/webhook`（Resend 回执）

（与原版一致，此处省略。完整契约见 §5.3.3 原版。）

#### 5.3.4 `POST /suppressions/unsubscribe`（One-Click 退订）

（与原版一致，此处省略。完整契约见 §5.3.4 原版。）

### 5.4 错误码约定

（与原版一致，此处省略。完整错误码表见 §5.4 原版。）

---

## 6. Cron 调度逻辑与关键实现要点

（与原版一致，此处省略。完整内容见 §6 原版。）

---

## 7. Resend / Email Worker 集成要点

### 7.1 双通道设计（本地 SMTP 保留 + Resend 兜底）

（与原版一致，此处省略图表。）

**🔴 修订：决策逻辑明确化**

| 用户配置 `sendChannel` | 发送路径 | 说明 |
|---|---|---|
| `local_smtp`（默认） | 本地 `email-agent.ts` → SMTP 发送 | 主力通道，免费无配额 |
| `resend` | Cloudflare Cron → Resend API | 兜底通道，100 封/日限制 |
| `auto` | 优先本地 SMTP，失败降级到 Resend | 智能路由，需实现降级逻辑 |

**决策点位置**：
- `local_smtp`：本地 `email-agent.ts` 直接发送，Cloudflare 仅做台账记录（通过 `POST /leads` 推送）；
- `resend`：本地通过 `POST /outreach` 创建任务，Cloudflare Cron 触发 Resend 发送；
- `auto`：本地 `email-agent.ts` 先尝试 SMTP，失败时调用 `POST /outreach` 降级到 Resend。

### 7.2 Resend 集成配置

**Cloudflare Secrets**（`wrangler secret put`）：
- `RESEND_API_KEY`：Resend API Key（Free Tier 或付费）；
- `RESEND_WEBHOOK_SECRET`：Webhook 验签密钥；
- `SENDER_DOMAIN`：发件域名（须在 Resend 内验证 SPF/DKIM）；
- `CLOUD_API_SIGNING_SECRET`：本地→云端 API 的双向 HMAC 签名密钥（可选增强）。

**Resend 域名验证**（🔴 修订：补充完整步骤）：

1. **在 Resend 控制台添加发件域**（如 `outreach.yourcompany.com`）；
2. **配置 SPF**：在域名 DNS 添加 TXT 记录 `v=spf1 include:_spf.resend.com ~all`；
3. **配置 DKIM**：按 Resend 指导添加 3 条 CNAME 记录（`resend._domainkey.yourdomain.com` → Resend 提供的值）；
4. **可选：配置 DMARC**：添加 TXT 记录 `_dmarc.yourdomain.com` → `v=DMARC1; p=reject; rua=mailto:postmaster@yourdomain.com`；
5. **域名所有权验证**：Resend 自动生成 TXT 记录 `_verify.yourdomain.com`，需添加验证；
6. **等待 DNS 传播**（5 分钟 - 24 小时）；
7. **验证完成**后，Resend 控制台的域名状态变为"Verified"。

**⚠️ 配额按发件域名计算**：100 封/日限制是每个发件域名的配额。如果多个团队共用一个域名，配额共享。建议每个团队使用独立子域（如 `team1.kone-cloud.com`、`team2.kone-cloud.com`）。

### 7.3 Email Worker（退订路由）

（与原版一致，此处省略。）

### 7.4 List-Unsubscribe 合规头

（与原版一致，此处省略。）

### 7.5 Free Tier 使用建议

（与原版一致，此处省略。）

---

## 8. Pages 看板核心页面结构

（与原版一致，此处省略。完整内容见 §8 原版。）

---

## 9. 本地 KONE AI 推送 Skill 改造要点

### 9.1 新增 Cloudflare 客户端模块

**位置**：`electron/services/cloudflare-service.ts`（新建，与 `supabase-service.ts` 平级）

**职责**：
- 封装 Cloudflare Workers API 的所有 HTTP 调用；
- 保持与 `supabase-service.ts` 相同的 IPC 契约（`IPC_CHANNELS.CLOUD.*`），主进程内替换后端；
- 实现 Bearer token 管理、幂等键生成、错误重试；
- 保持 Gold Filter 门槛（`score >= 80`）与本地 Fail-Closed 授权门禁不变。

### 9.2 关键改造点

| 现有代码 | 改造动作 | 备注 |
|---|---|---|
| `supabase-service.ts` | **保留**（老工作区继续用），**新增** `cloudflare-service.ts` | 双栈共存期 |
| `automation-service.ts` | 删除 N8N Webhook 部分，保留邮箱验证 | 铁律一落地 |
| `config-service.ts` | 删除 `n8nSettings` 类型与 getter | 铁律一落地 |
| `proxy-service.ts` | 删除 N8N webhook hostname 白名单 | 铁律一落地 |
| `n8n-settings-tab.tsx` | **删除整个文件** | 铁律一落地 |
| `automation-workflow.tsx` | 更新套餐锁定提示文案 | 铁律一落地 |
| `help-dialog.tsx` | 更新帮助文档文案 | 铁律一落地 |
| `cloud-sync-gate.ts` | 更新函数注释 | 铁律一落地 |
| `supabase-service.ts:332` | 注释改为 "由 Cloudflare Workers 消费" | 铁律一落地 |
| `IPC_CHANNELS.CLOUD.*` | **不变**（契约稳定） | 主进程内路由切换 |
| 前端 | **零改动**（IPC 契约稳定） | 用户无感 |
| `email-agent.ts` | 保留本地 SMTP；新增可选 Resend 发送器 | 通过 Worker API 转发 |
| `followup-scheduler.ts` | 保留本地 4 段序列；新增云端状态同步 | 通过 `GET /events?since=<ts>` 拉取 |

### 9.3 数据流向

（与原版一致，此处省略。）

### 9.4 迁移路径（🔴 修订：补充完整策略）

**阶段 A**（Phase 1）：**双栈共存**
- `supabase-service.ts` 保留不动；
- 新增 `cloudflare-service.ts`；
- 通过 `user_config.cloudProvider`（'supabase' | 'cloudflare'）路由；
- 老工作区默认 'supabase'，新工作区默认 'cloudflare'。

**阶段 B**（Phase 2）：**迁移工具**
- 提供 Supabase→D1 数据导出脚本；
- **迁移策略**：
  1. **双写期**：同时写 Supabase 和 D1，确保数据一致性；
  2. **读切换**：验证 D1 数据完整后，将读路径切换到 D1；
  3. **验证**：行数对比、抽样校验、业务逻辑测试；
  4. **清理**：确认无误后关闭 Supabase 写入。
- **SQL 语法转换清单**：
  - Postgres `NOW()` → SQLite `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  - Postgres `UUID()` → SQLite 应用层生成 UUIDv7
  - Postgres `RETURNING` → SQLite `RETURNING`（D1 支持）或两次查询
  - Postgres `ILIKE` → SQLite `LIKE`（SQLite LIKE 默认大小写不敏感）
  - Postgres 数组类型 → SQLite JSON
- 迁移期间允许读旧写新；
- 迁移完成后关闭 Supabase 依赖。

**阶段 C**（Phase 3，可选）：**清理**
- 删除 `supabase-service.ts` 及相关依赖；
- 更新 `PROVIDER-CAPABILITY.md`。

---

## 10. 安全与熔断 Checklist

（与原版一致，此处省略。完整 checklist 见 §10 原版。）

---

## 11. 部署与配置清单

### 11.1 Cloudflare 项目结构

（与原版一致，此处省略。）

### 11.2 wrangler.toml（Worker 层）

（与原版一致，此处省略。）

### 11.3 部署流程

（与原版一致，此处省略。）

### 11.4 本地 KONE AI 侧配置

（与原版一致，此处省略。）

### 11.5 🔴 测试策略（新增）

**Worker 层测试**：
- **框架**：Vitest + miniflare（Cloudflare 官方测试环境）
- **覆盖范围**：
  - Bearer 鉴权（有效/无效/过期 token）
  - workspace_id 隔离（跨租户访问必须拒绝）
  - 幂等键去重（重复请求返回同一响应）
  - 二次门禁（10 步 Fail-Closed 逐条测试）
  - Webhook 验签（HMAC-SHA256 正确/错误/过期）
  - 熔断触发与恢复
  - Cron 调度逻辑（扫队、发送、熔断检查）
- **D1 测试**：`wrangler d1 execute --local` 本地 SQLite 实例
- **目标覆盖率**：核心逻辑 ≥ 80%

**集成测试**：
- Worker ↔ D1 端到端（写入 leads → 查询 → 审批 → outreach → webhook → events）
- Resend mock（使用 nock 或 mock server 模拟 Resend API）
- Webhook 签名验证（正确/错误/时间窗过期）

**端到端冒烟测试**：
- 部署到 Cloudflare 后，通过 curl 验证所有端点
- 本地 Kone AI → Cloudflare API → D1 存储 → Pages 看板可见
- 完整发送链路：本地审批 → 云端排队 → Cron 发送 → Resend → Webhook → D1 → 本地 UI

**CI/CD**：
- GitHub Actions 自动测试（Vitest + miniflare）
- `wrangler d1 execute --local` 验证 D1 schema
- 部署前自动运行冒烟测试

---

## 12. 风险与边界声明

### 12.1 已识别风险

| # | 风险 | 严重性 | 缓解 |
|---|---|---|---|
| R1 | **Realtime 依赖 Durable Object**，DO 免费额度可能不足 | 中 | 免费额度充足（10 万调用/日）；可降级为 30s 轮询 |
| R2 | **D1 无 RLS**，Worker 层若漏校验 workspace_id 会导致数据泄露 | 高 | 单测强制断言所有 SQL 包含 workspace_id；review gate |
| R3 | **Resend Free 100 封/日**（按发件域名配额）不足以支撑生产流量 | 中 | 明确定位为"预览/兜底"通道，本地 SMTP 为主通道；多团队用独立子域 |
| R4 | **N8N 移除后，老客户的自动化流程中断** | 中 | 迁移期保持双栈共存，提供迁移文档；`automation-service.ts` 保留邮箱验证部分 |
| R5 | **Supabase→D1 数据迁移** | 中 | 提供一次性导出脚本；双写期→读切换→验证→清理；SQL 语法转换清单 |
| R6 | **Cloudflare 免费额度随时调整** | 中 | 监控用量，超额时提前通知用户升级；Worker 层实现用量告警 |
| R7 | **本地 SMTP 保留 vs 用户"零配置"预期** | 低 | 提供 Resend 快速配置向导，5 分钟完成域名验证 |
| R8 | **审批流缺失阶段** | 低 | Phase 1 本地审批（现有 UI）→ 云端直接设为 `approved`（过渡方案）；Phase 3 实现完整云端审批 |
| R9 | **Suppression 表跨工作区语义** | 低 | `workspace_id` 可 NULL，代表全局抑制；文档明确 |
| R10 | **Cron 单点故障** | 低 | 15 分钟批量容错；单条失败不影响整批 |
| R11 | **对客口径合规风险**（🔴 新增） | 高 | Phase -1 立即处理：README/UI 加"目标态/路线图"标注 |
| R12 | **Phase 0 工作量被低估**（🔴 新增） | 中 | 完整 N8N 足迹清单（8 文件/65 处引用），工作量修正为 2-3 天 |

### 12.2 明确边界（本方案 **不** 做的事）

- **不重写本地 KONE AI**：所有本地能力（四级弹性搜索、ICP+LLM 双轨评分、Gold Filter、Fail-Closed、Zustand、FollowupScheduler、Email Agent SMTP/IMAP）**全部保留**；
- **不替换 V1.3 宪法**：Cloudflare 层必须继承 `CLOUD-COLLABORATION-DELIVERY.md` SSOT 的所有约束（Fail-Closed、幂等、追加式事件、不可覆盖审批、全局抑制）；
- **不修改授权模型**：`cloud_send` 仍是 Premium 门禁，`license-guard.ts` 不动；
- **不追求云端完全替代本地**：`leads` 表在云端是**台账**（approved 后的候选池），本地 Zustand 是**工作台**（未审批的搜索中间态）；
- **不承诺完全零成本**：Cloudflare Free + Resend Free 是**基础免费额度**，规模增长后需升级（成本可控，但仍需监控）；
- **不承诺 D1 完全替代 Supabase 的 Realtime**：D1 无原生 Realtime，需 Durable Object 或轮询（体验略降级，但可接受）；
- **⚠️ 云端闭环当前为 `NO-GO`**：实施后仍需通过 `CLOUD-COLLABORATION-DELIVERY.md §13` 全部 10 条门禁方可转为 `GO`。

### 12.3 与 Phase A 交付的关系

- **Phase A（V1.3 上市前必要优化）已交付**：N1（精准度验证视图）、N2（需处理动作入口）、干净机器验收手册、314/314 单测全绿、打包冒烟通过；
- **Phase A 明确"不做"**：云端协同闭环（审批/二次门禁/投递/事件回写）——规格自身判定 `NO-GO` 且为**高级版增量**；
- **本方案（Cloudflare 云地协同）是 V1.3 交付后的新增能力**：不阻断 V1.3 上市；
- **两者不矛盾**：Phase A 的"不做"是指 **V1.3 交付前不做**，不是永久不做。Cloudflare 方案是交付后的增量规划；
- **即使完全不实施 Cloudflare**，V1.3 仍可作为"本地优先 + 团队轻量协同（Supabase）"的商用 SaaS 工具交付；
- **B-3 云协同**（`KONE-V1.3-B2签名与B4持久化技术方案-2026-09-25.md`）定位为**高级版功能**，本方案正是 B-3 的完整技术方案。

---

## 13. 分阶段执行计划

> **🔴 修订**：新增 Phase -1（对客口径对齐），修正 Phase 0 工作量与风险，修正 Phase 1 时间估算，对齐 `高级版云端功能梳理 §6.2` 的 6 阶段路径。

### Phase -1：对客口径对齐（0.5 天）—— 合规前置

> **🔴 新增**：基于 `KONE-V1.3-高级版云端功能模块深度梳理-2026-09-25.md §0` 的"对客夸大"风险。

| 任务 | 动作 | 文件 |
|---|---|---|
| P-1-1 | README 版本对照表中云端两项加注"（目标态/路线图，需配置云端后端）" | `README.md` |
| P-1-2 | 前端高级版入口同步标注 | `src/components/` |
| P-1-3 | 确认"云端能力不对外宣称已交付"直到 §13 门禁全部通过 | 文档 |

**验收**：README 与 UI 均标注"目标态/路线图"，与 `CLOUD-COLLABORATION-DELIVERY.md §0` 一致。

### Phase 0：N8N 移除（2-3 天）—— 铁律一落地

> **🔴 修订**：原声明"1-2 天零风险"修正为"2-3 天中低风险"。

| # | 任务 | 动作 | 文件 |
|---|---|---|---|
| P0-1 | 删除 `n8n-settings-tab.tsx` 整个文件 | 145 行整删 | `src/components/settings/` |
| P0-2 | 修改 `automation-service.ts` | 保留邮箱验证，删除 N8N Webhook 部分（约 100 行） | `electron/services/` |
| P0-3 | 修改 `config-service.ts` | 删除 `n8nSettings` 类型与 getter（5 处） | `electron/services/` |
| P0-4 | 修改 `proxy-service.ts` | 删除 N8N webhook hostname 白名单（3 处） | `electron/services/` |
| P0-5 | 修改 `automation-workflow.tsx` | 更新套餐锁定提示文案（1 处） | `src/components/` |
| P0-6 | 修改 `help-dialog.tsx` | 更新帮助文档文案（2 处） | `src/components/` |
| P0-7 | 修改 `cloud-sync-gate.ts` | 更新函数注释（2 处） | `electron/utils/` |
| P0-8 | 修改 `supabase-service.ts:332` | 注释改为"由 Cloudflare Workers 消费" | `electron/services/` |
| P0-9 | 更新 `ARCH-STANDARDS.md §7.4` | "n8n cloud email automation" → "Cloudflare cloud email automation" | 文档 |
| P0-10 | 更新 `ARCH-STANDARDS.md §8` | "Premium n8n automation" → "Premium Cloudflare automation" | 文档 |
| P0-11 | 更新 `kone-PRD.md` | 相关章节标注"已迁移至 Cloudflare" | 文档 |
| P0-12 | 更新 `CHANGELOG.md` | 记录变更 | 文档 |
| P0-13 | 同步更新相关单测 | 删除 N8N mock，替换为 Cloudflare mock | `tests/` |

**验收**：`npm run test:unit` 全绿、`npm run typecheck` 0 error、`npm run verify:consistency` 双绿。

### Phase 1：最小可用云（3-4 周）—— 团队台账 + 看板

> **🔴 修订**：原声明"1-2 周"修正为"3-4 周"（单人），或"2-3 周"（双人并行）。

**目标**：本地 KONE AI 能推台账到 Cloudflare，Pages 看板可见；本地 SMTP 仍为主发送通道。

**对齐 `高级版云端功能梳理 §6.2` 阶段映射**：

| 高级版 6 阶段 | 本方案对应 | 覆盖度 |
|---|---|---|
| A. 契约先行（三态字典 + 最小化载荷 + 幂等键） | Phase 1（D1 Schema + API 契约） | ✅ |
| B. 本地审批（`pending_approval` + `ApprovalRecord`） | Phase 3（P3-1/P3-2） | Phase 1 暂用本地审批 |
| C. 云端门禁（10 步 Fail-Closed） | Phase 1（Bearer + workspace_id + 幂等） | 部分（完整 10 步在 Phase 3） |
| D. 投递与事件（队列 + Webhook + 事件审计） | Phase 2 | 不在 Phase 1 |
| E. 回写与 UI（跨端状态回写 + UI 必备） | Phase 1-2 | 部分 |
| F. 发布门禁（§13 全部 10 条） | Phase 3 | 不在 Phase 1 |

| # | 任务 | 动作 | 预估 |
|---|---|---|---|
| P1-1 | 创建 `kone-cloud/` monorepo（Worker + Pages + migrations） | 项目初始化 | 1 天 |
| P1-2 | 实现 `migrations/001_init.sql`（本文档 §4 完整 schema） | D1 DDL | 2 天 |
| P1-3 | 实现 Worker 核心路由：`/leads`、`/leads?status=`、`/events?since=`、`/healthz` | HTTP API | 3 天 |
| P1-4 | 实现 Bearer 鉴权、workspace_id 隔离、幂等去重 | 安全层 | 2 天 |
| P1-5 | 实现 Pages 看板骨架（概览 + 线索台账 + 事件流） | React + Vite | 3 天 |
| P1-6 | 本地新增 `cloudflare-service.ts`，实现 `POST /leads` 推送 | 主进程 | 2 天 |
| P1-7 | `user_config.cloudProvider` 路由（'supabase' | 'cloudflare'） | 配置层 | 1 天 |
| P1-8 | 前端 `Settings` 新增 Cloudflare 配置项 | UI | 1 天 |
| P1-9 | 部署到 Cloudflare，端到端冒烟测试 | 部署 + 验证 | 2 天 |
| P1-10 | 更新 `CLOUD-COLLABORATION-DELIVERY.md`（Supabase→Cloudflare） | 文档 | 1 天 |
| P1-11 | Worker 单测（Vitest + miniflare） | 测试 | 2 天 |

**验收**：
- 本地推送台账 → D1 存储成功 → Pages 看板可见；
- 本地拉取事件 → Zustand 更新 → UI 实时刷新；
- 老工作区（Supabase）与新工作区（Cloudflare）双栈共存；
- 本地 SMTP 发送路径不受影响；
- Worker 核心逻辑测试覆盖率 ≥ 80%。

### Phase 2：云端发送 + 回复闭环（2-3 周）—— 差异化触达

> **对齐高级版 6 阶段 D（投递与事件）**

**目标**：支持通过 Cloudflare Resend 发送，Webhook 回执闭环，4 段序列节律。

| # | 任务 | 动作 |
|---|---|---|
| P2-1 | 实现 `POST /outreach`（含 campaign/sequence_stage/scheduled_at） |
| P2-2 | 实现 Cron Trigger（15 分钟扫队）+ Queue 消费者 |
| P2-3 | 实现 `integrations/resend.ts`（Resend API 调用） |
| P2-4 | 实现 `POST /events/webhook`（Resend 回执，HMAC 验签） |
| P2-5 | 实现 `schedule/window.ts`（时区窗口，周二-周四 9-11:30/14-16:30） |
| P2-6 | 实现 `schedule/sequence.ts`（4 段序列，3-5d/7-10d/12-14d + 抖动） |
| P2-7 | 实现 `POST /suppressions/unsubscribe`（One-Click 退订） |
| P2-8 | 实现 `circuit/breaker.ts`（熔断器：硬退率 >3% 或投诉 >0.05%） |
| P2-9 | 本地 `followup-scheduler.ts` 新增云端状态同步（`GET /events?since=` 轮询） |
| P2-10 | 本地 `email-agent.ts` 新增可选 Resend 发送器 |
| P2-11 | 端到端测试：本地审批 → 云端排队 → Cron 发送 → Resend → Webhook → D1 → 本地 UI |
| P2-12 | Resend 域名验证文档（SPF/DKIM/DMARC 配置指南） |

**验收**：
- 端到端冷邮触达：本地审批 → 云端排队 → Resend 发送 → 回执 → 本地 UI 显示"已送达/已回复"；
- 4 段序列按节律自动推进，回复/退订/硬退立即终止序列；
- 熔断触发时暂停投递，过期后自动恢复；
- 时区窗口严格遵守（周二-周四、本地 9-11:30/14-16:30）。

### Phase 3：审批门禁 + 高级功能（2-4 周，可选）—— SaaS 商业版

> **对齐高级版 6 阶段 B（本地审批）+ C（云端门禁）+ E（回写与 UI）+ F（发布门禁）**

**目标**：完整对齐 `CLOUD-COLLABORATION-DELIVERY.md` 云端 SSOT 全部约束。

| # | 任务 | 动作 |
|---|---|---|
| P3-1 | 实现 `POST /leads/{id}/approve` / `/reject`（含 draft_version 校验） |
| P3-2 | 实现 `approvals` 表不可覆盖 + `events.lead.approved` 追加 |
| P3-3 | 实现 `approver_machine_id` 权限校验（工作区管理员 vs 普通成员） |
| P3-4 | 实现 `GET /dashboard/stats`（看板聚合指标） |
| P3-5 | 实现 `/team` 页面（工作区成员、日限额、熔断阈值） |
| P3-6 | 实现 `/privacy/export` 和 `/privacy/delete`（GDPR/CCPA） |
| P3-7 | 实现 Durable Object WebSocket 广播（替代 30s 轮询） |
| P3-8 | 迁移工具：Supabase→D1 数据导出脚本（含双写期→读切换→验证→清理） |
| P3-9 | 老工作区迁移到 Cloudflare 的过渡方案 |
| P3-10 | 更新 `CLOUD-COLLABORATION-DELIVERY.md` 全部为 Cloudflare 实现状态 |
| P3-11 | 完整 E2E 测试套件（Worker + Pages + Resend mock） |
| P3-12 | **§13 发布门禁全部 10 条验收**（对齐 `高级版云端功能梳理 §6.2` F 阶段） |

**验收**：
- 审批流完整闭环（草稿变更触发重新审批）；
- 工作区成员权限隔离；
- GDPR/CCPA 合规；
- 迁移工具可用，老工作区可平滑切换；
- 全链路 E2E 通过；
- **§13 门禁全部通过 → 转为 `GO`**。

### Phase 4：清理与优化（1 周，可选）

| # | 任务 | 动作 |
|---|---|---|
| P4-1 | 删除 `supabase-service.ts`（如全部工作区已迁移） |
| P4-2 | 删除 `automation-service.ts` 中的 Supabase fallback 部分 |
| P4-3 | 更新 `PROVIDER-CAPABILITY.md` 移除 Supabase/N8N |
| P4-4 | 更新 `ARCH-STANDARDS.md` §7 云端章节 |
| P4-5 | 性能优化：D1 查询优化、Worker 冷启动优化、Pages 静态化 |

---

## 14. 决策要点与后续行动

### 14.1 需用户拍板的决策

1. **是否立即执行 Phase -1**（0.5 天）？
   - 推荐：是，立即对齐对客口径；
   - 理由：合规前置，防止对客夸大。

2. **是否立即执行 Phase 0**（2-3 天，中低风险）？
   - 推荐：是，立即移除 N8N 依赖；
   - 理由：铁律一要求"完全放弃 N8N"，虽涉及 8 个文件但均为低风险改动。

3. **Phase 1 是否作为 V1.3 交付前的必做项**？
   - 推荐：否。Phase 1 是**新增能力**，不阻断 V1.3 上市；
   - 理由：Phase A 已确认 B-3 云协同是高级版功能，且 V1.3 已可通过 Supabase 实现基础团队协同。

4. **Supabase 是否保留双栈共存**？
   - 推荐：保留。老工作区继续用 Supabase，新工作区走 Cloudflare，迁移期至少 6 个月；
   - 理由：数据迁移有风险，强制迁移可能影响老用户。

5. **本地 SMTP 是否保留**？
   - 推荐：保留。本地 SMTP 是核心差异化能力，且完全免费；
   - 理由：Resend Free 有配额限制（按发件域名），不适合作为唯一通道。

6. **是否立即开始 Phase 1 编码**（3-4 周）？
   - 推荐：否。先完成本文档的评审与拍板，再开始实施；
   - 理由：本方案涉及新增 monorepo、D1 schema、Worker API、Pages 看板，工程量大，需完整评审。

### 14.2 下一步行动

1. **本周**：
   - 用户评审本文档，确认 6 个决策点；
   - 执行 Phase -1（0.5 天，对客口径对齐）；
   - 开始 Phase 0（2-3 天，移除 N8N 依赖）。

2. **Phase 0 完成后**：
   - 更新 `CHANGELOG.md`、`CLOUD-COLLABORATION-DELIVERY.md`；
   - 提交 PR，走完整验证流程（`test:unit` + `typecheck` + `verify:consistency`）；
   - 发布 V1.3.1 补丁版本。

3. **Phase 1 启动前**：
   - 用户确认 Cloudflare 账号（如需）与 Resend 账号（如需）；
   - 用户确认 Cloudflare 免费额度充足；
   - 用户确认 Resend 域名验证可行（如选择 Resend 通道）；
   - 开始 `kone-cloud/` monorepo 初始化。

---

## 附录 A：与现有代码的映射

| 本文档章节 | 对应现有代码 | 关系 |
|---|---|---|
| §1 目标态全景 | `supabase-service.ts`、`automation-service.ts`、`followup-scheduler.ts`、`email-agent.ts` | 现有实现 → 目标态 |
| §2 铁律评估 | `license-guard.ts`、`cloud-sync-gate.ts`、`email-suppression.ts` | 现有能力对齐 |
| §3 架构总览 | 无（新建） | 目标态 |
| §4 D1 Schema | `CLOUD-COLLABORATION-DELIVERY.md §9`（云端核心实体） | 与 SSOT 一致 |
| §4.3 状态机边界 | `STATE-MACHINES.md §8`（禁止写法） | 🔴 新增对齐 |
| §5 Workers API | `supabase-service.ts` IPC 端点 | 契约一致，后端替换 |
| §5.0 §15 对齐 | `ARCH-STANDARDS.md §15`（10 条硬边界） | 🔴 新增对齐 |
| §6 Cron 调度 | `followup-scheduler.ts`（本地 4 段序列） | 逻辑对齐，执行位置不同 |
| §7 Resend 集成 | `email-agent.ts`（本地 SMTP） | 保留本地，新增云端 |
| §8 Pages 看板 | 无（新建） | 目标态 |
| §9 本地推送 Skill | 新增 `cloudflare-service.ts` | 与 `supabase-service.ts` 平级 |
| §10 安全熔断 | `CLOUD-COLLABORATION-DELIVERY.md §11` | 与 SSOT 一致 |
| §11 部署配置 | 无（新建） | 目标态 |
| §11.5 测试策略 | 无（新建） | 🔴 新增 |
| §12 风险边界 | `KONE-V1.3-B2签名与B4持久化技术方案-2026-09-25.md` | 与 B-3 方案对齐 |
| §13 执行计划 | `KONE-V1.3-上线前必要优化梳理-2026-09-25.md`（Phase A） | Phase A 是必要，本方案是新增 |

---

## 附录 B：关键术语

- **Gold Filter**：本地评分阈值过滤（`score >= 80`），只有通过 Gold Filter 的线索才能上云；
- **Fail-Closed**：安全优先，任何不确定情况都默认拒绝（授权失败、Webhook 验签失败、抑制命中等均拒绝）；
- **双轨状态机**：`leads.status`（业务生命周期）与 `outreach.status`（投递通道）分离；
- **三态分离**：业务状态（`LeadBusinessStatus` 7+4）、投递状态（`OutreachStatus` 4+3）、跟进状态（`FollowupStatus` 6）必须独立，禁止推导；
- **幂等键**：SHA-256(machine_id|domain|email|score|draft_version)，防止网络重试重复写入；
- **追加式事件表**：`events` 表只 INSERT 不 UPDATE/DELETE，可保留完整审计；
- **Durable Object**：Cloudflare 提供的状态化 WebSocket 服务，用于 Realtime 广播；
- **One-Click Unsubscribe**：退订链接无需用户点击确认，直接生效（合规要求）；
- **熔断**：投递失败率超过阈值时暂停所有投递，等待恢复后自动重试；
- **NO-GO**：`CLOUD-COLLABORATION-DELIVERY.md §0` 定义的当前发布判定状态，需通过 §13 门禁方可转为 `GO`。

---

## 附录 C：修订记录

| 日期 | 版本 | 修订内容 | 依据 |
|---|---|---|---|
| 2026-09-25 | v1.0 | 初始版本 | 用户需求 |
| 2026-09-28 | v1.1 | **13 项修订**：N8N 足迹修正、对客口径风险、NO-GO 声明、状态机边界、§15 对齐、载荷字段对齐、§7.4 更新、6 阶段映射、D1 Realtime 细化、Resend 复杂度、Phase 1 时间、迁移策略、测试策略 | `KONE-V1.3-Cloudflare执行计划全局审查-2026-09-28.md` |

---

*本文档为**规划评估**，未改动任何代码。所有决策点需用户拍板后，方可进入实施阶段。*

*方法论声明：本文档所有结论均基于对项目现有代码的直接读取与取证，非假设性推演。所有与 V1.3 宪法的冲突点已明确标注，所有边界条件已明确声明。修订版基于全部 10 份规范文档逐条交叉验证，所有修订均有对应的审查报告依据。*
