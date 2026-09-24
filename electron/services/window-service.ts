import { app, BrowserWindow, screen, session, shell } from './electron-bridge'
import path from 'path'
import fs from 'fs'

// 窗口图标：打包版从 resources 根读取（extraResources 拷贝，asar 外）；
// dev 从源码 build/ 目录读取。electron-builder 默认不把 buildResources 目录打进 asar，
// 因此打包环境绝不能用 build/ 路径。dev 侧基于 __dirname 向上推导，
// 不依赖 app.getAppPath()（以文件形式启动 Electron 时该值会指向 main.js 目录）。
const getWindowIconPath = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath || '', 'icon.ico')
  }
  return path.join(__dirname, '..', '..', '..', 'build', 'icon.ico')
}

// preload 编译产物固定在 dist-electron/preload/index.js；
// 本文件编译后位于 dist-electron/electron/services/，向上两级即达。
const getPreloadPath = () => path.join(__dirname, '..', '..', 'preload', 'index.js')

/**
 * P0-7 修复：`session.defaultSession.webRequest.onBeforeSendHeaders` 是**追加**语义，
 * 原先在每次 createMainWindow() 内注册。窗口重建（macOS activate / 异常重开）会
 * 逐次累积同一监听器。此处提升为模块级一次性安装，并保留幂等标志。
 */
let userAgentHeaderInstalled = false
const installUserAgentHeader = () => {
  if (userAgentHeaderInstalled) return
  userAgentHeaderInstalled = true
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = 'Kone-AI/1.0'
    callback({ requestHeaders: details.requestHeaders })
  })
}

export const createMainWindow = async () => {
  const isDev = !app.isPackaged
  const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173'
  const preloadPath = getPreloadPath()
  const { workAreaSize } = screen.getPrimaryDisplay()
  const width = Math.min(1280, workAreaSize.width)
  const height = Math.min(800, workAreaSize.height)
  const minWidth = Math.min(960, workAreaSize.width)
  const minHeight = Math.min(640, workAreaSize.height)

  const mainWindow = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    show: false,
    autoHideMenuBar: true,
    icon: getWindowIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      /* 安全加固（审计 L1）：开启渲染进程沙箱。前置条件已满足——
         preload 仅依赖 `electron`（contextBridge/ipcRenderer），不触碰任何 Node API；
         且 `npm run bundle:preload` 将 preload 打包为**自足单文件**（内联 IPC_CHANNELS），
         消除沙箱化 preload 禁止的本地 `require`。见 tests/preload-sandbox-contract.test.js。 */
      sandbox: true,
      preload: preloadPath,
    },
  })

  const windowIconPath = getWindowIconPath()
  if (!fs.existsSync(windowIconPath)) {
    console.warn(`[Window] Icon file missing, OS will fall back to default: ${windowIconPath}`)
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('unresponsive', () => {
    console.error(' [Window] Main window became unresponsive')
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(' [Window] Renderer process gone:', details)
  })

  // P0-7 修复：一次性安装，窗口重建不再重复注册（原实现每次调用都会追加监听器）
  installUserAgentHeader()

  // EL-01 修复：导航安全——默认拒绝新窗口，仅允许 https 外链经外部浏览器打开
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // EL-01 修复：阻止渲染进程导航到非本地 origin（防 XSS 链接劫持）
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocal = isDev
      ? url.startsWith('http://127.0.0.1:5173') || url.startsWith('http://localhost:5173')
      : url.startsWith('file://')
    if (!isLocal) {
      event.preventDefault()
    }
  })

  if (isDev) {
    try {
      await mainWindow.loadURL(devUrl)
      mainWindow.webContents.openDevTools()
    } catch (error) {
      console.error(' [System] Dev URL load failed:', error)
    }
  } else {
    try {
      await mainWindow.loadFile(path.join(__dirname, '..', '..', '..', 'dist', 'index.html'))
    } catch (error) {
      console.error(' [Window] Production index load failed:', error)
    }
  }

  return mainWindow
}
