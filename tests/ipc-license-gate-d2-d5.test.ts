/**
 * ipc-license-gate-d2-d5.test.ts
 *
 * 回归测试：2026-10-19 收口的四处 plain `registerIpc` 授权缺口
 * （映射与裁决见 docs/reports/ipc-plain-register-license-mapping-2026-10-19.md §3/§4）
 *
 *   D2 · `CLOUD.CREATE_APPROVAL` / `CLOUD.LIST_APPROVALS` 此前**无任何门禁**
 *        → 活跃 Trial 与 Basic 均可读写云端审批记录（审批是 cloud_send 服务端二次门禁的前置）。
 *        修复：`cloud_send`（Premium 起）。
 *
 *   D3 · `CONFIG.SET` 通道**必须**保持免门禁（否则锁死 Trial 的 ICP/密钥配置 = 激活死锁），
 *        但 `cloud.*` 命名空间此前对任意套餐可写 → Trial/Basic 可配置高级版云端能力。
 *        修复：**key 级**校验，`cloud.*` 需 `cloud_send`；读端与其它 key 完全不变。
 *
 *   D4 · `AUTOMATION.IMAP_STATUS / IMAP_RESTART / IMAP_TEST_CONNECTION` 此前**无门禁**
 *        → Trial 可读取/重启/探测本地邮件回信服务（Agent 域状态，PRD §6.0 禁暴露）。
 *        修复：`local_autopilot`（Paid Basic 起，AGENTS.md 允许 Basic 用低量本地 Email）。
 *
 *   D5 · `AUTOPILOT.CLEAR_LEGACY` 此前**无门禁** → Trial 可清理巡航遗留节点。
 *        修复：`local_autopilot`（与同族 AUTOPILOT.* 一致）。
 *
 * ── 关键前提（与 d1-d6 套件同源）
 *   `requireFeature` 在 `!app.isPackaged` 时无条件放行（dev 旁路），
 *   因此必须 `isPackaged: true` 且清掉 `KONE_REGRESSION_TEST`，否则断言会假通过。
 *   license claims 由 secret-manager 写入 `kone-secrets.json`（**不是** config store）。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const Module = require('node:module')

delete process.env.KONE_REGRESSION_TEST

const originalLoad = Module._load
const userDataDir = path.join(os.tmpdir(), 'kone-license-gate-d2-d5-test')

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
    // 必须可用：否则 secret-manager 读写抛错 → 门禁恒读到 null（全员被拒）。
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
  licenseService: path.join(DIST, 'services/license-service.js'),
  configService: path.join(DIST, 'services/config-service.js'),
  autopilotState: path.join(DIST, 'services/autopilot-state-service.js'),
  imapReply: path.join(DIST, 'services/imap-reply-service.js'),
  cloudflare: path.join(DIST, 'services/cloudflare-service.js'),
  electronBridge: path.join(DIST, 'services/electron-bridge.js'),
  secretManager: path.join(DIST, 'services/secret-manager.js'),
}

const NOW = Date.now()
const PERSONAS = {
  /* 活跃 Trial：无 local_autopilot、无 cloud_send —— 四处缺陷的共同触发者 */
  trial: {
    status: 'active',
    plan: 'trial',
    expiresAt: NOW + 86400000,
    features: ['search_basic', 'lead_export'],
    licenseKey: 'trial-key',
    machineId: 'test-machine',
  },
  /* 付费 Basic：有 local_autopilot；**无** cloud_send */
  basic: {
    status: 'active',
    plan: 'basic',
    expiresAt: NOW + 86400000,
    features: ['search_basic', 'search_deep', 'analysis_basic', 'analysis_advanced', 'lead_export', 'local_autopilot'],
    licenseKey: 'basic-key',
    machineId: 'test-machine',
  },
  /* Premium：cloud_send + local_autopilot 齐全 */
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

