# KONE V1.3 Phase 2 · Resend 邮件投递接入规划

> **文档角色**：Phase 2 执行计划与架构设计  
> **前置条件**：Phase 1（Cloudflare 云地协同最小可用）已完成  
> **目标**：完整投递闭环从"目标态"→"可用态"  
> **对齐**：CLOUD-COLLABORATION-DELIVERY.md §8（Fail-Closed）、§7.1（数据契约）

---

## 一、Phase 2 目标与范围

### 1.1 核心目标
在 Phase 1 基础上，补全邮件投递闭环：
1. **队列投递**：`outreach` 表状态机驱动，Cron 定时扫描 → Resend API 发送
2. **Webhook 回调**：Resend 投递状态（sent/delivered/bounced/complained）→ 状态回写
3. **回复事件**：IMAP 轮询或 API 回复检测 → `lead.replied` 状态更新
4. **跨端同步**：本地 Agent 触达状态 ↔ 云端 outreach 状态双向同步

### 1.2 范围界定
| 包含 | 不包含（Phase 3+） |
|------|-------------------|
| Resend API 集成（发送/查询） | 多 SMTP 中继（Postmark/SendGrid） |
| Cron 定时投递（每分钟扫描） | 自定义发送间隔策略 |
| Webhook 状态回写 | 退订管理 UI（Phase 1 已有 API） |
| IMAP 回复检测（可选） | 自动回复 AI 生成 |
| 本地 → 云端状态回写 | 云端 → 本地自动执行 |

---

## 二、架构设计

### 2.1 数据流
```
本地 KONE AI                    Cloudflare Workers                  Resend
    │                               │                               │
    │  POST /v1/leads               │                               │
    │ ────────────────────────────▶ │                               │
    │                               │  INSERT leads (status='queued')
    │                               │                               │
    │                               │  ┌─── Cron (每分钟) ───┐      │
    │                               │  │ SELECT queued leads │      │
    │                               │  │ FOR UPDATE SKIP LOCKED      │
    │                               │  └─────────────────────┘      │
    │                               │                               │
    │                               │  POST /api/emails/send        │
    │                               │ ────────────────────────────▶ │
    │                               │  ◀──────────────────────────── │
    │                               │  200 { id: 'email_123' }      │
    │                               │                               │
    │                               │  UPDATE outreach SET          │
    │                               │    status='sent',             │
    │                               │    resend_id='email_123'      │
    │                               │                               │
    │                               │  ◀── Webhook ──               │
    │                               │  POST /v1/webhooks/resend     │
    │                               │  { event: 'email.delivered' } │
    │                               │                               │
    │  GET /v1/events (since=...)   │                               │
    │ ◀──────────────────────────── │                               │
    │  本地状态回写                   │                               │
    │                               │                               │
```

### 2.2 新增 Worker 路由

| 路由 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/v1/outreach/queue` | POST | 是 | 将 approved lead 加入发送队列 |
| `/v1/outreach/status` | GET | 是 | 查询 outreach 状态 |
| `/v1/webhooks/resend` | POST | HMAC | Resend Webhook 回调 |
| `/v1/cron/send` | POST | Secret | Cron 触发送（需 secret 验证） |

### 2.3 D1 Schema 变更

```sql
-- outreach 表新增字段（Phase 1 已建表，此处补字段）
ALTER TABLE outreach ADD COLUMN resend_id TEXT;
ALTER TABLE outreach ADD COLUMN resend_status TEXT;  -- 'queued'|'sent'|'delivered'|'bounced'|'complained'
ALTER TABLE outreach ADD COLUMN sent_at TEXT;
ALTER TABLE outreach ADD COLUMN delivered_at TEXT;
ALTER TABLE outreach ADD COLUMN bounced_at TEXT;
ALTER TABLE outreach ADD COLUMN bounce_reason TEXT;

