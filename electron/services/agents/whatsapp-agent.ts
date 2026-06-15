import type { AgentTask } from '../agent-pipeline'
import type { SalesAgentState, AgentLogEntry } from '../../../src/shared/ipc-contracts'

type WhatsAppSessionState = 'disconnected' | 'connected' | 'qr_ready' | 'expired' | 'rate_limited' | 'error'

type WhatsAppAgentConfig = {
  dailyLimit: number
  sessionPath?: string
}

type WhatsAppAgentResult = {
  success: boolean
  messageId?: string
  error?: string
}

export class WhatsAppAgent {
  private config: WhatsAppAgentConfig
  private state: SalesAgentState
  private logEntries: AgentLogEntry[] = []
  private sessionState: WhatsAppSessionState = 'disconnected'
  private browser: any = null

  constructor(config: WhatsAppAgentConfig, state: SalesAgentState) {
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

  getSessionState(): WhatsAppSessionState {
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
      await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 30000 })

      const qrSelector = 'canvas[aria-label="Scan me!"]'
      const qrExists = await page.$(qrSelector).then((el: any) => !!el).catch(() => false)

      if (qrExists) {
        this.sessionState = 'qr_ready'
        this.addLog('qr_ready', 'QR code displayed, waiting for scan')

        await page.waitForSelector(qrSelector, { hidden: true, timeout: 120000 }).catch(() => {})

        const stillQr = await page.$(qrSelector).then((el: any) => !!el).catch(() => false)
        if (stillQr) {
          this.sessionState = 'expired'
          this.addLog('qr_expired', 'QR code scan timeout')
          return false
        }
      }

      const chatList = await page.waitForSelector('div[data-testid="chat-list"]', { timeout: 30000 }).catch(() => null)
      if (chatList) {
        this.sessionState = 'connected'
        this.addLog('session_connected', 'WhatsApp Web session active')
        return true
      }

      this.sessionState = 'error'
      this.addLog('session_error', 'Could not detect WhatsApp Web main interface')
      return false
    } catch (err) {
      this.sessionState = 'error'
      this.addLog('connect_failed', err instanceof Error ? err.message : String(err || ''))
      return false
    }
  }

  async checkSession(): Promise<WhatsAppSessionState> {
    if (!this.browser) return 'disconnected'
    try {
      const pages = await this.browser.pages()
      const page = pages[0]
      if (!page) return 'disconnected'

      const url = page.url()
      if (url.includes('web.whatsapp.com')) {
        const chatList = await page.$('div[data-testid="chat-list"]')
        this.sessionState = chatList ? 'connected' : 'disconnected'
      } else {
        this.sessionState = 'disconnected'
      }
    } catch {
      this.sessionState = 'error'
    }
    return this.sessionState
  }

  async sendMessage(task: AgentTask, message?: string): Promise<WhatsAppAgentResult> {
    if (this.sessionState !== 'connected') {
      const connected = await this.connect()
      if (!connected) return { success: false, error: `WhatsApp not connected (state: ${this.sessionState})` }
    }

    if (this.state.dailyUsed >= this.config.dailyLimit) {
      return { success: false, error: 'Daily limit reached' }
    }

    try {
      const pages = await this.browser.pages()
      const page = pages[0]

      const phoneNumber = task.phone?.replace(/[^0-9]/g, '') || ''
      if (!phoneNumber) return { success: false, error: 'No phone number' }

      await page.goto(`https://web.whatsapp.com/send?phone=${phoneNumber}`, { waitUntil: 'networkidle2', timeout: 30000 })

      const messageBoxSelector = 'div[data-testid="conversation-compose-box-input"] > p'
      const messageBox = await page.waitForSelector(messageBoxSelector, { timeout: 15000 }).catch(() => null)
      if (!messageBox) {
        this.addLog('send_failed', `Could not find message input for ${phoneNumber}`)
        return { success: false, error: 'Message input not found' }
      }

      const text = message || `Hi ${task.company},\n\nWe noticed your business and would like to connect.\n\nBest regards`
      await messageBox.type(text, { delay: 50 })

      const sendButton = await page.waitForSelector('button[data-testid="compose-btn-send"]', { timeout: 5000 }).catch(() => null)
      if (sendButton) {
        await sendButton.click()
      } else {
        await page.keyboard.press('Enter')
      }

      await new Promise((resolve) => setTimeout(resolve, 2000))

      this.state.dailyUsed += 1
      this.state.completedCount += 1
      this.state.lastActivity = new Date().toISOString()
      this.addLog('message_sent', `To=${phoneNumber} Company=${task.company}`)

      return { success: true, messageId: `${Date.now()}-${phoneNumber}` }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err || '')
      const isRateLimited = /rate.limit|429|too many|blocked/i.test(errMsg)
      if (isRateLimited) {
        this.sessionState = 'rate_limited'
        this.addLog('rate_limited', `Company=${task.company}`)
      }
      this.state.failedCount += 1
      this.state.lastActivity = new Date().toISOString()
      this.addLog('send_failed', `Company=${task.company} Error=${errMsg}`)
      return { success: false, error: errMsg }
    }
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
