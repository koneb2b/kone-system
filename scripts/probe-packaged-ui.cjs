/* 打包版功能与视觉验证探针。
 *
 * 前置：`node scripts/dev-launch-packaged.cjs release-v140`（应用须已在跑）
 *
 * 设计原则（来自项目既有教训）：
 * - **断言可达性用几何/文本，不用「元素存在」**（隐藏元素也算存在）
 * - **多场景必须断言截图哈希互不相同**，否则可能拍到同一帧却报通过
 * - **页面切换动画期间截图会拍到旧帧** → 每次导航后等待足够时长
 * - 只做**只读**操作：导航、截图、读取文本；**不点击任何发送/删除类按钮**
 *
 * 用法：node scripts/probe-packaged-ui.cjs [输出目录]
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const puppeteer = require('puppeteer-core')

const rootDir = path.join(__dirname, '..')
const outputDir = (process.argv[2] || 'release-v140').trim()
const outRoot = path.join(rootDir, '.probe-packaged')
fs.mkdirSync(outRoot, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PAGES = [
  { name: '01-搜索获客', nav: '智能获客' },
  { name: '02-线索管理', nav: '线索管理' },
  { name: '03-数据中心', nav: '数据中心' },
  { name: '04-知识库', nav: '知识库' },
  { name: '05-系统设置', nav: '系统设置' },
  { name: '06-账号管理', nav: '账号管理' },
  { name: '07-AI销售团队', nav: 'AI 销售团队' },
  { name: '08-自动化序列', nav: '自动化序列' },
  { name: '09-团队协作', nav: '团队协作' },
  { name: '10-使用指南', nav: '使用指南' },
]

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
]

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

const collectErrors = (page, sink) => {
  page.on('console', (m) => {
    if (m.type() === 'error') sink.push({ kind: 'console.error', text: m.text().slice(0, 300) })
  })
  page.on('pageerror', (e) => sink.push({ kind: 'pageerror', text: String(e).slice(0, 300) }))
}

/* 点击侧边栏导航项（按可见文本匹配），并等待渲染稳定。
   注意：部分导航项文本含换行（如「自动化序列\n高级」），
   故用「去空白后 includes」而非精确相等。 */
const clickNav = async (page, label) => {
  const ok = await page.evaluate((target) => {
    const norm = (s) => (s || '').replace(/\s+/g, '')
    const want = norm(target)
    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"]'))
    const hit = nodes.find((n) => norm(n.innerText).startsWith(want))
    if (hit) {
      hit.click()
      return true
    }
    return false
  }, label)
  // 页面切换动画期间截图会拍到旧帧，实测需 >= 1800ms
  await sleep(1900)
  return ok
}

const main = async () => {
  const report = { startedAt: new Date().toISOString(), boot: null, pages: [], viewports: [], issues: [], hashes: {} }

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    protocolTimeout: 60000,
  })

  let page = null
  const started = Date.now()
  while (!page && Date.now() - started < 15000) {
    const pages = await browser.pages()
    page = pages.find((p) => !p.url().startsWith('devtools://')) || null
    if (!page) await sleep(500)
  }
  if (!page) throw new Error('未找到应用页面')

  collectErrors(page, report.issues)
  await page.setViewport({ width: 1440, height: 900 })

  /* ── 现状快照 ── */
  await sleep(1500)
  report.boot = await page.evaluate(() => ({
    hasActivation: document.body.innerText.includes('激活'),
    hasNav: !!document.querySelector('nav'),
    textPreview: document.body.innerText.slice(0, 200),
  }))
  await page.screenshot({ path: path.join(outRoot, '00-现状.png') })

  /* ── 遍历各页面 ── */
  for (const p of PAGES) {
    const clicked = await clickNav(page, p.nav)
    const info = await page.evaluate(() => ({
      text: document.body.innerText,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      // 横向溢出 = 自适应问题的强信号
      hasHorizontalOverflow: document.body.scrollWidth > window.innerWidth + 2,
      errorBoundary: document.body.innerText.includes('出错了') || document.body.innerText.includes('Error'),
    }))
    const file = path.join(outRoot, `${p.name}.png`)
    await page.screenshot({ path: file })
    report.pages.push({
      name: p.name,
      navClicked: clicked,
      textLength: info.text.length,
      hasHorizontalOverflow: info.hasHorizontalOverflow,
      bodyWidth: info.bodyWidth,
      viewportWidth: info.viewportWidth,
      errorBoundary: info.errorBoundary,
      screenshot: file,
      hash: md5(file),
    })
  }

  /* ── 多分辨率自适应（回到搜索页）── */
  for (const v of VIEWPORTS) {
    await page.setViewport({ width: v.width, height: v.height })
    await sleep(1200)
    const info = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      overflow: document.body.scrollWidth > window.innerWidth + 2,
      // 关键控件是否仍在视口内（几何断言，非存在性断言）
      sidebarVisible: (() => {
        const el = document.querySelector('nav') || document.querySelector('aside')
        if (!el) return false
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.left >= 0
      })(),
    }))
    const file = path.join(outRoot, `viewport-${v.name}.png`)
    await page.screenshot({ path: file })
    report.viewports.push({ ...v, ...info, screenshot: file, hash: md5(file) })
  }

  /* ── 截图 distinct 检查：多场景不得全部同图 ── */
  const pageHashes = report.pages.map((p) => p.hash)
  report.hashes.pagesDistinct = new Set(pageHashes).size
  report.hashes.pagesTotal = pageHashes.length
  report.hashes.allPagesIdentical = new Set(pageHashes).size === 1

  fs.writeFileSync(path.join(outRoot, 'report.json'), JSON.stringify(report, null, 2))

  /* ── 控制台摘要 ── */
  console.log('=== 页面遍历 ===')
  for (const p of report.pages) {
    console.log(
      `${p.name.padEnd(16)} clicked=${p.navClicked} text=${String(p.textLength).padStart(5)} 溢出=${p.hasHorizontalOverflow ? 'YES' : 'no '} 错误边界=${p.errorBoundary ? 'YES' : 'no'}`,
    )
  }
  console.log(`\n截图 distinct: ${report.hashes.pagesDistinct}/${report.hashes.pagesTotal}（全部相同=${report.hashes.allPagesIdentical}）`)
  console.log('\n=== 分辨率自适应 ===')
  for (const v of report.viewports) {
    console.log(`${v.name.padEnd(11)} 溢出=${v.overflow ? 'YES' : 'no '} 侧边栏可见=${v.sidebarVisible} scrollW=${v.scrollWidth} innerW=${v.innerWidth}`)
  }
  console.log(`\n=== 控制台错误（${report.issues.length} 条）===`)
  const seen = new Set()
  for (const i of report.issues) {
    const k = i.text.slice(0, 120)
    if (seen.has(k)) continue
    seen.add(k)
    console.log(`[${i.kind}] ${k}`)
  }

  await browser.disconnect()
}

main().catch((e) => {
  console.error('探针失败:', e.message)
  process.exit(1)
})
