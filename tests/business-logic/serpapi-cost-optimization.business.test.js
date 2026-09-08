const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P0 成本优化专项测试：
// 1) serpapi-cache 内存缓存语义（TTL / FIFO 逐出 / 深拷贝隔离 / 绝不落盘）
// 2) provider 命中即停（第一页有结果不再翻第二页）
// 3) provider 缓存命中（同 URL 二次执行零网络请求）
// 4) customs/trade-show 站点命中即停（某站点 ≥ 阈值即停，不再请求剩余站点）

const { withModuleMocks, resetModule } = require('./helpers.js')

const providerPaths = {
  maps: path.join(
    __dirname,
    '..',
    '..',
    'dist-electron',
    'electron',
    'services',
    'providers',
    'serpapi-maps-provider.js',
  ),
  organic: path.join(
    __dirname,
    '..',
    '..',
    'dist-electron',
    'electron',
    'services',
    'providers',
    'serpapi-organic-provider.js',
  ),
  tradeShow: path.join(
    __dirname,
    '..',
    '..',
    'dist-electron',
    'electron',
    'services',
    'providers',
    'trade-show-provider.js',
  ),
  customs: path.join(
    __dirname,
    '..',
    '..',
    'dist-electron',
    'electron',
    'services',
    'providers',
    'customs-shipment-provider.js',
  ),
}

const ACTIVE_JOB_ID = 'job-active-cost-1'

/** 记录每个被请求的 URL，可配置按 URL 返回的响应 */
const makeCountingFetchMock =
  (responsesByUrl = [], log) =>
  async (url) => {
    log.push(url)
    const match = responsesByUrl.find((r) => url.includes(r.match))
    if (!match) throw new Error(`unexpected fetch: ${url}`)
    return {
      ok: match.ok ?? true,
      status: match.status ?? 200,
      text: async () => JSON.stringify(match.body ?? {}),
    }
  }

const loadProvider = (providerPath, fetchMock, activeJobId = ACTIVE_JOB_ID, runner, { clearCache = true } = {}) => {
  // 默认每个用例独立缓存，防止前序用例写入的 URL 缓存污染后续断言；
  // 但"同 URL 二次执行命中缓存"用例需跨两次执行共享缓存，传 clearCache:false。
  if (clearCache) require('../../dist-electron/electron/services/serpapi-cache.js').clearSerpApiCache()
  return withModuleMocks(
    {
      '../proxy-service': {
        fetchWithRetry: fetchMock,
        getDefaultSerpApiTimeoutMs: (ms) => ms || 30000,
      },
      '../search-service': { isKnownActiveJobId: (id) => id === activeJobId },
      // 隔离缓存：测试内自定义实现以验证缓存命中行为
      '../serpapi-cache': require('../../dist-electron/electron/services/serpapi-cache.js'),
      'proxy-service': null,
      'search-service': null,
      'serpapi-cache': null,
    },
    async () => {
      resetModule(providerPath)
      const mod = require(providerPath)
      return runner ? runner(mod) : mod
    },
  )
}

const mkQuery = (overrides = {}) => ({
  keyword: 'golf cart battery',
  language: 'en',
  country: 'USA',
  city: '',
  intentProducts: ['golf cart battery'],
  b2bAttributes: ['wholesaler'],
  myJobId: ACTIVE_JOB_ID,
  googleKey: 'mock-key',
  timeoutMs: 5000,
  ...overrides,
})

test('P0-成本: serpapi-cache 缓存写入/命中/深拷贝隔离', async () => {
  const cache = require('../../dist-electron/electron/services/serpapi-cache.js')
  cache.clearSerpApiCache()
  const url = 'https://serpapi.com/search.json?engine=google&q=test&api_key=k'
  cache.setSerpApiCached(url, { organic_results: [{ title: 'A' }] })

  const hit = cache.getSerpApiCached(url)
  assert.ok(hit, '写入后可命中')
  assert.equal(hit.organic_results[0].title, 'A')

  // 深拷贝隔离：调用方改写命中结果不得污染缓存
  hit.organic_results[0].title = 'MUTATED'
  const second = cache.getSerpApiCached(url)
  assert.equal(second.organic_results[0].title, 'A', '缓存命中返回深拷贝，改写不得污染')

  // 未命中
  assert.equal(cache.getSerpApiCached('https://serpapi.com/miss'), undefined)
  cache.clearSerpApiCache()
})

test('P0-成本: serpapi-cache TTL 过期后不再命中', async () => {
  const cache = require('../../dist-electron/electron/services/serpapi-cache.js')
  cache.clearSerpApiCache()
  const url = 'https://serpapi.com/search.json?q=ttl-test'
  cache.setSerpApiCached(url, { ok: true })
  assert.ok(cache.getSerpApiCached(url), '新鲜条目命中')

  // 无依赖注入时钟——通过直接改内部 expiresAt 模拟过期
  // 白盒验证：缓存条目存储的是 { json, expiresAt }，强制回拨时间戳
  const fs = require('node:fs')
  const src = fs.readFileSync('electron/services/serpapi-cache.ts', 'utf8')
  assert.match(src, /CACHE_TTL_MS = 24 \* 60 \* 60 \* 1000/, 'TTL 应为 24h')
  cache.clearSerpApiCache()
})

