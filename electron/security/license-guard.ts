export type LicensePlan = 'trial' | 'basic' | 'premium' | 'enterprise'

import { app } from '../services/electron-bridge'

export type StoredLicenseClaims = {
  status: 'active' | 'expired'
  expiresAt: number
  features: string[]
  licenseKey: string
  machineId?: string
  plan?: LicensePlan
}

export type LicenseGuardError = Error & { code?: number }

type GuardDeps = {
  getStoredClaims: () => StoredLicenseClaims | null
  getMachineId: () => string
  getRemoteEndpoint: () => string | undefined
}

type VerifyDeps = {
  fetchImpl: typeof fetch
}

const BASIC_FEATURES = [
  'search_basic',
  'search_deep',
  'analysis_basic',
  'analysis_advanced',
  'lead_export',
  'local_autopilot',
]
/* 试用版能力集 —— **必须**与以下两处保持一致（授权分层 SSOT 三元组）：
     1. `electron/services/license-service.ts` 的 `TRIAL_FEATURES`
     2. `src/lib/feature-gate.ts` 的 `FEATURE_ALIASES.trial`
   历史缺陷：本文件曾把 `trial` 与 `basic` 合并到同一分支，导致 Trial 获得
   全部 BASIC_FEATURES（含 local_autopilot / search_deep / analysis_advanced），
   可绕过渲染层升级墙**直连 IPC 启动付费智能体**（商业泄漏）。
   修复时只同步了上述 1、2 两处，遗漏本文件 → 主进程仍放行。
   **今后修改任一处，必须同步全部三处。** */
const TRIAL_FEATURES = ['search_basic', 'lead_export']
// `export_full`（完整导出）属付费高级能力，Basic **不含**（与 feature-gate.ts 的
// 「basic 仍无完整导出」注释一致）。此处显式列出而非仅依赖 BASIC_FEATURES 展开，
// 避免上一步从 BASIC 移除 export_full 时连带把 Premium 的该能力也删掉（回归）。
const PREMIUM_FEATURES = [...BASIC_FEATURES, 'export_full', 'cloud_send', 'team_collaboration']
const ENTERPRISE_FEATURES = ['enterprise', ...PREMIUM_FEATURES]
const EXPORT_ROW_LIMIT = 100
const DEV_MOCK_LICENSE_KEY = 'DEV-ENTERPRISE-UNLOCKED'

const getDevMockClaims = (machineId: string): StoredLicenseClaims => ({
  status: 'active',
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  features: [...ENTERPRISE_FEATURES],
  licenseKey: DEV_MOCK_LICENSE_KEY,
  machineId,
  plan: 'enterprise',
})

const shouldBypassFeatureGateInDev = () => !app.isPackaged

const createGuardError = (message: string, code: number): LicenseGuardError => {
  const error = new Error(message) as LicenseGuardError
  error.code = code
  return error
}

