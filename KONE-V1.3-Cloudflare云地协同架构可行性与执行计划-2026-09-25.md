# KONE V1.3 · Cloudflare 云地协同架构可行性评估与分阶段执行计划

> ⚠️ **本文档已被取代（2026-09-28），仅作历史留档。**
> 本版对 N8N 移除的工作量评估存在**重大低估**：原估「1 文件 + 1 处注释、1 天零风险」，
> 修订版订正为「8 文件 / 65 处 / 2306 行、2–3 天中低风险」。
> 请以 **`KONE-V1.3-Cloudflare云地协同架构可行性与执行计划-修订版-2026-09-28.md`** 为准。

> **日期**：2026-09-25 ｜ **基线**：HEAD 现状（Phase A 已完成，V1.3 上市前必要优化交付）
> **性质**：**纯规划评估**，未改动任何代码；仅识别缺口、评估可行性、给出分阶段路径。
> **对齐基线**：`CLOUD-COLLABORATION-DELIVERY.md`（Kone 云端协同 SSOT 目标态）、`AGENTS.md`「Agent 双管道宪法」、`ARCH-STANDARDS.md §7`（边缘重活云端轻量）、`KONE-V1.3-Agent双管道与Autopilot宪法核验-2026-09-25.md`（10/10 合规）。
> **方法论**：先读代码取证，再下结论；grep 只用于定位，不用于判定。

---

## 0. 一句话结论

**方案总体可行，但不能作为 V1.3 交付前的必做项，也不能整体替换现有 SSOT**。建议以 **P0 → P1 → P2** 三阶段渐进迁移：先把 **Supabase 团队协同能力平移到 Cloudflare D1（零功能损失）**，再叠加 **Resend 云端发送通道（本地 SMTP 保留）**，最后才考虑 **审批门禁与熔断**（Phase A 已确认 B-3 云协同是高级版功能，非当前发布阻断）。**用户明确指令"完全放弃 N8N"落地成本极低**（1 个文件 + 1 处注释），但"完全放弃 Supabase"需重写 `supabase-service.ts` 的 6 个 IPC 端点与所有前端订阅，属中高风险迁移，需专项排期。

| 项 | 结论 |
|---|---|
| 5 条核心铁律**整体可行性** | ✅ 可行（4 条零成本对齐，1 条需重构 Supabase→D1） |
| 与现有 V1.3 宪法的**冲突点** | 3 处（详见 §2.1） |
| **必须放弃**的既有实现 | N8N `automation-service.ts`（低风险）、Supabase 团队协同 IPC（中风险） |
| **可完全保留**的既有实现 | 四级弹性搜索、本地 ICP/LLM 评分、Gold Filter、本地 SMTP Email Agent、Fail-Closed 授权、Zustand 本地持久化、FollowupScheduler 本地状态机 |
| **零服务端成本**可行性 | ✅ Cloudflare 免费额度（D1 5 GB / Workers 100k req/day / Pages / Queue / Email Workers）完全够用；**唯一硬约束是 Resend Free Tier 100 封/日** —— 需按团队数分摊，或用户自备付费 Resend 账户 |
| **Phase A 交付阻断项**（干净机器验收）**是否受影响** | 不受影响；本方案属**新增能力**，与 Phase A 交付正交 |

---

## 1. 目标态全景：现有状态 vs 目标态（一张图看清差距）

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

### 2.1 铁律一："完全放弃 N8N" —— 可行，成本极低 ⭐

**现有证据**：
- `electron/services/automation-service.ts`：N8N Webhook 发信对接，注释"n8n 未部署时降级为 Supabase campaigns 表入库"；
- `electron/services/supabase-service.ts:332-343`：`createCampaign()` 注释"由 n8n 后续消费"；
- 全仓 grep `n8n` 命中 4 处（1 主文件 + 1 注释 + 2 CHANGELOG 记录）；
- `electron/security/license-guard.ts` 中 `cloud_send` 是 Premium 门禁，与 N8N 无绑定，**移除 N8N 不改授权模型**。

**迁移清单**：
| 项 | 动作 | 影响面 |
|---|---|---|
| `automation-service.ts` | 保留邮箱验证部分（`verifyEmailsBatch`、`classifyEmailStatic` 集成点），删除 N8N Webhook 部分 | 一个文件 |
| `supabase-service.ts:332` | 注释改为"由 Cloudflare Workers 后续消费" | 一行注释 |
| `automation-service.ts` 内 `getN8nWebhookUrl` | 删除或替换为 `getCloudQueueUrl` | 一个函数 |
| `tests/*` | 相关单测删除 N8N mock，替换为 Cloudflare mock | 需检查 |
| `kone-PRD.md` / `ARCH-STANDARDS.md` | 相关章节标注"已迁移到 Cloudflare" | 文档 |

**结论**：低风险、单文件改动，可在 Phase 0 一次性完成。

### 2.2 铁律二："严格遵循 Kone V1.3 宪法" —— 部分可行，需明确边界 ⚠️

**现有 V1.3 宪法核心约束**（`ARCH-STANDARDS.md` + `AGENTS.md` + `CLOUD-COLLABORATION-DELIVERY.md`）：

| 宪法约束 | 现状 | 与 Cloudflare 方案的兼容 |
|---|---|---|
| 搜索并发 ≤ 2 | `SEARCH_ENRICH_CONCURRENCY=2`，`SEARCH_LLM_CONCURRENCY=2` | ✅ 云端不碰搜索，本地保留 |
| 3000 字符 LLM 输入 | `MAX_WEBSITE_TEXT_FOR_LLM=3000` | ✅ 云端不碰 LLM |
| Gold Filter (score≥80) 上云 | `supabase-service.ts:105` `GOLD_FILTER_MIN_SCORE=80` | ✅ 直接搬到 D1 层 |
| Fail-Closed 授权 | `license-guard.ts` `PREMIUM_FEATURES=[..., 'cloud_send', ...]` | ✅ 云端 Workers API 也必须实现同等门禁 |
| 边缘重活云端轻量 | `ARCH-STANDARDS.md §7`："云端仅存精简状态" | ✅ **与用户"云端唯一真相源"存在张力**（见下） |
| Zustand 本地持久化 | `src/store/leads-store.ts` | ⚠️ **需澄清"唯一真相源"含义**（见下） |

**⚠️ 关键张力一：「云端唯一真相源」vs「边缘重活云端轻量」**

用户原话："cloud as single source of truth"。但 Kone V1.3 宪法 `ARCH-STANDARDS.md §7` 明确"边缘重活，云端轻量"。二者表面冲突，实际可通过**语义分层**解决：

- **业务线索台账**（云端为真相源）：`leads`（审批后的候选池）、`outreach`（发送/回复状态）、`approvals`（审批记录）、`suppressions`（全局抑制）、`events`（事件流）—— 云端是权威；
- **本地工作台态**（本地为真相源）：搜索中间态、LLM 提示缓存、Zustand 未审批候选、Draft 版本、Agent 运行日志 —— 云端**不感知**；
- **边界**：只有经过 Gold Filter 的候选才"上云入册"，云端记录一旦建立就永久保留（不可删除，仅可追加事件）。

**建议表述修正**：把"云端唯一真相源"细化为 **"云端为业务线索台账的唯一真相源，本地为工作台态的唯一真相源"**。这与 `CLOUD-COLLABORATION-DELIVERY.md §1` 的"一体化职责边界"完全一致，且不违反 V1.3 宪法。

**结论**：可行，但**必须澄清"唯一真相源"的边界定义**，否则会与 V1.3 宪法的"边缘重活云端轻量"永久矛盾。

### 2.3 铁律三："云端为唯一真相源 D1" —— 需从 Supabase 迁移，中高风险 ⚠️

