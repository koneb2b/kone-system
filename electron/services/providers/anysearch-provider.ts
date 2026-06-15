import { fetchWithTimeout } from '../proxy-service'
import { ProviderQuery, type SearchProvider, type ProviderExecuteResult } from '../provider-registry'
import type { DataSourceType } from '../../../src/shared/ipc-contracts'

const FETCH_LIMIT = 100

const normalizeDecisionMaker = (dm: any) => ({
  name: String(dm?.name || '').trim(),
  title: String(dm?.title || '').trim(),
  email: String(dm?.email || '').trim(),
  phone: String(dm?.phone || '').trim(),
  linkedinUrl: dm?.linkedinUrl ? String(dm.linkedinUrl).trim() : undefined,
  source: String(dm?.source || 'AnySearch').trim(),
  confidenceScore: Number.isFinite(Number(dm?.confidenceScore)) ? Math.max(0, Math.min(100, Number(dm.confidenceScore))) : 0,
})

const normalizeAnySearchResult = (item: any) => ({
  source: (['customs_shipment', 'trade_show', 'yellow_pages', 'linkedin_search', 'facebook_search', 'google_maps', 'google_organic'].includes(String(item?.dataSourceType || ''))
    ? String(item?.dataSourceType)
    : 'google_maps') as DataSourceType,
  company: String(item?.company || item?.name || item?.title || '').trim(),
  website: String(item?.website || item?.url || item?.link || '').trim(),
  phone: String(item?.phone || item?.phoneNumber || '').trim(),
  address: String(item?.address || item?.location || '').trim(),
  snippet: String(item?.snippet || item?.description || '').trim(),
  reason: String(item?.reason || item?.snippet || item?.description || '').trim(),
  exhibitionFootprints: Array.isArray(item?.exhibitionFootprints) ? item.exhibitionFootprints : undefined,
  customsData: item?.customsData ? {
    annualImportVolume: String(item.customsData.annualImportVolume || '').trim() || undefined,
    topSuppliers: Array.isArray(item.customsData.topSuppliers) ? item.customsData.topSuppliers : undefined,
    originCountries: Array.isArray(item.customsData.originCountries) ? item.customsData.originCountries : undefined,
    lastShipmentDate: String(item.customsData.lastShipmentDate || '').trim() || undefined,
  } : undefined,
  decisionMakers: Array.isArray(item?.decisionMakers) ? item.decisionMakers.map(normalizeDecisionMaker) : undefined,
  agentStatus: item?.agentStatus ? {
    whatsappSent: Boolean(item.agentStatus.whatsappSent),
    whatsappStatus: ['pending', 'delivered', 'replied', 'failed'].includes(String(item.agentStatus.whatsappStatus || ''))
      ? String(item.agentStatus.whatsappStatus) as 'pending' | 'delivered' | 'replied' | 'failed'
      : undefined,
    linkedinContacted: Boolean(item.agentStatus.linkedinContacted),
    emailSequenceStage: Number.isFinite(Number(item.agentStatus.emailSequenceStage)) ? Math.min(3, Math.max(0, Number(item.agentStatus.emailSequenceStage))) : 0,
  } : undefined,
})

export class AnySearchProvider implements SearchProvider {
  readonly id = 'anysearch' as const
  readonly label = 'AnySearch Multi-Source'

  supportedLanguages(): string[] {
    return ['en', 'multi']
  }

  async execute(query: ProviderQuery): Promise<ProviderExecuteResult> {
    const { keyword, country, city, anysearchApiKey, anysearchBaseUrl, timeoutMs, myJobId } = query
    if (!anysearchApiKey || !anysearchBaseUrl) return { results: [], error: 'AnySearch not configured' }

    const { getCurrentActiveJobId } = await import('../search-service')
    if (myJobId !== getCurrentActiveJobId()) {
      return { results: [], error: `Stale job ${myJobId} — discarded by temporal isolation` }
    }

    try {
      const endpoint = anysearchBaseUrl.replace(/\/$/, '') + '/v1/search/entity'
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${anysearchApiKey}`,
          },
          body: JSON.stringify({
            query: keyword,
            country: country || undefined,
            city: city || undefined,
            sources: ['customs', 'trade_shows', 'yellow_pages', 'linkedin', 'facebook', 'maps'],
            limit: FETCH_LIMIT,
          }),
        },
        timeoutMs || 30000
      )

      if (!response.ok) {
        const rawText = await response.text().catch(() => '')
        throw new Error(`AnySearch HTTP ${response.status}: ${rawText.substring(0, 100)}`)
      }

      const json: any = await response.json().catch(() => ({}))
      const rawResults = Array.isArray(json?.results)
        ? json.results
        : Array.isArray(json?.data?.results)
          ? json.data.results
          : Array.isArray(json?.data?.entities)
            ? json.data.entities
            : []

      return { results: rawResults.map(normalizeAnySearchResult).filter((item: any) => item.company.length > 0) }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
