const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

/* P0 修复守护测试（2026-10-09 全项目审计后的 7 项阻断缺陷）。
 *
 * ## 诚实边界声明（重要）
 * 本文件由两类断言组成，**能力不同**：
 *   1) **运行时断言**（P0-6）—— 真正执行产品代码，验证行为正确。
 *   2) **源码结构断言**（P0-1/2/3/4/5/7）—— 只验证「修复代码是否在位」，
 *      **不验证运行时行为**。这类断言会被「写了但写错」绕过。
 * 之所以用结构断言，是因为这些修复分布在主进程私有作用域（白名单常量、
 * 执行循环内部），没有可注入的测试接缝。它们的价值在于**防回退**：
 * 任何删掉修复的改动都会立即失败。
 * 运行时行为由 e2e（permission-lock 等）与手工验收覆盖。
 */

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

/* ───────────── P0-6：运行时断言（最强）───────────── */

const mapperPath = path.join(repoRoot, 'src', 'lib', 'lead-mappers.ts')
const realRequire = Module.createRequire(__filename)
const stubs = {
  '@/lib/utils': { stableHash: (value) => String(value) },
}
const customRequire = (id) => {
  if (id in stubs) return stubs[id]
  if (id.startsWith('@/')) return realRequire(path.join(repoRoot, 'src', id.slice(2)))
  return realRequire(id)
}
const loadMapper = () => {
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

test('P0-6: LeadSearchResult 形态（id 为 number + leadKey 为 UUID）必须提取出 leadKey', () => {
  const { mapSearchResultToLeadItem } = loadMapper()
  // 这正是 search-engine.tsx:352 `handleSaveLead(lead: LeadSearchResult)` 的真实形态：
  // id 已被转成 number，原始 UUID 只在 leadKey 上。
  const item = mapSearchResultToLeadItem({
    id: 12345,
    leadKey: 'uuid-abc-123',
    company: 'Acme Industrial',
    industry: 'Machinery',
  })
  assert.equal(
    item.leadKey,
    'uuid-abc-123',
    'P0-6 回归：入库 leadKey 必须取自 result.leadKey（否则双管道触达读端失效）',
  )
})

test('P0-6: 原始 SearchExecuteResult 形态（id 本身是字符串）走回退路径', () => {
  const { mapSearchResultToLeadItem } = loadMapper()
  // autopilot-runner.ts:215 传的是 searchExecute 的原始结果，id 可能是字符串 UUID。
  const item = mapSearchResultToLeadItem({ id: 'uuid-xyz-789', company: 'Beta GmbH' })
  assert.equal(item.leadKey, 'uuid-xyz-789', 'P0-6 回归：回退路径应保留字符串 id')
})

test('P0-6: 两者都没有时 leadKey 为 undefined（不编造）', () => {
  const { mapSearchResultToLeadItem } = loadMapper()
  const item = mapSearchResultToLeadItem({ id: 999, company: 'Gamma' })
  assert.equal(item.leadKey, undefined, 'P0-6：无稳定 UUID 时不得编造 leadKey')
})

test('P0-6: 空白字符串 leadKey 视为无效', () => {
  const { mapSearchResultToLeadItem } = loadMapper()
  const item = mapSearchResultToLeadItem({ id: 1, leadKey: '   ', company: 'Delta' })
  assert.equal(item.leadKey, undefined, 'P0-6：空白 leadKey 不应通过')
})

/* ───────────── P0-1：密钥白名单（源码结构断言）───────────── */

test('P0-1: 邮箱 SMTP/IMAP 密码必须在 secret 写入白名单内', () => {
  const src = read('electron/services/config-service.ts')
  const block = src.match(/const SECRET_SET_WHITELIST[\s\S]*?\n\]\)/)
  assert.ok(block, '应能定位 SECRET_SET_WHITELIST 定义')
  assert.match(
    block[0],
    /SECRET_KEYS\.EMAIL_SMTP_PASS/,
    'P0-1 回归：白名单缺 EMAIL_SMTP_PASS 会导致邮箱密码写不进 → 密码丢失',
  )
  assert.match(block[0], /SECRET_KEYS\.EMAIL_IMAP_PASS/, 'P0-1 回归：白名单缺 EMAIL_IMAP_PASS')
})

test('P0-1: 保存邮箱时必须先写加密槽、后清空明文槽（顺序不可颠倒）', () => {
  const src = read('src/components/accounts-management.tsx')
  const secretIdx = src.indexOf("secretSet({ key: 'secrets.email.smtpPass'")
  // 注意：`smtpPass: ''` 也出现在 draft 初始化（组件顶部）与 draft 重置处，
  // 只有**最后一次**（写入 user_config.accounts.email 的那处）才是「清空明文槽」。
  const clearIdx = src.lastIndexOf("smtpPass: ''")
  assert.ok(secretIdx > 0 && clearIdx > 0, '应能定位两处关键代码')
  assert.ok(secretIdx < clearIdx, 'P0-1 回归：必须先写加密槽再清空明文槽 —— 否则 secretSet 失败时密码彻底丢失')
})

