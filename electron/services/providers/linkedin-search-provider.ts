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

interface SerpApiLinkedinItem {
  title?: string
  company?: string
  name?: string
  link?: string
  url?: string
  public_profile_url?: string
  phone?: string
  location?: string
  description?: string
  snippet?: string
  reason?: string
  position?: string
  job_title?: string
  email?: string
}

const computeConfidenceScore = (item: SerpApiLinkedinItem): number => {
  let score = 25 // base: result exists
  if (item?.name) score += 15
  if (item?.position || item?.job_title) score += 15
  if (item?.location) score += 10
  if (item?.company) score += 10
  if (item?.description || item?.snippet) score += 10 // has profile summary
  if (item?.public_profile_url || item?.link) score += 5
  if (item?.phone) score += 5
  if (item?.email) score += 5
  return Math.min(score, 100)
}

const normalizeLinkedinResult = (item: SerpApiLinkedinItem) => {
  const score = computeConfidenceScore(item)
  return {
    source: 'linkedin_search' as const,
    company: String(item?.title || item?.company || item?.name || '').trim(),
    website: String(item?.link || item?.url || item?.public_profile_url || '').trim(),
    phone: String(item?.phone || '').trim(),
    address: String(item?.location || '').trim(),
    snippet: String(item?.description || item?.snippet || '').trim(),
    reason: String(item?.reason || item?.description || '').trim() || 'LinkedIn Search result via SerpApi',
    contact: String(item?.name || '').trim(),
    contactTitle: String(item?.position || '').trim(),
    decisionMakers: item?.name
      ? [
          {
            name: String(item.name).trim(),
            title: String(item.position || item?.job_title || '').trim(),
            email: '',
            phone: String(item?.phone || '').trim(),
            linkedinUrl: String(item?.link || item?.public_profile_url || '').trim(),
            source: 'SerpApi LinkedIn' as const,
            confidenceScore: score,
          },
        ]
      : undefined,
  }
}

export class LinkedinSearchProvider implements SearchProvider {
  readonly id = 'linkedin_search' as const
  readonly name = 'SerpApi LinkedIn Search'
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
        const url = `https://serpapi.com/search.json?engine=linkedin&q=${encodeURIComponent(keyword)}&api_key=${encodeURIComponent(googleKey)}&start=${page * 10}&num=${FETCH_LIMIT}`
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
        const pageResults = Array.isArray(json?.organic_results)
          ? json.organic_results
          : Array.isArray(json?.people_results)
            ? json.people_results
            : []

        results.push(...pageResults.map(normalizeLinkedinResult))
        if (pageResults.length === 0 || results.length >= FETCH_LIMIT) break
      }

      return { results }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
