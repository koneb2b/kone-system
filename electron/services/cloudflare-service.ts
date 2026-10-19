/**
 * cloudflare-service.ts — Cloudflare Workers + D1 团队台账推送
 *
 * 架构原则（ARCH-STANDARDS §15 · CLOUD-COLLABORATION-DELIVERY.md §7.1）:
 * - 边缘重活，云端轻量：本地 AI 打分完成后，将精简状态推送至 D1
 * - 幂等优先：所有 POST 端点必须携带 Idempotency-Key，服务端按 (workspace, key) 去重
 * - 全局抑制检查：Worker 侧在插入前查 suppressions 表，命中则 403
 * - 团队防撞单：Worker 侧按 (workspace, normalized_domain) 检查 protection_until
 * - Fail-Closed：凭证缺失或网络失败一律抛错，绝不静默吞掉
 * - 超时兜底：所有 fetch 均包裹 AbortController，防止挂起
 *
 * Phase 1 范围：仅 POST /leads + GET /dashboard/stats。
 * outreach/Queue/Resend 属 Phase 2，当前版本仅推送台账，投递仍走本地 SMTP。
 */

import { extractDomain } from '../utils/domain'
import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc } from '../ipc/registry'
import type { ConfigStore } from './config-service'
import { buildFeatureDeniedResponse } from './license-service'
import * as crypto from 'crypto'

/* ──────────────────────────────────────────────
 *  Types
 * ────────────────────────────────────────────── */

export type CloudflareConfig = {
  url: string
  apiKey: string
  workspaceId: string
}

export type CloudLeadPayload = {
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
}

export type PushLeadResponse = {
  success: boolean
  data?: { id: string; status: string; approvalRequired: boolean; collision: boolean; idempotent?: boolean }
  error?: { code: string; message: string; requestId?: string }
}

export type BatchPushResult = {
  pushed: number
  accepted: number
  rejected: number
  errors: Array<{ localRefId: string; code: string; message: string }>
}

export type DashboardStats = {
  leads: {
    total: number
    scored: number
    pendingApproval: number
    approved: number
    queued: number
    sent: number
    replied: number
    suppressed: number
  }
  outreach: {
    total: number
    pending: number
    sent: number
    delivered: number
    bounced: number
    complained: number
    failed: number
  }
  suppressions: number
  syncVersion: number
}

/* ──────────────────────────────────────────────
 *  Config (Fail-Closed)
 * ────────────────────────────────────────────── */

const getCloudflareConfig = (store: ConfigStore): CloudflareConfig => {
  const url = String(store.get('cloud.cloudflareUrl') || '')
    .trim()
    .replace(/\/+$/, '')
  const apiKey = String(store.get('cloud.cloudflareApiKey') || '').trim()
  const workspaceId = String(store.get('cloud.cloudflareWorkspaceId') || '').trim()

  if (!url || !apiKey || !workspaceId) {
    throw new Error('未配置 Cloudflare 云端引擎凭证，请在系统设置中填写 API URL、API Key 与 Workspace ID')
  }
  return { url, apiKey, workspaceId }
}

/* P0-6 修复对齐：Cloudflare fetch 全链路超时，防止网络挂起永久 pending。
   与 supabase-service.ts 的 SUPABASE_TIMEOUT_MS 保持一致的兜底思路。 */
const CLOUDFLARE_TIMEOUT_MS = 15_000

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CLOUDFLARE_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/* ──────────────────────────────────────────────
 *  Schema version (与 kone-cloud/src/worker.ts 的 SCHEMA_VERSION 环境变量对齐)
 * ────────────────────────────────────────────── */

export const CLOUDFLARE_SCHEMA_VERSION = '1.0.0'

/* ──────────────────────────────────────────────
 *  Public API
 * ────────────────────────────────────────────── */

/**
 * 推送单条线索至 Cloudflare D1 团队台账。
 * 幂等：相同 (workspaceId, idempotencyKey) 返回同一 leadId，不重复插入。
 */
