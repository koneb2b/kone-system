import { fetchWithRetry, getDefaultSerpApiTimeoutMs } from '../proxy-service'
import {
  ProviderQuery,
  type ProviderConfig,
  type SearchProvider,
  type ProviderExecuteResult,
  type ProviderResult,
} from '../provider-registry'

const SERPAPI_RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504])
const FETCH_LIMIT = 50

interface SerpApiFacebookItem {
  title?: string
  name?: string
  page_name?: string
  link?: string
  url?: string
  phone?: string
  address?: string
  location?: string
  snippet?: string
  description?: string
  about?: string
}

const normalizeFacebookResult = (item: SerpApiFacebookItem) => ({
  source: 'facebook_search' as const,
  company: String(item?.title || item?.name || item?.page_name || '').trim(),
  website: String(item?.link || item?.url || '').trim(),
  phone: String(item?.phone || '').trim(),
  address: String(item?.address || item?.location || '').trim(),
  snippet: String(item?.snippet || item?.description || item?.about || '').trim(),
  reason: String(item?.snippet || item?.description || '').trim() || 'Facebook Search result via SerpApi',
  contact: '',
  contactTitle: '',
})

export class FacebookSearchProvider implements SearchProvider {
  readonly id = 'facebook_search' as const
  readonly name = 'SerpApi Facebook Search'
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
        // Use SerpApi Facebook search engine
        const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(`site:facebook.com ${keyword}`)}&api_key=${encodeURIComponent(googleKey)}&start=${page * 10}&num=${FETCH_LIMIT}`
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
        const pageResults = Array.isArray(json?.organic_results) ? json.organic_results : []

        results.push(...pageResults.map(normalizeFacebookResult))
        if (pageResults.length === 0 || results.length >= FETCH_LIMIT) break
      }

      return { results }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
