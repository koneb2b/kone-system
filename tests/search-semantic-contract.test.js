const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8')

test('search stage payload exposes structured degraded semantic metadata (AnalysisSemanticCode)', () => {
  const contracts = read('src', 'shared', 'ipc-contracts.ts')
  // O1 拆分（P7a）：分析语义（getAnalysisConfigError / buildDevMockAnalysisData）已迁至
  // electron/services/search/analysis.ts —— 断言读取目标随之迁移，断言强度不变。
  const analysisService = read('electron', 'services', 'search', 'analysis.ts')
  const searchEngine = read('src', 'components', 'search-engine.tsx')

  assert.match(contracts, /export type AnalysisSemanticCode =/)
  assert.match(contracts, /'missing_llm_key'/)
  assert.match(contracts, /'missing_llm_base_url'/)
  assert.match(contracts, /'provider_timeout'/)
  assert.match(contracts, /'provider_unavailable'/)
  assert.match(contracts, /semantic\?: AnalysisSemanticMeta/)

  assert.match(analysisService, /semantic: AnalysisSemanticMeta/)
  assert.match(analysisService, /code: 'missing_llm_key'/)
  assert.match(analysisService, /degraded: true/)
  assert.match(analysisService, /settingsActionable: true/)

  // AI-skip degraded-state detection now lives in the extracted search hook.
  const searchHook = read('src', 'hooks', 'use-search-engine.ts')
  assert.match(searchHook, /isAiSkippedStageMessage\(payload\?\.message\)/)
  assert.match(searchEngine, /aiScoringSkipped/)

  // 用户可见的「未启用 AI 评分」降级文案随卡片组件抽离迁移至 `search-result-card.tsx`：
  // `search-engine.tsx` 负责把 `aiScoringSkipped` 透传给 `SearchResultCard`，卡片再按
  // `settlementMeta.state === 'ai_skipped'` 渲染该文案。此处对"标志 → 文案"整条链路都断言，
  // 既避免断言停留在已抽离走的旧文件上，也防止透传被摘除后文案静默失效。
  const searchResultCard = read('src', 'components', 'search', 'search-result-card.tsx')
  assert.match(searchResultCard, /未启用 AI 评分/)
  assert.match(searchResultCard, /getLeadSettlementMeta\(lead, \{ isStreaming, aiScoringSkipped \}\)/)
  assert.match(
    searchEngine,
    /aiScoringSkipped=\{aiScoringSkipped\}/,
    'search-engine 应将 aiScoringSkipped 透传给 SearchResultCard',
  )
})

test('search result IDs use stable hashing via lead-mappers createNumericLeadId', () => {
  const mapper = read('src', 'lib', 'lead-mappers.ts')
  const searchEngine = read('src', 'components', 'search-engine.tsx')

  assert.match(mapper, /const createNumericLeadId = /)
  assert.match(mapper, /stableHash\(input\)/)
  assert.match(searchEngine, /stableHash/)
})
