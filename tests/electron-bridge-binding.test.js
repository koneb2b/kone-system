const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

// ─────────────────────────────────────────────────────────────
// A1 / packaged-startup regression: electron-bridge lazy Proxy MUST bind
// native Electron methods to their owning object.
//
// Electron's native APIs (app.getPath, dialog.showMessageBox, safeStorage.*)
// are bound methods that need their owner as `this`. The lazy export Proxy in
// electron-bridge.ts returned `base[p]` bare, which strips the binding. In a
// PACKAGED build this crashed startup with:
//     TypeError: electron_bridge_1.app.getPath is not a function
//   at getSecretFilePath (secret-manager.js)
// and post-obfuscation as `app[_0x2bb659(...)] is not a function`.
//
// Consumers such as secret-manager / backup-service access these APIs both
// directly and via destructuring, so the binding must survive both paths.
// (ARCH-STANDARDS §11 electron-bridge fallback protocol / build-agent §9.1)
// ─────────────────────────────────────────────────────────────

const BRIDGE = path.join(__dirname, '..', 'dist-electron', 'electron', 'services', 'electron-bridge.js')

const originalLoad = Module._load

// A native-like stub: getPath THROWS when `this` is lost, mirroring Electron.
const makeFakeApp = () => ({
  _secret: 'USERDATA_PATH',
  getPath(name) {
    if (!this || !this._secret) {
      throw new TypeError('app.getPath is not a function (this lost)')
    }
    return `${this._secret}:${name}`
  },
  isPackaged: true,
})

const withElectronMock = (fakeApp) => {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return { app: fakeApp }
    return originalLoad.call(this, request, parent, isMain)
  }
}

const loadFreshBridge = () => {
  delete require.cache[require.resolve(BRIDGE)]
  return require(BRIDGE)
}

test('A1: lazy Proxy binds native methods on DIRECT access', () => {
  withElectronMock(makeFakeApp())
  try {
    const bridge = loadFreshBridge()
    assert.equal(
      bridge.app.getPath('userData'),
      'USERDATA_PATH:userData',
      'direct app.getPath() must resolve with `this` intact',
    )
  } finally {
    Module._load = originalLoad
  }
})

test('A1: lazy Proxy binds native methods on DESTRUCTURED access (packaged crash path)', () => {
  withElectronMock(makeFakeApp())
  try {
    const bridge = loadFreshBridge()
    // This is precisely what secret-manager / backup-service do.
    const { getPath } = bridge.app
    assert.equal(
      getPath('userData'),
      'USERDATA_PATH:userData',
      'destructured getPath must keep its binding (regression guard)',
    )
  } finally {
    Module._load = originalLoad
  }
})

test('A1: non-function properties still pass through unchanged', () => {
  withElectronMock(makeFakeApp())
  try {
    const bridge = loadFreshBridge()
    assert.equal(bridge.app.isPackaged, true, 'plain property passthrough preserved')
  } finally {
    Module._load = originalLoad
  }
})

test('A1: negative control — an UNBOUND proxy reproduces the packaged crash', () => {
  // Guards the guard: proves these tests would fail if the bind were removed.
  const fakeApp = makeFakeApp()
  const unboundProxy = new Proxy({}, { get: (_t, p) => fakeApp[p] })
  const { getPath } = unboundProxy
  assert.throws(
    () => getPath('userData'),
    /is not a function/,
    'unbound access must throw, confirming the bind is what fixes startup',
  )
})

// ─────────────────────────────────────────────────────────────
// A1b: reject a DEGRADED electron module.
//
// In a packaged app, evicting `electron` from require.cache and re-requiring
// could hand back a partially-initialized module whose `app` has on/whenReady
// but NOT getPath. The old validity check (`m.app || m.BrowserWindow || ...`)
// accepted it, so startup died later at app.getPath('userData'). The loader
// must now reject such a module and fall through to the stubs instead.
// ─────────────────────────────────────────────────────────────

test('A1b: a degraded electron module (app without getPath) is rejected, stubs take over', () => {
  const degradedApp = { on() {}, whenReady: () => Promise.resolve() } // NO getPath
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return { app: degradedApp }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const bridge = loadFreshBridge()
    // The stub fallback must supply a WORKING getPath rather than the
    // degraded module's missing one.
    assert.equal(
      typeof bridge.app.getPath,
      'function',
      'degraded module must not be accepted; stub getPath must be available',
    )
    const p = bridge.app.getPath('userData')
    assert.ok(typeof p === 'string' && p.length > 0, 'stub getPath must return a usable path so startup can proceed')
  } finally {
    Module._load = originalLoad
  }
})

test('A1b: a fully valid electron module is still preferred over stubs', () => {
  withElectronMock(makeFakeApp())
  try {
    const bridge = loadFreshBridge()
    assert.equal(
      bridge.app.getPath('userData'),
      'USERDATA_PATH:userData',
      'a real module with getPath must win over the stub',
    )
  } finally {
    Module._load = originalLoad
  }
})

// ─────────────────────────────────────────────────────────────
// A1c: class-like exports must stay CONSTRUCTIBLE through the Proxy.
//
// JS checks the Proxy TARGET's callability BEFORE consulting the `construct`
// trap. With a plain `{}` target, packaged startup died at window creation:
//     TypeError: electron_bridge_1.BrowserWindow is not a constructor
//   at createMainWindow (window-service.js)
// A function target fixes it. Static helpers on those classes
// (BrowserWindow.getAllWindows) must still work.
// ─────────────────────────────────────────────────────────────

test('A1c: BrowserWindow is constructible through the lazy Proxy', () => {
  const instances = []
  class FakeBrowserWindow {
    constructor(opts) {
      this.opts = opts
      instances.push(this)
    }
    loadURL() {
      return Promise.resolve()
    }
  }
  FakeBrowserWindow.getAllWindows = () => instances

  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return { app: makeFakeApp(), BrowserWindow: FakeBrowserWindow }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const bridge = loadFreshBridge()
    const win = new bridge.BrowserWindow({ width: 1024 })
    assert.ok(win, 'new BrowserWindow(...) must succeed (regression guard)')
    assert.deepEqual(win.opts, { width: 1024 }, 'constructor args are forwarded')
    // Static helper reached through the Proxy must still resolve.
    assert.equal(
      bridge.BrowserWindow.getAllWindows().length,
      1,
      'static class helpers remain callable through the Proxy',
    )
  } finally {
    Module._load = originalLoad
  }
})
