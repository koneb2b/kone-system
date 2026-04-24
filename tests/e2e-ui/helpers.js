const puppeteer = require('puppeteer')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const BASE_URL = 'http://127.0.0.1:5173'
const DEBUG_PORT = 9222
const DEFAULT_TIMEOUT_MS = 30000
const STABILITY_DELAY_MS = 800
const ARTIFACT_DIR = path.join(process.cwd(), '.sisyphus', 'evidence', 'ui-spider')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ensureArtifactDir = () => {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
}

const sanitizeName = (value) => String(value || '').replace(/[^a-z0-9-_]/gi, '-').toLowerCase()

const startElectronDevStack = () => {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run dev']
    : ['run', 'dev']
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KONE_SMOKE_TEST: '1',
      KONE_REMOTE_DEBUGGING_PORT: String(DEBUG_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const logs = []
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))

  return { child, logs }
}

const stopElectronDevStack = async (child) => {
  if (!child || child.killed) return
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
    })
    return
  }
  child.kill('SIGTERM')
}

const waitForDebugEndpoint = async (logs) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (response.ok) return true
    } catch {}
    await sleep(1000)
  }
  ensureArtifactDir()
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'electron-launch-timeout.log'), (logs || []).join(''), 'utf8')
  return false
}

const connectElectronBrowser = async () => puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })

const getElectronPage = async (browser) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pages = await browser.pages()
    const targetPage = pages.find((page) => {
      const url = page.url()
      return url.includes(BASE_URL) || url === 'about:blank'
    })
    if (targetPage) {
      await targetPage.setViewport({ width: 1440, height: 900 }).catch(() => undefined)
      if (targetPage.url() === 'about:blank') {
        try {
          await targetPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 })
        } catch {}
      }
      return targetPage
    }
    await sleep(500)
  }
  throw new Error('Electron page not found')
}

const waitForAppReady = async (page) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await page.waitForSelector('[data-stage="dashboard"], [data-stage="activation-screen"], [data-stage="locked"]', { timeout: 2000 })
      return true
    } catch {}
    await sleep(500)
  }
  return false
}

const assertNoCrashUi = async (page) => {
  const crashTexts = ['Something went wrong', 'Reload App', 'Kone Enterprise Recovery']
  const bodyText = await page.evaluate(() => document.body.innerText || '')
  for (const text of crashTexts) {
    if (bodyText.includes(text)) {
      throw new Error(`ErrorBoundary UI detected: ${text}`)
    }
  }
}

const waitForAnyAnchor = async (page, anchors, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    for (const anchor of anchors) {
      if (anchor.type === 'selector') {
        const found = await page.$(anchor.value)
        if (found) return { matched: anchor }
      }
      if (anchor.type === 'text') {
        const bodyText = await page.evaluate(() => document.body.innerText || '')
        if (bodyText.includes(anchor.value)) return { matched: anchor }
      }
    }
    await sleep(250)
  }
  throw new Error(`No module anchor matched within timeout. anchors=${anchors.map((item) => `${item.type}:${item.value}`).join(', ')}`)
}

const navigateViaSidebar = async (page, navId) => {
  await page.waitForSelector(`button[data-nav-id="${navId}"]`, { timeout: DEFAULT_TIMEOUT_MS })
  await page.click(`button[data-nav-id="${navId}"]`)
}

const waitForStableModule = async (page, anchors) => {
  await page.waitForSelector('[data-stage="dashboard"]', { timeout: DEFAULT_TIMEOUT_MS })
  const match = await waitForAnyAnchor(page, anchors, DEFAULT_TIMEOUT_MS)
  await sleep(STABILITY_DELAY_MS)
  return match
}

const collectFailureArtifacts = async (page, moduleName, phase, error, consoleMessages, processLogs) => {
  ensureArtifactDir()
  const stem = `${sanitizeName(moduleName)}-${sanitizeName(phase)}`
  const screenshotPath = path.join(ARTIFACT_DIR, `${stem}.png`)
  const domPath = path.join(ARTIFACT_DIR, `${stem}-dom.txt`)
  const consolePath = path.join(ARTIFACT_DIR, `${stem}-console.txt`)
  const processPath = path.join(ARTIFACT_DIR, `${stem}-process.txt`)

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '')
  fs.writeFileSync(domPath, bodyText, 'utf8')
  fs.writeFileSync(consolePath, `${String(error?.stack || error)}\n\n[console]\n${consoleMessages.join('\n')}`, 'utf8')
  fs.writeFileSync(processPath, processLogs.join(''), 'utf8')

  return { screenshotPath, domPath, consolePath, processPath }
}

module.exports = {
  ARTIFACT_DIR,
  BASE_URL,
  startElectronDevStack,
  stopElectronDevStack,
  waitForDebugEndpoint,
  connectElectronBrowser,
  getElectronPage,
  waitForAppReady,
  assertNoCrashUi,
  navigateViaSidebar,
  waitForStableModule,
  collectFailureArtifacts,
}
