// ───────────────────────────────────────────────────────────────
// Phase 2.9 · 云端二次门禁测试（AGENTS.md 宪法第 5 条落地验证）
//
// 覆盖 CLOUD-COLLABORATION-DELIVERY.md §8 的门禁 ⑤⑥⑦⑧⑨ 负向路径。
//
// 设计说明：
//   门禁由 `env.APPROVAL_GATE_ENABLED` 控制，**生产默认关闭**
//   （必须等本地审批 UI 就绪才能开启，否则用户无审批入口 → 投递全被拒）。
//   因此本文件**不通过 SELF.fetch**（它用 vitest 配置里的固定 env，门禁为关闭态），
//   而是直接调用 worker 的 default export，注入 `APPROVAL_GATE_ENABLED='true'` 的 env，
//   从而在不影响既有 35 个 HTTP 测试的前提下验证门禁行为。
// ───────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:workers'
import worker, { bumpDeliveryQuota, maybeTripCircuit } from '../src/worker.js'

/** 门禁开启的 env：spread 保留 D1 等真实 binding，仅覆盖开关 */
const gatedEnv = { ...env, APPROVAL_GATE_ENABLED: 'true' } as unknown as Parameters<typeof worker.fetch>[1]
/** 门禁关闭的 env：验证向后兼容 */
const openEnv = { ...env, APPROVAL_GATE_ENABLED: 'false' } as unknown as Parameters<typeof worker.fetch>[1]

const CTX = {} as ExecutionContext

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function setupWorkspace(name: string): Promise<{ token: string; workspaceId: string }> {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const token = `tok-${name}-${uniq}`
  const workspaceId = `ws-${name}-${uniq}`
  await env.DB.prepare(`INSERT INTO workspaces (id, name, api_token_hash) VALUES (?, ?, ?)`)
    .bind(workspaceId, name, await sha256Hex(token))
    .run()
  return { token, workspaceId }
}

function bearer(token: string): Headers {
  return new Headers({
    Authorization: `Bearer ${token}`,
    'X-Schema-Version': '1.0.0',
    'Content-Type': 'application/json',
  })
}

type SeedOpts = {
  status?: string
  emailGrade?: string
  domain?: string
  ownerMachineId?: string | null
  protectionUntil?: string | null
}

