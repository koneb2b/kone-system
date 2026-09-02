import { create } from 'zustand'
import {
  fetchClaimedDomains as fetchClaimedDomainsApi,
  checkDomainsCollision,
  configGet,
  configSet,
} from '@/lib/electron-api'
import type { DataSourceType, DecisionMaker, CustomsData, AgentStatus } from '@/shared/ipc-contracts'

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
  }
  contact: string
  contactTitle: string
  email: string
  phone: string
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
  return {
    ...lead,
    status,
    followUp: status,
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
      const existingScore = result[matchIdx].confidenceScore
      const incomingScore = dm.confidenceScore
      result[matchIdx] = {
        ...result[matchIdx],
        ...dm,
        confidenceScore:
          existingScore !== undefined && incomingScore !== undefined
            ? Math.max(existingScore, incomingScore)
            : (existingScore ?? incomingScore),
      }
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

type LeadsState = {
  leads: LeadItem[]
  searchResults: LeadSearchResult[]
  hydrated: boolean
  teamClaimedDomains: Set<string>
  hydrateFromConfig: () => Promise<void>
  saveLeads: (leads: LeadItem[]) => Promise<LeadItem[]>
  mergeLeads: (leads: LeadItem[]) => Promise<LeadItem[]>
  addLead: (lead: LeadItem) => Promise<LeadItem[]>
  updateLead: (id: number, patch: Partial<LeadItem>) => Promise<LeadItem[]>
  deleteLead: (id: number) => Promise<LeadItem[]>
  setSearchResults: (results: LeadSearchResult[]) => Promise<void>
  refreshTeamClaimedDomains: () => Promise<void>
  refreshCollisionsForDomains: (domains: string[]) => Promise<void>
  isDomainClaimed: (domain: string) => boolean
}

export const useLeadsStore = create<LeadsState>((set, get) => ({
  leads: [],
  searchResults: [],
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
    set({ searchResults: results })
    probeLeadStore(get().leads.length)
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
