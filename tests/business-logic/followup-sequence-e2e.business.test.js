const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')

/* S5b 守护测试：跟进序列端到端 + S5a 买家证据贯通盲区。
 *
 * ## 为什么需要
 * 1. **盲区（真实缺陷）**：S5a 的 `AgentTask.buyerEvidence` 在
 *    「队列 → 暂存（StagedTarget） → 发送任务」两级映射中被丢弃 ——
 *    单测只覆盖队列层与 provider 层，**中间接线无人验证**，导致差异化首封
 *    在真实流程中退化为模板。本测试直接断言该链路。
 * 2. **状态机闭环**：`followup-scheduler.ts` 的纯函数此前有覆盖，但真正驱动序列的
 *    `runFollowupTick`（回复停止 / IMAP 缺失挂起 / IMAP 报错延后 / 正常推进 /
 *    窗口外重试）**零覆盖**。
 *
 * ## 手法
 * - electron 模块打桩（沿用 `agent-prompt-knowledge` 的成熟做法）；
 * - 打桩 **`EmailAgent.prototype`**：测试与 agent-service 共享同一类对象（Node 模块缓存），
 *   故原型打桩能作用于 agent-service 内部创建的实例 —— **无需为测试新增产品代码缝**。
 */

const TMP_USER_DATA = path.join(process.cwd(), '.tmp-followup-e2e-user-data')
const originalLoad = Module._load
const electronMock = {
  app: { isPackaged: false, name: 'Kone AI', getPath: () => TMP_USER_DATA },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (v) => Buffer.from(String(v), 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8'),
  },
}
Module._load = (request, parent, isMain) => {
  if (request === 'electron') return electronMock
  return originalLoad.call(this, request, parent, isMain)
}

const DIST = path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services')
const agentService = require(path.join(DIST, 'agent-service.js'))
const pipeline = require(path.join(DIST, 'agent-pipeline.js'))
const followup = require(path.join(DIST, 'followup-scheduler.js'))
const { EmailAgent } = require(path.join(DIST, 'agents', 'email-agent.js'))

const { runFollowupTick, stageAgentsFromPipeline, consumeStagedTargets, getAgentStatus } = agentService
const { createPlan, upsertPlan, readPlans } = followup
const FOLLOWUP_TICK_INTERVAL_MS = 60 * 60 * 1000

/* ── 打桩 EmailAgent.prototype（共享类对象 → 作用于内部实例） ── */
const proto = EmailAgent.prototype
const originalMethods = {
  connect: proto.connect,
  disconnect: proto.disconnect,
  checkReply: proto.checkReply,
  executeSequence: proto.executeSequence,
}
let seqCalls = []

const stubEmailAgent = ({
  connected = true,
  reply = { configured: true, replied: false },
  seqResult = { success: true },
} = {}) => {
  seqCalls = []
  proto.connect = async () => connected
  proto.disconnect = async () => {}
  proto.checkReply = async () => reply
  proto.executeSequence = async (task, stage) => {
    seqCalls.push({ task, stage })
    return seqResult
  }
}
test.after(() => Object.assign(proto, originalMethods))

/* ── store mock（真 KV） ── */
const mkStore = (initial = {}) => {
  const map = new Map(Object.entries(initial))
  return {
    get: (k) => map.get(k),
    set: (k, v) => map.set(k, v),
  }
}

const SMTP_CONFIG = {
  user_config: {
    accounts: {
      email: {
        smtpHost: 'smtp.test.local',
        smtpPort: 587,
        smtpUser: 'sender@test.local',
        smtpPass: 'pw',
        senderEmail: 'sender@test.local',
      },
    },
  },
}

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000
/** 造一个「已到期」的计划（stage 0，nextSendAt 在过去）。 */
const duePlan = (overrides = {}) => ({
  ...createPlan('ACME GmbH', 'buyer@acme.example', NOW - 10 * DAY, 'lead-key-1', 'DE'),
  nextSendAt: NOW - DAY,
  ...overrides,
})

/* ── A. 无到期计划 → 零副作用 ── */

test('S5b: 无到期计划时 tick 直接返回，不触发任何发送', async () => {
  stubEmailAgent()
  const store = mkStore({ ...SMTP_CONFIG, followup_plans: [] })
  await runFollowupTick(store, NOW)
  assert.equal(seqCalls.length, 0, '不应有任何发送')
})

test('S5b: 计划未到期时 tick 不发送（时间门禁）', async () => {
  stubEmailAgent()
  const store = mkStore({
    ...SMTP_CONFIG,
    followup_plans: [duePlan({ nextSendAt: NOW + DAY })],
  })
  await runFollowupTick(store, NOW)
  assert.equal(seqCalls.length, 0, '未到期不得发送')
})

/* ── B. 已回复 → 序列终止（最高优先级） ── */

test('S5b: 检测到回复 → 序列立即终止且**不发送**', async () => {
  stubEmailAgent({ reply: { configured: true, replied: true } })
  const store = mkStore({ ...SMTP_CONFIG, followup_plans: [duePlan()] })
  await runFollowupTick(store, NOW)

  const plan = readPlans(store)[0]
  assert.equal(plan.done, true, '回复后计划必须终止')
  assert.equal(plan.repliedAt, NOW, '记录回复时间')
  assert.equal(seqCalls.length, 0, '已回复的线索绝不能继续发送')
  assert.equal(getAgentStatus('lead-key-1')?.emailSequenceStage, 0, '回写真实 stage（0）')
})

