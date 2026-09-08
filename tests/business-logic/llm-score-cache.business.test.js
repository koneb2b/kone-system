const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P0 成本优化（第二阶段）：LLM 评分缓存专项测试。
// 验证：
// 1) 缓存 key 三元组语义：ICP/关键词/公司 任一变化 → key 不同（不复用旧评分）
// 2) 命中返回深拷贝、TTL 24h、FIFO 上限、绝不落盘
// 3) 评分循环接线：缓存命中时零 LLM 网络请求，且进度事件照常推进

const { withModuleMocks, resetModule } = require('./helpers.js')

const cacheModule = () => require('../../dist-electron/electron/services/llm-score-cache.js')
const searchServicePath = path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'search-service.js')

test('P0-LLM缓存: ICP/关键词/公司三元组任一变化即换 key', async () => {
  const cache = cacheModule()
  cache.clearLlmScoreCache()

  const lead = { company: 'Golf Cart Co', website: 'https://golfcart.example', address: 'TX' }
  const icp = {
    targetProduct: 'golf cart battery',
    buyerPersona: 'dealer',
    coreAdvantage: 'wholesale',
    negativeIcp: '',
  }
  const keyBase = cache.buildLlmScoreCacheKey(icp, 'golf cart battery dealer', lead)

  // 相同输入 → 相同 key
  assert.equal(cache.buildLlmScoreCacheKey(icp, 'golf cart battery dealer', lead), keyBase)

  // ICP 变化 → 换 key
  const icpChanged = { ...icp, coreAdvantage: 'factory-direct' }
  assert.notEqual(cache.buildLlmScoreCacheKey(icpChanged, 'golf cart battery dealer', lead), keyBase)

  // 关键词变化 → 换 key
  assert.notEqual(cache.buildLlmScoreCacheKey(icp, 'golf cart wholesaler', lead), keyBase)

  // 公司变化（不同 domain）→ 换 key
  const otherLead = { company: 'Golf Cart Co', website: 'https://other.example', address: 'TX' }
  assert.notEqual(cache.buildLlmScoreCacheKey(icp, 'golf cart battery dealer', otherLead), keyBase)

  cache.clearLlmScoreCache()
})

test('P0-LLM缓存: 写入/命中/深拷贝隔离', async () => {
  const cache = cacheModule()
  cache.clearLlmScoreCache()

  const lead = { company: 'ACME', website: 'https://acme.example' }
  const key = cache.buildLlmScoreCacheKey(undefined, 'battery importer', lead)
  cache.setLlmScoreCached(key, [
    { matchScore: 88, matchReasons: ['x'], company: 'ACME', website: 'https://acme.example' },
  ])

  const hit = cache.getLlmScoreCached(key)
  assert.ok(Array.isArray(hit), '命中返回数组')
  assert.equal(hit[0].matchScore, 88)
  assert.equal(cache.getLlmScoreCacheStats().hits, 1)

  // 深拷贝隔离：改写命中值不污染缓存
  hit[0].matchScore = 0
  const second = cache.getLlmScoreCached(key)
  assert.equal(second[0].matchScore, 88, '命中返回深拷贝，改写不得污染缓存')

  cache.clearLlmScoreCache()
})

test('P0-LLM缓存: ICP 空与有值不共用缓存（空 ICP 为独立 key）', async () => {
  const cache = cacheModule()
  cache.clearLlmScoreCache()

  const lead = { company: 'Beta Co', website: 'https://beta.example' }
  const emptyKey = cache.buildLlmScoreCacheKey(undefined, 'keyword', lead)
  const filledKey = cache.buildLlmScoreCacheKey({ targetProduct: 'x' }, 'keyword', lead)
  assert.notEqual(emptyKey, filledKey, '空 ICP 与有 ICP 不得复用同一评分')
  cache.clearLlmScoreCache()
})

test('P0-LLM缓存: TTL 常量为 24h，FIFO 上限 500', async () => {
  const cache = cacheModule()
  const fs = require('node:fs')
  const src = fs.readFileSync('electron/services/llm-score-cache.ts', 'utf8')
  assert.match(src, /CACHE_TTL_MS = 24 \* 60 \* 60 \* 1000/, 'TTL 应为 24h')
  assert.match(src, /CACHE_MAX_ENTRIES = 500/, '容量上限 500')
  // 绝不落盘：无 fs 写入 API 调用
  assert.doesNotMatch(src, /writeFile|writeFileSync|createWriteStream/, '缓存不得落盘')
})

