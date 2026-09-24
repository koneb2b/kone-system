const assert = require('node:assert/strict')
const {
  buildFallbackAwareMapsQuery,
  normalizeSearchResponseCandidates,
  resolveSerpSearchPlan,
} = require('../dist-electron/electron/services/search-service.js')

const run = async () => {
  const stageEvents = []
  const fallbackEvents = []
  const calls = []

  const planOne = await resolveSerpSearchPlan({
    keyword: 'Golf Cart Battery Dealer',
    city: 'San Francisco',
    country: 'USA',
    googleKey: 'mock-key',
    timeoutMs: 2000,
    attemptSearch: async (mode, modeQuery, modeLocation) => {
      calls.push({ mode, modeQuery, modeLocation })
      if (mode === 'maps-location') {
        throw new Error('UNSUPPORTED_LOCATION::SerpApi HTTP 400: unsupported location')
      }
      return {
        nextOrganic: [],
        nextLocal: [
          {
            title: 'Bay Battery Supply',
            website: 'baybattery.example',
            address: 'San Francisco, CA, USA',
            description: 'Golf cart battery distributor',
          },
        ],
      }
    },
    onStage: (message, searchMode) => stageEvents.push({ message, searchMode }),
    onFallback: (event, detail) => fallbackEvents.push({ event, detail }),
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    mode: 'maps-location',
    modeQuery: 'Golf Cart Battery Dealer',
    modeLocation: 'San Francisco',
  })
  assert.deepEqual(calls[1], {
    mode: 'maps-keyword',
    modeQuery: buildFallbackAwareMapsQuery('Golf Cart Battery Dealer', 'San Francisco, USA'),
    modeLocation: '',
  })
  assert.equal(planOne.activeSearchMode, 'maps-keyword-fallback')
  assert.equal(stageEvents[0] && stageEvents[0].searchMode, 'maps-keyword-fallback')
  assert.match(String((stageEvents[0] && stageEvents[0].message) || ''), /地图定位受限/)
  assert.equal(fallbackEvents[0] && fallbackEvents[0].event, 'location-rejected')

  const planTwoCalls = []
  const organicStageEvents = []

  const planTwo = await resolveSerpSearchPlan({
    keyword: 'Battery Dealer',
    city: '',
    country: 'Japan',
    googleKey: 'mock-key',
    timeoutMs: 2000,
    attemptSearch: async (mode, modeQuery, modeLocation) => {
      planTwoCalls.push({ mode, modeQuery, modeLocation })
      if (mode === 'maps-keyword') {
        return { nextOrganic: [], nextLocal: [] }
      }
      return {
        nextOrganic: [
          {
            title: 'Tokyo Battery Trading',
            link: 'https://tokyobattery.example',
            snippet: 'Industrial battery importer in Japan',
          },
        ],
        nextLocal: [],
      }
    },
    onStage: (message, searchMode) => organicStageEvents.push({ message, searchMode }),
  })

  assert.equal(planTwoCalls.length, 2)
  assert.deepEqual(planTwoCalls[0], {
    mode: 'maps-keyword',
    modeQuery: buildFallbackAwareMapsQuery('Battery Dealer', 'Japan'),
    modeLocation: '',
  })
  assert.deepEqual(planTwoCalls[1], {
    mode: 'organic-keyword',
    modeQuery: buildFallbackAwareMapsQuery('Battery Dealer', 'Japan'),
    modeLocation: '',
  })
  assert.equal(planTwo.activeSearchMode, 'organic-fallback')
  assert.equal(organicStageEvents[0] && organicStageEvents[0].searchMode, 'organic-fallback')
  assert.match(String((organicStageEvents[0] && organicStageEvents[0].message) || ''), /全局网页线索/)

  const normalized = normalizeSearchResponseCandidates(planTwo.allOrganic, planTwo.allLocal, '', 'Japan')
  assert.equal(normalized.filteredLocalResults.length, 0)
  assert.equal(normalized.normalizedCandidates.length, 1)
  assert.equal(normalized.normalizedCandidates[0] && normalized.normalizedCandidates[0].source, 'Google Organic')
  assert.equal(
    normalized.normalizedCandidates[0] && normalized.normalizedCandidates[0].company,
    'Tokyo Battery Trading',
  )
  assert.equal(
    normalized.normalizedCandidates[0] && normalized.normalizedCandidates[0].website,
    'https://tokyobattery.example',
  )

  console.log('[mock-search-fallback] all assertions passed')
}

run().catch((error) => {
  console.error('[mock-search-fallback] failed', error)
  process.exitCode = 1
})
