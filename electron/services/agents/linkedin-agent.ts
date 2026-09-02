import type { AgentTask } from '../agent-pipeline'
import type { SalesAgentState, AgentLogEntry } from '../../../src/shared/ipc-contracts'
import { launchPersistentBrowser } from './browser-resolver'

type LinkedinSessionState = 'disconnected' | 'connected' | 'error'

type LinkedinProfileData = {
  name?: string
  headline?: string
  summary?: string
  location?: string
  industry?: string
  experience?: Array<{ title?: string; company?: string; duration?: string }>
}

export type LinkedinAgentConfig = {
  dailyLimit: number
  sessionPath?: string
  // P1-2（缺口6）：LLM 真生成个性化破冰文案的回调。返回 null 表示生成失败/
  // 不可用，readProfile 将降级为静态模板。由 agent-service 注入。
  icebreakerProvider?: (task: AgentTask, profile: LinkedinProfileData) => Promise<string | null>
}

export type LinkedinAgentResult = {
  success: boolean
  profileData?: LinkedinProfileData
  icebreakerCopy?: string
  error?: string
}

/* P1-2：静态模板兜底（LLM 破冰生成失败/未注入时使用）。导出以便 mock-only 测试。 */
export const buildIcebreakerTemplate = (task: AgentTask, profile: LinkedinProfileData): string => {
  const name = profile.name || 'there'
  const headline = profile.headline || 'professional'
  const company = task.company
  return `Hi ${name},\n\nI noticed your profile as ${headline} and was impressed by your background. Our team at Kone helps companies like ${company} streamline their B2B outreach. Feel free to review the profile and reach out if relevant.\n\nBest regards`
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
      // L0-2/B2：打包产物无捆绑 Chromium —— 探测用户机器 Chrome/Edge 后再启动，
      // 浏览器来源写入运行日志保持可审计（找不到时抛出带指引的中文错误）。
      const { browser, label } = await launchPersistentBrowser(this.config.sessionPath)
      this.browser = browser
      this.addLog('browser_launched', `Browser engine: ${label}`)

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
      const summary = await page
        .$eval('.display-flex.ph5.pv3 .inline-show-more-text', (el: any) => el?.textContent?.trim() || '')
        .catch(() => '')

      const location = await page
        .$eval('.text-body-small.inline', (el: any) => el?.textContent?.trim() || '')
        .catch(() => '')
      const industry = await page
        .$$eval('dt', (els: any[]) => {
          for (const dt of els) {
            if (dt.textContent?.trim().toLowerCase() === 'industry') {
              return dt.nextElementSibling?.textContent?.trim() || ''
            }
          }
          return ''
        })
        .catch(() => '')

      const profileData: LinkedinProfileData = {
        name,
        headline,
        summary: summary || undefined,
        location: location || undefined,
        industry: industry || undefined,
      }

      /* P1-2（缺口6）：破冰文案优先 LLM 真生成（输入 Profile 实际提取内容），
         失败/未注入降级静态模板；来源写入日志可审计。
         只读边界不变：文案仅供人工触达，不触发任何自动动作。 */
      let icebreakerCopy = ''
      let icebreakerSource = 'template'
      if (this.config.icebreakerProvider) {
        try {
          const generated = await this.config.icebreakerProvider(task, profileData)
          if (generated?.trim()) {
            icebreakerCopy = generated.trim()
            icebreakerSource = 'ai_generated'
          }
        } catch (err) {
          this.addLog('icebreaker_provider_failed', err instanceof Error ? err.message : String(err || ''))
        }
      }
      if (!icebreakerCopy) {
        icebreakerCopy = this.generateIcebreaker(task, profileData)
      }
      this.addLog('icebreaker_source', `Company=${task.company} Source=${icebreakerSource}`)

      this.state.dailyUsed += 1
      this.state.completedCount += 1
      this.state.lastActivity = new Date().toISOString()
      this.addLog('profile_read', `Company=${task.company} Profile=${task.linkedinUrl}`)

      return { success: true, profileData, icebreakerCopy }
    } catch (err) {
      this.state.failedCount += 1
      this.state.lastActivity = new Date().toISOString()
      this.addLog(
        'profile_read_failed',
        `Company=${task.company} Error=${err instanceof Error ? err.message : String(err || '')}`,
      )
      return { success: false, error: err instanceof Error ? err.message : String(err || '') }
    }
  }

  private generateIcebreaker(task: AgentTask, profile: LinkedinProfileData): string {
    return buildIcebreakerTemplate(task, profile)
  }

  async disconnect() {
    if (this.browser) {
      try {
        await this.browser.close()
      } catch {
        /* ignore close failure during disconnect */
      }
      this.browser = null
    }
    this.sessionState = 'disconnected'
  }
}