const makeStore = () => {
  const values = {
    'system.machineId': 'test-machine',
    'system.hardwareMachineId': 'test-machine',
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

/** 每个用例重建模块级单例，避免 registry / accounts 等跨用例污染 */
const loadHarness = (personaKey, options = {}) => {
  fs.mkdirSync(userDataDir, { recursive: true })

  for (const p of Object.values(PATHS)) {
    try {
      delete require.cache[require.resolve(p)]
    } catch {
      /* module not yet loaded */
    }
  }

  const { SECRET_KEYS } = require(PATHS.configService)
  const { setSecret } = require(PATHS.secretManager)
  setSecret(SECRET_KEYS.LICENSE_CLAIMS, JSON.stringify(PERSONAS[personaKey]))

  const { registry } = require(PATHS.registry)
  registry.resetRegistry()

  const { IPC_CHANNELS } = require(PATHS.channels)
  const { createLicenseService } = require(PATHS.licenseService)
  const { registerConfigHandlers } = require(PATHS.configService)
  const { registerAutopilotStateHandlers } = require(PATHS.autopilotState)
  const { registerImapReplyHandlers } = require(PATHS.imapReply)
  const { registerCloudflareHandlers } = require(PATHS.cloudflare)

  const store = makeStore()
  const ipc = makeIpcMain()

  // main.ts 注入的是**同一个** licenseGuard 实例；此处复刻该装配顺序。
  const { licenseGuard } = createLicenseService(store)
  const guard = options.omitGuard ? undefined : licenseGuard

  registerConfigHandlers(ipc, store, guard)
  registerAutopilotStateHandlers(ipc, store, guard)
  registerCloudflareHandlers(ipc, store, guard)
  registerImapReplyHandlers(ipc, store, guard, () => null)

  // 与 main.ts 的注册中心网关一致：把 registry 已登记的通道统一绑定到本 ipcMain
  // （attach 按 ipcMain 实例幂等，服务内自绑定不会重复）。
  registry.attach(ipc)

  return { IPC_CHANNELS, ipc, registry }
}

const invoke = async (ipc, channel, args = []) => {
  const handler = ipc.handled.get(channel)
  assert.ok(handler, `通道应已注册: ${channel}`)
  // sender 需实现 isDestroyed()：部分放行路径会探测是否启动轮询。
  return handler({ sender: { isDestroyed: () => true } }, ...args)
}

const assertFeatureDenied = (result, label) => {
  assert.equal(result?.success, false, `${label} 应被拒绝`)
  assert.equal(result?.error, 'FEATURE_DENIED', `${label} 应返回 FEATURE_DENIED，实际 ${JSON.stringify(result)}`)
  assert.equal(result?.code, 403, `${label} 应返回 403`)
}

const assertNotDenied = (result, label) => {
  assert.notEqual(result?.error, 'FEATURE_DENIED', `${label} 不应被付费墙拦截，实际 ${JSON.stringify(result)}`)
}

/* ──────────────────────────────────────────────
 * D2 · CLOUD.CREATE_APPROVAL / LIST_APPROVALS → cloud_send
 * ────────────────────────────────────────────── */

test('D2 · 活跃 Trial 不可提交云端审批（修复前会放行）', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('trial')
  const result = await invoke(ipc, IPC_CHANNELS.CLOUD.CREATE_APPROVAL, [
    { leadId: 'lead-1', draftVersion: 1, decision: 'approved' },
  ])
  assertFeatureDenied(result, 'Trial · 云端审批提交')
})

test('D2 · 付费 Basic 不可提交云端审批', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('basic')
  const result = await invoke(ipc, IPC_CHANNELS.CLOUD.CREATE_APPROVAL, [
    { leadId: 'lead-1', draftVersion: 1, decision: 'approved' },
  ])
  assertFeatureDenied(result, 'Basic · 云端审批提交')
})

test('D2 · Premium 通过 gate（不再被 FEATURE_DENIED 拦截）', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('premium')
  const result = await invoke(ipc, IPC_CHANNELS.CLOUD.CREATE_APPROVAL, [
    { leadId: 'lead-1', draftVersion: 1, decision: 'approved' },
  ])
  assertNotDenied(result, 'Premium · 云端审批提交')
})

test('D2 · 活跃 Trial 不可查询云端审批', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('trial')
  const result = await invoke(ipc, IPC_CHANNELS.CLOUD.LIST_APPROVALS, [{ limit: 10 }])
  assertFeatureDenied(result, 'Trial · 云端审批查询')
})

test('D2 · Premium 可查询云端审批', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('premium')
  const result = await invoke(ipc, IPC_CHANNELS.CLOUD.LIST_APPROVALS, [{ limit: 10 }])
  assertNotDenied(result, 'Premium · 云端审批查询')
})

/* ──────────────────────────────────────────────
 * D3 · CONFIG.SET 的 cloud.* key 级付费校验
 * ────────────────────────────────────────────── */

test('D3 · 活跃 Trial 不可写 cloud.* 配置', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('trial')
  const result = await invoke(ipc, IPC_CHANNELS.CONFIG.SET, [{ key: 'cloud.provider', value: 'cloudflare' }])
  assert.equal(result?.success, false, 'Trial 写 cloud.* 应被拒绝')
  assert.match(String(result?.error), /FEATURE_DENIED/, '应带 FEATURE_DENIED 标记')
  assert.equal(result?.code, 403)
})

test('D3 · 付费 Basic 不可写 cloud.* 配置', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('basic')
  const result = await invoke(ipc, IPC_CHANNELS.CONFIG.SET, [{ key: 'cloud.provider', value: 'cloudflare' }])
  assert.equal(result?.success, false, 'Basic 写 cloud.* 应被拒绝')
  assert.match(String(result?.error), /FEATURE_DENIED/)
  assert.equal(result?.code, 403)
})

