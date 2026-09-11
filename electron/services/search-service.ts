import * as crypto from 'crypto'
import { app } from 'electron'
import { IPC_CHANNELS } from '../ipc/channels'
import type { AnalysisSemanticMeta, AnalysisSemanticCode } from '../../src/shared/ipc-contracts'
import { isCircuitBreakerOpenError, resetCircuitBreaker } from '../utils/http-client'
import { ConfigStore, DEFAULT_SEARCH_TIMEOUT_MS, getGoogleConfig, getPublicUserConfig, getUserLlmApiKey, SECRET_KEYS } from './config-service'
import { createLicenseService, registerSecureFeatureIpc } from './license-service'
import { buildLlmEndpoint, buildSearchEndpoint, fetchWithRetry, fetchWithTimeout, getDefaultSerpApiTimeoutMs, isTimeoutError } from './proxy-service'
import { getSecret } from './secret-manager'

type SearchExecutePayload = {
  keyword: string
  country?: string
  city?: string
  filterOptions?: {
    priorityWebsite?: boolean
    localDomainOnly?: boolean
    highRelevanceOnly?: boolean
    b2bRoleOnly?: boolean
  }
}

type SearchExecuteResult = {
  id: string
  company: string
  website: string
  contact?: string
  contactTitle?: string
  email?: string
  phone: string
  address: string
  isB2B?: boolean | null
  source?: string
  matchReasons?: string[]
  riskFlags?: string[]
  matchScore?: number | null
  snippet?: string
  inferredRole?: string
  salesStrategy?: string
  fallbackStatus?: 'social_blind_score'
}

const MAX_SEARCH_CANDIDATES = 100
const SEARCH_LLM_CONCURRENCY = 2
const SEARCH_ENRICH_CONCURRENCY = 2
const SERPAPI_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const SEARCH_LLM_TIMEOUT_MS = 20_000
const WEBSITE_PROBE_TIMEOUT_MS = 15_000
const MAX_WEBSITE_TEXT_FOR_LLM = 3000
const SCOUT_NEGATIVE_TERMS = [
  'auto repair', 'body shop', 'mechanic', 'tire', 'car wash', 'oil change', 'collision', 'tow', 'detailing', 'smog',
]
const SCOUT_B2B_TERMS = [
  'dealer', 'wholesale', 'supplier', 'distributor', 'manufacturer', 'factory', 'industrial', 'commercial', 'b2b',
]
const KEYWORD_STOP_TERMS = new Set(['the', 'and', 'for', 'with', 'from', 'usa', 'us', 'global', 'company', 'companies'])

const emitBasicResults = (sender: Electron.WebContents, candidates: Array<Partial<SearchExecuteResult>>) => {
  sender.send(
    IPC_CHANNELS.SEARCH.BASIC_RESULTS,
    candidates.map((item) => applySchemaDefaults({ ...item, matchScore: undefined }))
  )
}

const emitStreamStart = (sender: Electron.WebContents, total: number) => {
  sender.send(IPC_CHANNELS.SEARCH.STREAM_START, total)
}

const emitStage = (
  sender: Electron.WebContents,
  stage: 'fetching' | 'normalizing' | 'scoring' | 'enriching' | 'complete',
  message: string,
  searchMode?: 'maps' | 'maps-keyword-fallback' | 'organic-fallback'
) => {
  sender.send(IPC_CHANNELS.SEARCH.STAGE, { stage, message, searchMode })
}

const emitLeadScored = (
  sender: Electron.WebContents,
  lead: Partial<SearchExecuteResult>,
  completedCount: number,
  totalCount: number
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

const isProductionRuntime = () => process.env.NODE_ENV === 'production'

const probeLog = (tag: string, ...args: unknown[]) => {
  if (isProductionRuntime()) return
  console.log(tag, ...args)
}

const probeError = (tag: string, ...args: unknown[]) => {
  console.error(tag, ...args)
}

const probeLlmRequest = (llmBaseUrl?: string) => {
  probeLog('[Probe-LLM] 请求发起, URL:', llmBaseUrl || 'N/A')
}

const probeLlmCrash = (error: unknown) => {
  probeError('[Probe-LLM] 请求崩溃:', error)
}

export const verifyLlmProbeFailure = async (llmBaseUrl?: string) => {
  probeLlmRequest(llmBaseUrl)
  try {
    throw new Error('VERIFY_LLM_PROBE_FAILURE')
  } catch (error) {
    probeLlmCrash(error)
    throw error
  }
}

const getAnalysisConfigError = (userConfig: any, llmKey: string, llmBaseUrl?: string): { message: string; semantic: AnalysisSemanticMeta } | null => {
  if (!llmKey) {
    return {
      message: '未检测到 AI API Key，请先前往系统设置完成配置',
      semantic: { code: 'missing_llm_key', settingsActionable: true },
    }
  }
  if (!llmBaseUrl) {
    return {
      message: '未检测到 AI Base URL，请先前往系统设置完成配置',
      semantic: { code: 'missing_llm_base_url', settingsActionable: true },
    }
  }

  const icpProfile = userConfig?.icpProfile || {}
  const hasIcpProfile = [icpProfile?.targetProduct, icpProfile?.buyerPersona, icpProfile?.coreAdvantage].some((value) => String(value || '').trim())
  if (!hasIcpProfile) {
    return {
      message: '未检测到 ICP 目标画像，请先前往系统设置补全目标产品、买家角色或核心优势',
      semantic: { code: 'missing_icp_profile', settingsActionable: true },
    }
  }

  return null
}

const buildAnalysisErrorResponse = (message: string, semantic: AnalysisSemanticMeta, code?: number) => ({
  success: false as const,
  error: message,
  code,
  meta: {
    analysisSemantic: semantic,
  },
})

const shouldUseDevMockAnalysis = (semantic: AnalysisSemanticMeta) => !app.isPackaged && semantic.settingsActionable === true

const getAnalysisFailureSemantic = (error: unknown): AnalysisSemanticMeta => {
  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.toLowerCase()

  if (isTimeoutError(error) || /timeout|timed out|econn|enet|socket/.test(normalized)) {
    return { code: 'provider_timeout' }
  }

  if (/api key|base url|配置|provider|forbidden|unauthorized|http 4\d\d|http 5\d\d/.test(normalized)) {
    return { code: 'provider_unavailable' }
  }

  return { code: 'provider_unavailable' }
}

const buildDevMockAnalysisData = (payload: { lead: any; scenario: 'direct_quote' | 'competitor_switch' | 'factory_strength' | 'reply_coach'; degradedReason: AnalysisSemanticCode }) => {
  const company = String(payload.lead?.company || 'Target Account').trim() || 'Target Account'
  const website = String(payload.lead?.website || '').trim() || '官网公开信息'
  const snippet = String(payload.lead?.snippet || '').trim() || '公开行业资料'
  const semantic: AnalysisSemanticMeta = {
    code: 'dev_mock_active',
    degraded: true,
    mockMode: true,
    degradedReason: payload.degradedReason,
    source: payload.scenario === 'reply_coach' ? 'reply_coach' : 'dev_mock',
    settingsActionable: true,
  }

  if (payload.scenario === 'reply_coach') {
    const customerText = String(payload.lead?.customerText || '').trim() || 'Please share your best price and lead time.'
    return {
      semantic,
      content: `Hi ${company} team,\n\n感谢回复。为了给您更准确的价格与交期建议，能否请您补充采购数量、目标应用以及预计项目时间？\n\n如果方便，我们也可以先基于当前信息提供分档报价参考。\n\nBest regards,\nKone Team`,
      analysis: `${company} 当前更像是在试探价格和交期，而不是已经给出完整采购承诺。`,
      suggestion: '保持基础报价稳定，并用数量、时间线、样品确认来交换更优条件。',
      customerText,
      negotiationRisk: `${company} 当前更像是在试探价格和交期，而不是已经给出完整采购承诺。`,
      pricingAdvice: '保持基础报价稳定，并用数量、时间线、样品确认来交换更优条件。',
      replyTemplate: `Hi ${company} team,\n\n感谢回复。为了给您更准确的价格与交期建议，能否请您补充采购数量、目标应用以及预计项目时间？\n\n如果方便，我们也可以先基于当前信息提供分档报价参考。\n\nBest regards,\nKone Team`,
      nextAction: '继续推进',
      usedFallback: true,
      source: 'dev_mock',
    }
  }

  return {
    semantic,
    content: `${company} 当前可基于 ${website} 与 ${snippet} 生成开发模式模拟分析结果。`,
    companyProfile: `${company} 公开资料显示其正在围绕目标市场进行采购或渠道扩张。`,
    painPoints: '可能缺少更快的报价响应、更稳定的交期控制或更清晰的方案沟通。',
    valueMapping: '可强调更快 RFQ 响应、稳定交付、以及面向项目型采购的协同支持。',
    emailSubject: `关于 ${company} 的合作建议`,
    emailBody: `Hi ${company} team,\n\n我们基于公开信息注意到贵司在相关市场具备明确的采购/渠道拓展信号。若您当前正在寻找更快响应、稳定交付或更高协同效率的供应支持，我们可以基于具体项目需求提供更聚焦的建议。\n\n欢迎回复一个当前项目或 SKU，我们将进一步细化方案。`,
    confidence: 72,
    usedFallback: true,
    source: 'dev_mock',
  }
}
const runLimitedConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
) => {
  let currentIndex = 0
  const normalizedLimit = Math.max(1, Math.min(limit, items.length || 1))

  const runner = async () => {
    while (true) {
      const index = currentIndex
      if (index >= items.length) return
      currentIndex += 1
      await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: normalizedLimit }, () => runner()))
}

