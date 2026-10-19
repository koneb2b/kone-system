const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const puppeteer = require('puppeteer-core')

const rootDir = path.resolve(__dirname, '..')
const unpackedRoot = path.join(rootDir, 'release', 'win-unpacked')
const executablePath = path.join(unpackedRoot, 'KoneAI.exe')
const reportPath = path.join(rootDir, 'tests', 'security-audit-report.json')
const debugPort = '9224'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function ensureExecutable() {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Unpacked executable not found: ${executablePath}`)
  }
}

async function connectToElectron() {
  const started = Date.now()
  while (Date.now() - started < 30000) {
    try {
      return await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, protocolTimeout: 60000 })
    } catch {
      await wait(500)
    }
  }
  throw new Error('Unable to connect to security audit target')
}

async function getActivePage(browser) {
  const started = Date.now()
  while (Date.now() - started < 20000) {
    const pages = await browser.pages()
    const page = pages.filter((p) => !p.url().startsWith('devtools://')).at(-1)
    if (page) {
      page.setDefaultTimeout(20000)
      page.setDefaultNavigationTimeout(20000)
      return page
    }
    await wait(250)
  }
  throw new Error('No active Electron page found')
}

function createSessionDirs(tag) {
  const runId = `${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const userDataDir = path.join(os.tmpdir(), `kone-security-userdata-${runId}`)
  const downloadsDir = path.join(os.tmpdir(), `kone-security-downloads-${runId}`)
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.mkdirSync(downloadsDir, { recursive: true })
  return { userDataDir, downloadsDir }
}

async function launchApp(tag, env = {}, existingDirs = null) {
  const dirs = existingDirs || createSessionDirs(tag)
  const proc = spawn(executablePath, [], {
    cwd: unpackedRoot,
    env: {
      ...process.env,
      CI: '1',
      KONE_REGRESSION_TEST: '1',
      KONE_REMOTE_DEBUGGING_PORT: debugPort,
      KONE_TEST_USER_DATA_DIR: dirs.userDataDir,
      KONE_TEST_DOWNLOADS_DIR: dirs.downloadsDir,
      ELECTRON_ENABLE_LOGGING: '1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

  await wait(4000)
  const browser = await connectToElectron()
  const page = await getActivePage(browser)
  await page.bringToFront()
  await page.setViewport({ width: 1440, height: 960 })
  await wait(1500)

  return { proc, browser, page, dirs, stdoutRef: () => stdout, stderrRef: () => stderr }
}

async function stopApp(session) {
  try { await session.browser.close() } catch {}
  try { session.proc.kill() } catch {}
  await wait(1200)
}

async function clickButtonByText(page, text) {
  const clicked = await page.evaluate((targetText) => {
    const buttons = Array.from(document.querySelectorAll('button'))
    const target = buttons.find((btn) => (btn.textContent || '').includes(targetText))
    if (!target) return false
    target.click()
    return true
  }, text)
  if (!clicked) throw new Error(`Button not found: ${text}`)
}

async function clickAnyButtonByTexts(page, texts) {
  const clicked = await page.evaluate((targetTexts) => {
    const candidates = Array.from(document.querySelectorAll('button, a, div, span'))
    const target = candidates.find((el) => targetTexts.some((text) => (el.textContent || '').includes(text)))
    if (!target) return false
    target.click()
    return true
  }, texts)
  if (!clicked) throw new Error(`Buttons not found: ${texts.join(', ')}`)
}

async function typeIntoTextarea(page, text) {
  await page.waitForSelector('textarea', { timeout: 10000 })
  await page.evaluate(() => {
    const el = document.querySelector('textarea')
    if (el) el.value = ''
  })
  await page.type('textarea', text)
}

async function waitForStage(page, stage) {
  await page.waitForSelector(`[data-stage="${stage}"]`, { timeout: 20000 })
}

function locateConfigFile(userDataDir) {
  return path.join(userDataDir, 'kone-config.json')
}

async function scenarioFirstTrial() {
  const session = await launchApp('first-trial')
  try {
    const page = session.page
    await page.waitForSelector('[data-stage="activation-screen"], [data-stage="dashboard"], [data-stage="locked"]', { timeout: 20000 })
    const stage = await page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || '')
    if (stage === 'locked') {
      throw new Error(`首次试用场景异常进入 locked: ${await page.evaluate(() => document.body.innerText || '')}`)
    }
    if (stage === 'activation-screen') {
      await clickButtonByText(page, '开启 7 天全功能免费试用')
      await waitForStage(page, 'dashboard')
    }
    const result = await page.evaluate(() => {
      const text = document.body.innerText || ''
      const hasCountdown = text.includes('试用剩余') || text.includes('试用版: 剩余') || text.includes('试用版 · 剩余')
      const hasSettingsNav = Boolean(document.querySelector('[data-nav-id="settings"]'))
      return { hasCountdown, hasSettingsNav, text }
    })
    if (!result.hasCountdown || !result.hasSettingsNav) {
      throw new Error(`首次试用后未正确进入主界面或倒计时未显示: ${result.text}`)
    }
    return { ok: true, dirs: session.dirs }
  } finally {
    await stopApp(session)
  }
}

async function scenarioDeleteConfig(dirs) {
  const configPath = locateConfigFile(dirs.userDataDir)
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
  const session = await launchApp('delete-config', {}, dirs)
  try {
    const page = session.page
    await waitForStage(page, 'dashboard')
    const ok = await page.evaluate(() => {
      const text = document.body.innerText || ''
      return text.includes('试用剩余')
    })
    if (!ok) throw new Error('删除 config 后未能从双锚点恢复试用态')
    return { ok: true }
  } finally {
    await stopApp(session)
  }
}

async function scenarioOfflineFallback(dirs) {
  const session = await launchApp('offline-fallback', { KONE_WORLD_TIME_API_URL: 'http://127.0.0.1:9/offline' }, dirs)
  try {
    const page = session.page
    await page.waitForSelector('[data-stage="dashboard"], [data-stage="activation-screen"], [data-stage="locked"]', { timeout: 20000 })
    const text = await page.evaluate(() => document.body.innerText || '')
    if (!text.trim()) throw new Error('断网启动页面空白')
    return { ok: true }
  } finally {
    await stopApp(session)
  }
}

async function scenarioTrialToPremium(dirs) {
  const session = await launchApp('trial-to-premium', {}, dirs)
  try {
    const page = session.page
    await waitForStage(page, 'dashboard')
    const countdownBtn = await page.$('[data-testid="btn-trial-countdown-upgrade"]')
    if (countdownBtn) {
      await countdownBtn.click()
    } else {
      await clickAnyButtonByTexts(page, ['升级正式版', '试用剩余'])
    }
    await page.waitForSelector('[data-testid="upgrade-modal"]', { timeout: 15000 })
    await page.waitForSelector('[data-testid="upgrade-license-textarea"]', { timeout: 15000 })
    await page.type('[data-testid="upgrade-license-textarea"]', 'KONE-DEV-8888')
    await page.click('[data-testid="btn-upgrade-unlock"]')
    await wait(3000)
    const result = await page.evaluate(() => {
      const text = document.body.innerText || ''
      return {
        ok: text.includes('企业版 (已激活)') || text.includes('正式版授权'),
        text,
      }
    })
    if (!result.ok) throw new Error(`试用转 Premium 后界面未即时刷新: ${result.text}`)
    return { ok: true }
  } finally {
    await stopApp(session)
  }
}

async function scenarioLockedScreen() {
  const session = await launchApp('locked-screen', { KONE_FORCE_LOCKED: '1' })
  try {
    const page = session.page
    await waitForStage(page, 'locked')
    const text = await page.evaluate(() => document.body.innerText || '')
    if (!text.includes('检测到系统时间异常被篡改') || !text.includes('软件已锁定')) {
      throw new Error(`locked-screen 文案断言失败: ${text}`)
    }
    return { ok: true }
  } finally {
    await stopApp(session)
  }
}

async function main() {
  ensureExecutable()
  const report = {
    firstTrial: { ok: false },
    deleteConfig: { ok: false },
    offlineFallback: { ok: false },
    trialToPremium: { ok: false },
    lockedScreen: { ok: false },
    failedStep: null,
    failureReason: null,
  }

  let dirs = null
  try {
    const first = await scenarioFirstTrial()
    report.firstTrial = { ok: true }
    dirs = first.dirs

    await scenarioDeleteConfig(dirs)
    report.deleteConfig = { ok: true }

    await scenarioOfflineFallback(dirs)
    report.offlineFallback = { ok: true }

    await scenarioTrialToPremium(dirs)
    report.trialToPremium = { ok: true }

    await scenarioLockedScreen()
    report.lockedScreen = { ok: true }
  } catch (error) {
    report.failedStep = Object.entries(report).find(([k, v]) => k !== 'failedStep' && k !== 'failureReason' && !v.ok)?.[0] || 'unknown'
    report.failureReason = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
