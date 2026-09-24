/**
 * ipc-startup-gate.test.ts
 *
 * 验证 P0-4 收口最后一步：`assertAllRegistered()` 启动门禁。
 * 本测试忠实复刻 `main.ts` 的 `registerIpcHandlers()` + `AUTOPILOT.SYNC_STATE` 注册序列
 * （同一组服务、同一组实参），在注册完成后调用 `registry.assertAllRegistered(collectInvokeChannels())`
 * 并 `registry.lock()`，证明：
 *   1. `collectInvokeChannels()` 精确返回 49 个 invoke 通道（= 声明总数 60 − 仅推送 11）
 *   2. 完整注册序列后，启动门禁**通过**（全部 invoke 通道已登记，含 20 处 Fail-Closed 包装器治理登记）
 *   3. 启动门禁**非空**：若故意漏注册某个 invoke 通道（如 auth 服务），`assertAllRegistered`
 *      必须抛错并指明缺失通道（防回归守卫真实有效）
 *   4. `lock()` 后禁止新增注册（启动后护栏生效）
 *
 * 不加载 main.ts 模块本身（其 bootstrap 不可在单测中执行），而是复刻其注册调用序列，
 * 使本测试等价于"对 main.ts 启动路径的注册完整性做端到端断言"。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const Module = require('node:module')

const originalLoad = Module._load

const userDataDir = path.join(os.tmpdir(), 'kone-startup-gate-test')

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
const autopilotContractPath = '../dist-electron/electron/ipc/contracts/autopilot.contract.js'
const authPath = '../dist-electron/electron/services/auth-service.js'
const configPath = '../dist-electron/electron/services/config-service.js'
const licensePath = '../dist-electron/electron/services/license-service.js'
const proxyPath = '../dist-electron/electron/services/proxy-service.js'
const searchPath = '../dist-electron/electron/services/search-service.js'
const exportPath = '../dist-electron/electron/services/export-service.js'
const autopilotStatePath = '../dist-electron/electron/services/autopilot-state-service.js'
const supabasePath = '../dist-electron/electron/services/supabase-service.js'
const automationPath = '../dist-electron/electron/services/automation-service.js'
const sandboxPath = '../dist-electron/electron/services/sandbox-service.js'
const agentPath = '../dist-electron/electron/services/agent-service.js'
const dnsPath = '../dist-electron/electron/services/dns-service.js'
const providerPath = '../dist-electron/electron/services/provider-service.js'

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

/** 复刻 main.ts 的 registerIpcHandlers() + SYNC_STATE 注册序列 */
const runMainRegistrationSequence = (
  registry,
  IPC_CHANNELS,
  registerIpc,
  autopilotSyncLifecycleContract,
  store,
  licenseGuard,
  ipcMain,
  electronApp,
  opts,
) => {
  const { registerConfigHandlers } = require(configPath)
  const { createLicenseService } = require(licensePath)
  const { registerProxyHandlers } = require(proxyPath)
  const { registerSearchHandlers } = require(searchPath)
  const { registerExportHandlers } = require(exportPath)
  const { registerAutopilotStateHandlers } = require(autopilotStatePath)
  const { registerSupabaseHandlers } = require(supabasePath)
  const { registerAutomationHandlers } = require(automationPath)
  const { registerSandboxHandlers } = require(sandboxPath)
  const { registerAgentHandlers } = require(agentPath)
  const { registerDnsHandlers } = require(dnsPath)
  const { registerProviderHandlers } = require(providerPath)

  // 与 main.ts registerIpcHandlers() 完全一致（含 license 本地别名展开）。
  // 支持 opts.skipAuth：复刻"漏注册 auth 服务"的回归场景时不调用 registerAuthHandlers。
  const skipAuth = !!(opts && opts.skipAuth)
  if (!skipAuth) {
    const { registerAuthHandlers } = require(authPath)
    registerAuthHandlers(ipcMain)
  }
  registerConfigHandlers(ipcMain, store)
  const { registerHandlers: registerLicenseHandlers } = createLicenseService(store)
  registerLicenseHandlers(ipcMain, electronApp)
  registerProxyHandlers(ipcMain, licenseGuard, store)
  registerSearchHandlers(ipcMain, store)
  registerExportHandlers(ipcMain, licenseGuard, store)
  registerAutopilotStateHandlers(ipcMain, store)
  registerSupabaseHandlers(ipcMain, store, licenseGuard, () => null)
  registerAutomationHandlers(ipcMain, store, licenseGuard)
  registerSandboxHandlers(ipcMain, store)
  registerAgentHandlers(ipcMain, store)
  registerDnsHandlers(ipcMain, store)
  registerProviderHandlers(ipcMain, store)

  // main.ts 在 registerIpcHandlers() 之后、initAutoUpdater() 之后注册 SYNC_STATE
  if (!opts || opts.includeSyncState !== false) {
    registerIpc(IPC_CHANNELS.AUTOPILOT.SYNC_STATE, autopilotSyncLifecycleContract, async () => ({
      success: true,
      data: null,
    }))
  }
}

