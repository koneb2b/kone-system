import { configGet, configSet } from '@/lib/electron-api'

export type UserSettingsConfig = {
  providers?: Array<{ id?: string; baseUrl?: string }>
  selectedModel?: string
  icpProfile?: {
    targetProduct?: string
    buyerPersona?: string
    coreAdvantage?: string
    negativeIcp?: string
  }
  connectionStatus?: Record<string, 'connected' | 'error' | 'pending'>
  userRole?: 'trial' | 'pro' | 'enterprise'
  searchTimeoutMs?: number
  analysisTimeoutMs?: number
  /* V1.3 Email Agent 配置边界（agent-service.ts:243-263 读取同一 shape） */
  accounts?: {
    email?: EmailAccountConfig
  }
}

/**
 * Email Agent SMTP + IMAP 配置（P0-2 链路修复 + L0-3/B3 加密改造 + Phase 2.5/P2.6 IMAP 扩展）。
 *
 * SMTP 字段：smtpPass 仅作【旧安装明文遗留回退】——新保存一律写入
 * secret-manager（'secrets.email.smtpPass'，safeStorage 加密），
 * 渲染端保存时会将本字段清空；主进程读端优先取 secret。
 *
 * IMAP 字段（Phase 2.5）：imapHost 必须显式填写——**不从 smtpHost 派生**
 * （不同提供商的 imap/smtp 主机名不同，如 smtp.gmail.com vs imap.gmail.com）。
 * imapUser/imapPass 均可留空，主进程读端按 imapUser → smtpUser、
 * imapPass 加密槽 → smtpPass 加密槽的顺序回退。imapPass 明文字段同 smtpPass
 * 一样仅作遗留回退，新保存一律走 secret-manager 的 'secrets.email.imapPass'。
 */
export type EmailAccountConfig = {
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  /** @deprecated 明文遗留回退字段 —— 请勿新写入，读端仅作兼容 */
  smtpPass?: string
  senderEmail?: string
  senderName?: string
  /* ── IMAP（Phase 2.5 回复检测，可选）── */
  imapHost?: string
  imapPort?: number
  imapUser?: string
  /** @deprecated 明文遗留回退字段 —— 请勿新写入，读端仅作兼容 */
  imapPass?: string
}

export type UserKnowledgeBaseConfig = {
  knowledgeBase?: {
    files?: unknown[]
    customTags?: string[]
    entries?: Array<{
      id: string
      title: string
      content: string
      tags: string[]
      createdAt?: string
      updatedAt?: string
    }>
    updatedAt?: string
  }
}

export type UserLeadsDataConfig = {
  leads?: unknown[]
  searchResults?: unknown[]
}

// user_config 边界约定：
// 1) settings: providers / selectedModel / icpProfile / connectionStatus / userRole / timeouts
// 2) leads data: leads / searchResults
// 3) knowledge data: knowledgeBase
// 不同模块写入时必须只 merge 自己负责的边界，禁止整包覆盖整个 user_config。
export type UserConfig = UserSettingsConfig & UserLeadsDataConfig & UserKnowledgeBaseConfig

const STORAGE_KEY = 'user_config'

export const getUserConfig = async <T extends UserConfig = UserConfig>(): Promise<T> => {
  const raw = await configGet<T>(STORAGE_KEY)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw
  }
  return {} as T
}

export const setUserConfig = async <T extends UserConfig = UserConfig>(next: T) =>
  configSet({ key: STORAGE_KEY, value: next })

export const updateUserConfig = async <T extends UserConfig = UserConfig>(
  updater: Partial<T> | ((current: T) => T),
) => {
  const current = await getUserConfig<T>()
  const next = typeof updater === 'function' ? updater(current) : ({ ...current, ...updater } as T)
  await setUserConfig(next)
  return next
}

export const updateUserSettingsConfig = async <T extends UserSettingsConfig = UserSettingsConfig>(
  updater: Partial<T> | ((current: T) => T),
) => {
  const current = await getUserConfig<UserConfig>()
  const currentSettings = current as T
  const nextSettings =
    typeof updater === 'function' ? updater(currentSettings) : ({ ...currentSettings, ...updater } as T)
  const next = {
    ...current,
    ...nextSettings,
  } as UserConfig
  await setUserConfig(next)
  return nextSettings
}

// 云端自动化配置已移除（Phase 0），Phase 1 接入 Cloudflare Workers 后重新实现。
