/**
 * ipc-registry-plain-batch3-migration.test.ts
 *
 * 验证第三批经 `registerIpc()` 收敛到注册中心的 10 个 plain 通道：
 *   - autopilot-state-service：AUTOPILOT.GET_STATE / SET_STATE / CLEAR_LEGACY（3）
 *   - auth-service：            AUTH.LOGIN / LOGOUT / GET_SESSION（3）
 *   - sandbox-service：         ACCOUNT.CONNECT / DISCONNECT / GET_LIST（3）
 *   - automation-service：      AUTOMATION.START_CAMPAIGN（1）
 *
 * 验证项：
 *   1. 十个 plain 通道确实登记进全局 registry（而非散落在 ipcMain.handle）
 *   2. 自绑定兼容层生效：register*Handlers 末尾的 registry.attach(ipcMain) 会把
 *      迁移通道落到调用方传入的 ipcMain，历史 e2e 无需改动即可 getHandler
 *   3. registry.dispatch 能路由到真实 handler 并返回结构化信封 { success, ... }
 *   4. 业务错误语义未被迁移改变（ACCOUNT.DISCONNECT 空 accountId 仍返回 400）
 *   5. dev 模式下响应契约校验可过（证明契约与 handler 实际返回形状一致）
 *   6. assertRegistered 启动门禁断言机制对迁移通道生效
 *
 * 不实际 dispatch 的通道（仅断言"已登记"）：
 *   - ACCOUNT.CONNECT：需要 event.sender（WebContents）驱动沙箱会话
 *   - AUTOMATION.START_CAMPAIGN：放行后会真实调用 n8n / Supabase（外部副作用）
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

const userDataDir = path.join(os.tmpdir(), 'kone-batch3-migration-test')

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
const autopilotPath = '../dist-electron/electron/services/autopilot-state-service.js'
const authPath = '../dist-electron/electron/services/auth-service.js'
const sandboxPath = '../dist-electron/electron/services/sandbox-service.js'
const automationPath = '../dist-electron/electron/services/automation-service.js'
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

test('第三批 plain 通道迁移：注册 / 自绑定 / 路由 / 信封 / 错误语义 / 启动门禁', async () => {
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
  const ipcAutopilot = makeIpcMain()
  const ipcAuth = makeIpcMain()
  const ipcSandbox = makeIpcMain()
  const ipcAutomation = makeIpcMain()

  const { registerAutopilotStateHandlers } = require(autopilotPath)
  const { registerAuthHandlers } = require(authPath)
  const { registerSandboxHandlers } = require(sandboxPath)
  const { registerAutomationHandlers } = require(automationPath)
  const { createLicenseService } = require(licensePath)

  registerAutopilotStateHandlers(ipcAutopilot, store)
  registerAuthHandlers(ipcAuth)
  registerSandboxHandlers(ipcSandbox, store)
  const { licenseGuard } = createLicenseService(store)
  registerAutomationHandlers(ipcAutomation, store, licenseGuard)

  const migrated = [
    // autopilot-state-service（3）
    IPC_CHANNELS.AUTOPILOT.GET_STATE,
    IPC_CHANNELS.AUTOPILOT.SET_STATE,
    IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY,
    // auth-service（3）
    IPC_CHANNELS.AUTH.LOGIN,
    IPC_CHANNELS.AUTH.LOGOUT,
    IPC_CHANNELS.AUTH.GET_SESSION,
    // sandbox-service（3）
    IPC_CHANNELS.ACCOUNT.CONNECT,
    IPC_CHANNELS.ACCOUNT.DISCONNECT,
    IPC_CHANNELS.ACCOUNT.GET_LIST,
    // automation-service（1）
    IPC_CHANNELS.AUTOMATION.START_CAMPAIGN,
  ]

  // 1) 十个 plain 通道确实登记进 registry
  const channels = registry.channels
  for (const ch of migrated) {
    assert.ok(channels.includes(ch), `通道应经 registry 注册: ${ch}`)
  }

  // 2) 自绑定兼容层生效：各 register*Handlers 末尾的 registry.attach 把通道落到各自的 ipcMain
  assert.ok(
    ipcAutopilot.handled.has(IPC_CHANNELS.AUTOPILOT.GET_STATE),
    'autopilot 自绑定：GET_STATE 应落到 registerAutopilotStateHandlers 的 ipcMain',
  )
  assert.ok(
    ipcAuth.handled.has(IPC_CHANNELS.AUTH.GET_SESSION),
    'auth 自绑定：GET_SESSION 应落到 registerAuthHandlers 的 ipcMain',
  )
  assert.ok(
    ipcSandbox.handled.has(IPC_CHANNELS.ACCOUNT.GET_LIST),
    'sandbox 自绑定：GET_LIST 应落到 registerSandboxHandlers 的 ipcMain',
  )
  assert.ok(
    ipcAutomation.handled.has(IPC_CHANNELS.AUTOMATION.START_CAMPAIGN),
    'automation 自绑定：START_CAMPAIGN 应落到 registerAutomationHandlers 的 ipcMain',
  )

  // 3) 路由往返 + 5) dev 模式契约校验可过
  const state = await registry.dispatch(IPC_CHANNELS.AUTOPILOT.GET_STATE, {})
  assert.equal(state.success, true, 'autopilot:get-state 应成功（信封契约校验通过）')
  assert.ok(state.data && typeof state.data.stateKind === 'string', 'autopilot:get-state 应回传 stateKind')

  const written = await registry.dispatch(IPC_CHANNELS.AUTOPILOT.SET_STATE, {}, { state: { a: 1 } })
  assert.equal(written.success, true, 'autopilot:set-state 应成功')
  const reread = await registry.dispatch(IPC_CHANNELS.AUTOPILOT.GET_STATE, {})
  assert.equal(reread.success, true, 'autopilot:get-state 二次读取应成功')
  assert.equal(reread.data.stateKind, 'queued_idle', '写入后应可读回 queued_idle 状态')

  const cleared = await registry.dispatch(IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY, {})
  assert.equal(cleared.success, true, 'autopilot:clear-legacy 应成功')

  // auth GET_SESSION：用回归开关拿到确定性成功信封（避免真实会话态依赖）
  const previousRegression = process.env.KONE_REGRESSION_TEST
  process.env.KONE_REGRESSION_TEST = '1'
  const session = await registry.dispatch(IPC_CHANNELS.AUTH.GET_SESSION, {})
  if (previousRegression === undefined) delete process.env.KONE_REGRESSION_TEST
  else process.env.KONE_REGRESSION_TEST = previousRegression
  assert.equal(session.success, true, 'auth:get-session 应成功（信封契约校验通过）')
  assert.ok(session.data && session.data.authenticated === true, 'auth:get-session 应回传 authenticated')

  const logout = await registry.dispatch(IPC_CHANNELS.AUTH.LOGOUT, {})
  assert.equal(typeof logout?.success, 'boolean', 'auth:logout 应返回结构化信封')

  // 4) 业务错误语义未被迁移改变：空 accountId 仍返回 400
  const badDisconnect = await registry.dispatch(IPC_CHANNELS.ACCOUNT.DISCONNECT, {}, { accountId: '' })
  assert.equal(badDisconnect.success, false, '空 accountId 应被拒绝')
  assert.equal(badDisconnect.code, 400, '空 accountId 应带 400 状态码（非契约校验失败）')

  const list = await registry.dispatch(IPC_CHANNELS.ACCOUNT.GET_LIST, {})
  assert.equal(list.success, true, 'account:get-list 应成功（信封契约校验通过）')
  assert.ok(list.data && Array.isArray(list.data.accounts), 'account:get-list 应回传 accounts 数组')

  // 6) 启动门禁断言机制对迁移通道生效
  for (const ch of migrated) {
    registry.assertRegistered(ch)
  }
  assert.throws(() => registry.assertRegistered('batch3:not-migrated'), /未注册/, 'assertRegistered 应对未注册通道抛错')

  console.log('[batch3-migration] registry 已登记通道:', channels.filter((c) => migrated.includes(c)).join(', '))
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
