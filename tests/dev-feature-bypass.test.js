const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const originalLoad = Module._load

const electronMock = {
  app: {
    isPackaged: true,
    name: 'Kone AI',
    getPath: () => path.join(process.cwd(), '.tmp-test-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
}

const loadWithMocks = () => {
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') {
      return electronMock
    }
    if (request === '../utils/http-client' && parent && /automation-service\.js$/.test(parent.filename)) {
      return {
        safeFetch: async () => ({ ok: true, status: 200 }),
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
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

loadWithMocks()

const channelsModulePath = '../dist-electron/electron/ipc/channels.js'
const searchModulePath = '../dist-electron/electron/services/search-service.js'
const automationModulePath = '../dist-electron/electron/services/automation-service.js'
const guardModulePath = '../dist-electron/electron/security/license-guard.js'

test('dev search handler reaches business logic instead of FEATURE_DENIED', async () => {
  electronMock.app.isPackaged = false
  resetModule(searchModulePath)
  resetModule(channelsModulePath)
  const { registerSearchHandlers } = require(searchModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)

  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    user_config: { providers: [] },
  })

  registerSearchHandlers(ipcMain, store)
  const result = await ipcMain.getHandler(IPC_CHANNELS.SEARCH.EXECUTE)(createEventMock(), {
    keyword: 'golf cart battery',
    country: 'US',
  })

  assert.notEqual(result?.error, 'FEATURE_DENIED')
  assert.notEqual(result?.code, 403)
  assert.ok(result?.error)
})

test('packaged license guard still fails closed without stored claims', () => {
  electronMock.app.isPackaged = true
  resetModule(guardModulePath)
  const { createLicenseGuard } = require(guardModulePath)

  const guard = createLicenseGuard({
    getStoredClaims: () => null,
    getMachineId: () => 'machine-prod',
    getRemoteEndpoint: () => undefined,
  })

  assert.throws(() => guard.requireFeature('search_basic', '海外客户智能搜索'), /未激活授权/)
})

test('dev automation manual path no longer stops at FEATURE_DENIED', async () => {
  electronMock.app.isPackaged = false
  resetModule(automationModulePath)
  resetModule(channelsModulePath)
  const { registerAutomationHandlers } = require(automationModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)

  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    user_config: { n8n: { webhookUrl: '' } },
    'system.machineId': 'machine-dev',
  })
  const licenseGuard = {
    getStoredClaims() {
      return null
    },
    requireFeature() {
      throw new Error('should not be called directly in this test harness')
    },
    requireAnyFeature() {
      throw new Error('should not be called directly in this test harness')
    },
  }

  resetModule(guardModulePath)
  const { createLicenseGuard } = require(guardModulePath)
  const realGuard = createLicenseGuard({
    getStoredClaims: () => null,
    getMachineId: () => 'machine-dev',
    getRemoteEndpoint: () => undefined,
  })

  registerAutomationHandlers(ipcMain, store, realGuard)
  const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOMATION.START_CAMPAIGN)(createEventMock(), {
    leads: [{ email: 'dev@example.com', company: 'Dev Co', website: 'https://example.com' }],
    templateId: 'default',
  })

  assert.notEqual(result?.error, 'FEATURE_DENIED')
})

test('packaged automation manual path still fails closed without cloud_send', async () => {
  electronMock.app.isPackaged = true
  resetModule(automationModulePath)
  resetModule(channelsModulePath)
  const { registerAutomationHandlers } = require(automationModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)

  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    'system.machineId': 'machine-prod',
  })
  const packagedGuard = {
    getStoredClaims() {
      return {
        status: 'active',
        expiresAt: Date.now() + 60_000,
        features: ['search_basic'],
        licenseKey: 'KONE-PROD',
        plan: 'basic',
      }
    },
    requireFeature() {
      const error = new Error('当前授权无权执行自动化发信')
      error.code = 403
      throw error
    },
    requireAnyFeature() {
      const error = new Error('当前授权无权执行自动化发信')
      error.code = 403
      throw error
    },
  }

  registerAutomationHandlers(ipcMain, store, packagedGuard)
  const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOMATION.START_CAMPAIGN)(createEventMock(), {
    leads: [{ email: 'prod@example.com', company: 'Prod Co', website: 'https://example.com' }],
    templateId: 'default',
  })

  assert.equal(result?.success, false)
  assert.equal(result?.error, 'FEATURE_DENIED')
  assert.equal(result?.code, 403)
})

test.after(() => {
  Module._load = originalLoad
  electronMock.app.isPackaged = true
})
