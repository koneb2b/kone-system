const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const { createTsAwareRequire } = require('./helpers.js')

// P1-3 续 · 组件级 selector 订阅前置：把 `getLeadSettlementMeta` 抽成纯函数后，
// 此处对其全部分支做回归防护。该函数决定搜索结果卡片的"结算态"展示
// （待评估 / 流式分析中 / 已评分 / 社交盲评 / AI 未启用 / 降级回退）。
//
// 缺陷背景：原实现内联于 search-engine.tsx 且闭包 isStreaming/aiScoringSkipped，
// 无法单测、也无法被卡片订阅复用。抽出为纯函数（标志由调用方注入）后，
// 卡片可按 leadKey 订阅自身切片并本地推导 settlementMeta，避免父列表每次帧重建。

const repoRoot = path.join(__dirname, '..', '..')
const mapperPath = path.join(repoRoot, 'src', 'lib', 'lead-mappers.ts')

const realRequire = Module.createRequire(__filename)
const stubs = {
  // 仅 getLeadSettlementMeta 的运行时依赖；type-only 导入在 transpile 阶段被擦除。
  '@/lib/utils': { stableHash: (value) => String(value) },
}
const customRequire = createTsAwareRequire((id) => {
  if (id in stubs) return stubs[id]
  if (id.startsWith('@/')) {
    return realRequire(path.join(repoRoot, 'src', id.slice(2)))
  }
  return realRequire(id)
})
const transpileMapper = () => {
  const source = fs.readFileSync(mapperPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
    fileName: mapperPath,
  }).outputText
  const moduleObj = { exports: {} }
  const ctx = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: customRequire,
    __dirname: path.dirname(mapperPath),
    __filename: mapperPath,
    process,
    console,
    setTimeout,
    clearTimeout,
    Buffer,
  })
  new vm.Script(transpiled, { filename: mapperPath }).runInContext(ctx)
  return moduleObj.exports
}

const baseLead = (overrides) => ({
  id: 'lead-1',
  company: 'AlphaCorp',
  website: 'https://alpha.test',
  country: 'US',
  leadKey: 'lead-1',
  matchScore: undefined,
  matchReasons: [],
  riskFlags: [],
  fallbackStatus: undefined,
  ...overrides,
})

test('getLeadSettlementMeta: 社交盲评态（有分值 + social_blind_score）', () => {
  const { getLeadSettlementMeta } = transpileMapper()
  const meta = getLeadSettlementMeta(baseLead({ matchScore: 70, fallbackStatus: 'social_blind_score' }), {
    isStreaming: false,
    aiScoringSkipped: false,
  })
  assert.equal(meta.state, 'social_blind_score')
  assert.equal(meta.showFallback, true)
  assert.equal(meta.fallbackTone, 'blue')
  assert.match(meta.fallbackReason, /LinkedIn|行业目录/)
})

test('getLeadSettlementMeta: 已评分态（有数值分，非社交盲评）', () => {
  const { getLeadSettlementMeta } = transpileMapper()
  const meta = getLeadSettlementMeta(baseLead({ matchScore: 88 }), { isStreaming: false, aiScoringSkipped: false })
  assert.equal(meta.state, 'scored')
  assert.equal(meta.showFallback, false)
  assert.equal(meta.showPending, false)
})

test('getLeadSettlementMeta: 流式分析中态（无分 + isStreaming）', () => {
  const { getLeadSettlementMeta } = transpileMapper()
  const meta = getLeadSettlementMeta(baseLead({}), { isStreaming: true, aiScoringSkipped: false })
  assert.equal(meta.state, 'streaming')
  assert.equal(meta.showPending, true)
  assert.equal(meta.showFallback, false)
})

test('getLeadSettlementMeta: AI 未启用态（无分 + aiScoringSkipped）', () => {
  const { getLeadSettlementMeta } = transpileMapper()
  const meta = getLeadSettlementMeta(baseLead({}), { isStreaming: false, aiScoringSkipped: true })
  assert.equal(meta.state, 'ai_skipped')
  assert.equal(meta.showFallback, true)
})

test('getLeadSettlementMeta: 降级回退态（官网 403 + 盲评失败）', () => {
  const { getLeadSettlementMeta } = transpileMapper()
  const meta = getLeadSettlementMeta(baseLead({ riskFlags: ['website_403', 'blind_score_failed'] }), {
    isStreaming: false,
    aiScoringSkipped: false,
  })
  assert.equal(meta.state, 'fallback')
  assert.match(meta.fallbackReason, /防爬|盲评/)
})

test('getLeadSettlementMeta: 默认回退态（无分、无阶段标志、无风险）', () => {
  const { getLeadSettlementMeta } = transpileMapper()
  const meta = getLeadSettlementMeta(baseLead({}), { isStreaming: false, aiScoringSkipped: false })
  assert.equal(meta.state, 'fallback')
  assert.equal(meta.fallbackReason, '待人工复核')
})
