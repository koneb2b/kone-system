const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const puppeteer = require('puppeteer-core')

const rootDir = path.resolve(__dirname, '..')
const unpackedRoot = path.join(rootDir, 'release', 'win-unpacked')
const executablePath = path.join(unpackedRoot, 'KoneAI.exe')
const reportPath = path.join(rootDir, '.sisyphus', 'evidence', 'trial-click-probe.json')
const debugPort = '9333'
const registryPath = 'HKCU\\Software\\KoneAI\\LicenseAnchor'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function connect() {
  const started = Date.now()
  while (Date.now() - started < 30000) {
    try {
      return await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, protocolTimeout: 120000 })
    } catch {
      await wait(500)
    }
  }
  throw new Error('Unable to connect to packaged app')
}

async function main() {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Missing executable: ${executablePath}`)
  }

  if (process.platform === 'win32') {
    try {
      require('child_process').execSync(`reg delete "${registryPath}" /f`, { stdio: 'ignore', timeout: 5000 })
    } catch {
      // ignore missing registry key
    }
  }

  const userDataDir = path.join(os.tmpdir(), `kone-trial-probe-${Date.now()}`)
  const downloadsDir = path.join(os.tmpdir(), `kone-trial-probe-downloads-${Date.now()}`)
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.mkdirSync(downloadsDir, { recursive: true })

  const proc = spawn(executablePath, [], {
    cwd: unpackedRoot,
    env: {
      ...process.env,
      CI: '1',
      KONE_REGRESSION_TEST: '1',
      KONE_REMOTE_DEBUGGING_PORT: debugPort,
      KONE_TEST_USER_DATA_DIR: userDataDir,
      KONE_TEST_DOWNLOADS_DIR: downloadsDir,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

  let browser
  try {
    await wait(4000)
    browser = await connect()
    const pages = await browser.pages()
    const page = pages.find((p) => !p.url().startsWith('devtools://'))
    if (!page) throw new Error('No app page found')

    page.setDefaultTimeout(15000)
    await page.bringToFront()
    await page.waitForSelector('[data-stage]')

    const before = await page.evaluate(() => ({
      stage: document.querySelector('[data-stage]')?.getAttribute('data-stage') || '',
      text: document.body?.innerText || '',
    }))

    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const target = buttons.find((btn) => /开启 7 天.*试用/.test(btn.textContent || ''))
      if (!target) return false
      target.click()
      return true
    })

    await wait(5000)

    const after = await page.evaluate(() => ({
      stage: document.querySelector('[data-stage]')?.getAttribute('data-stage') || '',
      text: document.body?.innerText || '',
      buttons: Array.from(document.querySelectorAll('button')).map((btn) => ({ text: btn.textContent || '', disabled: btn.hasAttribute('disabled') })),
    }))

    fs.writeFileSync(reportPath, JSON.stringify({ clicked, before, after, stdout, stderr }, null, 2), 'utf8')
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    proc.kill()
  }
}

main().catch((error) => {
  fs.writeFileSync(reportPath, JSON.stringify({ error: String(error?.message || error) }, null, 2), 'utf8')
  console.error(error)
  process.exitCode = 1
})
