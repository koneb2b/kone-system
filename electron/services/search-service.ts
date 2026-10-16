import * as crypto from 'crypto'
import { IPC_CHANNELS } from '../ipc/channels'
import type { DataSourceType, DecisionMaker } from '../../src/shared/ipc-contracts'
import { validateDecisionMakerContacts } from '../utils/contact-validation'
import { classifyPhoneKind, type PhoneKind } from '../utils/contact-validation'
import { resolveCountryCode } from '../../src/lib/country-code'
/* 联系方式来源与可信度（三档）—— 双端 SSOT */
import {
  pickContactWithProvenance,
  type ContactFieldProvenance,
  type ContactProvenance,
  type ContactTier,
} from '../../src/shared/contact-provenance'
/* 用户「相关 / 不相关」反馈闭环（S4c）—— 本地、零成本，让匹配精度**越用越准** */
import { applyFeedbackAdjustment, deriveFeedbackKey, type LeadFeedbackMap } from '../../src/shared/lead-feedback'
import {
  enrichFromApollo,
  getUserApolloApiKey,
  APOLLO_VERIFIED_EMAIL_STATUS,
  type ApolloEnrichResult,
} from './search/enrich-apollo'
import {
  enrichFromProspeo,
  getUserProspeoApiKey,
  PROSPEO_VERIFIED_EMAIL_STATUS,
  type ProspeoEnrichResult,
} from './search/enrich-prospeo'
/* Step 3（2026-10-16 数据链路审计）：补全调用账本 + 字段级去重缓存 */
import { recordEnrichmentCall, type RecordEnrichmentCallInput } from './search/enrichment-ledger'
import { buildEnrichmentCacheKey, getEnrichmentCached, setEnrichmentCached } from './search/enrichment-cache'
import {
  resolveEnrichmentOptions,
  summarizeEnrichmentCalls,
  type EnrichmentCallRecord,
} from '../../src/shared/enrichment-cost'
import { isCircuitBreakerOpenError, resetCircuitBreaker } from '../utils/http-client'
import {
  ConfigStore,
  DEFAULT_SEARCH_TIMEOUT_MS,
  getGoogleConfig,
  getPublicUserConfig,
  getUserLlmApiKey,
  SECRET_KEYS,
} from './config-service'
import { createLicenseService, registerSecureFeatureIpc } from './license-service'
import {
  buildLlmEndpoint,
  buildSearchEndpoint,
  fetchWithRetry,
  fetchWithTimeout,
  getDefaultSerpApiTimeoutMs,
  isTimeoutError,
} from './proxy-service'
import { getSecret } from './secret-manager'
import { buildAgentTaskQueue, withPipelineIsolation } from './agent-pipeline'
import { stageAgentsFromPipeline } from './agent-service'
import { getOrCreateProviderRegistry } from './provider-service'
import type { ProviderQuery, ProviderResult } from './provider-registry'
import { getSerpApiCached, setSerpApiCached } from './serpapi-cache'
import { buildLlmScoreCacheKey, getLlmScoreCached, setLlmScoreCached } from './llm-score-cache'
/* O1 拆分（P1）：纯文本/URL 工具已抽出至 ./search/text-utils，行为不变 */
import {
  extractDomainFromUrl,
  extractEmailsFromText,
  extractJsonObjectFromText,
  extractLocationTerms,
  extractPhonesFromText,
  getHostFromUrl,
  mergePromptParts,
  mergeUniqueValues,
  normalizeGeoText,
  normalizeWebsiteUrl,
  sanitizePlainText,
} from './search/text-utils'
/* 官网联系方式提取（纯函数）：真实 UA / 扩展联系页路径 / JSON-LD 解析。
   目的：提升**免费**邮箱/电话命中率，降低对付费富化（Apollo）的依赖。 */
import {
  WEBSITE_PROBE_USER_AGENT,
  CONTACT_PAGE_FETCH_LIMIT,
  buildContactPageUrls,
  decodeContactHrefValue,
  extractContactLinksFromHtml,
  extractLabelledMobileNumbers,
  extractWhatsAppNumbers,
  parseJsonLdContacts,
} from './search/contact-extract'
/* O1 拆分（P2/P3/P4/P7b）：词表/常量/并发/意图已抽出至 ./search/*，行为不变 */
import {
  MAX_SEARCH_CANDIDATES,
  MAX_WEBSITE_TEXT_FOR_LLM,
  SEARCH_CHANNEL_FETCH_LIMIT,
  SEARCH_ENRICH_CONCURRENCY,
  SEARCH_FANOUT_CONCURRENCY,
  SEARCH_LLM_CONCURRENCY,
  SEARCH_LLM_SCORE_LIMIT,
  SEARCH_LLM_TIMEOUT_MS,
  SEARCH_PRODUCT_TERM_LIMIT,
  SEARCH_TARGETED_LEAD_LIMIT,
  SEARCH_VARIANT_LIMIT,
  SERPAPI_RETRYABLE_STATUS,
  WEBSITE_PROBE_TIMEOUT_MS,
  ENRICH_LOOKUP_BUDGET,
  PROSPEO_EMAIL_BUDGET,
  PROSPEO_MOBILE_BUDGET,
} from './search/constants'
import { mapLimitedConcurrency, runLimitedConcurrency } from './search/concurrency'
/* O1 拆分（P3）：Scout 预筛/准入逻辑已抽出至 ./search/scout，行为不变 */
import {
  computeEligibilityVeto,
  computeScoutRelevance,
  extractKeywordAnchors,
  isTrashLead,
  matchesProductTerm,
} from './search/scout'
/* 保留公开导出面：测试经编译产物访问 searchService.computeEligibilityVeto / .matchesProductTerm */
export { computeEligibilityVeto, matchesProductTerm }
/* O1 拆分（P4）：意图/语言解析已抽出至 ./search/intent，行为不变 */
import {
  buildIntentMutationPrompt,
  COUNTRY_LANGUAGE_MAP,
  crossProductB2BKeywords,
  fallbackMutateB2BKeywords,
  LANGUAGE_LABELS,
  normalizeIntentCountry,
  parseIntentMutation,
  resolveEmailLanguage,
  sanitizeProductTerms,
  type SearchIntentMutation,
} from './search/intent'
/* 保留公开导出面：LANGUAGE_LABELS 原为导出符号 */
export { LANGUAGE_LABELS }
/* O1 拆分（P5）：评分基元与评分提示词已抽出至 ./search/scoring，行为不变 */
import {
  applyNegativeIcpPenalty,
  applySchemaDefaults,
  buildSearchScoringPrompt,
  buildUniversalIcpPrompt,
  computeIcpMatchScore,
  mapHttpError,
  normalizeOpportunityRationale,
  normalizeOpportunityScore,
  OPPORTUNITY_RATIONALE_MAX_LEN,
  rankByMatchScore,
} from './search/scoring'
/* O1 拆分（P5）：本地 SearchExecuteResult / OpportunityScore 类型已抽出至 ./search/types */
import type { OpportunityScore, SearchExecuteResult } from './search/types'
/* 保留公开导出面：computeIcpMatchScore / normalizeOpportunityScore / buildSearchScoringPrompt / OpportunityScore 原为导出符号
   S4b（2026-10-16）：新增 normalizeOpportunityRationale / OPPORTUNITY_RATIONALE_MAX_LEN 供守护测试直接断言。 */
export {
  buildSearchScoringPrompt,
  computeIcpMatchScore,
  normalizeOpportunityRationale,
  normalizeOpportunityScore,
  OPPORTUNITY_RATIONALE_MAX_LEN,
  type OpportunityScore,
}
/* O1 拆分（P6）：日志探针与 LLM 结果抽取/合并已抽出至 ./search/*，行为不变 */
import { probeError, probeLlmCrash, probeLlmRequest, probeLog } from './search/probe'
export { verifyLlmProbeFailure } from './search/probe'
import { extractLlmResults, mergeLlmResultsWithCandidates } from './search/llm-results'
/* O1 拆分（P7a）：深度分析/回复教练/知识库选取已抽出至 ./search/analysis，行为不变 */
import {
  buildAnalysisErrorResponse,
  buildAnalysisPrompt,
  buildDevMockAnalysisData,
  buildReplyCoachPrompt,
  getAnalysisConfigError,
  getAnalysisFailureSemantic,
  parseReplyCoachResponse,
  parseStructuredAnalysisResponse,
  pickRelevantKnowledgeEntries,
  shouldUseDevMockAnalysis,
} from './search/analysis'
/* 保留公开导出面：parseStructuredAnalysisResponse 原为导出符号 */
export { parseStructuredAnalysisResponse }
/* O1 拆分（P8）：活跃作业注册表已抽出至 ./search/job-registry（解 Provider 循环依赖），行为不变 */
import { getActiveJobIdFor, registerActiveJob } from './search/job-registry'
/* 保留公开导出面：getCurrentActiveJobId / isKnownActiveJobId 原为导出符号 */
export { getCurrentActiveJobId, isKnownActiveJobId } from './search/job-registry'

type SearchExecutePayload = {
  keyword: string
  country?: string
  city?: string
  dataSourceType?: DataSourceType
  filterOptions?: {
    priorityWebsite?: boolean
    localDomainOnly?: boolean
    highRelevanceOnly?: boolean
    b2bRoleOnly?: boolean
  }
  /* Step 2E：分级补全的用户授权开关（与 src/shared/ipc-contracts.ts 的 SearchExecuteRequest 对齐） */
  enrichment?: {
    email?: boolean
    mobile?: boolean
  }
}

const COUNTRY_TLD_MAP: Record<string, string[]> = {
  germany: ['.de'],
  france: ['.fr'],
  italy: ['.it'],
  spain: ['.es'],
  netherlands: ['.nl'],
  belgium: ['.be'],
  poland: ['.pl'],
  portugal: ['.pt'],
  austria: ['.at'],
  switzerland: ['.ch'],
  uk: ['.uk', '.co.uk'],
  'united kingdom': ['.uk', '.co.uk'],
  usa: ['.us', '.com'],
  'united states': ['.us', '.com'],
  canada: ['.ca'],
  australia: ['.au'],
}

const emitBasicResults = (
  sender: Electron.WebContents,
  candidates: Array<Partial<SearchExecuteResult>>,
  preserveScore = false,
) => {
  sender.send(
    IPC_CHANNELS.SEARCH.BASIC_RESULTS,
    candidates.map((item) => applySchemaDefaults(preserveScore ? item : { ...item, matchScore: undefined })),
  )
}

const emitStreamStart = (sender: Electron.WebContents, total: number) => {
  sender.send(IPC_CHANNELS.SEARCH.STREAM_START, total)
}

const emitStage = (
  sender: Electron.WebContents,
  stage:
    | 'anysearch'
    | 'fetching'
    | 'normalizing'
    | 'prefiltering'
    | 'scoring'
    | 'blind_scoring'
    | 'enriching'
    | 'complete'
    | 'localized_search',
  message: string,
  searchMode?: 'anysearch' | 'maps' | 'maps-keyword-fallback' | 'organic-fallback',
  extra?: Record<string, unknown>,
) => {
  sender.send(IPC_CHANNELS.SEARCH.STAGE, { stage, message, searchMode, ...extra })
}

const emitLeadScored = (
  sender: Electron.WebContents,
  lead: Partial<SearchExecuteResult>,
  completedCount: number,
  totalCount: number,
) => {
  sender.send(IPC_CHANNELS.SEARCH.LEAD_SCORED, {
    candidate: applySchemaDefaults(lead),
    completedCount,
    totalCount,
  })
}

