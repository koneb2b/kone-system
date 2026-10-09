/**
 * 设计 token 修复的**回归检查**：逐页截图，确认 `@theme inline` 注册后
 * 各页面仍正常渲染（不出现整页 ErrorBoundary），并收集 console error。
 *
 * 注意：mock 桥统一走 `scripts/lib/mock-bridge.cjs`（键名严格对齐 preload），
 * 否则渲染层挂载期抛错 → 整页白屏，探针产出无意义截图。
 */
const puppeteer = require('puppeteer')
const path = require('node:path')
const { buildMockBridgeSource } = require('./lib/mock-bridge.cjs')

const BASE_URL = 'http://127.0.0.1:5173'
const OUT = path.join(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SAMPLE_LEADS = [
  {
    id: 1,
    company: 'Acme Industrial Trading Co., Ltd.',
    contact: 'John Doe',
    contactTitle: 'Procurement Manager',
    email: 'john@acme.com',
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
    tags: [],
    unlocked: true,
    website: 'https://acme.com',
    estimatedValue: '$120,000',
    dataSourceType: 'google_organic',
    decisionMakers: [
      {
        name: 'Jane Smith',
        title: 'CEO',
        email: 'jane@acme.com',
        phone: '+1 415 555 0199',
        linkedinUrl: 'https://linkedin.com/in/jane',
        source: 'linkedin_search',
        confidenceScore: 94,
        emailGrade: 'verified',
        phoneValid: true,
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
    industry: 'Tooling',
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

const run = async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 950 })

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

  await page.evaluateOnNewDocument(buildMockBridgeSource({ leads: SAMPLE_LEADS }))
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await sleep(3000)

  const sidebar = await page.evaluate(() => {
    const aside = document.querySelector('aside')
    if (!aside) return { found: false }
    const r = aside.getBoundingClientRect()
    const navBtns = Array.from(aside.querySelectorAll('button[data-nav-id]'))
    const visible = navBtns.filter((b) => {
      const br = b.getBoundingClientRect()
      return br.width > 0 && br.height > 0 && br.top >= 0
    }).length
    return {
      found: true,
      width: Math.round(r.width),
      navTotal: navBtns.length,
      navFullyVisible: visible,
      navIds: navBtns.map((b) => b.getAttribute('data-nav-id')),
    }
  })

  const shots = []
  const pages = ['search', 'leads', 'data', 'knowledge', 'settings']
  for (const nav of pages) {
    try {
      await page.waitForSelector(`button[data-nav-id="${nav}"]`, { timeout: 8000 })
      await page.click(`button[data-nav-id="${nav}"]`)
      await sleep(2000)
      const p = path.join(OUT, `probe-page-${nav}.png`)
      await page.screenshot({ path: p })
      shots.push(path.basename(p))
    } catch (e) {
      errors.push(`nav ${nav} failed: ${e?.message || e}`)
    }
  }

  await browser.close()
  console.log(JSON.stringify({ shots, sidebar, errors: errors.slice(0, 8) }, null, 2))
}

run().catch((e) => {
  console.error('ERROR', e?.message || e)
  process.exit(1)
})
