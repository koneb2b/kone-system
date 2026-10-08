/**
 * 客户白皮书预览生成器（开发辅助，非产品代码）
 *
 * 用途：把 `export-service.ts` 的 `buildPdfHtml` 渲染成 HTML 文件，
 * 便于在浏览器中直接查看导出文档的**视觉设计**（配色 / 排版 / 信息层级），
 * 无需真的走一次 Electron 导出流程。
 *
 * 原理：`export-service.ts` 依赖 Electron 运行时，故此处用 vm + 自定义 require
 * 加载（与 tests 中加载 feature-gate.ts 的做法一致），并转译 TS。
 *
 * 用法：node scripts/preview-whitepaper.cjs [输出路径]
 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Module = require('node:module')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const SERVICE = path.join(ROOT, 'electron', 'services', 'export-service.ts')
const OUT = process.argv[2] || path.join(ROOT, 'whitepaper-preview.html')
const realRequire = Module.createRequire(__filename)

// ── 加载 export-service（mock Electron 侧依赖）──
const source = fs.readFileSync(SERVICE, 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: SERVICE,
}).outputText

const mod = { exports: {} }
const ctx = vm.createContext({
  module: mod,
  exports: mod.exports,
  require: (id) => {
    if (id === './electron-bridge') return { app: {}, BrowserWindow: {}, dialog: {}, shell: {} }
    if (id === '../ipc/channels') return { IPC_CHANNELS: { FILES: {} } }
    if (id === './config-service') return {}
    if (id === './license-service') return { registerSecureFeatureIpc: () => {} }
    return realRequire(id)
  },
  __dirname: path.dirname(SERVICE),
  __filename: SERVICE,
  process,
  console,
  Buffer,
  setTimeout,
})
new vm.Script(js, { filename: SERVICE }).runInContext(ctx)

const { buildPdfHtml } = mod.exports
if (typeof buildPdfHtml !== 'function') {
  console.error('未能加载 buildPdfHtml，请检查导出是否仍为 export')
  process.exit(1)
}

// ── 示例数据（覆盖各类可信度状态，便于检验视觉效果）──
const html = buildPdfHtml({
  company: 'Nordic Battery Trading GmbH',
  website: 'https://nordic-battery.example',
  country: '德国',
  industry: '储能电池 / 新能源',
  machineId: 'MACHINE-DEMO-0001',
  contact: 'Anna Schmidt',
  contactTitle: 'Head of Procurement',
  email: 'procurement@nordic-battery.example',
  phone: '+49 40 1234 5678',
  dataSourceType: 'linkedin_search',
  matchScore: 87,
  opportunityScore: { icpFit: 82, intent: 74, evidence: 68, riskPenalty: 5, finalScore: 79 },
  riskFlags: ['域名邮箱为 catch-all，投递成功率可能受影响', '未发现近期采购公开记录'],
  evidence: '命中 LinkedIn 公开职位页与官网团队页；官网产品线与目标品类高度重合。',
  customsData: {
    annualImportVolume: '约 1,200 万美元 / 年',
    lastShipmentDate: '2026-07-18',
    topSuppliers: ['CATL', 'EVE Energy', 'BYD'],
    originCountries: ['中国', '韩国'],
  },
  exhibitionFootprints: ['Intersolar Europe 2026', 'ees Europe 2025', 'The smarter E 2025'],
  decisionMakers: [
    {
      name: 'Anna Schmidt',
      title: 'Head of Procurement',
      email: 'anna.schmidt@nordic-battery.example',
      phone: '+49 40 1234 5678',
      linkedinUrl: 'linkedin.com/in/anna-schmidt-demo',
      emailGrade: 'verified',
      phoneValid: true,
      confidenceScore: 92,
    },
    {
      name: 'Lukas Weber',
      title: 'Technical Director',
      email: 'l.weber@nordic-battery.example',
      phone: '+49 40 1234 5690',
      emailGrade: 'probable',
      confidenceScore: 78,
    },
    {
      name: 'Mia Hoffmann',
      title: 'Supply Chain Manager',
      email: 'mia@nordic-battery.example',
      phone: '',
      emailGrade: 'risky',
      confidenceScore: 61,
    },
  ],
  strategies: [
    {
      scenario: '首次触达',
      subject: 'Regarding your 2026 storage cell sourcing plan',
      body: 'Dear Anna,\n\nWe noticed your recent expansion in utility-scale storage. Our LFP cells ship with full traceability and EU-compliant documentation.\n\nWould a 15-minute call next week make sense?\n\nBest regards',
    },
    {
      scenario: '跟进（未回复 7 天）',
      subject: 'Quick follow-up: cell supply lead time',
      body: 'Hi Anna,\n\nJust following up on my previous note. We currently hold buffer stock for Q4 delivery, which may help with your timeline.\n\nHappy to share the spec sheet if useful.',
    },
  ],
})

fs.writeFileSync(OUT, html, 'utf8')
console.log(`✅ 白皮书预览已生成：${OUT}`)
