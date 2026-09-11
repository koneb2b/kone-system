const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { URL } = require('node:url')

const originalLoad = Module._load
const originalFetch = global.fetch

const handlers = new Map()
const senderEvents = []

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
    // 保持 LLM 密钥为空，走“仅基础结果”路径，聚焦 Scout 预筛行为
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
  if (request === './secret-manager' && parent && /electron[\\/]services[\\/](search-service|config-service)\.js$/.test(parent.filename)) {
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

const createStore = () => ({
  values: {
    user_config: {
      providers: [
        { id: 'google-leads', baseUrl: 'https://serpapi.com' },
      ],
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
  senderEvents.length = 0
  handlers.clear()
}

const CANDIDATES = [
  {
    title: 'Munich Battery Systems GmbH',
    website: 'https://munich-batteries.de',
    address: 'Munich, Germany',
    description: 'Industrial battery distributor and OEM supplier',
  },
  {
    title: 'Auto Service Max',
    website: 'https://autoservicemax.com',
    address: 'Hamburg, Germany',
    description: 'car wash tire service body shop',
  },
  {
    title: 'Central Cafe Berlin',
    website: 'https://centralcafe.de',
    address: 'Berlin, Germany',
    description: 'coffee shop and bakery',
  },
  {
    title: 'Battery Trade Professional',
    website: 'https://www.linkedin.com/company/battery-trade',
    address: 'Berlin, Germany',
    description: 'Industrial battery distributor listing',
  },
  {
    title: 'Stuttgart Power Batterie Handel',
    website: 'https://stuttgart-batterie.de',
    address: 'Stuttgart, Germany',
    description: 'Industrial battery wholesaler for retail and fleet',
  },
]

const mockFetch = async (url) => {
  const target = String(url)
  if (target.startsWith('https://serpapi.com/search.json')) {
    const parsed = new URL(target)
    const start = Number(parsed.searchParams.get('start') || '0')
    if (parsed.searchParams.get('engine') === 'google_maps') {
      if (start > 0) return jsonResponse(200, { local_results: [] })
      return jsonResponse(200, { local_results: CANDIDATES })
    }
    return jsonResponse(200, { organic_results: [] })
  }
  throw new Error(`Unexpected fetch: ${target}`)
}

const executeSearch = async (filterOptions) => {
  const { registerSearchHandlers } = require('../../dist-electron/electron/services/search-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')
  registerSearchHandlers(createIpcMain(), createStore())
  const executeHandler = handlers.get(IPC_CHANNELS.SEARCH.EXECUTE)
  assert.equal(typeof executeHandler, 'function')
  const result = await executeHandler(createEvent(), {
    keyword: 'Industrial battery distributor',
    country: 'Germany',
    city: '',
    filterOptions,
  })
  assert.equal(result.success, true)
  const basicEvent = senderEvents.find((event) => event.channel === IPC_CHANNELS.SEARCH.BASIC_RESULTS)
  assert.ok(basicEvent, 'basic results event must be emitted')
  const completedEvent = senderEvents.find((event) => event.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
  assert.ok(completedEvent, 'stream must end with complete closure')
  return basicEvent.payload
}

test('A: Scout 预筛剔除汽修类噪声候选（强制前置漏斗）', async () => {
  resetState()
  global.fetch = mockFetch

  const payload = await executeSearch({})
  const companies = payload.map((item) => item.company)

  assert.ok(!companies.includes('Auto Service Max'), '汽修类噪声必须在 Scout 阶段被剔除')
  assert.ok(companies.includes('Munich Battery Systems GmbH'), '高相关 B2B 候选必须保留')
  assert.ok(companies.includes('Central Cafe Berlin'), '默认规则下弱相关候选保留，交由评分环节处理')
})

test('B: 只看高相关开关在 Scout 阶段剔除零信号候选', async () => {
  resetState()
  global.fetch = mockFetch

  const payload = await executeSearch({ highRelevanceOnly: true })
  const companies = payload.map((item) => item.company)

  assert.ok(!companies.includes('Central Cafe Berlin'), '零关键词信号且零 B2B 信号的候选必须被剔除')
  assert.ok(companies.includes('Munich Battery Systems GmbH'), '含正向信号的候选必须保留')
})

test('C: 优先本土域名开关将本土官网排在聚合平台之前', async () => {
  resetState()
  global.fetch = mockFetch

  const payload = await executeSearch({ localDomainOnly: true })
  const companies = payload.map((item) => item.company)

  assert.ok(companies.includes('Munich Battery Systems GmbH'))
  assert.ok(companies.includes('Battery Trade Professional'), '聚合平台候选默认不剔除，仅降位')

  const localIndex = companies.indexOf('Stuttgart Power Batterie Handel')
  const aggregatorIndex = companies.indexOf('Battery Trade Professional')
  assert.ok(localIndex >= 0, '本土域名候选必须保留')
  assert.ok(localIndex < aggregatorIndex, '本土官网必须排在 LinkedIn 等聚合平台之前')
})