-- 新增 webhook_events 表（审计）
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  event_type TEXT NOT NULL,  -- 'email.sent'|'email.delivered'|'email.bounced'|'email.complained'
  event_id TEXT NOT NULL,    -- Resend event id (idempotency)
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON webhook_events(received_at);
```

### 2.4 Resend API 集成

**密钥存储**：
- `RESEND_API_KEY` → Cloudflare Workers Secrets（不写入代码）
- 本地配置：`cloud.resendApiKey`（仅用于测试连接，实际发送由 Worker 执行）

**发送流程**：
1. Worker 接收 `POST /v1/outreach/queue` → 创建 outreach 记录（status='queued'）
2. Cron 每分钟扫描 `status='queued' AND sent_at IS NULL` 的记录
3. 调用 Resend API `POST https://api.resend.com/emails`
4. 更新 outreach 状态为 'sent'，记录 `resend_id`
5. Webhook 回调更新最终状态

---

## 三、执行计划

### 3.1 子任务分解

| ID | 任务 | 依赖 | 预估 |
|----|------|------|------|
| P2-1 | D1 Schema 迁移（outreach 字段 + webhook_events 表） | - | 0.5h |
| P2-2 | Worker: outreach/queue 路由（入队） | P2-1 | 1h |
| P2-3 | Worker: cron/send 路由（定时投递） | P2-1 | 2h |
| P2-4 | Worker: webhooks/resend 路由（HMAC 验证 + 状态回写） | P2-1 | 1.5h |
| P2-5 | Worker: outreach/status 查询 | P2-1 | 0.5h |
| P2-6 | 本地: cloudflare-service 扩展（queueOutreach, pollOutreachStatus） | P2-2 | 1h |
| P2-7 | 本地: automation-service 集成（approved → queue） | P2-6 | 0.5h |
| P2-8 | 本地: Agent 状态回写（云端 outreach → 本地 agentStatus） | P2-6 | 1h |
| P2-9 | Worker 测试（queue/cron/webhook） | P2-2~4 | 2h |
| P2-10 | 端到端测试（本地 → 云端 → Resend mock） | P2-6~8 | 1.5h |
| P2-11 | 文档更新（CLOUD-COLLABORATION-DELIVERY.md §13 门禁） | P2-9~10 | 0.5h |

**总计**：~12h（可分 2-3 个 session 完成）

### 3.2 关键设计决策

1. **Cron 频率**：每分钟扫描一次，单次最多处理 50 条（防雪崩）
2. **重试策略**：Resend API 失败 → 指数退避（1min/5min/15min/1h），最多 3 次
3. **幂等性**：Webhook event_id 唯一约束，重复回调直接忽略
4. **安全**：Cron 路由需 `X-Cron-Secret` 头验证（Workers Secrets）
5. **降级**：Resend 不可用 → outreach 保持 'queued' 状态，下次 Cron 重试

### 3.3 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Resend 免费额度限制（3000 封/月） | 超出后无法发送 | 监控用量，超限告警；Enterprise 升级路径 |
| Cron 冷启动延迟 | 投递延迟 ~2s | 可接受（非实时场景） |
| Webhook 重复回调 | 状态回写重复 | event_id 唯一约束 + 幂等处理 |
| 本地状态与云端不同步 | 用户看到错误状态 | 本地轮询 GET /v1/events (since=...) |

---

## 四、Phase 2 验收标准

- [ ] P2-1~P2-5：Worker 路由全部通过单元测试
- [ ] P2-6~P2-8：本地集成测试通过
- [ ] P2-9：Worker 测试套件 ≥ 25 条测试全绿
- [ ] P2-10：端到端流程验证（本地推送 → 云端入队 → Cron 发送 → Webhook 回写 → 本地同步）
- [ ] P2-11：文档更新，§13 门禁状态从 NO-GO → GO（或 CONDITIONAL-GO）
- [ ] CHANGELOG 更新 v1.4.0 条目

---

## 五、与 Phase 1 的关系

| Phase | 状态 | 能力 |
|-------|------|------|
| Phase 1 | ✅ 已完成 | 本地推送 → D1 存储 → Pages 仪表盘 |
| **Phase 2** | 📋 规划中 | **Resend 投递 → Webhook 回写 → 跨端同步** |
| Phase 3 | 🔮 未来 | 多 SMTP 中继、AI 回复生成、自动化策略 |

Phase 2 完成后，云端投递闭环将从"目标态"变为"可用态"，满足商用发布门禁。

---

*文档版本：v1.0.0 | 创建时间：2026-09-28 | 作者：Software Architect Agent*
