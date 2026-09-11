const { spawn, execSync } = require('child_process')
const puppeteer = require('puppeteer-core')
const path = require('path')
const fs = require('fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const exe = path.join(__dirname, '..', 'release', 'win-unpacked', 'KoneAI.exe')
const REPORT = { startedAt: new Date().toISOString(), modules: {}, errors: [] }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function launch() {
  try { execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' }) } catch {}
  await wait(1000)
  const proc = spawn(exe, [], { cwd: path.dirname(exe), env: { ...process.env, KONE_SMOKE_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  proc.stderr.on('data', (c) => (stderr += c.toString()))
  await wait(4500)
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', protocolTimeout: 90000 })
  let page = null
  for (let i = 0; i < 40 && !page; i++) {
    const pages = await browser.pages()
    page = pages.find((p) => !p.url().startsWith('devtools://')) || null
    if (!page) await wait(500)
  }
  await page.bringToFront()
  await page.setViewport({ width: 1440, height: 900 })
  await wait(3000)
  return { browser, page, stderr }
}

async function nav(page, name) {
  await page.evaluate((n) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes(n))
    b?.click()
  }, name)
  await wait(1200)
}

async function setInput(page, selector, value) {
  return page.evaluate(([sel, v]) => {
    const el = document.querySelector(sel)
    if (!el) return false
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, [selector, value])
}

async function main() {
  log('=== 启动应用 ===')
  const { browser, page, stderr } = await launch()
  const appState = await page.evaluate(() => ({
    text: document.body?.innerText?.slice(0, 150) || '',
    hasNav: Boolean(document.querySelector('[data-nav-id="search"]')),
  }))
  REPORT.modules.app = { ok: appState.hasNav, text: appState.text }
  if (!appState.hasNav) REPORT.errors.push('应用启动未进入主界面')
  log('应用启动:', appState.hasNav ? 'OK 已进入主界面' : 'FAIL')

  // ── 模块 1：系统设置 配置状态 ──
  log('=== 系统设置：验证三渠道配置已保存 ===')
  await nav(page, '系统设置')
  const settings = await page.evaluate(() => {
    const t = document.body.innerText
    return {
      llm: /智能决策大脑/.test(t),
      google: /谷歌获客引擎/.test(t) || /谷歌地图/.test(t),
      anysearch: /AnySearch/.test(t),
      savedKeys: (t.match(/已保存自定义密钥/g) || []).length,
    }
  })
  REPORT.modules.settings = settings
  log('  LLM:', settings.llm, '| 谷歌:', settings.google, '| AnySearch:', settings.anysearch, '| 已保存密钥标记:', settings.savedKeys)

  // ── 模块 2：LLM 模型识别 ──
  log('=== 识别模型（LLM 数据交互）===')
  const model = await page.evaluate(async () => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
    tabs.find((t) => t.textContent.includes('基础配置'))?.click()
    await new Promise((r) => setTimeout(r, 600))
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '识别模型')
    if (!btn) return { ok: false, detail: '未找到识别模型按钮' }
    btn.click()
    await new Promise((r) => setTimeout(r, 8000))
    const opts = Array.from(document.querySelectorAll('select option')).map((o) => o.textContent.trim()).filter(Boolean)
    return { ok: opts.length > 0, models: opts }
  })
  REPORT.modules.modelIdentify = model
  if (!model.ok) REPORT.errors.push('LLM 模型识别失败: ' + (model.detail || '未拉回模型'))
  log('  模型识别:', model.ok ? 'OK 拉回 ' + model.models.length + ' 个模型' : 'FAIL', model.models?.slice(0, 6).join(','))

  // ── 模块 3：智能获客 搜索（耐心等待完整流程）──
  log('=== 智能获客：填词 → 搜索 → 等待完整流程 ===')
  await nav(page, '智能获客')
  await wait(800)
  const k1 = await setInput(page, 'input[placeholder*="自然语言"]', 'golf cart lithium battery distributor')
  const k2 = await setInput(page, 'input[placeholder*="国家"]', 'United States')
  log('  输入回填:', k1 && k2 ? 'OK' : 'FAIL', JSON.stringify({ k1, k2 }))
  await wait(400)
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="btn-search-execute"]')
    if (btn) { btn.click(); return 'testid' }
    return 'none'
  })
  log('  点击搜索按钮:', clicked)
  if (clicked === 'none') throw new Error('未找到搜索按钮')

  // 耐心轮询：记录阶段，直到 评分完成（AI 深度分析中 N/50 到 50 或 完成/失败文案）
  const searchStart = Date.now()
  let lastStage = ''
  let scoredCount = 0
  let done = false
  let maxWait = 480000 // 最长 8 分钟（fetching ~45s + 评分 50条×3s/2并发 ≈ 120s + 富化）
  const stagesSeen = []
  while (Date.now() - searchStart < maxWait) {
    await wait(5000)
    const s = await page.evaluate(() => {
      const t = document.body.innerText
      const m = t.match(/AI 深度分析中\.\.\.\s*(\d+)\s*\/\s*(\d+)/)
      const stageMatch = t.match(/正在抓取|正在进行 ICP|正在补全|已返回|完成|错误|失败/g)
      return {
        scored: m ? Number(m[1]) : 0,
        total: m ? Number(m[2]) : 0,
        stage: stageMatch ? stageMatch[stageMatch.length - 1] : '',
        hasResult: /当前展示\s*\d+\s*\/\s*\d+/.test(t),
        tail: t.slice(-200),
      }
    })
    if (s.stage && s.stage !== lastStage) { lastStage = s.stage; stagesSeen.push(s.stage) }
    scoredCount = Math.max(scoredCount, s.scored)
    log(`  [${Math.round((Date.now() - searchStart) / 1000)}s] 阶段=${s.stage || '-'} 评分=${s.scored}/${s.total || '?'} 有结果=${s.hasResult}`)
    // 完成判定：评分达到总数，或出现"完成/已返回/失败"结束语
    if (s.total > 0 && s.scored >= s.total) { done = true; break }
    if (/完成|已返回/.test(s.stage) && (s.hasResult || s.scored > 0)) { done = true; break }
    if (/失败|错误/.test(s.tail) && Date.now() - searchStart > 60000) { done = true; break }
  }
  const elapsedMs = Date.now() - searchStart
  log(`  搜索流程结束: done=${done} 耗时=${Math.round(elapsedMs / 1000)}s 评分进度=${scoredCount}/50 阶段=${stagesSeen.join('→')}`)

  // 采集结果指标
  const metrics = await page.evaluate(() => {
    const t = document.body.innerText
    const aiScored = (t.match(/ICP 综合评估\s*\d+%/g) || []).length
    const rules = (t.match(/ICP 综合评估\s*\d+%（规则）/g) || []).length
    const failed = (t.match(/评估失败|保留基础信息/g) || []).length
    const dm = (t.match(/位决策人/g) || []).length
    const customs = (t.match(/海关数据/g) || []).length
    const exhibitions = (t.match(/展会足迹/g) || []).length
    const sources = Array.from(new Set((t.match(/谷歌|Google|海关|展会|LinkedIn|Facebook|AnySearch|社媒|贸易/g) || [])))
    const show = t.match(/当前展示\s*\d+\s*\/\s*\d+/)?.[0] || ''
    return { aiScored, rules, failed, dm, customs, exhibitions, sources, show }
  })
  REPORT.modules.search = { done, elapsedMs, scoredCount, ...metrics }
  if (!done) REPORT.errors.push(`搜索流程未在时限内完成（${Math.round(elapsedMs / 1000)}s）`)
  if (metrics.aiScored + metrics.rules + metrics.failed === 0) REPORT.errors.push('搜索未产生任何结果卡片（0 结果）')
  if (done && scoredCount === 0 && metrics.aiScored === 0) REPORT.errors.push('搜索完成但 AI 评分为 0（请确认已配置 LLM 密钥）')
  log('  结果:', metrics.show, '| AI评分卡:', metrics.aiScored, '| 规则评分卡:', metrics.rules, '| 失败卡:', metrics.failed)
  log('  数据源徽标:', metrics.sources.join(','), '| 决策人:', metrics.dm, '| 海关:', metrics.customs, '| 展会:', metrics.exhibitions)

  // ── 模块 4：保存线索 → 线索管理 ──
  log('=== 保存线索 → 线索管理 ===')
  const saved = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /加入线索|保存|入库/.test(x.textContent))
    if (!b) return 'no-save-btn'
    b.click()
    return 'clicked'
  })
  log('  保存按钮:', saved)
  await wait(2000)
  await nav(page, '线索管理')
  const leads = await page.evaluate(() => {
    const t = document.body.innerText
    return {
      kanban: (t.match(/待跟进|联系中|已回复|已归档/g) || []).length,
      hasLead: /待跟进|联系中/.test(t),
      snippet: t.slice(0, 120),
    }
  })
  REPORT.modules.leads = { ...leads, saveClicked: saved !== 'no-save-btn' }
  if (saved === 'no-save-btn') REPORT.errors.push('未找到保存线索按钮，保存链路中断')
  if (!leads.hasLead) REPORT.errors.push('保存后线索管理页无线索可见')
  log('  线索看板:', leads.kanban > 0 ? 'OK 出现看板列' : 'FAIL', '| 有线索:', leads.hasLead)

  // ── 模块 5：数据中心 统计 ──
  log('=== 数据中心：统计卡数据交互 ===')
  await nav(page, '数据中心')
  const dc = await page.evaluate(() => {
    const t = document.body.innerText
    return {
      stats: (t.match(/总线索|今日新增|已触达|高分|海关数据覆盖/g) || []).length,
      hasCount: /\d+/.test(t.match(/总线索数[^\d]*(\d+)/)?.[1] || ''),
      snippet: t.slice(0, 150),
    }
  })
  REPORT.modules.dataCenter = dc
  if (dc.stats === 0) REPORT.errors.push('数据中心统计卡未渲染')
  log('  数据中心:', dc.stats > 0 ? 'OK 统计卡渲染' : 'FAIL', '| 片段:', dc.snippet.slice(0, 80))

  // ── 模块 6：知识库 添加 ──
  log('=== 知识库：新增条目 ===')
  await nav(page, '知识库')
  const kb = await page.evaluate(async () => {
    const addBtn = Array.from(document.querySelectorAll('button')).find((b) => /新增|添加|新建/.test(b.textContent))
    if (!addBtn) return { ok: false, detail: '未找到新增按钮' }
    addBtn.click()
    await new Promise((r) => setTimeout(r, 500))
    const title = document.querySelector('input[placeholder*="标题"]') || document.querySelector('input')
    const textarea = document.querySelector('textarea')
    if (title && textarea) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, '高尔夫球车锂电池卖点')
      title.dispatchEvent(new Event('input', { bubbles: true }))
      const tset = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      tset.call(textarea, '锂电池组对比铅酸：3倍寿命、快充、轻量化。')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      const save = Array.from(document.querySelectorAll('button')).find((b) => /保存/.test(b.textContent))
      save?.click()
      await new Promise((r) => setTimeout(r, 1500))
      return { ok: true, detail: document.body.innerText.slice(0, 120) }
    }
    return { ok: false, detail: '未找到标题输入框' }
  })
  REPORT.modules.knowledgeBase = kb
  if (!kb.ok) REPORT.errors.push('知识库新增条目失败: ' + (kb.detail || ''))
  log('  知识库:', kb.ok ? 'OK 已添加' : 'FAIL', kb.detail?.slice(0, 80))

  // ── 收尾 ──
  REPORT.finishedAt = new Date().toISOString()
  REPORT.stderr = stderr.slice(0, 300)
  fs.writeFileSync(path.join(__dirname, '..', 'tests', 'module-e2e-report.json'), JSON.stringify(REPORT, null, 2))
  if (REPORT.errors.length > 0) {
    log(`=== 存在 ${REPORT.errors.length} 项失败 ===`)
    REPORT.errors.forEach((item) => log('FAIL:', item))
    process.exitCode = 1
  } else {
    log('=== 全部模块验证通过 ===')
  }
  log('=== 验证完成，报告已保存 ===')
  console.log(JSON.stringify(REPORT, null, 2))
  // 保留 8 秒让用户看界面，再清理
  log('界面保留 8 秒供查看...')
  await wait(8000)
  try { execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' }) } catch {}
}

main().catch((e) => { console.error('FATAL', e); try { execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' }) } catch {}; process.exit(1) })
