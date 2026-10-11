const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const { createTsAwareRequire } = require('./helpers.js')

/**
 * 导出列构造器 SSOT 守护（防漂移闭环）。
 *
 * ## 背景：真实缺陷
 * 客户资料导出曾有三处**各自手写列定义**：
 *   - `leads-table.tsx`      —— 搜索结果导出（曾 8 列 → 扩到 26 列）
 *   - `leads-management.tsx` —— 线索管理导出（14 列，**完全没有决策人**）
 *   - `data-center.tsx`      —— 数据中心（仅 date/leads 统计，性质不同不纳入）
 *
 * 后果：用户从「搜索结果」导出能拿到核心关键人，从「线索管理」导出一个都没有
 * —— 同一份数据、两个入口、两种结果。且扩列时只改了其中一处。
 *
 * 现统一到 `src/lib/lead-export.ts`。本测试锁死该收敛，防止再次分裂。
 */

const repoRoot = path.join(__dirname, '..', '..')
const exportLibPath = path.join(repoRoot, 'src', 'lib', 'lead-export.ts')

const realRequire = Module.createRequire(__filename)
const stubs = {
  './error-message': {
    escapeCsvValue: (value) => {
      const text = String(value ?? '')
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    },
  },
  './lead-mappers': {
    // 与真实实现口径一致（已评分 → "N%"，未评分 → 待评估）
    formatMatchScoreForExport: (score) => (typeof score === 'number' ? `${score}%` : '待评估'),
  },
}
const customRequire = createTsAwareRequire((id) => {
  if (id in stubs) return stubs[id]
  return realRequire(id)
})

/** 转译并加载**真实**的 lead-export.ts（非内联副本），确保测试不与实现脱钩。 */
const loadLeadExport = () => {
  const source = fs.readFileSync(exportLibPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: exportLibPath,
  }).outputText
  const moduleObj = { exports: {} }
  const ctx = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: customRequire,
    __dirname: path.dirname(exportLibPath),
    __filename: exportLibPath,
    process,
    console,
    Buffer,
  })
  new vm.Script(transpiled, { filename: exportLibPath }).runInContext(ctx)
  return moduleObj.exports
}

const sampleLead = {
  id: 1,
  company: 'Acme Trading Co.',
  contact: 'John Doe',
  contactTitle: 'Procurement Manager',
  email: 'john@acme.com',
  phone: '+1 555 0100',
  country: 'United States',
  countryCode: 'US',
  industry: 'Industrial Parts',
  source: 'google_organic',
  matchScore: 85,
  status: 'new',
  followUp: 'pending',
  starred: false,
  lastActivity: '',
  addedDate: '2026-10-09',
  tags: [],
  unlocked: true,
  website: 'https://acme.com',
  estimatedValue: '',
  dataSourceType: 'google_organic',
  decisionMakers: [
    {
      name: 'Jane Smith',
      title: 'CEO',
      email: 'jane@acme.com',
      phone: '+1 555 0199',
      source: '外部数据源',
      confidenceScore: 90,
      emailGrade: 'verified',
      phoneValid: true,
    },
  ],
}

test('SSOT: 列定义包含决策人槽位（核心关键人不得丢失）', () => {
  const { LEAD_EXPORT_HEADERS, DECISION_MAKER_SLOTS } = loadLeadExport()
  assert.equal(DECISION_MAKER_SLOTS, 3)
  for (let i = 1; i <= DECISION_MAKER_SLOTS; i += 1) {
    for (const field of ['姓名', '职位', '邮箱', '邮箱等级', '电话']) {
      assert.ok(
        LEAD_EXPORT_HEADERS.includes(`决策人${i}${field}`),
        `表头缺「决策人${i}${field}」—— 决策人是触达闭环的关键数据`,
      )
    }
  }
})

test('SSOT: 表头顺序稳定（企业主体 → 顶层联系方式 → 决策人 → 溯源）', () => {
  const { LEAD_EXPORT_HEADERS } = loadLeadExport()
  // 注意：模块在 vm context 中加载，其数组原型与测试进程不同，
  // 故不能直接用 assert.deepEqual（会因引用不等而误判），改为逐项比较。
  /* 「地址」为 2026-10-11 新增：用户明确要求的客户核心信息之一。
     数据层 LeadItem.address 一直存在，此前导出链路遗漏（数据链路断裂）。 */
  const expected = ['公司名称', '行业', '国家', '地址', '匹配度', '联系人', '职位', '邮箱', '邮箱等级', '电话', '网站']
  expected.forEach((name, i) => {
    assert.equal(LEAD_EXPORT_HEADERS[i], name, `第 ${i} 列应为「${name}」`)
  })
  assert.equal(LEAD_EXPORT_HEADERS[LEAD_EXPORT_HEADERS.length - 1], '数据来源')
})

test('SSOT: 行长度与表头长度严格一致（不得错位）', () => {
  const { LEAD_EXPORT_HEADERS, buildLeadExportRow } = loadLeadExport()
  const row = buildLeadExportRow(sampleLead)
  assert.equal(row.length, LEAD_EXPORT_HEADERS.length, '行单元格数与表头列数不一致 → CSV 会错位')
})

