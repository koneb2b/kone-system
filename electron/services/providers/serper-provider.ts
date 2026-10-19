import { fetchWithRetry, getDefaultSerpApiTimeoutMs } from '../proxy-service'
import {
  ProviderQuery,
  type ProviderConfig,
  type SearchProvider,
  type ProviderExecuteResult,
  type ProviderResult,
} from '../provider-registry'

/* Serper.dev Google 网页搜索适配器（可选 BYOK 来源，独立于 SerpApi）。
   设计要点：
   - 使用独立的 `DataSourceType='serper'`，与 `google_organic` 分列，保证来源标注诚实。
   - 一次性 POST JSON（Serper 无 GET 分页语义）；按 Serper 条款**不缓存结果**。
   - **不做自动重试**（Phase 2B-Lite.1）：重试会额外消耗用户自备额度，
     fetchWithRetry 默认 retries=0 = 恰好一次请求。
   - 遵守 myJobId 时空隔离：陈旧管道任务静默丢弃。 */
const SERPER_ENDPOINT = 'https://google.serper.dev/search'

interface SerperOrganicItem {
  title?: string
  link?: string
  snippet?: string
}

const normalizeSerperResult = (item: SerperOrganicItem): ProviderResult => ({
  source: 'serper',
  company: String(item?.title || '').trim(),
  website: String(item?.link || '').trim(),
  phone: '',
  address: '',
  snippet: String(item?.snippet || '').trim(),
  reason: String(item?.snippet || '').trim(),
})

export class SerperProvider implements SearchProvider {
  readonly id = 'serper' as const
  readonly name = 'Serper (Google)'
  readonly requiredConfigKeys = ['serperApiKey']

  supportedLanguages(): string[] {
    return ['en']
  }

  isAvailable(config?: ProviderConfig): boolean {
    return !!config?.serperApiKey
  }

  async execute(query: ProviderQuery): Promise<ProviderExecuteResult> {
    const { keyword, serperApiKey, timeoutMs, myJobId } = query
    if (!serperApiKey) return { results: [], error: 'Serper key not configured' }

    const { isKnownActiveJobId } = await import('../search/job-registry')
    if (!isKnownActiveJobId(myJobId)) {
      return { results: [], error: `Stale job ${myJobId} — discarded by temporal isolation` }
    }

    try {
      /* 不自动重试（§五：单源模式不得自动重试）——重试会额外消耗用户自备额度。 */
      const response = await fetchWithRetry(
        SERPER_ENDPOINT,
        {
          method: 'POST',
          headers: { 'X-API-KEY': serperApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: keyword, num: 10 }),
        },
        getDefaultSerpApiTimeoutMs(timeoutMs || 30000),
      )

      if (!response.ok) {
        return { results: [], error: `Serper HTTP ${response.status}` }
      }

      const rawText = await response.text()
      const json = rawText ? JSON.parse(rawText) : {}
      const items: SerperOrganicItem[] = Array.isArray(json?.organic) ? json.organic : []
      return { results: items.map(normalizeSerperResult) }
    } catch (err) {
      return { results: [], error: err instanceof Error ? err.message : String(err || '') }
    }
  }
}