const fetchSerpApiWithRetry = (url: string, timeoutMs: number) =>
  fetchWithRetry(
    url,
    { method: 'GET' },
    getDefaultSerpApiTimeoutMs(timeoutMs),
    {
      retries: 2,
      shouldRetry: (response, error) => {
        if (error) return true
        return Boolean(response && SERPAPI_RETRYABLE_STATUS.has(response.status))
      },
    }
  )

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

const getHostFromUrl = (url: string) => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

const normalizeLlmJsonText = (raw: string) => {
  let text = raw.replace(/\uFEFF/g, '').trim()
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    text = fencedMatch[1].trim()
  }
  text = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  text = text.replace(/^json\s*/i, '').trim()
  const first = text.search(/[\[{]/)
  const lastObj = text.lastIndexOf('}')
  const lastArr = text.lastIndexOf(']')
  const last = Math.max(lastObj, lastArr)
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1).trim()
  }
  return text
}

const normalizeOrganicCandidate = (item: any) => ({
  company: String(item?.company || item?.name || item?.title || '').trim(),
  website: String(item?.website || item?.url || item?.link || '').trim(),
  phone: String(item?.phone || item?.phoneNumber || '').trim(),
  address: String(item?.address || item?.location || item?.snippet || '').trim(),
  source: String(item?.source || '').trim() || 'Google Organic',
  reason: String(item?.reason || item?.snippet || '').trim(),
  snippet: String(item?.snippet || item?.summary || item?.description || '').trim(),
})

const normalizeLocalCandidate = (item: any) => ({
  company: String(item?.title || item?.name || item?.company || '').trim(),
  website: String(item?.website || item?.links?.website || item?.link || item?.url || '').trim(),
  phone: String(item?.phone || item?.links?.phone || item?.phoneNumber || '').trim(),
  address: String(item?.address || item?.location || '').trim(),
  source: 'Google Maps',
  reason: String(item?.reason || item?.description || item?.snippet || '').trim() || 'Google Maps local business result',
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
        const fallbackKey = `${item.company.toLowerCase()}|${String(item.address || '').trim().toLowerCase()}`
        return [websiteKey || fallbackKey, { ...item, website: normalizedWebsite || item.website }]
      })
    ).values()
  )

  return uniqueCandidates.slice(0, MAX_SEARCH_CANDIDATES)
}

const extractKeywordAnchors = (keyword: string) => {
  const normalized = String(keyword || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
  return Array.from(
    new Set(
      normalized
        .split(/\s+/g)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !KEYWORD_STOP_TERMS.has(term))
    )
  )
}

const computeScoutRelevance = (
  candidate: Partial<SearchExecuteResult> & { reason?: string },
  keyword: string,
  options?: { priorityWebsite?: boolean; b2bRoleOnly?: boolean; highRelevanceOnly?: boolean }
) => {
  const anchors = extractKeywordAnchors(keyword)
  const text = `${candidate.company || ''} ${candidate.reason || ''} ${candidate.snippet || ''} ${candidate.website || ''}`.toLowerCase()
  const anchorHits = anchors.filter((term) => text.includes(term))
  const b2bHits = SCOUT_B2B_TERMS.filter((term) => text.includes(term))
  const negativeHits = SCOUT_NEGATIVE_TERMS.filter((term) => text.includes(term))
  const noWebsitePenalty = Boolean(options?.priorityWebsite && !String(candidate.website || '').trim())
  const missingB2BSignalPenalty = Boolean(options?.b2bRoleOnly && b2bHits.length === 0)
  const weakRelevancePenalty = Boolean(options?.highRelevanceOnly && anchorHits.length === 0 && b2bHits.length === 0)
  const keep = !(negativeHits.length > 0 && anchorHits.length === 0 && b2bHits.length === 0) && !noWebsitePenalty && !missingB2BSignalPenalty && !weakRelevancePenalty

  return {
    keep,
    reason: keep ? '' : noWebsitePenalty ? '缺少官网信号' : missingB2BSignalPenalty ? '缺少 B2B 信号' : weakRelevancePenalty ? '低相关信号' : '行业偏离',
    anchorHits,
    b2bHits,
    negativeHits,
  }
}

// 优先本土域名：Scout 阶段按目标国家的 ccTLD 与全球聚合平台信号做本土度分档，
// 用于基础结果排序（本土官网优先、聚合平台靠后），与前端展示过滤形成双保险。
const SCOUT_GLOBAL_AGGREGATOR_DOMAINS = new Set([
  'facebook.com', 'linkedin.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com',
  'tiktok.com', 'yelp.com', 'amazon.com', 'ebay.com', 'alibaba.com', 'aliexpress.com',
  'made-in-china.com', 'dhgate.com', 'wikipedia.org', 'reddit.com', 'pinterest.com',
])

const SCOUT_COUNTRY_CCTLD_MAP: Record<string, string[]> = {
  'united states': ['us'], 'usa': ['us'], '美国': ['us'],
  'canada': ['ca'], '加拿大': ['ca'],
  'united kingdom': ['uk'], 'uk': ['uk'], '英国': ['uk'],
  'germany': ['de'], '德国': ['de'],
  'france': ['fr'], '法国': ['fr'],
  'italy': ['it'], '意大利': ['it'],
  'spain': ['es'], '西班牙': ['es'],
  'netherlands': ['nl'], '荷兰': ['nl'],
  'belgium': ['be'], '比利时': ['be'],
  'poland': ['pl'], '波兰': ['pl'],
  'portugal': ['pt'], '葡萄牙': ['pt'],
  'austria': ['at'], '奥地利': ['at'],
  'switzerland': ['ch'], '瑞士': ['ch'],
  'sweden': ['se'], '瑞典': ['se'],
  'norway': ['no'], '挪威': ['no'],
  'denmark': ['dk'], '丹麦': ['dk'],
  'finland': ['fi'], '芬兰': ['fi'],
  'ireland': ['ie'], '爱尔兰': ['ie'],
  'greece': ['gr'], '希腊': ['gr'],
  'czech republic': ['cz'], 'czechia': ['cz'], '捷克': ['cz'],
  'romania': ['ro'], '罗马尼亚': ['ro'],
  'hungary': ['hu'], '匈牙利': ['hu'],
  'russia': ['ru'], '俄罗斯': ['ru'],
  'turkey': ['tr'], '土耳其': ['tr'],
  'australia': ['au'], '澳大利亚': ['au'], '澳洲': ['au'],
  'new zealand': ['nz'], '新西兰': ['nz'],
  'japan': ['jp'], '日本': ['jp'],
  'south korea': ['kr'], 'korea': ['kr'], '韩国': ['kr'],
  'india': ['in'], '印度': ['in'],
  'brazil': ['br'], '巴西': ['br'],
  'mexico': ['mx'], '墨西哥': ['mx'],
  'argentina': ['ar'], '阿根廷': ['ar'],
  'chile': ['cl'], '智利': ['cl'],
  'colombia': ['co'], '哥伦比亚': ['co'],
  'south africa': ['za'], '南非': ['za'],
  'israel': ['il'], '以色列': ['il'],
  'united arab emirates': ['ae'], 'uae': ['ae'], '阿联酋': ['ae'],
  'saudi arabia': ['sa'], '沙特': ['sa'], '沙特阿拉伯': ['sa'],
  'singapore': ['sg'], '新加坡': ['sg'],
  'malaysia': ['my'], '马来西亚': ['my'],
  'thailand': ['th'], '泰国': ['th'],
  'vietnam': ['vn'], '越南': ['vn'],
  'philippines': ['ph'], '菲律宾': ['ph'],
  'indonesia': ['id'], '印度尼西亚': ['id'], '印尼': ['id'],
  'egypt': ['eg'], '埃及': ['eg'],
  'nigeria': ['ng'], '尼日利亚': ['ng'],
}

type ScoutLocalDomainSignal = 'local' | 'neutral' | 'global'

