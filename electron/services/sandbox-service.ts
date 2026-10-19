import { session } from './electron-bridge'
import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc, registry } from '../ipc/registry'
import {
  accountConnectContract,
  accountDisconnectContract,
  accountGetListContract,
} from '../ipc/contracts/account.contract'
import { ConfigStore } from './config-service'
import { createLicenseService } from './license-service'

type AccountEntry = {
  accountId: string
  accountType: 'email_smtp' | 'email_imap' | 'linkedin' | 'facebook' | 'whatsapp'
  label: string
  email?: string
  status: 'connected' | 'disconnected' | 'rate_limited' | 'error'
  connectedAt?: string
  lastCheckedAt?: string
  errorMessage?: string
  credentials?: Record<string, string>
}

const SESSION_PREFIX = 'persist:kone_sandbox_'
const MAX_CONCURRENT_HEALTH_CHECKS = 2
const HEALTH_POLL_INTERVAL_MS = 30_000

const accounts: Map<string, AccountEntry> = new Map()
let healthCheckTimer: ReturnType<typeof setInterval> | null = null
let healthCheckRunning = false

/* P1-9 修复：账号列表此前是**纯内存 Map** —— 进程重启即清空，
   用户每次开机都要重新「连接」账号（Cookie 分区其实还在，只是列表空了）。
   现持久化到独立配置键；Cookie 本就由 `persist:kone_sandbox_*` 分区承载。
   注意：只持久化**结构**（connect / disconnect），不持久化 `status` ——
   重启后由 30s 健康检查自动刷新，避免每次检查都写盘。 */
const SANDBOX_ACCOUNTS_CONFIG_KEY = 'sandbox_accounts'
let sandboxStore: ConfigStore | null = null

const persistSandboxAccounts = () => {
  if (!sandboxStore) return
  try {
    sandboxStore.set(SANDBOX_ACCOUNTS_CONFIG_KEY, Array.from(accounts.values()))
  } catch {
    /* disk-protected env → keep in-memory accounts only */
  }
}

const hydrateSandboxAccounts = (store: ConfigStore) => {
  sandboxStore = store
  try {
    const saved = store.get(SANDBOX_ACCOUNTS_CONFIG_KEY)
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        const e = entry as AccountEntry | undefined
        if (e && typeof e === 'object' && e.accountId) accounts.set(e.accountId, e)
      }
    }
  } catch {
    /* corrupt/absent persistence → start with an empty list */
  }
}

const generateAccountId = () => {
  const ts = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 8)
  return `kone_acct_${ts}_${rnd}`
}

const getSessionPartition = (accountId: string) => `${SESSION_PREFIX}${accountId}`

const runLimitedConcurrency = async <T>(items: T[], limit: number, worker: (item: T) => Promise<void>) => {
  let currentIndex = 0
  const normalizedLimit = Math.max(1, Math.min(limit, items.length || 1))

  const runner = async () => {
    while (true) {
      const index = currentIndex
      if (index >= items.length) return
      currentIndex += 1
      await worker(items[index])
    }
  }

  await Promise.all(Array.from({ length: normalizedLimit }, () => runner()))
}

