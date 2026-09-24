/**
 * ipc-registry-provider-migration.test.ts
 *
 * 验证 PROVIDER 服务作为首批经 `registerIpc()` 收敛到注册中心的迁移批次：
 *   1. 两个通道确实登记进全局 registry（而非直挂 ipcMain.handle）
 *   2. registry.dispatch 能路由到真实 handler 并返回符合契约的形状
 *   3. dev 模式下请求/响应契约校验可过（证明契约定义准确）
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

const userDataDir = path.join(os.tmpdir(), 'kone-provider-migration-test')

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
const providerServicePath = '../dist-electron/electron/services/provider-service.js'

test('PROVIDER 服务经 registry.registerIpc 迁移：注册 / 路由 / 契约校验 / 启动门禁', async () => {
  const { registry } = require(registryPath)
  const { IPC_CHANNELS } = require(channelsPath)
  const { registerProviderHandlers } = require(providerServicePath)

  registry.resetRegistry()

  const store = {
    get: () => undefined,
    set: () => {},
    path: path.join(userDataDir, 'kone-config.json'),
  }
  registerProviderHandlers({ handle() {}, on() {}, removeHandler() {} }, store)

  // 1) 两个通道确实登记进 registry（而非直挂 ipcMain.handle）
  const channels = registry.channels
  assert.ok(channels.includes(IPC_CHANNELS.PROVIDER.LIST), 'provider:list 应经 registry 注册')
  assert.ok(channels.includes(IPC_CHANNELS.PROVIDER.STATUS), 'provider:status 应经 registry 注册')

  // 2) dispatch 路由到真实 handler
  const list = await registry.dispatch(IPC_CHANNELS.PROVIDER.LIST, {})
  assert.ok(Array.isArray(list), 'provider:list 应返回数组')
  assert.ok(list.length > 0, 'provider:list 应至少列出一个 provider')
  assert.ok(
    list.every(
      (p) =>
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.available === 'boolean' &&
        Array.isArray(p.requiredConfig),
    ),
    'list 元素形状符合契约（id/name/available/requiredConfig）',
  )

  // 3) dev 模式下请求/响应契约校验可过
  const known = await registry.dispatch(IPC_CHANNELS.PROVIDER.STATUS, {}, 'google-leads')
  assert.ok(
    known === null || (typeof known === 'object' && typeof known.id === 'string'),
    'provider:status 返回对象或 null',
  )

  const unknown = await registry.dispatch(IPC_CHANNELS.PROVIDER.STATUS, {}, 'no-such-provider-id')
  assert.equal(unknown, null, '未知 provider id 返回 null（契约允许 any/null）')

  // 4) 启动门禁断言机制对迁移通道生效
  registry.assertRegistered(IPC_CHANNELS.PROVIDER.LIST)
  registry.assertRegistered(IPC_CHANNELS.PROVIDER.STATUS)
  assert.throws(
    () => registry.assertRegistered('provider:not-migrated'),
    /未注册/,
    'assertRegistered 应对未注册通道抛错',
  )

  console.log('[provider-migration] registry 已登记通道:', channels.filter((c) => c.startsWith('provider:')).join(', '))
})

test.after(() => {
  try {
    require(registryPath).registry.resetRegistry()
  } catch {
    /* 清理全局注册中心单例，避免污染同进程的其它测试文件 */
  }
  Module._load = originalLoad
})
