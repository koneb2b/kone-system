import { app } from './electron-bridge'
import { execSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

const { machineIdSync } = require('node-machine-id') as { machineIdSync: (original?: boolean) => string }
import { IPC_CHANNELS, type IpcChannel } from '../ipc/channels'
import { createLicenseGuard } from '../security/license-guard'
import {
  ConfigStore,
  getDevEnterpriseClaims,
  getMachineIdOrCreate,
  getStoredLicenseClaims,
  getUserLlmApiKey as getUserLlmApiKeyFromConfig,
  SECRET_KEYS,
} from './config-service'
import { type OfflineLicenseClaims, verifyOfflineLicensePayload } from './offline-license'
import { setSecret } from './secret-manager'

export type LicenseTier = 'unregistered' | 'basic' | 'premium' | 'expired'

const ANNUAL_LICENSE_MS = 365 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const TRIAL_DURATION_DAYS = 7
const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * DAY_MS
const SYSTEM_TIME_ABNORMAL_MESSAGE = '系统环境异常，请恢复标准北京时间'
const WORLD_TIME_API_URL = 'http://worldtimeapi.org/api/timezone/Etc/UTC'
const REGISTRY_PATH = 'HKCU\\Software\\KoneAI\\LicenseAnchor'
const REGISTRY_VALUE = 'TrialBlob'
const ANCHOR_DIR_NAME = '.kone-anchor'
const ANCHOR_FILE_NAME = 'anchor.bin'
const ANCHOR_VERSION = 2
const STANDARD_TIME_CACHE_MS = 5 * 60 * 1000
// Snappy timeout: license activation and trial-anchor sync fall back to local
// Date.now() on failure, so a firewalled/offline machine must NOT block the
// activation UI for a long window. Keep this well under any UI-facing IPC budget.
const STANDARD_TIME_FETCH_TIMEOUT_MS = 2000
const TRIAL_FEATURES = [
  'search_basic',
  'search_deep',
  'analysis_basic',
  'analysis_advanced',
  'lead_export',
  'export_full',
  'local_autopilot',
] as const

type StoredLicenseClaims = {
  status: 'active' | 'expired'
  expiresAt: number
  features: string[]
  licenseKey: string
  machineId?: string
  plan?: 'trial' | 'basic' | 'premium' | 'enterprise'
}

type AnchorPayload = {
  version: number
  machineId: string
  firstTrialAt: number
  expiresAt: number
  lastCheckDate: number
  trialConsumed: boolean
  lockedReason?: 'time_rollback'
  updatedAt: number
}

type TrialState = {
  available: boolean
  active: boolean
  expired: boolean
  locked: boolean
  daysRemaining: number
  firstTrialAt: number
  expiresAt: number
  lastCheckDate: number
  machineId: string
  message?: string
}

type SecureOperationName<TArgs extends unknown[]> =
  | string
  | ((event: Electron.IpcMainInvokeEvent, ...args: TArgs) => string)

type SecureFeatureName<TArgs extends unknown[]> =
  | string
  | string[]
  | ((event: Electron.IpcMainInvokeEvent, ...args: TArgs) => string | string[])

let cachedStandardTime: { value: number; fetchedAt: number } | null = null

const getHardwareMachineId = (): string => {
  try {
    return machineIdSync()
  } catch {
    try {
      if (process.platform === 'win32') {
        const raw = execSync('wmic csproduct get uuid', { encoding: 'utf8', timeout: 5000 })
        const lines = raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !/^uuid$/i.test(line))
        const uuid = lines[0] || ''
        if (uuid && uuid !== 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF') return uuid
      } else if (process.platform === 'darwin') {
        const raw = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', timeout: 5000 })
        const match = raw.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
        if (match?.[1]) return match[1].trim()
      } else {
        const raw = execSync('cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null', {
          encoding: 'utf8',
          timeout: 5000,
        })
        if (raw.trim()) return raw.trim()
      }
    } catch {
      // ignore and fallback below
    }
  }
  return ''
}

export const getPhysicalMachineId = (store: ConfigStore): string => {
  const cached = String(store.get('system.hardwareMachineId') || '').trim()
  if (cached) return cached

  const hardwareId = getHardwareMachineId()
  if (hardwareId) {
    store.set('system.hardwareMachineId', hardwareId)
    return hardwareId
  }

  const fallback = getMachineIdOrCreate(store)
  store.set('system.hardwareMachineId', fallback)
  return fallback
}

const shouldUseProductionAnchorRoot = () => app.isPackaged || process.env.NODE_ENV === 'production'

const getAnchorUserDataRoot = () => {
  const explicitTestDir = process.env.KONE_TEST_USER_DATA_DIR?.trim()
  if (explicitTestDir) {
    return explicitTestDir
  }

  const rootDirName = shouldUseProductionAnchorRoot() ? 'KoneAI' : 'KoneAI-Dev'
  return path.join(process.env.APPDATA || app.getPath('appData'), rootDirName)
}

const shouldSkipAnchorPersistenceError = (error: unknown) => {
  const errorCode =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
          .trim()
          .toUpperCase()
      : ''
  return errorCode === 'EPERM' || errorCode === 'EACCES'
}

const logAnchorPersistenceWarning = (action: string, error: unknown) => {
  console.warn(`[License] Failed to ${action}, skipped to keep activation flow alive:`, error)
}

const getAnchorDirectory = () => path.join(getAnchorUserDataRoot(), ANCHOR_DIR_NAME)

const getAnchorFilePath = () => path.join(getAnchorDirectory(), ANCHOR_FILE_NAME)

const getAnchorKey = (machineId: string) =>
  crypto.createHash('sha256').update(`kone-anchor|${machineId}|${app.name}|v${ANCHOR_VERSION}`).digest()

const encryptAnchor = (payload: AnchorPayload): string => {
  const key = getAnchorKey(payload.machineId)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

const decryptAnchor = (blob: string, machineId: string): AnchorPayload | null => {
  try {
    const raw = Buffer.from(String(blob || '').trim(), 'base64')
    if (raw.length <= 28) return null
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const encrypted = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', getAnchorKey(machineId), iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(decrypted) as AnchorPayload
    if (!parsed?.machineId || parsed.machineId !== machineId) return null
    if (!parsed.firstTrialAt || !parsed.expiresAt) return null
    return parsed
  } catch {
    return null
  }
}

const ensureAnchorDirectory = () => {
  const dir = getAnchorDirectory()
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (error) {
    if (shouldSkipAnchorPersistenceError(error)) {
      logAnchorPersistenceWarning('create anchor directory', error)
      return ''
    }
    throw error
  }

  if (process.platform === 'win32') {
    try {
      execSync(`attrib +h "${dir}"`, { stdio: 'ignore' })
    } catch {
      // ignore
    }
  }

  return dir
}

const readFileAnchorBlob = (): string => {
  try {
    const filePath = getAnchorFilePath()
    if (!fs.existsSync(filePath)) return ''
    return fs.readFileSync(filePath, 'utf8').trim()
  } catch {
    return ''
  }
}

const writeFileAnchorBlob = (blob: string) => {
  try {
    const dir = ensureAnchorDirectory()
    if (!dir) {
      return
    }

    const filePath = getAnchorFilePath()
    fs.writeFileSync(filePath, blob, 'utf8')
    if (process.platform === 'win32') {
      try {
        execSync(`attrib +h "${filePath}"`, { stdio: 'ignore' })
      } catch {
        // ignore
      }
    }
  } catch (error) {
    if (shouldSkipAnchorPersistenceError(error)) {
      logAnchorPersistenceWarning('write file anchor', error)
      return
    }
    throw error
  }
}

const readRegistryAnchorBlob = (): string => {
  if (process.platform !== 'win32') return ''
  try {
    const raw = execSync(`reg query "${REGISTRY_PATH}" /v ${REGISTRY_VALUE}`, { encoding: 'utf8', timeout: 5000 })
    const match = raw.match(new RegExp(`${REGISTRY_VALUE}\\s+REG_\\w+\\s+(.+)$`, 'mi'))
    return match?.[1]?.trim() || ''
  } catch {
    return ''
  }
}

const writeRegistryAnchorBlob = (blob: string) => {
  if (process.platform !== 'win32') return
  try {
    execSync(`reg add "${REGISTRY_PATH}" /f /v ${REGISTRY_VALUE} /t REG_SZ /d "${blob}"`, {
      stdio: 'ignore',
      timeout: 5000,
    })
  } catch (error) {
    console.warn('[License] Failed to write registry anchor:', error)
  }
}

const mergeAnchors = (machineId: string, anchors: AnchorPayload[]): AnchorPayload | null => {
  if (anchors.length === 0) return null
  const valid = anchors.filter((anchor) => anchor.machineId === machineId)
  if (valid.length === 0) return null
  return {
    version: ANCHOR_VERSION,
    machineId,
    firstTrialAt: Math.min(...valid.map((anchor) => anchor.firstTrialAt)),
    expiresAt: Math.max(...valid.map((anchor) => anchor.expiresAt)),
    lastCheckDate: Math.max(...valid.map((anchor) => anchor.lastCheckDate || 0)),
    trialConsumed: valid.some((anchor) => anchor.trialConsumed),
    lockedReason: valid.some((anchor) => anchor.lockedReason === 'time_rollback') ? 'time_rollback' : undefined,
    updatedAt: Math.max(...valid.map((anchor) => anchor.updatedAt || 0)),
  }
}

const readAnchor = (machineId: string): AnchorPayload | null => {
  const fileAnchor = decryptAnchor(readFileAnchorBlob(), machineId)
  const registryAnchor = decryptAnchor(readRegistryAnchorBlob(), machineId)
  return mergeAnchors(machineId, [fileAnchor, registryAnchor].filter(Boolean) as AnchorPayload[])
}

const persistAnchor = (anchor: AnchorPayload) => {
  const blob = encryptAnchor(anchor)
  writeFileAnchorBlob(blob)
  writeRegistryAnchorBlob(blob)
}

const isRegressionHarnessEnabled = () => process.env.KONE_REGRESSION_TEST === '1'
const isRegressionDevHarnessEnabled = () => isRegressionHarnessEnabled() && !app.isPackaged
const getRegressionWorldTimeApiUrl = () =>
  isRegressionHarnessEnabled() ? process.env.KONE_WORLD_TIME_API_URL?.trim() || '' : ''
const shouldForceLockedForAudit = () => isRegressionHarnessEnabled() && process.env.KONE_FORCE_LOCKED === '1'

const getStandardTime = async (fallbackFloor = 0): Promise<number> => {
  if (cachedStandardTime && Date.now() - cachedStandardTime.fetchedAt < STANDARD_TIME_CACHE_MS) {
    return Math.max(cachedStandardTime.value, fallbackFloor)
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), STANDARD_TIME_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(getRegressionWorldTimeApiUrl() || WORLD_TIME_API_URL, {
        method: 'GET',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`worldtimeapi http ${response.status}`)
      }
      const payload: any = await response.json()
      const value = Number(payload?.unixtime || 0) * 1000
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('invalid world time payload')
      }
      cachedStandardTime = { value, fetchedAt: Date.now() }
      return Math.max(value, fallbackFloor)
    } finally {
      clearTimeout(timeoutId)
    }
  } catch {
    return Math.max(Date.now(), fallbackFloor)
  }
}

