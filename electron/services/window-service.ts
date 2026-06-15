import { app, BrowserWindow, screen, session } from './electron-bridge'
import path from 'path'

const getWindowIconPath = () => path.join(app.getAppPath(), 'build', 'icon.ico')

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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('unresponsive', () => {
    console.error('❌ [Window] Main window became unresponsive')
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('❌ [Window] Renderer process gone:', details)
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
      console.error('❌ [System] Dev URL load failed:', error)
    }
  } else {
    try {
      await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
    } catch (error) {
      console.error('❌ [Window] Production index load failed:', error)
    }
  }

  return mainWindow
}
