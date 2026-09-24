const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// P1-2 回归防护：搜索扇出（关键词变体）必须有界并发。
//
// 缺陷背景：search-service 的关键词变体层原先是 `Promise.all(allSearchKeywords.map(...))`，
// 完全无界。关键词数 = 英文变体 ≤4 + 各本地语言 ≤4/语言，多语言扩面时可一次性打出
// 十几个并发上游请求，触发限流或本机 socket 耗尽。
// 同时它与宪法"最大并发 Job = 2"语义混淆——2 是 LLM 评分/官网富化的算力红线，
// 扇出是另一个独立并发域，现已显式设闸为 3 并在规范中区分。

const repoRoot = path.join(__dirname, '..', '..')
const searchSource = fs.readFileSync(path.join(repoRoot, 'electron', 'services', 'search-service.ts'), 'utf8')
// O1 拆分（P2）：`mapLimitedConcurrency` 定义已迁至 search/concurrency.ts（调用点仍在 search-service.ts）。
const concurrencySource = fs.readFileSync(
  path.join(repoRoot, 'electron', 'services', 'search', 'concurrency.ts'),
  'utf8',
)
const prdSource = fs.readFileSync(path.join(repoRoot, 'kone-PRD.md'), 'utf8')

test('P1-2: 关键词变体层不再使用无界 Promise.all', () => {
  assert.doesNotMatch(
    searchSource,
    /Promise\.all\(\s*allSearchKeywords\.map/,
    'allSearchKeywords 必须走有界并发，不得退化为无界 Promise.all',
  )
  assert.match(
    searchSource,
    /mapLimitedConcurrency\(\s*allSearchKeywords,\s*SEARCH_FANOUT_CONCURRENCY/,
    '搜索扇出必须显式传入 SEARCH_FANOUT_CONCURRENCY',
  )
})

test('P1-2: SEARCH_FANOUT_CONCURRENCY 已定义且为有限正值', () => {
  const m = searchSource.match(/const\s+SEARCH_FANOUT_CONCURRENCY\s*=\s*(\d+)/)
  assert.ok(m, '必须定义 SEARCH_FANOUT_CONCURRENCY 常量')
  const value = Number(m[1])
  assert.ok(Number.isFinite(value) && value > 0, `扇出并发必须为有限正值，实际 ${value}`)
  assert.ok(value <= 8, `扇出并发不得超过 8（避免上游限流），实际 ${value}`)
})

test('P1-2: 结果版并发助手按索引回填，顺序不漂移', () => {
  // O1 拆分（P2）后定义位于 search/concurrency.ts（断言强度不变）。
  const m = concurrencySource.match(/const mapLimitedConcurrency[\s\S]*?\n}/)
  assert.ok(m, '必须定义 mapLimitedConcurrency')
  const body = m[0]
  assert.match(body, /results\[index\]\s*=\s*await/, '必须按索引回填以保证结果顺序与入参一致')
  assert.match(body, /currentIndex\s*\+=\s*1/, '必须由游标分配任务（真并发调度）')
})

test('P1-2: 宪法常量表区分了扇出与评分/富化两个并发域', () => {
  assert.match(prdSource, /SEARCH_FANOUT_CONCURRENCY/, '宪法常量表必须收录扇出并发')
  assert.match(prdSource, /两个独立并发域|独立并发域/, '必须说明扇出与评分/富化是不同并发域')
  // 评分/富化的 2 不得被改写
  assert.match(prdSource, /SEARCH_LLM_CONCURRENCY/, '评分并发常量名必须保留')
  assert.match(prdSource, /SEARCH_ENRICH_CONCURRENCY/, '富化并发常量名必须保留')
})
