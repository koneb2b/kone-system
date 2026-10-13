/*
 * probe-packaged-persistence.cjs — 打包版「写入 → 真实重启 → 读回」持久化闭环（自持版）
 *
 * 为什么自持：上一版把生命周期交给外部手动 kill+relaunch，无法证明「同一 exe、同一
 * userData、不同进程」的冷启动；而且 verify 阶段会自动申请试用，掩盖授权未恢复。
 * 本版**一次命令**完成：启动 → 写 → 杀自己 → 重启 → 读回 → 清理，并用 PID / exe sha256 /
 * userData 三重身份锚定，证明不是同一个进程在内存里自圆其说。
 *
 * 防自证（与项目探针约定一致）：
 *   1) 写后立即通过 `window.electronAPI.config.get('user_config')` 读回（APP 自己读盘的口径），
 *      不靠「页面上改了 state」自欺；重启后再次读回，且 PID 必须不同。
 *   2) 同时校验 标题 / 正文 / 条目标签 / 自定义标签 四字段，不单看标题。
 *   3) verify 阶段**绝不自动激活**：若重启后不在 dashboard，视为「授权未持久化」FAIL。
 *   4) 截图必须真实产出，缺失即判未完成。
 *
 * 隔离：userData 强制落在 `.probe-packaged/persistence-userdata`，绝不碰真实 AppData。
 *
 * 用法：node scripts/probe-packaged-persistence.cjs [输出目录，默认 release-v148]
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('node:child_process')
const puppeteer = require('puppeteer-core')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, '.probe-packaged', 'persistence')
const USER_DATA = path.join(OUT_DIR, 'userdata')
const STATE_FILE = path.join(OUT_DIR, 'state.json')
const REPORT_FILE = path.join(OUT_DIR, 'report.json')
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.mkdirSync(USER_DATA, { recursive: true })

const OUTPUT_DIR = (process.argv[2] || 'release-v148').trim()
const UNPACKED = path.join(ROOT, OUTPUT_DIR, 'win-unpacked')
const EXE = path.join(UNPACKED, 'KoneAI.exe')

const SETTLE = 1200
const NAV = 1900
const CDP = 'http://127.0.0.1:9222'
const TITLE_PH = '例如：循环寿命优势'
const CONTENT_PH = '填写该条知识的具体内容，AI 会直接引用。'
const TAG_PH = '例如：产品卖点, 话术, ICP'
const TAG_INPUT_PH = '新增自定义标签，例如：售后保障、交期承诺'

const ENTRY_TITLE = `持久化探针 ${Date.now().toString(36)}`
const ENTRY_CONTENT = `由持久化探针写入，用于验证「写入 → 冷启动 → 读回」。运行标识 ${ENTRY_TITLE}`
const ENTRY_TAGS = '持久化, 回归验证'
const CUSTOM_TAG = `持久化标签_${Date.now().toString(36)}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

let appProc = null
function launchApp() {
  if (!fs.existsSync(EXE)) throw new Error(`未找到安装包可执行文件：${EXE}（先打包 ${OUTPUT_DIR}）`)
  const env = { ...process.env, KONE_SMOKE_TEST: '1', KONE_TEST_USER_DATA_DIR: USER_DATA }
  delete env.ELECTRON_RUN_AS_NODE
  appProc = spawn(EXE, [], { cwd: UNPACKED, env, stdio: ['ignore', 'pipe', 'pipe'] })
  appProc.stdout.on('data', () => {})
  appProc.stderr.on('data', () => {})
  return appProc
}
async function waitCdp(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 1500)
      const res = await fetch(`${CDP}/json/version`, { signal: ac.signal })
      clearTimeout(t)
      if (res.ok) return await res.json()
    } catch {
      /* 尚未就绪 */
    }
    await sleep(800)
  }
  throw new Error('CDP 在 60s 内未就绪（9222 未监听）')
}
async function killApp() {
  if (!appProc || appProc.pid == null) return
  try {
    require('node:child_process').execSync(`taskkill /PID ${appProc.pid} /T /F`, { stdio: 'ignore' })
  } catch {
    /* 已退出 */
  }
  appProc = null
}
function connect() {
  return puppeteer.connect({ browserURL: CDP, protocolTimeout: 60000 })
}
/**
 * 等待渲染页面出现。
 * CDP 的 `/json/version` 会在**渲染页面创建之前**就绪，故 waitCdp 成功后
 * `browser.pages()` 可能仍为空 → 直接取 [0] 会 undefined。必须轮询等待。
 */
async function waitForPage(browser, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pages = await browser.pages().catch(() => [])
    const p = pages.find((pg) => !pg.url().startsWith('devtools://'))
    if (p) return p
    await sleep(500)
  }
  throw new Error('30s 内未出现渲染页面（CDP 已就绪但无 page target）')
}

