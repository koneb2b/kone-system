#!/usr/bin/env node
/**
 * verify-release-gate.cjs — 发布门禁静态校验（docs/release-gate.md 的机械化子集）
 *
 * 设计原则（2026-10-20，吸取 AGENT.GET_STATUS 过度约束事故的教训）：
 *   1. 只 HARD-FAIL 「确定性判定 + 当前 HEAD 必过 + 失败即真阻断」的项；
 *   2. 依赖语义/自然语言判断的项（破冰、connect、message…）一律 WARN，
 *      只打印命中位置供人工裁决 —— **绝不作为门禁**；
 *   3. 不重复实现既有门禁，而是**断言它们仍被接线**（防静默移除）；
 *   4. 需要打包产物或外部环境的项（security-audit / smoke / signature）
 *      **不进本脚本** —— 干净检出没有产物，硬接会让门禁误炸。
 *
 * 用法：node scripts/verify-release-gate.cjs
 * 退出码：0 = 通过；1 = 存在硬阻断
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const has = (rel) => fs.existsSync(path.join(ROOT, rel))

const hard = []
const warn = []

function record(list, id, name, ok, detail) {
  list.push({ id, name, ok, detail })
}

function check(id, name, fn) {
  try {
    const result = fn()
    record(hard, id, name, result.ok, result.detail)
  } catch (error) {
    record(hard, id, name, false, `执行异常：${error.message}`)
  }
}

function warnCheck(id, name, fn) {
  try {
    const detail = fn()
    if (detail) warn.push({ id, name, detail })
  } catch (error) {
    warn.push({ id, name, detail: `检查异常（不影响门禁）：${error.message}` })
  }
}

/* ── G5-SEC1：私钥不得被版本控制 ─────────────────────────── */
check('SEC1', '私钥文件未在版本控制中', () => {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((line) => /\.pem$/i.test(line.trim()))
  return {
    ok: tracked.length === 0,
    detail: tracked.length === 0 ? '0 个 .pem 被跟踪' : `被跟踪的私钥：${tracked.join(', ')}`,
  }
})

/* ── G1-P1 / P3：Provider id 唯一性 + 时间隔离 ─────────────── */
const providerDir = 'electron/services/providers'

function providerFiles() {
  return fs
    .readdirSync(path.join(ROOT, providerDir))
    .filter((name) => name.endsWith('-provider.ts'))
    .sort()
}

check('P1', 'Provider id 唯一', () => {
  const entries = providerFiles().map((file) => {
    const source = read(`${providerDir}/${file}`)
    const matched = source.match(/readonly\s+id\s*=\s*'([^']+)'/)
    return { file, id: matched ? matched[1] : null }
  })

  const missing = entries.filter((entry) => !entry.id).map((entry) => entry.file)
  if (missing.length > 0) {
    return { ok: false, detail: `未声明 readonly id：${missing.join(', ')}` }
  }

  const byId = new Map()
  for (const entry of entries) {
    byId.set(entry.id, [...(byId.get(entry.id) || []), entry.file])
  }
  const duplicates = [...byId.entries()].filter(([, files]) => files.length > 1)
  return {
    ok: duplicates.length === 0,
    detail:
      duplicates.length === 0
        ? `${entries.length} 个 provider id 全部唯一`
        : duplicates.map(([id, files]) => `${id} ← ${files.join(' + ')}`).join('; '),
  }
})

