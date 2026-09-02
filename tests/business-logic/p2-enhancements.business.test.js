const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P2 增强项纯函数测试：
// - P2-3 normalizeOpportunityScore（55/35/10 − Risk Penalty 结构化机会分）
// - P2-1 buildVerificationQueues（五级差异化队列路由）
// - P2-2 describeCadence（14 天协同节律定位）
// - P2-4 resolveDkimSelectors（自定义 selector 与默认列表合并）

const searchService = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'search-service.js'),
)
const automation = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'automation-service.js'),
)
const sched = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'followup-scheduler.js'),
)
const dnsService = require(path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'dns-service.js'))

/* ── P2-3 机会分 ── */

test('P2-3: normalizeOpportunityScore 钳制各维度并按公式重算 finalScore', () => {
  const score = searchService.normalizeOpportunityScore({
    icpFit: 99,
    intent: 40,
    evidence: 12,
    riskPenalty: -5,
    finalScore: 123,
  })
  assert.deepEqual(
    score,
    { icpFit: 55, intent: 35, evidence: 10, riskPenalty: 0, finalScore: 100 },
    '越界值钳制 + finalScore 重算',
  )
})

test('P2-3: Risk Penalty 正确扣分', () => {
  const score = searchService.normalizeOpportunityScore({ icpFit: 50, intent: 30, evidence: 8, riskPenalty: 15 })
  assert.equal(score.finalScore, 73, '50+30+8-15=73')
})

test('P2-3: 缺失/非法输入 → undefined（不臆造）', () => {
  assert.equal(searchService.normalizeOpportunityScore(undefined), undefined)
  assert.equal(searchService.normalizeOpportunityScore('garbage'), undefined)
  assert.equal(searchService.normalizeOpportunityScore({}), undefined, '全空对象不臆造分数')
})

test('P2-3: buildUniversalIcpPrompt schema 含 opportunityScore 结构（经 buildSearchScoringPrompt 透出）', () => {
  const { system } = searchService.buildSearchScoringPrompt({
    keyword: 'golf cart',
    candidates: [{ company: 'Acme', website: 'https://acme.de' }],
  })
  assert.match(system, /opportunityScore/)
  assert.match(system, /icpFit \(0-55/)
  assert.match(system, /intent \(0-35/)
  assert.match(system, /evidence \(0-10/)
  assert.match(system, /riskPenalty \(0-20/)
  assert.match(system, /finalScore = icpFit \+ intent \+ evidence − riskPenalty/)
  /* Stage-1 宪法不在此层：prompt 不得改写 40/30/20/10 */
  assert.doesNotMatch(system, /40\/30\/20\/10/)
})

/* ── P2-1 五级差异化队列 ── */

test('P2-1: buildVerificationQueues 按五级正确路由', () => {
  const results = [
    { email: 'a@x.com', valid: true, grade: 'verified' },
    { email: 'b@x.com', valid: true, grade: 'probable' },
    { email: 'c@x.com', valid: true, grade: 'catch_all' },
    { email: 'info@x.com', valid: false, grade: 'risky', reason: '公共角色邮箱' },
    { email: 'd@x.com', valid: false, grade: 'invalid', reason: '格式无效' },
    { email: 'e@x.com', valid: true }, // 未知 grade → valid 兜底
    { email: 'f@x.com', valid: false }, // 未知 grade → 抑制建议
  ]
  const q = automation.buildVerificationQueues(results)
  assert.equal(q.primary.length, 3, 'verified + probable + valid 兜底')
  assert.equal(q.throttled.length, 1, 'catch_all 限频')
  assert.equal(q.deprioritized.length, 1, 'risky 降权')
  assert.equal(q.suppressionCandidates.length, 2, 'invalid + invalid 兜底')
})

test('P2-1: 非数组输入安全降级为全空队列', () => {
  const q = automation.buildVerificationQueues(undefined)
  assert.deepEqual(q, { primary: [], throttled: [], deprioritized: [], suppressionCandidates: [] })
})

/* ── P2-2 节律指引 ── */

test('P2-2: describeCadence 输出各阶段 14 天节律定位，人工阶段显式标注', () => {
  assert.match(sched.describeCadence(0), /Day 0-1/)
  assert.match(sched.describeCadence(1), /LinkedIn.*人工/)
  assert.match(sched.describeCadence(2), /Day 7-10/)
  assert.match(sched.describeCadence(3), /Day 12-14/)
})

/* ── P2-4 DKIM selector ── */

test('P2-4: resolveDkimSelectors 合并默认列表（追加不替换）且去重小写化', () => {
  const selectors = dnsService.resolveDkimSelectors(['Selector1', 'mykey'])
  for (const def of ['default', 'google', 'selector1', 'selector2', 'k1', 'mail']) {
    assert.ok(selectors.includes(def), `默认 selector ${def} 必须保留`)
  }
  assert.ok(selectors.includes('mykey'), '自定义 selector 必须追加')
  assert.equal(selectors.filter((s) => s === 'selector1').length, 1, '重复项去重')
})

test('P2-4: 逗号分隔字符串与空配置安全解析', () => {
  assert.deepEqual(dnsService.resolveDkimSelectors('s1, s2'), [
    'default',
    'google',
    'selector1',
    'selector2',
    'k1',
    'mail',
    's1',
    's2',
  ])
  assert.equal(dnsService.resolveDkimSelectors(undefined).length, 6, '无配置 → 默认 6 个')
})
