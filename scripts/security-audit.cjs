const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const puppeteer = require('puppeteer-core')

const rootDir = path.resolve(__dirname, '..')
const unpackedRoot = path.join(rootDir, 'release', 'win-unpacked')
const executablePath = path.join(unpackedRoot, 'KoneAI.exe')
const reportPath = path.join(rootDir, 'tests', 'security-audit-report.json')
const debugPort = String(9200 + Math.floor(Math.random() * 600))
const registryPath = 'HKCU\\Software\\KoneAI\\LicenseAnchor'

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
      return await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, protocolTimeout: 120000 })
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

function clearRegistryAnchor() {
  if (process.platform !== 'win32') return
  try {
    require('child_process').execSync(`reg delete "${registryPath}" /f`, { stdio: 'ignore', timeout: 5000 })
  } catch {
    // ignore missing key or local registry access failures in audit cleanup
  }
}

async function scenarioFirstTrial() {
  clearRegistryAnchor()
  const session = await launchApp('first-trial')
  try {
    const page = session.page
    await page.waitForSelector('[data-stage="activation-screen"], [data-stage="dashboard"], [data-stage="locked"]', { timeout: 20000 })
    const stage = await page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || '')
    if (stage === 'locked') {
      throw new Error(`首次试用场景异常进入 locked: ${await page.evaluate(() => document.body.innerText || '')}`)
    }
    if (stage === 'activation-screen') {
      await clickButtonByText(page, '开启 7 天免费试用')
      const started = Date.now()
      let nextStage = stage
      while (Date.now() - started < 30000) {
        await wait(500)
        nextStage = await page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || '')
        if (nextStage === 'dashboard') {
          break
        }
      }
      if (nextStage !== 'dashboard') {
        throw new Error(`首次试用后未切换到 dashboard: ${await page.evaluate(() => document.body.innerText || '')}`)
      }
    }
    const result = await page.evaluate(() => {
      const text = document.body.innerText || ''
      const hasCountdown = text.includes('试用剩余') || text.includes('试用版: 剩余') || text.includes('试用版 · 剩余') || text.includes('正在同步权限...')
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
    const started = Date.now()
    let stage = await page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || '')
    while (Date.now() - started < 30000 && stage !== 'dashboard') {
      await wait(500)
      stage = await page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || '')
    }
    if (stage !== 'dashboard') {
      throw new Error(`删除 config 后未切换到 dashboard: ${await page.evaluate(() => document.body.innerText || '')}`)
    }
    const ok = await page.evaluate(() => {
      const text = document.body.innerText || ''
      return text.includes('试用剩余') || text.includes('正在同步权限...')
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
    const started = Date.now()
    let stage = ''
    while (Date.now() - started < 30000) {
      stage = await page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || '')
      if (stage === 'dashboard' || stage === 'activation-screen' || stage === 'locked') {
        break
      }
      await wait(500)
    }
    if (!stage) {
      throw new Error(`断网启动未进入可识别 stage: ${await page.evaluate(() => document.body.innerText || '')}`)
    }
    const text = await page.evaluate(() => document.body.innerText || '')
    if (!text.trim()) throw new Error('断网启动页面空白')
    return { ok: true, stage }
  } finally {
    await stopApp(session)
  }
}

async function scenarioTrialToPremium(dirs) {
  const session = await launchApp('trial-to-premium', {}, dirs)
  try {
    const page = session.page
    const started = Date.now()
    let stage = ''
    while (Date.now() - started < 30000) {
      stage = await page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || '')
      if (stage === 'dashboard') {
        break
      }
      await wait(500)
    }
    if (stage !== 'dashboard') {
      throw new Error(`试用转 Premium 前未进入 dashboard: ${await page.evaluate(() => document.body.innerText || '')}`)
    }
    const countdownBtn = await page.$('[data-testid="btn-trial-countdown-upgrade"]')
    if (countdownBtn) {
      await countdownBtn.click()
    } else {
      await clickAnyButtonByTexts(page, ['升级正式版', '试用剩余', '正在同步权限...'])
    }
    await page.waitForSelector('[data-testid="upgrade-modal"]', { timeout: 15000 })
    await page.waitForSelector('[data-testid="upgrade-license-textarea"]', { timeout: 15000 })
    await page.type('[data-testid="upgrade-license-textarea"]', 'KONE-DEV-8888')
    await page.click('[data-testid="btn-upgrade-unlock"]')
    await wait(3000)
    const result = await page.evaluate(() => {
      const text = document.body.innerText || ''
      return {
        ok: text.includes('授权文件无效，请联系顾问重新生成') || text.includes('激活失败') || text.includes('激活码无效，请核对后重新输入'),
        text,
      }
    })
    if (!result.ok) throw new Error(`升级弹窗失败闭环未出现预期提示: ${result.text}`)
    return { ok: true, mode: 'packaged-upgrade-dialog-validated' }
  } finally {
    await stopApp(session)
  }
}

async function scenarioLockedScreen() {
  const session = await launchApp('locked-screen', { KONE_FORCE_LOCKED: '1' })
  try {
    const page = session.page
    const started = Date.now()
    let stage = ''
    while (Date.now() - started < 30000) {
      stage = await page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || '')
      if (stage === 'locked') {
        break
      }
      await wait(500)
    }
    if (stage !== 'locked') {
      throw new Error(`locked-screen 未进入 locked stage: ${await page.evaluate(() => document.body.innerText || '')}`)
    }
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
  clearRegistryAnchor()
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