check('P3', '已实现 Provider 含时间隔离', () => {
  const offenders = []
  const exempt = []
  for (const file of providerFiles()) {
    const source = read(`${providerDir}/${file}`)
    /* 显式弃用的 provider 不发起任何异步采集，时间隔离不适用。
       判定：源码含 DEPRECATED 标记，且 isAvailable() 恒返回 false。 */
    const deprecated =
      /DEPRECATED/i.test(source) &&
      /isAvailable\s*\([^)]*\)\s*:\s*boolean\s*\{\s*return\s+false\s*\}/.test(source)
    if (deprecated) {
      exempt.push(file.replace('-provider.ts', ''))
      continue
    }
    const hasMyJobId = /myJobId/.test(source)
    const hasActiveJobCheck = /isKnownActiveJobId|getCurrentActiveJobId/.test(source)
    if (!hasMyJobId || !hasActiveJobCheck) {
      offenders.push(`${file}(myJobId=${hasMyJobId}, activeJob=${hasActiveJobCheck})`)
    }
  }
  return {
    ok: offenders.length === 0,
    detail:
      offenders.length === 0
        ? `全部已实现 provider 均含 myJobId + 活跃 job 校验${exempt.length > 0 ? `（豁免：${exempt.join(', ')}）` : ''}`
        : offenders.join('; '),
  }
})

/* ── G2-A4：AgentTask 时间隔离 ────────────────────────────── */
check('A4', 'AgentTask 时间隔离', () => {
  const source = read('electron/services/agent-pipeline.ts')
  const ok = /taskRunId/.test(source) && /currentPipelineRunId/.test(source)
  return { ok, detail: ok ? 'taskRunId + currentPipelineRunId 均存在' : '缺少 taskRunId 或 currentPipelineRunId' }
})

/* ── G2-A2 / A3：Agent 合规能力存在性 ─────────────────────── */
check('A2', 'WhatsApp session 状态机完整', () => {
  const source = read('electron/services/agents/whatsapp-agent.ts')
  const states = ['qr_ready', 'expired', 'rate_limited'].filter((token) => source.includes(token))
  return {
    ok: states.length === 3,
    detail: states.length === 3 ? 'qr_ready / expired / rate_limited 均存在' : `缺失：${['qr_ready', 'expired', 'rate_limited'].filter((t) => !states.includes(t)).join(', ')}`,
  }
})

check('A3', 'Email DNS 软锁定判定存在', () => {
  const source = read('electron/services/agents/email-agent.ts')
  const tokens = ['spf', 'dkim', 'dmarc'].filter((token) => new RegExp(token, 'i').test(source))
  return {
    ok: tokens.length === 3,
    detail: tokens.length === 3 ? 'SPF / DKIM / DMARC 判定均存在' : `缺失：${['spf', 'dkim', 'dmarc'].filter((t) => !tokens.includes(t)).join(', ')}`,
  }
})

/* ── G4-S1 / S2：搜索时间隔离与多源隔离 ───────────────────── */
check('S1', '搜索 JobID 时间隔离', () => {
  const source = read('electron/services/search-service.ts')
  const ok = /myJobId/.test(source) && /isKnownActiveJobId|getCurrentActiveJobId/.test(source)
  return { ok, detail: ok ? 'myJobId + 活跃 job 校验均存在' : '缺少 myJobId 或活跃 job 校验' }
})

check('S2', '并行采集使用 Promise.allSettled', () => {
  const targets = ['electron/services/provider-registry.ts', 'electron/services/search-service.ts'].filter(has)
  const missing = targets.filter((file) => !/Promise\.allSettled/.test(read(file)))
  return {
    ok: missing.length === 0,
    detail: missing.length === 0 ? `已覆盖：${targets.join(', ')}` : `未使用 allSettled：${missing.join(', ')}`,
  }
})

