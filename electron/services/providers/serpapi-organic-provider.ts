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

interface SerpApiOrganicItem {
  title?: string
  name?: string
  company?: string
  website?: string
  url?: string
  link?: string
  phone?: string
  phoneNumber?: string
  address?: string
  location?: string
  snippet?: string
  summary?: string
  description?: string
  reason?: string
}

const normalizeOrganicResult = (item: SerpApiOrganicItem) => ({
  source: 'google_organic' as const,
  company: String(item?.company || item?.name || item?.title || '').trim(),
  website: String(item?.website || item?.url || item?.link || '').trim(),
  phone: String(item?.phone || item?.phoneNumber || '').trim(),
  address: String(item?.address || item?.location || item?.snippet || '').trim(),
  snippet: String(item?.snippet || item?.summary || item?.description || '').trim(),
  reason: String(item?.reason || item?.snippet || '').trim(),
})

export class SerpApiOrganicProvider implements SearchProvider {
  readonly id = 'google_organic' as const
  readonly name = 'SerpApi Google Organic'
  readonly requiredConfigKeys = ['googleKey']

  supportedLanguages(): string[] {
    return ['en']
  }

  isAvailable(config?: ProviderConfig): boolean {
    return !!config?.googleKey
  }

  async execute(query: ProviderQuery): Promise<ProviderExecuteResult> {
    const { keyword, googleKey, timeoutMs, myJobId } = query
    if (!googleKey) return { results: [], error: 'SerpApi key not configured' }

    const { isKnownActiveJobId } = await import('../search-service')
    if (!isKnownActiveJobId(myJobId)) {
      return { results: [], error: `Stale job ${myJobId} — discarded by temporal isolation` }
    }

    try {
      const results: ProviderResult[] = []

      for (let page = 0; page < 2; page++) {
        const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${encodeURIComponent(googleKey)}&start=${page * 10}&num=10`

        // 成本优化（P0）：缓存命中直接复用，不再消耗 SerpApi 额度。
        const cached = getSerpApiCached(url)
        if (cached !== undefined) {
          const cachedResults = Array.isArray((cached as any)?.organic_results) ? (cached as any).organic_results : []
          results.push(...cachedResults.map(normalizeOrganicResult))
          break
        }

        const response = await fetchWithRetry(url, { method: 'GET' }, getDefaultSerpApiTimeoutMs(timeoutMs || 30000), {
          retries: 2,
          shouldRetry: (_res: Response | null, _err: unknown) => {
            if (_err) return true
            return Boolean(_res && SERPAPI_RETRYABLE_STATUS.has(_res.status))
          },
        })

        if (!response.ok) break
        const rawText = await response.text()
        const json = rawText ? JSON.parse(rawText) : {}
        setSerpApiCached(url, json)
        const pageResults = Array.isArray(json?.organic_results) ? json.organic_results : []

        results.push(...pageResults.map(normalizeOrganicResult))
        // 成本优化（P0）：命中即停——第一页已有结果不再翻第二页。
        if (page === 0 && pageResults.length > 0) break
        if (pageResults.length === 0) break
      }

      return { results }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
