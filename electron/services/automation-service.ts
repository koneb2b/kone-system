/**
 * automation-service.ts — n8n 自动化发信对接 & 邮箱有效性验证
 *
 * 架构原则（ARCH-STANDARDS §7）:
 * - 边缘重活：邮箱验证（SMTP 握手模拟）在本地执行
 * - 云端轻量：n8n 未部署时降级为 Supabase campaigns 表入库
 * - 优雅降级：n8n 不可达时自动 fallback 到数据库队列
 */

import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc, registry } from '../ipc/registry'
import { automationStartCampaignContract } from '../ipc/contracts/automation.contract'
import { ensureTrialAccess, registerSecureFeatureIpc } from './license-service'
import { getPhysicalMachineId } from './license-service'
import { extractDomain } from '../utils/domain'
import { safeFetch } from '../utils/http-client'
import { verifyEmailDetailed, classifyEmailStatic } from '../utils/email-verification'
import type { ConfigStore } from './config-service'

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
  /* B-02 修复：区分"组装成功"与"真实推送至云端 Webhook"。 */
  pushed?: boolean
  accepted?: number
  rejected?: number
  error?: string
  message?: string
}

const N8N_GOLD_FILTER_MIN_SCORE = 80

const resolveLeadScore = (lead: Record<string, unknown>) => {
  const rawScore = typeof lead.matchScore === 'number' ? lead.matchScore : lead.score
  return Number.isFinite(Number(rawScore)) ? Math.round(Number(rawScore)) : undefined
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
 *  n8n Workflow Trigger
 * ────────────────────────────────────────────── */
const getN8nWebhookUrl = (store: ConfigStore): string => {
  const config = store.get('user_config') as { n8n?: { webhookUrl?: string } } | undefined
  return String(config?.n8n?.webhookUrl || '').trim()
}

const isPlaceholderWebhook = (value: string) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return (
    !normalized ||
    normalized.includes('your-webhook') ||
    normalized.includes('placeholder') ||
    normalized.endsWith('/demo')
  )
}

const resolveAuthorizationLevel = (
  store: ConfigStore,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
) => {
  const claims = licenseGuard.getStoredClaims()
  if (claims?.status === 'active' && claims.expiresAt > Date.now()) {
    return String(claims.plan || 'licensed').trim() || 'licensed'
  }
  const trialExpiresAt = Number(store.get('system.trialExpiresAt') || 0)
  if (trialExpiresAt > Date.now()) {
    return 'trial'
  }
  return 'unlicensed'
}

