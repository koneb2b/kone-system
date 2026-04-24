import { create } from "zustand"
import { fetchClaimedDomains as fetchClaimedDomainsApi, checkDomainsCollision } from "@/lib/electron-api"

export type LeadStatus = "new" | "contacting" | "replied" | "archived"
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
}

export type LeadSearchResult = {
  id: number
  company: string
  industry: string
  matchScore?: number
  fallbackStatus?: 'social_blind_score'
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
}

const normalizeLeadWebsite = (website?: string) => {
  const value = String(website || "").trim().toLowerCase()
  return value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "")
}

const normalizeLeadCompany = (company?: string) => String(company || "").trim().toLowerCase()

export const normalizeLeadStatus = (status?: string): LeadStatus => {
  switch (status) {
    case "contacting":
    case "replied":
    case "archived":
    case "new":
      return status
    case "contacted":
    case "qualified":
    case "negotiation":
      return "contacting"
    case "closed":
      return "replied"
    case "lost":
      return "archived"
    default:
      return "new"
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

export const getLeadUniqueKey = (lead: Pick<LeadItem, "website" | "company">) => {
  const websiteKey = normalizeLeadWebsite(lead.website)
  if (websiteKey) return `website:${websiteKey}`
  return `company:${normalizeLeadCompany(lead.company)}`
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
            generatedStrategies: {
              ...(existing.generatedStrategies || {}),
              ...(lead.generatedStrategies || {}),
            },
          }
        : lead
    )
  })

  return Array.from(merged.values()).sort((a, b) => {
    const dateDelta = new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime()
    if (dateDelta !== 0) return dateDelta
    return (typeof b.matchScore === 'number' ? b.matchScore : -1) - (typeof a.matchScore === 'number' ? a.matchScore : -1)
  })
}

const probeLeadStore = (count: number) => {
  console.log("📊 [Probe-Store] Store 纯内存态更新，当前线索数:", count)
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
    set({ hydrated: true })
    probeLeadStore(get().leads.length)
  },
  saveLeads: async (leads) => {
    set({ leads: leads.map((lead) => normalizeLeadItem(lead)) })
    probeLeadStore(get().leads.length)
    return leads
  },
  mergeLeads: async (incoming) => {
    const next = mergeLeads(get().leads, incoming)
    set({ leads: next })
    probeLeadStore(get().leads.length)
    return next
  },
  addLead: async (lead) => {
    return get().mergeLeads([lead])
  },
  updateLead: async (id, patch) => {
    const next = get().leads.map((lead) => (lead.id === id ? normalizeLeadItem({ ...lead, ...patch }) : lead))
    set({ leads: next })
    probeLeadStore(get().leads.length)
    return next
  },
  deleteLead: async (id) => {
    const next = get().leads.filter((lead) => lead.id !== id)
    set({ leads: next })
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
    const normalized = domain.trim().toLowerCase().replace(/^www\./, "").replace(/^https?:\/\//, "").replace(/\/$/, "")
    return get().teamClaimedDomains.has(normalized)
  },
}))
