import type { AgentTask } from '../agent-pipeline'
import type { SalesAgentState, AgentLogEntry } from '../../../src/shared/ipc-contracts'

type LinkedinSessionState = 'disconnected' | 'connected' | 'error'

type LinkedinProfileData = {
  name?: string
  headline?: string
  summary?: string
  location?: string
  industry?: string
  experience?: Array<{ title?: string; company?: string; duration?: string }>
}

type LinkedinAgentConfig = {
  dailyLimit: number
  sessionPath?: string
}

type LinkedinAgentResult = {
  success: boolean
  profileData?: LinkedinProfileData
  icebreakerCopy?: string
  error?: string
}

export class LinkedinAgent {
  private config: LinkedinAgentConfig
  private state: SalesAgentState
  private logEntries: AgentLogEntry[] = []
  private sessionState: LinkedinSessionState = 'disconnected'
  private browser: any = null

  constructor(config: LinkedinAgentConfig, state: SalesAgentState) {
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

  getSessionState(): LinkedinSessionState {
    return this.sessionState
  }

  async connect(): Promise<boolean> {
    try {
      const puppeteer = await import('puppeteer')
      this.browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        userDataDir: this.config.sessionPath,
      })

      const page = await this.browser.newPage()
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 })

      const loginPrompt = await page.$('#main__form').catch(() => null)
      if (loginPrompt) {
        this.sessionState = 'disconnected'
        this.addLog('session_expired', 'LinkedIn session expired, needs login')
        return false
      }

      this.sessionState = 'connected'
      this.addLog('session_connected', 'LinkedIn session active')
      return true
    } catch (err) {
      this.sessionState = 'error'
      this.addLog('connect_failed', err instanceof Error ? err.message : String(err || ''))
      return false
    }
  }

  async readProfile(task: AgentTask): Promise<LinkedinAgentResult> {
    if (this.sessionState !== 'connected') {
      const connected = await this.connect()
      if (!connected) return { success: false, error: `LinkedIn not connected (state: ${this.sessionState})` }
    }

    if (this.state.dailyUsed >= this.config.dailyLimit) {
      return { success: false, error: 'Daily limit reached' }
    }

    if (!task.linkedinUrl) {
      return { success: false, error: 'No LinkedIn URL' }
    }

    try {
      const pages = await this.browser.pages()
      const page = pages[0]

      await page.goto(task.linkedinUrl, { waitUntil: 'networkidle2', timeout: 30000 })

      const name = await page.$eval('h1', (el: any) => el?.textContent?.trim() || '').catch(() => '')
      const headline = await page.$eval('.text-body-medium', (el: any) => el?.textContent?.trim() || '').catch(() => '')
      const summary = await page.$eval('.display-flex.ph5.pv3 .inline-show-more-text', (el: any) => el?.textContent?.trim() || '').catch(() => '')

      const location = await page.$eval('.text-body-small.inline', (el: any) => el?.textContent?.trim() || '').catch(() => '')
      const industry = await page.$$eval('dt', (els: any[]) => {
        for (const dt of els) {
          if (dt.textContent?.trim().toLowerCase() === 'industry') {
            return dt.nextElementSibling?.textContent?.trim() || ''
          }
        }
        return ''
      }).catch(() => '')

      const profileData: LinkedinProfileData = { name, headline, summary: summary || undefined, location: location || undefined, industry: industry || undefined }

      const icebreakerCopy = this.generateIcebreaker(task, profileData)

      this.state.dailyUsed += 1
      this.state.completedCount += 1
      this.state.lastActivity = new Date().toISOString()
      this.addLog('profile_read', `Company=${task.company} Profile=${task.linkedinUrl}`)

      return { success: true, profileData, icebreakerCopy }
    } catch (err) {
      this.state.failedCount += 1
      this.state.lastActivity = new Date().toISOString()
      this.addLog('profile_read_failed', `Company=${task.company} Error=${err instanceof Error ? err.message : String(err || '')}`)
      return { success: false, error: err instanceof Error ? err.message : String(err || '') }
    }
  }

  private generateIcebreaker(task: AgentTask, profile: LinkedinProfileData): string {
    const name = profile.name || 'there'
    const headline = profile.headline || 'professional'
    const company = task.company
    return `Hi ${name},\n\nI noticed your profile as ${headline} and was impressed by your background. Our team at Kone helps companies like ${company} streamline their B2B outreach. Feel free to review the profile and reach out if relevant.\n\nBest regards`
  }

  async disconnect() {
    if (this.browser) {
      try {
        await this.browser.close()
      } catch {}
      this.browser = null
    }
    this.sessionState = 'disconnected'
  }
}
