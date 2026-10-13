/**
 * provider-serpapi-key-fallback.business.test.js
 *
 * 背景（2026-10-12 真实 UX 陷阱）：
 * 前端曾有「谷歌获客引擎」与「谷歌地图」两个独立密钥框，但两者是**同一个 SerpApi 账号**
 * （maps/organic/linkedin/customs/trade_show/facebook 全部走 SerpApi）。
 * 而搜索管线此前**只读 google-leads 的密钥** → 用户若只填「谷歌地图」，
 * 所有 Provider 取不到 key → **整轮搜索静默无数据**。
 *
 * 修复：读取端 `buildProviderConfig` 改为 **google-leads 优先、回退 google-maps**。
 * 本测试锁定该回退语义（含"只填 maps 也必须能搜"的反向场景）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const providerServicePath = path.join(ROOT, 'dist-electron', 'electron', 'services', 'provider-service.js')

const { withModuleMocks, resetModule } = require('./helpers.js')

const LEADS_SECRET = 'secrets.google-leads.apiKey'
const MAPS_SECRET = 'secrets.google-maps.apiKey'

const loadBuildProviderConfig = async (secrets) => {
  let mod = null
  await withModuleMocks(
    {
      [`./config-service::${providerServicePath}`]: {
        getGoogleConfig: () => ({
          googleLeads: { id: 'google-leads', baseUrl: '', secretKey: LEADS_SECRET },
          googleMaps: { id: 'google-maps', baseUrl: '', secretKey: MAPS_SECRET },
        }),
        SECRET_KEYS: {
          ANYSEARCH_API_KEY: 'secrets.anysearch.apiKey',
          ANYSEARCH_BASE_URL: 'secrets.anysearch.baseUrl',
        },
      },
      [`./secret-manager::${providerServicePath}`]: {
        getSecret: (key) => secrets[key] || '',
      },
      [`./providers/index::${providerServicePath}`]: {
        createDefaultProviderRegistry: () => ({}),
      },
    },
    async () => {
      resetModule(providerServicePath)
      mod = require(providerServicePath)
    },
  )
  return mod.buildProviderConfig
}

test('只填 google-leads → 使用 leads 密钥', async () => {
  const build = await loadBuildProviderConfig({ [LEADS_SECRET]: 'LEADS_KEY_123' })
  const cfg = build({})
  assert.equal(cfg.googleKey, 'LEADS_KEY_123')
})

test('只填 google-maps → **回退**到 maps 密钥（修复"只填地图→搜索零量"陷阱）', async () => {
  const build = await loadBuildProviderConfig({ [MAPS_SECRET]: 'MAPS_KEY_456' })
  const cfg = build({})
  assert.equal(cfg.googleKey, 'MAPS_KEY_456', 'maps 密钥必须被回退读取，否则搜索整轮无数据')
})

test('两者都填 → leads 优先', async () => {
  const build = await loadBuildProviderConfig({ [LEADS_SECRET]: 'LEADS', [MAPS_SECRET]: 'MAPS' })
  const cfg = build({})
  assert.equal(cfg.googleKey, 'LEADS')
})

test('都不填 → googleKey 为 undefined（Fail-Closed，不伪造密钥）', async () => {
  const build = await loadBuildProviderConfig({})
  const cfg = build({})
  assert.equal(cfg.googleKey, undefined)
})

test('空白字符串不算已配置（trim 后回退）', async () => {
  const build = await loadBuildProviderConfig({ [LEADS_SECRET]: '   ', [MAPS_SECRET]: 'MAPS_REAL' })
  const cfg = build({})
  assert.equal(cfg.googleKey, 'MAPS_REAL')
})
