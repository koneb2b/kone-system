const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

/* P1 修复守护测试（2026-10-09 全项目审计后的体验/合规类缺陷）。
 *
 * 诚实边界：P1-10 是**运行时断言**（真正执行纯函数）；其余为**源码结构断言**
 * （只验「修复代码在不在」，不验运行时行为）—— 这些改动分布在 JSX 组件内部，
 * 无可用测试接缝。结构断言的价值在防回退。
 */

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

/* ───────────── P1-10：审批邮箱等级（运行时）───────────── */

const gradePath = path.join(repoRoot, 'src', 'lib', 'approval-grade.ts')
const loadGrade = () => {
  const transpiled = ts.transpileModule(fs.readFileSync(gradePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: gradePath,
  }).outputText
  const moduleObj = { exports: {} }
  const ctx = vm.createContext({ module: moduleObj, exports: moduleObj.exports, require, console })
  new vm.Script(transpiled, { filename: gradePath }).runInContext(ctx)
  return moduleObj.exports
}

test('P1-10: 命中决策人时使用其真实邮箱等级', () => {
  const { resolveEmailVerificationGrade } = loadGrade()
  const grade = resolveEmailVerificationGrade({
    email: 'jane@acme.com',
    decisionMakers: [{ email: 'jane@acme.com', emailGrade: 'risky' }],
  })
  assert.equal(grade, 'risky', 'P1-10：应取决策人的真实等级，而非硬编码 verified')
})

test('P1-10: 无匹配决策人时诚实降级为 unverified（不得谎报 verified）', () => {
  const { resolveEmailVerificationGrade, DEFAULT_EMAIL_VERIFICATION_GRADE } = loadGrade()
  const grade = resolveEmailVerificationGrade({
    email: 'nobody@unknown.com',
    decisionMakers: [{ email: 'other@acme.com', emailGrade: 'verified' }],
  })
  assert.equal(grade, 'unverified', 'P1-10 回归：未验证邮箱绝不能被标为 verified（合规风险）')
  assert.equal(DEFAULT_EMAIL_VERIFICATION_GRADE, 'unverified', '默认值应与云端一致')
})

test('P1-10: 邮箱为空时降级为 unverified', () => {
  const { resolveEmailVerificationGrade } = loadGrade()
  assert.equal(resolveEmailVerificationGrade({}), 'unverified')
  assert.equal(resolveEmailVerificationGrade({ email: '   ' }), 'unverified')
})

test('P1-10: 邮箱匹配对大小写与空白不敏感', () => {
  const { resolveEmailVerificationGrade } = loadGrade()
  const grade = resolveEmailVerificationGrade({
    email: '  Jane@Acme.COM ',
    decisionMakers: [{ email: 'jane@acme.com', emailGrade: 'catch_all' }],
  })
  assert.equal(grade, 'catch_all', 'P1-10：匹配应归一化大小写与空白')
})

test('P1-10: 决策人无 emailGrade 时降级（不继承空值）', () => {
  const { resolveEmailVerificationGrade } = loadGrade()
  const grade = resolveEmailVerificationGrade({
    email: 'jane@acme.com',
    decisionMakers: [{ email: 'jane@acme.com' }],
  })
  assert.equal(grade, 'unverified')
})

test('P1-10: leads-table 不得硬编码 emailVerificationGrade', () => {
  const src = read('src/components/leads-table.tsx')
  assert.ok(
    !/emailVerificationGrade:\s*'verified'/.test(src),
    "P1-10 回归：不得硬编码 'verified'（会覆盖云端的 unverified 诚实默认值）",
  )
  assert.match(src, /resolveEmailVerificationGrade\(lead\)/, 'P1-10：应调用判定函数')
})

/* ───────────── P1-3：来源筛选（源码结构断言）───────────── */

test('P1-3: 来源筛选不得保留硬编码死选项', () => {
  const src = read('src/components/leads-management.tsx')
  for (const dead of ['LinkedIn', 'Trade Show', 'AI Search']) {
    assert.ok(
      !new RegExp(`<SelectItem value="${dead}"`).test(src),
      `P1-3 回归：硬编码选项「${dead}」永不匹配真实 source 值（死选项）`,
    )
  }
})

