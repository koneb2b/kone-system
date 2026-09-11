import path from 'path'
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron'
import { registerAuthHandlers } from './services/auth-service'
import {
  assertConfigWritable,
  createConfigStore,
  migrateLegacySecretsFromConfig,
  registerConfigHandlers,
} from './services/config-service'
import { registerExportHandlers } from './services/export-service'
import { createLicenseService } from './services/license-service'
import { registerProxyHandlers } from './services/proxy-service'
import { registerSearchHandlers } from './services/search-service'
import { clearLegacyAutopilotNode, registerAutopilotStateHandlers } from './services/autopilot-state-service'
import { registerSupabaseHandlers } from './services/supabase-service'
import { registerAutomationHandlers } from './services/automation-service'
import { registerSandboxHandlers } from './services/sandbox-service'
import { registerAgentHandlers } from './services/agent-service'
import { registerDnsHandlers } from './services/dns-service'
import { registerProviderHandlers } from './services/provider-service'
import { createMainWindow } from './services/window-service'
import { IPC_CHANNELS } from './ipc/channels'
import { registry } from './ipc/registry'
import type { AutopilotLifecycle } from '../src/shared/ipc-contracts'

import { initCrashReporter } from './services/crash-reporter'
import { initBackupService } from './services/backup-service'
import { initAutoUpdater } from './services/auto-updater'

// Initialize crash reporter before any other code
initCrashReporter()

// Initialize backup service (non-blocking, runs in background)
initBackupService()

if (process.env.KONE_TEST_USER_DATA_DIR?.trim()) {
  app.setPath('userData', process.env.KONE_TEST_USER_DATA_DIR.trim())
}

if (process.env.KONE_TEST_DOWNLOADS_DIR?.trim()) {
  app.setPath('downloads', process.env.KONE_TEST_DOWNLOADS_DIR.trim())
}

if (process.env.KONE_SMOKE_TEST === '1' || process.env.KONE_REGRESSION_TEST === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.KONE_REMOTE_DEBUGGING_PORT?.trim() || '9222')
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

const store = createConfigStore()
assertConfigWritable(store)

const { licenseGuard, registerHandlers: registerLicenseHandlers } = createLicenseService(store)
let mainTray: Electron.Tray | null = null
let isQuitting = false
let autopilotLifecycle: AutopilotLifecycle = 'idle'
let mainWindowRef: Electron.BrowserWindow | null = null

app.on('second-instance', () => {
  const mainWindow = mainWindowRef ?? BrowserWindow.getAllWindows()[0] ?? null
  if (!mainWindow) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
})

const registerIpcHandlers = () => {
  registerAuthHandlers(ipcMain)
  registerConfigHandlers(ipcMain, store)
  registerLicenseHandlers(ipcMain, app)
  registerProxyHandlers(ipcMain, licenseGuard, store)
  registerSearchHandlers(ipcMain, store)
  registerExportHandlers(ipcMain, licenseGuard, store)
  registerAutopilotStateHandlers(ipcMain, store)
  registerSupabaseHandlers(ipcMain, store, licenseGuard, () => mainWindowRef)
  registerAutomationHandlers(ipcMain, store, licenseGuard)
  registerSandboxHandlers(ipcMain, store)
  registerAgentHandlers(ipcMain, store)
  registerDnsHandlers(ipcMain, store)
  registerProviderHandlers(ipcMain, store)

  // P0-4：注册中心网关接通。当前生产 handler 仍走 register*Handlers 直挂 ipcMain，
  // registry 仅绑定已通过 registerIpc() 登记的通道（迁移过程中逐步增加）。
  // 迁移完成后 assertAllRegistered 将作为启动门禁生效。
  registry.attach(ipcMain)
}

const getTrayIcon = () => {
  const trayIconPath = path.join(app.getAppPath(), 'build', 'icon.ico')
  const icon = nativeImage.createFromPath(trayIconPath)
  return icon.isEmpty() ? nativeImage.createFromNamedImage('NSStatusAvailable', []) : icon
}

const buildTrayMenu = (mainWindow: Electron.BrowserWindow) => {
  const isRunning = autopilotLifecycle === 'running'
  const isPaused = autopilotLifecycle === 'paused'

  return Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      },
    },
    {
      label: '⏸ 暂停巡航',
      enabled: isRunning,
      click: () => {
        mainWindow.webContents.send(IPC_CHANNELS.SYSTEM.AUTOPILOT_ACTION, 'pause')
      },
    },
    {
      label: '▶ 继续巡航',
      enabled: isPaused,
      click: () => {
        mainWindow.webContents.send(IPC_CHANNELS.SYSTEM.AUTOPILOT_ACTION, 'resume')
      },
    },
    {
      label: '⏹ 停止并清空',
      enabled: isRunning || isPaused,
      click: () => {
        mainWindow.webContents.send(IPC_CHANNELS.SYSTEM.AUTOPILOT_ACTION, 'stop')
      },
    },
    {
      type: 'separator',
    },
    {
      label: '彻底退出 Kone',
      click: () => {
        isQuitting = true
        mainTray?.destroy()
        mainTray = null
        app.exit(0)
      },
    },
  ])
}

const getTrayTooltip = () => {
  if (autopilotLifecycle === 'running') {
    return 'Kone - 巡航运行中 (Auto-Pilot)'
  }

  if (autopilotLifecycle === 'paused') {
    return 'Kone - 巡航已暂停'
  }

  return 'Kone - 待命休眠中'
}

const refreshTrayMenu = (mainWindow: Electron.BrowserWindow) => {
  if (!mainTray) {
    return
  }
  mainTray.setToolTip(getTrayTooltip())
  mainTray.setContextMenu(buildTrayMenu(mainWindow))
}

const createTray = (mainWindow: Electron.BrowserWindow) => {
  if (mainTray) return mainTray

  mainTray = new Tray(getTrayIcon())
  refreshTrayMenu(mainWindow)

  mainTray.on('double-click', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  return mainTray
}

const bindWindowCloseToTray = (mainWindow: Electron.BrowserWindow) => {
  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    mainWindow.hide()
  })
}

app.on('child-process-gone', (_event, details) => {
  console.error('[Main] Child process crashed:', details)
})

app
  .whenReady()
  .then(async () => {
    if (!hasSingleInstanceLock) {
      return
    }

    migrateLegacySecretsFromConfig(store)
    clearLegacyAutopilotNode(store)
    registerIpcHandlers()
    const mainWindow = await createMainWindow()
    mainWindowRef = mainWindow
    createTray(mainWindow)
    bindWindowCloseToTray(mainWindow)
    initAutoUpdater()
    ipcMain.handle(IPC_CHANNELS.AUTOPILOT.SYNC_STATE, (_event, lifecycle: unknown) => {
      if (
        lifecycle === 'idle' ||
        lifecycle === 'running' ||
        lifecycle === 'paused' ||
        lifecycle === 'completed' ||
        lifecycle === 'error'
      ) {
        autopilotLifecycle = lifecycle
        refreshTrayMenu(mainWindow)
        return { success: true, data: null }
      }
      return { success: false, error: 'Invalid autopilot lifecycle', code: 400 }
    })
  })
  .catch((error) => {
    console.error('[Main] App startup failed:', error)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const mainWindow = await createMainWindow()
    mainWindowRef = mainWindow
    createTray(mainWindow)
    bindWindowCloseToTray(mainWindow)
    return
  }

  const mainWindow = BrowserWindow.getAllWindows()[0] ?? null
  mainWindowRef = mainWindow
  mainWindow?.show()
})

app.on('before-quit', () => {
  isQuitting = true
})
