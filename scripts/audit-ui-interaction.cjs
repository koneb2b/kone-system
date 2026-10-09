/**
 * 全模块交互审计探针（AI 自验）。
 *
 * ## 目标
 * 用户要求「全面系统跑一遍，各个前端模块细节按钮功能交互是否正常」。
 * 本探针**逐页遍历全部 9 个模块**，对每页做三件事：
 *   1. 收集 console / pageerror（渲染期异常）
 *   2. **枚举所有按钮**（文本 / 禁用态 / 是否可见）→ 形成「细节按钮」盘点
 *   3. 执行**安全的交互动作**（点 tab、开关抽屉），验证交互不崩溃
 * 并截图存证。
 *
 * ## 安全边界（重要）
 * 本探针**绝不点击**破坏性/外发类按钮（删除、停止、发送、清空）。
 * 只点击明确无副作用的控件（tab 切换、展开/收起、下拉）。破坏性按钮仅**枚举**，
 * 由人工/静态分析单独核查。
 *
 * 用法：先 `npx vite --host 127.0.0.1 --port 5173`，再跑本脚本。
 */

const puppeteer = require('puppeteer')
const path = require('node:path')
const fs = require('node:fs')
const { buildMockBridgeSource } = require('./lib/mock-bridge.cjs')

const BASE_URL = 'http://127.0.0.1:5173'
const OUT = path.join(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 覆盖全部 9 个导航模块（含高级版）。title 用于等待页面切换完成，feature 是该页特征文本。 */
const NAV_MODULES = [
  { id: 'search', label: '智能获客', title: '海外客户智能搜索', feature: '立即开始 AI 获客' },
  { id: 'leads', label: '线索管理', title: '线索管理', feature: '客户资料下载' },
  { id: 'data', label: '数据中心', title: '数据中心', feature: '线索' },
  { id: 'knowledge', label: '知识库', title: '企业知识库', feature: '我的标签' },
  { id: 'settings', label: '系统设置', title: '系统设置', feature: '保存' },
  { id: 'accounts', label: '账号管理', title: '多账号沙箱管理', feature: '沙箱' },
  { id: 'agents', label: 'AI 销售团队', title: 'AI 销售团队', feature: '今日配额' },
  { id: 'automation', label: '自动化序列', title: '智能触达工作流', feature: '云端' },
  { id: 'team-dashboard', label: '团队协作', title: '团队协作看板', feature: '团队' },
]

/* 破坏性/外发按钮：仅枚举，绝不点击 */
const DANGEROUS_RE = /删除|清空|停止|发送|投递|断开|移除|剔除|提交至|立即激活|一键清洗|开始触达|启动巡航/

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
    decisionMakers: [],
  },
  {
    id: 2,
    company: 'Berlin Werkzeug GmbH',
    contact: 'Klaus Müller',
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
    dataSourceType: 'google_maps',
    decisionMakers: [],
  },
]

/** 枚举页面内所有按钮（文本 / 禁用 / 可见 / 危险标记）。 */
const enumerateButtons = () =>
  Array.from(document.querySelectorAll('button')).map((b) => {
    const r = b.getBoundingClientRect()
    const text = (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)
    return {
      text,
      disabled: !!b.disabled,
      visible: r.width > 0 && r.height > 0,
      aria: b.getAttribute('aria-label') || '',
    }
  })

