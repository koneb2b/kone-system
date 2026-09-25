import { useEffect, useMemo, useState } from 'react'
import { getLicenseStatus } from '@/lib/electron-api'

export type FeatureKey =
  | 'search_basic'
  | 'search_deep'
  | 'lead_export'
  | 'export_full'
  | 'analysis_basic'
  | 'analysis_advanced'
  | 'cloud_send'
  | 'team_collaboration'
  | 'local_autopilot'

export type LicensePlan = 'trial' | 'basic' | 'premium' | 'enterprise'

type LicenseStatusLike = {
  status?: 'active' | 'expired'
  expiresAt?: number
  features?: string[]
  plan?: string
}

const ENTERPRISE_FEATURES: FeatureKey[] = [
  'search_basic',
  'search_deep',
  'lead_export',
  'export_full',
  'analysis_basic',
  'analysis_advanced',
  'local_autopilot',
  'cloud_send',
  'team_collaboration',
]

const DEV_ENTERPRISE_FALLBACK: LicenseStatusLike = {
  status: 'active',
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  features: [
    'enterprise',
    'search_basic',
    'search_deep',
    'analysis_basic',
    'analysis_advanced',
    'lead_export',
    'export_full',
    'local_autopilot',
    'cloud_send',
    'team_collaboration',
  ],
  plan: 'enterprise',
}

export type FeatureGateState = {
  loading: boolean
  status: 'active' | 'expired'
  expiresAt: number
  features: string[]
  featureSet: Set<string>
  plan: LicensePlan
  canAccess: (feature: FeatureKey | string) => boolean
  getSearchLimit: () => {
    cooldownMs: number
    maxResults: number
    allowDeepAnalysis: boolean
  }
  getExportLimit: () => {
    enabled: boolean
    maxRows: number | null
    fullExport: boolean
  }
}

const DEFAULT_STATE: FeatureGateState = {
  loading: true,
  status: 'expired',
  expiresAt: 0,
  features: [],
  featureSet: new Set<string>(),
  plan: 'trial',
  canAccess: () => false,
  getSearchLimit: () => ({ cooldownMs: 12000, maxResults: 10, allowDeepAnalysis: false }),
  getExportLimit: () => ({ enabled: false, maxRows: 0, fullExport: false }),
}

const FEATURE_ALIASES: Record<string, string[]> = {
  search: ['search_basic'],
  analysis: ['analysis_basic'],
  export: ['lead_export'],
  /* 试用版能力集（对齐 README「版本能力对照」试用列 + kone-PRD §5.1.2 套餐边界）：
     仅本地搜索与 ICP 评分（受 10 条/次、15 秒间隔限制）、本地 CSV 导出（限 100 行）。
     **不得**含 search_deep / analysis_basic / analysis_advanced / export_full——否则
     `getSearchLimit`/`getExportLimit` 的试用限额分支永不触发，试用用户将获得与付费版
     等同的完整能力（商业泄漏）。 */
  trial: ['search_basic', 'lead_export', 'local_autopilot'],
  /* basic = 付费基础版：解除搜索限额、开放 AI 分析；仍无完整导出与云端能力 */
  basic: ['search_basic', 'search_deep', 'analysis_basic', 'analysis_advanced', 'lead_export', 'local_autopilot'],
  premium: [
    'search_basic',
    'search_deep',
    'analysis_basic',
    'analysis_advanced',
    'lead_export',
    'export_full',
    'local_autopilot',
    'cloud_send',
    'team_collaboration',
  ],
  enterprise: [
    'search_basic',
    'search_deep',
    'analysis_basic',
    'analysis_advanced',
    'lead_export',
    'export_full',
    'local_autopilot',
    'cloud_send',
    'team_collaboration',
  ],
}

let cachedStatus: LicenseStatusLike | null = null
let pendingStatusPromise: Promise<LicenseStatusLike> | null = null

const normalizeFeatureSet = (features: string[] = [], plan?: string) => {
  const normalized = new Set<string>()

  for (const rawFeature of features) {
    const feature = String(rawFeature || '').trim()
    if (!feature) continue
    normalized.add(feature)
    const aliases = FEATURE_ALIASES[feature] || []
    aliases.forEach((alias) => normalized.add(alias))
  }

  const normalizedPlan = String(plan || '')
    .trim()
    .toLowerCase()
  if (normalizedPlan === 'enterprise') {
    normalized.add('enterprise')
    FEATURE_ALIASES.enterprise.forEach((alias) => normalized.add(alias))
  } else if (normalizedPlan === 'premium' || normalizedPlan === 'pro') {
    normalized.add('premium')
    FEATURE_ALIASES.premium.forEach((alias) => normalized.add(alias))
  } else if (normalizedPlan === 'basic') {
    normalized.add('basic')
    FEATURE_ALIASES.basic.forEach((alias) => normalized.add(alias))
  } else if (normalizedPlan === 'trial') {
    normalized.add('trial')
    /* 修复：此前误用 FEATURE_ALIASES.basic（实为"全部本地能力"），使试用获得 search_deep /
       analysis_* / export_full，导致试用限额与 AI 分析门禁全部失效（商业泄漏）。 */
    FEATURE_ALIASES.trial.forEach((alias) => normalized.add(alias))
  }

  return normalized
}