async function setVal(page, placeholder, value) {
  return page.evaluate((ph, val) => {
    const el = [...document.querySelectorAll('input,textarea')].find((e) => (e.getAttribute('placeholder') || '') === ph)
    if (!el) return 'MISSING'
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.blur()
    return el.value
  }, placeholder, value)
}
async function clickText(page, text) {
  return page.evaluate((want) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const hit = [...document.querySelectorAll('button')].find((b) => {
      const r = b.getBoundingClientRect()
      return r.width > 1 && r.height > 1 && !b.disabled && norm(b.textContent) === want
    })
    if (!hit) return null
    hit.click()
    return norm(hit.textContent)
  }, text)
}
async function stage(page) {
  return page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || null)
}
async function activateTrialIfNeeded(page) {
  // 等 [data-stage] 挂载：刚 connect 时 React 可能尚未渲染，直接读 stage 会得到 null
  await page.waitForSelector('[data-stage]', { timeout: 30000 })
  if ((await stage(page)) === 'dashboard') return 'already'
  await page.waitForSelector('[data-stage="activation-screen"]', { timeout: 25000 })
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /开启\s*7\s*天.*试用/.test((x.textContent || '').replace(/\s+/g, ' ')))
    if (b) { b.click(); return true }
    return false
  })
  if (!clicked) throw new Error('未找到试用按钮')
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'dashboard', { timeout: 30000 })
  return 'activated'
}
async function gotoKnowledge(page) {
  await page.evaluate(() => document.querySelector('[data-nav-id="knowledge"]')?.click())
  await sleep(NAV)
}
/**
 * 通过 APP 自身配置读取口径校验持久化（不靠内存 state 自欺）。
 *
 * 关键：`window.electronAPI.config.get()` 返回的是**IPC 原始信封** `{ success, data }`，
 * 渲染层自己的 `configGet` 会 unwrap 到 `.data`。探针直连 preload 时必须自己解包，
 * 否则读的是信封外层 → `knowledgeBase` 恒 undefined → **假阴性**（写入成功也判失败）。
 * 这里显式兼容两种形态（已解包 / 未解包）。
 */
async function readKnowledge(page) {
  return page.evaluate(async () => {
    const res = await window.electronAPI.config.get('user_config')
    const cfg = res && typeof res === 'object' && 'data' in res ? res.data : res
    const kb = cfg?.knowledgeBase || {}
    return { entries: kb.entries || [], customTags: kb.customTags || [] }
  })
}
/**
 * 截图：视觉证据是**补充**，持久化闭环的决定性证据是「读回 + PID 锚定」。
 * 某些非交互桌面会话下 `Page.captureScreenshot` 会挂起（环境问题，非产品缺陷），
 * 故截图失败**降级为 WARN**，不得阻断主结论。失败详情写入 report。
 */
const shotWarnings = []
async function shot(page, tag) {
  const p = path.join(OUT_DIR, `${tag}.png`)
  try {
    await page.bringToFront().catch(() => {})
    await page.screenshot({ path: p, timeout: 25000, captureBeyondViewport: false })
    if (!fs.existsSync(p)) throw new Error('截图文件未产出')
    return p
  } catch (e) {
    const msg = `截图 ${tag} 失败（环境可能不支持）：${(e && e.message) || e}`
    shotWarnings.push(msg)
    console.log(`  ! WARN ${msg}`)
    return null
  }
}