const performHealthCheck = async (entry: AccountEntry, store: ConfigStore) => {
  try {
    const partition = getSessionPartition(entry.accountId)
    const ses = session.fromPartition(partition)

    if (entry.accountType === 'linkedin') {
      const cookies = await ses.cookies.get({ url: 'https://www.linkedin.com' })
      const liAtCookie = cookies.find((c) => c.name === 'li_at')
      if (liAtCookie && liAtCookie.expirationDate && liAtCookie.expirationDate * 1000 > Date.now()) {
        entry.status = 'connected'
        entry.errorMessage = undefined
      } else {
        entry.status = 'disconnected'
        entry.errorMessage = 'LinkedIn 会话已过期，请重新登录'
      }
    } else if (entry.accountType === 'facebook') {
      const cookies = await ses.cookies.get({ url: 'https://www.facebook.com' })
      const cUserCookie = cookies.find((c) => c.name === 'c_user')
      if (cUserCookie && cUserCookie.expirationDate && cUserCookie.expirationDate * 1000 > Date.now()) {
        entry.status = 'connected'
        entry.errorMessage = undefined
      } else {
        entry.status = 'disconnected'
        entry.errorMessage = 'Facebook 会话已过期，请重新登录'
      }
    } else if (entry.accountType === 'whatsapp') {
      const cookies = await ses.cookies.get({ url: 'https://web.whatsapp.com' })
      const hasSession = cookies.some((c) => c.name === 'WAToken1' || c.name === 'wa_ul')
      if (hasSession) {
        entry.status = 'connected'
        entry.errorMessage = undefined
      } else {
        entry.status = 'disconnected'
        entry.errorMessage = 'WhatsApp Web 会话未建立'
      }
    } else {
      // 邮箱账号（email_smtp / email_imap）没有浏览器会话可查，
      // 退而校验 `user_config` 中的主机配置是否已填写（Fail-Closed）。
      //
      // 此前**无条件置 'connected'** —— 只要注册过账号条目就显示"已连接"，
      // 即便 SMTP/IMAP 从未配置，账号列表也给出虚假的"已连接"信号，
      // 与宪法「不得假成功」的要求相悖。
      // 注：此处只校验配置**存在性**；真实连通性由「测试连接」与
      // Email Agent 执行前的 DNS 健康检查（email-agent.ts）负责。
      /* P1-7 修复：邮箱配置的真实写入路径是 `user_config.accounts.email.*`
         （`accounts-management.tsx` 保存端、`agent-service.ts` / `imap-reply-service.ts`
         读取端均如此）。此处原先读**顶层** `user_config.smtpHost` → 路径不匹配 →
         邮箱账号恒判「已断开」，与「保存并连接」的成功提示自相矛盾。
         顶层读取保留为向后兼容回退（旧安装可能残留）。 */
      const cfg = (store.get('user_config') ?? {}) as {
        smtpHost?: string
        imapHost?: string
        accounts?: { email?: { smtpHost?: string; imapHost?: string } }
      }
      const emailCfg = cfg.accounts?.email
      const host =
        entry.accountType === 'email_smtp' ? emailCfg?.smtpHost || cfg.smtpHost : emailCfg?.imapHost || cfg.imapHost
      if (String(host ?? '').trim()) {
        entry.status = 'connected'
        entry.errorMessage = undefined
      } else {
        entry.status = 'disconnected'
        entry.errorMessage =
          entry.accountType === 'email_smtp'
            ? '未配置 SMTP 主机，请在「邮箱」设置中补全后重试'
            : '未配置 IMAP 主机，请在「邮箱」设置中补全后重试'
      }
    }

    entry.lastCheckedAt = new Date().toISOString()
  } catch (error) {
    entry.status = 'error'
    entry.errorMessage = error instanceof Error ? error.message : String(error || '主进程连接检测失败')
    entry.lastCheckedAt = new Date().toISOString()
  }

  return entry
}

const broadcastStatusUpdate = (sender: Electron.WebContents, updated: AccountEntry) => {
  sender.send(IPC_CHANNELS.ACCOUNT.STATUS_UPDATE, {
    accountId: updated.accountId,
    accountType: updated.accountType,
    label: updated.label,
    email: updated.email,
    status: updated.status,
    connectedAt: updated.connectedAt,
    lastCheckedAt: updated.lastCheckedAt,
    errorMessage: updated.errorMessage,
  })
}

const startHealthCheckPoller = (sender: Electron.WebContents, store: ConfigStore) => {
  if (healthCheckTimer) return

  healthCheckTimer = setInterval(async () => {
    if (healthCheckRunning) return
    healthCheckRunning = true

    try {
      const entries = Array.from(accounts.values()).filter(
        (e) => e.status === 'connected' || e.status === 'disconnected',
      )

      if (entries.length === 0) {
        healthCheckRunning = false
        return
      }

      await runLimitedConcurrency(entries, MAX_CONCURRENT_HEALTH_CHECKS, async (entry) => {
        const updated = await performHealthCheck(entry, store)
        accounts.set(updated.accountId, updated)
        if (!sender.isDestroyed()) {
          broadcastStatusUpdate(sender, updated)
        }
      })
    } catch {
      // 静默恢复，不断开轮询
    } finally {
      healthCheckRunning = false
    }
  }, HEALTH_POLL_INTERVAL_MS)
}

