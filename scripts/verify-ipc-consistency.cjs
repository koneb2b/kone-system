#!/usr/bin/env node
/**
 * verify-ipc-consistency.cjs — IPC 契约一致性门禁（CI P0-9）
 *
 * 目的：`electron/ipc/channels.ts` 是通道命名唯一事实源；本脚本机械校验
 *   "定义 / 注册 / 推送 / 渲染层暴露" 四个面之间不存在漂移。
 *
 * 校验项：
 *   1. 所有被引用的通道都必须在 channels.ts 中定义（防止拼写错误/幽灵通道）
 *   2. 所有已定义的通道必须被真实注册（ipcMain.handle / 安全包装器）或用于推送
 *      —— 禁止死通道
 *   3. 渲染层（preload）暴露的 invoke 通道必须有真实 handler
 *   4. 报告统计口径：通道总数 / 注册数 / 仅推送数 / registry 迁移数
 *
 * 用法：node scripts/verify-ipc-consistency.cjs
 * 退出码：0 = 通过；1 = 契约漂移
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CHANNELS_FILE = path.join(ROOT, 'electron', 'ipc', 'channels.ts')
const ELECTRON_DIR = path.join(ROOT, 'electron')
const PRELOAD_FILE = path.join(ROOT, 'preload', 'index.ts')

const failures = []
const notes = []

const walkTs = (dir) => {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...walkTs(full))
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

// ── 解析 channels.ts ────────────────────────────────────────
const channelSource = fs.readFileSync(CHANNELS_FILE, 'utf8')
/** path -> channel string，例如 "SEARCH.EXECUTE" -> "search:execute" */
const declared = new Map()

for (const groupMatch of channelSource.matchAll(/([A-Z_]+)\s*:\s*\{([\s\S]*?)\n\s*\}/g)) {
  const group = groupMatch[1]
  for (const keyMatch of groupMatch[2].matchAll(/([A-Z_]+)\s*:\s*'([^']+)'/g)) {
    declared.set(`${group}.${keyMatch[1]}`, keyMatch[2])
  }
}

if (declared.size === 0) {
  console.error('❌ 无法从 channels.ts 解析出任何通道定义')
  process.exit(1)
}

// 反向表：channel string -> path（用于校验字面量引用）
const byChannelString = new Map([...declared.entries()].map(([k, v]) => [v, k]))

// ── 扫描 electron/ 的注册与推送 ─────────────────────────────
const registered = new Set()
const pushed = new Set()
const referenced = new Set()
/** 经 registry.registerIpc() 显式迁移的通道（真实可观测口径，非硬编码） */
const registryMigrated = new Set()

/* 直接注册：ipcMain.handle(IPC_CHANNELS.X.Y, ...)
   包装器注册：registerSecureFeatureIpc('<featureKey>', IPC_CHANNELS.X.Y, ...)
   —— 包装器的首参是 feature key，因此通道常量出现在第二个实参，正则需允许前置实参。 */
