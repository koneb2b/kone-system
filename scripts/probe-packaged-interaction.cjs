/*
 * probe-packaged-interaction.cjs — 打包版安装包「数据交互」探针
 *
 * 目标：验证安装包各功能的**真实数据交互**是否规范严谨 —— 写入是否生效、
 *       前端校验是否拦得住、无凭据时是否优雅降级、错误反馈是否可见。
 *       DOM 存在 ≠ 交互可用，本脚本必须真的点、真的填、真的读回。
 *
 * 前置：`KONE_TEST_USER_DATA_DIR=/tmp/kone-probe-ud1 node scripts/dev-launch-packaged.cjs release-v148`
 *   —— 必须用隔离 userData，所有写入都不会污染真实用户数据。
 *
 * 与 probe-packaged-discovery.cjs 的分工：
 *   discovery   = 只读采集（拿到选择器事实）
 *   interaction = 真实读写（本文件）
 *
 * 安全边界（严格遵守）：
 *   - **绝不点击任何发送/外发类按钮**（发送邮件、发 WhatsApp、启动 Agent 巡航）
 *   - 只写「可逆数据」：知识库条目 / 自定义标签，且全部写在隔离 userData
 *   - 写入的数据由 S5 自行删除，不留脏数据
 *
 * 断言可信度（沿用项目探针约定）：
 *   1. 断言用**几何 + 文本**，不用 DOM 存在性（隐藏节点也算存在）
 *   2. 每次转场/操作后等足够时长，避免动画中途读到旧帧
 *   3. 反馈文案用 body.innerText 的「新增行」差分获取 —— toast 是瞬态元素，
 *      抓 role/status 选择器极易错过；差分法不依赖任何组件实现细节
 *   4. 提取目标文本时取「最小匹配项」，避免误选外层容器
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const puppeteer = require('puppeteer-core')

const OUT_DIR = path.resolve(__dirname, '..', '.probe-packaged', 'interaction')
fs.mkdirSync(OUT_DIR, { recursive: true })

const SETTLE_MS = 1200 // 操作后等 UI 落定（toast 出现 + 动画收尾）
const NAV_MS = 1900 // 转场动画（项目既有教训：动画中途截图会拍到旧帧）

// 测试数据 —— 统一前缀便于回收，也避免与用户真实数据混淆
let pageErrorSeen = false // 模块级：任一阶段发生未捕获 pageerror 即污染健康态断言
let ENTRY_BASELINE = 0 // 进入 S2 时记录的知识库条目卡片基线，S5 删除后须回到该值

const RUN_TAG = `探针-${Date.now().toString(36)}`
const ENTRY_TITLE = `探针测试条目 ${RUN_TAG}`
const ENTRY_CONTENT =
  `这是一条由打包版数据交互探针自动写入的测试知识条目，运行标识 ${RUN_TAG}。\n` +
  '用于验证「写入 → 保存 → 读回 → 删除」的完整闭环。'
const CUSTOM_TAG = `探针标签_${RUN_TAG}`

const results = []
const allErrors = []
const shotHashes = [] // 多场景截图哈希：用于「截图互不相同」防旧帧自欺

function record(name, status, detail) {
  results.push({ name, status, detail })
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '!' : status === 'INFO' ? 'i' : '✗'
  console.log(`  ${icon} [${status}] ${name}${detail ? ' — ' + detail : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(page, tag) {
  try {
    const p = path.join(OUT_DIR, `${tag}.png`)
    await page.bringToFront().catch(() => {})
    await page.screenshot({ path: p, timeout: 25000, captureBeyondViewport: false })
    const md5 = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')
    shotHashes.push({ tag, md5 })
    return { path: p, md5 }
  } catch (e) {
    record(`截图 ${tag}`, 'WARN', String(e.message || e).slice(0, 80))
    return null
  }
}

/**
 * 关闭可能残留的模态层。
 *
 * 自欺来源：上一版 S1 打开「升级授权」面板后未关闭，随后 `document.querySelector(...).click()`
 * 会在**被遮罩覆盖**的情况下依然触发（evaluate 直调 click 无视视觉遮挡），
 * 于是后续导航/点击看似成功、实则点在遮罩上 → 状态错位却不自知。
 * 每次转场前先关模态，是消除该类自欺的最小代价手段。
 */