const stopHealthCheckPoller = () => {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
}

const buildFeatureResult = (success: boolean, error?: string, code?: number) => {
  if (success) return null
  return {
    success: false as const,
    error,
    code,
  }
}

const hasFeature = (licenseGuard: ReturnType<typeof createLicenseService>['licenseGuard'], featureKey: string) => {
  try {
    licenseGuard.requireFeature(featureKey, '账号操作')
    return true
  } catch {
    return false
  }
}

/**
 * Get a deterministic filesystem path for an account type's sandbox partition.
 * The path is stable so puppeteer cookie/session data persists across agent restarts,
 * maintaining the same isolation boundary as Electron sandbox accounts.
 * Falls back to a type-specific path under system temp when account store is empty.
 */
export const getSandboxPathForAccount = (accountType: string): string => {
  const existing = Array.from(accounts.values()).find((a) => a.accountType === accountType)
  const accountId = existing?.accountId || `kone_acct_${accountType}_default`
  const baseDir = process.env.TEMP || '/tmp'
  return `${baseDir}/kone_agent_sandbox/${accountId}`
}

/**
 * Find an account entry by type from the sandbox account store.
 */
export const findAccountByType = (accountType: string): AccountEntry | undefined => {
  return Array.from(accounts.values()).find((a) => a.accountType === accountType)
}

