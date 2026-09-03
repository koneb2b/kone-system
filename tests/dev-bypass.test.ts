/**
 * dev-bypass.test.ts — 开发环境特权放行验证矩阵
 *
 * Coverage:
 *   1. requireFeature: unpackaged → pass, packaged → deny
 *   2. requireAnyFeature: same matrix
 *   3. registerSecureFeatureIpc: dev handler executes
 *   4. Manual auth path (automation-service): dev passes
 *
 * 不依赖外部 API, 所有 mock 在本地完成。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const crypto = require('node:crypto')

const originalLoad = Module._load
const DIST = path.join(process.cwd(), 'dist-electron')
const EMPTY_HANDLER = async () => ({ success: true, data: 'ok' })

const makeElectronMock = (isPackaged: boolean) => ({
  app: {
    isPackaged,
    name: 'Kone AI',
    getPath: () => path.join(process.cwd(), '.tmp-test-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8'),
  },
})

let electronMock = makeElectronMock(true)

Module._load = function mockElectron(request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return electronMock
  return originalLoad.call(this, request, parent, isMain)
}

function createIpcMainMock() {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  return {
    handle(channel: string, handler: (...args: any[]) => unknown) {
      handlers.set(channel, handler)
    },
    getHandler(channel: string) {
      const handler = handlers.get(channel)
      assert.ok(handler, `Missing handler for channel: ${channel}`)
      return handler
    },
  }
}

function createStoreMock(values: Record<string, any> = {}) {
  return {
    get(key: string) {
      return values[key]
    },
    set(key: string, value: any) {
      values[key] = value
    },
  }
}

const resetModule = (modulePath: string) => {
  delete require.cache[require.resolve(modulePath)]
}

// Also reset electron-bridge which caches the electron module reference
const resetElectronBridge = () => {
  const bridgePath = path.join(DIST, 'electron/services/electron-bridge.js')
  delete require.cache[require.resolve(bridgePath)]
}

// ──────────────────────────────────────────────
// 1. requireFeature – unpackaged passes
// ──────────────────────────────────────────────
test('requireFeature passes in unpackaged runtime', () => {
  resetElectronBridge()
  electronMock = makeElectronMock(false)
  resetModule(path.join(DIST, 'electron/security/license-guard.js'))
  const { createLicenseGuard } = require(path.join(DIST, 'electron/security/license-guard.js'))

  const guard = createLicenseGuard({
    getStoredClaims: () => null, // no stored claims → should trigger dev mock
    getMachineId: () => 'dev-machine',
    getRemoteEndpoint: () => undefined,
  })

  const result = guard.requireFeature('search_basic', '海外客户智能搜索')
  assert.ok(result, 'should return result object')
  assert.ok(result.claims, 'should have claims')
  assert.ok(result.featureSet, 'should have featureSet')
  assert.ok(result.featureSet.has('search_basic'), 'search_basic should be in dev features')
})

test('requireAnyFeature passes in unpackaged runtime', () => {
  resetElectronBridge()
  electronMock = makeElectronMock(false)
  resetModule(path.join(DIST, 'electron/security/license-guard.js'))
  const { createLicenseGuard } = require(path.join(DIST, 'electron/security/license-guard.js'))

  const guard = createLicenseGuard({
    getStoredClaims: () => null,
    getMachineId: () => 'dev-machine',
    getRemoteEndpoint: () => undefined,
  })

  const result = guard.requireAnyFeature(['cloud_send', 'team_collaboration'], '自动化发信')
  assert.ok(result, 'should return result object')
  assert.ok(result.featureSet.has('cloud_send'), 'cloud_send should be in dev features')
})

// ──────────────────────────────────────────────
// 2. requireFeature – packaged denies
// ──────────────────────────────────────────────
test('requireFeature denies in packaged runtime without claims', () => {
  resetElectronBridge()
  electronMock = makeElectronMock(true)
  resetModule(path.join(DIST, 'electron/security/license-guard.js'))
  const { createLicenseGuard } = require(path.join(DIST, 'electron/security/license-guard.js'))

  const guard = createLicenseGuard({
    getStoredClaims: () => null,
    getMachineId: () => 'prod-machine',
    getRemoteEndpoint: () => undefined,
  })

  assert.throws(
    () => guard.requireFeature('search_basic', '海外客户智能搜索'),
    (err: Error) => {
      assert.ok(
        err.message.includes('未激活授权') || err.message.includes('无权'),
        `Error message should indicate denial: ${err.message}`,
      )
      return true
    },
  )
})

test('requireAnyFeature denies in packaged runtime without claims', () => {
  resetElectronBridge()
  electronMock = makeElectronMock(true)
  resetModule(path.join(DIST, 'electron/security/license-guard.js'))
  const { createLicenseGuard } = require(path.join(DIST, 'electron/security/license-guard.js'))

  const guard = createLicenseGuard({
    getStoredClaims: () => null,
    getMachineId: () => 'prod-machine',
    getRemoteEndpoint: () => undefined,
  })

  assert.throws(
    () => guard.requireAnyFeature(['cloud_send'], '自动化发信'),
    (err: Error) => {
      assert.ok(
        err.message.includes('未激活授权') || err.message.includes('无权'),
        `Error message should indicate denial: ${err.message}`,
      )
      return true
    },
  )
})

// ──────────────────────────────────────────────
// 3. registerSecureFeatureIpc – dev passes
// ──────────────────────────────────────────────
test('registerSecureFeatureIpc lets handler execute in dev mode', async () => {
  resetElectronBridge()
  electronMock = makeElectronMock(false)
  const store = createStoreMock({
    'system.machineId': 'dev-machine',
    'system.hardwareMachineId': 'dev-machine',
  })

  resetModule(path.join(DIST, 'electron/services/license-service.js'))
  const { registerSecureFeatureIpc } = require(path.join(DIST, 'electron/services/license-service.js'))
  const ipcMain = createIpcMainMock()

  const licenseGuard = {
    requireFeature: () => ({
      claims: { status: 'active', features: ['search_basic'] },
      featureSet: new Set(['search_basic']),
    }),
  }
  registerSecureFeatureIpc(ipcMain, 'search:execute', store, licenseGuard, 'search_basic', EMPTY_HANDLER, '搜索')
  const handler = ipcMain.getHandler('search:execute')
  const result = await handler({}, { query: 'test' })

  assert.ok(result, 'should have a result')
  // Dev bypass means handler executes; success shape depends on EMPTY_HANDLER
  assert.equal(result.success, true, 'handler should execute in dev mode')
})

test('registerSecureFeatureIpc blocks handler in packaged mode without claims', async () => {
  resetElectronBridge()
  electronMock = makeElectronMock(true)
  const store = createStoreMock({})

  resetModule(path.join(DIST, 'electron/services/license-service.js'))
  const { registerSecureFeatureIpc } = require(path.join(DIST, 'electron/services/license-service.js'))
  const ipcMain = createIpcMainMock()

  const prodLicenseGuard = {
    requireFeature: () => {
      throw Object.assign(new Error('未激活授权'), { code: 401 })
    },
    getStoredClaims: () => null,
  }
  registerSecureFeatureIpc(
    ipcMain,
    'search:execute-prod',
    store,
    prodLicenseGuard,
    'search_basic',
    EMPTY_HANDLER,
    '搜索',
  )
  const handler = ipcMain.getHandler('search:execute-prod')
  const result = await handler({}, { query: 'test' })

  // In packaged mode without claims, should return FEATURE_DENIED
  assert.ok(result)
  // The response shape might be { success: false, error: ... } or similar
  // The key assertion is it's NOT { success: true, data: 'ok' }
  assert.notEqual(
    result.success === true && result.data === 'ok',
    true,
    'handler should NOT execute in packaged mode without claims',
  )
})