export const pushLead = async (
  store: ConfigStore,
  payload: CloudLeadPayload,
  idempotencyKey: string,
): Promise<PushLeadResponse> => {
  const config = getCloudflareConfig(store)

  const response = await fetchWithTimeout(`${config.url}/v1/leads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Schema-Version': CLOUDFLARE_SCHEMA_VERSION,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  })

  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean
    data?: PushLeadResponse['data']
    code?: string
    message?: string
    requestId?: string
  }

  if (!response.ok || body.success === false) {
    return {
      success: false,
      error: {
        code: body.code || `HTTP_${response.status}`,
        message: body.message || `Cloudflare Worker 返回 ${response.status}`,
        requestId: body.requestId,
      },
    }
  }

  return {
    success: true,
    data: body.data,
  }
}

/**
 * 批量推送线索。顺序执行以避免 D1 并发写入冲突；错误不中断整批。
 * 幂等键由调用方传入（通常基于 localRefId 派生，见派生函数）。
 */
export const pushLeadsBatch = async (
  store: ConfigStore,
  leads: Array<{
    localRefId: string
    payload: CloudLeadPayload
    idempotencyKey: string
  }>,
): Promise<BatchPushResult> => {
  const result: BatchPushResult = {
    pushed: 0,
    accepted: 0,
    rejected: 0,
    errors: [],
  }

  for (const item of leads) {
    result.pushed += 1
    const res = await pushLead(store, item.payload, item.idempotencyKey)
    if (res.success && res.data) {
      result.accepted += 1
    } else {
      result.rejected += 1
      result.errors.push({
        localRefId: item.localRefId,
        code: res.error?.code || 'UNKNOWN',
        message: res.error?.message || 'Unknown error',
      })
    }
  }

  return result
}

/**
 * 拉取 Cloudflare 看板聚合指标（供 Settings 页面展示连通性 + 数据规模）。
 */
export const getDashboardStats = async (store: ConfigStore): Promise<DashboardStats> => {
  const config = getCloudflareConfig(store)

  const response = await fetchWithTimeout(`${config.url}/v1/dashboard/stats`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'X-Schema-Version': CLOUDFLARE_SCHEMA_VERSION,
    },
  })

  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean
    data?: DashboardStats
    code?: string
    message?: string
  }

  if (!response.ok || body.success === false) {
    throw new Error(body.message || `Cloudflare 看板请求失败：${response.status}`)
  }

  return body.data as DashboardStats
}

/**
 * 测试 Cloudflare 连通性（供 Settings "测试连接" 按钮使用）。
 * 命中 /healthz（无需鉴权）+ /dashboard/stats（需鉴权），两级校验。
 */
export const testConnection = async (
  store: ConfigStore,
): Promise<{ ok: boolean; message: string; latencyMs: number }> => {
  const started = Date.now()
  try {
    // 配置校验移入 try 内：getCloudflareConfig 在配置缺失时会抛错，
    // 此前位于 try 之外 → 异常穿透，调用方拿不到结构化错误信息。
    const config = getCloudflareConfig(store)

    // 1. Health check (no auth)
    const health = await fetchWithTimeout(`${config.url}/healthz`, { method: 'GET' })
    if (!health.ok) {
      return { ok: false, message: `健康检查失败：${health.status}`, latencyMs: Date.now() - started }
    }

    // 2. Authenticated dashboard (validates API key)
    const authed = await fetchWithTimeout(`${config.url}/v1/dashboard/stats`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'X-Schema-Version': CLOUDFLARE_SCHEMA_VERSION,
      },
    })

    // 此前未检查响应状态 → API Key 错误（401/403）也会返回 ok:true，
    // 造成"显示连接成功但实际不可用"的假阳性。现按状态码给出可行动提示。
    if (!authed.ok) {
      const hint =
        authed.status === 401 || authed.status === 403
          ? 'API Key 无效或权限不足，请核对 Worker API Token'
          : `鉴权请求失败（HTTP ${authed.status}）`
      return { ok: false, message: hint, latencyMs: Date.now() - started }
    }

    return { ok: true, message: 'Cloudflare 云端引擎连通正常', latencyMs: Date.now() - started }
  } catch (error: unknown) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Cloudflare 云端引擎连接失败',
      latencyMs: Date.now() - started,
    }
  }
}

/* ──────────────────────────────────────────────
 *  Payload builder — 从本地 LeadBusiness 类型映射到云端 payload
 * ────────────────────────────────────────────── */

export type LocalLeadLike = {
  id: string
  domain?: string
  company?: string
  country?: string
  contact?: string
  contactName?: string
  contactTitle?: string
  score?: number
  ai_tags?: string[]
  urls?: string[]
  emailVerificationGrade?: string
  dnsRisk?: string
  manualExceptionReason?: string | null
  draftVersion?: number
  created_at?: string
}

/** 从本地 Lead 构造云端 payload（对齐 CLOUD-COLLABORATION-DELIVERY.md §7.1 必填字段）。 */
export const buildLeadPayload = (lead: LocalLeadLike, workspaceId: string): CloudLeadPayload => {
  const email = String(lead.contact || '')
    .trim()
    .toLowerCase()
  const domain = extractDomain(email || lead.domain || '') || 'unknown'
  const score = Number(lead.score ?? 0)

  return {
    workspaceId,
    localRefId: String(lead.id || crypto.randomUUID()),
    normalizedDomain: domain,
    company: String(lead.company || domain),
    country: lead.country || undefined,
    contact: {
      name: String(lead.contactName || lead.contact || 'Unknown'),
      normalizedEmail: email || `unknown@${domain}`,
      title: lead.contactTitle || undefined,
    },
    score,
    evidenceSummary: {
      matchReasons: Array.isArray(lead.ai_tags) ? lead.ai_tags : [],
      urls: Array.isArray(lead.urls) ? lead.urls : [],
    },
    riskFlags: {
      dns: lead.dnsRisk || undefined,
      emailGrade: lead.emailVerificationGrade || 'unverified',
    },
    emailVerificationGrade: lead.emailVerificationGrade || 'unverified',
    manualExceptionReason: lead.manualExceptionReason ?? null,
    draftVersion: lead.draftVersion ?? 0,
  }
}

/** 幂等键派生：基于 localRefId + 时间戳，保证同一条 lead 重推时命中同一 key。 */
export const deriveIdempotencyKey = (localRefId: string): string => {
  return `lead-${localRefId}`
}

/* ──────────────────────────────────────────────
 *  Utility — 检测 Cloudflare 配置是否完整（供 Settings UI 使用）
 * ────────────────────────────────────────────── */

export const isCloudflareConfigured = (store: ConfigStore): boolean => {
  try {
    getCloudflareConfig(store)
    return true
  } catch {
    return false
  }
}

/* ──────────────────────────────────────────────
 *  Phase 2: Outreach 投递闭环
 * ────────────────────────────────────────────── */

export type QueueOutreachPayload = {
  leadId: string
  subject: string
  body: string
  scheduledAt?: string
  sequenceStage?: number
  /* [V1.4.0] Phase 2.9 · 门禁 ⑦⑧ 所需的审批上下文（CLOUD-COLLABORATION-DELIVERY.md §7.1 必需字段）。
     云端开启 APPROVAL_GATE_ENABLED 后，缺失 draftVersion 会返回 DRAFT_VERSION_MISMATCH。 */
  draftVersion?: number
  approvalId?: string
  campaignId?: string
}

export type QueueOutreachResponse = {
  success: boolean
  data?: { id: string; status: string; queued: boolean; scheduledAt?: string; idempotent?: boolean }
  error?: { code: string; message: string; requestId?: string }
}

/**
 * 云端 outreach 状态（对齐前端契约 `CloudOutreachRecord`）。
 *
 * 可空字段统一为 `string | null`：D1 中这些列实际为 NULL（未送达 / 未回复等），
 * 此前本类型写为 `?: string`（不含 null），与前端契约的 `?: string | null` 不一致，
 * 导致 mapOutreachRow 产出 null 时类型报错。以**能真实表达数据库 NULL 语义**为准统一为 `| null`。
 */
export type OutreachStatus = {
  id: string
  workspaceId: string
  leadId: string
  campaignId: string
  sequenceStage: number
  scheduledAt: string
  sentAt?: string | null
  deliveredAt?: string | null
  bouncedAt?: string | null
  complainedAt?: string | null
  repliedAt?: string | null
  provider: string
  resendId?: string | null
  providerMessageId?: string | null
  subject: string
  status: string
  bounceType?: string | null
  error?: string | null
  sendAttempts: number
  nextRetryAt?: string | null
  createdAt: string
  updatedAt: string
}

export type PollOutreachResult = {
  outreach: OutreachStatus[]
  limit: number
  offset: number
}

/**
 * D1 原始行（snake_case，列名与 kone-cloud migrations 完全一致）。
 * 仅用于描述跨进程响应的**实际**形状，不得用于业务层。
 */
type OutreachRow = {
  id: string
  workspace_id: string
  lead_id: string
  campaign_id: string | null
  sequence_stage: number
  scheduled_at: string
  sent_at?: string | null
  delivered_at?: string | null
  bounced_at?: string | null
  complained_at?: string | null
  replied_at?: string | null
  provider: string
  resend_id?: string | null
  provider_message_id?: string | null
  subject: string
  status: string
  bounce_type?: string | null
  error?: string | null
  send_attempts?: number | null
  next_retry_at?: string | null
  created_at: string
  updated_at: string
}

/**
 * D1 行 → 本地契约（snake_case → camelCase）显式映射。
 *
 * 修复 P0-1：此前 `pollOutreachStatus` 直接 `return body.data as PollOutreachResult`。
 * TypeScript 的 `as` 只在编译期生效，运行时字段名仍是 snake_case，
 * 于是除 id / status / subject / provider / error 五个同名字段外，
 * **所有时间戳恒为 undefined** —— 后果连锁：
 *   · 看板漏斗六阶段全 0（sentCount 依赖 sentAt）
 *   · 趋势恒显示"当前时间窗口内无投递数据"
 *   · 明细表被时间窗口整表过滤为空（时间戳回落 0 < cutoff）
 *   · CSV 导出的时间戳列全空
 *   · IMAP 轮询恒 skipped:'no_outstanding_outreach'
 * 而既有门禁（typecheck / 单测 / IPC 一致性）均不覆盖跨进程字段命名，故全绿。
 *
 * 规则：跨进程响应一律走显式映射函数，**禁止裸 `as` 强转**。
 */
export const mapOutreachRow = (row: OutreachRow): OutreachStatus => ({
  id: row.id,
  workspaceId: row.workspace_id,
  leadId: row.lead_id,
  campaignId: row.campaign_id ?? '',
  sequenceStage: row.sequence_stage,
  scheduledAt: row.scheduled_at,
  sentAt: row.sent_at ?? null,
  deliveredAt: row.delivered_at ?? null,
  bouncedAt: row.bounced_at ?? null,
  complainedAt: row.complained_at ?? null,
  repliedAt: row.replied_at ?? null,
  provider: row.provider,
  resendId: row.resend_id ?? null,
  providerMessageId: row.provider_message_id ?? null,
  subject: row.subject,
  status: row.status,
  bounceType: row.bounce_type ?? null,
  error: row.error ?? null,
  sendAttempts: row.send_attempts ?? 0,
  nextRetryAt: row.next_retry_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/* ── Phase 2.5: 回复上报 ── */
export type ReportOutreachReplyPayload = {
  outreachId: string
  messageId: string
  inReplyTo?: string
  sender: string
  subject?: string
  replyBody?: string
  receivedAt?: string
}

export type ReportOutreachReplyResponse = {
  success: boolean
  data?: {
    id: string
    outreachId: string
    status: string
    idempotent: boolean
  }
  error?: { code: string; message: string; requestId?: string }
}

/**
 * 将 approved lead 加入发送队列（Phase 2）。
 * 云端 Cron 将定时扫描并调用 Resend API 发送。
 */
/* ── [V1.4.0] Phase 2.9 · 审批（AGENTS.md 宪法第 5 条）─────────────
   宪法：「高分、分阶段任务或 cloud_send 功能永不授权投递。
   审批 + 服务端二次门禁成功是强制前提。」
   本段提供审批记录的写入与查询；投递放行由云端门禁 ⑦ 判定。 */

export type CreateApprovalPayload = {
  leadId: string
  /** 审批人 = 本机机器 ID（与 license machineId 对齐；单机使用场景） */
  approverMachineId: string
  decision: 'approved' | 'rejected' | 'needs_revision'
  /** 当前草稿版本 —— 云端门禁 ⑦ 要求与审批记录严格相等 */
  draftVersion: number
  emailVerificationGrade: string
  manualExceptionReason?: string
}

export type CreateApprovalData = {
  approvalId: string
  leadId: string
  decision: string
  draftVersion: number
  status: string
}

export type ApprovalRecord = {
  id: string
  workspaceId: string
  leadId: string
  approverMachineId: string
  decision: string
  approvedAt: string
  draftVersion: number
  emailVerificationGrade: string
  manualExceptionReason: string | null
  riskSnapshot: string | null
  createdAt: string
}

export type ListApprovalsData = {
  approvals: ApprovalRecord[]
  limit: number
}

/** 云端 approvals 原始行（snake_case，与 D1 列名一致） */
type ApprovalRow = {
  id: string
  workspace_id: string
  lead_id: string
  approver_machine_id: string
  decision: string
  approved_at: string
  draft_version: number
  email_verification_grade: string
  manual_exception_reason?: string | null
  risk_snapshot?: string | null
  created_at: string
}

/**
 * D1 行 → 本地契约（snake_case → camelCase）显式映射。
 * 跨进程响应**禁止裸 `as` 强转**——P0-1 教训：as 仅编译期生效，
 * 运行时字段名不变会导致字段静默变 undefined。规则同 mapOutreachRow。
 */
const mapApprovalRow = (row: ApprovalRow): ApprovalRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  leadId: row.lead_id,
  approverMachineId: row.approver_machine_id,
  decision: row.decision,
  approvedAt: row.approved_at,
  draftVersion: row.draft_version,
  emailVerificationGrade: row.email_verification_grade,
  manualExceptionReason: row.manual_exception_reason ?? null,
  riskSnapshot: row.risk_snapshot ?? null,
  createdAt: row.created_at,
})

/** 写入审批记录（云端不可覆盖，只追加） */
export const createApproval = async (
  store: ConfigStore,
  payload: CreateApprovalPayload,
): Promise<CreateApprovalData> => {
  const config = getCloudflareConfig(store)

  const response = await fetchWithTimeout(`${config.url}/v1/approvals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Schema-Version': CLOUDFLARE_SCHEMA_VERSION,
    },
    body: JSON.stringify(payload),
  })

  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean
    data?: CreateApprovalData
    code?: string
    message?: string
  }

  if (!response.ok || body.success === false) {
    throw new Error(body.message || `Cloudflare create approval failed: ${response.status}`)
  }
  if (!body.data) {
    throw new Error('Cloudflare create approval returned no data')
  }
  return body.data
}

