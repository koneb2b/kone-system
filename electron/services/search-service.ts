import * as crypto from 'crypto'
import { app } from './electron-bridge'
import { IPC_CHANNELS } from '../ipc/channels'
import type {
  AnalysisSemanticMeta,
  AnalysisSemanticCode,
  DataSourceType,
  DecisionMaker,
  CustomsData,
  AgentStatus,
} from '../../src/shared/ipc-contracts'
import { validateDecisionMakerContacts } from '../utils/contact-validation'
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
  reason?: string
  matchReasons?: string[]
  riskFlags?: string[]
  matchScore?: number | null
  snippet?: string
  inferredRole?: string
  salesStrategy?: string
  fallbackStatus?: 'social_blind_score'
  /* P1-1 置信标识: ai = LLM 评分；deterministic = 40/30/20/10 确定性预筛分。
     P1-3：与 src/shared/ipc-contracts.ts SearchExecuteResult 对齐，防止序列化丢字段 */
  scoreSource?: 'ai' | 'deterministic'
  /* P2-3 Stage-2 结构化机会分（55/35/10 − Risk Penalty） */
  opportunityScore?: OpportunityScore
  country?: string
  city?: string
  status?: 'new' | 'contacting' | 'replied' | 'archived'
  dataSourceType?: DataSourceType
  dataSourceNote?: string
  exhibitionFootprints?: string[]
  customsData?: CustomsData
  decisionMakers?: DecisionMaker[]
  agentStatus?: AgentStatus
}

type SearchIntentMutation = {
  country: string
  city: string
  pureEnglishProducts: string[]
  keywords: string[]
  countryOfficialLanguages?: string[]
  localizedProducts?: Record<string, string[]>
  localizedKeywords?: Record<string, string[]>
}

/* 邮件生成目标语言的显示标签（ISO 639-1 → 语言名），供 prompt 与前端使用 */
export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  zh: 'Chinese',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  ru: 'Russian',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  ar: 'Arabic',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  cs: 'Czech',
  el: 'Greek',
  hu: 'Hungarian',
  ro: 'Romanian',
  uk: 'Ukrainian',
  he: 'Hebrew',
  hi: 'Hindi',
}

/* 按国家解析邮件目标语言：优先显式 language，缺省取国家官方语言（非英文
   返回首个非 en 语言，英文国家回 en）；无法推导回退 en。 */
const resolveEmailLanguage = (country?: string, explicitLanguage?: string): string => {
  const explicit = String(explicitLanguage || '')
    .trim()
    .toLowerCase()
  if (explicit && LANGUAGE_LABELS[explicit]) return explicit
  if (explicit) return explicit // 合法 ISO 但未在标签表，仍透传
  const langs =
    COUNTRY_LANGUAGE_MAP[
      String(country || '')
        .trim()
        .toLowerCase()
    ] || []
  const nonEnglish = langs.find((l) => l !== 'en')
  return nonEnglish || 'en'
}

const COUNTRY_LANGUAGE_MAP: Record<string, string[]> = {
  germany: ['de', 'en'],
  france: ['fr', 'en'],
  italy: ['it', 'en'],
  spain: ['es', 'en'],
  netherlands: ['nl', 'en'],
  belgium: ['nl', 'fr', 'en'],
  poland: ['pl', 'en'],
  portugal: ['pt', 'en'],
  austria: ['de', 'en'],
  switzerland: ['de', 'fr', 'it', 'en'],
  uk: ['en'],
  'united kingdom': ['en'],
  usa: ['en'],
  'united states': ['en'],
  canada: ['en', 'fr'],
  australia: ['en'],
  japan: ['ja', 'en'],
  china: ['zh', 'en'],
  'south korea': ['ko', 'en'],
  brazil: ['pt', 'en'],
  mexico: ['es', 'en'],
  india: ['hi', 'en'],
  russia: ['ru', 'en'],
  turkey: ['tr', 'en'],
  vietnam: ['vi', 'en'],
  thailand: ['th', 'en'],
  indonesia: ['id', 'en'],
  malaysia: ['ms', 'en'],
  singapore: ['en', 'zh', 'ms', 'ta'],
}

const MAX_SEARCH_CANDIDATES = 200
const SEARCH_CHANNEL_FETCH_LIMIT = 100
const SEARCH_TARGETED_LEAD_LIMIT = 50
/* P1-1：与 SEARCH_TARGETED_LEAD_LIMIT 对齐——全部 50 条目标线索都进入 LLM 评分
   与官网富化，消除"20 真富化 / 50 展示"的非对称（假高分/精度盲区）。
   并发上限仍为 SEARCH_LLM_CONCURRENCY=2（宪法红线，调用总数不改变并发）。 */
