const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const fs = require('node:fs')

const originalLoad = Module._load
const originalWriteFileSync = fs.writeFileSync

const electronMock = {
  app: {
    isPackaged: true,
    name: 'Kone AI',
    getPath: () => path.join(process.cwd(), '.tmp-test-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
}

const loadWithMocks = () => {
  Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
      return electronMock
    }
    return originalLoad.call(this, request, parent, isMain)
  }
}

const resetModule = (modulePath) => {
  delete require.cache[require.resolve(modulePath)]
}

const createStoreMock = (values = {}) => ({
  get(key) {
    return values[key]
  },
  set(key, value) {
    values[key] = value
  },
})

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

loadWithMocks()

const guardModulePath = '../dist-electron/electron/security/license-guard.js'
const serviceModulePath = '../dist-electron/electron/services/license-service.js'
const channelsModulePath = '../dist-electron/electron/ipc/channels.js'

const restorePatchedFs = () => {
  fs.writeFileSync = originalWriteFileSync
}

const ensureUserDataDir = () => {
  fs.mkdirSync(electronMock.app.getPath('userData'), { recursive: true })
}

test('packaged runtime remains fail-closed when no stored claims exist', () => {
  electronMock.app.isPackaged = true
  resetModule(guardModulePath)
  const { createLicenseGuard } = require(guardModulePath)

  const guard = createLicenseGuard({
    getStoredClaims: () => null,
    getMachineId: () => 'machine-prod',
    getRemoteEndpoint: () => undefined,
  })

  assert.equal(guard.getStoredClaims(), null)
  assert.throws(() => guard.requireFeature('cloud_send', '自动化发信'), /未激活授权/)
})

test('development runtime returns full mock claims when stored claims are missing', () => {
  ensureUserDataDir()
  electronMock.app.isPackaged = false
  resetModule(guardModulePath)
  const { createLicenseGuard } = require(guardModulePath)

  const guard = createLicenseGuard({
    getStoredClaims: () => null,
    getMachineId: () => 'machine-dev',
    getRemoteEndpoint: () => undefined,
  })

  const claims = guard.getStoredClaims()
  assert.ok(claims)
  assert.equal(claims.status, 'active')
  assert.equal(claims.plan, 'enterprise')
  assert.equal(claims.machineId, 'machine-dev')
  assert.equal(claims.licenseKey, 'DEV-ENTERPRISE-UNLOCKED')
  assert.ok(Array.isArray(claims.features))
  assert.ok(claims.features.includes('cloud_send'))
  assert.ok(claims.features.includes('team_collaboration'))

  const result = guard.requireFeature('cloud_send', '自动化发信')
  assert.equal(result.claims.machineId, 'machine-dev')
  assert.ok(result.featureSet.has('cloud_send'))
})

test('anchor persistence tolerates EPERM in both development and packaged runtime so activation flow still resolves', async () => {
  const epermError = Object.assign(new Error('access denied'), { code: 'EPERM' })
  const originalFetch = global.fetch
  const store = createStoreMock({
    'system.machineId': 'machine-anchor',
    'system.hardwareMachineId': 'machine-anchor',
  })

  ensureUserDataDir()
  fs.writeFileSync = (targetPath, ...args) => {
    if (String(targetPath).includes('anchor.bin')) {
      throw epermError
    }
    return originalWriteFileSync.call(fs, targetPath, ...args)
  }
  global.fetch = async () => ({
    ok: true,
    async json() {
      return { unixtime: Math.floor(Date.now() / 1000) }
    },
  })

  electronMock.app.isPackaged = false
  resetModule(serviceModulePath)
  const { createLicenseService } = require(serviceModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)
  const devIpcMain = createIpcMainMock()
  const devService = createLicenseService(store)
  devService.registerHandlers(devIpcMain, electronMock.app)
  const devResult = await devIpcMain.getHandler(IPC_CHANNELS.LICENSE.REQUEST_TRIAL)()
  assert.equal(devResult.success, true)
  assert.equal(devResult.data?.success, true)

  electronMock.app.isPackaged = true
  resetModule(serviceModulePath)
  const { createLicenseService: createPackagedLicenseService } = require(serviceModulePath)
  const { IPC_CHANNELS: packagedChannels } = require(channelsModulePath)
  const packagedIpcMain = createIpcMainMock()
  const packagedService = createPackagedLicenseService(store)
  packagedService.registerHandlers(packagedIpcMain, electronMock.app)
  const packagedResult = await packagedIpcMain.getHandler(packagedChannels.LICENSE.REQUEST_TRIAL)()
  assert.equal(packagedResult.success, true)
  assert.equal(packagedResult.data?.success, true)
  assert.equal(typeof packagedResult.data?.expiresAt, 'number')

  global.fetch = originalFetch
})


test.after(() => {
  restorePatchedFs()
  if (typeof global.fetch === 'undefined') {
    delete global.fetch
  }
  Module._load = originalLoad
  electronMock.app.isPackaged = true
})
