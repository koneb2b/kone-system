const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const puppeteer = require('puppeteer-core')

const rootDir = path.resolve(__dirname, '..')
const unpackedRoot = path.join(rootDir, 'release', 'win-unpacked')
const executablePath = path.join(unpackedRoot, 'KoneAI.exe')
const evidenceDir = path.join(rootDir, '.sisyphus', 'evidence')
const reportPath = path.join(evidenceDir, 'help-dialog-probe.json')
const screenshotPath = path.join(evidenceDir, 'help-dialog-probe.png')
const debugPort = '9334'
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
  fs.mkdirSync(evidenceDir, { recursive: true })

  if (process.platform === 'win32') {
    try {
      require('child_process').execSync(`reg delete "${registryPath}" /f`, { stdio: 'ignore', timeout: 5000 })
    } catch {
      // ignore missing registry key
    }
  }

  const userDataDir = path.join(os.tmpdir(), `kone-help-probe-${Date.now()}`)
  const downloadsDir = path.join(os.tmpdir(), `kone-help-probe-downloads-${Date.now()}`)
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
  const report = {}
  try {
    await wait(4000)
    browser = await connect()
    const pages = await browser.pages()
    const page = pages.find((p) => !p.url().startsWith('devtools://'))
    if (!page) throw new Error('No app page found')

    page.setDefaultTimeout(15000)
    await page.bringToFront()
    await page.waitForSelector('[data-stage]')

    // 1. 全新环境直接点“使用指南”——该入口位于侧边栏，仅仪表盘阶段可见；
    //    先走试用进入主界面（与 trial-click-probe 相同路径）。
    const trialClicked = await page.evaluate(() => {
      const target = Array.from(document.querySelectorAll('button')).find((btn) => /开启 7 天.*试用/.test(btn.textContent || ''))
      if (!target) return false
      target.click()
      return true
    })
    report.trialClicked = trialClicked
    await wait(5000)

    // 2. 点击侧边栏“使用指南”
    const helpClicked = await page.evaluate(() => {
      const target = document.querySelector('[data-testid="btn-open-help"]')
      if (!target) return false
      target.click()
      return true
    })
    report.helpButtonFound = helpClicked
    await wait(1200)

    // 3. 断言对话框内容
    const dialog = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      const text = dlg ? dlg.textContent || '' : ''
      return {
        dialogVisible: Boolean(dlg),
        hasTitle: text.includes('使用指南'),
        hasFiveSteps: /第一步/.test(text) && /第五步/.test(text),
        hasAgentFaq: text.includes('AI 销售团队') && /人在回路|开始触达/.test(text),
        hasFaq: text.includes('常见问题'),
        textPreview: text.slice(0, 160),
      }
    })
    report.dialog = dialog
    await page.screenshot({ path: screenshotPath })

    report.pass = Boolean(helpClicked && dialog.dialogVisible && dialog.hasTitle && dialog.hasFiveSteps)
    report.stdout = stdout.slice(0, 600)
    report.stderr = stderr.slice(0, 600)
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log('help-dialog probe pass =', report.pass)
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
