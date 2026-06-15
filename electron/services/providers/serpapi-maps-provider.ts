import { fetchWithRetry, getDefaultSerpApiTimeoutMs } from '../proxy-service'
import { ProviderQuery, type SearchProvider, type ProviderExecuteResult } from '../provider-registry'

const SERPAPI_RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504])
const FETCH_LIMIT = 100

const normalizeLocalResult = (item: any) => ({
  source: 'google_maps' as const,
  company: String(item?.title || item?.name || item?.company || '').trim(),
  website: String(item?.website || item?.links?.website || item?.link || item?.url || '').trim(),
  phone: String(item?.phone || item?.links?.phone || item?.phoneNumber || '').trim(),
  address: String(item?.address || item?.location || '').trim(),
  snippet: String(item?.description || item?.address || item?.snippet || '').trim(),
  reason: String(item?.reason || item?.description || item?.snippet || '').trim() || 'Google Maps local business result',
})

export class SerpApiMapsProvider implements SearchProvider {
  readonly id = 'google_maps' as const
  readonly label = 'SerpApi Google Maps'

  supportedLanguages(): string[] {
    return ['en']
  }

  async execute(query: ProviderQuery): Promise<ProviderExecuteResult> {
    const { keyword, country, city, googleKey, timeoutMs, myJobId } = query
    if (!googleKey) return { results: [], error: 'SerpApi key not configured' }

    const { getCurrentActiveJobId } = await import('../search-service')
    if (myJobId !== getCurrentActiveJobId()) {
      return { results: [], error: `Stale job ${myJobId} — discarded by temporal isolation` }
    }

    try {
      const location = city && country ? `${city}, ${country}` : country || ''
      const locationParams = location ? `&location=${encodeURIComponent(location)}&z=12` : ''
      const results: any[] = []

      for (let page = 0; page < 2; page++) {
        const url = `https://serpapi.com/search.json?engine=google_maps&type=search&q=${encodeURIComponent(keyword)}${locationParams}&api_key=${encodeURIComponent(googleKey)}&start=${page * 20}&num=${FETCH_LIMIT}`
        const response = await fetchWithRetry(url, { method: 'GET' }, getDefaultSerpApiTimeoutMs(timeoutMs || 30000), {
          retries: 2,
          shouldRetry: (res: any, err: any) => {
            if (err) return true
            return Boolean(res && SERPAPI_RETRYABLE_STATUS.has(res.status))
          },
        })

        if (!response.ok) break
        const rawText = await response.text()
        const json = rawText ? JSON.parse(rawText) : {}
        const pageResults = Array.isArray(json?.local_results)
          ? json.local_results
          : Array.isArray(json?.local_results?.places)
            ? json.local_results.places
            : []

        results.push(...pageResults.map(normalizeLocalResult))
        if (pageResults.length === 0 || results.length >= FETCH_LIMIT) break
      }

      return { results }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
