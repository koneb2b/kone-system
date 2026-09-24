/**
 * ipc-registry-license-migration.test.ts
 *
 * 验证第四批经 `registerIpc()` 收敛到注册中心的 6 个 plain 通道（license-service）：
 *   SYSTEM.GET_DEVICE_STATUS / LICENSE.GET_INFO / LICENSE.REQUEST_TRIAL /
 *   LICENSE.SUBMIT / LICENSE.VERIFY / LICENSE.CHECK_STATUS
 *
 * 验证项：
 *   1. 六个 plain 通道确实登记进全局 registry（而非散落在 ipcMain.handle）
 *   2. 自绑定兼容层生效：registerHandlers 末尾的 registry.attach(ipcMain) 把
 *      迁移通道落到调用方传入的 ipcMain，历史 e2e 无需改动即可 getHandler
 *   3. registry.dispatch 能路由到真实 handler 并返回结构化信封 { success, ... }
 *   4. 业务错误语义未被迁移改变（SUBMIT / VERIFY 空激活码仍返回 400）
 *   5. dev 模式下响应契约校验可过（证明契约与 handler 实际返回形状一致）
 *   6. assertRegistered 启动门禁断言机制对迁移通道生效
 *
 * 不实际 dispatch 的通道（仅断言"已登记"，避免真实外部副作用）：
 *   - LICENSE.GET_INFO：refreshTier + syncTrialAnchor 有网络 / 文件 IO
 *   - LICENSE.REQUEST_TRIAL：syncTrialAnchor 写注册表 / 文件
 *   - LICENSE.CHECK_STATUS：refreshTier + getInvisibleTrialLicenseState 有网络 / 文件 IO
 *
 * 测试在 dev 形态（app.isPackaged=false）下运行，以真实触发契约校验。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const Module = require('node:module')

const originalLoad = Module._load

const userDataDir = path.join(os.tmpdir(), 'kone-license-migration-test')

const electronMock = {
  app: {
    isPackaged: false,
    name: 'Kone AI',
    getPath: (name) => path.join(userDataDir, name === 'userData' ? '' : String(name)),
    setPath() {},
    whenReady: () => Promise.resolve(),
    isReady: () => true,
    on() {},
    once() {},
    quit() {},
    exit() {},
    requestSingleInstanceLock: () => true,
    commandLine: { appendSwitch() {}, hasSwitch: () => false },
    getName: () => 'Kone AI',
    getVersion: () => '1.3.0',
    getAppPath: () => process.cwd(),
    disableHardwareAcceleration() {},
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(String(value), 'utf8'),
    decryptString: (buffer) => Buffer.from(buffer).toString('utf8'),
  },
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
  BrowserWindow: function () {},
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    showSaveDialog: () => Promise.resolve({ canceled: true, filePath: '' }),
  },
  shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
  Menu: { buildFromTemplate: () => ({ popup() {}, items: [] }), setApplicationMenu() {} },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1280, height: 720 }, workArea: { width: 1280, height: 720 } }),
    getAllDisplays: () => [],
  },
  session: {
    defaultSession: { webRequest: { onBeforeSendHeaders() {} } },
    fromPartition: () => ({ clearStorageData: async () => {}, cookies: { get: async () => [] } }),
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromNamedImage: () => ({ isEmpty: () => true }),
  },
}

Module._load = function mockLoad(request, parent, isMain) {
  if (request === 'electron') return electronMock
  return originalLoad.call(this, request, parent, isMain)
}

const registryPath = '../dist-electron/electron/ipc/registry.js'
const channelsPath = '../dist-electron/electron/ipc/channels.js'
const licensePath = '../dist-electron/electron/services/license-service.js'

const makeStore = () => {
  const values = {
    license_claims: JSON.stringify({
      status: 'active',
      plan: 'enterprise',
      expiresAt: Date.now() + 86400000,
      features: ['search_basic', 'team_collaboration', 'cloud_send', 'local_autopilot'],
    }),
  }
  return {
    get: (k) => values[k],
    set: (k, v) => {
      values[k] = v
    },
    flushSync: () => {},
    path: path.join(userDataDir, 'kone-config.json'),
  }
}

const makeIpcMain = () => {
  const handled = new Map()
  return {
    handled,
    handle(channel, handler) {
      handled.set(channel, handler)
    },
    on() {},
    removeHandler() {},
  }
}

test('第四批 license-service plain 通道迁移：注册 / 自绑定 / 路由 / 信封 / 错误语义 / 启动门禁', async () => {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* dir may not exist */
  }
  fs.mkdirSync(userDataDir, { recursive: true })

  const { registry } = require(registryPath)
  const { IPC_CHANNELS } = require(channelsPath)

  registry.resetRegistry()

  const store = makeStore()
  const ipcLicense = makeIpcMain()

  const { createLicenseService } = require(licensePath)
  const { licenseGuard, registerHandlers } = createLicenseService(store)
  // registerHandlers 内部只为 6 个 plain 通道登记；20 处 Fail-Closed 包装器登记点不在此测试范围
  registerHandlers(ipcLicense, electronMock.app)

  const migrated = [
    IPC_CHANNELS.SYSTEM.GET_DEVICE_STATUS,
    IPC_CHANNELS.LICENSE.GET_INFO,
    IPC_CHANNELS.LICENSE.REQUEST_TRIAL,
    IPC_CHANNELS.LICENSE.SUBMIT,
    IPC_CHANNELS.LICENSE.VERIFY,
    IPC_CHANNELS.LICENSE.CHECK_STATUS,
  ]

  // 1) 六个 plain 通道确实登记进 registry
  const channels = registry.channels
  for (const ch of migrated) {
    assert.ok(channels.includes(ch), `通道应经 registry 注册: ${ch}`)
  }

  // 2) 自绑定兼容层生效：registerHandlers 末尾的 registry.attach 把 6 通道落到传入的 ipcMain
  for (const ch of migrated) {
    assert.ok(ipcLicense.handled.has(ch), `license 自绑定：应落到 registerHandlers 的 ipcMain: ${ch}`)
  }

  // 3) + 5) 路由往返 + dev 模式契约校验可过：GET_DEVICE_STATUS 无外部副作用
  const device = await registry.dispatch(IPC_CHANNELS.SYSTEM.GET_DEVICE_STATUS, {})
  assert.equal(device.success, true, 'system:get-device-status 应成功（信封契约校验通过）')
  assert.ok('available' in device.data, 'system:get-device-status 应回传 available')
  assert.equal(typeof device.data.machineId, 'string', 'system:get-device-status 应回传 machineId 字符串')

  // 4) 业务错误语义未被迁移改变：空激活码仍返回 400（SUBMIT / VERIFY 均早返回，无外部副作用）
  const emptySubmit = await registry.dispatch(IPC_CHANNELS.LICENSE.SUBMIT, {}, { licenseKey: '' })
  assert.equal(emptySubmit.success, false, '空激活码 SUBMIT 应被拒绝')
  assert.equal(emptySubmit.code, 400, '空激活码 SUBMIT 应带 400 状态码（非契约校验失败）')

  const emptyVerify = await registry.dispatch(IPC_CHANNELS.LICENSE.VERIFY, {}, '')
  assert.equal(emptyVerify.success, false, '空激活码 VERIFY 应被拒绝')
  assert.equal(emptyVerify.code, 400, '空激活码 VERIFY 应带 400 状态码（非契约校验失败）')

  // 6) 启动门禁断言机制对迁移通道生效
  for (const ch of migrated) {
    registry.assertRegistered(ch)
  }
  assert.throws(
    () => registry.assertRegistered('license:not-migrated'),
    /未注册/,
    'assertRegistered 应对未注册通道抛错',
  )

  console.log('[license-migration] registry 已登记通道:', channels.filter((c) => migrated.includes(c)).join(', '))
})

test.after(() => {
  try {
    require(registryPath).registry.resetRegistry()
  } catch {
    /* 清理全局注册中心单例，避免污染同进程的其它测试文件 */
  }
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* best effort cleanup */
  }
  Module._load = originalLoad
})