const buildTrialClaims = (anchor: AnchorPayload): StoredLicenseClaims => ({
  status: anchor.expiresAt > Date.now() && anchor.lockedReason !== 'time_rollback' ? 'active' : 'expired',
  expiresAt: anchor.expiresAt,
  features: [...TRIAL_FEATURES],
  licenseKey: `TRIAL-${anchor.machineId.slice(0, 12).toUpperCase()}`,
  machineId: anchor.machineId,
  plan: 'trial',
})

const persistClaims = (claims: StoredLicenseClaims) => {
  setSecret(SECRET_KEYS.LICENSE_KEY, claims.licenseKey)
  setSecret(SECRET_KEYS.LICENSE_CLAIMS, JSON.stringify(claims))
}

const restoreClaimsFromAnchor = (machineId: string): StoredLicenseClaims | null => {
  const anchor = readAnchor(machineId)
  if (!anchor || !anchor.trialConsumed) return null
  const claims = buildTrialClaims(anchor)
  persistClaims(claims)
  return claims
}

const syncTrialAnchor = async (machineId: string): Promise<TrialState> => {
  const anchor = readAnchor(machineId)
  if (!anchor || !anchor.trialConsumed) {
    return {
      available: true,
      active: false,
      expired: false,
      locked: false,
      daysRemaining: TRIAL_DURATION_DAYS,
      firstTrialAt: 0,
      expiresAt: 0,
      lastCheckDate: 0,
      machineId,
    }
  }

  if (Date.now() + 1000 < Number(anchor.lastCheckDate || 0)) {
    const lockedAnchor: AnchorPayload = {
      ...anchor,
      lockedReason: 'time_rollback',
      updatedAt: Date.now(),
    }
    persistAnchor(lockedAnchor)
    persistClaims(buildTrialClaims(lockedAnchor))
    return {
      available: false,
      active: false,
      expired: true,
      locked: true,
      daysRemaining: 0,
      firstTrialAt: lockedAnchor.firstTrialAt,
      expiresAt: lockedAnchor.expiresAt,
      lastCheckDate: lockedAnchor.lastCheckDate,
      machineId,
      message: SYSTEM_TIME_ABNORMAL_MESSAGE,
    }
  }

  const standardTime = await getStandardTime(anchor.lastCheckDate || 0)
  const nextAnchor: AnchorPayload = {
    ...anchor,
    lastCheckDate: Math.max(anchor.lastCheckDate || 0, standardTime),
    updatedAt: Date.now(),
  }
  persistAnchor(nextAnchor)
  persistClaims(buildTrialClaims(nextAnchor))

  const active = nextAnchor.expiresAt > standardTime && nextAnchor.lockedReason !== 'time_rollback'
  const daysRemaining = active ? Math.max(0, Math.ceil((nextAnchor.expiresAt - standardTime) / DAY_MS)) : 0

  return {
    available: false,
    active,
    expired: !active,
    locked: nextAnchor.lockedReason === 'time_rollback',
    daysRemaining,
    firstTrialAt: nextAnchor.firstTrialAt,
    expiresAt: nextAnchor.expiresAt,
    lastCheckDate: nextAnchor.lastCheckDate,
    machineId,
    message: nextAnchor.lockedReason === 'time_rollback' ? SYSTEM_TIME_ABNORMAL_MESSAGE : undefined,
  }
}