/** 查询审批记录（按 leadId 或最近 N 条） */
export const listApprovals = async (
  store: ConfigStore,
  opts?: { leadId?: string; limit?: number },
): Promise<ListApprovalsData> => {
  const config = getCloudflareConfig(store)

  const params = new URLSearchParams()
  if (opts?.leadId) params.set('leadId', opts.leadId)
  params.set('limit', String(opts?.limit ?? 50))

  const response = await fetchWithTimeout(`${config.url}/v1/approvals?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'X-Schema-Version': CLOUDFLARE_SCHEMA_VERSION,
    },
  })

  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean
    data?: { approvals?: ApprovalRow[]; limit?: number }
    code?: string
    message?: string
  }

  if (!response.ok || body.success === false) {
    throw new Error(body.message || `Cloudflare list approvals failed: ${response.status}`)
  }

  // 显式 snake→camel 映射，禁止裸 as（P0-1 教训）
  return {
    approvals: (body.data?.approvals ?? []).map(mapApprovalRow),
    limit: body.data?.limit ?? 0,
  }
}

export const queueOutreach = async (
  store: ConfigStore,
  payload: QueueOutreachPayload,
): Promise<QueueOutreachResponse> => {
  const config = getCloudflareConfig(store)

  const response = await fetchWithTimeout(`${config.url}/v1/outreach/queue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Schema-Version': CLOUDFLARE_SCHEMA_VERSION,
    },
    body: JSON.stringify(payload),
  })

  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean
    data?: QueueOutreachResponse['data']
    code?: string
    message?: string
    requestId?: string
  }

  if (!response.ok || body.success === false) {
    return {
      success: false,
      error: {
        code: body.code || `HTTP_${response.status}`,
        message: body.message || `Cloudflare outreach queue failed: ${response.status}`,
        requestId: body.requestId,
      },
    }
  }

  return {
    success: true,
    data: body.data,
  }
}