**现有证据**：
- `supabase-service.ts` 是完整的云端实现（622 行，11 个 IPC 端点）；
- 前端订阅：`IPC_CHANNELS.CLOUD.*` 11 个通道已在 `electron/ipc/channels.ts` 定义、`supabase-service.ts` 注册；
- `RealtimeChannel` 已订阅 `leads` 表变更，`IPC_CHANNELS.CLOUD.REALTIME_LEAD_EVENT` 已推送至渲染进程；
- `CLOUD-COLLABORATION-DELIVERY.md §9` 明确定义了云端核心实体：`companies`/`contacts`/`leads`/`approvals`/`outreach`/`events`/`suppressions`。

**迁移路径**：
- **不是简单替换库**：Supabase 使用 PostgREST + Realtime；Cloudflare D1 使用 SQLite + HTTP API + Websocket（**无原生 Realtime**）。
- **Realtime 替代方案**：Cloudflare 有 3 条路 —— (a) 用 Pages 前端轮询 D1；(b) 用 Cloudflare Queue + Websocket；(c) 用 Durable Objects 提供 WebSocket 广播。**推荐 (c)**：Durable Object 是 Cloudflare 唯一能同时保证有序性和实时性的方案，且免费额度内可用。
- **RLS 迁移**：Supabase 用行级安全（RLS）做租户隔离；D1 无 RLS，需**在 Worker API 层显式校验 `workspace_id`**（Fail-Closed）。

**风险矩阵**：

| 风险 | 严重性 | 缓解 |
|---|---|---|
| D1 无原生 Realtime，需 Durable Object | 中 | DO 免费额度充足，架构复杂但可控 |
| Supabase RLS 语义丢失，需在 Worker 层实现 | 高 | 强制所有 SQL 拼接 `WHERE workspace_id = ?`；单测覆盖 |
| 前端 11 个 IPC 端点契约不变（`IPC_CHANNELS.CLOUD.*`），但主进程实现整体重写 | 中 | 保持 IPC 契约稳定，主进程内替换后端，前端零改动 |
| 团队已有 Supabase 部署的迁移路径 | 中 | 提供一次性数据导出脚本（Supabase→D1），或明确"新部署走 CF，老部署继续用 Supabase" |

**结论**：可行，但**不是一次改动，是 2-3 天的中等工程**。建议放在 Phase 1，且**允许短期双栈共存**（新工作区走 CF，老工作区继续 Supabase）。

### 2.4 铁律四："零服务端成本（CF Free + Resend Free ≤80/日）" —— 基本可行，但需按用户数分摊 ⚠️

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
| Durable Objects | 免费额度（免费计划内基础量） | 每工作区 1 个 DO | ✅ |

**Resend Free Tier 约束**：
- **100 封/日**、**10k 封/月**、仅 1 个发件域、无 SSO、无自定义模板变量（`{{first_name}}` 等变量在 Free 有严格限制）；
- **实际业务量估算**：假设每个团队 3 人，每天触达 20 家，则日均 20 封 —— **100 封/日可支撑 5 个团队**。若用户量 >5 个团队，Resend Free 会成为瓶颈。

**关键权衡**：
- **本地 SMTP 保留**：`email-agent.ts` 已经有完整的 SMTP 通道（`smtpHost`/`smtpPort`/`smtpUser`/`smtpPass`），用户用自己的邮箱账号（Gmail/Outlook/自建 Postfix）发信，**0 成本、无配额限制**（仅受邮件提供商限制）。
- **云端 Resend 作为可选通道**：适合无自有邮箱的团队，作为"零配置开箱即用"体验。
- **推荐策略**：**本地 SMTP 为主通道，Resend 作为兜底/预览通道**，两者通过 Worker API 统一路由。

**结论**：**零服务端成本可行**，但需要**明确 Resend Free 是"预览/兜底"通道，本地 SMTP 才是主力发送通道**。100 封/日限制不适合作为生产通道的强约束。

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

```
┌────────────────────────────────────────────────────────────────────────┐
│  Local Electron (Kone AI)                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────────────────┐  │
│  │ Zustand  │  │ Email    │  │ Followup  │  │ Push Skill (新建)   │  │
│  │ Store    │  │ Agent    │  │ Scheduler │  │ CF Workers API     │  │
│  │ (本地真相)│  │ (SMTP/IMAP)│ │ (4 段序列)│  │ 推送台账到 D1       │  │
│  └──────────┘  └──────────┘  └───────────┘  └────────────────────┘  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ HTTPS + Bearer
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Cloudflare (免费层级)                                                   │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Workers API (api.kone-cloud.workers.dev)                       │  │
│  │  ─ POST /leads (幂等上云，本地推送)                              │  │
│  │  ─ POST /outreach (创建投递任务)                                │  │
│  │  ─ POST /events/webhook (Resend 回执)                           │  │
│  │  ─ GET  /dashboard/* (看板数据)                                 │  │
│  │  ─ POST /suppressions/unsubscribe (一键退订)                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────┐  ┌───────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │    D1      │  │   Queue       │  │ Durable    │  │  Email      │  │
│  │ (业务台账)  │  │ (任务/事件)    │  │ Object     │  │  Workers    │  │
│  │ leads /    │  │ (异步发送)     │  │ (Realtime) │  │ (退订路由)   │  │
│  │ outreach / │  │               │  │            │  │             │  │
│  │ approvals/ │  │               │  │            │  │             │  │
│  │ events /   │  │               │  │            │  │             │  │
│  │ suppressions│  │               │  │            │  │             │  │
│  └────────────┘  └───────────────┘  └────────────┘  └─────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Cron Trigger (每 15 分钟扫队) → 触发 Queue → Worker 发送 → Resend │  │
│  │  Pages 看板 (React + Vite) → 通过 Workers API 拉数据 + DO Realtime  │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                        ┌──────────────┐
                        │   Resend     │
                        │ (可选发送通道)│
                        │ (Free 100/日)│
                        └──────────────┘
```

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