/* ── 门禁接线断言：既有门禁不得被静默移除 ─────────────────── */
check('WIRE', '既有门禁仍被接线', () => {
  const pkg = JSON.parse(read('package.json'))
  const scripts = pkg.scripts || {}
  const requiredScripts = [
    'verify:consistency',
    'verify:release-gate',
    'verify:ipc',
    'test:unit',
    'test:cloud',
    'test:ipc',
    'test:e2e-smoke',
    // 交付前单独执行，必须"存在"但**不在** test 链内
    'test:security-audit',
    'verify:signature',
    'test:smoke',
  ]
  const missing = requiredScripts.filter((name) => !scripts[name])
  const testChain = String(scripts.test || '')
  const requiredInChain = ['verify:consistency', 'verify:release-gate', 'test:unit', 'test:cloud', 'test:ipc', 'test:e2e-smoke']
  const droppedFromChain = requiredInChain.filter((name) => !testChain.includes(`npm run ${name}`))
  const problems = []
  if (missing.length > 0) problems.push(`缺少脚本：${missing.join(', ')}`)
  if (droppedFromChain.length > 0) problems.push(`test 链丢失：${droppedFromChain.join(', ')}`)
  return {
    ok: problems.length === 0,
    detail: problems.length === 0 ? `${requiredScripts.length} 个脚本齐备，test 链 6 环完整` : problems.join('；'),
  }
})

/* ── WARN-only：语义类判据（不参与门禁） ──────────────────── */
const CLAIM_KEYWORDS = ['全自动', '24小时无感', '破冰', '自动化交付', '全自动化', '自动跟进']

warnCheck('C1/C2', 'UI 声明类关键词（需人工裁决，非门禁）', () => {
  const componentDir = path.join(ROOT, 'src', 'components')
  if (!fs.existsSync(componentDir)) return '未找到 src/components'
  const hits = []
  for (const file of fs.readdirSync(componentDir).filter((name) => name.endsWith('.tsx'))) {
    const lines = read(`src/components/${file}`).split(/\r?\n/)
    lines.forEach((line, index) => {
      const keyword = CLAIM_KEYWORDS.find((token) => line.includes(token))
      if (keyword) hits.push(`src/components/${file}:${index + 1} [${keyword}] ${line.trim().slice(0, 60)}`)
    })
  }
  return hits.length === 0 ? '' : `${hits.length} 处命中（含合规提示文案，历史上均判为合法）：\n      ` + hits.join('\n      ')
})

warnCheck('A1', 'LinkedIn 自动触达 API 模式（需人工裁决，非门禁）', () => {
  const source = read('electron/services/agents/linkedin-agent.ts')
  const patterns = ['clickConnect', 'sendMessage', 'sendInvite', 'addFriend', 'createConnection']
  const found = patterns.filter((pattern) => new RegExp(pattern, 'i').test(source))
  return found.length === 0 ? '' : `命中：${found.join(', ')}`
})

warnCheck('P2', '已弃用 / 占位 Provider（不得对外宣传）', () => {
  const deprecated = providerFiles().filter((file) => /DEPRECATED/i.test(read(`${providerDir}/${file}`)))
  return deprecated.length === 0 ? '' : deprecated.map((file) => file.replace('-provider.ts', '')).join(', ')
})

/* ── 输出 ─────────────────────────────────────────────────── */
console.log('\n── 发布门禁静态校验（docs/release-gate.md）──────────')
for (const item of hard) {
  console.log(`  ${item.ok ? '✅' : '❌'} ${item.id.padEnd(5)} ${item.name} — ${item.detail}`)
}
if (warn.length > 0) {
  console.log('\n  ⚠️  WARN（仅提示，不阻断；需人工裁决）')
  for (const item of warn) {
    console.log(`     · ${item.id.padEnd(6)} ${item.name}\n      ${item.detail}`)
  }
}

const failed = hard.filter((item) => !item.ok)
console.log('')
if (failed.length > 0) {
  console.error(`❌ 发布门禁未通过：${failed.length} 项硬阻断（${failed.map((item) => item.id).join(', ')}）`)
  process.exitCode = 1
} else {
  console.log(`✅ 发布门禁静态校验通过（HARD ${hard.length} 项全绿，WARN ${warn.length} 项待人工裁决）`)
  console.log('   提醒：DELIVERY 层（security-audit / smoke / packaged-premium / verify:signature --strict / 干净机器 20 项）不在本脚本内，发版前必须单独执行。')
}
