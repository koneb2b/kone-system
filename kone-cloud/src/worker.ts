// ───────────────────────────────────────────────────────────────
// Kone Cloud Worker · 主入口
// Aligned with: ARCH-STANDARDS.md §15 (10 hard boundaries)
//                CLOUD-COLLABORATION-DELIVERY.md §8 (Fail-Closed)
// ───────────────────────────────────────────────────────────────

import { hashToken, jsonResponse, errorResponse, generateId, nowUTC, normalizeEmail, normalizeDomain, parseJson, type ApiError, type ApiSuccess } from './utils.js'
import { authenticate } from './auth.js'
import { sendEmailViaResend } from './resend.js'

// ── Worker Bindings ──
export interface Env {
  DB: D1Database
  SCHEMA_VERSION: string
  // Phase 2: Resend 投递
  CRON_SECRET?: string
  RESEND_API_KEY?: string
  // Phase 2 · P2-13: Resend webhook HMAC 签名密钥（Svix 签发，每 endpoint 独立）
  RESEND_WEBHOOK_SECRET?: string
}

// ── Phase 2 · Webhook signature verification (Svix / Resend) ──
//
// Resend signs webhooks via Svix. Signature format:
//   svix-id:        <uuid>
//   svix-timestamp: <unix seconds>
//   svix-signature: v1=<base64>, ...  (space-delimited, may include multiple)
//
// Verification per https://docs.svix.com/receiving/verifying-payloads/how-manual:
//   signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
//   key           = base64Decode(secret without `whsec_` prefix)
//   signature     = base64(HMAC-SHA256(key, signedContent))
//
// Reference secret example (from Svix docs):
//   secret    = 'whsec_plJ3nmyCDGBKInavdOK15jsl'
//   payload   = '{"event_type":"ping","data":{"success":true}}'
//   msg_id    = 'msg_loFOjxBNrRLzqYUf'
//   timestamp = '1731705121'
//   signature = 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='
const SIGNATURE_HEADER = 'svix-signature'
const TIMESTAMP_HEADER = 'svix-timestamp'
const EVENT_ID_HEADER = 'svix-id'
const SIGNATURE_TOLERANCE_SEC = 300

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// Svix secrets are `whsec_<base64>`. Strip the prefix and decode the key bytes.
// If the prefix is absent, we assume it's already the base64-encoded key.
function parseSvixSecret(secret: string): Uint8Array {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  return base64ToBytes(raw)
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return bytesToBase64(new Uint8Array(sig))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Verify a Resend/Svix webhook signature.
 * Accepts the `v1=<base64>[ v2=<base64>]...` space-delimited signature list.
 * Enforces a ±5-minute time window to defend against replay attacks.
 */
async function verifyResendWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const svixId = headers.get(EVENT_ID_HEADER)
  const timestampHeader = headers.get(TIMESTAMP_HEADER)
  const signatureHeader = headers.get(SIGNATURE_HEADER)
  if (!svixId || !timestampHeader || !signatureHeader || !secret) return false

  const timestamp = Number(timestampHeader)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SEC) return false

  const keyBytes = parseSvixSecret(secret)
  const signedContent = `${svixId}.${timestamp}.${rawBody}`
  const expected = await hmacSha256(keyBytes, signedContent)

  // Signatures are space-delimited; strip the `vN,` prefix from each candidate.
  const candidates = signatureHeader.split(' ').map((s) => s.trim()).filter(Boolean)
  for (const candidate of candidates) {
    const commaIdx = candidate.indexOf(',')
    if (commaIdx < 0) continue
    const version = candidate.slice(0, commaIdx)
    if (!/^v\d+$/.test(version)) continue
    const sigValue = candidate.slice(commaIdx + 1)
    if (constantTimeEqual(expected, sigValue)) return true
  }
  return false
}

// ── Lead creation payload (aligned with CLOUD-COLLABORATION-DELIVERY.md §7.1) ──
type LeadPayload = {
  schemaVersion?: string
  workspaceId: string
  localRefId: string
  normalizedDomain: string
  company: string
  country?: string
  contact: {
    name: string
    normalizedEmail: string
    title?: string
  }
  score: number
  evidenceSummary?: { matchReasons?: string[]; urls?: string[] }
  riskFlags?: { dns?: string; emailGrade?: string }
  emailVerificationGrade?: string
  manualExceptionReason?: string | null
  draftVersion?: number
  approvalId?: string | null
  approverMachineId?: string | null
  approvedAt?: string | null
  campaignId?: string | null
  sequenceStage?: number | null
  aiEmail?: { subject?: string; body?: string }
}

