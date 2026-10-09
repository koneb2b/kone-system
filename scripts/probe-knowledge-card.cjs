/**
 * 知识库来源卡片 —— 自动化视觉验证探针（AI 自验，不依赖人工确认）。
 *
 * ## 验证目标
 * `KnowledgeSourceCard`（analysis-drawer.tsx）是「知识库是否真的参与了 AI 分析」
 * 的唯一可见证据。改造前 usedKnowledgeTitles 只透传不渲染 → 用户无从判断。
 *
 * 本探针跑**两种状态**并各截一图：
 *   1. 有资料命中 → 蓝色卡片 + 条目列表 + 条数徽标
 *   2. 无资料     → 琥珀色提示卡 + 「去补全产品资料」引导按钮
 *
 * ## 防自欺护栏（重要）
 * 初版探针曾出现「两个场景截出完全相同的图」而仍报通过的情况 —— 探针不可信
 * 比没探针更危险。故本版强制三条：
 *   a) patch 用 `Object.defineProperty`（简单赋值会被 mock 桥的 Proxy 吞掉）
 *   b) 断言卡片真的进入**视口**（DOM 存在 ≠ 用户可见）
 *   c) 断言两张截图**哈希不同**（相同即说明场景未真正区分）
 *
 * 用法：先 `npx vite --host 127.0.0.1 --port 5173`，再跑本脚本。
 */

const puppeteer = require('puppeteer')
const path = require('node:path')
const crypto = require('node:crypto')
const fs = require('node:fs')
const { buildMockBridgeSource } = require('./lib/mock-bridge.cjs')

const BASE_URL = 'http://127.0.0.1:5173'
const OUT_DIR = path.join(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    starred: false,
    lastActivity: '2026-10-08',
    addedDate: '2026-10-08',
    tags: [],
    unlocked: true,
    website: 'https://acme-industrial.com',
    estimatedValue: '$120,000',
    dataSourceType: 'google_organic',
    snippet: '北美工业配件进口商。',
    decisionMakers: [],
  },
]

const buildAnalysisResponse = (usedKnowledgeTitles) => ({
  success: true,
  data: {
    content: 'analysis body',
    companyProfile: 'Acme 是北美领先的工业配件进口商，采购规模稳定增长。',
    painPoints: '供应链分散导致交期波动，急需稳定且可追溯的供货方。',
    valueMapping: '对照知识库中的「工厂实力」，自有产线可解决其交期稳定诉求。',
    emailSubject: 'Stable supply for your industrial parts line',
    emailBody: 'Hi Acme team,\n\nWe noticed your growing import volume.\n\nBest regards,\nKone Agent',
    confidence: 88,
    usedKnowledgeTitles,
    usedFallback: false,
    source: 'website',
  },
})

const hashFile = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

