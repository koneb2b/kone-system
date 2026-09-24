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
import { IPC_CHANNELS, collectInvokeChannels } from './ipc/channels'
import { registry, registerIpc } from './ipc/registry'
import { autopilotSyncLifecycleContract } from './ipc/contracts/autopilot.contract'
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

  // P0-4/收口：注册中心网关接通。迁移已完成——全部 invoke 通道均经 `registerIpc()` 登记进
  // 注册中心（含 20 处 Fail-Closed 包装器以 `skipAttach` 治理登记，真实绑定仍由包装器自己完成），
  // plain 直挂已清零；此处把登记的通道统一绑定（按 ipcMain 实例幂等）到真实 ipcMain。
  // 启动门禁 `assertAllRegistered()` 在 `whenReady()` 末尾、本函数执行完之后触发。
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
    // 第四批迁移收口：最后一处 plain 直挂。契约 autopilotSyncLifecycleContract 规定请求为
    // { lifecycle } 对象（与 v2 测试一致）；preload 负责把公开 API 的 lifecycle 字符串包成
    // 该对象，主进程在此解包，从而既保持契约真值、又不破坏渲染层调用形态。
    registerIpc(
      IPC_CHANNELS.AUTOPILOT.SYNC_STATE,
      autopilotSyncLifecycleContract,
      async (_event: unknown, payload: unknown) => {
        const lifecycle = (payload as { lifecycle?: string } | undefined)?.lifecycle
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
      },
    )

    // P0-4/收口：启动门禁。所有 invoke 通道（含经 Fail-Closed 包装器治理登记的 20 处）均已在上方
    // registerIpcHandlers() + SYNC_STATE 登记进注册中心。`collectInvokeChannels()` 已排除仅推送通道，
    // 故此处断言全部 invoke 通道均已注册；断言通过后锁定注册中心，禁止运行期新增注册（防回归）。
    registry.assertAllRegistered(collectInvokeChannels())
    registry.lock()
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
  /* P0-5：退出前强制同步落盘，确保防抖窗口内尚未写盘的配置变更不丢失。 */
  try {
    store.flushSync?.()
  } catch (error) {
    console.error('[Config] 退出前落盘失败:', error instanceof Error ? error.message : String(error))
  }
})
