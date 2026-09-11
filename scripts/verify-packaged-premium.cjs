/**
 * verify-packaged-premium.cjs — 打包版高级功能真实链路验证（CDP 直连）
 * 验证：授权分层 / 识别模型 / 真实搜索评分 / 开发信小语种 / 线索 / 自动化 / 团队 / 账号
 */
const { spawn, execSync } = require('child_process')
const puppeteer = require('puppeteer-core')
const path = require('path')
const fs = require('fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const exe = path.join(__dirname, '..', 'release', 'win-unpacked', 'KoneAI.exe')
const REPORT = { startedAt: new Date().toISOString(), modules: {}, errors: [] }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function main() {
  if (!fs.existsSync(exe)) { console.error('未找到打包产物'); process.exit(1) }
  try { execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' }) } catch {}
  await wait(1000)
  const proc = spawn(exe, [], { cwd: path.dirname(exe), env: { ...process.env, KONE_SMOKE_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  proc.stderr.on('data', (c) => (stderr += c.toString()))
  await wait(4500)
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', protocolTimeout: 120000 })
  const target = (await browser.targets()).find((t) => t.type() === 'page' && !t.url().startsWith('devtools://'))
  if (!target) throw new Error('未检测到应用页')
  const session = await target.createCDPSession()
  await session.send('Runtime.enable')
  await wait(2500)
  const ev = async (expr, awaitPromise = true) => {
    const r = await session.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 150))
    return r.result?.value
  }
  const setInput = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`)
  const clickNav = (name) => ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes(${JSON.stringify(name)})); if (!b) return false; b.click(); return true; })()`)

  // M0 授权分层
  const auth = await ev(`({ text: document.body.innerText.slice(0,120), premium: ['账号管理','AI 销售团队','自动化序列','团队协作'].every((x)=>document.body.innerText.includes(x)) })`)
  REPORT.modules.auth = auth
  log('M0 授权:', auth.premium ? 'OK 高级版全解锁' : 'FAIL', '|', String(auth.text).slice(0, 60))
  /* 若未激活/试用过期，搜索会被授权 Gate 拦截返回 0 结果。
     检测并点击"开启 7 天试用"完成授权后继续。 */
  const unauth = await ev(`/未激活|待激活|试用过期/.test(document.body.innerText)`)
  if (unauth) {
    log('  检测到未激活，尝试开启 7 天试用...')
    const trialBtn = await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /开启.{0,3}试用|免费试用/.test(x.textContent)); if (!b) return false; b.click(); return true; })()`)
    log(`  试用按钮: ${trialBtn}`)
    await wait(3000)
    const after = await ev(`/未激活|待激活/.test(document.body.innerText)`)
    log('  授权状态:', after ? '仍未激活' : '已激活（试用开启）')
    if (after) {
      // 可能弹窗/输入激活码，记录供人工
      REPORT.errors.push('授权未完成：需要手动激活')
    }
  }

  // M1 识别模型（真实 LLM）
  await clickNav('系统设置'); await wait(800)
  await ev(`(() => { const t = Array.from(document.querySelectorAll('[role="tab"]')).find((x) => x.textContent.includes('基础配置')); t?.click(); })()`); await wait(500)
  const m1click = await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '识别模型'); if (!b) return false; b.click(); return true; })()`)
  await wait(9000)
  const models = await ev(`Array.from(document.querySelectorAll('select option')).map(o => o.textContent.trim()).filter(Boolean)`)
  REPORT.modules.modelIdentify = { clicked: m1click, ok: models.some((m) => m && m !== '请点击识别'), models }
  log(`M1 识别模型: ${REPORT.modules.modelIdentify.ok ? 'OK ' + models.length + '个: ' + models.slice(0, 5).join(',') : 'FAIL: ' + models.join(',')}`)

  // M2 真实搜索（德国）
  await clickNav('智能获客'); await wait(800)
  await setInput('input[placeholder*="自然语言"]', 'golf cart lithium battery distributor')
  await setInput('input[placeholder*="国家"]', 'Germany')
  await wait(400)
  await ev(`(() => { const b = document.querySelector('[data-testid="btn-search-execute"]'); b?.click(); return !!b; })()`)
  const t0 = Date.now()
  let last = '', stages = [], scored = 0, total = 0, done = false
  while (Date.now() - t0 < 300000) {
    await wait(5000)
    const s = await ev(`(() => { const t = document.body.innerText;
      const m = t.match(/AI 深度分析中\\.\\.\\.\\s*(\\d+)\\s*\\/\\s*(\\d+)/);
      const st = t.match(/正在抓取|正在进行 ICP|正在补全|已返回|完成|错误|失败/g);
      const shown = (t.match(/当前展示\\s*(\\d+)\\s*\\/\\s*(\\d+)/)||[]);
      return { scored: m ? +m[1] : 0, total: m ? +m[2] : 0, stage: st ? st[st.length-1] : '',
               shown: shown[1] ? +shown[1] : 0, resTotal: shown[2] ? +shown[2] : 0 }; })()`)
    if (s.stage && s.stage !== last) { last = s.stage; stages.push(s.stage) }
    if (s.scored > scored) scored = s.scored
    if (s.total > total) total = s.total
    log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${s.stage || '-'} 评分=${s.scored}/${s.total || '?'} 展示=${s.shown}/${s.resTotal || '?'}`)
    if (s.total > 0 && s.scored >= s.total && s.shown > 0) { done = true; break }
    if (/完成|已返回/.test(s.stage) && s.shown > 0 && Date.now() - t0 > 30000) { done = true; break }
    if (/失败|错误/.test(s.stage) && Date.now() - t0 > 60000) { done = true; break }
  }
  const m2 = await ev(`(() => { const t = document.body.innerText; return {
    ai: (t.match(/ICP 综合评估\\s*\\d+%/g)||[]).length,
    rules: (t.match(/（规则）/g)||[]).length,
    failed: (t.match(/评估失败|保留基础信息/g)||[]).length,
    dm: (t.match(/位决策人/g)||[]).length,
    sources: Array.from(new Set(t.match(/谷歌|Google|海关|展会|LinkedIn|Facebook/g)||[])),
    show: (t.match(/当前展示\\s*\\d+\\s*\\/\\s*\\d+/)||[''])[0],
  }; })()`)
  REPORT.modules.search = { done, elapsedMs: Date.now() - t0, scored, total, stages, ...m2 }
  if (!done) REPORT.errors.push(`M2 搜索流程未在时限内完成（${Math.round((Date.now() - t0) / 1000)}s）`)
  if (Number(m2.ai) + Number(m2.rules) + Number(m2.failed) === 0) REPORT.errors.push('M2 搜索未产生任何结果卡片（0 结果）')
  log(`M2 搜索: ${m2.show} AI分=${m2.ai} 规则=${m2.rules} 失败=${m2.failed} 决策人=${m2.dm} 源=${m2.sources.join(',')} 耗时=${Math.round((Date.now() - t0) / 1000)}s 阶段=${stages.join('→')}`)

  // M3 开发信（德国 → 应德语）
  const m3click = await ev(`(() => { const b = document.querySelector('[data-testid="btn-gen-email"]'); if (!b) return false; b.click(); return true; })()`)
  await wait(15000)
  const m3 = await ev(`(() => { const t = document.body.innerText; return {
    draft: /针对性开发信/.test(t), subject: (t.match(/主题：([^\\n]+)/)||[''])[1] || '', german: /[äöüßÄÖÜ]/.test(t)
  }; })()`)
  REPORT.modules.emailDraft = { clicked: m3click, ...m3 }
  if (!m3click) REPORT.errors.push('M3 开发信按钮未找到（btn-gen-email）')
  if (m3click && !m3.draft) REPORT.errors.push('M3 开发信按钮点击后未生成草稿')
  log(`M3 开发信: 生成=${m3.draft} 主题=${String(m3.subject).slice(0, 40)} 含德文=${m3.german}`)

  // M4 保存线索 → 线索管理
  const m4click = await ev(`(() => { const b = document.querySelector('[data-testid="btn-save-lead"]'); b?.click(); return !!b; })()`)
  if (!m4click) REPORT.errors.push('M4 保存线索按钮未找到（btn-save-lead）')
  await wait(1500)
  await clickNav('线索管理'); await wait(1200)
  const m4 = await ev(`(() => { const t = document.body.innerText; return { kanban: /待跟进|联系中|已回复|已归档/.test(t), lead: /待跟进/.test(t) }; })()`)
  REPORT.modules.leads = { saveClicked: m4click, ...m4 }
  if (m4click && !m4.lead) REPORT.errors.push('M4 保存后线索管理无线索可见')
  log(`M4 线索: 看板=${m4.kanban} 有线索=${m4.lead}`)

  // M5-M7
  await clickNav('自动化序列'); await wait(900)
  const m5 = await ev(`(() => { const t = document.body.innerText; return { verify: /邮箱清洗|校验/.test(t), dns: /域名信誉|DNS/.test(t) }; })()`)
  await clickNav('团队协作'); await wait(900)
  const m6 = await ev(`/看板|成员|协同/.test(document.body.innerText)`)
  await clickNav('账号管理'); await wait(900)
  const m7 = await ev(`(() => { const t = document.body.innerText; return { email: /企业邮箱|SMTP/.test(t), wa: /WhatsApp/.test(t) }; })()`)
  REPORT.modules.automation = m5; REPORT.modules.team = { ok: m6 }; REPORT.modules.accounts = m7
  if (!m5.verify) REPORT.errors.push('M5 自动化序列缺少邮箱清洗区块')
  if (!m6) REPORT.errors.push('M6 团队协作看板未渲染')
  log(`M5 自动化: 验证=${m5.verify} DNS=${m5.dns} | M6 团队=${m6} | M7 账号 邮箱=${m7.email} WA=${m7.wa}`)

  if (REPORT.errors.length > 0) {
    log(`=== 存在 ${REPORT.errors.length} 项失败 ===`)
    REPORT.errors.forEach((item) => log('FAIL:', item))
    process.exitCode = 1
  } else {
    log('=== 打包版高级功能全部验证通过 ===')
  }
  REPORT.finishedAt = new Date().toISOString(); REPORT.stderr = stderr.slice(0, 200)
  fs.writeFileSync(path.join(__dirname, '..', 'tests', 'packaged-premium-report.json'), JSON.stringify(REPORT, null, 2))
  log('=== 报告已保存 tests/packaged-premium-report.json ===')
  console.log(JSON.stringify(REPORT, null, 2))
  await wait(5000)
  try { execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' }) } catch {}
}

main().catch((e) => { console.error('FATAL', e.message); try { execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' }) } catch {}; process.exit(1) })
