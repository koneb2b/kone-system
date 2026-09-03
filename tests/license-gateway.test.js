const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const originalLoad = Module._load

const electronMock = {
  app: {
    isPackaged: true,
    getPath: () => path.join(process.cwd(), '.tmp-test-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
}

Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return electronMock
  }
  return originalLoad.call(this, request, parent, isMain)
}

const { registerSecureIpc, registerSecureFeatureIpc } = require('../dist-electron/electron/services/license-service.js')

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

const createLicenseGuardMock = ({ claims = null, featureError = null } = {}) => ({
  getStoredClaims() {
    return claims
  },
  requireFeature() {
    if (featureError) throw featureError
    return { claims, featureSet: new Set() }
  },
  requireAnyFeature() {
    if (featureError) throw featureError
    return { claims, featureSet: new Set() }
  },
})

test('scene A: expired trial short-circuits before handler execution', async () => {
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    'trial.firstActivationTimestamp': Date.now() - 9 * 24 * 60 * 60 * 1000,
    'trial.lastKnownGoodTimestamp': Date.now() - 1000,
    'trial.deviceId': 'device-a',
    'system.hardwareMachineId': 'device-a',
  })
  const licenseGuard = createLicenseGuardMock()
  let handlerExecuted = false

  registerSecureIpc(
    ipcMain,
    'test:expired',
    store,
    licenseGuard,
    async () => {
      handlerExecuted = true
      return { success: true }
    },
    '海外客户智能搜索',
  )

  const result = await ipcMain.getHandler('test:expired')(createEventMock())

  assert.equal(handlerExecuted, false)
  assert.equal(result.success, false)
  assert.equal(result.error, 'TRIAL_EXPIRED')
  assert.equal(result.operationName, '海外客户智能搜索')
  assert.match(result.message, /海外客户智能搜索/)
})

test('scene B: missing feature denies access before handler execution', async () => {
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    'system.machineId': 'device-b',
  })
  const featureError = new Error('当前授权无权执行线索全量导出')
  featureError.code = 403
  const licenseGuard = createLicenseGuardMock({
    claims: { status: 'active', expiresAt: Date.now() + 60_000, features: [], licenseKey: 'KONE-OK' },
    featureError,
  })
  let handlerExecuted = false

  registerSecureFeatureIpc(
    ipcMain,
    'test:feature-denied',
    store,
    licenseGuard,
    ['lead_export', 'export_full'],
    async () => {
      handlerExecuted = true
      return { success: true }
    },
    '线索全量导出',
  )

  const result = await ipcMain.getHandler('test:feature-denied')(createEventMock())

  assert.equal(handlerExecuted, false)
  assert.equal(result.success, false)
  assert.equal(result.error, 'FEATURE_DENIED')
  assert.equal(result.operationName, '线索全量导出')
  assert.equal(result.code, 403)
  assert.match(result.message, /线索全量导出/)
})

test('scene C: trial and feature pass through to handler', async () => {
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    'system.machineId': 'device-c',
  })
  const licenseGuard = createLicenseGuardMock({
    claims: {
      status: 'active',
      expiresAt: Date.now() + 60_000,
      features: ['cloud_send'],
      licenseKey: 'KONE-ACTIVE',
    },
  })
  let handlerCallCount = 0

  registerSecureFeatureIpc(
    ipcMain,
    'test:success',
    store,
    licenseGuard,
    'cloud_send',
    async (_event, payload) => {
      handlerCallCount += 1
      return { success: true, echoed: payload }
    },
    '云端代理请求',
  )

  const payload = { url: 'https://example.com' }
  const result = await ipcMain.getHandler('test:success')(createEventMock(), payload)

  assert.equal(handlerCallCount, 1)
  assert.deepEqual(result, { success: true, echoed: payload })
})

test.after(() => {
  Module._load = originalLoad
})
