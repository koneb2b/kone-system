const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

/* S5a「策略质量」守护测试：
 *  A. 差异化首封 —— 买家证据抽取（`buildBuyerEvidence`）与 prompt 注入；
 *  B. 质量度量 —— 首封「引用证据率」（`measureEvidenceCitation`）。
 *
 * 变异验证（手工复核点）：
 *  - 若 `buildBuyerEvidence` 不再截断/去重/封顶 → 对应用例判红；
 *  - 若 `measureEvidenceCitation` 恒返回 0 → 「引用命中」用例判红；
 *  - 若 prompt 漏拼 `[BUYER EVIDENCE]` 块 → 端到端注入用例判红。
 */

const TMP_USER_DATA = path.join(process.cwd(), '.tmp-outreach-quality-user-data')
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

const quality = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'agents', 'outreach-quality.js'),
)
const pipeline = require(path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'agent-pipeline.js'))
const { createLlmEmailContentProvider } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'agent-service.js'),
)

const {
  buildBuyerEvidence,
  measureEvidenceCitation,
  tokenizeForCitation,
  BUYER_EVIDENCE_MAX_ITEMS,
  BUYER_EVIDENCE_MAX_LEN,
} = quality

/* ── A1. 证据抽取：优先级 / 去重 / 截断 / 封顶 ── */

test('S5a: buildBuyerEvidence 按优先级抽取真实字段并去重', () => {
  const evidence = buildBuyerEvidence({
    snippet: 'Distributor of industrial pumps across Bavaria',
    matchReasons: ['Importer profile matches ICP', 'importer profile matches icp'],
    salesStrategy: 'Lead with the certification angle',
    opportunityScore: {
      rationale: {
        icpFit: 'Website lists our exact product category',
        intent: 'Tender published 2026-Q3',
        evidence: 'RFQ page mentions expansion',
        riskPenalty: 'info@ only',
      },
    },
  })
  assert.deepEqual(evidence, [
    'Tender published 2026-Q3',
    'Website lists our exact product category',
    'Importer profile matches ICP',
    'RFQ page mentions expansion',
  ])
  assert.ok(!evidence.some((item) => /info@ only/.test(item)), 'riskPenalty 是风险信号，不得进入外发首封证据')
})

test('S5a: buildBuyerEvidence 缺失/空输入 → 空数组（不臆造、不用占位符）', () => {
  assert.deepEqual(buildBuyerEvidence(null), [])
  assert.deepEqual(buildBuyerEvidence(undefined), [])
  assert.deepEqual(buildBuyerEvidence({}), [])
  assert.deepEqual(buildBuyerEvidence({ matchReasons: ['', '   '], snippet: '  ' }), [])
})

test('S5a: buildBuyerEvidence 条数封顶与单条截断', () => {
  const many = Array.from({ length: 9 }, (_, i) => `signal number ${i} about the buyer`)
  assert.equal(buildBuyerEvidence({ matchReasons: many }).length, BUYER_EVIDENCE_MAX_ITEMS, '条数封顶')

  const long = 'a'.repeat(BUYER_EVIDENCE_MAX_LEN + 50)
  const evidence = buildBuyerEvidence({ snippet: long })
  assert.equal(evidence.length, 1)
  assert.equal(evidence[0].length, BUYER_EVIDENCE_MAX_LEN, '超长截断到上限')
  assert.ok(evidence[0].endsWith('…'))
})

/* ── A2. 管道贯通：SearchExecuteResult → AgentTask.buyerEvidence ── */