test('D3 · Premium 可写 cloud.* 配置', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('premium')
  const result = await invoke(ipc, IPC_CHANNELS.CONFIG.SET, [{ key: 'cloud.provider', value: 'cloudflare' }])
  assert.equal(result?.success, true, `Premium 应能写入，实际 ${JSON.stringify(result)}`)
})

test('D3 · 活跃 Trial 仍可写普通配置（防激活死锁的回归锚点）', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('trial')
  const result = await invoke(ipc, IPC_CHANNELS.CONFIG.SET, [{ key: 'user_config', value: { foo: 1 } }])
  assert.equal(result?.success, true, `Trial 必须能继续配置 ICP/密钥，实际 ${JSON.stringify(result)}`)
})

test('D3 · cloud 前缀边界：`cloud` 与 `cloud.x` 拦截，`cloudx.x` 不拦截', async () => {
  const exact = await invoke(
    ...(() => {
      const { IPC_CHANNELS, ipc } = loadHarness('trial')
      return [ipc, IPC_CHANNELS.CONFIG.SET, [{ key: 'cloud', value: {} }]]
    })(),
  )
  assert.match(String(exact?.error), /FEATURE_DENIED/, '`cloud` 精确键应拦截')

  const lookalike = await invoke(
    ...(() => {
      const { IPC_CHANNELS, ipc } = loadHarness('trial')
      return [ipc, IPC_CHANNELS.CONFIG.SET, [{ key: 'cloudx.foo', value: 1 }]]
    })(),
  )
  assert.equal(lookalike?.success, true, '`cloudx.*` 不是 cloud 命名空间，不应误伤')
})

test('D3 · 未注入 licenseGuard 时 Fail-Closed（调用方漏传不得开口子）', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('premium', { omitGuard: true })
  const result = await invoke(ipc, IPC_CHANNELS.CONFIG.SET, [{ key: 'cloud.provider', value: 'cloudflare' }])
  assert.equal(result?.success, false, '缺少 guard 时必须拒绝而非放行')
  assert.match(String(result?.error), /FEATURE_DENIED/)
  assert.equal(result?.code, 403)
})

/* ──────────────────────────────────────────────
 * D4 · AUTOMATION.IMAP_* → local_autopilot
 * ────────────────────────────────────────────── */

test('D4 · 活跃 Trial 不可读取 IMAP 状态（修复前会放行）', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('trial')
  const result = await invoke(ipc, IPC_CHANNELS.AUTOMATION.IMAP_STATUS)
  assertFeatureDenied(result, 'Trial · IMAP 状态读取')
})

test('D4 · 付费 Basic 可读取 IMAP 状态', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('basic')
  const result = await invoke(ipc, IPC_CHANNELS.AUTOMATION.IMAP_STATUS)
  assertNotDenied(result, 'Basic · IMAP 状态读取')
})

test('D4 · 活跃 Trial 不可重启 IMAP 自动检测（且无副作用）', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('trial')
  const result = await invoke(ipc, IPC_CHANNELS.AUTOMATION.IMAP_RESTART)
  assertFeatureDenied(result, 'Trial · IMAP 自动检测重启')
})

test('D4 · 付费 Basic 可重启 IMAP 自动检测', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('basic')
  const result = await invoke(ipc, IPC_CHANNELS.AUTOMATION.IMAP_RESTART)
  assertNotDenied(result, 'Basic · IMAP 自动检测重启')
})

test('D4 · 活跃 Trial 不可测试 IMAP 连接（修复前会放行）', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('trial')
  const result = await invoke(ipc, IPC_CHANNELS.AUTOMATION.IMAP_TEST_CONNECTION)
  assertFeatureDenied(result, 'Trial · IMAP 连接测试')
})

test('D4 · 付费 Basic 可测试 IMAP 连接', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('basic')
  const result = await invoke(ipc, IPC_CHANNELS.AUTOMATION.IMAP_TEST_CONNECTION)
  assertNotDenied(result, 'Basic · IMAP 连接测试')
})

/* ──────────────────────────────────────────────
 * D5 · AUTOPILOT.CLEAR_LEGACY → local_autopilot
 * ────────────────────────────────────────────── */

test('D5 · 活跃 Trial 不可清理巡航遗留节点（修复前会放行）', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('trial')
  const result = await invoke(ipc, IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY)
  assertFeatureDenied(result, 'Trial · 巡航遗留清理')
})

test('D5 · 付费 Basic 可清理巡航遗留节点', async () => {
  const { IPC_CHANNELS, ipc } = loadHarness('basic')
  const result = await invoke(ipc, IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY)
  assert.equal(result?.success, true, `Basic 应能清理，实际 ${JSON.stringify(result)}`)
})

test.after(() => {
  try {
    require(PATHS.registry).registry.resetRegistry()
  } catch {
    /* best effort cleanup */
  }
})
