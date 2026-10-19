import { app } from './electron-bridge'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc } from '../ipc/registry'
import {
  configGetContract,
  configSetContract,
  secretSetContract,
  secretCheckContract,
} from '../ipc/contracts/config.contract'
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
  /* Phase 2.5/P2.6：IMAP 回复检测专用密码加密落位。留空即回退到 EMAIL_SMTP_PASS */
  EMAIL_IMAP_PASS: 'secrets.email.imapPass',
  /* 2026-10-11：Apollo.io 联系人富化 API Key（B2B 邮箱 + 手机号补全，
     用于弥补官网抓取「不公开邮箱 / 多为座机」的覆盖短板）。经 safeStorage 加密落盘，
     与 LLM/Google 密钥同级，渲染层设置页必须能写。 */
  APOLLO_API_KEY: 'secrets.apollo.apiKey',
  /* 2026-10-13：Prospeo 联系人富化 API Key（**Apollo 的低成本前置**）。
     实测：search-person 1 credit（25 人/页，30 天内同页免费）/ 仅邮箱 enrich 1 credit /
     邮箱+手机 enrich 10 credits —— 邮箱成本比 Apollo 低一个数量级。
     经 safeStorage 加密落盘，渲染层设置页必须能写。 */
  PROSPEO_API_KEY: 'secrets.prospeo.apiKey',
  /* 2026-10-17：Serper（自备密钥的可选 Google 网页搜索来源，BYOK）。与 SerpApi 分列，
     经 safeStorage 加密落盘，渲染层设置页必须能写。 */
  SERPER_API_KEY: 'secrets.serper.apiKey',
} as const

export const PROVIDER_SECRET_KEYS: Record<string, string> = {
  llm: SECRET_KEYS.LLM_API_KEY,
  'google-leads': SECRET_KEYS.GOOGLE_LEADS_API_KEY,
  'google-maps': SECRET_KEYS.GOOGLE_MAPS_API_KEY,
  'decision-maker': SECRET_KEYS.DECISION_MAKER_API_KEY,
  anysearch: SECRET_KEYS.ANYSEARCH_API_KEY,
  serper: SECRET_KEYS.SERPER_API_KEY,
}

/* ── 原生文件存储 Store 替代 electron-store ── */

// DATA-01 修复：移除非必要写入队列（writeFileSync 本身为同步阻塞），
// 改为原子写入 + 错误上抛。原队列机制在同步 I/O 下无实际并行收益。

class NativeStore {
  declare path: string
  private data: Record<string, unknown>