const getScoutLocalDomainSignal = (
  candidate: Partial<SearchExecuteResult>,
  country?: string
): ScoutLocalDomainSignal => {
  const rawWebsite = String(candidate?.website || '').trim()
  if (!rawWebsite) return 'neutral'
  const host = extractDomainFromUrl(rawWebsite).replace(/^www\./, '')
  if (!host || !host.includes('.')) return 'neutral'
  const labels = host.split('.').filter(Boolean)
  if (labels.length < 2) return 'neutral'
  const registrable = labels.slice(-2).join('.')
  if (SCOUT_GLOBAL_AGGREGATOR_DOMAINS.has(registrable)) return 'global'
  const allowedTlds = SCOUT_COUNTRY_CCTLD_MAP[String(country || '').trim().toLowerCase()]
  if (!allowedTlds || allowedTlds.length === 0) return 'neutral'
  return allowedTlds.includes(`.${labels[labels.length - 1]}`) ? 'local' : 'neutral'
}

const trimWebsiteTextForLlm = (value: string) =>
  sanitizePlainText(
    String(value || '')
      .replace(/\b(home|about|products|services|blog|news|privacy|cookie|login|sign in|menu|navigation|footer|header|copyright)\b/gi, ' ')
      .replace(/\s+/g, ' '),
    MAX_WEBSITE_TEXT_FOR_LLM
  )

const buildSerpApiMapsEndpoint = (query: string, apiKey: string, location?: string, start = 0) => {
  const locationParams = location ? `&location=${encodeURIComponent(location)}&z=12` : ''
  return `https://serpapi.com/search.json?engine=google_maps&type=search&q=${encodeURIComponent(query)}${locationParams}&api_key=${encodeURIComponent(apiKey)}&start=${start}`
}

const buildSerpApiOrganicEndpoint = (query: string, apiKey: string, start = 0) =>
  `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}&start=${start}`

type SerpSearchMode = 'maps-location' | 'maps-keyword' | 'organic-keyword'

export const buildFallbackAwareMapsQuery = (keyword: string, locationString: string) =>
  locationString ? `${keyword} in ${locationString}` : keyword

export const normalizeSearchResponseCandidates = (organicResults: any[], localResults: any[], city?: string, locationString?: string) => {
  const filteredLocalResults = city ? filterLocalResultsByLocation(localResults, locationString) : localResults
  return {
    filteredLocalResults,
    normalizedCandidates: normalizeSearchCandidates({ organic_results: organicResults, local_results: filteredLocalResults }),
  }
}