export const checkTrialStatus = (store: ConfigStore) => {
  const deviceId = getPhysicalMachineId(store)
  const anchor = readAnchor(deviceId)
  if (!anchor || !anchor.trialConsumed) {
    return {
      isExpired: false,
      daysRemaining: TRIAL_DURATION_DAYS,
      deviceId,
      firstActivationTimestamp: 0,
      rollbackDetected: false,
      available: true,
    }
  }

  const rollbackDetected =
    Date.now() + 1000 < Number(anchor.lastCheckDate || 0) || anchor.lockedReason === 'time_rollback'
  const isExpired = rollbackDetected || anchor.expiresAt <= Date.now()
  return {
    isExpired,
    daysRemaining: isExpired ? 0 : Math.max(0, Math.ceil((anchor.expiresAt - Date.now()) / DAY_MS)),
    deviceId,
    firstActivationTimestamp: anchor.firstTrialAt,
    rollbackDetected,
    available: false,
  }
}

const shouldBypassLicenseInDev = () => !app.isPackaged || isRegressionDevHarnessEnabled()

export const ensureTrialAccess = (
  store: ConfigStore | undefined,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  operationName: string,
) => {
  if (!store) return null

  if (shouldBypassLicenseInDev()) {
    return null
  }

  const claims = licenseGuard.getStoredClaims()
  if (claims && claims.status === 'active' && claims.expiresAt > Date.now()) {
    return null
  }

  const trialStatus = checkTrialStatus(store)
  if (!trialStatus.available && trialStatus.isExpired) {
    return {
      success: false,
      error: trialStatus.rollbackDetected ? 'SYSTEM_TIME_ABNORMAL' : 'TRIAL_EXPIRED',
      message: trialStatus.rollbackDetected
        ? SYSTEM_TIME_ABNORMAL_MESSAGE
        : `${operationName}不可用：试用期已过期，请完成授权后继续使用`,
      operationName,
      code: 403,
    }
  }

  // Fail-Closed: no active claims + trial not yet consumed (no anchor) → deny
  if (trialStatus.available) {
    return {
      success: false,
      error: 'TRIAL_EXPIRED',
      message: `${operationName}不可用：请先开启试用或完成授权`,
      operationName,
      code: 403,
    }
  }

  return null
}

