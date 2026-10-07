-- ───────────────────────────────────────────────────────────────────
-- Kone V1.3 · Cloudflare D1 Schema · 004_webhook_event_idempotency.sql
-- Version: v1.3.0 (2026-10-07)
-- 修复：Webhook 事件链路两处缺陷（审计 P0-3 / P0-4）
--
-- 变更动机：
--   [P0-4] 002_outreach_webhook.sql 的 event_type CHECK 枚举只含
--          sent/delivered/bounced/complained/opened/clicked，缺 'email.replied'。
--          而 worker.ts 的 switch 已处理 email.replied（第 845 行），
--          003_reply_detection.sql 也为 outreach 补了 replied 终态——
--          唯独 webhook_events 表未同步，导致回复事件 INSERT 触发 CHECK 失败 → HTTP 500。
--          003 重建了 outreach 表却遗漏本表，本次补齐。
--
--   [P0-3] UNIQUE(provider, event_id) 配 event_id = Resend 的 data.id（email id）。
--          Resend 对同一封邮件的 sent/delivered/bounced **共用同一个 email id**，
--          于是首个事件落库后，后续同类事件被判重复直接返回，
--          delivered / bounced 状态**永不落库**（表现为看板"已送达"恒为 0）。
--          修复：唯一键改为 (provider, event_type, event_id) 三字段联合；
--          配合 worker 侧 event_id 改用 svix-id（每事件唯一），双保险。
--
-- 兼容性：
--   - D1/SQLite 不支持 ALTER TABLE 修改 CHECK / UNIQUE 约束，必须重建表。
--     沿用 003_reply_detection.sql 已验证的 _new → 复制 → DROP → RENAME 模式。
--   - 按原列顺序全量 INSERT SELECT 复制，零数据丢失。
--   - DROP TABLE 会连带删除原表索引，故索引在改名后重建（名称与 002 保持一致，可安全重放）。
--   - 若历史数据中存在 (provider, event_type, event_id) 重复行（旧 email-id 语义下
--     理论上不会产生，因为旧的 UNIQUE(provider,event_id) 已拦截），
--     复制前先按 id 去重保留最早一条，避免重建后唯一约束冲突导致迁移失败。
-- ───────────────────────────────────────────────────────────────────

-- ================================================================
-- 1. 重建 webhook_events：补 'email.replied' + 修唯一键
-- ================================================================
CREATE TABLE webhook_events_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'resend' CHECK (provider IN ('resend','local_smtp','gmail_api')),
  event_type    TEXT NOT NULL
    CHECK (event_type IN (
      'email.sent','email.delivered','email.bounced',
      'email.complained','email.opened','email.clicked',
      'email.replied'
    )),
  -- 幂等键：优先取 Svix 的 svix-id（每事件唯一）；
  -- 缺失时 worker 回落为 `${type}:${emailId}`，靠三字段联合唯一键保证正确去重。
  event_id      TEXT NOT NULL,
  payload       TEXT NOT NULL,
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at  TEXT,
  UNIQUE(provider, event_type, event_id)
);

-- 复制历史数据；按新唯一键去重，保留 id 最小（最早）的一条
INSERT INTO webhook_events_new (id, workspace_id, provider, event_type, event_id, payload, received_at, processed_at)
SELECT id, workspace_id, provider, event_type, event_id, payload, received_at, processed_at
FROM webhook_events
WHERE id IN (
  SELECT MIN(id) FROM webhook_events
  GROUP BY provider, event_type, event_id
);

DROP TABLE webhook_events;
ALTER TABLE webhook_events_new RENAME TO webhook_events;

-- 重建索引（名称与 002_outreach_webhook.sql 一致）
CREATE INDEX IF NOT EXISTS idx_webhook_events_ws      ON webhook_events(workspace_id, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type    ON webhook_events(provider, event_type, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_pending ON webhook_events(processed_at) WHERE processed_at IS NULL;
