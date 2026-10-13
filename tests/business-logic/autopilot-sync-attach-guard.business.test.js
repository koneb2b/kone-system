/**
 * autopilot-sync-attach-guard.business.test.js
 *
 * ## 背景（2026-10-12 打包版数据交互审计发现的真实缺陷）
 * `AUTOPILOT.SYNC_STATE`（'sync-autopilot-state'）在 `main.ts` 的 `whenReady()` 中**晚于**
 * `registerIpcHandlers()` 登记。而 `registerIpcHandlers()` 末尾才执行 `registry.attach(ipcMain)`
 * —— 该 `attach()` 只对"登记时刻已存在的通道"做真实 `ipcMain.handle` 绑定。
 * 后果：SYNC_STATE **永远不绑定到 ipcMain**，渲染层调用恒得
 * `No handler registered for 'sync-autopilot-state'`，系统托盘巡航状态永不更新
 * （实测：打包版每次 dashboard 挂载都写 ERROR 日志）。
 *
 * ## 本测试锁定的不变量
 *   ① 源码结构：`IPC_CHANNELS.AUTOPILOT.SYNC_STATE` 的 `registerIpc(...)` 调用必须出现在
 *      `registerIpcHandlers()` 调用**之前**（剥离注释后判定，避免被说明性注释误导）
 *   ② 机制演示：向 registry 登记 A → attach（A 绑定）→ 再登记 B → **不**再次 attach ⇒ B 不绑定；
 *      再 attach ⇒ B 绑定。证明「晚登记 + 不补 attach = 死通道」这一失败模式真实存在，
 *      且 `attach()` 幂等、可补齐晚登记通道（这正是修复所依赖的机制）
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const MAIN_SRC = path.join(ROOT, 'electron', 'main.ts')
const registryPath = path.join(ROOT, 'dist-electron', 'electron', 'ipc', 'registry.js')

/** 剥离 // 与 /* *\/ 注释（保留字符串内的 http:// —— 判定用 \s// 前缀避免误伤） */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n]*/g, '')

test('SYNC_STATE 的 registerIpc 必须先于 registerIpcHandlers()（否则永不绑定 ipcMain）', () => {
  const src = stripComments(fs.readFileSync(MAIN_SRC, 'utf8'))
  const idxSync = src.indexOf('IPC_CHANNELS.AUTOPILOT.SYNC_STATE')
  const idxInvoke = src.indexOf('registerIpcHandlers()')
  assert.notEqual(idxSync, -1, '未找到 SYNC_STATE 登记点（通道名或写法变更？）')
  assert.notEqual(idxInvoke, -1, '未找到 registerIpcHandlers() 调用点')
  assert.ok(
    idxSync < idxInvoke,
    `SYNC_STATE 必须登记在 registerIpcHandlers() 之前；当前 idxSync=${idxSync} idxInvoke=${idxInvoke}。` +
      '若晚于 registerIpcHandlers（其末尾 attach），该通道将永远不绑定到 ipcMain。',
  )
})

test('机制演示：晚登记且不补 attach 的通道确实不会被绑定（失败模式可复现）', () => {
  const { registry } = require(registryPath)
  registry.resetRegistry()

  const bound = new Set()
  const ipcMain = {
    handle: (channel) => {
      bound.add(channel)
    },
  }
  const anyEntry = {
    contract: { channel: '', requestRule: { type: 'any' }, responseRule: { type: 'any' } },
    handler: async () => null,
  }

  // A 在 attach 之前登记 → attach 时绑定
  registry.register('probe:early', anyEntry)
  registry.attach(ipcMain)
  assert.ok(bound.has('probe:early'), '早登记通道应被 attach 绑定')

  // B（模拟 SYNC_STATE）在 attach 之后登记 → 不补 attach ⇒ 不绑定（失败模式）
  registry.register('probe:late', anyEntry)
  assert.ok(!bound.has('probe:late'), '晚登记且未补 attach 的通道不应被绑定（复现死通道）')

  // 补一次 attach（幂等）⇒ 晚登记通道被补齐（修复所依赖的机制）
  registry.attach(ipcMain)
  assert.ok(bound.has('probe:late'), '幂等 attach 应补齐晚登记通道')

  registry.resetRegistry()
})
