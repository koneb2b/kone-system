import { stableHash } from '@/lib/utils'
import type { LeadAnalysisCacheEntry, LeadItem, LeadSearchResult } from '@/store/leads-store'
import type {
  SearchExecuteResult,
  DataSourceType,
  DecisionMaker,
  CustomsData,
  AgentStatus,
} from '@/shared/ipc-contracts'

type LeadMapperInput = Partial<Omit<SearchExecuteResult, 'id'>> & {
  id?: number | string
  company: string
  industry?: LeadSearchResult['industry']
  unlocked?: LeadSearchResult['unlocked']
  countryCode?: LeadSearchResult['countryCode']
  status?: LeadSearchResult['status']
  analysisCache?: Record<string, LeadAnalysisCacheEntry | unknown>
  /* V1.3 */
  dataSourceType?: DataSourceType
  exhibitionFootprints?: string[]
  customsData?: CustomsData
  decisionMakers?: DecisionMaker[]
  agentStatus?: AgentStatus
}

type LeadMapperContext = {
  country?: string
  countryCode?: string
  industry?: string
  addedDate?: string
  estimatedValue?: string
  lastActivity?: string
}

const VALID_DATASOURCE_VALUES = new Set<string>([
  'google_maps',
  'google_organic',
  'customs_shipment',
  'trade_show',
  'yellow_pages',
  'linkedin_search',
  'facebook_search',
  'anysearch',
])

const normalizeDataSourceType = (raw?: unknown): DataSourceType | undefined => {
  if (!raw) return undefined
  const value = String(raw).trim()
  return VALID_DATASOURCE_VALUES.has(value) ? (value as DataSourceType) : undefined
}

const normalizeDecisionMakers = (raw?: unknown): DecisionMaker[] | undefined => {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const sanitized: DecisionMaker[] = []
  for (const dm of raw) {
    if (!dm || typeof dm !== 'object') continue
    const rec = dm as Record<string, unknown>
    const name = String(rec.name || '').trim()
    if (!name) continue
    sanitized.push({
      name,
      title: String(rec.title || '').trim() || '未知职位',
      email: String(rec.email || '').trim(),
      phone: String(rec.phone || '').trim(),
      linkedinUrl: rec.linkedinUrl ? String(rec.linkedinUrl).trim() : undefined,
      source: String(rec.source || '').trim() || '外部数据源',
      confidenceScore: Number.isFinite(Number(rec.confidenceScore))
        ? Math.max(0, Math.min(100, Number(rec.confidenceScore)))
        : 0,
    })
  }
  return sanitized.length > 0 ? sanitized : undefined
}

const normalizeCustomsData = (raw?: unknown): CustomsData | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const result: CustomsData = {}
  if (rec.annualImportVolume) result.annualImportVolume = String(rec.annualImportVolume).trim()
  if (Array.isArray(rec.topSuppliers)) {
    const items = rec.topSuppliers.map((s) => String(s).trim()).filter(Boolean)
    if (items.length > 0) result.topSuppliers = items
  }
  if (Array.isArray(rec.originCountries)) {
    const items = rec.originCountries.map((s) => String(s).trim()).filter(Boolean)
    if (items.length > 0) result.originCountries = items
  }
  if (rec.lastShipmentDate) result.lastShipmentDate = String(rec.lastShipmentDate).trim()
  return Object.keys(result).length > 0 ? result : undefined
}

const normalizeAgentStatus = (raw?: unknown): AgentStatus | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const whatsappStatus = rec.whatsappStatus
  const validStatusValues = new Set(['pending', 'delivered', 'replied', 'failed'])
  return {
    whatsappSent: Boolean(rec.whatsappSent),
    whatsappStatus:
      whatsappStatus && validStatusValues.has(String(whatsappStatus).trim())
        ? (String(whatsappStatus).trim() as 'pending' | 'delivered' | 'replied' | 'failed')
        : undefined,
    linkedinContacted: Boolean(rec.linkedinContacted),
    emailSequenceStage: Number.isFinite(Number(rec.emailSequenceStage))
      ? (Math.min(3, Math.max(0, Number(rec.emailSequenceStage))) as 0 | 1 | 2 | 3)
      : (0 as 0 | 1 | 2 | 3),
  }
}

const createNumericLeadId = (input: string) => {
  const hashed = stableHash(input)
  return Number.parseInt(hashed, 36) || Date.now()
}

const resolveCountryCode = (countryCode?: string, country?: string) => {
  const normalizedCode = String(countryCode || '')
    .trim()
    .toUpperCase()
  if (normalizedCode) return normalizedCode.slice(0, 2)

  const normalizedCountry = String(country || '').trim()
  if (!normalizedCountry) return 'GL'
  return normalizedCountry.slice(0, 2).toUpperCase()
}

const normalizeAnalysisCache = (analysisCache?: Record<string, LeadAnalysisCacheEntry | unknown>) => {
  if (!analysisCache || typeof analysisCache !== 'object') return undefined
  return analysisCache as Record<string, LeadAnalysisCacheEntry>
}

