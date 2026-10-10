const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

/* P2 修复守护测试。
 *
 * P2-1（countryCode）是**运行时断言** —— 真正执行纯函数，验证解析结果。
 * 该缺陷的原形态是 `country.slice(0, 2).toUpperCase()`：`Germany` → `GE`（实为 `DE`）、
 * `United States` → `UN`（实为 `US`）—— 错误代码会作为"看起来合法"的数据
 * 进入表格、导出文件与云端台账。
 */

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

const ccPath = path.join(repoRoot, 'src', 'lib', 'country-code.ts')
const loadCountryCode = () => {
  const transpiled = ts.transpileModule(fs.readFileSync(ccPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: ccPath,
  }).outputText
  const moduleObj = { exports: {} }
  const ctx = vm.createContext({ module: moduleObj, exports: moduleObj.exports, require, console })
  new vm.Script(transpiled, { filename: ccPath }).runInContext(ctx)
  return moduleObj.exports
}

test('P2-1: 国家名解析为正确的 ISO 代码（不得截取前两字母）', () => {
  const { resolveCountryCode } = loadCountryCode()
  // 这三条正是原实现的错误样本
  assert.equal(resolveCountryCode('Germany'), 'DE', 'P2-1 回归：Germany 不是 GE')
  assert.equal(resolveCountryCode('United States'), 'US', 'P2-1 回归：United States 不是 UN')
  assert.equal(resolveCountryCode('China'), 'CN')
  assert.equal(resolveCountryCode('Japan'), 'JP')
  assert.equal(resolveCountryCode('Australia'), 'AU')
  assert.equal(resolveCountryCode('Turkey'), 'TR')
})

test('P2-1: 支持中文国名', () => {
  const { resolveCountryCode } = loadCountryCode()
  assert.equal(resolveCountryCode('德国'), 'DE')
  assert.equal(resolveCountryCode('美国'), 'US')
  assert.equal(resolveCountryCode('越南'), 'VN')
})

test('P2-1: 大小写与空白不敏感', () => {
  const { resolveCountryCode } = loadCountryCode()
  assert.equal(resolveCountryCode('  germany  '), 'DE')
  assert.equal(resolveCountryCode('UNITED KINGDOM'), 'GB')
})

test('P2-1: 未知国家返回空串（诚实，不猜）', () => {
  const { resolveCountryCode } = loadCountryCode()
  assert.equal(resolveCountryCode('Atlantis'), '', 'P2-1：未知国家不得返回臆造的代码')
  assert.equal(resolveCountryCode(''), '')
  assert.equal(resolveCountryCode(undefined), '')
})

test('P2-1: 三处调用点都不得再用 slice(0, 2) 推导国家代码', () => {
  for (const rel of [
    'src/lib/lead-mappers.ts',
    'src/hooks/use-search-engine.ts',
    'src/components/analysis-drawer.tsx',
  ]) {
    const src = read(rel)
    // 只检查**代码行**：注释里提及原实现（用于说明修复原因）是允许的。
    const codeOnly = src
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    assert.ok(
      !/country\.slice\(0,\s*2\)/.test(codeOnly),
      `${rel} 仍在使用 country.slice(0, 2) 推导国家代码（P2-1 回归）`,
    )
  }
})

test('P2-1: lead-mappers 保留本地 resolveCountryCode 签名并委托共享映射', () => {
  const src = read('src/lib/lead-mappers.ts')
  assert.match(src, /resolveCountryCodeFromName\(country\)/, 'P2-1：应委托共享映射')
  assert.match(
    src,
    /const resolveCountryCode = \(countryCode\?: string, country\?: string\)/,
    'P2-1：本地函数签名应保持不变（调用方不受影响）',
  )
})
