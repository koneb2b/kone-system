const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// N-1 / N-2 回归防护（2026-11-03 评审发现的两个 P1 缺陷）：
//
// N-1 completedCount 双重递增：三个 Agent 类内部与编排层（agent-service）共享同一
//     SalesAgentState 对象引用，成功一次计两次 —— WhatsApp delivered 甚至 +2 /
//     pending +1 不一致，进度公式 (completed+failed)/total 可超 100%。
//     修复：Agent 类内不再递增 completedCount，编排层为唯一计数点。
//
// N-2 rate_limited 不中止批次：WhatsApp 命中限流后 sessionState='rate_limited'，
//     但 SalesAgentState.status 不变，下一目标自动 reconnect 继续发送（违反宪法
//     "限流时必须进入 paused 或 error"）。修复：编排层检测限流 → 置 status='error'
//     + 诚实 errorMessage + 中止本轮剩余目标。

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const whatsappAgentSrc = read('electron/services/agents/whatsapp-agent.ts')
const linkedinAgentSrc = read('electron/services/agents/linkedin-agent.ts')
const emailAgentSrc = read('electron/services/agents/email-agent.ts')
const agentServiceSrc = read('electron/services/agent-service.ts')

// ── N-1: Agent 类内不得递增 completedCount（编排层是唯一计数点）─────────

test('N-1: whatsapp-agent 类内不得递增 completedCount（编排层单点计数）', () => {
  // 类内递增的两种历史形态：无条件递增 / delivered 条件递增
  assert.doesNotMatch(
    whatsappAgentSrc,
    /this\.state\.completedCount\s*\+=/,
    'whatsapp-agent.ts 类内不得出现 this.state.completedCount += —— 计数归编排层',
  )
  // 编排层 WhatsApp 成功分支保留单点计数
  assert.match(agentServiceSrc, /agent\.completedCount \+= 1/, 'agent-service.ts 必须保留编排层唯一计数点')
})

test('N-1: linkedin-agent 类内不得递增 completedCount', () => {
  assert.doesNotMatch(
    linkedinAgentSrc,
    /this\.state\.completedCount\s*\+=/,
    'linkedin-agent.ts 类内不得出现 completedCount 递增 —— 曾与 agent-service.ts:837 双计',
  )
})

test('N-1: email-agent 类内不得递增 completedCount', () => {
  assert.doesNotMatch(
    emailAgentSrc,
    /this\.state\.completedCount\s*\+=/,
    'email-agent.ts 类内不得出现 completedCount 递增 —— 曾与 agent-service.ts:944 双计',
  )
})

test('N-1: dailyUsed 仍由 Agent 类内单点递增（限额语义不被误删）', () => {
  for (const [name, src] of [
    ['whatsapp', whatsappAgentSrc],
    ['linkedin', linkedinAgentSrc],
    ['email', emailAgentSrc],
  ]) {
    assert.match(src, /this\.state\.dailyUsed \+= 1/, `${name}-agent.ts 必须保留 dailyUsed 递增（限额口径）`)
  }
  // 编排层不得递增 dailyUsed（避免限额双计）
  assert.doesNotMatch(
    agentServiceSrc,
    /agent\.dailyUsed \+= 1/,
    'agent-service.ts 编排层不得递增 dailyUsed —— 限额口径归 Agent 类内单点',
  )
})

// ── N-2: rate_limited 必须中止批次并置 error ──────────────────────────

test('N-2: WhatsApp 命中限流后编排层必须置 error 并中止批次', () => {
  // 修复后的编排逻辑：失败分支内检测 getSessionState()==='rate_limited'
  assert.match(agentServiceSrc, /getSessionState\(\) === 'rate_limited'/, '编排层必须在失败分支检测限流状态')
  // 置 error + 诚实 errorMessage + 中止（break）
  const rateLimitBlock = agentServiceSrc.match(
    /if \(instance\.getSessionState\(\) === 'rate_limited'\) \{[\s\S]*?\n\s*\}/,
  )
  assert.ok(rateLimitBlock, '限流处理块必须存在')
  assert.match(rateLimitBlock[0], /agent\.status = 'error'/, '限流必须置 status=error（不得继续 running）')
  assert.match(rateLimitBlock[0], /rate limited/i, 'errorMessage 必须如实说明限流')
  assert.match(rateLimitBlock[0], /\bbreak\b/, '限流必须中止本轮剩余目标')
})

test('N-2: whatsapp-agent 的 rate_limited 状态仍由真实 DOM 检测写入（不得删状态机）', () => {
  assert.match(whatsappAgentSrc, /'rate_limited'/, 'sessionState 状态机必须保留 rate_limited')
  assert.match(whatsappAgentSrc, /qr_ready|expired/, '会话状态机完整性（release-gate A2 判据）')
})

test('N-2: 编排层错误状态可见（emitAgentStatus 必须在限流块内被调用）', () => {
  const rateLimitBlock = agentServiceSrc.match(
    /if \(instance\.getSessionState\(\) === 'rate_limited'\) \{[\s\S]*?\n\s*\}/,
  )
  assert.match(rateLimitBlock[0], /emitAgentStatus\(agent\)/, '限流置 error 后必须即时推送状态变更')
})
