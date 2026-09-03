/* global document, window */
const puppeteer = require('puppeteer')
const path = require('path')

const targetUrl = 'http://localhost:5173'
const screenshotPath = path.join(__dirname, 'smoke-test.png')
const reportPath = path.join(__dirname, 'smoke-test-report.json')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function clickTestButton(page, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, a, div, span'))
      const target = candidates.find((el) => {
        const text = (el.textContent || '').trim()
        return (text.includes('LLM') && text.includes('测试')) || text === '测试连接'
      })
      if (target) {
        target.click()
        return true
      }
      return false
    })
    if (clicked) return true
    await wait(400)
  }
  throw new Error('LLM test button not found')
}

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })

  const report = {
    electronAPI: false,
    llmSuccess: false,
    notificationToggled: false,
    notificationPersisted: false,
  }

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 20000 })

    report.electronAPI = await page.evaluate(() => typeof window.electronAPI !== 'undefined')
    console.log(`[check] window.electronAPI: ${report.electronAPI ? 'defined' : 'undefined'}`)

    await page.evaluate(() => {
      const nav = document.querySelector('[data-nav-id="settings"]')
      if (nav) nav.click()
    })
    await wait(1200)

    await clickTestButton(page, 15000)
    await wait(2000)

    report.llmSuccess = await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('[role="status"], [data-sonner-toast], [data-testid="connection-success"]'),
      )
      return nodes.some(
        (el) => (el.textContent || '').includes('Connection Success') || (el.textContent || '').includes('连接成功'),
      )
    })
    console.log(`[check] LLM test success: ${report.llmSuccess ? 'yes' : 'no'}`)

    const toggled = await page.evaluate(() => {
      const switchEl = document.querySelector('[data-slot="switch"]')
      if (!switchEl) return false
      switchEl.click()
      return true
    })
    report.notificationToggled = toggled
    await wait(600)

    await page.reload({ waitUntil: 'networkidle2' })
    await page.evaluate(() => {
      const nav = document.querySelector('[data-nav-id="settings"]')
      if (nav) nav.click()
    })
    await wait(1000)

    report.notificationPersisted = await page.evaluate(() => {
      const switchEl = document.querySelector('[data-slot="switch"]')
      if (!switchEl) return false
      return switchEl.getAttribute('data-state') === 'checked'
    })

    await page.evaluate(() => {
      const nav = document.querySelector('[data-nav-id="leads"]')
      if (nav) nav.click()
    })
    await wait(1000)

    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.log(`[artifact] ${screenshotPath}`)
  } finally {
    await browser.close()
    const fs = require('fs')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(`[artifact] ${reportPath}`)
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
