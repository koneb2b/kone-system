/**
 * contact-provenance.business.test.js — 联系方式「来源与可信度」三档模型守护测试（S2）
 *
 * 背景（2026-10-13 产品定位校准）：Kone 是专业严谨的 B2B 获客工作台，
 * 联系方式必须**说清来源与可信度**：明确区分「已验证 / 官网提取 / 推测」，
 * 默认优先高置信度、`inferred` 不自动用于 Agent、发送前二次确认。
 *
 * 本测试锁定：
 *   ① `pickContactWithProvenance` 的**取值与来源同源**（杜绝静默错标 —— 值来自 A、来源却标 B）；
 *   ② 三档放行语义（`canAutoUseContact`：仅 verified/extracted 可自动使用）；
 *   ③ `applySchemaDefaults` **透传** `contactProvenance`（否则序列化即丢字段）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const PROV = path.join(ROOT, 'dist-electron', 'src', 'shared', 'contact-provenance.js')
const SCORING = path.join(ROOT, 'dist-electron', 'electron', 'services', 'search', 'scoring.js')
const SEARCH_SERVICE_TS = path.join(ROOT, 'electron', 'services', 'search-service.ts')

const { pickContactWithProvenance, CONTACT_TIER_LABEL } = require(PROV)

test('pickContactWithProvenance：取第一个非空候选，且**来源与该候选同源**', () => {
  const pick = pickContactWithProvenance([
    { value: '', tier: 'extracted', source: '官网' },
    { value: '  ', tier: 'extracted', source: '官网' },
    { value: 'sales@acme.com', tier: 'verified', source: 'Prospeo' },
    { value: 'other@acme.com', tier: 'extracted', source: '官网' },
  ])
  assert.equal(pick.value, 'sales@acme.com')
  assert.equal(pick.provenance.tier, 'verified')
  assert.equal(pick.provenance.source, 'Prospeo', '来源必须与被选中值同源，不得错标')
})

test('pickContactWithProvenance：全空 → 空值且无来源（诚实，不臆造档位）', () => {
  const pick = pickContactWithProvenance([
    { value: undefined, tier: 'verified', source: 'Prospeo' },
    { value: null, tier: 'extracted', source: '官网' },
  ])
  assert.equal(pick.value, '')
  assert.equal(pick.provenance, undefined, '无值即无来源标注（宁可不标，不可谎报）')
})

test('pickContactWithProvenance：trim 后取值（与既有行为一致）', () => {
  const pick = pickContactWithProvenance([{ value: '  a@b.com  ', tier: 'extracted', source: '官网' }])
  assert.equal(pick.value, 'a@b.com')
})

test('三档显示名齐全且互不相同（UI 统一口径）', () => {
  const labels = [CONTACT_TIER_LABEL.verified, CONTACT_TIER_LABEL.extracted, CONTACT_TIER_LABEL.inferred]
  assert.ok(labels.every((l) => typeof l === 'string' && l.length > 0))
  assert.equal(new Set(labels).size, 3, '三档显示名不得重复')
})

/* ── S3：放行 / 二次确认语义 ───────────────────────────────────────── */

test('canAutoDispatch：仅显式 inferred 拦下；无标注按 extracted 放行（向后兼容历史数据）', () => {
  const { canAutoDispatch } = require(PROV)
  assert.equal(canAutoDispatch('verified'), true)
  assert.equal(canAutoDispatch('extracted'), true)
  assert.equal(canAutoDispatch('inferred'), false, '推测数据不得自动派发')
  assert.equal(canAutoDispatch(undefined), true, '无标注不得被整体排除')
})

test('requiresSendConfirmation：仅推测档需要二次确认（其余不打扰用户）', () => {
  const { requiresSendConfirmation } = require(PROV)
  assert.equal(requiresSendConfirmation('inferred'), true)
  assert.equal(requiresSendConfirmation('verified'), false)
  assert.equal(requiresSendConfirmation('extracted'), false)
  assert.equal(requiresSendConfirmation(undefined), false, '无标注按既有流程，不打扰')
})

test('applySchemaDefaults 必须**透传** contactProvenance（否则序列化即丢字段）', () => {
  const { applySchemaDefaults } = require(SCORING)
  const provenance = {
    email: { tier: 'verified', source: 'Prospeo', grade: 'verified' },
    phone: { tier: 'extracted', source: '官网', kind: 'landline' },
  }
  const out = applySchemaDefaults({
    company: 'Acme',
    website: 'https://acme.com',
    phone: '',
    contactProvenance: provenance,
  })
  assert.deepEqual(out.contactProvenance, provenance, 'contactProvenance 必须原样透传')
  // 缺失时不臆造
  const bare = applySchemaDefaults({ company: 'B', website: 'https://b.com', phone: '' })
  assert.equal(bare.contactProvenance, undefined)
})

test('源码守卫：邮箱/电话取值必须经 pickContactWithProvenance（取值与来源同源）', () => {
  const src = fs
    .readFileSync(SEARCH_SERVICE_TS, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /pickContactWithProvenance\(\[/, '邮箱取值必须走同源助手')
  assert.match(src, /contactProvenance/, '必须产出 contactProvenance')
  assert.ok(
    !/const email = String\(\s*payload\.candidate\.email \|\|/.test(src),
    '邮箱不得再用手写 `||` 链（那样无法保证来源同源）',
  )
})