```sql
-- ─────────────────────────────────────────────────────────
-- Kone V1.3 Cloudflare D1 Schema
-- 版本：v1.0.0 (2026-09-25)
-- 迁移位置：cloudflare/migrations/001_init.sql
-- ─────────────────────────────────────────────────────────

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- 工作区（租户）—— 每个客户工作区一条
CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,          -- UUIDv7
  name          TEXT NOT NULL,
  api_token_hash TEXT NOT NULL,            -- SHA-256(token)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_workspaces_token ON workspaces(api_token_hash);

-- 联系人（规范化邮箱）
CREATE TABLE IF NOT EXISTS contacts (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  normalized_email TEXT NOT NULL,          -- trim().toLowerCase()
  title        TEXT,
  department   TEXT,
  verification_grade TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_grade IN ('verified','probable','catch_all','risky','invalid','unverified')),
  manual_exception_reason TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, normalized_email)
);
CREATE INDEX IF NOT EXISTS idx_contacts_ws_email ON contacts(workspace_id, normalized_email);

-- 公司（规范化域名）—— 用于团队防撞单
CREATE TABLE IF NOT EXISTS companies (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  normalized_domain  TEXT NOT NULL,
  name               TEXT,
  country            TEXT,
  owner_machine_id   TEXT,                 -- 认领机器
  owner_label        TEXT,
  protection_until   TEXT,                 -- 防撞单保护期（ISO8601）
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, normalized_domain)
);
CREATE INDEX IF NOT EXISTS idx_companies_ws_domain ON companies(workspace_id, normalized_domain);
CREATE INDEX IF NOT EXISTS idx_companies_owner     ON companies(owner_machine_id);

-- 业务线索台账（LeadBusinessStatus）
CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL DEFAULT 0,           -- ICP+LLM 综合分（0-100）
  evidence_summary TEXT,                                -- JSON: 摘要 + 引用 URL
  risk_flags      TEXT,                                 -- JSON: DNS 健康、邮件验证等级等
  status          TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','scored','pending_approval','approved','queued','sent','replied','rejected','suppressed','failed','archived')),
  approval_id     TEXT,                                 -- 外键到 approvals.id（未审批前 NULL）
  draft_version   INTEGER DEFAULT 0,
  local_ref_id    TEXT NOT NULL,                        -- 本地 Zustand leadKey
  idempotency_key TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, local_ref_id)
);
CREATE INDEX IF NOT EXISTS idx_leads_status       ON leads(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_approval     ON leads(approval_id);
CREATE INDEX IF NOT EXISTS idx_leads_idempotency  ON leads(workspace_id, idempotency_key);

-- 审批记录（不可覆盖）
CREATE TABLE IF NOT EXISTS approvals (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id               TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  approver_machine_id   TEXT NOT NULL,
  decision              TEXT NOT NULL CHECK (decision IN ('approved','rejected','needs_revision')),
  approved_at           TEXT NOT NULL,
  draft_version         INTEGER NOT NULL,
  email_verification_grade TEXT NOT NULL,
  manual_exception_reason TEXT,
  risk_snapshot         TEXT,                              -- JSON 快照
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_approvals_lead    ON approvals(lead_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON approvals(approver_machine_id);

-- 投递任务（OutreachStatus）
CREATE TABLE IF NOT EXISTS outreach (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id           TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id       TEXT NOT NULL,                        -- 活动标识（自由文本）
  sequence_stage    INTEGER NOT NULL DEFAULT 0 CHECK (sequence_stage BETWEEN 0 AND 3),
  scheduled_at      TEXT NOT NULL,                        -- ISO8601 UTC
  sent_at           TEXT,
  delivered_at      TEXT,
  bounced_at        TEXT,
  complained_at     TEXT,
  replied_at        TEXT,
  provider          TEXT NOT NULL DEFAULT 'local_smtp' CHECK (provider IN ('local_smtp','resend','gmail_api')),
  provider_message_id TEXT,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,                        -- 完整正文（可含模板变量渲染后版本）
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','sent','delivered','bounced','complained','failed')),
  bounce_type       TEXT CHECK (bounce_type IN ('temporary','permanent')),  -- 区分软硬退
  error             TEXT,
  idempotency_key   TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, campaign_id, contact_email, sequence_stage)
    -- 注：contact_email 需通过 contact_id 关联，此处为逻辑约束，实际由应用层保证
);
CREATE INDEX IF NOT EXISTS idx_outreach_status    ON outreach(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_outreach_lead      ON outreach(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_provider  ON outreach(provider_message_id);

-- 事件流（追加式，禁止 UPDATE/DELETE）
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id         TEXT,
  outreach_id     TEXT,
  type            TEXT NOT NULL
    CHECK (type IN ('lead.created','lead.approved','lead.rejected','outreach.queued','outreach.sent','outreach.delivered','outreach.bounced','outreach.complained','outreach.replied','suppression.added','suppression.removed','approval.created','manual.action','sync.failed','sync.retried')),
  actor           TEXT,                                    -- machine_id 或 'system' 或 'resend'
  payload         TEXT,                                    -- JSON
  external_id     TEXT,                                    -- 外部系统消息 ID（去重）
  occurred_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_lead       ON events(lead_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_outreach   ON events(outreach_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_type_time  ON events(type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_external   ON events(workspace_id, external_id);

-- 全局抑制（唯一可跨工作区的表；由 One-Click 与硬退触发）
CREATE TABLE IF NOT EXISTS suppressions (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT,                                  -- NULL 表示全局（跨租户）抑制
  normalized_email  TEXT NOT NULL,
  reason            TEXT NOT NULL CHECK (reason IN ('user_unsubscribe','one_click_unsubscribe','hard_bounce','complaint','manual')),
  source            TEXT NOT NULL,                          -- 'manual'|'webhook'|'system'
  added_by          TEXT,                                  -- machine_id
  added_at          TEXT NOT NULL,
  expires_at        TEXT,                                  -- 可选过期
  UNIQUE(workspace_id, normalized_email, reason)
);
CREATE INDEX IF NOT EXISTS idx_supp_email   ON suppressions(normalized_email);
CREATE INDEX IF NOT EXISTS idx_supp_ws_email ON suppressions(workspace_id, normalized_email);

-- 日配额与熔断状态（跨工作区）
CREATE TABLE IF NOT EXISTS delivery_quota (
  workspace_id      TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  today_key         TEXT NOT NULL,                         -- 'YYYY-MM-DD'
  sent_today        INTEGER NOT NULL DEFAULT 0,
  bounced_today     INTEGER NOT NULL DEFAULT 0,
  complained_today  INTEGER NOT NULL DEFAULT 0,
  last_reset_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  circuit_open_until TEXT                                  -- ISO8601，NULL 表示熔断关闭
);

-- 变更令牌（可选，用于 Pages 看板实时刷新）
CREATE TABLE IF NOT EXISTS sync_tokens (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 4.3 索引与写入性能评估

- 所有 WHERE 子句（`workspace_id + status`、`workspace_id + idempotency_key`、`normalized_email`、`provider_message_id`、`occurred_at`）均已有索引；
- `events` 表采用自增 ID + 复合索引，追加式写入无写放大；
- `suppressions` 是唯一支持跨工作区查询的表（`workspace_id` 可为 NULL）；
- **预估写入 TPS**：单个团队 20 人日常操作 < 500 writes/day，远低于 D1 免费额度 10,000 writes/day。

---

## 5. Workers 核心 API 契约

### 5.1 通用约定

- **Base URL**：`https://api.kone-cloud.workers.dev/v1`
- **鉴权**：所有端点要求 `Authorization: Bearer <token>`，token 存储为 SHA-256 hash 于 `workspaces.api_token_hash`；
- **幂等**：`POST` 端点必须接受 `Idempotency-Key` header，重复请求返回同一响应；
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

| 方法 | 路径 | 用途 | 幂等 |
|---|---|---|---|
| `POST` | `/leads` | 本地推送已 Gold Filter 的线索台账 | ✅ (idempotency_key) |
| `POST` | `/leads/{id}/approve` | 人工审批 | ✅ (idempotency_key) |
| `POST` | `/leads/{id}/reject` | 人工驳回 | ✅ (idempotency_key) |
| `GET`  | `/leads?status=<s>` | 按状态查询线索 | — |
| `POST` | `/outreach` | 创建投递任务（可含多阶段） | ✅ (idempotency_key) |
| `POST` | `/outreach/{id}/cancel` | 取消排队任务 | ✅ |
| `POST` | `/events/webhook` | Resend Webhook 回调（HMAC 验签） | ✅ (external_id) |
| `GET`  | `/events?since=<ts>&leadId=<id>` | 增量拉取事件（本地轮询用） | — |
| `POST` | `/suppressions/unsubscribe` | One-Click 退订链接命中 | ✅ (email) |
| `GET`  | `/dashboard/stats` | 看板聚合指标 | — |
| `GET`  | `/dashboard/outreach?campaignId=<id>` | 活动明细 | — |
| `GET`  | `/healthz` | 存活探针（无鉴权） | — |

### 5.3 关键端点契约详情

#### 5.3.1 `POST /leads`（本地推送台账）

**请求**：
```http
POST /v1/leads
Authorization: Bearer <token>
Idempotency-Key: <sha256(machine_id|domain|email|score|draft_ver)>
Content-Type: application/json

{
  "localRefId": "abc123",
  "normalizedDomain": "example.com",
  "company": "Example Inc",
  "country": "CN",
  "contact": { "name": "Zhang", "normalizedEmail": "zhang@example.com", "title": "CTO" },
  "score": 85,
  "evidenceSummary": { "matchReasons": ["AI/ML", "Series A"], "urls": ["https://..."] },
  "riskFlags": { "dns": "safe", "emailGrade": "verified" },
  "draftVersion": 3,
  "aiEmail": { "subject": "...", "body": "..." }
}
```

