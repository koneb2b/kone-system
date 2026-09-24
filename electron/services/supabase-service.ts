/**
 * supabase-service.ts — 云端团队同步 & 防撞单引擎
 *
 * 架构原则（ARCH-STANDARDS §7）:
 * - 边缘重活，云端轻量：本地负责 AI 打分，云端仅存精简状态
 * - 高价值过滤（Gold Filter）：score >= 80 或手动标记才允许上云
 * - 云端凭证安全：Supabase URL/Key 从配置注入，不硬编码
 * - 优雅降级：云端不可达时静默回退本地模式
 */

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { IPC_CHANNELS } from '../ipc/channels'
import { registerSecureFeatureIpc } from './license-service'
import { getPhysicalMachineId } from './license-service'
import { extractDomain } from '../utils/domain'
import { evaluateCloudSyncGate } from '../utils/cloud-sync-gate'
import type { ConfigStore } from './config-service'
import * as crypto from 'crypto'

/* ──────────────────────────────────────────────
 *  Types
 * ────────────────────────────────────────────── */
export type CloudLead = {
  id?: string
  domain: string
  email?: string
  company?: string
  country?: string
  ai_tags?: string[]
  score: number
  owner_machine_id: string
  owner_label?: string
  status?: 'following' | 'contacted' | 'replied' | 'archived'
  is_opened?: boolean
  opened_at?: string
  opened_geo?: string
  created_at?: string
  updated_at?: string
}

export type DomainCollisionResult = {
  collision: boolean
  ownerLabel?: string
  ownerMachineId?: string
  domain: string
  /* B-01 修复：区分"确实无碰撞"与"查询失败无法确认"。
     unknown=true 表示因网络/权限/数据库错误无法确认防撞状态，
     前端不得将其展示为"可安全触达"。 */
  unknown?: boolean
  error?: string
}

export type TeamLeadEntry = CloudLead & { id: string; created_at: string }

type SupabaseConfig = { url: string; anonKey: string }

/* ──────────────────────────────────────────────
 *  Singleton Supabase client (lazy init)
 * ────────────────────────────────────────────── */
let cachedClient: SupabaseClient | null = null
let cachedConfigHash = ''

// P0-2 fix: 凭证必须通过配置注入，严禁硬编码 fallback (.clinerules §6.3)
const getSupabaseConfig = (store: ConfigStore): SupabaseConfig => {
  const url = String(store.get('cloud.supabaseUrl') || '').trim()
  const anonKey = String(store.get('cloud.supabaseAnonKey') || '').trim()
  if (!url || !anonKey) {
    throw new Error('未配置云端引擎凭证，请在系统设置中填写 Supabase URL 与 Key')
  }
  return { url, anonKey }
}

/* P0-6 修复：Supabase REST 调用原先全部没有超时，网络挂起即永久 pending。
   通过注入 global.fetch 一次性覆盖所有 .from()/.rpc()/鉴权请求，
   无需在 9 个调用点逐一包裹 AbortSignal。 */
const SUPABASE_TIMEOUT_MS = 15_000

const supabaseFetchWithTimeout = (input: unknown, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController()
  /* 请求超时定时器不得 unref()，否则在无其他句柄时事件循环会提前退出、超时永不触发。 */
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS)

  const upstream = init?.signal
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  const signal = upstream && typeof anyFn === 'function' ? anyFn([upstream, controller.signal]) : controller.signal

  return fetch(input as Parameters<typeof fetch>[0], { ...(init || {}), signal }).finally(() => clearTimeout(timer))
}

const getClient = (store: ConfigStore): SupabaseClient => {
  const config = getSupabaseConfig(store)
  const hash = `${config.url}|${config.anonKey}`
  if (cachedClient && cachedConfigHash === hash) return cachedClient
  cachedClient = createClient(config.url, config.anonKey, {
    auth: { persistSession: false },
    global: { fetch: supabaseFetchWithTimeout as unknown as typeof fetch },
  })
  cachedConfigHash = hash
  return cachedClient
}

/* ──────────────────────────────────────────────
 *  Core functions
 * ────────────────────────────────────────────── */