async function seedLead(workspaceId: string, opts: SeedOpts = {}) {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const companyId = `co-${uniq}`
  const contactId = `ct-${uniq}`
  const leadId = `ld-${uniq}`

  await env.DB.prepare(
    `INSERT INTO companies (id, workspace_id, normalized_domain, owner_machine_id, protection_until) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(companyId, workspaceId, opts.domain ?? `example-${uniq}.com`, opts.ownerMachineId ?? null, opts.protectionUntil ?? null)
    .run()

  await env.DB.prepare(
    `INSERT INTO contacts (id, workspace_id, name, normalized_email, verification_grade) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(contactId, workspaceId, 'Test Contact', `contact-${uniq}@example.com`, opts.emailGrade ?? 'verified')
    .run()

  await env.DB.prepare(
    `INSERT INTO leads (id, workspace_id, company_id, contact_id, status, local_ref_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(leadId, workspaceId, companyId, contactId, opts.status ?? 'approved', `ref-${uniq}`, `idem-${uniq}`)
    .run()

  return { leadId, companyId, contactId, email: `contact-${uniq}@example.com` }
}

/** 写入一条 approved 审批记录 */
async function approveLead(
  workspaceId: string,
  leadId: string,
  draftVersion: number,
  grade = 'verified',
  exception: string | null = null,
): Promise<string> {
  const approvalId = `ap-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await env.DB.prepare(
    `INSERT INTO approvals (id, workspace_id, lead_id, approver_machine_id, decision, approved_at, draft_version, email_verification_grade, manual_exception_reason)
     VALUES (?, ?, ?, 'machine-test', 'approved', ?, ?, ?, ?)`,
  )
    .bind(approvalId, workspaceId, leadId, new Date().toISOString(), draftVersion, grade, exception)
    .run()
  return approvalId
}

async function queue(
  targetEnv: Parameters<typeof worker.fetch>[1],
  token: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: { success?: boolean; code?: string; data?: Record<string, unknown> } }> {
  const res = await worker.fetch(
    new Request('https://api.example.com/v1/outreach/queue', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify(payload),
    }),
    targetEnv,
    CTX,
  )
  return { status: res.status, body: (await res.json()) as never }
}

describe('Phase 2.9 · 云端二次门禁', () => {
  it('门禁关闭时不拦截（向后兼容，保护未就绪的本地审批 UI）', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-off')
    const { leadId } = await seedLead(workspaceId)
    const r = await queue(openEnv, token, { leadId, subject: 's', body: 'b' })
    expect(r.status).toBe(200)
    expect(r.body.data?.queued).toBe(true)
  })

  it('⑤ 撞单保护期内 → COMPANY_CONFLICT', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-collision')
    const future = new Date(Date.now() + 86400000).toISOString()
    const { leadId } = await seedLead(workspaceId, { ownerMachineId: 'other-machine', protectionUntil: future })
    await approveLead(workspaceId, leadId, 1)
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('COMPANY_CONFLICT')
  })

  it('⑥ 命中全局抑制 → SUPPRESSED', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-suppressed')
    const { leadId, email } = await seedLead(workspaceId)
    await env.DB.prepare(
      // source CHECK 仅允许 ('manual','webhook','system')；reason CHECK 见规范 §10
      `INSERT INTO suppressions (id, workspace_id, normalized_email, reason, source, added_at) VALUES (?, NULL, ?, 'one_click_unsubscribe', 'system', ?)`,
    )
      .bind(`sp-${Date.now()}`, email, new Date().toISOString())
      .run()
    await approveLead(workspaceId, leadId, 1)
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(403) // statusMap: SUPPRESSED → 403
    expect(r.body.code).toBe('SUPPRESSED')
  })

  it('⑦ 无审批记录 → APPROVAL_REQUIRED（宪法第 5 条核心）', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-no-approval')
    const { leadId } = await seedLead(workspaceId)
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('APPROVAL_REQUIRED')
  })

  it('⑦ 审批为 rejected 时不授权投递 → APPROVAL_REQUIRED', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-rejected')
    const { leadId } = await seedLead(workspaceId)
    await env.DB.prepare(
      `INSERT INTO approvals (id, workspace_id, lead_id, approver_machine_id, decision, approved_at, draft_version, email_verification_grade)
       VALUES (?, ?, ?, 'machine-test', 'rejected', ?, 1, 'verified')`,
    )
      .bind(`ap-rej-${Date.now()}`, workspaceId, leadId, new Date().toISOString())
      .run()
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('APPROVAL_REQUIRED')
  })

  it('⑦ 草稿版本不匹配 → DRAFT_VERSION_MISMATCH（旧批准不得授权新草稿）', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-draft')
    const { leadId } = await seedLead(workspaceId)
    await approveLead(workspaceId, leadId, 1)
    // 提交 draftVersion=2，但审批记录是 1 → 必须拒绝
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 2 })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('DRAFT_VERSION_MISMATCH')
  })

  it('⑦ 缺失 draftVersion → DRAFT_VERSION_MISMATCH', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-nodraft')
    const { leadId } = await seedLead(workspaceId)
    await approveLead(workspaceId, leadId, 1)
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b' })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('DRAFT_VERSION_MISMATCH')
  })

  it('⑧ 邮箱等级不足且无人工例外 → EMAIL_GRADE_INSUFFICIENT', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-grade')
    const { leadId } = await seedLead(workspaceId, { emailGrade: 'unverified' })
    await approveLead(workspaceId, leadId, 1, 'unverified', null)
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('EMAIL_GRADE_INSUFFICIENT')
  })

  it('⑧ 有审批人记录的人工例外 → 放行', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-grade-exception')
    const { leadId } = await seedLead(workspaceId, { emailGrade: 'unverified' })
    await approveLead(workspaceId, leadId, 1, 'unverified', '客户电话确认过该邮箱')
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(200)
  })

  it('⑨ 熔断开启 → CIRCUIT_OPEN', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-circuit')
    const { leadId } = await seedLead(workspaceId)
    await approveLead(workspaceId, leadId, 1)
    await env.DB.prepare(
      `INSERT INTO delivery_quota (workspace_id, today_key, sent_today, circuit_open_until) VALUES (?, ?, 0, ?)`,
    )
      .bind(workspaceId, new Date().toISOString().slice(0, 10), new Date(Date.now() + 3600000).toISOString())
      .run()
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(423) // statusMap: CIRCUIT_OPEN → 423 Locked
    expect(r.body.code).toBe('CIRCUIT_OPEN')
  })

  it('⑨ 超出日配额 → QUOTA_EXCEEDED', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-quota')
    const { leadId } = await seedLead(workspaceId)
    await approveLead(workspaceId, leadId, 1)
    await env.DB.prepare(
      `INSERT INTO delivery_quota (workspace_id, today_key, sent_today) VALUES (?, ?, 999)`,
    )
      .bind(workspaceId, new Date().toISOString().slice(0, 10))
      .run()
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(429)
    expect(r.body.code).toBe('QUOTA_EXCEEDED')
  })

  it('② 跨 workspace 的 leadId → LEAD_NOT_FOUND（不泄露存在性）', async () => {
    const a = await setupWorkspace('gate-tenant-a')
    const b = await setupWorkspace('gate-tenant-b')
    const { leadId } = await seedLead(b.workspaceId)
    await approveLead(b.workspaceId, leadId, 1)
    // 用 A 的 token 请求 B 的 lead
    const r = await queue(gatedEnv, a.token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('LEAD_NOT_FOUND')
  })

  it('正向：审批齐全且版本一致 → 200 且 queued', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-pass')
    const { leadId } = await seedLead(workspaceId)
    await approveLead(workspaceId, leadId, 3)
    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 3 })
    expect(r.status).toBe(200)
    expect(r.body.data?.queued).toBe(true)
    expect(r.body.data?.status).toBe('pending')
  })

  it('幂等：同一 lead 重复 queue 返回既有记录，不重复建行', async () => {
    const { token, workspaceId } = await setupWorkspace('gate-idempotent')
    const { leadId } = await seedLead(workspaceId)
    await approveLead(workspaceId, leadId, 1)
    const r1 = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    const r2 = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(r2.body.data?.idempotent).toBe(true)
    expect(r2.body.data?.id).toBe(r1.body.data?.id)
  })
})