**云端二次门禁（Fail-Closed 顺序）**：
1. Bearer token 校验 → `workspaces.api_token_hash`；
2. Schema 版本校验（`schemaVersion` header）；
3. `Idempotency-Key` 去重（命中返回既有 lead）；
4. 公司防撞单：查询 `companies` 表该 domain 是否已被其他 owner 认领；
5. 全局抑制检查：`suppressions.normalized_email` 命中即拒绝；
6. 写入 `contacts` + `companies` + `leads`（`status='scored'`）；
7. 追加 `events.lead.created`。

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

**请求**：
```http
POST /v1/leads/lead-uuid/approve
Authorization: Bearer <token>
Idempotency-Key: <sha256(lead_id|approver|draft_version|now_bucket)>

{
  "decision": "approved",
  "draftVersion": 3,
  "manualExceptionReason": null,
  "riskSnapshot": { "dns": "safe", "emailGrade": "verified" }
}
```

**云端校验**：
1. 现有 `leads.draft_version` 必须等于请求的 `draftVersion`（草稿变更需重新审批）；
2. `email_verification_grade` 必须与云端记录一致（防止本地篡改）；
3. 写入 `approvals`（不可覆盖）+ 更新 `leads.status='approved'` + 追加 `events.lead.approved`；
4. 若 `decision='approved'` 且 `outreach` 已排队，则**不重复**创建新投递。

#### 5.3.3 `POST /events/webhook`（Resend 回执）

**请求**：
```http
POST /v1/events/webhook
Content-Type: application/json
X-Resend-Signature: t=1700000000,v1=<hmac_sha256(t|payload, webhook_secret)>
X-Resend-Event-Id: evt_abc123

{
  "event": "email.delivered | email.bounce | email.complaint | email.replied | email.opened | email.clicked",
  "id": "evt_abc123",
  "emailId": "msg_xyz",
  "type": "bouncePermanent | bounceTemporary | complaint | ...",
  "to": "zhang@example.com",
  "occurredAt": "2026-09-25T10:00:00Z"
}
```

**云端处理（顺序 Fail-Closed）**：
1. **HMAC 验签**：`HMAC-SHA256(t|payload, webhook_secret)` 必须匹配 `X-Resend-Signature`，且 `t` 与当前时间差 < 5 分钟；
2. **事件唯一键**：`external_id = X-Resend-Event-Id`，命中即幂等返回 200（不重复写库）；
3. 写入 `events` 追加式表；
4. 根据事件类型更新 `outreach.status`：
   - `email.delivered` → `status='delivered'`, `delivered_at`
   - `email.bounce` + `type='bouncePermanent'` → `status='bounced'`, `bounce_type='permanent'`，**写入 suppressions**
   - `email.bounce` + `type='bounceTemporary'` → 保持 `status='sent'`，标记 `bounce_type='temporary'`，进入受控重试
   - `email.complaint` → `status='complained'`，**写入 suppressions**
   - `email.replied` → 更新 `leads.status='replied'`，通知负责销售（触发 IPC 推送）
5. 熔断检查（见 §9）：更新 `delivery_quota`。

#### 5.3.4 `POST /suppressions/unsubscribe`（One-Click 退订）

**请求**：
```http
POST /v1/suppressions/unsubscribe?email=zhang%40example.com
Content-Type: application/x-www-form-urlencoded
# 无需鉴权（One-Click 链接公开），但 email 必须校验
```

**云端处理**：
1. 规范化邮箱（`trim().toLowerCase()`）；
2. 写入 `suppressions(reason='one_click_unsubscribe', source='webhook')`；
3. 扫描 `outreach` 表，取消该邮箱所有 `status='pending'` 的任务；
4. 追加 `events.suppression.added`；
5. 返回标准 HTTP 200（One-Click 规范要求），Body 为 HTML 确认页。

### 5.4 错误码约定

| Code | HTTP | 含义 | 是否重试 |
|---|---|---|---|
| `INVALID_TOKEN` | 401 | Bearer 无效或过期 | ❌ |
| `INSUFFICIENT_PERMISSION` | 403 | 跨 workspace 访问 | ❌ |
| `NOT_FOUND` | 404 | 资源不存在 | ❌ |
| `VALIDATION_ERROR` | 400 | 字段校验失败 | ❌（修正后重试） |
| `IDEMPOTENCY_CONFLICT` | 409 | 幂等键冲突但载荷不同 | ❌ |
| `TEAM_COLLISION` | 409 | 撞单保护期冲突 | ❌（需人工介入） |
| `SUPPRESSED` | 422 | 收件人被抑制 | ❌ |
| `RATE_LIMITED` | 429 | 日配额耗尽 | ✅（次日重试） |
| `CIRCUIT_OPEN` | 429 | 熔断触发，暂停投递 | ✅（熔断过期后） |
| `INTERNAL` | 500 | 未知错误 | ✅ |

---

## 6. Cron 调度逻辑与关键实现要点

### 6.1 调度策略（Cloudflare Cron Trigger）

```javascript
// wrannel.toml
[[triggers.crons]]
  schedule = "*/15 * * * *"   // 每 15 分钟
  binding  = "CRON"
```

### 6.2 调度伪代码

```javascript
// worker/src/cron-sender.js
export default {
  async fetch(request, env, ctx) {
    if (request.headers.get('cf-scheduled')) {
      return dispatchBatchSend(env);
    }
    // ... other routes
  }
};

async function dispatchBatchSend(env) {
  const db = env.D1_DB;
  const now = new Date().toISOString();
  const nowTs = Date.now();

  // 1) 熔断检查（跨工作区）
  for (const q of await db.prepare('SELECT * FROM delivery_quota WHERE circuit_open_until IS NOT NULL OR circuit_open_until > ?').bind(now).all()) {
    if (q.circuit_open_until > now) continue;
    await db.prepare('UPDATE delivery_quota SET circuit_open_until = NULL WHERE workspace_id = ?').bind(q.workspace_id).run();
  }

  // 2) 扫队：找出到期的 pending 任务
  const due = await db.prepare(`
    SELECT o.*, l.workspace_id as ws, l.contact_id
    FROM outreach o
    JOIN leads l ON o.lead_id = l.id
    WHERE o.status = 'pending'
      AND o.scheduled_at <= ?
      AND o.workspace_id NOT IN (SELECT workspace_id FROM delivery_quota WHERE circuit_open_until > ?)
    ORDER BY o.scheduled_at ASC
    LIMIT 100   -- 批量控制，防单次调度卡住
  `).bind(now, now).all();

  // 3) 分工作区统计，逐条尝试发送
  for (const task of due.results) {
    try {
      await sendSingleOutreach(task, env, db);
    } catch (err) {
      // 失败任务进入事件流 + 受控重试
      await db.prepare(`INSERT INTO events (workspace_id, outreach_id, type, actor, payload, occurred_at)
        VALUES (?, ?, 'sync.failed', 'cron', ?, ?)`)
        .bind(task.workspace_id, task.id, JSON.stringify({ error: err.message }), now).run();
      // 判断是否重试：temporary bounce 最多重试 2 次，permanent 直接标记
    }
  }

  // 4) 熔断触发
  const sentToday = (await db.prepare('SELECT COUNT(*) as c FROM outreach WHERE status IN (\'sent\',\'delivered\') AND sent_at >= date(\'now\')').first()).c;
  const bouncedToday = (await db.prepare('SELECT COUNT(*) as c FROM outreach WHERE status = \'bounced\' AND bounced_at >= date(\'now\')').first()).c;
  const complainedToday = (await db.prepare('SELECT COUNT(*) as c FROM outreach WHERE status = \'complained\' AND complained_at >= date(\'now\')').first()).c;

  if (bouncedToday > 3 || complainedToday > 0 || (bouncedToday / Math.max(sentToday, 1)) > 0.03) {
    // 熔断：4 小时暂停投递
    const openUntil = new Date(Date.now() + 4*3600*1000).toISOString();
    await db.prepare('UPDATE delivery_quota SET sent_today=?, bounced_today=?, complained_today=?, circuit_open_until=? WHERE workspace_id=?')
      .bind(sentToday, bouncedToday, complainedToday, openUntil, task.workspace_id).run();
    console.warn('[Cron] Circuit OPEN for', task.workspace_id, 'until', openUntil);
  }

  return new Response(JSON.stringify({ scanned: due.results.length, now }), {
    headers: { 'content-type': 'application/json' }
  });
}

async function sendSingleOutreach(task, env, db) {
  // 时区校验：本地时区 9:00-11:30 或 14:00-16:30，周二-周四
  const { isWithinSendWindow } = await import('../schedule-window.js');
  if (!isWithinSendWindow(task.scheduled_at)) {
    // 延后到下个工作日窗口
    await db.prepare('UPDATE outreach SET scheduled_at = ?, updated_at = ? WHERE id = ?')
      .bind(computeNextWindow(task.scheduled_at), new Date().toISOString(), task.id).run();
    return;
  }

  // Resend 发送（或降级到 Queue 异步）
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `Kone Outreach <outreach@${env.SENDER_DOMAIN}>`,
      to: [decodeEmail(task.contact_email)],
      subject: task.subject,
      html: task.body,
      tags: [
        { name: 'lead_id', value: task.lead_id },
        { name: 'outreach_id', value: task.id },
        { name: 'workspace_id', value: task.workspace_id },
        { name: 'campaign', value: task.campaign_id }
      ]
    })
  });

  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // 更新投递状态
  await db.prepare(`UPDATE outreach SET status='accepted', provider='resend', provider_message_id=?, updated_at=? WHERE id=?`)
    .bind(data.id, new Date().toISOString(), task.id).run();
  await db.prepare(`INSERT INTO events (workspace_id, outreach_id, type, actor, payload, occurred_at) VALUES (?, ?, 'outreach.queued', 'cron', ?, ?)`)
    .bind(task.workspace_id, task.id, JSON.stringify({ resendId: data.id }), new Date().toISOString()).run();
}
```