test('SSOT: 决策人字段被正确摊平到固定槽位', () => {
  const { LEAD_EXPORT_HEADERS, buildLeadExportRow } = loadLeadExport()
  const row = buildLeadExportRow(sampleLead)
  const idx = (name) => LEAD_EXPORT_HEADERS.indexOf(name)
  assert.equal(row[idx('决策人1姓名')], 'Jane Smith')
  assert.equal(row[idx('决策人1邮箱')], 'jane@acme.com')
  assert.equal(row[idx('决策人1邮箱等级')], 'verified')
  // 第二个槽位无数据 → 留空（保证平面表结构稳定）
  assert.equal(row[idx('决策人2姓名')], '')
})

test('SSOT: 缺失字段留空而非 undefined/null', () => {
  const { buildLeadExportRow } = loadLeadExport()
  const sparse = { id: 2, company: 'Bare Co.' }
  const row = buildLeadExportRow(sparse)
  for (const cell of row) {
    assert.ok(!/undefined|null/.test(String(cell)), `单元格出现 undefined/null：${cell}`)
  }
})

test('SSOT: CSV 含 UTF-8 BOM（Excel 正确识别中文）', () => {
  const { buildLeadExportCsv } = loadLeadExport()
  const csv = buildLeadExportCsv([sampleLead])
  assert.ok(csv.startsWith('\ufeff'), 'CSV 必须以 UTF-8 BOM 开头')
})

test('SSOT 守护: 消费方不得再手写导出列字面量', () => {
  const consumers = [
    path.join(repoRoot, 'src', 'components', 'leads-table.tsx'),
    path.join(repoRoot, 'src', 'components', 'leads-management.tsx'),
  ]
  for (const file of consumers) {
    const src = fs.readFileSync(file, 'utf8')
    assert.ok(
      /from\s+'@\/lib\/lead-export'/.test(src),
      `${path.basename(file)} 必须从 '@/lib/lead-export' 引入导出构造器`,
    )
    assert.ok(
      !/'公司名称'\s*,\s*\n\s*'行业'/.test(src),
      `${path.basename(file)} 仍存在手写的导出列字面量 —— 会与 SSOT 漂移`,
    )
  }
})

test('可触达渠道: 有 phone/email/linkedin 时正确标注', () => {
  const { buildReachabilityChannel } = loadLeadExport()
  const withAll = {
    ...sampleLead,
    decisionMakers: [{ ...sampleLead.decisionMakers[0], linkedinUrl: 'https://linkedin.com/in/jane' }],
  }
  assert.equal(buildReachabilityChannel(withAll), 'WhatsApp / 邮件 / LinkedIn')
})

test('可触达渠道: 无任何联系方式返回「—」（需补数据）', () => {
  const { buildReachabilityChannel } = loadLeadExport()
  const bare = { id: 9, company: 'No Contact Ltd.' }
  assert.equal(buildReachabilityChannel(bare), '—')
})

test('可触达渠道: 决策人层级字段也能触发（顶层为空时）', () => {
  const { buildReachabilityChannel } = loadLeadExport()
  const dmOnly = {
    id: 10,
    company: 'DM Only Ltd.',
    decisionMakers: [{ name: 'A', title: 'CTO', email: 'a@dm.com', phone: '', source: 'x', confidenceScore: 50 }],
  }
  assert.equal(buildReachabilityChannel(dmOnly), '邮件')
})

test('字段组: 默认全选时表头与 LEAD_EXPORT_HEADERS 一致（不改变既有行为）', () => {
  const { LEAD_EXPORT_HEADERS, buildLeadExportHeaders, DEFAULT_EXPORT_GROUPS } = loadLeadExport()
  const headers = buildLeadExportHeaders(DEFAULT_EXPORT_GROUPS)
  assert.equal(headers.length, LEAD_EXPORT_HEADERS.length)
  headers.forEach((name, i) => {
    assert.equal(name, LEAD_EXPORT_HEADERS[i], `默认全选第 ${i} 列应一致`)
  })
})

test('字段组: 按勾选裁剪后行长度与表头仍严格一致（防错位）', () => {
  const { buildLeadExportRow, buildLeadExportHeaders } = loadLeadExport()
  const groups = ['core', 'reachability']
  const headers = buildLeadExportHeaders(groups)
  const row = buildLeadExportRow(sampleLead, groups)
  assert.equal(row.length, headers.length, '裁剪后行与表头列数不一致 → CSV 会错位')
  assert.ok(headers.includes('可触达渠道'), '勾选 reachability 后应含「可触达渠道」列')
  assert.ok(!headers.includes('数据来源'), '未勾选 trailing 不应含「数据来源」列')
})

test('字段组: 空勾选时输出空表头（调用方须拦截）', () => {
  const { buildLeadExportHeaders, buildLeadExportRow } = loadLeadExport()
  assert.equal(buildLeadExportHeaders([]).length, 0)
  assert.equal(buildLeadExportRow(sampleLead, []).length, 0)
})
