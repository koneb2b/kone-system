const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P1-4（缺口8）：冷邮件时区感知发送窗口。
// - 已知国家：仅收件人当地时间 09:00-18:00 放行
// - 未知国家：诚实降级放行（不猜测时区）
// - EmailAgent.sendEmail 窗口外返回 outside_recipient_send_window 且不消耗日频

const windowUtil = require(path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'utils', 'send-window.js'))
const { EmailAgent } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'agents', 'email-agent.js'),
)

test('P1-4: resolveRecipientLocalHour 使用 IANA 时区换算', () => {
  // 2024-01-15 10:00 UTC → Berlin 11 点（CET, UTC+1）
  const r = windowUtil.resolveRecipientLocalHour('Germany', new Date('2024-01-15T10:00:00Z'))
  assert.equal(r.resolved, true)
  assert.equal(r.hour, 11)
})

test('P1-4: 窗口内放行、窗口外拦截（固定时间锚点）', () => {
  // Berlin 当地 11:00 → 放行
  const inside = windowUtil.isWithinSendWindow('Germany', new Date('2024-01-15T10:00:00Z'))
  assert.equal(inside.allowed, true)

  // Berlin 当地 18:30 → 拦截（窗口终点不含）
  const outside = windowUtil.isWithinSendWindow('Germany', new Date('2024-01-15T17:30:00Z'))
  assert.equal(outside.allowed, false)
  assert.match(outside.reason, /发送窗口/)

  // 09:00 整点（含起点）→ 放行
  const boundary = windowUtil.isWithinSendWindow('Germany', new Date('2024-01-15T08:00:00Z'))
  assert.equal(boundary.allowed, true)
})

test('P1-4: 未知国家不拦截（诚实降级）', () => {
  const r = windowUtil.isWithinSendWindow('Atlantis', new Date('2024-01-15T23:30:00Z'))
  assert.equal(r.resolved, false)
  assert.equal(r.allowed, true, '时区未知时不得凭空拦截')
  assert.equal(windowUtil.isWithinSendWindow(undefined).allowed, true)
})

test('P1-4: sendEmail 窗口外返回 deferred 错误且不消耗日频/不计失败', async () => {
  // 实时挑选窗口内/外的国家（跨时区地图在任意时刻必然同时存在两种）
  const candidates = ['USA', 'Germany', 'Japan', 'Australia', 'Brazil', 'India', 'UK', 'China', 'Canada', 'France']
  const outside = candidates.find((c) => {
    const r = windowUtil.isWithinSendWindow(c)
    return r.resolved && !r.allowed
  })
  const inside = candidates.find((c) => {
    const r = windowUtil.isWithinSendWindow(c)
    return r.resolved && r.allowed
  })

  const makeAgent = () => {
    const agent = new EmailAgent(
      {
        smtpHost: 'smtp.test.local',
        smtpPort: 587,
        smtpUser: 't@t.local',
        smtpPass: 'x',
        senderEmail: 't@t.local',
        dailyLimit: 10,
      },
      {
        agentId: 'agent-email',
        agentType: 'email',
        status: 'idle',
        dailyUsed: 0,
        dailyLimit: 10,
        completedCount: 0,
        failedCount: 0,
        progress: 0,
      },
    )
    // 直接注入 transporter，跳过真实 SMTP connect
    agent.transporter = { sendMail: async () => ({ messageId: 'mock-1' }) }
    return agent
  }

  const mkTask = (country) => ({
    id: 't1',
    leadId: 0,
    company: 'Acme',
    website: 'https://acme.de',
    email: 'john@acme.de',
    country,
    createdAt: Date.now(),
    priority: 0,
  })

  if (outside) {
    const agent = makeAgent()
    const result = await agent.sendEmail(mkTask(outside), 's', 'b')
    assert.equal(result.success, false, '窗口外不得发送')
    assert.equal(result.error, 'outside_recipient_send_window')
    assert.equal(agent.state.dailyUsed, 0, '延迟发送不消耗日频')
    assert.equal(agent.state.failedCount, 0, '延迟发送不计失败')
    assert.ok(agent.getLogs().some((l) => l.event === 'send_deferred_window'))
  } else {
    assert.fail('测试环境应至少找到一个窗口外国家')
  }

  if (inside) {
    const agent = makeAgent()
    // 窗口内 → 越过窗口门禁，后续走到 DNS 健康检查（t.local 无 SPF → critical 软锁）。
    // 关键断言：失败原因不再是 outside_recipient_send_window，即窗口门禁已放行。
    const result = await agent.sendEmail(mkTask(inside), 's', 'b')
    assert.notEqual(result.error, 'outside_recipient_send_window', '窗口内必须放行')
    assert.equal(agent.state.dailyUsed, 0, 'DNS 软锁路径不消耗日频')
  } else {
    assert.fail('测试环境应至少找到一个窗口内国家')
  }
})