export const resolveSerpSearchPlan = async (payload: {
  keyword: string
  city?: string
  country?: string
  googleKey: string
  timeoutMs: number
  attemptSearch: (mode: SerpSearchMode, modeQuery: string, modeLocation: string) => Promise<{ nextOrganic: any[]; nextLocal: any[] }>
  onStage?: (message: string, searchMode?: 'maps' | 'maps-keyword-fallback' | 'organic-fallback') => void
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

  if (city) {
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

const applySchemaDefaults = (item: Partial<SearchExecuteResult>): SearchExecuteResult => ({
  id: String(item.id || crypto.randomUUID()),
  company: String(item.company || '').trim(),
  website: String(item.website || '').trim(),
  contact: item.contact ? String(item.contact).trim() : '',
  contactTitle: item.contactTitle ? String(item.contactTitle).trim() : '',
  email: item.email ? String(item.email).trim() : '',
  phone: String(item.phone || '').trim(),
  address: String(item.address || '').trim(),
  isB2B: typeof item.isB2B === 'boolean' ? item.isB2B : item.isB2B ?? undefined,
  source: String(item.source || '').trim() || 'Google Maps',
  matchReasons: Array.isArray(item.matchReasons)
    ? item.matchReasons.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 2)
    : [],
  riskFlags: Array.isArray(item.riskFlags)
    ? item.riskFlags.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 1)
    : [],
  matchScore: Number.isFinite(Number(item.matchScore)) ? Math.max(0, Math.min(100, Number(item.matchScore))) : undefined,
  snippet: item.snippet ? String(item.snippet).trim() : undefined,
  fallbackStatus: item.fallbackStatus === 'social_blind_score' ? 'social_blind_score' : undefined,
})

const sanitizePlainText = (value: string, maxLen = 2800) =>
  value.replace(/\s+/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen)

const normalizeWebsiteUrl = (value?: string) => {
  const website = String(value || '').trim()
  if (!website) return ''
  return /^https?:\/\//i.test(website) ? website : `https://${website}`
}

const normalizeGeoText = (value?: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const LOCATION_TERM_ALIASES: Record<string, string[]> = {
  usa: ['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america'],
  us: ['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america'],
  uk: ['uk', 'u.k.', 'united kingdom', 'great britain', 'britain'],
  uae: ['uae', 'u.a.e.', 'united arab emirates'],
}

const extractLocationTerms = (locationString?: string) =>
  Array.from(
    new Set(
      normalizeGeoText(locationString)
        .split(/[;,/|]/)
        .flatMap((part) => part.split(/\s+/g))
        .map((part) => part.trim())
        .filter((part) => part.length >= 2)
        .flatMap((part) => LOCATION_TERM_ALIASES[part] || [part])
    )
  )

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

const extractDomainFromUrl = (value?: string) => {
  try {
    const normalized = normalizeWebsiteUrl(value)
    if (!normalized) return ''
    return new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

const extractEmailsFromText = (input: string) => Array.from(new Set((input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((item) => item.trim())))

const extractPhonesFromText = (input: string) =>
  Array.from(new Set((input.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || []).map((item) => item.replace(/\s+/g, ' ').trim()).filter((item) => item.replace(/\D/g, '').length >= 8)))

const mergePromptParts = (...parts: string[]) => parts.join('')

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
  failureCode?: 'website_403' | 'website_503' | 'website_timeout' | 'website_unreachable'
}

const createEmptyWebsiteContentProbe = (url = '', failureCode?: 'website_403' | 'website_503' | 'website_timeout' | 'website_unreachable'): WebsiteContentProbe => ({
  ok: false,
  url,
  title: '',
  description: '',
  body: '',
  directEmails: [],
  directPhones: [],
  failureCode,
})

const mergeUniqueValues = (...collections: string[][]) => Array.from(new Set(collections.flat().map((item) => String(item || '').trim()).filter(Boolean)))

const buildContactPageUrls = (website: string) => {
  try {
    const base = new URL(normalizeWebsiteUrl(website))
    return ['/contact', '/contact-us'].map((pathname) => new URL(pathname, base).toString())
  } catch {
    return []
  }
}

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
    body: sanitizePlainText(validProbes.map((probe) => probe.body).filter(Boolean).join(' '), 2200),
    directEmails: mergeUniqueValues(...validProbes.map((probe) => probe.directEmails)),
    directPhones: mergeUniqueValues(...validProbes.map((probe) => probe.directPhones)),
  }
}

const buildDeepProbeSystemPrompt = () =>
  mergePromptParts(
    'You are a B2B lead ',
    'research analyst. ',
    'Analyze the company website text and snippet. ',
    'Return ONLY valid JSON with key: outreachAngle. ',
    'Do not invent contact names, titles, phone numbers, or email addresses. ',
    'Keep the outreach angle concise and commercially usable.'
  )

const buildSearchScoringSystemPrompt = () =>
  mergePromptParts(
    'You are a B2B lead ',
    'scoring analyst. ',
    'Score ALL candidates against the ICP. ',
    'DO NOT filter or remove any item. ',
    'If irrelevant, assign low score (0-20). ',
    'Return ALL items in valid JSON array with fields: ',
    'company, website, address, matchScore, matchReasons, riskFlags. ',
    'matchReasons must contain 1-2 short specific reasons why the lead fits the ICP. ',
    'riskFlags must contain exactly 1 short risk flag explaining why the lead might not be ideal, such as retail-focused, weak website, unclear B2B intent, or low procurement signal. ',
    'NEVER return empty if candidates > 0. ',
    'NEVER filter data.'
  )

const buildUniversalIcpPrompt = (userConfig?: {
  icpProfile?: {
    targetProduct?: string
    buyerPersona?: string
    coreAdvantage?: string
    negativeIcp?: string
  }
}) => {
  const icpProfile = userConfig?.icpProfile || {}
  const targetProduct = String(icpProfile.targetProduct || '').trim() || '未提供'
  const buyerPersona = String(icpProfile.buyerPersona || '').trim() || '未提供'
  const coreAdvantage = String(icpProfile.coreAdvantage || '').trim() || '未提供'
  const negativeIcp = String(icpProfile.negativeIcp || '').trim() || '未提供'

  return mergePromptParts(
    'You are a senior B2B key account manager with 15 years of experience in global industrial sales. ',
    'Score every candidate against the ICP and return ONLY valid JSON. ',
    'You must output ONLY valid JSON. No explanations, no markdown tags. Strictly match the schema. ',
    'Evaluate with 4 dimensions: business synergy, role match, advantage resonance, and company strength. ',
    'If a candidate clearly matches the Negative ICP, set the first dimension to 0 immediately and keep the total score very low. ',
    `Target product: ${targetProduct}. `,
    `Preferred buyer role: ${buyerPersona}. `,
    `Core advantage: ${coreAdvantage}. `,
    `Negative ICP: ${negativeIcp}. `,
    'Do not remove any item. Return a top-level JSON object with key "results". ',
    'Each item must contain: company, website, address, totalScore, inferredRole, matchReason, salesStrategy, riskFlags, isB2B. ',
    'totalScore must be a number from 0 to 100. inferredRole must be a short inferred buying/company role. ',
    'matchReason must be one short conclusion. salesStrategy must be one short follow-up suggestion tied to the core advantage. ',
    'riskFlags must contain exactly 1 short risk flag. isB2B must be boolean. ',
    'Never invent contact names, emails, or phone numbers. Never output markdown or explanations outside JSON.'
  )
}

const buildAnalysisSystemPrompt = (knowledgeBaseText: string) =>
  mergePromptParts(
    'You are a world-class B2B export sales director and strategic account planner. ',
    'Your job is to analyze one target company and produce a conversion-ready outreach brief. ',
    'You must reason in three stages: 1) company profile and buying context, 2) map the customer pain points to the seller knowledge base, 3) generate a highly targeted outreach email. ',
    'Use the knowledge base as the primary source of seller strengths, products, differentiators, proof points, and messaging tone. ',
    'Never invent contacts, certifications, factories, purchase plans, or commercial facts that are not supported by the provided context. ',
    'If the context is weak, say so inside the relevant field instead of fabricating details. ',
    'Return ONLY valid JSON, with no markdown, code fences, commentary, or extra keys. ',
    'The JSON schema is strictly: ',
    '{"companyProfile":"string","painPoints":"string","valueMapping":"string","emailSubject":"string","emailBody":"string","confidence":0}. ',
    'companyProfile must summarize company scale cues, core business model, target market, and likely buying role in Chinese. ',
    'painPoints must infer the customer\'s likely operational or commercial pain points in Chinese. ',
    'valueMapping must explicitly map which seller advantage/product/knowledge point solves which customer pain point in Chinese. ',
    'emailSubject must be a concise high-open-rate English subject line. ',
    'emailBody must be a professional English cold email body tailored to the target company, without markdown. ',
    'confidence must be an integer from 0 to 100. ',
    'Keep static reasoning rules here; dynamic company and website data will be passed separately.\n\n',
    '[KNOWLEDGE BASE DATA:\n',
    knowledgeBaseText,
    '\n]'
  )

const buildReplyCoachSystemPrompt = () =>
  mergePromptParts(
    'You are a top-tier B2B commercial negotiation expert. ',
    'Analyze the customer reply and the previous sales strategy. ',
    'Return ONLY valid JSON with keys: negotiationRisk, pricingAdvice, replyTemplate, nextAction. ',
    'negotiationRisk must deeply explain the hidden intent, risk points, and whether the customer is price testing, delaying, comparing suppliers, or showing genuine buying interest. ',
    'pricingAdvice must give concrete pricing game advice, such as holding price, tiered quotation, or exchanging better pricing for larger order commitment. ',
    'replyTemplate must be a ready-to-send professional English reply with clear logic and strong B2B tone. ',
    'nextAction must be a short Chinese action label for sales, 2-8 characters preferred, such as 继续推进, 建议索样, 换条件, 延后跟进. ',
    'Keep it practical, commercially sharp, and fully industry-agnostic. ',
    'Do not invent facts beyond the provided context.'
  )

const extractContactCandidates = (input: string) => {
  const compact = sanitizePlainText(input, 4000)
  const emailMatches = extractEmailsFromText(compact)
  const phoneMatches = extractPhonesFromText(compact)
  const contactPatterns = [
    /(?:contact|联系人|reach\s+out\s+to|talk\s+to)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*[,|-]\s*(?:sales|procurement|sourcing|business development|director|manager)/i,
  ]
  const titlePatterns = [/(procurement manager|sourcing manager|business development manager|sales director|commercial director|engineering director)/i]
  const contact = contactPatterns.map((pattern) => compact.match(pattern)?.[1]?.trim()).find(Boolean) || ''
  const contactTitle = titlePatterns.map((pattern) => compact.match(pattern)?.[1]?.trim()).find(Boolean) || ''
  return { contact, contactTitle, email: emailMatches[0] || '', phone: phoneMatches[0] || '' }
}

const fetchWebsiteContent = async (url: string, timeoutMs: number): Promise<WebsiteContentProbe> => {
  try {
    probeLog('[Probe-Fetch] Fetching website:', url, 'timeoutMs:', timeoutMs)
    const response = await withTimeoutGuard(
      fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': 'Kone-AI/1.0' } }, timeoutMs),
      timeoutMs,
      `Website fetch ${url}`
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
    const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    const contactHrefMatches = Array.from(html.matchAll(/(?:href=["']mailto:([^"'>?#]+)|href=["']tel:([^"'>?#]+))/gi))
    return {
      ok: true,
      url,
      title: titleMatch?.[1] ? sanitizePlainText(titleMatch[1], 200) : '',
      description: descMatch?.[1] ? sanitizePlainText(descMatch[1], 400) : '',
      body: sanitizePlainText(bodyText, 2200),
      directEmails: Array.from(new Set(contactHrefMatches.map((match) => match[1]).filter(Boolean).map((item) => String(item).trim()))),
      directPhones: Array.from(new Set(contactHrefMatches.map((match) => match[2]).filter(Boolean).map((item) => String(item).trim()))),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '')
    probeLog('[Probe-Fetch] Website fetch failed:', {
      url,
      message,
    })
    return createEmptyWebsiteContentProbe(url, isTimeoutError(error) || /timeout/i.test(message) ? 'website_timeout' : 'website_unreachable')
  }
}

const extractWebsiteContent = async (url: string, timeoutMs: number) => {
  const strictTimeoutMs = Math.max(1, Math.min(timeoutMs || WEBSITE_PROBE_TIMEOUT_MS, WEBSITE_PROBE_TIMEOUT_MS))
  const homepage = await fetchWebsiteContent(url, strictTimeoutMs)
  if (!homepage.ok) {
    return homepage
  }

  const homepageExtracted = extractContactCandidates([
    homepage.title,
    homepage.description,
    homepage.body,
    homepage.directEmails.join(' '),
    homepage.directPhones.join(' '),
  ].join(' '))

  if (homepageExtracted.email && homepageExtracted.phone) {
    return homepage
  }

  const contactUrls = buildContactPageUrls(url)
  if (contactUrls.length === 0) {
    return homepage
  }

  const successfulContacts: WebsiteContentProbe[] = []
  for (const contactUrl of contactUrls) {
    try {
      const contactResult = await fetchWebsiteContent(contactUrl, strictTimeoutMs)
      if (contactResult.ok) successfulContacts.push(contactResult)
    } catch {
      // ignore individual contact page failures
    }
  }

  if (successfulContacts.length === 0) {
    return homepage
  }

  return mergeWebsiteContentProbes(homepage, ...successfulContacts)
}

const buildDeepProbePrompt = (payload: { company: string; website: string; snippet?: string; websiteText: string }) => ({
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
    candidates: [{
      company: payload.candidate.company,
      website: payload.candidate.website || '',
      snippet: payload.candidate.snippet || '',
      reason: payload.candidate.reason || '',
    }],
    instruction: '官网不可访问，请仅基于 company、website、snippet、reason 做轻量评分，仍需输出 0-100 matchScore。',
  }),
})

const buildSocialFallbackQueries = (company: string, country?: string) => [
  `site:linkedin.com/company "${company}" ${country || ''}`.trim(),
  `site:kompass.com "${company}"`,
  `site:europages.com "${company}"`,
]

const fetchSocialFallbackSnippet = async (query: string, googleKey: string, timeoutMs: number) => {
  const response = await fetchSerpApiWithRetry(buildSerpApiOrganicEndpoint(query, googleKey), timeoutMs)
  const rawText = await response.text()
  probeLog('[Probe-403-Fallback] SerpApi social query status:', {
    query,
    status: response.status,
    payload: rawText.substring(0, 240),
  })
  if (!response.ok) {
    return ''
  }

  let parsed: any = null
  try {
    parsed = rawText ? JSON.parse(rawText) : null
  } catch {
    parsed = null
  }

  const organicResults = Array.isArray(parsed?.organic_results) ? parsed.organic_results : []
  return sanitizePlainText(
    organicResults
      .slice(0, 3)
      .map((item: any) => [String(item?.title || '').trim(), String(item?.snippet || '').trim()].filter(Boolean).join(' - '))
      .filter(Boolean)
      .join(' '),
    900
  )
}

const buildSocialFallbackEnrichedText = async (company: string, country: string | undefined, googleKey: string, timeoutMs: number) => {
  console.log("[Probe-403-Fallback] 使用 LinkedIn/Kompass/Europages 平替 for:", company)
  const snippets: string[] = []
  for (const query of buildSocialFallbackQueries(company, country)) {
    const result = await fetchSocialFallbackSnippet(query, googleKey, timeoutMs).catch(() => '')
    snippets.push(result)
  }
  return trimWebsiteTextForLlm(snippets.filter(Boolean).join(' '))
}

const extractJsonObjectFromText = (raw: string) => {
  try {
    const parsed = JSON.parse(normalizeLlmJsonText(raw))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
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
}) => {
  const website = normalizeWebsiteUrl(payload.candidate.website)
  const snippet = String(payload.candidate.snippet || '').trim()
  const websiteContent = website ? await extractWebsiteContent(website, WEBSITE_PROBE_TIMEOUT_MS) : createEmptyWebsiteContentProbe()
  const probeText = trimWebsiteTextForLlm([websiteContent.title, websiteContent.description, websiteContent.body, snippet].filter(Boolean).join(' '))
  const extracted = extractContactCandidates([probeText, websiteContent.directEmails.join(' '), websiteContent.directPhones.join(' ')].join(' '))

  let llmInferred: Record<string, unknown> | null = null
  if (website && payload.llmEndpoint && payload.llmKey) {
    const { system, user } = buildDeepProbePrompt({ company: String(payload.candidate.company || '').trim(), website, snippet, websiteText: probeText })
    probeLog('[Probe-LLM] Deep probe candidate:', String(payload.candidate.company || '').trim(), 'timeoutMs:', payload.timeoutMs)
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
        payload.timeoutMs
      ),
      payload.timeoutMs,
      `Deep probe LLM ${String(payload.candidate.company || '').trim() || website}`
    ).catch((error) => {
      probeLog('[Probe-LLM] Deep probe failed:', {
        candidate: String(payload.candidate.company || '').trim(),
        message: error instanceof Error ? error.message : String(error || ''),
      })
      return null
    })

    if (response?.ok) {
      probeLog('[Probe-LLM] Deep probe response status:', response.status, 'candidate:', String(payload.candidate.company || '').trim())
      const llmJson: any = await response.json().catch(() => ({}))
      const content = llmJson?.choices?.[0]?.message?.content || llmJson?.choices?.[0]?.text || ''
      llmInferred = typeof content === 'string' ? extractJsonObjectFromText(content) : null
    }
  }

  const contact = String(payload.candidate.contact || extracted.contact || '').trim()
  const contactTitle = String(payload.candidate.contactTitle || extracted.contactTitle || '').trim()
  const email = String(payload.candidate.email || websiteContent.directEmails[0] || extracted.email || '').trim()
  const phone = String(payload.candidate.phone || websiteContent.directPhones[0] || extracted.phone || '').trim()
  const outreachAngle = String(llmInferred?.outreachAngle || '').trim()

  if (!websiteContent.ok) {
    const eligible403Fallback = ['website_403', 'website_503', 'website_timeout'].includes(String(websiteContent.failureCode || ''))
    const socialFallbackText = eligible403Fallback
      ? await buildSocialFallbackEnrichedText(String(payload.candidate.company || '').trim(), payload.country, payload.googleKey, payload.timeoutMs)
      : ''
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
        payload.timeoutMs
      ),
      payload.timeoutMs,
      `Snippet fallback ${String(payload.candidate.company || '').trim() || website}`
    ).catch(() => null)

    const blindLead = fallbackResponse?.ok
      ? mergeLlmResultsWithCandidates([
          {
            company: String(payload.candidate.company || '').trim(),
            website,
            phone,
            address: String(payload.candidate.address || '').trim(),
            source: String(payload.candidate.source || 'Google Maps').trim(),
            reason: Array.isArray(payload.candidate.matchReasons) ? payload.candidate.matchReasons[0] : '',
            snippet: fallbackSnippet,
          },
        ], extractLlmResults(await fallbackResponse.json().catch(() => ({}))))[0]
      : null

    const websiteBlockedBy403 = websiteContent.failureCode === 'website_403'
    const blindScoreFailed = !blindLead
    const usedSocialFallback = Boolean(eligible403Fallback && socialFallbackText)

    return {
      ...payload.candidate,
      ...blindLead,
      website,
      contact,
      contactTitle,
      email,
      phone,
      fallbackStatus: usedSocialFallback ? 'social_blind_score' : payload.candidate.fallbackStatus,
      matchReasons: [
        ...(Array.isArray(blindLead?.matchReasons) && blindLead?.matchReasons.length > 0 ? blindLead.matchReasons : Array.isArray(payload.candidate.matchReasons) ? payload.candidate.matchReasons : []),
        blindScoreFailed && websiteBlockedBy403
          ? '官网存在防爬限制，且 AI 盲评超时失败，建议稍后重试或人工复核'
          : usedSocialFallback
            ? '官网访问受限，已基于 LinkedIn/Kompass/Europages 简介轻量评估'
            : '官网访问受限，基于简介轻量评估（官网无法访问）',
      ].filter(Boolean).slice(0, 2),
      riskFlags: [
        ...(websiteBlockedBy403 ? ['website_403'] : []),
        ...(blindScoreFailed ? ['blind_score_failed'] : []),
        '官网访问受限，建议人工复核',
      ].filter(Boolean).slice(0, 3),
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
      matchReasons: [
        ...(Array.isArray(payload.candidate.matchReasons) ? payload.candidate.matchReasons : []),
        ...(outreachAngle ? [`网页深度探测判断：${sanitizePlainText(outreachAngle, 120)}`] : []),
      ].filter(Boolean).slice(0, 2),
    snippet: snippet || probeText,
    salesStrategy: outreachAngle,
  }
}

const buildSearchScoringPrompt = (payload: {
  keyword: string
  icpProfile?: { targetProduct?: string; buyerPersona?: string; coreAdvantage?: string; negativeIcp?: string }
  candidates: Array<{ company: string; website: string; snippet?: string; reason?: string }>
}) => ({
  system: buildUniversalIcpPrompt({ icpProfile: payload.icpProfile }),
  user: JSON.stringify({
    keyword: payload.keyword,
    icpProfile: {
      targetProduct: payload.icpProfile?.targetProduct || '',
      buyerPersona: payload.icpProfile?.buyerPersona || '',
      coreAdvantage: payload.icpProfile?.coreAdvantage || '',
      negativeIcp: payload.icpProfile?.negativeIcp || '',
    },
    candidates: payload.candidates,
  }),
})

const buildAnalysisPrompt = (payload: {
  knowledgeBase: Array<{ title: string; content: string; tags?: string[] }>
  icpProfile: { targetProduct?: string; buyerPersona?: string; coreAdvantage?: string }
  lead: { company: string; industry?: string; country?: string; website?: string; address?: string; phone?: string; contact?: string; contactTitle?: string; snippet?: string; matchReasons?: string[]; riskFlags?: string[]; inferredRole?: string; source?: string; salesStrategy?: string }
  scenario: 'direct_quote' | 'competitor_switch' | 'factory_strength'
  websiteText: string
}) => {
  const scenarioMap = {
    direct_quote: 'Direct Quote Entry',
    competitor_switch: 'Competitor Replacement',
    factory_strength: 'Factory Strength Proof',
  } as const
  const knowledgeBaseText = payload.knowledgeBase.length
    ? payload.knowledgeBase
        .map((entry, index) => `${index + 1}. ${entry.title}${entry.tags?.length ? ` [${entry.tags.join(', ')}]` : ''}\n${entry.content}`)
        .join('\n\n')
    : '暂无知识库内容，请仅基于线索与网站信息分析。'
  return {
    system: buildAnalysisSystemPrompt(knowledgeBaseText),
    user: JSON.stringify({
      scenario: scenarioMap[payload.scenario],
      icpProfile: payload.icpProfile,
      lead: payload.lead,
      websiteText: payload.websiteText,
      requiredStages: {
        stage1: '拆解企业画像与买方角色',
        stage2: '映射知识库卖点与客户痛点',
        stage3: '生成主题与开发信正文',
      },
    }),
  }
}

const buildReplyCoachPrompt = (payload: {
  icpProfile: { targetProduct?: string; buyerPersona?: string; coreAdvantage?: string; negativeIcp?: string }
  lead: { company: string; industry?: string; country?: string; website?: string; snippet?: string; salesStrategy?: string; customerText?: string }
}) => ({
  system: buildReplyCoachSystemPrompt(),
  user: JSON.stringify({
    icpProfile: payload.icpProfile,
    lead: {
      company: payload.lead.company,
      industry: payload.lead.industry || '',
      country: payload.lead.country || '',
      website: payload.lead.website || '',
      snippet: payload.lead.snippet || '',
    },
    previousSalesStrategy: payload.lead.salesStrategy || '',
    customerReply: payload.lead.customerText || '',
  }),
})

const parseStructuredAnalysisResponse = (raw: string) => {
  const trimmed = typeof raw === 'string' ? normalizeLlmJsonText(raw) : ''
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    const emailBody = String(parsed?.emailBody || parsed?.content || '').trim()
    const confidenceValue = Number(parsed?.confidence)
    return {
      companyProfile: String(parsed?.companyProfile || '').trim(),
      painPoints: String(parsed?.painPoints || '').trim(),
      valueMapping: String(parsed?.valueMapping || '').trim(),
      emailSubject: String(parsed?.emailSubject || '').trim(),
      emailBody,
      confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(100, Math.round(confidenceValue))) : undefined,
      rawContent: trimmed,
      parseFallback: false,
      content: emailBody,
    }
  } catch {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const fallbackBody = lines.slice(1).join('\n') || trimmed
    return {
      companyProfile: lines[0] || 'AI 分析中缺失该维度数据',
      painPoints: lines[1] || 'AI 分析中缺失该维度数据',
      valueMapping: lines[2] || 'AI 分析中缺失该维度数据',
      emailSubject: lines[3] || 'Following up on potential cooperation',
      emailBody: fallbackBody,
      confidence: undefined,
      rawContent: raw,
      parseFallback: true,
      content: fallbackBody,
    }
  }
}

export { parseStructuredAnalysisResponse }

const parseReplyCoachResponse = (raw: string) => {
  const trimmed = typeof raw === 'string' ? normalizeLlmJsonText(raw) : ''
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    return {
      negotiationRisk: String(parsed?.negotiationRisk || '').trim(),
      pricingAdvice: String(parsed?.pricingAdvice || '').trim(),
      replyTemplate: String(parsed?.replyTemplate || '').trim(),
      nextAction: String(parsed?.nextAction || '').trim(),
      rawContent: trimmed,
      parseFallback: false,
    }
  } catch {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    return {
      negotiationRisk: lines[0] || trimmed.slice(0, 260),
      pricingAdvice: lines[1] || '建议先澄清需求范围、价格敏感点与采购体量，再决定是否采用阶梯报价。',
      replyTemplate: lines.slice(2).join('\n') || trimmed,
      nextAction: '继续推进',
      rawContent: raw,
      parseFallback: true,
    }
  }
}