export const registerSandboxHandlers = (ipcMain: Electron.IpcMain, store: ConfigStore) => {
  const { licenseGuard } = createLicenseService(store)
  // P1-9：恢复上次会话的账号列表（重启不再清空）
  hydrateSandboxAccounts(store)

  let rollcallSender: Electron.WebContents | null = null

  /* ── ACCOUNT CONNECT ── */
  registerIpc(IPC_CHANNELS.ACCOUNT.CONNECT, accountConnectContract, async (_event: unknown, payload: unknown) => {
    try {
      const p = (payload || {}) as { accountType: string; label: string; credentials?: Record<string, string> }
      const accountType = String(p?.accountType || '').trim() as AccountEntry['accountType']

      const hasTeamCollaboration = hasFeature(licenseGuard, 'team_collaboration')
      /* D6（2026-10-19 修复）：非高级套餐的代理键必须是 local_autopilot（Paid Basic）。
         此处原用 search_basic —— 而 search_basic 亦属 TRIAL_FEATURES，
         导致活跃 Trial 可通过该判断越权绑定真实邮箱账号（违反 PRD §六.0 熔断要求）。 */
      const hasLocalAutopilot = hasFeature(licenseGuard, 'local_autopilot')

      if (!hasTeamCollaboration) {
        const isEmailType = accountType === 'email_smtp' || accountType === 'email_imap'
        if (!isEmailType || !hasLocalAutopilot) {
          return (
            buildFeatureResult(false, 'FEATURE_DENIED', 403) ?? { success: false, error: 'FEATURE_DENIED', code: 403 }
          )
        }
        const existingEmail = Array.from(accounts.values()).find(
          (a) => a.accountType === 'email_smtp' || a.accountType === 'email_imap',
        )
        if (existingEmail) {
          return { success: false, error: '基础版仅支持单个企业邮箱通道。请先断开已有邮箱账号。', code: 403 }
        }
      }

      rollcallSender = (_event as Electron.IpcMainInvokeEvent).sender
      const accountId = generateAccountId()
      const partition = getSessionPartition(accountId)

      const entry: AccountEntry = {
        accountId,
        accountType,
        label: String(p.label || '').trim() || `${accountType} 账号`,
        email: p.credentials?.email || undefined,
        // 初始状态**不谎报** connected：先置 disconnected，紧接着做一次真实健康检查
        // 并以检查结果覆盖。此前无条件置 'connected'，而轮询间隔 30s，
        // 意味着注册后最长 30 秒内账号列表会显示一个未经验证的"已连接"。
        status: 'disconnected',
        connectedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        credentials: p.credentials,
      }

      accounts.set(accountId, entry)
      persistSandboxAccounts()

      // 立即执行一次健康检查（不等待 30s 轮询），使返回的 status 反映真实情况
      await performHealthCheck(entry, store)

      if (rollcallSender && !rollcallSender.isDestroyed()) {
        startHealthCheckPoller(rollcallSender, store)
      }

      return {
        success: true,
        data: {
          accountId: entry.accountId,
          status: entry.status,
          errorMessage: entry.errorMessage,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '沙箱创建失败',
        code: 500,
      }
    }
  })

  /* ── ACCOUNT DISCONNECT ── */
  registerIpc(IPC_CHANNELS.ACCOUNT.DISCONNECT, accountDisconnectContract, async (_event: unknown, payload: unknown) => {
    try {
      const p = (payload || {}) as { accountId: string }
      const accountId = String(p?.accountId || '').trim()
      if (!accountId) {
        return { success: false, error: '缺少账号ID', code: 400 }
      }

      const entry = accounts.get(accountId)
      if (!entry) {
        return { success: false, error: '未找到目标账号', code: 404 }
      }

      const hasTeamCollaboration = hasFeature(licenseGuard, 'team_collaboration')
      // D6：与 CONNECT 同步换键（search_basic → local_autopilot），避免"可连不可断"的授权裂缝。
      const hasLocalAutopilot = hasFeature(licenseGuard, 'local_autopilot')
      const isEmailType = entry.accountType === 'email_smtp' || entry.accountType === 'email_imap'

      if (!hasTeamCollaboration && (!isEmailType || !hasLocalAutopilot)) {
        return (
          buildFeatureResult(false, 'FEATURE_DENIED', 403) ?? { success: false, error: 'FEATURE_DENIED', code: 403 }
        )
      }

      const partition = getSessionPartition(accountId)
      const ses = session.fromPartition(partition)
      await ses.clearStorageData({ storages: ['cookies', 'localstorage'] })

      accounts.delete(accountId)
      persistSandboxAccounts()

      if (accounts.size === 0) {
        stopHealthCheckPoller()
      }

      return { success: true, data: null }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '沙箱断开失败',
        code: 500,
      }
    }
  })

  /* ── ACCOUNT GET LIST ── */
  registerIpc(IPC_CHANNELS.ACCOUNT.GET_LIST, accountGetListContract, async (_event: unknown) => {
    try {
      const hasTeamCollaboration = hasFeature(licenseGuard, 'team_collaboration')
      // D6：读端同样换键，否则 Trial 仍可读到账号绑定元数据（PRD §六.0 禁暴露运行指标）。
      const hasLocalAutopilot = hasFeature(licenseGuard, 'local_autopilot')

      if (!hasTeamCollaboration && !hasLocalAutopilot) {
        return (
          buildFeatureResult(false, 'FEATURE_DENIED', 403) ?? { success: false, error: 'FEATURE_DENIED', code: 403 }
        )
      }

      rollcallSender = (_event as Electron.IpcMainInvokeEvent).sender

      let entries = Array.from(accounts.values())
      if (!hasTeamCollaboration) {
        entries = entries.filter((e) => e.accountType === 'email_smtp' || e.accountType === 'email_imap')
      }

      const sessionEntries = entries.map((entry) => ({
        accountId: entry.accountId,
        accountType: entry.accountType,
        label: entry.label,
        email: entry.email,
        status: entry.status,
        connectedAt: entry.connectedAt,
        lastCheckedAt: entry.lastCheckedAt,
        errorMessage: entry.errorMessage,
      }))

      if (rollcallSender && !rollcallSender.isDestroyed() && accounts.size > 0) {
        startHealthCheckPoller(rollcallSender, store)
      }

      return { success: true, data: { accounts: sessionEntries } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '读取账号列表失败',
        code: 500,
      }
    }
  })

  /* 自绑定兼容层（与 agent-service / autopilot-state-service / auth-service 同构）：
     历史 e2e / 独立测试直接调用本函数而未显式 attach，迁移后 3 个 plain 通道需落到
     ipcMain 才能被 getHandler 取到。attach 按 ipcMain 实例幂等，主进程末尾的 attach
     不会重复绑定。 */
  registry.attach(ipcMain)
}
