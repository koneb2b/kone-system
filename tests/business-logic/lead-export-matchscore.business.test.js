const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

// P2-4 · CSV 导出判空：线索表 CSV 导出原先直接用 `${lead.matchScore}%`，
// 当 matchScore 为 undefined（待评估）时，会向用户导出 "undefined%" 的虚构/错误评分列，
// 而 UI 列已显示「待评估」。本测试对抽出后的纯函数 `formatMatchScoreForExport`
// 做回归防护，确保导出口径与 UI 一致（未评分 → 「待评估」）。

const repoRoot = path.join(__dirname, '..', '..')
const mapperPath = path.join(repoRoot, 'src', 'lib', 'lead-mappers.ts')

const realRequire = Module.createRequire(__filename)
const stubs = {
  '@/lib/utils': { stableHash: (value) => String(value) },
}
const { createTsAwareRequire } = require('./helpers.js')

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

test('formatMatchScoreForExport: 已评分数值输出 "N%"', () => {
  const { formatMatchScoreForExport } = transpileMapper()
  assert.equal(formatMatchScoreForExport(85), '85%')
  assert.equal(formatMatchScoreForExport(0), '0%')
  assert.equal(formatMatchScoreForExport(100), '100%')
})

test('formatMatchScoreForExport: 未评分（undefined）输出「待评估」', () => {
  const { formatMatchScoreForExport } = transpileMapper()
  assert.equal(formatMatchScoreForExport(undefined), '待评估')
})

test('formatMatchScoreForExport: null 评分输出「待评估」', () => {
  const { formatMatchScoreForExport } = transpileMapper()
  assert.equal(formatMatchScoreForExport(null), '待评估')
})
