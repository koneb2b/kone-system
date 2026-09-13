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
    ws.onerror = (e) => reject(new Error('WS error'))
  })
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error('页面异常: ' + JSON.stringify(result.exceptionDetails).slice(0, 300))
  }
  return result.result.value
}

async function main() {
  const target = await findAppTarget()
  const cdp = await connectCdp(target.webSocketDebuggerUrl)

  const sleep = 'new Promise(r => setTimeout(r, ARG))'
  const stage = await evaluate(cdp, `(() => ({ stage: document.querySelector('[data-stage]')?.getAttribute('data-stage') || '', text: (document.body?.innerText||'').slice(0,240) }))()`)
  console.log('STAGE:', JSON.stringify(stage))

  // 进入系统设置
  await evaluate(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('系统设置')); b?.click(); return !!b })()`)
  await evaluate(cdp, sleep.replace('ARG', '1500'))
  await evaluate(cdp, `(() => { const tabs=[...document.querySelectorAll('[role="tab"]')]; const t=tabs.find(x=>(x.textContent||'').includes('基础配置')); t?.click(); return tabs.length })()`)
  await evaluate(cdp, sleep.replace('ARG', '800'))

  // 枚举密钥输入框并填写 LLM key
  const fill = await evaluate(cdp, `(() => {
    const inputs = [...document.querySelectorAll('input')]
    const info = inputs.map(i => ({ type: i.type, ph: i.placeholder || '' }))
    const keyInput = inputs.find(el => el.type === 'password') || inputs.find(el => /key|密钥/i.test(el.placeholder || ''))
    if (!keyInput) return { ok: false, info }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(keyInput, 'sk-dev-probe-1234567890abcdef')
    keyInput.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true, ph: keyInput.placeholder }
  })()`)
  console.log('FILL:', JSON.stringify(fill))
  if (!fill.ok) throw new Error('未找到密钥输入框: ' + JSON.stringify(fill.info))

  // 保存
  const save = await evaluate(cdp, `(() => {
    const b=[...document.querySelectorAll('button')].find(x=>/^(保存|保存配置|保存密钥|保存设置)/.test((x.textContent||'').trim()))
    if (!b) return { ok:false, buttons:[...document.querySelectorAll('button')].map(x=>(x.textContent||'').trim()).filter(Boolean).slice(0,40) }
    b.click(); return { ok: true, label: (b.textContent||'').trim() }
  })()`)
  console.log('SAVE:', JSON.stringify(save))
  if (!save.ok) throw new Error('未找到保存按钮: ' + JSON.stringify(save.buttons))

  await evaluate(cdp, sleep.replace('ARG', '2500'))
  const toast = await evaluate(cdp, `(() => {
    const t = document.body?.innerText || ''
    const toasts = [...document.querySelectorAll('[role="status"], li')].map(x=>(x.textContent||'').trim()).filter(s => /保存|成功|失败|错误/.test(s)).slice(0,5)
    return { toasts, hasKeyEcho: t.includes('已保存自定义密钥') }
  })()`)
  console.log('TOAST:', JSON.stringify(toast))
  await evaluate(cdp, `void 0`)
  fs.mkdirSync('.sisyphus/evidence', { recursive: true })
  // 原生 CDP 无 screenshot，页面状态以文本+落盘文件为证
  cdp.close()
}

main().then(() => { console.log('PROBE DONE'); process.exit(0) }).catch((e) => { console.error('PROBE FAIL:', e.message); process.exit(1) })