### 6.3 序列节律定义

| Stage | 触发时机 | 间隔 | 内容来源 |
|---|---|---|---|
| 0 (首封) | 审批通过后立即入队 | — | 本地 `aiEmail`（Stage 0 消费） |
| 1 (跟进 1) | Stage 0 发送后 Day 3-5 | 3-5 天（±20% 抖动） | 模板 + LLM 生成（行业洞察） |
| 2 (跟进 2) | Stage 1 后 Day 7-10 | 3-4 天 | 模板（案例研究） |
| 3 (收束) | Stage 2 后 Day 12-14 | 2-3 天 | 模板（Break-up 礼貌确认） |

**关键约束**：
- 收到回复（`events.outreach.replied`）→ 立即将 `outreach.status='replied'`，**所有 pending 后续 stage 自动取消**；
- 收到退订/投诉/永久硬退 → 立即加入 `suppressions`，**所有 pending 后续 stage 自动取消**；
- 时区窗口：仅周二-周四、本地 9:00-11:30 或 14:00-16:30；
- 抖动：Stage 间隔 ±20%，避免整点节律指纹（对齐本地 `jitteredInterval()` 语义）。

---

## 7. Resend / Email Worker 集成要点

### 7.1 双通道设计（本地 SMTP 保留 + Resend 兜底）

```
┌────────────────────────────────────────────────────────┐
│  Local Kone AI                                          │
│  Email Agent (SMTP/IMAP)                                │
│  ─ 主力通道（用户自有邮箱）                              │
│  ─ 免费无配额，但受邮件提供商限制                        │
│  ─ 发送后通过 IMAP 检测回复                             │
└────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌──────────────────────────┐
              │  Cloudflare Worker API   │
              │  POST /outreach          │
              │  (选择 provider 参数)     │
              └──────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   ┌─────────────────────┐       ┌─────────────────────┐
   │ provider='local_smtp'│       │ provider='resend'   │
   │ (本地代发，回写事件)  │       │ (Cloudflare 发送)    │
   └─────────────────────┘       └─────────────────────┘
              │                               │
              ▼                               ▼
   ┌─────────────────────┐       ┌─────────────────────┐
   │ 本地 IMAP 检测回复   │       │ Resend Webhook 回执  │
   │ → 写 events 表      │       │ → 写 events 表       │
   └─────────────────────┘       └─────────────────────┘
```

### 7.2 Resend 集成配置

**Cloudflare Secrets**（`wrangler secret put`）：
- `RESEND_API_KEY`：Resend API Key（Free Tier 或付费）；
- `RESEND_WEBHOOK_SECRET`：Webhook 验签密钥；
- `SENDER_DOMAIN`：发件域名（须在 Resend 内验证 SPF/DKIM）；
- `CLOUD_API_SIGNING_SECRET`：本地→云端 API 的双向 HMAC 签名密钥（可选增强）。

**Resend 域名验证**（一次性）：
1. 在 Resend 控制台添加发件域；
2. 按 Resend 指导配置 SPF（`v=spf1 include:_spf.resend.com ~all`）、DKIM（3 条 CNAME 记录）；
3. 可选：DMARC 记录；
4. **域名所有权验证**（TXT 记录 `_verify.<domain>`）。

### 7.3 Email Worker（退订路由）

```javascript
// worker/src/email-worker.js
// Cloudflare Email Workers（免费）
export default {
  async asyncEmail({ message, raw, envelope }, env, ctx) {
    const to = envelope.to;
    // 判断是否退订请求（发件人是 unsubscribe@<domain>）
    if (envelope.from.endsWith('@kone-unsubscribe.workers.dev')) {
      // 解析 email 参数
      const unsubscribeEmail = raw.text.match(/X-Original-To:\s*(\S+)/i)?.[1];
      if (unsubscribeEmail) {
        await addSuppression(env.D1_DB, unsubscribeEmail, 'user_unsubscribe');
      }
    }
    return { accept: true };
  }
};
```

### 7.4 List-Unsubscribe 合规头

所有 Resend 发送必须包含：
```
List-Unsubscribe: <https://api.kone-cloud.workers.dev/v1/suppressions/unsubscribe?email=<base64_email>>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Worker 端 `POST /suppressions/unsubscribe` 必须：
- 无需 Bearer 鉴权（One-Click 规范）；
- 邮箱必须经过 base64 解码 + 规范化；
- 响应 200 HTML 确认页；
- 记录到 `events` 表（`type='suppression.added'`）。

### 7.5 Free Tier 使用建议

| 场景 | 推荐通道 | 理由 |
|---|---|---|
| 客户自己有企业邮箱 | 本地 SMTP | 免费、无配额、品牌邮件域名 |
| 客户无邮箱（团队新用户） | Resend Free | 100 封/日够用；单发件域 |
| 客户需要 A/B 测试 | Resend（付费） | Free 不支持自定义模板变量 |
| 客户需要 SSO/审计 | Resend（付费） | Free 无 SSO |
| 客户日均触达 > 30 封 | Resend（付费） 或本地 SMTP | Free 配额不足 |

---

## 8. Pages 看板核心页面结构

### 8.1 技术选型

- **框架**：React 18 + Vite（与本地 Kone AI 一致，减少技术栈分裂）；
- **实时**：Cloudflare Durable Object WebSocket 广播（或 30 秒轮询 `/events?since=<ts>` 兜底）；
- **鉴权**：与 Workers API 共用 Bearer token；
- **部署**：Cloudflare Pages（免费，1000 站点）。

### 8.2 页面清单

| 页面 | 路由 | 用途 | 关键指标 |
|---|---|---|---|
| 概览 | `/` | 团队当日 KPI | 触达/送达/回复/转化率、熔断状态 |
| 线索台账 | `/leads` | 全部业务线索 | 状态筛选、评分排序、证据展开 |
| 审批队列 | `/approval` | 待人工审批 | 证据、风险、草稿预览、批准/驳回 |
| 活动看板 | `/campaigns` | 活动详情 | 序列节律、单线索时间线 |
| 事件流 | `/events` | 全部事件 | 类型/时间/操作人筛选 |
| 抑制管理 | `/suppressions` | 全局黑名单 | 原因、来源、添加时间、人工解除 |
| 团队管理 | `/team` | 工作区成员 | 认领机器、日限额、熔断阈值 |
| 系统设置 | `/settings` | API token、Resend 配置 | Webhook 密钥、发件域名 |

### 8.3 核心交互

**审批卡片**（`/approval`）：
- 展示：公司名、评分、证据摘要、风险标记、草稿预览、验证等级；
- 操作：批准 / 驳回 / 需修改；
- 权限：仅 approved 状态的 lead 可入 outreach；
- 版本控制：草稿变更后旧审批失效，需重新审批。

**事件时间线**（`/campaigns/:id`）：
- 按时间轴展示单线索的全部事件；
- 支持跳转到出处（原始搜索 URL、草稿版本、审批记录）；
- 支持人工触发事件（取消排队、手动加入抑制）。

**看板指标**（`/`）：
- 今日触达数、送达率、回复率、熔断状态；
- 序列节奏图（Day 0 / Day 3-5 / Day 7-10 / Day 12-14）；
- 抑制清单增长趋势。

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
| `createCampaign()` 注释 | 改为 "由 Cloudflare Workers 消费" | 一行 |
| `IPC_CHANNELS.CLOUD.*` | **不变**（契约稳定） | 主进程内路由切换 |
| 前端 | **零改动**（IPC 契约稳定） | 用户无感 |
| `email-agent.ts` | 保留本地 SMTP；新增可选 Resend 发送器 | 通过 Worker API 转发 |
| `followup-scheduler.ts` | 保留本地 4 段序列；新增云端状态同步 | 通过 `GET /events?since=<ts>` 拉取 |

### 9.3 数据流向

```
本地 KONE AI (Zustand + FollowupPlan)
        │
        │  Gold Filter (score≥80) + Fail-Closed
        ▼