const resolveOperationName = <TArgs extends unknown[]>(
  channel: IpcChannel,
  operationName: SecureOperationName<TArgs> | undefined,
  event: Electron.IpcMainInvokeEvent,
  args: TArgs,
) => {
  const resolved = typeof operationName === 'function' ? operationName(event, ...args) : operationName
  return String(resolved || channel).trim() || channel
}

const buildFeatureDeniedResponse = (operationName: string, error: { message?: string; code?: number } | undefined) => ({
  success: false,
  error: 'FEATURE_DENIED',
  message: String(error?.message || `当前授权无权执行${operationName}`),
  operationName,
  code: Number(error?.code) || 403,
})

const buildStructuredIpcErrorResponse = (operationName: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || `${operationName}失败`)
  const normalizedMessage = String(message || '').trim() || `${operationName}失败`
  const code = typeof (error as { code?: unknown })?.code === 'number' ? Number((error as { code?: number }).code) : 500

  return {
    success: false,
    error: normalizedMessage,
    operationName,
    code,
  }
}

export const registerSecureIpc = <TArgs extends unknown[], TResult>(
  ipcMain: Electron.IpcMain,
  channel: IpcChannel,
  store: ConfigStore | undefined,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  operationName?: SecureOperationName<TArgs>,
) =>
  ipcMain.handle(channel, async (event, ...args) => {
    const resolvedOperationName = resolveOperationName(channel, operationName, event, args as TArgs)
    const trialDenied = ensureTrialAccess(store, licenseGuard, resolvedOperationName)
    if (trialDenied) return trialDenied

    try {
      return await handler(event, ...(args as TArgs))
    } catch (error) {
      return buildStructuredIpcErrorResponse(resolvedOperationName, error)
    }
  })

