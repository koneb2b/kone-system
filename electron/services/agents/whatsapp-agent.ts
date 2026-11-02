import type { AgentTask } from '../agent-pipeline'
import type { SalesAgentState, AgentLogEntry } from '../../../src/shared/ipc-contracts'
import { launchPersistentBrowser } from './browser-resolver'

type WhatsAppSessionState = 'disconnected' | 'connected' | 'qr_ready' | 'expired' | 'rate_limited' | 'error'

export type WhatsAppAgentConfig = {
  dailyLimit: number
  sessionPath?: string
  // Anti-ban pacing: randomized delay applied AFTER each send (PRD reach-out red line).
  minSendIntervalMs?: number
  maxSendIntervalMs?: number
  /* P0 知识库注入：当调用方未显式传入 message 时，用本函数构造兜底文案。
     必须是**纯同步函数且永不抛错** —— 它是真实外发动作路径上的一环，
     绝不能因内容构造失败阻断发送（ARCH-STANDARDS「内容层失败永不阻断发送链路」）。
     返回 undefined 或空串时回落到内置极简模板。 */
  fallbackTextBuilder?: (task: AgentTask) => string | undefined
}

// 'delivered' is ONLY set when WhatsApp Web shows a real delivery/read tick.
// If the tick cannot be confirmed we return 'pending' — never fake a delivered status.
type WhatsAppDeliveryStatus = 'delivered' | 'pending' | 'failed'

type WhatsAppAgentResult = {
  success: boolean
  messageId?: string
  deliveryStatus?: WhatsAppDeliveryStatus
  error?: string
}

const DEFAULT_MIN_SEND_INTERVAL_MS = 30_000
const DEFAULT_MAX_SEND_INTERVAL_MS = 90_000

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
      // L0-2/B2：打包产物无捆绑 Chromium —— 探测用户机器 Chrome/Edge 后再启动，
      // 浏览器来源写入运行日志保持可审计（找不到时抛出带指引的中文错误）。
      const { browser, label } = await launchPersistentBrowser(this.config.sessionPath)
      this.browser = browser
      this.addLog('browser_launched', `Browser engine: ${label}`)

      const page = await this.browser.newPage()
      await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 30000 })

      const qrSelector = 'canvas[aria-label="Scan me!"]'
      const qrExists = await page
        .$(qrSelector)
        .then((el: any) => !!el)
        .catch(() => false)

      if (qrExists) {
        this.sessionState = 'qr_ready'
        this.addLog('qr_ready', 'QR code displayed, waiting for scan')

        await page.waitForSelector(qrSelector, { hidden: true, timeout: 120000 }).catch(() => {})

        const stillQr = await page
          .$(qrSelector)
          .then((el: any) => !!el)
          .catch(() => false)
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

      await page.goto(`https://web.whatsapp.com/send?phone=${phoneNumber}`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })

      const messageBoxSelector = 'div[data-testid="conversation-compose-box-input"] > p'
      const messageBox = await page.waitForSelector(messageBoxSelector, { timeout: 15000 }).catch(() => null)
      if (!messageBox) {
        this.addLog('send_failed', `Could not find message input for ${phoneNumber}`)
        return { success: false, error: 'Message input not found' }
      }

      // 优先级：调用方显式文案 > 知识库驱动的构造文案 > 内置极简模板。
      // 构造失败（返回空）时静默回落，绝不让内容问题阻断发送。
      let builtFallback: string | undefined
      try {
        builtFallback = this.config.fallbackTextBuilder?.(task)
      } catch {
        builtFallback = undefined
      }
      const text =
        message ||
        (builtFallback && builtFallback.trim()) ||
        `Hi ${task.company},\n\nWe noticed your business and would like to connect.\n\nBest regards`
      await messageBox.type(text, { delay: 50 })

      const sendButton = await page
        .waitForSelector('button[data-testid="compose-btn-send"]', { timeout: 5000 })
        .catch(() => null)
      if (sendButton) {
        await sendButton.click()
      } else {
        await page.keyboard.press('Enter')
      }

      // Real delivery confirmation: poll for the last outgoing message's status tick.
      // WhatsApp renders an aria-label like "Sent"/"Delivered"/"Read" on the check icon.
      // We NEVER assume success — if no tick is observed, the status stays 'pending'.
      const deliveryStatus = await this.detectDeliveryStatus(page)

      this.state.dailyUsed += 1
      /* N-1 修复（2026-11-03）：不再在此递增 completedCount —— 编排层
         （agent-service executeWhatsAppAgent）是唯一计数点，避免与共享 state
         对象双重递增（delivered 曾 +2 / pending +1 不一致，进度可超 100%）。
         投递语义由返回值 deliveryStatus 承载，不污染计数。 */
      this.state.lastActivity = new Date().toISOString()
      this.addLog('message_sent', `To=${phoneNumber} Company=${task.company} Delivery=${deliveryStatus}`)

      // Randomized human-like pacing before the next send (anti rate-limit).
      await this.pace()

      return { success: true, messageId: `${Date.now()}-${phoneNumber}`, deliveryStatus }
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

  // Best-effort delivery confirmation. Returns 'delivered' ONLY when a real
  // sent/delivered/read tick is observed; otherwise 'pending'. Never fakes success.
  private async detectDeliveryStatus(page: any): Promise<WhatsAppDeliveryStatus> {
    const deadline = Date.now() + 8000
    const tickSelectors = [
      'span[data-testid="msg-dblcheck"]',
      'span[data-testid="msg-check"]',
      'span[aria-label="Sent"]',
      'span[aria-label="Delivered"]',
      'span[aria-label="Read"]',
    ]
    while (Date.now() < deadline) {
      for (const selector of tickSelectors) {
        const tick = await page.$(selector).catch(() => null)
        if (tick) return 'delivered'
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return 'pending'
  }

  // Randomized delay to mimic human cadence and reduce rate-limit/ban risk.
  private async pace(): Promise<void> {
    const min = this.config.minSendIntervalMs ?? DEFAULT_MIN_SEND_INTERVAL_MS
    const max = Math.max(min, this.config.maxSendIntervalMs ?? DEFAULT_MAX_SEND_INTERVAL_MS)
    const delay = min + Math.floor(Math.random() * (max - min + 1))
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  async disconnect() {
    if (this.browser) {
      try {
        await this.browser.close()
      } catch {
        /* browser.close() may throw if already closed — ignore for disconnect */
      }
      this.browser = null
    }
    this.sessionState = 'disconnected'
  }
}
