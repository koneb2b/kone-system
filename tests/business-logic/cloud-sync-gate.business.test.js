const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// 上云 Gold Filter 回归防护（kone-PRD §L157，宪法红线）：
// 「只有 `email` 非空的合格黄金线索才放行单向交接，绝不允许 bulk-sync 未经筛选的原始垃圾包上云。」
// 此前实现只校验评分与域名、漏了 email —— 会把无邮箱线索同步上云。
const { evaluateCloudSyncGate } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'utils', 'cloud-sync-gate.js'),
)

const MIN = 80

test('§L157: 无邮箱线索一律不予上云（即便评分达标）', () => {
  const result = evaluateCloudSyncGate({ matchScore: 95, email: '' }, MIN)
  assert.equal(result.allowed, false)
  assert.match(result.reason, /邮箱/)
})

test('§L157: email 为空白字符同样视为缺失', () => {
  assert.equal(evaluateCloudSyncGate({ matchScore: 95, email: '   ' }, MIN).allowed, false)
  assert.equal(evaluateCloudSyncGate({ matchScore: 95 }, MIN).allowed, false)
  assert.equal(evaluateCloudSyncGate({ matchScore: 95, email: null }, MIN).allowed, false)
})

test('§L157: 评分达标且 email 非空 → 放行', () => {
  assert.equal(evaluateCloudSyncGate({ matchScore: 88, email: 'buyer@corp.com' }, MIN).allowed, true)
})

test('§L157: 评分低于阈值 → 拒绝（原因指向评分）', () => {
  const result = evaluateCloudSyncGate({ matchScore: 60, email: 'buyer@corp.com' }, MIN)
  assert.equal(result.allowed, false)
  assert.match(result.reason, /低于上云阈值/)
})

test('§L157: 人工 force 覆盖评分阈值，但仍须 email 非空', () => {
  assert.equal(evaluateCloudSyncGate({ matchScore: 10, email: 'buyer@corp.com' }, MIN, true).allowed, true)
  assert.equal(evaluateCloudSyncGate({ matchScore: 10, email: '' }, MIN, true).allowed, false)
})

test('§L157: score 字段作为 matchScore 的兼容回退', () => {
  assert.equal(evaluateCloudSyncGate({ score: 90, email: 'a@b.com' }, MIN).allowed, true)
  assert.equal(evaluateCloudSyncGate({ score: 50, email: 'a@b.com' }, MIN).allowed, false)
})