const scenarioKnowledgeKeywords: Record<'direct_quote' | 'competitor_switch' | 'factory_strength', string[]> = {
  direct_quote: ['报价', '价格', '方案', '成本', 'quote'],
  competitor_switch: ['竞品', '替代', '对比', '替换', '竞争'],
  factory_strength: ['工厂', '产能', '交付', '认证', '制造', '实力'],
}

const pickRelevantKnowledgeEntries = (
  entries: Array<{ title: string; content: string; tags?: string[] }>,
  scenario: 'direct_quote' | 'competitor_switch' | 'factory_strength',
  limit = 5
) => {
  const keywords = scenarioKnowledgeKeywords[scenario] || []
  const scored = entries.map((entry) => {
    const text = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`.toLowerCase()
    const score = keywords.reduce((sum, keyword) => (text.includes(keyword.toLowerCase()) ? sum + 1 : sum), 0)
    return { entry, score }
  })

  const prioritized = scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.entry.content.length - a.entry.content.length
    })
    .map((item) => item.entry)

  const withHits = prioritized.filter((entry) => {
    const text = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`.toLowerCase()
    return keywords.some((keyword) => text.includes(keyword.toLowerCase()))
  })

  const fallback = prioritized.filter((entry) => !withHits.includes(entry))
  return [...withHits, ...fallback].slice(0, limit)
}

