import { app, BrowserWindow, dialog, shell } from './electron-bridge'
import * as fs from 'fs'
import * as path from 'path'
import { IPC_CHANNELS } from '../ipc/channels'
import { ConfigStore } from './config-service'
import { registerSecureFeatureIpc } from './license-service'

const TRIAL_PDF_EXPORT_LIMIT = 3
const TRIAL_PDF_COUNT_KEY = 'license.trialPdfExportCount'

/**
 * 试用版 PDF 白皮书导出次数持久化读写。
 *
 * 必须持久化到 config store（而非模块级内存变量），否则用户重启应用即可
 * 将计数清零，绕过 PRD §一.1 规定的"全局上限硬编码为 3 次"PLG 逼单卡点。
 */
const getTrialPdfExportCount = (store: ConfigStore): number => {
  try {
    const raw = Number(store.get(TRIAL_PDF_COUNT_KEY, 0))
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
  } catch {
    return 0
  }
}

const setTrialPdfExportCount = (store: ConfigStore, value: number): void => {
  try {
    store.set(TRIAL_PDF_COUNT_KEY, Math.max(0, Math.floor(value)))
  } catch {
    // config 写入失败时静默降级：本次不落盘，但不阻断导出主流程
  }
}

const getMachineIdSafe = (store: ConfigStore) => {
  try {
    return String(store.get('machineId') || '').substring(0, 16)
  } catch {
    return 'UNREGISTERED'
  }
}

