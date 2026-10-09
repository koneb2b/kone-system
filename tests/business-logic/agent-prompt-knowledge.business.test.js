const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

/* 知识库 → LLM prompt 端到端验证（补齐此前唯一的验证盲区）。
 *
 * ## 为什么需要这个测试
 * 知识库改造的核心价值主张是「AI 真的拿到了用户的产品资料」。但此前的覆盖有缺口：
 *   - 单测 `agent-knowledge-injection.business.test.js` 只验证
 *     `renderKnowledgePromptBlock` **返回了什么字符串**；
 *   - 视觉探针只验证 UI 卡片**渲染成什么样**（走的是 `analysis.generate` 另一条链路）。
 * **中间那段把片段拼进 system/user prompt 的代码（agent-service.ts 内）从未被验证** ——
 * 若条件写反、漏拼 knowledgeBlock、或把降级规则拼错，上述两者都发现不了，
 * 而用户会拿到一封**没有产品卖点**的开发信（正是本次改造要解决的问题）。
 *
 * ## 方法
 * mock 全局 `fetch`（`safeFetch` 直接调用它）捕获真实请求体，然后调用**产品自带的**
 * `createLlmEmailContentProvider`，断言 prompt 内容。只 mock 网络出口，其余全真实。
 */

const TMP_USER_DATA = path.join(process.cwd(), '.tmp-prompt-knowledge-user-data')
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

const AGENT_SERVICE = path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'agent-service.js')

const { createLlmEmailContentProvider, createKnowledgeWhatsAppTextBuilder } = require(AGENT_SERVICE)

/* ── 捕获网络出口 ── */
let captured = []
const realFetch = globalThis.fetch
const parseBody = (raw) => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
const installFetchSpy = () => {
  captured = []
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), body: parseBody(init?.body) })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ subject: 'Probe subject', body: 'Probe body' }) } }],
      }),
    }
  }
}
const restoreFetch = () => {
  globalThis.fetch = realFetch
}
test.after(() => restoreFetch())

/** 构造一个可用的 store（含 LLM 凭证 + 知识库）。 */
const mkStore = (knowledgeBase) => ({
  get: (key) =>
    key === 'user_config'
      ? {
          llmApiKey: 'test-llm-key',
          providers: [{ id: 'llm', baseUrl: 'https://llm.test.local/v1' }],
          selectedModel: 'gpt-4',
          knowledgeBase,
        }
      : undefined,
})

const KB_HIT = [{ id: 'k1', title: '工厂实力', content: '自有工厂 20000 平米，月产能 50 万件', tags: ['工厂实力'] }]

test('知识库注入：命中的条目正文必须真的进入发给 LLM 的 user prompt', async () => {
  installFetchSpy()
  const provider = createLlmEmailContentProvider(mkStore({ entries: KB_HIT }))
  const result = await provider({ company: 'Acme', website: 'https://acme.com' }, 0)

  assert.equal(captured.length, 1, '应发起一次 LLM 请求')
  const messages = captured[0].body.messages
  const user = messages.find((m) => m.role === 'user')?.content || ''
  const system = messages.find((m) => m.role === 'system')?.content || ''

  assert.match(user, /\[SELLER KNOWLEDGE BASE\]/, 'user prompt 必须含知识库标记块')
  assert.match(user, /自有工厂 20000 平米/, '知识库条目**正文**必须真的进入 prompt')
  assert.match(user, /工厂实力/, '条目标题必须进入 prompt')
  assert.match(system, /primary source of the seller strengths/i, 'system prompt 必须声明知识库为卖方优势来源')
  assert.ok(result && result.subject, 'provider 应返回解析后的内容')
})

test('知识库注入：无命中时 prompt 不含知识库块，且走诚实降级规则', async () => {
  installFetchSpy()
  // 条目与线索/stage 完全不相关 → no_match
  const provider = createLlmEmailContentProvider(
    mkStore({ entries: [{ id: 'x', title: '完全无关', content: 'zzzzz', tags: [] }] }),
  )
  await provider({ company: 'Acme', website: 'https://acme.com' }, 0)

  const messages = captured[0].body.messages
  const user = messages.find((m) => m.role === 'user')?.content || ''
  const system = messages.find((m) => m.role === 'system')?.content || ''

  assert.ok(!/\[SELLER KNOWLEDGE BASE\]/.test(user), '无命中时**不得**出现知识库块')
  assert.ok(!/zzzzz/.test(user), '无关条目正文绝不能进入 prompt')
  assert.match(system, /do NOT claim any specific product capability/i, '必须注入诚实降级规则（禁止编造卖点）')
})

test('知识库注入：未配置知识库时同样走诚实降级（不编造）', async () => {
  installFetchSpy()
  const provider = createLlmEmailContentProvider(mkStore(undefined))
  await provider({ company: 'Acme', website: '' }, 0)

  const system = captured[0].body.messages.find((m) => m.role === 'system')?.content || ''
  const user = captured[0].body.messages.find((m) => m.role === 'user')?.content || ''
  assert.ok(!/\[SELLER KNOWLEDGE BASE\]/.test(user), '未配置时不得有知识库块')
  assert.match(system, /do NOT claim any specific product capability/i)
})

test('知识库注入：用户自定义标签让资料进入 prompt（与检索层贯通）', async () => {
  installFetchSpy()
  // 资料只用用户自定义术语，不含任何内置标签/stage 词
  const provider = createLlmEmailContentProvider(
    mkStore({
      entries: [{ id: 'c1', title: '交期承诺', content: '我们承诺 15 天交付', tags: ['交期承诺'] }],
      customTags: ['交期承诺'],
    }),
  )
  await provider({ company: 'Acme', website: '' }, 0)

  const user = captured[0].body.messages.find((m) => m.role === 'user')?.content || ''
  assert.match(user, /\[SELLER KNOWLEDGE BASE\]/, '自定义标签命中的资料必须进入 prompt')
  assert.match(user, /我们承诺 15 天交付/, '自定义标签资料的正文必须真的进入 prompt')
})

test('知识库注入：LLM 不可用时返回 null（内容层失败不得抛出）', async () => {
  installFetchSpy()
  // 无 llmApiKey → callLlmJson 直接返回 null（不发起请求）
  const provider = createLlmEmailContentProvider({
    get: (key) =>
      key === 'user_config'
        ? { providers: [{ id: 'llm', baseUrl: 'https://llm.test.local/v1' }], knowledgeBase: { entries: KB_HIT } }
        : undefined,
  })
  const result = await provider({ company: 'Acme', website: '' }, 0)
  assert.equal(result, null, '缺凭证时必须返回 null（由 EmailAgent 降级模板），而不是抛错')
})

test('WhatsApp 兜底文案：命中知识库时列出条目，未命中时不编造卖点', () => {
  const withKb = createKnowledgeWhatsAppTextBuilder(mkStore({ entries: KB_HIT }))
  const text = withKb({
    id: 't',
    leadId: 0,
    company: 'Acme',
    website: 'https://acme.com',
    createdAt: Date.now(),
    priority: 1,
  })
  assert.match(text, /工厂实力/, 'WhatsApp 文案应列出命中的资料标题')
  assert.match(text, /Acme/, '应包含公司名做个性化')

  const noKb = createKnowledgeWhatsAppTextBuilder(mkStore({ entries: [] }))
  const fallback = noKb({ id: 't', leadId: 0, company: 'Acme', website: '', createdAt: Date.now(), priority: 1 })
  assert.ok(!/ISO9001|20000 平米|认证/.test(fallback), '无资料时不得编造任何卖点/资质')
  assert.match(fallback, /Acme/, '仍应保留中性问候')
})
