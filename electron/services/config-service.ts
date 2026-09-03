import { app } from './electron-bridge'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { IPC_CHANNELS } from '../ipc/channels'
import { resetCircuitBreaker } from '../utils/http-client'
import { checkSecret, getSecret, migrateSecrets, setSecret } from './secret-manager'

export const DEFAULT_SEARCH_TIMEOUT_MS = 60000

export const SECRET_KEYS = {
  LLM_API_KEY: 'secrets.llm.apiKey',
  GOOGLE_LEADS_API_KEY: 'secrets.google-leads.apiKey',
  GOOGLE_MAPS_API_KEY: 'secrets.google-maps.apiKey',
  DECISION_MAKER_API_KEY: 'secrets.decision-maker.apiKey',
  LICENSE_KEY: 'secrets.license.key',
  LICENSE_CLAIMS: 'secrets.license.claims',
  ANYSEARCH_API_KEY: 'secrets.anysearch.apiKey',
  ANYSEARCH_BASE_URL: 'secrets.anysearch.baseUrl',
  /* L0-3/B3：Email Agent SMTP 密码加密落位（明文遗留字段仅作读端回退兼容） */
  EMAIL_SMTP_PASS: 'secrets.email.smtpPass',
} as const

export const PROVIDER_SECRET_KEYS: Record<string, string> = {
  llm: SECRET_KEYS.LLM_API_KEY,
  'google-leads': SECRET_KEYS.GOOGLE_LEADS_API_KEY,
  'google-maps': SECRET_KEYS.GOOGLE_MAPS_API_KEY,
  'decision-maker': SECRET_KEYS.DECISION_MAKER_API_KEY,
  anysearch: SECRET_KEYS.ANYSEARCH_API_KEY,
}

/* ── 原生文件存储 Store 替代 electron-store ── */

const MAX_CONCURRENT_WRITES = 2
let pendingWrites = 0
const writeQueue: Array<() => void> = []

const drainWriteQueue = () => {
  while (pendingWrites < MAX_CONCURRENT_WRITES && writeQueue.length > 0) {
    const next = writeQueue.shift()
    if (next) {
      pendingWrites += 1
      next()
    }
  }
}

class NativeStore {
  declare path: string
  private data: Record<string, unknown>

  constructor(options: { name: string; cwd: string; defaults?: Record<string, unknown> }) {
    this.path = path.join(options.cwd, `${options.name}.json`)
    const defaults = options.defaults || {}
    this.data = { ...defaults }

    try {
      if (fs.existsSync(this.path)) {
        const raw = fs.readFileSync(this.path, 'utf-8')
        if (raw && raw.trim()) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(this.data, parsed)
          }
        }
      } else {
        fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8')
      }
    } catch {
      try {
        fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8')
      } catch {
        // 磁盘写保护环境静默降级
      }
    }
  }

  get(key: string, defaultValue?: any): any {
    const parts = String(key || '').split('.')
    let node: any = this.data

    for (const part of parts) {
      if (node === null || typeof node !== 'object') {
        return defaultValue
      }
      if (!(part in node)) {
        return defaultValue
      }
      node = node[part]
    }

    return node === undefined ? defaultValue : node
  }

  set(key: string, value: any): void {
    const parts = String(key || '').split('.')
    const leaf = parts.pop()!
    let node: any = this.data

    for (const part of parts) {
      if (!(part in node) || typeof node[part] !== 'object' || node[part] === null) {
        node[part] = {}
      }
      node = node[part]
    }

    node[leaf] = value
    this.flushToDisk()
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  private flushToDisk(): void {
    const doWrite = () => {
      try {
        fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8')
      } catch {
        // 写入失败静默降级
      } finally {
        pendingWrites = Math.max(0, pendingWrites - 1)
        drainWriteQueue()
      }
    }

    if (pendingWrites < MAX_CONCURRENT_WRITES) {
      pendingWrites += 1
      doWrite()
    } else {
      writeQueue.push(doWrite)
    }
  }
}

