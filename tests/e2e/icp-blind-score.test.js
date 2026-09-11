const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { URL } = require('node:url')

const originalLoad = Module._load
const originalFetch = global.fetch

const handlers = new Map()
const senderEvents = []

const BLIND_SCORE_LABEL = '官网访问受限，基于简介轻量评估（官网无法访问）'

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

const parseLlmUserPayload = (options) => {
  try {
    const body = JSON.parse(String(options?.body || '{}'))
    const userContent = body?.messages?.[1]?.content || '{}'
    return JSON.parse(String(userContent || '{}'))
  } catch {
    return {}
  }
}

const singleCandidateMaps = (website, snippet = 'Industrial battery distributor') => ({
  local_results: [
    {
      title: 'Target Battery Co',
      website,
      address: 'Berlin, Germany',
      description: snippet,
    },
  ],
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
        targetProduct: 'Industrial battery',
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

const executeSearch = async (payload) => {
  senderEvents.length = 0
  handlers.clear()

  const { registerSearchHandlers } = require('../../dist-electron/electron/services/search-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

  const store = createStore()
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
      send(channel, eventPayload) {
        senderEvents.push({ channel, payload: eventPayload })
      },
    },
  }, {
    keyword: payload.keyword || 'Industrial battery dealer',
    country: payload.country || 'Germany',
    city: payload.city || '',
    filterOptions: {},
  })

  return { result, IPC_CHANNELS }
}

const createScenario = (overrides = {}) => ({
  serpApi(target) {
    const parsed = new URL(target)
    const engine = parsed.searchParams.get('engine')
    const start = Number(parsed.searchParams.get('start') || '0')

    if (engine === 'google_maps') {
      if (start > 0) return jsonResponse(200, { local_results: [] })
      return jsonResponse(200, singleCandidateMaps('https://target.example', 'Industrial battery distributor'))
    }

    if (engine === 'google') return jsonResponse(200, { organic_results: [] })

    throw new Error(`Unexpected SerpApi engine: ${engine || ''}`)
  },
  website(target) {
    if (target === 'https://target.example' || target === 'https://target.example/contact' || target === 'https://target.example/contact-us') {
      throw new Error('network timeout')
    }
    throw new Error(`Unexpected website target: ${target}`)
  },
  llm(options) {
    const userPayload = parseLlmUserPayload(options)

    if (userPayload && userPayload.mode === 'snippet_fallback') {
      return llmResponse({
        results: [{
          company: 'Target Battery Co',
          website: 'https://target.example',
          totalScore: 76,
          matchReason: '简介显示工业电池分销角色明确',
          salesStrategy: '先沟通交付稳定性与供货节奏',
          riskFlags: ['官网访问受限，建议人工复核'],
          isB2B: true,
        }],
      })
    }

    if (Object.prototype.hasOwnProperty.call(userPayload || {}, 'websiteText')) {
      return llmResponse({ outreachAngle: '围绕稳定交付切入首轮沟通' })
    }

    return llmResponse({
      results: [{
        company: 'Target Battery Co',
        website: 'https://target.example',
        totalScore: 74,
        matchReason: '初步信息符合工业电池分销画像',
        salesStrategy: '优先询问采购频次与品牌偏好',
        riskFlags: [],
        isB2B: true,
      }],
    })
  },
  ...overrides,
})

global.fetch = async (url, options) => {
  const target = String(url)
  const scenario = global.__scenario

  if (!scenario) throw new Error('Scenario not configured')

  if (target.startsWith('https://serpapi.com/search.json')) {
    return scenario.serpApi(target, options)
  }

  if (target === 'https://mock-llm.example/v1/chat/completions') {
    return scenario.llm(options)
  }

  if (target.startsWith('https://')) {
    return scenario.website(target, options)
  }

  throw new Error(`Unexpected fetch: ${target}`)
}

