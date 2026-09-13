const fs = require('fs')

const debugPort = process.env.KONE_DEV_DEBUG_PORT || '9335'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function findAppTarget() {
  const started = Date.now()
  while (Date.now() - started < 60000) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await res.json()
      const app = targets.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:5173'))
      if (app) return app
    } catch {}
    await wait(1000)
  }
  throw new Error('未找到应用页面目标')
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const mid = ++id
          pending.set(mid, { res, rej })
          ws.send(JSON.stringify({ id: mid, method, params }))
        })
      },
      close() { try { ws.close() } catch {} },
    })
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(msg.error.message))
        else res(msg.result)
      }
    }
    ws.onerror = () => reject(new Error('WS error'))
  })
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails?.exception?.description || JSON.stringify(result.exceptionDetails)
    throw new Error('页面异常: ' + desc.slice(0, 200))
  }
  return result.result.value
}

const results = {}
const record = (name, ok, detail) => {
  results[name] = { ok, detail }
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

async function main() {
  const target = await findAppTarget()
  const cdp = await connectCdp(target.webSocketDebuggerUrl)

  const sleep = (ms) => wait(ms)
  const bodyText = () => evaluate(cdp, `(document.body?.innerText||'')`)
  const bodyHas = async (t) => (await bodyText()).includes(t)
  // 轮询等待文本出现（toast 最长挂 5s，轮询 300ms）
  const waitForText = async (pattern, timeoutMs = 6000) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const text = await bodyText()
      const lines = text.split(String.fromCharCode(10))
      const idx = lines.findIndex((line) => pattern.test(line))
      if (idx >= 0) return lines.slice(idx, idx + 2).join(' | ').slice(0, 200)
      await wait(300)
    }
    return ''
  }
  const setInput = (selector, value) => evaluate(cdp, `(() => {
    const el = document.querySelector('${selector}')
    if (!el) return false
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, '${value}')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  const clickButton = (matcher) => evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('button')].find((x) => ${matcher})
    if (!b) return false
    b.click()
    return true
  })()`)

  // ── 进入 系统设置 → 基础配置 ──
  await evaluate(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('系统设置')); b?.click(); return !!b })()`)
  await sleep(1500)
  await evaluate(cdp, `(() => { const t=[...document.querySelectorAll('[role="tab"]')].find(x=>(x.textContent||'').includes('基础配置')); t?.click(); return !!t })()`)
  await sleep(800)
  let ready = false
  for (let i = 0; i < 30 && !ready; i++) {
    ready = await evaluate(cdp, `(() => Boolean(document.querySelector('#llm-key')))()`)
    if (!ready) await sleep(500)
  }
  if (!ready) throw new Error('设置页输入框未就绪')

  // 场景 E：清空密钥输入后点保存 → 必须有明确提示
  await setInput('#llm-key', '')
  await sleep(300)
  await clickButton(`(x.textContent || '').trim() === '保存密钥'`)
  const eToast = await waitForText(/请先输入 API Key/)
  record('E-保存密钥空值提示', Boolean(eToast), eToast || '6s 内未出现提示')

  // 场景 A：填 LLM key + mock baseUrl → 保存 → 回显
  await setInput('#llm-key', 'sk-mock-ok')
  await setInput('#llm-base', 'http://127.0.0.1:8787/v1')
  await sleep(400)
  await clickButton(`(x.textContent || '').trim() === '保存密钥'`)
  const aToast = await waitForText(/已保存自定义密钥|保存密钥失败/)
  record('A-保存密钥落盘', /已保存自定义密钥/.test(aToast) && !/失败/.test(aToast), aToast || '未出现回显')

  // 场景 B：识别模型（已保存正确 key）→ 模型下拉填充
  await clickButton(`(x.textContent || '').includes('识别模型')`)
  let options = []
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    options = await evaluate(cdp, `[...document.querySelectorAll('select option')].map(o => o.textContent.trim()).filter(Boolean)`)
    if (options.length > 1) break
  }
  const bOk = options.some((m) => /gpt-4o-mini/.test(m))
  record('B-识别模型正路径', bOk, JSON.stringify(options.slice(0, 4)))

  // 场景 C：错误 key 识别 → 中文“密钥无效或未授权”
  await setInput('#llm-key', 'sk-wrong-key')
  await sleep(300)
  await clickButton(`(x.textContent || '').includes('识别模型')`)
  const cToast = await waitForText(/密钥无效或未授权|无法访问|额度受限|异常状态/)
  record('C-识别模型错误key中文提示', /密钥无效或未授权/.test(cToast), cToast || '6s 内未出现中文提示')

  // 场景 D：清空 baseUrl → 识别 → 提示填 Base URL
  await setInput('#llm-base', '')
  await sleep(300)
  await clickButton(`(x.textContent || '').includes('识别模型')`)
  const dToast = await waitForText(/请先填写 LLM Base URL/)
  record('D-缺BaseURL提示', Boolean(dToast), dToast || '6s 内未出现提示')

  // 场景 F：恢复正确配置 → 测试连接 → 联通徽标 + 无失败 toast
  await setInput('#llm-base', 'http://127.0.0.1:8787/v1')
  await setInput('#llm-key', 'sk-mock-ok')
  await sleep(300)
  await clickButton(`(x.textContent || '').includes('测试连接')`)
  const fToast = await waitForText(/测试连接失败/, 2500)
  const connected = await bodyHas('已联通')
  record('F-测试连接连通', connected && !fToast, `已联通=${connected} 失败提示=${fToast || '无'}`)

  // 场景 G：协同引擎 Tab
  const switchTab = async (needle) => {
    for (let i = 0; i < 5; i++) {
      const active = await evaluate(cdp, `(() => {
        const t = [...document.querySelectorAll('[role="tab"]')].find(x => (x.textContent || '').includes('${needle}'))
        if (!t) return 'missing'
        if (t.getAttribute('data-state') !== 'active') {
          // Radix TabsTrigger 监听 mousedown 激活，纯 .click() 不生效
          t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
          t.click()
        }
        return t.getAttribute('data-state')
      })()`)
      if (active === 'active') return true
      await sleep(600)
    }
    return false
  }
  await switchTab('协同引擎')
  const gText = (await bodyText()).split(String.fromCharCode(10)).filter((l) => /协同|高级|锁定|升级/.test(l)).slice(0, 5).join(' / ')
  const gLocked = await bodyHas('该功能为高级版专属')
  console.log('G 诊断:', gText.slice(0, 160))
  if (gLocked) {
    record('G-协同引擎锁定态', true, '当前环境为非高级版，锁定页与升级 CTA 正常渲染')
  } else {
    const switchToggled = await evaluate(cdp, `(() => { const s=document.querySelector('[role="switch"]'); if(!s) return false; s.click(); return true })()`)
    await sleep(900)
    const warning = await bodyHas('尚未填写云端发送队列地址')
    record('G-协同引擎联动警示', switchToggled && warning, `switch=${switchToggled} warning=${warning}`)
  }

  // 场景 H：ICP 填写并手动保存
  await switchTab('ICP')
  await evaluate(cdp, `(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const el = document.querySelector('#icp-product') || [...document.querySelectorAll('input')][0]
    set.call(el, '高尔夫球车锂电池')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(400)
  await clickButton(`/保存 ICP 策略/.test((x.textContent || '').trim())`)
  const hToast = await waitForText(/配置已保存|保存失败/)
  record('H-ICP保存回显', /配置已保存/.test(hToast), hToast || '6s 内未出现保存结果')

  const passCount = Object.values(results).filter((r) => r.ok).length
  console.log(`=== 系统设置全场景实测：${passCount}/${Object.keys(results).length} 通过 ===`)
  fs.mkdirSync('.sisyphus/evidence', { recursive: true })
  fs.writeFileSync('.sisyphus/evidence/settings-e2e-probe.json', JSON.stringify(results, null, 2))
  cdp.close()
}

main().then(() => process.exit(0)).catch((e) => { console.error('PROBE FAIL:', e.message); process.exit(1) })
