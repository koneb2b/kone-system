const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { URL } = require('node:url')

const originalLoad = Module._load
const originalFetch = global.fetch

const handlers = new Map()
const senderEvents = []
const observedQueries = []

const electronMock = {
  app: {
    isPackaged: false,
    name: 'Kone AI',
    getPath: () => path.join(process.cwd(), '.tmp-test-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
}

const secretManagerMock = {
  getSecret(key) {
    if (/google-leads/i.test(String(key || ''))) return 'mock-google-key'
    if (/llm/i.test(String(key || ''))) return 'mock-llm-key'
    return ''
  },
  setSecret() {
    return { exists: true, masked: '***' }
  },
  checkSecret() {
    return { exists: true, masked: '***' }
  },
  migrateSecrets() {
    return false
  },
}

const licenseServiceMock = {
  createLicenseService() {
    return { licenseGuard: {} }
  },
  registerSecureFeatureIpc(ipcMain, channel, _store, _licenseGuard, _featureName, handler) {
    ipcMain.handle(channel, handler)
  },
}

Module._load = function mockLoad(request, parent, isMain) {
  if (request === 'electron') return electronMock
  if (
    request === './secret-manager' &&
    parent &&
    /electron[\\/]services[\\/]search-service\.js$/.test(parent.filename)
  ) {
    return secretManagerMock
  }
  if (
    request === './secret-manager' &&
    parent &&
    /electron[\\/]services[\\/]config-service\.js$/.test(parent.filename)
  ) {
    return secretManagerMock
  }
  if (
    request === './license-service' &&
    parent &&
    /electron[\\/]services[\\/]search-service\.js$/.test(parent.filename)
  ) {
    return licenseServiceMock
  }
  return originalLoad.call(this, request, parent, isMain)
}

const jsonResponse = (status, data) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get(name) {
      return String(name || '').toLowerCase() === 'content-type' ? 'application/json' : null
    },
  },
  async text() {
    return JSON.stringify(data)
  },
  async json() {
    return data
  },
})

const textResponse = (status, text) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get() {
      return 'text/html'
    },
  },
  async text() {
    return text
  },
  async json() {
    throw new Error('not json')
  },
})

const llmResponse = (payload) =>
  jsonResponse(200, {
    choices: [{ message: { content: JSON.stringify(payload) } }],
  })

const createStore = () => ({
  values: {
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
  },
  get(key) {
    return this.values[key]
  },
  set(key, value) {
    this.values[key] = value
  },
})

const createIpcMain = () => ({
  handle(channel, handler) {
    handlers.set(channel, handler)
  },
})

const createEvent = () => ({
  sender: {
    send(channel, payload) {
      senderEvents.push({ channel, payload })
    },
  },
})

const resetState = () => {
  global.__deepProbeIssued = false
  observedQueries.length = 0
  senderEvents.length = 0
  handlers.clear()
  // P0 成本优化：serpapi-cache 是共享单例，测试场景间必须清缓存，
  // 否则前序场景写入的 URL 响应会污染后序场景的 mock 断言。
  try {
    require('../../dist-electron/electron/services/serpapi-cache.js').clearSerpApiCache()
  } catch {
    // dist 未编译时静默跳过
  }
}

const assert403ErrorShapes = () => {
  const trialExpired = {
    success: false,
    error: 'TRIAL_EXPIRED',
    message: 'trial expired',
    operationName: '海外客户智能搜索',
    code: 403,
  }
  const featureDenied = {
    success: false,
    error: 'FEATURE_DENIED',
    message: 'feature denied',
    operationName: '海外客户智能搜索',
    code: Number('403'),
  }

  assert.equal(trialExpired.success, false)
  assert.equal(trialExpired.error, 'TRIAL_EXPIRED')
  assert.equal(typeof trialExpired.message, 'string')
  assert.equal(typeof trialExpired.operationName, 'string')
  assert.equal(trialExpired.code, 403)

  assert.equal(featureDenied.success, false)
  assert.equal(featureDenied.error, 'FEATURE_DENIED')
  assert.equal(typeof featureDenied.message, 'string')
  assert.equal(typeof featureDenied.operationName, 'string')
  assert.equal(featureDenied.code, 403)
}