const SEARCH_LLM_SCORE_LIMIT = 50
const SEARCH_LLM_CONCURRENCY = 2
const SEARCH_ENRICH_CONCURRENCY = 2
const SERPAPI_RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504])
const SEARCH_LLM_TIMEOUT_MS = 20_000
const WEBSITE_PROBE_TIMEOUT_MS = 15_000
const MAX_WEBSITE_TEXT_FOR_LLM = 3000
const SCOUT_NEGATIVE_TERMS = [
  'auto repair',
  'body shop',
  'mechanic',
  'tire',
  'car wash',
  'oil change',
  'collision',
  'tow',
  'detailing',
  'smog',
]
const SCOUT_B2B_TERMS = [
  'dealer',
  'wholesale',
  'supplier',
  'distributor',
  'manufacturer',
  'factory',
  'industrial',
  'commercial',
  'b2b',
]
const KEYWORD_STOP_TERMS = new Set(['the', 'and', 'for', 'with', 'from', 'usa', 'us', 'global', 'company', 'companies'])

let currentActiveJobId: string | null = null
export const getCurrentActiveJobId = () => currentActiveJobId
/* P3-2 多窗口时空隔离升级：ownerKey（sender WebContents id）→ 最新 jobId。
   单窗口语义与原模块级单例完全兼容（currentActiveJobId 始终指向最新 job，
   供 Provider 与旧路径回退）；多窗口并发时各窗口的异步回调按 owner 解析，
   不再被其他窗口的新搜索误杀。 */
const activeJobIds = new Map<number, string>()
export const isKnownActiveJobId = (jobId: string | undefined): boolean => {
  if (!jobId) return false
  if (jobId === currentActiveJobId) return true
  for (const value of activeJobIds.values()) {
    if (value === jobId) return true
  }
  return false
}
const OMNI_CONTROL_TERMS = [
  /请搜索/g,
  /帮我找/g,
  /帮我寻找/g,
  /搜索/g,
  /查找/g,
  /寻找/g,
  /必须包含/g,
  /包含/g,
  /客户的/g,
  /核心信息/g,
  /条/g,
  /家/g,
  /please\s*(search|find)/gi,
  /must\s*include/gi,
  /with\s*(email|phone|website)/gi,
  /\b\d+\s*(results|leads|items)?\b/gi,
]
const TRASH_LEAD_PATTERNS = [
  /reddit\.com/i,
  /wikipedia\.org/i,
  /\.edu(?:\/|$)/i,
  /\.gov(?:\/|$)/i,
  /imf\.org/i,
  /worldbank\.org/i,
  /招生简章/i,
  /人才简章/i,
  /招聘/i,
  /白皮书/i,
  /行业白皮书/i,
  /论坛/i,
  /报告/i,
  /reddit/i,
  /forum/i,
]

/* P0-2 Eligibility Gate（kone-PRD §0.5.1 Stage 0.5 对齐）：
   结构化 0/1 一票否决。computeScoutRelevance 是"软"过滤（一个锚点词命中即可保留
   含负向信号的候选），本门在其后执行：命中即剔除，杜绝维修店/B2C/二手/平台卖家
   混入高分池。仅覆盖可从候选文本可靠判定的类目；制裁国与 CRM 保护期重复企业
   需要候选之外的上下文数据，暂不在此层实现（诚实边界，不虚报）。 */
const ELIGIBILITY_HARD_VETO_RULES: Array<{ category: string; patterns: RegExp[] }> = [
  {
    category: '维修/保养服务',
    patterns: [
      /\brepair\s*(shop|service|center|centre)/i,
      /\bauto\s*repair\b/i,
      /\bbody\s*shop\b/i,
      /\bmechanic\b/i,
      /\btire\s*(shop|service)/i,
      /\boil\s*change\b/i,
      /\bcollision\s*(center|centre|repair)/i,
      /\bmaintenance\s*service/i,
      /维修服务/i,
      /汽修/i,
      /维修厂/i,
    ],
  },
  {
    category: 'B2C/零售终端',
    patterns: [
      /\bretail\s*store\b/i,
      /\bboutique\b/i,
      /\bonline\s*(store|shop)\b/i,
      /\bweb\s*shop\b/i,
      /\bwebshop\b/i,
      /\be-?commerce\s*store\b/i,
      /\bdirect\s*to\s*consumers?\b/i,
      /\bfor\s*households\s*only\b/i,
      /零售店/i,
      /专卖店/i,
      /旗舰店/i,
    ],
  },
  {
    category: '二手/翻新',
    patterns: [
      /\bused\s*(goods|equipment|cars?|machinery|parts)\b/i,
      /\brefurbished\b/i,
      /\bsecond-?hand\b/i,
      /\bsalvage\s*(yard|parts)/i,
      /\bscrap\s*(yard|metal)/i,
      /二手(设备|汽车|机械)/i,
      /翻新/i,
    ],
  },
  {
    category: '电商平台卖家',
    patterns: [
      /\b(amazon|ebay|aliexpress|shopee|wish|temu)\.(com|de|co\.uk|fr|es|it)/i,
      /\bseller\s*on\s*(amazon|ebay|aliexpress|shopee)\b/i,
      /\b(amazon|ebay)\s*(store|shop|seller)\b/i,
      /\betsy\.com\b/i,
      /电商店铺/i,
    ],
  },
  {
    category: '纯内容/资讯站',
    patterns: [
      /\b(blog|blogger)\b/i,
      /\bnews\s*(portal|website|site)\b/i,
      /\bmagazine\b/i,
      /\bpress\s*release\b/i,
      /\breview\s*site\b/i,
      /\bpinterest\.com\b/i,
      /博客/i,
      /资讯网/i,
      /门户网/i,
    ],
  },
]

