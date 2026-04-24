const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { createIpcMainMock, createEventMock, createStoreMock, createElectronMock, withModuleMocks, resetModule } = require('./helpers.js')

const originalFetch = global.fetch
const searchServicePath = '../../dist-electron/electron/services/search-service.js'
const configServicePath = '../../dist-electron/electron/services/config-service.js'
const secretManagerPath = '../../dist-electron/electron/services/secret-manager.js'
const licenseServicePath = '../../dist-electron/electron/services/license-service.js'
const channelsPath = '../../dist-electron/electron/ipc/channels.js'

const loadSearchService = () => require(searchServicePath)


test('level-2 fallback emits exact maps-keyword-fallback wording', async () => {
  const stageEvents = []
  const calls = []

  const { buildFallbackAwareMapsQuery, resolveSerpSearchPlan } = loadSearchService()
  const plan = await resolveSerpSearchPlan({
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
  })

  assert.equal(plan.activeSearchMode, 'maps-keyword-fallback')
  assert.equal(stageEvents[0]?.searchMode, 'maps-keyword-fallback')
  assert.equal(stageEvents[0]?.message, '地图定位受限，正在尝试扩大识别范围...')
  assert.deepEqual(calls[1], {
    mode: 'maps-keyword',
    modeQuery: buildFallbackAwareMapsQuery('Golf Cart Battery Dealer', 'San Francisco, USA'),
    modeLocation: '',
  })
})

test('level-3 fallback emits exact organic-fallback wording', async () => {
  const stageEvents = []

  const { resolveSerpSearchPlan } = loadSearchService()
  const plan = await resolveSerpSearchPlan({
    keyword: 'Battery Dealer',
    city: '',
    country: 'Japan',
    googleKey: 'mock-key',
    timeoutMs: 2000,
    attemptSearch: async (mode) => {
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
    onStage: (message, searchMode) => stageEvents.push({ message, searchMode }),
  })

  assert.equal(plan.activeSearchMode, 'organic-fallback')
  assert.equal(stageEvents[0]?.searchMode, 'organic-fallback')
  assert.equal(stageEvents[0]?.message, '未发现地图商户，已自动为您补位全局网页线索...')
})

test('search handler pre-filter removes body shop and mechanic noise while retaining a valid dealer', async () => {
  const electronMock = createElectronMock()
  const secretManagerMock = {
    getSecret(key) {
      if (/google-leads/i.test(String(key || ''))) return 'mock-google-key'
      if (/llm/i.test(String(key || ''))) return 'mock-llm-key'
      return ''
    },
    setSecret() { return { exists: true, masked: '***' } },
    checkSecret() { return { exists: true, masked: '***' } },
    migrateSecrets() { return false },
  }
  const licenseServiceMock = {
    createLicenseService() {
      return { licenseGuard: {} }
    },
    registerSecureFeatureIpc(ipcMain, channel, _store, _licenseGuard, _featureName, handler) {
      ipcMain.handle(channel, handler)
    },
  }

  const senderEvents = []
  global.fetch = async (url) => {
    const target = String(url)
    if (target.startsWith('https://serpapi.com/search.json')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async text() {
          return JSON.stringify({
            local_results: [
              { title: 'Downtown Body Shop', website: 'https://bodyshop.example', address: 'Tokyo', description: 'body shop and repair center' },
              { title: 'Quick Mechanic Service', website: 'https://mechanic.example', address: 'Tokyo', description: 'mechanic and tire service' },
              { title: 'Tokyo Battery Trading', website: 'https://tokyobattery.example', address: 'Tokyo', description: 'industrial battery dealer' },
            ],
          })
        },
        async json() {
          return {
            local_results: [
              { title: 'Downtown Body Shop', website: 'https://bodyshop.example', address: 'Tokyo', description: 'body shop and repair center' },
              { title: 'Quick Mechanic Service', website: 'https://mechanic.example', address: 'Tokyo', description: 'mechanic and tire service' },
              { title: 'Tokyo Battery Trading', website: 'https://tokyobattery.example', address: 'Tokyo', description: 'industrial battery dealer' },
            ],
          }
        },
      }
    }
    throw new Error(`Unexpected fetch: ${target}`)
  }

  await withModuleMocks({
    electron: electronMock,
    'electron-store': class MockStore {
      constructor() {
        this.values = {}
        this.path = path.join(process.cwd(), '.tmp-business-logic-user-data', 'kone-config.json')
      }
      get(key) {
        return this.values[key]
      }
      set(key, value) {
        this.values[key] = value
      }
    },
    [`./secret-manager::${path.join(process.cwd(), 'dist-electron', 'electron', 'services', 'search-service.js')}`]: secretManagerMock,
    [`./secret-manager::${path.join(process.cwd(), 'dist-electron', 'electron', 'services', 'config-service.js')}`]: secretManagerMock,
    [`./license-service::${path.join(process.cwd(), 'dist-electron', 'electron', 'services', 'search-service.js')}`]: licenseServiceMock,
  }, async () => {
    resetModule(searchServicePath)
    resetModule(configServicePath)
    resetModule(secretManagerPath)
    resetModule(licenseServicePath)
    resetModule(channelsPath)
    const { registerSearchHandlers } = require(searchServicePath)
    const { IPC_CHANNELS } = require(channelsPath)
    const ipcMain = createIpcMainMock()
    const store = createStoreMock({
      user_config: {
        providers: [
          { id: 'google-leads', baseUrl: 'https://serpapi.com' },
          { id: 'llm', baseUrl: 'https://mock-llm.example/v1' },
        ],
        selectedModel: 'gpt-4o-mini',
        icpProfile: {
          targetProduct: 'Industrial battery system',
          buyerPersona: 'distributor',
          coreAdvantage: 'stable delivery',
          negativeIcp: '',
        },
      },
    })

    registerSearchHandlers(ipcMain, store)
    const result = await ipcMain.getHandler(IPC_CHANNELS.SEARCH.EXECUTE)({
      sender: {
        send(channel, payload) {
          senderEvents.push({ channel, payload })
        },
      },
    }, {
      keyword: 'Industrial battery dealer',
      country: 'Japan',
      city: '',
      filterOptions: {},
    })

    assert.equal(result?.success, true)
    assert.ok(Array.isArray(result?.data?.results))
    const companies = result.data.results.map((item) => item.company)
    assert.ok(companies.includes('Tokyo Battery Trading'))
    assert.ok(!companies.includes('Downtown Body Shop'))
    assert.ok(!companies.includes('Quick Mechanic Service'))
  })
})

test.after(() => {
  global.fetch = originalFetch
})
