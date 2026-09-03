import * as path from 'path'
import * as os from 'os'

// ── Lazy Electron module loader ──────────────────────────────
// Electron 33+ on Windows bug: require('electron') returns the npm
// package string (binary path) instead of the Electron API during
// early module initialization.
//
// Strategy: clear the require cache and retry. Use a timeout retry
// for the initial load race condition. Exports are Proxies that
// dynamically resolve _electron on every access.

let _electron: any = null
let _stubsBuilt = false
let _retries = 0
const MAX_RETRIES = 5
const RETRY_DELAY_MS = 100

// A usable Electron main-process module must expose `app` WITH its real methods.
// Checking only for `app`'s presence is not enough: a partially-initialized
// module can carry an `app` object that has `on`/`whenReady` but is missing
// `getPath`, which is exactly what crashed packaged startup at
// getSecretFilePath() → app.getPath('userData').
function isUsableElectronModule(m: any): boolean {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false
  if (m.app && typeof m.app.getPath === 'function') return true
  // Renderer/common entry points legitimately have no `app`.
  return Boolean(m.BrowserWindow || m.ipcMain || m.dialog)
}

function tryLoadElectron(): any | null {
  // First attempt: plain require, WITHOUT touching require.cache.
  //
  // In a packaged app `electron` is a built-in served by Electron's own loader.
  // Evicting it from require.cache and re-requiring can return a PARTIALLY
  // initialized module whose `app` lacks getPath — the packaged startup crash
  // "electron_bridge_1.app.getPath is not a function". The cache-eviction hack
  // below only exists for the dev-mode defect where require('electron') yields
  // the npm binary-path STRING, which cannot happen once packaged. So we only
  // resort to it when we actually observe that bad string form.
  try {
    const direct = require('electron')
    if (isUsableElectronModule(direct)) {
      return direct
    }
    // Only the broken string form justifies clearing the cache and retrying.
    if (typeof direct === 'string') {
      try {
        delete require.cache[require.resolve('electron')]
      } catch {
        /* cache clear is best-effort — retry proceeds regardless */
      }
      const retried = require('electron')
      if (isUsableElectronModule(retried)) {
        return retried
      }
    }
  } catch {
    /* direct require failed — fall through to alternative internal paths */
  }

  // Try alternative internal paths
  for (const p of ['electron/main', 'electron/common', 'electron/renderer']) {
    try {
      const m = require(p)
      if (isUsableElectronModule(m)) {
        return m
      }
    } catch {
      /* path not resolvable in this environment — try next */
    }
  }

  return null
}

function scheduleRetry(): void {
  if (_retries >= MAX_RETRIES) return
  _retries++
  setTimeout(() => {
    _electron = tryLoadElectron()
    if (_electron) {
      try {
        console.log('[electron-bridge] Electron module loaded after retry #' + _retries)
      } catch {
        /* console.log in a non-electron context may fail — non-fatal */
      }
    } else if (_retries < MAX_RETRIES) {
      scheduleRetry()
    }
  }, RETRY_DELAY_MS * _retries)
}

function ensureElectron(): void {
  if (_electron) return
  _electron = tryLoadElectron()
  if (!_electron) {
    scheduleRetry()
  }
}

function buildStubsOnce(): void {
  if (_stubsBuilt) return
  _stubsBuilt = true

  const userDataPath = path.join(os.homedir(), '.kone-config')
  const miniApp: any = {
    getPath: (name: string) => {
      const map: Record<string, string> = {
        userData: userDataPath,
        appData: userDataPath,
        home: os.homedir(),
        temp: os.tmpdir(),
        desktop: path.join(os.homedir(), 'Desktop'),
        documents: path.join(os.homedir(), 'Documents'),
        downloads: path.join(os.homedir(), 'Downloads'),
      }
      return map[name] || userDataPath
    },
    setPath: () => {},
    whenReady: () => Promise.resolve(),
    isReady: () => true,
    on: () => {},
    once: () => {},
    quit: () => process.exit(0),
    exit: (code?: number) => process.exit(code ?? 0),
    requestSingleInstanceLock: () => true,
    commandLine: { appendSwitch: () => {}, hasSwitch: () => false },
    getName: () => 'Kone AI',
    getVersion: () => '1.3.0-alpha',
    isPackaged: false,
    getAppPath: () => process.cwd(),
    disableHardwareAcceleration: () => {},
  }

  const fakeWindowsList: any[] = []
  const fakeWindow: any = function (this: any, _opts?: any) {
    const w: any = {
      loadURL: () => Promise.resolve(),
      loadFile: () => Promise.resolve(),
      show: () => {},
      hide: () => {},
      focus: () => {},
      close: () => {},
      minimize: () => {},
      maximize: () => {},
      restore: () => {},
      on: () => {},
      once: () => {},
      webContents: { openDevTools: () => {}, on: () => {}, session: { webRequest: { onBeforeSendHeaders: () => {} } } },
      setTitle: () => {},
      getTitle: () => '',
      isMinimized: () => false,
      isMaximized: () => false,
      isVisible: () => true,
      isFocused: () => true,
      setSize: () => {},
      getSize: () => [1024, 768],
      setPosition: () => {},
      getPosition: () => [0, 0],
      center: () => {},
      setMinimumSize: () => {},
      setMaximumSize: () => {},
      setResizable: () => {},
      setAlwaysOnTop: () => {},
      moveTop: () => {},
      setMenuBarVisibility: () => {},
      setAutoHideMenuBar: () => {},
    }
    fakeWindowsList.push(w)
    return w
  } as any
  fakeWindow.getAllWindows = () => fakeWindowsList
  fakeWindow.fromId = () => fakeWindowsList[0] || null
  fakeWindow.fromWebContents = () => fakeWindowsList[0] || null

  _electron = {
    app: miniApp,
    BrowserWindow: fakeWindow,
    ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} } as any,
    Menu: {
      buildFromTemplate: () => ({ popup: () => {}, items: [] as any[], append: () => {}, insert: () => {} }),
      setApplicationMenu: () => {},
    } as any,
    Tray: function () {
      const tray = {
        setToolTip: () => {},
        setContextMenu: () => {},
        destroy: () => {},
        on: () => tray,
        once: () => tray,
        removeListener: () => tray,
        listeners: () => [],
      }
      return tray
    } as any,
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }),
      createFromNamedImage: () => ({ isEmpty: () => true }),
    } as any,
    dialog: {
      showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
      showSaveDialog: () => Promise.resolve({ canceled: true, filePath: '' }),
    } as any,
    shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() } as any,
    screen: {
      getPrimaryDisplay: () => ({
        workAreaSize: { width: 1920, height: 1080 },
        workArea: { width: 1920, height: 1080 },
      }),
      getAllDisplays: () => [],
    } as any,
    session: { defaultSession: { webRequest: { onBeforeSendHeaders: () => {} } } } as any,
    safeStorage: { isEncryptionAvailable: () => false, encryptString: () => '', decryptString: () => '' } as any,
  }
}