const buildPdfHtml = (payload: {
  company: string
  website: string
  country: string
  machineId: string
  customsData?: {
    annualImportVolume?: string
    topSuppliers?: string[]
    originCountries?: string[]
    lastShipmentDate?: string
  }
  exhibitionFootprints?: string[]
  decisionMakers?: Array<{ name: string; title: string; email: string; phone: string; linkedinUrl?: string }>
  strategies?: Array<{ scenario: string; subject: string; body: string }>
}) => {
  const dm = (payload.decisionMakers || []).slice(0, 5)
  const strategies = (payload.strategies || []).slice(0, 3)
  const footprints = (payload.exhibitionFootprints || []).slice(0, 10)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; font-size: 12px; color: #1e293b; line-height: 1.6; }
  .cover { background: linear-gradient(135deg, #1e40af 0%, #0891b2 100%); color: #fff; padding: 60px 40px; text-align: center; min-height: 300px; }
  .cover h1 { font-size: 28px; margin-bottom: 16px; letter-spacing: 2px; }
  .cover .sub { font-size: 14px; opacity: 0.85; margin-bottom: 24px; }
  .cover .sig { font-size: 10px; opacity: 0.6; margin-top: 40px; font-family: monospace; }
  .section { padding: 24px 32px; border-bottom: 1px solid #e2e8f0; page-break-inside: avoid; }
  .section h2 { font-size: 16px; color: #1e40af; margin-bottom: 12px; border-left: 4px solid #0891b2; padding-left: 8px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .info-item { font-size: 11px; }
  .info-label { color: #64748b; }
  .dm-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-bottom: 8px; }
  .dm-card .name { font-size: 13px; font-weight: 600; color: #0f172a; }
  .dm-card .title { font-size: 11px; color: #475569; }
  .dm-card .contact { font-size: 10px; color: #2563eb; margin-top: 4px; }
  .strategy-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin-bottom: 10px; }
  .strategy-card h3 { font-size: 13px; color: #0891b2; margin-bottom: 6px; }
  .strategy-card .subj { font-weight: 600; font-size: 11px; margin-bottom: 4px; }
  .strategy-card .body { font-size: 10px; color: #475569; white-space: pre-wrap; }
  .footer { text-align: center; padding: 16px; font-size: 9px; color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { padding: 6px 8px; border: 1px solid #e2e8f0; text-align: left; }
  th { background: #f1f5f9; color: #475569; }
</style></head>
<body>
  <div class="cover">
    <h1>Kone AI · 客户全景白皮书</h1>
    <div class="sub">${payload.company} — B2B 深度商业画像与多源情报分析</div>
    <div class="sig">Machine ID: ${payload.machineId} | Generated: ${new Date().toISOString().split('T')[0]}</div>
  </div>

  <div class="section">
    <h2>企业画像</h2>
    <div class="info-grid">
      <div class="info-item"><span class="info-label">企业名称：</span>${payload.company}</div>
      <div class="info-item"><span class="info-label">官网：</span>${payload.website || '-'}</div>
      <div class="info-item"><span class="info-label">目标市场：</span>${payload.country || '-'}</div>
      ${payload.customsData?.annualImportVolume ? `<div class="info-item"><span class="info-label">年进口量级：</span>${payload.customsData.annualImportVolume}</div>` : ''}
      ${payload.customsData?.lastShipmentDate ? `<div class="info-item"><span class="info-label">最近报关日期：</span>${payload.customsData.lastShipmentDate}</div>` : ''}
    </div>
    ${payload.customsData?.topSuppliers?.length ? `<p style="margin-top:8px;font-size:11px;"><span class="info-label">核心供应商：</span>${payload.customsData.topSuppliers.join('、')}</p>` : ''}
    ${payload.customsData?.originCountries?.length ? `<p style="font-size:11px;"><span class="info-label">采购来源国：</span>${payload.customsData.originCountries.join('、')}</p>` : ''}
    ${footprints.length > 0 ? `<p style="margin-top:8px;font-size:11px;"><span class="info-label">历史展会足迹：</span>${footprints.join('、')}</p>` : ''}
  </div>

  ${
    dm.length > 0
      ? `
  <div class="section">
    <h2>决策人图谱 (${dm.length} 人)</h2>
    ${dm
      .map(
        (p) => `
      <div class="dm-card">
        <div class="name">${p.name}</div>
        <div class="title">${p.title}</div>
        <div class="contact">${p.email} | ${p.phone}${p.linkedinUrl ? ` | ${p.linkedinUrl}` : ''}</div>
      </div>
    `,
      )
      .join('')}
  </div>`
      : ''
  }

  ${
    strategies.length > 0
      ? `
  <div class="section">
    <h2>销售弹药库</h2>
    ${strategies
      .map(
        (s, i) => `
      <div class="strategy-card">
        <h3>场景 ${i + 1}：${s.scenario}</h3>
        <div class="subj">Subject: ${s.subject}</div>
        <div class="body">${s.body}</div>
      </div>
    `,
      )
      .join('')}
  </div>`
      : ''
  }

  <div class="footer">Kone AI V1.3 — 客户隐私与数据安全本地100%重计算，绝不外泄至公有云 | ${new Date().toISOString()}</div>
</body></html>`
}

export const registerExportHandlers = (
  ipcMain: Electron.IpcMain,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  store: ConfigStore,
) => {
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.FILES.EXPORT_SAVE,
    store,
    licenseGuard,
    ['lead_export', 'export_full'],
    async (_event, payload: { fileName: string; content: string } | undefined | null) => {
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
    },
    '线索全量导出',
  )

  /* ── V1.3 本地 PDF 客户白皮书导出 ── */
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.FILES.EXPORT_PDF,
    store,
    licenseGuard,
    'analysis_advanced',
    async (
      _event,
      payload:
        | {
            company: string
            website: string
            country: string
            customsData?: Record<string, unknown>
            exhibitionFootprints?: string[]
            decisionMakers?: Array<Record<string, unknown>>
            strategies?: Array<{ scenario: string; subject: string; body: string }>
            fileName?: string
          }
        | undefined
        | null,
    ) => {
      try {
        const claims = licenseGuard.getStoredClaims?.()
        const isTrial = claims?.plan === 'trial'

        if (isTrial) {
          if (getTrialPdfExportCount(store) >= TRIAL_PDF_EXPORT_LIMIT) {
            return {
              success: false,
              code: 429,
              message: '已达到当前套餐高价值功能执行配额上限，请升级至高级企业版解锁无限次资产导出与发信合规检测。',
              error: 'TRIAL_PDF_LIMIT',
            }
          }
          // 注意：配额在导出成功落盘后才递增（见下方 store.set），
          // 避免用户取消保存对话框或生成失败时被误扣次数。
        }

        if (!payload || typeof payload !== 'object') {
          return { success: false, error: '导出参数无效', code: 400 }
        }

        const machineId = getMachineIdSafe(store)
        const html = buildPdfHtml({
          company: String(payload.company || ''),
          website: String(payload.website || ''),
          country: String(payload.country || ''),
          machineId,
          customsData: (payload.customsData as any) || undefined,
          exhibitionFootprints: Array.isArray(payload.exhibitionFootprints)
            ? (payload.exhibitionFootprints as string[])
            : undefined,
          decisionMakers: Array.isArray(payload.decisionMakers) ? (payload.decisionMakers as any) : undefined,
          strategies: Array.isArray(payload.strategies) ? (payload.strategies as any) : undefined,
        })

        const focusedWindow = BrowserWindow.getFocusedWindow()
        if (!focusedWindow) {
          return { success: false, error: '未找到活跃窗口', code: 500 }
        }

        const tempDir = path.join(app.getPath('userData'), 'KoneExports')
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }

        const safeCompanyName = String(payload.company || 'customer')
          .replace(/[<>:"/\\|?*]/g, '_')
          .substring(0, 40)
        const defaultFileName = `Kone_白皮书_${safeCompanyName}_${new Date().toISOString().slice(0, 10)}.pdf`

        const saveDialogOptions = {
          title: '下载客户白皮书 PDF',
          defaultPath: defaultFileName,
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        }

        const dialogResult = focusedWindow
          ? await dialog.showSaveDialog(focusedWindow, saveDialogOptions)
          : await dialog.showSaveDialog(saveDialogOptions)

        if (dialogResult.canceled || !dialogResult.filePath) {
          return { success: false, canceled: true }
        }

        const previewWin = new BrowserWindow({
          width: 800,
          height: 600,
          show: false,
          webPreferences: { nodeIntegration: false, contextIsolation: true },
        })

        await previewWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

        const pdfBuffer = await previewWin.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          pageSize: 'A4',
        })

        previewWin.close()

        fs.writeFileSync(dialogResult.filePath, pdfBuffer)
        shell.showItemInFolder(dialogResult.filePath)

        // 导出成功后才递增试用配额，并持久化到 config store（防重启绕过）
        let trialRemaining: number | undefined
        if (isTrial) {
          const nextCount = getTrialPdfExportCount(store) + 1
          setTrialPdfExportCount(store, nextCount)
          trialRemaining = Math.max(0, TRIAL_PDF_EXPORT_LIMIT - nextCount)
        }

        return {
          success: true,
          data: {
            filePath: dialogResult.filePath,
            trialRemaining,
          },
        }
      } catch (error: any) {
        return {
          success: false,
          error: error?.message || 'PDF 生成失败',
          code: error?.code || 500,
        }
      }
    },
    '客户白皮书 PDF 导出',
  )
}