export const registerSecureFeatureIpc = <TArgs extends unknown[], TResult>(
  ipcMain: Electron.IpcMain,
  channel: IpcChannel,
  store: ConfigStore | undefined,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  featureName: SecureFeatureName<TArgs>,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  operationName?: SecureOperationName<TArgs>,
) =>
  registerSecureIpc(
    ipcMain,
    channel,
    store,
    licenseGuard,
    async (event, ...args) => {
      const resolvedFeatureName =
        typeof featureName === 'function' ? featureName(event, ...(args as TArgs)) : featureName
      const resolvedOperationName = resolveOperationName(channel, operationName, event, args as TArgs)

      try {
        if (Array.isArray(resolvedFeatureName)) {
          licenseGuard.requireAnyFeature(resolvedFeatureName, resolvedOperationName)
        } else {
          licenseGuard.requireFeature(resolvedFeatureName, resolvedOperationName)
        }
      } catch (error: any) {
        return buildFeatureDeniedResponse(resolvedOperationName, error)
      }

      return handler(event, ...(args as TArgs))
    },
    operationName,
  )

const getInvisibleTrialLicenseState = async (store: ConfigStore) => {
  const machineId = getPhysicalMachineId(store)
  const trial = await syncTrialAnchor(machineId)
  if (!trial.active) {
    return {
      status: 'expired' as const,
      type: 'trial' as const,
      plan: 'trial' as const,
      isExpired: true,
      isLocked: trial.locked,
      message: trial.message,
      expiresAt: trial.expiresAt,
      features: [] as string[],
      machineId,
    }
  }

  return {
    status: 'active' as const,
    type: 'trial' as const,
    plan: 'trial' as const,
    isExpired: false,
    isLocked: false,
    message: trial.message,
    expiresAt: trial.expiresAt,
    features: [...TRIAL_FEATURES],
    machineId,
  }
}