test('S5a: buildAgentTaskQueue 把买家证据带上任务（端到端）', () => {
  const queue = pipeline.buildAgentTaskQueue([
    {
      id: 'lead-uuid-1',
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
  assert.equal(queue.email.length, 1, '合格线索应入邮件队列')
  const task = queue.email[0]
  assert.ok(Array.isArray(task.buyerEvidence), 'buyerEvidence 必须是数组')
  assert.ok(task.buyerEvidence.length > 0, '证据必须被带上（否则首封无从引用）')
  assert.ok(
    task.buyerEvidence.includes('New production line announced'),
    'S4b 机会分依据必须成为买家证据（S4b → S5a 贯通）',
  )
})

/* ── B1. 引用率度量 ── */

test('S5a: measureEvidenceCitation 无证据 → 全 0（不臆造分母）', () => {
  assert.deepEqual(measureEvidenceCitation('Any body', []), { total: 0, cited: 0, rate: 0, citedItems: [] })
  assert.deepEqual(measureEvidenceCitation('Any body', null), { total: 0, cited: 0, rate: 0, citedItems: [] })
})

test('S5a: measureEvidenceCitation 命中引用的证据被正确计入（改写也算）', () => {
  const evidence = ['Distributor of industrial valves across Bavaria', 'New production line announced in 2026']
  const body =
    'Hi ACME team,\n\nWe saw that you distribute industrial valves across Bavaria and noticed the ' +
    'new production line announced for 2026. That expansion is exactly where we help.\n\nKone Agent'
  const result = measureEvidenceCitation(body, evidence)
  assert.equal(result.total, 2)
  assert.equal(result.cited, 2, '两条证据的实词均被正文覆盖')
  assert.equal(result.rate, 1)
  assert.equal(result.citedItems.length, 2)
})

test('S5a: measureEvidenceCitation 未引用的证据不计入（正文空洞模板 → 低引用率）', () => {
  const evidence = ['Distributor of industrial valves across Bavaria', 'New production line announced in 2026']
  const body = 'Hi ACME team,\n\nWe would like to explore potential collaboration opportunities.\n\nKone Agent'
  const result = measureEvidenceCitation(body, evidence)
  assert.equal(result.total, 2)
  assert.equal(result.cited, 0, '模板空洞正文不应被判为引用证据')
  assert.equal(result.rate, 0)
})

test('S5a: tokenizeForCitation 过滤虚词与短词，中文走 2-gram', () => {
  const tokens = tokenizeForCitation('The distributor with your valves is here')
  assert.ok(!tokens.includes('the'), '虚词被过滤')
  assert.ok(!tokens.includes('with'), '虚词被过滤')
  assert.ok(tokens.includes('distributor'), '实词保留')
  assert.ok(tokens.includes('valves'), '实词保留')
  const cn = tokenizeForCitation('自有工厂产能充足')
  assert.deepEqual(cn, ['自有', '有工', '工厂', '厂产', '产能', '能充', '充足'])
})

/* ── A3. 端到端：买家证据真的进入发给 LLM 的 prompt ── */

let captured = []
const realFetch = globalThis.fetch
const installFetchSpy = () => {
  captured = []
  globalThis.fetch = async (url, init) => {
    let body
    try {
      body = JSON.parse(init?.body)
    } catch {
      body = null
    }
    captured.push({ url: String(url), body })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ subject: 'Probe subject', body: 'Probe body' }) } }],
      }),
    }
  }
}
test.after(() => {
  globalThis.fetch = realFetch
})

const mkStore = () => ({
  get: (key) =>
    key === 'user_config'
      ? {
          llmApiKey: 'test-llm-key',
          providers: [{ id: 'llm', baseUrl: 'https://llm.test.local/v1' }],
          selectedModel: 'gpt-4',
        }
      : undefined,
})

test('S5a: 买家证据必须真的进入发给 LLM 的 user prompt，并要求引用', async () => {
  installFetchSpy()
  const provider = createLlmEmailContentProvider(mkStore())
  await provider(
    {
      company: 'ACME GmbH',
      website: 'https://acme.example',
      buyerEvidence: ['New production line announced in 2026', 'Distributor of industrial valves in Bavaria'],
    },
    0,
  )

  assert.equal(captured.length, 1, '应发起一次 LLM 请求')
  const messages = captured[0].body.messages
  const user = messages.find((m) => m.role === 'user')?.content || ''
  const system = messages.find((m) => m.role === 'system')?.content || ''

  assert.match(user, /\[BUYER EVIDENCE\]/, 'user prompt 必须含买家证据标记块')
  assert.match(user, /New production line announced in 2026/, '证据**原文**必须真的进入 prompt')
  assert.match(system, /BUYER EVIDENCE lists verified facts/i, 'system prompt 必须声明证据来源')
  assert.match(system, /references at least one/i, '必须要求首封引用至少一条证据')
  assert.match(system, /Do not invent any buyer fact/i, '必须禁止编造买家事实')
})

test('S5a: 无买家证据时不出现证据块，且走「禁止编造买家事实」的诚实降级', async () => {
  installFetchSpy()
  const provider = createLlmEmailContentProvider(mkStore())
  await provider({ company: 'ACME GmbH', website: '' }, 0)

  const messages = captured[0].body.messages
  const user = messages.find((m) => m.role === 'user')?.content || ''
  const system = messages.find((m) => m.role === 'system')?.content || ''

  assert.ok(!/\[BUYER EVIDENCE\]/.test(user), '无证据时不得出现证据块')
  assert.match(system, /do NOT invent buyer facts/i, '必须注入诚实降级规则')
})
