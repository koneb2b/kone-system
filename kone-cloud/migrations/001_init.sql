-- ───────────────────────────────────────────────────────────────────
-- Kone V1.3 · Cloudflare D1 Schema · 001_init.sql
-- Version: v1.0.0 (2026-09-28)
-- Aligned with: CLOUD-COLLABORATION-DELIVERY.md §9, ARCH-STANDARDS.md §15
--
-- Note: D1 does not support PRAGMA statements (WAL, foreign_keys, synchronous).
-- foreign_keys is enforced by D1's underlying SQLite engine automatically.
-- ───────────────────────────────────────────────────────────────────

-- ================================================================
-- 1. workspaces — 租户隔离根表，替代 Supabase RLS
-- ================================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  api_token_hash TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_workspaces_token ON workspaces(api_token_hash);

-- ================================================================
-- 2. contacts — 联系人（规范化邮箱）
-- ================================================================
CREATE TABLE IF NOT EXISTS contacts (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  normalized_email      TEXT NOT NULL,
  title                 TEXT,
  department            TEXT,
  verification_grade    TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_grade IN ('verified','probable','catch_all','risky','invalid','unverified')),
  manual_exception_reason TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, normalized_email)
);
CREATE INDEX IF NOT EXISTS idx_contacts_ws_email ON contacts(workspace_id, normalized_email);

-- ================================================================
-- 3. companies — 公司（规范化域名），团队防撞单
-- ================================================================
CREATE TABLE IF NOT EXISTS companies (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  normalized_domain  TEXT NOT NULL,
  name               TEXT,
  country            TEXT,
  owner_machine_id   TEXT,
  owner_label        TEXT,
  protection_until   TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, normalized_domain)
);
CREATE INDEX IF NOT EXISTS idx_companies_ws_domain ON companies(workspace_id, normalized_domain);
CREATE INDEX IF NOT EXISTS idx_companies_owner     ON companies(owner_machine_id);

-- ================================================================
-- 4. leads — 业务线索台账（LeadBusinessStatus）
--    双轨状态机：leads.status 是业务生命周期，outreach.status 是投递通道
-- ================================================================
CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL DEFAULT 0,
  evidence_summary TEXT,
  risk_flags      TEXT,
  status          TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','scored','pending_approval','approved','queued','sent','replied','rejected','suppressed','failed','archived')),
  approval_id     TEXT,
  draft_version   INTEGER DEFAULT 0,
  local_ref_id    TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, local_ref_id)
);
CREATE INDEX IF NOT EXISTS idx_leads_status       ON leads(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_approval     ON leads(approval_id);
CREATE INDEX IF NOT EXISTS idx_leads_idempotency  ON leads(workspace_id, idempotency_key);

-- ================================================================
-- 5. approvals — 审批记录（不可覆盖）
-- ================================================================
CREATE TABLE IF NOT EXISTS approvals (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id                 TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  approver_machine_id     TEXT NOT NULL,
  decision                TEXT NOT NULL CHECK (decision IN ('approved','rejected','needs_revision')),
  approved_at             TEXT NOT NULL,
  draft_version           INTEGER NOT NULL,
  email_verification_grade TEXT NOT NULL,
  manual_exception_reason TEXT,
  risk_snapshot           TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_approvals_lead     ON approvals(lead_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON approvals(approver_machine_id);

-- ================================================================
-- 6. outreach — 投递任务（OutreachStatus）
-- ================================================================
CREATE TABLE IF NOT EXISTS outreach (
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
  provider          TEXT NOT NULL DEFAULT 'local_smtp' CHECK (provider IN ('local_smtp','resend','gmail_api')),
  provider_message_id TEXT,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','sent','delivered','bounced','complained','failed')),
  bounce_type       TEXT CHECK (bounce_type IN ('temporary','permanent')),
  error             TEXT,
  idempotency_key   TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, campaign_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_outreach_status    ON outreach(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_outreach_lead      ON outreach(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_provider  ON outreach(provider_message_id);

-- ================================================================
-- 7. events — 事件流（追加式，禁止 UPDATE/DELETE）
-- ================================================================
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id         TEXT,
  outreach_id     TEXT,
  type            TEXT NOT NULL
    CHECK (type IN (
      'lead.created','lead.approved','lead.rejected',
      'outreach.queued','outreach.sent','outreach.delivered',
      'outreach.bounced','outreach.complained','outreach.replied',
      'suppression.added','suppression.removed',
      'approval.created','manual.action',
      'sync.failed','sync.retried'
    )),
  actor           TEXT,
  payload         TEXT,
  external_id     TEXT,
  occurred_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_lead        ON events(lead_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_outreach    ON events(outreach_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_type_time   ON events(type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_external    ON events(workspace_id, external_id);

-- ================================================================
-- 8. suppressions — 全局抑制（唯一可跨工作区的表）
-- ================================================================
CREATE TABLE IF NOT EXISTS suppressions (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT,
  normalized_email  TEXT NOT NULL,
  reason            TEXT NOT NULL CHECK (reason IN ('user_unsubscribe','one_click_unsubscribe','hard_bounce','complaint','manual')),
  source            TEXT NOT NULL CHECK (source IN ('manual','webhook','system')),
  added_by          TEXT,
  added_at          TEXT NOT NULL,
  expires_at        TEXT,
  UNIQUE(workspace_id, normalized_email, reason)
);
CREATE INDEX IF NOT EXISTS idx_supp_email    ON suppressions(normalized_email);
CREATE INDEX IF NOT EXISTS idx_supp_ws_email ON suppressions(workspace_id, normalized_email);

-- ================================================================
-- 9. delivery_quota — 日配额与熔断状态
-- ================================================================
CREATE TABLE IF NOT EXISTS delivery_quota (
  workspace_id      TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  today_key         TEXT NOT NULL,
  sent_today        INTEGER NOT NULL DEFAULT 0,
  bounced_today     INTEGER NOT NULL DEFAULT 0,
  complained_today  INTEGER NOT NULL DEFAULT 0,
  last_reset_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  circuit_open_until TEXT
);

-- ================================================================
-- 10. sync_tokens — 变更令牌（Pages 看板实时刷新用）
-- ================================================================
CREATE TABLE IF NOT EXISTS sync_tokens (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
