const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// 守护：知识库场景预筛**只返回真实命中**的条目。
//
// 历史行为（已修）：命中不足时按 content.length 无条件把无关长文档填入
// prompt，而 system prompt 声明「以知识库作为卖方优势的首要来源」
// → 既污染上下文，又挤占本可给相关条目的名额。
// 本测试锁死修复，防止回退。

const { pickRelevantKnowledgeEntries } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'search', 'analysis.js'),
)

test('KB: 只返回命中场景关键词的条目', () => {
  const entries = [
    { title: '报价体系', content: '阶梯折扣与账期', tags: [] },
    { title: '团队照片', content: '年会合影', tags: [] },
  ]
  const picked = pickRelevantKnowledgeEntries(entries, 'direct_quote', 5)
  assert.deepEqual(
    picked.map((e) => e.title),
    ['报价体系'],
    '未命中「报价/价格/成本」的条目必须被排除',
  )
})

test('KB: 绝不用 content.length 兜底填充无关条目（防回退）', () => {
  const entries = [
    { title: '超长无关', content: 'z'.repeat(8000), tags: [] },
    { title: '工厂实力', content: '自有产线，交付稳定', tags: [] },
  ]
  const picked = pickRelevantKnowledgeEntries(entries, 'factory_strength', 5)
  assert.equal(picked.length, 1)
  assert.equal(picked[0].title, '工厂实力', '无关长文档不得因长度被选中')
})

test('KB: 零命中返回空数组，而不是硬凑 limit 条', () => {
  const entries = [{ title: '团建', content: '春游', tags: [] }]
  const picked = pickRelevantKnowledgeEntries(entries, 'direct_quote', 5)
  assert.deepEqual(picked, [])
})

test('KB: 遵守 limit 上限', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({
    title: `报价方案${i}`,
    content: '价格与成本说明',
    tags: [],
  }))
  const picked = pickRelevantKnowledgeEntries(entries, 'direct_quote', 3)
  assert.equal(picked.length, 3)
})

test('KB: 同分时保持原始顺序（稳定排序，结果可测）', () => {
  const entries = [
    { title: 'A报价', content: '价格', tags: [] },
    { title: 'B报价', content: '价格', tags: [] },
  ]
  const picked = pickRelevantKnowledgeEntries(entries, 'direct_quote', 5)
  assert.deepEqual(
    picked.map((e) => e.title),
    ['A报价', 'B报价'],
  )
})

test('KB: 空输入安全返回空数组', () => {
  assert.deepEqual(pickRelevantKnowledgeEntries([], 'direct_quote', 5), [])
})