export type ConfigStore = any

const fallbackUserData = () => {
  const p = typeof app.getPath === 'function' ? app.getPath('userData') : undefined
  return p || path.join(os.homedir(), '.kone-config')
}

export const createConfigStore = () =>
  new NativeStore({
    name: 'kone-config',
    cwd: fallbackUserData(),
    defaults: {
      leads: [],
      auth: { verified: false },
    },
  }) as ConfigStore

export const assertConfigWritable = (store: ConfigStore) => {
  try {
    const storePath = (store as NativeStore).path || path.join(fallbackUserData(), 'kone-config.json')
    fs.accessSync(storePath, fs.constants.W_OK)
  } catch {
    console.warn('⚠️ [Config] Store path is not writable')
  }
}

export const sanitizeUserConfig = (rawConfig: unknown) => {
  const next = rawConfig && typeof rawConfig === 'object' ? { ...(rawConfig as Record<string, unknown>) } : {}
  delete next.apiKeys
  delete next.licenseKey
  return next
}

export const getPublicUserConfig = (store: ConfigStore) => sanitizeUserConfig(store.get('user_config'))

export const getProviderConfig = (store: ConfigStore, providerId: string) => {
  const userConfig = getPublicUserConfig(store) as { providers?: Array<{ id?: string; baseUrl?: string }> }
  const providers = Array.isArray(userConfig?.providers) ? userConfig.providers : []
  return providers.find((provider) => provider?.id === providerId) || null
}

type ProviderConfigSnapshot = {
  id: string
  baseUrl: string
  secretKey: string
}

export type N8nConfigSnapshot = {
  webhookUrl: string
  autoPush: boolean
  minScore: number
  roleFilter: string
}

export const getGoogleConfig = (store: ConfigStore) => {
  const googleLeads = getProviderConfig(store, 'google-leads')
  const googleMaps = getProviderConfig(store, 'google-maps')

  const normalizeProviderSnapshot = (
    id: string,
    provider: { id?: string; baseUrl?: string } | null,
    secretKey: string,
  ): ProviderConfigSnapshot => ({
    id,
    baseUrl: provider?.baseUrl?.trim() || '',
    secretKey,
  })

  return {
    googleLeads: normalizeProviderSnapshot('google-leads', googleLeads, SECRET_KEYS.GOOGLE_LEADS_API_KEY),
    googleMaps: normalizeProviderSnapshot('google-maps', googleMaps, SECRET_KEYS.GOOGLE_MAPS_API_KEY),
  }
}

export const getN8nConfig = (store: ConfigStore): N8nConfigSnapshot => {
  const userConfig = getPublicUserConfig(store) as {
    n8n?: { webhookUrl?: string; autoPush?: boolean; minScore?: number; roleFilter?: string }
  }

  const rawMinScore = Number(userConfig?.n8n?.minScore)
  return {
    webhookUrl: String(userConfig?.n8n?.webhookUrl || '').trim(),
    autoPush: Boolean(userConfig?.n8n?.autoPush),
    minScore: Number.isFinite(rawMinScore) ? Math.max(0, Math.min(100, rawMinScore)) : 60,
    roleFilter: String(userConfig?.n8n?.roleFilter || '').trim(),
  }
}

export const shouldAllowN8nPush = (config: N8nConfigSnapshot, lead: { matchScore?: number; inferredRole?: string }) => {
  if (!config.autoPush) {
    return { allowed: true as const, reason: '' }
  }

  const matchScore = Number.isFinite(Number(lead.matchScore)) ? Number(lead.matchScore) : 0
  if (matchScore < config.minScore) {
    return {
      allowed: false as const,
      reason: `该线索评分低于自动推送阈值 ${config.minScore}，已被智能路由拦截`,
    }
  }

  const normalizedRoleFilter = config.roleFilter.toLowerCase()
  const normalizedInferredRole = String(lead.inferredRole || '')
    .trim()
    .toLowerCase()
  if (normalizedRoleFilter && !normalizedInferredRole.includes(normalizedRoleFilter)) {
    return {
      allowed: false as const,
      reason: `该线索角色不符合自动推送条件（需匹配：${config.roleFilter}），已被智能路由拦截`,
    }
  }

  return { allowed: true as const, reason: '' }
}

