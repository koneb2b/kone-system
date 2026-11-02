import * as nodemailer from 'nodemailer'
import type { AgentTask } from '../agent-pipeline'
import type { SalesAgentState, AgentLogEntry } from '../../../src/shared/ipc-contracts'
import { isWithinSendWindow } from '../../utils/send-window'
import { classifyEmailStatic } from '../../utils/email-verification'
/* S5a：首封「引用证据率」的确定性度量（纯函数，不抛错，可安全置于真实发送路径） */
import { measureEvidenceCitation } from './outreach-quality'

export type EmailAgentConfig = {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  imapHost?: string
  imapPort?: number
  imapUser?: string
  imapPass?: string
  senderEmail: string
  senderName?: string
  dailyLimit: number
  // Compliance gate (P1-4): return true if the recipient must NOT be emailed
  // (unsubscribed / bounced / manually suppressed). Injected by agent-service so
  // the EmailAgent stays pure and store-agnostic. Absent → no suppression.
  isSuppressed?: (email: string) => boolean
  // P0-1 差异化触达（G1）：LLM 实时生成定制开发信的回调。返回 null 表示生成
  // 失败/不可用，executeSequence 将降级为阶段模板。由 agent-service 注入，
  // EmailAgent 保持 pure、不感知 store/LLM 配置。
  emailContentProvider?: (task: AgentTask, stage: 0 | 1 | 2 | 3) => Promise<{ subject: string; body: string } | null>
  // P2-4：用户配置的自定义 DKIM selector（与默认列表合并探测，防误报）
  dkimSelectors?: string[]
}

type EmailAgentResult = {
  success: boolean
  messageId?: string
  error?: string
}

// Result of an IMAP reply probe. `configured: false` means IMAP was not set up,
// so the caller must NOT assume "no reply" — it simply cannot know.
type ReplyCheckResult = {
  configured: boolean
  replied: boolean
  error?: string
}

export class EmailAgent {
  private transporter: nodemailer.Transporter | null = null
  private config: EmailAgentConfig
  private state: SalesAgentState
  private logEntries: AgentLogEntry[] = []

  constructor(config: EmailAgentConfig, state: SalesAgentState) {
    this.config = config
    this.state = state
  }

  private addLog(event: string, detail?: string) {
    const entry: AgentLogEntry = {
      timestamp: new Date().toISOString(),
      event,
      detail,
    }
    this.logEntries.push(entry)
  }

  getLogs(): AgentLogEntry[] {
    return this.logEntries
  }

  async connect(): Promise<boolean> {
    try {
      this.transporter = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpPort === 465,
        auth: {
          user: this.config.smtpUser,
          pass: this.config.smtpPass,
        },
        connectionTimeout: 10000,
      })

