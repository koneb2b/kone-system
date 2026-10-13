/**
 * search 缺配置负向泄漏测试（2026-10-11 新增，配套 search-service.ts 1428 处修复）
 *
 * ## 背景（真实缺陷）
 * 原缺配置分支抛出的异常内插了密钥/地址原文：
 *   throw new Error(`缺少配置. Debug: key=[${googleKey}], url=[${googleBaseUrl || ''}]`)
 * 该字符串沿 IPC → 渲染层 → 界面**直接显示**，当用户只填了半个 key 或误填带凭据的 URL，
 * 原文会被回显到 UI，构成**密钥/端点泄漏**。现改为用户可读提示，明细只走 probeLog。
 *
 * ## 本测试锁定的不变量
 *   对三组缺配置输入（key 空 / url 空 / 两者皆空）：
 *   ① handler 必须返回 success:false，且 **result.error 与 STREAM_ERROR 载荷完全不含哨兵 key/url**
 *   ② 流式生命周期必须完整：STREAM_START → STREAM_ERROR → STREAM_COMPLETE（错误路径也收尾）
 *   ③ 缺配置路径**零网络请求**（不得因占位而烧额度）
 *   ④ 反向：当 key 与 url 都具备时，**不得**发出"搜索服务尚未配置"的 config-missing 错误
 *
 * 复用项目既有 compiled-path loader（与 search-fallback.business.test.js 一致）：
 * 直接 require dist-electron 下的已编译 search-service.js，因此运行前必须保证 dist-electron
 * 为最新源码（本仓库 `npm run test:unit` 会先 `build:electron:dev`；若单独跑本文件，先编译）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const searchServicePath = path.join(ROOT, 'dist-electron', 'electron', 'services', 'search-service.js')
const configServicePath = path.join(ROOT, 'dist-electron', 'electron', 'services', 'config-service.js')
const secretManagerPath = path.join(ROOT, 'dist-electron', 'electron', 'services', 'secret-manager.js')
const licenseServicePath = path.join(ROOT, 'dist-electron', 'electron', 'services', 'license-service.js')
const channelsPath = path.join(ROOT, 'dist-electron', 'electron', 'ipc', 'channels.js')

const {
  createIpcMainMock,
  createEventMock,
  createStoreMock,
  createElectronMock,
  withModuleMocks,
  resetModule,
} = require('./helpers.js')

const originalFetch = global.fetch

const loadMocks = (googleKey) => {
  const electronMock = createElectronMock()
  const secretManagerMock = {
    getSecret(key) {
      if (/google/i.test(String(key || ''))) return googleKey
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
  return { electronMock, secretManagerMock, licenseServiceMock }
}

/** 构造一份最小但合法的 user_config（providers 决定 google baseUrl） */
const makeStore = (googleBaseUrl) =>
  createStoreMock({
    user_config: {
      providers: [{ id: 'google-leads', baseUrl: googleBaseUrl }],
      selectedModel: 'gpt-4o-mini',
      icpProfile: {
        targetProduct: 'Industrial battery system',
        buyerPersona: 'distributor',
        coreAdvantage: 'stable delivery',
        negativeIcp: '',
      },
    },
  })

const KEY_SENTINEL = 'SENTINEL_GOOGLE_KEY_9c27'
const URL_SENTINEL = 'https://sentinel-url-9c27.invalid/private'

const runExecute = async ({ googleKey, googleBaseUrl, fetchImpl }) => {
  const { electronMock, secretManagerMock, licenseServiceMock } = loadMocks(googleKey)
  const senderEvents = []
  global.fetch = async (url) => {
    if (typeof fetchImpl === 'function') return fetchImpl(url)
    throw new Error(`UNEXPECTED_FETCH ${String(url)}`)
  }

  const result = await withModuleMocks(
    {
      electron: electronMock,
      'electron-store': class MockStore {
        constructor() {
          this.values = {}
          this.path = path.join(process.cwd(), '.tmp-search-missing-ud', 'kone-config.json')
        }
        get(key) {
          return this.values[key]
        }
        set(key, value) {
          this.values[key] = value
        }
      },
      [`./secret-manager::${searchServicePath}`]: secretManagerMock,
      [`./secret-manager::${configServicePath}`]: secretManagerMock,
      [`./license-service::${searchServicePath}`]: licenseServiceMock,
    },
    async () => {
      for (const p of [searchServicePath, configServicePath, secretManagerPath, licenseServicePath, channelsPath]) {
        resetModule(p)
      }
      const { registerSearchHandlers } = require(searchServicePath)
      const { IPC_CHANNELS } = require(channelsPath)
      const ipcMain = createIpcMainMock()
      registerSearchHandlers(ipcMain, makeStore(googleBaseUrl))
      return ipcMain.getHandler(IPC_CHANNELS.SEARCH.EXECUTE)(
        { sender: { send: (channel, payload) => senderEvents.push({ channel, payload }) } },
        { keyword: 'Industrial battery dealer', country: 'Japan', city: '', filterOptions: {} },
      )
    },
  )

  const { IPC_CHANNELS } = require(channelsPath)
  return { result, events: senderEvents, C: IPC_CHANNELS.SEARCH }
}

