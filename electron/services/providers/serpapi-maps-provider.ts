import { fetchWithRetry, getDefaultSerpApiTimeoutMs } from '../proxy-service'
import {
  ProviderQuery,
  type ProviderConfig,
  type SearchProvider,
  type ProviderExecuteResult,
  type ProviderResult,
} from '../provider-registry'
import { getSerpApiCached, setSerpApiCached } from '../serpapi-cache'

const SERPAPI_RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504])
const FETCH_LIMIT = 100

interface SerpApiMapsItem {
  title?: string
  name?: string
  company?: string
  website?: string
  links?: { website?: string; phone?: string }
  link?: string
  url?: string
  phone?: string
  phoneNumber?: string
  address?: string
  location?: string
  description?: string
  snippet?: string
  reason?: string
}

const normalizeLocalResult = (item: SerpApiMapsItem) => ({
  source: 'google_maps' as const,
  company: String(item?.title || item?.name || item?.company || '').trim(),
  website: String(item?.website || item?.links?.website || item?.link || item?.url || '').trim(),
  phone: String(item?.phone || item?.links?.phone || item?.phoneNumber || '').trim(),
  address: String(item?.address || item?.location || '').trim(),
  snippet: String(item?.description || item?.address || item?.snippet || '').trim(),
  reason:
    String(item?.reason || item?.description || item?.snippet || '').trim() || 'Google Maps local business result',
})

export class SerpApiMapsProvider implements SearchProvider {
  readonly id = 'google_maps' as const
  readonly name = 'SerpApi Google Maps'
  readonly requiredConfigKeys = ['googleKey']

  supportedLanguages(): string[] {
    return ['en']
  }

  isAvailable(config?: ProviderConfig): boolean {
    return !!config?.googleKey
  }

  async execute(query: ProviderQuery): Promise<ProviderExecuteResult> {
    const { keyword, country, city, googleKey, timeoutMs, myJobId } = query
    if (!googleKey) return { results: [], error: 'SerpApi key not configured' }

    const { isKnownActiveJobId } = await import('../search-service')
    if (!isKnownActiveJobId(myJobId)) {
      return { results: [], error: `Stale job ${myJobId} — discarded by temporal isolation` }
    }

    try {
      const location = city && country ? `${city}, ${country}` : country || ''
      const locationParams = location ? `&location=${encodeURIComponent(location)}&z=12` : ''
      const results: ProviderResult[] = []

      for (let page = 0; page < 2; page++) {
        const url = `https://serpapi.com/search.json?engine=google_maps&type=search&q=${encodeURIComponent(keyword)}${locationParams}&api_key=${encodeURIComponent(googleKey)}&start=${page * 20}&num=${FETCH_LIMIT}`

        // 成本优化（P0）：缓存命中直接复用，不再消耗 SerpApi 额度。
        const cached = getSerpApiCached(url)
        if (cached !== undefined) {
          const cachedResults = Array.isArray((cached as any)?.local_results)
            ? (cached as any).local_results
            : Array.isArray((cached as any)?.local_results?.places)
              ? (cached as any).local_results.places
              : []
          results.push(...cachedResults.map(normalizeLocalResult))
          break
        }

        const response = await fetchWithRetry(url, { method: 'GET' }, getDefaultSerpApiTimeoutMs(timeoutMs || 30000), {
          retries: 2,
          shouldRetry: (res: Response | null, err: unknown) => {
            if (err) return true
            return Boolean(res && SERPAPI_RETRYABLE_STATUS.has(res.status))
          },
        })

        if (!response.ok) break
        const rawText = await response.text()
        const json = rawText ? JSON.parse(rawText) : {}
        setSerpApiCached(url, json)
        const pageResults = Array.isArray(json?.local_results)
          ? json.local_results
          : Array.isArray(json?.local_results?.places)
            ? json.local_results.places
            : []

        results.push(...pageResults.map(normalizeLocalResult))
        // 成本优化（P0）：命中即停——第一页已有结果不再翻第二页。
        if (page === 0 && pageResults.length > 0) break
        if (pageResults.length === 0 || results.length >= FETCH_LIMIT) break
      }

      return { results }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
