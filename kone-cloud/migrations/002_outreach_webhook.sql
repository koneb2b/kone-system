-- ───────────────────────────────────────────────────────────────────
-- Kone V1.3 · Cloudflare D1 Schema · 002_outreach_webhook.sql
-- Version: v1.1.0 (2026-09-28)
-- Phase 2: Resend 投递接入 · Webhook 审计
-- ───────────────────────────────────────────────────────────────────

-- ================================================================
-- 1. webhook_events — Webhook 事件审计表
--    记录所有来自 Resend 的回调事件，用于：
--    - 幂等性保障（event_id 唯一约束）
--    - 调试与审计（完整 payload 存档）
--    - 事件重放（故障恢复）
--    注意：workspace_id 可为 NULL，因为 Webhook 是全局回调，不绑定特定租户
-- ================================================================
CREATE TABLE IF NOT EXISTS webhook_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'resend' CHECK (provider IN ('resend','local_smtp','gmail_api')),
  event_type    TEXT NOT NULL
    CHECK (event_type IN (
      'email.sent','email.delivered','email.bounced',
      'email.complained','email.opened','email.clicked'
    )),
  event_id      TEXT NOT NULL,  -- Resend event id (idempotency key)
  payload       TEXT NOT NULL,  -- Complete webhook payload (JSON)
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at  TEXT,           -- Set when outreach status is updated
  UNIQUE(provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_ws     ON webhook_events(workspace_id, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type   ON webhook_events(provider, event_type, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_pending ON webhook_events(processed_at) WHERE processed_at IS NULL;

-- ================================================================
-- 2. 扩展 outreach 表：Resend 集成字段
--    使用 ALTER TABLE 添加新列（D1 支持 ADD COLUMN）
-- ================================================================

-- Resend 返回的 email ID（用于查询发送状态）
-- provider_message_id 已存在，但语义不明确；resend_id 专用于 Resend 集成
ALTER TABLE outreach ADD COLUMN resend_id TEXT;

-- Resend 发送尝试次数（用于重试策略）
ALTER TABLE outreach ADD COLUMN send_attempts INTEGER NOT NULL DEFAULT 0;

-- 下次重试时间（指数退避：1min/5min/15min/1h）
ALTER TABLE outreach ADD COLUMN next_retry_at TEXT;

-- 创建索引以优化 Cron 扫描
CREATE INDEX IF NOT EXISTS idx_outreach_queued     ON outreach(status, next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outreach_resend_id  ON outreach(resend_id);