const mapHttpError = (status: number, provider: string) => {
  if (status === 401 || status === 403) return `${provider} API 密钥无效或未授权，请检查设置`
  if (status === 429) return `${provider} API 调用额度已耗尽，请前往平台充值`
  if (status >= 500) return `${provider} 服务暂时拥堵，请稍后重试`
  return `${provider} HTTP ${status}`
}

const extractLlmResults = (llmPayload: any) => {
  const content = llmPayload?.choices?.[0]?.message?.content || llmPayload?.choices?.[0]?.text || ''
  if (!content || typeof content !== 'string') return []
  try {
    const parsed = JSON.parse(normalizeLlmJsonText(content))
    const results = Array.isArray(parsed)
      ? parsed
      : parsed?.results || parsed?.data?.results || parsed?.candidates || parsed?.data?.candidates || parsed?.items || parsed?.data?.items || (parsed && typeof parsed === 'object' ? [parsed] : [])
    probeLog('[Probe-LLM-Parse] Extract results shape:', {
      contentPreview: content.slice(0, 240),
      parsedType: Array.isArray(parsed) ? 'array' : typeof parsed,
      resultCount: Array.isArray(results) ? results.length : 0,
      keys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 12) : [],
    })
    if (!Array.isArray(results)) return []
    return results.map((item: any) => ({
      ...applySchemaDefaults({
        ...item,
        matchScore: item?.totalScore ?? item?.matchScore,
        matchReasons: [item?.matchReason].filter(Boolean),
      }),
      inferredRole: String(item?.inferredRole || '').trim(),
      salesStrategy: String(item?.salesStrategy || '').trim(),
      riskFlags: Array.isArray(item?.riskFlags)
        ? item.riskFlags.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 1)
        : [],
      isB2B: typeof item?.isB2B === 'boolean' ? item.isB2B : undefined,
    }))
  } catch (error) {
    probeError('[Probe-LLM-Parse-Error] Failed to parse scoring response:', {
      message: error instanceof Error ? error.message : String(error || ''),
      stack: error instanceof Error ? error.stack : '',
      contentPreview: content.slice(0, 500),
    })
    return []
  }
}

const mergeLlmResultsWithCandidates = (
  candidates: ReturnType<typeof normalizeSearchCandidates>,
  llmResults: SearchExecuteResult[]
) => {
  const resultPool = Array.isArray(llmResults) ? llmResults : []
  const usedResultIndexes = new Set<number>()

  return candidates.map((candidate) => {
    const normalizedCandidateCompany = candidate.company.trim().toLowerCase()
    const normalizedCandidateWebsite = extractDomainFromUrl(candidate.website)

    const matchedIndex = resultPool.findIndex((result, index) => {
      if (usedResultIndexes.has(index)) return false
      const normalizedResultCompany = String(result.company || '').trim().toLowerCase()
      const normalizedResultWebsite = extractDomainFromUrl(result.website)

      if (normalizedCandidateWebsite && normalizedResultWebsite && normalizedCandidateWebsite === normalizedResultWebsite) {
        return true
      }

      return normalizedCandidateCompany.length > 0 && normalizedCandidateCompany === normalizedResultCompany
    })

    const matched = matchedIndex >= 0 ? resultPool[matchedIndex] : null
    if (matchedIndex >= 0) {
      usedResultIndexes.add(matchedIndex)
    }

    return {
      ...applySchemaDefaults({
        ...candidate,
        ...matched,
        company: matched?.company || candidate.company,
        website: matched?.website || candidate.website,
        address: matched?.address || candidate.address,
        matchReasons: matched?.matchReasons || [candidate.reason || candidate.snippet || '基础信息与搜索词存在一定相关性'].filter(Boolean).slice(0, 2),
        riskFlags: matched?.riskFlags || ['需人工复核其 B2B 采购意图'],
        snippet: matched?.snippet || candidate.snippet,
      }),
      inferredRole: matched?.inferredRole || '',
      salesStrategy: matched?.salesStrategy || '',
    }
  })
}

