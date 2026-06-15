import { fetchWithRetry, getDefaultSerpApiTimeoutMs } from '../proxy-service'
import { ProviderQuery, type SearchProvider, type ProviderExecuteResult } from '../provider-registry'

const SERPAPI_RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504])

const normalizeOrganicResult = (item: any) => ({
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
  readonly label = 'SerpApi Google Organic'

  supportedLanguages(): string[] {
    return ['en']
  }

  async execute(query: ProviderQuery): Promise<ProviderExecuteResult> {
    const { keyword, googleKey, timeoutMs, myJobId } = query
    if (!googleKey) return { results: [], error: 'SerpApi key not configured' }

    const { getCurrentActiveJobId } = await import('../search-service')
    if (myJobId !== getCurrentActiveJobId()) {
      return { results: [], error: `Stale job ${myJobId} — discarded by temporal isolation` }
    }

    try {
      const results: any[] = []

      for (let page = 0; page < 2; page++) {
        const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${encodeURIComponent(googleKey)}&start=${page * 10}&num=10`
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
        const pageResults = Array.isArray(json?.organic_results) ? json.organic_results : []

        results.push(...pageResults.map(normalizeOrganicResult))
        if (pageResults.length === 0) break
      }

      return { results }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