// ───────────────────────────────────────────────────────────────
// Main Worker
// ───────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    const requestId = generateId()
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/v1/, '')
    const method = request.method

    // ── Health check (no auth) ──
    if (path === '/healthz' || path === '/healthz/') {
      return jsonResponse({ success: true, data: { status: 'ok', schemaVersion: env.SCHEMA_VERSION, timestamp: nowUTC() }, requestId })
    }

    // ── Phase 2: Webhook (no Bearer auth, uses x-resend-signature) ──
    if (path === '/webhooks/resend' && method === 'POST') {
      return await handleResendWebhook(request, env, requestId)
    }

    // ── Phase 2: Cron send (no Bearer auth, uses X-Cron-Secret) ──
    if (path === '/cron/send' && method === 'POST') {
      return await handleCronSend(request, env, requestId)
    }

    // ── Auth guard ──
    const auth = await authenticate(request, env)
    if (!auth.ok) {
      return errorResponse(auth.code, auth.message, requestId)
    }
    const workspace = auth.workspace

    // ── Schema version check ──
    const schemaVer = request.headers.get('X-Schema-Version')
    if (schemaVer && schemaVer !== env.SCHEMA_VERSION) {
      return errorResponse('SCHEMA_VERSION_MISMATCH', `Expected schema version ${env.SCHEMA_VERSION}, got ${schemaVer}`, requestId)
    }

    // ── Route dispatch ──
    try {
      // POST /leads — create lead
      if (path === '/leads' && method === 'POST') {
        return await handleCreateLead(request, env, workspace, requestId)
      }

      // GET /leads — list leads
      if (path === '/leads' && method === 'GET') {
        return await handleListLeads(request, env, workspace, requestId)
      }

      // GET /events — list events
      if (path === '/events' && method === 'GET') {
        return await handleListEvents(request, env, workspace, requestId)
      }

      // POST /suppressions/unsubscribe — one-click unsubscribe
      if (path === '/suppressions/unsubscribe' && method === 'POST') {
        return await handleUnsubscribe(request, env, workspace, requestId)
      }

      // GET /dashboard/stats — aggregate stats
      if (path === '/dashboard/stats' && method === 'GET') {
        return await handleDashboardStats(env, workspace, requestId)
      }

      // ── Phase 2: Outreach 投递闭环 ──

      // POST /outreach/queue — 将 approved lead 加入发送队列
      if (path === '/outreach/queue' && method === 'POST') {
        return await handleQueueOutreach(request, env, workspace, requestId)
      }

      // GET /outreach/status — 查询 outreach 状态
      if (path === '/outreach/status' && method === 'GET') {
        return await handleListOutreach(request, env, workspace, requestId)
      }

      // POST /outreach/reply — 本地 IMAP poller 上报回复事件（Phase 2.5）
      if (path === '/outreach/reply' && method === 'POST') {
        return await handleReportReply(request, env, workspace, requestId)
      }

      // 404
      return errorResponse('NOT_FOUND', `Route not found: ${method} ${path}`, requestId)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      console.error(`[${requestId}] Unhandled error:`, message)
      return errorResponse('INTERNAL_ERROR', message, requestId)
    }
  },
}

