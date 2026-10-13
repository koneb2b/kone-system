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
import { registerCloudflareHandlers } from './services/cloudflare-service'
import { registerOutreachSyncHandlers } from './services/outreach-sync-service'
import { startOutreachSync, stopOutreachSync } from './services/outreach-sync-service'
import { registerImapReplyHandlers } from './services/imap-reply-service'
import { startImapReplyPoll, stopImapReplyPoll } from './services/imap-reply-service'
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
import { initFileLogging } from './utils/logger'

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

// 初始化结构化文件日志（商用加固 · 审计 G1）：镜像既有 console.* 到滚动日志文件
// （$userData/logs/kone-YYYYMMDD.log，保留 7 天），供线上问题定位。置于 userData 覆盖之后。
initFileLogging(app.getPath('userData'))

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
  registerCloudflareHandlers(ipcMain, store)
  registerOutreachSyncHandlers(ipcMain, store, () => mainWindowRef)
  registerImapReplyHandlers(ipcMain, store, () => mainWindowRef)
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

    /* 密钥迁移失败**不得**中断启动：否则 createMainWindow 不执行 → 应用无窗口、彻底变砖，
       用户连"进设置页重新录入密钥"这条唯一恢复路径都走不到。
       Fail-Closed 应作用于**单个能力**（取不到密钥 = 未配置），而非整个应用。（2026-10-12 实测复现） */
    try {
      migrateLegacySecretsFromConfig(store)
    } catch (error) {
      console.error('[Main] 密钥迁移失败（已降级为"密钥不可用"，应用继续启动）:', error)
    }
    clearLegacyAutopilotNode(store)
    // 第四批迁移收口：最后一处 plain 直挂。契约 autopilotSyncLifecycleContract 规定请求为
    // { lifecycle } 对象（与 v2 测试一致）；preload 负责把公开 API 的 lifecycle 字符串包成
    // 该对象，主进程在此解包，从而既保持契约真值、又不破坏渲染层调用形态。
    //
    // 关键顺序（P0 修复）：本通道必须在 `registerIpcHandlers()`（其末尾执行 `registry.attach(ipcMain)`）
    // **之前**登记。`attach()` 只对"登记时刻已存在的通道"做真实 `ipcMain.handle` 绑定；若本通道晚于
    // attach 登记，将**永远不绑定到 ipcMain** —— 渲染层调用恒得
    // "No handler registered for 'sync-autopilot-state'"（实测：打包版每次 dashboard 挂载都报错，
    // 系统托盘巡航状态永不更新）。同理也需早于 createMainWindow，因为已激活用户的 dashboard 会在
    // createMainWindow 期间即调用本通道。
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
          // mainWindowRef 可能尚未赋值（渲染层在 createMainWindow 期间即调用）——此时托盘尚未创建，
          // 随后 createTray(mainWindow) 会依据已同步的 autopilotLifecycle 建菜单，此处无需刷新。
          if (mainWindowRef) {
            refreshTrayMenu(mainWindowRef)
          }
          return { success: true, data: null }
        }
        return { success: false, error: 'Invalid autopilot lifecycle', code: 400 }
      },
    )
    registerIpcHandlers()
    const mainWindow = await createMainWindow()
    mainWindowRef = mainWindow
    createTray(mainWindow)
    bindWindowCloseToTray(mainWindow)
    initAutoUpdater()

    // P0-4/收口：启动门禁。所有 invoke 通道（含经 Fail-Closed 包装器治理登记的 20 处）均已在上方
    // registerIpcHandlers() + SYNC_STATE 登记进注册中心。`collectInvokeChannels()` 已排除仅推送通道，
    // 故此处断言全部 invoke 通道均已注册；断言通过后锁定注册中心，禁止运行期新增注册（防回归）。
    registry.assertAllRegistered(collectInvokeChannels())
    registry.lock()

    // [V1.3.10] P2.8b：注册中心锁定后启动后台轮询定时器。两个 timer 都遵循"注册中心 gate 之后"的
    // 生命周期不变量——避免在通道未就绪前发起云端/IMAP 网络调用。
    //   - startOutreachSync：cloud.outreachSyncEnabled 默认 true（Phase 2 起），60s 轮询云状态回写本地。
    //   - startImapReplyPoll：cloud.imapReplyDetectionEnabled 默认 false（P2.8b 保守），15min 拉 IMAP
    //     INBOX 匹配 In-Reply-To；未显式开启时立即返回，timer 保持 null。
    // 两者首次轮询延迟 5s，避免 IMAP/Cloudflare 认证风暴。stop 在 app.on('before-quit') 中执行。
    startOutreachSync(store, mainWindow)
    startImapReplyPoll(store, mainWindow)
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
  // [V1.3.10] P2.8b：停止后台轮询定时器，避免退出过程中触发新一轮 pollReplies 或 syncOutreachStatus。
  // 两个 timer 的 setInterval 回调可能正在执行，clear 后仍会跑完当前回调；不阻塞退出流程。
  try {
    stopOutreachSync()
    stopImapReplyPoll()
  } catch (error) {
    console.error('[Main] 停止后台轮询定时器失败:', error instanceof Error ? error.message : String(error))
  }
  /* P0-5：退出前强制同步落盘，确保防抖窗口内尚未写盘的配置变更不丢失。 */
  try {
    store.flushSync?.()
  } catch (error) {
    console.error('[Config] 退出前落盘失败:', error instanceof Error ? error.message : String(error))
  }
})
