import * as nodemailer from 'nodemailer'
import type { AgentTask } from '../agent-pipeline'
import type { SalesAgentState, AgentLogEntry } from '../../../src/shared/ipc-contracts'

const DNS_CRITICAL_RISK_TERMS = ['fail', 'spamhaus', 'blacklist', 'banned']

type EmailAgentConfig = {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  imapHost?: string
  imapPort?: number
  senderEmail: string
  senderName?: string
  dailyLimit: number
}

type EmailAgentResult = {
  success: boolean
  messageId?: string
  error?: string
}

const buildDnsRiskLabel = (dnsResult: { valid?: boolean; error?: string }): 'safe' | 'warning' | 'critical' => {
  if (!dnsResult || dnsResult.valid === false) return 'critical'
  if (dnsResult.valid === true) return 'safe'
  return 'warning'
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

  async checkDnsHealth(domain: string): Promise<{ valid: boolean; risk: 'safe' | 'warning' | 'critical'; error?: string }> {
    const { promises: dns } = await import('dns')
    try {
      const mxRecords = await dns.resolve(domain, 'MX').catch(() => [])
      const txtRecords = await dns.resolve(domain, 'TXT').catch(() => [] as string[][])

      const txtStrings = txtRecords.flat()
      const hasSPF = txtStrings.some((r: string) => r.toLowerCase().includes('v=spf1'))
      const hasMX = mxRecords.length > 0

      let hasDKIM = false
      const selectors = ['default', 'google', 'selector1', 'k1', 'mail']
      for (const sel of selectors) {
        const exists = await dns.resolve(`${sel}._domainkey.${domain}`, 'TXT').catch(() => null)
        if (exists) { hasDKIM = true; break }
      }

      const dmarcRecords = await dns.resolve(`_dmarc.${domain}`, 'TXT').catch(() => [] as string[][])
      const hasDMARC = dmarcRecords.flat().length > 0

      const reversed = domain.split('.').reverse().join('.')
      const isBlacklisted = await dns.resolve4(`${reversed}.zen.spamhaus.org`).then(() => true).catch(() => false)

      const issues: string[] = []
      if (!hasMX) issues.push('missing MX')
      if (!hasSPF) issues.push('missing SPF')
      if (!hasDKIM) issues.push('missing DKIM')
      if (isBlacklisted) issues.push('Spamhaus blacklisted')

      const risk: 'safe' | 'warning' | 'critical' = isBlacklisted ? 'critical' : (!hasMX || !hasSPF) ? 'warning' : 'safe'

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
      this.state.completedCount += 1
      this.state.lastActivity = new Date().toISOString()
      this.addLog('email_sent', `To=${task.email} Company=${task.company} MessageID=${info.messageId}`)

      return { success: true, messageId: info.messageId }
    } catch (err) {
      this.state.failedCount += 1
      this.state.lastActivity = new Date().toISOString()
      this.addLog('email_send_failed', `To=${task.email} Error=${err instanceof Error ? err.message : String(err || '')}`)
      return { success: false, error: err instanceof Error ? err.message : String(err || '') }
    }
  }

  async executeSequence(task: AgentTask, stage: 0 | 1 | 2 | 3): Promise<EmailAgentResult> {
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

    return this.sendEmail(task, subjects[stage] || subjects[0], bodies[stage] || bodies[0])
  }

  async disconnect() {
    if (this.transporter) {
      this.transporter.close()
      this.transporter = null
    }
  }
}
