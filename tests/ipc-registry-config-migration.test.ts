/**
 * ipc-registry-config-migration.test.ts
 *
 * 验证 config-service（CONFIG.GET / CONFIG.SET / SECRET.SET / SECRET.CHECK，共 4 通道）
 * 经 `registerIpc()` 收敛到注册中心的迁移批次：
 *   1. 四个通道确实登记进全局 registry
 *   2. registry.dispatch 能路由到真实 handler 并返回结构化信封 { success, ... }
 *   3. dev 模式下响应契约校验可过（证明响应始终为信封形状）
 *   4. assertRegistered 启动门禁断言机制对迁移通道生效
 *
 * 测试在 dev 形态（app.isPackaged=false）下运行，以真实触发契约校验。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')

const originalLoad = Module._load

const userDataDir = path.join(os.tmpdir(), 'kone-config-migration-test')

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
  session: { defaultSession: { webRequest: { onBeforeSendHeaders() {} } } },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromNamedImage: () => ({ isEmpty: () => true }),
  },
  Tray: function () {
    return { setToolTip() {}, setContextMenu() {}, destroy() {} }
  },
}

const supabaseModuleMock = {
  createClient() {
    return {
      from() {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          neq() {
            return this
          },
          in() {
            return this
          },
          limit() {
            return this
          },
          single() {
            return Promise.resolve({ data: null, error: null })
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null })
          },
          upsert() {
            return Promise.resolve({ data: null, error: null })
          },
          insert() {
            return Promise.resolve({ data: null, error: null })
          },
          order() {
            return this
          },
        }
      },
      removeChannel() {},
      channel() {
        return {
          on() {
            return this
          },
          subscribe() {
            return this
          },
        }
      },
    }
  },
}

Module._load = function mockLoad(request, parent, isMain) {
  if (request === 'electron') return electronMock
  if (request === '@supabase/supabase-js') return supabaseModuleMock
  return originalLoad.call(this, request, parent, isMain)
}

const registryPath = '../dist-electron/electron/ipc/registry.js'
const channelsPath = '../dist-electron/electron/ipc/channels.js'
const configServicePath = '../dist-electron/electron/services/config-service.js'

test('config-service 经 registry.registerIpc 迁移：注册 / 路由 / 信封契约校验 / 启动门禁', async () => {
  const { registry } = require(registryPath)
  const { IPC_CHANNELS } = require(channelsPath)
  const { registerConfigHandlers } = require(configServicePath)

  registry.resetRegistry()

  const storeValues = {}
  const store = {
    get: (key) => storeValues[key],
    set: (key, value) => {
      storeValues[key] = value
    },
    flushSync: () => {},
    path: path.join(userDataDir, 'kone-config.json'),
  }
  registerConfigHandlers({ handle() {}, on() {}, removeHandler() {} }, store)

  // 1) 四个通道确实登记进 registry
  const channels = registry.channels
  assert.ok(channels.includes(IPC_CHANNELS.CONFIG.GET), 'config:get 应经 registry 注册')
  assert.ok(channels.includes(IPC_CHANNELS.CONFIG.SET), 'config:set 应经 registry 注册')
  assert.ok(channels.includes(IPC_CHANNELS.SECRET.SET), 'secret:set 应经 registry 注册')
  assert.ok(channels.includes(IPC_CHANNELS.SECRET.CHECK), 'secret:check 应经 registry 注册')

  // 2) CONFIG.GET 路由到真实 handler，返回信封（data 初值不假定——配置层可能注入默认值）
  const got = await registry.dispatch(IPC_CHANNELS.CONFIG.GET, {}, 'user_config')
  assert.ok(typeof got === 'object' && got !== null, 'config:get 应返回对象')
  assert.equal(got.success, true, '白名单配置项读取应成功')
  assert.ok('data' in got, 'config:get 信封应含 data 字段')

  // 3) CONFIG.SET 写入后 GET 可回读（dev 模式响应契约校验可过）
  const setResult = await registry.dispatch(IPC_CHANNELS.CONFIG.SET, {}, { key: 'user_config', value: { foo: 1 } })
  assert.equal(setResult.success, true, 'config:set 应成功')
  assert.equal(setResult.data, null, 'config:set 回执 data 为 null')
  const gotAgain = await registry.dispatch(IPC_CHANNELS.CONFIG.GET, {}, 'user_config')
  assert.ok(
    gotAgain.data && typeof gotAgain.data === 'object' && (gotAgain.data as { foo?: number }).foo === 1,
    '写入后 GET 应回读到 foo:1（证明 SET→GET 路由往返）',
  )

  // 4) SECRET.CHECK 返回信封（success 为布尔）
  const check = await registry.dispatch(IPC_CHANNELS.SECRET.CHECK, {}, 'anysearch-api-key')
  assert.ok(typeof check === 'object' && typeof check.success === 'boolean', 'secret:check 返回信封')

  // 5) SECRET.SET 非白名单 key 返回 403 信封（证明 handler 真实执行）
  const badSet = await registry.dispatch(IPC_CHANNELS.SECRET.SET, {}, { key: 'forbidden.key', value: 'x' })
  assert.equal(badSet.success, false, '非白名单密钥写入应被拒绝')
  assert.equal(badSet.code, 403, '拒绝应带 403 状态码')

  // 6) 启动门禁断言机制对迁移通道生效
  for (const ch of [
    IPC_CHANNELS.CONFIG.GET,
    IPC_CHANNELS.CONFIG.SET,
    IPC_CHANNELS.SECRET.SET,
    IPC_CHANNELS.SECRET.CHECK,
  ]) {
    registry.assertRegistered(ch)
  }
  assert.throws(() => registry.assertRegistered('config:not-migrated'), /未注册/, 'assertRegistered 应对未注册通道抛错')

  console.log(
    '[config-migration] registry 已登记通道:',
    channels.filter((c) => c.startsWith('config:') || c.startsWith('secret:')).join(', '),
  )
})

test.after(() => {
  try {
    require(registryPath).registry.resetRegistry()
  } catch {
    /* 清理全局注册中心单例，避免污染同进程的其它测试文件 */
  }
  Module._load = originalLoad
})
