import { create } from 'zustand'
import { clearFeatureRegistryCache, getFeatureRegistry, type LicensePlan } from '@/lib/feature-gate'
import { getLicenseInfo } from '@/lib/electron-api'
import type { LicenseTier } from '@/shared/ipc-contracts'

type LicenseStoreState = {
  loading: boolean
  isLicensed: boolean
  isExpired: boolean
  isTrial: boolean
  plan: LicensePlan
  tier: LicenseTier
  daysRemaining: number
  expiresAt: number
  machineId: string
  refreshLicenseStatus: (forceRefresh?: boolean) => Promise<void>
}

const getDaysRemaining = (expiresAt: number) => {
  if (!expiresAt || expiresAt <= Date.now()) {
    return 0
  }

  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
}

export const useLicenseStore = create<LicenseStoreState>((set) => ({
  loading: true,
  isLicensed: false,
  isExpired: false,
  isTrial: false,
  plan: 'trial',
  tier: 'basic',
  daysRemaining: 0,
  expiresAt: 0,
  machineId: '',
  refreshLicenseStatus: async (forceRefresh = false) => {
    set((state) => ({ ...state, loading: true }))

    try {
      if (forceRefresh) {
        clearFeatureRegistryCache()
      }

      const [license, info] = await Promise.all([getFeatureRegistry(forceRefresh), getLicenseInfo().catch(() => null)])
      const isTrial = info?.isTrial ?? false
      const isLicensed = license.status === 'active' && !isTrial
      const isExpired = license.status === 'expired'
      const tier: LicenseTier = info?.tier || (isLicensed ? 'premium' : 'basic')
      const daysLeft = info?.daysLeft ?? getDaysRemaining(license.expiresAt)

      set({
        loading: false,
        isLicensed,
        isExpired,
        isTrial,
        plan: license.plan,
        tier,
        daysRemaining: Math.ceil(daysLeft),
        expiresAt: info?.expiresAt || license.expiresAt,
        machineId: info?.machineId || '',
      })
    } catch {
      set({
        loading: false,
        isLicensed: false,
        isExpired: true,
        isTrial: false,
        plan: 'trial',
        tier: 'basic',
        daysRemaining: 0,
        expiresAt: 0,
        machineId: '',
      })
    }
  },
}))