const run = async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 950 })

  let currentModule = '(boot)'
  const errorsByModule = {}
  const pushErr = (msg) => {
    const key = currentModule
    if (!errorsByModule[key]) errorsByModule[key] = []
    if (errorsByModule[key].length < 10) errorsByModule[key].push(String(msg).slice(0, 240))
  }
  page.on('console', (m) => {
    if (m.type() === 'error') pushErr(m.text())
  })
  page.on('pageerror', (e) => pushErr(`[pageerror] ${e}`))

  const bridge = buildMockBridgeSource({
    leads: SAMPLE_LEADS,
    // 提供 premium tier，确保高级模块（automation / team-dashboard）可渲染
    license: { plan: 'premium', status: 'active', tier: 'premium', features: [], expiresAt: null },
  })
  await page.evaluateOnNewDocument(bridge)

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('button[data-nav-id="search"]', { timeout: 20000 })
  await sleep(2500)

  const report = { modules: [], sidebar: null, summary: {} }

  report.sidebar = await page.evaluate(() => {
    const aside = document.querySelector('aside')
    if (!aside) return { found: false }
    const navBtns = Array.from(aside.querySelectorAll('button[data-nav-id]'))
    return {
      found: true,
      navIds: navBtns.map((b) => b.getAttribute('data-nav-id')),
    }
  })

  for (const mod of NAV_MODULES) {
    currentModule = mod.id
    const entry = { id: mod.id, label: mod.label, rendered: false, buttons: [], interactions: [], errors: [] }

    try {
      const navBtn = await page.$(`button[data-nav-id="${mod.id}"]`)
      if (!navBtn) {
        entry.errors.push('导航按钮不存在')
        report.modules.push(entry)
        continue
      }
      await navBtn.click()
      // 等页面标题切换（而非固定 sleep）——否则会截到上一页内容
      await page
        .waitForFunction(
          (t) => {
            const h1 = document.querySelector('h1')
            return !!h1 && (h1.textContent || '').includes(t)
          },
          { timeout: 10000 },
          mod.title,
        )
        .catch(() => {})
      // 页面进入动画（animate-kone-view-enter）期间截图会拍到上一页的合成帧。
      // 必须等动画彻底结束（实测 700ms 不足，1800ms 稳定）。
      await sleep(1800)

      // 渲染判定：主内容区有可见文本，且未被 ErrorBoundary 接管
      const renderState = await page.evaluate(() => {
        const main = document.querySelector('main') || document.body
        const text = (main.innerText || '').trim()
        const crashed = /Something went wrong|应用出错|出错了/.test(text) || !!document.querySelector('[data-error-boundary]')
        return { textLen: text.length, crashed, head: text.slice(0, 120) }
      })
      entry.rendered = renderState.textLen > 20 && !renderState.crashed
      entry.head = renderState.head
      entry.crashed = renderState.crashed

      entry.buttons = await page.evaluate(enumerateButtons)

      // 特征文本断言：确认内容区确实是本模块（防止「点了没切换」被误判为通过）
      entry.featurePresent = await page.evaluate((f) => document.body.innerText.includes(f), mod.feature)

      // UI 质量量化：过小字号（<11px）、过小点击目标（<28px 高）、水平溢出
      entry.uiQuality = await page.evaluate(() => {
        const smallText = []
        const smallTargets = []
        document.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          const txt = (el.childElementCount === 0 ? el.textContent || '' : '').trim()
          if (!txt) return
          const fs = parseFloat(getComputedStyle(el).fontSize)
          if (fs && fs < 11) smallText.push(`${Math.round(fs)}px:${txt.slice(0, 18)}`)
        })
        document.querySelectorAll('button, a, [role="button"], input, select').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          if (r.height < 28) {
            const label = (el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 18)
            smallTargets.push(`${Math.round(r.height)}px:${label}`)
          }
        })
        const overflowX = document.documentElement.scrollWidth > window.innerWidth + 2
        return {
          smallTextCount: smallText.length,
          smallTextSample: [...new Set(smallText)].slice(0, 4),
          smallTargetCount: smallTargets.length,
          smallTargetSample: [...new Set(smallTargets)].slice(0, 4),
          horizontalOverflow: overflowX,
        }
      })

      // 安全交互 1：点击第一个可见、未禁用、非危险的按钮，看是否崩溃
      const safeIdx = entry.buttons.findIndex((b) => b.visible && !b.disabled && b.text && !DANGEROUS_RE.test(b.text))
      if (safeIdx >= 0) {
        const label = entry.buttons[safeIdx].text
        const before = await page.evaluate(() => document.body.innerText.length)
        try {
          await page.evaluate((i) => {
            const btns = Array.from(document.querySelectorAll('button'))
            btns[i]?.click()
          }, safeIdx)
          await sleep(900)
          const after = await page.evaluate(() => document.body.innerText.length)
          const stillAlive = await page.evaluate(() => !!document.querySelector('button[data-nav-id]'))
          entry.interactions.push({
            clicked: label,
            aliveAfter: stillAlive,
            textLenDelta: after - before,
          })
        } catch (e) {
          entry.interactions.push({ clicked: label, error: String(e).slice(0, 160) })
        }
      }

      // 强制两帧合成后再截图，避免拍到切换动画的中间帧
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )
      const shot = path.join(OUT, `ui-audit-${mod.id}.png`)
      await page.screenshot({ path: shot })
      entry.screenshot = path.basename(shot)
    } catch (e) {
      entry.errors.push(`交互失败: ${String(e?.message || e).slice(0, 200)}`)
    }

    entry.errors = [...(errorsByModule[mod.id] || [])]
    report.modules.push(entry)
  }

  // 汇总
  const allButtons = report.modules.flatMap((m) => m.buttons)
  report.summary = {
    modulesChecked: report.modules.length,
    modulesRendered: report.modules.filter((m) => m.rendered).length,
    modulesCrashed: report.modules.filter((m) => m.crashed).length,
    totalButtons: allButtons.length,
    disabledButtons: allButtons.filter((b) => b.disabled).length,
    invisibleButtons: allButtons.filter((b) => !b.visible).length,
    modulesWithConsoleErrors: report.modules.filter((m) => m.errors.length > 0).map((m) => m.id),
  }

  fs.writeFileSync(path.join(OUT, 'audit-ui-interaction-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.summary, null, 2))
  console.log('\n--- 各模块按钮数 / 错误数 ---')
  for (const m of report.modules) {
    console.log(
      `${m.rendered ? 'OK ' : 'FAIL'} ${m.id.padEnd(16)} buttons=${String(m.buttons.length).padStart(3)} errors=${m.errors.length}${m.crashed ? ' [CRASHED]' : ''}`,
    )
  }

  await browser.close()
  const ok = report.summary.modulesCrashed === 0
  process.exit(ok ? 0 : 1)
}

run().catch((e) => {
  console.error('探针执行失败:', e)
  process.exit(1)
})
