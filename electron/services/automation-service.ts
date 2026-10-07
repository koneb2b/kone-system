/**
 * automation-service.ts — 邮箱有效性验证 & 云端发信对接（目标态）
 *
 * 架构原则（ARCH-STANDARDS §7）:
 * - 边缘重活：邮箱验证（SMTP 握手模拟）在本地执行
 * - 云端投递闭环为目标态，Phase 1 接入 Cloudflare Workers + Queue + Resend
 * - 当前版本仅保留邮箱验证与授权门禁，start-campaign 返回降级提示
 */

import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc, registry } from '../ipc/registry'
import { automationStartCampaignContract } from '../ipc/contracts/automation.contract'
import { ensureTrialAccess, registerSecureFeatureIpc } from './license-service'
import { getPhysicalMachineId } from './license-service'
import { verifyEmailDetailed, classifyEmailStatic } from '../utils/email-verification'
import {
  buildLeadPayload,
  deriveIdempotencyKey,
  pushLeadsBatch,
  isCloudflareConfigured,
  queueOutreach,
} from './cloudflare-service'
import type { ConfigStore } from './config-service'
import * as crypto from 'crypto'

/* ──────────────────────────────────────────────
 *  Types
 * ────────────────────────────────────────────── */
export type EmailVerifyResult = {
  email: string
  valid: boolean
  /* P0-3 五级分级: verified / probable / catch_all / risky / invalid（增量字段，向后兼容） */
  grade?: string
  reason?: string
}

export type CampaignStartResult = {
  triggered: boolean
  pushed?: boolean
  accepted?: number
  rejected?: number
  error?: string
  message?: string
}

export type EmailTemplate = {
  id: string
  name: string
  subject: string
  body: string
}

/* ──────────────────────────────────────────────
 *  Email Verification（P0-3 五级分级引擎）
 *  实现位于 utils/email-verification.ts（RFC 深度校验 / disposable / role-account /
 *  catch-all 探测 / 灰名单退避）。此处保持 IPC 面、Premium 保护与批量纪律不变。
 * ────────────────────────────────────────────── */

export { classifyEmailStatic }

const verifyEmail = async (email: string): Promise<EmailVerifyResult> => {
  try {
    const result = await verifyEmailDetailed(email)
    return { email: result.email, valid: result.valid, grade: result.grade, reason: result.reason }
  } catch {
    /* 引擎保证 resolve，不 reject——此分支仅为兜底，不武断标 verified。 */
    const trimmed = String(email || '')
      .trim()
      .toLowerCase()
    return { email: trimmed, valid: false, grade: 'probable', reason: 'SMTP 验证异常' }
  }
}

/* P2-1 五级验证差异化队列（kone-PRD §六邮箱五级分级）：
   verified/probable → primary 主队列；catch_all → throttled（限频靠内容防投诉）；
   risky → deprioritized（disposable/role 降权）；invalid → suppressionCandidates（建议入抑制清单）。
   未知 grade 按 valid 兜底归类。纯函数，导出供测试与渲染端复用。 */
export type VerificationQueues = {
  primary: EmailVerifyResult[]
  throttled: EmailVerifyResult[]
  deprioritized: EmailVerifyResult[]
  suppressionCandidates: EmailVerifyResult[]
}

export const buildVerificationQueues = (results: EmailVerifyResult[]): VerificationQueues => {
  const queues: VerificationQueues = { primary: [], throttled: [], deprioritized: [], suppressionCandidates: [] }
  for (const result of Array.isArray(results) ? results : []) {
    if (result.grade === 'verified' || result.grade === 'probable') queues.primary.push(result)
    else if (result.grade === 'catch_all') queues.throttled.push(result)
    else if (result.grade === 'risky') queues.deprioritized.push(result)
    else if (result.grade === 'invalid') queues.suppressionCandidates.push(result)
    else (result.valid ? queues.primary : queues.suppressionCandidates).push(result)
  }
  return queues
}

/* P1-11：邮箱验证并发度。原实现完全串行，单邮箱最坏约 17.5s
   （SMTP 8s + 灰名单回退 1.5s + catch-all 探测 8s），50 条最坏 >14 分钟，
   期间该 IPC 永不返回。改为**有界**并发：既避免 SMTP 端口爆发，
   又把最坏耗时压到约 1/4。可用环境变量覆盖以便测试。 */
const EMAIL_VERIFY_CONCURRENCY = Math.max(1, Number(process.env.KONE_EMAIL_VERIFY_CONCURRENCY) || 4)

/** 有界并发映射：结果顺序与入参严格对齐（按索引回填），不改变批处理语义。 */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runner = async () => {
    for (;;) {
      const index = cursor
      if (index >= items.length) return
      cursor += 1
      results[index] = await worker(items[index])
    }
  }
  const runnerCount = Math.max(1, Math.min(limit, items.length || 1))
  await Promise.all(Array.from({ length: runnerCount }, () => runner()))
  return results
}

const verifyEmailsBatch = async (emails: string[]): Promise<EmailVerifyResult[]> => {
  const targets = emails.slice(0, 50)
  return mapWithConcurrency(targets, EMAIL_VERIFY_CONCURRENCY, (email) => verifyEmail(email))
}

