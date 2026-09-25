const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')
const Module = require('node:module')
const ts = require('typescript')

// 套餐边界回归防护（kone-PRD §5.1.2 + README「版本能力对照」）：
// 试用版仅可体验本地搜索 + ICP 评分（10 条/次、15 秒间隔）与本地 CSV 导出（限 100 行），
// **不开放** AI 深度分析/开发信、完整导出。
// 历史缺陷：`normalizeFeatureSet` 的 trial 分支误用 `FEATURE_ALIASES.basic`（实为"全部本地能力"），
// 且 `TRIAL_FEATURES` 误含 search_deep / analysis_* / export_full → 试用限额与 AI 分析门禁全部失效（商业泄漏）。
const repoRoot = path.join(__dirname, '..', '..')
const gatePath = path.join(repoRoot, 'src', 'lib', 'feature-gate.ts')
const realRequire = Module.createRequire(__filename)

const loadGate = () => {
  // Vite 的 import.meta.env 在 CJS/vm 下非法 → 预处理为静态桩
  const source = fs
    .readFileSync(gatePath, 'utf8')
    .replace(/import\.meta\.env/g, "({ DEV: false, PROD: true, MODE: 'test' })")
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: gatePath,
  }).outputText
  const moduleObj = { exports: {} }
  const ctx = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: (id) => {
      if (id === 'react') return { useEffect: () => {}, useMemo: (fn) => fn(), useState: (v) => [v, () => {}] }
      if (id === '@/lib/electron-api') return { getLicenseStatus: async () => null }
      return realRequire(id)
    },
    __dirname: path.dirname(gatePath),
    __filename: gatePath,
    process,
    console,
    Buffer,
  })
  new vm.Script(transpiled, { filename: gatePath }).runInContext(ctx)
  return moduleObj.exports
}

const gate = loadGate()
const TRIAL_FEATURES = ['search_basic', 'lead_export']
const active = (plan, features) => ({ status: 'active', expiresAt: Date.now() + 86400000, plan, features })

test('试用版：搜索限额 10 条/次、15 秒间隔，且不开深度分析', () => {
  const limit = gate.toFeatureGateState(active('trial', TRIAL_FEATURES)).getSearchLimit()
  assert.equal(limit.maxResults, 10)
  assert.equal(limit.cooldownMs, 15000)
  assert.equal(limit.allowDeepAnalysis, false)
})

test('试用版：导出开启但限 100 行，无完整导出', () => {
  const limit = gate.toFeatureGateState(active('trial', TRIAL_FEATURES)).getExportLimit()
  assert.equal(limit.enabled, true)
  assert.equal(limit.maxRows, 100)
  assert.equal(limit.fullExport, false)
})

test('试用版：不得访问 search_deep / analysis_* / export_full / local_autopilot', () => {
  const state = gate.toFeatureGateState(active('trial', TRIAL_FEATURES))
  /* local_autopilot 尤其关键：AGENT.CONTROL 在主进程用 requireFeature('local_autopilot') 门禁，
     若试用持有该特性，即可绕过渲染层升级墙直连 IPC 启动智能体（违反 ipc-agent.md「主进程强制」）。 */
  for (const feature of ['search_deep', 'analysis_basic', 'analysis_advanced', 'export_full', 'local_autopilot']) {
    assert.equal(state.canAccess(feature), false, `试用版不应可访问 ${feature}`)
  }
  assert.equal(state.canAccess('search_basic'), true)
  assert.equal(state.canAccess('lead_export'), true)
})

test('基础版：解除搜索限额、开放 AI 分析，但仍无完整导出', () => {
  const state = gate.toFeatureGateState(
    active('basic', ['search_basic', 'search_deep', 'analysis_basic', 'analysis_advanced', 'lead_export']),
  )
  const search = state.getSearchLimit()
  assert.equal(search.maxResults, 100)
  assert.equal(search.cooldownMs, 0)
  assert.equal(search.allowDeepAnalysis, true)
  const exp = state.getExportLimit()
  assert.equal(exp.maxRows, 100)
  assert.equal(exp.fullExport, false)
})

test('高级版：完整导出（maxRows null）', () => {
  const exp = gate.toFeatureGateState(active('premium', ['lead_export', 'export_full', 'cloud_send'])).getExportLimit()
  assert.equal(exp.enabled, true)
  assert.equal(exp.maxRows, null)
  assert.equal(exp.fullExport, true)
})

test('源码守护：license-service 的 TRIAL_FEATURES 不得含付费专属能力', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron', 'services', 'license-service.ts'), 'utf8')
  const match = src.match(/const TRIAL_FEATURES = \[([\s\S]*?)\]/)
  assert.ok(match, '未找到 TRIAL_FEATURES 定义')
  for (const forbidden of ['search_deep', 'analysis_basic', 'analysis_advanced', 'export_full', 'local_autopilot']) {
    assert.ok(!match[1].includes(`'${forbidden}'`), `TRIAL_FEATURES 不得含 ${forbidden}（商业泄漏/授权绕过）`)
  }
})

test('源码守护：EXPORT_PDF 门禁不得为付费专属（其处理器含 isTrial 配额，即 §零.3 的 3 次 PLG 钩子）', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron', 'services', 'export-service.ts'), 'utf8')
  const pdfBlock = src.match(/EXPORT_PDF,[\s\S]{0,400}?async/)
  assert.ok(pdfBlock, '未找到 EXPORT_PDF 注册块')
  assert.match(pdfBlock[0], /'lead_export'/, 'EXPORT_PDF 应以 lead_export 放行（试用由内部 3 次配额差异化）')
  assert.doesNotMatch(
    pdfBlock[0],
    /^\s*'analysis_advanced',\s*$/m,
    'EXPORT_PDF 不得仅以 analysis_advanced 门禁——否则试用永远进不来，TRIAL_PDF_EXPORT_LIMIT 成为死代码',
  )
})

test('源码守护：API_TEST_CONNECTION 属配置能力，不得要求分析类特性', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron', 'services', 'proxy-service.ts'), 'utf8')
  const block = src.match(/API_TEST_CONNECTION,[\s\S]{0,600}?async/)
  assert.ok(block, '未找到 API_TEST_CONNECTION 注册块')
  // 只断言"特性表达式行"（注释中会说明历史误用 analysis_basic，不应误伤）
  const featureExpr = block[0].match(/=>\s*'([a-z_]+)'/)
  assert.ok(featureExpr, '未找到 API_TEST_CONNECTION 的特性表达式')
  assert.ok(
    !/^analysis_/.test(featureExpr[1]),
    `连接测试不得要求 analysis_*（实际 ${featureExpr[1]}）——试用版不含分析特性，会导致 README 第 1 步「测试连接」失败`,
  )
})

test('源码守护：trial 分支必须使用 FEATURE_ALIASES.trial（非 basic）', () => {
  const src = fs.readFileSync(gatePath, 'utf8')
  const trialBranch = src.match(/normalizedPlan === 'trial'[\s\S]{0,260}/)
  assert.ok(trialBranch, '未找到 trial 分支')
  // 断言"代码调用"而非注释文本：注释中会说明"此前误用 FEATURE_ALIASES.basic"
  assert.match(trialBranch[0], /FEATURE_ALIASES\.trial\.forEach/, 'trial 分支应使用 FEATURE_ALIASES.trial')
  assert.doesNotMatch(
    trialBranch[0],
    /FEATURE_ALIASES\.basic\.forEach/,
    'trial 分支不得使用 FEATURE_ALIASES.basic（会导致试用获得完整能力）',
  )
})