/* ── C. IMAP 未配置 → 人工挂起（绝不盲推） ── */

test('S5b: IMAP 未配置 → 计划挂起待人工确认，**绝不盲推**', async () => {
  stubEmailAgent({ reply: { configured: false, replied: false } })
  const store = mkStore({ ...SMTP_CONFIG, followup_plans: [duePlan()] })
  await runFollowupTick(store, NOW)

  const plan = readPlans(store)[0]
  assert.equal(plan.pendingManual, true, '回复检测盲区必须挂起')
  assert.equal(plan.done, false, '挂起 ≠ 终止')
  assert.equal(seqCalls.length, 0, '盲区下绝不发送')
  assert.equal(getAgentStatus('lead-key-1')?.emailPendingManual, true, '回写待人工标记（UI 可见）')
})

/* ── D. IMAP 真实报错 → 延后一轮（不消耗阶段） ── */

test('S5b: IMAP 报错 → 延后一个间隔且不发送、不推进阶段', async () => {
  stubEmailAgent({ reply: { configured: true, replied: false, error: 'imap down' } })
  const store = mkStore({ ...SMTP_CONFIG, followup_plans: [duePlan()] })
  await runFollowupTick(store, NOW)

  const plan = readPlans(store)[0]
  assert.equal(seqCalls.length, 0, '报错不得盲发')
  assert.equal(plan.stage, 0, '阶段不推进')
  assert.ok(plan.nextSendAt > NOW, '延后到未来')
  assert.notEqual(plan.pendingManual, true, '真实报错走延后，而非人工挂起')
})

/* ── E. 正常 → 发送下一阶段 + 推进 + 回写真实 stage + 证据连续性 ── */

test('S5b: 未回复 → 发送下一阶段、推进计划并回写**真实** stage', async () => {
  stubEmailAgent({ reply: { configured: true, replied: false }, seqResult: { success: true } })
  const store = mkStore({
    ...SMTP_CONFIG,
    followup_plans: [duePlan({ buyerEvidence: ['New production line announced in 2026'] })],
  })
  await runFollowupTick(store, NOW)

  assert.equal(seqCalls.length, 1, '应发送一次')
  assert.equal(seqCalls[0].stage, 1, '发送的是下一阶段（stage 1）')
  const plan = readPlans(store)[0]
  assert.equal(plan.stage, 1, '计划推进到 1')
  assert.equal(plan.done, false)
  assert.ok(plan.nextSendAt > NOW, '下一轮时间已顺延')
  assert.equal(getAgentStatus('lead-key-1')?.emailSequenceStage, 1, '回写真实 stage（1，而非首封的 0）')
  /* S5b 证据连续性：跟进轮次沿用首封的买家证据 */
  assert.deepEqual(seqCalls[0].task.buyerEvidence, ['New production line announced in 2026'])
})

/* ── F. 收件人窗口外 → 短周期重试，不消耗轮次 ── */

test('S5b: 收件人发送窗口外 → 短周期重试且**不消耗阶段**', async () => {
  stubEmailAgent({
    reply: { configured: true, replied: false },
    seqResult: { success: false, error: 'outside_recipient_send_window' },
  })
  const store = mkStore({ ...SMTP_CONFIG, followup_plans: [duePlan()] })
  await runFollowupTick(store, NOW)

  const plan = readPlans(store)[0]
  assert.equal(plan.stage, 0, '窗口外不得消耗阶段')
  assert.equal(plan.done, false)
  assert.equal(plan.nextSendAt, NOW + FOLLOWUP_TICK_INTERVAL_MS, '短周期（1 小时）后重试')
})

/* ── G. 盲区守护：管道 → 暂存 的 buyerEvidence 贯通 ── */

test('S5b 盲区守护: buyerEvidence 必须穿过「队列 → 暂存」不丢字段', () => {
  const queue = pipeline.buildAgentTaskQueue([
    {
      id: 'lead-uuid-9',
      company: 'ACME GmbH',
      website: 'https://acme.example',
      email: 'buyer@acme.example',
      matchScore: 82,
      snippet: 'Distributor of industrial valves in Germany',
      matchReasons: ['Importer profile matches ICP'],
      opportunityScore: {
        icpFit: 40,
        intent: 25,
        evidence: 5,
        riskPenalty: 0,
        finalScore: 70,
        rationale: { intent: 'New production line announced' },
      },
    },
  ])
  assert.equal(queue.email.length, 1)
  const staged = pipeline && queue.email[0].buyerEvidence
  assert.ok(staged && staged.length > 0, '队列层必须带证据')

  const store = mkStore(SMTP_CONFIG)
  stageAgentsFromPipeline(queue, { send: () => {}, isDestroyed: () => false }, store)
  const targets = consumeStagedTargets('agent-email')
  assert.equal(targets.length, 1, '目标应被暂存')
  assert.ok(Array.isArray(targets[0].buyerEvidence), '暂存层必须保留 buyerEvidence')
  assert.deepEqual(targets[0].buyerEvidence, queue.email[0].buyerEvidence, '两级映射后证据必须逐字一致')
})

/* ── H. 最后一跳（暂存 → 发送任务）源码结构断言 ── */

test('S5b 盲区守护: executeEmailAgent 必须把 buyerEvidence 下传进发送任务', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'services', 'agent-service.ts'), 'utf8')
  /* 剥离注释行，避免被说明性注释误触发（项目既有教训） */
  const code = src
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
  assert.match(code, /buyerEvidence:\s*target\.buyerEvidence/, '发送任务必须携带 buyerEvidence')
})
