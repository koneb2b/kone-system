const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P0 知识库 → 获客链路闭环守护。
//
// 三条不变量：
//   1) 只返回**真实命中**的条目 —— 绝不按 content.length 兜底填充无关长文档
//      （search/analysis.ts 的历史有害行为，已修，此处锁死防回退）
//   2) 无命中时诚实降级 —— reason 能区分「没配」与「配了但不相关」
//   3) 渲染出的 prompt 片段确实包含命中条目的正文（证明 LLM 真拿到资料）

const { readKnowledgeEntries, selectKnowledgeForAgent, renderKnowledgePromptBlock } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'agent-knowledge.js'),
)

const mkStore = (entries, extra = {}) => ({
  get: (key) => (key === 'user_config' ? { knowledgeBase: { entries, ...extra } } : undefined),
})

test('P0-KB: 命中场景关键词的条目被选中', () => {
  const store = mkStore([
    { title: '工厂实力', content: '自有工厂 20000 平米，交付能力强', tags: ['工厂实力'] },
    { title: '无关条目', content: '公司团建活动照片', tags: [] },
  ])
  const result = selectKnowledgeForAgent({ company: 'Acme' }, 0, readKnowledgeEntries(store))
  assert.equal(result.injected, true)
  assert.ok(
    result.entries.some((e) => e.title === '工厂实力'),
    '应命中含「工厂/交付」关键词的条目',
  )
})

test('P0-KB: 绝不按 content.length 兜底填充无关条目（防回退）', () => {
  // 一条极长的**无关**文档 + 一条短的相关文档。
  // 历史 bug：兜底按长度排序会优先塞进这条长文档 → 污染 prompt。
  const longIrrelevant = 'x'.repeat(5000)
  const store = mkStore([
    { title: '超长无关文档', content: longIrrelevant, tags: [] },
    { title: '报价方案', content: '我们提供阶梯报价', tags: ['直接报价'] },
  ])
  const result = selectKnowledgeForAgent({ company: 'Acme' }, 0, readKnowledgeEntries(store))
  assert.ok(!result.entries.some((e) => e.title === '超长无关文档'), '无关的长文档绝不能被兜底选入')
  assert.ok(result.entries.some((e) => e.title === '报价方案'))
})

test('P0-KB: 无任何命中时返回空且标注 no_match（不编造）', () => {
  const store = mkStore([{ title: '完全无关', content: 'zzzz', tags: [] }])
  const result = selectKnowledgeForAgent({ company: 'Acme' }, 0, readKnowledgeEntries(store))
  assert.equal(result.injected, false)
  assert.equal(result.entries.length, 0)
  assert.equal(result.reason, 'no_match')
  assert.equal(result.totalEntries, 1, '应如实报告用户确实配了 1 条')
})

test('P0-KB: 未配置知识库时 reason=empty（可区分于 no_match）', () => {
  const result = selectKnowledgeForAgent({ company: 'Acme' }, 0, readKnowledgeEntries(mkStore([])))
  assert.equal(result.injected, false)
  assert.equal(result.reason, 'empty')
  assert.equal(result.totalEntries, 0)
})

test('P0-KB: 渲染出的 prompt 片段确实含命中条目正文', () => {
  const store = mkStore([{ title: '工厂实力', content: '自有工厂交期稳定', tags: ['工厂实力'] }])
  const selection = selectKnowledgeForAgent({ company: 'Acme' }, 0, readKnowledgeEntries(store))
  const block = renderKnowledgePromptBlock(selection)
  assert.ok(block.includes('工厂实力'))
  assert.ok(block.includes('自有工厂交期稳定'), '正文必须真的进入 prompt')
})

test('P0-KB: 未命中时渲染为空串（调用方据此走诚实降级）', () => {
  const selection = selectKnowledgeForAgent({ company: 'Acme' }, 0, [])
  assert.equal(renderKnowledgePromptBlock(selection), '')
})

test('P0-KB: readKnowledgeEntries 对畸形数据健壮（不抛错）', () => {
  const bad = { get: () => ({ knowledgeBase: { entries: 'not-an-array' } }) }
  assert.deepEqual(readKnowledgeEntries(bad), [])
  const nullish = { get: () => undefined }
  assert.deepEqual(readKnowledgeEntries(nullish), [])
  assert.deepEqual(readKnowledgeEntries(undefined), [])
  // 空标题且空正文的条目应被过滤
  const empty = mkStore([{ title: '', content: '', tags: [] }])
  assert.deepEqual(readKnowledgeEntries(empty), [])
})

test('P0-KB: 用户快捷标签措辞必须能命中（跨端副本守护）', () => {
  const fs = require('node:fs')
  // 知识库 UI 定义的快捷标签 —— Agent 侧必须在匹配关键词中包含同样的措辞，
  // 否则用户按 UI 提示命名的资料反而检索不到（副本漂移）。
  const uiSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'knowledge-base.tsx'), 'utf8')
  const match = uiSource.match(/const quickTags = \[([^\]]+)\]/)
  assert.ok(match, 'knowledge-base.tsx 中应存在 quickTags 定义')
  const uiTags = match[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  assert.ok(uiTags.length > 0, 'quickTags 不应为空')

  // 用每个 UI 快捷标签作为资料标题，stage 0 必须能命中。
  for (const tag of uiTags) {
    const store = mkStore([{ title: tag, content: `${tag}的详细说明`, tags: [tag] }])
    const result = selectKnowledgeForAgent({ company: 'Acme GmbH' }, 0, readKnowledgeEntries(store))
    assert.equal(result.injected, true, `UI 快捷标签「${tag}」必须能被 Agent 侧检索命中`)
  }
})
