const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('child_process')
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

  /* 清理残留实例：KoneAI.exe 固定绑定 9222 调试端口，若上次冒烟/审计异常退出
     留下旧进程，新实例绑定端口失败，puppeteer.connect 会连到残留旧实例导致
     检测全 false。spawn 前先强制结束本应用所有进程。 */
  try {
    execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' })
  } catch {
    // 无残留进程时 taskkill 报错可忽略
  }
  await wait(800)

  const childEnv = {
    ...process.env,
    CI: '1',
    KONE_SMOKE_TEST: '1',
    ELECTRON_ENABLE_LOGGING: '1',
  }
  delete childEnv.ELECTRON_RUN_AS_NODE

  const electronProc = spawn(executablePath, [], {
    cwd: unpackedRoot,
    env: childEnv,
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