function getElectronProp(prop: string): any {
  if (!_electron) ensureElectron()
  if (!_electron) buildStubsOnce()
  return _electron?.[prop]
}

// ── Initialize ────────────────────────────────────────────────
ensureElectron()

// ── Lazy exports via dynamic property resolution ──────────────
// Every access to app/BrowserWindow/etc checks _electron live,
// so retries that succeed later will be picked up automatically.

function createLazyExport<T>(prop: string): T {
  // The Proxy target MUST be callable for `new Target(...)` / `Target(...)` to
  // work: JavaScript checks the TARGET's callability BEFORE consulting the
  // `construct`/`apply` traps. With a plain `{}` target, `new BrowserWindow()`
  // throws "BrowserWindow is not a constructor" in the packaged app even though
  // a `construct` trap is defined. A function target keeps class-like exports
  // (BrowserWindow, Tray, Menu, nativeImage) constructible while remaining a
  // perfectly good target for plain object exports such as `app`.
  const callableTarget = function () {} as any
  return new Proxy(callableTarget, {
    get(_target, p: string | symbol) {
      const base = getElectronProp(prop)
      if (!base) return undefined
      const value = base[p]
      if (typeof value !== 'function') return value
      // CRITICAL: Electron's native APIs (app.getPath, dialog.showMessageBox, …)
      // are bound methods that require their owning object as `this`. Returning
      // `base[p]` bare strips that binding, so a packaged build crashes with
      // "app.getPath is not a function" (and, post-obfuscation, with mangled
      // property names). Bind functions to their base so callers can safely
      // destructure or invoke them through this lazy Proxy.
      //
      // BUT: `.bind()` returns a non-constructible wrapper, which would break
      // nested constructors reached through a namespace (e.g. Menu.MenuItem).
      // Anything carrying a prototype with own members is treated as a class
      // and returned unbound so `new` keeps working.
      const looksConstructible = value.prototype && Object.getOwnPropertyNames(value.prototype).length > 1
      return looksConstructible ? value : value.bind(base)
    },
    set(_target, p: string | symbol, value: any) {
      const base = getElectronProp(prop)
      if (base) {
        base[p] = value
        return true
      }
      return false
    },
    apply(_target, _thisArg, args) {
      const base = getElectronProp(prop)
      if (typeof base === 'function') return base(...args)
      return undefined
    },
    construct(_target, args) {
      const base = getElectronProp(prop)
      if (typeof base === 'function') return new base(...args)
      return {}
    },
  }) as unknown as T
}

export const app = createLazyExport<Electron.App>('app')
export const BrowserWindow = createLazyExport<typeof Electron.BrowserWindow>('BrowserWindow')
export const ipcMain = createLazyExport<Electron.IpcMain>('ipcMain')
export const Menu = createLazyExport<typeof Electron.Menu>('Menu')
export const Tray = createLazyExport<typeof Electron.Tray>('Tray')
export const nativeImage = createLazyExport<typeof Electron.NativeImage>('nativeImage')
export const dialog = createLazyExport<Electron.Dialog>('dialog')
export const shell = createLazyExport<Electron.Shell>('shell')
export const screen = createLazyExport<Electron.Screen>('screen')
export const session = createLazyExport<typeof Electron.session>('session')
export const safeStorage = createLazyExport<Electron.SafeStorage>('safeStorage')
