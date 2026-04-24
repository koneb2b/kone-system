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
  if (request === './secret-manager' && parent && /electron[\\/]services[\\/]search-service\.js$/.test(parent.filename)) {
    return secretManagerMock
  }
  if (request === './secret-manager' && parent && /electron[\\/]services[\\/]config-service\.js$/.test(parent.filename)) {
    return secretManagerMock
  }
  if (request === './license-service' && parent && /electron[\\/]services[\\/]search-service\.js$/.test(parent.filename)) {
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

const llmResponse = (payload) => jsonResponse(200, {
  choices: [{ message: { content: JSON.stringify(payload) } }],
})

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
          organic_results: [
            { title: 'Blocked Parts Co - Kompass', snippet: 'B2B industrial supplier profile' },
          ],
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

  if (target === 'https://blocked.example' || target === 'https://blocked.example/contact' || target === 'https://blocked.example/contact-us') {
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

test('403 多源降级会触发 LinkedIn/Kompass/Europages 查询并返回 social_blind_score', async () => {
  global.__deepProbeIssued = false
  observedQueries.length = 0
  senderEvents.length = 0
  handlers.clear()

  const { registerSearchHandlers } = require('../../dist-electron/electron/services/search-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

  const store = {
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
  }

  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
  }

  registerSearchHandlers(ipcMain, store)

  const executeHandler = handlers.get(IPC_CHANNELS.SEARCH.EXECUTE)
  assert.equal(typeof executeHandler, 'function')

  const result = await executeHandler({
    sender: {
      send(channel, payload) {
        senderEvents.push({ channel, payload })
      },
    },
  }, {
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

test.after(() => {
  Module._load = originalLoad
  global.fetch = originalFetch
  delete global.__deepProbeIssued
})
