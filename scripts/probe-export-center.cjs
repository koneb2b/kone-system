/**
 * 客户资料下载端 —— 自动化视觉验证探针（AI 自验，不依赖人工确认）。
 *
 * ## 为什么需要它
 * 「下载端样式和数据完不完善」这类问题**必须看渲染结果**才能判定。
 * 本探针脱离 Electron，直接用 Puppeteer 连 Vite dev server：
 *   1. 注入 mock Electron 桥（license=premium 放行、leads=样例数据）
 *   2. 导航到「线索管理」（data-nav-id="leads"）
 *   3. 打开「客户资料下载端」侧滑 → 截图
 *   4. 顺带断言关键数据真的渲染出来了（不只是好看）
 *
 * 与 `scripts/puppeteer-selfcheck.cjs` 同思路，但目标是视觉 + 数据双验证。
 *
 * 用法：先 `npx vite --host 127.0.0.1 --port 5173`，再跑本脚本。
 */

const puppeteer = require('puppeteer')
const path = require('node:path')

const BASE_URL = 'http://127.0.0.1:5173'
const OUT_DIR = path.join(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 样例线索 —— 覆盖各种可信度/缺失状态，用于检验渲染与文案。 */
const SAMPLE_LEADS = [
  {
    id: 1,
    company: 'Acme Industrial Trading Co., Ltd.',
    contact: 'John Doe',
    contactTitle: 'Procurement Manager',
    email: 'john@acme-industrial.com',
    phone: '+1 415 555 0100',
    country: 'United States',
    countryCode: 'US',
    industry: 'Industrial Machinery Parts',
    source: 'google_organic',
    matchScore: 92,
    status: 'new',
    followUp: 'pending',
    starred: true,
    lastActivity: '2026-10-08',
    addedDate: '2026-10-08',
    tags: ['高价值'],
    unlocked: true,
    website: 'https://acme-industrial.com',
    estimatedValue: '$120,000',
    dataSourceType: 'google_organic',
    snippet: '北美工业配件进口商，近两年采购额持续增长。',
    decisionMakers: [
      {
        name: 'Jane Smith',
        title: 'Chief Executive Officer',
        email: 'jane.smith@acme-industrial.com',
        phone: '+1 415 555 0199',
        linkedinUrl: 'https://linkedin.com/in/janesmith',
        source: 'linkedin_search',
        confidenceScore: 94,
        emailGrade: 'verified',
        phoneValid: true,
      },
      {
        name: 'Robert Lee',
        title: 'Head of Sourcing',
        email: 'robert.lee@acme-industrial.com',
        phone: '',
        source: 'linkedin_search',
        confidenceScore: 81,
        emailGrade: 'probable',
        phoneValid: false,
      },
    ],
  },
  {
    id: 2,
    company: 'Berlin Werkzeug GmbH',
    contact: 'Klaus Müller',
    contactTitle: '',
    email: '',
    phone: '+49 30 5550 2200',
    country: 'Germany',
    countryCode: 'DE',
    industry: 'Tooling & Hardware',
    source: 'google_maps',
    matchScore: 74,
    status: 'contacted',
    followUp: 'in_progress',
    starred: false,
    lastActivity: '2026-10-07',
    addedDate: '2026-10-07',
    tags: [],
    unlocked: true,
    website: 'https://berlin-werkzeug.de',
    estimatedValue: '',
    dataSourceType: 'google_maps',
    decisionMakers: [],
  },
  {
    id: 3,
    company: 'Osaka Precision Components',
    contact: '',
    contactTitle: '',
    email: '',
    phone: '',
    country: 'Japan',
    countryCode: 'JP',
    industry: 'Precision Components',
    source: 'anysearch',
    matchScore: 68,
    status: 'new',
    followUp: 'pending',
    starred: false,
    lastActivity: '2026-10-06',
    addedDate: '2026-10-06',
    tags: [],
    unlocked: false,
    website: '',
    estimatedValue: '',
    dataSourceType: 'anysearch',
    decisionMakers: [],
  },
]

/** 注入 mock Electron 桥 —— 让渲染层以为在 Electron 里跑，且授权为 premium。 */
const installMockBridge = () => {
  window.__KONE_PROBE__ = { configCalls: [], exportCalls: [] }
  const ok = (data) => Promise.resolve({ success: true, data })
  const leads = SAMPLE_LEADS_PLACEHOLDER

  window.electronAPI = {
    system: { getDeviceStatus: () => ok({ machineId: 'probe-machine', trialDaysLeft: 30 }) },
    auth: { getSession: () => ok(null), login: () => ok(null), logout: () => ok(null) },
    license: {
      checkStatus: () => ok({ plan: 'premium', status: 'active', features: [], expiresAt: null }),
      getInfo: () => ok({ plan: 'premium', status: 'active' }),
      verify: () => ok({ valid: true }),
    },
    config: {
      get: (key) => {
        window.__KONE_PROBE__.configCalls.push(key)
        if (key === 'leads') return ok(leads)
        return ok(null)
      },
      set: () => ok(null),
      save: () => ok(null),
      fetchModels: () => ok({ models: [] }),
    },
    // 真实桥路径为 `files.saveExport`（见 src/lib/electron-api.ts:235），
    // 此前 mock 成 file/leads.saveExportFile → 探针捕获不到 payload。
    files: {
      saveExport: (payload) => {
        window.__KONE_PROBE__.exportCalls.push(payload)
        return Promise.resolve({ success: true, data: { path: 'C:\\probe\\export.csv', canceled: false } })
      },
    },
    account: { getList: () => ok({ accounts: [] }) },
    autopilot: { getState: () => ok(null), setState: () => ok(null), clearLegacy: () => ok(null) },
    agent: { list: () => ok({ agents: [] }), getLog: () => ok({ entries: [] }) },
    secret: { check: () => ok({ configured: false }), set: () => ok(null) },
    api: { testConnection: () => ok({ connected: false }), proxy: () => ok(null) },
    cloud: { checkCollision: () => ok({ collided: false }) },
    search: { execute: () => ok(null) },
  }
}

const run = async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=2'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })

  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  const mockSrc = installMockBridge.toString().replace('SAMPLE_LEADS_PLACEHOLDER', JSON.stringify(SAMPLE_LEADS))
  await page.evaluateOnNewDocument(`(${mockSrc})()`)

  // 等 dev server
  // 注意：Vite 的 HMR 是长连接（websocket），`networkidle2` 可能永不触发 →
  // 一律超时。故改用 `domcontentloaded` + 显式等待选择器。
  let ready = false
  for (let i = 0; i < 40; i += 1) {
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
      ready = true
      break
    } catch (err) {
      if (i === 39) console.error('goto failed:', err?.message || err)
      await sleep(1000)
    }
  }
  if (!ready) {
    await browser.close()
    throw new Error('dev server not reachable at ' + BASE_URL)
  }

  // 等 React 挂载
  await page.waitForSelector('button[data-nav-id="leads"]', { timeout: 20000 })
  await page.click('button[data-nav-id="leads"]')
  await sleep(2500) // 等 leads 载入 + 渲染

  // 打开下载端
  const trigger = await page.waitForSelector('[data-testid="btn-export-csv"]', { timeout: 15000 })
  await trigger.click()
  await sleep(1200)

  const listShot = path.join(OUT_DIR, 'probe-export-center-open.png')
  await page.screenshot({ path: listShot })

  // ---- 断言：文字必须真的渲染出来 ----
  const panelText = await page.evaluate(() => document.body.innerText)
  const checks = {
    hasTitle: panelText.includes('客户资料下载端'),
    hasReachability: panelText.includes('可触达渠道分布'),
    hasGroupIncome: panelText.includes('核心关键人'),
    hasDecisionMakerHint: panelText.includes('决策人最多 3 位'),
    hasColumnCount: /将导出\s*\d+\s*列/.test(panelText),
    hasExportButton: /导出 CSV（\d+ 条）/.test(panelText),
    hasTotal68: panelText.includes('3'), // 样例 3 条
  }

  // ---- 断言：导出的 CSV 内容（点击导出，读取传给桥的 payload） ----
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const target = btns.find((b) => /导出 CSV/.test(b.textContent || ''))
    if (target) target.click()
  })
  await sleep(1200)
  const exportPayload = await page.evaluate(() => {
    const calls = window.__KONE_PROBE__?.exportCalls || []
    return calls[calls.length - 1] || null
  })

  await browser.close()

  const csvLines = exportPayload ? String(exportPayload.content || '').replace(/^\ufeff/, '').split('\n') : []
  const csvHeaders = csvLines[0] ? csvLines[0].split(',') : []

  const result = {
    screenshot: listShot,
    checks,
    consoleErrors: consoleErrors.slice(0, 10),
    export: {
      captured: Boolean(exportPayload),
      fileName: exportPayload?.fileName,
      headerCount: csvHeaders.length,
      headers: csvHeaders,
      rowCount: Math.max(0, csvLines.length - 1),
      firstRow: csvLines[1] || '',
      hasDecisionMakerCols: csvHeaders.some((h) => h.includes('决策人1姓名')),
      hasReachabilityCol: csvHeaders.includes('可触达渠道'),
    },
  }
  console.log(JSON.stringify(result, null, 2))

  const allOk = Object.values(checks).every(Boolean) && Object.values(result.export).every((v) => v !== false)
  if (!allOk) process.exit(2)
}

run().catch((err) => {
  console.error('PROBE ERROR:', err?.message || err)
  process.exit(1)
})
