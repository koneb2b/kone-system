#!/usr/bin/env node
/**
 * 云端链路安全门禁（2026-10-07 新增）
 *
 * ── 为什么需要这个脚本 ──────────────────────────────────────────────
 * 2026-10-07 全项目文档与代码交叉审计发现 5 项 P0，其中两项**现有门禁全部漏过**：
 *
 *   · P0-2 跨租户越权：`UPDATE outreach SET status='failed' WHERE status='pending'`
 *     缺 workspace 与 email 谓词 → 任一租户任一邮箱退订即清空全平台待发队列。
 *   · P0-1 看板字段全空：跨进程响应被 `as PollOutreachResult` 裸强转，
 *     TS 的 as 仅编译期生效、运行时字段名不变 → 除同名字段外全部 undefined。
 *
 * 漏过的原因很明确：
 *   - `verify-doc-consistency.cjs` 只做字面值比对与引用断链检查；
 *   - `tsc` 无法发现运行时字段名不匹配；
 *   - `npm run test:unit` 不覆盖跨进程契约形状。
 *
 * 本脚本补上这两类**结构性**检查，使同类缺陷在 CI 阶段即可被拦截，
 * 而不必依赖人工审计。
 *
 * ── 检查项 ────────────────────────────────────────────────────────
 *   1. 危险 SQL：kone-cloud 的 UPDATE / DELETE 必须带租户或主键谓词。
 *   2. 跨进程裸强转：对云端响应禁止 `as <跨进程类型>`，必须走显式映射函数。
 *
 * ── 豁免 ─────────────────────────────────────────────────────────
 *   确属全局语义的语句（如全局抑制名单扫描）可在同一条 SQL 模板字符串内
 *   写 `safe-global:` 注释显式豁免，并在注释中说明理由。
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.cwd()
const CLOUD_SRC = path.join(ROOT, 'kone-cloud', 'src')
const CF_SERVICE = path.join(ROOT, 'electron', 'services', 'cloudflare-service.ts')

const failures = []
const notes = []

/* ── 1. 危险 SQL 谓词检查 ─────────────────────────────────────── */

/** 写操作必须包含以下任一谓词，才认为作用域被限定 */
const SQL_PREDICATE =
  /workspace_id|lead_id|resend_id|normalized_email|provider_message_id|\bid\s*=\s*\?|ON\s+CONFLICT/i

/** 显式豁免标记（写在 SQL 模板字符串内或紧邻上一行注释） */
const SQL_EXEMPT = /safe-global:/

function checkDangerousSql() {
  if (!fs.existsSync(CLOUD_SRC)) {
    notes.push('未找到 kone-cloud/src，跳过危险 SQL 检查')
    return
  }

  let scanned = 0
  let stmts = 0
  for (const file of fs.readdirSync(CLOUD_SRC)) {
    if (!file.endsWith('.ts')) continue
    const full = path.join(CLOUD_SRC, file)
    const src = fs.readFileSync(full, 'utf8')
    scanned++

    // 提取所有反引号模板字符串（SQL 均以模板字符串书写）
    const blocks = src.match(/`[^`]*`/g) || []
    for (const block of blocks) {
      if (!/\b(UPDATE\s+[A-Za-z_]+|DELETE\s+FROM\s+[A-Za-z_]+)/i.test(block)) continue
      stmts++
      if (SQL_EXEMPT.test(block)) continue
      if (SQL_PREDICATE.test(block)) continue

      const preview = block.replace(/\s+/g, ' ').trim().slice(0, 90)
      failures.push(
        `[云端安全] ${file} 存在无租户/主键谓词的写操作，可能波及全平台数据：\n` +
          `            ${preview}…\n` +
          `            若确为全局语义，请在 SQL 模板内加 \`safe-global:\` 注释并说明理由。`,
      )
    }
  }
  notes.push(`危险 SQL 检查：扫描 ${scanned} 个源文件、${stmts} 条写操作`)
}

/* ── 2. 跨进程裸强转检查 ──────────────────────────────────────── */

/** 跨进程（Worker → 本地）响应类型：必须经显式映射，禁止裸 as */
const CROSS_PROCESS_TYPES = [
  'PollOutreachResult',
  'ReportOutreachReplyResponse',
  'CloudDashboardStats',
  'CloudPollOutreachData',
]

function checkCrossProcessCast() {
  if (!fs.existsSync(CF_SERVICE)) {
    notes.push('未找到 cloudflare-service.ts，跳过跨进程强转检查')
    return
  }
  const src = fs.readFileSync(CF_SERVICE, 'utf8')
  let hits = 0

  // 逐行剥离注释后再检查——否则「说明为何不能裸 as」的注释文字会被误判为违规代码。
  // （本脚本首版即踩此坑：修复说明里的 `as PollOutreachResult` 被当成真实强转。）
  const lines = src.split('\n')
  for (const [idx, line] of lines.entries()) {
    const trimmed = line.trim()
    // 整行注释：跳过
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    // 行尾注释：截断
    const code = line.split('//')[0]
    for (const type of CROSS_PROCESS_TYPES) {
      // 匹配 `as <Type>`，但不匹配函数返回类型标注（=> Promise<Type>）
      if (!new RegExp(`\\bas\\s+${type}\\b`).test(code)) continue
      hits++
      failures.push(
        `[云端安全] cloudflare-service.ts:${idx + 1} 对跨进程响应使用了裸 \`as ${type}\`。\n` +
          `            TS 的 as 仅编译期生效，运行时字段名仍是 snake_case → 字段静默变 undefined。\n` +
          `            请改为显式映射函数（参考 mapOutreachRow）。`,
      )
    }
  }
  notes.push(`跨进程强转检查：${CROSS_PROCESS_TYPES.length} 个类型，命中 ${hits} 处裸 as`)
}

/* ── 执行 ─────────────────────────────────────────────────────── */

console.log('── 云端链路安全门禁 ──────────────────────────')
checkDangerousSql()
checkCrossProcessCast()

for (const note of notes) console.log(`  · ${note}`)

if (failures.length > 0) {
  console.error('')
  for (const f of failures) console.error(`❌ ${f}`)
  console.error(`\n❌ 云端链路安全门禁未通过（${failures.length} 项）`)
  process.exit(1)
}

console.log('✅ 云端链路安全门禁通过')
