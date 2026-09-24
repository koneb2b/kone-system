const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// 宪法排序法典回归防护（kone-PRD §0.5.1 / L145 / L207）：
// 确定性预评分（40/30/20/10）必须"为初始排序与预筛漏斗服务"——在 LLM 评分前按
// matchScore 降序排序，未评分项按 -1 兜底。否则 `slice(0, N)` 会退化为"按数据源
// 合并顺序取前 N 条"，本地(Maps)结果挤掉有机(Organic)结果，高相关线索进不了 AI 评分。
const scoring = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'search', 'scoring.js'),
)

test('rankByMatchScore: 按 matchScore 降序排列', () => {
  const input = [
    { company: 'A', matchScore: 40 },
    { company: 'B', matchScore: 90 },
    { company: 'C', matchScore: 70 },
  ]
  const ranked = scoring.rankByMatchScore(input)
  assert.deepEqual(
    ranked.map((l) => l.company),
    ['B', 'C', 'A'],
  )
})

test('rankByMatchScore: 未评分项（undefined/null）统一按 -1 兜底排在末尾', () => {
  const input = [
    { company: 'no-score-undefined' },
    { company: 'scored-60', matchScore: 60 },
    { company: 'no-score-null', matchScore: null },
    { company: 'scored-100', matchScore: 100 },
  ]
  const ranked = scoring.rankByMatchScore(input)
  assert.deepEqual(
    ranked.map((l) => l.company),
    ['scored-100', 'scored-60', 'no-score-undefined', 'no-score-null'],
  )
})

test('rankByMatchScore: 不修改入参（纯函数）', () => {
  const input = [
    { company: 'A', matchScore: 10 },
    { company: 'B', matchScore: 90 },
  ]
  const snapshot = input.map((l) => l.company)
  scoring.rankByMatchScore(input)
  assert.deepEqual(
    input.map((l) => l.company),
    snapshot,
    '入参顺序不应被改动',
  )
})

test('rankByMatchScore: 同分保持原有相对顺序（稳定）', () => {
  const input = [
    { company: 'first', matchScore: 80 },
    { company: 'second', matchScore: 80 },
    { company: 'third', matchScore: 80 },
  ]
  assert.deepEqual(
    scoring.rankByMatchScore(input).map((l) => l.company),
    ['first', 'second', 'third'],
  )
})

test('rankByMatchScore: 空数组安全', () => {
  assert.deepEqual(scoring.rankByMatchScore([]), [])
})
