// Launches Electron with clean env and explicit main entry
const cp = require('child_process')
const path = require('path')
const electronPath = require('electron')
const mainEntry = path.join(__dirname, 'dist-electron', 'electron', 'main.js')
// ELECTRON_RUN_AS_NODE must be DELETED, not set to ''. Electron tests for the
// variable's PRESENCE, not its value, so an empty string still forces the
// binary into plain-Node mode: process.type is undefined, require('electron')
// returns the binary path STRING instead of the API object, and startup dies
// with "app.getPath is not a function".
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = cp.spawn(electronPath, [mainEntry], { stdio: 'inherit', env, cwd: __dirname })
child.on('exit', (code) => process.exit(code ?? 0))
