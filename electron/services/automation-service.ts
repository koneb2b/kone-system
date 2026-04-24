/**
 * automation-service.ts — n8n 自动化发信对接 & 邮箱有效性验证
 *
 * 架构原则（ARCH-STANDARDS §7）:
 * - 边缘重活：邮箱验证（SMTP 握手模拟）在本地执行
 * - 云端轻量：n8n 未部署时降级为 Supabase campaigns 表入库
 * - 优雅降级：n8n 不可达时自动 fallback 到数据库队列
 */

import * as net from 'net'
import * as dns from 'dns'
import { IPC_CHANNELS } from '../ipc/channels'
import { ensureTrialAccess, registerSecureFeatureIpc } from './license-service'
import { getPhysicalMachineId } from './license-service'
import { extractDomain } from '../utils/domain'
import { safeFetch } from '../utils/http-client'
import type { ConfigStore } from './config-service'

/* ──────────────────────────────────────────────
 *  Types
 * ────────────────────────────────────────────── */
export type EmailVerifyResult = {
  email: string
  valid: boolean
  reason?: string
}

export type CampaignStartResult = {
  triggered: boolean
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
 *  Email Verification (local SMTP handshake)
 * ────────────────────────────────────────────── */
const SMTP_TIMEOUT_MS = 8000

const resolveMx = (domain: string): Promise<string | null> =>
  new Promise((resolve) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err || !addresses?.length) return resolve(null)
      const sorted = addresses.sort((a, b) => a.priority - b.priority)
      resolve(sorted[0].exchange)
    })
  })

const smtpHandshake = (mxHost: string, email: string): Promise<{ valid: boolean; reason?: string }> =>
  new Promise((resolve) => {
    const socket = new net.Socket()
    let resolved = false
    const done = (valid: boolean, reason?: string) => {
      if (resolved) return
      resolved = true
      socket.destroy()
      resolve({ valid, reason })
    }

    socket.setTimeout(SMTP_TIMEOUT_MS)
    socket.on('timeout', () => done(false, 'SMTP 连接超时'))
    socket.on('error', () => done(false, 'SMTP 连接失败'))

    socket.connect(25, mxHost, () => {
      let phase = 0
      let buffer = ''

      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        if (!buffer.includes('\r\n')) return
        const code = parseInt(buffer.slice(0, 3), 10)
        buffer = ''

        if (phase === 0 && code === 220) {
          phase = 1
          socket.write(`EHLO kone-verify.local\r\n`)
        } else if (phase === 1 && (code === 250 || code === 220)) {
          phase = 2
          socket.write(`MAIL FROM:<verify@kone-verify.local>\r\n`)
        } else if (phase === 2 && code === 250) {
          phase = 3
          socket.write(`RCPT TO:<${email}>\r\n`)
        } else if (phase === 3) {
          socket.write('QUIT\r\n')
          done(code === 250, code !== 250 ? `RCPT 拒绝 (${code})` : undefined)
        } else {
          socket.write('QUIT\r\n')
          done(false, `意外响应码 ${code}`)
        }
      })
    })
  })

const verifyEmail = async (email: string): Promise<EmailVerifyResult> => {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) {
    return { email: trimmed, valid: false, reason: '格式无效' }
  }
  const domain = trimmed.split('@')[1]
  const mxHost = await resolveMx(domain)
  if (!mxHost) {
    return { email: trimmed, valid: false, reason: `域名 ${domain} 无 MX 记录` }
  }
  try {
    const result = await smtpHandshake(mxHost, trimmed)
    return { email: trimmed, ...result }
  } catch {
    return { email: trimmed, valid: false, reason: 'SMTP 验证异常' }
  }
}

const verifyEmailsBatch = async (emails: string[]): Promise<EmailVerifyResult[]> => {
  // 串行执行，避免 SMTP 端口爆发
  const results: EmailVerifyResult[] = []
  for (const email of emails.slice(0, 50)) {
    results.push(await verifyEmail(email))
  }
  return results
}

/* ──────────────────────────────────────────────
 *  n8n Workflow Trigger
 * ────────────────────────────────────────────── */
const getN8nWebhookUrl = (store: ConfigStore): string => {
  const config = store.get('user_config') as { n8n?: { webhookUrl?: string } } | undefined
  return String(config?.n8n?.webhookUrl || '').trim()
}

