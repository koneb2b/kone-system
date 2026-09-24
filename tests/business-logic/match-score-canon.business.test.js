const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// 三态语义法典回归防护（kone-PRD §L147，V1.2 不变红线）：
//   undefined = 未评分（Scout 骨架态）｜有效数字 = 已评分｜null = 上游判定无效值。
// **任何映射层不得将 undefined/null 静默转换为 0** —— 0 分是"评估过且极差"，
// 与"尚未评估"商业语义完全不同，混淆即破坏高潜推荐漏斗的可信度。
const scoring = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'search', 'scoring.js'),
)

test('normalizeMatchScore: null 必须保留为 null（严禁静默转 0）', () => {
  assert.equal(scoring.normalizeMatchScore(null), null)
})

test('normalizeMatchScore: undefined 必须保留为 undefined（未评分态）', () => {
  assert.equal(scoring.normalizeMatchScore(undefined), undefined)
})

test('normalizeMatchScore: 空串不得折算为 0（此前 Number("")===0 的误判）', () => {
  assert.equal(scoring.normalizeMatchScore(''), undefined)
  assert.equal(scoring.normalizeMatchScore('   '), undefined)
})

test('normalizeMatchScore: 合法数字透传，0 与未评分区分', () => {
  assert.equal(scoring.normalizeMatchScore(0), 0)
  assert.equal(scoring.normalizeMatchScore(95), 95)
  assert.equal(scoring.normalizeMatchScore(100), 100)
})

test('normalizeMatchScore: 数字字符串防御性转换（LLM 偶发返回 "85"）', () => {
  assert.equal(scoring.normalizeMatchScore('85'), 85)
  assert.equal(scoring.normalizeMatchScore(' 72 '), 72)
})

test('normalizeMatchScore: 非数字输入归一为 undefined', () => {
  assert.equal(scoring.normalizeMatchScore('abc'), undefined)
  assert.equal(scoring.normalizeMatchScore(NaN), undefined)
  assert.equal(scoring.normalizeMatchScore({}), undefined)
})

test('normalizeMatchScore: 超界钳制到 0-100', () => {
  assert.equal(scoring.normalizeMatchScore(150), 100)
  assert.equal(scoring.normalizeMatchScore(-5), 0)
})

test('applySchemaDefaults: matchScore 三态在序列化层不被破坏', () => {
  assert.equal(scoring.applySchemaDefaults({ company: 'A', matchScore: null }).matchScore, null)
  assert.equal(scoring.applySchemaDefaults({ company: 'B' }).matchScore, undefined)
  assert.equal(scoring.applySchemaDefaults({ company: 'C', matchScore: 0 }).matchScore, 0)
  assert.equal(scoring.applySchemaDefaults({ company: 'D', matchScore: 88 }).matchScore, 88)
})
