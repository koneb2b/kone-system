import { BrowserWindow, dialog, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { IPC_CHANNELS } from '../ipc/channels'
import { ConfigStore } from './config-service'
import { registerSecureFeatureIpc } from './license-service'

export const registerExportHandlers = (
  ipcMain: Electron.IpcMain,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  store: ConfigStore,
) => {
  registerSecureFeatureIpc(ipcMain, IPC_CHANNELS.FILES.EXPORT_SAVE, store, licenseGuard, ['lead_export', 'export_full'], async (_event, payload: { fileName: string; content: string } | undefined | null) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '导出参数无效', code: 400 }
      }
      const { fileName, content } = payload
      if (typeof fileName !== 'string' || typeof content !== 'string') {
        return { success: false, error: '导出文件名或内容无效', code: 400 }
      }
      const safeFileName = path.basename(String(fileName || '')).trim()
      if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
        throw new Error('Invalid fileName')
      }

      const normalizedContent = licenseGuard.enforceExportLimit(String(content || ''))

      const extension = path.extname(safeFileName).replace(/^\./, '').toLowerCase()
      const saveDialogOptions = {
        title: '导出客户资料 (Export Leads)',
        defaultPath: safeFileName,
        filters: [
          {
            name: extension ? 'Data Files' : 'All Files',
            extensions: extension ? [extension] : ['*'],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
      }

      const focusedWindow = BrowserWindow.getFocusedWindow()
      const dialogResult = focusedWindow
        ? await dialog.showSaveDialog(focusedWindow, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions)

      if (dialogResult.canceled || !dialogResult.filePath) {
        return { success: false, canceled: true }
      }

      const filePath = dialogResult.filePath
      fs.writeFileSync(filePath, normalizedContent, 'utf8')
      shell.showItemInFolder(filePath)
      return { success: true, data: { filePath } }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Export failed', code: error?.code }
    }
  }, '线索全量导出')
}
