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

const performHealthCheck = async (entry: AccountEntry) => {
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
      entry.status = 'connected'
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

const startHealthCheckPoller = (sender: Electron.WebContents) => {
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
        const updated = await performHealthCheck(entry)
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

  let rollcallSender: Electron.WebContents | null = null

  /* ── ACCOUNT CONNECT ── */
  registerIpc(IPC_CHANNELS.ACCOUNT.CONNECT, accountConnectContract, async (_event: unknown, payload: unknown) => {
    try {
      const p = (payload || {}) as { accountType: string; label: string; credentials?: Record<string, string> }
      const accountType = String(p?.accountType || '').trim() as AccountEntry['accountType']

      const hasTeamCollaboration = hasFeature(licenseGuard, 'team_collaboration')
      const hasSearchBasic = hasFeature(licenseGuard, 'search_basic')

      if (!hasTeamCollaboration) {
        const isEmailType = accountType === 'email_smtp' || accountType === 'email_imap'
        if (!isEmailType || !hasSearchBasic) {
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
        status: 'connected',
        connectedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        credentials: p.credentials,
      }

      accounts.set(accountId, entry)
      if (rollcallSender && !rollcallSender.isDestroyed()) {
        startHealthCheckPoller(rollcallSender)
      }

      return {
        success: true,
        data: {
          accountId: entry.accountId,
          status: entry.status,
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
      const hasSearchBasic = hasFeature(licenseGuard, 'search_basic')
      const isEmailType = entry.accountType === 'email_smtp' || entry.accountType === 'email_imap'

      if (!hasTeamCollaboration && (!isEmailType || !hasSearchBasic)) {
        return (
          buildFeatureResult(false, 'FEATURE_DENIED', 403) ?? { success: false, error: 'FEATURE_DENIED', code: 403 }
        )
      }

      const partition = getSessionPartition(accountId)
      const ses = session.fromPartition(partition)
      await ses.clearStorageData({ storages: ['cookies', 'localstorage'] })

      accounts.delete(accountId)

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
      const hasSearchBasic = hasFeature(licenseGuard, 'search_basic')

      if (!hasTeamCollaboration && !hasSearchBasic) {
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
        startHealthCheckPoller(rollcallSender)
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