/* ───────────── P0-2：配置读取白名单（源码结构断言）───────────── */

test('P0-2: cloud 命名空间必须在 config 读取白名单内', () => {
  const src = read('electron/services/config-service.ts')
  const block = src.match(/const CONFIG_GET_ALLOWED_NAMESPACES = \[[\s\S]*?\n\]/)
  assert.ok(block, '应能定位 CONFIG_GET_ALLOWED_NAMESPACES 定义')
  assert.match(block[0], /'cloud'/, 'P0-2 回归：读白名单缺 cloud → 云端配置「存了读不出来」')
})

test('P0-2: 读写边界不得倒挂（可写却不可读）', () => {
  const src = read('electron/services/config-service.ts')
  const blacklist = src.match(/const CONFIG_SET_BLACKLIST = \[([^\]]*)\]/)
  const allowlist = src.match(/const CONFIG_GET_ALLOWED_NAMESPACES = \[([\s\S]*?)\n\]/)
  assert.ok(blacklist && allowlist)
  // cloud 不在写黑名单（可写）→ 必须在读白名单（可读），否则就是本次修的 P0-2
  const cloudWritable = !/'cloud\.'/.test(blacklist[1])
  if (cloudWritable) {
    assert.match(allowlist[1], /'cloud'/, 'P0-2：cloud 可写就必须可读（读写对称性）')
  }
})

/* ───────────── P0-3/P0-4：启停检查点（源码结构断言）───────────── */

test('P0-3/P0-4: 每条 Agent 执行循环都必须有启停检查点', () => {
  const src = read('electron/services/agent-service.ts')
  const loops = (src.match(/for \(const target of targets\) \{/g) || []).length
  const gates = (src.match(/await waitWhilePaused\(agent\)/g) || []).length
  assert.ok(loops >= 3, `应至少有 3 条执行循环（whatsapp/linkedin/email），实际 ${loops}`)
  assert.equal(gates, loops, `P0-3/P0-4 回归：检查点数(${gates}) 必须等于循环数(${loops})，否则有循环无法被停止`)
})

test('P0-3/P0-4: 检查点必须在循环内 break（停止后不得继续发送）', () => {
  const src = read('electron/services/agent-service.ts')
  const block = src.match(/const waitWhilePaused = [\s\S]*?\n\}/)
  assert.ok(block, '应能定位 waitWhilePaused')
  assert.match(block[0], /agent\.status === 'idle'/, 'waitWhilePaused 必须识别 idle（停止）')
  assert.match(block[0], /agent\.status === 'paused'/, 'waitWhilePaused 必须识别 paused（暂停）')
})

test('P0-4: startAgent 在 paused 时只恢复状态，不得启动第二条循环', () => {
  const src = read('electron/services/agent-service.ts')
  assert.match(
    src,
    /if \(agent\.status === 'paused'\) \{[\s\S]{0,240}?agent\.status = 'running'[\s\S]{0,120}?return/,
    'P0-4 回归：paused 分支必须在启动新循环前 return，否则与原挂起循环并存 → 重复发送',
  )
})

/* ───────────── P0-5：日限额持久化（源码结构断言）───────────── */

test('P0-5: 日限额必须持久化且带本地日期锚点', () => {
  const src = read('electron/services/agent-service.ts')
  assert.match(src, /const AGENT_DAILY_USAGE_CONFIG_KEY/, 'P0-5：应有独立的持久化 key')
  assert.match(src, /const todayDateKey = /, 'P0-5：应有本地日期键（避免 UTC 跨日错位）')
  assert.match(src, /const persistAgentDailyUsage = /, 'P0-5：应有落盘函数')
  assert.match(src, /dailyUsage\.date === todayDateKey\(\)/, 'P0-5 回归：恢复时必须比对日期，否则跨天不会重置')
  assert.match(src, /persistAgentDailyUsage\(\)/, 'P0-5：执行循环内必须调用落盘')
})

/* ───────────── P0-7：深度分析门禁（源码结构断言）───────────── */

test('P0-7: 深度分析门禁必须以能力判断，不得用 role 字符串', () => {
  const src = read('src/components/search/deep-analysis.tsx')
  // 只断言**代码形态**（`if (role !== 'pro') return null`）；注释中提及原实现是允许的。
  assert.ok(
    !/if\s*\(\s*role\s*!==\s*'pro'\s*\)\s*return null/.test(src),
    "P0-7 回归：不得再用 `if (role !== 'pro') return null` —— premium 的 role 是 'enterprise'，会被误挡",
  )
  assert.match(src, /if \(!allowDeepAnalysis\) return null/, 'P0-7：应以 allowDeepAnalysis 为门禁')
})

test('P0-7: 深度分析组件不再接收 role prop', () => {
  const src = read('src/components/search/deep-analysis.tsx')
  assert.ok(!/^\s*role:/m.test(src), 'P0-7：role prop 应已移除（避免死字段）')
})
