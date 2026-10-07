import { create } from 'zustand'
import { getUserConfig, updateUserConfig } from '@/lib/user-config'

export type BuyerPersona = 'distributor' | 'integrator' | 'brand_owner' | 'oem' | 'wholesaler'

export type IcpProfile = {
  targetProduct: string
  buyerPersona: BuyerPersona | ''
  coreAdvantage: string
  negativeIcp: string
}

export type LlmConfig = {
  baseUrl: string
  model: string
}

export type PersistedUserConfig = {
  providers?: Array<{ id?: string; baseUrl?: string }>
  selectedModel?: string
  icpProfile?: IcpProfile
}

type ConfigState = {
  llmConfig: LlmConfig
  icpProfile: IcpProfile
  hydrated: boolean
  setLlmConfig: (patch: Partial<LlmConfig>) => void
  setIcpProfile: (patch: Partial<IcpProfile>) => void
  hydrateFromStorage: () => Promise<void>
  persistToStorage: (override?: Partial<PersistedUserConfig>) => Promise<void>
}

const defaultLlmConfig: LlmConfig = {
  baseUrl: '',
  model: '',
}

const defaultIcpProfile: IcpProfile = {
  targetProduct: '',
  buyerPersona: '',
  coreAdvantage: '',
  negativeIcp: '',
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  llmConfig: defaultLlmConfig,
  icpProfile: defaultIcpProfile,
  hydrated: false,
  setLlmConfig: (patch) => set((state) => ({ llmConfig: { ...state.llmConfig, ...patch } })),
  setIcpProfile: (patch) => set((state) => ({ icpProfile: { ...state.icpProfile, ...patch } })),
  hydrateFromStorage: async () => {
    try {
      const raw = await getUserConfig<PersistedUserConfig>()
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const typed = raw as PersistedUserConfig
        const llm = Array.isArray(typed.providers) ? typed.providers.find((item) => item?.id === 'llm') : undefined
        const nextLlm: LlmConfig = {
          baseUrl: llm?.baseUrl?.trim() || '',
          model: typed.selectedModel?.trim() || '',
        }
        set({
          llmConfig: nextLlm,
          icpProfile: { ...defaultIcpProfile, ...(typed.icpProfile || {}) },
          hydrated: true,
        })
        return
      }
    } catch (error) {
      console.error(error)
    }
    set({ llmConfig: defaultLlmConfig, icpProfile: defaultIcpProfile, hydrated: true })
  },
  persistToStorage: async (override) => {
    try {
      const state = get()
      await updateUserConfig<PersistedUserConfig>((base) => ({
        ...base,
        icpProfile: state.icpProfile,
        ...(override || {}),
      }))
    } catch (error) {
      console.error(error)
    }
  },
}))
