const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P1-2（缺口6）：LinkedIn 破冰文案真 LLM 化。
// readProfile 依赖真实浏览器会话，mock-only 套件覆盖：
//  1. 静态模板兜底的确定性输出（诚实措辞，无自动 Connect 诱导）
//  2. icebreakerProvider 注入后 readProfile 内容选择逻辑通过静态检查固化
//     （provider 执行路径由 tsc 类型链与 email-differentiation 同款模式保障）

const mod = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'agents', 'linkedin-agent.js'),
)

const mkTask = {
  id: 't1',
  leadId: 0,
  company: 'Acme GmbH',
  website: 'https://acme.de',
  linkedinUrl: 'https://linkedin.com/in/john',
  createdAt: 0,
  priority: 0,
}

test('P1-2: 模板兜底包含 Profile 实际提取内容且措辞无自动触达诱导', () => {
  const copy = mod.buildIcebreakerTemplate(mkTask, {
    name: 'John Miller',
    headline: 'Head of Procurement',
    industry: 'Automotive',
  })
  assert.match(copy, /John Miller/, '使用真实姓名')
  assert.match(copy, /Head of Procurement/, '使用真实职位')
  assert.match(copy, /Acme GmbH/, '使用公司名')
  assert.doesNotMatch(copy, /automatically|auto-connect|已自动发送|已发送好友申请/i, '不得暗示自动触达')
  assert.doesNotMatch(copy, /Would love to connect/i, '历史夸大措辞不得回归')
})

test('P1-2: 缺失字段时的降级默认值', () => {
  const copy = mod.buildIcebreakerTemplate({ ...mkTask, company: '' }, {})
  assert.match(copy, /there/, '姓名缺省降级')
  assert.match(copy, /professional/, '职位缺省降级')
})

test('P1-2: LinkedinAgent 构造函数接受 icebreakerProvider（注入面存在）', () => {
  const agent = new mod.LinkedinAgent(
    {
      dailyLimit: 5,
      sessionPath: '.tmp-icebreaker-test',
      icebreakerProvider: async (task, profile) => `Hi ${profile.name}, noticed your work at ${task.company}.`,
    },
    {
      agentId: 'agent-linkedin',
      agentType: 'linkedin',
      status: 'idle',
      dailyUsed: 0,
      dailyLimit: 5,
      completedCount: 0,
      failedCount: 0,
      progress: 0,
    },
  )
  assert.ok(agent, '带 provider 的构造不抛错')
  assert.equal(agent.getSessionState(), 'disconnected', '只读边界：初始未连接，不主动触碰平台')
})