const GOLD_FILTER_MIN_SCORE = 80

const compactLead = (lead: Record<string, unknown>, machineId: string): Partial<CloudLead> => ({
  domain: extractDomain(String(lead.website || lead.domain || '')),
  email:
    String(lead.email || '')
      .trim()
      .slice(0, 255) || undefined,
  company:
    String(lead.company || '')
      .trim()
      .slice(0, 200) || undefined,
  country:
    String(lead.country || '')
      .trim()
      .slice(0, 50) || undefined,
  ai_tags: Array.isArray(lead.matchReasons) ? lead.matchReasons.map(String).slice(0, 5) : [],
  score: Math.round(Number(lead.matchScore || lead.score || 0)),
  owner_machine_id: machineId,
  owner_label:
    String(lead.ownerLabel || '')
      .trim()
      .slice(0, 100) || undefined,
  status: 'following',
})

/**
 * 防撞单检测：查询云端该 domain 是否已被其他设备认领
 */
const checkDomainCollision = async (store: ConfigStore, domain: string): Promise<DomainCollisionResult> => {
  const normalizedDomain = extractDomain(domain)
  const client = getClient(store)
  const machineId = getPhysicalMachineId(store)
  try {
    const { data, error } = await client
      .from('leads')
      .select('owner_machine_id, owner_label')
      .eq('domain', normalizedDomain)
      .neq('owner_machine_id', machineId)
      .limit(1)
      .single()

    if (error) {
      // B-01 修复：Supabase 返回错误时不能假设"无碰撞"——必须返回 unknown
      return { collision: false, domain: normalizedDomain, unknown: true, error: error.message }
    }
    if (!data) {
      // 查询成功但无匹配行 = 确实无碰撞
      return { collision: false, domain: normalizedDomain }
    }
    return {
      collision: true,
      ownerLabel: data.owner_label || undefined,
      ownerMachineId: data.owner_machine_id,
      domain: normalizedDomain,
    }
  } catch {
    // 网络不可达 → 不能假设无碰撞
    return { collision: false, domain: normalizedDomain, unknown: true, error: '网络不可达，无法确认防撞状态' }
  }
}

/**
 * 高价值线索上云（Gold Filter: score >= 80 或 force=true）
 */
const syncLeadToCloud = async (
  store: ConfigStore,
  lead: Record<string, unknown>,
  force = false,
): Promise<{ synced: boolean; reason?: string }> => {
  /* §L157 上云 Gold Filter（宪法）：合格 = 评分达阈值（或人工 force）**且 email 非空**。
     此前只校验评分与域名、漏了 email，会把无邮箱线索 bulk-sync 上云。 */
  const gate = evaluateCloudSyncGate(lead, GOLD_FILTER_MIN_SCORE, force)
  if (!gate.allowed) {
    return { synced: false, reason: gate.reason }
  }
  const client = getClient(store)
  const machineId = getPhysicalMachineId(store)
  const payload = compactLead(lead, machineId)
  if (!payload.domain) {
    return { synced: false, reason: '缺少域名，无法同步' }
  }
  try {
    const { error } = await client
      .from('leads')
      .upsert({ ...payload, updated_at: new Date().toISOString() }, { onConflict: 'domain,owner_machine_id' })
    if (error) {
      console.error('[Supabase] syncLeadToCloud failed:', error.message)
      return { synced: false, reason: `云端写入失败: ${error.message}` }
    }
    return { synced: true }
  } catch (err: any) {
    console.error('[Supabase] syncLeadToCloud exception:', err?.message)
    return { synced: false, reason: '云端连接异常，线索已保留在本地' }
  }
}

/**
 * 拉取团队最新高分线索流
 */
const fetchTeamLeads = async (
  store: ConfigStore,
  limit = 50,
): Promise<{ leads: TeamLeadEntry[]; offline: boolean }> => {
  const client = getClient(store)
  try {
    const { data, error } = await client
      .from('leads')
      .select('*')
      .gte('score', GOLD_FILTER_MIN_SCORE)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return { leads: [], offline: false }
    return { leads: (data || []) as TeamLeadEntry[], offline: false }
  } catch {
    return { leads: [], offline: true }
  }
}

