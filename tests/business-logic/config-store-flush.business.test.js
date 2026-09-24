const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// P0-5 回归防护：NativeStore 落盘合并 + 防抖 + flushSync 强持久化。
//
// 缺陷背景：原 set() 每次调用都执行 全量 JSON.stringify + writeFileSync + fsync + rename，
// 而 Agent 写回一次会触发 2 次（agentStatus + 日志），搜索 50 条线索时高频放大。
//
// 测试隔离：electron-bridge 的 stub 把 userData 解析为 os.homedir()/.kone-config，
// 因此在 require 之前重定向 HOME/USERPROFILE 到仓库内临时目录即可完全避免污染真实用户目录。

const TEMP_HOME = path.join(process.cwd(), '.tmp-p05-home')
process.env.USERPROFILE = TEMP_HOME
process.env.HOME = TEMP_HOME

// 保证用例幂等：残留的临时目录会让"磁盘落后于内存"类断言读到上一轮的值。
// 某些受限环境会拒绝大量文件清理——此时放弃清理，让后续 set() 覆盖即可。
try {
  fs.rmSync(TEMP_HOME, { recursive: true, force: true })
} catch {
  /* env may refuse bulk delete; subsequent set() will overwrite the file */
}

// 统计对 kone-config.json 的真实磁盘写入次数（模块内通过 fs.writeFileSync 动态调用）
let configWrites = 0
const originalWriteFileSync = fs.writeFileSync
fs.writeFileSync = function patchedWriteFileSync(...args) {
  if (String(args[0] || '').includes('kone-config.json')) configWrites += 1
  return originalWriteFileSync.apply(fs, args)
}

const { createConfigStore } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'config-service.js'),
)

const STORE_FILE = path.join(TEMP_HOME, '.kone-config', 'kone-config.json')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readStoreFile = () => {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
  } catch {
    return null
  }
}

const store = createConfigStore()

test('P0-5: 防抖窗口内大量 set 合并为极少数次落盘', async () => {
  await delay(500) // 让构造期/迁移期写入结束
  configWrites = 0

  for (let i = 0; i < 100; i += 1) store.set(`bulk.key${i}`, i)

  assert.equal(configWrites, 0, '防抖窗口内不得逐次同步落盘')

  await delay(600)
  assert.ok(configWrites <= 2, `100 次 set 应合并为 ≤2 次落盘，实际 ${configWrites} 次（原实现为 100 次）`)
})

test('P0-5: set 后内存读取立即可见（不改变读取语义）', () => {
  store.set('memoryProbe.value', 'immediate')
  assert.equal(store.get('memoryProbe.value'), 'immediate')
})

test('P0-5: flushSync 立即落盘并包含最新值', () => {
  store.set('syncProbe.value', 'durable')
  store.flushSync()
  assert.equal(readStoreFile()?.syncProbe?.value, 'durable', 'flushSync 后磁盘必须含最新值')
})

test('P0-5: 未 flush 时磁盘落后于内存，flush 后收敛', async () => {
  store.flushSync()
  const before = readStoreFile()?.debounceProbe?.value
  assert.equal(before, undefined)

  store.set('debounceProbe.value', 'pending')
  assert.equal(readStoreFile()?.debounceProbe?.value, undefined, '防抖窗口内磁盘尚未更新')

  await delay(600)
  assert.equal(readStoreFile()?.debounceProbe?.value, 'pending', '窗口结束后自动落盘收敛')
})

test('P0-5: 嵌套键写入语义保持不变', () => {
  store.set('nested.deep.value', 42)
  assert.equal(store.get('nested.deep.value'), 42)
  store.flushSync()
  assert.equal(readStoreFile()?.nested?.deep?.value, 42)
})
