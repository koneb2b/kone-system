/*
 * probe-packaged-discovery.cjs — 打包版安装包「交互式元素实况探查」
 *
 * 为什么需要这一步：
 *   用户要求验证安装包「各功能数据交互是否规范严谨」。但仓库里只有 12 个
 *   data-testid，9 个模块的控件绝大多数无 testid → 选择器必须靠真实 DOM 实况
 *   推导，不能靠猜。猜错选择器的探针比不跑探针更危险（会误报"功能失效"）。
 *
 * 本脚本做什么：
 *   1. 用 puppeteer.connect 接住已运行的打包实例（不自行启动，见 dev-launch-packaged.cjs）
 *   2. 过激活门（isolated userData，KONE_TEST_USER_DATA_DIR 隔离，不碰真实用户数据）
 *   3. 逐模块转场，采集可交互元素清单（text / role / 几何 / 可见性 / 唯一性）
 *   4. 全页截图
 *
 * 安全边界（与 probe-packaged-ui.cjs 一致）：
 *   本脚本**只做只读采集**：导航 + 读取 + 截图。不点击任何创建/保存/发送/删除类按钮。
 *   真正会写入数据的交互由 probe-packaged-interaction.cjs 单独执行，且只写在隔离 userData。
 *
 * 环境：Node ≥ 18（Puppeteer Core）
 */

const fs = require('fs')
const path = require('path')

const puppeteer = require('puppeteer-core')

const OUT_DIR = path.resolve(__dirname, '..', '.probe-packaged', 'dom')
fs.mkdirSync(OUT_DIR, { recursive: true })

const PAGE_WAIT_MS = 1900 // 转场后等动画落定（项目探针约定，动画中途截图会拍到旧帧）

/**
 * 采集页面全部可交互元素的实况。
 *
 * 设计要点：
 *  - 同时收 button / input / select / textarea / [role=button] / a[href] / [tabindex]
 *    —— 只收 button 会漏掉大量用 div+role 或 label 包裹的自定义控件（本项目大量使用）
 *  - 记录可见性（rect 宽高 > 0 且 computed visibility/opacity 非零），因为 React 条件渲染
 *    常留空壳节点在 DOM 里，DOM 存在 ≠ 用户可见
 *  - text 取「可见文本长度最小的匹配项」，避免取到外层容器文本（项目探针约定）
 */
async function harvestInteractive(page) {
  return await page.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return false
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || Number(cs.opacity || 1) <= 0.02) return false
      if (cs.display === 'none' || cs.display === 'contents') return false
      return true
    }

    // 输入类元素没有可见文本，标签来自 label/aria
    const labelText = (el) => {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim()
      const ph = el.getAttribute('placeholder')
      if (ph) return `[placeholder] ${ph.trim()}`
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (lab) return lab.textContent.trim()
      }
      // 自定义表单常把 label 作为 input 的父元素第一个子节点
      const p = el.parentElement
      if (p) {
        const first = p.querySelector('label, span, div')
        if (first && first !== el) {
          const t = first.textContent.trim().replace(/\s+/g, ' ')
          if (t && t.length <= 40) return t
        }
      }
      return ''
    }

    const textOf = (el) => {
      let t = (el.textContent || '').trim().replace(/\s+/g, ' ')
      // 剪掉长文本，避免清单不可读
      return t.length > 48 ? t.slice(0, 48) + '…' : t
    }

    const selectors = [
      'button',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[role="textbox"]',
      '[role="switch"]',
      '[role="checkbox"]',
      '[role="menuitem"]',
      'a[href]',
    ]
    const seen = new Set()
    const out = []
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue
        seen.add(el)
        const isInput = /^(input|select|textarea)$/.test(el.tagName.toLowerCase())
        const visible = isVisible(el)
        const r = el.getBoundingClientRect()
        out.push({
          tag: el.tagName.toLowerCase(),
          type: isInput ? el.getAttribute('type') || el.tagName.toLowerCase() : null,
          testid: el.getAttribute('data-testid') || '',
          navId: el.getAttribute('data-nav-id') || '',
          text: isInput ? labelText(el) : textOf(el),
          disabled: !!el.disabled,
          readonly: !!el.readOnly,
          checked: el.tagName === 'INPUT' ? el.checked : null,
          visible,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        })
      }
    }
    // 去掉重复的（role=button 与 button 常是同一元素）
    return out.sort((a, b) => a.y - b.y || a.x - b.x)
  })
}

function writeOut(name, payload) {
  const p = path.join(OUT_DIR, `${name}.json`)
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
  return p
}

/** 截图容错：超时不致命，只记录（截图失败不影响 DOM 采集结论） */
async function shot(page, filePath, label) {
  try {
    await page.screenshot({ path: filePath, timeout: 120000 })
    return true
  } catch (e) {
    console.warn(`  [warn] 截图失败 ${label}: ${String(e.message || e).slice(0, 120)}`)
    return false
  }
}

