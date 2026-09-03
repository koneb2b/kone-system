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
  n8n?: {
    webhookUrl: string
    autoPush: boolean
    minScore?: number
    roleFilter?: string
  }
  userRole?: 'trial' | 'pro' | 'enterprise'
  searchTimeoutMs?: number
  analysisTimeoutMs?: number
  /* V1.3 Email Agent 配置边界（agent-service.ts:243-263 读取同一 shape） */
  accounts?: {
    email?: EmailAccountConfig
  }
}

/**
 * Email Agent SMTP 配置（P0-2 链路修复 + L0-3/B3 加密改造）。
 * 注意：smtpPass 字段仅作【旧安装明文遗留回退】——新保存一律写入
 * secret-manager（'secrets.email.smtpPass'，safeStorage 加密），
 * 渲染端保存时会将本字段清空；主进程读端优先取 secret。
 */
export type EmailAccountConfig = {
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  /** @deprecated 明文遗留回退字段 —— 请勿新写入，读端仅作兼容 */
  smtpPass?: string
  senderEmail?: string
  senderName?: string
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
// 1) settings: providers / selectedModel / icpProfile / connectionStatus / n8n / userRole / timeouts
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

export const getN8nSettings = async () => {
  const config = await getUserConfig()
  return {
    webhookUrl: config.n8n?.webhookUrl?.trim() || '',
    autoPush: Boolean(config.n8n?.autoPush),
    minScore: Number.isFinite(Number(config.n8n?.minScore))
      ? Math.max(0, Math.min(100, Number(config.n8n?.minScore)))
      : 60,
    roleFilter: String(config.n8n?.roleFilter || '').trim(),
  }
}