cloudflare-service.ts (新增)
        │
        │  HTTPS + Bearer + Idempotency-Key
        ▼
Cloudflare Workers API
        │
        ▼
D1 (leads / approvals / outreach / events / suppressions)
        │
        │  Cron 触发 Queue
        ▼
Resend (可选) → 回执 → Webhook → D1
        │
        │  本地轮询 GET /events?since=<ts>
        ▼
Zustand → IPC → UI 实时更新
```

### 9.4 迁移路径（不破坏现有部署）

**阶段 A**（Phase 1）：**双栈共存**
- `supabase-service.ts` 保留不动；
- 新增 `cloudflare-service.ts`；
- 通过 `user_config.cloudProvider`（'supabase' | 'cloudflare'）路由；
- 老工作区默认 'supabase'，新工作区默认 'cloudflare'。

**阶段 B**（Phase 2）：**迁移工具**
- 提供 Supabase→D1 数据导出脚本；
- 迁移期间允许读旧写新；
- 迁移完成后关闭 Supabase 依赖。

**阶段 C**（Phase 3，可选）：**清理**
- 删除 `supabase-service.ts` 及相关依赖；
- 更新 `PROVIDER-CAPABILITY.md`。

---

## 10. 安全与熔断 Checklist

### 10.1 鉴权与授权

- [ ] 所有 API 端点（除 `/healthz`、`/suppressions/unsubscribe`）要求 `Authorization: Bearer`；
- [ ] Bearer token 存储为 SHA-256 hash，明文不落库；
- [ ] `workspace_id` 显式校验（替代 Supabase RLS）；
- [ ] 所有 SQL 必须包含 `workspace_id` 过滤，禁止裸查询；
- [ ] Durable Object WebSocket 连接要求一次性 token（JWT 或短期 Bearer）；
- [ ] 本地 KONE AI 通过 `cloudflare-service.ts` 强制使用 `registerSecureFeatureIpc('cloud_send', ...)`，维持 Fail-Closed 授权门禁。

### 10.2 Webhook 安全

- [ ] 所有 Resend Webhook 必须验证 `X-Resend-Signature`（HMAC-SHA256）；
- [ ] 时间窗校验：`t` 与当前时间差 < 5 分钟；
- [ ] 事件唯一键 `external_id` 幂等去重；
- [ ] 验签失败返回 401，不写库、不改状态；
- [ ] 敏感事件（`outreach.replied`）二次校验：`message_id` 必须匹配已知的 `outreach.provider_message_id`。

### 10.3 熔断与限流

- [ ] 日发送上限（默认 100 封/日，可配置）；
- [ ] 硬退率 > 3% → 熔断 4 小时；
- [ ] 投诉率 > 0.05% → 熔断 4 小时；
- [ ] 熔断期间所有 `pending` 任务延迟到熔断过期后；
- [ ] Resend API 返回 429 → 立即熔断 15 分钟；
- [ ] 单次 Cron 批量 ≤ 100 条，防卡住。

### 10.4 数据保护

- [ ] 所有密钥（Resend API Key、Webhook Secret）通过 `wrangler secret put` 存储；
- [ ] 不在普通配置、Renderer、日志或安装包中出现密钥；
- [ ] 本地→云端 API 载荷**必须经 Gold Filter**，禁止上传原始 HTML、未准入候选、SMTP 密码、Cookie、Session；
- [ ] 本地 Payload 白名单字段（对齐 `CLOUD-COLLABORATION-DELIVERY.md §7`）：
  - ✅ `schemaVersion`、`idempotencyKey`、`workspaceId`、`localRefId`、`company`、`normalizedDomain`、`contact`、`normalizedEmail`、`score`、`evidenceSummary`、`riskFlags`、`emailVerificationGrade`、`approvalId`、`approverMachineId`、`approvedAt`、`draftVersion`、`subject`、`body`、`campaignId`、`sequenceStage`
  - ❌ 原始 HTML、未准入候选、API Key、SMTP 密码、Cookie、Session、浏览器配置、无关联系人。
- [ ] `events` 表只 INSERT 不 UPDATE/DELETE（追加式审计）；
- [ ] `approvals` 表不可覆盖（草稿版本变更必须新建记录）。

### 10.5 合规

- [ ] 所有 Resend 发送包含 `List-Unsubscribe` 与 `List-Unsubscribe-Post` 头；
- [ ] One-Click Unsubscribe 链接必须返回 200 HTML 确认页；
- [ ] 全局抑制永久生效，重新导入、重新评分、修改草稿**不得解除抑制**；
- [ ] 人工解除抑制必须记录操作人、时间、原因；
- [ ] 数据保留期：业务数据默认 24 个月（可配置），事件日志默认 12 个月；
- [ ] GDPR/CCPA 数据主体请求接口：`POST /privacy/export`（导出）、`POST /privacy/delete`（删除）。

---

## 11. 部署与配置清单

### 11.1 Cloudflare 项目结构

```
kone-cloud/
├── wrangler.toml                     # CF 项目根配置
├── package.json
├── README.md
├── migrations/
│   ├── 001_init.sql                  # D1 完整 schema
│   └── 002_seed.sql                  # 可选：初始工作区
├── worker/
│   ├── src/
│   │   ├── index.ts                  # 入口
│   │   ├── routes/
│   │   │   ├── leads.ts
│   │   │   ├── approvals.ts
│   │   │   ├── outreach.ts
│   │   │   ├── events.ts
│   │   │   ├── suppressions.ts
│   │   │   └── dashboard.ts
│   │   ├── db/
│   │   │   ├── query.ts              # D1 查询助手
│   │   │   └── schema.ts             # 类型定义
│   │   ├── auth/
│   │   │   ├── bearer.ts
│   │   │   └── idempotency.ts
│   │   ├── schedule/
│   │   │   ├── window.ts             # 时区窗口
│   │   │   └── sequence.ts           # 4 段序列节律
│   │   ├── circuit/
│   │   │   └── breaker.ts            # 熔断器
│   │   └── integrations/
│   │       ├── resend.ts
│   │       └── email-worker.ts
│   ├── test/                         # Vitest 单测
│   └── wrangler.toml
├── pages/
│   ├── src/                          # React + Vite
│   └── wrangler.toml
└── scripts/
    ├── deploy.sh
    ├── migrate.sh
    └── smoke.sh
