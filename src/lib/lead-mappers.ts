import { stableHash } from "@/lib/utils"
import type { LeadAnalysisCacheEntry, LeadItem, LeadSearchResult } from "@/store/leads-store"
import type { SearchExecuteResult } from "@/shared/ipc-contracts"

type LeadMapperInput = Partial<Omit<SearchExecuteResult, "id">> & {
  id?: number | string
  company: string
  industry?: LeadSearchResult["industry"]
  unlocked?: LeadSearchResult["unlocked"]
  countryCode?: LeadSearchResult["countryCode"]
  status?: LeadSearchResult["status"]
  analysisCache?: Record<string, LeadAnalysisCacheEntry | unknown>
}

type LeadMapperContext = {
  country?: string
  countryCode?: string
  industry?: string
  addedDate?: string
  estimatedValue?: string
  lastActivity?: string
}

const createNumericLeadId = (input: string) => {
  const hashed = stableHash(input)
  return Number.parseInt(hashed, 36) || Date.now()
}

const resolveCountryCode = (countryCode?: string, country?: string) => {
  const normalizedCode = String(countryCode || "").trim().toUpperCase()
  if (normalizedCode) return normalizedCode.slice(0, 2)

  const normalizedCountry = String(country || "").trim()
  if (!normalizedCountry) return "GL"
  return normalizedCountry.slice(0, 2).toUpperCase()
}

const normalizeAnalysisCache = (analysisCache?: Record<string, LeadAnalysisCacheEntry | unknown>) => {
  if (!analysisCache || typeof analysisCache !== "object") return undefined
  return analysisCache as Record<string, LeadAnalysisCacheEntry>
}

export const mapSearchResultToLeadItem = (result: LeadMapperInput, context: LeadMapperContext = {}): LeadItem => {
  const company = String(result.company || "").trim()
  const website = String(result.website || "").trim()
  const country = String(context.country || result.country || "Global").trim() || "Global"
  const industry = String(context.industry || result.industry || "").trim()
  const addedDate = context.addedDate || new Date().toISOString().slice(0, 10)
  const numericId = Number(result.id)
  const id = Number.isFinite(numericId) && numericId > 0
    ? numericId
    : createNumericLeadId(`${company}::${website}::${country}::${industry}`)

  return {
    id,
    company,
    contact: String(result.contact || "").trim(),
    contactTitle: String(result.contactTitle || "").trim(),
    email: String(result.email || "").trim(),
    phone: String(result.phone || "").trim(),
    country,
    countryCode: resolveCountryCode(context.countryCode || result.countryCode, country),
    industry,
    source: String(result.source || "Google Maps").trim() || "Google Maps",
    matchScore: typeof result.matchScore === 'number' ? result.matchScore : undefined,
    fallbackStatus: result.fallbackStatus === 'social_blind_score' ? 'social_blind_score' : undefined,
    status: "new",
    followUp: "new",
    starred: false,
    lastActivity: context.lastActivity || "刚刚",
    addedDate,
    tags: [],
    unlocked: Boolean(result.unlocked),
    website,
    estimatedValue: context.estimatedValue || "-",
    address: result.address ? String(result.address).trim() : undefined,
    snippet: result.snippet ? String(result.snippet).trim() : undefined,
    matchReasons: Array.isArray(result.matchReasons) ? result.matchReasons.filter(Boolean) : [],
    riskFlags: Array.isArray(result.riskFlags) ? result.riskFlags.filter(Boolean) : [],
    inferredRole: result.inferredRole ? String(result.inferredRole).trim() : undefined,
    salesStrategy: result.salesStrategy ? String(result.salesStrategy).trim() : undefined,
    analysisCache: normalizeAnalysisCache(result.analysisCache),
  }
}
