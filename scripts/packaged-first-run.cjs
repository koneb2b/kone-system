/**
 * Kone 打包版「首次运行」自动化验收（本机可执行，无需干净机器）。
 *
 * 与 packaged-smoke.cjs 的差别：
 *   - smoke 复用当前用户数据，只证明"能启动"；
 *   - 本脚本注入全新 `--user-data-dir`，强制走首次运行路径（无既有授权/配置/线索），
 *     因此能验证激活页、试用入口、桥接注入等"首启才出现"的行为。
 *
 * 它不能替代干净机器验收的部分（报告中如实列出）：
 *   - 目标机是否预装 Chrome/Node/VC++ 运行库等环境依赖；
 *   - 首次安装的 NSIS 安装行为、快捷方式、卸载项；
 *   - 真实第三方 API（SerpApi/LLM/SMTP）联网效果。
 *
 * 用法：
 *   node scripts/packaged-first-run.cjs              // 默认读 release/win-unpacked
 *   node scripts/packaged-first-run.cjs release-build
 *
 * 退出码：0 = PASS；1 = FAIL（详见 tests/packaged-first-run-report.json）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execSync } = require('child_process')
const puppeteer = require('puppeteer-core')

const rootDir = path.resolve(__dirname, '..')
const outputDirOverride = (process.argv[2] || process.env.KONE_PACKAGED_ROOT || 'release').trim()
const unpackedRoot = path.join(rootDir, outputDirOverride, 'win-unpacked')
const executablePath = path.join(unpackedRoot, 'KoneAI.exe')
const reportPath = path.join(rootDir, 'tests', 'packaged-first-run-report.json')
const screenshotPath = path.join(rootDir, 'tests', 'packaged-first-run.png')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ACTIVATION_PATTERN = /软件授权验证|立即验证授权|设备识别码|激活码/
const TRIAL_ENTRY_PATTERN = /免费试用|开启\s*7\s*天|试用/

async function run() {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Unpacked executable not found: ${executablePath}`)
  }

  // 全新用户数据目录 = 首次运行语义
  const profileDir = path.join(os.tmpdir(), `kone-first-run-${Date.now()}`)
  fs.mkdirSync(profileDir, { recursive: true })

  try {
    execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' })
  } catch {
    /* 无残留进程 */
  }
  await wait(800)

  const childEnv = { ...process.env, CI: '1', KONE_SMOKE_TEST: '1', ELECTRON_ENABLE_LOGGING: '1' }
  delete childEnv.ELECTRON_RUN_AS_NODE

  const electronProc = spawn(executablePath, [`--user-data-dir=${profileDir}`], {
    cwd: unpackedRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  electronProc.stdout.on('data', (c) => {
    stdout += c.toString()
  })
  electronProc.stderr.on('data', (c) => {
    stderr += c.toString()
  })

  const report = {
    scenario: 'packaged-first-run',
    startedAt: new Date().toISOString(),
    executablePath,
    profileDir,
    checks: {},
    bodyTextSample: '',
    screenshotPath,
    stdout: '',
    stderr: '',
    coverage: {
      autoCovered: ['首次启动渲染', '激活页/试用入口', 'preload 桥接注入', '首启不崩溃'],
      notAutoCovered: [
        'NSIS 安装器行为（快捷方式/卸载项/安装目录）',
        '目标机环境依赖缺失场景',
        '真实第三方 API 联网',
        '干净机器无历史残留（本机仅以空 profile 近似）',
      ],
    },
  }

  let browser
  try {
    await wait(4000)
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', protocolTimeout: 60000 })

    let page = null
    const deadline = Date.now() + 20000
    while (!page && Date.now() < deadline) {
      const pages = await browser.pages()
      page = pages.find((p) => !p.url().startsWith('devtools://')) || null
      if (!page) await wait(500)
    }
    if (!page) throw new Error('No Electron app page detected')

    page.setDefaultTimeout(20000)
    await page.bringToFront()
    await page.setViewport({ width: 1440, height: 900 })
    await page.waitForSelector('[data-stage]', { timeout: 20000 })
    await wait(2500)

    const snapshot = await page.evaluate(() => {
      const text = document.body?.innerText || ''
      return {
        bodyText: text,
        hasBridge: typeof window.electronAPI !== 'undefined',
        bridgeKeyCount:
          typeof window.electronAPI === 'object' && window.electronAPI
            ? Object.keys(window.electronAPI).length
            : 0,
        hasStage: Boolean(document.querySelector('[data-stage]')),
        hasNavSettings: Boolean(document.querySelector('[data-nav-id="settings"]')),
        hasNavSearch: Boolean(document.querySelector('[data-nav-id="search"]')),
        hasNavAgents: Boolean(document.querySelector('[data-nav-id="agents"]')),
        visibleTextLength: text.replace(/\s+/g, '').length,
      }
    })

    report.bodyTextSample = snapshot.bodyText.slice(0, 1200)

    report.checks.booted = snapshot.visibleTextLength > 0
    report.checks.stageRendered = snapshot.hasStage
    report.checks.preloadBridgeVisible = snapshot.hasBridge && snapshot.bridgeKeyCount > 0
    report.checks.bridgeKeyCount = snapshot.bridgeKeyCount
    report.checks.activationScreenVisible = ACTIVATION_PATTERN.test(snapshot.bodyText)
    report.checks.trialEntryVisible = TRIAL_ENTRY_PATTERN.test(snapshot.bodyText)
    report.checks.dashboardNavVisible = snapshot.hasNavSettings || snapshot.hasNavSearch
    report.checks.agentsNavVisible = snapshot.hasNavAgents
    report.checks.landedOnKnownScreen =
      report.checks.activationScreenVisible || report.checks.dashboardNavVisible

    try {
      await page.screenshot({ path: screenshotPath })
    } catch {
      await wait(2000)
      await page.screenshot({ path: screenshotPath })
    }
  } finally {
    report.finishedAt = new Date().toISOString()
    report.stdout = stdout
    report.stderr = stderr
    report.verdict =
      report.checks.booted &&
      report.checks.stageRendered &&
      report.checks.preloadBridgeVisible &&
      report.checks.landedOnKnownScreen
        ? 'PASS'
        : 'FAIL'
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    if (browser) await browser.close().catch(() => undefined)
    electronProc.kill()
  }

  console.log(`[first-run] verdict=${report.verdict}`)
  console.log(`[first-run] report=${reportPath}`)
  if (report.verdict !== 'PASS') {
    throw new Error(`Packaged first-run validation failed: ${JSON.stringify(report.checks)}`)
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