/**
 * 读取打开追踪状态
 */
const fetchTrackingStatus = async (
  store: ConfigStore,
  domains: string[],
): Promise<{
  tracking: Record<string, { isOpened: boolean; openedAt?: string; openedGeo?: string }>
  offline: boolean
}> => {
  const client = getClient(store)
  if (domains.length === 0) return { tracking: {}, offline: false }
  try {
    const { data, error } = await client
      .from('leads')
      .select('domain, is_opened, opened_at, opened_geo')
      .in('domain', domains.map(extractDomain))
    if (error) return { tracking: {}, offline: false }
    const map: Record<string, { isOpened: boolean; openedAt?: string; openedGeo?: string }> = {}
    for (const row of data || []) {
      map[row.domain] = { isOpened: Boolean(row.is_opened), openedAt: row.opened_at, openedGeo: row.opened_geo }
    }
    return { tracking: map, offline: false }
  } catch {
    return { tracking: {}, offline: true }
  }
}

/**
 * 拉取所有已被团队其他成员认领的域名集合（防撞单墙用）
 */
const fetchClaimedDomains = async (store: ConfigStore): Promise<{ domains: string[]; offline: boolean }> => {
  const client = getClient(store)
  const machineId = getPhysicalMachineId(store)
  try {
    const { data, error } = await client.from('leads').select('domain').neq('owner_machine_id', machineId)
    if (error) return { domains: [], offline: false }
    return { domains: (data || []).map((r: { domain: string }) => r.domain), offline: false }
  } catch {
    return { domains: [], offline: true }
  }
}

/**
 * upsertLead — 按 (domain, owner_machine_id) 联合主键防重写入
 * 严格剥离源码，仅保留核心字段（ARCH-STANDARDS §7: ~1KB/条）
 */
const upsertLead = async (
  store: ConfigStore,
  lead: Record<string, unknown>,
  force = false,
): Promise<{ upserted: boolean; id?: string; reason?: string }> => {
  const score = Math.round(Number(lead.matchScore || lead.score || 0))
  if (!force && score < GOLD_FILTER_MIN_SCORE) {
    return { upserted: false, reason: `评分 ${score} 低于上云阈值 ${GOLD_FILTER_MIN_SCORE}` }
  }
  const client = getClient(store)
  const machineId = getPhysicalMachineId(store)
  const payload = compactLead(lead, machineId)
  if (!payload.domain) {
    return { upserted: false, reason: '缺少域名，无法写入' }
  }
  try {
    const { data, error } = await client
      .from('leads')
      .upsert({ ...payload, updated_at: new Date().toISOString() }, { onConflict: 'domain,owner_machine_id' })
      .select('id')
      .single()
    if (error) {
      return { upserted: false, reason: `云端写入失败: ${error.message}` }
    }
    return { upserted: true, id: data?.id }
  } catch (err: any) {
    return { upserted: false, reason: '云端连接异常，线索已保留在本地' }
  }
}

/**
 * checkDomainCollisions — 高效批量撞单查询
 * 使用 .in('domain', domains) + .neq('owner_machine_id', self)
 * 返回被其他设备认领的域名列表
 */
const checkDomainCollisions = async (
  store: ConfigStore,
  domains: string[],
): Promise<{ claimedDomains: string[]; offline: boolean; error?: string }> => {
  if (!domains.length) return { claimedDomains: [], offline: false }
  const client = getClient(store)
  const machineId = getPhysicalMachineId(store)
  const normalized = domains.map(extractDomain).filter(Boolean)
  if (!normalized.length) return { claimedDomains: [], offline: false }
  try {
    const { data, error } = await client
      .from('leads')
      .select('domain')
      .in('domain', normalized)
      .neq('owner_machine_id', machineId)
    if (error) return { claimedDomains: [], offline: true, error: error.message }
    const claimed = [...new Set((data || []).map((r: { domain: string }) => r.domain))]
    return { claimedDomains: claimed, offline: false }
  } catch {
    return { claimedDomains: [], offline: true }
  }
}

