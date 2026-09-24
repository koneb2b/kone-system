const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { URL } = require('node:url')

/* 缩短慢源 race 超时：provider mock 永不 settle，避免单测挂 120s 等 race 兜底 */
process.env.KONE_LATE_SOURCE_TIMEOUT_MS = '100'

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

const serpapiCacheMock = {
  getSerpApiCached: () => undefined,
  setSerpApiCached: () => {},
}

Module._load = function mockLoad(request, parent, isMain) {
  if (request === 'electron') return electronMock
  if (
    request === './secret-manager' &&
    parent &&
    /electron[\\/]services[\\/](search-service|config-service)\.js$/.test(parent.filename)
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
  if (
    request === './serpapi-cache' &&
    parent &&
    /electron[\\/]services[\\/]search-service\.js$/.test(parent.filename)
  ) {
    return serpapiCacheMock
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

const parseLlmUserPayload = (options) => {
  try {
    const body = JSON.parse(String(options?.body || '{}'))
    const userContent = body?.messages?.[1]?.content || '{}'
    return JSON.parse(String(userContent || '{}'))
  } catch {
    return {}
  }
}

global.fetch = async (url, options = {}) => {
  const target = String(url)

  if (target.startsWith('https://serpapi.com/search.json')) {
    const parsed = new URL(target)
    const engine = parsed.searchParams.get('engine')
    const start = Number(parsed.searchParams.get('start') || '0')
    if (engine === 'google_maps') {
      if (start > 0) return jsonResponse(200, { local_results: [] })
      return jsonResponse(200, {
        local_results: [
          {
            title: 'Progressive Battery GmbH',
            website: 'https://progressive.example',
            address: 'Berlin, Germany',
            description: 'Industrial battery distributor and OEM supplier',
          },
        ],
      })
    }
    return jsonResponse(200, { organic_results: [] })
  }

  if (target === 'https://mock-llm.example/v1/chat/completions') {
    const userPayload = parseLlmUserPayload(options)
    /* 评分请求（snippet_fallback 盲评或正常评分）：返回含 totalScore 的 results */
    if (userPayload.mode === 'snippet_fallback' || userPayload.candidates || userPayload.keyword) {
      return jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    company: 'Progressive Battery GmbH',
                    website: 'https://progressive.example',
                    totalScore: 82,
                    matchReason: '简介显示工业电池分销角色明确，产品词命中',
                    salesStrategy: '优先沟通交付稳定性与采购频次',
                    riskFlags: [],
                    isB2B: true,
                  },
                ],
              }),
            },
          },
        ],
      })
    }
    /* 富化/开发信请求：返回通用文案 */
    return jsonResponse(200, {
      choices: [{ message: { content: JSON.stringify({ outreachAngle: '围绕稳定交付切入首轮沟通' }) } }],
    })
  }

  /* 官网抓取：触发 snippet 盲评路径（简化测试，避免富化 LLM 二次调用复杂度） */
  if (target.startsWith('https://')) {
    throw new Error('network timeout')
  }

  throw new Error(`Unexpected fetch: ${target}`)
}

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

const executeSearch = async () => {
  senderEvents.length = 0
  handlers.clear()
  try {
    require('../../dist-electron/electron/services/serpapi-cache.js').clearSerpApiCache()
  } catch {
    // dist 未编译时静默跳过
  }

  const { registerSearchHandlers } = require('../../dist-electron/electron/services/search-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

  registerSearchHandlers(
    {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    },
    createStore(),
  )

  const executeHandler = handlers.get(IPC_CHANNELS.SEARCH.EXECUTE)
  assert.equal(typeof executeHandler, 'function')

  const result = await executeHandler(
    {
      sender: {
        send(channel, payload) {
          senderEvents.push({ channel, payload })
        },
      },
    },
    {
      keyword: 'Industrial battery dealer',
      country: 'Germany',
      city: '',
      filterOptions: {},
    },
  )

  return { result, IPC_CHANNELS }
}

test('渐进式双波 emit 语义：首屏 raw(strip score) -> 流式 scored -> 最终 preserveScore 保留分数 -> 单次 complete', async () => {
  const { result, IPC_CHANNELS } = await executeSearch()

  assert.equal(result.success, true, 'search must succeed')

  const basicEvents = senderEvents.filter((e) => e.channel === IPC_CHANNELS.SEARCH.BASIC_RESULTS)
  const scoredEvents = senderEvents.filter((e) => e.channel === IPC_CHANNELS.SEARCH.LEAD_SCORED)
  const completeEvents = senderEvents.filter((e) => e.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)

  // 1. 至少 2 次 emitBasicResults（首屏 raw + 最终合并全量）
  assert.ok(basicEvents.length >= 2, `expected >= 2 BASIC_RESULTS events (raw + final), got ${basicEvents.length}`)

  // 2. 首屏 emit 应剥离 matchScore（raw 候选 = 「待评估」）
  const firstBasic = basicEvents[0].payload
  assert.ok(Array.isArray(firstBasic) && firstBasic.length > 0, 'first basic results must be non-empty array')
  assert.ok(
    firstBasic.every((item) => item.matchScore === undefined),
    'first emit (raw candidates) must strip matchScore to undefined (待评估)',
  )

  // 3. emitLeadScored 应流式回填分数（matchScore 为数字）
  assert.ok(scoredEvents.length > 0, 'emitLeadScored must stream at least one scored lead')
  const scoredLead = scoredEvents[0].payload?.candidate
  assert.ok(
    typeof scoredLead?.matchScore === 'number',
    `streamed lead matchScore must be numeric, got ${typeof scoredLead?.matchScore}`,
  )

  // 4. 最终 emitBasicResults 应保留 matchScore（preserveScore=true — 核心修复）
  //    重构前无评分后 emit（分数由 emitLeadScored 保留）；重构后新增的最终 emit
  //    若不 preserveScore 会冲掉已流式回填的分数，导致「未分析完成」假象。
  const finalBasic = basicEvents[basicEvents.length - 1].payload
  assert.ok(Array.isArray(finalBasic) && finalBasic.length > 0, 'final basic results must be non-empty array')
  assert.ok(
    finalBasic.some((item) => typeof item.matchScore === 'number'),
    'final emit (preserveScore=true) must preserve numeric matchScore — this is the score-wipe fix',
  )

  // 5. emitStreamComplete 只调一次（流式生命周期闭环，禁止静默终止）
  assert.equal(
    completeEvents.length,
    1,
    `stream complete must be emitted exactly once (lifecycle closure), got ${completeEvents.length}`,
  )
})

test.after(() => {
  Module._load = originalLoad
  global.fetch = originalFetch
})
