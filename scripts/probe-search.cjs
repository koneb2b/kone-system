const { spawn, execSync } = require('child_process')
const puppeteer = require('puppeteer-core')
const path = require('path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
const exe = path.join(__dirname, '..', 'release', 'win-unpacked', 'KoneAI.exe')
try { execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' }) } catch {}
await wait(800)
const proc = spawn(exe, [], { cwd: path.dirname(exe), env: { ...process.env, KONE_SMOKE_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
let stderr = ''
proc.stderr.on('data', (c) => (stderr += c.toString()))
await wait(4000)
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', protocolTimeout: 60000 })
let page = null
for (let i = 0; i < 30 && !page; i++) {
  const pages = await browser.pages()
  page = pages.find((p) => !p.url().startsWith('devtools://')) || null
  if (!page) await wait(500)
}
await page.bringToFront()
await page.setViewport({ width: 1440, height: 900 })
await wait(2500)

// 填搜索
const filled = await page.evaluate(({ kw, country }) => {
  const setVal = (el, v) => {
    if (!el) return false
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  const k = setVal(document.querySelector('input[placeholder*="自然语言"]'), kw)
  const c = setVal(document.querySelector('input[placeholder*="国家"]'), country)
  return { k, c }
}, { kw: 'golf cart lithium battery distributor', country: 'United States' })
console.log('filled:', JSON.stringify(filled))
await wait(500)
const clicked = await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="btn-search-execute"]')
  if (btn) { btn.click(); return 'testid' }
  return 'none'
})
console.log('clicked:', clicked)

// 逐步 dump：阶段区 + 结果区 + 控制区
for (let i = 0; i < 70; i++) {
  await wait(3000)
  const dump = await page.evaluate(() => {
    const text = document.body.innerText
    // 找关键行
    const lines = text.split('\n').filter((l) => l.trim())
    const key = lines.filter((l) => /搜索|评估|处理|补全|完成|当前展示|数据源|结果|失败|错误|AI|ICP|线索|经销商|battery/i.test(l)).slice(0, 25)
    return { key, hasResultCard: document.querySelectorAll('[class*="card"]').length, bodyLen: text.length }
  })
  console.log(`--- t=${i * 3}s hasCards=${dump.hasResultCard} bodyLen=${dump.bodyLen}`)
  console.log(dump.key.join(' | '))
  if (/当前展示/.test(dump.key.join(' ')) && /完成|失败/.test(dump.key.join(' '))) break
}
try { execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' }) } catch {}
}

main().catch((e) => { console.error(e); process.exit(1) })
