const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { createIpcMainMock, createEventMock, createStoreMock, createElectronMock, withModuleMocks, resetModule } = require('./helpers.js')

const originalFetch = global.fetch
const originalLoad = Module._load
const searchServicePath = '../../dist-electron/electron/services/search-service.js'
const channelsPath = '../../dist-electron/electron/ipc/channels.js'

const noisyHtml = `<html><head><style>${'x'.repeat(3000)}</style><script>${'y'.repeat(3000)}</script></head><body><nav>${'NAV '.repeat(300)}</nav><main><h1>Industrial Battery Supplier</h1><p>${'Useful battery content '.repeat(700)}</p></main><footer>${'FOOTER '.repeat(300)}</footer></body></html>`
const capturedBodies = []

test('dirty HTML is de-noised before LLM and truncated to <= 3000 chars', async () => {
  const electronMock = createElectronMock()
  const secretManagerMock = {
    getSecret(key) {
      if (/llm/i.test(String(key || ''))) return 'mock-llm-key'
      return ''
    },
    setSecret() { return { exists: true, masked: '***' } },
    checkSecret() { return { exists: true, masked: '***' } },
    migrateSecrets() { return false },
  }
  const licenseServiceMock = {
    createLicenseService() {
      return { licenseGuard: {} }
    },
    registerSecureFeatureIpc(ipcMain, channel, _store, _licenseGuard, _featureName, handler) {
      ipcMain.handle(channel, handler)
    },
  }

  capturedBodies.length = 0
  global.fetch = async (url, options = {}) => {
    const target = String(url)
    if (target.startsWith('https://example.com')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        async text() { return noisyHtml },
        async json() { throw new Error('not json') },
      }
    }
    if (target === 'https://mock-llm.example/v1/chat/completions') {
      const parsedBody = JSON.parse(String(options.body || '{}'))
      capturedBodies.push(parsedBody)
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async json() {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  content: 'Mock analysis content',
                  companyProfile: 'Profile',
                  painPoints: 'Pain',
                  valueMapping: 'Value',
                  emailSubject: 'Subject',
                  emailBody: 'Body',
                }),
              },
            }],
          }
        },
        async text() { return '' },
      }
    }
    throw new Error(`Unexpected fetch: ${target}`)
  }

  await withModuleMocks({
    electron: electronMock,
    [
      `./secret-manager::${path.join(process.cwd(), 'dist-electron', 'electron', 'services', 'search-service.js')}`
    ]: secretManagerMock,
    [
      `./secret-manager::${path.join(process.cwd(), 'dist-electron', 'electron', 'services', 'config-service.js')}`
    ]: secretManagerMock,
    [
      `./license-service::${path.join(process.cwd(), 'dist-electron', 'electron', 'services', 'search-service.js')}`
    ]: licenseServiceMock,
  }, async () => {
    resetModule(searchServicePath)
    resetModule(channelsPath)
    const { registerSearchHandlers } = require(searchServicePath)
    const { IPC_CHANNELS } = require(channelsPath)
    const ipcMain = createIpcMainMock()
    const store = createStoreMock({
      user_config: {
        providers: [{ id: 'llm', baseUrl: 'https://mock-llm.example/v1' }],
        llmApiKey: 'mock-llm-key',
        selectedModel: 'gpt-4o-mini',
        icpProfile: { targetProduct: 'battery', buyerPersona: 'dealer', coreAdvantage: 'stable delivery' },
      },
    })

    registerSearchHandlers(ipcMain, store)
    const result = await ipcMain.getHandler(IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE)(createEventMock(), {
      lead: {
        company: 'Example GmbH',
        website: 'https://example.com',
        snippet: 'Fallback snippet',
      },
      scenario: 'direct_quote',
    })

    assert.equal(result?.success, true)
  })

  assert.ok(capturedBodies.length > 0)
  const payloadText = capturedBodies[0].messages.map((message) => String(message.content || '')).join(' ')
  assert.ok(!payloadText.includes('<script'))
  assert.ok(!payloadText.includes('<style'))
  assert.ok(!payloadText.includes('<nav'))
  assert.ok(!payloadText.includes('<footer'))
  assert.ok(payloadText.length > 0)

  const websiteSegment = payloadText.match(/Industrial Battery Supplier[\s\S]*/)?.[0] || payloadText
  assert.ok(websiteSegment.length <= 3000)
})

test.after(() => {
  Module._load = originalLoad
  global.fetch = originalFetch
})
