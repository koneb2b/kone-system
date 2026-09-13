import { app, BrowserWindow, screen, session } from './electron-bridge'
import path from 'path'
import fs from 'fs'

// 窗口图标：打包版从 resources 根读取（extraResources 拷贝，asar 外）；
// dev 从源码 build/ 目录读取。electron-builder 默认不把 buildResources 目录打进 asar，
// 因此打包环境绝不能用 appPath/build 路径。
const getWindowIconPath = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath || '', 'icon.ico')
  }
  return path.join(app.getAppPath(), 'build', 'icon.ico')
}

export const createMainWindow = async () => {
  const isDev = !app.isPackaged
  const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173'
  const preloadPath = path.join(app.getAppPath(), 'dist-electron', 'preload', 'index.js')
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
      sandbox: false,
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

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = 'Kone-AI/1.0'
    callback({ requestHeaders: details.requestHeaders })
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
      await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
    } catch (error) {
      console.error(' [Window] Production index load failed:', error)
    }
  }

  return mainWindow
}