  constructor(options: { name: string; cwd: string; defaults?: Record<string, unknown> }) {
    this.path = path.join(options.cwd, `${options.name}.json`)
    const defaults = options.defaults || {}
    this.data = { ...defaults }

    /* P0-5 加固：确保父目录存在。原实现在目录缺失（userData 被清理/首次异常启动）
       时进入 catch 分支并"静默降级"，结果是所有 set() 永久写不进磁盘且无任何提示。 */
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true })
    } catch {
      /* 目录不可创建时留给下方写入失败路径统一记录 lastWriteError */
    }

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
    // DATA-02: 检查并执行 Schema 迁移
    this.migrateIfNeeded()
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
    // P0-5 修复：原实现每次 set() 都做一次全量 JSON.stringify + writeFileSync + fsync
    // （Agent 回写一次会触发 2 次）。改为合并 + 防抖落盘；需要强持久性的边界
    // （退出、备份、导出、用户可见的配置写入）显式调用 flushSync()。
    this.scheduleFlush()
    // DATA-01 修复：写入失败不再静默——向上抛出让 IPC 层感知
    if (this.lastWriteError) {
      throw new Error(`配置写入失败: ${this.lastWriteError}`)
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  private lastWriteError: string | null = null

  getWriteError(): string | null {
    return this.lastWriteError
  }

  /* P0-5：落盘合并窗口。窗口内任意多次 set() 只产生一次序列化 + 一次磁盘写入。 */
  private static readonly FLUSH_DEBOUNCE_MS = 250
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushPending = false
  private fsyncUnsupportedWarned = false

  private scheduleFlush(): void {
    if (this.flushPending) return
    this.flushPending = true
    const timer = setTimeout(() => {
      this.flushPending = false
      this.flushTimer = null
      this.flushToDisk()
    }, NativeStore.FLUSH_DEBOUNCE_MS)
    // 后台内务定时器不得阻止事件循环退出（否则测试进程与主进程退出会被拖住）
    if (typeof timer.unref === 'function') timer.unref()
    this.flushTimer = timer
  }

  /**
   * P0-5：立即同步落盘并上抛失败。
   * 调用边界：应用退出前、备份触发前、导出读取前、以及用户可见的 CONFIG.SET。
   */
  flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flushPending = false
    this.flushToDisk()
    if (this.lastWriteError) {
      throw new Error(`配置写入失败: ${this.lastWriteError}`)
    }
  }

  // DATA-02: Schema 版本化与迁移支持
  private static readonly CURRENT_SCHEMA_VERSION = 1

  getSchemaVersion(): number {
    return Number(this.data._schemaVersion) || 0
  }

  private migrateIfNeeded(): void {
    const currentVersion = this.getSchemaVersion()
    if (currentVersion < NativeStore.CURRENT_SCHEMA_VERSION) {
      // 未来迁移逻辑在此扩展：
      // switch (currentVersion) {
      //   case 0: // v0 → v1 迁移逻辑
      //     break
      // }
      this.data._schemaVersion = NativeStore.CURRENT_SCHEMA_VERSION
    }
  }

  private flushToDisk(): void {
    try {
      // DATA-01 修复：原子写入——临时文件 → fsync → 原子 rename
      const tmpPath = this.path + '.tmp'
      const data = JSON.stringify(this.data, null, 2)
      fs.writeFileSync(tmpPath, data, 'utf-8')
      /* P0-5 加固：fsync 仅用于提升掉电持久性，并非写入成功的前提。
         某些文件系统（网络盘、容器 overlay、部分虚拟化卷）会返回 EPERM/ENOTSUP。
         原实现把 fsync 异常与写入异常一并吞进 lastWriteError，会导致**所有配置
         永久无法持久化**且每次 set() 都抛错。此处降级为一次性告警，rename 照常执行。 */
      try {
        const fd = fs.openSync(tmpPath, 'r')
        try {
          fs.fsyncSync(fd)
        } finally {
          fs.closeSync(fd)
        }
      } catch (fsyncError) {
        if (!this.fsyncUnsupportedWarned) {
          this.fsyncUnsupportedWarned = true
          console.warn(
            '[Config] 当前文件系统不支持 fsync，已降级为仅原子 rename（数据仍会写入）:',
            fsyncError instanceof Error ? fsyncError.message : String(fsyncError),
          )
        }
      }
      fs.renameSync(tmpPath, this.path)
      this.lastWriteError = null
    } catch (e) {
      this.lastWriteError = e instanceof Error ? e.message : String(e)
      try {
        fs.unlinkSync(this.path + '.tmp')
      } catch {
        /* cleanup best-effort */
      }
    }
  }
}

export type ConfigStore = any

const fallbackUserData = () => {
  const p = typeof app.getPath === 'function' ? app.getPath('userData') : undefined
  return p || path.join(os.homedir(), '.kone-config')
}

/* P0-5：登记当前活跃 store，供"需要读磁盘上的配置文件"的下游（备份、导出）
   在读取前强制 flushSync，避免防抖窗口内的变更未被写入。 */
let activeStore: NativeStore | null = null

export const getActiveConfigStore = (): { flushSync?: () => void } | null => activeStore

export const createConfigStore = (): ConfigStore => {
  const store = new NativeStore({
    name: 'kone-config',
    cwd: fallbackUserData(),
    defaults: {
      leads: [],
      auth: { verified: false },
    },
  })
  activeStore = store
  return store as ConfigStore
}

