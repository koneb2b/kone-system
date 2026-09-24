-- ============================================================
-- SEC-01 + SEC-02: Supabase 租户身份与 RLS 重写迁移
-- 
-- 目标：关闭 B-01（anon 全量读写），建立基于组织身份的租户隔离
-- 性质：破坏性迁移——删除 anon 全量策略，不可回滚到不安全状态
-- 前置条件：Supabase Auth 已启用（Email/Password 或 OAuth）
-- 执行顺序：按本文件从上到下顺序执行
-- ============================================================

-- ═══════════════════════════════════════════════
-- Step 1: 创建组织与成员表
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,  -- auth.uid()
  role            TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org
  ON organization_members (organization_id);

CREATE INDEX IF NOT EXISTS idx_org_members_user
  ON organization_members (user_id);

-- 组织成员的 RLS：用户只能查看自己所属的组织和成员
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_self" ON organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_select_self" ON organization_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR organization_id IN (
    SELECT organization_id FROM organization_members om WHERE om.user_id = auth.uid()
  ));

-- 仅 owner/admin 可管理成员
CREATE POLICY "org_members_insert" ON organization_members
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM organization_members om
    WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
  ));

CREATE POLICY "org_members_delete" ON organization_members
  FOR DELETE TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members om
    WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
  ));

-- ═══════════════════════════════════════════════
-- Step 2: 为现有表添加 organization_id 列
-- ═══════════════════════════════════════════════

ALTER TABLE leads ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE warmup_stats ADD COLUMN IF NOT EXISTS organization_id UUID;

-- ═══════════════════════════════════════════════
-- Step 3: 数据迁移——为每个 owner_machine_id 创建默认组织
-- ═══════════════════════════════════════════════

-- 为每个独特的 owner_machine_id 创建一个默认组织
INSERT INTO organizations (id, name)
SELECT 
  gen_random_uuid(),
  'Migrated-' || LEFT(owner_machine_id, 8)
FROM (SELECT DISTINCT owner_machine_id FROM leads WHERE organization_id IS NULL) AS sub
ON CONFLICT DO NOTHING;

-- 将现有 leads 关联到对应组织
-- 注意：此迁移假设一台设备 = 一个组织；真实场景需根据业务调整
UPDATE leads SET organization_id = org.id
FROM organizations org
WHERE leads.organization_id IS NULL
  AND leads.owner_machine_id IS NOT NULL
  AND org.name LIKE 'Migrated-%';

-- 同样处理 campaigns 和 warmup_stats
UPDATE campaigns SET organization_id = (
  SELECT organization_id FROM leads WHERE leads.id = campaigns.lead_id
) WHERE campaigns.organization_id IS NULL AND campaigns.lead_id IS NOT NULL;

UPDATE warmup_stats SET organization_id = (
  SELECT organization_id FROM leads
  WHERE leads.owner_machine_id = warmup_stats.owner_machine_id
  LIMIT 1
) WHERE warmup_stats.organization_id IS NULL;

-- 添加 NOT NULL 约束（迁移后强制）
ALTER TABLE leads ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE campaigns ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE warmup_stats ALTER COLUMN organization_id SET NOT NULL;

-- 组织级索引
CREATE INDEX IF NOT EXISTS idx_leads_org ON leads (organization_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns (organization_id);
CREATE INDEX IF NOT EXISTS idx_warmup_org ON warmup_stats (organization_id);

-- 防撞单升级：组织级唯一约束（替代设备级）
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_domain_org
  ON leads (domain, organization_id);

-- ═══════════════════════════════════════════════
-- Step 4: 删除危险的 anon 全量策略
-- ═══════════════════════════════════════════════

DROP POLICY IF EXISTS "leads_anon_all" ON leads;
DROP POLICY IF EXISTS "campaigns_anon_all" ON campaigns;
DROP POLICY IF EXISTS "warmup_stats_anon_all" ON warmup_stats;

-- ═══════════════════════════════════════════════
-- Step 5: 创建基于组织身份的 RLS 策略
-- ═══════════════════════════════════════════════

-- leads 策略
CREATE POLICY "leads_org_select" ON leads
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "leads_org_insert" ON leads
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "leads_org_update" ON leads
  FOR UPDATE TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "leads_org_delete" ON leads
  FOR DELETE TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

-- campaigns 策略
CREATE POLICY "campaigns_org_select" ON campaigns
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "campaigns_org_insert" ON campaigns
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "campaigns_org_update" ON campaigns
  FOR UPDATE TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "campaigns_org_delete" ON campaigns
  FOR DELETE TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

-- warmup_stats 策略
CREATE POLICY "warmup_org_select" ON warmup_stats
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "warmup_org_insert" ON warmup_stats
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "warmup_org_update" ON warmup_stats
  FOR UPDATE TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "warmup_org_delete" ON warmup_stats
  FOR DELETE TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

-- ═══════════════════════════════════════════════
-- Step 6: 撤销 anon 角色权限
-- ═══════════════════════════════════════════════

-- 确保 anon 角色对这三张表无任何权限
REVOKE ALL ON leads FROM anon;
REVOKE ALL ON campaigns FROM anon;
REVOKE ALL ON warmup_stats FROM anon;
REVOKE ALL ON organizations FROM anon;
REVOKE ALL ON organization_members FROM anon;

-- ═══════════════════════════════════════════════
-- 回滚脚本（仅在紧急情况下使用）
-- ═══════════════════════════════════════════════
-- 警告：回滚将恢复 anon 全量读写，仅在不安全环境中使用
--
-- DROP POLICY IF EXISTS "leads_org_select" ON leads;
-- DROP POLICY IF EXISTS "leads_org_insert" ON leads;
-- DROP POLICY IF EXISTS "leads_org_update" ON leads;
-- DROP POLICY IF EXISTS "leads_org_delete" ON leads;
-- DROP POLICY IF EXISTS "campaigns_org_select" ON campaigns;
-- DROP POLICY IF EXISTS "campaigns_org_insert" ON campaigns;
-- DROP POLICY IF EXISTS "campaigns_org_update" ON campaigns;
-- DROP POLICY IF EXISTS "campaigns_org_delete" ON campaigns;
-- DROP POLICY IF EXISTS "warmup_org_select" ON warmup_stats;
-- DROP POLICY IF EXISTS "warmup_org_insert" ON warmup_stats;
-- DROP POLICY IF EXISTS "warmup_org_update" ON warmup_stats;
-- DROP POLICY IF EXISTS "warmup_org_delete" ON warmup_stats;
-- CREATE POLICY "leads_anon_all" ON leads FOR ALL TO anon USING (true) WITH CHECK (true);
-- CREATE POLICY "campaigns_anon_all" ON campaigns FOR ALL TO anon USING (true) WITH CHECK (true);
-- CREATE POLICY "warmup_stats_anon_all" ON warmup_stats FOR ALL TO anon USING (true) WITH CHECK (true);