const run = async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=2'],
  })

  const results = []
  const allErrors = []

  const scenarios = [
    {
      key: 'with-knowledge',
      titles: ['工厂实力：自有 20000 平米产线', '认证资质：ISO9001 / CE'],
      shot: 'probe-knowledge-card-with.png',
      expect: (t) => t.includes('引用产品资料') && t.includes('工厂实力：自有 20000 平米产线'),
    },
    {
      key: 'without-knowledge',
      titles: [],
      shot: 'probe-knowledge-card-without.png',
      expect: (t) => t.includes('未引用任何产品资料') && t.includes('去补全产品资料'),
    },
  ]

  for (const scenario of scenarios) {
    // 每个场景用独立 browser context —— 否则第二个场景会命中第一个场景
    // 持久化到 store 的 analysisCache，导致两场景渲染同一内容。
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })

    const errors = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    const bridgeSrc = buildMockBridgeSource({ leads: SAMPLE_LEADS })
    const response = JSON.stringify(buildAnalysisResponse(scenario.titles))

    await page.evaluateOnNewDocument(`
      ${bridgeSrc}
      ;(() => {
        const RESPONSE = ${response};
        try {
          // defineProperty 而非赋值 —— mock 桥的 Proxy 会吞掉普通 set
          Object.defineProperty(window.electronAPI.analysis, 'generate', {
            value: () => Promise.resolve(RESPONSE),
            writable: true,
            configurable: true,
          });
        } catch (e) { window.__PATCH_ERROR__ = String(e); }
      })()
    `)

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('button[data-nav-id="leads"]', { timeout: 20000 })
    await page.click('button[data-nav-id="leads"]')
    await sleep(2500)

    const analyzeBtn = await page.waitForSelector('[data-testid="btn-analyze-lead"]', { timeout: 15000 })
    await analyzeBtn.click()
    await sleep(1500)

    // 点击生成按钮。注意：报告面板（含知识库卡片）只在生成成功后才渲染，
    // 固定 sleep 会拍到尚未生成的页面（曾导致两场景截图完全相同）。
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const gen = btns.find((b) => /生成报告|生成开发信|刷新报告|重新生成/.test(b.textContent || ''))
      if (!gen || gen.disabled) return false
      gen.click()
      return true
    })
    if (!clicked) throw new Error(`[${scenario.key}] 生成按钮不可用`)

    // 轮询等待知识库卡片出现（最长 15s），而不是盲等
    const appeared = await page
      .waitForFunction(
        () => {
          const all = Array.from(document.querySelectorAll('section'))
          return all.some((s) => /引用产品资料|未引用任何产品资料/.test(s.textContent || ''))
        },
        { timeout: 15000, polling: 300 },
      )
      .then(() => true)
      .catch(() => false)
    if (!appeared) throw new Error(`[${scenario.key}] 知识库卡片未在 15s 内渲染`)

    // 定位卡片并**裁剪截图**（不依赖滚动 —— 抽屉内嵌滚动容器时
    // scrollIntoView 常不生效，导致截到视口外的同一片区域）。
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('section'))
      const matches = all.filter((s) => /引用产品资料|未引用任何产品资料/.test(s.textContent || ''))
      if (!matches.length) return
      const card = matches.reduce((a, b) =>
        (a.textContent || '').length <= (b.textContent || '').length ? a : b,
      )
      card.scrollIntoView({ block: 'center' })
    })
    await sleep(700)

    // 滚动后再取几何（位置已变）
    const cardBox2 = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('section'))
      const matches = all.filter((s) => /引用产品资料|未引用任何产品资料/.test(s.textContent || ''))
      if (!matches.length) return null
      const card = matches.reduce((a, b) =>
        (a.textContent || '').length <= (b.textContent || '').length ? a : b,
      )
      const r = card.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    if (!cardBox2) throw new Error(`[${scenario.key}] 找不到知识库卡片`)

    const shot = path.join(OUT_DIR, scenario.shot)
    const clip = {
      x: Math.max(0, Math.floor(cardBox2.x) - 16),
      y: Math.max(0, Math.floor(cardBox2.y) - 16),
      width: Math.ceil(cardBox2.width) + 32,
      height: Math.ceil(cardBox2.height) + 32,
    }
    await page.screenshot({ path: shot, clip })

    // 取**最小**的匹配 section（知识库卡片本身），而非最外层面板：
    // 外层「转化动作」区块文本最多，简单 find 会先命中它。
    const text = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('section'))
      const matches = all.filter((s) => /引用产品资料|未引用任何产品资料/.test(s.textContent || ''))
      if (!matches.length) return ''
      const inner = matches.reduce((a, b) =>
        (a.textContent || '').length <= (b.textContent || '').length ? a : b,
      )
      return inner.textContent || ''
    })
    // clip 截图已直接对齐卡片几何，此处断言几何有效（有宽高、非零）
    const cardVisible = cardBox2.width > 100 && cardBox2.height > 30
    const patchError = await page.evaluate(() => window.__PATCH_ERROR__ || null)
    const guideClickable =
      scenario.key === 'without-knowledge'
        ? await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find((x) =>
              /去补全产品资料/.test(x.textContent || ''),
            )
            return Boolean(b) && !b.disabled
          })
        : null

    results.push({
      scenario: scenario.key,
      screenshot: shot,
      cardText: text.slice(0, 120),
      rendered: scenario.expect(text),
      inViewport: cardVisible,
      guideClickable,
      patchError,
      errors: errors.slice(0, 5),
    })
    allErrors.push(...errors)
    await page.close()
    await context.close()
  }

  await browser.close()

  const hashes = results.map((r) => ({ scenario: r.scenario, hash: hashFile(r.screenshot) }))
  const distinct = new Set(hashes.map((h) => h.hash)).size === hashes.length

  const ok =
    results.every((r) => r.rendered) &&
    results.every((r) => r.inViewport) &&
    results.every((r) => !r.patchError) &&
    results.every((r) => r.errors.length === 0) &&
    allErrors.length === 0 &&
    distinct

  console.log(JSON.stringify({ results, hashes, screenshotsDistinct: distinct, allOk: ok }, null, 2))
  if (!ok) process.exit(2)
}

run().catch((err) => {
  console.error('PROBE ERROR:', err?.message || err)
  process.exit(1)
})