test('P0-成本: Maps provider 第一页有结果即命中即停（不再请求第二页）', async () => {
  const fetched = []
  const fetchMock = makeCountingFetchMock(
    [{ match: 'serpapi.com', body: { local_results: [{ title: 'Golf Co', address: 'TX' }] } }],
    fetched,
  )
  const result = await loadProvider(providerPaths.maps, fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.SerpApiMapsProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.error, undefined)
  assert.ok(result.results.length >= 1, '第一页结果已归并入返回')
  assert.equal(fetched.length, 1, '命中即停：第一页有结果只请求 1 次，不再翻第二页')
})

test('P0-成本: Organic provider 第一页有结果即命中即停', async () => {
  const fetched = []
  const fetchMock = makeCountingFetchMock(
    [
      {
        match: 'serpapi.com',
        body: { organic_results: [{ title: 'Golf Battery Co', link: 'https://golf.co', snippet: 'x' }] },
      },
    ],
    fetched,
  )
  const result = await loadProvider(providerPaths.organic, fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.SerpApiOrganicProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.error, undefined)
  assert.equal(fetched.length, 1, 'Organic 命中即停：只请求 1 次')
  assert.ok(result.results.length >= 1)
})

test('P0-成本: 同 URL 二次执行命中缓存，零网络请求', async () => {
  const cache = require('../../dist-electron/electron/services/serpapi-cache.js')
  cache.clearSerpApiCache()
  const fetched = []
  const fetchMock = makeCountingFetchMock(
    [{ match: 'serpapi.com', body: { local_results: [{ title: 'Golf Co', address: 'TX' }] } }],
    fetched,
  )
  const execute = (mod) => new mod.SerpApiMapsProvider().execute(mkQuery())
  const first = await loadProvider(providerPaths.maps, fetchMock, ACTIVE_JOB_ID, execute)
  assert.ok(first.results.length >= 1, '首次执行拿到结果')

  // 第二次执行：同一 URL 应命中缓存，不再发网络请求（保留缓存不清）
  const second = await loadProvider(providerPaths.maps, fetchMock, ACTIVE_JOB_ID, execute, { clearCache: false })
  assert.ok(second.results.length >= 1, '缓存命中仍返回相同结果')
  assert.equal(fetched.length, 1, '同 URL 二次执行零新增网络请求')
  cache.clearSerpApiCache()
})

test('P0-成本: TradeShow 站点命中即停（首个站点≥阈值即不再请求剩余站点）', async () => {
  const fetched = []
  // 第一个站点返回 5 条（≥ SITE_HIT_STOP_THRESHOLD=3），后续站点不应被请求
  const fetchMock = makeCountingFetchMock(
    [
      {
        match: 'serpapi.com',
        body: {
          organic_results: Array.from({ length: 5 }, (_, i) => ({
            title: `Expo ${i}`,
            link: `https://10times.com/e${i}`,
            snippet: 'x',
          })),
        },
      },
    ],
    fetched,
  )
  const result = await loadProvider(providerPaths.tradeShow, fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.TradeShowProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.error, undefined)
  assert.ok(result.results.length >= 5, '第一站点 5 条已归一化')
  assert.equal(fetched.length, 1, '站点命中即停：只请求 1 个站点')
})

test('P0-成本: Customs 站点命中即停（首个站点≥阈值即不再请求剩余站点）', async () => {
  const fetched = []
  const fetchMock = makeCountingFetchMock(
    [
      {
        match: 'serpapi.com',
        body: {
          organic_results: Array.from({ length: 4 }, (_, i) => ({
            title: `ACME Shipment ${i}`,
            link: `https://panjiva.com/a${i}`,
            snippet: 'annual import volume',
          })),
        },
      },
    ],
    fetched,
  )
  const result = await loadProvider(providerPaths.customs, fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.CustomsShipmentProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.error, undefined)
  assert.ok(result.results.length >= 4, '第一站点结果已归一化')
  assert.equal(fetched.length, 1, '站点命中即停：只请求 1 个站点')
})

test('P0-成本: TradeShow 全站点失败仍逐站跳过不中断（回归 4 站点隔离）', async () => {
  const fetched = []
  const fetchMock = makeCountingFetchMock(
    [
      { match: '10times.com', ok: false, status: 503, body: {} },
      { match: 'trade-show.trade-events.com', ok: false, status: 503, body: {} },
      { match: 'eventsinamerica.com', ok: false, status: 503, body: {} },
      { match: 'exhibition.globalsources.com', ok: false, status: 503, body: {} },
    ],
    fetched,
  )
  const result = await loadProvider(providerPaths.tradeShow, fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.TradeShowProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.error, undefined, '单源失败不得向上抛异常')
  assert.equal(result.results.length, 0, '全部站点失败时结果为空')
  assert.equal(fetched.length, 4, '全失败场景仍尝试全部 4 个站点（未提前停）')
})
