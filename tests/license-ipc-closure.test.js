const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')

const originalLoad = Module._load
const originalWriteFileSync = fs.writeFileSync

const electronMock = {
  app: {
    isPackaged: true,
    name: 'Kone AI',
    getPath: () => path.join(process.cwd(), '.tmp-license-ipc-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
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

const serviceModulePath = '../dist-electron/electron/services/license-service.js'
const channelsModulePath = '../dist-electron/electron/ipc/channels.js'

const resetModule = (modulePath) => {
  delete require.cache[require.resolve(modulePath)]
}

const createStoreMock = (values = {}, shouldThrow = false) => ({
  get(key) {
    if (shouldThrow) {
      throw new Error('store exploded')
    }
    return values[key]
  },
  set(key, value) {
    if (shouldThrow) {
      throw new Error('store exploded')
    }
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

test('license info and device status resolve structured errors when machine-id path throws', async () => {
  electronMock.app.isPackaged = true
  resetModule(serviceModulePath)
  const { createLicenseService } = require(serviceModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)

  const ipcMain = createIpcMainMock()
  const service = createLicenseService(createStoreMock({}, true))
  service.registerHandlers(ipcMain, electronMock.app)

  const deviceResult = await ipcMain.getHandler(IPC_CHANNELS.SYSTEM.GET_DEVICE_STATUS)()
  assert.equal(deviceResult.success, false)
  assert.match(String(deviceResult.error || ''), /store exploded|读取设备状态失败/)

  const infoResult = await ipcMain.getHandler(IPC_CHANNELS.LICENSE.GET_INFO)()
  assert.equal(infoResult.success, false)
  assert.match(String(infoResult.error || ''), /store exploded|读取授权信息失败/)
})

test('request trial resolves structured failure object when non-permission anchor persistence fails', async () => {
  const originalFetch = global.fetch
  const ioError = Object.assign(new Error('disk broken'), { code: 'EIO' })

  global.fetch = async () => ({
    ok: true,
    async json() {
      return { unixtime: Math.floor(Date.now() / 1000) }
    },
  })

  fs.writeFileSync = (targetPath, ...args) => {
    if (String(targetPath).includes('anchor.bin')) {
      throw ioError
    }
    return originalWriteFileSync.call(fs, targetPath, ...args)
  }

  electronMock.app.isPackaged = true
  resetModule(serviceModulePath)
  const { createLicenseService } = require(serviceModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)

  const ipcMain = createIpcMainMock()
  const service = createLicenseService(createStoreMock({
    'system.machineId': 'machine-ipc',
    'system.hardwareMachineId': 'machine-ipc',
  }))
  service.registerHandlers(ipcMain, electronMock.app)

  const result = await ipcMain.getHandler(IPC_CHANNELS.LICENSE.REQUEST_TRIAL)()
  assert.equal(result.success, false)
  assert.equal(result.data?.success, false)
  assert.match(String(result.error || ''), /disk broken|试用申请失败/)
  assert.match(String(result.data?.message || ''), /disk broken|试用申请失败/)

  global.fetch = originalFetch
})

test('submit and verify resolve structured failures for invalid license payloads', async () => {
  electronMock.app.isPackaged = true
  resetModule(serviceModulePath)
  const { createLicenseService } = require(serviceModulePath)
  const { IPC_CHANNELS } = require(channelsModulePath)

  const ipcMain = createIpcMainMock()
  const service = createLicenseService(createStoreMock({
    'system.machineId': 'machine-submit',
    'system.hardwareMachineId': 'machine-submit',
  }))
  service.registerHandlers(ipcMain, electronMock.app)

  const submitResult = await ipcMain.getHandler(IPC_CHANNELS.LICENSE.SUBMIT)(null, { licenseKey: 'bad-license-key' })
  assert.equal(submitResult.success, false)
  assert.equal(typeof submitResult.error, 'string')
  assert.equal(typeof submitResult.data?.message, 'string')

  const verifyResult = await ipcMain.getHandler(IPC_CHANNELS.LICENSE.VERIFY)(null, 'bad-license-key')
  assert.equal(verifyResult.success, false)
  assert.equal(typeof verifyResult.error, 'string')
  assert.equal(typeof verifyResult.data?.message, 'string')
})

test.after(() => {
  fs.writeFileSync = originalWriteFileSync
  if (typeof global.fetch === 'undefined') {
    delete global.fetch
  }
  Module._load = originalLoad
})
