const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// S4b（2026-10-16）：机会分的**逐维度评分依据**（evidence binding）。
// 目标：让「为什么是这个分」可解释、可复核；缺失时诚实降级（不臆造、不落空键）。
//
// 变异验证（手工复核点）：
//  - 若 `normalizeOpportunityScore` 无条件落 `rationale` 键 → 「向后兼容」用例判红；
//  - 若 `normalizeOpportunityRationale` 不做截断 → 「超长截断」用例判红；
//  - 若提示词删掉 rationale 要求 → 「提示词」用例判红。

const searchService = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'search-service.js'),
)
const scoring = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'search', 'scoring.js'),
)

const { normalizeOpportunityScore, normalizeOpportunityRationale, OPPORTUNITY_RATIONALE_MAX_LEN } = searchService

/* ── 1. 归一化：透传 + trim + 压缩空白 ── */

test('S4b: normalizeOpportunityRationale 透传四维依据并归一空白', () => {
  const r = normalizeOpportunityRationale({
    icpFit: '  Website states "industrial valves distributor"  ',
    intent: 'RFQ\tposted\n2026-Q3',
    evidence: '  ',
    riskPenalty: 'info@ only, no decision maker',
  })
  assert.deepEqual(r, {
    icpFit: 'Website states "industrial valves distributor"',
    intent: 'RFQ posted 2026-Q3',
    riskPenalty: 'info@ only, no decision maker',
  })
  assert.equal('evidence' in r, false, '空白维度不落键')
})

/* ── 2. 超长截断（防 LLM 回吐整段文本） ── */

test('S4b: 单条依据超长被截断到上限并加省略号', () => {
  const long = 'x'.repeat(OPPORTUNITY_RATIONALE_MAX_LEN + 80)
  const r = normalizeOpportunityRationale({ icpFit: long })
  assert.equal(r.icpFit.length, OPPORTUNITY_RATIONALE_MAX_LEN, '截断到上限长度')
  assert.ok(r.icpFit.endsWith('…'), '截断后以省略号结尾')
})

/* ── 3. 向后兼容硬保证：无依据时**不落 rationale 键** ── */

test('S4b: 无 rationale 时 normalizeOpportunityScore 结果不含 rationale 键（旧数据逐字段不变）', () => {
  const score = normalizeOpportunityScore({ icpFit: 40, intent: 20, evidence: 5, riskPenalty: 3, finalScore: 0 })
  assert.deepEqual(
    score,
    { icpFit: 40, intent: 20, evidence: 5, riskPenalty: 3, finalScore: 62 },
    '与改造前完全一致（deepStrictEqual 不允许多余键）',
  )
  assert.equal('rationale' in score, false)
})

test('S4b: 全空 / 非法 rationale 一律不落键且不抛', () => {
  for (const bad of [{}, { icpFit: '   ' }, 'garbage', 42, [], null, undefined]) {
    const score = normalizeOpportunityScore({
      icpFit: 10,
      intent: 5,
      evidence: 2,
      riskPenalty: 0,
      rationale: bad,
    })
    assert.equal('rationale' in score, false, `非法输入 ${JSON.stringify(bad)} 不应落键`)
  }
})

/* ── 4. 有依据时落键，且只落有值的维度 ── */

test('S4b: 有依据时 normalizeOpportunityScore 保留 rationale（只落有值维度）', () => {
  const score = normalizeOpportunityScore({
    icpFit: 50,
    intent: 30,
    evidence: 8,
    riskPenalty: 10,
    rationale: { icpFit: 'distributor of pumps in Germany', intent: '' },
  })
  assert.equal(score.finalScore, 78)
  assert.deepEqual(score.rationale, { icpFit: 'distributor of pumps in Germany' })
})

/* ── 5. 端到端：applySchemaDefaults 白名单序列化不丢 rationale ── */

test('S4b: applySchemaDefaults 端到端透传 rationale（白名单序列化不丢字段）', () => {
  const item = scoring.applySchemaDefaults({
    company: 'ACME GmbH',
    website: 'https://acme.example',
    phone: '',
    opportunityScore: {
      icpFit: 45,
      intent: 25,
      evidence: 6,
      riskPenalty: 5,
      finalScore: 0,
      rationale: { icpFit: 'OEM partner page lists our product category' },
    },
  })
  assert.ok(item.opportunityScore, '机会分保留')
  assert.deepEqual(item.opportunityScore.rationale, { icpFit: 'OEM partner page lists our product category' })
})

/* ── 6. 提示词要求逐维度引用证据（源码断言） ── */

test('S4b: 评分提示词要求输出 rationale 并显式禁止臆造', () => {
  const system = searchService.buildSearchScoringPrompt({ keyword: 'valves', candidates: [] }).system
  assert.match(system, /"rationale" object with exactly the keys icpFit, intent, evidence, riskPenalty/)
  assert.match(system, /EMPTY STRING/, '无证据维度须留空串')
  assert.match(system, /never fabricate/, '显式禁止臆造')
  assert.match(system, /CITES the concrete basis/, '要求引用具体依据')
})