// ───────────────────────────────────────────────────────────────
// POST /leads — 创建线索台账（含防撞单 + 抑制检查）
// ───────────────────────────────────────────────────────────────
async function handleCreateLead(request: Request, env: Env, workspace: { id: string }, requestId: string): Promise<Response> {
  const body = await parseJson<LeadPayload>(request)
  if (!body) {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', requestId)
  }

  // ── Validate required fields ──
  const required: Array<[string, unknown]> = [
    ['workspaceId', body.workspaceId],
    ['localRefId', body.localRefId],
    ['normalizedDomain', body.normalizedDomain],
    ['company', body.company],
    ['contact.name', body.contact?.name],
    ['contact.normalizedEmail', body.contact?.normalizedEmail],
    ['score', body.score],
  ]
  for (const [field, value] of required) {
    if (!value && value !== 0) {
      return errorResponse('VALIDATION_ERROR', `Missing required field: ${field}`, requestId)
    }
  }

  // ── Workspace isolation (Fail-Closed §15.4) ──
  if (body.workspaceId !== workspace.id) {
    return errorResponse('TENANT_MISMATCH', 'workspaceId does not match authenticated workspace', requestId)
  }

  // ── Idempotency check (Fail-Closed §15.4) ──
  const idempotencyKey = request.headers.get('Idempotency-Key')
  if (!idempotencyKey) {
    return errorResponse('VALIDATION_ERROR', 'Idempotency-Key header is required', requestId)
  }

  const existing = await env.DB.prepare(
    `SELECT id, status FROM leads WHERE workspace_id = ? AND idempotency_key = ?`
  ).bind(workspace.id, idempotencyKey).first<{ id: string; status: string }>()

  if (existing) {
    return jsonResponse({
      success: true,
      data: { id: existing.id, status: existing.status, approvalRequired: existing.status !== 'approved', collision: false, idempotent: true },
      requestId,
    })
  }

  // ── Global suppression check (Fail-Closed §15.7) ──
  const normalizedEmail = normalizeEmail(body.contact.normalizedEmail)
  const suppression = await env.DB.prepare(
    `SELECT id FROM suppressions WHERE normalized_email = ? AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(normalizedEmail, nowUTC()).first()

  if (suppression) {
    return errorResponse('SUPPRESSED', `Email ${normalizedEmail} is in global suppression list`, requestId)
  }

  // ── Company collision check ──
  const domain = normalizeDomain(body.normalizedDomain)
  const existingCompany = await env.DB.prepare(
    `SELECT id, owner_machine_id, protection_until FROM companies WHERE workspace_id = ? AND normalized_domain = ?`
  ).bind(workspace.id, domain).first<{ id: string; owner_machine_id: string; protection_until: string }>()

  let collision = false
  if (existingCompany && existingCompany.owner_machine_id && existingCompany.protection_until && existingCompany.protection_until > nowUTC()) {
    collision = true
    return errorResponse('TEAM_COLLISION', `Domain ${domain} is claimed by another member during protection period`, requestId)
  }

  // ── Write contacts + companies + leads ──
  const leadId = generateId()
  const now = nowUTC()
  const evidenceSummaryJson = JSON.stringify(body.evidenceSummary ?? {})
  const riskFlagsJson = JSON.stringify(body.riskFlags ?? {})
  const emailGrade = body.emailVerificationGrade ?? (body.riskFlags?.emailGrade ?? 'unverified')

  // Upsert contact — RETURNING id gives the actual row id (may be pre-existing on conflict)
  const contactRow = await env.DB.prepare(
    `INSERT INTO contacts (id, workspace_id, name, normalized_email, title, verification_grade, manual_exception_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, normalized_email) DO UPDATE SET
       name = excluded.name, title = excluded.title,
       verification_grade = excluded.verification_grade,
       manual_exception_reason = excluded.manual_exception_reason,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING id`
  ).bind(generateId(), workspace.id, body.contact.name, normalizedEmail, body.contact.title ?? '', emailGrade, body.manualExceptionReason ?? null).first<{ id: string }>()
  const contactId = contactRow?.id ?? ''

  // Upsert company (only if new)
  let companyId: string
  if (existingCompany) {
    companyId = existingCompany.id
  } else {
    const newCompanyId = generateId()
    await env.DB.prepare(
      `INSERT INTO companies (id, workspace_id, normalized_domain, name, country)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(newCompanyId, workspace.id, domain, body.company, body.country ?? '').run()
    companyId = newCompanyId
  }

  // Insert lead
  await env.DB.prepare(
    `INSERT INTO leads (id, workspace_id, company_id, contact_id, score, evidence_summary, risk_flags, status, draft_version, local_ref_id, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'scored', ?, ?, ?)`
  ).bind(leadId, workspace.id, companyId, contactId, body.score, evidenceSummaryJson, riskFlagsJson, body.draftVersion ?? 0, body.localRefId, idempotencyKey).run()

  // Append event (append-only §15.8)
  await env.DB.prepare(
    `INSERT INTO events (workspace_id, lead_id, type, actor, payload, occurred_at)
     VALUES (?, ?, 'lead.created', 'system', ?, ?)`
  ).bind(workspace.id, leadId, JSON.stringify({ score: body.score, domain, email: normalizedEmail }), now).run()

  // Increment sync token
  await env.DB.prepare(
    `INSERT INTO sync_tokens (workspace_id, version) VALUES (?, 1)
     ON CONFLICT(workspace_id) DO UPDATE SET
       version = version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(workspace.id).run()

  return jsonResponse({
    success: true,
    data: { id: leadId, status: 'scored', approvalRequired: true, collision },
    requestId,
  })
}

// ───────────────────────────────────────────────────────────────
// GET /leads — 查询线索台账
// ───────────────────────────────────────────────────────────────
async function handleListLeads(request: Request, env: Env, workspace: { id: string }, requestId: string): Promise<Response> {
  const url = new URL(request.url)
  const status = url.searchParams.get('status') ?? null
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)
  const offset = Number(url.searchParams.get('offset')) || 0

  let query = `SELECT id, workspace_id, company_id, contact_id, score, status, draft_version, local_ref_id, created_at, updated_at FROM leads WHERE workspace_id = ?`
  const params: string[] = [workspace.id]

  if (status) {
    query += ` AND status = ?`
    params.push(status)
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`
  params.push(String(limit), String(offset))

  const result = await env.DB.prepare(query).bind(...params).all<{
    id: string; workspace_id: string; company_id: string; contact_id: string
    score: number; status: string; draft_version: number; local_ref_id: string
    created_at: string; updated_at: string
  }>()

  return jsonResponse({ success: true, data: { leads: result.results, limit, offset }, requestId })
}

// ───────────────────────────────────────────────────────────────
// GET /events — 增量事件拉取
// ───────────────────────────────────────────────────────────────
async function handleListEvents(request: Request, env: Env, workspace: { id: string }, requestId: string): Promise<Response> {
  const url = new URL(request.url)
  const since = url.searchParams.get('since') ?? '1970-01-01T00:00:00Z'
  const leadId = url.searchParams.get('leadId') ?? null
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500)

  let query = `SELECT id, workspace_id, lead_id, outreach_id, type, actor, payload, external_id, occurred_at FROM events WHERE workspace_id = ? AND occurred_at > ?`
  const params: string[] = [workspace.id, since]

  if (leadId) {
    query += ` AND lead_id = ?`
    params.push(leadId)
  }

  query += ` ORDER BY occurred_at ASC LIMIT ?`
  params.push(String(limit))

  const result = await env.DB.prepare(query).bind(...params).all<{
    id: number; workspace_id: string; lead_id: string; outreach_id: string
    type: string; actor: string; payload: string; external_id: string
    occurred_at: string
  }>()

  return jsonResponse({ success: true, data: { events: result.results, since }, requestId })
}