const derivePlan = (featureSet: Set<string>, claimedPlan?: string): LicensePlan => {
  const normalizedPlan = String(claimedPlan || '')
    .trim()
    .toLowerCase()
  if (normalizedPlan === 'enterprise' || normalizedPlan === 'trial' || normalizedPlan === 'basic') {
    return normalizedPlan
  }
  if (normalizedPlan === 'premium' || normalizedPlan === 'pro') {
    return 'premium'
  }
  if (featureSet.has('premium') || featureSet.has('cloud_send') || featureSet.has('team_collaboration')) {
    return 'premium'
  }
  if (
    featureSet.has('basic') ||
    featureSet.has('search_deep') ||
    featureSet.has('analysis_advanced') ||
    featureSet.has('export_full')
  ) {
    return 'basic'
  }
  if (featureSet.has('search_basic') || featureSet.has('analysis_basic') || featureSet.has('lead_export')) {
    return 'basic'
  }
  return 'trial'
}

const canAccessFeature = (featureSet: Set<string>, feature: FeatureKey | string) => featureSet.has(feature)

/**
 * 纯函数：由授权状态推导 feature gate 状态（含各套餐的搜索/导出限额）。
 * 导出供单测直接验证套餐边界（`tests/business-logic/feature-gate-tier.business.test.js`）。
 */
export const toFeatureGateState = (license: LicenseStatusLike | null | undefined): FeatureGateState => {
  const featureSet = normalizeFeatureSet(license?.features || [], license?.plan)
  const plan = derivePlan(featureSet, license?.plan)
  const isEnterprise = plan === 'enterprise' || featureSet.has('enterprise')
  const status =
    license?.status === 'active' && (Number(license?.expiresAt || 0) > Date.now() || isEnterprise)
      ? 'active'
      : 'expired'

  if (isEnterprise) {
    ENTERPRISE_FEATURES.forEach((feature) => featureSet.add(feature))
    featureSet.add('enterprise')
  }

  const canAccess = (feature: FeatureKey | string) => status === 'active' && canAccessFeature(featureSet, feature)

  return {
    loading: false,
    status,
    expiresAt: Number(license?.expiresAt || 0),
    features: Array.from(featureSet),
    featureSet,
    plan,
    canAccess,
    getSearchLimit: () => ({
      cooldownMs:
        canAccess('search_deep') || plan === 'enterprise' || plan === 'basic' || plan === 'premium' ? 0 : 15000,
      maxResults:
        canAccess('search_deep') || plan === 'enterprise' || plan === 'basic' || plan === 'premium' ? 100 : 10,
      allowDeepAnalysis: canAccess('search_deep') || plan === 'basic' || plan === 'premium' || plan === 'enterprise',
    }),
    getExportLimit: () => {
      if (!canAccess('lead_export')) {
        return { enabled: false, maxRows: 0, fullExport: false }
      }
      if (canAccess('export_full')) {
        return { enabled: true, maxRows: null, fullExport: true }
      }
      return { enabled: true, maxRows: 100, fullExport: false }
    },
  }
}

export const getFeatureRegistry = async (forceRefresh = false) => {
  if (import.meta.env.DEV) {
    cachedStatus = DEV_ENTERPRISE_FALLBACK
    pendingStatusPromise = null
    return toFeatureGateState(DEV_ENTERPRISE_FALLBACK)
  }

  if (!forceRefresh && cachedStatus) {
    return toFeatureGateState(cachedStatus)
  }

  if (!forceRefresh && pendingStatusPromise) {
    return toFeatureGateState(await pendingStatusPromise)
  }

  pendingStatusPromise = getLicenseStatus()
    .then((status) => {
      cachedStatus = status
      return status
    })
    .finally(() => {
      pendingStatusPromise = null
    })

  return toFeatureGateState(await pendingStatusPromise)
}

export const clearFeatureRegistryCache = () => {
  cachedStatus = null
  pendingStatusPromise = null
}

export function useFeatureGate() {
  const [gate, setGate] = useState<FeatureGateState>(DEFAULT_STATE)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      try {
        const next = await getFeatureRegistry()
        if (mounted) {
          setGate(next)
        }
      } catch {
        if (mounted) {
          setGate({ ...DEFAULT_STATE, loading: false })
        }
      }
    }

    void load()

    return () => {
      mounted = false
    }
  }, [])

  return useMemo(() => gate, [gate])
}