async function closeModal(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(400)
  await page.evaluate(() => {
    const close = [
      ...document.querySelectorAll('[role="dialog"] button, .modal button, [data-testid*="close"]'),
    ].find(
      (b) =>
        /关闭|取消|×|x|close/i.test(b.textContent || '') ||
        /close|关闭/i.test(b.getAttribute('aria-label') || '')
    )
    if (close) close.click()
  })
  await sleep(400)
}

/** 转场到指定模块（按 data-nav-id） */
async function goto(page, navId) {
  await closeModal(page)
  await page.evaluate((id) => document.querySelector(`[data-nav-id="${id}"]`)?.click(), navId)
  await sleep(NAV_MS)
}

/** 按可见文本点击按钮（归一化空白；contains=false 为精确匹配） */
async function clickText(page, text, { contains = false } = {}) {
  return await page.evaluate(
    (want, mode) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const hit = [...document.querySelectorAll('button')].find((b) => {
        const r = b.getBoundingClientRect()
        if (r.width < 1 || r.height < 1 || b.disabled) return false
        const t = norm(b.textContent)
        return mode === 'contains' ? t.includes(want) : t === want
      })
      if (!hit) return null
      hit.click()
      return norm(hit.textContent)
    },
    text,
    contains ? 'contains' : 'exact'
  )
}

/** 按 placeholder 写入（React 受控组件必须走 native value setter） */
async function typeByPlaceholder(page, placeholder, value) {
  return await page.evaluate((ph, val) => {
    const el = [...document.querySelectorAll('input,textarea')].find(
      (e) => (e.getAttribute('placeholder') || '') === ph
    )
    if (!el) return 'MISSING_PLACEHOLDER'
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.blur()
    return el.value
  }, placeholder, value)
}

/** 页面可见文本行 */
async function textLines(page) {
  return page.evaluate(() =>
    (document.body.innerText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

/** 操作前后文本差分 → 新出现的反馈行（toast / 错误提示） */
async function feedbackAdded(page, beforeLines) {
  const after = await textLines(page)
  return after.filter((l) => beforeLines.indexOf(l) === -1)
}

/**
 * 文本片段是否在页面上可见。
 *
 * 必须同时检查 **input/textarea 的 value** —— 知识库条目的标题/内容存在受控输入的
 * value 里，不在 textContent 里。只查 textContent 会让「条目已渲染」这类断言
 * **恒为 false**（写入成功也判不通过），属于探针自欺，必须堵死。
 */
async function textVisible(page, snippet, { maxLen = 80 } = {}) {
  return page.evaluate(
    (snip, cap) => {
      const visible = (el) => {
        const r = el.getBoundingClientRect()
        return r.width > 1 && r.height > 1
      }
      // 1) 输入类元素的 value（受控表单的真实内容）
      for (const el of document.querySelectorAll('input,textarea')) {
        if ((el.value || '').includes(snip) && visible(el)) return true
      }
      // 2) 文本节点：取最小匹配项，避免命中外层容器
      const nodes = [...document.querySelectorAll('*')].filter((n) => {
        if (n.children.length > 12) return false
        const t = (n.textContent || '').trim()
        return t.length > 0 && t.length <= cap && t.includes(snip)
      })
      return nodes.some(visible)
    },
    snippet,
    maxLen
  )
}

/** 统计当前可见的知识库条目卡片数（按标题输入框定位，几何可见） */
async function countEntryCards(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('input')].filter((e) => {
      if ((e.getAttribute('placeholder') || '') !== '例如：循环寿命优势') return false
      const r = e.getBoundingClientRect()
      return r.width > 1 && r.height > 1
    }).length
  })
}

const stageOf = (page) =>
  page.evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || null)

/** 校验应用没有崩到白屏 / error boundary，且该阶段没有未捕获异常 */
async function assertAlive(page, label) {
  // 该阶段发生 pageerror ⇒ 应用不在健康态（此前只汇总、不断言 → 自欺）
  if (pageErrorSeen) {
    pageErrorSeen = false
    record(`应用存活 @${label}`, 'FAIL', '该阶段发生未捕获异常(pageerror)，应用不在健康态')
    return false
  }
  const probe = await page.evaluate(() => {
    const t = document.body.innerText || ''
    return {
      len: t.length,
      crashed: t.length < 40 || /Application error|Uncaught|渲染出错|Unexpected token/i.test(t),
      stage: document.querySelector('[data-stage]')?.getAttribute('data-stage') || null,
    }
  })
  if (probe.crashed || probe.stage === 'locked') {
    record(`应用存活 @${label}`, 'FAIL', `stage=${probe.stage} 文本长度=${probe.len}（可能白屏或被 error boundary 吞掉）`)
    return false
  }
  return true
}

