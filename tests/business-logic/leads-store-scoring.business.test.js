const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

// P1-3 回归防护：流式评分单点增量更新。
//
// 缺陷背景：原实现每收到一帧 emitLeadScored 就对 searchResults 做整体
// `map` + 整体 `setSearchResults` 引用替换，导致所有整对象订阅者全部重渲染，
// 且流式期间分页 useEffect 因依赖 `searchResults` 被反复触发，分页跳回第 1 页。
// 修复：新增 `updateScoredLead` action 走单点更新 + 可选 top-K 重排，
// searchResultsByKey 索引保持同步。

const repoRoot = path.join(__dirname, '..', '..')
const storePath = path.join(repoRoot, 'src', 'store', 'leads-store.ts')

const realRequire = Module.createRequire(__filename)
const stubs = {
  '@/lib/electron-api': {
    fetchClaimedDomains: async () => ({ domains: [] }),
    checkDomainsCollision: async () => ({ claimedDomains: [], offline: true }),
    configGet: async () => null,
    configSet: async () => null,
  },
}
const customRequire = (id) => {
  if (id in stubs) return stubs[id]
  if (id.startsWith('@/')) {
    return realRequire(path.join(repoRoot, 'src', id.slice(2)))
  }
  return realRequire(id)
}
const transpileStore = () => {
  const source = fs.readFileSync(storePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
    fileName: storePath,
  }).outputText
  const moduleObj = { exports: {} }
  const ctx = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: customRequire,
    __dirname: path.dirname(storePath),
    __filename: storePath,
    process,
    console,
    setTimeout,
    clearTimeout,
    Buffer,
  })
  new vm.Script(transpiled, { filename: storePath }).runInContext(ctx)
  return moduleObj.exports
}

const lead = (overrides) => ({
  id: 'lead-1',
  company: 'AlphaCorp',
  website: 'https://alpha.test',
  country: 'US',
  leadKey: 'lead-1',
  matchScore: undefined,
  ...overrides,
})

test('P1-3: updateScoredLead 按 leadKey 命中并合并字段', () => {
  const mod = transpileStore()
  const useLeadsStore = mod.useLeadsStore
  useLeadsStore.setState({
    searchResults: [
      lead({ id: 'a', leadKey: 'a', company: 'A', website: 'https://a.test' }),
      lead({ id: 'b', leadKey: 'b', company: 'B', website: 'https://b.test' }),
    ],
    searchResultsByKey: {},
  })
  const ok = useLeadsStore.getState().updateScoredLead({
    id: 'a',
    company: 'A',
    website: 'https://a.test',
    matchScore: 82,
    matchReasons: ['产品相关', 'B2B 信号'],
    scoreSource: 'ai',
    contact: 'boss@a.test',
    inferredRole: 'CEO',
  })
  assert.equal(ok, true)
  const updated = useLeadsStore.getState().searchResults.find((l) => l.leadKey === 'a')
  assert.equal(updated.matchScore, 82)
  assert.deepEqual(updated.matchReasons, ['产品相关', 'B2B 信号'])
  assert.equal(updated.scoreSource, 'ai')
  assert.equal(updated.contact, 'boss@a.test')
  assert.equal(updated.inferredRole, 'CEO')
  assert.equal(useLeadsStore.getState().searchResultsByKey['a'].matchScore, 82)
})

test('P1-3: 未命中目标时返回 false 且不修改数组', () => {
  const mod = transpileStore()
  const useLeadsStore = mod.useLeadsStore
  const initial = [lead({ id: 'x', leadKey: 'x', company: 'X', website: 'https://x.test' })]
  useLeadsStore.setState({ searchResults: initial, searchResultsByKey: { x: initial[0] } })
  const before = useLeadsStore.getState().searchResults
  const ok = useLeadsStore
    .getState()
    .updateScoredLead({ id: 'unknown', company: 'Z', website: 'https://z.test', matchScore: 90 })
  assert.equal(ok, false)
  assert.strictEqual(useLeadsStore.getState().searchResults, before, '未命中不得产生新数组')
})

test('P1-3: reposition=true 时高分组被重新置顶', () => {
  const mod = transpileStore()
  const useLeadsStore = mod.useLeadsStore
  const seeded = [
    lead({ id: 'a', leadKey: 'a', company: 'A', website: 'https://a.test', matchScore: 70 }),
    lead({ id: 'b', leadKey: 'b', company: 'B', website: 'https://b.test', matchScore: 80 }),
    lead({ id: 'c', leadKey: 'c', company: 'C', website: 'https://c.test', matchScore: undefined }),
    lead({ id: 'd', leadKey: 'd', company: 'D', website: 'https://d.test', matchScore: undefined }),
  ]
  useLeadsStore.setState({ searchResults: seeded, searchResultsByKey: {} })
  /* C 的分数从无到 95 → 应被置于顶 K 之前 */
  useLeadsStore
    .getState()
    .updateScoredLead(
      { id: 'c', company: 'C', website: 'https://c.test', matchScore: 95 },
      { reposition: true, topCount: 3 },
    )
  const after = useLeadsStore.getState().searchResults.map((l) => l.leadKey)
  /* 顶 K=3 应为 C(95)、B(80)、A(70)；D 保持原位尾 */
  assert.equal(after.length, 4, '长度不变')
  assert.equal(after[0], 'c', '高分组 C 必须置顶')
  assert.equal(after[1], 'b', '原次高分 B 紧随')
  assert.equal(after[2], 'a', 'A 进入顶 K 第三位')
  assert.equal(after[3], 'd', '未评分的 D 保留原相对位置')
})

