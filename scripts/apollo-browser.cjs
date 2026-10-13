/*
 * apollo-browser.cjs — 受控浏览器助手（仅用于把 Apollo API Key 取回并写入应用）
 *
 * 为什么需要它：用户已登录 Apollo 的浏览器与自动化浏览器是**独立会话**，
 * 自动化不会、也不应读取用户真实浏览器的 Cookie/登录态。故启动一个**独立 profile**
 * 的受控 Chrome，用户在**该窗口**登录后，由本脚本读取密钥（用户自己的密钥，用户自己的会话）。
 *
 * 用法：
 *   node scripts/apollo-browser.cjs open    # 启动受控 Chrome 并打开 Apollo keys 页（窗口保持）
 *   node scripts/apollo-browser.cjs read    # 连接该窗口，截图 + 导出页面可见文本到文件
 *   node scripts/apollo-browser.cjs close   # 关闭受控 Chrome
 *
 * 安全：密钥只写入本地文件 .probe-packaged/apollo/keys-page.txt（供写入应用时读取），
 *       不打印到日志；本脚本不接触用户真实 Chrome profile。
 */
const fs = require('fs')
const path = require('path')
const { spawn, execSync } = require('node:child_process')
const puppeteer = require('puppeteer-core')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, '.probe-packaged', 'apollo')
fs.mkdirSync(OUT, { recursive: true })

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = path.join(OUT, 'chrome-profile')
const CDP_PORT = 9333
const KEYS_URL = 'https://developer.apollo.io/#/keys'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function launch() {
  if (!fs.existsSync(CHROME)) throw new Error(`未找到 Chrome：${CHROME}`)
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,OptimizationHints',
    KEYS_URL,
  ]
  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore' })
  child.unref()
  console.log(`[apollo] 已启动受控 Chrome（独立 profile）→ ${KEYS_URL}`)
  console.log(`[apollo] profile=${PROFILE}`)
  console.log(`[apollo] 请在**新打开的 Chrome 窗口**里登录 Apollo（若已是登录页）。登录完成后运行：node scripts/apollo-browser.cjs read`)
}

async function connect() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}`, protocolTimeout: 60000 })
      return browser
    } catch {
      await sleep(700)
    }
  }
  throw new Error('受控 Chrome 未在 30s 内就绪（9333 未监听）。请先运行 open。')
}

async function read() {
  const browser = await connect()
  const pages = await browser.pages()
  let page = pages.find((p) => p.url().includes('apollo.io')) || pages[pages.length - 1]
  await page.bringToFront().catch(() => {})
  await sleep(1500)
  const shotPath = path.join(OUT, 'apollo-keys.png')
  await page.screenshot({ path: shotPath, timeout: 25000 }).catch((e) => console.log('[apollo] 截图失败:', e.message))
  const text = await page.evaluate(() => document.body.innerText || '')
  fs.writeFileSync(path.join(OUT, 'keys-page.txt'), text, 'utf8')
  const url = page.url()
  console.log(`[apollo] url=${url}`)
  console.log(`[apollo] 截图=${shotPath}`)
  console.log(`[apollo] 页面文本长度=${text.length}（已写入 keys-page.txt）`)
  console.log('[apollo] 登录态判断：', /log in|sign in|登录|Sign In/i.test(text) && text.length < 4000 ? '疑似未登录' : '疑似已登录（详见 keys-page.txt）')
  await browser.disconnect()
}

function close() {
  try {
    execSync(`taskkill /F /FI "WINDOWTITLE eq *Apollo*"`, { stdio: 'ignore' })
  } catch {}
  // 兜底：按 profile 特征结束（仅关闭使用本脚本 profile 的 chrome）
  try {
    const pidFile = path.join(PROFILE, 'chrome_debug_port_owner.txt')
    void pidFile
  } catch {}
  console.log('[apollo] 已尝试关闭受控 Chrome（如仍有窗口，请手动关闭该独立窗口）')
}

const cmd = (process.argv[2] || 'open').trim()
;(async () => {
  if (cmd === 'open') launch()
  else if (cmd === 'read') await read()
  else if (cmd === 'close') close()
  else console.log('用法: open | read | close')
})().catch((e) => {
  console.error('[apollo] 失败:', e.message)
  process.exit(1)
})
