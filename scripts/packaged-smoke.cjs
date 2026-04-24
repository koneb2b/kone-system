const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const puppeteer = require('puppeteer-core')

const rootDir = path.resolve(__dirname, '..')
const unpackedRoot = path.join(rootDir, 'release', 'win-unpacked')
const executablePath = path.join(unpackedRoot, 'KoneAI.exe')
const screenshotPath = path.join(rootDir, 'tests', 'packaged-smoke.png')
const reportPath = path.join(rootDir, 'tests', 'packaged-smoke-report.json')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run() {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Unpacked executable not found: ${executablePath}`)
  }

  const electronProc = spawn(executablePath, [], {
    cwd: unpackedRoot,
    env: {
      ...process.env,
      CI: '1',
      KONE_SMOKE_TEST: '1',
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  electronProc.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  electronProc.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const report = {
    booted: false,
    activationScreenVisible: false,
    preloadBridgeVisible: false,
    dashboardNavVisible: false,
    screenshotPath,
    executablePath,
    stdout: '',
    stderr: '',
  }

  let browser
  try {
    await wait(4000)
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', protocolTimeout: 60000 })

    let targetPage = null
    const started = Date.now()
    while (!targetPage && Date.now() - started < 15000) {
      const pages = await browser.pages()
      targetPage = pages.find((page) => !page.url().startsWith('devtools://')) || null
      if (!targetPage) await wait(500)
    }

    if (!targetPage) {
      throw new Error('No Electron app page detected')
    }

    targetPage.setDefaultTimeout(15000)
    targetPage.setDefaultNavigationTimeout(20000)
    await targetPage.bringToFront()
    await targetPage.setViewport({ width: 1440, height: 900 })
    await wait(2000)
    await targetPage.waitForSelector('[data-stage]', { timeout: 15000 })

    const snapshot = await targetPage.evaluate(() => ({
      bodyText: document.body?.innerText || '',
      hasBridge: typeof window.electronAPI !== 'undefined',
      hasNavSettings: Boolean(document.querySelector('[data-nav-id="settings"]')),
      hasNavSearch: Boolean(document.querySelector('[data-nav-id="search"]')),
      hasActivation: /软件授权验证|立即验证授权|Kone AI/i.test(document.body?.innerText || ''),
    }))

    report.booted = snapshot.bodyText.length > 0
    report.activationScreenVisible = snapshot.hasActivation
    report.preloadBridgeVisible = snapshot.hasBridge
    report.dashboardNavVisible = snapshot.hasNavSettings || snapshot.hasNavSearch

    try {
      await targetPage.screenshot({ path: screenshotPath })
    } catch (error) {
      await wait(2000)
      try {
        await targetPage.screenshot({ path: screenshotPath })
      } catch (retryError) {
        throw new Error(`Screenshot failed after retry: ${retryError.message || retryError}`)
      }
    }
  } finally {
    report.stdout = stdout
    report.stderr = stderr
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    electronProc.kill()
  }

  if (!report.booted || !report.preloadBridgeVisible || (!report.activationScreenVisible && !report.dashboardNavVisible)) {
    throw new Error('Packaged smoke validation failed')
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
