import * as path from 'path'
import * as os from 'os'

let _electron: any

function tryRequire(name: string): any | null {
  try {
    const m = require(name)
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      return m
    }
  } catch {}
  return null
}

// Try multiple import paths for Electron API
const candidates = [
  'electron', 'electron/main', 'electron/common', 'electron/renderer',
  'electron/js2c/browser_init', 'electron/js2c/node_init',
  'node:electron/js2c/browser_init', 'node:electron/js2c/node_init',
]
for (const name of candidates) {
  const m = tryRequire(name)
  if (m && (m.app || m.BrowserWindow || m.ipcMain || m.dialog)) {
    _electron = m
    break
  }
}

// Construct minimal fallback when the real Electron module is unavailable
// (Known Electron 33+ Windows bug: https://github.com/electron/electron/issues/49034)
const isUsingStubs = (!_electron || typeof _electron !== 'object' || !_electron.app)
if (isUsingStubs) {
  // Keep event loop alive since there's no real GUI
  setInterval(() => {}, 60000)

  let readyFired = false
  const readyListeners: (() => void)[] = []
  const userDataPath = path.join(os.homedir(), '.kone-config')

  const miniApp = {
    getPath: (name: string) => {
      if (name === 'userData' || name === 'appData') return userDataPath
      if (name === 'home') return os.homedir()
      if (name === 'temp') return os.tmpdir()
      if (name === 'desktop') return path.join(os.homedir(), 'Desktop')
      if (name === 'documents') return path.join(os.homedir(), 'Documents')
      if (name === 'downloads') return path.join(os.homedir(), 'Downloads')
      return userDataPath
    },
    setPath: () => {},
    whenReady: () => Promise.resolve(),
    isReady: () => true,
    on: (event: string, cb: (...args: any[]) => void) => {
      if (event === 'ready') {
        setTimeout(() => cb(), 0)
      }
    },
    once: (event: string, cb: (...args: any[]) => void) => {
      if (event === 'ready') {
        setTimeout(() => cb(), 0)
      }
    },
    quit: () => process.exit(0),
    exit: (code?: number) => process.exit(code ?? 0),
    requestSingleInstanceLock: () => true,
    commandLine: { appendSwitch: () => {}, hasSwitch: () => false },
    getName: () => 'Kone AI',
    getVersion: () => '1.3.0-alpha',
    getLocale: () => 'zh-CN',
    getLocaleCountryCode: () => 'CN',
    isPackaged: false,
    getAppPath: () => process.cwd(),
    disableHardwareAcceleration: () => {},
  }

  const fakeWindowsList: any[] = []
  const fakeWindow = function(this: any, opts?: any) {
    const w: any = {
      loadURL: (url: string) => Promise.resolve(),
      loadFile: (file: string) => Promise.resolve(),
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
    Menu: { buildFromTemplate: () => ({
      popup: () => {},
      items: [] as any[],
      append: () => {},
      insert: () => {},
    }), setApplicationMenu: () => {} } as any,
    Tray: function() {
      const tray = { setToolTip: () => {}, setContextMenu: () => {}, destroy: () => {},
        on: () => tray, once: () => tray, removeListener: () => tray, listeners: () => [] }
      return tray
    } as any,
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }), createFromNamedImage: () => ({ isEmpty: () => true }) } as any,
    dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }), showSaveDialog: () => Promise.resolve({ canceled: true, filePath: '' }) } as any,
    shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() } as any,
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 }, workArea: { width: 1920, height: 1080 } }), getAllDisplays: () => [] } as any,
    session: { defaultSession: { webRequest: { onBeforeSendHeaders: () => {} } } } as any,
    safeStorage: { isEncryptionAvailable: () => false, encryptString: () => '', decryptString: () => '' } as any,
  }
}

const noopFallback = new Proxy({}, {
  get(_: any, p: string | symbol) {
    if (typeof p === 'string') return function() { return undefined }
    return undefined
  }
})

export const app: Electron.App = (_electron.app || noopFallback) as Electron.App
export const BrowserWindow = (_electron.BrowserWindow || function BrowserWindow(){} as any) as unknown as typeof Electron.BrowserWindow
export const ipcMain: Electron.IpcMain = (_electron.ipcMain || noopFallback) as Electron.IpcMain
export const Menu = (_electron.Menu || function Menu(){} as any) as unknown as typeof Electron.Menu
export const Tray = (_electron.Tray || function Tray(){} as any) as unknown as typeof Electron.Tray
export const nativeImage = (_electron.nativeImage || noopFallback) as unknown as typeof Electron.nativeImage
export const dialog: Electron.Dialog = (_electron.dialog || noopFallback) as Electron.Dialog
export const shell: Electron.Shell = (_electron.shell || noopFallback) as Electron.Shell
export const screen: Electron.Screen = (_electron.screen || noopFallback) as Electron.Screen
export const session = (_electron.session || noopFallback) as unknown as typeof Electron.session
export const safeStorage: Electron.SafeStorage = (_electron.safeStorage || noopFallback) as Electron.SafeStorage
