import { app, BrowserWindow, dialog, shell } from './electron-bridge'
import * as fs from 'fs'
import * as path from 'path'
import { IPC_CHANNELS } from '../ipc/channels'
import { ConfigStore } from './config-service'
import { registerSecureFeatureIpc } from './license-service'
import type { FileExportPdfRequest } from '../../src/shared/ipc-contracts'

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

/** 导出供预览/测试使用（白皮书模板是纯函数，可脱离 Electron 直接渲染 HTML） */
export const buildPdfHtml = (payload: {
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
  decisionMakers?: Array<{
    name: string
    title: string
    email: string
    phone: string
    linkedinUrl?: string
    /** 邮箱验证等级（contact-validation.ts 产出） */
    emailGrade?: string
    /** 电话是否有效 */
    phoneValid?: boolean
    /** 置信度 0-100 */
    confidenceScore?: number
  }>
  strategies?: Array<{ scenario: string; subject: string; body: string }>
  /* 可信度与来源（2026-10-09）：让白皮书能回答"数据从哪来、可不可信" */
  matchScore?: number
  opportunityScore?: Record<string, unknown>
  dataSourceType?: string
  contact?: string
  contactTitle?: string
  email?: string
  phone?: string
  industry?: string
  /** 企业地址（2026-10-11）：与 CSV 导出同步补齐，回应用户「店址」诉求 */
  address?: string
  riskFlags?: string[]
  evidence?: string
}) => {
  const dm = (payload.decisionMakers || []).slice(0, 5)
  const strategies = (payload.strategies || []).slice(0, 3)
  const footprints = (payload.exhibitionFootprints || []).slice(0, 10)

  /* ── 设计语言对齐项目 ───────────────────────────────────────────────
     配色取自 `src/index.css` 的 CSS 变量（此前白皮书用深蓝 #1e40af + 青 #0891b2，
     与项目主色**不符**）：
       --brand-green             : 92 65% 44%  → #5cb828（**品牌标识绿**）
       --primary                 : 221 83% 53% → #2563eb（**UI 主色蓝**，2026-10-09 对齐）
       --deep-blue               : 210 100% 8% → #001529（深蓝黑）
       --sidebar-background      : 217 33% 17% → #1e293b
       --border                  : 214 32% 91% → #e2e8f0
       --muted-foreground        : 217 16% 46% → #64748b
       --radius                  : 0.75rem     → 12px
     字体沿用项目字体栈（Microsoft YaHei / PingFang SC）。

     注意：白皮书是**对外交付文档**，属「品牌物料」场景，
     故采用**品牌绿**作点缀（而非软件 UI 的蓝色主色）—— 二者场景不同，不混用。 */
  const BRAND = '#5cb828'
  const DEEP = '#001529'
  const INK = '#1e293b'
  const LINE = '#e2e8f0'
  const MUTED = '#64748b'
  const SURFACE = '#f8fafc'

  /** HTML 转义：白皮书会渲染用户/外部数据，必须防注入 */
  const esc = (v: unknown): string =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  /** 空值统一显示为「—」，避免出现 undefined / null 字样 */
  const val = (v: unknown): string => {
    const s = String(v ?? '').trim()
    return s ? esc(s) : '—'
  }

  /** 邮箱等级 → 徽标样式与文案（诚实标注，不美化） */
  const gradeBadge = (grade?: string): { text: string; bg: string; fg: string } => {
    switch (grade) {
      case 'verified':
        return { text: '已验证', bg: '#ecfdf5', fg: '#15803d' }
      case 'probable':
      case 'catch_all':
        return { text: '可能有效', bg: '#eff6ff', fg: '#1d4ed8' }
      case 'risky':
        return { text: '存在风险', bg: '#fffbeb', fg: '#b45309' }
      case 'invalid':
        return { text: '无效', bg: '#fef2f2', fg: '#b91c1c' }
      default:
        return { text: '未验证', bg: '#f1f5f9', fg: MUTED }
    }
  }

  /** 评分条（0-100），用于「综合评分」区块的可视化 */
  const scoreBar = (label: string, score: number | undefined, hint?: string): string => {
    if (typeof score !== 'number' || !Number.isFinite(score)) return ''
    const pct = Math.max(0, Math.min(100, Math.round(score)))
    return `
      <div class="score-row">
        <div class="score-head">
          <span class="score-label">${esc(label)}</span>
          <span class="score-value">${pct}<i>/100</i></span>
        </div>
        <div class="score-track"><div class="score-fill" style="width:${pct}%"></div></div>
        ${hint ? `<div class="score-hint">${esc(hint)}</div>` : ''}
      </div>`
  }

  const opp = (payload.opportunityScore ?? {}) as Record<string, unknown>
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

  const scoreSection =
    typeof payload.matchScore === 'number' || num(opp.icpFit) !== undefined || num(opp.finalScore) !== undefined
      ? `
  <div class="section">
    <h2>综合评分</h2>
    <div class="scores">
      ${scoreBar('匹配度', payload.matchScore, '确定性规则评分，与线索列表一致')}
      ${scoreBar('ICP 契合', num(opp.icpFit))}
      ${scoreBar('采购意向', num(opp.intent))}
      ${scoreBar('证据充分度', num(opp.evidence))}
      ${scoreBar('机会分（终值）', num(opp.finalScore), '综合 ICP / 意向 / 证据，扣除风险项后得出')}
    </div>
  </div>`
      : ''

  const riskSection =
    (payload.riskFlags?.length ?? 0) > 0 || payload.evidence
      ? `
  <div class="section">
    <h2>风险与证据</h2>
    ${
      payload.riskFlags?.length
        ? `<div class="risk-box">
             <div class="risk-title">风险提示</div>
             <ul class="risk-list">${payload.riskFlags.map((r) => `<li>${val(r)}</li>`).join('')}</ul>
           </div>`
        : ''
    }
    ${payload.evidence ? `<div class="evidence"><span class="info-label">证据摘要：</span>${val(payload.evidence)}</div>` : ''}
  </div>`
      : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Microsoft YaHei', 'PingFang SC', -apple-system, sans-serif; font-size: 12px; color: ${INK}; line-height: 1.65; background:#fff; }

  /* ── 封面：深蓝黑底 + 品牌绿点缀，与项目主色一致 ── */
  .cover { position:relative; background: linear-gradient(150deg, ${DEEP} 0%, #0b2338 60%, #123048 100%); color:#fff; padding: 64px 44px 52px; min-height: 300px; overflow:hidden; }
  .cover::after { content:''; position:absolute; right:-80px; top:-80px; width:280px; height:280px; border-radius:50%; background: radial-gradient(circle, rgba(92,184,40,0.28), rgba(92,184,40,0) 70%); }
  .brand-row { display:flex; align-items:center; gap:10px; margin-bottom:34px; }
  .brand-mark { width:30px; height:30px; border-radius:9px; background:${BRAND}; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:15px; color:#fff; }
  .brand-name { font-size:14px; letter-spacing:3px; font-weight:600; opacity:.95; }
  .cover h1 { font-size:30px; letter-spacing:1px; font-weight:700; margin-bottom:14px; }
  .cover .accent { width:56px; height:4px; border-radius:2px; background:${BRAND}; margin-bottom:20px; }
  .cover .sub { font-size:14px; color:rgba(255,255,255,.86); margin-bottom:8px; }
  .cover .sub-2 { font-size:12px; color:rgba(255,255,255,.6); }
  .cover .meta { position:relative; z-index:1; margin-top:36px; display:flex; gap:26px; font-size:10px; color:rgba(255,255,255,.62); font-family: ui-monospace, monospace; }

  .section { padding: 26px 34px; border-bottom: 1px solid ${LINE}; page-break-inside: avoid; }
  .section h2 { font-size:15px; color:${DEEP}; font-weight:700; margin-bottom:16px; padding-left:11px; border-left:4px solid ${BRAND}; line-height:1.2; }

  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px 26px; }
  .info-item { font-size:11.5px; padding-bottom:8px; border-bottom:1px dashed ${LINE}; }
  .info-label { color:${MUTED}; margin-right:6px; }
  .info-value { color:${INK}; font-weight:600; }

  /* 评分可视化 */
  .scores { display:flex; flex-direction:column; gap:13px; }
  .score-row { page-break-inside:avoid; }
  .score-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px; }
  .score-label { font-size:11.5px; color:${INK}; }
  .score-value { font-size:14px; font-weight:700; color:${DEEP}; }
  .score-value i { font-size:10px; font-weight:400; color:${MUTED}; font-style:normal; }
  .score-track { height:7px; border-radius:4px; background:${SURFACE}; border:1px solid ${LINE}; overflow:hidden; }
  .score-fill { height:100%; border-radius:4px; background:linear-gradient(90deg, ${BRAND}, #7ed957); }
  .score-hint { font-size:10px; color:${MUTED}; margin-top:4px; }

  /* 决策人卡片 —— 白皮书的核心资产 */
  .dm-card { border:1px solid ${LINE}; border-radius:12px; padding:14px 16px; margin-bottom:10px; page-break-inside:avoid; background:#fff; }
  .dm-top { display:flex; align-items:center; gap:11px; margin-bottom:9px; }
  .dm-avatar { width:34px; height:34px; border-radius:10px; background:${SURFACE}; border:1px solid ${LINE}; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:${DEEP}; flex-shrink:0; }
  .dm-name { font-size:13.5px; font-weight:700; color:${DEEP}; }
  .dm-title { font-size:11px; color:${MUTED}; margin-top:2px; }
  .dm-rows { display:flex; flex-direction:column; gap:5px; }
  .dm-row { font-size:11px; display:flex; align-items:center; gap:7px; }
  .dm-row .k { color:${MUTED}; width:44px; flex-shrink:0; }
  .dm-row .v { color:${INK}; word-break:break-all; }
  .badge { display:inline-block; font-size:9.5px; padding:1px 7px; border-radius:999px; font-weight:600; }

  /* 风险与证据 */
  .risk-box { border:1px solid #fde68a; background:#fffbeb; border-radius:12px; padding:12px 14px; margin-bottom:10px; }
  .risk-title { font-size:11.5px; font-weight:700; color:#b45309; margin-bottom:6px; }
  .risk-list { list-style:none; }
  .risk-list li { font-size:11px; color:#92400e; padding-left:12px; position:relative; }
  .risk-list li::before { content:'!'; position:absolute; left:0; font-weight:700; }
  .evidence { font-size:11px; color:${INK}; background:${SURFACE}; border-radius:12px; padding:11px 13px; }

  .strategy-card { border:1px solid ${LINE}; border-radius:12px; padding:15px; margin-bottom:11px; page-break-inside:avoid; }
  .strategy-card h3 { font-size:12.5px; color:${DEEP}; font-weight:700; margin-bottom:7px; }
  .strategy-card .subj { font-size:11px; font-weight:600; color:${INK}; margin-bottom:6px; padding:7px 10px; background:${SURFACE}; border-radius:8px; }
  .strategy-card .body { font-size:10.5px; color:#475569; white-space:pre-wrap; }

  /* 数据可信度说明 —— 诚实标注数据边界 */
  .trust { background:${SURFACE}; border-radius:12px; padding:16px 18px; border:1px solid ${LINE}; }
  .trust-title { font-size:12px; font-weight:700; color:${DEEP}; margin-bottom:9px; }
  .trust-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 24px; margin-bottom:11px; }
  .trust-item { font-size:10.5px; }
  .trust-note { font-size:10px; color:${MUTED}; line-height:1.75; border-top:1px dashed ${LINE}; padding-top:10px; }
  .legend { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }

  .footer { text-align:center; padding:18px; font-size:9px; color:#94a3b8; }
</style></head>
<body>
  <div class="cover">
    <div class="brand-row">
      <div class="brand-mark">K</div>
      <div class="brand-name">KONE AI</div>
    </div>
    <h1>客户全景白皮书</h1>
    <div class="accent"></div>
    <div class="sub">${val(payload.company)}</div>
    <div class="sub-2">B2B 深度商业画像 · 多源情报交叉验证 · 关键决策人图谱</div>
    <div class="meta">
      <span>生成日期 ${new Date().toISOString().split('T')[0]}</span>
      <span>数据来源 ${val(payload.dataSourceType)}</span>
      <span>设备 ${esc(payload.machineId)}</span>
    </div>
  </div>

  <div class="section">
    <h2>企业画像</h2>
    <div class="info-grid">
      <div class="info-item"><span class="info-label">企业名称</span><span class="info-value">${val(payload.company)}</span></div>
      <div class="info-item"><span class="info-label">官方网站</span><span class="info-value">${val(payload.website)}</span></div>
      <div class="info-item"><span class="info-label">目标市场</span><span class="info-value">${val(payload.country)}</span></div>
      <div class="info-item"><span class="info-label">所属行业</span><span class="info-value">${val(payload.industry)}</span></div>
      <div class="info-item"><span class="info-label">企业地址</span><span class="info-value">${val(payload.address)}</span></div>
      <div class="info-item"><span class="info-label">企业联系口</span><span class="info-value">${val(payload.contact)}${payload.contactTitle ? ` · ${esc(payload.contactTitle)}` : ''}</span></div>
      <div class="info-item"><span class="info-label">企业邮箱</span><span class="info-value">${val(payload.email)}</span></div>
      <div class="info-item"><span class="info-label">企业电话</span><span class="info-value">${val(payload.phone)}</span></div>
      ${payload.customsData?.annualImportVolume ? `<div class="info-item"><span class="info-label">年进口量级</span><span class="info-value">${val(payload.customsData.annualImportVolume)}</span></div>` : ''}
      ${payload.customsData?.lastShipmentDate ? `<div class="info-item"><span class="info-label">最近报关日期</span><span class="info-value">${val(payload.customsData.lastShipmentDate)}</span></div>` : ''}
    </div>
    ${payload.customsData?.topSuppliers?.length ? `<p style="margin-top:11px;font-size:11px;"><span class="info-label">核心供应商</span>${payload.customsData.topSuppliers.map((s) => esc(s)).join('、')}</p>` : ''}
    ${payload.customsData?.originCountries?.length ? `<p style="font-size:11px;"><span class="info-label">采购来源国</span>${payload.customsData.originCountries.map((s) => esc(s)).join('、')}</p>` : ''}
    ${footprints.length > 0 ? `<p style="margin-top:11px;font-size:11px;"><span class="info-label">历史展会足迹</span>${footprints.map((s) => esc(s)).join('、')}</p>` : ''}
  </div>

  ${scoreSection}
  ${riskSection}

  ${
    dm.length > 0
      ? `
  <div class="section">
    <h2>核心决策人（${dm.length} 位）</h2>
    ${dm
      .map((p, i) => {
        const g = gradeBadge((p as { emailGrade?: string }).emailGrade)
        const phoneValid = (p as { phoneValid?: boolean }).phoneValid
        const initial = esc(
          String(p.name || '?')
            .trim()
            .slice(0, 1),
        )
        return `
      <div class="dm-card">
        <div class="dm-top">
          <div class="dm-avatar">${initial}</div>
          <div>
            <div class="dm-name">${val(p.name)}</div>
            <div class="dm-title">${val(p.title)}</div>
          </div>
        </div>
        <div class="dm-rows">
          ${
            p.email
              ? `<div class="dm-row"><span class="k">邮箱</span><span class="v">${esc(p.email)}</span>
                   <span class="badge" style="background:${g.bg};color:${g.fg}">${g.text}</span></div>`
              : ''
          }
          ${
            p.phone
              ? `<div class="dm-row"><span class="k">电话</span><span class="v">${esc(p.phone)}</span>
                   ${phoneValid === true ? '<span class="badge" style="background:#ecfdf5;color:#15803d">号码有效</span>' : ''}</div>`
              : ''
          }
          ${p.linkedinUrl ? `<div class="dm-row"><span class="k">LinkedIn</span><span class="v">${esc(p.linkedinUrl)}</span></div>` : ''}
          <div class="dm-row"><span class="k">置信度</span><span class="v">${val((p as { confidenceScore?: number }).confidenceScore)}${(p as { confidenceScore?: number }).confidenceScore !== undefined ? ' / 100' : ''}</span></div>
        </div>
      </div>`
      })
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
        <h3>场景 ${i + 1}：${val(s.scenario)}</h3>
        <div class="subj">主题：${val(s.subject)}</div>
        <div class="body">${esc(s.body)}</div>
      </div>
    `,
      )
      .join('')}
  </div>`
      : ''
  }

  <div class="section">
    <h2>数据来源与可信度</h2>
    <div class="trust">
      <div class="trust-title">本报告数据如何得来</div>
      <div class="trust-grid">
        <div class="trust-item"><span class="info-label">数据来源</span><span class="info-value">${val(payload.dataSourceType)}</span></div>
        <div class="trust-item"><span class="info-label">采集时间</span><span class="info-value">${new Date().toISOString().split('T')[0]}</span></div>
        <div class="trust-item"><span class="info-label">决策人样本</span><span class="info-value">${dm.length} 位</span></div>
        <div class="trust-item"><span class="info-label">计算方式</span><span class="info-value">本地确定性规则 + 本地大模型</span></div>
      </div>
      <div class="trust-note">
        <b>邮箱等级含义：</b>
        <div class="legend">
          <span class="badge" style="background:#ecfdf5;color:#15803d">已验证</span>
          <span class="badge" style="background:#eff6ff;color:#1d4ed8">可能有效</span>
          <span class="badge" style="background:#fffbeb;color:#b45309">存在风险</span>
          <span class="badge" style="background:#fef2f2;color:#b91c1c">无效</span>
          <span class="badge" style="background:#f1f5f9;color:${MUTED}">未验证</span>
        </div>
        <br>
        「已验证」仅代表通过了格式与域名层面校验，<b>不构成 100% 投递保证</b>；
        标注「存在风险 / 无效」的地址建议在触达前二次确认。<br>
        本报告中的企业信息、决策人信息来自<b>公开网页与第三方数据源</b>，
        可能随对方网站更新而变动；海关与展会数据为<b>公开网页近似检索结果</b>，仅供参考。<br>
        所有数据均在本机完成采集与计算，<b>不上传至任何公有云</b>。
      </div>
    </div>
  </div>

  <div class="footer">Kone AI V1.3 · 客户隐私与数据安全本地 100% 重计算，绝不外泄至公有云 · ${new Date().toISOString()}</div>
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
    /* 门禁为 `lead_export`（任何已授权层级均可导出 PDF），**试用由下方 `isTrial` 的 3 次配额差异化**——
       此即 kone-PRD §零.3「Trial 高价值 PDF 白皮书导出上限 3 次（全局硬编码）| PLG 逼单卡点」。
       此前门禁为 `analysis_advanced`（付费专属），与下方的 `isTrial` 配额代码**自相矛盾**：
       试用永远进不来，3 次配额成为死代码。 */
    'lead_export',
    async (_event, payload: FileExportPdfRequest | undefined | null) => {
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
          /* 可信度与来源（2026-10-09）：供白皮书渲染「综合评分」「风险与证据」
             「数据来源与可信度」三个区块，回应用户「真实可靠」的诉求。 */
          matchScore: typeof payload.matchScore === 'number' ? payload.matchScore : undefined,
          opportunityScore: (payload.opportunityScore as Record<string, unknown>) || undefined,
          dataSourceType: payload.dataSourceType ? String(payload.dataSourceType) : undefined,
          contact: payload.contact ? String(payload.contact) : undefined,
          contactTitle: payload.contactTitle ? String(payload.contactTitle) : undefined,
          email: payload.email ? String(payload.email) : undefined,
          phone: payload.phone ? String(payload.phone) : undefined,
          industry: payload.industry ? String(payload.industry) : undefined,
          address: payload.address ? String(payload.address) : undefined,
          riskFlags: Array.isArray(payload.riskFlags) ? (payload.riskFlags as string[]) : undefined,
          evidence: payload.evidence ? String(payload.evidence) : undefined,
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