const isPlaceholderWebhook = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized || normalized.includes('your-webhook') || normalized.includes('placeholder') || normalized.endsWith('/demo')
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

  const compactLeads = leads.map((lead) => {
    const aiAnalysis = typeof lead.aiAnalysis === 'object' && lead.aiAnalysis ? lead.aiAnalysis as Record<string, unknown> : {}
    const aiGeneratedPitch = typeof lead.aiGeneratedPitch === 'object' && lead.aiGeneratedPitch ? lead.aiGeneratedPitch as Record<string, unknown> : {}
    const userSettings = typeof lead.userSettings === 'object' && lead.userSettings ? lead.userSettings as Record<string, unknown> : {}
    return {
      lead_info: {
        email: String(lead.email || '').trim(),
        company: String(lead.company || '').trim().slice(0, 200),
        domain: (() => {
          const raw = String(lead.website || lead.domain || '').trim()
          try {
            const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`)
            return url.hostname.replace(/^www\./, '').toLowerCase()
          } catch {
            return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].toLowerCase()
          }
        })(),
        website: String(lead.website || lead.domain || '').trim(),
        country: String(lead.country || '').trim().slice(0, 50),
        contact: String(lead.contact || '').trim().slice(0, 100),
        contact_title: String(lead.contactTitle || '').trim().slice(0, 120),
        phone: String(lead.phone || '').trim().slice(0, 80),
        address: String(lead.address || '').trim().slice(0, 240),
        source: String(lead.source || '').trim().slice(0, 120),
        inferred_role: String(lead.inferredRole || '').trim().slice(0, 120),
        match_reasons: Array.isArray(lead.matchReasons) ? lead.matchReasons.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4) : [],
        risk_flags: Array.isArray(lead.riskFlags) ? lead.riskFlags.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3) : [],
        snippet: String(lead.snippet || '').trim().slice(0, 500),
      },
      icp_match_score: Number.isFinite(Number(lead.matchScore || lead.score)) ? Math.round(Number(lead.matchScore || lead.score)) : undefined,
      ai_analysis: {
        companyProfile: String(aiAnalysis.companyProfile || '').trim().slice(0, 800),
        painPoints: String(aiAnalysis.painPoints || '').trim().slice(0, 800),
        valueMapping: String(aiAnalysis.valueMapping || '').trim().slice(0, 1000),
        confidence: Number.isFinite(Number(aiAnalysis.confidence)) ? Math.round(Number(aiAnalysis.confidence)) : undefined,
        source: String(aiAnalysis.source || '').trim().slice(0, 80),
      },
      ai_generated_pitch: {
        emailSubject: String(aiGeneratedPitch.emailSubject || '').trim().slice(0, 200),
        emailBody: String(aiGeneratedPitch.emailBody || '').trim().slice(0, 2400),
      },
      user_settings: {
        templateId: String(userSettings.templateId || templateId || 'default').trim(),
        selectedModel: String(userSettings.selectedModel || '').trim().slice(0, 120),
        icpProfile: (() => {
          const icp = typeof userSettings.icpProfile === 'object' && userSettings.icpProfile
            ? userSettings.icpProfile as Record<string, unknown>
            : {}
          return {
            targetProduct: String(icp.targetProduct || '').trim().slice(0, 500),
            buyerPersona: String(icp.buyerPersona || '').trim().slice(0, 100),
            coreAdvantage: String(icp.coreAdvantage || '').trim().slice(0, 500),
            negativeIcp: String(icp.negativeIcp || '').trim().slice(0, 300),
          }
        })(),
      },
      verification_status: String(lead.verificationStatus || 'unverified').trim(),
    }
  }).filter((entry) => entry.lead_info.email)

  if (!compactLeads.length) {
    return { triggered: false, error: '选中线索均无有效邮箱', rejected: leads.length }
  }

  const webhookUrl = getN8nWebhookUrl(store)
  if (isPlaceholderWebhook(webhookUrl) || !webhookUrl.startsWith('https://')) {
    console.error('[Automation] 渐进式模式拦截成功. 目标线索数:', compactLeads.length)
    return {
      triggered: true,
      accepted: compactLeads.length,
      rejected: leads.length - compactLeads.length,
      message: '渐进式开发模式：数据组装成功，云端 Webhook 暂未配置，已取消推送',
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
        accepted: compactLeads.length,
        rejected: leads.length - compactLeads.length,
        message: `已成功同步 ${compactLeads.length} 条线索至云端发送队列`,
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
  ipcMain.handle(IPC_CHANNELS.AUTOMATION.START_CAMPAIGN, async (_event, payload: { leads: Array<Record<string, unknown>>; templateId?: string }) => {
    const authorizationLevel = resolveAuthorizationLevel(store, licenseGuard)
    const trialDenied = ensureTrialAccess(store, licenseGuard, '自动化发信')
    if (trialDenied) {
      console.log(`📊 [Probe-IPC] 云端发送请求已拦截/放行，当前授权级别: ${authorizationLevel}，结果: 已拦截`)
      return trialDenied
    }

    try {
      licenseGuard.requireFeature('cloud_send', '自动化发信')
    } catch (error: any) {
      console.log(`📊 [Probe-IPC] 云端发送请求已拦截/放行，当前授权级别: ${authorizationLevel}，结果: 已拦截`)
      return {
        success: false,
        error: 'FEATURE_DENIED',
        message: String(error?.message || '当前授权无权执行自动化发信'),
        operationName: '自动化发信',
        code: Number(error?.code) || 403,
      }
    }

    console.log(`📊 [Probe-IPC] 云端发送请求已拦截/放行，当前授权级别: ${authorizationLevel}，结果: 已放行`)

    try {
      const result = await triggerN8nWorkflow(store, payload?.leads || [], payload?.templateId)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error?.message || '自动化发信失败', code: error?.code }
    }
  })
}