export const getConfigValue = (store: ConfigStore, key: string) => {
  if (key === 'user_config') {
    return getPublicUserConfig(store)
  }
  return store.get(key)
}

export const setConfigValue = (store: ConfigStore, key: string, value: unknown) => {
  if (key === 'user_config') {
    store.set(key, sanitizeUserConfig(value))
    return
  }
  store.set(key, value)
}

export const getProviderSecretKey = (provider?: string) => {
  const secretKey = provider ? PROVIDER_SECRET_KEYS[provider] : undefined
  if (!secretKey) {
    throw new Error(`Unsupported secret provider: ${provider || 'unknown'}`)
  }
  if (provider === 'anysearch' && !getSecret(secretKey).trim()) {
    return SECRET_KEYS.DECISION_MAKER_API_KEY
  }
  return secretKey
}

export const getStoredLicenseClaims = () => {
  const raw = getSecret(SECRET_KEYS.LICENSE_CLAIMS)
  if (!raw) return null
  try {
    return JSON.parse(raw) as {
      status: 'active' | 'expired'
      expiresAt: number
      features: string[]
      licenseKey: string
      machineId?: string
      plan?: 'trial' | 'basic' | 'premium' | 'enterprise'
    }
  } catch {
    return null
  }
}

export const getMachineFingerprint = () => {
  try {
    const cpu = os.cpus()?.[0]?.model || 'unknown'
    const raw = [os.hostname(), os.userInfo().username, process.arch, cpu].join('|')
    return crypto.createHash('sha256').update(raw).digest('hex')
  } catch {
    return `ID-${os.hostname()}`
  }
}

export const getMachineIdOrCreate = (store: ConfigStore) => {
  const cached = store.get('system.machineId')
  if (cached) return String(cached)
  const generated = getMachineFingerprint()
  store.set('system.machineId', generated)
  return generated
}

export const getDevEnterpriseClaims = (store: ConfigStore) => ({
  status: 'active' as const,
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  features: [
    'enterprise',
    'search_basic',
    'search_deep',
    'analysis_basic',
    'analysis_advanced',
    'lead_export',
    'export_full',
    'cloud_send',
    'team_collaboration',
  ],
  licenseKey: 'DEV-ENTERPRISE-UNLOCKED',
  machineId: getMachineIdOrCreate(store),
  plan: 'enterprise' as const,
})

/**
 * 读取用户 LLM API Key。
 * 优先使用 secret store 中的正式密钥；若不存在，则兼容旧版 user_config.llmApiKey。
 * 这是唯一合法的 LLM API Key 读取入口。
 */
export const getUserLlmApiKey = (store?: ConfigStore): string => {
  const secretValue = getSecret(SECRET_KEYS.LLM_API_KEY).trim()
  if (secretValue) {
    return secretValue
  }

  if (!store) {
    return ''
  }

  const userConfig = store.get('user_config') as { llmApiKey?: string } | undefined
  return String(userConfig?.llmApiKey || '').trim()
}

export const migrateLegacySecretsFromConfig = (store: ConfigStore) => {
  const rawConfig = store.get('user_config') as Record<string, unknown> | undefined
  const apiKeys = Array.isArray(rawConfig?.apiKeys) ? rawConfig.apiKeys : []
  const migrationEntries = apiKeys
    .map((item: any) => ({
      key: PROVIDER_SECRET_KEYS[String(item?.id || '')],
      value: typeof item?.key === 'string' ? item.key : undefined,
    }))
    .filter((item: { key?: string; value?: string }) => Boolean(item.key && item.value))

  if (typeof rawConfig?.licenseKey === 'string' && rawConfig.licenseKey.trim()) {
    migrationEntries.push({ key: SECRET_KEYS.LICENSE_KEY, value: rawConfig.licenseKey })
  }

  const migrated = migrateSecrets(migrationEntries)
  if (migrated) {
    resetCircuitBreaker()
  }
  store.set('user_config', sanitizeUserConfig(rawConfig))
}