test('P1-3: 单次 update 仅触发一次状态写入（不重建整数组）', () => {
  const mod = transpileStore()
  const useLeadsStore = mod.useLeadsStore
  const seeded = [
    lead({ id: 'a', leadKey: 'a', company: 'A', website: 'https://a.test' }),
    lead({ id: 'b', leadKey: 'b', company: 'B', website: 'https://b.test' }),
  ]
  useLeadsStore.setState({ searchResults: seeded, searchResultsByKey: {} })
  const beforeRef = useLeadsStore.getState().searchResults
  const beforeByKeyRef = useLeadsStore.getState().searchResultsByKey

  useLeadsStore.getState().updateScoredLead({ id: 'a', company: 'A', website: 'https://a.test', matchScore: 75 })

  const afterRef = useLeadsStore.getState().searchResults
  const afterByKeyRef = useLeadsStore.getState().searchResultsByKey
  assert.notStrictEqual(beforeRef, afterRef, '数组引用必须更新（订阅者收到通知）')
  assert.notStrictEqual(beforeByKeyRef, afterByKeyRef, 'byKey 索引必须同步更新')
  assert.equal(afterRef.length, 2, '长度不变（增量更新，不重建）')
})

// ─────────────────────────────────────────────────────────────
// L0-4 / F1：合并键优先级（审计 §9-L0-4）
//
// 缺陷背景：`findScoredLeadIndex` 原先对**同一条 lead**依次尝试
// leadKey → website → company 并立即 return，即"逐条位置优先"。
// 这导致靠前条目的**弱匹配**（company / website）会遮蔽靠后条目的
// **强匹配**（leadKey）：评分被写到错误的条目上，真正的目标线索
// 分数始终为 undefined —— 即审计所述"评分更新静默丢弃路径"。
//
// 修复方向：改为"条件优先级"——先全量扫描 leadKey，未命中再扫
// website，最后才回退 company。以下用例即该行为的回归防护。
// ─────────────────────────────────────────────────────────────

test('L0-4/F1: leadKey 强匹配优先，不被靠前条目的弱 company 匹配遮蔽（公司名重复场景）', () => {
  const mod = transpileStore()
  const useLeadsStore = mod.useLeadsStore
  /* 采集常见场景：两条线索公司名完全相同（同名分支 / 重复抓取），但 leadKey 不同 */
  useLeadsStore.setState({
    searchResults: [
      lead({ id: 'a', leadKey: 'a', company: 'Acme GmbH', website: 'https://a.test' }),
      lead({ id: 'b', leadKey: 'b', company: 'Acme GmbH', website: 'https://b.test' }),
    ],
    searchResultsByKey: {},
  })
  const ok = useLeadsStore.getState().updateScoredLead({
    id: 'b',
    company: 'Acme GmbH',
    website: 'https://b.test',
    matchScore: 91,
  })
  assert.equal(ok, true)
  const rs = useLeadsStore.getState().searchResults
  const a = rs.find((l) => l.leadKey === 'a')
  const b = rs.find((l) => l.leadKey === 'b')
  assert.equal(b.matchScore, 91, 'leadKey 命中的 b 必须被评分')
  assert.equal(a.matchScore, undefined, '弱 company 匹配不得把评分写到无关的 a 上')
})

test('L0-4/F1: website 弱匹配不得遮蔽靠后条目的 leadKey 强匹配', () => {
  const mod = transpileStore()
  const useLeadsStore = mod.useLeadsStore
  /* 两条线索共用同一 website（集团站 / 抓取归一），leadKey 才是唯一身份 */
  useLeadsStore.setState({
    searchResults: [
      lead({ id: 'a', leadKey: 'a', company: 'A', website: 'https://same.test' }),
      lead({ id: 'b', leadKey: 'b', company: 'B', website: 'https://same.test' }),
    ],
    searchResultsByKey: {},
  })
  useLeadsStore.getState().updateScoredLead({
    id: 'b',
    company: 'B',
    website: 'https://same.test',
    matchScore: 88,
  })
  const rs = useLeadsStore.getState().searchResults
  assert.equal(rs.find((l) => l.leadKey === 'b').matchScore, 88, 'leadKey 命中的 b 必须被评分')
  assert.equal(rs.find((l) => l.leadKey === 'a').matchScore, undefined, '弱 website 匹配不得污染 a')
})

test('L0-4/F1: 公司名漂移时仍按 leadKey 命中（不丢评分）', () => {
  const mod = transpileStore()
  const useLeadsStore = mod.useLeadsStore
  useLeadsStore.setState({
    searchResults: [
      lead({ id: 'a', leadKey: 'a', company: 'Acme GmbH', website: 'https://a.test' }),
      lead({ id: 'b', leadKey: 'b', company: 'Acme GmbH', website: 'https://b.test' }),
    ],
    searchResultsByKey: {},
  })
  /* 评分回包公司名发生漂移（"Acme GmbH."），website 也不同 —— 仅 leadKey 可定位 */
  const ok = useLeadsStore.getState().updateScoredLead({
    id: 'b',
    company: 'Acme GmbH.',
    website: 'https://drifted.test',
    matchScore: 77,
  })
  assert.equal(ok, true, '公司名漂移时也必须命中')
  const rs = useLeadsStore.getState().searchResults
  assert.equal(rs.find((l) => l.leadKey === 'b').matchScore, 77)
  assert.equal(rs.find((l) => l.leadKey === 'a').matchScore, undefined)
})
