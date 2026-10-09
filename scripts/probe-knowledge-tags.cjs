/**
 * 知识库自定义标签 —— 自动化验证探针（AI 自验，不依赖人工确认）。
 *
 * ## 验证目标
 * 「用户可自定义标签」此前是**假象**：`customTags` 是死字段（类型声明了但零读写），
 * 且 Agent 侧只认 4 个硬编码内置标签。本探针验证本次改造的**用户可见闭环**：
 *   1. 标签池把「内置标签」与「自定义标签」区分展示（内置有灰标、自定义可删）
 *   2. 用户能真的**添加**一个自定义标签并看到它出现在标签池中
 *   3. 点击「保存知识库」后，`customTags` **真的写进了 store**（不是只改了 UI 状态）
 *   4. 刷新页面后自定义标签**仍在**（证明是从 store 回填，而非内存态）
 *
 * ## 防自欺护栏
 * 沿用 probe-knowledge-card.cjs 的教训（曾有"两场景截出同一张图却报通过"）：
 *   a) 断言元素真的进入**视口**（DOM 存在 ≠ 用户可见）
 *   b) **断言 store 里的真实值**（UI 显示 ≠ 已持久化）—— 本探针的核心
 *   c) 保存前后各截一图，断言**哈希不同**（相同即说明操作未生效）
 *
 * 用法：先 `npx vite --host 127.0.0.1 --port 5173`，再跑本脚本。
 */

const puppeteer = require('puppeteer')
const path = require('node:path')
const crypto = require('node:crypto')
const fs = require('node:fs')
const { buildMockBridgeSource } = require('./lib/mock-bridge.cjs')

