/**
 * 设计 token 生效性验证 —— 确认 `bg-primary` / `text-primary` 等语义类
 * 是否真的映射到 src/index.css 定义的品牌绿。
 *
 * 背景：root 定义了 `--primary: 92 65% 44%`（品牌绿），但未找到 `@theme` 块
 * 或 tailwind.config.js。若语义类未生效，`bg-primary` 会回落到 Tailwind 默认蓝
 * —— 这正是「设计 token 是绿、UI 到处是蓝」的疑似根因。
 */
const puppeteer = require('puppeteer')

const BASE_URL = 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const run = async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await sleep(2000)

  const result = await page.evaluate(() => {
    const probe = document.createElement('div')
    document.body.appendChild(probe)

    const read = (cls) => {
      probe.className = cls
      return getComputedStyle(probe).backgroundColor
    }
    const readColor = (cls) => {
      probe.className = cls
      return getComputedStyle(probe).color
    }

    const rootVar = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()

    const out = {
      cssVarPrimary: rootVar,
      bgPrimary: read('bg-primary'),
      bgBlue600: read('bg-blue-600'),
      textPrimary: readColor('text-primary'),
      borderBorder: getComputedStyle((() => {
        probe.className = 'border border-border'
        return probe
      })()).borderColor,
      bgMuted: read('bg-muted'),
      bgBackground: read('bg-background'),
    }
    probe.remove()
    return out
  })

  await browser.close()
  console.log(JSON.stringify(result, null, 2))
}

run().catch((e) => {
  console.error('ERROR', e?.message || e)
  process.exit(1)
})
