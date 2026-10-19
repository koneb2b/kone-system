const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// Serper Provider 专项离线单测（零网络：mock fetchWithRetry + 时间隔离）。
// 覆盖：结果归一化 / isAvailable 依赖独立 serperApiKey / 陈旧 myJobId 丢弃 / 单源失败隔离。
// 生产代码位于 electron/services/providers/serper-provider.ts，测试加载 dist-electron 编译产物
// （与 provider-isolation.business.test.js 一致；先经 npm run build:electron:dev 编译）。

const { withModuleMocks, resetModule } = require('./helpers.js')

const providerPath = path.join(
  __dirname,
  '..',
  '..',
  'dist-electron',
  'electron',
  'services',
  'providers',
  'serper-provider.js',
)

const ACTIVE_JOB_ID = 'job-active-serper'

const makeFetchMock = (responsesByUrl, calls) => async (url) => {
  if (calls) calls.push(url)
  const match = responsesByUrl.find((r) => url.includes(r.match))
  if (!match) throw new Error(`unexpected fetch: ${url}`)
  return {
    ok: match.ok ?? true,
    status: match.status ?? 200,
    text: async () => JSON.stringify(match.body ?? {}),
  }
}

const loadProvider = (fetchMock, activeJobId = ACTIVE_JOB_ID, runner) =>
  withModuleMocks(
    {
      '../proxy-service': {
        fetchWithRetry: fetchMock,
        getDefaultSerpApiTimeoutMs: (ms) => ms || 30000,
      },
      // Serper 通过 `await import('../search/job-registry')` 做时间隔离判断
      '../search/job-registry': { isKnownActiveJobId: (id) => id === activeJobId },
      // 编译产物会 require('proxy-service' / 'search-service')（无相对前缀的 CJS 解析）
      'proxy-service': null,
      'search-service': null,
    },
    async () => {
      resetModule(providerPath)
      const mod = require(providerPath)
      // runner 必须在 mock 作用域内执行：execute 的动态导入发生在调用时
      return runner ? runner(mod) : mod
    },
  )

const mkQuery = (overrides = {}) => ({
  keyword: 'golf cart battery wholesaler',
  language: 'en',
  country: 'USA',
  city: '',
  intentProducts: ['golf cart battery'],
  b2bAttributes: ['wholesaler'],
  myJobId: ACTIVE_JOB_ID,
  serperApiKey: 'mock-serper-key',
  timeoutMs: 5000,
  ...overrides,
})

test('Serper: organic 结果归一化为 serper 来源线索', async () => {
  const fetchMock = makeFetchMock([
    {
      match: 'google.serper.dev',
      body: {
        organic: [
          {
            title: 'ACME Golf Carts',
            link: 'https://acme.example.com',
            snippet: 'Wholesale golf cart batteries for distributors.',
          },
        ],
      },
    },
  ])
  const result = await loadProvider(fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.SerperProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.error, undefined)
  assert.equal(result.results.length, 1)
  const first = result.results[0]
  assert.equal(first.source, 'serper', '来源必须标注为 serper，不得冒充 google_organic')
  assert.equal(first.company, 'ACME Golf Carts')
  assert.equal(first.website, 'https://acme.example.com')
  assert.equal(first.snippet, 'Wholesale golf cart batteries for distributors.')
})

test('Serper: 无 serperApiKey 时不发请求并返回空错误', async () => {
  const fetchMock = makeFetchMock([{ match: 'google.serper.dev', body: { organic: [] } }])
  const result = await loadProvider(fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.SerperProvider()
    const available = provider.isAvailable({ serperApiKey: '' })
    const res = await provider.execute(mkQuery({ serperApiKey: undefined }))
    return { available, res }
  })

  assert.equal(result.available, false)
  assert.equal(result.res.results.length, 0)
  assert.match(String(result.res.error), /not configured/)
})

test('Serper: 陈旧 myJobId 被时间隔离丢弃（返回空结果而非抛异常）', async () => {
  const fetchMock = makeFetchMock([
    { match: 'google.serper.dev', body: { organic: [{ title: 'X', link: 'https://x.example.com' }] } },
  ])
  const result = await loadProvider(fetchMock, 'job-stale-serper', async (mod) => {
    const provider = new mod.SerperProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.results.length, 0, '陈旧 job 结果必须为空')
  assert.match(String(result.error), /Stale job/)
})

test('Serper: 上游非 200 被隔离跳过，不中断整轮采集', async () => {
  const fetchMock = makeFetchMock([{ match: 'google.serper.dev', ok: false, status: 503, body: {} }])
  const result = await loadProvider(fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.SerperProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.results.length, 0)
  assert.match(String(result.error), /Serper HTTP 503/)
})

test('Serper: 单源不做自动重试（429 也只发一次请求，不额外消耗自备额度）', async () => {
  const fetchCalls = []
  const fetchMock = makeFetchMock([{ match: 'google.serper.dev', ok: false, status: 429, body: {} }], fetchCalls)
  const result = await loadProvider(fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.SerperProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.results.length, 0)
  assert.match(String(result.error), /Serper HTTP 429/)
  assert.equal(fetchCalls.length, 1, '可重试状态码也不得自动重试（§五）')
})

test('Serper: 错误信息不携带 API Key（密钥安全边界）', async () => {
  const fetchMock = makeFetchMock([
    { match: 'google.serper.dev', ok: false, status: 401, body: { message: 'Unauthorized' } },
  ])
  const result = await loadProvider(fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.SerperProvider()
    return provider.execute(mkQuery())
  })

  assert.equal(result.results.length, 0)
  assert.equal(String(result.error).includes('mock-serper-key'), false, '错误/日志路径不得回显密钥原文')
  assert.match(String(result.error), /Serper HTTP 401/)
})

test('Serper: isAvailable 仅依赖独立 serperApiKey（不回退 SerpApi）', async () => {
  const fetchMock = makeFetchMock([])
  const result = await loadProvider(fetchMock, ACTIVE_JOB_ID, async (mod) => {
    const provider = new mod.SerperProvider()
    return {
      withSerper: provider.isAvailable({ serperApiKey: 'k' }),
      withGoogleOnly: provider.isAvailable({ googleKey: 'serpapi-key' }),
      empty: provider.isAvailable({}),
    }
  })

  assert.equal(result.withSerper, true)
  assert.equal(result.withGoogleOnly, false, 'SerpApi 密钥不得使 Serper 可用')
  assert.equal(result.empty, false)
})
