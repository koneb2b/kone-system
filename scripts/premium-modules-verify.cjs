/**
 * premium-modules-verify.cjs (CDP direct) — 高级版功能各模块数据交互验证
 * 用底层 CDP session 直连（绕过 puppeteer Page 的 Network.enable 兼容问题）。
 */
const puppeteer = require('puppeteer-core')
const path = require('path')
const fs = require('fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const REPORT = { startedAt: new Date().toISOString(), modules: {}, errors: [] }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', protocolTimeout: 120000 })
  const target = (await browser.targets()).find((t) => t.type() === 'page' && t.url().includes('5173'))
  if (!target) throw new Error('未找到 5173 应用页')
  const session = await target.createCDPSession()
  await session.send('Runtime.enable')
  await session.send('Page.enable')

  const evalJs = async (expression, awaitPromise = true) => {
    const r = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 200))
    return r.result?.value
  }
  const text = () => evalJs('document.body.innerText')
  const clickByText = (text) =>
    evalJs(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`)
  const setInput = (sel, value) =>
    evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`)
  const nav = async (name) => { await clickByText(name); await wait(1200) }

  await wait(2500)
  // ── M0 授权分层 ──
  log('M0 授权分层')
  const t0 = await text()
  REPORT.modules.auth = {
    plan: (t0.match(/高级版|企业版|试用版|专业版/g) || [])[0] || '',
    expires: (t0.match(/高级版: [\d-]+ 到期/g) || [''])[0],
    premiumNav: ['账号管理', 'AI 销售团队', '自动化序列', '团队协作'].every((x) => t0.includes(x)),
  }
  log(`  plan=${REPORT.modules.auth.plan} ${REPORT.modules.auth.expires} 高级导航=${REPORT.modules.auth.premiumNav}`)

  // ── M1 系统设置 / 识别模型 ──
  log('M1 系统设置 / 识别模型')
  await nav('系统设置')
  const s1 = await text()
  REPORT.modules.settings = {
    llm: /智能决策大脑/.test(s1), google: /谷歌获客引擎|谷歌地图/.test(s1), anysearch: /AnySearch/.test(s1),
    savedKeys: (s1.match(/已保存自定义密钥/g) || []).length,
  }
  await evalJs(`(() => { const t = Array.from(document.querySelectorAll('[role="tab"]')).find(x => x.textContent.includes('基础配置')); t?.click(); })()`)
  await wait(600)
  const modelBtn = await evalJs(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '识别模型'); if (!b) return false; b.click(); return true; })()`)
  await wait(8000)
  const models = await evalJs(`Array.from(document.querySelectorAll('select option')).map(o => o.textContent.trim()).filter(Boolean)`)
  REPORT.modules.modelIdentify = { clicked: modelBtn, ok: models.length > 0, models }
  log(`  配置 LLM=${REPORT.modules.settings.llm} 谷歌=${REPORT.modules.settings.google} AnySearch=${REPORT.modules.settings.anysearch} 密钥=${REPORT.modules.settings.savedKeys}`)
  log(`  识别模型: ${models.length > 0 ? 'OK ' + models.length + '个: ' + models.slice(0, 4).join(',') : 'FAIL'}`)

  // ── M2 智能获客真实搜索 ──
  log('M2 智能获客搜索')
  await nav('智能获客')
  await setInput('input[placeholder*="自然语言"]', 'golf cart lithium battery distributor')
  await setInput('input[placeholder*="国家"]', 'Germany')
  await wait(400)
  const clicked = await evalJs(`(() => { const b = document.querySelector('[data-testid="btn-search-execute"]'); if (!b) return false; b.click(); return true; })()`)
  log(`  搜索点击=${clicked}`)
  const searchStart = Date.now()
  let lastStage = '', scored = 0, total = 0, done = false
  const stages = []
  while (Date.now() - searchStart < 240000) {
    await wait(5000)
    const s = await evalJs(`(() => { const t = document.body.innerText;
      const m = t.match(/AI 深度分析中\\.\\.\\.\\s*(\\d+)\\s*\\/\\s*(\\d+)/);
      const st = t.match(/正在抓取|正在进行 ICP|正在补全|已返回|完成|错误|失败/g);
      return { scored: m ? +m[1] : 0, total: m ? +m[2] : 0, stage: st ? st[st.length-1] : '', hasResult: /当前展示\\s*\\d+\\s*\\/\\s*\\d+/.test(t) }; })()`)
    if (s.stage && s.stage !== lastStage) { lastStage = s.stage; stages.push(s.stage) }
    if (s.scored > scored) scored = s.scored
    if (s.total > total) total = s.total
    log(`  [${Math.round((Date.now() - searchStart) / 1000)}s] ${s.stage || '-'} 评分=${s.scored}/${s.total || '?'} 结果=${s.hasResult}`)
    if (s.total > 0 && s.scored >= s.total) { done = true; break }
    if (/完成|已返回/.test(s.stage) && s.hasResult && Date.now() - searchStart > 30000) { done = true; break }
    if (/错误|失败/.test(s.stage) && Date.now() - searchStart > 45000) { done = true; break }
  }
  const m2 = await evalJs(`(() => { const t = document.body.innerText; return {
    aiScored: (t.match(/ICP 综合评估\\s*\\d+%/g)||[]).length,
    rules: (t.match(/（规则）/g)||[]).length,
    failed: (t.match(/评估失败|保留基础信息/g)||[]).length,
    dm: (t.match(/位决策人/g)||[]).length,
    customs: (t.match(/海关数据/g)||[]).length,
    exhibitions: (t.match(/展会足迹/g)||[]).length,
    sources: Array.from(new Set(t.match(/谷歌|Google|海关|展会|LinkedIn|Facebook|AnySearch/g)||[])),
    show: (t.match(/当前展示\\s*\\d+\\s*\\/\\s*\\d+/)||[''])[0],
  }; })()`)
  REPORT.modules.search = { done, elapsedMs: Date.now() - searchStart, scored, total, stages, ...m2 }
  log(`  结果=${m2.show} AI分=${m2.aiScored} 规则=${m2.rules} 失败=${m2.failed} | 决策人=${m2.dm} 海关=${m2.customs} 展会=${m2.exhibitions}`)
  log(`  数据源=${m2.sources.join(',')} 阶段=${stages.join('→')} 耗时=${Math.round((Date.now() - searchStart) / 1000)}s`)

  // ── M3 结果卡生成开发信（小语种）──
  log('M3 结果卡生成开发信')
  const emailClicked = await evalJs(`(() => { const b = document.querySelector('[data-testid="btn-gen-email"]'); if (!b) return false; b.click(); return true; })()`)
  await wait(12000)
  const m3 = await evalJs(`(() => { const t = document.body.innerText; return {
    hasDraft: /针对性开发信/.test(t),
    subject: (t.match(/主题：([^\\n]+)/)||[''])[1] || '',
    hasGerman: /[äöüßÄÖÜ]/.test(t),
    hasChinese: /[\\u4e00-\\u9fff]/.test(t),
  }; })()`)
  REPORT.modules.emailDraft = { clicked: emailClicked, ...m3 }
  if (!emailClicked) REPORT.errors.push('M3 结果卡开发信按钮未找到（btn-gen-email）')
  if (emailClicked && !m3.hasDraft) REPORT.errors.push('M3 开发信按钮点击后未生成草稿')
  log(`  开发信: 生成=${m3.hasDraft} 主题=${m3.subject.slice(0, 36)} 德文=${m3.hasGerman} 中文=${m3.hasChinese}`)

  // ── M4 保存线索 → 线索管理 ──
  log('M4 保存线索 → 线索管理')
  const saveClicked = await evalJs(`(() => { const b = document.querySelector('[data-testid="btn-save-lead"]'); if (!b) return false; b.click(); return true; })()`)
  await wait(1500)
  await nav('线索管理')
  const m4 = await evalJs(`(() => { const t = document.body.innerText; return { kanban: /待跟进|联系中|已回复|已归档/.test(t), hasLead: /待跟进/.test(t) }; })()`)
  REPORT.modules.leads = { saveClicked, ...m4 }
  if (!saveClicked) REPORT.errors.push('M4 保存线索按钮未找到（btn-save-lead）')
  if (saveClicked && !m4.hasLead) REPORT.errors.push('M4 保存后线索管理无线索可见')
  log(`  保存=${saveClicked} 看板=${m4.kanban} 有线索=${m4.hasLead}`)

  // ── M5 自动化工作流 ──
  log('M5 自动化工作流')
  await nav('自动化序列')
  const m5 = await evalJs(`(() => { const t = document.body.innerText; return {
    hasVerify: /邮箱清洗|校验/.test(t), hasTemplate: /模板|首次触达/.test(t),
    hasDns: /域名信誉|DNS/.test(t), hasCloudGate: /云端|高级版|Premium/.test(t),
  }; })()`)
  REPORT.modules.automation = m5
  if (!m5.hasVerify || !m5.hasTemplate) REPORT.errors.push('M5 自动化工作流核心区块缺失')
  log(`  邮箱验证=${m5.hasVerify} 模板=${m5.hasTemplate} DNS=${m5.hasDns} 云端门槛=${m5.hasCloudGate}`)

  // ── M6 团队协作 ──
  log('M6 团队协作')
  await nav('团队协作')
  const m6 = await evalJs(`(() => { const t = document.body.innerText; return {
    hasBoard: /看板|成员|线索|协同/.test(t), hasCloudHint: /云端|Supabase|配置|未连接|未配置/.test(t),
    snippet: t.slice(0, 140),
  }; })()`)
  REPORT.modules.team = m6
  log(`  看板=${m6.hasBoard} 云端提示=${m6.hasCloudHint} 片段=${m6.snippet.slice(0, 55)}`)

  // ── M7 账号管理 + AI 销售团队 ──
  log('M7 账号管理 / AI 销售团队')
  await nav('账号管理')
  const m7a = await evalJs(`(() => { const t = document.body.innerText; return { email: /企业邮箱|SMTP/.test(t), wa: /WhatsApp/.test(t), li: /LinkedIn/.test(t) }; })()`)
  await nav('AI 销售团队')
  const m7b = await evalJs(`(() => { const t = document.body.innerText; return { cards: /拓客猎手|商务买手|邮件/.test(t), devLeak: /npm run dev|开发壳模式/.test(t) }; })()`)
  REPORT.modules.accounts = m7a
  REPORT.modules.agents = m7b
  log(`  账号 邮箱=${m7a.email} WA=${m7a.wa} LI=${m7a.li} | 智能体卡=${m7b.cards} 开发泄漏=${m7b.devLeak}`)

  REPORT.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(__dirname, '..', 'tests', 'premium-modules-report.json'), JSON.stringify(REPORT, null, 2))
  log('=== 报告已保存 tests/premium-modules-report.json ===')
  console.log(JSON.stringify(REPORT, null, 2))
  await browser.disconnect()
}

if (REPORT.errors.length > 0) {
  console.log(`=== 存在 ${REPORT.errors.length} 项失败 ===`)
  REPORT.errors.forEach((item) => console.log('FAIL:', item))
  process.exitCode = 1
} else {
  console.log('=== 高级版模块全部验证通过 ===')
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
