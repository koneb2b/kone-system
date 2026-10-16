import { create } from 'zustand'
import {
  fetchClaimedDomains as fetchClaimedDomainsApi,
  checkDomainsCollision,
  configGet,
  configSet,
} from '@/lib/electron-api'
import type {
  DataSourceType,
  DecisionMaker,
  CustomsData,
  AgentStatus,
  OpportunityScoreRationale,
} from '@/shared/ipc-contracts'
/* 号码类型（WhatsApp 可用性）：来自 wa.me 直链的号码为 mobile，前端据此放行 WhatsApp 按钮 */
import type { PhoneKind } from '@/shared/phone-kind'
/* 联系方式来源与可信度（三档）：结果卡片徽标 / 筛选 / 发送前确认共用 */
import type { ContactProvenance } from '@/shared/contact-provenance'
/* 国家名 → ISO alpha-2：用于校正历史遗留的假国家码（见 normalizeLeadItem 注释） */
import { resolveCountryCode } from '@/lib/country-code'

// Durable persistence key for the SAVED lead pool. Only `leads` (the operator's
// curated, long-lived asset) is persisted — NEVER `searchResults`, which is a
// volatile candidate batch (ARCH-STANDARDS §4.3: config storage must not absorb
// volatile business payloads). The main-process NativeStore debounces disk writes.
const LEADS_CONFIG_KEY = 'leads'

// Fire-and-forget persistence of the saved lead pool to the local config store.
// Failures degrade silently (offline/disk-protected env) so the UI never blocks;
// the in-memory Zustand state remains the live source of truth for the session.
const persistLeads = (leads: LeadItem[]): void => {
  void configSet({ key: LEADS_CONFIG_KEY, value: leads }).catch(() => {
    // disk-protected / non-electron env → keep session state, drop persistence
  })
}

export type LeadStatus = 'new' | 'contacting' | 'replied' | 'archived'
export type FollowUpStatus = LeadStatus

export type LeadAnalysisCacheEntry = {
  companyProfile?: string
  painPoints?: string
  valueMapping?: string
  emailSubject?: string
  emailBody?: string
  confidence?: number
  rawContent?: string
  parseFallback?: boolean
  usedKnowledgeTitles?: string[]
  usedFallback?: boolean
  source?: string
  updatedAt?: string
  replyCoaching?: {
    customerText: string
    negotiationRisk: string
    pricingAdvice: string
    replyTemplate: string
    nextAction: string
    timestamp: number
  }
}

export type LeadItem = {
  id: number
  company: string
  contact: string
  contactTitle: string
  email: string
  phone: string
  /* 号码类型（WhatsApp 可用性）：后端判定优先（wa.me 直链 → mobile）；缺失时前端回退本地判定 */
  phoneKind?: PhoneKind
  /* 联系方式来源与可信度（三档）：verified / extracted / inferred */
  contactProvenance?: ContactProvenance
  country: string
  countryCode: string
  industry: string
  source: string
  matchScore?: number | null
  fallbackStatus?: 'social_blind_score'
  /* P1-1 置信标识: ai = LLM 评分；deterministic = 确定性预筛分 */
  scoreSource?: 'ai' | 'deterministic'
  /* P2-3 Stage-2 结构化机会分 */
  opportunityScore?: {
    icpFit: number
    intent: number
    evidence: number
    riskPenalty: number
    finalScore: number
    /* S4b：逐维度评分依据（可选；缺失时不展示） */
    rationale?: OpportunityScoreRationale
  }
  status: LeadStatus
  followUp: FollowUpStatus
  starred: boolean
  lastActivity: string
  addedDate: string
  tags: string[]
  unlocked: boolean
  website: string
  estimatedValue: string
  address?: string
  snippet?: string
  matchReasons?: string[]
  riskFlags?: string[]
  inferredRole?: string
  salesStrategy?: string
  analysisCache?: Record<string, LeadAnalysisCacheEntry>
  generatedStrategies?: Record<string, string>
  /* V1.3 多源融合字段 */
  dataSourceType?: DataSourceType
  exhibitionFootprints?: string[]
  customsData?: CustomsData
  decisionMakers?: DecisionMaker[]
  agentStatus?: AgentStatus
  /* P0-1：搜索产物稳定 UUID（SearchExecuteResult.id），用于 agentStatus 写回关联 */
  leadKey?: string
  /* [V1.4.0] Phase 2.9 · 审批（AGENTS.md 宪法第 5 条）
     存在 approvalId 即表示该线索已通过人工审批；draftVersion 必须与云端审批记录
     严格相等（门禁 ⑦ 校验），草稿变更后需递增并重新批准。
     取舍说明：本轮**不扩展 LeadStatus 枚举**——改枚举会触及既有 UI 分支与数据迁移，
     风险高于收益；审批态先以本字段承载，状态机正式迁移作为独立后续任务。 */
  approvalId?: string
  draftVersion?: number
  /** 审批结论：undefined = 未审批；'approved' 已批准；'rejected' 已驳回；'needs_revision' 待修订 */
  approvalDecision?: 'approved' | 'rejected' | 'needs_revision'
}

