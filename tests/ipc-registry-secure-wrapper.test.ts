/**
 * ipc-registry-secure-wrapper.test.ts
 *
 * 验证 Fail-Closed 授权包装器（registerSecureIpc / registerSecureFeatureIpc）的治理登记：
 * 第四批收口后，仅余 20 处经包装器登记的通道未完成 registry 迁移。本测试证明——
 * 在不改变 production 绑定（`ipcMain.handle`）与 Fail-Closed 授权语义的前提下，
 * 包装器也把通道登记进注册中心（skipAttach，供未来 assertAllRegistered 门禁覆盖）。
 *
 * 验证项：
 *   1. 经包装器登记的通道确实出现在 registry.channels（治理事实可见）
 *   2. registry 条目标记 skipAttach：attach() 不会重复绑定，production ipcMain.handle 绑定保留
 *   3. 真实 ipcMain.handle 绑定仍生效（历史 e2e / 渲染层调用形态零变化）
 *   4. Fail-Closed 仍生效：被拒授权返回 403 信封（dev 模式 ensureTrialAccess 旁路、requireFeature 抛错）
 *   5. 授权通过时 handler 正常返回（授权语义未被治理登记破坏）
 *
 * 测试在 dev 形态（app.isPackaged=false）下运行：ensureTrialAccess 旁路返回 null，
 * 授权判定完全由传入的 mock licenseGuard 决定，从而确定性地验证 Fail-Closed 与放行。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const Module = require('node:module')

const originalLoad = Module._load

const userDataDir = path.join(os.tmpdir(), 'kone-secure-wrapper-test')

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
const licensePath = '../dist-electron/electron/services/license-service.js'

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

// Fail-Closed 拒绝态：requireFeature / requireAnyFeature 一律抛出 403
const denyGuard = {
  getStoredClaims: () => null,
  requireFeature: () => {
    throw Object.assign(new Error('当前授权无权执行该操作'), { code: 403 })
  },
  requireAnyFeature: () => {
    throw Object.assign(new Error('当前授权无权执行该操作'), { code: 403 })
  },
}

// 授权通过态：requireFeature / requireAnyFeature 返回 claims + featureSet
const allowGuard = {
  getStoredClaims: () => null,
  requireFeature: () => ({ claims: {}, featureSet: new Set() }),
  requireAnyFeature: () => ({ claims: {}, featureSet: new Set() }),
}

test('Fail-Closed 包装器治理登记：registry 可见 + 绑定保留 + 403 / 放行', async () => {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* dir may not exist */
  }
  fs.mkdirSync(userDataDir, { recursive: true })

  const { registry } = require(registryPath)
  const { registerSecureFeatureIpc } = require(licensePath)

  registry.resetRegistry()

  const ipcDeny = makeIpcMain()
  const ipcAllow = makeIpcMain()
  const okHandler = async () => ({ success: true, data: 'ok' })

  // 1) + 2) + 3) 治理登记 + skipAttach + production 绑定保留
  registerSecureFeatureIpc(ipcDeny, 'test:secure-denied', undefined, denyGuard, 'some_feature', okHandler, '测试操作')
  assert.ok(registry.channels.includes('test:secure-denied'), '包装器通道应登记进 registry')
  assert.ok(ipcDeny.handled.has('test:secure-denied'), 'production ipcMain.handle 绑定应保留（零行为变化）')
  const dumped = registry.dumpRegistry().find((d) => d.channel === 'test:secure-denied')
  assert.ok(dumped && dumped.skipAttach === true, '治理登记条目应标记 skipAttach（attach 不重复绑定）')

  // 4) Fail-Closed 仍生效：被拒授权返回 403 信封
  const denied = await registry.dispatch('test:secure-denied', {})
  assert.equal(denied.success, false, '被拒授权应返回失败信封')
  assert.equal(denied.code, 403, '被拒授权应带 403 状态码（Fail-Closed 未因治理登记而失效）')
  assert.equal(denied.error, 'FEATURE_DENIED', '被拒授权应带 FEATURE_DENIED 标记')

  // 5) 授权通过时 handler 正常返回（授权语义未被破坏）
  registerSecureFeatureIpc(
    ipcAllow,
    'test:secure-allowed',
    undefined,
    allowGuard,
    'some_feature',
    okHandler,
    '测试操作',
  )
  const allowed = await registry.dispatch('test:secure-allowed', {})
  assert.equal(allowed.success, true, '授权通过应放行')
  assert.equal(allowed.data, 'ok', '授权通过后 handler 应正常返回')

  console.log('[secure-wrapper] 治理登记通道:', registry.channels.filter((c) => c.startsWith('test:secure')).join(', '))
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
