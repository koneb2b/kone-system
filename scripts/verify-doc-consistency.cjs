#!/usr/bin/env node
/**
 * verify-doc-consistency.cjs — 规范文档与代码的一致性门禁（CI P0-9）
 *
 * 目的：把「文档漂移」变成可机械校验的 CI 失败项，落实 ARCH-STANDARDS §16.5：
 *   "CI must fail on broken references, stale function names, duplicate normative
 *    definitions, schema/example drift."
 *
 * 校验项：
 *   1. 强制读链完整性（AGENTS.md 声明的文档必须真实存在）
 *   2. 过时函数名（权威文档中不得出现代码里不存在的符号，勘误行除外）
 *   3. 宪法常量与代码常量一致（kone-PRD §0.3 ↔ search-service.ts）
 *   4. 架构红线在 ARCH-STANDARDS 中可查（并发 2 / 3000 字符）
 *   5. 归档墓碑桩不得复活（已被 kone-PRD 声明清除）
 *
 * 用法：node scripts/verify-doc-consistency.cjs
 * 退出码：0 = 通过；1 = 存在漂移（CI 必须判红）
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

/** 承担强制约束的活规范（权威层 + 流程角色层 + 运维层） */
const ACTIVE_DOCS = [
  'kone-PRD.md',
  'PROJECT-PRD.md',
  'ARCH-STANDARDS.md',
  'CLOUD-COLLABORATION-DELIVERY.md',
  'PROVIDER-CAPABILITY.md',
  'AGENTS.md',
  'GLOSSARY.md',
  'STATE-MACHINES.md',
  'FIELD-DICTIONARY.md',
  'CHANGELOG.md',
  'V1.2-商业版交付与运维手册.md',
  '.opencode/agents/ui-agent.md',
  '.opencode/agents/ipc-agent.md',
  '.opencode/agents/system-blueprint.md',
  '.opencode/agents/build-agent.md',
]

/** 时点快照：允许保留历史函数名，不参与裁决 */
const SNAPSHOT_PATTERNS = [
  /^KONE-V1\.3-.*\.md$/,
  /^KONE-V1\.3-规范文档与架构数据交互深度梳理报告\.md$/,
  /^\d{4}-\d{2}-\d{2}\//,
  /^archive\//,
]

/** 代码中不存在的历史符号（勘误行允许提及） */
const STALE_SYMBOLS = ['computeLeadScore', 'enrichLeadWebsite', 'emitDecisionMakers']

/** 勘误标记：出现这些词的同一行视为"明确纠正历史错误"，不判失败 */
const ERRATUM_MARKERS = ['勘误', '不存在', '臆造', '早期版本', '严禁凭旧名', 'stale function']

/** 已被 kone-PRD §0.2 声明清除的墓碑桩，不得复活 */
const REMOVED_TOMBSTONES = ['KONE-商用成熟度深度审计报告.md', 'V1.2-to-V1.3-alignment.md']

const failures = []
const notes = []

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

const isSnapshot = (rel) => SNAPSHOT_PATTERNS.some((re) => re.test(rel.replace(/\\/g, '/')))