/** config:set 写保护黑名单 — 禁止渲染进程直接篡改授权/计费相关键 */
const CONFIG_SET_BLACKLIST = ['license.', 'billing.', 'secrets.', 'system.hardwareMachineId']

const isConfigKeyBlocked = (key: string): boolean => CONFIG_SET_BLACKLIST.some((prefix) => key.startsWith(prefix))

/** secret:set 写保护白名单 — 仅允许渲染进程设置这些密钥 */
const SECRET_SET_WHITELIST: Set<string> = new Set([
  SECRET_KEYS.LLM_API_KEY,
  SECRET_KEYS.GOOGLE_LEADS_API_KEY,
  SECRET_KEYS.GOOGLE_MAPS_API_KEY,
  SECRET_KEYS.DECISION_MAKER_API_KEY,
  SECRET_KEYS.ANYSEARCH_API_KEY,
  SECRET_KEYS.ANYSEARCH_BASE_URL,
])

interface IElectronMain extends Electron.IpcMain {
  handle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void
}

export const registerConfigHandlers = (ipcMain: Electron.IpcMain, store: ConfigStore) => {
  ipcMain.handle(IPC_CHANNELS.CONFIG.GET, (_event, key: string) => {
    try {
      return { success: true, data: getConfigValue(store, key) }
    } catch (error: any) {
      console.error('[Config] Get failed:', error?.message)
      return { success: false, error: error?.message || 'Config get failed', code: error?.code }
    }
  })
  ipcMain.handle(IPC_CHANNELS.CONFIG.SET, (_event, payload: { key: string; value: unknown } | undefined | null) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '配置写入参数无效', code: 400 }
      }
      const { key, value } = payload
      if (typeof key !== 'string' || !key.trim()) {
        return { success: false, error: '配置项 key 无效', code: 400 }
      }
      if (isConfigKeyBlocked(key)) {
        console.warn(`[Config] 已拦截受保护配置项写入: ${key}`)
        return { success: false, error: `禁止直接修改受保护的配置项: ${key}`, code: 403 }
      }
      setConfigValue(store, key, value)
      resetCircuitBreaker()
      return { success: true, data: null }
    } catch (error: any) {
      console.error('[Config] Set failed:', error?.message)
      return { success: false, error: error?.message || 'Config set failed', code: error?.code }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SECRET.SET, (_event, payload: { key: string; value: string } | undefined | null) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '密钥写入参数无效', code: 400 }
      }
      if (typeof payload.key !== 'string' || !payload.key.trim()) {
        return { success: false, error: '密钥 key 无效', code: 400 }
      }
      if (typeof payload.value !== 'string') {
        return { success: false, error: '密钥 value 无效', code: 400 }
      }
      if (!SECRET_SET_WHITELIST.has(payload.key)) {
        console.warn(`[Secret] 已拦截非白名单密钥写入: ${payload.key}`)
        return { success: false, error: `禁止设置非白名单密钥: ${payload.key}`, code: 403 }
      }
      const result = setSecret(payload.key, payload.value)
      if (payload.key === SECRET_KEYS.ANYSEARCH_API_KEY) {
        setSecret('anysearch-api-key', payload.value)
      }
      resetCircuitBreaker()
      return { success: true, data: result }
    } catch (error: any) {
      console.error('[Secret] Set failed:', error?.message)
      return { success: false, error: error?.message || 'Secret set failed', code: error?.code }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SECRET.CHECK, (_event, key: string) => {
    try {
      return { success: true, data: checkSecret(key) }
    } catch (error: any) {
      console.error('[Secret] Check failed:', error?.message)
      return { success: false, error: error?.message || 'Secret check failed', code: error?.code }
    }
  })
}
