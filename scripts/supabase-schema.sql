-- ============================================================
-- Kone Cloud Schema — Supabase SQL Editor
-- 适用于 Kone AI B2B 智能获客系统云端扩展
-- ============================================================

-- 1. leads 表：高价值线索存储 + 防撞单 + 追踪
CREATE TABLE IF NOT EXISTS leads (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain        TEXT NOT NULL,
  email         TEXT,
  company       TEXT,
  country       TEXT,
  ai_tags       JSONB DEFAULT '[]'::jsonb,
  score         INTEGER NOT NULL DEFAULT 0,

  -- 归属与防撞单
  owner_machine_id  TEXT NOT NULL,
  owner_label       TEXT,
  status            TEXT NOT NULL DEFAULT 'following'
                    CHECK (status IN ('following', 'contacted', 'replied', 'archived')),

  -- 隐形像素追踪
  is_opened     BOOLEAN DEFAULT false,
  opened_at     TIMESTAMPTZ,
  opened_geo    TEXT,

  -- 时间戳
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 防撞单核心索引：同一域名 + 同一设备唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_domain_owner
  ON leads (domain, owner_machine_id);

-- 高分线索快速查询
CREATE INDEX IF NOT EXISTS idx_leads_score
  ON leads (score DESC);

-- 按域名查重（防撞单检测）
CREATE INDEX IF NOT EXISTS idx_leads_domain
  ON leads (domain);

-- 时间线排序
CREATE INDEX IF NOT EXISTS idx_leads_created
  ON leads (created_at DESC);

-- 2. campaigns 表：自动化发信序列状态
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  domain          TEXT NOT NULL,
  email           TEXT NOT NULL,
  template_id     TEXT NOT NULL DEFAULT 'default',
  sequence_step   INTEGER NOT NULL DEFAULT 1,

  -- IDEM-01 幂等键：防止重复提交产生重复发送任务
  idempotency_key  TEXT,

  -- 状态机
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sending', 'sent', 'opened', 'replied', 'bounced', 'unsubscribed')),

  -- n8n 回调
  n8n_execution_id  TEXT,
  sent_at           TIMESTAMPTZ,
  opened_at         TIMESTAMPTZ,
  replied_at        TIMESTAMPTZ,
  bounced_at        TIMESTAMPTZ,

  -- 归属
  owner_machine_id  TEXT NOT NULL,

  -- 时间戳
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_lead
  ON campaigns (lead_id);

CREATE INDEX IF NOT EXISTS idx_campaigns_domain
  ON campaigns (domain);

-- IDEM-01 幂等键唯一约束：同设备同幂等键只允许一条 campaign
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_idempotency
  ON campaigns (owner_machine_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_status
  ON campaigns (status);

CREATE INDEX IF NOT EXISTS idx_campaigns_owner
  ON campaigns (owner_machine_id);

-- 3. warmup_stats 表：邮箱预热信誉数据
CREATE TABLE IF NOT EXISTS warmup_stats (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email_account   TEXT NOT NULL,
  owner_machine_id TEXT NOT NULL,

  -- 日级别统计
  stat_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  sent_count      INTEGER DEFAULT 0,
  received_count  INTEGER DEFAULT 0,
  inbox_count     INTEGER DEFAULT 0,
  spam_count      INTEGER DEFAULT 0,
  bounce_count    INTEGER DEFAULT 0,

  -- 信誉分 (0-100)
  reputation_score INTEGER DEFAULT 50,

  -- 时间戳
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),

  -- 每个邮箱每天一条记录
  UNIQUE (email_account, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_warmup_account
  ON warmup_stats (email_account);

CREATE INDEX IF NOT EXISTS idx_warmup_date
  ON warmup_stats (stat_date DESC);

-- 4. RLS (Row Level Security) — SEC-02 修复：租户隔离
-- 注意：anon 全量策略已移除，详见 scripts/supabase-rls-migration.sql
-- 新建数据库时应先执行 supabase-schema.sql 再执行 supabase-rls-migration.sql

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmup_stats ENABLE ROW LEVEL SECURITY;

-- SEC-02: anon 全量策略已移除——不再创建 leads_anon_all / campaigns_anon_all / warmup_stats_anon_all
-- 组织级 RLS 策略详见 scripts/supabase-rls-migration.sql

-- 5. updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_warmup_stats_updated_at
  BEFORE UPDATE ON warmup_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6. Realtime 订阅权限 — 必须显式将表加入 publication
-- Supabase 的 Realtime 引擎只监听 supabase_realtime publication 中的表
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE campaigns;
