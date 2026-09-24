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
const FETCH_LIMIT = 50
/** 成本优化（P0）：命中即停阈值——单站点拿到 ≥ 该数量结果即视为命中，不再请求后续站点 */
const SITE_HIT_STOP_THRESHOLD = 3
const TRADE_SHOW_SITES = [
  'site:10times.com',
  'site:trade-show.trade-events.com',
  'site:eventsinamerica.com',
  'site:exhibition.globalsources.com',
]

interface SerpApiOrganicItem {
  title?: string
  name?: string
  link?: string
  url?: string
  phone?: string
  address?: string
  location?: string
  snippet?: string
  description?: string
  reason?: string
}

const extractExhibitionFootprints = (snippet: string, title: string): string[] => {
  const text = `${title} ${snippet}`
  const footprints: string[] = []

  // Match exhibition/trade show names with year context
  const pattern = /([A-Z][A-Za-z0-9&'/-]+(?:\s+[A-Z][A-Za-z0-9&'/-]+){1,6})\s*(\d{4})?/g
  const exhibitionKeywords =
    /exhibition|expo|trade\s+show|fair|conference|summit|forum|show|convention|meet|exposition/i

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

const normalizeTradeShowResult = (item: SerpApiOrganicItem, sourceSite: string) => {
  const snippet = String(item?.snippet || item?.description || '').trim()
  const title = String(item?.title || item?.name || '').trim()
  return {
    source: 'trade_show' as const,
    company: title
      .replace(/\s*\|.*$/, '')
      .replace(/ – .*$/, '')
      .trim(),
    website: String(item?.link || item?.url || '').trim(),
    phone: String(item?.phone || '').trim(),
    address: String(item?.address || item?.location || '').trim(),
    snippet,
    reason: String(item?.reason || snippet || '').trim() || `Trade show/exhibition record via ${sourceSite}`,
    contact: '',
    contactTitle: '',
    exhibitionFootprints: extractExhibitionFootprints(snippet, title),
    dataSourceNote: '基于 SerpApi 网页搜索的近似展会数据，来源为公开展会目录网站（非官方展会名录接口），仅供参考。',
  }
}

export class TradeShowProvider implements SearchProvider {
  readonly id = 'trade_show' as const
  readonly name = 'SerpApi Trade Show Search'
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

    const { isKnownActiveJobId } = await import('../search/job-registry')
    if (!isKnownActiveJobId(myJobId)) {
      return { results: [], error: `Stale job ${myJobId} — discarded by temporal isolation` }
    }

    try {
      const results: ProviderResult[] = []

      for (const site of TRADE_SHOW_SITES) {
        if (results.length >= FETCH_LIMIT) break
        const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(`${site} ${keyword}`)}&api_key=${encodeURIComponent(googleKey)}&num=10`

        // 成本优化（P0）：缓存命中直接复用，不再消耗 SerpApi 额度。
        const cached = getSerpApiCached(url)
        if (cached !== undefined) {
          const cachedResults = Array.isArray((cached as any)?.organic_results) ? (cached as any).organic_results : []
          results.push(...cachedResults.map((r: SerpApiOrganicItem) => normalizeTradeShowResult(r, site)))
          if (results.length >= SITE_HIT_STOP_THRESHOLD) break
          continue
        }

        const response = await fetchWithRetry(url, { method: 'GET' }, getDefaultSerpApiTimeoutMs(timeoutMs || 30000), {
          retries: 1,
          shouldRetry: (res: Response | null, err: unknown) => {
            if (err) return true
            return Boolean(res && SERPAPI_RETRYABLE_STATUS.has(res.status))
          },
        })

        if (!response.ok) continue
        const rawText = await response.text()
        const json = rawText ? JSON.parse(rawText) : {}
        setSerpApiCached(url, json)
        const pageResults = Array.isArray(json?.organic_results) ? json.organic_results : []
        results.push(...pageResults.map((r: SerpApiOrganicItem) => normalizeTradeShowResult(r, site)))
        // 成本优化（P0）：命中即停——某站点已有足量结果即不再请求剩余站点，
        // 站点调用从 4 次收敛为通常 1~2 次。
        if (results.length >= SITE_HIT_STOP_THRESHOLD) break
      }

      return { results }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