const triggerN8nWorkflow = async (
  store: ConfigStore,
  leads: Array<Record<string, unknown>>,
  templateId?: string,
): Promise<CampaignStartResult> => {
  if (!leads.length) {
    return { triggered: false, error: '请选择至少一条线索' }
  }

  const compactLeads = leads
    .map((lead) => {
      const aiAnalysis =
        typeof lead.aiAnalysis === 'object' && lead.aiAnalysis ? (lead.aiAnalysis as Record<string, unknown>) : {}
      const aiGeneratedPitch =
        typeof lead.aiGeneratedPitch === 'object' && lead.aiGeneratedPitch
          ? (lead.aiGeneratedPitch as Record<string, unknown>)
          : {}
      const userSettings =
        typeof lead.userSettings === 'object' && lead.userSettings ? (lead.userSettings as Record<string, unknown>) : {}
      return {
        lead_info: {
          email: String(lead.email || '').trim(),
          company: String(lead.company || '')
            .trim()
            .slice(0, 200),
          domain: (() => {
            const raw = String(lead.website || lead.domain || '').trim()
            try {
              const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`)
              return url.hostname.replace(/^www\./, '').toLowerCase()
            } catch {
              return raw
                .replace(/^https?:\/\//, '')
                .replace(/^www\./, '')
                .split('/')[0]
                .split('?')[0]
                .toLowerCase()
            }
          })(),
          website: String(lead.website || lead.domain || '').trim(),
          country: String(lead.country || '')
            .trim()
            .slice(0, 50),
          contact: String(lead.contact || '')
            .trim()
            .slice(0, 100),
          contact_title: String(lead.contactTitle || '')
            .trim()
            .slice(0, 120),
          phone: String(lead.phone || '')
            .trim()
            .slice(0, 80),
          address: String(lead.address || '')
            .trim()
            .slice(0, 240),
          source: String(lead.source || '')
            .trim()
            .slice(0, 120),
          inferred_role: String(lead.inferredRole || '')
            .trim()
            .slice(0, 120),
          match_reasons: Array.isArray(lead.matchReasons)
            ? lead.matchReasons
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .slice(0, 4)
            : [],
          risk_flags: Array.isArray(lead.riskFlags)
            ? lead.riskFlags
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .slice(0, 3)
            : [],
          snippet: String(lead.snippet || '')
            .trim()
            .slice(0, 500),
        },
        icp_match_score: resolveLeadScore(lead),
        ai_analysis: {
          companyProfile: String(aiAnalysis.companyProfile || '')
            .trim()
            .slice(0, 800),
          painPoints: String(aiAnalysis.painPoints || '')
            .trim()
            .slice(0, 800),
          valueMapping: String(aiAnalysis.valueMapping || '')
            .trim()
            .slice(0, 1000),
          confidence: Number.isFinite(Number(aiAnalysis.confidence))
            ? Math.round(Number(aiAnalysis.confidence))
            : undefined,
          source: String(aiAnalysis.source || '')
            .trim()
            .slice(0, 80),
        },
        ai_generated_pitch: {
          emailSubject: String(aiGeneratedPitch.emailSubject || '')
            .trim()
            .slice(0, 200),
          emailBody: String(aiGeneratedPitch.emailBody || '')
            .trim()
            .slice(0, 2400),
        },
        user_settings: {
          templateId: String(userSettings.templateId || templateId || 'default').trim(),
          selectedModel: String(userSettings.selectedModel || '')
            .trim()
            .slice(0, 120),
          icpProfile: (() => {
            const icp =
              typeof userSettings.icpProfile === 'object' && userSettings.icpProfile
                ? (userSettings.icpProfile as Record<string, unknown>)
                : {}
            return {
              targetProduct: String(icp.targetProduct || '')
                .trim()
                .slice(0, 500),
              buyerPersona: String(icp.buyerPersona || '')
                .trim()
                .slice(0, 100),
              coreAdvantage: String(icp.coreAdvantage || '')
                .trim()
                .slice(0, 500),
              negativeIcp: String(icp.negativeIcp || '')
                .trim()
                .slice(0, 300),
            }
          })(),
        },
        verification_status: String(lead.verificationStatus || 'unverified').trim(),
      }
    })
    .filter(
      (entry) =>
        entry.lead_info.email &&
        typeof entry.icp_match_score === 'number' &&
        entry.icp_match_score >= N8N_GOLD_FILTER_MIN_SCORE,
    )

  if (!compactLeads.length) {
    return {
      triggered: false,
      error: `选中线索均无有效邮箱或评分低于上云阈值 ${N8N_GOLD_FILTER_MIN_SCORE}`,
      rejected: leads.length,
    }
  }

  const webhookUrl = getN8nWebhookUrl(store)
  if (isPlaceholderWebhook(webhookUrl) || !webhookUrl.startsWith('https://')) {
    console.error('[Automation] 渐进式模式拦截成功. 目标线索数:', compactLeads.length)
    return {
      triggered: true,
      pushed: false,
      accepted: compactLeads.length,
      rejected: leads.length - compactLeads.length,
      message: `渐进式开发模式：数据组装成功，云端 Webhook 暂未配置，已取消推送；已拦截 ${leads.length - compactLeads.length} 条低分或无邮箱线索`,
    }
  }

  try {
    const response = await safeFetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start_campaign',
        templateId: templateId || 'default',
        leads: compactLeads,
        timestamp: Date.now(),
      }),
    })
    if (response.ok) {
      return {
        triggered: true,
        pushed: true,
        accepted: compactLeads.length,
        rejected: leads.length - compactLeads.length,
        message: `已成功同步 ${compactLeads.length} 条线索至云端发送队列，已拦截 ${leads.length - compactLeads.length} 条低分或无邮箱线索`,
      }
    }
    return { triggered: false, error: `云端发送失败（HTTP ${response.status}）` }
  } catch (err: any) {
    return { triggered: false, error: err?.message || '云端队列不可达，请检查网络连接' }
  }
}

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
  registerIpc(
    IPC_CHANNELS.AUTOMATION.START_CAMPAIGN,
    automationStartCampaignContract,
    async (_event: unknown, payload: unknown) => {
      const p = (payload || {}) as { leads: Array<Record<string, unknown>>; templateId?: string }
      const authorizationLevel = resolveAuthorizationLevel(store, licenseGuard)
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

      try {
        const result = await triggerN8nWorkflow(store, p?.leads || [], p?.templateId)
        return { success: true, data: result }
      } catch (error: any) {
        return { success: false, error: error?.message || '自动化发信失败', code: error?.code }
      }
    },
  )

  /* 自绑定兼容层（与 agent-service / autopilot-state-service / auth-service /
     sandbox-service 同构）：历史 e2e / 独立测试直接调用本函数而未显式 attach，
     迁移后 START_CAMPAIGN 需落到 ipcMain 才能被 getHandler 取到。attach 按
     ipcMain 实例幂等，主进程末尾的 attach 不会重复绑定。 */
  registry.attach(ipcMain)
}