      await this.transporter.verify()
      this.addLog('smtp_connected', `SMTP ${this.config.smtpHost}:${this.config.smtpPort} verified`)
      return true
    } catch (err) {
      this.addLog('smtp_connect_failed', err instanceof Error ? err.message : String(err || ''))
      return false
    }
  }

  async checkDnsHealth(
    domain: string,
  ): Promise<{ valid: boolean; risk: 'safe' | 'warning' | 'critical'; error?: string }> {
    const { promises: dns } = await import('dns')
    try {
      const mxRecords = await dns.resolve(domain, 'MX').catch(() => [])
      const txtRecords = await dns.resolve(domain, 'TXT').catch(() => [] as string[][])

      const txtStrings = txtRecords.flat()
      const hasSPF = txtStrings.some((r: string) => r.toLowerCase().includes('v=spf1'))
      const hasMX = mxRecords.length > 0

      let hasDKIM = false
      /* P2-4：默认有限 selector 列表 + 用户配置合并（自定义 selector 防误报） */
      const selectors = [
        ...new Set([
          'default',
          'google',
          'selector1',
          'k1',
          'mail',
          ...(this.config.dkimSelectors || [])
            .map((s) =>
              String(s || '')
                .trim()
                .toLowerCase(),
            )
            .filter(Boolean),
        ]),
      ]
      for (const sel of selectors) {
        const exists = await dns.resolve(`${sel}._domainkey.${domain}`, 'TXT').catch(() => null)
        if (exists) {
          hasDKIM = true
          break
        }
      }

      const dmarcRecords = await dns.resolve(`_dmarc.${domain}`, 'TXT').catch(() => [] as string[][])
      const hasDMARC = dmarcRecords.flat().length > 0

      const reversed = domain.split('.').reverse().join('.')
      const isBlacklisted = await dns
        .resolve4(`${reversed}.zen.spamhaus.org`)
        .then(() => true)
        .catch(() => false)

      const issues: string[] = []
      if (!hasMX) issues.push('missing MX')
      if (!hasSPF) issues.push('missing SPF')
      if (!hasDKIM) issues.push('missing DKIM')
      if (!hasDMARC) issues.push('missing DMARC')
      if (isBlacklisted) issues.push('Spamhaus blacklisted')

      // Spec (ARCH-STANDARDS §9.5.6 / kone-PRD §六.2 / system-blueprint §7.6):
      // "critical SPF/DKIM records missing OR domain blacklisted → soft-lock sends".
      // A blacklisted domain or a domain with NO SPF sender policy is a genuine
      // high-risk state that must BLOCK, not merely warn — otherwise the
      // Deliverability Shield is cosmetic. DKIM/DMARC/MX are surfaced as warnings
      // only: DKIM is probed via a finite selector list (custom selectors would
      // false-positive as "missing"), so hard-blocking on it would wrongly lock out
      // legitimately configured domains.
      const risk: 'safe' | 'warning' | 'critical' =
        isBlacklisted || !hasSPF ? 'critical' : !hasMX || !hasDKIM || !hasDMARC ? 'warning' : 'safe'

      this.addLog('dns_health_check', `domain=${domain} risk=${risk} issues=${issues.join(',') || 'none'}`)

      return { valid: risk === 'safe', risk, error: issues.length > 0 ? issues.join('; ') : undefined }
    } catch (err) {
      this.addLog('dns_check_error', err instanceof Error ? err.message : String(err || ''))
      return { valid: false, risk: 'warning', error: 'DNS check failed' }
    }
  }

  async sendEmail(task: AgentTask, subject: string, body: string): Promise<EmailAgentResult> {
    if (!this.transporter) {
      const connected = await this.connect()
      if (!connected) return { success: false, error: 'SMTP not connected' }
    }

    if (this.state.dailyUsed >= this.config.dailyLimit) {
      return { success: false, error: 'Daily limit reached' }
    }

    // P1-4 compliance gate: check suppression list before sending.
    if (task.email && this.config.isSuppressed?.(task.email)) {
      this.addLog('send_blocked_suppressed', `Recipient ${task.email} is suppressed (unsubscribed/bounced/DNC)`)
      return { success: false, error: 'Recipient is suppressed' }
    }

    // P2-1 五级差异化队列门禁：disposable/格式非法收件人硬拦截（保护域名信誉，
    // 不消耗日频、不计失败）；role-account（info@/sales@）降权——放行但记录日志。
    const staticCheck = classifyEmailStatic(task.email || '')
    if (staticCheck.grade === 'invalid' || (staticCheck.grade === 'risky' && staticCheck.reason?.includes('一次性'))) {
      this.addLog(
        'send_blocked_static_verify',
        `Recipient=${task.email} Grade=${staticCheck.grade} Reason=${staticCheck.reason}`,
      )
      return { success: false, error: `Recipient email rejected: ${staticCheck.reason}` }
    }
    if (staticCheck.grade === 'risky') {
      this.addLog(
        'send_role_account',
        `Recipient=${task.email} is a role account — deprioritized, deliverability may be fine but conversion is low`,
      )
    }

    // P1-4 send-window gate: deliver only within the recipient's local
    // 09:00-18:00. Unknown timezone → allowed (honest degradation). This returns
    // BEFORE any counter mutation so a deferral never burns the daily quota or
    // counts as failure; the caller defers the plan to the next tick.
    const window = isWithinSendWindow(task.country)
    if (!window.allowed) {
      this.addLog('send_deferred_window', `Recipient=${task.email} ${window.reason}`)
      return { success: false, error: 'outside_recipient_send_window' }
    }

    const senderDomain = this.config.senderEmail.split('@').pop() || ''
    const dnsHealth = await this.checkDnsHealth(senderDomain)
    if (dnsHealth.risk === 'critical') {
      this.addLog('send_blocked_dns', `Domain ${senderDomain} DNS critical - soft locked`)
      return { success: false, error: `DNS health critical: ${dnsHealth.error}` }
    }

    if (!this.transporter) {
      return { success: false, error: 'Transporter not initialized' }
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"${this.config.senderName || 'Kone Agent'}" <${this.config.senderEmail}>`,
        to: task.email,
        subject,
        text: body,
        headers: {
          'X-Kone-Agent': 'email',
          'X-Kone-Lead': task.company,
        },
      })

      this.state.dailyUsed += 1
      /* N-1 修复（2026-11-03）：completedCount 统一由编排层单点计数，
         此处不递增（state 为共享对象引用，曾致双计）。 */
      this.state.lastActivity = new Date().toISOString()
      this.addLog('email_sent', `To=${task.email} Company=${task.company} MessageID=${info.messageId}`)

      return { success: true, messageId: info.messageId }
    } catch (err) {
      this.state.failedCount += 1
      this.state.lastActivity = new Date().toISOString()
      this.addLog(
        'email_send_failed',
        `To=${task.email} Error=${err instanceof Error ? err.message : String(err || '')}`,
      )
      return { success: false, error: err instanceof Error ? err.message : String(err || '') }
    }
  }

  // Detect whether a lead has replied since a given date by scanning the IMAP
  // inbox for messages FROM the lead's domain. Returns configured:false when
  // IMAP is not set up so the scheduler can decide policy (never fake "no reply").
  async checkReply(leadEmail: string, sinceDate: Date): Promise<ReplyCheckResult> {
    const host = this.config.imapHost?.trim()
    if (!host) {
      return { configured: false, replied: false }
    }

    const leadDomain = leadEmail.split('@').pop()?.toLowerCase() || ''
    if (!leadDomain) {
      return { configured: true, replied: false, error: 'Invalid lead email' }
    }

    let client: import('imapflow').ImapFlow | null = null
    try {
      const { ImapFlow } = await import('imapflow')
      client = new ImapFlow({
        host,
        port: this.config.imapPort || 993,
        secure: (this.config.imapPort || 993) === 993,
        auth: {
          user: this.config.imapUser?.trim() || this.config.smtpUser,
          pass: this.config.imapPass?.trim() || this.config.smtpPass,
        },
        logger: false,
      })

      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        // Search inbox for messages received since the send date, then match sender domain.
        const uids = await client.search({ since: sinceDate }, { uid: true })
        if (!uids || uids.length === 0) {
          return { configured: true, replied: false }
        }

        for await (const msg of client.fetch({ uid: uids.join(',') }, { envelope: true }, { uid: true })) {
          const fromAddrs = msg.envelope?.from || []
          const matched = fromAddrs.some(
            (a) =>
              String(a.address || '')
                .toLowerCase()
                .endsWith(`@${leadDomain}`) || String(a.address || '').toLowerCase() === leadEmail.toLowerCase(),
          )
          if (matched) {
            this.addLog('reply_detected', `Lead=${leadEmail} replied since ${sinceDate.toISOString()}`)
            return { configured: true, replied: true }
          }
        }

        return { configured: true, replied: false }
      } finally {
        lock.release()
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err || '')
      this.addLog('imap_check_failed', `Lead=${leadEmail} Error=${errMsg}`)
      return { configured: true, replied: false, error: errMsg }
    } finally {
      if (client) {
        try {
          await client.logout()
        } catch {
          /* ignore */
        }
      }
    }
  }

  async executeSequence(task: AgentTask, stage: 0 | 1 | 2 | 3): Promise<EmailAgentResult> {
    /* P0-1 差异化触达（G1 缺口闭环）。内容来源优先级：
       1. task.aiEmail —— 线索上已生成的 AI 定制开发信（Stage0 首封直接消费）
       2. config.emailContentProvider —— LLM 实时生成 150 词定制信
       3. 阶段模板 —— 最终兜底，保证序列永不因内容层失败而中断
       每次发送记录 email_content_source 日志，触达内容可审计。 */
    let subject: string
    let body: string
    let source: 'ai_pitch' | 'ai_generated' | 'template' = 'template'

    if (stage === 0 && task.aiEmail?.subject && task.aiEmail?.body) {
      subject = task.aiEmail.subject
      body = task.aiEmail.body
      source = 'ai_pitch'
    } else {
      let generated: { subject: string; body: string } | null = null
      if (this.config.emailContentProvider) {
        try {
          generated = await this.config.emailContentProvider(task, stage)
        } catch (err) {
          this.addLog('email_content_provider_failed', err instanceof Error ? err.message : String(err || ''))
          generated = null
        }
      }
      if (generated?.subject && generated?.body) {
        subject = generated.subject
        body = generated.body
        source = 'ai_generated'
      } else {
        const subjects: Record<number, string> = {
          0: `Partnership opportunity with ${task.company}`,
          1: `Following up - ${task.company}`,
          2: `Case study for ${task.company}`,
          3: `Final note - ${task.company}`,
        }
        const bodies: Record<number, string> = {
          0: `Hi ${task.company} team,\n\nWe noticed your company in the industry and would like to explore potential collaboration opportunities.\n\nBest regards,\nKone Agent`,
          1: `Hi ${task.company} team,\n\nJust following up on my previous message. We'd love to hear your thoughts.\n\nBest regards,\nKone Agent`,
          2: `Hi ${task.company} team,\n\nWe recently helped a similar company achieve great results. Would you be interested in a case study?\n\nBest regards,\nKone Agent`,
          3: `Hi ${task.company} team,\n\nThis is a final note. Feel free to reach out if you're interested.\n\nBest regards,\nKone Agent`,
        }
        subject = subjects[stage] || subjects[0]
        body = bodies[stage] || bodies[0]
      }
    }

    /* S5a 质量度量：记录首封「引用证据率」（可复核、不靠感觉）。
       纯函数度量，放在真实发送路径上也不引入网络/超时风险。 */
    const citation = measureEvidenceCitation(body, task.buyerEvidence || [])
    this.addLog(
      'email_content_source',
      `To=${task.email} Stage=${stage} Source=${source} EvidenceCited=${citation.cited}/${citation.total} Rate=${citation.rate}`,
    )
    return this.sendEmail(task, subject, body)
  }

  async disconnect() {
    if (this.transporter) {
      this.transporter.close()
      this.transporter = null
    }
  }
}