export const mapSearchResultToLeadItem = (result: LeadMapperInput, context: LeadMapperContext = {}): LeadItem => {
  const company = String(result.company || '').trim()
  const website = String(result.website || '').trim()
  const country = String(context.country || result.country || 'Global').trim() || 'Global'
  const industry = String(context.industry || result.industry || '').trim()
  const addedDate = context.addedDate || new Date().toISOString().slice(0, 10)
  const numericId = Number(result.id)
  const id =
    Number.isFinite(numericId) && numericId > 0
      ? numericId
      : createNumericLeadId(`${company}::${website}::${country}::${industry}`)

  return {
    id,
    /* P0-1：保留搜索产物稳定 UUID（字符串 id），供 agentStatus 写回关联 */
    leadKey: typeof result.id === 'string' && result.id.trim() ? result.id.trim() : undefined,
    company,
    contact: String(result.contact || '').trim(),
    contactTitle: String(result.contactTitle || '').trim(),
    email: String(result.email || '').trim(),
    phone: String(result.phone || '').trim(),
    country,
    countryCode: resolveCountryCode(context.countryCode || result.countryCode, country),
    industry,
    source: String(result.source || 'Google Maps').trim() || 'Google Maps',
    matchScore: typeof result.matchScore === 'number' ? result.matchScore : undefined,
    fallbackStatus: result.fallbackStatus === 'social_blind_score' ? 'social_blind_score' : undefined,
    /* P1-1 置信标识透传：区分 LLM 评分与确定性预筛分 */
    scoreSource:
      result.scoreSource === 'ai' ? 'ai' : result.scoreSource === 'deterministic' ? 'deterministic' : undefined,
    /* P2-3 结构化机会分透传 */
    opportunityScore:
      result.opportunityScore && typeof result.opportunityScore === 'object' ? result.opportunityScore : undefined,
    status: 'new',
    followUp: 'new',
    starred: false,
    lastActivity: context.lastActivity || '刚刚',
    addedDate,
    tags: [],
    unlocked: Boolean(result.unlocked),
    website,
    estimatedValue: context.estimatedValue || '-',
    address: result.address ? String(result.address).trim() : undefined,
    snippet: result.snippet ? String(result.snippet).trim() : undefined,
    matchReasons: Array.isArray(result.matchReasons) ? result.matchReasons.filter(Boolean) : [],
    riskFlags: Array.isArray(result.riskFlags) ? result.riskFlags.filter(Boolean) : [],
    inferredRole: result.inferredRole ? String(result.inferredRole).trim() : undefined,
    salesStrategy: result.salesStrategy ? String(result.salesStrategy).trim() : undefined,
    analysisCache: normalizeAnalysisCache(result.analysisCache),
    /* V1.3 多源融合字段 */
    dataSourceType: normalizeDataSourceType(result.dataSourceType),
    exhibitionFootprints: Array.isArray(result.exhibitionFootprints) ? result.exhibitionFootprints : undefined,
    customsData: normalizeCustomsData(result.customsData),
    decisionMakers: normalizeDecisionMakers(result.decisionMakers),
    agentStatus: normalizeAgentStatus(result.agentStatus),
  }
}

/* 搜索结果卡片"结算态"推导：根据线索评分态与当前搜索阶段，决定卡片展示
 * 待评估 / 流式分析中 / 已评分 / 社交盲评 / AI 未启用 / 降级回退 等形态。
 * 纯函数，便于单元测试；`isStreaming` / `aiScoringSkipped` 为全局搜索阶段标志，
 * 由调用方（搜索结果列表）注入，避免与单条线索数据耦合。 */
export const SOCIAL_BLIND_SCORE_MESSAGE = '官网受保护，已使用 LinkedIn / 行业目录公开信息完成盲评'

export type SettlementMeta = {
  state: string
  showPending: boolean
  showFallback: boolean
  fallbackTone: 'blue' | 'amber'
  fallbackReason: string
}

export const getLeadSettlementMeta = (
  lead: LeadSearchResult,
  opts: { isStreaming: boolean; aiScoringSkipped: boolean },
): SettlementMeta => {
  const { isStreaming, aiScoringSkipped } = opts
  const hasNumericScore = typeof lead.matchScore === 'number'
  const primaryReason =
    Array.isArray(lead.matchReasons) && lead.matchReasons.length > 0 ? String(lead.matchReasons[0] || '').trim() : ''
  const riskFlags = Array.isArray(lead.riskFlags) ? lead.riskFlags.map((item) => String(item || '').trim()) : []
  const hasWebsite403 = riskFlags.includes('website_403')
  const hasBlindScoreFailed = riskFlags.includes('blind_score_failed')
  const isSocialBlindScore = lead.fallbackStatus === 'social_blind_score' && hasNumericScore

  if (isSocialBlindScore) {
    return {
      state: 'social_blind_score',
      showPending: false,
      showFallback: true,
      fallbackTone: 'blue',
      fallbackReason: SOCIAL_BLIND_SCORE_MESSAGE,
    }
  }
  if (hasNumericScore) {
    return { state: 'scored', showPending: false, showFallback: false, fallbackTone: 'amber', fallbackReason: '' }
  }
  if (isStreaming) {
    return { state: 'streaming', showPending: true, showFallback: false, fallbackTone: 'amber', fallbackReason: '' }
  }
  if (aiScoringSkipped) {
    return {
      state: 'ai_skipped',
      showPending: false,
      showFallback: true,
      fallbackTone: 'amber',
      fallbackReason: '当前未启用 AI 评分，已展示基础结果',
    }
  }
  if (hasWebsite403 && hasBlindScoreFailed) {
    return {
      state: 'fallback',
      showPending: false,
      showFallback: true,
      fallbackTone: 'amber',
      fallbackReason: '官网存在防爬限制，且 AI 盲评超时失败，建议稍后重试或人工复核',
    }
  }
  const hasUsableFallbackData = Boolean(primaryReason || riskFlags.some(Boolean))
  return {
    state: 'fallback',
    showPending: false,
    showFallback: true,
    fallbackTone: 'amber',
    fallbackReason: hasUsableFallbackData ? primaryReason || riskFlags.find(Boolean) || '待人工复核' : '待人工复核',
  }
}
