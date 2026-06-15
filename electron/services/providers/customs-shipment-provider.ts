import { fetchWithRetry, getDefaultSerpApiTimeoutMs } from '../proxy-service'
import { ProviderQuery, type SearchProvider, type ProviderExecuteResult } from '../provider-registry'

const SERPAPI_RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504])
const FETCH_LIMIT = 50
const CUSTOMS_SITES = [
  'site:panjiva.com',
  'site:importgenius.com',
  'site:tradeintelligence.net',
  'site:customstoday.com.pk',
]

const extractCustomsData = (snippet: string, title: string) => {
  const text = `${title} ${snippet}`

  // Extract annual import volume/value
  const volumeMatch = text.match(/(?:annual(?:ized)?\s+)?import\s+(?:volume|value|shipment|revenue)s?\s*(?::|of|:)\s*[\$€£]?([\d,]+(?:\.\d+)?(?:\s*(?:million|billion|thousand|TEUs?|tons|kg|MT|containers?))?)/i)
    || text.match(/([\d,]+(?:\.\d+)?(?:\s*(?:million|billion|thousand|TEUs?|tons|kg|MT))?)\s*(?:\s+in\s+)?(?:annual\s+)?import(?:s|ed)?\b/i)
  const annualImportVolume = volumeMatch ? volumeMatch[0].replace(/^\s*import\s+(?:volume|value|shipment)s?\s*(?::|of)?\s*/i, '').trim() : ''

  // Extract origin countries
  const originCountries: string[] = []
  const originPatterns = [
    /(?:from|origin|exported\s+from|manufactured\s+in|sourced\s+from|shipped\s+from|imported\s+from|country\s+of\s+origin)\s+(?::|of)?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g,
    /origin(?::|of)?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g,
  ]
  const knownCountries = new Set(['china', 'usa', 'germany', 'japan', 'korea', 'india', 'brazil', 'italy', 'france', 'spain', 'uk', 'united kingdom', 'vietnam', 'thailand', 'taiwan', 'malaysia', 'indonesia', 'singapore', 'turkey', 'mexico', 'canada', 'australia', 'netherlands', 'poland', 'switzerland', 'sweden', 'belgium', 'austria', 'hong kong', 'south korea', 'saudi arabia', 'uae', 'russia'])
  for (const pattern of originPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const country = match[1].trim()
      if (country.length > 2 && knownCountries.has(country.toLowerCase())) {
        originCountries.push(country)
      }
    }
  }

  // Extract top suppliers
  const topSuppliers: string[] = []
  const supplierPatterns = [
    /(?:supplier|supplied\s+by|vendor|supply\s+from|manufactured\s+by|produced\s+by|partner)\s*(?::|of)?\s*([A-Z][A-Za-z0-9\s&.,'-]+?)(?=[,;.]|\s+(?:and|for|in|to|with|based|located))/g,
  ]
  for (const pattern of supplierPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const supplier = match[1].trim()
      if (supplier.length > 2 && !/(?:the|this|our|their|an?)\s*$/.test(supplier)) {
        topSuppliers.push(supplier)
      }
    }
  }

  // Extract last shipment date
  const dateMatch = text.match(/(?:last\s+)?ship(?:ment|ped)?\s*(?::|on|date)?\s*([A-Z][a-z]+(?:\s+\d{1,2})?[,:]?\s+\d{4})/i)
    || text.match(/(\d{4}[-/]\d{2}[-/]\d{2})/)
    || text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i)
  const lastShipmentDate = dateMatch ? dateMatch[1].trim() : ''

  return {
    annualImportVolume,
    topSuppliers: [...new Set(topSuppliers)].slice(0, 5),
    originCountries: [...new Set(originCountries)].slice(0, 5),
    lastShipmentDate,
  }
}

const normalizeCustomsResult = (item: any, sourceSite: string) => {
  const snippet = String(item?.snippet || item?.description || '').trim()
  const title = String(item?.title || item?.name || '').trim()
  return {
  source: 'customs_shipment' as const,
  company: title.replace(/\s*\|.*$/, '').replace(/ – .*$/, '').trim(),
  website: String(item?.link || item?.url || '').trim(),
  phone: String(item?.phone || '').trim(),
  address: String(item?.address || item?.location || '').trim(),
  snippet,
  reason: String(item?.reason || snippet || '').trim() || `Customs/shipment record via ${sourceSite}`,
  contact: '',
  contactTitle: '',
  customsData: extractCustomsData(snippet, title),
  }
}

export class CustomsShipmentProvider implements SearchProvider {
  readonly id = 'customs_shipment' as const
  readonly label = 'SerpApi Customs Shipment Search'

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

      for (const site of CUSTOMS_SITES) {
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
        results.push(...pageResults.map((r: any) => normalizeCustomsResult(r, site)))
      }

      return { results }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
