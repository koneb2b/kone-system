/**
 * negative-icp-guard.business.test.js — 用户「负向 ICP」确定性护栏守护测试（S4a）
 *
 * 背景（2026-10-13）：`negativeIcp` 此前**只出现在 LLM 评分 prompt** 里（软约束），
 * LLM 完全可能忽略它，把明显不符合的线索仍打高分 → 进入 Agent 管道浪费触达额度。
 *
 * 修复：新增**确定性**护栏 —— 命中负向词即**封顶降权**（低于管道门槛 60）+ 写入**可解释** riskFlag。
 * 刻意用「封顶」而非「剔除」：负向词是自由文本，误伤风险不可忽略；封顶让线索仍可见（透明可复核），
 * 但无法跨过 60 分门槛进入自动触达。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SCORING = path.join(ROOT, 'dist-electron', 'electron', 'services', 'search', 'scoring.js')
const SEARCH_SERVICE_TS = path.join(ROOT, 'electron', 'services', 'search-service.ts')

const { parseNegativeIcpTerms, matchNegativeIcp, applyNegativeIcpPenalty, NEGATIVE_ICP_SCORE_CAP } = require(SCORING)

test('parseNegativeIcpTerms：按逗号/顿号/分号/竖线/换行切分，去重、剔除过短项', () => {
  const terms = parseNegativeIcpTerms(' 零售, 电商、二手 ; 政府|军方\n学校, a ')
  assert.deepEqual(terms.sort(), ['学校', '政府', '军方', '电商', '零售', '二手'].sort())
  assert.ok(!terms.includes('a'), '单字符项应被剔除（噪声）')
  assert.deepEqual(parseNegativeIcpTerms(''), [])
  assert.deepEqual(parseNegativeIcpTerms(undefined), [])
})

test('matchNegativeIcp：命中返回词项（可解释），未命中返回空数组', () => {
  const lead = { company: 'ABC Retail Store', snippet: 'B2C 电商 零售 面向消费者' }
  const hits = matchNegativeIcp(lead, '零售, 电商')
  assert.deepEqual(hits.sort(), ['零售', '电商'].sort())
  assert.deepEqual(matchNegativeIcp(lead, '军工, 政府'), [], '未命中应为空')
  assert.deepEqual(matchNegativeIcp(lead, ''), [], '未配置负向 ICP 时不得误判')
})

test('applyNegativeIcpPenalty：命中即**封顶**到管道门槛之下 + 写入可解释 riskFlag', () => {
  const lead = { company: 'ABC 零售', snippet: 'B2C', matchScore: 88, riskFlags: ['原有风险'] }
  const out = applyNegativeIcpPenalty(lead, '零售')
  assert.ok(out.matchScore < 60, `封顶后必须低于 Agent 管道门槛 60，实际 ${out.matchScore}`)
  assert.equal(out.matchScore, NEGATIVE_ICP_SCORE_CAP)
  assert.ok(
    out.riskFlags.some((f) => f.includes('命中负向 ICP') && f.includes('零售')),
    `riskFlag 必须**可解释**（写明命中词），实际 ${JSON.stringify(out.riskFlags)}`,
  )
  assert.ok(out.riskFlags.includes('原有风险'), '原有 riskFlags 不得丢失')
})

test('applyNegativeIcpPenalty：未命中 → **原样返回**（零副作用，不改变任何字段）', () => {
  const lead = { company: 'ABC Manufacturing', snippet: 'B2B 批发', matchScore: 88 }
  const out = applyNegativeIcpPenalty(lead, '零售, 电商')
  assert.deepEqual(out, lead, '未命中不得改动线索')
})

test('applyNegativeIcpPenalty：未配置负向 ICP → 不封顶（不得误伤）', () => {
  const lead = { company: 'ABC 零售', matchScore: 88 }
  assert.equal(applyNegativeIcpPenalty(lead, '').matchScore, 88)
  assert.equal(applyNegativeIcpPenalty(lead, undefined).matchScore, 88)
})

test('applyNegativeIcpPenalty：幂等（重复应用结果一致）', () => {
  const lead = { company: 'ABC 零售', matchScore: 88 }
  const once = applyNegativeIcpPenalty(lead, '零售')
  const twice = applyNegativeIcpPenalty(once, '零售')
  assert.equal(twice.matchScore, once.matchScore)
  assert.equal(new Set(twice.riskFlags).size, twice.riskFlags.length, 'riskFlag 不得重复堆叠')
})

test('applyNegativeIcpPenalty：仅封顶不上调（原本低分不被抬高）', () => {
  const lead = { company: 'ABC 零售', matchScore: 5 }
  assert.equal(applyNegativeIcpPenalty(lead, '零售').matchScore, 5)
})

test('源码守卫：预筛排序必须使用**经负向 ICP 护栏**的数组（不得回退为原始 scoredMergedLeads）', () => {
  const src = fs
    .readFileSync(SEARCH_SERVICE_TS, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /applyNegativeIcpPenalty\(/, '必须调用负向 ICP 护栏')
  assert.match(src, /rankByMatchScore\(guardedMergedLeads\)/, '排序必须基于护栏后的数组')
  assert.ok(
    !/rankByMatchScore\(scoredMergedLeads\)/.test(src),
    '不得回退为对未护栏的 scoredMergedLeads 排序（负向线索会重新排到前面）',
  )
})