test('缺配置①：googleKey 有值但 baseUrl 为空 → Fail-Closed 且零泄漏', async () => {
  const { result, events, C } = await runExecute({ googleKey: KEY_SENTINEL, googleBaseUrl: '' })
  assert.equal(result.success, false)
  const errEvents = events.filter((e) => e.channel === C.STREAM_ERROR)
  assert.equal(errEvents.length, 1, '缺配置应恰好一次 STREAM_ERROR')
  const message = errEvents[0].payload
  assert.equal(typeof message, 'string')
  assert.equal(message, result.error)
  assert.ok(message.includes('搜索服务尚未配置'), '应为用户可读提示')
  assert.ok(!message.includes(KEY_SENTINEL), '异常消息不得内插密钥哨兵')
  assert.ok(!message.includes(URL_SENTINEL), '异常消息不得内插地址哨兵')
  // 流式生命周期完整收尾
  const channels = events.map((e) => e.channel)
  assert.deepEqual(channels, [C.STREAM_START, C.STREAM_ERROR, C.STREAM_COMPLETE])
  assert.ok(
    !events.some(
      (e) =>
        e.channel === C.STREAM_COMPLETE && events.indexOf(e) < events.findIndex((x) => x.channel === C.STREAM_ERROR),
    ),
    'complete 必须在 error 之后',
  )
})

test('缺配置②：googleKey 为空但 baseUrl 有值 → Fail-Closed 且零泄漏', async () => {
  const { result, events, C } = await runExecute({ googleKey: '', googleBaseUrl: URL_SENTINEL })
  assert.equal(result.success, false)
  const errEvents = events.filter((e) => e.channel === C.STREAM_ERROR)
  assert.equal(errEvents.length, 1)
  const message = errEvents[0].payload
  assert.ok(message.includes('搜索服务尚未配置'))
  assert.ok(!message.includes(KEY_SENTINEL))
  assert.ok(!message.includes(URL_SENTINEL))
  assert.deepEqual(
    events.map((e) => e.channel),
    [C.STREAM_START, C.STREAM_ERROR, C.STREAM_COMPLETE],
  )
})

test('缺配置③：googleKey 与 baseUrl 皆空 → Fail-Closed 且零泄漏', async () => {
  const { result, events, C } = await runExecute({ googleKey: '', googleBaseUrl: '' })
  assert.equal(result.success, false)
  const errEvents = events.filter((e) => e.channel === C.STREAM_ERROR)
  assert.equal(errEvents.length, 1)
  const message = errEvents[0].payload
  assert.ok(message.includes('搜索服务尚未配置'))
  assert.ok(!message.includes(KEY_SENTINEL))
  assert.ok(!message.includes(URL_SENTINEL))
  assert.deepEqual(
    events.map((e) => e.channel),
    [C.STREAM_START, C.STREAM_ERROR, C.STREAM_COMPLETE],
  )
})

test('反向④：配置完整（key+url 都有）不得触发 config-missing 错误', async () => {
  const { events, C } = await runExecute({
    googleKey: KEY_SENTINEL,
    googleBaseUrl: 'https://serpapi.com',
    // 后续 fetch 抛错，但本断言只关心"不得出现 config-missing 文案"
    fetchImpl: () => {
      throw new Error('NETWORK_BLOCKED_IN_TEST')
    },
  })
  const configMissing = events.filter((e) => e.channel === C.STREAM_ERROR && /搜索服务尚未配置/.test(e.payload))
  assert.equal(configMissing.length, 0, '配置完整时不得发出 config-missing 错误')
})

test.after(() => {
  global.fetch = originalFetch
})
