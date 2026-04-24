const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')

const originalLoad = Module._load

const electronMock = {
  app: {
    isPackaged: true,
    name: 'Kone AI',
    getPath: (key) => {
      if (key === 'userData') return path.join(process.cwd(), '.tmp-autopilot-user-data')
      return path.join(process.cwd(), '.tmp-autopilot-user-data')
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
}

const originalFetch = global.fetch
const originalLoadModule = Module._load
const originalEnv = process.env.KONE_INTERACTION_TEST_ALLOW_ANALYSIS

Module._load = function mockLoad(request, parent, isMain) {
  if (request === 'electron') {
    return electronMock
  }
  if (
    process.env.KONE_INTERACTION_TEST_ALLOW_ANALYSIS === '1' &&
    (request === './license-service' || request === '../../dist-electron/electron/services/license-service.js') &&
    parent &&
    /search-service\.js$/.test(parent.filename)
  ) {
    return {
      registerSecureFeatureIpc(ipcMainArg, channel, _store, _licenseGuard, _featureName, handler) {
        ipcMainArg.handle(channel, async (event, ...args) => handler(event, ...args))
      },
      createLicenseService() {
        return { licenseGuard: { getStoredClaims() { return { status: 'active', expiresAt: Date.now() + 60_000, features: ['analysis_advanced'], licenseKey: 'KONE-TEST', plan: 'basic' } } } }
      },
    }
  }
  return originalLoadModule.call(this, request, parent, isMain)
}

const resetModule = (modulePath) => {
  delete require.cache[require.resolve(modulePath)]
}

const createIpcMainMock = () => {
  const handlers = new Map()
  return {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    getHandler(channel) {
      const handler = handlers.get(channel)
      assert.ok(handler, `Missing handler for channel: ${channel}`)
      return handler
    },
  }
}

const createEventMock = () => ({
  sender: {
    send() {},
  },
})

const createStoreMock = (values = {}) => ({
  get(key) {
    return values[key]
  },
  set(key, value) {
    values[key] = value
  },
})

const channelsModulePath = '../dist-electron/electron/ipc/channels.js'
const searchModulePath = '../dist-electron/electron/services/search-service.js'
const autopilotStateModulePath = '../dist-electron/electron/services/autopilot-state-service.js'

test('analysis generate returns dev mock payload with semantic markers when config is missing in dev', async () => {
  electronMock.app.isPackaged = false
  resetModule(searchModulePath)
  resetModule(channelsModulePath)

  const { registerSearchHandlers } = require(searchModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    user_config: {
      providers: [],
      icpProfile: {},
    },
    'system.machineId': 'analysis-dev',
  })

  registerSearchHandlers(ipcMain, store)
  const result = await ipcMain.getHandler(IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE)(createEventMock(), {
    lead: {
      company: 'Example GmbH',
      website: 'https://example.com',
      snippet: 'Industrial sourcing team looking for battery supplier',
    },
    scenario: 'direct_quote',
  })

  assert.equal(result?.success, true)
  assert.equal(result?.data?.semantic?.mockMode, true)
  assert.equal(result?.data?.semantic?.code, 'dev_mock_active')
  assert.equal(result?.data?.semantic?.degradedReason, 'missing_llm_key')
  assert.equal(result?.data?.source, 'dev_mock')
  assert.ok(result?.data?.emailBody)
})

test('analysis generate returns typed invalid_scenario failure in packaged runtime', async () => {
  electronMock.app.isPackaged = true
  process.env.KONE_INTERACTION_TEST_ALLOW_ANALYSIS = '1'
  resetModule(searchModulePath)
  resetModule(channelsModulePath)

  const { registerSearchHandlers } = require(searchModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    user_config: {
      providers: [{ id: 'llm', baseUrl: 'https://mock-llm.example/v1' }],
      selectedModel: 'gpt-4o-mini',
      llmApiKey: 'mock-llm-key',
      icpProfile: { targetProduct: 'battery' },
    },
    'system.machineId': 'analysis-prod',
  })

  global.fetch = async () => ({ ok: true, async json() { return {} } })

  registerSearchHandlers(ipcMain, store)
  const result = await ipcMain.getHandler(IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE)(createEventMock(), {
    lead: { company: 'Example GmbH' },
    scenario: 'unsupported_mode',
  })

  assert.equal(result?.success, false)
  assert.equal(result?.meta?.analysisSemantic?.code, 'invalid_scenario')
  delete process.env.KONE_INTERACTION_TEST_ALLOW_ANALYSIS
})

test('autopilot state handler returns ready_empty when state file is absent', async () => {
  electronMock.app.isPackaged = true
  resetModule(autopilotStateModulePath)
  resetModule(channelsModulePath)

  const { registerAutopilotStateHandlers } = require(autopilotStateModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({})
  const filePath = path.join(electronMock.app.getPath('userData'), 'autopilot_state.json')
  fs.rmSync(electronMock.app.getPath('userData'), { recursive: true, force: true })
  assert.equal(fs.existsSync(filePath), false)

  registerAutopilotStateHandlers(ipcMain, store)
  const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOPILOT.GET_STATE)()

  assert.equal(result?.success, true)
  assert.equal(result?.data?.stateKind, 'ready_empty')
  assert.equal(result?.data?.state, null)
})

test('autopilot state handler returns state_unavailable when state file is corrupt', async () => {
  electronMock.app.isPackaged = true
  resetModule(autopilotStateModulePath)
  resetModule(channelsModulePath)

  const { registerAutopilotStateHandlers } = require(autopilotStateModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({})
  const userDataDir = electronMock.app.getPath('userData')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'autopilot_state.json'), '{invalid-json', 'utf8')

  registerAutopilotStateHandlers(ipcMain, store)
  const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOPILOT.GET_STATE)()

  assert.equal(result?.success, true)
  assert.equal(result?.data?.stateKind, 'state_unavailable')
  assert.equal(result?.data?.state, null)
  assert.ok(result?.data?.statusReason)
})

test.after(() => {
  Module._load = originalLoad
  global.fetch = originalFetch
  if (typeof originalEnv === 'undefined') {
    delete process.env.KONE_INTERACTION_TEST_ALLOW_ANALYSIS
  } else {
    process.env.KONE_INTERACTION_TEST_ALLOW_ANALYSIS = originalEnv
  }
  fs.rmSync(electronMock.app.getPath('userData'), { recursive: true, force: true })
  electronMock.app.isPackaged = true
})
