const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8')

test('search stage payload exposes structured degraded semantic metadata (AnalysisSemanticCode)', () => {
  const contracts = read('src', 'shared', 'ipc-contracts.ts')
  const service = read('electron', 'services', 'search-service.ts')
  const searchEngine = read('src', 'components', 'search-engine.tsx')

  assert.match(contracts, /export type AnalysisSemanticCode =/)
  assert.match(contracts, /'missing_llm_key'/)
  assert.match(contracts, /'missing_llm_base_url'/)
  assert.match(contracts, /'provider_timeout'/)
  assert.match(contracts, /'provider_unavailable'/)
  assert.match(contracts, /semantic\?: AnalysisSemanticMeta/)

  assert.match(service, /semantic: AnalysisSemanticMeta/)
  assert.match(service, /code: 'missing_llm_key'/)
  assert.match(service, /degraded: true/)
  assert.match(service, /settingsActionable: true/)

  // AI-skip degraded-state detection now lives in the extracted search hook.
  const searchHook = read('src', 'hooks', 'use-search-engine.ts')
  assert.match(searchHook, /isAiSkippedStageMessage\(payload\?\.message\)/)
  assert.match(searchEngine, /aiScoringSkipped/)
  assert.match(searchEngine, /未启用 AI 评分/)
})

test('search result IDs use stable hashing via lead-mappers createNumericLeadId', () => {
  const mapper = read('src', 'lib', 'lead-mappers.ts')
  const searchEngine = read('src', 'components', 'search-engine.tsx')

  assert.match(mapper, /const createNumericLeadId = /)
  assert.match(mapper, /stableHash\(input\)/)
  assert.match(searchEngine, /stableHash/)
})