/**
 * 轮询 outreach 状态（Phase 2）。
 * 本地可定期调用以同步云端投递进度。
 */
export const pollOutreachStatus = async (
  store: ConfigStore,
  opts?: { status?: string; leadId?: string; limit?: number; offset?: number },
): Promise<PollOutreachResult> => {
  const config = getCloudflareConfig(store)

  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.leadId) params.set('leadId', opts.leadId)
  params.set('limit', String(opts?.limit ?? 50))
  params.set('offset', String(opts?.offset ?? 0))

  const response = await fetchWithTimeout(`${config.url}/v1/outreach/status?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'X-Schema-Version': CLOUDFLARE_SCHEMA_VERSION,
    },
  })

  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean
    data?: { outreach?: OutreachRow[]; limit?: number; offset?: number }
    code?: string
    message?: string
  }

  if (!response.ok || body.success === false) {
    throw new Error(body.message || `Cloudflare outreach status failed: ${response.status}`)
  }

  // 显式 snake→camel 映射（P0-1）：不得再直接 `as PollOutreachResult` 强转。
  const raw = body.data
  return {
    outreach: (raw?.outreach ?? []).map(mapOutreachRow),
    limit: raw?.limit ?? 0,
    offset: raw?.offset ?? 0,
  }
}

/**
 * 上报一条本地 IMAP 检测到的回复（Phase 2.5）。
 * 云端会将对应 outreach 置为 'replied' 终态，写入 email_replies 存档 + events 审计。
 */
export const reportOutreachReply = async (
  store: ConfigStore,
  payload: ReportOutreachReplyPayload,
): Promise<ReportOutreachReplyResponse> => {
  const config = getCloudflareConfig(store)

  const response = await fetchWithTimeout(`${config.url}/v1/outreach/reply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Schema-Version': CLOUDFLARE_SCHEMA_VERSION,
    },
    body: JSON.stringify(payload),
  })

  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean
    data?: ReportOutreachReplyResponse['data']
    code?: string
    message?: string
    requestId?: string
  }

  if (!response.ok || body.success === false) {
    return {
      success: false,
      error: {
        code: body.code ?? 'REPORT_REPLY_FAILED',
        message: body.message ?? `Cloudflare reply report failed: ${response.status}`,
        requestId: body.requestId,
      },
    }
  }

  return { success: true, data: body.data }
}

