const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P0-1 差异化邮件触达闭环（G1 核心卖点缺口）：executeSequence 内容来源优先级
//   1. task.aiEmail（AI 定制开发信，Stage0 消费）
//   2. config.emailContentProvider（LLM 实时生成）
//   3. 阶段模板兜底
// 通过替换实例 sendEmail 捕获实际投递内容，不发起真实 SMTP。

const { EmailAgent } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'agents', 'email-agent.js'),
)

const makeAgent = (provider) => {
  const agent = new EmailAgent(
    {
      smtpHost: 'smtp.test.local',
      smtpPort: 587,
      smtpUser: 'tester@test.local',
      smtpPass: 'irrelevant',
      senderEmail: 'tester@test.local',
      dailyLimit: 10,
      emailContentProvider: provider,
    },
    {
      agentId: 'agent-email',
      label: 'Email',
      agentType: 'email',
      status: 'idle',
      dailyUsed: 0,
      dailyLimit: 10,
      completedCount: 0,
      failedCount: 0,
      progress: 0,
    },
  )
  // 捕获投递内容而不真实发送
  const sent = []
  agent.sendEmail = async (task, subject, body) => {
    sent.push({ subject, body })
    return { success: true, messageId: 'mock-1' }
  }
  return { agent, sent }
}

const mkTask = (overrides = {}) => ({
  id: 'task-1',
  leadId: 0,
  company: 'Acme GmbH',
  website: 'https://acme.de',
  email: 'john@acme.de',
  createdAt: Date.now(),
  priority: 80,
  ...overrides,
})

test('P0-1: task.aiEmail 优先消费 —— Stage0 投递 AI 定制开发信', async () => {
  const { agent, sent } = makeAgent(undefined)
  const task = mkTask({
    aiEmail: {
      subject: 'Acme battery distribution in Europe — quick question',
      body: 'Hi John, saw Acme exports golf cart batteries since 1998...',
    },
  })
  await agent.executeSequence(task, 0)
  assert.equal(sent.length, 1)
  assert.match(sent[0].subject, /Acme battery distribution/, '必须投递 AI 定制主题而非模板')
  assert.match(sent[0].body, /John/, '正文必须含个性化内容')
  assert.ok(agent.getLogs().some((l) => l.event === 'email_content_source' && l.detail?.includes('ai_pitch')))
})

test('P0-1: 无 aiEmail 时 LLM provider 实时生成被消费', async () => {
  const { agent, sent } = makeAgent(async (task, stage) => ({
    subject: `Custom pitch for ${task.company} (stage ${stage})`,
    body: 'Dynamically generated 150-word personalized outreach grounded in company signals.',
  }))
  await agent.executeSequence(mkTask(), 1)
  assert.equal(sent.length, 1)
  assert.match(sent[0].subject, /Custom pitch for Acme GmbH \(stage 1\)/, 'LLM 生成内容必须被消费')
  assert.ok(agent.getLogs().some((l) => l.event === 'email_content_source' && l.detail?.includes('ai_generated')))
})

test('P0-1: provider 失败/返回 null → 模板兜底，序列不中断', async () => {
  for (const brokenProvider of [
    async () => null,
    async () => {
      throw new Error('LLM unreachable')
    },
  ]) {
    const { agent, sent } = makeAgent(brokenProvider)
    const result = await agent.executeSequence(mkTask(), 0)
    assert.equal(result.success, true, '内容层失败不得中断发送链路')
    assert.equal(sent.length, 1)
    assert.match(sent[0].subject, /Partnership opportunity with Acme GmbH/, '必须降级到阶段模板')
    assert.ok(agent.getLogs().some((l) => l.event === 'email_content_source' && l.detail?.includes('template')))
  }
})

test('P0-1: 未注入 provider 且无 aiEmail → 直接模板兜底（向后兼容）', async () => {
  const { agent, sent } = makeAgent(undefined)
  const result = await agent.executeSequence(mkTask(), 3)
  assert.equal(result.success, true)
  assert.match(sent[0].subject, /Final note - Acme GmbH/)
  assert.ok(agent.getLogs().some((l) => l.event === 'email_content_source' && l.detail?.includes('template')))
})

test('P0-1: Stage1-3 不消费 task.aiEmail（首封专用，跟进走生成/模板）', async () => {
  const { agent, sent } = makeAgent(async () => ({ subject: 'Generated follow-up', body: 'Generated body' }))
  const task = mkTask({ aiEmail: { subject: 'Initial pitch subject', body: 'Initial pitch body' } })
  await agent.executeSequence(task, 1)
  assert.equal(sent[0].subject, 'Generated follow-up', 'aiEmail 仅限 Stage0 首封')
})