async function passActivation(page) {
  if ((await stageOf(page)) === 'dashboard') return true
  await page.waitForSelector('[data-stage="activation-screen"]', { timeout: 20000 })
  const label = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /开启\s*7\s*天.*试用/.test((x.textContent || '').replace(/\s+/g, ' '))
    )
    if (!b) return null
    b.click()
    return (b.textContent || '').replace(/\s+/g, ' ').trim()
  })
  if (!label) throw new Error('未找到试用按钮')
  await page.waitForFunction(
    () => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'dashboard',
    { timeout: 30000 }
  )
  await sleep(1000)
  console.log(`[probe] 已过激活门：${label}`)
  return true
}

async function main() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    protocolTimeout: 60000,
  })
  const pages = await browser.pages()
  if (!pages.length) throw new Error('无渲染页面 —— 渲染进程已死，请重启打包实例')
  const page = pages[0]
  await page.setViewport({ width: 1440, height: 900 })

  page.on('pageerror', (e) => {
    const m = `pageerror: ${String(e.message || e).slice(0, 200)}`
    if (!allErrors.includes(m)) allErrors.push(m)
    pageErrorSeen = true
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const t = `console.error: ${msg.text().slice(0, 200)}`
    if (!allErrors.includes(t)) allErrors.push(t)
  })

  await passActivation(page)
  console.log(`\n运行标识: ${RUN_TAG}\n`)

  // ============ S1 授权门禁：无效授权码 ============
  // 注意：解锁按钮的 disabled 条件是 `!licenseKey.trim()`（空才禁用），
  // 格式校验交给 submitLicense 在提交时做 —— 这是刻意的设计（提交时校验，非逐键校验），
  // 所以正确的断言是「提交后必须被拒 + 不得解锁」，而不是「按钮必须禁用」。
  console.log('--- S1 授权码校验（无效码必须被拒）---')
  {
    await goto(page, 'settings')
    await page.evaluate(() => document.querySelector('[data-testid="btn-license-upgrade-panel"]')?.click())
    await sleep(800)
    const before = await textLines(page)
    const typed = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="upgrade-license-textarea"]')
      if (!el) return 'NO_TEXTAREA'
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(el, 'PROBE-INVALID-0000-0000')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.blur()
      return el.value
    })
    record('S1 写入无效授权码', typed === 'NO_TEXTAREA' ? 'WARN' : 'PASS', typed === 'NO_TEXTAREA' ? '未找到输入框' : `回读="${typed}"`)

    if (typed !== 'NO_TEXTAREA') {
      await page.evaluate(() => document.querySelector('[data-testid="btn-upgrade-unlock"]')?.click())
      await sleep(SETTLE_MS + 1500)
      const added = await feedbackAdded(page, before)
      console.log(`  反馈新增: ${JSON.stringify(added.slice(0, 5))}`)
      const rejected = added.some((l) => /激活失败|无效|不正确|核对|重新输入|验证失败|未注册/i.test(l))
      record('S1 无效码被明确拒绝', rejected ? 'PASS' : 'FAIL', rejected ? '' : '未出现拒绝提示')
      const unlocked = await page.evaluate(() => {
        const t = document.body.innerText || ''
        return /已解锁|正式版已生效|授权已激活/i.test(t)
      })
      record('S1 无效码未触发解锁', unlocked ? 'FAIL' : 'PASS')
      await shot(page, 's1-bad-license')
      await assertAlive(page, 'S1')
    } else {
      record('S1 无效码被明确拒绝', 'WARN', '输入框缺失，未执行提交')
    }
  }

  // ============ S2 知识库新建条目（真实写入） ============
  console.log('\n--- S2 知识库新建条目（真实写入）---')
  {
    await goto(page, 'knowledge')
    // 知识库初始必然渲染 1 个空条目（createEmptyEntry），故基线 ≥1；S5 须回到该基线
    ENTRY_BASELINE = await countEntryCards(page)
    const addedBtn = await clickText(page, '新增条目')
    record('S2 点击新增条目', addedBtn ? 'PASS' : 'FAIL', addedBtn ? '' : '按钮不可点')
    await sleep(SETTLE_MS)

    const t = await typeByPlaceholder(page, '例如：循环寿命优势', ENTRY_TITLE)
    record('S2 填写标题', t === ENTRY_TITLE ? 'PASS' : 'FAIL', `回读="${String(t).slice(0, 44)}"`)
    const c = await typeByPlaceholder(page, '填写该条知识的具体内容，AI 会直接引用。', ENTRY_CONTENT)
    record('S2 填写内容', c === ENTRY_CONTENT ? 'PASS' : 'WARN', c === 'MISSING_PLACEHOLDER' ? '输入框未找到' : '')
    const tg = await typeByPlaceholder(page, '例如：产品卖点, 话术, ICP', '探针话术, 交付测试')
    record('S2 填写标签', tg === 'MISSING_PLACEHOLDER' ? 'FAIL' : 'PASS')

    await shot(page, 's2-filled-before-save')

    const saved = await clickText(page, '保存知识库')
    record('S2 点击保存知识库', saved ? 'PASS' : 'FAIL', saved ? '' : '保存按钮不可点')
    await sleep(SETTLE_MS + 600)

    const rendered = await textVisible(page, ENTRY_TITLE)
    record('S2 条目已渲染到列表', rendered ? 'PASS' : 'FAIL')
    const cards = await countEntryCards(page)
    record('S2 条目卡片数增加', cards >= ENTRY_BASELINE + 1 ? 'PASS' : 'FAIL', `当前可见条目卡片数 = ${cards}（基线 ${ENTRY_BASELINE}）`)
    const counter = await page.evaluate(() => {
      const m = (document.body.innerText || '').match(/有效条目\s*(\d+)\s*\/\s*(\d+)/)
      return m ? { ok: +m[1], total: +m[2] } : null
    })
    record('S2 条目计数联动', counter && counter.total >= 1 ? 'PASS' : 'WARN', counter ? `有效 ${counter.ok}/${counter.total}` : '未读到计数')
    // 经 APP 自身配置读取口径确认已落盘（非内存 state 自欺）——注意 config.get 返回 IPC 信封
    const kbNow = await page.evaluate(async () => {
      const res = await window.electronAPI.config.get('user_config')
      const cfg = res && typeof res === 'object' && 'data' in res ? res.data : res
      return cfg?.knowledgeBase?.entries || []
    })
    const persistedNow = kbNow.some((e) => e.title === ENTRY_TITLE && e.content === ENTRY_CONTENT)
    record('S2 保存经 APP 配置口径读回', persistedNow ? 'PASS' : 'WARN', persistedNow ? `配置条目数=${kbNow.length}` : '配置口径未读到目标条目')
    await shot(page, 's2-saved')
    await assertAlive(page, 'S2')
  }

  // ============ S3 知识库自定义标签（真实写入） ============
  console.log('\n--- S3 知识库自定义标签（真实写入）---')
  {
    const res = await typeByPlaceholder(page, '新增自定义标签，例如：售后保障、交期承诺', CUSTOM_TAG)
    record('S3 填写自定义标签', res === 'MISSING_PLACEHOLDER' ? 'FAIL' : 'PASS')
    const btnState = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '添加标签')
      return b ? { disabled: !!b.disabled } : null
    })
    const added = await clickText(page, '添加标签')
    await sleep(SETTLE_MS)
    // 关键：用 chip 专属 aria-label 按钮判定标签**真的渲染**为可删除 chip。
    // 不能用 textVisible —— 输入框 value 里也有该字符串，会造成假阳性。
    const chipRendered = await page.evaluate(
      (tag) => !!document.querySelector(`button[aria-label="删除标签 ${tag}"]`),
      CUSTOM_TAG
    )
    record(
      'S3 标签已渲染为可删除 chip',
      chipRendered ? 'PASS' : 'FAIL',
      chipRendered ? `标签="${CUSTOM_TAG.slice(0, 28)}"` : `按钮启用=${btnState && !btnState.disabled} 可点=${!!added}`
    )
    await shot(page, 's3-custom-tag')
    await assertAlive(page, 'S3')
  }

  // ============ S4 知识库搜索过滤 ============
  console.log('\n--- S4 知识库搜索过滤 ---')
  {
    await typeByPlaceholder(page, '按标题、内容或标签搜索知识条目...', ENTRY_TITLE)
    await sleep(SETTLE_MS)
    const hit = await textVisible(page, ENTRY_TITLE)
    const filteredCards = await countEntryCards(page)
    record(
      'S4 按标题过滤后仅剩目标条目',
      hit && filteredCards === 1 ? 'PASS' : 'FAIL',
      `卡片数=${filteredCards} 标题可见=${hit}`
    )
    await shot(page, 's4-filtered')

    await typeByPlaceholder(page, '按标题、内容或标签搜索知识条目...', '')
    await sleep(SETTLE_MS)
    const restoredCards = await countEntryCards(page)
    record('S4 清空后列表恢复全部条目', restoredCards >= 2 ? 'PASS' : 'FAIL', `卡片数=${restoredCards}`)
    await shot(page, 's4-cleared')
    await assertAlive(page, 'S4')
  }

  // ============ S5 删除自写条目（闭环回收） ============
  console.log('\n--- S5 删除自写条目（闭环回收）---')
  {
    // 先清空搜索，确保所有卡片可见（随后按「标题输入框精确值」定位，不依赖搜索）
    await typeByPlaceholder(page, '按标题、内容或标签搜索知识条目...', '')
    await sleep(600)
    const delRes = await page.evaluate((title) => {
      // 精确定位条目标题输入框：placeholder 唯一 + value 精确等于目标。
      // 用 includes 会先命中搜索框（其 value 也含标题）→ walk-up 到错误卡片，删除落空。
      const titleInput = [...document.querySelectorAll('input')].find(
        (e) => (e.getAttribute('placeholder') || '') === '例如：循环寿命优势' && (e.value || '') === title
      )
      if (!titleInput) return 'NO_ENTRY_INPUT'
      let card = titleInput
      for (let i = 0; i < 12 && card; i++) {
        const del = [...card.querySelectorAll('button')].find(
          (b) => b.querySelector('svg') && String(b.getAttribute('class') || '').includes('hover:bg-red-50')
        )
        if (del) {
          del.click()
          return 'CLICKED_DELETE'
        }
        card = card.parentElement
      }
      return 'NO_DELETE_BTN'
    }, ENTRY_TITLE)
    await sleep(SETTLE_MS)
    // 删除是内存操作 —— 必须再保存才真正落盘（否则配置口径仍残留）
    await clickText(page, '保存知识库')
    await sleep(SETTLE_MS + 400)
    const afterCards = await countEntryCards(page)
    const residual = await page.evaluate(async () => {
      const res = await window.electronAPI.config.get('user_config')
      const cfg = res && typeof res === 'object' && 'data' in res ? res.data : res
      return (cfg?.knowledgeBase?.entries || []).filter((e) => String(e.title || '').includes('探针测试条目')).length
    })
    const deleted = delRes === 'CLICKED_DELETE' && afterCards === ENTRY_BASELINE && residual === 0
    record(
      'S5 已删除自写条目（卡片回到基线 + 配置口径清零）',
      deleted ? 'PASS' : 'FAIL',
      `操作=${delRes} 卡片=${afterCards}/${ENTRY_BASELINE} 配置残留=${residual}`
    )
    await shot(page, 's5-deleted')
    await assertAlive(page, 'S5')

    // 回收自定义标签：用 chip 专属 aria-label 精确定位（不靠 textContent 模糊匹配）
    const tagRemoved = await page.evaluate((tag) => {
      const b = document.querySelector(`button[aria-label="删除标签 ${tag}"]`)
      if (b) {
        b.click()
        return true
      }
      return false
    }, CUSTOM_TAG)
    await sleep(SETTLE_MS)
    if (tagRemoved) {
      await clickText(page, '保存知识库')
      await sleep(SETTLE_MS)
    }
    record('S5 自定义标签已回收', tagRemoved ? 'PASS' : 'WARN', tagRemoved ? '' : '未找到标签关闭按钮（可能已不在标签池）')
  }

  // ============ S6 搜索空提交校验 ============
  console.log('\n--- S6 搜索空提交校验 ---')
  {
    await goto(page, 'search')
    // 负向守卫：输入框识别必须走 tagName.toLowerCase()（大写 TAGNAME 曾导致 input 被误判为非输入）
    const inputTag = await page.evaluate(() => {
      const el = document.querySelector('main input')
      return el ? el.tagName.toLowerCase() : 'NO_INPUT'
    })
    record('S6 搜索输入框识别正确（防 tagName 大小写误判）', inputTag === 'input' ? 'PASS' : 'WARN', `tagName=${inputTag}`)
    await page.evaluate(() => {
      const el = document.querySelector('main input')
      if (!el) return
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, '')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.blur()
    })
    await sleep(400)
    const btnState = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="btn-search-execute"]')
      return b ? { disabled: !!b.disabled, text: b.textContent.trim() } : null
    })
    if (!btnState) record('S6 空输入时执行按钮状态', 'WARN', '未找到执行按钮')
    else {
      record(
        'S6 空输入时执行按钮状态',
        btnState.disabled ? 'PASS' : 'WARN',
        `disabled=${btnState.disabled} 文本="${btnState.text}"`
      )
      if (!btnState.disabled) {
        // 若仍可点，验证点击后是校验提示而非崩溃
        const before = await textLines(page)
        await page.evaluate(() => document.querySelector('[data-testid="btn-search-execute"]')?.click())
        await sleep(SETTLE_MS + 500)
        const added = await feedbackAdded(page, before)
        console.log(`  反馈新增: ${added.length ? JSON.stringify(added.slice(0, 5)) : '(无)'}`)
        const ok = await assertAlive(page, 'S6')
        const validated = added.some((l) => /请先|请填写|输入|关键词|必填|不能为空/i.test(l))
        record('S6 空提交有前端校验提示', validated ? 'PASS' : 'WARN', validated ? '' : '未检测到校验文案')
        record('S6 空提交未导致崩溃', ok ? 'PASS' : 'FAIL')
      } else {
        record('S6 空提交未导致崩溃', 'PASS', '按钮已禁用，请求根本不会发出')
      }
    }
    await shot(page, 's6-empty-submit')
  }

  // ============ S7 无凭据搜索的优雅降级 ============
  console.log('\n--- S7 无凭据搜索的优雅降级 ---')
  {
    const filled = await page.evaluate(() => {
      const el = document.querySelector('main input')
      if (!el) return 'NO_INPUT'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, 'solar panel manufacturer Germany')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.blur()
      return el.value
    })
    record('S7 填写搜索关键词', filled === 'NO_INPUT' ? 'FAIL' : 'PASS', `回读="${String(filled).slice(0, 40)}"`)
    await shot(page, 's7-filled')

    const before = await textLines(page)
    await page.evaluate(() => document.querySelector('[data-testid="btn-search-execute"]')?.click())
    await sleep(8000) // 无 key 应快速降级；给足时间
    const added = await feedbackAdded(page, before)
    console.log(`  反馈新增(前10行): ${JSON.stringify(added.slice(0, 10))}`)
    await shot(page, 's7-after-submit')

    const ok = await assertAlive(page, 'S7')
    record('S7 无凭据搜索未崩溃', ok ? 'PASS' : 'FAIL')
    const graceful = added.some((l) =>
      /未配置|尚未|请先|密钥|配置|无法|失败|错误|暂不|请前往|降级|候选/.test(l)
    )
    record('S7 有明确的用户可读反馈', graceful ? 'PASS' : 'WARN', graceful ? '' : '提交后未检测到任何反馈行')
  }

  // ============ S8 线索管理空表导出 ============
  console.log('\n--- S8 线索管理空表导出 ---')
  {
    await goto(page, 'leads')
    const before = await textLines(page)
    await page.evaluate(() => document.querySelector('[data-testid="btn-export-csv"]')?.click())
    await sleep(SETTLE_MS + 800)
    const added = await feedbackAdded(page, before)
    console.log(`  反馈新增: ${added.length ? JSON.stringify(added.slice(0, 6)) : '(无)'}`)
    const ok = await assertAlive(page, 'S8')
    record('S8 空表导出未崩溃', ok ? 'PASS' : 'FAIL')
    // 导出经由系统「保存文件」对话框，无头探针无法确认文件真正落盘 —— 不能凭「无崩溃」冒充 PASS
    record('S8 导出文件真实落盘', 'BLOCKED', '导出走系统保存对话框，无头探针无法自动确认磁盘文件；需人工复核')
    await shot(page, 's8-lead-export')
  }

  // ============ S9 数据中心空报表导出 ============
  console.log('\n--- S9 数据中心空报表导出 ---')
  {
    await goto(page, 'data')
    const before = await textLines(page)
    const clicked = await clickText(page, '导出报表')
    await sleep(SETTLE_MS + 800)
    const added = await feedbackAdded(page, before)
    console.log(`  反馈新增: ${added.length ? JSON.stringify(added.slice(0, 6)) : '(无)'}`)
    record(
      'S9 导出按钮状态',
      clicked ? 'PASS' : 'WARN',
      clicked ? '可点' : '按钮不可点（无数据时禁用属合理降级）'
    )
    record('S9 空报表导出未崩溃', (await assertAlive(page, 'S9')) ? 'PASS' : 'FAIL')
    record('S9 报表文件真实落盘', 'BLOCKED', '导出走系统保存对话框，无头探针无法自动确认磁盘文件；需人工复核')
    await shot(page, 's9-data-export')
  }

  // ============ S10 设置页空凭据测试连接 ============
  console.log('\n--- S10 设置页空凭据测试连接 ---')
  {
    await goto(page, 'settings')
    const before = await textLines(page)
    const clicked = await clickText(page, '测试连接')
    record(
      'S10 测试连接按钮可点',
      clicked ? 'PASS' : 'INFO',
      clicked ? '' : '不可点（无 baseUrl 时禁用，属合理降级）'
    )
    if (clicked) {
      await sleep(SETTLE_MS + 2000)
      const added = await feedbackAdded(page, before)
      console.log(`  反馈新增: ${added.length ? JSON.stringify(added.slice(0, 6)) : '(无)'}`)
      record('S10 空凭据测试连接未崩溃', (await assertAlive(page, 'S10')) ? 'PASS' : 'FAIL')
      const graceful = added.some((l) => /失败|错误|无效|无法|未配置|超时|401|403|404/i.test(l))
      record('S10 空凭据测试连接给出明确反馈', graceful ? 'PASS' : 'WARN', graceful ? '' : '未检测到失败提示')
    }
    await shot(page, 's10-test-conn')
  }

  // ============ S11 搜索结果数据溯源标注 ============
  console.log('\n--- S11 搜索结果数据溯源标注 ---')
  {
    await goto(page, 'search')
    await sleep(500)
    const src = await page.evaluate(() => {
      const t = document.body.innerText || ''
      return {
        snippets: (t.match(/Google Maps|Apex|Apollo|手动录入|LinkedIn|403/g) || []).slice(0, 10),
        hasResults: /候选|线索|条/.test(t),
      }
    })
    record('S11 来源标注可识别', src.snippets.length ? 'PASS' : 'INFO', `检测到: ${JSON.stringify(src.snippets)}`)
    await shot(page, 's11-sourcing')
  }

  // ============ 汇总 ============
  // 防自欺：多场景截图若 md5 相同 ⇒ 拍到同一帧（旧帧/未转场），必须暴露而非默认通过
  if (shotHashes.length) {
    const uniq = new Set(shotHashes.map((s) => s.md5))
    const dup = shotHashes.length - uniq.size
    record('多场景截图互不相同（防旧帧自欺）', dup === 0 ? 'PASS' : 'FAIL', `${shotHashes.length} 张 / 去重 ${uniq.size} 张`)
  }
  const tally = (s) => results.filter((r) => r.status === s).length
  console.log('\n================ 交互探针汇总 ================')
  for (const r of results) console.log(`  [${r.status}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
  console.log(
    `\nPASS=${tally('PASS')}  FAIL=${tally('FAIL')}  WARN=${tally('WARN')}  INFO=${tally('INFO')}  BLOCKED=${tally('BLOCKED')}`
  )
  console.log(`运行时错误: ${allErrors.length} 条`)
  for (const e of allErrors.slice(0, 20)) console.log('  ', e)

  fs.writeFileSync(
    path.join(OUT_DIR, 'results.json'),
    JSON.stringify({ runTag: RUN_TAG, results, errors: allErrors, shotHashes }, null, 2),
    'utf8'
  )

  await browser.disconnect()
  process.exitCode = tally('FAIL') > 0 ? 1 : 0
}

main().catch((err) => {
  console.error('\n[probe] FAILED:', (err && err.stack) || String(err))
  process.exitCode = 1
})
