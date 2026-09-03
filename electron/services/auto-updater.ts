/**
 * Kone Auto Updater
 *
 * Integrates electron-updater for automatic application updates.
 * Checks for updates on startup, downloads in background,
 * and prompts user to install when ready.
 *
 * Dependency: npm install electron-updater
 * (electron-builder already present in devDependencies)
 */

import { dialog, app } from './electron-bridge'

// Dynamic require of electron-updater to avoid crash when not installed
let _autoUpdater: any = null
let _checkInProgress = false
let _updateAvailable = false
let _downloadCompleted = false

function getAutoUpdater(): any {
  if (_autoUpdater) return _autoUpdater
  try {
    _autoUpdater = require('electron-updater').autoUpdater
    return _autoUpdater
  } catch {
    return null
  }
}

/**
 * Get current update status.
 */
export function getUpdateStatus(): {
  checkInProgress: boolean
  updateAvailable: boolean
  downloadCompleted: boolean
} {
  return {
    checkInProgress: _checkInProgress,
    updateAvailable: _updateAvailable,
    downloadCompleted: _downloadCompleted,
  }
}

/**
 * Check for updates manually (triggered by user from Settings).
 */
export async function checkForUpdates(): Promise<{
  success: boolean
  updateAvailable: boolean
  version?: string
  error?: string
}> {
  const updater = getAutoUpdater()
  if (!updater) {
    return { success: false, updateAvailable: false, error: 'electron-updater not installed' }
  }

  if (_checkInProgress) {
    return { success: false, updateAvailable: false, error: 'Check already in progress' }
  }

  try {
    _checkInProgress = true
    const result = await updater.checkForUpdates()
    _checkInProgress = false

    if (result && result.updateInfo) {
      _updateAvailable = true
      return {
        success: true,
        updateAvailable: true,
        version: result.updateInfo.version,
      }
    }

    _updateAvailable = false
    return { success: true, updateAvailable: false }
  } catch (e) {
    _checkInProgress = false
    return {
      success: false,
      updateAvailable: false,
      error: e instanceof Error ? e.message : String(e || ''),
    }
  }
}

/**
 * Initialize the auto-updater.
 * Called once at app startup after window is created.
 */
export function initAutoUpdater(): void {
  const updater = getAutoUpdater()
  if (!updater) {
    console.log('[AutoUpdater] electron-updater not available')
    return
  }

  // Update-source policy (aligned with the offline commercial model):
  // Kone ships WITHOUT an online update feed (package.json#build.publish = null).
  // License activation and updates are delivered through the offline advisor
  // channel (WeChat): the advisor sends the new signed installer, the user
  // installs it manually. Do NOT run auto-checks here — with no feed configured
  // they can only fail/no-op and would emit misleading "checking for update"
  // logs, implying an auto-update path that does not exist.
  //
  // A feed can be enabled later WITHOUT code changes by setting the
  // KONE_UPDATE_FEED_URL environment variable to a hosted electron-updater feed.
  const feedUrl = String(process.env.KONE_UPDATE_FEED_URL || '').trim()
  if (!feedUrl) {
    console.log(
      '[AutoUpdater] No update feed configured — updates delivered via offline (advisor/WeChat) channel; auto-check skipped',
    )
    return
  }

  try {
    updater.setFeedURL({ provider: 'generic', url: feedUrl })
  } catch (err) {
    console.warn(
      '[AutoUpdater] Failed to set feed URL, staying on offline update channel:',
      err instanceof Error ? err.message : String(err || ''),
    )
    return
  }

  // Configure update feed (default: electron-builder publish config)
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true

  // Listen for update events
  updater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for update...')
  })

  updater.on('update-available', (info: any) => {
    _updateAvailable = true
    console.log(`[AutoUpdater] Update available: v${info.version}`)
  })

  updater.on('update-not-available', () => {
    _updateAvailable = false
    console.log('[AutoUpdater] No update available')
  })

  updater.on('download-progress', (progress: any) => {
    console.log(`[AutoUpdater] Download progress: ${Math.round(progress.percent)}%`)
  })

  updater.on('update-downloaded', (info: any) => {
    _downloadCompleted = true
    console.log(`[AutoUpdater] Update downloaded: v${info.version}`)

    // Prompt user to install
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Kone AI 更新已就绪',
        message: `新版本 v${info.version} 已下载完成。`,
        detail: '是否立即重启应用以完成安装？',
        buttons: ['立即重启', '稍后再说'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          updater.quitAndInstall()
        }
      })
  })

  updater.on('error', (error: Error) => {
    console.error('[AutoUpdater] Error:', error.message)
  })

  // Check for updates after a short delay (non-blocking startup)
  setTimeout(() => {
    updater.checkForUpdates().catch((err: Error) => {
      console.warn('[AutoUpdater] Initial check failed:', err.message)
    })
  }, 10000)
}