const emitStreamComplete = (sender: Electron.WebContents) => {
  sender.send(IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
}

const emitStreamError = (sender: Electron.WebContents, error: string) => {
  sender.send(IPC_CHANNELS.SEARCH.STREAM_ERROR, error)
  sender.send(IPC_CHANNELS.SEARCH.STREAM_COMPLETE)
}

const getLatestUserConfigSnapshot = (store: ConfigStore) => getPublicUserConfig(store) as any

export const fetchSerpApiWithRetry = (url: string, timeoutMs: number) =>
  fetchWithRetry(url, { method: 'GET' }, getDefaultSerpApiTimeoutMs(timeoutMs), {
    retries: 2,
    shouldRetry: (response, error) => {
      if (error) return true
      return Boolean(response && SERPAPI_RETRYABLE_STATUS.has(response.status))
    },
  })

const isSerpApiUnsupportedLocationError = (status: number, rawText: string) => {
  if (status !== 400) return false

  const normalized = String(rawText || '').toLowerCase()
  return normalized.includes('unsupported') && normalized.includes('location')
}

const getFriendlySerpApiError = (status: number, rawText: string) => {
  if (isSerpApiUnsupportedLocationError(status, rawText)) {
    return '目标地区识别失败，请尝试输入标准国家或城市全称（例如：United States）。'
  }

  return `SerpApi HTTP ${status}: ${rawText.substring(0, 100)}`
}

export const normalizeOrganicCandidate = (item: any) => ({
  company: String(item?.company || item?.name || item?.title || '').trim(),
  website: String(item?.website || item?.url || item?.link || '').trim(),
  phone: String(item?.phone || item?.phoneNumber || '').trim(),
  address: String(item?.address || item?.location || item?.snippet || '').trim(),
  source: String(item?.source || '').trim() || 'Google Organic',
  reason: String(item?.reason || item?.snippet || '').trim(),
  snippet: String(item?.snippet || item?.summary || item?.description || '').trim(),
  dataSourceType: item?.dataSourceType,
  exhibitionFootprints: item?.exhibitionFootprints,
  customsData: item?.customsData,
  decisionMakers: item?.decisionMakers,
  agentStatus: item?.agentStatus,
  dataSourceNote: item?.dataSourceNote,
})

export const normalizeLocalCandidate = (item: any) => ({
  company: String(item?.title || item?.name || item?.company || '').trim(),
  website: String(item?.website || item?.links?.website || item?.link || item?.url || '').trim(),
  phone: String(item?.phone || item?.links?.phone || item?.phoneNumber || '').trim(),
  address: String(item?.address || item?.location || '').trim(),
  source: 'Google Maps',
  reason:
    String(item?.reason || item?.description || item?.snippet || '').trim() || 'Google Maps local business result',
  snippet: String(item?.description || item?.address || item?.snippet || '').trim(),
})

const normalizeSearchCandidates = (raw: any) => {
  const organicResults = Array.isArray(raw?.organic_results)
    ? raw.organic_results
    : Array.isArray(raw?.results)
      ? raw.results
      : Array.isArray(raw?.data?.results)
        ? raw.data.results
        : Array.isArray(raw?.items)
          ? raw.items
          : Array.isArray(raw?.data?.items)
            ? raw.data.items
            : []
  const localResults = Array.isArray(raw?.local_results)
    ? raw.local_results
    : Array.isArray(raw?.local_results?.places)
      ? raw.local_results.places
      : []

  const organicCandidates = organicResults
    .map((item: any) => normalizeOrganicCandidate(item))
    .filter((item: any) => item.company.length > 0)

  const localCandidates = localResults
    .map((item: any) => normalizeLocalCandidate(item))
    .filter((item: any) => item.company.length > 0)

  const uniqueCandidates = Array.from(
    new Map(
      [...localCandidates, ...organicCandidates].map((item: any) => {
        const normalizedWebsite = normalizeWebsiteUrl(item.website)
        const websiteKey = extractDomainFromUrl(normalizedWebsite)
        const fallbackKey = `${item.company.toLowerCase()}|${String(item.address || '')
          .trim()
          .toLowerCase()}`
        return [websiteKey || fallbackKey, { ...item, website: normalizedWebsite || item.website }]
      }),
    ).values(),
  )

  return uniqueCandidates.slice(0, MAX_SEARCH_CANDIDATES)
}

const mutateSearchIntent = async (payload: {
  keyword: string
  country: string
  city: string
  llmEndpoint: string
  llmKey: string
  model: string
  timeoutMs: number
}): Promise<SearchIntentMutation> => {
  const fallbackResult = fallbackMutateB2BKeywords(payload.keyword)
  const fallbackCountry = normalizeIntentCountry(
    payload.country || (/(美国|usa|united states|america)/i.test(payload.keyword) ? 'USA' : ''),
  )
  const fallbackLanguages = fallbackCountry ? COUNTRY_LANGUAGE_MAP[fallbackCountry.toLowerCase()] || ['en'] : ['en']
  const fallback: SearchIntentMutation = {
    country: fallbackCountry,
    city: payload.city,
    pureEnglishProducts: fallbackResult.pureEnglishProducts,
    keywords: fallbackResult.keywords,
    countryOfficialLanguages: fallbackLanguages,
  }

  if (!payload.llmEndpoint || !payload.llmKey) return fallback

  try {
    const { system, user } = buildIntentMutationPrompt({
      keyword: payload.keyword,
      country: payload.country,
      city: payload.city,
    })
    const response = await withTimeoutGuard(
      fetchWithTimeout(
        payload.llmEndpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.llmKey}` },
          body: JSON.stringify({
            model: payload.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            response_format: { type: 'json_object' },
          }),
        },
        Math.min(payload.timeoutMs, SEARCH_LLM_TIMEOUT_MS),
      ),
      Math.min(payload.timeoutMs, SEARCH_LLM_TIMEOUT_MS),
      'Omni intent mutation',
    )
    if (!response.ok) return fallback
    const llmJson: any = await response.json().catch(() => ({}))
    const content = llmJson?.choices?.[0]?.message?.content || llmJson?.choices?.[0]?.text || ''
    const parsed = typeof content === 'string' ? parseIntentMutation(content) : null
    const rawKeywords = Array.isArray(parsed?.keywords)
      ? parsed.keywords.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    const rawProducts = Array.isArray(parsed?.pureEnglishProducts)
      ? parsed.pureEnglishProducts.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : []
    const llmKeywords = rawKeywords.length > 0 ? rawKeywords : []
    /* 产品词清洗 + 封顶（2026-10-11，宪法 SEARCH_PRODUCT_TERM_LIMIT）：
       ① 清洗：剔除含中文/控制词/超长的**不可检索**条目（见 sanitizeProductTerms）；
       ② 封顶：与同段 `keywords.slice(0, 4)` 保持对称 —— 此前 `pureEnglishProducts`
          无上限，而变体数 = 产品词数 × 4，实测 3 语言场景派发 17 变体 → SerpApi 53 次调用。 */
    const llmProducts = sanitizeProductTerms(rawProducts)
    const keywords = llmKeywords.length > 0 ? llmKeywords.slice(0, 4) : fallback.keywords
    const pureEnglishProducts = (llmProducts.length > 0 ? llmProducts : fallback.pureEnglishProducts).slice(
      0,
      SEARCH_PRODUCT_TERM_LIMIT,
    )

    const normalizedCountry = normalizeIntentCountry(String(parsed?.country || fallback.country || '').trim())

    const countryOfficialLanguages = Array.isArray(parsed?.countryOfficialLanguages)
      ? parsed.countryOfficialLanguages.map(String).filter(Boolean)
      : normalizedCountry
        ? COUNTRY_LANGUAGE_MAP[normalizedCountry.toLowerCase()] || ['en']
        : ['en']

    const localizedProducts: Record<string, string[]> = {}
    const localizedKeywords: Record<string, string[]> = {}
    if (parsed?.localizedProducts && typeof parsed.localizedProducts === 'object') {
      for (const lang of Object.keys(parsed.localizedProducts)) {
        const terms = parsed.localizedProducts[lang]
        if (Array.isArray(terms)) {
          localizedProducts[lang] = terms.map(String).filter(Boolean)
        }
      }
    }
    if (parsed?.localizedKeywords && typeof parsed.localizedKeywords === 'object') {
      for (const lang of Object.keys(parsed.localizedKeywords)) {
        const terms = parsed.localizedKeywords[lang]
        if (Array.isArray(terms)) {
          localizedKeywords[lang] = terms.map(String).filter(Boolean)
        }
      }
    }

    return {
      country: normalizedCountry,
      city: String(parsed?.city || fallback.city || '').trim(),
      pureEnglishProducts,
      keywords: keywords.length > 0 ? keywords : fallback.keywords,
      countryOfficialLanguages: countryOfficialLanguages.length > 0 ? countryOfficialLanguages : undefined,
      localizedProducts: Object.keys(localizedProducts).length > 0 ? localizedProducts : undefined,
      localizedKeywords: Object.keys(localizedKeywords).length > 0 ? localizedKeywords : undefined,
    }
  } catch (error) {
    probeLog(
      '[Probe-Intent] Intent mutation fallback engaged:',
      error instanceof Error ? error.message : String(error || ''),
    )
    return fallback
  }
}

const mergeDecisionMakers = (current?: DecisionMaker[], incoming?: DecisionMaker[]) => {
  const merged = new Map<string, DecisionMaker>()
  for (const item of [...(current || []), ...(incoming || [])]) {
    const key = item.email || `${item.name}|${item.title}`.toLowerCase()
    if (!key.trim()) continue
    const existing = merged.get(key)
    if (!existing || Number(item.confidenceScore || 0) >= Number(existing.confidenceScore || 0)) {
      merged.set(key, item)
    }
  }
  return Array.from(merged.values())
}

const mergeLeadFacts = <T extends Partial<SearchExecuteResult>>(items: T[]) => {
  const merged = new Map<string, T>()
  for (const item of items) {
    const normalizedWebsite = normalizeWebsiteUrl(item.website)
    const domain = extractDomainFromUrl(normalizedWebsite)
    const key =
      domain ||
      `${String(item.company || '')
        .trim()
        .toLowerCase()}|${String(item.address || '')
        .trim()
        .toLowerCase()}`
    if (!key.trim()) continue
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...item, website: normalizedWebsite || item.website })
      continue
    }
    merged.set(key, {
      ...existing,
      ...item,
      website: normalizeWebsiteUrl(item.website || existing.website) || item.website || existing.website,
      decisionMakers: mergeDecisionMakers(existing.decisionMakers, item.decisionMakers),
      exhibitionFootprints: Array.from(
        new Set([...(existing.exhibitionFootprints || []), ...(item.exhibitionFootprints || [])]),
      ),
      customsData: Object.keys(item.customsData || {}).length > 0 ? item.customsData : existing.customsData,
      agentStatus: item.agentStatus || existing.agentStatus,
    })
  }
  return Array.from(merged.values())
}

const trimWebsiteTextForLlm = (value: string) =>
  sanitizePlainText(
    String(value || '')
      .replace(
        /\b(home|about|products|services|blog|news|privacy|cookie|login|sign in|menu|navigation|footer|header|copyright)\b/gi,
        ' ',
      )
      .replace(/\s+/g, ' '),
    MAX_WEBSITE_TEXT_FOR_LLM,
  )

type SerpSearchMode = 'maps-location' | 'maps-keyword' | 'organic-keyword'

export const buildSerpApiMapsEndpoint = (query: string, apiKey: string, location?: string, start = 0) => {
  const locationParams = location ? `&location=${encodeURIComponent(location)}&z=12` : ''
  return `https://serpapi.com/search.json?engine=google_maps&type=search&q=${encodeURIComponent(query)}${locationParams}&api_key=${encodeURIComponent(apiKey)}&start=${start}&num=${SEARCH_CHANNEL_FETCH_LIMIT}`
}

export const buildSerpApiOrganicEndpoint = (query: string, apiKey: string, start = 0) =>
  `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}&start=${start}&num=10`

export const buildFallbackAwareMapsQuery = (keyword: string, locationString: string) =>
  locationString ? `${keyword} in ${locationString}` : keyword

export const normalizeSearchResponseCandidates = (
  organicResults: any[],
  localResults: any[],
  city?: string,
  locationString?: string,
) => {
  const filteredLocalResults = city ? filterLocalResultsByLocation(localResults, locationString) : localResults
  return {
    filteredLocalResults,
    normalizedCandidates: normalizeSearchCandidates({
      organic_results: organicResults,
      local_results: filteredLocalResults,
    }),
  }
}

export const resolveSerpSearchPlan = async (payload: {
  keyword: string
  city?: string
  country?: string
  googleKey: string
  timeoutMs: number
  dataSourceType?: string
  attemptSearch: (
    mode: SerpSearchMode,
    modeQuery: string,
    modeLocation: string,
  ) => Promise<{ nextOrganic: any[]; nextLocal: any[] }>
  onStage?: (message: string, searchMode?: 'anysearch' | 'maps' | 'maps-keyword-fallback' | 'organic-fallback') => void
  onFallback?: (event: 'location-rejected' | 'zero-local-organic', detail: Record<string, unknown>) => void
}) => {
  const keyword = String(payload.keyword || '').trim()
  const city = String(payload.city || '').trim()
  const country = String(payload.country || '').trim()
  const locationString = city && country ? `${city}, ${country}` : country || ''
  let allOrganic: any[] = []
  let allLocal: any[] = []
  let activeSearchMode: 'maps' | 'maps-keyword-fallback' | 'organic-fallback' = 'maps'
  let lastUnsupportedLocationError = ''
  let fetched = false

  const runMapsLocationSearch = async () => {
    try {
      const result = await payload.attemptSearch('maps-location', keyword, city || country || '')
      allOrganic = result.nextOrganic
      allLocal = result.nextLocal
      activeSearchMode = 'maps'
      fetched = true
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '')
      if (message.startsWith('UNSUPPORTED_LOCATION::')) {
        lastUnsupportedLocationError = message.replace('UNSUPPORTED_LOCATION::', '')
        payload.onFallback?.('location-rejected', { keyword, city, country, locationString })
        payload.onStage?.('地图定位受限，正在尝试扩大识别范围...', 'maps-keyword-fallback')
        return false
      }
      throw error
    }
  }

  const runMapsKeywordSearch = async () => {
    const fallbackQuery = buildFallbackAwareMapsQuery(keyword, locationString)
    const result = await payload.attemptSearch('maps-keyword', fallbackQuery, '')
    allOrganic = result.nextOrganic
    allLocal = result.nextLocal
    activeSearchMode = 'maps-keyword-fallback'
    fetched = true
    return result
  }

  const runOrganicFallbackSearch = async () => {
    const fallbackQuery = buildFallbackAwareMapsQuery(keyword, locationString)
    const result = await payload.attemptSearch('organic-keyword', fallbackQuery, '')
    allOrganic = result.nextOrganic
    allLocal = result.nextLocal
    activeSearchMode = 'organic-fallback'
    fetched = true
    payload.onStage?.('未发现地图商户，已自动为您补位全局网页线索...', 'organic-fallback')
    return result
  }

  if (payload.dataSourceType === 'google_organic') {
    payload.onStage?.(' 正在通过 Google 网页搜索引擎进行全局线索采集...', 'organic-fallback')
    await runOrganicFallbackSearch()
  } else if (city) {
    const levelOneSucceeded = await runMapsLocationSearch()
    if (!levelOneSucceeded) {
      const levelTwoResult = await runMapsKeywordSearch()
      if ((levelTwoResult.nextLocal?.length || 0) === 0) {
        payload.onFallback?.('zero-local-organic', { keyword, locationString })
        await runOrganicFallbackSearch()
      }
    }
  } else {
    const levelTwoResult = await runMapsKeywordSearch()
    activeSearchMode = 'maps-keyword-fallback'
    if ((levelTwoResult.nextLocal?.length || 0) === 0) {
      payload.onFallback?.('zero-local-organic', { keyword, locationString })
      await runOrganicFallbackSearch()
    }
  }

  if (!fetched) {
    throw new Error(lastUnsupportedLocationError || '目标地区识别失败，系统已自动尝试降级搜索模式，请稍后。')
  }

  return {
    allOrganic,
    allLocal,
    locationString,
    activeSearchMode,
  }
}

const filterLocalResultsByLocation = (localResults: any[], locationString?: string) => {
  const terms = extractLocationTerms(locationString)
  if (terms.length === 0) {
    return localResults
  }

  const filtered = localResults.filter((item) => {
    const address = normalizeGeoText(item?.address || item?.location || '')
    if (!address) {
      return false
    }

    return terms.some((term) => address.includes(term))
  })

  if (filtered.length === 0 && localResults.length > 0) {
    probeLog('[Probe-Normalize] Location filter fallback engaged, preserving original local results:', {
      locationString: locationString || '',
      termCount: terms.length,
      originalLocalCount: localResults.length,
    })
    return localResults
  }

  return filtered
}

const withTimeoutGuard = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          probeError('[Probe-Timeout] Guard triggered:', { label, timeoutMs })
          reject(new Error(`${label} timeout after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type WebsiteContentProbe = {
  ok: boolean
  url: string
  title: string
  description: string
  body: string
  directEmails: string[]
  directPhones: string[]
  /** 首页 `<a>` 链接中识别出的**站内联系页**候选（零 API 成本的真实 URL 发现）。 */
  contactLinks: string[]
  /** **WhatsApp 直链**号码（`wa.me` 等）—— 定义上即为 WhatsApp 可用，是免费手机号最高价值来源。 */
  whatsappNumbers: string[]
  failureCode?: 'website_403' | 'website_503' | 'website_timeout' | 'website_unreachable'
}

const createEmptyWebsiteContentProbe = (
  url = '',
  failureCode?: 'website_403' | 'website_503' | 'website_timeout' | 'website_unreachable',
): WebsiteContentProbe => ({
  ok: false,
  url,
  title: '',
  description: '',
  body: '',
  directEmails: [],
  directPhones: [],
  contactLinks: [],
  whatsappNumbers: [],
  failureCode,
})

const mergeWebsiteContentProbes = (...probes: WebsiteContentProbe[]): WebsiteContentProbe => {
  const validProbes = probes.filter((probe) => probe.ok)
  if (validProbes.length === 0) {
    return probes[0] || createEmptyWebsiteContentProbe()
  }

  return {
    ok: true,
    url: validProbes[0]?.url || probes[0]?.url || '',
    title: validProbes.map((probe) => probe.title).find(Boolean) || '',
    description: validProbes.map((probe) => probe.description).find(Boolean) || '',
    body: sanitizePlainText(
      validProbes
        .map((probe) => probe.body)
        .filter(Boolean)
        .join(' '),
      2200,
    ),
    directEmails: mergeUniqueValues(...validProbes.map((probe) => probe.directEmails)),
    directPhones: mergeUniqueValues(...validProbes.map((probe) => probe.directPhones)),
    contactLinks: mergeUniqueValues(...validProbes.map((probe) => probe.contactLinks)),
    whatsappNumbers: mergeUniqueValues(...validProbes.map((probe) => probe.whatsappNumbers)),
  }
}

const buildDeepProbeSystemPrompt = () =>
  mergePromptParts(
    'You are a B2B lead ',
    'research analyst. ',
    'Analyze the company website text and snippet. ',
    'Return ONLY valid JSON with key: outreachAngle. ',
    'Do not invent contact names, titles, phone numbers, or email addresses. ',
    'Keep the outreach angle concise and commercially usable.',
  )

const extractContactCandidates = (input: string) => {
  const compact = sanitizePlainText(input, 4000)
  const emailMatches = extractEmailsFromText(compact)
  const phoneMatches = extractPhonesFromText(compact)
  const contactPatterns = [
    /(?:contact|联系人|reach\s+out\s+to|talk\s+to)\s*[:-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*[,|-]\s*(?:sales|procurement|sourcing|business development|director|manager)/i,
  ]
  const titlePatterns = [
    /(procurement manager|sourcing manager|business development manager|sales director|commercial director|engineering director)/i,
  ]
  const contact = contactPatterns.map((pattern) => compact.match(pattern)?.[1]?.trim()).find(Boolean) || ''
  const contactTitle = titlePatterns.map((pattern) => compact.match(pattern)?.[1]?.trim()).find(Boolean) || ''
  return { contact, contactTitle, email: emailMatches[0] || '', phone: phoneMatches[0] || '' }
}

const fetchWebsiteContent = async (url: string, timeoutMs: number): Promise<WebsiteContentProbe> => {
  try {
    probeLog('[Probe-Fetch] Fetching website:', url, 'timeoutMs:', timeoutMs)
    const response = await withTimeoutGuard(
      fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': WEBSITE_PROBE_USER_AGENT } }, timeoutMs),
      timeoutMs,
      `Website fetch ${url}`,
    )
    probeLog('[Probe-Fetch] Website response status:', response.status, 'url:', url)
    if (!response.ok) {
      if (response.status === 403) {
        probeLog('[Probe-Fetch] Website blocked by 403:', { url })
        return createEmptyWebsiteContentProbe(url, 'website_403')
      }
      if (response.status === 503) {
        probeLog('[Probe-Fetch] Website unavailable by 503:', { url })
        return createEmptyWebsiteContentProbe(url, 'website_503')
      }
      return createEmptyWebsiteContentProbe(url, 'website_unreachable')
    }
    const html = await response.text()
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const descMatch = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
    const contactHrefMatches = Array.from(html.matchAll(/(?:href=["']mailto:([^"'>?#]+)|href=["']tel:([^"'>?#]+))/gi))
    /* JSON-LD（application/ld+json）的 Organization/LocalBusiness telephone/email：
       结构化数据命中率高、噪声低，是**免费**联系方式的重要来源。 */
    const jsonLdContacts = parseJsonLdContacts(html)
    return {
      ok: true,
      url,
      title: titleMatch?.[1] ? sanitizePlainText(titleMatch[1], 200) : '',
      description: descMatch?.[1] ? sanitizePlainText(descMatch[1], 400) : '',
      body: sanitizePlainText(bodyText, 2200),
      directEmails: mergeUniqueValues(
        contactHrefMatches
          .map((match) => match[1])
          .filter(Boolean)
          /* `mailto:`/`tel:` 值可能含 URL 编码（如 `%20`）→ 必须解码，否则残留进字段 */
          .map((item) => decodeContactHrefValue(String(item))),
        jsonLdContacts.emails,
      ),
      directPhones: mergeUniqueValues(
        contactHrefMatches
          .map((match) => match[2])
          .filter(Boolean)
          .map((item) => decodeContactHrefValue(String(item))),
        jsonLdContacts.phones,
      ),
      /* 站内联系页候选：从首页 `<a>` 链接识别真实 URL（零 API 成本，比猜固定路径更准）。 */
      contactLinks: extractContactLinksFromHtml(html, url),
      /* WhatsApp 直链（`wa.me` 等，定义上即可用于 WhatsApp）+ 带「手机/WhatsApp」标记的号码。
         这是**免费**获取「可用于 WhatsApp 的手机号」的最高价值来源（商家电话多为座机）。 */
      whatsappNumbers: mergeUniqueValues(
        extractWhatsAppNumbers(html),
        extractLabelledMobileNumbers(`${bodyText} ${titleMatch?.[1] || ''}`),
      ),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '')
    probeLog('[Probe-Fetch] Website fetch failed:', {
      url,
      message,
    })
    return createEmptyWebsiteContentProbe(
      url,
      isTimeoutError(error) || /timeout/i.test(message) ? 'website_timeout' : 'website_unreachable',
    )
  }
}

const extractWebsiteContent = async (url: string, timeoutMs: number) => {
  const strictTimeoutMs = Math.max(1, Math.min(timeoutMs || WEBSITE_PROBE_TIMEOUT_MS, WEBSITE_PROBE_TIMEOUT_MS))
  const homepage = await fetchWebsiteContent(url, strictTimeoutMs)
  if (!homepage.ok) {
    return homepage
  }

  const homepageExtracted = extractContactCandidates(
    [
      homepage.title,
      homepage.description,
      homepage.body,
      homepage.directEmails.join(' '),
      homepage.directPhones.join(' '),
    ].join(' '),
  )

  if (homepageExtracted.email && homepageExtracted.phone) {
    return homepage
  }

  /* 联系页候选 = 首页发现的**真实链接**（优先，比猜固定路径更准）+ 固定路径兜底；
     合并去重并受 CONTACT_PAGE_FETCH_LIMIT 上限约束（不放大延迟/连接数，也不改富化线索并发=2）。 */
  const contactUrls = Array.from(new Set([...(homepage.contactLinks || []), ...buildContactPageUrls(url)])).slice(
    0,
    CONTACT_PAGE_FETCH_LIMIT,
  )
  if (contactUrls.length === 0) {
    return homepage
  }

  const successfulContacts: WebsiteContentProbe[] = []
  /* 联系页并行抓取：/contact 与 /contact-us 串行时最坏 2×15s；
     并行后单条线索的抓取上限回落到 15s（不改变富化线索并发=2 的宪法约束） */
  await Promise.all(
    contactUrls.map(async (contactUrl) => {
      try {
        const contactResult = await fetchWebsiteContent(contactUrl, strictTimeoutMs)
        if (contactResult.ok) successfulContacts.push(contactResult)
      } catch {
        // ignore individual contact page failures
      }
    }),
  )

  if (successfulContacts.length === 0) {
    return homepage
  }

  return mergeWebsiteContentProbes(homepage, ...successfulContacts)
}

const buildDeepProbePrompt = (payload: {
  company: string
  website: string
  snippet?: string
  websiteText: string
}) => ({
  system: buildDeepProbeSystemPrompt(),
  user: JSON.stringify(payload),
})

const buildSnippetFallbackPrompt = (payload: {
  keyword: string
  icpProfile?: { targetProduct?: string; buyerPersona?: string; coreAdvantage?: string; negativeIcp?: string }
  candidate: { company: string; website?: string; snippet?: string; reason?: string }
}) => ({
  system: buildUniversalIcpPrompt({ icpProfile: payload.icpProfile }),
  user: JSON.stringify({
    keyword: payload.keyword,
    mode: 'snippet_fallback',
    candidates: [
      {
        company: payload.candidate.company,
        website: payload.candidate.website || '',
        snippet: payload.candidate.snippet || '',
        reason: payload.candidate.reason || '',
      },
    ],
    instruction: '官网不可访问，请仅基于 company、website、snippet、reason 做轻量评分，仍需输出 0-100 matchScore。',
  }),
})

const buildSocialFallbackQueries = (company: string, country?: string) => [
  `site:linkedin.com/company "${company}" ${country || ''}`.trim(),
  `site:kompass.com "${company}"`,
  `site:europages.com "${company}"`,
]

const fetchSocialFallbackSnippet = async (query: string, googleKey: string, timeoutMs: number) => {
  const url = buildSerpApiOrganicEndpoint(query, googleKey)

  // 成本优化（P0）：403 盲评兜底查询同样走缓存，避免重复烧额度。
  const cached = getSerpApiCached(url)
  if (cached !== undefined) {
    const cachedOrganic = Array.isArray((cached as any)?.organic_results) ? (cached as any).organic_results : []
    return sanitizePlainText(
      cachedOrganic
        .slice(0, 3)
        .map((item: any) =>
          [String(item?.title || '').trim(), String(item?.snippet || '').trim()].filter(Boolean).join(' - '),
        )
        .filter(Boolean)
        .join(' '),
      900,
    )
  }

  const response = await fetchSerpApiWithRetry(url, timeoutMs)
  const rawText = await response.text()
  probeLog('[Probe-403-Fallback] SerpApi social query status:', {
    query,
    status: response.status,
    payload: rawText.substring(0, 240),
  })
  if (!response.ok) {
    return ''
  }

  let parsed: any
  try {
    parsed = rawText ? JSON.parse(rawText) : null
  } catch {
    parsed = null
  }

  if (parsed !== null) setSerpApiCached(url, parsed)

  const organicResults = Array.isArray(parsed?.organic_results) ? parsed.organic_results : []
  return sanitizePlainText(
    organicResults
      .slice(0, 3)
      .map((item: any) =>
        [String(item?.title || '').trim(), String(item?.snippet || '').trim()].filter(Boolean).join(' - '),
      )
      .filter(Boolean)
      .join(' '),
    900,
  )
}

const buildSocialFallbackEnrichedText = async (
  company: string,
  country: string | undefined,
  googleKey: string,
  timeoutMs: number,
) => {
  probeLog('[Probe-403-Fallback] 使用 LinkedIn/Kompass/Europages 平替 for:', company)
  const snippets: string[] = []
  for (const query of buildSocialFallbackQueries(company, country)) {
    const result = await fetchSocialFallbackSnippet(query, googleKey, timeoutMs).catch(() => '')
    snippets.push(result)
  }
  return trimWebsiteTextForLlm(snippets.filter(Boolean).join(' '))
}

/** 在多个候选电话中**优先选手机**（最大化 WhatsApp 可达性）；无手机则保持既有回退顺序。
 * 分类复用双端 SSOT `classifyPhoneKind`（已在 contact-validation 收敛）。
 *
 * 2026-10-13 增强：`whatsappPhone`（来自网页 `wa.me` 直链）**定义上即可用于 WhatsApp**，
 * 故直接按 `mobile` 参与排序 —— 这是**免费**拿到「可用于 WhatsApp 的手机号」的关键来源
 * （Google Maps 等来源的商家电话绝大多数是座机，US 号码因 LNP 无法从号段区分，一律 `unknown`）。
 *
 * 2026-10-13 再增强（S2）：返回值同时携带**来源与可信度**（`provenance`），
 * 保证「取值」与「来源标注」同源，杜绝静默错标。 */
const pickBestPhoneForReach = (
  candidatePhone: string,
  apollo: ApolloEnrichResult | null,
  prospeo: ProspeoEnrichResult | null,
  whatsappPhone: string,
  websitePhone: string,
  extractedPhone: string,
  country?: string,
  candidateSourceLabel = 'Google Maps',
): { phone: string; provenance?: ContactFieldProvenance } => {
  const countryCode = resolveCountryCode(country) || ''
  const ranked: Array<{ phone: string; kind: PhoneKind; provenance: ContactFieldProvenance }> = []
  if (candidatePhone)
    ranked.push({
      phone: candidatePhone,
      kind: classifyPhoneKind(candidatePhone, countryCode),
      provenance: {
        tier: 'extracted',
        source: candidateSourceLabel,
        kind: classifyPhoneKind(candidatePhone, countryCode),
      },
    })
  /* Prospeo 揭示的 `mobile` 是**已验证手机号**（字段语义即 mobile）→ 优先于 Apollo 的自报类型 */
  if (prospeo?.phone)
    ranked.push({
      phone: prospeo.phone,
      kind: prospeo.phoneKind,
      provenance: { tier: 'verified', source: 'Prospeo', kind: prospeo.phoneKind, verifiedAt: Date.now() },
    })
  if (apollo?.phone)
    ranked.push({
      phone: apollo.phone,
      kind: apollo.phoneKind,
      provenance: { tier: 'verified', source: 'Apollo', kind: apollo.phoneKind, verifiedAt: Date.now() },
    })
  /* WhatsApp 直链号码：网站主动挂出的一键 WhatsApp → 定义上可用，按 mobile 参与排序 */
  if (whatsappPhone)
    ranked.push({
      phone: whatsappPhone,
      kind: 'mobile',
      provenance: { tier: 'extracted', source: '官网 WhatsApp 直链', kind: 'mobile' },
    })
  if (websitePhone)
    ranked.push({
      phone: websitePhone,
      kind: classifyPhoneKind(websitePhone, countryCode),
      provenance: { tier: 'extracted', source: '官网', kind: classifyPhoneKind(websitePhone, countryCode) },
    })
  if (extractedPhone)
    ranked.push({
      phone: extractedPhone,
      kind: classifyPhoneKind(extractedPhone, countryCode),
      provenance: { tier: 'extracted', source: '官网', kind: classifyPhoneKind(extractedPhone, countryCode) },
    })
  const mobile = ranked.find((r) => r.kind === 'mobile')
  if (mobile) return { phone: mobile.phone, provenance: mobile.provenance }
  /* 无手机 → 保持**既有回退顺序**（候选 > 官网 > 提取），行为不变 */
  const fallbackOrder = [candidatePhone, websitePhone, extractedPhone]
  for (const fallbackPhone of fallbackOrder) {
    const hit = ranked.find((r) => r.phone === fallbackPhone)
    if (hit) return { phone: hit.phone, provenance: hit.provenance }
  }
  return { phone: '' }
}

const enrichLeadWithDeepProbe = async (payload: {
  candidate: Partial<SearchExecuteResult>
  llmEndpoint: string
  llmKey: string
  model: string
  timeoutMs: number
  keyword: string
  country?: string
  googleKey: string
  icpProfile?: { targetProduct?: string; buyerPersona?: string; coreAdvantage?: string; negativeIcp?: string }
  skipLlmProbe?: boolean
  /** 是否为高价值线索（matchScore ≥ 60，会进入 Agent 管道）—— Apollo 富化仅对此类触发。 */
  highValue?: boolean
  /** 每轮搜索的 Apollo 富化查询预算计数器（总量护栏，Fail-Closed 共享）。 */
  enrichBudget?: { used: number; limit: number }
  /** 每轮搜索的 Prospeo **邮箱**富化预算计数器（Apollo 的低成本前置）。 */
  prospeoEmailBudget?: { used: number; limit: number }
  /** 每轮搜索的 Prospeo **手机号**富化预算计数器（10 credits/条，独立且更小）。 */
  prospeoMobileBudget?: { used: number; limit: number }
  /* Step 2E：分级补全的用户授权开关（缺省：邮箱放行、手机关闭） */
  enrichmentOptions?: { email?: boolean; mobile?: boolean }
}) => {
  const website = normalizeWebsiteUrl(payload.candidate.website)
  const snippet = String(payload.candidate.snippet || '').trim()
  const websiteContent = website
    ? await extractWebsiteContent(website, WEBSITE_PROBE_TIMEOUT_MS)
    : createEmptyWebsiteContentProbe()
  const probeText = trimWebsiteTextForLlm(
    [websiteContent.title, websiteContent.description, websiteContent.body, snippet].filter(Boolean).join(' '),
  )
  const extracted = extractContactCandidates(
    [probeText, websiteContent.directEmails.join(' '), websiteContent.directPhones.join(' ')].join(' '),
  )

  /* Step 3：本线索的补全调用流水（既写全局账本，也用于生成本线索的 enrichmentCost 摘要）。
     **不伪造成本**：付费供应商一律 `cost: null`（未知）—— 我们知其**计费单位**（credit），
     但**未与账单核对**，故不写精确费用；公布单价记录在 `detail` 中供人工判断。 */
  const enrichmentCalls: EnrichmentCallRecord[] = []
  const pushEnrichmentCall = (input: RecordEnrichmentCallInput) => {
    const record = recordEnrichmentCall(input)
    if (record) enrichmentCalls.push(record)
  }

  /* Step 2E：**分级补全的用户授权门控**。
     - 邮箱：缺省放行（低成本前置，Prospeo 约 2 credits/条）；
     - 手机：缺省**关闭**（10 credits/条，高成本）—— 必须由用户在 UI 显式开启。
     门控在**调用前**判定，未授权时不发起任何请求（`skipped_not_opted_in`）。 */
  const allowEmailEnrich = payload.enrichmentOptions?.email !== false
  const allowMobileEnrich = payload.enrichmentOptions?.mobile === true

  let prospeo: ProspeoEnrichResult | null = null
  try {
    const prospeoKey = getUserProspeoApiKey()
    const emailBudget = payload.prospeoEmailBudget
    const mobileBudget = payload.prospeoMobileBudget
    const candidatePhone = String(payload.candidate.phone || '').trim()
    const alreadyMobile =
      Boolean(candidatePhone) &&
      classifyPhoneKind(candidatePhone, resolveCountryCode(payload.country) || '') === 'mobile'
    /* 手机仅在「用户已授权 + 预算剩余 + 尚无手机」时才请求 —— 三条缺一不可。 */
    const wantMobile =
      allowMobileEnrich && Boolean(mobileBudget) && mobileBudget!.used < mobileBudget!.limit && !alreadyMobile

    if (!payload.highValue) {
      pushEnrichmentCall({ provider: 'prospeo', field: 'identity', status: 'skipped_not_high_value' })
    } else if (!prospeoKey) {
      pushEnrichmentCall({
        provider: 'prospeo',
        field: 'identity',
        status: 'skipped_not_opted_in',
        detail: 'Prospeo API key 未配置',
      })
    } else if (!allowEmailEnrich) {
      pushEnrichmentCall({
        provider: 'prospeo',
        field: 'identity',
        status: 'skipped_not_opted_in',
        detail: '用户未开启联系人补全',
      })
    } else if (!emailBudget || emailBudget.used >= emailBudget.limit) {
      pushEnrichmentCall({ provider: 'prospeo', field: 'identity', status: 'skipped_budget' })
    } else {
      /* Step 3：字段级去重缓存 —— 命中即**不发起请求**，天然不消耗额度。 */
      const identityCacheKey = buildEnrichmentCacheKey(
        'prospeo',
        website || String(payload.candidate.company || ''),
        'identity',
      )
      const cachedProspeo = getEnrichmentCached<ProspeoEnrichResult>(identityCacheKey)
      if (cachedProspeo) {
        prospeo = cachedProspeo
        pushEnrichmentCall({
          provider: 'prospeo',
          field: 'identity',
          status: 'hit',
          billingUnit: 'credit',
          fromCache: true,
          detail: '缓存命中，未消耗额度',
        })
      } else {
        emailBudget.used += 1
        if (wantMobile) mobileBudget!.used += 1
        const result = await enrichFromProspeo({
          domain: website,
          company: String(payload.candidate.company || '').trim(),
          country: payload.country,
          wantMobile,
          timeoutMs: payload.timeoutMs,
        })
        if (result.used) {
          prospeo = result
          setEnrichmentCached(identityCacheKey, result)
          pushEnrichmentCall({
            provider: 'prospeo',
            field: 'identity',
            status: 'hit',
            billingUnit: 'credit',
            detail: 'search-person（公布价 1 credit，未与账单核对）',
          })
          if (result.email) {
            pushEnrichmentCall({
              provider: 'prospeo',
              field: 'email',
              status: 'hit',
              billingUnit: 'credit',
              detail: `enrich-person 邮箱（公布价 1 credit，status=${result.emailStatus || 'unknown'}）`,
            })
          }
          if (result.phone) {
            pushEnrichmentCall({
              provider: 'prospeo',
              field: 'mobile',
              status: 'hit',
              billingUnit: 'credit',
              detail: 'enrich-person 手机（公布价 10 credits）',
            })
          }
        } else {
          pushEnrichmentCall({
            provider: 'prospeo',
            field: 'identity',
            status: 'miss',
            billingUnit: 'credit',
            detail: 'search-person 无命中（公布价 1 credit，未与账单核对）',
          })
        }
      }
    }
  } catch {
    prospeo = null
    pushEnrichmentCall({ provider: 'prospeo', field: 'identity', status: 'error', billingUnit: 'unknown' })
  }

  let apollo: ApolloEnrichResult | null = null
  try {
    /* Step 2D：**第二供应商只在首选未给出符合要求的结果时**才执行。
       「符合要求」= 拿到了邮箱（Prospeo 未拿到邮箱才回退 Apollo），避免重复付费。 */
    const prospeoHasQualifyingEmail = Boolean(prospeo?.email)
    if (!payload.highValue) {
      pushEnrichmentCall({ provider: 'apollo', field: 'email', status: 'skipped_not_high_value' })
    } else if (!payload.enrichBudget || !getUserApolloApiKey()) {
      pushEnrichmentCall({
        provider: 'apollo',
        field: 'email',
        status: 'skipped_not_opted_in',
        detail: 'Apollo API key 未配置',
      })
    } else if (prospeoHasQualifyingEmail) {
      pushEnrichmentCall({
        provider: 'apollo',
        field: 'email',
        status: 'skipped_not_opted_in',
        detail: '首选供应商已给出邮箱，按 Step 2D 不重复调用',
      })
    } else if (payload.enrichBudget.used >= payload.enrichBudget.limit) {
      pushEnrichmentCall({ provider: 'apollo', field: 'email', status: 'skipped_budget' })
    } else {
      const apolloCacheKey = buildEnrichmentCacheKey(
        'apollo',
        website || String(payload.candidate.company || ''),
        'identity',
      )
      const cachedApollo = getEnrichmentCached<ApolloEnrichResult>(apolloCacheKey)
      if (cachedApollo) {
        apollo = cachedApollo
        pushEnrichmentCall({
          provider: 'apollo',
          field: 'identity',
          status: 'hit',
          billingUnit: 'credit',
          fromCache: true,
          detail: '缓存命中，未消耗额度',
        })
      } else {
        payload.enrichBudget.used += 1
        const result = await enrichFromApollo({
          domain: website,
          company: String(payload.candidate.company || '').trim(),
          country: payload.country,
        })
        if (result.used) {
          apollo = result
          setEnrichmentCached(apolloCacheKey, result)
          pushEnrichmentCall({
            provider: 'apollo',
            field: 'identity',
            status: 'hit',
            billingUnit: 'credit',
            detail: `people/match（公布价 1-9 credits，match_confidence=${result.matchConfidence || 'unknown'}）`,
          })
        } else {
          pushEnrichmentCall({ provider: 'apollo', field: 'identity', status: 'miss', billingUnit: 'credit' })
        }
      }
    }
  } catch {
    apollo = null
    pushEnrichmentCall({ provider: 'apollo', field: 'identity', status: 'error', billingUnit: 'unknown' })
  }

  let llmInferred: Record<string, unknown> | null = null
  /* skipLlmProbe：LLM 服务熔断时跳过 LLM 深探，但保留官网抓取（邮箱/电话
     提取独立于 LLM，仍有价值），避免熔断后连官网信息也丢掉 */
  if (!payload.skipLlmProbe && website && payload.llmEndpoint && payload.llmKey) {
    const { system, user } = buildDeepProbePrompt({
      company: String(payload.candidate.company || '').trim(),
      website,
      snippet,
      websiteText: probeText,
    })
    probeLog(
      '[Probe-LLM] Deep probe candidate:',
      String(payload.candidate.company || '').trim(),
      'timeoutMs:',
      payload.timeoutMs,
    )
    const response = await withTimeoutGuard(
      fetchWithTimeout(
        payload.llmEndpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.llmKey}` },
          body: JSON.stringify({
            model: payload.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            response_format: { type: 'json_object' },
          }),
        },
        payload.timeoutMs,
      ),
      payload.timeoutMs,
      `Deep probe LLM ${String(payload.candidate.company || '').trim() || website}`,
    ).catch((error) => {
      probeLog('[Probe-LLM] Deep probe failed:', {
        candidate: String(payload.candidate.company || '').trim(),
        message: error instanceof Error ? error.message : String(error || ''),
      })
      return null
    })

    if (response?.ok) {
      probeLog(
        '[Probe-LLM] Deep probe response status:',
        response.status,
        'candidate:',
        String(payload.candidate.company || '').trim(),
      )
      const llmJson: any = await response.json().catch(() => ({}))
      const content = llmJson?.choices?.[0]?.message?.content || llmJson?.choices?.[0]?.text || ''
      llmInferred = typeof content === 'string' ? extractJsonObjectFromText(content) : null
    }
  }

  let contact = String(payload.candidate.contact || extracted.contact || '').trim()
  let contactTitle = String(payload.candidate.contactTitle || extracted.contactTitle || '').trim()
  /* 数据源标签（用于来源标注）：候选自带 source（如 "Google Maps"）。 */
  const candidateSourceLabel = String(payload.candidate.source || 'Google Maps').trim()
  /* 邮箱优先级（Step 4 修正）：**按可信档排序**，`verified` 必须优先于 `extracted`。
     ⚠️ 2026-10-16 审计修正：此前把 `payload.candidate.email`（`extracted`）排在
     `prospeo/apollo`（`verified`）**之前**，一旦候选自带邮箱就会用**低可信值压掉高可信值**，
     与「低可信不得覆盖高可信」相悖。现按档位排序（同档位保持业务顺序）。
     邮箱可信档**如实标注**：Prospeo/Apollo 仅在**自报状态为已验证**时才算 `verified`，
     否则降为 `extracted` —— 不把「供应商返回了」等同于「已验证」（审计 D-3/D-4）。 */
  const enrichAt = Date.now()
  const prospeoEmailTier: ContactTier =
    String(prospeo?.emailStatus || '').toUpperCase() === PROSPEO_VERIFIED_EMAIL_STATUS ? 'verified' : 'extracted'
  const apolloEmailTier: ContactTier =
    String(apollo?.emailStatus || '').toLowerCase() === APOLLO_VERIFIED_EMAIL_STATUS ? 'verified' : 'extracted'
  const emailPick = pickContactWithProvenance([
    {
      value: prospeo?.email,
      tier: prospeoEmailTier,
      source: 'Prospeo',
      grade: prospeo?.emailStatus,
      verifiedAt: enrichAt,
    },
    { value: apollo?.email, tier: apolloEmailTier, source: 'Apollo', grade: apollo?.emailStatus, verifiedAt: enrichAt },
    { value: payload.candidate.email, tier: 'extracted', source: candidateSourceLabel },
    { value: websiteContent.directEmails[0], tier: 'extracted', source: '官网' },
    { value: extracted.email, tier: 'extracted', source: '官网' },
  ])
  const email = emailPick.value
  /* 电话优先级：在所有候选中**优先选手机**（最大化 WhatsApp 可达性），无手机则保持
     既有回退顺序（线索自带 > 官网 > LLM 提取）。返回值同时携带来源与可信度。 */
  const phonePick = pickBestPhoneForReach(
    String(payload.candidate.phone || '').trim(),
    apollo,
    prospeo,
    /* 网站挂出的 WhatsApp 直链号码（定义上可用于 WhatsApp）优先于座机 */
    String(websiteContent.whatsappNumbers[0] || '').trim(),
    websiteContent.directPhones[0] || '',
    extracted.phone || '',
    payload.country,
    candidateSourceLabel,
  )
  const phone = phonePick.phone
  /* 号码类型（WhatsApp 可用性）：**直接采信来源标注中的 kind**（Prospeo 已验证手机 /
     WhatsApp 直链 → `mobile`），否则回退双端 SSOT 判定。 */
  const phoneKind: PhoneKind =
    phonePick.provenance?.kind || classifyPhoneKind(phone, resolveCountryCode(payload.country) || '')
  /* 联系方式来源与可信度（三档）：与取值**同源**产出，供前端徽标 / 筛选 / 管道放行使用。 */
  const contactProvenance: ContactProvenance = {}
  if (emailPick.provenance) contactProvenance.email = emailPick.provenance
  if (phonePick.provenance) contactProvenance.phone = phonePick.provenance

  /* ── Step 2B：决策人身份交付（审计缺陷 D-2）────────────────────────────
     此前富化源**完全不参与** `contact` / `contactTitle` / `decisionMakers`：
     Prospeo 的 `search-person` 已按域名找到人（且做了决策者职位加权），
     姓名与职位却**在适配器出口被丢弃** → 用户永远只看到「有邮箱但不知道是谁」。
     现按「不覆盖既有更高优先来源」的原则补位：
       · 候选自带（搜索结果）> 官网正则 > **Prospeo（按域名定向检索）** > **Apollo（按域名匹配）**；
     并如实记录**公司关联依据**（`matchBasis`）与来源，`confidenceScore` 保持 0（不臆造）。
     注意：供应商「返回了某人」≠「该人是已验证联系人」，故 tier 记为 `extracted`（非 verified）。 */
  let resolvedContactSource = contact ? (payload.candidate.contact ? candidateSourceLabel : '官网') : ''
  let resolvedContactMatchBasis: string | undefined
  if (!contact && prospeo?.contactName) {
    contact = prospeo.contactName
    contactTitle = prospeo.contactTitle || contactTitle
    resolvedContactSource = 'Prospeo'
    resolvedContactMatchBasis = 'Prospeo 按公司域名检索（决策者职位加权）'
  } else if (!contact && apollo?.contactName) {
    contact = apollo.contactName
    contactTitle = apollo.contactTitle || contactTitle
    resolvedContactSource = 'Apollo'
    resolvedContactMatchBasis = `Apollo people/match 按公司域名匹配（match_confidence=${apollo.matchConfidence || 'unknown'}）`
  }
  if (contact) {
    contactProvenance.contact = {
      tier: 'extracted',
      source: resolvedContactSource,
      verifiedAt: enrichAt,
    }
  }

  /* 富化得到的决策人（身份独立于联系方式：`confidenceScore` 恒 0 = 未验证，前端据此降级展示）。 */
  const enrichedDecisionMakers: DecisionMaker[] = []
  if (prospeo?.contactName) {
    enrichedDecisionMakers.push({
      name: prospeo.contactName,
      title: prospeo.contactTitle || '',
      email: prospeo.email || '',
      phone: prospeo.phone || '',
      linkedinUrl: prospeo.contactLinkedinUrl,
      source: 'Prospeo',
      confidenceScore: 0,
      matchBasis: 'Prospeo 按公司域名检索（决策者职位加权）',
      discoveredAt: enrichAt,
    })
  }
  if (apollo?.contactName) {
    enrichedDecisionMakers.push({
      name: apollo.contactName,
      title: apollo.contactTitle || '',
      email: apollo.email || '',
      phone: apollo.phone || '',
      linkedinUrl: apollo.contactLinkedinUrl,
      source: 'Apollo',
      confidenceScore: 0,
      matchBasis: `Apollo people/match 按公司域名匹配（match_confidence=${apollo.matchConfidence || 'unknown'}）`,
      discoveredAt: enrichAt,
    })
  }
  const decisionMakers = mergeDecisionMakers(payload.candidate.decisionMakers, enrichedDecisionMakers)

  /* Step 3：本线索的补全成本摘要（未知计费如实计入 `unknownCostCalls`，不伪造精确成本）。 */
  const enrichmentCost = summarizeEnrichmentCalls(enrichmentCalls)

  /* 数据源归因：Prospeo / Apollo **真正贡献了联系数据**时才标注，避免误导（不虚标）。 */
  const enrichSourceSuffix = (prospeo?.used ? ' · Prospeo' : '') + (apollo?.used ? ' · Apollo' : '')
  const outreachAngle = String(llmInferred?.outreachAngle || '').trim()

  if (!websiteContent.ok) {
    const eligible403Fallback = ['website_403', 'website_503', 'website_timeout'].includes(
      String(websiteContent.failureCode || ''),
    )
    const socialFallbackText = eligible403Fallback
      ? await buildSocialFallbackEnrichedText(
          String(payload.candidate.company || '').trim(),
          payload.country,
          payload.googleKey,
          payload.timeoutMs,
        )
      : ''
    /* 403 站点：兜底抓取的 LinkedIn/Kompass/Europages 简介里**常含邮箱/电话**，
       此前只喂给 LLM 生成文案、**未挖掘联系方式**（免费信息被白白丢弃）。此处补齐。 */
    const socialContacts = socialFallbackText ? extractContactCandidates(socialFallbackText) : null
    const fallbackSnippet = trimWebsiteTextForLlm([snippet, socialFallbackText].filter(Boolean).join(' ')) || snippet
    const { system, user } = buildSnippetFallbackPrompt({
      keyword: payload.keyword,
      icpProfile: payload.icpProfile,
      candidate: {
        company: String(payload.candidate.company || '').trim(),
        website,
        snippet: fallbackSnippet,
        reason: Array.isArray(payload.candidate.matchReasons) ? payload.candidate.matchReasons[0] : '',
      },
    })
    const fallbackResponse = await withTimeoutGuard(
      fetchWithTimeout(
        payload.llmEndpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.llmKey}` },
          body: JSON.stringify({
            model: payload.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            response_format: { type: 'json_object' },
          }),
        },
        payload.timeoutMs,
      ),
      payload.timeoutMs,
      `Snippet fallback ${String(payload.candidate.company || '').trim() || website}`,
    ).catch(() => null)

    const blindLead = fallbackResponse?.ok
      ? mergeLlmResultsWithCandidates(
          [
            {
              company: String(payload.candidate.company || '').trim(),
              website,
              phone,
              address: String(payload.candidate.address || '').trim(),
              source: (String(payload.candidate.source || 'Google Maps') + enrichSourceSuffix).trim(),
              reason: Array.isArray(payload.candidate.matchReasons) ? payload.candidate.matchReasons[0] : '',
              snippet: fallbackSnippet,
            },
          ],
          extractLlmResults(await fallbackResponse.json().catch(() => ({}))),
        )[0]
      : null

    const websiteBlockedBy403 = websiteContent.failureCode === 'website_403'
    const blindScoreFailed = !blindLead
    const usedSocialFallback = Boolean(eligible403Fallback && socialFallbackText)

    return {
      ...payload.candidate,
      ...blindLead,
      website,
      /* 数据溯源必须在**两条返回路径**都成立：`blindLead` 为 null（LLM 盲评超时/失败）时
       * `...blindLead` 不展开任何字段，source 会退回 `payload.candidate.source`，
       * 导致邮箱/电话来自 Apollo 却只显示「Google Maps」——静默丢失数据溯源。
       * 故在此显式覆盖，确保与正常路径口径一致（Apollo 有贡献才加标，不虚标）。 */
      source: (String(payload.candidate.source || 'Google Maps') + enrichSourceSuffix).trim(),
      contact: contact || socialContacts?.contact || '',
      contactTitle: contactTitle || socialContacts?.contactTitle || '',
      email: email || socialContacts?.email || '',
      phone: phone || socialContacts?.phone || '',
      phoneKind,
      contactProvenance,
      decisionMakers,
      enrichmentCost,
      fallbackStatus: usedSocialFallback ? 'social_blind_score' : payload.candidate.fallbackStatus,
      matchReasons: [
        ...(Array.isArray(blindLead?.matchReasons) && blindLead?.matchReasons.length > 0
          ? blindLead.matchReasons
          : Array.isArray(payload.candidate.matchReasons)
            ? payload.candidate.matchReasons
            : []),
        blindScoreFailed && websiteBlockedBy403
          ? '官网存在防爬限制，且 AI 盲评超时失败，建议稍后重试或人工复核'
          : usedSocialFallback
            ? '官网访问受限，已基于 LinkedIn/Kompass/Europages 简介轻量评估'
            : '官网访问受限，基于简介轻量评估（官网无法访问）',
      ]
        .filter(Boolean)
        .slice(0, 2),
      riskFlags: [
        ...(websiteBlockedBy403 ? ['website_403'] : []),
        ...(blindScoreFailed ? ['blind_score_failed'] : []),
        '官网访问受限，建议人工复核',
      ]
        .filter(Boolean)
        .slice(0, 3),
      snippet: fallbackSnippet || probeText,
      salesStrategy: blindLead?.salesStrategy || payload.candidate.salesStrategy || '',
      matchScore: typeof blindLead?.matchScore === 'number' ? blindLead.matchScore : payload.candidate.matchScore,
    }
  }

  return {
    ...payload.candidate,
    website,
    contact,
    contactTitle,
    email,
    phone,
    phoneKind,
    contactProvenance,
    decisionMakers,
    enrichmentCost,
    source: (String(payload.candidate.source || 'Google Maps') + enrichSourceSuffix).trim(),
    matchReasons: [
      ...(Array.isArray(payload.candidate.matchReasons) ? payload.candidate.matchReasons : []),
      ...(outreachAngle ? [`网页深度探测判断：${sanitizePlainText(outreachAngle, 120)}`] : []),
    ]
      .filter(Boolean)
      .slice(0, 2),
    snippet: snippet || probeText,
    salesStrategy: outreachAngle,
  }
}

const getAnySearchConfig = (store: ConfigStore) => {
  const userConfig = getLatestUserConfigSnapshot(store)
  const providers: Array<{ id?: string; baseUrl?: string; apiKey?: string }> = Array.isArray(userConfig?.providers)
    ? userConfig.providers
    : []
  const anysearchCfg = providers.find((p) => p.id === 'anysearch')
  const apiKey = anysearchCfg?.apiKey?.trim() || getSecret('anysearch-api-key')?.trim() || ''
  const baseUrl = anysearchCfg?.baseUrl?.trim() || ''
  return { apiKey, baseUrl }
}

const normalizeAnySearchDecisionMaker = (dm: any) => ({
  name: String(dm?.name || '').trim(),
  title: String(dm?.title || '').trim(),
  email: String(dm?.email || '').trim(),
  phone: String(dm?.phone || '').trim(),
  linkedinUrl: dm?.linkedinUrl ? String(dm.linkedinUrl).trim() : undefined,
  source: String(dm?.source || 'AnySearch').trim(),
  confidenceScore: Number.isFinite(Number(dm?.confidenceScore))
    ? Math.max(0, Math.min(100, Number(dm.confidenceScore)))
    : 0,
})

const normalizeAnySearchResult = (item: any) => ({
  company: String(item?.company || item?.name || item?.title || '').trim(),
  website: String(item?.website || item?.url || item?.link || '').trim(),
  phone: String(item?.phone || item?.phoneNumber || '').trim(),
  address: String(item?.address || item?.location || '').trim(),
  source: 'AnySearch',
  reason: String(item?.reason || item?.snippet || item?.description || '').trim(),
  snippet: String(item?.snippet || item?.description || '').trim(),
  dataSourceType: [
    'customs_shipment',
    'trade_show',
    'yellow_pages',
    'linkedin_search',
    'facebook_search',
    'google_maps',
    'google_organic',
  ].includes(String(item?.dataSourceType || ''))
    ? (String(item?.dataSourceType) as DataSourceType)
    : undefined,
  exhibitionFootprints: Array.isArray(item?.exhibitionFootprints) ? item.exhibitionFootprints : undefined,
  customsData: item?.customsData
    ? {
        annualImportVolume: String(item.customsData.annualImportVolume || '').trim() || undefined,
        topSuppliers: Array.isArray(item.customsData.topSuppliers) ? item.customsData.topSuppliers : undefined,
        originCountries: Array.isArray(item.customsData.originCountries) ? item.customsData.originCountries : undefined,
        lastShipmentDate: String(item.customsData.lastShipmentDate || '').trim() || undefined,
      }
    : undefined,
  decisionMakers: Array.isArray(item?.decisionMakers)
    ? item.decisionMakers.map(normalizeAnySearchDecisionMaker)
    : undefined,
  agentStatus: item?.agentStatus
    ? {
        whatsappSent: Boolean(item.agentStatus.whatsappSent),
        whatsappStatus: ['pending', 'delivered', 'replied', 'failed'].includes(
          String(item.agentStatus.whatsappStatus || ''),
        )
          ? (String(item.agentStatus.whatsappStatus) as 'pending' | 'delivered' | 'replied' | 'failed')
          : undefined,
        linkedinContacted: Boolean(item.agentStatus.linkedinContacted),
        emailSequenceStage: Number.isFinite(Number(item.agentStatus.emailSequenceStage))
          ? Math.min(3, Math.max(0, Number(item.agentStatus.emailSequenceStage)))
          : 0,
      }
    : undefined,
})

const attemptAnySearch = async (
  keyword: string,
  country: string,
  city: string,
  apiKey: string,
  baseUrl: string,
  timeoutMs: number,
  dataSourceType?: DataSourceType,
): Promise<{ results: any[]; dataSourceType?: string }> => {
  const endpoint = baseUrl.replace(/\/$/, '') + '/v1/search/entity'
  const sourceMap: Partial<Record<DataSourceType, string[]>> = {
    customs_shipment: ['customs'],
    trade_show: ['trade_shows'],
    yellow_pages: ['yellow_pages'],
    linkedin_search: ['linkedin'],
    facebook_search: ['facebook'],
    google_maps: ['maps'],
  }
  const sources =
    dataSourceType && dataSourceType !== 'google_organic'
      ? sourceMap[dataSourceType] || ['customs', 'trade_shows', 'yellow_pages', 'linkedin', 'facebook', 'maps']
      : ['customs', 'trade_shows', 'yellow_pages', 'linkedin', 'facebook', 'maps']
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: keyword,
        country: country || undefined,
        city: city || undefined,
        sources,
        limit: SEARCH_CHANNEL_FETCH_LIMIT,
      }),
    },
    timeoutMs,
  )

  if (!response.ok) {
    const rawText = await response.text().catch(() => '')
    probeError('[Probe-AnySearch] Request failed:', { status: response.status, preview: rawText.substring(0, 200) })
    throw new Error(`AnySearch HTTP ${response.status}: ${rawText.substring(0, 100)}`)
  }

  const json: any = await response.json().catch(() => ({}))
  const rawResults = Array.isArray(json?.results)
    ? json.results
    : Array.isArray(json?.data?.results)
      ? json.data.results
      : Array.isArray(json?.data?.entities)
        ? json.data.entities
        : []

  return {
    results: rawResults.map(normalizeAnySearchResult).filter((item: any) => item.company.length > 0),
    dataSourceType: String(json?.dataSourceType || '').trim() || undefined,
  }
}

export const registerSearchHandlers = (ipcMain: Electron.IpcMain, store: ConfigStore) => {
  const { licenseGuard } = createLicenseService(store)

  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.SEARCH.EXECUTE,
    store,
    licenseGuard,
    'search_basic',
    async (_event, payload: SearchExecutePayload) => {
      try {
        const currentClaims = licenseGuard.getStoredClaims?.() || null
        probeLog('[Probe-Auth] Search execute triggered, license status:', {
          status: currentClaims?.status || 'no_claims',
          plan: currentClaims?.plan || 'none',
          expiresAt: currentClaims?.expiresAt || 0,
          featureCount: Array.isArray(currentClaims?.features) ? currentClaims.features.length : 0,
          featurePreview: Array.isArray(currentClaims?.features) ? currentClaims.features.slice(0, 8) : [],
        })

        const keyword = payload?.keyword?.trim()
        if (!keyword) return { success: false, error: 'Missing keyword' }

        const myJobId = crypto.randomUUID()
        /* P3-2：登记 owner 作用域的活跃 job；全局最新由 job-registry 内部维护（兼容） */
        const jobOwnerKey = _event?.sender?.id ?? 0
        registerActiveJob(jobOwnerKey, myJobId)
        const activeJobIdFor = (): string | null => getActiveJobIdFor(jobOwnerKey)

        emitStreamStart(_event.sender, 0)

        const userConfig = getLatestUserConfigSnapshot(store)
        const { googleLeads: googleConfig } = getGoogleConfig(store)
        const providers: Array<{ id?: string; baseUrl?: string }> = Array.isArray(userConfig?.providers)
          ? userConfig.providers
          : []
        const llmConfig = providers.find((k) => k.id === 'llm')
        const googleKey = getSecret(googleConfig.secretKey).trim()
        const googleBaseUrl = googleConfig.baseUrl
        const llmKey = getUserLlmApiKey(store)
        const llmBaseUrl = llmConfig?.baseUrl?.trim()
        const hasLlmConfig = Boolean(llmKey && llmBaseUrl)
        probeLog('[Probe-Config] Search provider config:', {
          hasGoogleKey: Boolean(googleKey),
          googleBaseUrl: googleBaseUrl || '',
          hasLlmKey: Boolean(llmKey),
          llmBaseUrl: llmBaseUrl || '',
          providerCount: providers.length,
        })

        const inputCity = typeof payload?.city === 'string' ? payload.city.trim() : ''
        const inputCountry = typeof payload?.country === 'string' ? payload.country.trim() : ''
        const filterOptions = payload?.filterOptions || {}
        /* Step 2E：分级补全授权（缺省：邮箱放行、手机关闭） */
        const enrichmentOptions = resolveEnrichmentOptions(payload?.enrichment)
        const dataSourceType = payload?.dataSourceType
        const configuredSearchTimeoutMs = Number(userConfig?.searchTimeoutMs) || DEFAULT_SEARCH_TIMEOUT_MS
        const timeoutMs = Math.max(DEFAULT_SEARCH_TIMEOUT_MS, configuredSearchTimeoutMs)
        /* LLM 超时上限 = SEARCH_LLM_TIMEOUT_MS (20s)。
           注意此处不能用 Math.max(DEFAULT_SEARCH_TIMEOUT_MS, ...)：那会把
           下限抬到 60s，导致 LLM 失败时每条线索等满 60s 才超时（50 条×并发2
           的最坏路径拖慢搜索 25 分钟以上）。 */
        const llmTimeoutMs = Math.min(timeoutMs, SEARCH_LLM_TIMEOUT_MS)
        probeLog('[Probe-Config] Quality controls:', {
          priorityWebsite: Boolean(filterOptions?.priorityWebsite),
          localDomainOnly: Boolean(filterOptions?.localDomainOnly),
          highRelevanceOnly: Boolean(filterOptions?.highRelevanceOnly),
          b2bRoleOnly: Boolean(filterOptions?.b2bRoleOnly),
          dataSourceType: dataSourceType || 'default',
        })

        const llmEndpoint = hasLlmConfig ? buildLlmEndpoint(llmBaseUrl || '') : ''
        if (!googleKey || !googleBaseUrl) {
          // ⚠️ 异常消息会沿 IPC 传到渲染层并直接显示在界面上，因此：
          //  1) 必须对用户可读（「缺少配置. Debug: key=[...], url=[...]」是开发期调试文案）
          //  2) **绝不能内插密钥或端点原文** —— 用户只填了半个 key 时原文会被回显到 UI
          //     构成密钥泄露。缺失明细走 probeLog，不进异常消息。
          probeLog('[Probe-Config] Search config missing:', {
            hasGoogleKey: Boolean(googleKey),
            hasGoogleBaseUrl: Boolean(googleBaseUrl),
          })
          throw new Error('搜索服务尚未配置：请先在「系统设置 → 基础配置」填写 Google 搜索密钥与接口地址。')
        }

        const intentMutation = await mutateSearchIntent({
          keyword,
          country: inputCountry,
          city: inputCity,
          llmEndpoint,
          llmKey,
          model: userConfig?.selectedModel || 'gpt-3.5-turbo',
          timeoutMs: llmTimeoutMs,
        })
        const country = intentMutation.country || inputCountry
        const city = intentMutation.city || inputCity
        /* P0-2：本地语言产品词变体进入确定性评分词库（多语言多源搜索执行宪法——
         本地语言变体并行补充，不得只让英文主干词参与 ICP 评分）。 */
        const coreProductTerms = [
          ...(intentMutation.pureEnglishProducts.length > 0
            ? intentMutation.pureEnglishProducts
            : extractKeywordAnchors(keyword)),
          ...Object.values(intentMutation.localizedProducts || {}).flat(),
        ]
        const deterministicKeywords = crossProductB2BKeywords(intentMutation.pureEnglishProducts, country)
        const intentKeywords =
          intentMutation.keywords.length > 0
            ? Array.from(new Set([...intentMutation.keywords.slice(0, 2), ...deterministicKeywords]))
                .filter(Boolean)
                .slice(0, 4)
            : deterministicKeywords
        const scoringKeyword = intentKeywords.join(' | ')
        const locationString = city && country ? `${city}, ${country}` : country ? String(country) : ''

        const localizedKeywordsMap = intentMutation.localizedKeywords
        const hasLocalizedVariants = Boolean(localizedKeywordsMap && Object.keys(localizedKeywordsMap).length > 0)

        const allSearchKeywords: Array<{ keyword: string; language: string }> = [
          ...intentKeywords.map((kw) => ({ keyword: kw, language: 'en' })),
        ]
        if (localizedKeywordsMap) {
          for (const [lang, terms] of Object.entries(localizedKeywordsMap)) {
            if (Array.isArray(terms)) {
              for (const term of terms.slice(0, 4)) {
                allSearchKeywords.push({ keyword: term, language: lang })
              }
            }
          }
        }

        /* 变体**总量**兜底（2026-10-11，宪法 SEARCH_VARIANT_LIMIT）：
           英文 ≤4 + 每语言 ≤4，但**语言数无上限** —— 多语言场景下会失控
           （实测 3 语言 → 17 变体 → SerpApi 53 次调用 → 免费额度 2 次搜索即耗尽）。
           此处按宪法硬截断，**英文变体排在前故优先保留**，砍掉的是靠后的本地语言变体。
           注意：这是**总量域**上限，与扇出并发域（SEARCH_FANOUT_CONCURRENCY=3）
           和评分并发域（SEARCH_LLM_CONCURRENCY=2）是不同维度，不得混读。 */
        if (allSearchKeywords.length > SEARCH_VARIANT_LIMIT) {
          probeLog('[Probe-Intent] Variant limit applied:', {
            before: allSearchKeywords.length,
            after: SEARCH_VARIANT_LIMIT,
          })
          allSearchKeywords.length = SEARCH_VARIANT_LIMIT
        }

        const localizedLanguages = localizedKeywordsMap
          ? Object.keys(localizedKeywordsMap)
              .filter((l) => l !== 'en')
              .join(', ')
          : ''

        emitStage(
          _event.sender,
          'fetching',
          hasLocalizedVariants
            ? `AI 智能解构成功！当前目标国家 [${country || 'Global'}] 语言 [${localizedLanguages}]，正在全渠道并发穿透以下高价值 B2B 变种词（含本地语言）：${allSearchKeywords.map((item) => `[${item.keyword}]`).join(', ')}`
            : `AI 智能解构成功！当前目标国家 [${country || 'Global'}]，正在全渠道并发穿透以下高价值 B2B 变种词：${intentKeywords.map((item) => `[${item}]`).join(', ')}`,
          'maps',
          {
            intentMutated: {
              country: country || 'Global',
              city,
              keywords: intentKeywords,
              localizedLanguages: hasLocalizedVariants ? localizedLanguages : undefined,
            },
          },
        )

        if (hasLocalizedVariants) {
          emitStage(
            _event.sender,
            'fetching',
            ` 检测到多语言搜索需求 [${localizedLanguages}]，English + 本地语言变体并行搜索中...`,
            'maps',
          )
          emitStage(
            _event.sender,
            'localized_search',
            ` 本地语言搜索变体已加入搜索管道: ${localizedLanguages}`,
            'maps',
            { localizedLanguages },
          )
        }

        const allOrganic: any[] = []
        const allLocal: any[] = []
        let activeSearchMode: 'maps' | 'maps-keyword-fallback' | 'organic-fallback' = city
          ? 'maps'
          : 'maps-keyword-fallback'
        const anySearchDecisionMakers: any[] = []
        let anySearchCustomsData: any | undefined = undefined
        const anySearchExhibitionFootprints: string[] = []
        let anySearchAgentStatus: any | undefined = undefined

        const anysearchCfg = getAnySearchConfig(store)
        const anySearchEnabled = Boolean(
          anysearchCfg.apiKey && anysearchCfg.baseUrl && dataSourceType !== 'google_organic',
        )
        if (anySearchEnabled) {
          emitStage(
            _event.sender,
            'fetching',
            'AnySearch 正在通过全网海关数据、全球展会名录及社媒多渠道深度穿透高管决策人...',
            'anysearch',
          )
        }
        emitStage(
          _event.sender,
          'fetching',
          dataSourceType === 'google_organic'
            ? ' 正在通过 Google 网页搜索引擎进行全局线索采集...'
            : '正在抓取 Google Maps / SerpApi 搜索结果...',
          dataSourceType === 'google_organic' ? 'organic-fallback' : 'maps',
        )

        const isSerpApi = /serpapi\.com/i.test(googleBaseUrl)
        const googleHost = getHostFromUrl(googleBaseUrl)
        const llmHost = getHostFromUrl(llmBaseUrl || '')
        if (googleHost) resetCircuitBreaker(googleHost)
        if (llmHost) resetCircuitBreaker(llmHost)

        /* 慢源后台聚合句柄：SerpApi 分支填充真实聚合器，非 SerpApi 为空（无渐进式慢源）。
           let 而非 const 以允许分支内赋值；双波代码（if/else 之后）在此作用域读取。 */
        let lateSourcesPromise: Promise<{ lateOrganic: any[]; lateLocal: any[] }> = Promise.resolve({
          lateOrganic: [],
          lateLocal: [],
        })

        if (isSerpApi) {
          const attemptSearch = async (mode: SerpSearchMode, modeQuery: string, modeLocation: string) => {
            const useOrganic = mode === 'organic-keyword'

            const nextOrganic: any[] = []
            const nextLocal: any[] = []

            for (let page = 0; page < 2; page += 1) {
              const pageEndpoint = useOrganic
                ? buildSerpApiOrganicEndpoint(modeQuery, googleKey, page * 10)
                : buildSerpApiMapsEndpoint(modeQuery, googleKey, modeLocation, page * 20)

              // 成本优化（P0）：先查内存缓存——同一关键词/位置/分页组合在
              // 一次会话内多次搜索（如调整 ICP 后重搜）命中时不再消耗 SerpApi 额度。
              const cachedJson = getSerpApiCached(pageEndpoint)
              if (cachedJson !== undefined) {
                nextOrganic.push(
                  ...(Array.isArray((cachedJson as any)?.organic_results) ? (cachedJson as any).organic_results : []),
                )
                nextLocal.push(
                  ...(Array.isArray((cachedJson as any)?.local_results)
                    ? (cachedJson as any).local_results
                    : Array.isArray((cachedJson as any)?.local_results?.places)
                      ? (cachedJson as any).local_results.places
                      : []),
                )
                break
              }

              const searchResponse = await fetchSerpApiWithRetry(pageEndpoint, timeoutMs)

              const rawText = await searchResponse.text()
              probeLog(
                '[Probe-API] SerpApi status:',
                searchResponse.status,
                'mode:',
                mode,
                'page:',
                page,
                'payload:',
                rawText.substring(0, 240),
              )
              if (!searchResponse.ok) {
                if (mode === 'maps-location' && isSerpApiUnsupportedLocationError(searchResponse.status, rawText)) {
                  if (googleHost) resetCircuitBreaker(googleHost)
                  throw new Error(`UNSUPPORTED_LOCATION::${getFriendlySerpApiError(searchResponse.status, rawText)}`)
                }
                probeError('[Probe-API] SerpApi request failed:', {
                  status: searchResponse.status,
                  mode,
                  preview: rawText.substring(0, 200),
                })
                throw new Error(getFriendlySerpApiError(searchResponse.status, rawText))
              }

              if (googleHost) resetCircuitBreaker(googleHost)

              let searchJson: any
              try {
                searchJson = rawText ? JSON.parse(rawText) : {}
              } catch {
                throw new Error('SerpApi 响应解析失败，请检查查询参数或稍后重试')
              }

              // 成本优化（P0）：仅缓存 HTTP 200 的成功响应；失败/降级响应不入缓存，
              // 避免把"当前被限流/降级"的状态错误复用到后续搜索。
              setSerpApiCached(pageEndpoint, searchJson)

              const pageOrganic = Array.isArray(searchJson?.organic_results) ? searchJson.organic_results : []
              const pageLocal = useOrganic
                ? []
                : Array.isArray(searchJson?.local_results)
                  ? searchJson.local_results
                  : Array.isArray(searchJson?.local_results?.places)
                    ? searchJson.local_results.places
                    : []

              nextOrganic.push(...pageOrganic)
              nextLocal.push(...pageLocal)

              // 成本优化（P0）：命中即停——第一页已有结果就不再翻第二页，
              // 单次搜索的 SerpApi 页调用从 2 次收敛为 1 次。
              if (page === 0 && (pageLocal.length > 0 || pageOrganic.length > 0)) break
              if (!useOrganic && pageLocal.length === 0) break
              if (useOrganic && pageOrganic.length === 0) break
              if (nextLocal.length >= SEARCH_CHANNEL_FETCH_LIMIT || nextOrganic.length >= SEARCH_CHANNEL_FETCH_LIMIT)
                break
            }

            return { nextOrganic, nextLocal }
          }
          const searchPlans: Array<{
            serpResult: any
            lateSources: Promise<{ anyResult: any; providerResults: ProviderResult[] }>
          }> = await mapLimitedConcurrency(
            allSearchKeywords,
            SEARCH_FANOUT_CONCURRENCY,
            async ({ keyword: mutatedKeyword, language: searchLanguage }) => {
              if (myJobId !== activeJobIdFor())
                return {
                  serpResult: { allOrganic: [], allLocal: [], activeSearchMode: 'organic-fallback' },
                  lateSources: Promise.resolve({ anyResult: null, providerResults: [] }),
                }
              const anySearchPromise = anySearchEnabled
                ? attemptAnySearch(
                    mutatedKeyword,
                    country,
                    city,
                    anysearchCfg.apiKey,
                    anysearchCfg.baseUrl,
                    timeoutMs,
                    dataSourceType,
                  ).catch((error) => {
                    if (myJobId !== activeJobIdFor()) return null
                    probeLog('[Probe-AnySearch] Level 0 failed, keeping SerpApi fallback:', {
                      keyword: mutatedKeyword,
                      message: error instanceof Error ? error.message : String(error || ''),
                    })
                    return null
                  })
                : Promise.resolve(null)
              const serpPromise = resolveSerpSearchPlan({
                keyword: mutatedKeyword,
                city,
                country,
                googleKey,
                timeoutMs,
                dataSourceType,
                attemptSearch: (mode, modeQuery, modeLocation) => attemptSearch(mode, modeQuery, modeLocation),
                onStage: (message, searchMode) => {
                  if (myJobId === activeJobIdFor()) emitStage(_event.sender, 'fetching', message, searchMode)
                },
                onFallback: (event, detail) => {
                  if (myJobId !== activeJobIdFor()) return
                  if (event === 'location-rejected') {
                    probeLog('[Probe-Fallback] Location rejected, switching to keyword-based query.', detail)
                  }
                  if (event === 'zero-local-organic') {
                    probeLog(
                      '[Probe-Fallback] Maps keyword returned zero local results, switching to Google Organic.',
                      detail,
                    )
                  }
                },
              })
              const providerQuery: ProviderQuery = {
                keyword: mutatedKeyword,
                language: searchLanguage || 'en',
                country,
                city,
                intentProducts: [],
                b2bAttributes: [],
                myJobId,
                googleKey: googleKey || undefined,
                anysearchApiKey: anysearchCfg.apiKey || undefined,
                anysearchBaseUrl: anysearchCfg.baseUrl || undefined,
                timeoutMs,
              }
              const registry = getOrCreateProviderRegistry()
              // Organic-only selection law (ARCH-STANDARDS §9.4): when the caller
              // explicitly selects `google_organic`, acquisition must stay Organic-only
              // and must NOT fan out to Maps/LinkedIn/customs/etc. Constrain the registry
              // to the organic provider; the default blind-search still dispatches to all.
              const providerIds: DataSourceType[] | undefined =
                dataSourceType === 'google_organic' ? ['google_organic'] : undefined
              const availableProviders = registry
                .getAvailableProviders({
                  googleKey,
                  anysearchApiKey: anysearchCfg.apiKey,
                  anysearchBaseUrl: anysearchCfg.baseUrl,
                })
                .filter((p) => !providerIds || providerIds.includes(p.id))
              if (availableProviders.length > 0 && myJobId === activeJobIdFor()) {
                probeLog(
                  '[Probe-Provider] Dispatching to providers:',
                  availableProviders.map((p) => p.name),
                )
              }
              const providerPromise = registry
                .executeAll(providerQuery, providerIds)
                .then((map) => {
                  const results: ProviderResult[] = []
                  for (const result of map.values()) {
                    results.push(...result.results)
                  }
                  return results
                })
                .catch((error) => {
                  if (myJobId !== activeJobIdFor()) return [] as ProviderResult[]
                  probeLog('[Probe-Provider] Registry execution failed:', {
                    keyword: mutatedKeyword,
                    message: error instanceof Error ? error.message : String(error || ''),
                  })
                  return [] as ProviderResult[]
                })
              /* 渐进式发射（P0 体验优化）：SerpApi 主源通常 10-30 秒返回，而 AnySearch
               深度穿透可能需要 2-3 分钟。此处不再等待全源到齐——主源结果立即返回
               用于第一波展示与评分；AnySearch/Provider 结果交给 lateSources 在
               评分期间后台聚合，到货后并入第二波。 */
              const serpResult = await serpPromise
              const lateSources = Promise.allSettled([anySearchPromise, providerPromise]).then(
                ([anySettled, providerSettled]) => ({
                  anyResult: anySettled.status === 'fulfilled' ? anySettled.value : null,
                  providerResults: providerSettled.status === 'fulfilled' ? providerSettled.value : [],
                }),
              )
              return { serpResult, lateSources }
            },
          )
          const lateSourcePromises = searchPlans.map((plan) => plan.lateSources)
          /* 第一波合并：仅 SerpApi 主源结果（AnySearch/Provider 由聚合器延后并入） */
          for (const plan of searchPlans) {
            if (myJobId !== activeJobIdFor()) break
            allOrganic.push(...plan.serpResult.allOrganic)
            allLocal.push(...plan.serpResult.allLocal)
            if (String(plan.serpResult.activeSearchMode) === 'organic-fallback') activeSearchMode = 'organic-fallback'
          }
          /* 第二波聚合器：AnySearch 深度穿透 + Provider 管道结果（与第一波评分并行执行）。
           决策人/海关/展会/Agent 状态维持原有全量共享语义聚合。 */
          const aggregateLateSources = async (): Promise<{ lateOrganic: any[]; lateLocal: any[] }> => {
            const settled = await Promise.all(lateSourcePromises)
            const lateOrganic: any[] = []
            const lateLocal: any[] = []
            if (myJobId !== activeJobIdFor()) return { lateOrganic, lateLocal }
            for (const late of settled) {
              if (late.anyResult?.results?.length) {
                lateOrganic.push(
                  ...late.anyResult.results.map((item: any) => ({
                    company: item.company,
                    website: item.website,
                    phone: item.phone,
                    address: item.address,
                    source: item.source,
                    reason: item.reason,
                    snippet: item.snippet,
                    dataSourceType: item.dataSourceType,
                    decisionMakers: item.decisionMakers,
                    customsData: item.customsData,
                    exhibitionFootprints: item.exhibitionFootprints,
                    agentStatus: item.agentStatus,
                  })),
                )
                anySearchDecisionMakers.push(
                  ...late.anyResult.results.flatMap((item: any) => item.decisionMakers || []).filter(Boolean),
                )
                anySearchCustomsData =
                  anySearchCustomsData || late.anyResult.results.find((item: any) => item.customsData)?.customsData
                anySearchExhibitionFootprints.push(
                  ...late.anyResult.results.flatMap((item: any) => item.exhibitionFootprints || []).filter(Boolean),
                )
                anySearchAgentStatus =
                  anySearchAgentStatus || late.anyResult.results.find((item: any) => item.agentStatus)?.agentStatus
              }
              if (late.providerResults.length) {
                lateOrganic.push(
                  ...late.providerResults.map((item: ProviderResult) => ({
                    company: item.company,
                    website: item.website,
                    phone: item.phone,
                    address: item.address,
                    contact: item.contact,
                    contactTitle: item.contactTitle,
                    email: item.email,
                    source: item.source,
                    reason: item.reason,
                    snippet: item.snippet,
                    dataSourceType: item.source,
                    dataSourceNote: item.dataSourceNote,
                    decisionMakers: item.decisionMakers,
                    customsData: item.customsData,
                    exhibitionFootprints: item.exhibitionFootprints,
                    agentStatus: item.agentStatus,
                  })),
                )
                anySearchDecisionMakers.push(
                  ...late.providerResults.flatMap((item: ProviderResult) => item.decisionMakers || []).filter(Boolean),
                )
                anySearchCustomsData =
                  anySearchCustomsData ||
                  late.providerResults.find((item: ProviderResult) => item.customsData)?.customsData
                anySearchExhibitionFootprints.push(
                  ...late.providerResults
                    .flatMap((item: ProviderResult) => item.exhibitionFootprints || [])
                    .filter(Boolean),
                )
                anySearchAgentStatus =
                  anySearchAgentStatus ||
                  late.providerResults.find((item: ProviderResult) => item.agentStatus)?.agentStatus
              }
            }
            return { lateOrganic, lateLocal }
          }
          lateSourcesPromise = aggregateLateSources()
        } else {
          const rawSearches = await Promise.allSettled(
            allSearchKeywords.map(async ({ keyword: mutatedKeyword }) => {
              if (myJobId !== activeJobIdFor()) return {}
              const searchResponse = await fetchWithTimeout(
                buildSearchEndpoint(googleBaseUrl),
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${googleKey}` },
                  body: JSON.stringify({ keyword: mutatedKeyword, country, city, limit: SEARCH_CHANNEL_FETCH_LIMIT }),
                },
                timeoutMs,
              )

              const rawText = await searchResponse.text()
              probeLog(
                '[Probe-API] Search service status:',
                searchResponse.status,
                'payload:',
                rawText.substring(0, 240),
              )
              if (!searchResponse.ok) throw new Error(mapHttpError(searchResponse.status, '搜索服务'))

              try {
                return rawText ? JSON.parse(rawText) : {}
              } catch {
                throw new Error('SerpApi 响应解析失败，请检查查询参数或稍后重试')
              }
            }),
          )
          for (const result of rawSearches) {
            if (myJobId !== activeJobIdFor()) break
            const searchJson = result.status === 'fulfilled' ? result.value : {}
            allOrganic.push(
              ...(Array.isArray(searchJson?.organic_results)
                ? searchJson.organic_results
                : Array.isArray(searchJson?.results)
                  ? searchJson.results
                  : Array.isArray(searchJson?.data?.results)
                    ? searchJson.data.results
                    : Array.isArray(searchJson?.items)
                      ? searchJson.items
                      : Array.isArray(searchJson?.data?.items)
                        ? searchJson.data.items
                        : []),
            )
            allLocal.push(
              ...(Array.isArray(searchJson?.local_results)
                ? searchJson.local_results
                : Array.isArray(searchJson?.local_results?.places)
                  ? searchJson.local_results.places
                  : []),
            )
          }
        }

        emitStage(_event.sender, 'normalizing', '正在整理候选客户并去重...')
        const { filteredLocalResults, normalizedCandidates } = normalizeSearchResponseCandidates(
          allOrganic,
          allLocal,
          city,
          locationString,
        )
        emitStage(_event.sender, 'prefiltering', ' 正在执行相关度预筛，剔除泛化结果...')
        probeLog('[Probe-Filter] Filter applied:', {
          priorityWebsite: Boolean(filterOptions?.priorityWebsite),
          localDomainOnly: Boolean(filterOptions?.localDomainOnly),
          highRelevanceOnly: Boolean(filterOptions?.highRelevanceOnly),
          b2bRoleOnly: Boolean(filterOptions?.b2bRoleOnly),
        })
        // P1-3 search-quality observability: aggregate discard reasons into named
        // categories (not just per-candidate log lines) so prefilter behaviour is
        // auditable via a structured probe (ipc-agent.md §8.5 / ARCH §5.9). This is
        // observation only — the 40/30/20/10 scoring constitution is untouched.
        const discardReasons: Record<string, number> = {}
        const recordDiscard = (reason: string) => {
          discardReasons[reason] = (discardReasons[reason] || 0) + 1
        }
        const candidates = normalizedCandidates.filter((candidate) => {
          if (isTrashLead(candidate)) {
            recordDiscard('trash')
            probeLog(`[Probe-AntiTrash] Discarded: ${candidate.company}`)
            return false
          }
          const relevance = computeScoutRelevance(candidate, scoringKeyword, {
            priorityWebsite: Boolean(filterOptions?.priorityWebsite),
            b2bRoleOnly: Boolean(filterOptions?.b2bRoleOnly),
            /* L1-2/N1：本土域名开关主进程挂载（此前仅前端二次过滤） */
            localDomainOnly: Boolean(filterOptions?.localDomainOnly),
            countryTlds:
              COUNTRY_TLD_MAP[
                String(country || '')
                  .trim()
                  .toLowerCase()
              ] || [],
          })
          if (!relevance.keep) {
            recordDiscard(relevance.reason || 'low_relevance')
            probeLog(`[Probe-Prefilter] Discarded: ${candidate.company} (Reason: ${relevance.reason})`)
            return false
          }
          /* P0-2 Eligibility Gate：软过滤之后的结构化一票否决（kone-PRD §0.5.1）。
           命中即剔除，不进 ICP 评分与 Agent 管道。 */
          const veto = computeEligibilityVeto(candidate)
          if (veto.blocked) {
            recordDiscard(`准入硬否决:${veto.category}`)
            probeLog(`[Probe-EligibilityGate] Vetoed: ${candidate.company} (Category: ${veto.category})`)
            return false
          }
          return true
        })
        probeLog('[Probe-Prefilter-Summary] Prefilter kept/discarded:', {
          input: normalizedCandidates.length,
          kept: candidates.length,
          discarded: normalizedCandidates.length - candidates.length,
          discardReasons,
        })
        probeLog('[Probe-Normalize] Candidate summary:', {
          organicCount: allOrganic.length,
          localCount: allLocal.length,
          filteredLocalCount: filteredLocalResults.length,
          candidateCount: candidates.length,
          discardedCount: normalizedCandidates.length - candidates.length,
          firstCandidate: candidates[0] || null,
          activeSearchMode,
          anySearchEnabled,
        })

        /* ── V1.3 AnySearch 多源字段注入 ── */
        const mergedLeads = mergeLeadFacts(
          candidates.map((candidate) => ({
            ...candidate,
            dataSourceType:
              candidate.dataSourceType ||
              ((activeSearchMode as string) === 'organic-fallback'
                ? ('google_organic' as const)
                : ('google_maps' as const)),
            decisionMakers:
              candidate.decisionMakers || (anySearchDecisionMakers.length ? anySearchDecisionMakers : undefined),
            customsData: candidate.customsData || anySearchCustomsData,
            exhibitionFootprints:
              candidate.exhibitionFootprints ||
              (anySearchExhibitionFootprints.length ? anySearchExhibitionFootprints : undefined),
            agentStatus: candidate.agentStatus || anySearchAgentStatus,
          })),
        )
        /* P0-4 决策人静态验证（G4）：email 静态分级（格式/disposable/role）+
         phone E.164 校验，零网络成本。不臆造 confidenceScore——前端依据
         confidenceScore<=0 渲染 "AI 推测，未验证" 降级徽标。 */
        const contactValidatedLeads = mergedLeads.map((lead) =>
          Array.isArray(lead.decisionMakers) && lead.decisionMakers.length > 0
            ? { ...lead, decisionMakers: validateDecisionMakerContacts(lead.decisionMakers) }
            : lead,
        )
        const scoredMergedLeads = contactValidatedLeads.map((lead) => ({
          ...lead,
          // Stamp a stable id ONCE at this shared upstream so the frontend
          // (emitBasicResults → applySchemaDefaults preserves existing id) and the
          // agent pipeline (buildAgentTaskQueue → AgentTask.leadKey) key on the SAME
          // identifier. Without this both surfaces get divergent random UUIDs and the
          // agentStatus write-back cannot be correlated (kone-PRD §0.7 / §3.7.3).
          id: (lead as Partial<SearchExecuteResult>).id || crypto.randomUUID(),
          matchScore: computeIcpMatchScore(lead as Partial<SearchExecuteResult>, coreProductTerms),
        }))
        /* S4a：用户自定义**负向 ICP 确定性护栏** —— 命中即封顶降权 + 写入可解释 riskFlag。
           此前 negativeIcp 只是 LLM prompt 里的**软约束**（LLM 可能忽略）。
           放在此处（排序/预筛之前）可同时影响初始排序、高相关过滤与首屏展示。
           S4c：叠加**用户反馈闭环**（曾标「不相关」→ 封顶；曾标「相关」→ 小幅加分）。 */
        const negativeIcpProfile = userConfig?.icpProfile?.negativeIcp
        const leadFeedback = (userConfig as { leadFeedback?: LeadFeedbackMap } | undefined)?.leadFeedback
        const guardedMergedLeads = scoredMergedLeads.map((lead) =>
          applyFeedbackAdjustment(
            applyNegativeIcpPenalty(lead, negativeIcpProfile),
            leadFeedback?.[deriveFeedbackKey(lead)],
          ),
        )

        /* 宪法排序（kone-PRD §0.5.1 / L176 / L207 / L211）：确定性预评分（40/30/20/10）
           "在 LLM 评分执行前必运行，为**初始排序与预筛漏斗**服务"，且多源增强字段
           "不得绕过此确定性预评分直接进入高潜推荐"。
           故必须**先按 matchScore 降序排序**（未评分按 -1 兜底，同 PRD 排序法典），
           再做高相关过滤与 `slice(0, SEARCH_TARGETED_LEAD_LIMIT)`。
           否则切片退化为"按数据源合并顺序取前 50"——合并顺序为 [...local, ...organic]，
           本地(Maps)结果会挤掉有机(Organic)结果，**高相关线索可能根本不进入 AI 评分**，
           与"精准获客"直接冲突。 */
        const rankedMergedLeads = rankByMatchScore(guardedMergedLeads)

        /* L1-2/N1：高相关过滤（只看高相关） —— 严格对齐前端“只看高相关”的语义：
         matchScore >= 60，未评分项视为不通过（0 < 60）。在 ICP 评分完成后、
         入选 targetedLeads 切片前执行，与前端语义严格对齐。 */
        const relevanceFilteredLeads = filterOptions?.highRelevanceOnly
          ? rankedMergedLeads.filter((lead) => typeof lead.matchScore === 'number' && (lead.matchScore as number) >= 60)
          : rankedMergedLeads

        if (filterOptions?.highRelevanceOnly) {
          probeLog('[Probe-Filter] HighRelevanceOnly discarded:', {
            input: guardedMergedLeads.length,
            kept: relevanceFilteredLeads.length,
            discarded: guardedMergedLeads.length - relevanceFilteredLeads.length,
          })
        }

        const targetedLeads = relevanceFilteredLeads.slice(0, SEARCH_TARGETED_LEAD_LIMIT)
        const leadsForScoring = targetedLeads.slice(0, SEARCH_LLM_SCORE_LIMIT)

        if (targetedLeads.length === 0) {
          probeLog('[Probe-IPC] Zero-candidate path reached, emitting complete stage and stream complete')
          emitStage(_event.sender, 'complete', '分析完成，未发现符合条件的线索')
          emitStreamComplete(_event.sender)
          return { success: true, data: { results: [] } }
        }

        emitStreamStart(_event.sender, targetedLeads.length)
        emitBasicResults(_event.sender, targetedLeads)
        // P1-3 contact-info acquisition-rate quality probe: quantify how many
        // targetedLeads carry email/phone (agent reachability). This is NOT an
        // outcome goal (agents send when they should), but an upstream data-quality
        // indicator showing how often the search providers deliver actionable assets.
        const withEmail = targetedLeads.filter((l) => l.email).length
        const withPhone = targetedLeads.filter((l) => l.phone).length
        probeLog('[Probe-ContactRate] Targeted leads contact-info coverage:', {
          total: targetedLeads.length,
          withEmail,
          withPhone,
          emailRate: targetedLeads.length ? (withEmail / targetedLeads.length).toFixed(2) : '0.00',
          phoneRate: targetedLeads.length ? (withPhone / targetedLeads.length).toFixed(2) : '0.00',
        })
        probeLog('[Probe-IPC] Basic results emitted:', {
          total: targetedLeads.length,
          scoringCount: leadsForScoring.length,
          activeSearchMode,
        })

        if (!hasLlmConfig) {
          if (!llmKey) {
            probeError('[Probe-Auth] LLM key missing, skipping scoring phase', {
              candidateCount: targetedLeads.length,
              hasLlmBaseUrl: Boolean(llmBaseUrl),
            })
          }
          if (!llmBaseUrl) {
            probeError('[Probe-Auth] LLM base URL missing, skipping scoring phase', {
              candidateCount: targetedLeads.length,
              hasLlmKey: Boolean(llmKey),
            })
          }
          const fallbackSourceLabel = targetedLeads.some((item) => String(item.source || '').includes('Organic'))
            ? '网页搜索'
            : 'Google Maps'
          emitStage(_event.sender, 'complete', `已返回 ${fallbackSourceLabel} 基础结果（未启用 AI 评分）`)
          emitStreamComplete(_event.sender)
          // Pipeline: STAGE qualified leads for human review (never auto-send)
          // P0-8 修复：管道暂存失败必须被观测，不得成为 unhandledRejection。
          void withPipelineIsolation(async (runId) => {
            const pipelineQueue = buildAgentTaskQueue(targetedLeads)
            stageAgentsFromPipeline(pipelineQueue, _event.sender, store, runId)
          }).catch((err) => {
            probeLog('pipeline_stage_failed', err instanceof Error ? err.message : String(err))
          })
          return { success: true, data: { results: targetedLeads.map((item) => applySchemaDefaults(item)) } }
        }

        /* 评分+富化 提取为可复用函数（渐进式两波共用）：
           - tScore: 本轮待 AI 评分的线索（第一波=主源、第二波=慢源新增）
           - tFinal: 本轮用于重建富化后最终结果集的完整线索（决定 finalResults 全集）
           每个调用获得独立的 cleanedResults/completedCount/熔断窗口（本地 const 天然隔离），
           符合渐进式两波各自独立评分的语义。 */
        const executeScoring = async (
          tScore: SearchExecuteResult[],
          tFinal: SearchExecuteResult[],
        ): Promise<SearchExecuteResult[]> => {
          probeLog('[Probe-IPC] Scoring queue starting', {
            candidateCount: tScore.length,
            concurrency: SEARCH_LLM_CONCURRENCY,
          })
          emitStage(_event.sender, 'scoring', '正在进行 ICP 智能评估...')

          if (!llmKey || !llmEndpoint) {
            probeError('[Probe-Auth] LLM config inconsistent after scoring gate', {
              hasLlmKey: Boolean(llmKey),
              hasLlmEndpoint: Boolean(llmEndpoint),
              candidateCount: leadsForScoring.length,
            })
            throw new Error('未检测到有效的 LLM 鉴权配置，无法执行 ICP 智能评估')
          }

          const cleanedResults: SearchExecuteResult[] = []
          let completedCount = 0
          /* LLM 持续失败快速降级（v2）：
           - 失败率滑动窗口（最近 10 次请求中网络失败 ≥ 50%）触发熔断，替代早期
             "连续失败 5 次"——对 LLM 偶发抖动更宽容，避免误伤整轮评分
           - 仅"服务不可达"类失败（网络/超时/5xx）计入窗口；HTTP 4xx（key 无效
             等配置错误）直接兜底提示、不熔断；LLM 200 但内容解析失败视为
             "可达"，不进失败窗口
           - 熔断后剩余线索走确定性兜底（诚实标注），LLM 恢复后下次搜索自动
             回到全量 AI 评分 */
          const CIRCUIT_WINDOW = 10
          const CIRCUIT_FAIL_RATE = 0.5
          const recentOutcomes: boolean[] = []
          let llmCircuitOpen = false
          const recordOutcome = (ok: boolean): boolean => {
            recentOutcomes.push(ok)
            if (recentOutcomes.length > CIRCUIT_WINDOW) recentOutcomes.shift()
            if (recentOutcomes.length < CIRCUIT_WINDOW) return false
            const fails = recentOutcomes.filter((o) => !o).length
            return fails / recentOutcomes.length >= CIRCUIT_FAIL_RATE
          }
          const isServiceUnavailableError = (error: unknown): boolean =>
            isTimeoutError(error) ||
            (typeof (error as { status?: unknown })?.status === 'number' &&
              Number((error as { status?: unknown }).status) >= 500)
          await runLimitedConcurrency(tScore, SEARCH_LLM_CONCURRENCY, async (candidate, index) => {
            if (myJobId !== activeJobIdFor()) return
            if (llmCircuitOpen) {
              const fallbackLead = applySchemaDefaults({
                ...candidate,
                scoreSource: 'deterministic',
                matchReasons: ['AI 评估服务持续不可达，已降级为基础评分'],
                riskFlags: ['官网访问超时或 AI 评估失败'],
              })
              cleanedResults[index] = fallbackLead
              completedCount += 1
              emitLeadScored(_event.sender, fallbackLead, completedCount, tScore.length)
              return
            }
            /* P0 成本优化：评分缓存——同 ICP + 同关键词 + 同公司 24h 内复用评分结果，
             命中时跳过 LLM 调用（零网络等待、进度条照常推进）。ICP 或关键词
             变化自动换 key，不会跨评估上下文误用旧评分。key 提升到 try 外以便
             catch 分支记录诊断信息。 */
            const scoreCacheKey = buildLlmScoreCacheKey(userConfig?.icpProfile || undefined, scoringKeyword, candidate)
            try {
              const cachedLlmResult = getLlmScoreCached<SearchExecuteResult[]>(scoreCacheKey)
              if (Array.isArray(cachedLlmResult) && cachedLlmResult.length > 0) {
                probeLog('[Probe-LLM-Cache] Score cache hit:', {
                  company: candidate.company,
                  website: candidate.website,
                  key: scoreCacheKey,
                })
                const cachedScoredLead = mergeLlmResultsWithCandidates([candidate], cachedLlmResult)[0]
                recordOutcome(true)
                const nextLead = cachedScoredLead
                  ? applySchemaDefaults({ ...cachedScoredLead, scoreSource: 'ai' })
                  : applySchemaDefaults({ ...candidate, scoreSource: 'deterministic' })
                cleanedResults[index] = nextLead
                completedCount += 1
                emitLeadScored(_event.sender, nextLead, completedCount, tScore.length)
                return
              }
              probeLog('[Probe-LLM] Scoring candidate:', {
                index,
                company: candidate.company,
                website: candidate.website,
                timeoutMs: llmTimeoutMs,
              })
              const { system, user } = buildSearchScoringPrompt({
                keyword: scoringKeyword,
                icpProfile: userConfig?.icpProfile || undefined,
                candidates: [candidate],
              })
              probeLlmRequest(llmBaseUrl)
              const llmResponse = await withTimeoutGuard(
                fetchWithTimeout(
                  llmEndpoint,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmKey}` },
                    body: JSON.stringify({
                      model: userConfig?.selectedModel || 'gpt-3.5-turbo',
                      messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: user },
                      ],
                      response_format: { type: 'json_object' },
                    }),
                  },
                  llmTimeoutMs,
                ),
                llmTimeoutMs,
                `Scoring LLM ${candidate.company || candidate.website || index}`,
              )
              probeLog('[Probe-LLM] Scoring candidate response:', {
                index,
                company: candidate.company,
                status: llmResponse.status,
              })

              if (!llmResponse.ok) throw new Error(mapHttpError(llmResponse.status, 'LLM'))

              const llmJson: any = await llmResponse.json().catch(() => ({}))
              const llmResults = extractLlmResults(llmJson)
              /* P0 成本优化：评分成功即写入缓存（同 ICP+关键词+公司 24h 复用），
               仅缓存 LLM 语义字段（extractLlmResults 输出），不含线索 UUID；
               命中时走完全相同的 merge/applySchemaDefaults 路径，口径零差异。 */
              if (Array.isArray(llmResults) && llmResults.length > 0) {
                setLlmScoreCached(scoreCacheKey, llmResults)
              }
              const scoredLead = mergeLlmResultsWithCandidates([candidate], llmResults)[0]
              /* P1-1 置信标识：LLM 评分成功 → ai；评分失败走模板兜底 → deterministic。
               LLM 可达（200 且可解析）即记成功——即使未解析出结构化分也不计失败窗口 */
              recordOutcome(true)
              const nextLead = scoredLead
                ? applySchemaDefaults({ ...scoredLead, scoreSource: 'ai' })
                : applySchemaDefaults({ ...candidate, scoreSource: 'deterministic' })
              cleanedResults[index] = nextLead
              completedCount += 1
              emitLeadScored(_event.sender, nextLead, completedCount, tScore.length)
            } catch (error) {
              probeLlmCrash(error)
              probeError(
                '[Probe-LLM-Error] Candidate:',
                candidate.company,
                'Error:',
                error instanceof Error ? error.message : String(error || ''),
                error instanceof Error ? error.stack : '',
              )
              probeLog('[Probe-LLM-Error-Ctx] Cache key:', scoreCacheKey)
              /* 仅服务不可达类失败（网络/超时/5xx）计入失败窗口；HTTP 4xx 为配置
               错误不熔断（每次都会快速兜底提示），避免误伤整轮评分 */
              if (isServiceUnavailableError(error) && !llmCircuitOpen && recordOutcome(false)) {
                llmCircuitOpen = true
                probeError('[Probe-LLM] Failure circuit opened:', {
                  window: CIRCUIT_WINDOW,
                  failRate: CIRCUIT_FAIL_RATE,
                  remaining: tScore.length - completedCount,
                })
                emitStage(_event.sender, 'scoring', 'AI 评估服务持续不可达，剩余线索已降级为基础评分')
              }
              const fallbackLead = applySchemaDefaults({
                ...candidate,
                scoreSource: 'deterministic',
                matchReasons: ['评估失败，已保留基础信息'],
                riskFlags: ['官网访问超时或 AI 评估失败'],
              })
              cleanedResults[index] = fallbackLead
              completedCount += 1
              probeLog('[Probe-LLM] Candidate fallback emitted:', {
                index,
                company: candidate.company,
                message: error instanceof Error ? error.message : String(error || ''),
              })
              emitLeadScored(_event.sender, fallbackLead, completedCount, tScore.length)
            }
          })

          if (cleanedResults.length > 0) {
            emitStage(_event.sender, 'enriching', '正在补全官网与商业信号...')
            const baseResults = cleanedResults.filter(Boolean)
            /* 密集数组兜底（2026-10-12 修复真实缺陷）：
               并发 worker 在「job 被抢占」时会**提前 `return`**（`if (myJobId !== activeJobIdFor()) return`，
               见下方），该索引**不会被写回**。若用 `new Array(n)` 初始化，数组会留下**空洞（hole）**；
               随后 `new Map(sparseResults.map(...))` 因 `Array.prototype.map` **跳过空洞**而产出稀疏数组，
               `new Map()` 迭代空洞时得到 `undefined` → 抛
               `TypeError: Iterator value undefined is not an entry object` → **整轮搜索直接中断**
               （实测复现：50 条线索全部评完、富化进行中被此错误打断）。
               改为以 `baseResults` 浅拷贝初始化：每个索引都有值，未富化者回落为原始线索。 */
            const enrichedResults: SearchExecuteResult[] = baseResults.slice()
            /* 2026-10-11：Apollo 富化每轮搜索的查询预算计数器（总量护栏）。
             * 由 enrichLeadWithDeepProbe 内共享读取/累加，超预算即静默降级到官网抓取。 */
            const enrichBudget = { used: 0, limit: ENRICH_LOOKUP_BUDGET }
            /* 2026-10-13：Prospeo 预算（Apollo 的低成本前置）。邮箱与手机**独立计数**：
               邮箱 ≈2 credits/条、手机 10 credits/条 → 手机预算更小，防止一轮烧光额度。 */
            const prospeoEmailBudget = { used: 0, limit: PROSPEO_EMAIL_BUDGET }
            const prospeoMobileBudget = { used: 0, limit: PROSPEO_MOBILE_BUDGET }
            await runLimitedConcurrency(baseResults, SEARCH_ENRICH_CONCURRENCY, async (item, index) => {
              if (myJobId !== activeJobIdFor()) return
              /* 性能/成本平衡：仅对高分线索（≥60，会进入 Agent 管道）做 LLM 深探；
               低分线索只做官网抓取（邮箱/电话提取独立于 LLM，仍有价值）。
               熔断时同样跳过 LLM 深探但保留官网抓取。 */
              const highValue = typeof item.matchScore === 'number' && item.matchScore >= 60
              const skipLlmProbe = llmCircuitOpen || !highValue
              try {
                const enriched = await withTimeoutGuard(
                  enrichLeadWithDeepProbe({
                    candidate: item,
                    llmEndpoint,
                    llmKey,
                    model: userConfig?.selectedModel || 'gpt-3.5-turbo',
                    timeoutMs: llmTimeoutMs,
                    keyword: scoringKeyword,
                    country,
                    googleKey,
                    icpProfile: userConfig?.icpProfile || undefined,
                    skipLlmProbe,
                    highValue,
                    enrichBudget,
                    prospeoEmailBudget,
                    prospeoMobileBudget,
                    enrichmentOptions,
                  }),
                  /* 外层守卫必须 ≥ 内部最坏耗时（官网抓取 15s + LLM 深探 20s = 35s），
                   否则高分线索的深探总是被外层守卫砍掉，表现为大量
                   "官网访问超时或 AI 评估失败"（此前 llmTimeoutMs 恒 60s 掩盖了此问题）。
                   2026-10-11：追加 Apollo 富化（约 15s，仅高价值线索串行触发）→ 预算上抬至
                   20 + 15 + 15 = 50s，仍在 SEARCH_TOTAL_TIMEOUT_MS(5min) 总时长预算内。 */
                  llmTimeoutMs + WEBSITE_PROBE_TIMEOUT_MS * 2,
                  `Enrich lead ${item.company || item.website || index}`,
                )
                enrichedResults[index] = applySchemaDefaults(enriched)
              } catch (error) {
                probeLog('[Probe-Fetch] Enrichment fallback triggered:', {
                  index,
                  company: item.company,
                  message: error instanceof Error ? error.message : String(error || ''),
                })
                enrichedResults[index] = applySchemaDefaults({
                  ...baseResults[index],
                  riskFlags: Array.from(
                    new Set([...(baseResults[index].riskFlags || []), '官网访问超时或 AI 评估失败']),
                  ).slice(0, 1),
                })
              }
            })
            const scoredResults = enrichedResults.map((item, index) => {
              const base = baseResults[index]
              const result = item || applySchemaDefaults(base)
              /* P1-1：富化重建时保留评分来源标识（丢失则回退确定性） */
              return { ...result, scoreSource: result.scoreSource || base?.scoreSource || 'deterministic' }
            })
            const scoredByKey = new Map(
              scoredResults.map((item) => [
                extractDomainFromUrl(item.website) || `${item.company.toLowerCase()}|${item.address.toLowerCase()}`,
                item,
              ]),
            )
            const finalResults = tFinal.map((item) => {
              const scored = scoredByKey.get(
                extractDomainFromUrl(item.website) ||
                  `${String(item.company || '').toLowerCase()}|${String(item.address || '').toLowerCase()}`,
              )
              // Preserve the stable upstream id so the pipeline leadKey stays correlated
              // with the id already emitted to the frontend via emitBasicResults.
              /* P1-1：未经 LLM 评分的尾部线索显式标记为确定性评分 */
              return scored
                ? { ...scored, id: item.id || scored.id }
                : applySchemaDefaults({ ...item, scoreSource: 'deterministic' })
            })
            return finalResults.slice(0, SEARCH_TARGETED_LEAD_LIMIT) || []
          }
          /* 本轮评分为空（全部兜底失败）：返回确定性转换的原候选 */
          return tFinal
            .slice(0, SEARCH_TARGETED_LEAD_LIMIT)
            .map((item) => applySchemaDefaults({ ...item, scoreSource: 'deterministic' }))
        }

        /* ── 渐进式双波执行 ──
           第一波：对主源（SerpApi）线索评分并展示（前端已通过第一波 emitBasicResults 看到列表）。
           第二波：等待 AnySearch/Provider 深度穿透到货，对慢源新增线索追评分，
           并把两波结果合并后统一 emitBasicResults 全量、投放 Agent 一次（防重复）。 */
        const firstPass = await executeScoring(leadsForScoring, targetedLeads)
        /* 渐进式语义澄清：首屏列表已在 emitStreamStart 后由 emitBasicResults(targetedLeads)
           发出（matchScore 剥离=「待评估」），主源 AI 评分通过 emitLeadScored 逐条流式
           回填（前端 onSearchLeadScored 按 leadKey/website/company 合并、保留已到分数）。
           此处不应再发 emitBasicResults——前端 onSearchBasicResults 是全量替换，会冲掉
           emitLeadScored 已回填的 matchScore。仅在慢源追评合并后发一次全量（preserveScore
           保留 AI 分），用于把慢源新增线索加入列表。 */
        /* 慢源等待设置超时上限：主源评分完成后，给深度穿透至多 120 秒补位。
           到时未到则用已到结果收尾，保证 complete 有界、不无限等待。
           测试可通过 KONE_LATE_SOURCE_TIMEOUT_MS 环境变量缩短（如 100ms），
           避免 provider mock 永不 settle 导致单测挂 120s。 */
        const LATE_SOURCE_TIMEOUT_MS = Number(process.env.KONE_LATE_SOURCE_TIMEOUT_MS) || 120_000
        /* P0-8 修复：主源先完成时必须 clearTimeout，否则会留下一个悬空 120s 定时器
           （长驻主进程定时器累积会推迟事件循环退出并掩盖真实句柄泄漏）。 */
        let lateSourceTimer: NodeJS.Timeout | null = null
        const wave2 = await Promise.race([
          lateSourcesPromise,
          new Promise<{ lateOrganic: any[]; lateLocal: any[] }>((resolve) => {
            lateSourceTimer = setTimeout(() => resolve({ lateOrganic: [], lateLocal: [] }), LATE_SOURCE_TIMEOUT_MS)
          }),
        ]).finally(() => {
          if (lateSourceTimer) clearTimeout(lateSourceTimer)
          lateSourceTimer = null
        })
        const mergedFinal = [...firstPass]
        /* 标记波次：来自慢源的新线索（去重主源后）以确定性起步，等待追评 */
        const wave1Keys = new Set(
          targetedLeads.map(
            (item) =>
              extractDomainFromUrl(item.website) ||
              `${String(item.company || '').toLowerCase()}|${String(item.address || '').toLowerCase()}`,
          ),
        )
        if (wave2.lateOrganic.length > 0 || wave2.lateLocal.length > 0) {
          const lateCandidates = [...wave2.lateOrganic, ...wave2.lateLocal]
          const lateLeads = lateCandidates.map((item: any) =>
            applySchemaDefaults({
              company: item.company,
              website: item.website,
              phone: item.phone,
              address: item.address,
              contact: item.contact,
              contactTitle: item.contactTitle,
              email: item.email,
              source: item.source,
              reason: item.reason,
              snippet: item.snippet,
              dataSourceType: item.dataSourceType || item.source,
              decisionMakers: item.decisionMakers,
              customsData: item.customsData,
              exhibitionFootprints: item.exhibitionFootprints,
              agentStatus: item.agentStatus,
            }),
          )
          const newLate = lateLeads.filter((item: SearchExecuteResult) => {
            const key =
              extractDomainFromUrl(item.website) ||
              `${String(item.company || '').toLowerCase()}|${String(item.address || '').toLowerCase()}`
            if (!key || wave1Keys.has(key)) return false
            /* 慢源候选同样执行合规预筛：垃圾线索 + 相关度（与第一波观测口径一致） */
            if (isTrashLead(item)) return false
            const relevance = computeScoutRelevance(item, scoringKeyword, {
              priorityWebsite: Boolean(filterOptions?.priorityWebsite),
              b2bRoleOnly: Boolean(filterOptions?.b2bRoleOnly),
              localDomainOnly: Boolean(filterOptions?.localDomainOnly),
              countryTlds:
                COUNTRY_TLD_MAP[
                  String(country || '')
                    .trim()
                    .toLowerCase()
                ] || [],
            })
            return relevance.keep
          })
          if (newLate.length > 0) {
            if (myJobId === activeJobIdFor()) {
              emitStage(_event.sender, 'scoring', `慢源深度穿透新增 ${newLate.length} 条线索，正在追评...`)
            }
            const slowScored = await executeScoring(newLate.slice(0, SEARCH_LLM_SCORE_LIMIT), newLate)
            mergedFinal.push(...slowScored)
          }
        }
        /* 两波合并去重（按域名）后统一投放 */
        const deduped = new Map<string, SearchExecuteResult>()
        for (const item of mergedFinal) {
          const key = extractDomainFromUrl(item.website) || `${String(item.company || '').toLowerCase()}`
          if (key && !deduped.has(key)) deduped.set(key, item)
        }
        const finalResults = Array.from(deduped.values())
          .slice(0, SEARCH_TARGETED_LEAD_LIMIT)
          /* S4a **安全网**：LLM 可能忽略 prompt 中的负向 ICP → 在**最终结果**上再兜一次底
             （幂等：未命中即原样返回），确保负向线索不会带着高分进入 Agent 管道。
             S4c：同样叠加用户反馈（防 LLM 把曾标「不相关」的线索重新打高分）。 */
          .map((lead) =>
            applyFeedbackAdjustment(
              applyNegativeIcpPenalty(lead, negativeIcpProfile),
              leadFeedback?.[deriveFeedbackKey(lead)],
            ),
          )
        /* preserveScore=true：finalResults 已含两波 AI 评分（emitLeadScored 也已流式
           回填），全量替换时保留 matchScore，避免冲掉已评分状态导致「未分析完成」假象。 */
        emitBasicResults(_event.sender, finalResults, true)
        emitStage(_event.sender, 'complete', '分析完成，线索已更新')
        emitStreamComplete(_event.sender)
        // Pipeline: 合并后统一 STAGE（一次投放，避免第二波重复 staging）
        // P0-8 修复：补 .catch，避免管道暂存异常升级为 unhandledRejection。
        void withPipelineIsolation(async (runId) => {
          const pipelineQueue = buildAgentTaskQueue(finalResults)
          stageAgentsFromPipeline(pipelineQueue, _event.sender, store, runId)
        }).catch((err) => {
          probeLog('pipeline_stage_failed', err instanceof Error ? err.message : String(err))
        })
        return { success: true, data: { results: finalResults } }
      } catch (error: any) {
        probeLog('[Probe-IPC] Search execute catch triggered, emitting stream:error + stream:complete', {
          message: error?.message || 'Search execute failed',
          /* 临时诊断（定位 "Iterator value undefined is not an entry object"）：打印栈顶 8 帧 */
          stack: String(error?.stack || '')
            .split('\n')
            .slice(0, 8)
            .join(' | '),
        })
        emitStreamError(_event.sender, error?.message || 'Search execute failed')
        if (isCircuitBreakerOpenError(error))
          return {
            success: false,
            error: '目标地区识别失败，系统已自动尝试降级搜索模式，请稍后。',
            code: error?.status,
          }
        if (isTimeoutError(error)) return { success: false, error: 'AI 数据流连接异常，请稍后重试' }
        return { success: false, error: error?.message || '当前搜索服务暂不可用，请稍后重试' }
      }
    },
    '海外客户智能搜索',
  )

  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE,
    store,
    licenseGuard,
    'analysis_advanced',
    async (
      _event,
      payload: {
        lead: {
          company: string
          industry?: string
          country?: string
          website?: string
          address?: string
          phone?: string
          contact?: string
          contactTitle?: string
          snippet?: string
          matchReasons?: string[]
          riskFlags?: string[]
          inferredRole?: string
          source?: string
          salesStrategy?: string
          customerText?: string
        }
        scenario: string
        /* 邮件目标语言（ISO 639-1），缺省按 lead.country 推导官方语言 */
        language?: string
      },
    ) => {
      try {
        const userConfig = getLatestUserConfigSnapshot(store)
        const providers: Array<{ id?: string; baseUrl?: string }> = Array.isArray(userConfig?.providers)
          ? userConfig.providers
          : []
        const llmConfig = providers.find((k) => k.id === 'llm')
        const llmKey = getUserLlmApiKey(store)
        const llmBaseUrl = llmConfig?.baseUrl?.trim()
        const scenario = payload?.scenario as 'direct_quote' | 'competitor_switch' | 'factory_strength' | 'reply_coach'
        const lead = payload?.lead || { company: '' }
        const analysisConfigError = getAnalysisConfigError(userConfig, llmKey, llmBaseUrl)

        if (analysisConfigError) {
          if (
            shouldUseDevMockAnalysis(analysisConfigError.semantic) &&
            scenario &&
            ['direct_quote', 'competitor_switch', 'factory_strength', 'reply_coach'].includes(scenario) &&
            lead.company
          ) {
            return {
              success: true,
              data: buildDevMockAnalysisData({
                lead,
                scenario,
                degradedReason: analysisConfigError.semantic.code,
              }),
            }
          }
          return buildAnalysisErrorResponse(analysisConfigError.message, analysisConfigError.semantic)
        }

        if (!scenario || !['direct_quote', 'competitor_switch', 'factory_strength', 'reply_coach'].includes(scenario)) {
          return buildAnalysisErrorResponse('当前分析场景暂不可用，请稍后重试', { code: 'invalid_scenario' })
        }

        if (!lead.company)
          return buildAnalysisErrorResponse('当前线索信息不足，暂时无法分析', { code: 'insufficient_lead_data' })

        const timeoutMs = Number(userConfig?.analysisTimeoutMs) || DEFAULT_SEARCH_TIMEOUT_MS

        if (scenario === 'reply_coach') {
          const customerText = String(payload?.lead?.customerText || '').trim()
          if (!customerText)
            return buildAnalysisErrorResponse('请先粘贴客户回信原文，再开始拆解', { code: 'insufficient_lead_data' })

          const { system, user } = buildReplyCoachPrompt({
            icpProfile: userConfig?.icpProfile || {},
            lead: {
              ...lead,
              salesStrategy: payload?.lead?.salesStrategy,
              customerText,
            },
          })

          const llmResponse = await fetchWithTimeout(
            buildLlmEndpoint(llmBaseUrl || ''),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmKey}` },
              body: JSON.stringify({
                model: userConfig?.selectedModel || 'gpt-3.5-turbo',
                messages: [
                  { role: 'system', content: system },
                  { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
              }),
            },
            timeoutMs,
          )

          if (!llmResponse.ok) throw new Error(mapHttpError(llmResponse.status, 'LLM'))
          const llmJson: any = await llmResponse.json().catch(() => ({}))
          const content = llmJson?.choices?.[0]?.message?.content || llmJson?.choices?.[0]?.text || ''
          const parsed = typeof content === 'string' ? parseReplyCoachResponse(content) : null
          if (!parsed)
            return buildAnalysisErrorResponse('AI 回信教练暂不可用，请稍后重试', {
              code: 'provider_unavailable',
              source: 'reply_coach',
            })

          return {
            success: true,
            data: {
              content: parsed.replyTemplate,
              analysis: parsed.negotiationRisk,
              suggestion: parsed.pricingAdvice,
              customerText,
              negotiationRisk: parsed.negotiationRisk,
              pricingAdvice: parsed.pricingAdvice,
              replyTemplate: parsed.replyTemplate,
              nextAction: parsed.nextAction,
              rawContent: parsed.rawContent,
              parseFallback: parsed.parseFallback,
              usedFallback: false,
              source: 'reply_coach',
            },
          }
        }

        const normalizedWebsite = normalizeWebsiteUrl(lead.website?.trim() || '')
        const websiteContent = normalizedWebsite
          ? await extractWebsiteContent(normalizedWebsite, timeoutMs)
          : { title: '', description: '', body: '', directEmails: [], directPhones: [] }
        const fallbackSnippet = lead.snippet ? sanitizePlainText(lead.snippet, 500) : ''
        const websiteText =
          trimWebsiteTextForLlm(
            [
              websiteContent.title,
              websiteContent.description,
              websiteContent.body,
              websiteContent.directEmails.join(' '),
              websiteContent.directPhones.join(' '),
            ]
              .filter(Boolean)
              .join(' '),
          ) || fallbackSnippet
        const knowledgeBaseEntries = Array.isArray(userConfig?.knowledgeBase?.entries)
          ? userConfig.knowledgeBase.entries
              .map((entry: any) => ({
                title: String(entry?.title || '').trim(),
                content: String(entry?.content || '').trim(),
                tags: Array.isArray(entry?.tags)
                  ? entry.tags.map((tag: unknown) => String(tag || '').trim()).filter(Boolean)
                  : [],
              }))
              .filter((entry: { title: string; content: string }) => entry.title || entry.content)
          : []
        const knowledgeBase = pickRelevantKnowledgeEntries(knowledgeBaseEntries, scenario, 5)
        const usedKnowledgeTitles = knowledgeBase.map((entry) => entry.title).filter(Boolean)

        /* 小语种同步翻译：缺省按 lead.country 推导官方语言，显式 language 优先 */
        const emailLanguage = resolveEmailLanguage(lead.country, payload?.language)
        const { system, user } = buildAnalysisPrompt({
          knowledgeBase,
          icpProfile: userConfig?.icpProfile || {},
          lead,
          scenario,
          websiteText,
          language: emailLanguage,
        })

        probeLlmRequest(llmBaseUrl)
        const llmResponse = await fetchWithTimeout(
          buildLlmEndpoint(llmBaseUrl || ''),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmKey}` },
            body: JSON.stringify({
              model: userConfig?.selectedModel || 'gpt-3.5-turbo',
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
            }),
          },
          timeoutMs,
        )

        if (!llmResponse.ok) throw new Error(mapHttpError(llmResponse.status, 'LLM'))
        const llmJson: any = await llmResponse.json().catch(() => ({}))
        const content = llmJson?.choices?.[0]?.message?.content || llmJson?.choices?.[0]?.text || ''
        const parsed = typeof content === 'string' ? parseStructuredAnalysisResponse(content) : null
        if (!parsed)
          return buildAnalysisErrorResponse('AI 分析结果暂不可用，请稍后重试', {
            code: 'provider_unavailable',
            source: websiteText ? 'website' : 'snippet',
          })

        return {
          success: true,
          data: {
            content: parsed.content,
            companyProfile: parsed.companyProfile,
            painPoints: parsed.painPoints,
            valueMapping: parsed.valueMapping,
            emailSubject: parsed.emailSubject,
            emailBody: parsed.emailBody,
            confidence: parsed.confidence,
            rawContent: parsed.rawContent,
            parseFallback: parsed.parseFallback,
            usedKnowledgeTitles,
            usedFallback: !websiteText || websiteText === fallbackSnippet,
            source: websiteText ? 'website' : 'snippet',
          },
        }
      } catch (error: any) {
        probeLlmCrash(error)
        const semantic = getAnalysisFailureSemantic(error)
        if (semantic.code === 'provider_timeout') {
          return buildAnalysisErrorResponse('AI 数据流连接异常，请稍后重试', semantic)
        }
        return buildAnalysisErrorResponse(
          error?.message || '当前智能分析服务暂不可用，请稍后重试',
          semantic,
          error?.status,
        )
      }
    },
    '客户智能分析',
  )
}
