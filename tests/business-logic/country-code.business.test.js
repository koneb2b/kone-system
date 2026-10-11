/**
 * country-code 守护测试（2026-10-11）
 *
 * ## 背景
 * P2-1 修复前，代码用 `country.slice(0, 2).toUpperCase()` 推导国家码：
 *   `Global`        → `GL`（格陵兰！）
 *   `United States` → `UN`
 *   `Germany`       → `GE`
 * 这些**假码**已落入用户数据，导出后显示「格陵兰」，污染下游
 * （号码补全 / 邮件语言 / 本地化搜索变体）。
 *
 * 本测试锁定两条不变量：
 *   ① 已知国家名必须解析为**正确的 ISO alpha-2**
 *   ② **未知/非国家名（如 Global）必须返回空串** —— 假码比空值更糟
 */
const assert = require('node:assert')
const test = require('node:test')

const load = () => {
  const candidates = ['../../dist-electron/src/lib/country-code.js', '../../dist-electron/lib/country-code.js']
  for (const c of candidates) {
    try {
      return require(c)
    } catch {
      /* try next */
    }
  }
  return require('../../src/lib/country-code.ts')
}

test('country-code: 已知国家名必须解析为正确 ISO alpha-2', () => {
  const { resolveCountryCode } = load()
  assert.equal(resolveCountryCode('Germany'), 'DE')
  assert.equal(resolveCountryCode('德国'), 'DE')
  assert.equal(resolveCountryCode('United States'), 'US')
  assert.equal(resolveCountryCode('USA'), 'US')
  assert.equal(resolveCountryCode('美国'), 'US')
  assert.equal(resolveCountryCode('United Kingdom'), 'GB')
  assert.equal(resolveCountryCode('中国'), 'CN')
})

test('country-code: 「Global」等非国家名必须返回空串（不得截取前两字母）', () => {
  const { resolveCountryCode } = load()
  // 这是本次实测发现的真实数据：country:"Global" → 曾被截成 "GL"（格陵兰）
  assert.equal(resolveCountryCode('Global'), '', 'Global 不得被解析为国家码')
  assert.equal(resolveCountryCode('global'), '')
  assert.equal(resolveCountryCode('全球'), '')
  assert.equal(resolveCountryCode(''), '')
  assert.equal(resolveCountryCode(undefined), '')
})

test('country-code: 假码来源（截取前两字母）必须已彻底移除', () => {
  const { resolveCountryCode } = load()
  // 逐项验证：这些**曾经**会被截取成假码的国家名，现在必须给出正确值或空串
  const cases = [
    ['Germany', 'DE'], // 曾 → GE
    ['United States', 'US'], // 曾 → UN
    ['Global', ''], // 曾 → GL
    ['France', 'FR'], // 曾碰巧对
  ]
  for (const [input, expected] of cases) {
    assert.equal(resolveCountryCode(input), expected, `${input} 应为 ${expected || '(空)'}`)
  }
})
