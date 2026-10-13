/**
 * lead-feedback.business.test.js — 用户「相关 / 不相关」反馈闭环守护测试（S4c）
 *
 * 背景（2026-10-13）：「匹配精度」是 Kone 的核心价值，但 ICP/LLM 评分是**静态规则**，
 * 不会因用户判断而改进。S4c 引入**本地、零成本**的反馈闭环：
 * 用户标「不相关」的线索，下一轮不再被高分推荐；标「相关」的获得可见的正向信号。
 *
 * 本测试锁定：
 *   ① 反馈键稳定（域名优先，跨轮次/跨公司名改写都命中同一实体）；
 *   ② 调整**可解释**（写入 riskFlags / matchReasons，不静默改分）、**保守**（不相关封顶、相关小幅）、
 *      **幂等**、**未标记则零副作用**；
 *   ③ 源码守卫：搜索链路确实读取并应用了反馈表。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const MOD = path.join(ROOT, 'dist-electron', 'src', 'shared', 'lead-feedback.js')
const SEARCH_SERVICE_TS = path.join(ROOT, 'electron', 'services', 'search-service.ts')

const {
  deriveFeedbackKey,
  applyFeedbackAdjustment,
  FEEDBACK_IRRELEVANT_SCORE_CAP,
  FEEDBACK_RELEVANT_BONUS,
  FEEDBACK_IRRELEVANT_REASON,
  FEEDBACK_RELEVANT_REASON,
} = require(MOD)

test('deriveFeedbackKey：域名优先（去 www、小写），跨轮次稳定', () => {
  assert.equal(deriveFeedbackKey({ website: 'https://www.Acme.com/path', company: 'Acme Inc' }), 'acme.com')
  assert.equal(deriveFeedbackKey({ website: 'acme.com', company: 'Acme Inc' }), 'acme.com')
  // 同一实体、公司名被改写 → 键不变（域名优先的价值）
  assert.equal(deriveFeedbackKey({ website: 'https://acme.com', company: 'ACME LLC' }), 'acme.com')
})

test('deriveFeedbackKey：无/非法网站 → 回退公司名小写', () => {
  assert.equal(deriveFeedbackKey({ website: '', company: '  Acme Inc ' }), 'acme inc')
  assert.equal(deriveFeedbackKey({ company: 'Acme Inc' }), 'acme inc')
  assert.equal(deriveFeedbackKey({}), '')
})

test('applyFeedbackAdjustment：不相关 → **封顶**到管道门槛之下 + 可解释 riskFlag（前置）', () => {
  const lead = { company: 'X', matchScore: 88, riskFlags: ['原有风险'] }
  const out = applyFeedbackAdjustment(lead, { verdict: 'irrelevant', at: 1 })
  assert.equal(out.matchScore, FEEDBACK_IRRELEVANT_SCORE_CAP)
  assert.ok(out.matchScore < 60, '封顶后必须低于 Agent 管道门槛 60')
  assert.equal(out.riskFlags[0], FEEDBACK_IRRELEVANT_REASON, '原因必须**前置**（schema 只保留首项）')
})

test('applyFeedbackAdjustment：相关 → **小幅**加分 + 可解释 matchReason', () => {
  const lead = { company: 'X', matchScore: 70, matchReasons: ['原有理由'] }
  const out = applyFeedbackAdjustment(lead, { verdict: 'relevant', at: 1 })
  assert.equal(out.matchScore, 70 + FEEDBACK_RELEVANT_BONUS)
  assert.equal(out.matchReasons[0], FEEDBACK_RELEVANT_REASON, '理由必须**前置**')
})

test('applyFeedbackAdjustment：加分不越界（封顶 100）', () => {
  const out = applyFeedbackAdjustment({ matchScore: 99 }, { verdict: 'relevant', at: 1 })
  assert.equal(out.matchScore, 100)
})

test('applyFeedbackAdjustment：未标记 → **原样返回**（零副作用）', () => {
  const lead = { company: 'X', matchScore: 88 }
  assert.deepEqual(applyFeedbackAdjustment(lead, undefined), lead)
})

test('applyFeedbackAdjustment：幂等 + 只封顶不上调', () => {
  const once = applyFeedbackAdjustment({ matchScore: 88 }, { verdict: 'irrelevant', at: 1 })
  const twice = applyFeedbackAdjustment(once, { verdict: 'irrelevant', at: 1 })
  assert.equal(twice.matchScore, once.matchScore)
  assert.equal(new Set(twice.riskFlags).size, twice.riskFlags.length, 'riskFlags 不得重复堆叠')
  // 原本低分不被抬高
  assert.equal(applyFeedbackAdjustment({ matchScore: 3 }, { verdict: 'irrelevant', at: 1 }).matchScore, 3)
})

test('源码守卫：搜索链路必须读取并应用反馈表（两处：排序前 + 最终结果）', () => {
  const src = fs
    .readFileSync(SEARCH_SERVICE_TS, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /applyFeedbackAdjustment\(/, '必须调用 applyFeedbackAdjustment')
  assert.match(src, /deriveFeedbackKey\(lead\)/, '必须用 deriveFeedbackKey 取反馈键')
  assert.match(src, /leadFeedback/, '必须从 userConfig 读取 leadFeedback 表')
  const calls = (src.match(/applyFeedbackAdjustment\(/g) || []).length
  assert.ok(calls >= 2, `应在「排序前」与「最终结果」两处应用（实际 ${calls} 处）`)
})