async function main() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    // 打包实例在 Electron 沙箱里跑，首次截图要等主进程预热；默认 180s 会超时
    protocolTimeout: 600000,
  })
  console.log('[probe] 已连接打包实例')
  const pages = await browser.pages()
  if (!pages.length) {
    throw new Error(
      'CDP 端口在监听但没有任何页面 —— 渲染进程已死（主进程孤儿存活）。' +
        '先 taskkill 残留 KoneAI.exe，再重新 `node scripts/dev-launch-packaged.cjs release-v148`'
    )
  }
  const page = pages[0]
  await page.setViewport({ width: 1440, height: 900 })
  console.log('[probe] 页面:', await page.title())

  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message || e).slice(0, 200)}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`)
  })

  // ---------- 过激活门 ----------
  const stageBefore = await page
    .evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || null)
    .catch(() => null)
  console.log('[probe] 当前 data-stage =', stageBefore)

  if (stageBefore !== 'dashboard') {
    await page.waitForSelector('[data-stage="activation-screen"]', { timeout: 20000 })
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const t = btns.find((b) => /开启\s*7\s*天.*试用/.test((b.textContent || '').replace(/\s+/g, ' ')))
      if (!t) return null
      t.click()
      return t.textContent.trim()
    })
    if (!clicked) throw new Error('未找到"开启 7 天试用"按钮')
    console.log('[probe] 已点击试用:', clicked)
    await page.waitForFunction(
      () => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'dashboard',
      { timeout: 30000 }
    )
  }
  await new Promise((r) => setTimeout(r, 1200))
  await shot(page, path.join(OUT_DIR, '00-activation-done.png'), '00-activation-done')

  // ---------- 逐模块采集 ----------
  const MODS = [
    ['search', '智能获客'],
    ['leads', '线索管理'],
    ['data', '数据中心'],
    ['knowledge', '知识库'],
    ['settings', '系统设置'],
    ['accounts', '账号管理'],
    ['agents', 'AI 销售团队'],
    ['automation', '自动化序列'],
    ['team-dashboard', '团队协作'],
  ]

  const summary = []
  for (const [navId, label] of MODS) {
    const before = await page.evaluate((id) => {
      const el = document.querySelector(`[data-nav-id="${id}"]`)
      if (!el) return 'MISSING'
      const r = el.getBoundingClientRect()
      return JSON.stringify({
        text: el.textContent.trim().replace(/\s+/g, ' '),
        disabled: el.disabled || null,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0,
      })
    }, navId)

    await page.evaluate((id) => document.querySelector(`[data-nav-id="${id}"]`)?.click(), navId)
    await new Promise((r) => setTimeout(r, PAGE_WAIT_MS))

    const els = await harvestInteractive(page)
    await shot(page, path.join(OUT_DIR, `01-${navId}.png`), navId)
    const stage = await page
      .evaluate(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') || null)

    const visible = els.filter((e) => e.visible)
    const testids = visible.filter((e) => e.testid)
    const inputCount = visible.filter((e) => ['input', 'select', 'textarea'].includes(e.tag)).length
    const btnCount = visible.filter((e) => ['button', 'a'].includes(e.tag)).length

    const rec = {
      navId,
      label,
      stage,
      nav: before,
      totalInteractive: els.length,
      visibleInteractive: visible.length,
      buttons: btnCount,
      inputs: inputCount,
      testids: testids.map((t) => t.testid),
      elements: els,
    }
    summary.push({ navId, label, stage, visible: visible.length, buttons: btnCount, inputs: inputCount, testids: testids.length })
    writeOut(`01-${navId}`, rec)
    console.log(
      `  ${label.padEnd(10)} stage=${String(stage).padEnd(12)} 可见控件=${String(visible.length).padStart(3)} ` +
        `按钮=${String(btnCount).padStart(3)} 输入=${String(inputCount).padStart(3)} testid=${testids.length}`
    )
  }

  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({ modules: summary, errors: errors.slice(0, 40) }, null, 2), 'utf8')

  console.log('\n=== 采集结果 ===')
  for (const m of summary) console.log(`  ${m.label}: ${m.visible} 个可见控件 / ${m.buttons} 按钮 / ${m.inputs} 输入 / ${m.testids} testid`)
  console.log(`\n控制台/运行时错误: ${errors.length} 条`)
  for (const e of errors.slice(0, 10)) console.log('  ', e)

  await browser.disconnect()
  console.log('\n产物:', OUT_DIR)
}

main().catch((err) => {
  console.error('\n[probe] FAILED:', err && err.stack ? err.stack : String(err))
  process.exitCode = 1
})