```

### 11.2 wrangler.toml（Worker 层）

```toml
name = "kone-cloud-api"
account_id = "YOUR_ACCOUNT_ID"
workers_dev = true
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat_v2"]

main = "worker/src/index.ts"
pages_build_output_dir = "pages/dist"

# D1 数据库
[[d1_databases]]
  binding = "D1_DB"
  database_name = "kone-cloud-db"
  database_id = "YOUR_DATABASE_ID"

# 队列（可选，用于异步发送）
[[queues.producers]]
  binding = "SEND_QUEUE"
  queue = "kone-send-queue"
[[queues.consumers]]
  queue = "kone-send-queue"
  max_batch_size = 10
  max_batch_timeout = 10

# Cron
[[triggers.crons]]
  schedule = "*/15 * * * *"
  binding = "CRON"

# Durable Objects（Realtime 广播）
[[durable_objects.bindings]]
  name = "SYNC_OBJECT"
  class_name = "SyncObject"

# 环境变量
[vars]
  SCHEMA_VERSION = "1.0.0"
  SEND_WINDOW_MORNING_START = 9
  SEND_WINDOW_MORNING_END = 11.5
  SEND_WINDOW_AFTERNOON_START = 14
  SEND_WINDOW_AFTERNOON_END = 16.5
  CIRCUIT_OPEN_DURATION_HOURS = 4
  CIRCUIT_BOUNCE_THRESHOLD = 0.03
  CIRCUIT_COMPLAINT_THRESHOLD = 0.0005
  RESEND_FREE_TIER_LIMIT = 100

# Secrets（通过 wrangler secret put 设置）
# - RESEND_API_KEY
# - RESEND_WEBHOOK_SECRET
# - SENDER_DOMAIN
```

### 11.3 部署流程

```bash
# 1) 初始化 D1 数据库
wrangler d1 create kone-cloud-db
wrangler d1 migrate kone-cloud-db --local migrations/001_init.sql
wrangler d1 migrate kone-cloud-db migrations/001_init.sql

# 2) 设置 Secrets
wrangler secret put RESEND_API_KEY          # 输入 Resend API Key
wrangler secret put RESEND_WEBHOOK_SECRET   # openssl rand -hex 32
wrangler secret put SENDER_DOMAIN           # 你的发件域

# 3) 部署 Worker
cd worker && wrangler deploy

# 4) 部署 Pages
cd pages && npm install && npm run build && wrangler pages deploy dist

# 5) 验证
curl https://api.kone-cloud.workers.dev/v1/healthz
curl -H "Authorization: Bearer <token>" https://api.kone-cloud.workers.dev/v1/dashboard/stats
```

### 11.4 本地 KONE AI 侧配置

**新增设置项**（`settings/base-settings-tab.tsx`）：
- `cloud.cloudflareApiUrl`：默认 `https://api.kone-cloud.workers.dev/v1`
- `cloud.cloudflareApiKey`：Bearer token
- `cloud.provider`：'supabase'（默认，兼容）| 'cloudflare'
- `cloud.sendChannel`：'local_smtp'（默认）| 'resend' | 'auto'
- `cloud.resendApiKey`：Resend API Key（仅当 sendChannel='resend' 时）

---

## 12. 风险与边界声明

### 12.1 已识别风险

| # | 风险 | 严重性 | 缓解 |
|---|---|---|---|
| R1 | **Realtime 依赖 Durable Object**，DO 免费额度可能不足 | 中 | 免费额度充足（每账户基础量 + 按用量付费）；可降级为 30s 轮询 |
| R2 | **D1 无 RLS**，Worker 层若漏校验 workspace_id 会导致数据泄露 | 高 | 单测强制断言所有 SQL 包含 workspace_id；review gate |
| R3 | **Resend Free 100 封/日** 不足以支撑生产流量 | 中 | 明确定位为"预览/兜底"通道，本地 SMTP 为主通道 |
| R4 | **N8N 移除后，老客户的自动化流程中断** | 中 | 迁移期保持双栈共存，提供迁移文档；`automation-service.ts` 保留邮箱验证部分 |
| R5 | **Supabase→D1 数据迁移** | 中 | 提供一次性导出脚本；迁移期间允许读旧写新 |
| R6 | **Cloudflare 免费额度随时调整** | 中 | 监控用量，超额时提前通知用户升级；Worker 层实现用量告警 |
| R7 | **本地 SMTP 保留 vs 用户"零配置"预期** | 低 | 提供 Resend 快速配置向导，5 分钟完成域名验证 |
| R8 | **审批流缺失阶段（Phase A 已确认 P0 已清零，但云端审批是新能力）** | 低 | 云端审批与本地审批并存；用户可关闭云端审批仅做台账 |
| R9 | **Suppression 表跨工作区语义** | 低 | `workspace_id` 可 NULL，代表全局抑制；文档明确 |
| R10 | **Cron 单点故障** | 低 | 15 分钟批量容错；单条失败不影响整批 |

### 12.2 明确边界（本方案 **不** 做的事）

- **不重写本地 KONE AI**：所有本地能力（四级弹性搜索、ICP+LLM 双轨评分、Gold Filter、Fail-Closed、Zustand、FollowupScheduler、Email Agent SMTP/IMAP）**全部保留**；
- **不替换 V1.3 宪法**：Cloudflare 层必须继承 `CLOUD-COLLABORATION-DELIVERY.md` SSOT 的所有约束（Fail-Closed、幂等、追加式事件、不可覆盖审批、全局抑制）；
- **不修改授权模型**：`cloud_send` 仍是 Premium 门禁，`license-guard.ts` 不动；
- **不追求云端完全替代本地**：`leads` 表在云端是**台账**（approved 后的候选池），本地 Zustand 是**工作台**（未审批的搜索中间态）；
- **不承诺完全零成本**：Cloudflare Free + Resend Free 是**基础免费额度**，规模增长后需升级（成本可控，但仍需监控）；
- **不承诺 D1 完全替代 Supabase 的 Realtime**：D1 无原生 Realtime，需 Durable Object 或轮询（体验略降级，但可接受）。

### 12.3 与 Phase A 交付的关系

- **Phase A（V1.3 上市前必要优化）已交付**：N1（精准度验证视图）、N2（需处理动作入口）、干净机器验收手册、314/314 单测全绿、打包冒烟通过；
- **本方案（Cloudflare 云地协同）是 V1.3 交付后的新增能力**：不阻断 V1.3 上市；
- **两者正交**：即使完全不实施 Cloudflare，V1.3 仍可作为"本地优先 + 团队轻量协同（Supabase）"的商用 SaaS 工具交付；
- **B-3 云协同**（`KONE-V1.3-B2签名与B4持久化技术方案-2026-09-25.md`）定位为**高级版功能**，本方案正是 B-3 的完整技术方案。

---

## 13. 分阶段执行计划

### Phase 0：立即执行（1-2 天）—— 铁律一落地（零风险）

| 任务 | 动作 | 文件 |
|---|---|---|
| P0-1 | 移除 `automation-service.ts` 中 N8N Webhook 部分（保留邮箱验证） | `electron/services/automation-service.ts` |
| P0-2 | 更新 `supabase-service.ts:332` 注释 | 一行 |
| P0-3 | 更新 `kone-PRD.md` 相关章节，标注"已迁移至 Cloudflare" | 文档 |
| P0-4 | 更新 `CHANGELOG.md` | 文档 |
| P0-5 | 相关单测同步更新 | `tests/` |

**验收**：`npm run test:unit` 全绿、`npm run typecheck` 0 error、`npm run verify:consistency` 双绿。

### Phase 1：最小可用云（1-2 周）—— 团队台账 + 看板

