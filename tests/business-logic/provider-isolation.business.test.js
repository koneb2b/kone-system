const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P3-1 Provider 专项单测（PROVIDER-CAPABILITY 标注待补）：
// 通过 Module._load mock 注入 proxy-service（fetchWithRetry）与 search-service
// （动态导入的时间隔离判断），零网络验证 Provider 的采集归一化与失败隔离。

const { withModuleMocks, resetModule } = require('./helpers.js')

const providerPaths = {
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

const ACTIVE_JOB_ID = 'job-active-1'

const makeFetchMock = (responsesByUrl) => async (url) => {
  const match = responsesByUrl.find((r) => url.includes(r.match))
  if (!match) throw new Error(`unexpected fetch: ${url}`)
  return {
    ok: match.ok ?? true,
    status: match.status ?? 200,
    text: async () => JSON.stringify(match.body ?? {}),
  }
}

const loadProvider = (providerPath, fetchMock, activeJobId = ACTIVE_JOB_ID, runner) =>
  withModuleMocks(
    {
      '../proxy-service': {
        fetchWithRetry: fetchMock,
        getDefaultSerpApiTimeoutMs: (ms) => ms || 30000,
      },
      // Provider 通过 `await import('../search-service')` 做时间隔离判断
      '../search-service': { isKnownActiveJobId: (id) => id === activeJobId },
      // 成本优化（P0）：serpapi-cache 是真实共享单例，测试必须隔离为空缓存，
      // 否则前序测试写入的 URL 缓存会污染后序"非 200 隔离"等断言。
      '../serpapi-cache': {
        getSerpApiCached: () => undefined,
        setSerpApiCached: () => {},
        getSerpApiCacheStats: () => ({ hits: 0, misses: 0, size: 0 }),
        clearSerpApiCache: () => {},
      },
      // 编译产物会 require('proxy-service')（无相对前缀的 CJS 解析）
      'proxy-service': null,
      'search-service': null,
      'serpapi-cache': null,
    },
    async () => {
      resetModule(providerPath)
      const mod = require(providerPath)
      // runner 必须在 mock 作用域内执行：provider.execute 的动态导入发生在调用时
      return runner ? runner(mod) : mod
    },
  )

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

test('P3-1: TradeShowProvider 归一化输出 + 展会足迹提取 + 数据源口径标注', async () => {
  const fetchMock = makeFetchMock([
    {
      match: 'serpapi.com',
      body: {
        organic_results: [
          {
            title: 'Golf Cart Expo 2025 | 10times',
            link: 'https://10times.com/golf-cart-expo',
            snippet: 'The leading golf cart industry exhibition with distributors and dealers.',
          },
        ],
      },
    },
  ])
  const result = await loadProvider(providerPaths.tradeShow, fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.TradeShowProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.error, undefined)
  assert.ok(result.results.length >= 1, '至少归一化一条结果')
  const first = result.results[0]
  assert.equal(first.company.includes('Golf Cart Expo'), true, '公司名清理站点后缀')
  assert.equal(first.dataSourceNote.includes('近似'), true, '必须诚实标注网页近似口径')
  assert.equal(first.source, 'trade_show')
})

test('P3-1: CustomsProvider 非官方库口径诚实标注', async () => {
  const fetchMock = makeFetchMock([
    {
      match: 'serpapi.com',
      body: {
        organic_results: [
          {
            title: 'ACME Trading import records | Panjiva',
            link: 'https://panjiva.com/acme-trading',
            snippet: 'ACME Trading shipment history, annual import volume and suppliers.',
          },
        ],
      },
    },
  ])
  const result = await loadProvider(providerPaths.customs, fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.CustomsShipmentProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.error, undefined)
  assert.ok(result.results.length >= 1)
  const first = result.results[0]
  assert.equal(String(first.dataSourceNote || '').includes('近似'), true, '海关近似口径必须随结果输出')
})

test('P3-1: 陈旧 myJobId 被时间隔离丢弃（返回空结果而非抛异常）', async () => {
  const fetchMock = makeFetchMock([
    { match: 'serpapi.com', body: { organic_results: [{ title: 'X Expo', link: 'https://10times.com/x' }] } },
  ])
  const result = await loadProvider(providerPaths.tradeShow, fetchMock, 'job-stale-999', async (mod) => {
    const provider = new mod.TradeShowProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.results.length, 0, '陈旧 job 结果必须为空')
  assert.match(String(result.error), /Stale job/)
})

test('P3-1: 上游非 200 被隔离跳过，不中断整轮采集', async () => {
  const fetchMock = makeFetchMock([
    { match: 'serpapi.com', ok: false, status: 503, body: {} },
    { match: 'trade-show.trade-events.com', ok: false, status: 503, body: {} },
    { match: 'eventsinamerica.com', ok: false, status: 503, body: {} },
    { match: 'exhibition.globalsources.com', ok: false, status: 503, body: {} },
  ])
  const result = await loadProvider(providerPaths.tradeShow, fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.TradeShowProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.error, undefined, '单源失败不得向上抛异常')
  assert.equal(result.results.length, 0, '全部源失败时结果为空')
})