/* 产品词命中判定（P0-2）：`text.includes(term)` 的子串匹配会把产品词 "car"
   误伤到 "carpet"、"card"。ASCII 词用词边界正则；本地语言变体（CJK/西里尔等）
   无 \b 语义，退回 includes。 */
export const matchesProductTerm = (text: string, term: string): boolean => {
  const normalized = String(term || '')
    .trim()
    .toLowerCase()
  if (!normalized) return false
  if (/^[\x20-\x7e]+$/.test(normalized)) {
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`).test(text)
  }
  return text.includes(normalized)
}

export const computeEligibilityVeto = (
  candidate: Partial<SearchExecuteResult> & { reason?: string },
): { blocked: boolean; category?: string } => {
  const haystack = [
    candidate.company,
    candidate.website,
    candidate.source,
    candidate.reason,
    candidate.snippet,
    candidate.address,
  ]
    .filter(Boolean)
    .join(' ')
  for (const rule of ELIGIBILITY_HARD_VETO_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return { blocked: true, category: rule.category }
    }
  }
  return { blocked: false }
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

const emitBasicResults = (sender: Electron.WebContents, candidates: Array<Partial<SearchExecuteResult>>) => {
  sender.send(
    IPC_CHANNELS.SEARCH.BASIC_RESULTS,
    candidates.map((item) => applySchemaDefaults({ ...item, matchScore: undefined })),
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

const getAnalysisConfigError = (
  userConfig: any,
  llmKey: string,
  llmBaseUrl?: string,
): { message: string; semantic: AnalysisSemanticMeta } | null => {
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
  const hasIcpProfile = [icpProfile?.targetProduct, icpProfile?.buyerPersona, icpProfile?.coreAdvantage].some((value) =>
    String(value || '').trim(),
  )
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

const shouldUseDevMockAnalysis = (semantic: AnalysisSemanticMeta) =>
  !app.isPackaged && semantic.settingsActionable === true

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

const buildDevMockAnalysisData = (payload: {
  lead: any
  scenario: 'direct_quote' | 'competitor_switch' | 'factory_strength' | 'reply_coach'
  degradedReason: AnalysisSemanticCode
}) => {
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
    const customerText =
      String(payload.lead?.customerText || '').trim() || 'Please share your best price and lead time.'
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
  worker: (item: T, index: number) => Promise<void>,
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
  text = text
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
  text = text.replace(/^json\s*/i, '').trim()
  const first = text.search(/[[{]/)
  const lastObj = text.lastIndexOf('}')
  const lastArr = text.lastIndexOf(']')
  const last = Math.max(lastObj, lastArr)
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1).trim()
  }
  return text
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

const normalizeIntentCountry = (value?: string) => {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  const lower = normalized.toLowerCase()
  if (/美国|usa|u\.s\.|united states|america/.test(lower)) return 'USA'
  if (/英国|uk|u\.k\.|united kingdom/.test(lower)) return 'UK'
  if (/德国|germany|deutschland/.test(lower)) return 'Germany'
  if (/法国|france/.test(lower)) return 'France'
  if (/意大利|italy/.test(lower)) return 'Italy'
  if (/西班牙|spain/.test(lower)) return 'Spain'
  if (/加拿大|canada/.test(lower)) return 'Canada'
  if (/澳大利亚|australia/.test(lower)) return 'Australia'
  return normalized
}

const stripOmniControlTerms = (keyword: string) => {
  let cleaned = String(keyword || '').trim()
  for (const pattern of OMNI_CONTROL_TERMS) {
    cleaned = cleaned.replace(pattern, ' ')
  }
  return cleaned
    .replace(/[，。；：、]/g, ' ')
    .replace(/\b(email|phone|website|contact|information|info)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const fallbackMutateB2BKeywords = (keyword: string): { pureEnglishProducts: string[]; keywords: string[] } => {
  const cleaned = stripOmniControlTerms(keyword)
  const lower = cleaned.toLowerCase()
  const rawProduct = /高尔夫|golf\s*cart/.test(lower)
    ? 'Golf cart'
    : cleaned
        .replace(
          /在?美国|usa|united states|品牌|经销商|批发商|独立站|批发|dealer|distributor|wholesaler|supplier|manufacturer|importer/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase()) ||
      cleaned ||
      keyword

  const raw = rawProduct.replace(/\s+/g, ' ').trim()
  const products = raw
    .split(/[,，、/]/)
    .map((p) => p.trim())
    .filter(Boolean)
  const pureEnglishProducts = products.length > 0 ? products : [raw]
  return {
    pureEnglishProducts,
    keywords: Array.from(new Set(pureEnglishProducts.flatMap((p) => B2B_ROLE_TERMS.map((role) => `${p} ${role}`))))
      .filter(Boolean)
      .slice(0, 4),
  }
}

const B2B_ROLE_TERMS = ['dealer', 'distributor', 'importer', 'wholesaler', 'supplier', 'manufacturer']

const crossProductB2BKeywords = (products: string[], country: string): string[] =>
  Array.from(
    new Set(
      products.flatMap((product) =>
        B2B_ROLE_TERMS.slice(0, 4).map((role) => (country ? `${product} ${role} ${country}` : `${product} ${role}`)),
      ),
    ),
  )
    .filter(Boolean)
    .slice(0, 4)

const buildIntentMutationPrompt = (payload: { keyword: string; country: string; city: string }) => ({
  system: mergePromptParts(
    'You are an intent parser for a B2B lead search engine. ',
    'Never pass the raw user sentence downstream. ',
    'Remove control words such as search, find, 50 leads, must include email, phone, website. ',
    'Extract ALL discrete CORE PRODUCT terms and TARGET LOCATION from the user input. ',
    'Split compound or multi-product input into separate product entries. ',
    'Return pureEnglishProducts as an ARRAY of individual product terms, never concatenated. ',
    'Then cross-multiply each core product with exactly 3 B2B role suffixes from: dealer, distributor, importer, wholesaler, supplier, manufacturer. ',
    'Optionally append location as a qualifier for natural keyword phrasing. ',
    'If a country is specified, detect its official language(s). For each official language (other than English), translate pureEnglishProducts into that language and generate localized B2B keywords. Use distributor/dealer/importer/wholesaler equivalents in the local language. ',
    'Return ONLY valid JSON with the following structure: {"country":"USA","city":"","pureEnglishProducts":["Golf cart","car monitor"],"b2bAttributes":["wholesaler","distributor","importer","dealer"],"keywords":["Golf cart dealer","Golf cart distributor","car monitor wholesaler","car monitor importer"],"countryOfficialLanguages":["en"],"localizedProducts":{"es":["carro de golf","monitor de coche"]},"localizedKeywords":{"es":["carro de golf distribuidor","carro de golf importador","monitor de coche mayorista"]}}. ',
    'countryOfficialLanguages must be an array of ISO language codes (en, fr, de, es, it, ja, zh, etc). ',
    'localizedProducts maps each non-English language code to translated product term arrays. ',
    'localizedKeywords maps each non-English language code to translated B2B keyword arrays. ',
    'If country is empty or English-only, set countryOfficialLanguages to ["en"] and omit localizedProducts/localizedKeywords. ',
    'Never use raw user control words like "50条", "必须包含邮箱", "search", "find", "帮我找" in keywords. ',
    'pureEnglishProducts must always be an array, never a single string. ',
    'localizedProducts and localizedKeywords must also be arrays, never single strings.',
  ),
  user: JSON.stringify(payload),
})

const parseIntentMutation = (raw: string): Partial<SearchIntentMutation> | null => {
  try {
    const parsed = JSON.parse(normalizeLlmJsonText(raw))
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
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
    const llmProducts = rawProducts.length > 0 ? rawProducts : []
    const keywords = llmKeywords.length > 0 ? llmKeywords.slice(0, 4) : fallback.keywords
    const pureEnglishProducts = llmProducts.length > 0 ? llmProducts : fallback.pureEnglishProducts

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

const isTrashLead = (candidate: Partial<SearchExecuteResult> & { reason?: string }) => {
  const haystack = [
    candidate.company,
    candidate.website,
    candidate.source,
    candidate.reason,
    candidate.snippet,
    candidate.address,
  ]
    .filter(Boolean)
    .join(' ')
  return TRASH_LEAD_PATTERNS.some((pattern) => pattern.test(haystack))
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

const extractKeywordAnchors = (keyword: string) => {
  const normalized = String(keyword || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
  return Array.from(
    new Set(
      normalized
        .split(/\s+/g)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !KEYWORD_STOP_TERMS.has(term)),
    ),
  )
}

const computeScoutRelevance = (
  candidate: Partial<SearchExecuteResult> & { reason?: string },
  keyword: string,
  options?: { priorityWebsite?: boolean; b2bRoleOnly?: boolean; localDomainOnly?: boolean; countryTlds?: string[] },
) => {
  const anchors = extractKeywordAnchors(keyword)
  const text =
    `${candidate.company || ''} ${candidate.reason || ''} ${candidate.snippet || ''} ${candidate.website || ''}`.toLowerCase()
  const anchorHits = anchors.filter((term) => text.includes(term))
  const b2bHits = SCOUT_B2B_TERMS.filter((term) => text.includes(term))
  const negativeHits = SCOUT_NEGATIVE_TERMS.filter((term) => text.includes(term))
  const noWebsitePenalty = Boolean(options?.priorityWebsite && !String(candidate.website || '').trim())
  const missingB2BSignalPenalty = Boolean(options?.b2bRoleOnly && b2bHits.length === 0)
  /* L1-2/N1：优先本土域名 —— 激活主进程 COUNTRY_TLD_MAP（此前为死代码，
     仅前端二次过滤生效）。未知国家（无 TLD 映射）不强制，镜像前端语义。 */
  const allowedTlds = Array.isArray(options?.countryTlds) ? options!.countryTlds! : []
  const websiteHost = String(candidate.website || '')
    .trim()
    .toLowerCase()
  const notLocalDomain = Boolean(
    options?.localDomainOnly &&
    allowedTlds.length > 0 &&
    (!websiteHost || !allowedTlds.some((tld) => websiteHost.endsWith(String(tld).toLowerCase()))),
  )
  const keep =
    !(negativeHits.length > 0 && anchorHits.length === 0 && b2bHits.length === 0) &&
    !noWebsitePenalty &&
    !missingB2BSignalPenalty &&
    !notLocalDomain

  return {
    keep,
    reason: keep
      ? ''
      : notLocalDomain
        ? '非本土域名'
        : noWebsitePenalty
          ? '缺少官网信号'
          : missingB2BSignalPenalty
            ? '缺少 B2B 信号'
            : '行业偏离',
    anchorHits,
    b2bHits,
    negativeHits,
  }
}

export const computeIcpMatchScore = (candidate: Partial<SearchExecuteResult>, coreProductTerms: string[]): number => {
  let score = 0
  const domain = extractDomainFromUrl(candidate.website)
  const hasWebsite = Boolean(domain)
  score += hasWebsite ? 40 : 10
  const text =
    `${candidate.company || ''} ${candidate.snippet || ''} ${candidate.reason || ''} ${(candidate.matchReasons || []).join(' ')}`.toLowerCase()
  const productMatch = coreProductTerms.some((term) => matchesProductTerm(text, term))
  score += productMatch ? 30 : 0
  const b2bSignals = ['wholesale', 'distribute', 'import', 'b2b', 'shop', 'dealer', 'supplier', 'manufacturer']
  const b2bHits = b2bSignals.filter((signal) => text.includes(signal))
  if (b2bHits.length >= 3) score += 20
  else if (b2bHits.length >= 1) score += 10
  const hasContact = Boolean(candidate.contact || candidate.email || candidate.phone)
  score += hasContact ? 10 : 0
  return Math.min(100, Math.max(0, score))
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

const applySchemaDefaults = (item: Partial<SearchExecuteResult>): SearchExecuteResult => ({
  id: String(item.id || crypto.randomUUID()),
  company: String(item.company || '').trim(),
  website: String(item.website || '').trim(),
  contact: item.contact ? String(item.contact).trim() : '',
  contactTitle: item.contactTitle ? String(item.contactTitle).trim() : '',
  email: item.email ? String(item.email).trim() : '',
  phone: String(item.phone || '').trim(),
  address: String(item.address || '').trim(),
  isB2B: typeof item.isB2B === 'boolean' ? item.isB2B : (item.isB2B ?? undefined),
  source: String(item.source || '').trim() || 'Google Maps',
  reason: item.reason ? String(item.reason).trim() : '',
  matchReasons: Array.isArray(item.matchReasons)
    ? item.matchReasons
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 2)
    : [],
  riskFlags: Array.isArray(item.riskFlags)
    ? item.riskFlags
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 1)
    : [],
  matchScore: Number.isFinite(Number(item.matchScore))
    ? Math.max(0, Math.min(100, Number(item.matchScore)))
    : undefined,
  snippet: item.snippet ? String(item.snippet).trim() : undefined,
  fallbackStatus: item.fallbackStatus === 'social_blind_score' ? 'social_blind_score' : undefined,
  /* P1-3：以下五个字段此前在序列化时被丢弃，导致前端"跟进建议/推断角色"永久空白
     （src/hooks/use-search-engine.ts:552-559 与 search-result-card.tsx:175-184 依赖它们） */
  inferredRole: item.inferredRole ? String(item.inferredRole).trim() : undefined,
  salesStrategy: item.salesStrategy ? String(item.salesStrategy).trim() : undefined,
  country: item.country ? String(item.country).trim() : undefined,
  city: item.city ? String(item.city).trim() : undefined,
  status: item.status === 'contacting' || item.status === 'replied' || item.status === 'archived' ? item.status : 'new',
  /* P1-1 置信标识：评分来源（ai=LLM 评分 / deterministic=确定性 40/30/20/10 预筛分） */
  scoreSource: item.scoreSource === 'ai' ? 'ai' : item.scoreSource === 'deterministic' ? 'deterministic' : undefined,
  /* P2-3 结构化机会分透传（白名单序列化，非法输入在此归一/剔除） */
  opportunityScore: normalizeOpportunityScore(item.opportunityScore),
  dataSourceType: item.dataSourceType || 'google_maps',
  dataSourceNote: item.dataSourceNote ? String(item.dataSourceNote).trim() : undefined,
  exhibitionFootprints: Array.isArray(item.exhibitionFootprints) ? item.exhibitionFootprints : [],
  customsData:
    item.customsData &&
    typeof item.customsData === 'object' &&
    Object.keys(item.customsData as Record<string, unknown>).length > 0
      ? item.customsData
      : {},
  decisionMakers: Array.isArray(item.decisionMakers) ? item.decisionMakers : [],
  agentStatus:
    item.agentStatus &&
    typeof item.agentStatus === 'object' &&
    Object.keys(item.agentStatus as Record<string, unknown>).length > 0
      ? item.agentStatus
      : { whatsappSent: false, linkedinContacted: false, emailSequenceStage: 0 as const },
})

const sanitizePlainText = (value: string, maxLen = 2800) =>
  value
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex -- 剥离 C0 控制字符是本函数的唯一职责
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen)

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
        .flatMap((part) => LOCATION_TERM_ALIASES[part] || [part]),
    ),
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

const extractEmailsFromText = (input: string) =>
  Array.from(new Set((input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((item) => item.trim())))

const extractPhonesFromText = (input: string) =>
  Array.from(
    new Set(
      (input.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [])
        .map((item) => item.replace(/\s+/g, ' ').trim())
        .filter((item) => item.replace(/\D/g, '').length >= 8),
    ),
  )

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
  failureCode,
})

const mergeUniqueValues = (...collections: string[][]) =>
  Array.from(
    new Set(
      collections
        .flat()
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )

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
    body: sanitizePlainText(
      validProbes
        .map((probe) => probe.body)
        .filter(Boolean)
        .join(' '),
      2200,
    ),
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
    'Keep the outreach angle concise and commercially usable.',
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
    'NEVER filter data.',
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
    /* P2-3 Stage-2 机会分模型（kone-PRD §0.5.1）：ICP Fit 55 + Intent(Why-Now) 35 + Evidence 10 − Risk Penalty 0-20。
       与 Stage-1 确定性 40/30/20/10 是分层关系，互不替代。 */
    'Evaluate with 4 dimensions: business synergy, role match, advantage resonance, and company strength. ',
    'Then derive a structured opportunityScore: icpFit (0-55: product application fit, distributor/importer/OEM positioning, regional coverage, purchasing capacity), intent (0-35: Why-Now buying signals such as RFQ/tender/new line/certification/expansion — 0 when no verifiable signal), evidence (0-10: strength of the cited evidence), riskPenalty (0-20: generic-email-only or info@ contact +5~10, no identified decision maker +5, minimal website +5). ',
    'finalScore = icpFit + intent + evidence − riskPenalty, clamped to 0-100. ',
    'If a candidate clearly matches the Negative ICP, set icpFit to 0 immediately and keep finalScore very low. ',
    `Target product: ${targetProduct}. `,
    `Preferred buyer role: ${buyerPersona}. `,
    `Core advantage: ${coreAdvantage}. `,
    `Negative ICP: ${negativeIcp}. `,
    'Do not remove any item. Return a top-level JSON object with key "results". ',
    'Each item must contain: company, website, address, totalScore, opportunityScore, inferredRole, matchReason, salesStrategy, riskFlags, isB2B. ',
    'totalScore must equal opportunityScore.finalScore (number 0-100). opportunityScore must be an object {icpFit, intent, evidence, riskPenalty, finalScore} of integers. ',
    'inferredRole must be a short inferred buying/company role. ',
    'matchReason must be one short conclusion. salesStrategy must be one short follow-up suggestion tied to the core advantage. ',
    'riskFlags must contain exactly 1 short risk flag. isB2B must be boolean. ',
    'Never invent contact names, emails, or phone numbers. Never output markdown or explanations outside JSON.',
  )
}

const buildAnalysisSystemPrompt = (knowledgeBaseText: string, emailLanguage = 'en') => {
  const langLabel = LANGUAGE_LABELS[emailLanguage] || emailLanguage
  const emailLangInstr =
    emailLanguage === 'en'
      ? [
          'emailSubject must be a concise high-open-rate English subject line. ',
          'emailBody must be a professional English cold email body tailored to the target company, without markdown. ',
        ]
      : [
          `emailSubject must be a concise high-open-rate subject line written in ${langLabel}. `,
          `emailBody must be a professional cold email body written in ${langLabel}, tailored to the target company, without markdown. `,
          'Keep companyProfile/painPoints/valueMapping analysis fields in Chinese; only the email subject/body follow the target language. ',
        ]
  return mergePromptParts(
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
    "painPoints must infer the customer's likely operational or commercial pain points in Chinese. ",
    'valueMapping must explicitly map which seller advantage/product/knowledge point solves which customer pain point in Chinese. ',
    ...emailLangInstr,
    'confidence must be an integer from 0 to 100. ',
    'Keep static reasoning rules here; dynamic company and website data will be passed separately.\n\n',
    '[KNOWLEDGE BASE DATA:\n',
    knowledgeBaseText,
    '\n]',
  )
}

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
    'Do not invent facts beyond the provided context.',
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
      fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': 'Kone-AI/1.0' } }, timeoutMs),
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
    return {
      ok: true,
      url,
      title: titleMatch?.[1] ? sanitizePlainText(titleMatch[1], 200) : '',
      description: descMatch?.[1] ? sanitizePlainText(descMatch[1], 400) : '',
      body: sanitizePlainText(bodyText, 2200),
      directEmails: Array.from(
        new Set(
          contactHrefMatches
            .map((match) => match[1])
            .filter(Boolean)
            .map((item) => String(item).trim()),
        ),
      ),
      directPhones: Array.from(
        new Set(
          contactHrefMatches
            .map((match) => match[2])
            .filter(Boolean)
            .map((item) => String(item).trim()),
        ),
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

  const contactUrls = buildContactPageUrls(url)
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
  skipLlmProbe?: boolean
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

  const contact = String(payload.candidate.contact || extracted.contact || '').trim()
  const contactTitle = String(payload.candidate.contactTitle || extracted.contactTitle || '').trim()
  const email = String(payload.candidate.email || websiteContent.directEmails[0] || extracted.email || '').trim()
  const phone = String(payload.candidate.phone || websiteContent.directPhones[0] || extracted.phone || '').trim()
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
              source: String(payload.candidate.source || 'Google Maps').trim(),
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
      contact,
      contactTitle,
      email,
      phone,
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

export const buildSearchScoringPrompt = (payload: {
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
  }
  scenario: 'direct_quote' | 'competitor_switch' | 'factory_strength'
  websiteText: string
  language?: string
}) => {
  const scenarioMap = {
    direct_quote: 'Direct Quote Entry',
    competitor_switch: 'Competitor Replacement',
    factory_strength: 'Factory Strength Proof',
  } as const
  const knowledgeBaseText = payload.knowledgeBase.length
    ? payload.knowledgeBase
        .map(
          (entry, index) =>
            `${index + 1}. ${entry.title}${entry.tags?.length ? ` [${entry.tags.join(', ')}]` : ''}\n${entry.content}`,
        )
        .join('\n\n')
    : '暂无知识库内容，请仅基于线索与网站信息分析。'
  return {
    system: buildAnalysisSystemPrompt(knowledgeBaseText, payload.language || 'en'),
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
  lead: {
    company: string
    industry?: string
    country?: string
    website?: string
    snippet?: string
    salesStrategy?: string
    customerText?: string
  }
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
      confidence: Number.isFinite(confidenceValue)
        ? Math.max(0, Math.min(100, Math.round(confidenceValue)))
        : undefined,
      rawContent: trimmed,
      parseFallback: false,
      content: emailBody,
    }
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
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
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
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
  limit = 5,
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

/* P2-3 Stage-2 机会分模型（kone-PRD §0.5.1）：ICP Fit 55 + Intent(Why-Now) 35 +
   Evidence 10 − Risk Penalty(0-20)。钳制各维度并按公式重算 finalScore；
   输入缺失/非法 → undefined（诚实缺省，不臆造）。纯函数，导出供测试。 */
export type OpportunityScore = {
  icpFit: number
  intent: number
  evidence: number
  riskPenalty: number
  finalScore: number
}

const clampInt = (value: unknown, min: number, max: number): number => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min
}

export const normalizeOpportunityScore = (raw: unknown): OpportunityScore | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const hasAnyField = ['icpFit', 'intent', 'evidence', 'riskPenalty', 'finalScore'].some((k) => obj[k] !== undefined)
  if (!hasAnyField) return undefined
  const icpFit = clampInt(obj.icpFit, 0, 55)
  const intent = clampInt(obj.intent, 0, 35)
  const evidence = clampInt(obj.evidence, 0, 10)
  const riskPenalty = clampInt(obj.riskPenalty, 0, 20)
  const finalScore = Math.max(0, Math.min(100, icpFit + intent + evidence - riskPenalty))
  return { icpFit, intent, evidence, riskPenalty, finalScore }
}

const extractLlmResults = (llmPayload: any) => {
  const content = llmPayload?.choices?.[0]?.message?.content || llmPayload?.choices?.[0]?.text || ''
  if (!content || typeof content !== 'string') return []
  try {
    const parsed = JSON.parse(normalizeLlmJsonText(content))
    const results = Array.isArray(parsed)
      ? parsed
      : parsed?.results ||
        parsed?.data?.results ||
        parsed?.candidates ||
        parsed?.data?.candidates ||
        parsed?.items ||
        parsed?.data?.items ||
        (parsed && typeof parsed === 'object' ? [parsed] : [])
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
        ? item.riskFlags
            .map((entry: unknown) => String(entry || '').trim())
            .filter(Boolean)
            .slice(0, 1)
        : [],
      isB2B: typeof item?.isB2B === 'boolean' ? item.isB2B : undefined,
      /* P2-3 Stage-2 机会分结构化输出（非法/缺失 → undefined，不臆造） */
      opportunityScore: normalizeOpportunityScore(item?.opportunityScore),
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
  llmResults: SearchExecuteResult[],
) => {
  const resultPool = Array.isArray(llmResults) ? llmResults : []
  const usedResultIndexes = new Set<number>()

  return candidates.map((candidate) => {
    const normalizedCandidateCompany = candidate.company.trim().toLowerCase()
    const normalizedCandidateWebsite = extractDomainFromUrl(candidate.website)

    const matchedIndex = resultPool.findIndex((result, index) => {
      if (usedResultIndexes.has(index)) return false
      const normalizedResultCompany = String(result.company || '')
        .trim()
        .toLowerCase()
      const normalizedResultWebsite = extractDomainFromUrl(result.website)

      if (
        normalizedCandidateWebsite &&
        normalizedResultWebsite &&
        normalizedCandidateWebsite === normalizedResultWebsite
      ) {
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
        matchReasons:
          matched?.matchReasons ||
          [candidate.reason || candidate.snippet || '基础信息与搜索词存在一定相关性'].filter(Boolean).slice(0, 2),
        riskFlags: matched?.riskFlags || ['需人工复核其 B2B 采购意图'],
        snippet: matched?.snippet || candidate.snippet,
      }),
      inferredRole: matched?.inferredRole || '',
      salesStrategy: matched?.salesStrategy || '',
    }
  })
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
        /* P3-2：登记 owner 作用域的活跃 job；currentActiveJobId 保留为全局最新（兼容） */
        const jobOwnerKey = _event?.sender?.id ?? 0
        activeJobIds.set(jobOwnerKey, myJobId)
        currentActiveJobId = myJobId
        const activeJobIdFor = (): string | null => activeJobIds.get(jobOwnerKey) ?? currentActiveJobId

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
          throw new Error(`缺少配置. Debug: key=[${googleKey}], url=[${googleBaseUrl || ''}]`)
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
          }> = await Promise.all(
            allSearchKeywords.map(async ({ keyword: mutatedKeyword, language: searchLanguage }) => {
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
            }),
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
          const lateSourcesPromise = aggregateLateSources()
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

        /* L1-2/N1：高相关过滤（只看高相关） —— 严格对齐前端“只看高相关”的语义：
         matchScore >= 60，未评分项视为不通过（0 < 60）。在 ICP 评分完成后、
         入选 targetedLeads 切片前执行，与前端语义严格对齐。 */
        const relevanceFilteredLeads = filterOptions?.highRelevanceOnly
          ? scoredMergedLeads.filter((lead) => typeof lead.matchScore === 'number' && (lead.matchScore as number) >= 60)
          : scoredMergedLeads

        if (filterOptions?.highRelevanceOnly) {
          probeLog('[Probe-Filter] HighRelevanceOnly discarded:', {
            input: scoredMergedLeads.length,
            kept: relevanceFilteredLeads.length,
            discarded: scoredMergedLeads.length - relevanceFilteredLeads.length,
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
          withPipelineIsolation(async (runId) => {
            const pipelineQueue = buildAgentTaskQueue(targetedLeads)
            stageAgentsFromPipeline(pipelineQueue, _event.sender, store, runId)
          })
          return { success: true, data: { results: targetedLeads.map((item) => applySchemaDefaults(item)) } }
        }

        probeLog('[Probe-IPC] Scoring queue starting', {
          candidateCount: leadsForScoring.length,
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
        await runLimitedConcurrency(leadsForScoring, SEARCH_LLM_CONCURRENCY, async (candidate, index) => {
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
            emitLeadScored(_event.sender, fallbackLead, completedCount, leadsForScoring.length)
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
              emitLeadScored(_event.sender, nextLead, completedCount, leadsForScoring.length)
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
            emitLeadScored(_event.sender, nextLead, completedCount, leadsForScoring.length)
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
                remaining: leadsForScoring.length - completedCount,
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
            emitLeadScored(_event.sender, fallbackLead, completedCount, leadsForScoring.length)
          }
        })

        if (cleanedResults.length > 0) {
          emitStage(_event.sender, 'enriching', '正在补全官网与商业信号...')
          const baseResults = cleanedResults.filter(Boolean)
          const enrichedResults: SearchExecuteResult[] = new Array(baseResults.length)
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
                }),
                /* 外层守卫必须 ≥ 内部最坏耗时（官网抓取 15s + LLM 深探 20s = 35s），
                   否则高分线索的深探总是被外层守卫砍掉，表现为大量
                   "官网访问超时或 AI 评估失败"（此前 llmTimeoutMs 恒 60s 掩盖了此问题）。 */
                llmTimeoutMs + WEBSITE_PROBE_TIMEOUT_MS,
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
          const finalResults = targetedLeads.map((item) => {
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
          emitStage(_event.sender, 'complete', '分析完成，线索已更新')
          emitStreamComplete(_event.sender)
          // Pipeline: STAGE enriched leads for human review (never auto-send)
          withPipelineIsolation(async (runId) => {
            const pipelineQueue = buildAgentTaskQueue(finalResults)
            stageAgentsFromPipeline(pipelineQueue, _event.sender, store, runId)
          })
          return { success: true, data: { results: finalResults.slice(0, SEARCH_TARGETED_LEAD_LIMIT) || [] } }
        }

        emitStage(_event.sender, 'complete', '分析完成，线索已更新')
        emitStreamComplete(_event.sender)
        return { success: true, data: { results: [] } }
      } catch (error: any) {
        probeLog('[Probe-IPC] Search execute catch triggered, emitting stream:error + stream:complete', {
          message: error?.message || 'Search execute failed',
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
