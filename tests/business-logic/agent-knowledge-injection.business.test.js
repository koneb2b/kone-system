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

const { readKnowledgeEntries, readKnowledgeSource, selectKnowledgeForAgent, renderKnowledgePromptBlock } = require(
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

/* ─────────── 用户自定义标签贯通（本次新增能力）───────────
   背景：`user_config.knowledgeBase.customTags` 曾是**死字段**（类型声明了但全仓零读写），
   且 Agent 侧只认硬编码的 4 个内置标签 → 用户自定义标签永远无法命中，
   「可自定义」形同虚设。以下测试锁死这条链路不回退。
   诚实边界：本组验证的是**检索层**行为（关键词确实含自定义标签）。
   真实端到端（UI 保存 → store → 发信 prompt）由 typecheck + 单测 + 手工验收共同覆盖。 */

test('P0-KB: 用户自定义标签让「非内置术语」的资料也能命中', () => {
  // 资料标题与内容都只用用户自己的术语，不含任何内置标签/stage 词。
  const store = mkStore([{ title: '交期承诺', content: '我们承诺 15 天交付', tags: ['交期承诺'] }], {
    customTags: ['交期承诺'],
  })
  const source = readKnowledgeSource(store)
  assert.deepEqual(source.customTags, ['交期承诺'], '自定义标签应被读取')

  // 不传自定义标签 → 不应命中（证明命中确实来自自定义标签，而非别的关键词）
  const withoutCustom = selectKnowledgeForAgent({ company: 'Acme' }, 0, source.entries)
  assert.equal(withoutCustom.injected, false, '不传自定义标签时该资料不应命中')

  // 传入自定义标签 → 必须命中
  const withCustom = selectKnowledgeForAgent({ company: 'Acme' }, 0, source.entries, 3, source.customTags)
  assert.equal(withCustom.injected, true, '自定义标签必须让资料被命中')
  assert.equal(withCustom.entries[0].title, '交期承诺')
})

test('P0-KB: 无自定义标签时行为与改造前完全一致（向后兼容）', () => {
  const entries = [{ title: '工厂实力', content: '自有工厂', tags: [] }]
  const legacy = selectKnowledgeForAgent({ company: 'Acme' }, 0, entries)
  const explicitEmpty = selectKnowledgeForAgent({ company: 'Acme' }, 0, entries, 3, [])
  assert.deepEqual(explicitEmpty, legacy, '显式传空数组不应改变行为')
})

test('P0-KB: 自定义标签不会挤掉内置标签的命中能力', () => {
  // 用户加了自定义标签后，内置标签的资料仍必须能命中（不得发生覆盖）。
  const store = mkStore(
    [
      { title: '工厂实力', content: '自有工厂 20000 平', tags: [] },
      { title: '售后保障', content: '7x24 小时响应', tags: [] },
    ],
    { customTags: ['售后保障'] },
  )
  const source = readKnowledgeSource(store)
  const result = selectKnowledgeForAgent({ company: 'Acme' }, 0, source.entries, 5, source.customTags)
  const titles = result.entries.map((e) => e.title)
  assert.ok(titles.includes('工厂实力'), '内置标签命中不得被自定义标签挤掉')
  assert.ok(titles.includes('售后保障'), '自定义标签资料也应命中')
})

test('P0-KB: readKnowledgeSource 对畸形 customTags 健壮（不抛错、不污染）', () => {
  const notArray = { get: () => ({ knowledgeBase: { entries: [], customTags: 'oops' } }) }
  assert.deepEqual(readKnowledgeSource(notArray).customTags, [])

  const mixed = { get: () => ({ knowledgeBase: { entries: [], customTags: ['ok', '', '   ', null, 42] } }) }
  assert.deepEqual(readKnowledgeSource(mixed).customTags, ['ok', '42'], '应过滤空串但保留可转字符串')

  assert.deepEqual(readKnowledgeSource(undefined), { entries: [], customTags: [] })
})

test('P0-KB: 自定义标签在 UI 侧确实被持久化（跨端贯通守护）', () => {
  const fs = require('node:fs')
  const uiSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'knowledge-base.tsx'), 'utf8')
  // UI 保存时必须写入 customTags，否则 Agent 侧永远读不到 → 自定义标签再次变成死字段。
  assert.ok(
    /customTags:\s*normalizeTags\(customTags\)/.test(uiSource),
    'knowledge-base.tsx 保存时必须持久化 customTags（否则自定义标签不参与检索）',
  )
  // UI 加载时也必须回填，否则用户刷新后自定义标签消失。
  assert.ok(/config\.knowledgeBase\?\.customTags/.test(uiSource), 'knowledge-base.tsx 加载时必须回填 customTags')
})