test('P0-LLM缓存: 评分循环命中缓存时评分 LLM 调用减少且进度事件照常推进', async () => {
  const cache = cacheModule()
  cache.clearLlmScoreCache()

  // 按消息内容区分调用类型：解构(#0 keyword+country)、评分(scoringKeyword)、深探(company+websiteText)
  const scoringPrompts = []
  let scoredEvents = 0
  const senderEvents = []
  const handlers = new Map()

  global.fetch = async (url, options) => {
    const target = String(url)
    if (target.startsWith('https://serpapi.com/search.json')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            local_results: [
              { title: 'Golf Cart Co', website: 'https://golfcart.example', address: 'TX', description: 'dealer' },
            ],
          }),
      }
    }
    if (target === 'https://mock-llm.example/v1/chat/completions') {
      let body
      try {
        body = JSON.parse(String(options.body || '{}'))
      } catch {
        body = {}
      }
      const userContent = body.messages && body.messages[1] ? String(body.messages[1].content) : ''
      // 评分 prompt 以 {"keyword":"<scoringKeyword>"} 开头（含 icpProfile），
      // 与解构(仅 keyword/country/city)和深探(company/websiteText) 可区分
      if (userContent.includes('icpProfile')) {
        scoringPrompts.push(userContent)
      }
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  { company: 'Golf Cart Co', website: 'https://golfcart.example', matchScore: 90, matchReason: 'OK' },
                ],
              }),
            },
          },
        ],
      }
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      }
    }
    if (target === 'https://golfcart.example' || target === 'https://golfcart.example/contact') {
      return { ok: false, status: 403, text: async () => 'forbidden' }
    }
    throw new Error(`Unexpected fetch: ${target}`)
  }

  const electronMock = {
    app: { isPackaged: false, name: 'Kone AI', getPath: () => path.join(process.cwd(), '.tmp-llm-cache-test') },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (buffer) => buffer.toString('utf8'),
    },
  }
  const secretManagerMock = {
    getSecret(key) {
      if (/google-leads/i.test(String(key || ''))) return 'mock-key'
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

  const originalLoad = require('node:module')._load
  require('node:module')._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock
    if (request === './secret-manager' && parent && /search-service\.js$/.test(parent.filename)) {
      return secretManagerMock
    }
    if (request === './secret-manager' && parent && /config-service\.js$/.test(parent.filename)) {
      return secretManagerMock
    }
    if (request === './license-service' && parent && /search-service\.js$/.test(parent.filename)) {
      return licenseServiceMock
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    resetModule(searchServicePath)
    const { registerSearchHandlers } = require(searchServicePath)
    const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

    const ipcMain = {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    }
    const storeValues = {
      user_config: {
        providers: [
          { id: 'google-leads', baseUrl: 'https://serpapi.com' },
          { id: 'llm', baseUrl: 'https://mock-llm.example/v1' },
        ],
        selectedModel: 'gpt-4o-mini',
        icpProfile: {
          targetProduct: 'golf cart battery',
          buyerPersona: 'dealer',
          coreAdvantage: 'wholesale',
          negativeIcp: '',
        },
      },
    }
    registerSearchHandlers(ipcMain, {
      values: storeValues,
      get(key) {
        return this.values[key]
      },
      set(key, value) {
        this.values[key] = value
      },
    })

    const executeHandler = handlers.get(IPC_CHANNELS.SEARCH.EXECUTE)
    const runSearch = async () =>
      executeHandler(
        {
          sender: {
            send(channel, payload) {
              senderEvents.push({ channel, payload })
              if (channel === IPC_CHANNELS.SEARCH.LEAD_SCORED) scoredEvents += 1
            },
          },
        },
        { keyword: 'Golf Cart Co', country: 'USA', city: '', filterOptions: {} },
      )

    // 第一次搜索：真实调用 LLM 评分（评分 prompt ≥1 次）
    cache.clearLlmScoreCache()
    const first = await runSearch()
    assert.equal(first.success, true)
    const firstScoringCount = scoringPrompts.length
    assert.ok(firstScoringCount >= 1, '首次搜索应真实调用 LLM 评分')

    // 第二次搜索（同 ICP/关键词/公司）：命中缓存，评分 prompt 调用数不增加
    const second = await runSearch()
    assert.equal(second.success, true)
    assert.equal(scoringPrompts.length, firstScoringCount, '第二次搜索命中缓存，零新增评分调用')
    assert.ok(scoredEvents >= 2, '两次搜索的评分进度事件均照常推进（用户体验不受影响）')
  } finally {
    require('node:module')._load = originalLoad
    global.fetch = undefined
    cache.clearLlmScoreCache()
  }
})