/* ──────────────────────────────────────────────
 *  Cloud Campaign Trigger（目标态 — Phase 1 接入 Cloudflare Workers + Queue）
 *  当前版本返回降级提示，保留授权门禁与 IPC 契约。
 * ────────────────────────────────────────────── */

/* ──────────────────────────────────────────────
 *  IPC Handler Registration
 * ────────────────────────────────────────────── */
export const registerAutomationHandlers = (
  ipcMain: Electron.IpcMain,
  store: ConfigStore,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
) => {
  // automation:verify-emails — premium only
  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.AUTOMATION.VERIFY_EMAILS,
    store,
    licenseGuard,
    'cloud_send',
    async (_event, payload: { emails: string[] } | undefined | null) => {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '邮箱验证参数无效', code: 400 }
      }
      if (!Array.isArray(payload.emails)) {
        return { success: false, error: '邮箱列表格式无效', code: 400 }
      }
      const results = await verifyEmailsBatch(payload.emails || [])
      return { success: true, data: { results } }
    },
    '邮箱有效性检测',
  )

  // automation:start-campaign — premium only
  // Phase 1: 推送台账至 Cloudflare D1；本地 SMTP 仍为主发送通道。
  registerIpc(
    IPC_CHANNELS.AUTOMATION.START_CAMPAIGN,
    automationStartCampaignContract,
    async (_event: unknown, payload: unknown) => {
      const p = (payload || {}) as { leads?: Array<Record<string, unknown>>; templateId?: string }
      const trialDenied = ensureTrialAccess(store, licenseGuard, '自动化发信')
      if (trialDenied) {
        return trialDenied
      }

      try {
        licenseGuard.requireFeature('cloud_send', '自动化发信')
      } catch (error: any) {
        return {
          success: false,
          error: 'FEATURE_DENIED',
          message: String(error?.message || '当前授权无权执行自动化发信'),
          operationName: '自动化发信',
          code: Number(error?.code) || 403,
        }
      }

      const leads = Array.isArray(p?.leads) ? p.leads : []

      // Phase 1: Provider routing — 'cloudflare' | 'supabase' | (unset = supabase legacy)
      // Supabase 路径仍返回目标态降级（Phase 0 已移除 N8N，Phase 2 才接入 Resend 投递）。
      const provider = String(store.get('cloud.provider') || 'supabase')
        .trim()
        .toLowerCase()

      if (provider !== 'cloudflare' || !isCloudflareConfigured(store)) {
        return {
          success: true,
          data: {
            triggered: false,
            pushed: false,
            accepted: 0,
            rejected: leads.length,
            message:
              provider === 'cloudflare'
                ? 'Cloudflare 云端引擎未配置，请先在系统设置 > 云端引擎中填写 API URL / Key / Workspace ID。'
                : '云端投递闭环为目标态，当前版本仅支持本地发信。请在系统设置中将云端引擎切换为 Cloudflare 以启用台账推送。',
          },
        }
      }

      const workspaceId = String(store.get('cloud.cloudflareWorkspaceId') || '').trim()

      // 构造 payload：将本地 lead 映射到云端 schema（对齐 CLOUD-COLLABORATION-DELIVERY.md §7.1）
      const batch = leads.map((lead) => {
        const localRefId = String((lead as any).id || crypto.randomUUID())
        return {
          localRefId,
          payload: buildLeadPayload(lead as any, workspaceId),
          idempotencyKey: deriveIdempotencyKey(localRefId),
        }
      })

      const result = await pushLeadsBatch(store, batch)

      return {
        success: true,
        data: {
          triggered: true,
          pushed: result.pushed,
          accepted: result.accepted,
          rejected: result.rejected,
          errors: result.errors,
          message:
            result.rejected === 0
              ? `已推送 ${result.accepted} 条线索至云端台账。本地 SMTP 通道继续处理实际投递。`
              : `推送完成：成功 ${result.accepted} 条，失败 ${result.rejected} 条。`,
        },
      }
    },
  )

  /* Phase 2: 将 approved lead 加入发送队列 */
  registerIpc(
    IPC_CHANNELS.AUTOMATION.QUEUE_OUTREACH,
    {
      channel: IPC_CHANNELS.AUTOMATION.QUEUE_OUTREACH,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async (_event: unknown, p: any) => {
      // License gate: premium feature
      const trialDenied = ensureTrialAccess(store, licenseGuard, '云端投递')
      if (trialDenied) return trialDenied

      const { leadId, subject, body, scheduledAt, sequenceStage } = p || {}

      if (!leadId || !subject || !body) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '缺少必填字段：leadId, subject, body',
          },
        }
      }

      const result = await queueOutreach(store, {
        leadId,
        subject,
        body,
        scheduledAt,
        sequenceStage,
      })

      return {
        success: result.success,
        data: result.data,
        error: result.error,
      }
    },
  )

  /* 自绑定兼容层（与 agent-service / autopilot-state-service / auth-service /
     sandbox-service 同构）：历史 e2e / 独立测试直接调用本函数而未显式 attach，
     迁移后 START_CAMPAIGN 需落到 ipcMain 才能被 getHandler 取到。attach 按
     ipcMain 实例幂等，主进程末尾的 attach 不会重复绑定。 */
  registry.attach(ipcMain)
}
