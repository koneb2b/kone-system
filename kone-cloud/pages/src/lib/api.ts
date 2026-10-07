// API client for Kone Cloud Worker
// Reads config from localStorage; caller manages auth state.

export type Credentials = {
  apiUrl: string
  apiKey: string
}

export type ApiResult<T> = {
  success: true
  data: T
  requestId?: string
} | {
  success: false
  code: string
  message: string
  requestId?: string
}

export type LeadRow = {
  id: string
  workspace_id: string
  company_id: string
  contact_id: string
  score: number
  status: string
  draft_version: number
  local_ref_id: string
  created_at: string
  updated_at: string
}

export type EventRow = {
  id: number
  workspace_id: string
  lead_id: string | null
  outreach_id: string | null
  type: string
  actor: string | null
  payload: string | null
  external_id: string | null
  occurred_at: string
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

const SCHEMA_VERSION = '1.0.0'

export const isConfigured = (creds?: Credentials | null): creds is Credentials => {
  return !!creds && !!creds.apiUrl && !!creds.apiKey
}

const buildHeaders = (creds: Credentials): Headers => {
  return new Headers({
    'Authorization': `Bearer ${creds.apiKey}`,
    'X-Schema-Version': SCHEMA_VERSION,
  })
}

const baseUrl = (creds: Credentials) => creds.apiUrl.replace(/\/+$/, '')

export const fetchDashboardStats = async (creds: Credentials): Promise<DashboardStats> => {
  const res = await fetch(`${baseUrl(creds)}/v1/dashboard/stats`, {
    method: 'GET',
    headers: buildHeaders(creds),
  })
  const body = (await res.json()) as ApiResult<DashboardStats>
  if (!body.success) throw new Error(body.message || `HTTP ${res.status}`)
  return body.data
}

export const fetchLeads = async (
  creds: Credentials,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<LeadRow[]> => {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  params.set('limit', String(opts.limit ?? 50))
  params.set('offset', String(opts.offset ?? 0))
  const res = await fetch(`${baseUrl(creds)}/v1/leads?${params.toString()}`, {
    method: 'GET',
    headers: buildHeaders(creds),
  })
  const body = (await res.json()) as ApiResult<{ leads: LeadRow[]; limit: number; offset: number }>
  if (!body.success) throw new Error(body.message || `HTTP ${res.status}`)
  return body.data.leads
}

export const fetchEvents = async (
  creds: Credentials,
  opts: { since?: string; leadId?: string; limit?: number } = {},
): Promise<EventRow[]> => {
  const params = new URLSearchParams()
  if (opts.since) params.set('since', opts.since)
  if (opts.leadId) params.set('leadId', opts.leadId)
  params.set('limit', String(opts.limit ?? 100))
  const res = await fetch(`${baseUrl(creds)}/v1/events?${params.toString()}`, {
    method: 'GET',
    headers: buildHeaders(creds),
  })
  const body = (await res.json()) as ApiResult<{ events: EventRow[]; since: string }>
  if (!body.success) throw new Error(body.message || `HTTP ${res.status}`)
  return body.data.events
}

export const testConnection = async (creds: Credentials): Promise<{ ok: boolean; message: string; latencyMs: number }> => {
  const start = Date.now()
  try {
    const res = await fetch(`${baseUrl(creds)}/healthz`, { method: 'GET' })
    if (!res.ok) return { ok: false, message: `健康检查失败：${res.status}`, latencyMs: Date.now() - start }
    await fetchDashboardStats(creds)
    return { ok: true, message: '云端引擎连通正常', latencyMs: Date.now() - start }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '连接失败', latencyMs: Date.now() - start }
  }
}