test('Scenario A: 官网超时触发 snippet 盲评并完成流式闭环', async () => {
  global.__scenario = createScenario()

  const { result, IPC_CHANNELS } = await executeSearch({ keyword: 'Industrial battery dealer' })

  assert.equal(result.success, true)
  assert.equal(typeof result.data.results[0].matchScore, 'number')
  assert.equal(result.data.results[0].fallbackStatus, undefined)
  assert.ok(Array.isArray(result.data.results[0].matchReasons))
  assert.ok(result.data.results[0].matchReasons.includes(BLIND_SCORE_LABEL))

  const completedEvent = senderEvents.find((event) => event.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
  assert.ok(completedEvent)
})

test('Scenario B: 官网 DNS 失败触发盲评且带有风险提示', async () => {
  global.__scenario = createScenario({
    website(target) {
      if (target === 'https://target.example' || target === 'https://target.example/contact' || target === 'https://target.example/contact-us') {
        throw new Error('getaddrinfo ENOTFOUND target.example')
      }
      throw new Error(`Unexpected website target: ${target}`)
    },
  })

  const { result, IPC_CHANNELS } = await executeSearch({ keyword: 'Industrial battery dealer' })

  assert.equal(result.success, true)
  assert.equal(typeof result.data.results[0].matchScore, 'number')
  assert.ok(Array.isArray(result.data.results[0].riskFlags))
  assert.ok(result.data.results[0].riskFlags.length > 0)

  const completedEvent = senderEvents.find((event) => event.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
  assert.ok(completedEvent)
})

test('Scenario C: 官网返回空白 HTML 时系统不崩溃且能完成', async () => {
  global.__scenario = createScenario({
    website(target) {
      if (target === 'https://target.example' || target === 'https://target.example/contact' || target === 'https://target.example/contact-us') {
        return textResponse(200, '<html><body></body></html>')
      }
      throw new Error(`Unexpected website target: ${target}`)
    },
  })

  const { result, IPC_CHANNELS } = await executeSearch({ keyword: 'Industrial battery dealer' })

  assert.equal(result.success, true)
  const completedEvent = senderEvents.find((event) => event.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
  assert.ok(completedEvent)
})

test('Scenario D: snippet 为空且官网失败时不应死锁或抛未捕获异常', async () => {
  global.__scenario = createScenario({
    serpApi(target) {
      const parsed = new URL(target)
      const engine = parsed.searchParams.get('engine')
      const start = Number(parsed.searchParams.get('start') || '0')

      if (engine === 'google_maps') {
        if (start > 0) return jsonResponse(200, { local_results: [] })
        return jsonResponse(200, singleCandidateMaps('https://target.example', ''))
      }

      if (engine === 'google') return jsonResponse(200, { organic_results: [] })

      throw new Error(`Unexpected SerpApi engine: ${engine || ''}`)
    },
    website(target) {
      if (target === 'https://target.example' || target === 'https://target.example/contact' || target === 'https://target.example/contact-us') {
        throw new Error('network timeout')
      }
      throw new Error(`Unexpected website target: ${target}`)
    },
    llm(options) {
      const userPayload = parseLlmUserPayload(options)
      if (userPayload && userPayload.mode === 'snippet_fallback') {
        return llmResponse({
          results: [{
            company: 'Target Battery Co',
            website: 'https://target.example',
            matchReason: '信息不足，保留人工判断空间',
            riskFlags: ['官网访问受限，建议人工复核'],
            isB2B: true,
          }],
        })
      }
      if (Object.prototype.hasOwnProperty.call(userPayload || {}, 'websiteText')) {
        return llmResponse({ outreachAngle: '' })
      }
      return llmResponse({
        results: [{
          company: 'Target Battery Co',
          website: 'https://target.example',
          matchReason: '基础信息不足，暂不输出分数',
          riskFlags: ['官网访问受限，建议人工复核'],
          isB2B: true,
        }],
      })
    },
  })

  const { result, IPC_CHANNELS } = await executeSearch({ keyword: 'Industrial battery dealer' })

  assert.equal(result.success, true)
  const completedEvent = senderEvents.find((event) => event.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
  assert.ok(completedEvent)
})

test('Scenario E: 正常评分与盲评并存时两条候选均应返回', async () => {
  global.__scenario = createScenario({
    serpApi(target) {
      const parsed = new URL(target)
      const engine = parsed.searchParams.get('engine')
      const start = Number(parsed.searchParams.get('start') || '0')

      if (engine === 'google_maps') {
        if (start > 0) return jsonResponse(200, { local_results: [] })
        return jsonResponse(200, {
          local_results: [
            {
              title: 'Good Power GmbH',
              website: 'https://good.example',
              address: 'Berlin, Germany',
              description: 'Industrial battery wholesaler',
            },
            {
              title: 'Bad Battery Ltd',
              website: 'https://bad.example',
              address: 'Munich, Germany',
              description: 'Industrial battery distributor',
            },
          ],
        })
      }

      if (engine === 'google') return jsonResponse(200, { organic_results: [] })

      throw new Error(`Unexpected SerpApi engine: ${engine || ''}`)
    },
    website(target) {
      if (target === 'https://good.example' || target === 'https://good.example/contact' || target === 'https://good.example/contact-us') {
        return textResponse(200, '<html><head><title>Good Power GmbH</title></head><body>Industrial battery OEM and distributor contact sales@good.example</body></html>')
      }
      if (target === 'https://bad.example' || target === 'https://bad.example/contact' || target === 'https://bad.example/contact-us') {
        throw new Error('network timeout')
      }
      throw new Error(`Unexpected website target: ${target}`)
    },
    llm(options) {
      const userPayload = parseLlmUserPayload(options)

      if (userPayload && userPayload.mode === 'snippet_fallback') {
        return llmResponse({
          results: [{
            company: 'Bad Battery Ltd',
            website: 'https://bad.example',
            totalScore: 65,
            matchReason: '仅基于简介进行轻量判断',
            salesStrategy: '先小样测试后放量',
            riskFlags: ['官网访问受限，建议人工复核'],
            isB2B: true,
          }],
        })
      }

      if (Object.prototype.hasOwnProperty.call(userPayload || {}, 'websiteText')) {
        return llmResponse({ outreachAngle: '优先强调供货稳定和质保承诺' })
      }

      return llmResponse({
        results: [
          {
            company: 'Good Power GmbH',
            website: 'https://good.example',
            totalScore: 88,
            matchReason: '官网与简介均显示工业电池 B2B 供货能力',
            salesStrategy: '围绕 OEM 与交付 SLA 推进首轮沟通',
            riskFlags: [],
            isB2B: true,
          },
          {
            company: 'Bad Battery Ltd',
            website: 'https://bad.example',
            totalScore: 63,
            matchReason: '基础信息有分销信号，但需官网复核',
            salesStrategy: '先确认采购周期与最小起订量',
            riskFlags: ['官网访问受限，建议人工复核'],
            isB2B: true,
          },
        ],
      })
    },
  })

  const { result, IPC_CHANNELS } = await executeSearch({ keyword: 'Industrial battery dealer' })

  assert.equal(result.success, true)
  assert.equal(result.data.results.length, 2)

  const good = result.data.results.find((item) => item.website === 'https://good.example')
  const bad = result.data.results.find((item) => item.website === 'https://bad.example')

  assert.ok(good)
  assert.equal(typeof good.matchScore, 'number')
  assert.ok(bad)
  assert.ok(typeof bad.matchScore === 'number' || Array.isArray(bad.riskFlags))

  const completedEvent = senderEvents.find((event) => event.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
  assert.ok(completedEvent)
})

test.after(() => {
  Module._load = originalLoad
  global.fetch = originalFetch
  delete global.__scenario
})