export const registerSearchHandlers = (ipcMain: Electron.IpcMain, store: ConfigStore) => {
  const { licenseGuard } = createLicenseService(store)

  registerSecureFeatureIpc(ipcMain, IPC_CHANNELS.SEARCH.EXECUTE, store, licenseGuard, 'search_basic', async (_event, payload: SearchExecutePayload) => {
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

      emitStreamStart(_event.sender, 0)

      const userConfig = getLatestUserConfigSnapshot(store)
      const { googleLeads: googleConfig } = getGoogleConfig(store)
      const providers: Array<{ id?: string; baseUrl?: string }> = Array.isArray(userConfig?.providers) ? userConfig.providers : []
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
      if (!googleKey || !googleBaseUrl) {
        throw new Error(`缺少配置. Debug: key=[${googleKey}], url=[${googleBaseUrl || ''}]`)
      }

      const isSerpApi = /serpapi\.com/i.test(googleBaseUrl)
      const googleHost = getHostFromUrl(googleBaseUrl)
      const llmHost = getHostFromUrl(llmBaseUrl || '')
      if (googleHost) resetCircuitBreaker(googleHost)
      if (llmHost) resetCircuitBreaker(llmHost)
      const city = typeof payload?.city === 'string' ? payload.city.trim() : ''
      const country = typeof payload?.country === 'string' ? payload.country.trim() : ''
      const filterOptions = payload?.filterOptions || {}
      const locationString = city && country
        ? `${city}, ${country}`
        : country
          ? String(country)
          : ''
      const llmEndpoint = hasLlmConfig ? buildLlmEndpoint(llmBaseUrl || '') : ''
      const configuredSearchTimeoutMs = Number(userConfig?.searchTimeoutMs) || DEFAULT_SEARCH_TIMEOUT_MS
      const timeoutMs = Math.max(DEFAULT_SEARCH_TIMEOUT_MS, configuredSearchTimeoutMs)
      const llmTimeoutMs = Math.max(DEFAULT_SEARCH_TIMEOUT_MS, Math.min(timeoutMs, SEARCH_LLM_TIMEOUT_MS))
      probeLog('[Probe-Config] Quality controls:', {
        priorityWebsite: Boolean(filterOptions?.priorityWebsite),
        localDomainOnly: Boolean(filterOptions?.localDomainOnly),
        highRelevanceOnly: Boolean(filterOptions?.highRelevanceOnly),
        b2bRoleOnly: Boolean(filterOptions?.b2bRoleOnly),
      })

      let allOrganic: any[] = []
      let allLocal: any[] = []
      let activeSearchMode: 'maps' | 'maps-keyword-fallback' | 'organic-fallback' = city ? 'maps' : 'maps-keyword-fallback'

      emitStage(_event.sender, 'fetching', '正在抓取 Google Maps / SerpApi 搜索结果...', 'maps')

      if (isSerpApi) {
        const attemptSearch = async (mode: SerpSearchMode, modeQuery: string, modeLocation: string) => {
          const useOrganic = mode === 'organic-keyword'

          const nextOrganic: any[] = []
          const nextLocal: any[] = []

          for (let page = 0; page < 3; page += 1) {
            const pageEndpoint = useOrganic
              ? buildSerpApiOrganicEndpoint(modeQuery, googleKey, page * 10)
              : buildSerpApiMapsEndpoint(modeQuery, googleKey, modeLocation, page * 20)
            const searchResponse = await fetchSerpApiWithRetry(pageEndpoint, timeoutMs)

            const rawText = await searchResponse.text()
            probeLog('[Probe-API] SerpApi status:', searchResponse.status, 'mode:', mode, 'page:', page, 'payload:', rawText.substring(0, 240))
            if (!searchResponse.ok) {
              if (mode === 'maps-location' && searchResponse.status === 400) {
                if (googleHost) resetCircuitBreaker(googleHost)
                throw new Error(`UNSUPPORTED_LOCATION::${getFriendlySerpApiError(searchResponse.status, rawText)}`)
              }
              probeError('[Probe-API] SerpApi request failed:', { status: searchResponse.status, mode, preview: rawText.substring(0, 200) })
              throw new Error(getFriendlySerpApiError(searchResponse.status, rawText))
            }

            if (googleHost) resetCircuitBreaker(googleHost)

            let searchJson: any = {}
            try {
              searchJson = rawText ? JSON.parse(rawText) : {}
            } catch {
              throw new Error('SerpApi 响应解析失败，请检查查询参数或稍后重试')
            }

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

            if (!useOrganic && pageLocal.length === 0) break
            if (useOrganic && pageOrganic.length === 0) break
            if (nextLocal.length >= MAX_SEARCH_CANDIDATES || nextOrganic.length >= MAX_SEARCH_CANDIDATES) break
          }

          return { nextOrganic, nextLocal }
        }
        const searchPlan = await resolveSerpSearchPlan({
          keyword,
          city,
          country,
          googleKey,
          timeoutMs,
          attemptSearch: (mode, modeQuery, modeLocation) => attemptSearch(mode, modeQuery, modeLocation),
          onStage: (message, searchMode) => emitStage(_event.sender, 'fetching', message, searchMode),
          onFallback: (event, detail) => {
            if (event === 'location-rejected') {
              probeLog('[Probe-Fallback] Location rejected, switching to keyword-based query.', detail)
            }
            if (event === 'zero-local-organic') {
              probeLog('[Probe-Fallback] Maps keyword returned zero local results, switching to Google Organic.', detail)
            }
          },
        })
        allOrganic = searchPlan.allOrganic
        allLocal = searchPlan.allLocal
        activeSearchMode = searchPlan.activeSearchMode
      } else {
        const searchResponse = await fetchWithTimeout(
          buildSearchEndpoint(googleBaseUrl),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${googleKey}` },
            body: JSON.stringify({ keyword, country: payload.country, city: payload.city }),
          },
          timeoutMs
        )

        const rawText = await searchResponse.text()
        probeLog('[Probe-API] Search service status:', searchResponse.status, 'payload:', rawText.substring(0, 240))
        if (!searchResponse.ok) throw new Error(mapHttpError(searchResponse.status, '搜索服务'))

        let searchJson: any = {}
        try {
          searchJson = rawText ? JSON.parse(rawText) : {}
        } catch {
          throw new Error('SerpApi 响应解析失败，请检查查询参数或稍后重试')
        }

        allOrganic = Array.isArray(searchJson?.organic_results)
          ? searchJson.organic_results
          : Array.isArray(searchJson?.results)
            ? searchJson.results
            : Array.isArray(searchJson?.data?.results)
              ? searchJson.data.results
              : Array.isArray(searchJson?.items)
                ? searchJson.items
                : Array.isArray(searchJson?.data?.items)
                  ? searchJson.data.items
                  : []
        allLocal = Array.isArray(searchJson?.local_results)
          ? searchJson.local_results
          : Array.isArray(searchJson?.local_results?.places)
            ? searchJson.local_results.places
            : []
      }

      emitStage(_event.sender, 'normalizing', '正在整理候选客户并去重...')
      const { filteredLocalResults, normalizedCandidates } = normalizeSearchResponseCandidates(allOrganic, allLocal, city, locationString)
      probeLog('[Probe-Filter] Filter applied: Priority Website =', Boolean(filterOptions?.priorityWebsite))
      const localDomainOnly = Boolean(filterOptions?.localDomainOnly)
      const candidates = normalizedCandidates.filter((candidate) => {
        const relevance = computeScoutRelevance(candidate, keyword, {
          priorityWebsite: Boolean(filterOptions?.priorityWebsite),
          b2bRoleOnly: Boolean(filterOptions?.b2bRoleOnly),
          highRelevanceOnly: Boolean(filterOptions?.highRelevanceOnly),
        })
        if (!relevance.keep) {
          probeLog(`[Probe-Prefilter] Discarded: ${candidate.company} (Reason: ${relevance.reason})`)
          return false
        }
        return true
      })
      if (localDomainOnly) {
        const localSignalRank: Record<ScoutLocalDomainSignal, number> = { local: 0, neutral: 1, global: 2 }
        candidates.sort((a, b) => localSignalRank[getScoutLocalDomainSignal(a, country)] - localSignalRank[getScoutLocalDomainSignal(b, country)])
      }
      probeLog('[Probe-Prefilter] Quality switch summary:', {
        localDomainOnly,
        highRelevanceOnly: Boolean(filterOptions?.highRelevanceOnly),
        localDomainFirstCount: localDomainOnly ? candidates.filter((candidate) => getScoutLocalDomainSignal(candidate, country) === 'local').length : 0,
      })
      probeLog('[Probe-Normalize] Candidate summary:', {
        organicCount: allOrganic.length,
        localCount: allLocal.length,
        filteredLocalCount: filteredLocalResults.length,
        candidateCount: candidates.length,
        discardedCount: normalizedCandidates.length - candidates.length,
        firstCandidate: candidates[0] || null,
        activeSearchMode,
      })
      if (candidates.length === 0) {
        probeLog('[Probe-IPC] Zero-candidate path reached, emitting complete stage and stream complete')
        emitStage(_event.sender, 'complete', '分析完成，未发现符合条件的线索')
        emitStreamComplete(_event.sender)
        return { success: true, data: { results: [] } }
      }

      emitStreamStart(_event.sender, candidates.length)
      emitBasicResults(_event.sender, candidates)
      probeLog('[Probe-IPC] Basic results emitted:', { total: candidates.length, activeSearchMode })

      if (!hasLlmConfig) {
        if (!llmKey) {
          probeError('[Probe-Auth] LLM key missing, skipping scoring phase', {
            candidateCount: candidates.length,
            hasLlmBaseUrl: Boolean(llmBaseUrl),
          })
        }
        if (!llmBaseUrl) {
          probeError('[Probe-Auth] LLM base URL missing, skipping scoring phase', {
            candidateCount: candidates.length,
            hasLlmKey: Boolean(llmKey),
          })
        }
        const fallbackSourceLabel = candidates.some((item) => String(item.source || '').includes('Organic')) ? '网页搜索' : 'Google Maps'
        emitStage(_event.sender, 'complete', `已返回 ${fallbackSourceLabel} 基础结果（未启用 AI 评分）`)
        emitStreamComplete(_event.sender)
        return { success: true, data: { results: candidates.map((item) => applySchemaDefaults(item)) } }
      }

      probeLog('[Probe-IPC] Scoring queue starting', {
        candidateCount: candidates.length,
        concurrency: SEARCH_LLM_CONCURRENCY,
      })
      emitStage(_event.sender, 'scoring', '正在进行 ICP 智能评估...')

      if (!llmKey || !llmEndpoint) {
        probeError('[Probe-Auth] LLM config inconsistent after scoring gate', {
          hasLlmKey: Boolean(llmKey),
          hasLlmEndpoint: Boolean(llmEndpoint),
          candidateCount: candidates.length,
        })
        throw new Error('未检测到有效的 LLM 鉴权配置，无法执行 ICP 智能评估')
      }

      const cleanedResults: SearchExecuteResult[] = []
      let completedCount = 0
      await runLimitedConcurrency(candidates, SEARCH_LLM_CONCURRENCY, async (candidate, index) => {
        try {
          probeLog('[Probe-LLM] Scoring candidate:', {
            index,
            company: candidate.company,
            website: candidate.website,
            timeoutMs: llmTimeoutMs,
          })
          const { system, user } = buildSearchScoringPrompt({
            keyword,
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
              llmTimeoutMs
            ),
            llmTimeoutMs,
            `Scoring LLM ${candidate.company || candidate.website || index}`
          )
          probeLog('[Probe-LLM] Scoring candidate response:', {
            index,
            company: candidate.company,
            status: llmResponse.status,
          })

          if (!llmResponse.ok) throw new Error(mapHttpError(llmResponse.status, 'LLM'))

          const llmJson: any = await llmResponse.json().catch(() => ({}))
          const scoredLead = mergeLlmResultsWithCandidates([candidate], extractLlmResults(llmJson))[0]
          const nextLead = scoredLead || applySchemaDefaults(candidate)
          cleanedResults[index] = nextLead
          completedCount += 1
          emitLeadScored(_event.sender, nextLead, completedCount, candidates.length)
        } catch (error) {
          probeLlmCrash(error)
          probeError('[Probe-LLM-Error] Candidate:', candidate.company, 'Error:', error instanceof Error ? error.message : String(error || ''), error instanceof Error ? error.stack : '')
          const fallbackLead = applySchemaDefaults({
            ...candidate,
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
          emitLeadScored(_event.sender, fallbackLead, completedCount, candidates.length)
        }
      })

      emitStreamComplete(_event.sender)
      probeLog('[Probe-IPC] Score stream complete emitted before enrichment phase')

      if (cleanedResults.length > 0) {
        emitStage(_event.sender, 'enriching', '正在补全官网与商业信号...')
        const baseResults = cleanedResults.filter(Boolean)
        const enrichedResults: SearchExecuteResult[] = new Array(baseResults.length)
        await runLimitedConcurrency(baseResults, SEARCH_ENRICH_CONCURRENCY, async (item, index) => {
          try {
            const enriched = await withTimeoutGuard(
              enrichLeadWithDeepProbe({
                candidate: item,
                llmEndpoint,
                llmKey,
                model: userConfig?.selectedModel || 'gpt-3.5-turbo',
                timeoutMs: llmTimeoutMs,
                keyword,
                country,
                googleKey,
                icpProfile: userConfig?.icpProfile || undefined,
              }),
              llmTimeoutMs,
              `Enrich lead ${item.company || item.website || index}`
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
              riskFlags: Array.from(new Set([...(baseResults[index].riskFlags || []), '官网访问超时或 AI 评估失败'])).slice(0, 1),
            })
          }
        })
        const finalResults = enrichedResults.map((item, index) => item || applySchemaDefaults(baseResults[index]))
        emitStage(_event.sender, 'complete', '分析完成，线索已更新')
        return { success: true, data: { results: finalResults || [] } }
      }

      emitStage(_event.sender, 'complete', '分析完成，线索已更新')
      return { success: true, data: { results: [] } }
    } catch (error: any) {
      probeLog('[Probe-IPC] Search execute catch triggered, emitting stream:error + stream:complete', {
        message: error?.message || 'Search execute failed',
      })
      emitStreamError(_event.sender, error?.message || 'Search execute failed')
      if (isCircuitBreakerOpenError(error)) return { success: false, error: '目标地区识别失败，系统已自动尝试降级搜索模式，请稍后。', code: error?.status }
      if (isTimeoutError(error)) return { success: false, error: 'AI 数据流连接异常，请稍后重试' }
      return { success: false, error: error?.message || '当前搜索服务暂不可用，请稍后重试' }
    }
  }, '海外客户智能搜索')

  registerSecureFeatureIpc(ipcMain, IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE, store, licenseGuard, 'analysis_advanced', async (_event, payload: { lead: { company: string; industry?: string; country?: string; website?: string; address?: string; phone?: string; contact?: string; contactTitle?: string; snippet?: string; matchReasons?: string[]; riskFlags?: string[]; inferredRole?: string; source?: string; salesStrategy?: string; customerText?: string }; scenario: string }) => {
    try {
      const userConfig = getLatestUserConfigSnapshot(store)
      const providers: Array<{ id?: string; baseUrl?: string }> = Array.isArray(userConfig?.providers) ? userConfig.providers : []
      const llmConfig = providers.find((k) => k.id === 'llm')
      const llmKey = getUserLlmApiKey(store)
      const llmBaseUrl = llmConfig?.baseUrl?.trim()
      const scenario = payload?.scenario as 'direct_quote' | 'competitor_switch' | 'factory_strength' | 'reply_coach'
      const lead = payload?.lead || { company: '' }
      const analysisConfigError = getAnalysisConfigError(userConfig, llmKey, llmBaseUrl)

      if (analysisConfigError) {
        if (shouldUseDevMockAnalysis(analysisConfigError.semantic) && scenario && ['direct_quote', 'competitor_switch', 'factory_strength', 'reply_coach'].includes(scenario) && lead.company) {
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

      if (!lead.company) return buildAnalysisErrorResponse('当前线索信息不足，暂时无法分析', { code: 'insufficient_lead_data' })

      const timeoutMs = Number(userConfig?.analysisTimeoutMs) || DEFAULT_SEARCH_TIMEOUT_MS

      if (scenario === 'reply_coach') {
        const customerText = String(payload?.lead?.customerText || '').trim()
        if (!customerText) return buildAnalysisErrorResponse('请先粘贴客户回信原文，再开始拆解', { code: 'insufficient_lead_data' })

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
          timeoutMs
        )

        if (!llmResponse.ok) throw new Error(mapHttpError(llmResponse.status, 'LLM'))
        const llmJson: any = await llmResponse.json().catch(() => ({}))
        const content = llmJson?.choices?.[0]?.message?.content || llmJson?.choices?.[0]?.text || ''
        const parsed = typeof content === 'string' ? parseReplyCoachResponse(content) : null
        if (!parsed) return buildAnalysisErrorResponse('AI 回信教练暂不可用，请稍后重试', { code: 'provider_unavailable', source: 'reply_coach' })

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
      const websiteContent = normalizedWebsite ? await extractWebsiteContent(normalizedWebsite, timeoutMs) : { title: '', description: '', body: '', directEmails: [], directPhones: [] }
      const fallbackSnippet = lead.snippet ? sanitizePlainText(lead.snippet, 500) : ''
      const websiteText = trimWebsiteTextForLlm([websiteContent.title, websiteContent.description, websiteContent.body, websiteContent.directEmails.join(' '), websiteContent.directPhones.join(' ')].filter(Boolean).join(' ')) || fallbackSnippet
      const knowledgeBaseEntries = Array.isArray(userConfig?.knowledgeBase?.entries)
        ? userConfig.knowledgeBase.entries
            .map((entry: any) => ({
              title: String(entry?.title || '').trim(),
              content: String(entry?.content || '').trim(),
              tags: Array.isArray(entry?.tags) ? entry.tags.map((tag: unknown) => String(tag || '').trim()).filter(Boolean) : [],
            }))
            .filter((entry: { title: string; content: string }) => entry.title || entry.content)
        : []
      const knowledgeBase = pickRelevantKnowledgeEntries(knowledgeBaseEntries, scenario, 5)
      const usedKnowledgeTitles = knowledgeBase.map((entry) => entry.title).filter(Boolean)

      const { system, user } = buildAnalysisPrompt({
        knowledgeBase,
        icpProfile: userConfig?.icpProfile || {},
        lead,
        scenario,
        websiteText,
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
        timeoutMs
      )

      if (!llmResponse.ok) throw new Error(mapHttpError(llmResponse.status, 'LLM'))
      const llmJson: any = await llmResponse.json().catch(() => ({}))
      const content = llmJson?.choices?.[0]?.message?.content || llmJson?.choices?.[0]?.text || ''
      const parsed = typeof content === 'string' ? parseStructuredAnalysisResponse(content) : null
      if (!parsed) return buildAnalysisErrorResponse('AI 分析结果暂不可用，请稍后重试', { code: 'provider_unavailable', source: websiteText ? 'website' : 'snippet' })

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
      return buildAnalysisErrorResponse(error?.message || '当前智能分析服务暂不可用，请稍后重试', semantic, error?.status)
    }
  }, '客户智能分析')
}