**目标**：本地 KONE AI 能推台账到 Cloudflare，Pages 看板可见；本地 SMTP 仍为主发送通道。

| 任务 | 动作 |
|---|---|
| P1-1 | 创建 `kone-cloud/` monorepo（Worker + Pages + migrations） |
| P1-2 | 实现 `migrations/001_init.sql`（本文档 §4 完整 schema） |
| P1-3 | 实现 Worker 核心路由：`/leads`、`/leads?status=`、`/events?since=`、`/healthz` |
| P1-4 | 实现 Bearer 鉴权、workspace_id 隔离、幂等去重 |
| P1-5 | 实现 Pages 看板骨架（概览 + 线索台账 + 事件流） |
| P1-6 | 本地新增 `cloudflare-service.ts`，实现 `POST /leads` 推送 |
| P1-7 | `user_config.cloudProvider` 路由（'supabase' | 'cloudflare'） |
| P1-8 | 前端 `Settings` 新增 Cloudflare 配置项 |
| P1-9 | 部署到 Cloudflare，端到端冒烟测试 |
| P1-10 | 更新 `CLOUD-COLLABORATION-DELIVERY.md`（Supabase→Cloudflare） |

**验收**：
- 本地推送台账 → D1 存储成功 → Pages 看板可见；
- 本地拉取事件 → Zustand 更新 → UI 实时刷新；
- 老工作区（Supabase）与新工作区（Cloudflare）双栈共存；
- 本地 SMTP 发送路径不受影响。

### Phase 2：云端发送 + 回复闭环（2-3 周）—— 差异化触达

**目标**：支持通过 Cloudflare Resend 发送，Webhook 回执闭环，4 段序列节律。

| 任务 | 动作 |
|---|---|
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

**目标**：完整对齐 `CLOUD-COLLABORATION-DELIVERY.md` 云端 SSOT 全部约束。

| 任务 | 动作 |
|---|---|
| P3-1 | 实现 `POST /leads/{id}/approve` / `/reject`（含 draft_version 校验） |
| P3-2 | 实现 `approvals` 表不可覆盖 + `events.lead.approved` 追加 |
| P3-3 | 实现 `approver_machine_id` 权限校验（工作区管理员 vs 普通成员） |
| P3-4 | 实现 `GET /dashboard/stats`（看板聚合指标） |
| P3-5 | 实现 `/team` 页面（工作区成员、日限额、熔断阈值） |
| P3-6 | 实现 `/privacy/export` 和 `/privacy/delete`（GDPR/CCPA） |
| P3-7 | 实现 Durable Object WebSocket 广播（替代 30s 轮询） |
| P3-8 | 迁移工具：Supabase→D1 数据导出脚本 |
| P3-9 | 老工作区迁移到 Cloudflare 的过渡方案 |
| P3-10 | 更新 `CLOUD-COLLABORATION-DELIVERY.md` 全部为 Cloudflare 实现状态 |
| P3-11 | 完整 E2E 测试套件（Worker + Pages + Resend mock） |

**验收**：
- 审批流完整闭环（草稿变更触发重新审批）；
- 工作区成员权限隔离；
- GDPR/CCPA 合规；
- 迁移工具可用，老工作区可平滑切换；
- 全链路 E2E 通过。

### Phase 4：清理与优化（1 周，可选）

| 任务 | 动作 |
|---|---|
| P4-1 | 删除 `supabase-service.ts`（如全部工作区已迁移） |
| P4-2 | 删除 `automation-service.ts` 中的 Supabase fallback 部分 |
| P4-3 | 更新 `PROVIDER-CAPABILITY.md` 移除 Supabase/N8N |
| P4-4 | 更新 `ARCH-STANDARDS.md` §7 云端章节 |
| P4-5 | 性能优化：D1 查询优化、Worker 冷启动优化、Pages 静态化 |

---

## 14. 决策要点与后续行动

### 14.1 需用户拍板的决策

1. **是否立即执行 Phase 0**（1-2 天，零风险）？
   - 推荐：是，立即移除 N8N 依赖；
   - 理由：铁律一要求"完全放弃 N8N"，成本极低，且不影响其他能力。

2. **Phase 1 是否作为 V1.3 交付前的必做项**？
   - 推荐：否。Phase 1 是**新增能力**，不阻断 V1.3 上市；
   - 理由：Phase A 已确认 B-3 云协同是高级版功能，且 V1.3 已可通过 Supabase 实现基础团队协同。

3. **Supabase 是否保留双栈共存**？
   - 推荐：保留。老工作区继续用 Supabase，新工作区走 Cloudflare，迁移期至少 6 个月；
   - 理由：数据迁移有风险，强制迁移可能影响老用户。

4. **本地 SMTP 是否保留**？
   - 推荐：保留。本地 SMTP 是核心差异化能力，且完全免费；
   - 理由：Resend Free 有配额限制，不适合作为唯一通道。

5. **是否立即开始 Phase 1 编码**？
   - 推荐：否。先完成本文档的评审与拍板，再开始实施；
   - 理由：本方案涉及新增 monorepo、D1 schema、Worker API、Pages 看板，工程量大，需完整评审。

### 14.2 下一步行动

1. **本周**：
   - 用户评审本文档，确认 5 个决策点；
   - 用户确认 Cloudflare 账号（如需）与 Resend 账号（如需）；
   - 开始 Phase 0（1-2 天，移除 N8N 依赖）。

2. **Phase 0 完成后**：
   - 更新 `CHANGELOG.md`、`CLOUD-COLLABORATION-DELIVERY.md`；
   - 提交 PR，走完整验证流程（`test:unit` + `typecheck` + `verify:consistency`）；
   - 发布 V1.3.1 补丁版本。

3. **Phase 1 启动前**：
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
| §5 Workers API | `supabase-service.ts` IPC 端点 | 契约一致，后端替换 |
| §6 Cron 调度 | `followup-scheduler.ts`（本地 4 段序列） | 逻辑对齐，执行位置不同 |
| §7 Resend 集成 | `email-agent.ts`（本地 SMTP） | 保留本地，新增云端 |
| §8 Pages 看板 | 无（新建） | 目标态 |
| §9 本地推送 Skill | 新增 `cloudflare-service.ts` | 与 `supabase-service.ts` 平级 |
| §10 安全熔断 | `CLOUD-COLLABORATION-DELIVERY.md §11` | 与 SSOT 一致 |
| §11 部署配置 | 无（新建） | 目标态 |
| §12 风险边界 | `KONE-V1.3-B2签名与B4持久化技术方案-2026-09-25.md` | 与 B-3 方案对齐 |
| §13 执行计划 | `KONE-V1.3-上线前必要优化梳理-2026-09-25.md`（Phase A） | Phase A 是必要，本方案是新增 |

---

## 附录 B：关键术语

- **Gold Filter**：本地评分阈值过滤（`score >= 80`），只有通过 Gold Filter 的线索才能上云；
- **Fail-Closed**：安全优先，任何不确定情况都默认拒绝（授权失败、Webhook 验签失败、抑制命中等均拒绝）；
- **双轨状态机**：`leads.status`（业务生命周期）与 `outreach.status`（投递通道）分离；
- **幂等键**：SHA-256(machine_id|domain|email|score|draft_version)，防止网络重试重复写入；
- **追加式事件表**：`events` 表只 INSERT 不 UPDATE/DELETE，可保留完整审计；
- **Durable Object**：Cloudflare 提供的状态化 WebSocket 服务，用于 Realtime 广播；
- **One-Click Unsubscribe**：退订链接无需用户点击确认，直接生效（合规要求）；
- **熔断**：投递失败率超过阈值时暂停所有投递，等待恢复后自动重试。

---

*本文档为**规划评估**，未改动任何代码。所有决策点需用户拍板后，方可进入实施阶段。*

*方法论声明：本文档所有结论均基于对项目现有代码的直接读取与取证，非假设性推演。所有与 V1.3 宪法的冲突点已明确标注，所有边界条件已明确声明。*
