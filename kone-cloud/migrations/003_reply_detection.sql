-- ───────────────────────────────────────────────────────────────────
-- Kone V1.3 · Cloudflare D1 Schema · 003_reply_detection.sql
-- Version: v1.2.0 (2026-09-29)
-- Phase 2.5: IMAP 回复检测基建
--
-- 变更动机：
--   - 001_init.sql 的 outreach.status CHECK 未包含 'replied'，但业务上
--     需要表达"客户已回复"这一终态；email.replied 事件需要能落库。
--   - D1/SQLite 不支持 ALTER TABLE 修改 CHECK 约束，必须重建表。
--   - 新增 email_opened_at / email_clicked_at 列承接 email.opened /
--     email.clicked webhook 事件（002 已允许，但 schema 无落库字段）。
--   - 新增 email_replies 表存档回复原文（subject/body/sender/messageId），
--     用于审计 + 未来 AI 二次跟进判断。
--
-- 兼容性：
--   - 保留所有既有 outreach 字段，仅在末尾追加两列（默认 NULL）。
--   - 数据按原列顺序 INSERT 复制，零数据丢失。
--   - 索引名与 001/002 一致，可安全重放。
-- ───────────────────────────────────────────────────────────────────

-- ================================================================
-- 1. 重建 outreach 表：加入 'replied' 状态 + email_opened/clicked 字段
-- ================================================================
CREATE TABLE outreach_new (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id           TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id       TEXT NOT NULL,
  sequence_stage    INTEGER NOT NULL DEFAULT 0 CHECK (sequence_stage BETWEEN 0 AND 3),
  scheduled_at      TEXT NOT NULL,
  sent_at           TEXT,
  delivered_at      TEXT,
  bounced_at        TEXT,
  complained_at     TEXT,
  replied_at        TEXT,
  email_opened_at   TEXT,
  email_clicked_at  TEXT,
  provider          TEXT NOT NULL DEFAULT 'local_smtp' CHECK (provider IN ('local_smtp','resend','gmail_api')),
  provider_message_id TEXT,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','sent','delivered','bounced','complained','failed','replied')),
  bounce_type       TEXT CHECK (bounce_type IN ('temporary','permanent')),
  error             TEXT,
  idempotency_key   TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resend_id         TEXT,
  send_attempts     INTEGER NOT NULL DEFAULT 0,
  next_retry_at     TEXT,
  UNIQUE(workspace_id, campaign_id, idempotency_key)
);

-- 数据迁移：按列顺序 INSERT 保持语义（不依赖列名顺序，SQLite 按序号匹配）
INSERT INTO outreach_new (
  id, workspace_id, lead_id, campaign_id, sequence_stage,
  scheduled_at, sent_at, delivered_at, bounced_at, complained_at, replied_at,
  email_opened_at, email_clicked_at,
  provider, provider_message_id, subject, body, status, bounce_type,
  error, idempotency_key, created_at, updated_at,
  resend_id, send_attempts, next_retry_at
)
SELECT
  id, workspace_id, lead_id, campaign_id, sequence_stage,
  scheduled_at, sent_at, delivered_at, bounced_at, complained_at, replied_at,
  NULL, NULL,
  provider, provider_message_id, subject, body, status, bounce_type,
  error, idempotency_key, created_at, updated_at,
  resend_id, send_attempts, next_retry_at
FROM outreach;

DROP TABLE outreach;
ALTER TABLE outreach_new RENAME TO outreach;

-- 重建索引（与 001/002 保持一致的索引名和定义）
CREATE INDEX IF NOT EXISTS idx_outreach_status    ON outreach(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_outreach_lead      ON outreach(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_provider  ON outreach(provider_message_id);
CREATE INDEX IF NOT EXISTS idx_outreach_queued    ON outreach(status, next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outreach_resend_id ON outreach(resend_id);
-- 新增：支持按已发送时间窗拉取候选回复（IMAP poller 用它做 since 窗口）
CREATE INDEX IF NOT EXISTS idx_outreach_sent_at   ON outreach(sent_at) WHERE sent_at IS NOT NULL;

-- ================================================================
-- 2. email_replies — 回复原文存档（Phase 2.5）
-- ================================================================
-- 每条 IMAP 匹配到的回复一行；(outreach_id, message_id) 唯一约束做幂等。
-- 后续 AI 二次跟进可基于 reply_body 做意图识别（Phase 2.6+）。
CREATE TABLE IF NOT EXISTS email_replies (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  outreach_id           TEXT NOT NULL REFERENCES outreach(id) ON DELETE CASCADE,
  lead_id               TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  message_id            TEXT NOT NULL,           -- Email-Message-ID from the reply
  in_reply_to           TEXT,                    -- In-Reply-To header value
  sender                TEXT NOT NULL,           -- Normalized lower-case from address
  subject               TEXT,
  reply_body            TEXT,                    -- Plain-text/plain-html body (may be truncated)
  received_at           TEXT NOT NULL,           -- Date header or IMAP internal date
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(outreach_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_email_replies_outreach ON email_replies(outreach_id);
CREATE INDEX IF NOT EXISTS idx_email_replies_lead     ON email_replies(lead_id);
CREATE INDEX IF NOT EXISTS idx_email_replies_received ON email_replies(received_at);