export type LeadSearchResult = {
  id: number
  company: string
  industry: string
  matchScore?: number | null
  fallbackStatus?: 'social_blind_score'
  /* P1-1 置信标识: ai = LLM 评分；deterministic = 确定性预筛分 */
  scoreSource?: 'ai' | 'deterministic'
  /* P2-3 Stage-2 结构化机会分 */
  opportunityScore?: {
    icpFit: number
    intent: number
    evidence: number
    riskPenalty: number
    finalScore: number
    /* S4b：逐维度评分依据（可选；缺失时不展示） */
    rationale?: OpportunityScoreRationale
  }
  contact: string
  contactTitle: string
  email: string
  phone: string
  /* 号码类型（WhatsApp 可用性）：来自 Prospeo 已验证手机 / wa.me 直链 → mobile */
  phoneKind?: PhoneKind
  /* 联系方式来源与可信度（三档）：verified / extracted / inferred */
  contactProvenance?: ContactProvenance
  unlocked: boolean
  address?: string
  matchReasons?: string[]
  riskFlags?: string[]
  isB2B?: boolean | null
  source?: string
  country?: string
  countryCode?: string
  website?: string
  snippet?: string
  inferredRole?: string
  salesStrategy?: string
  status?: LeadStatus
  analysisCache?: Record<string, LeadAnalysisCacheEntry>
  dataSourceNote?: string
  /* V1.3 多源融合字段 */
  dataSourceType?: DataSourceType
  exhibitionFootprints?: string[]
  customsData?: CustomsData
  decisionMakers?: DecisionMaker[]
  agentStatus?: AgentStatus
  /* P0-1：搜索产物稳定 UUID，用于 agentStatus 写回关联 */
  leadKey?: string
}

