const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P0-2 Eligibility Gate（G2 假高分漏洞闭环）：
// computeScoutRelevance 是软过滤（一个锚点词命中即可保留负向信号候选），
// Eligibility Gate 在其后执行结构化一票否决；产品词命中必须是词边界匹配。
// 本套件直接断言编译产物的纯函数行为，零网络。

const searchService = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'search-service.js'),
)

const mkCandidate = (overrides = {}) => ({
  company: 'Acme GmbH',
  website: 'https://acme.de',
  snippet: 'industrial battery wholesaler',
  ...overrides,
})

test('P0-2: B2C 零售终端被一票否决', () => {
  const veto = searchService.computeEligibilityVeto(
    mkCandidate({ company: 'Premium Retail Store', snippet: 'online store for consumers' }),
  )
  assert.equal(veto.blocked, true)
  assert.match(veto.category, /B2C/)
})

test('P0-2: 维修/保养服务被一票否决', () => {
  const veto = searchService.computeEligibilityVeto(
    mkCandidate({ company: 'Fast Auto Repair', snippet: 'oil change and collision repair' }),
  )
  assert.equal(veto.blocked, true)
  assert.match(veto.category, /维修/)
})

test('P0-2: 二手/翻新被一票否决', () => {
  const veto = searchService.computeEligibilityVeto(
    mkCandidate({ company: 'Used Machinery Trader', snippet: 'refurbished equipment' }),
  )
  assert.equal(veto.blocked, true)
  assert.match(veto.category, /二手/)
})

test('P0-2: 电商平台卖家被一票否决', () => {
  const veto = searchService.computeEligibilityVeto(
    mkCandidate({ company: 'Top Deals', website: 'https://topdeals.ebay.com/shop' }),
  )
  assert.equal(veto.blocked, true)
  assert.match(veto.category, /电商平台/)
})

test('P0-2: 正向对照组 —— 合规 B2B 批发商不被否决', () => {
  const veto = searchService.computeEligibilityVeto(
    mkCandidate({ company: 'Tokyo Battery Trading', snippet: 'battery distributor and wholesaler since 1985' }),
  )
  assert.equal(veto.blocked, false, '合规 B2B 候选不得被硬门误杀')
})

test('P0-2: matchesProductTerm 词边界 —— "car" 不再误伤 "carpet"', () => {
  assert.equal(searchService.matchesProductTerm('carpet world trading co', 'car'), false, '子串误伤必须被消除')
  assert.equal(searchService.matchesProductTerm('car dealer and exporter', 'car'), true, '真实命中必须保留')
})

test('P0-2: matchesProductTerm 非 ASCII（本地语言变体）退回 includes', () => {
  assert.equal(searchService.matchesProductTerm('我们有高尔夫球车库存', '高尔夫球车'), true)
  assert.equal(searchService.matchesProductTerm('computadora industrial', 'computadora industrial'), true)
})

test('P0-2: computeIcpMatchScore 产品词误伤修复生效', () => {
  // 域名 40 分；产品词 "car" 对 "Carpet World" 在词边界规则下不应命中
  const carpetScore = searchService.computeIcpMatchScore(
    mkCandidate({ company: 'Carpet World', snippet: 'carpets and rugs' }),
    ['car'],
  )
  assert.equal(carpetScore, 40, '误伤命中被消除后只剩域名分')

  const carScore = searchService.computeIcpMatchScore(
    mkCandidate({ company: 'Munich Car Export GmbH', snippet: 'car exporter' }),
    ['car'],
  )
  assert.equal(carScore, 70, '真实产品命中得 40+30')
})