// ───────────────────────────────────────────────────────────────
// POST /suppressions/unsubscribe — 一键退订
// ───────────────────────────────────────────────────────────────
async function handleUnsubscribe(request: Request, env: Env, workspace: { id: string }, requestId: string): Promise<Response> {
  const body = await parseJson<{ email: string; source?: string }>(request)
  if (!body || !body.email) {
    return errorResponse('VALIDATION_ERROR', 'Missing required field: email', requestId)
  }

  const normalizedEmail = normalizeEmail(body.email)
  const suppressionId = generateId()
  const now = nowUTC()

  // Check if already suppressed
  const existing = await env.DB.prepare(
    `SELECT id FROM suppressions WHERE normalized_email = ? AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(normalizedEmail, now).first()

  if (existing) {
    return jsonResponse({ success: true, data: { email: normalizedEmail, alreadySuppressed: true }, requestId })
  }

  // Insert suppression (global, workspace_id = NULL)
  await env.DB.prepare(
    `INSERT INTO suppressions (id, workspace_id, normalized_email, reason, source, added_at)
     VALUES (?, NULL, ?, 'one_click_unsubscribe', ?, ?)`
  ).bind(suppressionId, normalizedEmail, body.source ?? 'webhook', now).run()

  // Cancel pending outreach **for this email only**.
  //
  // 安全修复 (P0-2)：此处原为 `WHERE status = 'pending'`，既无 workspace 谓词也无 email 谓词，
  // 导致任一租户的任一邮箱退订 → 全平台所有租户的 pending 队列被清空（跨租户数据破坏）。
  //
  // 注意**不能**加 `workspace_id = ?` 谓词来"修复"：抑制名单本身是全局语义
  // （上一条 INSERT 的 workspace_id = NULL），某邮箱退订后任何租户都不应再向其投递。
  // 因此正确范围是"该 email 命中的 outreach"，而非"该 workspace 的 outreach"。
  // 路径：outreach.lead_id → leads.id → leads.contact_id → contacts.normalized_email
  await env.DB.prepare(
    `UPDATE outreach SET status = 'failed', error = 'suppressed'
     WHERE status = 'pending'
       AND lead_id IN (
         SELECT l.id FROM leads l
         JOIN contacts c ON c.id = l.contact_id
         WHERE c.normalized_email = ?
       )`
  ).bind(normalizedEmail).run()

  // Append event (tenant-scoped: the workspace that owns the caller's API key)
  await env.DB.prepare(
    `INSERT INTO events (workspace_id, type, actor, payload, occurred_at)
     VALUES (?, 'suppression.added', 'system', ?, ?)`
  ).bind(workspace.id, JSON.stringify({ email: normalizedEmail, reason: 'one_click_unsubscribe' }), now).run()

  return jsonResponse({ success: true, data: { email: normalizedEmail, suppressed: true }, requestId })
}

// ───────────────────────────────────────────────────────────────
// GET /dashboard/stats — 看板聚合指标
// ───────────────────────────────────────────────────────────────
async function handleDashboardStats(env: Env, workspace: { id: string }, requestId: string): Promise<Response> {
  const [leadStats, outreachStats, suppressionCount, syncToken] = await Promise.all([
    env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('new','scored') THEN 1 ELSE 0 END) AS scored,
        SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) AS pendingApproval,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied,
        SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END) AS suppressed
       FROM leads WHERE workspace_id = ?`
    ).bind(workspace.id).first(),

    env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
        SUM(CASE WHEN status = 'complained' THEN 1 ELSE 0 END) AS complained,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM outreach WHERE workspace_id = ?`
    ).bind(workspace.id).first(),

    env.DB.prepare(`SELECT COUNT(*) AS count FROM suppressions WHERE workspace_id = ?` ).bind(workspace.id).first(),
    env.DB.prepare(`SELECT version FROM sync_tokens WHERE workspace_id = ?` ).bind(workspace.id).first(),
  ])

  return jsonResponse({
    success: true,
    data: {
      leads: {
        total: leadStats?.total ?? 0,
        scored: leadStats?.scored ?? 0,
        pendingApproval: leadStats?.pendingApproval ?? 0,
        approved: leadStats?.approved ?? 0,
        queued: leadStats?.queued ?? 0,
        sent: leadStats?.sent ?? 0,
        replied: leadStats?.replied ?? 0,
        suppressed: leadStats?.suppressed ?? 0,
      },
      outreach: {
        total: outreachStats?.total ?? 0,
        pending: outreachStats?.pending ?? 0,
        sent: outreachStats?.sent ?? 0,
        delivered: outreachStats?.delivered ?? 0,
        bounced: outreachStats?.bounced ?? 0,
        complained: outreachStats?.complained ?? 0,
        failed: outreachStats?.failed ?? 0,
      },
      suppressions: suppressionCount?.count ?? 0,
      syncVersion: syncToken?.version ?? 0,
    },
    requestId,
  })
}

// ───────────────────────────────────────────────────────────────
// Phase 2: Outreach 投递闭环
// ───────────────────────────────────────────────────────────────

// ── POST /outreach/queue — 将 approved lead 加入发送队列 ──
async function handleQueueOutreach(request: Request, env: Env, workspace: { id: string }, requestId: string): Promise<Response> {
  const body = await parseJson<{
    leadId: string
    subject: string
    body: string
    scheduledAt?: string
    sequenceStage?: number
  }>(request)
  if (!body) {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', requestId)
  }

  // Validate required fields
  if (!body.leadId || !body.subject || !body.body) {
    return errorResponse('VALIDATION_ERROR', 'Missing required fields: leadId, subject, body', requestId)
  }

  // Check for existing queued outreach for this lead (idempotency)
  const existing = await env.DB.prepare(
    `SELECT id, status FROM outreach WHERE workspace_id = ? AND lead_id = ? AND status = 'pending'`
  ).bind(workspace.id, body.leadId).first<{ id: string; status: string }>()

  if (existing) {
    return jsonResponse({
      success: true,
      data: { id: existing.id, status: existing.status, queued: false, idempotent: true },
      requestId,
    })
  }

  // Check if lead exists and is approved
  const lead = await env.DB.prepare(
    `SELECT id, status, workspace_id FROM leads WHERE workspace_id = ? AND id = ?`
  ).bind(workspace.id, body.leadId).first<{ id: string; status: string; workspace_id: string }>()

  if (!lead) {
    return errorResponse('LEAD_NOT_FOUND', `Lead not found: ${body.leadId}`, requestId)
  }

  if (lead.status !== 'approved' && lead.status !== 'queued') {
    return errorResponse('LEAD_NOT_APPROVED', `Lead must be approved to queue outreach (current: ${lead.status})`, requestId)
  }

  // Create outreach record
  const outreachId = generateId()
  const now = nowUTC()
  const scheduledAt = body.scheduledAt ?? now
  const sequenceStage = body.sequenceStage ?? 0

  // 幂等键修复 (P1-B)：原为 `outreach_${leadId}_${now}`，含时间戳 →
  // 每次调用生成不同 key，UNIQUE(workspace_id, campaign_id, idempotency_key) 形同虚设，
  // 同一 lead 可被反复入队并重复发送。
  // 改为不含时间戳，粒度对齐唯一键：同一 (workspace, campaign='default') 内，
  // 同一 lead 的同一序列阶段只允许一行。
  // 注意：投递重试不依赖新插入行，而由 send_attempts / next_retry_at 在原行推进，故不受影响；
  // 不同序列阶段（sequence_stage）仍可各自入队，符合序列投递语义。
  const idempotencyKey = `outreach_${body.leadId}_stage${sequenceStage}`

  // 幂等短路：同 key 已有记录时返回既有 id，而非撞 UNIQUE 抛 500。
  // 与本地 outreach-sync-service 的 idempotent:true 语义对齐（不重复推送本地状态）。
  const dup = await env.DB.prepare(
    `SELECT id, status FROM outreach WHERE workspace_id = ? AND campaign_id = 'default' AND idempotency_key = ?`
  ).bind(workspace.id, idempotencyKey).first<{ id: string; status: string }>()

  if (dup) {
    return jsonResponse({
      success: true,
      data: { id: dup.id, status: dup.status, queued: false, idempotent: true, scheduledAt },
      requestId,
    })
  }

  await env.DB.prepare(
    `INSERT INTO outreach (id, workspace_id, lead_id, campaign_id, sequence_stage, scheduled_at, subject, body, status, provider, send_attempts, idempotency_key)
     VALUES (?, ?, ?, 'default', ?, ?, ?, ?, 'pending', 'resend', 0, ?)`
  ).bind(outreachId, workspace.id, body.leadId, sequenceStage, scheduledAt, body.subject, body.body, idempotencyKey).run()

  // Update lead status to 'queued'
  await env.DB.prepare(
    `UPDATE leads SET status = 'queued', updated_at = ? WHERE id = ? AND workspace_id = ?`
  ).bind(now, body.leadId, workspace.id).run()

  // Append event
  await env.DB.prepare(
    `INSERT INTO events (workspace_id, lead_id, outreach_id, type, actor, payload, occurred_at)
     VALUES (?, ?, ?, 'outreach.queued', 'system', ?, ?)`
  ).bind(workspace.id, body.leadId, outreachId, JSON.stringify({ subject: body.subject, scheduledAt }), now).run()

  // Increment sync token
  await env.DB.prepare(
    `INSERT INTO sync_tokens (workspace_id, version) VALUES (?, 1)
     ON CONFLICT(workspace_id) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(workspace.id).run()

  return jsonResponse({
    success: true,
    data: { id: outreachId, status: 'pending', queued: true, scheduledAt },
    requestId,
  })
}