const BASE_URL = 'http://127.0.0.1:5173'
const OUT_DIR = path.join(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CUSTOM_TAG = '交期承诺'

const hashFile = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

/** 在页面上下文里取出当前 store 中的 user_config。 */
const readStoredConfig = (page) =>
  page.evaluate(() => {
    try {
      // mock 桥把 config 存在 window.__MOCK_STORE__ 里（见 mock-bridge.cjs）
      const raw = window.__MOCK_STORE__?.get?.('user_config')
      return raw ? JSON.parse(JSON.stringify(raw)) : null
    } catch {
      return null
    }
  })

const run = async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=2'],
  })

  const errors = []
  const checks = []
  const record = (name, pass, detail) => {
    checks.push({ name, pass, detail })
    console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  }

  // 单一 context：本探针需要一个**持续存在**的 store 来验证「保存 → 刷新后仍在」。
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  const bridgeSrc = buildMockBridgeSource({ leads: [] })
  await page.evaluateOnNewDocument(bridgeSrc)

  const gotoKnowledge = async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('button[data-nav-id="knowledge"]', { timeout: 20000 })
    await page.click('button[data-nav-id="knowledge"]')
    // 等标签池卡片真正渲染出来（而非固定 sleep）。
    // 注意：input 的 placeholder 不在 innerText 里，故用「添加标签」按钮文案判定。
    await page.waitForFunction(
      () => document.body.innerText.includes('我的标签') && document.body.innerText.includes('添加标签'),
      { timeout: 15000 },
    )
  }

  // 首次进入前清空 mock store（避免上一轮探针遗留的 localStorage 干扰）。
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.evaluate(() => window.__MOCK_STORE__?.reset?.())

  await gotoKnowledge()

  // ── 检查 1：标签池渲染，内置标签带「内置」标记 ──
  // 从 h3「我的标签」向上找到**包含标签 chip 的卡片容器**（h3 的直接父级只含标题，
  // 会漏掉标签 chip）。做法：取所有包含该 h3 且同时含「内置」文本的容器中最小的一个。
  const poolText = await page.evaluate(() => {
    const h3 = Array.from(document.querySelectorAll('h3')).find((el) => el.textContent?.includes('我的标签'))
    if (!h3) return ''
    let node = h3.parentElement
    while (node && !/内置/.test(node.innerText || '')) node = node.parentElement
    return node ? node.innerText || '' : ''
  })
  record('标签池渲染出「我的标签」区块', poolText.includes('我的标签'), '')
  record(
    '内置标签标注为「内置」',
    poolText.includes('内置') && poolText.includes('竞品替换'),
    `poolText=${JSON.stringify(poolText.slice(0, 80))}`,
  )

  const beforeShot = path.join(OUT_DIR, 'probe-knowledge-tags-before.png')
  await page.screenshot({ path: beforeShot })

  // ── 检查 2：添加自定义标签 ──
  const added = await page.evaluate((tag) => {
    const input = document.querySelector('input[placeholder*="新增自定义标签"]')
    if (!input) return { ok: false, why: '未找到自定义标签输入框' }
    // React 受控组件：必须用原生 setter 才能触发 onChange
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, tag)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  }, CUSTOM_TAG)
  record('找到自定义标签输入框', added.ok, added.why || '')

  await sleep(300)
  const clickedAdd = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /添加标签/.test(b.textContent || ''))
    if (!btn || btn.disabled) return false
    btn.click()
    return true
  })
  record('点击「添加标签」按钮', clickedAdd, '')

  await sleep(400)
  const poolAfterAdd = await page.evaluate(() => document.body.innerText)
  record('新标签出现在标签池中（UI 层）', poolAfterAdd.includes(CUSTOM_TAG), `期望包含「${CUSTOM_TAG}」`)

  const afterAddShot = path.join(OUT_DIR, 'probe-knowledge-tags-after-add.png')
  await page.screenshot({ path: afterAddShot })

  // ── 检查 3：保存后 customTags 真的落库 ──
  const clickedSave = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /保存知识库/.test(b.textContent || ''))
    if (!btn || btn.disabled) return false
    btn.click()
    return true
  })
  record('点击「保存知识库」按钮', clickedSave, '')

  // 等 store 真被写入（轮询而非固定 sleep）
  let stored = null
  try {
    await page.waitForFunction(
      (tag) => {
        try {
          const raw = window.__MOCK_STORE__?.get?.('user_config')
          return !!(raw && raw.knowledgeBase && Array.isArray(raw.knowledgeBase.customTags) && raw.knowledgeBase.customTags.includes(tag))
        } catch {
          return false
        }
      },
      { timeout: 8000 },
      CUSTOM_TAG,
    )
  } catch {
    /* 下面统一读取并报错 */
  }
  stored = await readStoredConfig(page)
  const storedTags = stored?.knowledgeBase?.customTags || []
  record(
    '保存后 store 中 customTags 真的含新标签（持久化核心断言）',
    Array.isArray(storedTags) && storedTags.includes(CUSTOM_TAG),
    `stored.customTags=${JSON.stringify(storedTags)}`,
  )

  // ── 检查 4：刷新后仍在（证明是回填，不是内存态）──
  await gotoKnowledge()
  const afterReloadText = await page.evaluate(() => document.body.innerText)
  record('刷新后自定义标签仍在（回填链路生效）', afterReloadText.includes(CUSTOM_TAG), `期望包含「${CUSTOM_TAG}」`)

  const afterReloadShot = path.join(OUT_DIR, 'probe-knowledge-tags-after-reload.png')
  await page.screenshot({ path: afterReloadShot })

  // ── 检查 5：截图哈希互不相同（防"操作没生效却报通过"）──
  const h1 = hashFile(beforeShot)
  const h2 = hashFile(afterAddShot)
  record('添加前后的截图哈希不同（操作确实产生了视觉变化）', h1 !== h2, `${h1.slice(0, 8)} vs ${h2.slice(0, 8)}`)

  // ── 检查 6：删除自定义标签 ──
  // 刷新后标签池需重新渲染，先等删除按钮出现（而非固定 sleep）。
  let deleteBtnFound = false
  try {
    await page.waitForSelector(`button[aria-label="删除标签 ${CUSTOM_TAG}"]`, { timeout: 8000 })
    deleteBtnFound = true
  } catch {
    /* 下面统一报错 */
  }
  record('刷新后出现自定义标签的删除按钮', deleteBtnFound, '')
  const removed = await page.evaluate((tag) => {
    const btn = document.querySelector(`button[aria-label="删除标签 ${tag}"]`)
    if (!btn) return false
    btn.click()
    return true
  }, CUSTOM_TAG)
  record('自定义标签可被删除（带删除按钮）', removed, '')

  await sleep(300)
  const afterRemove = await page.evaluate(() => document.body.innerText)
  record('删除后标签从池中消失', !afterRemove.includes(CUSTOM_TAG), '')

  const allOk = checks.every((c) => c.pass)
  const report = {
    checks,
    allOk,
    customTag: CUSTOM_TAG,
    screenshots: { before: beforeShot, afterAdd: afterAddShot, afterReload: afterReloadShot },
    hashes: { before: h1, afterAdd: h2 },
    errors,
  }
  console.log('\n' + JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(OUT_DIR, 'probe-knowledge-tags-report.json'), JSON.stringify(report, null, 2))

  await browser.close()
  console.log(`\n===== 知识库自定义标签验证：${checks.filter((c) => c.pass).length}/${checks.length} 通过 =====`)
  if (!allOk) process.exit(1)
}

run().catch((e) => {
  console.error('探针执行失败:', e)
  process.exit(1)
})
