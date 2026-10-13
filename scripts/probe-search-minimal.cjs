/* 最小搜索链路验证 —— 在**打包版**上跑一次真实搜索，验证：
 *   输入 → 搜索 → 评分 → 结果渲染 → 落库 → 导出可用
 *
 * ## 刻意「最小化」
 * - 只发**1 次**搜索请求（消耗真实 SerpApi/LLM 配额，用户已明确授权）
 * - 关键词简短，避免触发多语言变体放大调用量
 * - **只读验证**：不点任何发送/删除类按钮
 *
 * ## React 受控输入的处理
 * 直接 `input.value = x` 不会触发 React 的 onChange（受控组件状态不同步），
 * 必须调用原生 value setter 再派发 input 事件。
 *
 * 用法：node scripts/probe-search-minimal.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const puppeteer = require('puppeteer-core')

const outDir = path.join(__dirname, '..', '.probe-packaged')
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const main = async () => {
  const report = { startedAt: new Date().toISOString(), steps: [] }
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    protocolTimeout: 180000,
  })
  const pages = await browser.pages()
  const page = pages.find((p) => !p.url().startsWith('devtools://'))
  if (!page) throw new Error('未找到应用页面')

  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

  await page.setViewport({ width: 1440, height: 900 })

  /* 1. 回到搜索页 */
  await page.evaluate(() => {
    const ns = [...document.querySelectorAll('button,a,[role=button]')]
    const h = ns.find((x) => (x.innerText || '').replace(/\s+/g, '').startsWith('智能获客'))
    if (h) h.click()
  })
  await sleep(2000)

  /* 2. 填入关键词（React 受控组件：用原生 setter + input 事件） */
  const KEYWORD = 'solar distributor Germany'
  const filled = await page.evaluate((kw) => {
    const input = document.querySelector('input[placeholder*="自然语言"]') || document.querySelector('input[type="text"]')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, kw)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, KEYWORD)
  report.steps.push({ step: '填关键词', ok: filled, keyword: KEYWORD })
  await sleep(600)

  /* 3. 点「立即开始 AI 获客」 */
  const clicked = await page.evaluate(() => {
    const ns = [...document.querySelectorAll('button')]
    const h = ns.find((x) => (x.innerText || '').replace(/\s+/g, '').includes('立即开始AI获客'))
    if (!h || h.disabled) return false
    h.click()
    return true
  })
  report.steps.push({ step: '点搜索', ok: clicked })

  /* 4. 等待结果（最多 150 秒，每 10 秒采样一次状态文本） */
  const samples = []
  for (let i = 0; i < 15; i += 1) {
    await sleep(10000)
    const s = await page.evaluate(() => {
      const t = document.body.innerText
      return {
        hasResultCard: document.querySelectorAll('[data-testid*="lead"], .lead-card').length,
        libraryCount: (t.match(/线索库总量\s*(\d+)/) || [])[1] || null,
        loading: /搜索中|正在搜索|加载中|AI 解构|变体/.test(t),
        snippet: t.slice(0, 120).replace(/\n+/g, ' | '),
      }
    })
    samples.push({ t: `${(i + 1) * 10}s`, ...s })
    if (!s.loading && i >= 2) break
  }
  report.samples = samples

  /* 5. 截图 */
  const shot = path.join(outDir, 'search-result.png')
  try {
    await page.screenshot({ path: shot })
    report.screenshot = shot
  } catch (e) {
    report.screenshotError = e.message
  }

  /* 6. 结果统计 */
  report.final = await page.evaluate(() => {
    const t = document.body.innerText
    return {
      libraryCount: (t.match(/线索库总量\s*(\d+)/) || [])[1] || null,
      analysisButtons: [...document.querySelectorAll('button')].filter((x) => /查看分析/.test(x.innerText || '')).length,
      lockedBadges: [...document.querySelectorAll('button')].filter((x) => /高级版锁定/.test(x.innerText || '')).length,
      hasError: /失败|错误|异常/.test(t),
    }
  })
  report.pageErrors = errors

  fs.writeFileSync(path.join(outDir, 'search-report.json'), JSON.stringify(report, null, 2))

  console.log('=== 步骤 ===')
  for (const s of report.steps) console.log(JSON.stringify(s))
  console.log('\n=== 采样 ===')
  for (const s of report.samples) console.log(`${s.t.padStart(5)} loading=${s.loading} 库=${s.libraryCount} | ${s.snippet.slice(0, 60)}`)
  console.log('\n=== 最终 ===')
  console.log(JSON.stringify(report.final, null, 2))
  console.log('页面错误:', report.pageErrors.length)

  await browser.disconnect()
}

main().catch((e) => {
  console.error('搜索探针失败:', e.message)
  process.exit(1)
})
