const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'services', 'search-service.ts'), 'utf8')
// O1 拆分（P7b）：`SERPAPI_RETRYABLE_STATUS` 已迁至 search/constants.ts（读取目标随之迁移，断言强度不变）。
const constantsSource = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'services', 'search', 'constants.ts'),
  'utf8',
)

test('SerpApi 429 is fail-fast and not retried by search service', () => {
  const retryableSet = constantsSource.match(/const SERPAPI_RETRYABLE_STATUS = new Set\(\[([^\]]+)\]\)/)
  assert.ok(retryableSet, 'SERPAPI_RETRYABLE_STATUS should remain explicit')
  assert.doesNotMatch(retryableSet[1], /\b429\b/)
})

test('SerpApi 400 location fallback only handles explicit unsupported-location errors', () => {
  assert.match(
    source,
    /mode === 'maps-location' && isSerpApiUnsupportedLocationError\(searchResponse\.status, rawText\)/,
  )
  assert.match(source, /status !== 400\) return false/)
  assert.match(source, /normalized\.includes\('unsupported'\) && normalized\.includes\('location'\)/)
})