export const assertConfigWritable = (store: ConfigStore) => {
  try {
    const storePath = (store as NativeStore).path || path.join(fallbackUserData(), 'kone-config.json')
    fs.accessSync(storePath, fs.constants.W_OK)
  } catch {
    console.warn(' [Config] Store path is not writable')
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

/* D3（2026-10-19）：`cloud.*` 属高级版能力（README §六 / PRD §5.1.2：云端能力 Trial/Basic
   均不开放）。通道整体**保持免门禁**以避免激活死锁，但该命名空间必须做 **key 级**付费校验。
   仅限制写端；读端（CONFIG_GET_ALLOWED_NAMESPACES 含 'cloud'）保持不变，否则设置页回显
   已配置值时会被 403 拖垮（P0-2 历史缺陷）。 */
const isCloudNamespaceKey = (key: string): boolean => key === 'cloud' || key.startsWith('cloud.')

/* DATA-05 修复：config:get 读取命名空间白名单 — 仅允许渲染进程读取以下命名空间。
   未列入的键将被拒绝，防止 renderer 被 XSS/依赖污染后越权读取敏感配置。 */
const CONFIG_GET_ALLOWED_NAMESPACES = [
  'leads', // 线索池持久化
  'user_config', // 用户配置（已脱敏，不含密钥）
  'autopilot', // Autopilot 运行态
  'system.trialExpiresAt', // 试用过期时间（前端需展示）
  'system.machineId', // 设备识别码（前端需展示）
  /* P0-2 修复：`cloud.*` 此前**可写不可读** —— 写端黑名单
     （CONFIG_SET_BLACKLIST）不含 `cloud.` 故可写，读端白名单却不含 → 一律 403。
     后果：云端引擎配置与 IMAP 自动检测「存了读不出来」，且 CloudSettingsTab
     用 Promise.all 聚合读取，任一拒绝即整体失败 → 保存成功后再次读取失败，
     恒弹「保存失败」（实际已落盘）。
     这些 key 本就需要在设置页回显（用户要看到已配置的值），故开放读取。 */
  'cloud', // 云端引擎配置（provider / url / apiKey / workspaceId）
]

const isConfigKeyReadable = (key: string): boolean => {
  if (!key || typeof key !== 'string') return false
  // 精确匹配或命名空间前缀匹配
  return CONFIG_GET_ALLOWED_NAMESPACES.some((ns) => key === ns || key.startsWith(ns + '.'))
}

/** secret:set 写保护白名单 — 仅允许渲染进程设置这些密钥 */
const SECRET_SET_WHITELIST: Set<string> = new Set([
  SECRET_KEYS.LLM_API_KEY,
  SECRET_KEYS.GOOGLE_LEADS_API_KEY,
  SECRET_KEYS.GOOGLE_MAPS_API_KEY,
  SECRET_KEYS.DECISION_MAKER_API_KEY,
  SECRET_KEYS.ANYSEARCH_API_KEY,
  SECRET_KEYS.ANYSEARCH_BASE_URL,
  /* P0-1 修复：邮箱密码此前**不在白名单**，而渲染层「保存邮箱」会调用
     `secret:set('secrets.email.smtpPass')` → 403 → 加密槽写不进。
     更严重的是渲染层**先清空了 user_config 的明文槽**，导致密码彻底丢失、
     邮箱链路（SMTP 发信 / IMAP 回复检测）完全不可用。
     这两个 key 与 LLM API Key 同级（同样经 safeStorage 加密落 kone-secrets.json），
     渲染层必须能写 —— 否则用户在设置页根本无法配置邮箱。 */
  SECRET_KEYS.EMAIL_SMTP_PASS,
  SECRET_KEYS.EMAIL_IMAP_PASS,
  /* 2026-10-11：Apollo 富化密钥——与 LLM/Google 同级，渲染层设置页必须能写，
     否则用户无法接入高质量联系人数据源。 */
  SECRET_KEYS.APOLLO_API_KEY,
  /* 2026-10-13：Prospeo（Apollo 的低成本前置）同样必须可写，否则设置页无法配置。 */
  SECRET_KEYS.PROSPEO_API_KEY,
  /* 2026-10-17：Serper（自备密钥的可选网页来源）同样必须可写，否则设置页无法配置。 */
  SECRET_KEYS.SERPER_API_KEY,
])

interface IElectronMain extends Electron.IpcMain {
  handle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void
}

/**
 * config / secret handler 注册。
 *
 * 按 ARCH-STANDARDS §3 迁移注记，本服务（CONFIG.GET / CONFIG.SET / SECRET.SET /
 * SECRET.CHECK，共 4 个通道）作为经 `registerIpc()` 收敛到注册中心的批次：通道经由
 * `electron/ipc/registry.ts` 的 `attach(ipcMain)` 在 `registerIpcHandlers()` 末尾统一
 * 绑定，响应侧在 dev 模式做结构化信封契约校验。请求侧放宽为 any（handler 自身负责
 * null/undefined/类型校验并返回 400/403 信封，见 config.contract.ts 设计取舍）。
 * `ipcMain` 参数保留以维持 `main.ts` 调用签名一致，注册动作改由 registry 完成。
 */
/* D3（2026-10-19）：`licenseGuard` 由 main.ts 注入（唯一实例）。**通道整体仍保持免门禁**
   ——加通道级门禁会锁死 Trial 的 ICP/密钥配置（激活死锁）；仅对 `cloud.*` 命名空间做
   **key 级**校验（需 `cloud_send`）。注意：本文件与 license-service 存在循环依赖，
   故此处只用 guard（运行时对象），**不** import license-service 任何符号。 */
export const registerConfigHandlers = (
  _ipcMain: Electron.IpcMain,
  store: ConfigStore,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
) => {
  registerIpc(IPC_CHANNELS.CONFIG.GET, configGetContract, async (_event: unknown, key: unknown) => {
    try {
      // DATA-05 修复：读取白名单校验——非白名单命名空间拒绝读取
      if (!isConfigKeyReadable(key as string)) {
        console.warn(`[Config] 已拦截非白名单配置项读取: ${key}`)
        return { success: false, error: `禁止读取受保护的配置项: ${key}`, code: 403 }
      }
      return { success: true, data: getConfigValue(store, key as string) }
    } catch (error: any) {
      console.error('[Config] Get failed:', error?.message)
      return { success: false, error: error?.message || 'Config get failed', code: error?.code }
    }
  })
  registerIpc(IPC_CHANNELS.CONFIG.SET, configSetContract, async (_event: unknown, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '配置写入参数无效', code: 400 }
      }
      const { key, value } = payload as { key: string; value: unknown }
      if (typeof key !== 'string' || !key.trim()) {
        return { success: false, error: '配置项 key 无效', code: 400 }
      }
      if (isConfigKeyBlocked(key)) {
        console.warn(`[Config] 已拦截受保护配置项写入: ${key}`)
        return { success: false, error: `禁止直接修改受保护的配置项: ${key}`, code: 403 }
      }
      /* D3（2026-10-19 修复）：`cloud.*` 写入需 `cloud_send`（高级版起）。本文件与
         license-service 循环依赖，故不 import buildFeatureDeniedResponse —— 改用本文件
         既有的 `error: string` + 403 信封，并保留 `FEATURE_DENIED` 标记供渲染层统一识别
         （accounts-management / agents-panel 的 /FEATURE_DENIED|TRIAL_EXPIRED/ 正则）。 */
      if (isCloudNamespaceKey(key)) {
        try {
          licenseGuard.requireFeature('cloud_send', '云端配置写入')
        } catch (error: any) {
          return {
            success: false,
            error: `FEATURE_DENIED：云端配置写入需要高级版授权（${String(error?.message || key)}）`,
            code: Number(error?.code) || 403,
          }
        }
      }
      setConfigValue(store, key, value)
      // P0-5：用户可见的配置写入必须立即持久化，并让落盘失败同步回传给渲染层
      try {
        store.flushSync?.()
      } catch (flushError: any) {
        return { success: false, error: flushError?.message || '配置落盘失败', code: 500 }
      }
      resetCircuitBreaker()
      return { success: true, data: null }
    } catch (error: any) {
      console.error('[Config] Set failed:', error?.message)
      return { success: false, error: error?.message || 'Config set failed', code: error?.code }
    }
  })

  registerIpc(IPC_CHANNELS.SECRET.SET, secretSetContract, async (_event: unknown, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: '密钥写入参数无效', code: 400 }
      }
      const typed = payload as { key: string; value: string }
      if (typeof typed.key !== 'string' || !typed.key.trim()) {
        return { success: false, error: '密钥 key 无效', code: 400 }
      }
      if (typeof typed.value !== 'string') {
        return { success: false, error: '密钥 value 无效', code: 400 }
      }
      if (!SECRET_SET_WHITELIST.has(typed.key)) {
        console.warn(`[Secret] 已拦截非白名单密钥写入: ${typed.key}`)
        return { success: false, error: `禁止设置非白名单密钥: ${typed.key}`, code: 403 }
      }
      const result = setSecret(typed.key, typed.value)
      if (typed.key === SECRET_KEYS.ANYSEARCH_API_KEY) {
        setSecret('anysearch-api-key', typed.value)
      }
      resetCircuitBreaker()
      return { success: true, data: result }
    } catch (error: any) {
      console.error('[Secret] Set failed:', error?.message)
      return { success: false, error: error?.message || 'Secret set failed', code: error?.code }
    }
  })

  registerIpc(IPC_CHANNELS.SECRET.CHECK, secretCheckContract, async (_event: unknown, key: unknown) => {
    try {
      return { success: true, data: checkSecret(key as string) }
    } catch (error: any) {
      console.error('[Secret] Check failed:', error?.message)
      return { success: false, error: error?.message || 'Secret check failed', code: error?.code }
    }
  })
}
