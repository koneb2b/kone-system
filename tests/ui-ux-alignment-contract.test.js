const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8')

test('premium workspace access treats Enterprise as unlocked in sidebar', () => {
  const sidebar = read('src', 'components', 'app-sidebar.tsx')

  assert.match(sidebar, /const canAccessPremiumWorkspace = tier === ["']premium["'] \|\| plan === ["']enterprise["']/)
  assert.match(sidebar, /item\.premium && !canAccessPremiumWorkspace/)
  assert.doesNotMatch(sidebar, /badge: ["']Pro["']/)
})

test('search quality controls use localized Simplified Chinese for filter labels', () => {
  const searchEngine = read('src', 'components', 'search-engine.tsx')

  assert.match(searchEngine, /优先官网/)
  assert.match(searchEngine, /优先 B2B 角色词/)
  assert.match(searchEngine, /优先本土域名/)
})

test('renderer and main process agree that US local domains may include .com', () => {
  // Renderer-side domain map now lives in the extracted search hook.
  // 引号风格兼容双/单引号（prettier 可能整文件统一，不影响语义对齐断言）。
  const searchHook = read('src', 'hooks', 'use-search-engine.ts')
  const searchService = read('electron', 'services', 'search-service.ts')

  const usEntry = /["']?usa["']?: \[("\.us", "\.com"|'\.us', '\.com')\]/
  const usStatesEntry = /["']?united states["']?: \[("\.us", "\.com"|'\.us', '\.com')\]/
  assert.match(searchHook, usEntry)
  assert.match(searchHook, usStatesEntry)
  assert.match(searchService, usEntry)
  assert.match(searchService, usStatesEntry)
})

test('user-visible search labels are Simplified Chinese without generic English helper copy', () => {
  const searchEngine = read('src', 'components', 'search-engine.tsx')
  const leadsTable = read('src', 'components', 'leads-table.tsx')

  // Omni-Search 大一统盲搜 (PROJECT-PRD §3): the legacy "搜索数据源" channel
  // dropdown was intentionally removed; the single blind-search entry replaces it.
  assert.doesNotMatch(searchEngine, /搜索数据源/)
  assert.match(searchEngine, /AI 全渠道盲搜/)
  assert.match(searchEngine, /AI 正在全球检索/)
  assert.match(searchEngine, /立即开始 AI 获客/)
  // No user-visible English data-source helper copy (JSX text); code comments/identifiers exempt.
  assert.doesNotMatch(searchEngine, />[^<]*Data Source[^<]*</)
  assert.match(leadsTable, /已评分高潜线索推荐/)
  assert.match(leadsTable, /仅展示已完成评分且最值得优先跟进的线索/)
})
