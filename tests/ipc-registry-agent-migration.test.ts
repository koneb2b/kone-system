/**
 * ipc-registry-agent-migration.test.ts
 *
 * 验证 agent-service 第二批经 `registerIpc()` 收敛到注册中心的 6 个 plain 通道：
 *   AGENT.LIST / AGENT.GET_LOG / AGENT.GET_STATUS /
 *   AGENT.SUPPRESS_LIST / AGENT.SUPPRESS_ADD / AGENT.SUPPRESS_REMOVE
 * 以及 `AGENT.CONTROL` 仍由 `registerSecureFeatureIpc` 包装（Fail-Closed 授权语义保留）；
 * 该包装通道现已**治理登记**进注册中心（`skipAttach`，真实 ipcMain.handle 绑定仍由包装器完成）。
 *
 * 验证项：
 *   1. 六个 plain 通道确实登记进全局 registry
 *   2. registry.dispatch 能路由到真实 handler 并返回结构化信封 { success, ... }
 *   3. GET_STATUS 空 leadKey 仍返回 400 信封（证明迁移未改变错误语义）
 *   4. AGENT.CONTROL 已治理登记进 registry（skipAttach）+ 仍由 registerSecureFeatureIpc 绑定到 ipcMain
 *      （Fail-Closed 授权包装未被绕过，仅新增"已知已注册"事实）
 *   5. dev 模式下响应契约校验可过（证明响应始终为信封形状）
 *   6. assertRegistered 启动门禁断言机制对迁移通道生效
 *
 * 测试在 dev 形态（app.isPackaged=false）下运行，以真实触发契约校验。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')

const originalLoad = Module._load

const userDataDir = path.join(os.tmpdir(), 'kone-agent-migration-test')

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
const agentServicePath = '../dist-electron/electron/services/agent-service.js'

test('agent-service 经 registry.registerIpc 迁移：6 plain 通道注册 / 路由 / 信封 / CONTROL 保留 / 启动门禁', async () => {
  const { registry } = require(registryPath)
  const { IPC_CHANNELS } = require(channelsPath)
  const { registerAgentHandlers, stopFollowupScheduler } = require(agentServicePath)

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
  // ipcMain 仅用于 AGENT.CONTROL 的 Fail-Closed 包装；plain 通道改经 registry 绑定
  const handled = new Map()
  const ipcMain = {
    handle(channel, _handler) {
      handled.set(channel, _handler)
    },
    on() {},
    removeHandler() {},
  }

  registerAgentHandlers(ipcMain, store)

  const migratedChannels = [
    IPC_CHANNELS.AGENT.LIST,
    IPC_CHANNELS.AGENT.GET_LOG,
    IPC_CHANNELS.AGENT.GET_STATUS,
    IPC_CHANNELS.AGENT.SUPPRESS_LIST,
    IPC_CHANNELS.AGENT.SUPPRESS_ADD,
    IPC_CHANNELS.AGENT.SUPPRESS_REMOVE,
  ]

  // 1) 六个 plain 通道确实登记进 registry
  const channels = registry.channels
  for (const ch of migratedChannels) {
    assert.ok(channels.includes(ch), `agent 通道应经 registry 注册: ${ch}`)
  }

  // 4) AGENT.CONTROL 治理登记进 registry（skipAttach）+ 仍由 registerSecureFeatureIpc 绑定到 ipcMain
  //    （Fail-Closed 授权语义零变化，只是新增"已知已注册"事实，供 assertAllRegistered 门禁覆盖）
  assert.ok(channels.includes(IPC_CHANNELS.AGENT.CONTROL), 'AGENT.CONTROL 应治理登记进 registry（供门禁覆盖）')
  const controlDump = registry.dumpRegistry().find((d) => d.channel === IPC_CHANNELS.AGENT.CONTROL)
  assert.ok(
    controlDump && controlDump.skipAttach === true,
    'AGENT.CONTROL 治理登记应标记 skipAttach（attach 不重复绑定）',
  )
  assert.ok(
    handled.has(IPC_CHANNELS.AGENT.CONTROL),
    'AGENT.CONTROL 仍应经 registerSecureFeatureIpc 绑定到 ipcMain（Fail-Closed 零变化）',
  )

  // 2) 路由往返：LIST 返回信封
  const list = await registry.dispatch(IPC_CHANNELS.AGENT.LIST, {})
  assert.equal(list.success, true, 'agent:list 应成功')
  assert.ok(
    list.data && typeof list.data === 'object' && Array.isArray(list.data.agents),
    'agent:list 信封应含 agents 数组',
  )

  // GET_LOG 返回信封（dev 模式响应契约校验可过）
  const log = await registry.dispatch(IPC_CHANNELS.AGENT.GET_LOG, {}, 'agent-email')
  assert.equal(log.success, true, 'agent:get-log 应成功')
  assert.ok(log.data && Array.isArray(log.data.logEntries), 'agent:get-log 信封应含 logEntries 数组')

  // GET_STATUS 返回信封
  const status = await registry.dispatch(IPC_CHANNELS.AGENT.GET_STATUS, {}, 'some-lead')
  assert.equal(status.success, true, 'agent:get-status 应成功')
  assert.ok(status.data && status.data.leadKey === 'some-lead', 'agent:get-status 信封应回传 leadKey')

  // 3) GET_STATUS 空 leadKey 仍返回 400 信封（迁移未改变错误语义）
  const badStatus = await registry.dispatch(IPC_CHANNELS.AGENT.GET_STATUS, {}, '')
  assert.equal(badStatus.success, false, '空 leadKey 应被拒绝')
  assert.equal(badStatus.code, 400, '空 leadKey 应带 400 状态码')

  // SUPPRESS_LIST 返回信封
  const sl = await registry.dispatch(IPC_CHANNELS.AGENT.SUPPRESS_LIST, {})
  assert.equal(sl.success, true, 'agent:suppress-list 应成功')
  assert.ok(sl.data && Array.isArray(sl.data.entries), 'agent:suppress-list 信封应含 entries 数组')

  // SUPPRESS_ADD / SUPPRESS_REMOVE 往返
  const sa = await registry.dispatch(IPC_CHANNELS.AGENT.SUPPRESS_ADD, {}, { email: 'x@y.com', reason: 'manual' })
  assert.equal(sa.success, true, 'agent:suppress-add 应成功')
  const sr = await registry.dispatch(IPC_CHANNELS.AGENT.SUPPRESS_REMOVE, {}, { email: 'x@y.com' })
  assert.equal(sr.success, true, 'agent:suppress-remove 应成功')

  // 6) 启动门禁断言机制对迁移通道生效
  for (const ch of migratedChannels) {
    registry.assertRegistered(ch)
  }
  assert.throws(() => registry.assertRegistered('agent:not-migrated'), /未注册/, 'assertRegistered 应对未注册通道抛错')

  stopFollowupScheduler()

  console.log(
    '[agent-migration] registry 已登记 agent 通道:',
    channels.filter((c) => c.startsWith('agent:')).join(', '),
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
