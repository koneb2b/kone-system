const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 安全加固（审计 L1）回归防护：渲染进程沙箱必须开启，且其前置条件（preload 自足）必须成立。
// 背景：`sandbox: true` 的 preload 只允许 require 受限模块（electron / events / timers / url），
// 禁止 require 本地文件。故 preload 必须由 `npm run bundle:preload`（esbuild）打包为自足单文件
// （内联 IPC_CHANNELS），否则开启沙箱会导致 preload 崩溃、桥接失效。

const repoRoot = path.join(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8')

test('window-service enables renderer sandbox with isolation intact', () => {
  const ws = read('electron', 'services', 'window-service.ts')
  assert.match(ws, /contextIsolation:\s*true/, 'contextIsolation 必须为 true')
  assert.match(ws, /nodeIntegration:\s*false/, 'nodeIntegration 必须为 false')
  assert.match(ws, /sandbox:\s*true/, 'sandbox 必须为 true（审计 L1）')
})

test('preload source uses no Node APIs (sandbox-safe)', () => {
  const src = read('preload', 'index.ts')
  const forbidden = [
    { re: /\bprocess\./, label: 'process.*' },
    { re: /\bBuffer\b/, label: 'Buffer' },
    { re: /\b__dirname\b/, label: '__dirname' },
    { re: /\brequire\(/, label: 'require(' },
    { re: /from ['"]fs['"]/, label: 'import fs' },
    { re: /from ['"]path['"]/, label: 'import path' },
    { re: /from ['"]os['"]/, label: 'import os' },
  ]
  for (const { re, label } of forbidden) {
    assert.doesNotMatch(src, re, `preload 不得使用 Node API：${label}`)
  }
})

test('bundled preload has no local requires (sandbox-compatible)', () => {
  const bundledPath = path.join(repoRoot, 'dist-electron', 'preload', 'index.js')
  assert.ok(fs.existsSync(bundledPath), `需先构建：${bundledPath} 不存在（npm run build:electron:dev）`)
  const src = fs.readFileSync(bundledPath, 'utf8')
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1])
  const nonElectron = requires.filter((r) => r !== 'electron')
  assert.deepEqual(
    nonElectron,
    [],
    `沙箱化 preload 不得 require 非 electron 模块（须由 bundle:preload 内联），实际: ${nonElectron.join(', ')}`,
  )
})
