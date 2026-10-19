/**
 * ipc-license-gate-d1-d6.test.ts
 *
 * 回归测试：2026-10-19 确认的两处 Fail-Closed 授权缺陷
 *
 *   D1 · `AUTOMATION.QUEUE_OUTREACH` 只挂 `ensureTrialAccess`、缺 `requireFeature('cloud_send')`
 *        → 活跃 Trial 与 Basic 可直连云端投递入队（cloud_send 属 Premium）。
 *
 *   D6 · `ACCOUNT.CONNECT / DISCONNECT / GET_LIST` 的非高级分支误用 `search_basic`
 *        作为代理键，而 `search_basic ∈ TRIAL_FEATURES`
 *        → 活跃 Trial 可绑定 / 查看真实邮箱账号（违反 PRD §六.0 熔断要求）。
 *
 * ── 关键前提（根因，见 docs/reports/ipc-plain-register-license-mapping-2026-10-19.md §1.1）
 *   `ensureTrialAccess` 只拦「过期 / 未授权」，**不是付费墙**；
 *   `requireFeature` 在 `!app.isPackaged` 时无条件放行（dev 旁路）。
 *   因此本文件必须把 electron mock 设为 `isPackaged: true` 且清掉
 *   `KONE_REGRESSION_TEST`，否则门禁被旁路、断言将全部假通过。
 *
 * 三态矩阵：活跃 Trial / 已过期 / 付费 Basic（+ Premium 对照组）。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const Module = require('node:module')

// 复核：不得处于回归测试旁路，否则门禁失效
delete process.env.KONE_REGRESSION_TEST

const originalLoad = Module._load
const userDataDir = path.join(os.tmpdir(), 'kone-license-gate-d1-d6-test')

/* 打包态（isPackaged=true）→ 授权门禁真实生效 */
const electronMock = {
  app: {
    isPackaged: true,
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
    getVersion: () => '1.4.36',
    getAppPath: () => process.cwd(),
    disableHardwareAcceleration() {},
  },
  safeStorage: {
    /* 必须可用：license claims 经 secret-manager 的 safeStorage 加密落盘。
       置 false 会让 writeSecretMap/readSecretMap 抛错 → 门禁恒读到 null。 */
    isEncryptionAvailable: () => true,
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

const DIST = path.join(__dirname, '..', 'dist-electron', 'electron')
const PATHS = {
  registry: path.join(DIST, 'ipc/registry.js'),
  channels: path.join(DIST, 'ipc/channels.js'),
  licenseGuard: path.join(DIST, 'security/license-guard.js'),
  licenseService: path.join(DIST, 'services/license-service.js'),
  sandbox: path.join(DIST, 'services/sandbox-service.js'),
  automation: path.join(DIST, 'services/automation-service.js'),
  electronBridge: path.join(DIST, 'services/electron-bridge.js'),
  secretManager: path.join(DIST, 'services/secret-manager.js'),
  configService: path.join(DIST, 'services/config-service.js'),
}

const NOW = Date.now()
const PERSONAS = {
  /* 活跃 Trial：状态 active 且未过期 → ensureTrialAccess 放行（这正是缺陷的触发条件） */
  trial: {
    status: 'active',
    plan: 'trial',
    expiresAt: NOW + 86400000,
    features: ['search_basic', 'lead_export'],
    licenseKey: 'trial-key',
    machineId: 'test-machine',
  },
  /* 付费 Basic：拥有 local_autopilot，但**不含** cloud_send */
  basic: {
    status: 'active',
    plan: 'basic',
    expiresAt: NOW + 86400000,
    features: ['search_basic', 'search_deep', 'analysis_basic', 'analysis_advanced', 'lead_export', 'local_autopilot'],
    licenseKey: 'basic-key',
    machineId: 'test-machine',
  },
  expired: {
    status: 'expired',
    plan: 'trial',
    expiresAt: NOW - 86400000,
    features: ['search_basic', 'lead_export'],
    licenseKey: 'stale-key',
    machineId: 'test-machine',
  },
  /* 对照组：Premium 具备 cloud_send + team_collaboration */
  premium: {
    status: 'active',
    plan: 'premium',
    expiresAt: NOW + 86400000,
    features: [
      'search_basic',
      'search_deep',
      'analysis_basic',
      'analysis_advanced',
      'lead_export',
      'local_autopilot',
      'export_full',
      'cloud_send',
      'team_collaboration',
    ],
    licenseKey: 'premium-key',
    machineId: 'test-machine',
  },
}

const EMAIL_ACCOUNT = {
  accountId: 'kone_acct_seed_email',
  accountType: 'email_smtp',
  label: 'seed@example.com',
  email: 'seed@example.com',
  status: 'connected',
  connectedAt: new Date(NOW).toISOString(),
  lastCheckedAt: new Date(NOW).toISOString(),
}

const makeStore = (personaKey, seedAccounts) => {
  const values = {
    'system.machineId': 'test-machine',
    'system.hardwareMachineId': 'test-machine',
  }
  if (seedAccounts) values.sandbox_accounts = seedAccounts
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

/** 每个用例重建模块级单例，避免 accounts / registry 跨用例污染 */
const loadHarness = (personaKey, options = {}) => {
  fs.mkdirSync(userDataDir, { recursive: true })

  for (const p of Object.values(PATHS)) {
    try {
      delete require.cache[require.resolve(p)]
    } catch {
      /* module not yet loaded */
    }
  }

  /* license claims **不在 config store**，而在 secret-manager 的 kone-secrets.json。
     必须走真实 `setSecret` 通道写入，否则 `getStoredLicenseClaims()` 恒为 null，
     门禁会把所有套餐（含 Premium）一律按"未激活"拒绝。 */
  const { SECRET_KEYS } = require(PATHS.configService)
  const { setSecret } = require(PATHS.secretManager)
  setSecret(SECRET_KEYS.LICENSE_CLAIMS, JSON.stringify(PERSONAS[personaKey]))

  const { registry } = require(PATHS.registry)
  registry.resetRegistry()

  const { IPC_CHANNELS } = require(PATHS.channels)
  const { registerSandboxHandlers } = require(PATHS.sandbox)
  const { registerAutomationHandlers } = require(PATHS.automation)
  const { createLicenseService } = require(PATHS.licenseService)

  const store = makeStore(personaKey, options.seedAccounts)
  const ipcSandbox = makeIpcMain()
  const ipcAutomation = makeIpcMain()

  registerSandboxHandlers(ipcSandbox, store)
  const { licenseGuard } = createLicenseService(store)
  registerAutomationHandlers(ipcAutomation, store, licenseGuard)

  return { IPC_CHANNELS, ipcSandbox, ipcAutomation, registry }
}

const invoke = async (ipc, channel, args = []) => {
  const handler = ipc.handled.get(channel)
  assert.ok(handler, `通道应已注册: ${channel}`)
  /* sender 必须实现 isDestroyed()：GET_LIST 放行路径会调用它探测是否启动健康巡检轮询。
     传 `{}` 会在成功分支抛 TypeError，被 catch 吞成 success:false（假阴性）。 */
  return handler({ sender: { isDestroyed: () => true } }, ...args)
}

const assertFeatureDenied = (result, label) => {
  assert.equal(result?.success, false, `${label} 应被拒绝`)
  assert.equal(result?.error, 'FEATURE_DENIED', `${label} 应返回 FEATURE_DENIED，实际 ${result?.error}`)
  assert.equal(result?.code, 403, `${label} 应返回 403`)
}

const QUEUE_PAYLOAD = [{ leadId: 'lead-1', subject: 's', body: 'b', draftVersion: 1 }]

/* ──────────────────────────────────────────────
 * D1 · AUTOMATION.QUEUE_OUTREACH 付费墙
 * ────────────────────────────────────────────── */

test('D1 · 活跃 Trial 不可调用 QUEUE_OUTREACH（修复前会放行）', async () => {
  const { IPC_CHANNELS, ipcAutomation } = loadHarness('trial')
  const result = await invoke(ipcAutomation, IPC_CHANNELS.AUTOMATION.QUEUE_OUTREACH, QUEUE_PAYLOAD)
  assertFeatureDenied(result, 'Trial · 云端投递入队')
})

test('D1 · 付费 Basic 不可调用 QUEUE_OUTREACH（cloud_send 属 Premium）', async () => {
  const { IPC_CHANNELS, ipcAutomation } = loadHarness('basic')
  const result = await invoke(ipcAutomation, IPC_CHANNELS.AUTOMATION.QUEUE_OUTREACH, QUEUE_PAYLOAD)
  assertFeatureDenied(result, 'Basic · 云端投递入队')
})

test('D1 · 授权过期不可调用 QUEUE_OUTREACH', async () => {
  const { IPC_CHANNELS, ipcAutomation } = loadHarness('expired')
  const result = await invoke(ipcAutomation, IPC_CHANNELS.AUTOMATION.QUEUE_OUTREACH, QUEUE_PAYLOAD)
  assert.equal(result?.success, false, '过期授权应被拒绝')
  assert.equal(result?.code, 403, '过期授权应返回 403')
})

test('D1 · Premium 通过 gate（不再被 FEATURE_DENIED 拦截）', async () => {
  const { IPC_CHANNELS, ipcAutomation } = loadHarness('premium')
  let result
  try {
    result = await invoke(ipcAutomation, IPC_CHANNELS.AUTOMATION.QUEUE_OUTREACH, QUEUE_PAYLOAD)
  } catch (error) {
    // 缺云端配置时下游可能抛错——这仍证明授权门禁已放行
    result = { error: String(error?.message || error) }
  }
  assert.notEqual(result?.error, 'FEATURE_DENIED', 'Premium 不应被授权门禁拦截')
  assert.notEqual(result?.code, 403, 'Premium 不应收到 403 授权拒绝')
})

/* ──────────────────────────────────────────────
 * D6 · ACCOUNT.* 代理键（search_basic → local_autopilot）
 * ────────────────────────────────────────────── */

test('D6 · 活跃 Trial 不可读取账号列表（修复前会放行）', async () => {
  const { IPC_CHANNELS, ipcSandbox } = loadHarness('trial', { seedAccounts: [EMAIL_ACCOUNT] })
  const result = await invoke(ipcSandbox, IPC_CHANNELS.ACCOUNT.GET_LIST)
  assertFeatureDenied(result, 'Trial · 账号列表')
})

test('D6 · 付费 Basic 可读取账号列表（仅邮箱类）', async () => {
  const { IPC_CHANNELS, ipcSandbox } = loadHarness('basic', { seedAccounts: [EMAIL_ACCOUNT] })
  const result = await invoke(ipcSandbox, IPC_CHANNELS.ACCOUNT.GET_LIST)
  assert.equal(result?.success, true, 'Basic 应能读取账号列表')
  assert.ok(Array.isArray(result?.data?.accounts), '应回传 accounts 数组')
  for (const account of result.data.accounts) {
    assert.ok(account.accountType === 'email_smtp' || account.accountType === 'email_imap', 'Basic 只应看到邮箱类账号')
  }
})

test('D6 · 活跃 Trial 不可绑定账号（CONNECT 早期拦截）', async () => {
  const { IPC_CHANNELS, ipcSandbox } = loadHarness('trial')
  const result = await invoke(ipcSandbox, IPC_CHANNELS.ACCOUNT.CONNECT, [
    { accountType: 'email_smtp', label: 'trial@example.com' },
  ])
  assertFeatureDenied(result, 'Trial · 绑定账号')
})

test('D6 · 活跃 Trial 不可断开账号（DISCONNECT，账号已存在）', async () => {
  const { IPC_CHANNELS, ipcSandbox } = loadHarness('trial', { seedAccounts: [EMAIL_ACCOUNT] })
  const result = await invoke(ipcSandbox, IPC_CHANNELS.ACCOUNT.DISCONNECT, [{ accountId: EMAIL_ACCOUNT.accountId }])
  assertFeatureDenied(result, 'Trial · 断开账号')
})

test('D6 · 付费 Basic 可断开邮箱账号', async () => {
  const { IPC_CHANNELS, ipcSandbox } = loadHarness('basic', { seedAccounts: [EMAIL_ACCOUNT] })
  const result = await invoke(ipcSandbox, IPC_CHANNELS.ACCOUNT.DISCONNECT, [{ accountId: EMAIL_ACCOUNT.accountId }])
  assert.equal(result?.success, true, `Basic 应能断开邮箱账号，实际 ${JSON.stringify(result)}`)
})

test('D6 · Premium 可读取全部账号（不受邮箱类型限制）', async () => {
  const { IPC_CHANNELS, ipcSandbox } = loadHarness('premium', { seedAccounts: [EMAIL_ACCOUNT] })
  const result = await invoke(ipcSandbox, IPC_CHANNELS.ACCOUNT.GET_LIST)
  assert.equal(result?.success, true, 'Premium 应能读取账号列表')
  assert.ok(Array.isArray(result?.data?.accounts), '应回传 accounts 数组')
})

test.after(() => {
  try {
    require(PATHS.registry).registry.resetRegistry()
  } catch {
    /* best effort cleanup */
  }
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* best effort cleanup */
  }
  Module._load = originalLoad
})