// ── 1. 强制读链完整性 ───────────────────────────────────────
function checkDocumentChain() {
  const agents = read('AGENTS.md')
  const chainSection = agents.split('## Mandatory Document Chain')[1]?.split('##')[0] || ''
  const referenced = [...chainSection.matchAll(/`([^`]+\.md)`/g)].map((m) => m[1])
  const unique = [...new Set(referenced)]

  if (unique.length === 0) {
    failures.push('[文档链] AGENTS.md 未声明任何文档路径')
    return
  }
  for (const rel of unique) {
    if (!exists(rel)) failures.push(`[文档链] AGENTS.md 引用了不存在的文档: ${rel}`)
  }
  // 两份 SSOT 必须在链内（2026-09-22 补入，防止再次漏列）
  for (const must of ['PROVIDER-CAPABILITY.md', 'CLOUD-COLLABORATION-DELIVERY.md']) {
    if (!unique.includes(must)) failures.push(`[文档链] 强制读链漏列 SSOT: ${must}`)
  }
  notes.push(`文档链共 ${unique.length} 份，全部存在`)
}

// ── 2. 过时函数名 ───────────────────────────────────────────
function checkStaleSymbols() {
  let scanned = 0
  for (const rel of ACTIVE_DOCS) {
    if (!exists(rel) || isSnapshot(rel)) continue
    scanned += 1
    const lines = read(rel).split(/\r?\n/)
    lines.forEach((line, idx) => {
      for (const symbol of STALE_SYMBOLS) {
        if (!line.includes(symbol)) continue
        if (ERRATUM_MARKERS.some((marker) => line.includes(marker))) continue
        failures.push(`[过时函数名] ${rel}:${idx + 1} 出现代码中不存在的符号 "${symbol}"（需勘误或删除）`)
      }
    })
  }
  notes.push(`扫描 ${scanned} 份活规范，过时符号白名单 ${STALE_SYMBOLS.length} 个`)
}

// ── 3. 宪法常量 ↔ 代码常量 ──────────────────────────────────
const CONSTANT_PAIRS = [
  // [kone-PRD 中必须出现的字面量, search-service.ts 中的常量名, 期望值]
  ['SEARCH_LLM_SCORE_LIMIT', 'SEARCH_LLM_SCORE_LIMIT', 50],
  ['SEARCH_TARGETED_LEAD_LIMIT', 'SEARCH_TARGETED_LEAD_LIMIT', 50],
  ['MAX_SEARCH_CANDIDATES', 'MAX_SEARCH_CANDIDATES', 200],
  ['SEARCH_CHANNEL_FETCH_LIMIT', 'SEARCH_CHANNEL_FETCH_LIMIT', 100],
  ['SEARCH_LLM_CONCURRENCY', 'SEARCH_LLM_CONCURRENCY', 2],
  ['SEARCH_ENRICH_CONCURRENCY', 'SEARCH_ENRICH_CONCURRENCY', 2],
  ['SEARCH_FANOUT_CONCURRENCY', 'SEARCH_FANOUT_CONCURRENCY', 3],
  ['MAX_WEBSITE_TEXT_FOR_LLM', 'MAX_WEBSITE_TEXT_FOR_LLM', 3000],
]

function checkConstitutionalConstants() {
  const prd = read('kone-PRD.md')
  const searchSource = read('electron/services/search-service.ts')
  // 取 §0.3 到下一个水平分隔线之间的内容（注意：表格分隔行含 "---"，
  // 不能用 split('---')，否则常量表会被截断成空块）。
  const constantsBlock = prd.match(/### 0\.3[\s\S]*?(?=\r?\n---\r?\n)/)?.[0] || ''
  if (!constantsBlock) {
    failures.push('[常量] 无法定位 kone-PRD §0.3 宪法常量表')
    return
  }

  for (const [docName, codeName, expected] of CONSTANT_PAIRS) {
    const codeMatch = searchSource.match(new RegExp(`${codeName}\\s*=\\s*([0-9_]+)`))
    if (!codeMatch) {
      failures.push(`[常量] search-service.ts 缺少常量 ${codeName}`)
      continue
    }
    const codeValue = Number(codeMatch[1].replace(/_/g, ''))
    if (codeValue !== expected) {
      failures.push(`[常量] ${codeName} 代码值为 ${codeValue}，门禁期望 ${expected}（若为有意变更，请同步常量表与门禁）`)
    }
    if (!constantsBlock.includes(docName)) {
      failures.push(`[常量] kone-PRD §0.3 常量表缺少 ${docName}（权威源不得缺失硬约束定义）`)
      continue
    }
    const rowLine = constantsBlock.split(/\r?\n/).find((l) => l.includes(docName)) || ''
    if (!rowLine.includes(String(expected))) {
      failures.push(`[常量] kone-PRD §0.3 中 ${docName} 未标注权威值 ${expected}`)
    }
  }

  // 管道阈值：文档 60 ↔ 代码 60
  if (!/matchScore\s*<\s*60/.test(read('electron/services/agent-pipeline.ts'))) {
    failures.push('[常量] agent-pipeline.ts 的管道阈值不再是 matchScore >= 60')
  }
  if (!prd.includes('matchScore >= 60')) {
    failures.push('[常量] kone-PRD 未声明管道阈值 matchScore >= 60')
  }
  notes.push(`宪法常量比对 ${CONSTANT_PAIRS.length} 项 + 管道阈值`)
}

// ── 4. 架构红线可查 ─────────────────────────────────────────
function checkArchitectureRedlines() {
  const arch = read('ARCH-STANDARDS.md')
  const redlines = [
    ['并发上限 2', /maximum concurrent jobs must remain fixed at `2`/i],
    ['正文截断 3000', /no more than `3000` characters/i],
    ['Provider 隔离 allSettled', /Promise\.allSettled/],
  ]
  for (const [label, re] of redlines) {
    if (!re.test(arch)) failures.push(`[架构红线] ARCH-STANDARDS.md 缺少红线声明: ${label}`)
  }
  notes.push(`架构红线 ${redlines.length} 项`)
}

// ── 5. 墓碑桩不得复活 ───────────────────────────────────────
function checkTombstonesRemoved() {
  for (const rel of REMOVED_TOMBSTONES) {
    if (exists(rel)) {
      failures.push(`[归档] ${rel} 已被 kone-PRD §0.2 声明清除，不得重新出现`)
    }
  }
  notes.push('归档墓碑桩检查通过')
}

// ── 6. 活规范内的文档引用必须存在（防断链） ──────────────────
/** 允许的"非文件"形态：通配、省略号、占位符 */
const NON_FILE_REF = /[*…<>{}|]/

function checkDocumentReferences() {
  let checked = 0
  for (const rel of ACTIVE_DOCS) {
    if (!exists(rel)) continue
    const lines = read(rel).split(/\r?\n/)
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(/`([A-Za-z0-9._\-\u4e00-\u9fff/]+\.md)`/g)) {
        const target = m[1]
        if (NON_FILE_REF.test(target)) continue
        if (target.startsWith('/') || target.includes('..')) continue
        if (target.endsWith('.md') === false) continue
        checked += 1
        if (!exists(target)) {
          failures.push(`[断链] ${rel}:${idx + 1} 引用了不存在的文档: ${target}`)
        }
      }
    })
  }
  notes.push(`文档交叉引用校验 ${checked} 处`)
}

// ── 7. 工具入口文件不得复述数值红线 ─────────────────────────
/**
 * `.clinerules` 是 AI 工具入口，历史上完整复制了宪法（24 处数值复述 + 过期的
 * 8 份读链）。防止其再次膨胀为第二规范源：只允许写流程与指针。
 */
const TOOL_ENTRY_FILES = ['.clinerules']

function checkToolEntryFiles() {
  for (const rel of TOOL_ENTRY_FILES) {
    if (!exists(rel)) continue
    const source = read(rel)
    if (!/不是规范事实源|本文不复制任何数值/.test(source)) {
      failures.push(`[工具入口] ${rel} 必须声明自身非规范源且不复述数值`)
    }
    for (const marker of ['3000', '4G-8G', 'matchScore >= 60']) {
      if (source.includes(marker)) {
        failures.push(`[工具入口] ${rel} 复述了数值红线 "${marker}" —— 数值只允许在 kone-PRD §零.3 定义`)
      }
    }
    if (!/CLOUD-COLLABORATION-DELIVERY\.md/.test(source) || !/PROVIDER-CAPABILITY\.md/.test(source)) {
      failures.push(`[工具入口] ${rel} 的读链必须包含两份 SSOT（云端协同 / Provider 能力）`)
    }
  }
  notes.push(`工具入口文件校验 ${TOOL_ENTRY_FILES.length} 份`)
}

// ── 执行 ────────────────────────────────────────────────────
checkDocumentChain()
checkStaleSymbols()
checkConstitutionalConstants()
checkArchitectureRedlines()
checkTombstonesRemoved()
checkDocumentReferences()
checkToolEntryFiles()

console.log('── 规范文档一致性校验 ──────────────────────────')
for (const note of notes) console.log(`  · ${note}`)

if (failures.length > 0) {
  console.error('\n❌ 检测到规范漂移：')
  for (const item of failures) console.error(`  - ${item}`)
  console.error(`\n共 ${failures.length} 项，CI 必须判红。`)
  process.exit(1)
}

console.log('\n✅ 规范文档一致性校验通过')