describe('Phase 2.9 · POST /approvals', () => {
  it('写入审批记录并回写 lead 状态 + 审计事件', async () => {
    const { token, workspaceId } = await setupWorkspace('approval-create')
    const { leadId } = await seedLead(workspaceId, { status: 'pending_approval' })

    const res = await worker.fetch(
      new Request('https://api.example.com/v1/approvals', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({
          leadId,
          approverMachineId: 'machine-abc',
          decision: 'approved',
          draftVersion: 1,
          emailVerificationGrade: 'verified',
        }),
      }),
      gatedEnv,
      CTX,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: { approvalId: string; status: string } }
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('approved')

    // lead 状态与 approval_id 已回写
    const lead = await env.DB.prepare(`SELECT status, approval_id FROM leads WHERE id = ?`)
      .bind(leadId)
      .first<{ status: string; approval_id: string }>()
    expect(lead?.status).toBe('approved')
    expect(lead?.approval_id).toBe(body.data.approvalId)

    // 审计事件已写入（approval.created + lead.approved）
    const events = await env.DB.prepare(`SELECT type FROM events WHERE lead_id = ? ORDER BY id`)
      .bind(leadId)
      .all<{ type: string }>()
    const types = events.results.map((e) => e.type)
    expect(types).toContain('approval.created')
    expect(types).toContain('lead.approved')
  })

  it('rejected 决策回写 status=rejected', async () => {
    const { token, workspaceId } = await setupWorkspace('approval-reject')
    const { leadId } = await seedLead(workspaceId, { status: 'pending_approval' })
    const res = await worker.fetch(
      new Request('https://api.example.com/v1/approvals', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({
          leadId,
          approverMachineId: 'machine-abc',
          decision: 'rejected',
          draftVersion: 1,
          emailVerificationGrade: 'verified',
        }),
      }),
      gatedEnv,
      CTX,
    )
    expect(res.status).toBe(200)
    const lead = await env.DB.prepare(`SELECT status FROM leads WHERE id = ?`).bind(leadId).first<{ status: string }>()
    expect(lead?.status).toBe('rejected')
  })

  it('缺字段 → VALIDATION_ERROR', async () => {
    const { token } = await setupWorkspace('approval-invalid')
    const res = await worker.fetch(
      new Request('https://api.example.com/v1/approvals', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({ leadId: 'x', decision: 'approved' }),
      }),
      gatedEnv,
      CTX,
    )
    expect(res.status).toBe(400)
  })

  it('跨 workspace → LEAD_NOT_FOUND', async () => {
    const a = await setupWorkspace('approval-tenant-a')
    const b = await setupWorkspace('approval-tenant-b')
    const { leadId } = await seedLead(b.workspaceId, { status: 'pending_approval' })
    const res = await worker.fetch(
      new Request('https://api.example.com/v1/approvals', {
        method: 'POST',
        headers: bearer(a.token),
        body: JSON.stringify({
          leadId,
          approverMachineId: 'machine-abc',
          decision: 'approved',
          draftVersion: 1,
          emailVerificationGrade: 'verified',
        }),
      }),
      gatedEnv,
      CTX,
    )
    expect(res.status).toBe(404)
  })
})

// ───────────────────────────────────────────────────────────────
// 阶段 4 · 日配额与熔断的写入侧
//
// 背景：门禁 ⑨ 读 `delivery_quota` 判断配额与熔断，但此前**无人写入该表**
// → 配额检查永不触发（"看起来有保护、实际不生效"）。本组测试锁定写入侧行为。
// ───────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)