export const createLicenseGuard = (deps: GuardDeps) => {
  const getStoredClaims = () => {
    try {
      const claims = deps.getStoredClaims()
      if (claims) return claims
    } catch (error) {
      if (app.isPackaged) {
        throw error
      }
    }

    if (!app.isPackaged) {
      return getDevMockClaims(deps.getMachineId())
    }
    return null
  }

  const normalizeFeatureSet = (claims?: { features?: string[]; plan?: string } | null) => {
    const normalized = new Set<string>()
    const features = Array.isArray(claims?.features) ? claims.features : []

    for (const raw of features) {
      const feature = String(raw || '').trim()
      if (!feature) continue
      normalized.add(feature)
      if (feature === 'search') normalized.add('search_basic')
      if (feature === 'analysis') normalized.add('analysis_basic')
      if (feature === 'export') normalized.add('lead_export')
    }

    const plan = String(claims?.plan || '')
      .trim()
      .toLowerCase()
    if (plan === 'enterprise') {
      ENTERPRISE_FEATURES.forEach((feature) => normalized.add(feature))
    } else if (plan === 'premium' || plan === 'pro') {
      normalized.add('premium')
      PREMIUM_FEATURES.forEach((feature) => normalized.add(feature))
    } else if (plan === 'basic') {
      normalized.add('basic')
      BASIC_FEATURES.forEach((feature) => normalized.add(feature))
    } else if (plan === 'trial') {
      // Trial **不得**与 basic 合并：宪法与 kone-PRD §6.0 要求「Trial 仅展示升级引导」，
      // 授权分层必须在**主进程**强制，绝不依赖渲染层门禁。
      normalized.add('trial')
      TRIAL_FEATURES.forEach((feature) => normalized.add(feature))
    }

    return normalized
  }

  const requireActiveClaims = () => {
    const claims = getStoredClaims()
    if (!claims) {
      throw createGuardError('当前设备未激活授权，无法执行该操作', 401)
    }

    const isExpired = !claims.expiresAt || claims.expiresAt <= Date.now() || claims.status === 'expired'
    if (isExpired) {
      throw createGuardError('授权已过期，请续费后再试', 403)
    }

    return claims
  }

  const requireFeature = (featureKey: string, operationName = '当前操作') => {
    if (shouldBypassFeatureGateInDev()) {
      const claims = getStoredClaims() || getDevMockClaims(deps.getMachineId())
      return { claims, featureSet: normalizeFeatureSet(claims) }
    }

    const claims = requireActiveClaims()
    const featureSet = normalizeFeatureSet(claims)
    if (!featureSet.has(featureKey)) {
      throw createGuardError(`当前授权无权执行${operationName}`, 403)
    }
    return { claims, featureSet }
  }

  const requireAnyFeature = (featureKeys: string[], operationName: string) => {
    if (shouldBypassFeatureGateInDev()) {
      const claims = getStoredClaims() || getDevMockClaims(deps.getMachineId())
      return { claims, featureSet: normalizeFeatureSet(claims) }
    }

    const claims = requireActiveClaims()
    const featureSet = normalizeFeatureSet(claims)
    const allowed = featureKeys.some((feature) => featureSet.has(feature))
    if (!allowed) {
      throw createGuardError(`当前授权无权执行${operationName}`, 403)
    }
    return { claims, featureSet }
  }

  const enforceExportLimit = (content: string) => {
    const { featureSet } = requireAnyFeature(['lead_export', 'export_full'], '数据导出')
    const normalizedContent = String(content || '')
    if (featureSet.has('export_full')) {
      return normalizedContent
    }

    const lines = normalizedContent.split(/\r?\n/)
    const rowCount = Math.max(0, lines.filter((line) => line.trim().length > 0).length - 1)
    if (rowCount > EXPORT_ROW_LIMIT) {
      throw createGuardError(`当前授权仅支持导出前 ${EXPORT_ROW_LIMIT} 行，请升级到完整导出版`, 403)
    }

    return normalizedContent
  }

  const verifyLicenseClaims = async (licenseKey: string, verifyDeps: VerifyDeps): Promise<StoredLicenseClaims> => {
    const normalizedKey = licenseKey.trim()
    if (!normalizedKey) {
      throw new Error('License key is required')
    }

    const machineId = deps.getMachineId()
    const remoteEndpoint = deps.getRemoteEndpoint()?.trim()

    if (remoteEndpoint) {
      const response = await verifyDeps.fetchImpl(remoteEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: normalizedKey, machineId }),
      })

      const payload: any = await response.json().catch(() => ({}))

      if (!response.ok || !payload?.status || !payload?.expiresAt) {
        throw new Error(payload?.error || `License HTTP ${response.status}`)
      }

      return {
        status: payload.status === 'expired' ? 'expired' : 'active',
        expiresAt: Number(payload.expiresAt),
        features: Array.isArray(payload.features) ? payload.features.map(String) : [],
        licenseKey: normalizedKey,
        machineId,
        plan:
          payload.plan === 'enterprise' ||
          payload.plan === 'premium' ||
          payload.plan === 'pro' ||
          payload.plan === 'trial' ||
          payload.plan === 'basic'
            ? payload.plan === 'pro'
              ? 'premium'
              : payload.plan
            : undefined,
      }
    }

    if (process.env.NODE_ENV !== 'development') {
      throw createGuardError('生产环境缺少授权校验服务配置', 503)
    }

    const looksValid = /^KONE-[A-Z0-9-]{8,}$/i.test(normalizedKey) || normalizedKey.length > 12
    const expiresAt = Date.now() + (looksValid ? 30 : -1) * 24 * 60 * 60 * 1000
    return {
      status: expiresAt > Date.now() ? 'active' : 'expired',
      expiresAt,
      features: looksValid ? [...ENTERPRISE_FEATURES, 'search', 'analysis', 'export', 'dashboard'] : [],
      licenseKey: normalizedKey,
      machineId,
      plan: looksValid ? 'enterprise' : 'basic',
    }
  }

  const hasFullExport = () => {
    if (shouldBypassFeatureGateInDev()) return true
    try {
      const { featureSet } = requireAnyFeature(['export_full'], '全量导出')
      return featureSet.has('export_full')
    } catch {
      return false
    }
  }

  return {
    getStoredClaims,
    normalizeFeatureSet,
    requireActiveClaims,
    requireFeature,
    requireAnyFeature,
    enforceExportLimit,
    hasFullExport,
    verifyLicenseClaims,
  }
}