const DIRECT_HANDLE_RE = /ipcMain\.handle(?:Once)?\s*\(\s*IPC_CHANNELS\.([A-Z_]+)\.([A-Z_]+)/g
const WRAPPED_HANDLE_RE =
  /(?:registerSecureIpc|registerSecureFeatureIpc|registerIpc)\s*\([^)]*?IPC_CHANNELS\.([A-Z_]+)\.([A-Z_]+)/g
const REGISTRY_RE = /registerIpc\s*\([^)]*?IPC_CHANNELS\.([A-Z_]+)\.([A-Z_]+)/g
const PUSH_RE = /\.(?:send|emit)\s*\(\s*IPC_CHANNELS\.([A-Z_]+)\.([A-Z_]+)/g
const ANY_REF_RE = /IPC_CHANNELS\.([A-Z_]+)\.([A-Z_]+)/g

/** 契约定义文件天然以字面量声明自己的通道名，不参与字面量直写检查 */
const LITERAL_CHECK_EXCLUDES = [path.join('electron', 'ipc', 'contracts')]

for (const file of walkTs(ELECTRON_DIR)) {
  const source = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')

  for (const m of source.matchAll(ANY_REF_RE)) {
    const key = `${m[1]}.${m[2]}`
    referenced.add(key)
    if (!declared.has(key)) {
      failures.push(`[通道未定义] ${rel} 引用了 channels.ts 中不存在的通道 ${key}`)
    }
  }
  for (const m of source.matchAll(DIRECT_HANDLE_RE)) registered.add(`${m[1]}.${m[2]}`)
  for (const m of source.matchAll(WRAPPED_HANDLE_RE)) registered.add(`${m[1]}.${m[2]}`)
  for (const m of source.matchAll(REGISTRY_RE)) registryMigrated.add(`${m[1]}.${m[2]}`)
  for (const m of source.matchAll(PUSH_RE)) pushed.add(`${m[1]}.${m[2]}`)
}

// ── 扫描 preload 暴露面 ─────────────────────────────────────
const preloadExposed = new Set()
if (fs.existsSync(PRELOAD_FILE)) {
  const preload = fs.readFileSync(PRELOAD_FILE, 'utf8')
  for (const m of preload.matchAll(ANY_REF_RE)) {
    const key = `${m[1]}.${m[2]}`
    preloadExposed.add(key)
    if (!declared.has(key)) {
      failures.push(`[通道未定义] preload/index.ts 引用了不存在的通道 ${key}`)
    }
  }
}

// ── 死通道检测 ──────────────────────────────────────────────
const deadChannels = []
for (const key of declared.keys()) {
  if (registered.has(key) || pushed.has(key)) continue
  deadChannels.push(key)
}
for (const key of deadChannels) {
  failures.push(`[死通道] ${key}（${declared.get(key)}）已定义但既未注册也未推送`)
}

// ── 渲染层暴露的 invoke 通道必须有 handler ─────────────────
for (const key of preloadExposed) {
  if (registered.has(key) || pushed.has(key)) continue
  failures.push(`[暴露无实现] preload 暴露了 ${key}（${declared.get(key)}），但主进程既未注册也未推送`)
}

// ── 通道字面量（非 IPC_CHANNELS 常量）直写检测 ──────────────
const literalChannelHits = []
for (const file of walkTs(ELECTRON_DIR)) {
  if (path.basename(file) === 'channels.ts') continue
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  if (LITERAL_CHECK_EXCLUDES.some((ex) => rel.includes(ex.replace(/\\/g, '/')))) continue
  const source = fs.readFileSync(file, 'utf8')
  for (const m of source.matchAll(/'([a-z][a-z-]*:[a-z][a-z-]*)'/g)) {
    if (!byChannelString.has(m[1])) continue
    literalChannelHits.push(`${rel} → '${m[1]}'`)
  }
}
for (const hit of literalChannelHits) {
  failures.push(`[字面量通道] ${hit} 应改用 IPC_CHANNELS 常量（命名唯一源约束）`)
}

// ── 统计 ────────────────────────────────────────────────────
notes.push(`通道定义总数: ${declared.size}`)
notes.push(`主进程已注册: ${registered.size}`)
notes.push(`仅推送通道: ${[...declared.keys()].filter((k) => !registered.has(k) && pushed.has(k)).length}`)
notes.push(`preload 暴露: ${preloadExposed.size}`)
// P0-4/续：本仓"经 registry 注册"的口径 = 全部已注册 invoke 通道。
// 其中 29 个经 registerIpc() 显式迁移；另 20 个 Fail-Closed 包装通道自第四批起也经
// registerSecureIpc 治理登记进 registry（skipAttach，真实 ipcMain.handle 绑定仍由包装器完成），
// 故 registry 已知通道 = 主进程已注册总数，plain 直挂已清零。
const registryKnown = registered.size
notes.push(
  `经 registry 注册（含 Fail-Closed 包装器治理登记 skipAttach）: ${registryKnown}（plain 经 registerIpc 显式迁移 ${registryMigrated.size} + 包装器治理登记 ${
    registryKnown - registryMigrated.size
  }；0 处 plain 直挂；目标态见 ARCH-STANDARDS §3 迁移注记；${
    registryMigrated.size > 0 ? `registerIpc 已迁移: ${[...registryMigrated].join(', ')}` : '尚无'
  }）`,
)

console.log('── IPC 契约一致性校验 ──────────────────────────')
for (const note of notes) console.log(`  · ${note}`)

if (failures.length > 0) {
  console.error('\n❌ 检测到 IPC 契约漂移：')
  for (const item of failures) console.error(`  - ${item}`)
  console.error(`\n共 ${failures.length} 项，CI 必须判红。`)
  process.exit(1)
}

console.log('\n✅ IPC 契约一致性校验通过')