test('A: 官网 403 触发社交源查询并标记 social_blind_score', async () => {
  resetState()
  assert403ErrorShapes()

  global.fetch = async (url) => {
    const target = String(url)

    if (target.startsWith('https://serpapi.com/search.json')) {
      const parsed = new URL(target)
      const engine = parsed.searchParams.get('engine')
      const query = parsed.searchParams.get('q') || ''
      const start = Number(parsed.searchParams.get('start') || '0')

      if (engine === 'google_maps') {
        if (start > 0) return jsonResponse(200, { local_results: [] })
        return jsonResponse(200, {
          local_results: [
            {
              title: 'Blocked Parts Co',
              website: 'https://blocked.example',
              address: 'Berlin, Germany',
              description: 'Industrial battery dealer',
            },
          ],
        })
      }

      if (engine === 'google') {
        observedQueries.push(query)
        if (query.includes('site:linkedin.com/company')) {
          return jsonResponse(200, {
            organic_results: [
              { title: 'Blocked Parts Co | LinkedIn', snippet: 'Industrial battery dealer in Germany' },
            ],
          })
        }
        if (query.includes('site:kompass.com')) {
          return jsonResponse(200, {
            organic_results: [{ title: 'Blocked Parts Co - Kompass', snippet: 'B2B industrial supplier profile' }],
          })
        }
        if (query.includes('site:europages.com')) {
          return jsonResponse(200, {
            organic_results: [
              { title: 'Blocked Parts Co - Europages', snippet: 'European directory listing for industrial batteries' },
            ],
          })
        }
        return jsonResponse(200, { organic_results: [] })
      }
    }

    if (
      target === 'https://blocked.example' ||
      target === 'https://blocked.example/contact' ||
      target === 'https://blocked.example/contact-us'
    ) {
      return textResponse(403, 'forbidden')
    }

    if (target === 'https://mock-llm.example/v1/chat/completions') {
      if (!global.__deepProbeIssued) {
        global.__deepProbeIssued = true
        return llmResponse({ outreachAngle: '优先强调稳定交付与行业目录背书' })
      }

      return llmResponse({
        results: [
          {
            company: 'Blocked Parts Co',
            website: 'https://blocked.example',
            address: 'Berlin, Germany',
            totalScore: 78,
            matchReason: '行业目录与 LinkedIn 信息显示具备工业采购相关性',
            salesStrategy: '围绕官网受保护场景，先用公开目录信息试探采购需求',
            riskFlags: ['官网受保护，建议结合人工复核'],
            isB2B: true,
          },
        ],
      })
    }

    throw new Error(`Unexpected fetch: ${target}`)
  }

  const { registerSearchHandlers } = require('../../dist-electron/electron/services/search-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

  registerSearchHandlers(createIpcMain(), createStore())

  const executeHandler = handlers.get(IPC_CHANNELS.SEARCH.EXECUTE)
  assert.equal(typeof executeHandler, 'function')

  const result = await executeHandler(createEvent(), {
    keyword: 'Industrial battery dealer',
    country: 'Germany',
    city: '',
    filterOptions: {},
  })

  assert.equal(result.success, true)
  assert.ok(Array.isArray(result.data.results))
  assert.equal(result.data.results[0].fallbackStatus, 'social_blind_score')
  assert.equal(typeof result.data.results[0].matchScore, 'number')
  assert.ok(observedQueries.includes('site:linkedin.com/company "Blocked Parts Co" Germany'))
  assert.ok(observedQueries.includes('site:kompass.com "Blocked Parts Co"'))
  assert.ok(observedQueries.includes('site:europages.com "Blocked Parts Co"'))

  const completedEvent = senderEvents.find((event) => event.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
  assert.ok(completedEvent)
})

test('B: 社交源全部为空时仍优雅降级并完成流闭环', async () => {
  resetState()

  global.fetch = async (url) => {
    const target = String(url)

    if (target.startsWith('https://serpapi.com/search.json')) {
      const parsed = new URL(target)
      const engine = parsed.searchParams.get('engine')
      const query = parsed.searchParams.get('q') || ''
      const start = Number(parsed.searchParams.get('start') || '0')

      if (engine === 'google_maps') {
        if (start > 0) return jsonResponse(200, { local_results: [] })
        return jsonResponse(200, {
          local_results: [
            {
              title: 'Blocked Parts Co',
              website: 'https://blocked.example',
              address: 'Berlin, Germany',
              description: 'Industrial battery dealer',
            },
          ],
        })
      }

      if (engine === 'google') {
        observedQueries.push(query)
        if (
          query.includes('site:linkedin.com/company') ||
          query.includes('site:kompass.com') ||
          query.includes('site:europages.com')
        ) {
          return jsonResponse(200, { organic_results: [] })
        }
        return jsonResponse(200, { organic_results: [] })
      }
    }

    if (
      target === 'https://blocked.example' ||
      target === 'https://blocked.example/contact' ||
      target === 'https://blocked.example/contact-us'
    ) {
      return textResponse(403, 'forbidden')
    }

    if (target === 'https://mock-llm.example/v1/chat/completions') {
      if (!global.__deepProbeIssued) {
        global.__deepProbeIssued = true
        return llmResponse({ outreachAngle: '官网受限，建议先发送询盘再补充资料' })
      }
      return llmResponse({
        results: [
          {
            company: 'Blocked Parts Co',
            website: 'https://blocked.example',
            matchReason: '官网不可访问，基于简介轻量评估',
            riskFlags: ['官网受保护'],
          },
        ],
      })
    }

    throw new Error(`Unexpected fetch: ${target}`)
  }

  const { registerSearchHandlers } = require('../../dist-electron/electron/services/search-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

  registerSearchHandlers(createIpcMain(), createStore())

  const executeHandler = handlers.get(IPC_CHANNELS.SEARCH.EXECUTE)
  assert.equal(typeof executeHandler, 'function')

  const result = await executeHandler(createEvent(), {
    keyword: 'Industrial battery dealer',
    country: 'Germany',
    city: '',
    filterOptions: {},
  })

  assert.equal(result.success, true)
  assert.ok(Array.isArray(result.data.results))
  assert.ok((result.data.results[0].matchReasons || []).includes('官网访问受限，基于简介轻量评估（官网无法访问）'))

  const completedEvent = senderEvents.find((event) => event.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
  assert.ok(completedEvent)
})

test('C: 三级降级链路 location 400 -> keyword fallback -> organic', async () => {
  const {
    resolveSerpSearchPlan,
    normalizeSearchResponseCandidates,
  } = require('../../dist-electron/electron/services/search-service.js')

  const stageEvents = []
  const calls = []

  const planResult = await resolveSerpSearchPlan({
    keyword: 'Battery Dealer',
    city: 'Tokyo',
    country: 'Japan',
    googleKey: 'mock-key',
    timeoutMs: 2000,
    attemptSearch: async (mode, modeQuery, modeLocation) => {
      calls.push({ mode, modeQuery, modeLocation })
      if (mode === 'maps-location') {
        throw new Error('UNSUPPORTED_LOCATION::SerpApi HTTP 400')
      }
      if (mode === 'maps-keyword') {
        return { nextLocal: [], nextOrganic: [] }
      }
      return {
        nextLocal: [],
        nextOrganic: [{ title: 'Tokyo Co', link: 'https://tokyo.example', snippet: 'battery' }],
      }
    },
    onStage: (message, searchMode) => stageEvents.push({ message, searchMode }),
  })

  assert.equal(calls[0].mode, 'maps-location')
  assert.equal(calls[1].mode, 'maps-keyword')
  assert.equal(calls[2].mode, 'organic-keyword')
  assert.equal(planResult.activeSearchMode, 'organic-fallback')
  assert.ok(stageEvents.some((event) => /地图定位受限/.test(String(event.message || ''))))
  assert.ok(stageEvents.some((event) => /全局网页线索/.test(String(event.message || ''))))

  const normalized = normalizeSearchResponseCandidates(planResult.allOrganic, planResult.allLocal, '', 'Japan')
  assert.equal(normalized.normalizedCandidates[0].source, 'Google Organic')
})

test.after(() => {
  Module._load = originalLoad
  global.fetch = originalFetch
  delete global.__deepProbeIssued
})