const normalizeLeadWebsite = (website?: string) => {
  const value = String(website || '')
    .trim()
    .toLowerCase()
  return value
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

const normalizeLeadCompany = (company?: string) =>
  String(company || '')
    .trim()
    .toLowerCase()

export const normalizeLeadStatus = (status?: string): LeadStatus => {
  switch (status) {
    case 'contacting':
    case 'replied':
    case 'archived':
    case 'new':
      return status
    case 'contacted':
    case 'qualified':
    case 'negotiation':
      return 'contacting'
    case 'closed':
      return 'replied'
    case 'lost':
      return 'archived'
    default:
      return 'new'
  }
}

const normalizeLeadItem = (lead: LeadItem): LeadItem => {
  const status = normalizeLeadStatus(lead.status || lead.followUp)
  /* 2026-10-11：**校正历史遗留的错误国家码**。
     P2-1 修复前，代码用 `country.slice(0,2).toUpperCase()` 推导国家码，
     把 `Global` 截成 `GL`（格陵兰）、`United States` 截成 `UN`。
     `resolveCountryCode` 虽已修好，但**不会回溯修正已落库的旧记录** ——
     实测用户线索 `country: "Global"` 仍带 `countryCode: "GL"`，导出显示「格陵兰」。
     此处按国家名**重算**：能识别 → 用正确码；不能识别（如 `Global`）→ **清空**。
     **绝不保留假码** —— 假码比空值更糟，会污染号码补全 / 邮件语言 / 本地化搜索变体。 */
  const countryCode = resolveCountryCode(lead.country) || ''
  return {
    ...lead,
    status,
    followUp: status,
    countryCode,
  }
}

export const getLeadUniqueKey = (lead: Pick<LeadItem, 'website' | 'company'>) => {
  const websiteKey = normalizeLeadWebsite(lead.website)
  if (websiteKey) return `website:${websiteKey}`
  return `company:${normalizeLeadCompany(lead.company)}`
}

const mergeDecisionMakers = (
  existing: DecisionMaker[] | undefined,
  incoming: DecisionMaker[] | undefined,
): DecisionMaker[] | undefined => {
  if (!incoming?.length) return existing
  if (!existing?.length) return incoming

  const result = [...existing]

  for (const dm of incoming) {
    const matchIdx = result.findIndex((e) => {
      const eEmail = e.email?.toLowerCase().trim()
      const dmEmail = dm.email?.toLowerCase().trim()
      if (eEmail && dmEmail && eEmail === dmEmail) return true

      const eName = e.name?.toLowerCase().trim()
      const dmName = dm.name?.toLowerCase().trim()
      const eTitle = e.title?.toLowerCase().trim()
      const dmTitle = dm.title?.toLowerCase().trim()
      return !!(eName && dmName && eName === dmName && eTitle && dmTitle && eTitle === dmTitle)
    })

    if (matchIdx >= 0) {
      const existingDm = result[matchIdx]
      const existingScore = existingDm.confidenceScore
      const incomingScore = dm.confidenceScore
      /* §L142（V1.3 决策人深度合并）：碰撞时以 **confidenceScore 较高者的属性**为准。
         此前实现是"入参属性恒覆盖 + 取最大置信度"——会在低置信来源后到时报出
         "低置信属性 + 高置信标签"的错标，且入参空字段（''）会抹掉已有的高价值资产
         （如 email / phone）。故：高置信者属性优先，空值不覆盖，置信度取两者最大值。 */
      const incomingWins = incomingScore >= existingScore
      const primary = incomingWins ? dm : existingDm
      const secondary = incomingWins ? existingDm : dm
      const mergedDm: DecisionMaker = { ...secondary }
      if (primary.name) mergedDm.name = primary.name
      if (primary.title) mergedDm.title = primary.title
      if (primary.email) mergedDm.email = primary.email
      if (primary.phone) mergedDm.phone = primary.phone
      if (primary.linkedinUrl) mergedDm.linkedinUrl = primary.linkedinUrl
      if (primary.source) mergedDm.source = primary.source
      if (primary.emailGrade) mergedDm.emailGrade = primary.emailGrade
      if (primary.phoneValid !== undefined) mergedDm.phoneValid = primary.phoneValid
      mergedDm.confidenceScore = Math.max(existingScore, incomingScore)
      result[matchIdx] = mergedDm
    } else {
      result.push(dm)
    }
  }

  return result
}

export const mergeLeads = (current: LeadItem[], incoming: LeadItem[]) => {
  const merged = new Map<string, LeadItem>()

  current.forEach((lead) => {
    merged.set(getLeadUniqueKey(lead), lead)
  })

  incoming.forEach((lead) => {
    const key = getLeadUniqueKey(lead)
    const existing = merged.get(key)
    merged.set(
      key,
      existing
        ? {
            ...existing,
            ...lead,
            id: existing.id,
            company: lead.company || existing.company,
            website: lead.website || existing.website,
            tags: lead.tags?.length ? lead.tags : existing.tags,
            decisionMakers: mergeDecisionMakers(existing.decisionMakers, lead.decisionMakers),
            exhibitionFootprints: Array.from(
              new Set([...(existing.exhibitionFootprints || []), ...(lead.exhibitionFootprints || [])]),
            ),
            generatedStrategies: {
              ...(existing.generatedStrategies || {}),
              ...(lead.generatedStrategies || {}),
            },
          }
        : lead,
    )
  })

  return Array.from(merged.values()).sort((a, b) => {
    const dateDelta = new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime()
    if (dateDelta !== 0) return dateDelta
    return (
      (typeof b.matchScore === 'number' ? b.matchScore : -1) - (typeof a.matchScore === 'number' ? a.matchScore : -1)
    )
  })
}

const probeLeadStore = (_count: number) => {
  // Intentionally no-op: keep renderer production bundles free of store probe logs.
}

/** 评分帧合并：把搜索产物的 `scoredLead` 字段合入已有线索条目（保持不可变）。 */
export const mergeScoredLeadFields = (
  existing: LeadSearchResult,
  scored: Record<string, unknown>,
): LeadSearchResult => {
  const scoredId = typeof scored.id === 'string' ? String(scored.id) : undefined
  return {
    ...existing,
    matchScore: typeof scored.matchScore === 'number' ? scored.matchScore : existing.matchScore,
    matchReasons: Array.isArray(scored.matchReasons) ? scored.matchReasons : existing.matchReasons,
    riskFlags: Array.isArray(scored.riskFlags) ? scored.riskFlags : existing.riskFlags,
    fallbackStatus:
      scored.fallbackStatus === 'social_blind_score' ? ('social_blind_score' as const) : existing.fallbackStatus,
    scoreSource:
      scored.scoreSource === 'ai' || scored.scoreSource === 'deterministic' ? scored.scoreSource : existing.scoreSource,
    opportunityScore:
      scored.opportunityScore && typeof scored.opportunityScore === 'object'
        ? (scored.opportunityScore as LeadSearchResult['opportunityScore'])
        : existing.opportunityScore,
    contact: typeof scored.contact === 'string' ? scored.contact : existing.contact,
    contactTitle: typeof scored.contactTitle === 'string' ? scored.contactTitle : existing.contactTitle,
    email: typeof scored.email === 'string' ? scored.email : existing.email,
    phone: typeof scored.phone === 'string' ? scored.phone : existing.phone,
    snippet: typeof scored.snippet === 'string' ? scored.snippet : existing.snippet,
    inferredRole: typeof scored.inferredRole === 'string' ? scored.inferredRole : existing.inferredRole,
    salesStrategy: typeof scored.salesStrategy === 'string' ? scored.salesStrategy : existing.salesStrategy,
    dataSourceType: (scored.dataSourceType as LeadSearchResult['dataSourceType']) || existing.dataSourceType,
    exhibitionFootprints: Array.isArray(scored.exhibitionFootprints)
      ? scored.exhibitionFootprints
      : existing.exhibitionFootprints,
    customsData: (scored.customsData as LeadSearchResult['customsData']) || existing.customsData,
    decisionMakers: Array.isArray(scored.decisionMakers)
      ? (scored.decisionMakers as DecisionMaker[])
      : existing.decisionMakers,
    agentStatus: (scored.agentStatus as LeadSearchResult['agentStatus']) || existing.agentStatus,
    /* leadKey 必须沿用已有条目的稳定 UUID，避免合并产生新 leadKey 切断管道关联。 */
    leadKey: existing.leadKey ?? scoredId,
  }
}

/** 在 searchResults 中按 leadKey / website / company 顺序回退定位目标条目下标。 */
const findScoredLeadIndex = (results: LeadSearchResult[], scored: Record<string, unknown>): number => {
  const scoredId = typeof scored.id === 'string' ? String(scored.id) : undefined
  const scoredWebsite = typeof scored.website === 'string' ? scored.website : undefined
  const scoredCompany = typeof scored.company === 'string' ? scored.company : undefined
  /* L0-4/F1：按「条件优先级」匹配，而非「逐条位置优先」。
     原实现在单条 lead 内依次尝试 leadKey → website → company 并立即 return，
     于是靠前条目的**弱匹配**（company / website）会遮蔽靠后条目的**强匹配**（leadKey）：
     评分被写到错误条目上，真正目标线索的分数始终为 undefined，即审计所述
     "评分更新静默丢弃路径"（同名公司 / 共用官网的采集去重场景极易触发）。
     改为每一级条件先全量扫描，未命中才降级到下一级：强键 → 次强 → 兜底。 */

  // 1) 强匹配：leadKey 是线索唯一身份，优先全量扫描
  if (scoredId) {
    for (let i = 0; i < results.length; i += 1) {
      if (results[i].leadKey && results[i].leadKey === scoredId) return i
    }
  }

  // 2) 次强：website（保留原守卫——仅当至少一方具备 leadKey 上下文时才用 website 定位）
  if (scoredWebsite) {
    for (let i = 0; i < results.length; i += 1) {
      const lead = results[i]
      if (lead.website && lead.website === scoredWebsite && !(!scoredId && !lead.leadKey)) return i
    }
  }

  // 3) 兜底：company（公司名可能漂移，仅作最后回退）
  if (scoredCompany) {
    for (let i = 0; i < results.length; i += 1) {
      if (results[i].company && results[i].company === scoredCompany) return i
    }
  }

  return -1
}

const sortByScoreThenOriginalOrder = (results: LeadSearchResult[]): LeadSearchResult[] => {
  return results
    .map((lead, index) => ({ lead, index }))
    .sort((a, b) => {
      const aScored = typeof a.lead.matchScore === 'number'
      const bScored = typeof b.lead.matchScore === 'number'
      if (aScored !== bScored) return aScored ? -1 : 1
      if (aScored && bScored) {
        const scoreDelta = (b.lead.matchScore || 0) - (a.lead.matchScore || 0)
        if (scoreDelta !== 0) return scoreDelta
      }
      return a.index - b.index
    })
    .map(({ lead }) => lead)
}

const reinsertTopRanked = (results: LeadSearchResult[], topCount: number): LeadSearchResult[] => {
  if (results.length === 0) return results
  if (topCount <= 0) return results
  const sorted = sortByScoreThenOriginalOrder(results)
  const top = sorted.slice(0, topCount)
  const topKeys = new Set(top.map((lead) => lead.leadKey ?? `${lead.website || ''}::${lead.company || ''}`))
  const rest = results.filter((lead) => !topKeys.has(lead.leadKey ?? `${lead.website || ''}::${lead.company || ''}`))
  return [...top, ...rest]
}

type LeadsState = {
  leads: LeadItem[]
  searchResults: LeadSearchResult[]
  /** P1-3：以 leadKey 为键的搜索结果索引，使 setSearchResults 之外也能按 id 单点更新。 */
  searchResultsByKey: Record<string, LeadSearchResult>
  hydrated: boolean
  teamClaimedDomains: Set<string>
  hydrateFromConfig: () => Promise<void>
  saveLeads: (leads: LeadItem[]) => Promise<LeadItem[]>
  mergeLeads: (leads: LeadItem[]) => Promise<LeadItem[]>
  addLead: (lead: LeadItem) => Promise<LeadItem[]>
  updateLead: (id: number, patch: Partial<LeadItem>) => Promise<LeadItem[]>
  deleteLead: (id: number) => Promise<LeadItem[]>
  setSearchResults: (results: LeadSearchResult[]) => Promise<void>
  /** P1-3：流式评分单点更新——只替换目标条目，避免每帧全量重建导致所有订阅者重渲染。 */
  updateScoredLead: (scoredLead: Record<string, unknown>, opts?: { reposition?: boolean; topCount?: number }) => boolean
  refreshTeamClaimedDomains: () => Promise<void>
  refreshCollisionsForDomains: (domains: string[]) => Promise<void>
  isDomainClaimed: (domain: string) => boolean
}

export const useLeadsStore = create<LeadsState>((set, get) => ({
  leads: [],
  searchResults: [],
  searchResultsByKey: {},
  hydrated: false,
  teamClaimedDomains: new Set<string>(),
  hydrateFromConfig: async () => {
    // Re-hydrate the saved lead pool from the local config store so leads
    // survive app restarts (P1 durability fix). Failures degrade to an empty
    // pool rather than blocking boot. searchResults stay ephemeral by design.
    try {
      const persisted = await configGet<LeadItem[] | null>(LEADS_CONFIG_KEY)
      if (Array.isArray(persisted) && persisted.length > 0) {
        set({ leads: persisted.map((lead) => normalizeLeadItem(lead)) })
      }
    } catch {
      // non-electron / disk-protected env → start with in-memory empty pool
    }
    set({ hydrated: true })
    probeLeadStore(get().leads.length)
  },
  saveLeads: async (leads) => {
    const next = leads.map((lead) => normalizeLeadItem(lead))
    set({ leads: next })
    persistLeads(next)
    probeLeadStore(get().leads.length)
    return leads
  },
  mergeLeads: async (incoming) => {
    const next = mergeLeads(get().leads, incoming)
    set({ leads: next })
    persistLeads(next)
    probeLeadStore(get().leads.length)
    return next
  },
  addLead: async (lead) => {
    return get().mergeLeads([lead])
  },
  updateLead: async (id, patch) => {
    const next = get().leads.map((lead) => (lead.id === id ? normalizeLeadItem({ ...lead, ...patch }) : lead))
    set({ leads: next })
    persistLeads(next)
    probeLeadStore(get().leads.length)
    return next
  },
  deleteLead: async (id) => {
    const next = get().leads.filter((lead) => lead.id !== id)
    set({ leads: next })
    persistLeads(next)
    probeLeadStore(get().leads.length)
    return next
  },
  setSearchResults: async (results) => {
    const byKey: Record<string, LeadSearchResult> = {}
    for (const lead of results) {
      if (lead.leadKey) byKey[lead.leadKey] = lead
    }
    set({ searchResults: results, searchResultsByKey: byKey })
    probeLeadStore(get().leads.length)
  },
  updateScoredLead: (scoredLead, opts) => {
    const { searchResults } = get()
    const index = findScoredLeadIndex(searchResults, scoredLead)
    if (index < 0) return false
    const patched = mergeScoredLeadFields(searchResults[index], scoredLead)
    const next = searchResults.slice()
    next[index] = patched
    const reposition = opts?.reposition !== false
    const topCount = opts?.topCount ?? 8
    const finalResults = reposition ? reinsertTopRanked(next, topCount) : next
    const byKey: Record<string, LeadSearchResult> = {}
    for (const lead of finalResults) {
      if (lead.leadKey) byKey[lead.leadKey] = lead
    }
    set({ searchResults: finalResults, searchResultsByKey: byKey })
    return true
  },
  refreshTeamClaimedDomains: async () => {
    try {
      const data = await fetchClaimedDomainsApi()
      set({ teamClaimedDomains: new Set(data.domains.map((d) => d.toLowerCase())) })
    } catch {
      // 云端不可达 → 保持当前集合
    }
  },
  refreshCollisionsForDomains: async (domains: string[]) => {
    if (!domains.length) return
    try {
      const data = await checkDomainsCollision(domains)
      if (data.offline) return
      set((state) => {
        const next = new Set(state.teamClaimedDomains)
        for (const d of data.claimedDomains) next.add(d.toLowerCase())
        return { teamClaimedDomains: next }
      })
    } catch {
      // 静默降级
    }
  },
  isDomainClaimed: (domain: string) => {
    const normalized = domain
      .trim()
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
    return get().teamClaimedDomains.has(normalized)
  },
}))
