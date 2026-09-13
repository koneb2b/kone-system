// Launches Electron with clean env.
// 必须以目录形式（含 package.json）启动：若以 main.js 文件路径启动，
// app.getAppPath() 会变成 main.js 所在目录，preload/图标等基于 appPath
// 的路径全部拼错，preload 加载失败后渲染层会退化为浏览器 devShell 假链路。
const cp = require('child_process')
const path = require('path')
const electronPath = require('electron')
const mainEntry = __dirname
// ELECTRON_RUN_AS_NODE must be DELETED, not set to ''. Electron tests for the
// variable's PRESENCE, not its value, so an empty string still forces the
// binary into plain-Node mode: process.type is undefined, require('electron')
// returns the binary path STRING instead of the API object, and startup dies
// with "app.getPath is not a function".
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = cp.spawn(electronPath, [mainEntry], { stdio: 'inherit', env, cwd: __dirname })
child.on('exit', (code) => process.exit(code ?? 0))