/**
 * createCampaign — 将发信任务写入 campaigns 表
 * 强制设定 status='queued'，由 n8n 后续消费
 */
const createCampaign = async (
  store: ConfigStore,
  config: {
    leadId?: string
    domain: string
    email: string
    templateId: string
    sequenceStep?: number
    idempotencyKey?: string
  },
): Promise<{ created: boolean; campaignId?: string; status?: string; error?: string; duplicate?: boolean }> => {
  const client = getClient(store)
  const machineId = getPhysicalMachineId(store)
  const domain = extractDomain(config.domain)
  if (!domain || !config.email) {
    return { created: false, error: '缺少域名或邮箱' }
  }
  // IDEM-01 修复：生成或使用提供的幂等键
  const idempotencyKey =
    config.idempotencyKey ||
    crypto
      .createHash('sha256')
      .update(`${machineId}|${domain}|${config.email}|${config.templateId}|${config.sequenceStep || 1}`)
      .digest('hex')
  try {
    const { data, error } = await client
      .from('campaigns')
      .insert({
        lead_id: config.leadId || null,
        domain,
        email: config.email.trim().slice(0, 255),
        template_id: config.templateId || 'default',
        sequence_step: config.sequenceStep || 1,
        status: 'queued',
        owner_machine_id: machineId,
        idempotency_key: idempotencyKey,
      })
      .select('id, status')
      .single()
    if (error) {
      // IDEM-01：检测幂等键冲突（重复提交）——返回已有记录而非报错
      if (error.code === '23505' || error.message.includes('duplicate')) {
        const { data: existing } = await client
          .from('campaigns')
          .select('id, status')
          .eq('owner_machine_id', machineId)
          .eq('idempotency_key', idempotencyKey)
          .single()
        if (existing) {
          return { created: false, campaignId: existing.id, status: existing.status || 'queued', duplicate: true }
        }
      }
      return { created: false, error: `任务写入失败: ${error.message}` }
    }
    return { created: true, campaignId: data?.id, status: data?.status || 'queued' }
  } catch (err: any) {
    return { created: false, error: '云端连接异常，任务未入队' }
  }
}

/* ──────────────────────────────────────────────
 *  Supabase Realtime 订阅引擎
 * ────────────────────────────────────────────── */
let realtimeChannel: RealtimeChannel | null = null

const startRealtimeSubscription = (
  store: ConfigStore,
  sendToRenderer: (event: { eventType: string; new: unknown; old: unknown }) => void,
) => {
  if (realtimeChannel) return // 已订阅
  const client = getClient(store)
  realtimeChannel = client
    .channel('kone-leads-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
      sendToRenderer({
        eventType: payload.eventType,
        new: payload.new || null,
        old: payload.old || null,
      })
    })
    .subscribe()
}

const stopRealtimeSubscription = (store: ConfigStore) => {
  if (!realtimeChannel) return
  const client = getClient(store)
  client.removeChannel(realtimeChannel)
  realtimeChannel = null
}

/* ──────────────────────────────────────────────
 *  IPC Handler Registration
 * ────────────────────────────────────────────── */