export const createLicenseService = (store: ConfigStore) => {
  const isRegressionDevMode = isRegressionDevHarnessEnabled()

  const licenseGuard = createLicenseGuard({
    getStoredClaims: getStoredLicenseClaims,
    getMachineId: () => getPhysicalMachineId(store),
    getRemoteEndpoint: () => process.env.KONE_LICENSE_SERVER,
  })

  const getRegressionLicenseMode = () => process.env.KONE_TEST_LICENSE_MODE?.trim().toLowerCase() || ''

  const buildRegressionVerifyError = (mode: string) => {
    if (mode === 'missing_server')
      return { success: false, error: '授权服务未配置，请设置 KONE_LICENSE_SERVER', code: 503 }
    if (mode === 'network_error') return { success: false, error: '授权服务不可达：mock network failure', code: 502 }
    if (mode === 'invalid_key') return { success: false, error: '授权码无效：mock invalid key', code: 400 }
    if (mode === 'expired') return { success: false, error: '授权已过期', code: 403 }
    return null
  }

  const resolveLicenseTier = async (): Promise<LicenseTier> => {
    if (!app.isPackaged) return 'premium'

    const storedClaims = getStoredLicenseClaims() || restoreClaimsFromAnchor(getPhysicalMachineId(store))
    if (storedClaims?.status === 'active' && storedClaims.expiresAt > Date.now()) {
      return storedClaims.plan === 'basic' || storedClaims.plan === 'trial' ? 'basic' : 'premium'
    }

    const trial = await syncTrialAnchor(getPhysicalMachineId(store))
    if (shouldForceLockedForAudit()) return 'expired'
    if (trial.active) return 'basic'
    if (trial.expired || trial.locked) return 'expired'
    return 'unregistered'
  }

  let currentTier: LicenseTier = 'unregistered'

  const refreshTier = async () => {
    currentTier = await resolveLicenseTier()
    return currentTier
  }

  const getTier = () => currentTier
  const getUserLlmApiKey = (): string => getUserLlmApiKeyFromConfig(store)

  const activatePaidClaims = (claims: StoredLicenseClaims) => {
    persistClaims(claims)
    store.set('license.status', claims.status)
    store.set('license.expiresAt', claims.expiresAt)
  }

  const registerHandlers = (ipcMain: Electron.IpcMain, electronApp: Electron.App) => {
    const buildIpcErrorResponse = (error: unknown, fallbackMessage: string, code = 500) => ({
      success: false,
      error: String(error instanceof Error ? error.message : fallbackMessage),
      code:
        error &&
        typeof error === 'object' &&
        'code' in error &&
        Number.isFinite(Number((error as { code?: unknown }).code))
          ? Number((error as { code?: unknown }).code)
          : code,
    })

    ipcMain.handle(IPC_CHANNELS.SYSTEM.GET_DEVICE_STATUS, () => {
      try {
        const machineId = getPhysicalMachineId(store)
        return { success: true, data: { available: Boolean(machineId), machineId } }
      } catch (error) {
        return buildIpcErrorResponse(error, '读取设备状态失败')
      }
    })

    ipcMain.handle(IPC_CHANNELS.LICENSE.GET_INFO, async () => {
      try {
        const tier = await refreshTier()
        const machineId = getPhysicalMachineId(store)
        const claims = (getStoredLicenseClaims() || restoreClaimsFromAnchor(machineId)) as StoredLicenseClaims | null
        const isDev = !electronApp.isPackaged
        const isPaid = Boolean(
          claims && claims.status === 'active' && claims.expiresAt > Date.now() && claims.plan !== 'trial',
        )
        const trial = isPaid ? null : await syncTrialAnchor(machineId)

        return {
          success: true,
          data: {
            tier: shouldForceLockedForAudit() ? 'expired' : tier,
            machineId,
            isDev,
            isTrial: Boolean(trial?.active) && !shouldForceLockedForAudit(),
            isLocked: shouldForceLockedForAudit() || Boolean(trial?.locked),
            message: shouldForceLockedForAudit() ? SYSTEM_TIME_ABNORMAL_MESSAGE : trial?.message,
            daysLeft: isDev
              ? 365
              : trial?.active
                ? trial.daysRemaining
                : claims?.expiresAt
                  ? Math.max(0, Math.ceil((claims.expiresAt - Date.now()) / DAY_MS))
                  : 0,
            hasLlmApiKey: Boolean(getUserLlmApiKey()),
            plan: isDev ? 'enterprise' : trial?.active ? 'trial' : claims?.plan || 'basic',
            expiresAt: isDev
              ? Date.now() + ANNUAL_LICENSE_MS
              : trial?.active
                ? trial.expiresAt
                : Number(claims?.expiresAt || 0),
            features: isDev
              ? [...getDevEnterpriseClaims(store).features]
              : trial?.active
                ? [...TRIAL_FEATURES]
                : claims?.features || [],
          },
        }
      } catch (error) {
        return buildIpcErrorResponse(error, '读取授权信息失败')
      }
    })

    ipcMain.handle(IPC_CHANNELS.LICENSE.REQUEST_TRIAL, async () => {
      try {
        const machineId = getPhysicalMachineId(store)
        const current = await syncTrialAnchor(machineId)

        if (current.locked) {
          return {
            success: false,
            error: SYSTEM_TIME_ABNORMAL_MESSAGE,
            code: 403,
            data: { success: false, message: SYSTEM_TIME_ABNORMAL_MESSAGE },
          }
        }

        if (current.active) {
          await refreshTier()
          return {
            success: true,
            data: {
              success: true,
              tier: 'basic' as const,
              daysLeft: current.daysRemaining,
              expiresAt: current.expiresAt,
              message: '试用已恢复',
            },
          }
        }

        if (!current.available) {
          return {
            success: true,
            data: {
              success: false,
              tier: 'expired' as const,
              daysLeft: 0,
              expiresAt: current.expiresAt,
              message: '该设备已试用过，无法再次申请免费试用',
            },
          }
        }

        const standardTime = await getStandardTime()
        const anchor: AnchorPayload = {
          version: ANCHOR_VERSION,
          machineId,
          firstTrialAt: standardTime,
          expiresAt: standardTime + TRIAL_DURATION_MS,
          lastCheckDate: standardTime,
          trialConsumed: true,
          updatedAt: Date.now(),
        }
        persistAnchor(anchor)
        persistClaims(buildTrialClaims(anchor))
        store.set('license.status', 'active')
        store.set('license.expiresAt', anchor.expiresAt)
        await refreshTier()

        return {
          success: true,
          data: {
            success: true,
            tier: 'basic' as const,
            daysLeft: TRIAL_DURATION_DAYS,
            expiresAt: anchor.expiresAt,
            message: '7 天试用已开启',
          },
        }
      } catch (error) {
        return {
          ...buildIpcErrorResponse(error, '试用申请失败'),
          data: {
            success: false,
            message: String(error instanceof Error ? error.message : '试用申请失败'),
          },
        }
      }
    })

    ipcMain.handle(IPC_CHANNELS.LICENSE.SUBMIT, async (_event, payload: { licenseKey: string }) => {
      try {
        const machineId = getPhysicalMachineId(store)
        const licenseKey = String(payload?.licenseKey || '').trim()
        if (!licenseKey) return { success: false, error: '请输入激活码', code: 400 }

        const trial = await syncTrialAnchor(machineId)
        if (trial.locked) {
          return { success: false, error: SYSTEM_TIME_ABNORMAL_MESSAGE, code: 403 }
        }

        const isDevLicenseBypass = licenseKey === 'KONE-DEV-8888' && !electronApp.isPackaged
        if (isDevLicenseBypass) {
          const claims = { ...getDevEnterpriseClaims(store), licenseKey: 'KONE-DEV-8888' }
          activatePaidClaims(claims)
          await refreshTier()
          return { success: true, data: { ...claims, tier: getTier(), type: 'license' as const, isExpired: false } }
        }

        if (isRegressionDevMode) {
          const regressionError = buildRegressionVerifyError(getRegressionLicenseMode())
          if (regressionError) return regressionError
        }

        if (electronApp.isPackaged) {
          const verified = verifyOfflineLicensePayload(licenseKey, machineId) as OfflineLicenseClaims
          const finalClaims: StoredLicenseClaims = {
            ...verified,
            plan: verified.plan === 'pro' ? 'premium' : verified.plan,
            expiresAt: Number(verified.expiresAt || 0),
          }
          activatePaidClaims(finalClaims)
          await refreshTier()
          return {
            success: true,
            data: {
              tier: getTier(),
              status: finalClaims.status,
              expiresAt: finalClaims.expiresAt,
              features: finalClaims.features,
              plan: finalClaims.plan,
              type: 'license' as const,
              isExpired: finalClaims.status === 'expired' || finalClaims.expiresAt <= Date.now(),
              isTrial: false,
              machineId: finalClaims.machineId,
            },
          }
        }

        const claims = { ...getDevEnterpriseClaims(store), licenseKey }
        activatePaidClaims(claims)
        await refreshTier()
        return { success: true, data: { ...claims, tier: getTier(), type: 'license' as const, isExpired: false } }
      } catch (error) {
        const message = String(error instanceof Error ? error.message : 'License verification failed')
        if (/expired|过期/i.test(message))
          return { success: false, error: '授权已过期', code: 403, data: { message: '授权已过期' } }
        if (/device|识别码|mismatch/i.test(message))
          return {
            success: false,
            error: '当前授权与本设备不匹配，请核对设备识别码',
            code: 400,
            data: { message: '当前授权与本设备不匹配，请核对设备识别码' },
          }
        if (/required|invalid|missing|无效/i.test(message))
          return {
            success: false,
            error: '授权文件无效，请联系顾问重新生成',
            code: 400,
            data: { message: '授权文件无效，请联系顾问重新生成' },
          }
        return { ...buildIpcErrorResponse(error, message), data: { message } }
      }
    })

    ipcMain.handle(IPC_CHANNELS.LICENSE.VERIFY, async (_event, key: string) => {
      try {
        const response = await (async () => {
          const machineId = getPhysicalMachineId(store)
          const licenseKey = String(key || '').trim()
          if (!licenseKey) return { success: false, error: '请输入激活码', code: 400 }
          const isDevLicenseBypass = licenseKey === 'KONE-DEV-8888' && !electronApp.isPackaged
          if (isDevLicenseBypass) {
            const claims = { ...getDevEnterpriseClaims(store), licenseKey: 'KONE-DEV-8888' }
            activatePaidClaims(claims)
            await refreshTier()
            return { success: true, data: { ...claims, type: 'license' as const, isExpired: false, tier: getTier() } }
          }
          if (isRegressionDevMode) {
            const regressionError = buildRegressionVerifyError(getRegressionLicenseMode())
            if (regressionError) return regressionError
          }
          if (electronApp.isPackaged) {
            const verified = verifyOfflineLicensePayload(licenseKey, machineId) as OfflineLicenseClaims
            const claims: StoredLicenseClaims = {
              ...verified,
              plan: verified.plan === 'pro' ? 'premium' : verified.plan,
            }
            activatePaidClaims(claims)
            await refreshTier()
            return {
              success: true,
              data: {
                status: claims.status,
                expiresAt: claims.expiresAt,
                features: claims.features,
                plan: claims.plan,
                type: 'license' as const,
                isExpired: claims.status === 'expired' || claims.expiresAt <= Date.now(),
                machineId: claims.machineId,
                tier: getTier(),
              },
            }
          }
          const claims = { ...getDevEnterpriseClaims(store), licenseKey }
          activatePaidClaims(claims)
          await refreshTier()
          return { success: true, data: { ...claims, type: 'license' as const, isExpired: false, tier: getTier() } }
        })()
        return response
      } catch (error) {
        const message = String(error instanceof Error ? error.message : 'License verification failed')
        if (/expired|过期/i.test(message))
          return { success: false, error: '授权已过期', code: 403, data: { message: '授权已过期' } }
        if (/device|识别码|mismatch/i.test(message))
          return {
            success: false,
            error: '当前授权与本设备不匹配，请核对设备识别码',
            code: 400,
            data: { message: '当前授权与本设备不匹配，请核对设备识别码' },
          }
        if (/required|invalid|missing|无效/i.test(message))
          return {
            success: false,
            error: '授权文件无效，请联系顾问重新生成',
            code: 400,
            data: { message: '授权文件无效，请联系顾问重新生成' },
          }
        return { ...buildIpcErrorResponse(error, message), data: { message } }
      }
    })

    ipcMain.handle(IPC_CHANNELS.LICENSE.CHECK_STATUS, async () => {
      try {
        if (process.env.KONE_REGRESSION_TEST === '1') {
          const mode = getRegressionLicenseMode()
          if (mode === 'expired' || mode === 'missing_server') {
            return {
              success: true,
              data: {
                status: 'expired',
                expiresAt: 0,
                features: [],
                plan: 'trial' as const,
                type: 'trial' as const,
                isExpired: true,
                tier: 'expired' as const,
              },
            }
          }
        }

        const tier = await refreshTier()
        const machineId = getPhysicalMachineId(store)
        const claims = (getStoredLicenseClaims() || restoreClaimsFromAnchor(machineId)) as StoredLicenseClaims | null
        if (claims?.status === 'active' && claims.expiresAt > Date.now() && claims.plan !== 'trial') {
          return {
            success: true,
            data: {
              status: claims.status,
              expiresAt: claims.expiresAt,
              features: claims.features || [],
              plan: claims.plan,
              type: 'license' as const,
              isExpired: false,
              machineId: claims.machineId,
              tier,
            },
          }
        }

        if (!electronApp.isPackaged) {
          return {
            success: true,
            data: {
              ...getDevEnterpriseClaims(store),
              type: 'license' as const,
              isExpired: false,
              tier: 'premium' as const,
            },
          }
        }

        const trialState = await getInvisibleTrialLicenseState(store)
        return {
          success: true,
          data: {
            ...trialState,
            tier: trialState.isExpired
              ? checkTrialStatus(store).available
                ? ('unregistered' as const)
                : ('expired' as const)
              : ('basic' as const),
          },
        }
      } catch (error) {
        return buildIpcErrorResponse(error, '读取授权状态失败')
      }
    })
  }

  return { licenseGuard, registerHandlers, getTier, refreshTier, getUserLlmApiKey }
}
