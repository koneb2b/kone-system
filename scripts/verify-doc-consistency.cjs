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
 *   3. 宪法常量与代码常量一致（kone-PRD §0.3 ↔ search/constants.ts）
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
  /^docs\/archive\//,
]

/**
 * 文档治理迁移解析（2026-10-19）：
 * 时点快照已从仓库根迁移到 docs/archive/snapshots/，但 CHANGELOG 等历史条目
 * 仍以旧根路径引用。为保留历史原文不改写，校验时按以下规则解析到新位置。
 */
const ARCHIVE_DIR = 'docs/archive/snapshots/'
const resolveMovedDoc = (target) => {
  const base = path.posix.basename(target.replace(/\\/g, '/'))
  if (!target.includes('/')) return ARCHIVE_DIR + base
  if (target.startsWith('archive/')) return ARCHIVE_DIR + base
  return null
}

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
  // [kone-PRD 中必须出现的字面量, search/constants.ts 中的常量名, 期望值]
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
  // O1 拆分（P7b）：宪法常量已从 search-service.ts 迁至 search/constants.ts，读取源随之迁移。
  const searchSource = read('electron/services/search/constants.ts')
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
      failures.push(`[常量] search/constants.ts 缺少常量 ${codeName}`)
      continue
    }
    const codeValue = Number(codeMatch[1].replace(/_/g, ''))
    if (codeValue !== expected) {
      failures.push(
        `[常量] ${codeName} 代码值为 ${codeValue}，门禁期望 ${expected}（若为有意变更，请同步常量表与门禁）`,
      )
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

  /* §0.3 其余数值常量的守护（2026-09-25 补入）。
     此前门禁仅覆盖 search/constants.ts 的 8 项，其余常量漂移只能靠人工发现——
     实际已发生一次：HTTP 熔断阈值写成 `> 3`（第 4 次才断开），与权威值差 1 次。
     元组：[文档锚点(须出现在 §0.3), 代码常量名, 期望值, 代码源文件, 文档中应出现的字面量] */
  const EXTRA_CONSTANT_PAIRS = [
    ['TRIAL_DURATION_DAYS', 'TRIAL_DURATION_DAYS', 7, 'electron/services/license-service.ts', '7'],
    ['SEARCH_PAGE_SIZE', 'SEARCH_PAGE_SIZE', 30, 'src/hooks/use-search-engine.ts', '30'],
    ['SEARCH_LLM_TIMEOUT_MS', 'SEARCH_LLM_TIMEOUT_MS', 20000, 'electron/services/search/constants.ts', '20s'],
    ['WEBSITE_PROBE_TIMEOUT_MS', 'WEBSITE_PROBE_TIMEOUT_MS', 15000, 'electron/services/search/constants.ts', '15s'],
    ['PDF 白皮书导出上限', 'TRIAL_PDF_EXPORT_LIMIT', 3, 'electron/services/export-service.ts', '3'],
    ['HTTP 熔断', 'FAILURE_THRESHOLD', 3, 'electron/utils/http-client.ts', '连续 3 次'],
    ['HTTP 熔断', 'CIRCUIT_OPEN_MS', 60000, 'electron/utils/http-client.ts', '60 秒'],
  ]
  for (const [docAnchor, codeName, expected, sourceFile, docToken] of EXTRA_CONSTANT_PAIRS) {
    let src
    try {
      src = read(sourceFile)
    } catch {
      failures.push(`[常量] 无法读取 ${sourceFile}（守护 ${codeName}）`)
      continue
    }
    const codeMatch = src.match(new RegExp(`${codeName}\\s*=\\s*([0-9_]+)`))
    if (!codeMatch) {
      failures.push(`[常量] ${sourceFile} 缺少常量 ${codeName}`)
      continue
    }
    const codeValue = Number(codeMatch[1].replace(/_/g, ''))
    if (codeValue !== expected) {
      failures.push(
        `[常量] ${codeName} 代码值为 ${codeValue}，门禁期望 ${expected}（若为有意变更，请同步 kone-PRD §0.3 与门禁）`,
      )
    }
    if (!constantsBlock.includes(docAnchor)) {
      failures.push(`[常量] kone-PRD §0.3 缺少锚点「${docAnchor}」（守护 ${codeName}）`)
      continue
    }
    const rowLine = constantsBlock.split(/\r?\n/).find((l) => l.includes(docAnchor)) || ''
    if (!rowLine.includes(docToken)) {
      failures.push(`[常量] kone-PRD §0.3 中「${docAnchor}」未标注权威值 ${docToken}`)
    }
  }

  // 管道阈值：文档 60 ↔ 代码 60
  if (!/matchScore\s*<\s*60/.test(read('electron/services/agent-pipeline.ts'))) {
    failures.push('[常量] agent-pipeline.ts 的管道阈值不再是 matchScore >= 60')
  }
  if (!prd.includes('matchScore >= 60')) {
    failures.push('[常量] kone-PRD 未声明管道阈值 matchScore >= 60')
  }
  notes.push(`宪法常量比对 ${CONSTANT_PAIRS.length} 项 + 扩展 ${EXTRA_CONSTANT_PAIRS.length} 项 + 管道阈值`)
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

  /* 代码符合性检查（2026-09-25 补入）：此前本函数**只校验文档是否声明**红线，
     不校验代码是否遵守——红线可能"写在纸上、代码里却违反"。以下为可机械判定的项。 */
  const codeChecks = [
    [
      'Provider 隔离必须用 Promise.allSettled（单源失败不得中断主搜索）',
      'electron/services/provider-registry.ts',
      /Promise\.allSettled/,
    ],
    ['并发上限常量必须存在且为 2', 'electron/services/search/constants.ts', /SEARCH_LLM_CONCURRENCY\s*=\s*2\b/],
    ['正文截断常量必须存在且为 3000', 'electron/services/search/constants.ts', /MAX_WEBSITE_TEXT_FOR_LLM\s*=\s*3000\b/],
  ]
  for (const [label, file, re] of codeChecks) {
    let src
    try {
      src = read(file)
    } catch {
      failures.push(`[架构红线] 无法读取 ${file}（${label}）`)
      continue
    }
    if (!re.test(src)) failures.push(`[架构红线] ${file} 未满足代码红线: ${label}`)
  }

  notes.push(`架构红线 ${redlines.length} 项（文档）+ ${codeChecks.length} 项（代码符合性）`)
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
        if (exists(target)) continue
        const relocated = resolveMovedDoc(target)
        if (relocated && exists(relocated)) continue
        failures.push(`[断链] ${rel}:${idx + 1} 引用了不存在的文档: ${target}`)
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

// ── 8. 版本口径一致性（package.json ↔ CHANGELOG）─────────────
/**
 * 版本口径的唯一约定：**`package.json.version` = CHANGELOG 最新条目版本**。
 *
 * 为什么必须门禁：`electron-builder` 从 `package.json` 取版本决定**安装包文件名**，
 * 而 `CHANGELOG.md` 是"版本变更时间线的唯一事实源"。二者漂移会导致
 * **「安装包名与内容不符」**（客户 / 支持 / 自动更新三方口径错位）。
 *
 * 历史教训：`package.json` 长期停在 `1.3.15` 而 CHANGELOG 已推进到 `1.4.x`，
 * **无任何门禁发现** —— 期间产出的每一个安装包都被错误标注为 `1.3.15`。
 *
 * 同时校验 CHANGELOG 条目**逆序（最新在前）**：
 * 曾发生 `[1.4.15]` 被孤立在文件顶部，时间线被破坏（按"最新在前"阅读会得到错误结论）。
 */
function checkVersionConsistency() {
  const pkg = JSON.parse(read('package.json'))
  const changelog = read('CHANGELOG.md')
  const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((match) => match[1])
  if (versions.length === 0) {
    failures.push('[版本口径] CHANGELOG.md 未找到任何 `## [x.y.z]` 版本条目')
    return
  }
  const latest = versions[0]
  if (pkg.version !== latest) {
    failures.push(
      `[版本口径] package.json.version (${pkg.version}) ≠ CHANGELOG 最新条目 (${latest})` +
        ' —— 安装包名取自 package.json，漂移会造成「包名与内容不符」',
    )
  }
  const toNum = (v) => v.split('.').map(Number)
  for (let i = 1; i < versions.length; i += 1) {
    const [a1, a2, a3] = toNum(versions[i - 1])
    const [b1, b2, b3] = toNum(versions[i])
    const prevHigher = a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3
    if (!prevHigher) {
      failures.push(
        `[版本口径] CHANGELOG 条目必须**逆序（最新在前）**：` +
          `${versions[i - 1]} 之后出现 ${versions[i]}（未严格递减，疑似条目被错放）`,
      )
      break
    }
  }
  notes.push(`版本口径一致：package.json ${pkg.version} = CHANGELOG 最新（共 ${versions.length} 条，逆序校验通过）`)
}

// ── 9. PRD 版本真相（kone-PRD §0.1 / PROJECT-PRD 头部 ↔ package.json）──
/**
 * 为什么必须门禁：两份 PRD 是 Agent 强制读链的**顶层裁决锚点**。
 * 历史教训（2026-10-19 审计）：kone-PRD §0.1 与 PROJECT-PRD 头部长期写 `1.3.0`，
 * 而 `package.json` 已到 `1.4.36`；原有门禁只校验 package.json ↔ CHANGELOG，
 * 导致读链第一页给出错误版本，Agent 据此实施会产出与真实版本不符的结论。
 */
function checkVersionTruthInPRDs() {
  const pkg = JSON.parse(read('package.json'))
  const targets = [
    { file: 'kone-PRD.md', re: /当前发布版本\s*=\s*`(\d+\.\d+\.\d+)`/ },
    { file: 'PROJECT-PRD.md', re: /当前发布版本为\s*`(\d+\.\d+\.\d+)`/ },
  ]
  for (const { file, re } of targets) {
    if (!exists(file)) {
      failures.push(`[版本真相] 缺少 ${file}`)
      continue
    }
    const m = read(file).match(re)
    if (!m) {
      failures.push(`[版本真相] ${file} 未找到版本声明（期望形如「当前发布版本 = \`x.y.z\`」）`)
      continue
    }
    if (m[1] !== pkg.version) {
      failures.push(
        `[版本真相] ${file} 声明 ${m[1]} ≠ package.json ${pkg.version} —— 读链裁决锚点必须与 package.json 同步`,
      )
    }
  }
  notes.push(`PRD 版本真相校验 ${targets.length} 份`)
}

// ── 10. DataSourceType 枚举一致（代码 ↔ 三份文档）─────────
/**
 * 为什么必须门禁：`DataSourceType` 是 Provider 溯源与前端徽标的契约枚举。
 * 历史教训（2026-10-19 审计）：代码已 9 值（含 `serper`），而 kone-PRD 两处写 7/8 值、
 * PROJECT-PRD 写 7 值、FIELD-DICTIONARY 写 8 值 —— 新增 Provider 无法在文档链内自洽。
 * 本检查以 `src/shared/ipc-contracts.ts` 为唯一事实源，逐份比对枚举集合与计数声明。
 */
function checkDataSourceTypeParity() {
  const contracts = read('src/shared/ipc-contracts.ts')
  const union = contracts.match(/export type DataSourceType\s*=([\s\S]*?)\n\s*\n/)
  if (!union) {
    failures.push('[枚举一致] src/shared/ipc-contracts.ts 未找到 `export type DataSourceType` 定义')
    return
  }
  const codeValues = [...union[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  const targets = [
    { file: 'kone-PRD.md', anchor: /export type DataSourceType[^\n]*/, count: /`DataSourceType`\s*(\d+)\s*个变体/ },
    { file: 'PROJECT-PRD.md', anchor: /`dataSourceType`[^\n]*google_maps[^\n]*/ },
    { file: 'FIELD-DICTIONARY.md', anchor: /^`'google_maps'[^\n]*/m, count: /## 3\. `DataSourceType`（(\d+) 值/ },
  ]
  for (const { file, anchor, count } of targets) {
    const text = read(file)
    const line = text.match(anchor)
    if (!line) {
      failures.push(`[枚举一致] ${file} 未找到 DataSourceType 枚举行`)
      continue
    }
    const docValues = [...line[0].matchAll(/[`']([a-z_]+)[`']/g)].map((m) => m[1])
    const missing = codeValues.filter((v) => !docValues.includes(v))
    const extra = docValues.filter((v) => !codeValues.includes(v))
    if (missing.length || extra.length) {
      failures.push(
        `[枚举一致] ${file} 与代码不一致：缺少 [${missing.join(', ') || '无'}]，多出 [${extra.join(', ') || '无'}]` +
          `（代码 ${codeValues.length} 值：${codeValues.join(', ')}）`,
      )
    }
    if (count) {
      const declared = text.match(count)
      if (!declared) {
        failures.push(`[枚举一致] ${file} 未找到枚举数量声明（应写明 ${codeValues.length}）`)
      } else if (Number(declared[1]) !== codeValues.length) {
        failures.push(`[枚举一致] ${file} 声明 ${declared[1]} 值 ≠ 代码 ${codeValues.length} 值`)
      }
    }
  }
  notes.push(`DataSourceType 枚举一致（代码 ${codeValues.length} 值 ↔ 3 份文档）`)
}

// ── 11. 现行文档不得把旧安装包 / 旧代际写成当前 ────────────────
/**
 * 为什么必须门禁：2026-10-19 全量审计发现，活跃文档仍可能残留旧安装包名
 * （如验收手册正文写 `Kone-Intellect-Setup-1.3.0.exe`）或把 V1.3 写成当前代际。
 * 历史原文允许保留，但同一行必须带「已过期 / 成文时 / 历史 / 旧版」等显式标注。
 */
function checkStaleCurrentClaims() {
  const pkg = JSON.parse(read('package.json'))
  const currentFacing = [
    ...ACTIVE_DOCS.filter((f) => f !== 'CHANGELOG.md'),
    'README.md',
    'KONE-V1.3-干净机器验收手册-2026-09-25.md',
    'KONE-V1.3-审批门禁端到端验证清单-2026-10-07.md',
  ]
  const allowMarkers = ['已过期', '成文时', '历史', '旧版', 'superseded', '历史证据', '不逐项重验']
  const installerRe = /Kone-Intellect-Setup-(\d+\.\d+\.\d+)\.exe/g
  const oldGenerationRe = /V1\.3[^\n]{0,12}(当前主线|当前版本|当前代际)|不存在[^\n]{0,10}V1\.4/
  let scanned = 0
  for (const file of [...new Set(currentFacing)]) {
    if (!exists(file)) continue
    scanned += 1
    const lines = read(file).split(/\r?\n/)
    lines.forEach((line, index) => {
      if (allowMarkers.some((marker) => line.includes(marker))) return
      for (const match of line.matchAll(installerRe)) {
        if (match[1] !== pkg.version) {
          failures.push(
            `[现行版本] ${file}:${index + 1} 引用旧安装包 ${match[0]} ≠ ${pkg.version}` +
              `（历史原文请同行标注「已过期/成文时」）`,
          )
        }
      }
      if (oldGenerationRe.test(line)) {
        failures.push(
          `[现行版本] ${file}:${index + 1} 仍把 V1.3 写作当前代际：${line.trim().slice(0, 80)}`,
        )
      }
    })
  }
  notes.push(`现行文档旧版本残留校验（${scanned} 份）`)
}

// ── 执行 ────────────────────────────────────────────────────
checkDocumentChain()
checkStaleSymbols()
checkConstitutionalConstants()
checkArchitectureRedlines()
checkTombstonesRemoved()
checkDocumentReferences()
checkToolEntryFiles()
checkVersionConsistency()
checkVersionTruthInPRDs()
checkDataSourceTypeParity()
checkStaleCurrentClaims()

console.log('── 规范文档一致性校验 ──────────────────────────')
for (const note of notes) console.log(`  · ${note}`)

if (failures.length > 0) {
  console.error('\n❌ 检测到规范漂移：')
  for (const item of failures) console.error(`  - ${item}`)
  console.error(`\n共 ${failures.length} 项，CI 必须判红。`)
  process.exit(1)
}

console.log('\n✅ 规范文档一致性校验通过')