// ── GET /outreach/status — 查询 outreach 状态 ──
async function handleListOutreach(request: Request, env: Env, workspace: { id: string }, requestId: string): Promise<Response> {
  const url = new URL(request.url)
  const status = url.searchParams.get('status') ?? null
  const leadId = url.searchParams.get('leadId') ?? null
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)
  const offset = Number(url.searchParams.get('offset')) || 0

  let query = `SELECT id, workspace_id, lead_id, campaign_id, sequence_stage, scheduled_at, sent_at, delivered_at, bounced_at, complained_at, replied_at, provider, resend_id, provider_message_id, subject, status, bounce_type, error, send_attempts, next_retry_at, created_at, updated_at FROM outreach WHERE workspace_id = ?`
  const params: string[] = [workspace.id]

  if (status) {
    query += ` AND status = ?`
    params.push(status)
  }

  if (leadId) {
    query += ` AND lead_id = ?`
    params.push(leadId)
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`
  params.push(String(limit), String(offset))

  const result = await env.DB.prepare(query).bind(...params).all<{
    id: string; workspace_id: string; lead_id: string; campaign_id: string
    sequence_stage: number; scheduled_at: string; sent_at: string; delivered_at: string
    bounced_at: string; complained_at: string; replied_at: string
    provider: string; resend_id: string; provider_message_id: string
    subject: string; status: string; bounce_type: string; error: string
    send_attempts: number; next_retry_at: string; created_at: string; updated_at: string
  }>()

  return jsonResponse({ success: true, data: { outreach: result.results, limit, offset }, requestId })
}

// ── POST /cron/send — Cron 定时投递 ──
async function handleCronSend(request: Request, env: Env, requestId: string): Promise<Response> {
  // Verify cron secret
  const cronSecret = request.headers.get('X-Cron-Secret')
  const envSecret = (env as any).CRON_SECRET as string | undefined

  // 常量时间比较（P1-B）：原为 `cronSecret !== envSecret` 普通字符串比较，
  // 存在时序侧信道——攻击者可依据响应耗时差异逐字节爆破 CRON_SECRET。
  // CLOUD-COLLABORATION-DELIVERY.md:247 声称已做常量时间比较，实际未落地（门禁未覆盖）。
  if (!cronSecret || !envSecret || !constantTimeEqual(cronSecret, envSecret)) {
    return errorResponse('UNAUTHORIZED', 'Invalid cron secret', requestId)
  }

  const now = nowUTC()
  const BATCH_SIZE = 50

  // Find pending outreach that are ready to send
  // JOIN with leads + contacts to resolve the actual recipient email.
  const pending = await env.DB.prepare(
    `SELECT o.id, o.workspace_id, o.lead_id, o.subject, o.body, o.send_attempts, o.next_retry_at,
            c.normalized_email AS recipient_email
     FROM outreach o
     JOIN leads l ON l.id = o.lead_id
     JOIN contacts c ON c.id = l.contact_id
     WHERE o.workspace_id IS NOT NULL AND o.status = 'pending'
       AND (o.next_retry_at IS NULL OR o.next_retry_at <= ?)
     ORDER BY o.scheduled_at ASC
     LIMIT ?`
  ).bind(now, String(BATCH_SIZE)).all<{
    id: string; workspace_id: string; lead_id: string
    subject: string; body: string; send_attempts: number; next_retry_at: string
    recipient_email: string
  }>()

  const resent: string[] = []
  const failed: string[] = []

  for (const outreach of pending.results) {
    if (!outreach.recipient_email) {
      // Safety net: missing contact email is unrecoverable — mark as failed with terminal error.
      await env.DB.prepare(
        `UPDATE outreach SET status = 'failed', error = 'missing_recipient_email', updated_at = ? WHERE id = ? AND workspace_id = ?`
      ).bind(now, outreach.id, outreach.workspace_id).run()
      failed.push(outreach.id)
      continue
    }

    try {
      const resendData = await sendEmailViaResend(
        {
          from: 'Kone AI <noreply@kone.example>',
          to: [outreach.recipient_email],
          subject: outreach.subject,
          html: outreach.body,
        },
        env.RESEND_API_KEY ?? '',
      )

      await env.DB.prepare(
        `UPDATE outreach SET status = 'sent', sent_at = ?, resend_id = ?, provider_message_id = ?, send_attempts = send_attempts + 1, updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      ).bind(now, resendData.id, resendData.id, now, outreach.id, outreach.workspace_id).run()

      // Append event
      await env.DB.prepare(
        `INSERT INTO events (workspace_id, lead_id, outreach_id, type, actor, payload, occurred_at)
         VALUES (?, ?, ?, 'outreach.sent', 'resend', ?, ?)`
      ).bind(outreach.workspace_id, outreach.lead_id, outreach.id, JSON.stringify({ resendId: resendData.id }), now).run()

      resent.push(outreach.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[CronSend] Failed to send ${outreach.id}:`, message)

      // Exponential backoff: 1min, 5min, 15min, 1h
      const attempts = outreach.send_attempts + 1
      const retryDelays = [60, 300, 900, 3600] // seconds
      const delay = retryDelays[Math.min(attempts - 1, retryDelays.length - 1)]
      const nextRetry = new Date(Date.now() + delay * 1000).toISOString()

      await env.DB.prepare(
        `UPDATE outreach SET send_attempts = ?, next_retry_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`
      ).bind(attempts, nextRetry, now, outreach.id, outreach.workspace_id).run()

      failed.push(outreach.id)
    }
  }

  return jsonResponse({
    success: true,
    data: { sentCount: resent.length, failedCount: failed.length, total: pending.results.length, resent, failed },
    requestId,
  })
}

// ── POST /webhooks/resend — Resend Webhook 回调 ──
//
// Signature verification (P2-13): Resend uses Svix for webhook signing.
// We require svix-* headers + a valid HMAC-SHA256 signature computed from
// the raw body and the per-endpoint RESEND_WEBHOOK_SECRET.
// The existence-check fallback (`x-resend-signature` only) has been removed —
// accepting unsigned requests would violate CLOUD-COLLABORATION-DELIVERY.md §13.
async function handleResendWebhook(request: Request, env: Env, requestId: string): Promise<Response> {
  // Read raw body FIRST — signature is computed over the exact byte sequence.
  const rawBody = await request.text()
  if (!rawBody) {
    return errorResponse('VALIDATION_ERROR', 'Empty request body', requestId)
  }

  // Verify Svix/Resend HMAC signature
  const secret = env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // Missing secret → fail closed (do not process webhooks silently)
    return errorResponse('UNAUTHORIZED', 'Webhook secret not configured', requestId)
  }
  const signatureValid = await verifyResendWebhookSignature(rawBody, request.headers, secret)
  if (!signatureValid) {
    return errorResponse('UNAUTHORIZED', 'Invalid webhook signature', requestId)
  }

  // Parse JSON safely
  let body: {
    type: string
    data: {
      id: string
      to?: string[]
      subject?: string
      bounced?: boolean
      bounced_code?: string
    }
  }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', requestId)
  }

  if (!body.type || !body.data?.id) {
    return errorResponse('VALIDATION_ERROR', 'Missing required field: type or data.id', requestId)
  }

  // Check if event already processed (idempotency)
  //
  // 幂等键修复 (P0-3)：原实现直接用 body.data.id（Resend 的 **email id**）。
  // Resend 对同一封邮件的 sent / delivered / bounced **共用同一个 email id**，
  // 于是首个事件落库后，后续事件被 UNIQUE 判为重复直接返回 →
  // delivered / bounced 永不落库（表现为看板"已送达"恒为 0）。
  //
  // 改用 Svix 的 svix-id：Resend 经 Svix 投递，每个事件有唯一 ID。
  // verifyResendWebhookSignature 已确保该 header 存在且签名有效；
  // 此处仍保留回落 `${type}:${emailId}`，配合 004 migration 的
  // UNIQUE(provider, event_type, event_id) 三字段联合唯一键兜底。
  const svixEventId = request.headers.get(EVENT_ID_HEADER)
  const eventId = svixEventId || `${body.type}:${body.data?.id}`
  {
    const existing = await env.DB.prepare(
      `SELECT id FROM webhook_events WHERE provider = 'resend' AND event_type = ? AND event_id = ?`
    ).bind(body.type, eventId).first()

    if (existing) {
      return jsonResponse({ success: true, data: { idempotent: true, eventId }, requestId })
    }
  }

  // Map event type to outreach status update.
  // Each case records a monotonically-later stage timestamp without regressing status.
  //   email.sent        → sent_at,     status='sent'
  //   email.delivered   → delivered_at,status='delivered'
  //   email.opened      → opened_at,   status='delivered' (opened implies delivered)
  //   email.clicked     → clicked_at,  status='delivered' (clicked implies delivered)
  //   email.bounced     → bounced_at,  status='bounced'
  //   email.complained  → complained_at,status='complained'
  //   email.replied     → replied_at,  status='replied'
  const now = nowUTC()
  const eventType = body.type
  let statusUpdate: { column: string; status: string } | null = null

  switch (body.type) {
    case 'email.sent':
      statusUpdate = { column: 'sent_at', status: 'sent' }
      break
    case 'email.delivered':
      statusUpdate = { column: 'delivered_at', status: 'delivered' }
      break
    case 'email.opened':
      statusUpdate = { column: 'email_opened_at', status: 'delivered' }
      break
    case 'email.clicked':
      statusUpdate = { column: 'email_clicked_at', status: 'delivered' }
      break
    case 'email.bounced':
      statusUpdate = { column: 'bounced_at', status: 'bounced' }
      break
    case 'email.complained':
      statusUpdate = { column: 'complained_at', status: 'complained' }
      break
    case 'email.replied':
      statusUpdate = { column: 'replied_at', status: 'replied' }
      break
    default:
      // Unknown event type, just log it
      break
  }

  // Update outreach if we have a status update
  if (statusUpdate && body.data?.id) {
    // 状态机守卫 (P1-B)：replied 是 outreach 终态（CLOUD-COLLABORATION-DELIVERY.md §13.1.6）。
    // 缺少守卫时，迟到的 email.delivered 会把已 replied 的记录回退成 delivered，
    // 让"客户已回复"这一最有价值的信号被静默抹掉。
    // 注意：本事件本身为 email.replied 时 status 尚未成为 replied，可正常写入。
    await env.DB.prepare(
      `UPDATE outreach SET ${statusUpdate.column} = ?, status = ?, provider_message_id = COALESCE(provider_message_id, ?), updated_at = ?
       WHERE resend_id = ?
         AND status NOT IN ('replied')`
    ).bind(now, statusUpdate.status, body.data.id, now, body.data.id).run()
  }

  // Insert webhook event for audit
  await env.DB.prepare(
    `INSERT INTO webhook_events (workspace_id, provider, event_type, event_id, payload, received_at, processed_at)
     VALUES (NULL, 'resend', ?, ?, ?, ?, ?)`
  ).bind(eventType, eventId, JSON.stringify(body), now, now).run()

  return jsonResponse({ success: true, data: { processed: true, eventType }, requestId })
}

// ── POST /outreach/reply — Phase 2.5 本地 IMAP 上报回复事件 ──
//
// Called by the local imap-reply-service after detecting a reply via In-Reply-To
// header matching against `outreach.provider_message_id`.
//
// Idempotency:
//   UNIQUE(outreach_id, message_id) on email_replies prevents duplicate
//   archival of the same reply message across multiple poller runs.
//
// State machine:
//   outreach.status = 'replied' (terminal; blocks re-send in cron)
//   outreach.replied_at = now
//   events type 'outreach.replied' is appended for audit
async function handleReportReply(request: Request, env: Env, workspace: { id: string }, requestId: string): Promise<Response> {
  const body = await parseJson<{
    outreachId: string
    messageId: string
    inReplyTo?: string
    sender: string
    subject?: string
    replyBody?: string
    receivedAt?: string
  }>(request)
  if (!body) {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', requestId)
  }

  // Validate required fields
  if (!body.outreachId || !body.messageId || !body.sender) {
    return errorResponse('VALIDATION_ERROR', 'Missing required fields: outreachId, messageId, sender', requestId)
  }

  const now = nowUTC()
  const receivedAt = body.receivedAt ?? now

  // Verify the outreach belongs to this workspace (tenant isolation)
  const outreach = await env.DB.prepare(
    `SELECT id, workspace_id, lead_id, status, provider_message_id FROM outreach WHERE id = ? AND workspace_id = ?`
  ).bind(body.outreachId, workspace.id).first<{
    id: string; workspace_id: string; lead_id: string
    status: string; provider_message_id: string
  }>()

  if (!outreach) {
    return errorResponse('OUTREACH_NOT_FOUND', `Outreach not found: ${body.outreachId}`, requestId)
  }

  // Idempotency: if this message_id was already archived for this outreach, return the prior record
  const existing = await env.DB.prepare(
    `SELECT id FROM email_replies WHERE outreach_id = ? AND message_id = ?`
  ).bind(outreach.id, body.messageId).first<{ id: string }>()

  if (existing) {
    return jsonResponse({
      success: true,
      data: { id: existing.id, outreachId: outreach.id, status: outreach.status, idempotent: true },
      requestId,
    })
  }

  // Insert reply archive row
  const replyId = generateId()
  await env.DB.prepare(
    `INSERT INTO email_replies (id, workspace_id, outreach_id, lead_id, message_id, in_reply_to, sender, subject, reply_body, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    replyId,
    workspace.id,
    outreach.id,
    outreach.lead_id,
    body.messageId,
    body.inReplyTo ?? null,
    body.sender.toLowerCase(),
    body.subject ?? null,
    // Cap reply body at 16KB to avoid D1 row-size issues
    body.replyBody ? body.replyBody.slice(0, 16384) : null,
    receivedAt,
  ).run()

  // Update outreach to 'replied' terminal state
  await env.DB.prepare(
    `UPDATE outreach SET status = 'replied', replied_at = ?, provider_message_id = COALESCE(provider_message_id, ?), updated_at = ?
     WHERE id = ? AND workspace_id = ?`
  ).bind(now, body.messageId, now, outreach.id, workspace.id).run()

  // Append audit event
  await env.DB.prepare(
    `INSERT INTO events (workspace_id, lead_id, outreach_id, type, actor, payload, occurred_at)
     VALUES (?, ?, ?, 'outreach.replied', 'imap_poller', ?, ?)`
  ).bind(
    workspace.id,
    outreach.lead_id,
    outreach.id,
    JSON.stringify({
      messageId: body.messageId,
      sender: body.sender,
      inReplyTo: body.inReplyTo ?? null,
      subject: body.subject ?? null,
    }),
    now,
  ).run()

  // Bump sync token
  await env.DB.prepare(
    `INSERT INTO sync_tokens (workspace_id, version) VALUES (?, 1)
     ON CONFLICT(workspace_id) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(workspace.id).run()

  return jsonResponse({
    success: true,
    data: { id: replyId, outreachId: outreach.id, status: 'replied', idempotent: false },
    requestId,
  })
}