test('P1-3: 来源筛选项必须从数据动态派生', () => {
  const src = read('src/components/leads-management.tsx')
  assert.match(src, /const sourceOptions = useMemo/, 'P1-3：应有动态派生的 sourceOptions')
  assert.match(src, /sourceOptions\.map\(/, 'P1-3：选项应渲染自 sourceOptions')
})

/* ───────────── P1-12：配额口径（源码结构断言）───────────── */

test('P1-12: 总配额必须与总用量同口径（不得只取首个智能体）', () => {
  const src = read('src/components/agents-panel.tsx')
  assert.ok(
    !/totalLimit = agents\[0\]\?\.dailyLimit/.test(src),
    'P1-12 回归：totalLimit 取 agents[0].dailyLimit 会与 Σ dailyUsed 口径不一致（显示如 12/5）',
  )
  assert.match(
    src,
    /const totalLimit = agents\.reduce\(\(sum, a\) => sum \+ a\.dailyLimit, 0\)/,
    'P1-12：totalLimit 应为各智能体配额之和',
  )
})

/* ───────────── P1-1 / P1-2：危险操作二次确认（源码结构断言）───────────── */

test('P1-1: 删除线索必须经确认对话框', () => {
  const src = read('src/components/leads-management.tsx')
  assert.match(src, /const \[pendingDelete, setPendingDelete\]/, 'P1-1：应有待删除态')
  assert.match(src, /const confirmDeleteLead = async/, 'P1-1：应有独立的确认执行函数')
  assert.match(src, /确认删除/, 'P1-1：确认对话框应有明确的「确认删除」按钮文案')
})

test('P1-2: 云端群发必须经确认对话框', () => {
  const src = read('src/components/automation-workflow.tsx')
  assert.match(src, /const \[confirmSendOpen, setConfirmSendOpen\]/, 'P1-2：应有群发确认态')
  assert.match(src, /确认提交/, 'P1-2：确认对话框应有明确的「确认提交」按钮文案')
  // 原实现按钮直接 `void handleStartCampaign()` —— 必须改为先开确认框
  const onClickBlock = src.match(/onClick=\{\(\) => \{[\s\S]{0,600}?setConfirmSendOpen\(true\)[\s\S]{0,200}?\}\}/)
  assert.ok(onClickBlock, 'P1-2：群发按钮应改为打开确认框而非直接发送')
})

/* ───────────── P1-5：导出口径（源码结构断言）───────────── */

test('P1-5: 导出必须用全量筛选结果，而非受显示上限约束的列表', () => {
  const src = read('src/components/leads-table.tsx')
  assert.match(src, /const filteredLeads = useMemo/, 'P1-5：应抽出全量筛选结果')
  assert.match(
    src,
    /buildLeadExportCsv\(filteredLeads\)/,
    'P1-5 回归：导出用 displayLeads 只会导出 50 条（与线索管理入口口径不一致）',
  )
  assert.match(src, /filteredLeads\.slice\(0, LEADS_TABLE_DISPLAY_LIMIT\)/, 'P1-5：显示上限应只作用于渲染')
})

/* ───────────── P1-7 / P1-9：账号链路（源码结构断言）───────────── */

test('P1-7: 邮箱账号健康检查必须读 accounts.email.* 路径', () => {
  const src = read('electron/services/sandbox-service.ts')
  assert.match(src, /cfg\.accounts\?\.email/, 'P1-7 回归：读顶层 user_config.smtpHost 会恒判「已断开」')
  assert.match(src, /emailCfg\?\.smtpHost/, 'P1-7：SMTP 主机应优先取 accounts.email.smtpHost')
})

test('P1-9: 账号列表必须持久化（重启不清空）', () => {
  const src = read('electron/services/sandbox-service.ts')
  assert.match(src, /const SANDBOX_ACCOUNTS_CONFIG_KEY/, 'P1-9：应有独立的持久化 key')
  assert.match(src, /const persistSandboxAccounts = /, 'P1-9：应有落盘函数')
  assert.match(src, /const hydrateSandboxAccounts = /, 'P1-9：应有恢复函数')
  assert.match(src, /hydrateSandboxAccounts\(store\)/, 'P1-9：注册时必须恢复账号列表')
  const persistCalls = (src.match(/persistSandboxAccounts\(\)/g) || []).length
  assert.ok(persistCalls >= 2, `P1-9：connect 与 disconnect 后都应落盘（实际 ${persistCalls} 处）`)
})

/* ───────────── P1-11：前端门禁与升级引导（源码结构断言）───────────── */

test('P1-11: cloud_send 类能力必须有统一的前端门禁与升级引导', () => {
  const src = read('src/components/automation-workflow.tsx')
  assert.match(src, /const requireCloudSend = useCallback/, 'P1-11：应有统一门禁函数')
  assert.match(src, /requireCloudSend\('邮箱清洗'\)/, 'P1-11：邮箱清洗应受门禁保护')
  assert.match(src, /requireCloudSend\('域名信誉检测'\)/, 'P1-11：域名检测应受门禁保护')
  assert.match(src, /requireCloudSend\('追踪状态刷新'\)/, 'P1-11：追踪刷新应受门禁保护')
})

/* ───────────── P1-6：未保存改动不丢失（源码结构断言）───────────── */

test('P1-6: 卸载时必须执行待落盘的改动，而非仅 clearTimeout', () => {
  const src = read('src/components/system-settings.tsx')
  assert.match(src, /const pendingPersistRef = useRef/, 'P1-6：应记录待落盘动作')
  assert.match(
    src,
    /clearTimeout\(persistTimeoutRef\.current\)[\s\S]{0,400}?pendingPersistRef\.current\?\.\(\)/,
    'P1-6 回归：cleanup 只 clearTimeout 会静默丢弃防抖窗口内的改动',
  )
  assert.match(src, /pendingPersistRef\.current = runPersist/, 'P1-6：schedulePersist 应记录待落盘动作')
})

/* ───────────── P1-8 / P1-4：诚实化（源码结构断言）───────────── */

test('P1-8: 社媒账号连接不得谎报「已激活」', () => {
  const src = read('src/components/accounts-management.tsx')
  assert.match(src, /平台登录未接入/, 'P1-8：应如实说明社媒登录尚未接入')
  assert.match(src, /if \(isEmailType\) \{/, 'P1-8：邮箱与社媒的提示文案应区分')
})

test('P1-4: 「分析」按钮不得在线索已存在时弹「已保存」', () => {
  const src = read('src/components/leads-table.tsx')
  assert.ok(!/title: '已保存'/.test(src), 'P1-4 回归：点「分析」却提示「已保存」属语义错位')
  assert.match(src, /title: '已同步线索'/, 'P1-4：仅在真正新增时提示')
})