export const registerSupabaseHandlers = (
  ipcMain: Electron.IpcMain,
  store: ConfigStore,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  getMainWindow?: () => Electron.BrowserWindow | null,
) => {
  // cloud:check-collision — premium only
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.CHECK_COLLISION,
    store,
    licenseGuard,
    'cloud_send',
    async (_event, payload: { domain: string } | undefined | null) => {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '防撞单检测参数无效', code: 400 }
      }
      if (typeof payload.domain !== 'string' || !payload.domain.trim()) {
        return { success: false, error: 'domain 参数无效', code: 400 }
      }
      const result = await checkDomainCollision(store, payload.domain)
      return { success: true, data: result }
    },
    '防撞单检测',
  )

  // cloud:sync-lead — premium only, Gold Filter enforced
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.SYNC_LEAD,
    store,
    licenseGuard,
    'cloud_send',
    async (_event, payload: { lead: Record<string, unknown>; force?: boolean } | undefined | null) => {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '线索云端同步参数无效', code: 400 }
      }
      if (!payload.lead || typeof payload.lead !== 'object') {
        return { success: false, error: 'lead 参数无效', code: 400 }
      }
      const result = await syncLeadToCloud(store, payload.lead, payload.force)
      return { success: true, data: result }
    },
    '线索云端同步',
  )

  // cloud:fetch-team-leads — premium only
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.FETCH_TEAM_LEADS,
    store,
    licenseGuard,
    'cloud_send',
    async (_event, payload?: { limit?: number }) => {
      const result = await fetchTeamLeads(store, payload?.limit)
      return { success: true, data: result }
    },
    '团队线索拉取',
  )

  // cloud:fetch-tracking — premium only
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.FETCH_TRACKING,
    store,
    licenseGuard,
    'cloud_send',
    async (_event, payload: { domains: string[] } | undefined | null) => {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '追踪状态查询参数无效', code: 400 }
      }
      if (!Array.isArray(payload.domains)) {
        return { success: false, error: 'domains 参数无效', code: 400 }
      }
      const result = await fetchTrackingStatus(store, payload.domains)
      return { success: true, data: result }
    },
    '追踪状态查询',
  )

  // cloud:fetch-claimed-domains — premium only
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.FETCH_CLAIMED_DOMAINS,
    store,
    licenseGuard,
    'cloud_send',
    async () => {
      const result = await fetchClaimedDomains(store)
      return { success: true, data: result }
    },
    '已认领域名查询',
  )

  // cloud:upsert-lead — premium only, Gold Filter enforced at function level
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.UPSERT_LEAD,
    store,
    licenseGuard,
    'cloud_send',
    async (_event, payload: { lead: Record<string, unknown>; force?: boolean } | undefined | null) => {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '线索 Upsert 参数无效', code: 400 }
      }
      if (!payload.lead || typeof payload.lead !== 'object') {
        return { success: false, error: 'lead 参数无效', code: 400 }
      }
      const result = await upsertLead(store, payload.lead, payload.force)
      return { success: true, data: result }
    },
    '线索Upsert',
  )

  // cloud:check-domains — premium only, batch collision check
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.CHECK_DOMAINS,
    store,
    licenseGuard,
    'cloud_send',
    async (_event, payload: { domains: string[] } | undefined | null) => {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '批量撞单检测参数无效', code: 400 }
      }
      if (!Array.isArray(payload.domains)) {
        return { success: false, error: 'domains 参数无效', code: 400 }
      }
      const result = await checkDomainCollisions(store, payload.domains)
      return { success: true, data: result }
    },
    '批量撞单检测',
  )

  // cloud:create-campaign — premium only
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.CREATE_CAMPAIGN,
    store,
    licenseGuard,
    'cloud_send',
    async (
      _event,
      payload:
        | { leadId?: string; domain: string; email: string; templateId: string; sequenceStep?: number }
        | undefined
        | null,
    ) => {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '创建发信任务参数无效', code: 400 }
      }
      if (
        typeof payload.domain !== 'string' ||
        typeof payload.email !== 'string' ||
        typeof payload.templateId !== 'string'
      ) {
        return { success: false, error: 'domain、email 或 templateId 参数无效', code: 400 }
      }
      const result = await createCampaign(store, payload)
      return { success: true, data: result }
    },
    '创建发信任务',
  )

  // cloud:subscribe-realtime — start Supabase Realtime channel
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.SUBSCRIBE_REALTIME,
    store,
    licenseGuard,
    'cloud_send',
    async () => {
      startRealtimeSubscription(store, (event) => {
        const win = getMainWindow?.()
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.CLOUD.REALTIME_LEAD_EVENT, event)
        }
      })
      return { success: true, data: null }
    },
    'Realtime订阅启动',
  )

  // cloud:unsubscribe-realtime — stop Supabase Realtime channel
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.CLOUD.UNSUBSCRIBE_REALTIME,
    store,
    licenseGuard,
    'cloud_send',
    async () => {
      stopRealtimeSubscription(store)
      return { success: true, data: null }
    },
    'Realtime订阅停止',
  )
}
