// Launches Electron with clean env and explicit main entry
const cp = require('child_process')
const path = require('path')
const electronPath = require('electron')
const mainEntry = path.join(__dirname, 'dist-electron', 'electron', 'main.js')
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '' }
const child = cp.spawn(electronPath, [mainEntry], { stdio: 'inherit', env, cwd: __dirname })
child.on('exit', (code) => process.exit(code ?? 0))