/* ──────────────────────────────────────────────
 *  IPC Handler Registration（供 Settings UI 使用）
 * ────────────────────────────────────────────── */

/* D2（2026-10-19）：`licenseGuard` 由 main.ts 注入（唯一实例）。本服务此前全部通道
   无授权门禁；审批类通道（CREATE_APPROVAL / LIST_APPROVALS）按 `cloud_send` 收口。 */
export const registerCloudflareHandlers = (
  ipcMain: Electron.IpcMain,
  store: ConfigStore,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
) => {
  // cloud:cloudflare-configured — 前端询问 Cloudflare 是否已配置
  registerIpc(
    IPC_CHANNELS.CLOUD.CLOUDFLARE_CONFIGURED,
    {
      channel: IPC_CHANNELS.CLOUD.CLOUDFLARE_CONFIGURED,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async () => {
      try {
        licenseGuard.requireFeature('cloud_send', '云端配置探测')
      } catch (error: any) {
        return buildFeatureDeniedResponse('云端配置探测', error)
      }
      return { success: true, data: { configured: isCloudflareConfigured(store) } }
    },
  )

  // cloud:cloudflare-test-connection — 前端"测试连接"按钮
  registerIpc(
    IPC_CHANNELS.CLOUD.CLOUDFLARE_TEST_CONNECTION,
    {
      channel: IPC_CHANNELS.CLOUD.CLOUDFLARE_TEST_CONNECTION,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async () => {
      /* 2026-10-20：`cloud_send` 收口。注意本处注册会被 outreach-sync-service 的同名
         后注册覆盖（有效 handler 在彼处），故彼处**同样**必须带门禁 —— 两处都加是
         防御纵深，避免未来注册顺序调整后静默失守。 */
      try {
        licenseGuard.requireFeature('cloud_send', '云端连接测试')
      } catch (error: any) {
        return buildFeatureDeniedResponse('云端连接测试', error)
      }
      // 与其他 handler 保持一致：捕获异常并返回结构化错误。
      // 此前无 try/catch，而 testConnection 内部的 getCloudflareConfig 位于其 try 之外，
      // 配置缺失时会抛出异常穿透到 IPC 层（前端只能看到 "[object Object]"）。
      try {
        return { success: true, data: await testConnection(store) }
      } catch (err) {
        return {
          success: false,
          error: {
            code: 'TEST_CONNECTION_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }
    },
  )

  // [V1.3.8] cloud:cloudflare-dashboard-stats — 云端触达看板聚合统计
  // Fail-Closed：未配置或调用失败时 success=false，前端展示"未连接"占位
  registerIpc(
    IPC_CHANNELS.CLOUD.CLOUDFLARE_DASHBOARD_STATS,
    {
      channel: IPC_CHANNELS.CLOUD.CLOUDFLARE_DASHBOARD_STATS,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async () => {
      try {
        licenseGuard.requireFeature('cloud_send', '云端触达统计')
      } catch (error: any) {
        return buildFeatureDeniedResponse('云端触达统计', error)
      }
      try {
        return { success: true, data: await getDashboardStats(store) }
      } catch (err) {
        return {
          success: false,
          error: {
            code: 'DASHBOARD_STATS_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }
    },
  )

  // [V1.3.8] cloud:cloudflare-poll-outreach-status — 云端触达明细（漏斗 + 30 日趋势）
  // 允许 {status?, limit?, offset?}，其余走 service 默认值
  registerIpc(
    IPC_CHANNELS.CLOUD.CLOUDFLARE_POLL_OUTREACH_STATUS,
    {
      channel: IPC_CHANNELS.CLOUD.CLOUDFLARE_POLL_OUTREACH_STATUS,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async (_event: unknown, ...args: unknown[]) => {
      try {
        licenseGuard.requireFeature('cloud_send', '云端投递明细')
      } catch (error: any) {
        return buildFeatureDeniedResponse('云端投递明细', error)
      }
      try {
        const opts = (args[0] ?? {}) as { status?: string; limit?: number; offset?: number }
        return { success: true, data: await pollOutreachStatus(store, opts) }
      } catch (err) {
        return {
          success: false,
          error: {
            code: 'POLL_OUTREACH_STATUS_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }
    },
  )

  // [V1.4.0] cloud:create-approval — 写入审批记录（AGENTS.md 宪法第 5 条）
  registerIpc(
    IPC_CHANNELS.CLOUD.CREATE_APPROVAL,
    {
      channel: IPC_CHANNELS.CLOUD.CREATE_APPROVAL,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async (_event: unknown, ...args: unknown[]) => {
      /* D2（2026-10-19 修复）：本通道此前**无任何门禁**——试用版/基础版均可写入云端审批
         记录。审批是 `cloud_send` 服务端二次门禁的前置（PRD §5.1.2 / §13.1）。 */
      try {
        licenseGuard.requireFeature('cloud_send', '云端审批提交')
      } catch (error: any) {
        return buildFeatureDeniedResponse('云端审批提交', error)
      }
      try {
        const payload = args[0] as CreateApprovalPayload
        return { success: true, data: await createApproval(store, payload) }
      } catch (err) {
        return {
          success: false,
          error: {
            code: 'CREATE_APPROVAL_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }
    },
  )

  // [V1.4.0] cloud:list-approvals — 查询审批记录
  registerIpc(
    IPC_CHANNELS.CLOUD.LIST_APPROVALS,
    {
      channel: IPC_CHANNELS.CLOUD.LIST_APPROVALS,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async (_event: unknown, ...args: unknown[]) => {
      /* D2（2026-10-19 修复）：本通道此前**无任何门禁**——审批记录属 `cloud_send` 域，
         试用版/基础版不应读取。 */
      try {
        licenseGuard.requireFeature('cloud_send', '云端审批查询')
      } catch (error: any) {
        return buildFeatureDeniedResponse('云端审批查询', error)
      }
      try {
        const opts = (args[0] ?? {}) as { leadId?: string; limit?: number }
        return { success: true, data: await listApprovals(store, opts) }
      } catch (err) {
        return {
          success: false,
          error: {
            code: 'LIST_APPROVALS_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }
    },
  )
}