describe('Phase 2.9 阶段4 · 日配额与熔断写入侧', () => {
  it('首次投递写入当日配额行', async () => {
    const { workspaceId } = await setupWorkspace('quota-first')
    await bumpDeliveryQuota(gatedEnv, workspaceId, 'sent')
    const q = await env.DB.prepare(`SELECT today_key, sent_today FROM delivery_quota WHERE workspace_id = ?`)
      .bind(workspaceId)
      .first<{ today_key: string; sent_today: number }>()
    expect(q?.sent_today).toBe(1)
    expect(q?.today_key).toBe(today())
  })

  it('同日累加（不重置）', async () => {
    const { workspaceId } = await setupWorkspace('quota-accum')
    await bumpDeliveryQuota(gatedEnv, workspaceId, 'sent')
    await bumpDeliveryQuota(gatedEnv, workspaceId, 'sent')
    await bumpDeliveryQuota(gatedEnv, workspaceId, 'sent')
    const q = await env.DB.prepare(`SELECT sent_today FROM delivery_quota WHERE workspace_id = ?`)
      .bind(workspaceId)
      .first<{ sent_today: number }>()
    expect(q?.sent_today).toBe(3)
  })

  it('跨日自动重置全部计数', async () => {
    const { workspaceId } = await setupWorkspace('quota-reset')
    await env.DB.prepare(
      `INSERT INTO delivery_quota (workspace_id, today_key, sent_today, bounced_today, complained_today) VALUES (?, '2000-01-01', 99, 5, 2)`,
    )
      .bind(workspaceId)
      .run()

    await bumpDeliveryQuota(gatedEnv, workspaceId, 'sent')

    const q = await env.DB.prepare(
      `SELECT today_key, sent_today, bounced_today, complained_today FROM delivery_quota WHERE workspace_id = ?`,
    )
      .bind(workspaceId)
      .first<{ today_key: string; sent_today: number; bounced_today: number; complained_today: number }>()
    expect(q?.today_key).toBe(today())
    expect(q?.sent_today).toBe(1)
    expect(q?.bounced_today).toBe(0)
    expect(q?.complained_today).toBe(0)
  })

  it('退信率超阈值（>5%）自动开熔断', async () => {
    const { workspaceId } = await setupWorkspace('quota-trip')
    await env.DB.prepare(
      `INSERT INTO delivery_quota (workspace_id, today_key, sent_today, bounced_today) VALUES (?, ?, 100, 10)`,
    )
      .bind(workspaceId, today())
      .run()

    await maybeTripCircuit(gatedEnv, workspaceId)

    const q = await env.DB.prepare(`SELECT circuit_open_until FROM delivery_quota WHERE workspace_id = ?`)
      .bind(workspaceId)
      .first<{ circuit_open_until: string | null }>()
    expect(q?.circuit_open_until).toBeTruthy()
    expect(new Date(q!.circuit_open_until!).getTime()).toBeGreaterThan(Date.now())
  })

  it('退信率正常（1%）不开熔断', async () => {
    const { workspaceId } = await setupWorkspace('quota-ok')
    await env.DB.prepare(
      `INSERT INTO delivery_quota (workspace_id, today_key, sent_today, bounced_today) VALUES (?, ?, 100, 1)`,
    )
      .bind(workspaceId, today())
      .run()

    await maybeTripCircuit(gatedEnv, workspaceId)

    const q = await env.DB.prepare(`SELECT circuit_open_until FROM delivery_quota WHERE workspace_id = ?`)
      .bind(workspaceId)
      .first<{ circuit_open_until: string | null }>()
    expect(q?.circuit_open_until).toBeNull()
  })

  it('集成：写入侧累加达上限后，门禁 ⑨ 真实拒绝投递', async () => {
    const { token, workspaceId } = await setupWorkspace('quota-integration')
    const { leadId } = await seedLead(workspaceId)
    await approveLead(workspaceId, leadId, 1)

    // 通过真实写入路径把 sent_today 从 199 推到 200（= DAILY_SEND_LIMIT）
    await env.DB.prepare(`INSERT INTO delivery_quota (workspace_id, today_key, sent_today) VALUES (?, ?, 199)`)
      .bind(workspaceId, today())
      .run()
    await bumpDeliveryQuota(gatedEnv, workspaceId, 'sent')

    const r = await queue(gatedEnv, token, { leadId, subject: 's', body: 'b', draftVersion: 1 })
    expect(r.status).toBe(429)
    expect(r.body.code).toBe('QUOTA_EXCEEDED')
  })
})