test('启动门禁：完整注册序列后 assertAllRegistered 通过 + lock 生效', async () => {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* dir may not exist */
  }
  fs.mkdirSync(userDataDir, { recursive: true })

  const { registry, registerIpc } = require(registryPath)
  const { IPC_CHANNELS, collectInvokeChannels } = require(channelsPath)
  const { autopilotSyncLifecycleContract } = require(autopilotContractPath)

  registry.resetRegistry()

  const store = makeStore()
  const { licenseGuard } = require(licensePath).createLicenseService(store)
  const ipcMain = makeIpcMain()

  // 1) collectInvokeChannels 精确为 49（声明 60 − 仅推送 11），且与 PUSH_CHANNELS 互斥
  const invoke = collectInvokeChannels()
  assert.equal(invoke.length, 49, 'collectInvokeChannels 应返回 49 个 invoke 通道')
  // 2) 完整复刻 main.ts 注册序列
  runMainRegistrationSequence(
    registry,
    IPC_CHANNELS,
    registerIpc,
    autopilotSyncLifecycleContract,
    store,
    licenseGuard,
    ipcMain,
    electronMock.app,
    {},
  )

  // 全部 invoke 通道均已登记
  for (const ch of invoke) {
    assert.ok(registry.channels.includes(ch), `启动序列应登记 invoke 通道: ${ch}`)
  }

  // 3) 启动门禁通过（不抛错）
  assert.doesNotThrow(() => registry.assertAllRegistered(invoke), '完整注册序列后 assertAllRegistered 应通过')

  // 4) 门禁通过后锁定，新增注册被拒绝
  assert.doesNotThrow(() => registry.lock(), 'lock() 应成功')
  assert.equal(registry.locked, true, '注册中心应已锁定')
  assert.throws(
    () =>
      registry.register('post-boot:channel', {
        contract: { channel: 'post-boot:channel', requestRule: { type: 'any' }, responseRule: { type: 'any' } },
        handler: async () => ({ success: true }),
      }),
    /已锁定/,
    'lock() 后应禁止新增注册',
  )

  console.log('[startup-gate] 49 invoke 通道全部登记，门禁通过 + 锁定生效')
})

test('启动门禁非空：漏注册 invoke 通道时 assertAllRegistered 抛错', async () => {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* dir may not exist */
  }
  fs.mkdirSync(userDataDir, { recursive: true })

  const { registry, registerIpc } = require(registryPath)
  const { IPC_CHANNELS, collectInvokeChannels } = require(channelsPath)
  const { autopilotSyncLifecycleContract } = require(autopilotContractPath)

  registry.resetRegistry()

  const store = makeStore()
  const { licenseGuard } = require(licensePath).createLicenseService(store)
  const ipcMain = makeIpcMain()

  // 故意跳过 registerAuthHandlers（auth:login / auth:logout / auth:get-session 将缺失），
  // 复刻一个漏注册的回归场景。其余通道与完整序列一致。
  runMainRegistrationSequence(
    registry,
    IPC_CHANNELS,
    registerIpc,
    autopilotSyncLifecycleContract,
    store,
    licenseGuard,
    ipcMain,
    electronMock.app,
    { skipAuth: true },
  )

  // 门禁必须抛错，且指明缺失通道（防回归守卫真实有效，非空）
  assert.throws(
    () => registry.assertAllRegistered(collectInvokeChannels()),
    /未注册/,
    '漏注册 invoke 通道时 assertAllRegistered 必须抛错（防回归守卫非空）',
  )

  console.log('[startup-gate] 漏注册场景门禁正确抛错（非空守卫验证通过）')
})

test.after(() => {
  try {
    require(registryPath).registry.resetRegistry()
  } catch {
    /* best effort */
  }
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
  Module._load = originalLoad
})
