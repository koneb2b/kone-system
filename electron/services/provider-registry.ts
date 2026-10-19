import type { DataSourceType } from '../../src/shared/ipc-contracts'

export type ProviderQuery = {
  keyword: string
  language: string
  country: string
  city: string
  intentProducts: string[]
  b2bAttributes: string[]
  myJobId: string
  googleKey?: string
  googleBaseUrl?: string
  anysearchApiKey?: string
  anysearchBaseUrl?: string
  /* 2026-10-17：Serper（可选 BYOK Google 网页来源）密钥——独立槽，不回退 SerpApi。 */
  serperApiKey?: string
  timeoutMs?: number
}

export type ProviderResult = {
  source: DataSourceType
  company: string
  website: string
  phone: string
  address: string
  contact?: string
  contactTitle?: string
  email?: string
  snippet?: string
  reason?: string
  dataSourceNote?: string
  isB2B?: boolean | null
  matchScore?: number | null
  decisionMakers?: Array<{
    name: string
    title: string
    email: string
    phone: string
    linkedinUrl?: string
    source: string
    confidenceScore: number
  }>
  customsData?: {
    annualImportVolume?: string
    topSuppliers?: string[]
    originCountries?: string[]
    lastShipmentDate?: string
  }
  exhibitionFootprints?: string[]
  agentStatus?: {
    whatsappSent: boolean
    whatsappStatus?: 'pending' | 'delivered' | 'replied' | 'failed'
    linkedinContacted: boolean
    emailSequenceStage: 0 | 1 | 2 | 3
  }
}

export type ProviderExecuteResult = {
  results: ProviderResult[]
  error?: string
}

export type ProviderConfig = {
  googleKey?: string
  anysearchApiKey?: string
  anysearchBaseUrl?: string
  serperApiKey?: string
}

export interface SearchProvider {
  readonly id: DataSourceType
  readonly name: string
  readonly requiredConfigKeys: string[]
  supportedLanguages(): string[]
  execute(query: ProviderQuery): Promise<ProviderExecuteResult>
  isAvailable(config?: ProviderConfig): boolean
}

export class ProviderRegistry {
  private providers = new Map<DataSourceType, SearchProvider>()

  register(provider: SearchProvider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: DataSourceType): SearchProvider | undefined {
    return this.providers.get(id)
  }

  getAll(): SearchProvider[] {
    return Array.from(this.providers.values())
  }

  getAvailableForLanguage(language: string): SearchProvider[] {
    return this.getAll().filter((p) => p.supportedLanguages().includes(language))
  }

  getAvailableProviders(config?: ProviderConfig): SearchProvider[] {
    return this.getAll().filter((p) => p.isAvailable(config))
  }

  getProviderStatusList(
    config?: ProviderConfig,
  ): Array<{ id: DataSourceType; name: string; available: boolean; requiredConfig: string[] }> {
    return this.getAll().map((p) => ({
      id: p.id,
      name: p.name,
      available: p.isAvailable(config),
      requiredConfig: p.requiredConfigKeys,
    }))
  }

  async executeAll(query: ProviderQuery, ids?: DataSourceType[]): Promise<Map<DataSourceType, ProviderExecuteResult>> {
    const config: ProviderConfig = {
      googleKey: query.googleKey,
      anysearchApiKey: query.anysearchApiKey,
      anysearchBaseUrl: query.anysearchBaseUrl,
      serperApiKey: query.serperApiKey,
    }
    const targets = (
      ids ? (ids.map((id) => this.providers.get(id)).filter(Boolean) as SearchProvider[]) : this.getAll()
    ).filter((p) => p.isAvailable(config))

    if (targets.length === 0) {
      return new Map()
    }

    const results = await Promise.allSettled(
      targets.map((provider) =>
        provider
          .execute(query)
          .then((r): { id: DataSourceType; result: ProviderExecuteResult } => ({ id: provider.id, result: r }))
          .catch((err): { id: DataSourceType; result: ProviderExecuteResult } => ({
            id: provider.id,
            result: { results: [] as ProviderResult[], error: err instanceof Error ? err.message : String(err || '') },
          })),
      ),
    )

    const map = new Map<DataSourceType, ProviderExecuteResult>()
    for (const settled of results) {
      const entry: { id: DataSourceType; result: ProviderExecuteResult } =
        settled.status === 'fulfilled'
          ? settled.value
          : { id: 'unknown' as DataSourceType, result: { results: [], error: 'Provider execution crashed' } }
      if (!map.has(entry.id)) {
        map.set(entry.id, entry.result)
      }
    }
    return map
  }

  async executeOne(id: DataSourceType, query: ProviderQuery): Promise<ProviderExecuteResult> {
    const provider = this.providers.get(id)
    if (!provider) return { results: [], error: `Provider ${id} not registered` }
    try {
      return await provider.execute(query)
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