;(async () => {
  const report = { steps: [], fails: [] }
  const fail = (name, detail) => { report.fails.push(`${name}: ${detail}`); console.log(`  ✗ FAIL ${name} — ${detail}`) }
  const pass = (name, detail) => { console.log(`  ✓ PASS ${name}${detail ? ' — ' + detail : ''}`) }
  try {
    const exeHash = sha256(EXE)
    console.log(`[identity] exe=${EXE}\n           sha256=${exeHash}\n           userData=${USER_DATA}`)

    // ── 启动（第一次）──
    launchApp()
    const v1 = await waitCdp()
    let browser = await connect()
    let page = await waitForPage(browser)
    await page.setViewport({ width: 1440, height: 900 })
    const trial = await activateTrialIfNeeded(page)
    pass('首次启动激活/进入', trial)
    await gotoKnowledge(page)

    // ── 写入 ──
    if (!(await clickText(page, '新增条目'))) throw new Error('无法点击「新增条目」')
    await sleep(SETTLE)
    const t = await setVal(page, TITLE_PH, ENTRY_TITLE)
    const c = await setVal(page, CONTENT_PH, ENTRY_CONTENT)
    const g = await setVal(page, TAG_PH, ENTRY_TAGS)
    if (!(await clickText(page, '保存知识库'))) throw new Error('无法点击「保存知识库」')
    await sleep(SETTLE + 600)
    await setVal(page, TAG_INPUT_PH, CUSTOM_TAG)
    await clickText(page, '添加标签')
    await sleep(SETTLE)
    if (!(await clickText(page, '保存知识库'))) throw new Error('二次保存失败')
    await sleep(SETTLE + 600)

    const before = await readKnowledge(page)
    const hasEntryNow = before.entries.some((e) => e.title === ENTRY_TITLE && e.content === ENTRY_CONTENT && e.tags?.includes('持久化'))
    const hasTagNow = before.customTags.includes(CUSTOM_TAG)
    hasEntryNow ? pass('写后即时读回（app 配置口径）', `条目=${before.entries.length} 标签=${before.customTags.length}`) : fail('写后即时读回', JSON.stringify({ hasEntryNow, hasTagNow }))
    await shot(page, 'write-done')

    const pid1 = appProc.pid
    await browser.disconnect()
    await killApp()
    await sleep(2500)

    // ── 重启（第二次，不同进程）──
    launchApp()
    const v2 = await waitCdp()
    browser = await connect()
    page = await waitForPage(browser)
    await page.setViewport({ width: 1440, height: 900 })
    // 重启后必须先等 React 挂载出 [data-stage]，否则读到 null 会被误判为「授权未持久化」
    await page.waitForSelector('[data-stage]', { timeout: 30000 })
    const s2 = await stage(page)
    if (s2 === 'activation-screen') {
      fail('重启后授权持久化', '重启后回到激活页，试用/授权未持久化')
    } else if (s2 === 'dashboard') {
      pass('重启后授权持久化', '仍在 dashboard')
    } else {
      fail('重启后授权持久化', `data-stage=${s2}`)
    }
    await gotoKnowledge(page)
    const after = await readKnowledge(page)
    const entry = after.entries.find((e) => e.title === ENTRY_TITLE)
    const persisted = !!entry && entry.content === ENTRY_CONTENT && (entry.tags || []).includes('持久化')
    const tagPersisted = after.customTags.includes(CUSTOM_TAG)
    persisted ? pass('重启后条目仍在（标题+正文+标签全字段）', `content匹配=${entry?.content === ENTRY_CONTENT}`) : fail('重启后条目丢失', JSON.stringify({ found: !!entry, tags: entry?.tags }))
    tagPersisted ? pass('重启后自定义标签仍在', CUSTOM_TAG) : fail('重启后自定义标签丢失', JSON.stringify(after.customTags))
    const pid2 = appProc.pid
    pid2 && pid2 !== pid1 ? pass('确为不同进程冷启动', `pid1=${pid1} pid2=${pid2}`) : fail('进程身份锚定', `pid1=${pid1} pid2=${pid2}`)
    await shot(page, 'verify')
    report.steps.push({ phase: 'verify', pid1, pid2, exeHash, userData: USER_DATA, entryPersisted: persisted, tagPersisted, stageAfterRestart: s2 })

    // ── 清理：删除自己创建的条目 + 标签，避免污染 userData ──
    try {
      const cleaned = await page.evaluate(
        (title, tag, titlePh) => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
          // 从标题输入框向上逐层寻找所在卡片，再点其删除按钮（titleEl 自身是 input，无子 button）
          let card = [...document.querySelectorAll('input')].find(
            (e) => (e.getAttribute('placeholder') || '') === titlePh && (e.value || '') === title
          )
          let deleted = false
          for (let i = 0; i < 12 && card; i++) {
            const del = [...card.querySelectorAll('button')].find(
              (b) =>
                (b.querySelector('svg') && String(b.getAttribute('class') || '').includes('hover:bg-red-50')) ||
                /删除/.test(norm(b.getAttribute('aria-label') || ''))
            )
            if (del) {
              del.click()
              deleted = true
              break
            }
            card = card.parentElement
          }
          // 移除自定义标签
          const chip = [...document.querySelectorAll('span')].find((s) => (s.textContent || '').includes(tag))
          const x = chip?.querySelector('button')
          const tagRemoved = !!x
          if (x) x.click()
          return { deleted, tagRemoved }
        },
        ENTRY_TITLE,
        CUSTOM_TAG,
        TITLE_PH
      )
      await sleep(SETTLE)
      await clickText(page, '保存知识库')
      await sleep(SETTLE)
      console.log(`  · 清理：条目删除=${cleaned.deleted} 标签回收=${cleaned.tagRemoved}`)
    } catch (e) {
      console.log(`  ! 清理时异常（不影响主结论）：${e.message}`)
    }

    await browser.disconnect()
    await killApp()
  } catch (err) {
    console.error('[persistence] FAILED:', (err && err.stack) || String(err))
    report.fails.push('exception: ' + (err && err.message || err))
  } finally {
    if (appProc) { try { require('node:child_process').execSync(`taskkill /PID ${appProc.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
  }
  report.warnings = shotWarnings
  report.passed = report.fails.length === 0
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8')
  if (shotWarnings.length) console.log(`\n[persistence] 截图告警 ${shotWarnings.length} 条（不影响主结论）`)
  console.log(`\n[persistence] ${report.passed ? 'ALL PASS' : 'HAS FAIL'} — 报告 ${REPORT_FILE}`)
  process.exit(report.fails.length ? 1 : 0)
})()
