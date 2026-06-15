import { fetchWithRetry, getDefaultSerpApiTimeoutMs } from '../proxy-service'
import { ProviderQuery, type SearchProvider, type ProviderExecuteResult } from '../provider-registry'

const SERPAPI_RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504])
const FETCH_LIMIT = 50
const TRADE_SHOW_SITES = [
  'site:10times.com',
  'site:trade-show.trade-events.com',
  'site:eventsinamerica.com',
  'site:exhibition.globalsources.com',
]

const extractExhibitionFootprints = (snippet: string, title: string): string[] => {
  const text = `${title} ${snippet}`
  const footprints: string[] = []

  // Match exhibition/trade show names with year context
  const pattern = /([A-Z][A-Za-z0-9&'\/\-]+(?:\s+[A-Z][A-Za-z0-9&'\/\-]+){1,6})\s*(\d{4})?/g
  const exhibitionKeywords = /exhibition|expo|trade\s+show|fair|conference|summit|forum|show|convention|meet|exposition/i

  let match
  while ((match = pattern.exec(text)) !== null) {
    const candidate = match[1].trim()
    const year = match[2] || ''
    // Must contain an exhibition-related keyword
    if (exhibitionKeywords.test(candidate) || exhibitionKeywords.test(text)) {
      const entry = year ? `${candidate} ${year}` : candidate
      if (entry.length > 5 && entry.split(/\s+/).length >= 2) {
        footprints.push(entry)
      }
    }
  }

  return [...new Set(footprints)].slice(0, 10)
}

const normalizeTradeShowResult = (item: any, sourceSite: string) => {
  const snippet = String(item?.snippet || item?.description || '').trim()
  const title = String(item?.title || item?.name || '').trim()
  return {
  source: 'trade_show' as const,
  company: title.replace(/\s*\|.*$/, '').replace(/ – .*$/, '').trim(),
  website: String(item?.link || item?.url || '').trim(),
  phone: String(item?.phone || '').trim(),
  address: String(item?.address || item?.location || '').trim(),
  snippet,
  reason: String(item?.reason || snippet || '').trim() || `Trade show/exhibition record via ${sourceSite}`,
  contact: '',
  contactTitle: '',
  exhibitionFootprints: extractExhibitionFootprints(snippet, title),
  }
}

export class TradeShowProvider implements SearchProvider {
  readonly id = 'trade_show' as const
  readonly label = 'SerpApi Trade Show Search'

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

      for (const site of TRADE_SHOW_SITES) {
        if (results.length >= FETCH_LIMIT) break
        const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(`${site} ${keyword}`)}&api_key=${encodeURIComponent(googleKey)}&num=10`
        const response = await fetchWithRetry(url, { method: 'GET' }, getDefaultSerpApiTimeoutMs(timeoutMs || 30000), {
          retries: 1,
          shouldRetry: (res: any, err: any) => {
            if (err) return true
            return Boolean(res && SERPAPI_RETRYABLE_STATUS.has(res.status))
          },
        })

        if (!response.ok) continue
        const rawText = await response.text()
        const json = rawText ? JSON.parse(rawText) : {}
        const pageResults = Array.isArray(json?.organic_results) ? json.organic_results : []
        results.push(...pageResults.map((r: any) => normalizeTradeShowResult(r, site)))
      }

      return { results }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
