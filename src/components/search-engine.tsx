"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Search, Sparkles, Globe, TrendingUp, AlertCircle, Check, AlertTriangle, Radar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { stableHash } from "@/lib/utils"
import { mapSearchResultToLeadItem } from "@/lib/lead-mappers"
import { Progress } from "@/components/ui/progress"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext } from "@/components/ui/pagination"
import { useLeadsStore, LeadSearchResult, getLeadUniqueKey } from "@/store/leads-store"
import { useAutopilotStore } from "@/store/autopilot-store"
import { autopilotSyncLifecycle, onAutopilotAction, onSearchBasicResults, onSearchLeadScored, onSearchStage, onSearchStreamComplete, onSearchStreamError, onSearchStreamStart, searchExecute, secretCheck } from "@/lib/electron-api"
import { useFeatureGate } from "@/lib/feature-gate"
import { useConfigStore } from "@/store/config-store"
import type { SearchExecuteResult } from "@/shared/ipc-contracts"

const formatErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback
  const normalized = message.toLowerCase()
  if (/trial_expired|试用已结束/.test(normalized)) return "当前授权已失效，请先完成激活后继续使用。"
  if (/403|401|授权|license|无权/.test(normalized)) return "当前授权状态异常，请联系顾问协助处理。"
  if (/network|timeout|fetch|socket|econn|enet|数据流/.test(normalized)) return "AI 数据流连接异常，请稍后重试。"
  if (/config|base url|key|配置/.test(normalized)) return "当前配置未完成，暂时无法执行智能搜索。"
  return "当前搜索服务暂不可用，请稍后重试或联系顾问。"
}

const buildPersistentErrorMessage = (error: unknown, fallback: string) => {
  const rawMessage = error instanceof Error ? error.message : String(error || fallback)
  const normalized = rawMessage.toLowerCase()
  const friendlyMessage = formatErrorMessage(error, fallback)

  if (/trial_expired|试用已结束/.test(normalized)) return friendlyMessage
  if (/network|timeout|fetch|failed to fetch|socket|econn|enet|429|5\d\d/.test(normalized)) {
    const detail = rawMessage.trim()
    return detail && detail !== friendlyMessage ? `${friendlyMessage}（详细原因：${detail}）` : friendlyMessage
  }

  return rawMessage.trim() || friendlyMessage
}

const resolveSearchStageMessage = (payload?: { stage?: string; message?: string; searchMode?: 'anysearch' | 'maps' | 'maps-keyword-fallback' | 'organic-fallback'; intentMutated?: { country?: string; keywords?: string[] } }) => {
  if (payload?.intentMutated) {
    const country = payload.intentMutated.country || 'Global'
    const keywords = Array.isArray(payload.intentMutated.keywords) ? payload.intentMutated.keywords : []
    return `🤖 AI 智能解构成功！当前目标国家 [${country}]，正在全渠道并发穿透以下高价值 B2B 变种词：${keywords.map((item) => `[${item}]`).join(', ')}`
  }
  if (payload?.stage === 'prefiltering') {
    return '🔍 正在执行相关度预筛，剔除泛化结果...'
  }
  if (payload?.stage === 'blind_scoring' || payload?.searchMode === 'anysearch') {
    return '🤖 AnySearch 正在通过全网海关数据、全球展会名录及社媒多渠道深度穿透高管决策人...'
  }
  if (payload?.searchMode === 'maps-keyword-fallback') {
    return '地图定位受限，正在尝试扩大识别范围...'
  }
  if (payload?.searchMode === 'organic-fallback') {
    return '未发现地图商户，已自动为您补位全局网页线索...'
  }
  return payload?.message || ''
}

const isAiSkippedStageMessage = (message?: string) => /未启用 AI 评分/.test(String(message || ''))

const SOCIAL_BLIND_SCORE_MESSAGE = '官网受保护，已使用 LinkedIn / 行业目录公开信息完成盲评'

const INTERNAL_FALLBACK_MARKERS = new Set(['website_403', 'blind_score_failed'])

const stripInternalMarkers = (items?: string[]) =>
  Array.isArray(items) ? items.filter((item) => !INTERNAL_FALLBACK_MARKERS.has(String(item || '').trim())) : []

const normalizeWebsiteHref = (website?: string) => {
  const raw = String(website || '').trim()
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

type AnalysisResult = {
  url: string
  title: string
  description: string
  matchScore?: number | null
  industryTags: string[]
}

type UserRole = 'trial' | 'pro' | 'enterprise'

type SearchDataSource = 'google_maps' | 'google_organic' | 'customs_shipment' | 'trade_show' | 'yellow_pages' | 'linkedin_search' | 'facebook_search'

interface SearchEngineProps {
  userRole?: UserRole | null
}

const DIRECTORY_HOST_PATTERNS = [
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'yellowpages',
  'yelp.',
  'made-in-china.com',
  'globalsources.com',
  'alibaba.com',
]

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

const SEARCH_PAGE_SIZE = 30
const OMNI_SEARCH_RESULT_LIMIT = 50
const OMNI_SEARCH_MODE_LABEL = 'AI 全渠道盲搜'
const OMNI_COMPLIANCE_GUIDE = '💡 规范向导：系统已依据 [Kone AI 商业全能版合规大坝] 自动为您死锁前 50 条最高相关度黄金买家资产，正在为您执行精细化清洗与高管穿透...'

const CSV_IMPORT_MAX_BYTES = 2 * 1024 * 1024
const CSV_IMPORT_MAX_LINES = 5_000



const buildSearchKeyword = (keyword: string, _dataSource: SearchDataSource) => {
  const normalizedKeyword = keyword
    .trim()
    .replace(/\bsite:linkedin\.com\/company\b/gi, '')
    .replace(/\bsite:facebook\.com\/pages\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return normalizedKeyword || keyword.trim()
}

const mapSearchExecuteResultToSearchResult = (
  item: Partial<SearchExecuteResult> & Record<string, any>,
  idx: number,
  context: { keyword: string; country: string },
): LeadSearchResult => ({
  id: Number(item.id) || Date.now() + idx,
  company: item.company || "",
  industry: context.keyword.trim(),
  matchScore: typeof item.matchScore === 'number' ? Number(item.matchScore) : undefined,
  fallbackStatus: item.fallbackStatus === 'social_blind_score' ? ('social_blind_score' as const) : undefined,
  contact: item.contact || "",
  contactTitle: item.contactTitle || "",
  email: item.email || "",
  phone: item.phone || "",
  unlocked: Boolean(item.unlocked),
  source: item.source || "Google Maps",
  country: context.country || "Global",
  countryCode: context.country ? context.country.slice(0, 2).toUpperCase() : "GL",
  website: item.website || "",
  matchReasons: Array.isArray(item.matchReasons) ? item.matchReasons : [],
  riskFlags: Array.isArray(item.riskFlags) ? item.riskFlags : [],
  address: item.address || "",
  isB2B: typeof item.isB2B === 'boolean' ? item.isB2B : undefined,
  snippet: item.snippet || "",
  inferredRole: item.inferredRole || "",
  salesStrategy: item.salesStrategy || "",
  status: item.status || "new",
  dataSourceType: item.dataSourceType,
  exhibitionFootprints: Array.isArray(item.exhibitionFootprints) ? item.exhibitionFootprints : undefined,
  customsData: item.customsData,
  decisionMakers: Array.isArray(item.decisionMakers) ? item.decisionMakers : undefined,
  agentStatus: item.agentStatus,
})

const hasAnalysisResult = (analysisCache?: Record<string, unknown>) =>
  Boolean(
    analysisCache &&
    ["direct_quote", "competitor_switch", "factory_strength"].some((key) => {
      const entry = analysisCache[key]
      return Boolean(entry && typeof entry === "object" && Object.keys(entry as Record<string, unknown>).length > 0)
    })
  )

const extractHostname = (website?: string) => {
  try {
    if (!website) return ''
    const normalized = /^https?:\/\//i.test(website) ? website : `https://${website}`
    return new URL(normalized).hostname.toLowerCase()
  } catch {
    return String(website || '').toLowerCase()
  }
}

const matchesB2BRoleSignal = (lead: LeadSearchResult) => {
  const corpus = [
    lead.company,
    lead.website,
    lead.snippet,
    ...(lead.matchReasons || []),
    ...(lead.riskFlags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return /(distributor|importer|oem|integrator|wholesaler|supplier|partner|procurement|contractor|dealer)/.test(corpus)
}

const isLikelyOfficialWebsite = (lead: LeadSearchResult) => {
  const hostname = extractHostname(lead.website)
  if (!hostname) return false
  return !DIRECTORY_HOST_PATTERNS.some((pattern) => hostname.includes(pattern))
}

const matchesLocalDomain = (lead: LeadSearchResult, country?: string) => {
  const normalizedCountry = String(country || '').trim().toLowerCase()
  if (!normalizedCountry) return true
  const allowedTlds = COUNTRY_TLD_MAP[normalizedCountry] || []
  if (allowedTlds.length === 0) return true
  const hostname = extractHostname(lead.website)
  return allowedTlds.some((tld) => hostname.endsWith(tld))
}

const sortSearchResults = (results: LeadSearchResult[]) => {
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

const mergeTopRankedResults = (current: LeadSearchResult[], next: LeadSearchResult[], topCount = 8) => {
  if (current.length <= 1) return next
  const ranked = sortSearchResults(next)
  const rankedTop = ranked.slice(0, topCount)
  const rankedKeys = new Set(rankedTop.map((lead) => `${lead.website || ''}::${lead.company || ''}`))
  const untouched = current.filter((lead) => !rankedKeys.has(`${lead.website || ''}::${lead.company || ''}`))
  return [...rankedTop, ...untouched]
}

const parseCsvLine = (line: string) => {
  const fields: string[] = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"'
        index += 1
        continue
      }

      insideQuotes = !insideQuotes
      continue
    }

    if (char === ',' && !insideQuotes) {
      fields.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  fields.push(current.trim())
  return fields.map((field) => field.replace(/^"|"$/g, '').trim())
}

const looksLikeCompanyHeader = (value: string) => /company|name|公司/i.test(value)

const looksLikeCountryHeader = (value: string) => /country|国家/i.test(value)

const buildAutopilotDraftFromCsv = (csvText: string) => {
  const normalizedText = csvText.replace(/^\uFEFF/, '').trim()
  if (!normalizedText) {
    throw new Error('CSV 文件为空，请先检查文件内容。')
  }

  const rows = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((row) => row.some((cell) => cell.trim()))

  if (rows.length === 0) {
    throw new Error('CSV 文件为空，请先检查文件内容。')
  }

  const [headerRow, ...dataRows] = rows
  const companyColumnIndex = headerRow.findIndex(looksLikeCompanyHeader)
  const countryColumnIndex = headerRow.findIndex(looksLikeCountryHeader)
  const hasRecognizedHeader = companyColumnIndex >= 0 || countryColumnIndex >= 0

  if (hasRecognizedHeader && companyColumnIndex < 0) {
    throw new Error('未找到公司列，请检查格式。')
  }

  const sourceRows = hasRecognizedHeader ? dataRows : rows

  if (sourceRows.length === 0) {
    throw new Error('CSV 中没有可导入的数据行。')
  }

  const draftLines = sourceRows
    .map((row) => {
      const company = companyColumnIndex >= 0 ? row[companyColumnIndex] || '' : row[0] || ''
      const country = countryColumnIndex >= 0 ? row[countryColumnIndex] || '' : ''
      const normalizedCompany = company.trim()

      if (!normalizedCompany) return ''
      return `${country.trim()} | ${normalizedCompany} | 1`
    })
    .filter(Boolean)

  if (draftLines.length === 0) {
    throw new Error('未解析到有效公司名称，请检查 CSV 内容。')
  }

  return {
    draftLines,
    importedCount: draftLines.length,
    usedHeaderMapping: hasRecognizedHeader,
  }
}

const rewriteAutopilotDraftWithDataSource = (rawText: string, dataSource: SearchDataSource) => {
  if (!rawText.trim()) return rawText

  return rawText
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim()
      if (!trimmedLine) return line

      const normalizedLine = line
        .replace(/[|，\t]/g, ',')
        .replace(/\s*,\s*/g, ',')
        .trim()
      const segments = normalizedLine.split(',').map((item) => item.trim()).filter(Boolean)
      if (segments.length < 2) return line

      const keywordIndex = 1
      const keyword = segments[keywordIndex]?.trim() || ''
      if (!keyword) return line

      segments[keywordIndex] = buildSearchKeyword(keyword, dataSource)
      return segments.join(', ')
    })
    .join('\n')
}

const readFileAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }

    reader.onerror = () => {
      reject(new Error('读取 CSV 文件失败，请稍后重试。'))
    }

    reader.readAsText(file)
  })

export function SearchEngine({ userRole }: SearchEngineProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [analyzingUrl, setAnalyzingUrl] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [savingLeadId, setSavingLeadId] = useState<number | null>(null)
  const [savedLeadIds, setSavedLeadIds] = useState<Set<number>>(new Set())
  const [searchKeyword, setSearchKeyword] = useState("")
  const [searchDataSource] = useState<SearchDataSource>('google_maps')
  const [searchCountry, setSearchCountry] = useState("")
  const [searchCity, setSearchCity] = useState("")
  const [emptyStateMessage, setEmptyStateMessage] = useState("")
  const [searchErrorMessage, setSearchErrorMessage] = useState("")
  const [showRetryHint, setShowRetryHint] = useState(false)
  const [lastSearchAt, setLastSearchAt] = useState(0)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isStartingAutopilot, setIsStartingAutopilot] = useState(false)
  const [streamTotal, setStreamTotal] = useState(0)
  const [analyzedCount, setAnalyzedCount] = useState(0)
  const [streamStageMessage, setStreamStageMessage] = useState("")
  const [streamStage, setStreamStage] = useState<"fetching" | "normalizing" | "prefiltering" | "blind_scoring" | "scoring" | "enriching" | "complete" | "localized_search" | "anysearch" | "">("")
  const [currentPage, setCurrentPage] = useState(1)
  const [autoSortEnabled, setAutoSortEnabled] = useState(true)
  const [trialExpired, setTrialExpired] = useState(false)
  const [officialOnlyEnabled, setOfficialOnlyEnabled] = useState(false)
  const [localDomainOnlyEnabled, setLocalDomainOnlyEnabled] = useState(false)
  const [highRelevanceOnlyEnabled, setHighRelevanceOnlyEnabled] = useState(false)
  const [b2bRoleOnlyEnabled, setB2bRoleOnlyEnabled] = useState(false)
  const [hasLlmKey, setHasLlmKey] = useState(true)
  const [showLlmKeyReminder, setShowLlmKeyReminder] = useState(false)
  const [aiScoringSkipped, setAiScoringSkipped] = useState(false)
  const [anySearchDegradeHint, setAnySearchDegradeHint] = useState(false)
  const { toast } = useToast()
  const { hydrateFromStorage: hydrateUserConfig, hydrated: configHydrated } = useConfigStore()
  const { searchResults, setSearchResults, addLead, leads, hydrateFromConfig, hydrated } = useLeadsStore()
  const autopilotRawText = useAutopilotStore((state) => state.draftText)
  const setAutopilotDraftText = useAutopilotStore((state) => state.setDraftText)
  const autopilotJobs = useAutopilotStore((state) => state.jobs)
  const autopilotRuntime = useAutopilotStore((state) => state.runtime)
  const autopilotStateKind = useAutopilotStore((state) => state.stateKind)
  const autopilotStatusReason = useAutopilotStore((state) => state.statusReason)
  const addBatchJobs = useAutopilotStore((state) => state.addBatchJobs)
  const startAutopilot = useAutopilotStore((state) => state.start)
  const pauseAutopilot = useAutopilotStore((state) => state.pause)
  const stopAndClearAutopilot = useAutopilotStore((state) => state.stopAndClear)
  const hydrateAutopilot = useAutopilotStore((state) => state.hydrateFromStorage)
  const autopilotHydrated = useAutopilotStore((state) => state.hydrated)
  const featureGate = useFeatureGate()
  const searchLimit = featureGate.getSearchLimit()
  const streamTotalRef = useRef(0)
  const streamStartedRef = useRef(false)
  const csvFileInputRef = useRef<HTMLInputElement | null>(null)
  const intentMutatedKeywordsRef = useRef<string>('')
  const autopilotBusy = autopilotRuntime.lifecycle === "running" || autopilotRuntime.lifecycle === "paused"
  const autopilotStartDisabled = isStartingAutopilot || autopilotRuntime.lifecycle === "running" || (!autopilotRawText.trim() && autopilotRuntime.lifecycle !== "paused")
  const autopilotCompletedOrFailed = autopilotRuntime.completedJobs + autopilotRuntime.failedJobs
  const autopilotCurrentJob = autopilotJobs.find((job) => job.id === autopilotRuntime.currentJobId)
  const autopilotProgressLabel = autopilotStateKind === "ready_empty"
    ? "暂无待执行任务"
    : autopilotStateKind === "hydrating"
      ? "正在读取巡航状态..."
      : autopilotStateKind === "state_unavailable"
        ? "巡航状态暂不可用"
        : `${autopilotCompletedOrFailed} / ${autopilotRuntime.totalJobs}`
  const autopilotCurrentJobLabel = autopilotCurrentJob
    ? `${autopilotCurrentJob.country} | ${autopilotCurrentJob.keyword}`
    : autopilotStateKind === "paused"
      ? "巡航已暂停，等待继续执行"
      : autopilotStateKind === "cooldown"
        ? "巡航正在冷却，等待自动继续"
        : autopilotStateKind === "state_unavailable"
          ? "主进程巡航状态不可用"
          : "暂无执行中的任务"
  const currentDataSourceLabel = OMNI_SEARCH_MODE_LABEL
  const shouldShowAutopilotFilterHint = (autopilotCurrentJob?.qualifiedCount || 0) === 0 || (autopilotCurrentJob?.savedCount || 0) === 0

  const handleNavigateLeads = () => {
    window.dispatchEvent(new Event("kone:navigate-leads"))
  }

  const displayedResults = useMemo(() => {
    return searchResults.filter((lead) => {
      if (officialOnlyEnabled && !isLikelyOfficialWebsite(lead)) return false
      if (localDomainOnlyEnabled && !matchesLocalDomain(lead, searchCountry)) return false
      if (highRelevanceOnlyEnabled && ((typeof lead.matchScore === 'number' ? lead.matchScore : 0) < 60)) return false
      if (b2bRoleOnlyEnabled && !matchesB2BRoleSignal(lead)) return false
      return true
    }).slice(0, OMNI_SEARCH_RESULT_LIMIT)
  }, [b2bRoleOnlyEnabled, highRelevanceOnlyEnabled, localDomainOnlyEnabled, officialOnlyEnabled, searchCountry, searchResults])

  const totalPages = Math.max(1, Math.ceil(displayedResults.length / SEARCH_PAGE_SIZE))
  const pagedResults = useMemo(
    () => displayedResults.slice((currentPage - 1) * SEARCH_PAGE_SIZE, currentPage * SEARCH_PAGE_SIZE),
    [currentPage, displayedResults]
  )

  const getLeadSettlementMeta = (lead: LeadSearchResult) => {
    const hasNumericScore = typeof lead.matchScore === 'number'
    const primaryReason = Array.isArray(lead.matchReasons) && lead.matchReasons.length > 0 ? String(lead.matchReasons[0] || '').trim() : ''
    const riskFlags = Array.isArray(lead.riskFlags) ? lead.riskFlags.map((item) => String(item || '').trim()) : []
    const hasWebsite403 = riskFlags.includes('website_403')
    const hasBlindScoreFailed = riskFlags.includes('blind_score_failed')
    const isSocialBlindScore = lead.fallbackStatus === 'social_blind_score' && hasNumericScore

    if (isSocialBlindScore) {
      return {
        state: 'social_blind_score' as const,
        showPending: false,
        showFallback: true,
        fallbackTone: 'blue' as const,
        fallbackReason: SOCIAL_BLIND_SCORE_MESSAGE,
      }
    }

    if (hasNumericScore) {
      return {
        state: 'scored' as const,
        showPending: false,
        showFallback: false,
        fallbackTone: 'amber' as const,
        fallbackReason: '',
      }
    }

    if (isStreaming) {
      return {
        state: 'streaming' as const,
        showPending: true,
        showFallback: false,
        fallbackTone: 'amber' as const,
        fallbackReason: '',
      }
    }

    if (aiScoringSkipped) {
      return {
        state: 'ai_skipped' as const,
        showPending: false,
        showFallback: true,
        fallbackTone: 'amber' as const,
        fallbackReason: '当前未启用 AI 评分，已展示基础结果',
      }
    }

    if (hasWebsite403 && hasBlindScoreFailed) {
      return {
        state: 'fallback' as const,
        showPending: false,
        showFallback: true,
        fallbackTone: 'amber' as const,
        fallbackReason: '官网存在防爬限制，且 AI 盲评超时失败，建议稍后重试或人工复核',
      }
    }

    const hasUsableFallbackData = Boolean(primaryReason || riskFlags.some(Boolean))

    return {
      state: 'fallback' as const,
      showPending: false,
      showFallback: true,
      fallbackTone: 'amber' as const,
      fallbackReason: hasUsableFallbackData ? primaryReason || riskFlags.find(Boolean) || '待人工复核' : '待人工复核',
    }
  }

  useEffect(() => {
    setCurrentPage(1)
  }, [searchKeyword, searchCountry, searchCity, officialOnlyEnabled, localDomainOnlyEnabled, highRelevanceOnlyEnabled, b2bRoleOnlyEnabled, searchResults])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const goToSearchPage = (page: number) => {
    let nextPage = page
    if (nextPage < 1) nextPage = totalPages
    if (nextPage > totalPages) nextPage = 1
    setCurrentPage(nextPage)
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  useEffect(() => {
    setSavedLeadIds(new Set(leads.map((item) => item.id)))
  }, [leads])

  const currentRole = userRole || 'enterprise'

  useEffect(() => {
    const unsubscribeStart = onSearchStreamStart((total) => {
      streamStartedRef.current = true
      streamTotalRef.current = total
      setIsStreaming(true)
      setStreamTotal(total)
      setAnalyzedCount(0)
      setIsLoading(true)
    })

    const unsubscribeStage = onSearchStage((payload) => {
      setStreamStage(payload?.stage || "")
      setStreamStageMessage(resolveSearchStageMessage(payload as any))
      if (isAiSkippedStageMessage(payload?.message)) {
        setAiScoringSkipped(true)
      }
      const mutated = (payload as any)?.intentMutated
      if (mutated && Array.isArray(mutated.keywords)) {
        intentMutatedKeywordsRef.current = mutated.keywords.join(' | ')
      }
    })

    const unsubscribeBasic = onSearchBasicResults((results) => {
      const industryKeyword = intentMutatedKeywordsRef.current || searchKeyword
      const normalizedResults: LeadSearchResult[] = (Array.isArray(results) ? results : [])
        .map((item: any, idx: number) => mapSearchExecuteResultToSearchResult(item, idx, { keyword: industryKeyword, country: searchCountry }))
        .slice(0, Math.min(searchLimit.maxResults, OMNI_SEARCH_RESULT_LIMIT))
      void setSearchResults(normalizedResults)
    })

    const unsubscribeScored = onSearchLeadScored((payload) => {
      const scoredLead = payload?.candidate
      setAnalyzedCount(typeof payload?.completedCount === 'number' ? payload.completedCount : 0)
      const nextTotal = typeof payload?.totalCount === 'number' ? payload.totalCount : streamTotalRef.current
      streamTotalRef.current = nextTotal
      setStreamTotal(nextTotal)
      if (!scoredLead || typeof scoredLead !== 'object') return
      const currentResults = useLeadsStore.getState().searchResults
      let hasMatch = false
      const updatedResults = currentResults.map((lead) => {
        const sameWebsite = lead.website && scoredLead.website && lead.website === scoredLead.website
        const sameCompany = lead.company && scoredLead.company && lead.company === scoredLead.company
        if (!sameWebsite && !sameCompany) return lead
        hasMatch = true
        return {
          ...lead,
          matchScore: typeof scoredLead.matchScore === 'number' ? scoredLead.matchScore : lead.matchScore,
          matchReasons: Array.isArray(scoredLead.matchReasons) ? scoredLead.matchReasons : lead.matchReasons,
          riskFlags: Array.isArray(scoredLead.riskFlags) ? scoredLead.riskFlags : lead.riskFlags,
          fallbackStatus: scoredLead.fallbackStatus === 'social_blind_score' ? 'social_blind_score' : lead.fallbackStatus,
          contact: typeof scoredLead.contact === 'string' ? scoredLead.contact : lead.contact,
          contactTitle: typeof scoredLead.contactTitle === 'string' ? scoredLead.contactTitle : lead.contactTitle,
          email: typeof scoredLead.email === 'string' ? scoredLead.email : lead.email,
          phone: typeof scoredLead.phone === 'string' ? scoredLead.phone : lead.phone,
          snippet: typeof scoredLead.snippet === 'string' ? scoredLead.snippet : lead.snippet,
          inferredRole: typeof scoredLead.inferredRole === 'string' ? scoredLead.inferredRole : lead.inferredRole,
          salesStrategy: typeof scoredLead.salesStrategy === 'string' ? scoredLead.salesStrategy : lead.salesStrategy,
          dataSourceType: scoredLead.dataSourceType || lead.dataSourceType,
          exhibitionFootprints: Array.isArray(scoredLead.exhibitionFootprints) ? scoredLead.exhibitionFootprints : lead.exhibitionFootprints,
          customsData: scoredLead.customsData || lead.customsData,
          decisionMakers: Array.isArray(scoredLead.decisionMakers) ? scoredLead.decisionMakers : lead.decisionMakers,
          agentStatus: scoredLead.agentStatus || lead.agentStatus,
        }
      })
      if (!hasMatch) return
      const nextResults = autoSortEnabled ? mergeTopRankedResults(currentResults, updatedResults, 8) : updatedResults
      void setSearchResults(nextResults)
    })

    const unsubscribeComplete = onSearchStreamComplete(() => {
      streamStartedRef.current = false
      setIsStreaming(false)
      setIsLoading(false)
      const finalResults = useLeadsStore.getState().searchResults
      const total = streamTotalRef.current || finalResults.length
      setAnalyzedCount(total || finalResults.filter((item) => typeof item.matchScore === 'number').length)
      const sortedResults = (autoSortEnabled ? sortSearchResults(finalResults) : finalResults).slice(0, OMNI_SEARCH_RESULT_LIMIT)
      void setSearchResults(sortedResults)
      toast({
        title: "分析完成",
        description: `已完成 ${total || finalResults.length} 条线索的评分分析`,
        variant: "default",
        className: "bg-emerald-50 border-emerald-200 text-emerald-800",
      })
    })

    const unsubscribeError = onSearchStreamError((error) => {
      streamStartedRef.current = false
      setIsStreaming(false)
      setIsLoading(false)
      const hasExistingResults = useLeadsStore.getState().searchResults.length > 0
      setEmptyStateMessage("")
      setSearchErrorMessage(error)
      setShowRetryHint(/network|timeout|fetch|failed to fetch|econn|enet|socket|429/i.test(String(error || '').toLowerCase()))
      toast({
        title: "搜索流处理中断",
        description: hasExistingResults ? "AI 增强处理中断，已保留基础搜索结果。" : error,
        variant: "destructive",
      })
    })

    return () => {
      unsubscribeStart()
      unsubscribeStage()
      unsubscribeBasic()
      unsubscribeScored()
      unsubscribeComplete()
      unsubscribeError()
    }
  }, [autoSortEnabled, searchCountry, searchKeyword, searchLimit.maxResults, setSearchResults, toast])

  useEffect(() => {
    if (!hydrated) {
      void hydrateFromConfig()
    }
  }, [hydrateFromConfig, hydrated])

  useEffect(() => {
    if (!configHydrated) {
      void hydrateUserConfig()
    }
  }, [configHydrated, hydrateUserConfig])

  useEffect(() => {
    let alive = true

    const checkLlmKey = async () => {
      try {
        const meta = await secretCheck("secrets.llm.apiKey")
        if (alive) {
          setHasLlmKey(Boolean(meta?.exists))
        }
      } catch {
        if (alive) {
          setHasLlmKey(false)
        }
      }
    }

    void checkLlmKey()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!autopilotHydrated) {
      void hydrateAutopilot()
    }
  }, [autopilotHydrated, hydrateAutopilot])

  useEffect(() => {
    const unsubscribe = onAutopilotAction((action) => {
      if (action === 'pause') {
        void useAutopilotStore.getState().pause()
        return
      }

      if (action === 'resume') {
        void useAutopilotStore.getState().start()
        return
      }

      if (action === 'stop') {
        void useAutopilotStore.getState().stopAndClear()
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    void autopilotSyncLifecycle(autopilotRuntime.lifecycle).catch((error) => {
      console.error('同步托盘巡航状态失败', error)
    })
  }, [autopilotRuntime.lifecycle])

  const handleSearch = async () => {
    if (autopilotBusy) {
      toast({
        title: "后台巡航正在占用搜索资源",
        description: "请先暂停或停止伴随式后台巡航，再执行手动搜索。",
        variant: "destructive",
      })
      return
    }

    if (featureGate.status !== 'active' || !featureGate.canAccess('search_basic')) {
      toast({
        title: "当前授权不可搜索",
        description: "请先激活有效授权后再使用 AI 获客搜索",
        variant: "destructive",
      })
      return
    }

    const now = Date.now()
    const elapsed = now - lastSearchAt
    if (searchLimit.cooldownMs > 0 && elapsed < searchLimit.cooldownMs) {
      const remainSeconds = Math.ceil((searchLimit.cooldownMs - elapsed) / 1000)
      toast({
        title: "搜索频率受限",
        description: `请等待 ${remainSeconds} 秒后再次搜索。`,
        variant: "destructive",
      })
      return
    }

    if (!searchKeyword.trim()) {
      toast({
        title: "请输入关键词",
        description: "请先填写关键词再开始搜索",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    setHasSearched(true)
    setEmptyStateMessage("")
    setSearchErrorMessage("")
    setShowRetryHint(false)
    setTrialExpired(false)
    setLastSearchAt(now)
    setStreamTotal(0)
    setAnalyzedCount(0)
    setStreamStage("")
    setStreamStageMessage("")
    setAiScoringSkipped(false)
    streamStartedRef.current = false
    setShowLlmKeyReminder(false)
    if (!hasLlmKey) {
      setShowLlmKeyReminder(true)
    }
    const searchKeywordForRequest = buildSearchKeyword(searchKeyword, searchDataSource)
    const isAnySearchSource = true
    if (isAnySearchSource) {
      try {
        const result = await secretCheck('secrets.anysearch.apiKey')
        setAnySearchDegradeHint(!result?.exists)
      } catch {
        setAnySearchDegradeHint(true)
      }
    } else {
      setAnySearchDegradeHint(false)
    }
    let searchTriggered = false
    try {
      searchTriggered = true
      const response = await searchExecute({
        keyword: searchKeywordForRequest,
        country: searchCountry,
        city: searchCity,
        dataSourceType: undefined,
        filterOptions: {
          priorityWebsite: officialOnlyEnabled,
          localDomainOnly: localDomainOnlyEnabled,
          highRelevanceOnly: highRelevanceOnlyEnabled,
          b2bRoleOnly: b2bRoleOnlyEnabled,
        },
      })

      const targetData = Array.isArray(response?.results) ? response.results : []

      if (!response || !Array.isArray(targetData)) {
        throw new Error('当前搜索结果暂不可用，请稍后重试')
      }

      const industryKeyword = intentMutatedKeywordsRef.current || searchKeyword
      const rawResults: LeadSearchResult[] = targetData.map((item: any, idx: number) =>
        mapSearchExecuteResultToSearchResult(item, idx, { keyword: industryKeyword, country: searchCountry })
      )

      const results = rawResults.slice(0, Math.min(searchLimit.maxResults, OMNI_SEARCH_RESULT_LIMIT))

        if (rawResults.length > results.length) {
        toast({
          title: "已应用搜索深度限制",
          description: `当前仅展示前 ${Math.min(searchLimit.maxResults, OMNI_SEARCH_RESULT_LIMIT)} 条结果。`,
          variant: "default",
          className: "bg-amber-50 border-amber-200 text-amber-800",
        })
      }

      await setSearchResults(results)
      if (results.length > 0) {
        toast({
          title: isStreaming ? "搜索结果已返回" : "搜索完成",
          description: `已返回 ${results.length} 条线索`,
          variant: "default",
          className: "bg-emerald-50 border-emerald-200 text-emerald-800",
        })
      }
      if (results.length === 0) {
        setEmptyStateMessage("目标地区可能没有直接相关的企业。建议：1. 尝试更宽泛的行业关键词；2. 扩大搜索的国家/城市范围。")
      }
    } catch (error) {
      if (!streamStartedRef.current) {
        setIsLoading(false)
      }
      const rawMessage = error instanceof Error ? error.message : String(error || '')
      if (/TRIAL_EXPIRED/i.test(rawMessage)) {
        // P1-1 fix: 严禁清空已有结果 (.clinerules §4.2)
        setTrialExpired(true)
        setSearchErrorMessage("")
        setShowRetryHint(false)
        toast({
          title: "授权已失效",
          description: "当前授权已失效，请先完成激活后继续使用。",
          variant: "destructive",
        })
        return
      }
      const message = buildPersistentErrorMessage(error, "Search failed")
      const normalizedMessage = rawMessage.toLowerCase()
      const isNetworkError = /network|timeout|fetch|failed to fetch|econn|enet|socket/.test(normalizedMessage)

      const existingResults = useLeadsStore.getState().searchResults
      const hasExistingResults = Array.isArray(existingResults) && existingResults.length > 0

      setEmptyStateMessage("")
      setSearchErrorMessage(message)
      setShowRetryHint(isNetworkError)

      toast({
        title: hasExistingResults ? "AI 增强处理异常" : "搜索失败",
        description: hasExistingResults ? "已保留基础搜索结果，可稍后重试 AI 评分。" : (isNetworkError ? "AI 数据流连接异常，请稍后重试。" : message),
        variant: "destructive",
      })
    } finally {
      if (!searchTriggered && !streamStartedRef.current) {
        setIsLoading(false)
      }
    }
  }

  const handleSaveLead = async (lead: LeadSearchResult) => {
    const leadKey = getLeadUniqueKey({ company: lead.company, website: lead.website || "" })
    const hasExistingLead = useLeadsStore.getState().leads.some((item) => getLeadUniqueKey(item) === leadKey)

    if (savedLeadIds.has(lead.id) || hasExistingLead) {
      toast({
        title: "已保存",
        description: "该线索已在库中，无需重复保存",
        variant: "default",
        className: "bg-emerald-50 border-emerald-200 text-emerald-800",
      })
      return
    }
    if (savingLeadId === lead.id) return
    if (hasExistingLead) {
      setSavedLeadIds((prev) => {
        const next = new Set(prev)
        next.add(lead.id)
        return next
      })
      toast({
        title: "已保存",
        description: "该线索已在库中，无需重复保存",
        variant: "default",
        className: "bg-emerald-50 border-emerald-200 text-emerald-800",
      })
      return
    }
    setSavingLeadId(lead.id)
    setSavedLeadIds((prev) => {
      const next = new Set(prev)
      next.add(lead.id)
      return next
    })
    try {
      const mapped = mapSearchResultToLeadItem(lead, {
        country: lead.country || "Global",
        countryCode: lead.countryCode || "GL",
        industry: lead.industry,
      })
      await addLead(mapped)
      toast({
        title: "已保存线索",
        description: `已写入 ${lead.company}`,
        variant: "default",
        className: "bg-emerald-50 border-emerald-200 text-emerald-800",
      })
      } catch (error) {
        setSavedLeadIds((prev) => {
          const next = new Set(prev)
          if (!useLeadsStore.getState().leads.some((item) => getLeadUniqueKey(item) === leadKey)) {
            next.delete(lead.id)
          }
          return next
      })
      toast({
        title: "保存失败",
        description: formatErrorMessage(error, "线索保存失败"),
        variant: "destructive",
      })
    } finally {
      setSavingLeadId(null)
    }
  }

  const handleAnalyzeUrl = async () => {
    if (!searchLimit.allowDeepAnalysis) {
      toast({
        title: "深度分析已锁定",
        description: "当前授权不支持网页深度分析。",
        variant: "destructive",
      })
      return
    }

    if (!analyzingUrl.trim()) {
      toast({
        title: "请输入目标网址",
        description: "请输入要分析的 company 官网 URL",
        variant: "destructive",
      })
      return
    }

    let url = analyzingUrl.trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }

    setIsAnalyzing(true)
    setAnalysisResult(null)

    try {
      const response = await searchExecute({
        keyword: url,
        country: searchCountry,
        city: searchCity,
      })

      const summaryReason = response?.results?.[0]?.matchReasons?.[0] || response?.results?.[0]?.riskFlags?.[0] || ""
      const score = typeof response?.results?.[0]?.matchScore === 'number' ? response.results[0].matchScore : undefined


      setAnalysisResult({
        url,
        title: "AI 已完成网站分析",
        description: summaryReason || "分析完成，暂无更多描述",
        matchScore: score,
        industryTags: ["B2B"],
      })

      toast({
        title: "分析完成",
        description: `ICP 综合评估: ${typeof score === 'number' ? `${score}%` : '待评估'}`,
        variant: "default",
        className: "bg-emerald-50 border-emerald-200 text-emerald-800",
      })
    } catch (error) {
      toast({
        title: "分析失败",
        description: formatErrorMessage(error, "无法分析该网页"),
        variant: "destructive",
      })
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleStartAutopilot = async () => {
    setIsStartingAutopilot(true)
    try {
      const autopilotDraftForQueue = rewriteAutopilotDraftWithDataSource(autopilotRawText, searchDataSource)
      const preparedJobs = autopilotDraftForQueue.trim() ? await addBatchJobs(autopilotDraftForQueue) : []
      const hasRunnableJobs = preparedJobs.length > 0 || autopilotJobs.some((job) => job.status === "pending")
      if (!hasRunnableJobs) {
        toast({
          title: "未识别到有效巡航任务",
          description: "请使用逗号、竖线或空格分隔，例如：Poland, lithium battery, 30。",
          variant: "destructive",
        })
        return
      }

      await startAutopilot()
      await setAutopilotDraftText("")
      toast({
        title: "后台巡航已启动",
        description: "系统将以低干扰方式串行执行静默获客任务。",
        variant: "default",
        className: "bg-emerald-50 border-emerald-200 text-emerald-800",
      })
    } catch (error) {
      toast({
        title: "巡航启动失败",
        description: formatErrorMessage(error, "后台巡航启动异常"),
        variant: "destructive",
      })
    } finally {
      setIsStartingAutopilot(false)
    }
  }

  const handleImportCsvClick = () => {
    csvFileInputRef.current?.click()
  }

  const handleImportCsvFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    if (file.size > CSV_IMPORT_MAX_BYTES) {
      toast({
        title: 'CSV 导入失败',
        description: '文件超过 2MB，请拆分后再导入。',
        variant: 'destructive',
      })
      return
    }

    try {
      const csvText = await readFileAsText(file)
      const roughLineCount = (csvText.match(/\r?\n/g)?.length || 0) + 1
      if (roughLineCount > CSV_IMPORT_MAX_LINES) {
        toast({
          title: 'CSV 导入失败',
          description: 'CSV 行数超过 5000 行，请拆分后再导入。',
          variant: 'destructive',
        })
        return
      }

      const { draftLines, importedCount, usedHeaderMapping } = buildAutopilotDraftFromCsv(csvText)
      const latestDraftText = useAutopilotStore.getState().draftText.trim()
      const nextDraft = latestDraftText ? `${latestDraftText}\n${draftLines.join('\n')}` : draftLines.join('\n')
      await setAutopilotDraftText(nextDraft)

      toast({
        title: 'CSV 导入成功',
        description: usedHeaderMapping
          ? `已识别并追加 ${importedCount} 条存量客户任务。`
          : `未识别到表头映射，已按第一列作为公司名导入 ${importedCount} 条任务。`,
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
    } catch (error) {
      toast({
        title: 'CSV 导入失败',
        description: error instanceof Error ? error.message : '读取或解析 CSV 失败，请检查文件格式。',
        variant: 'destructive',
      })
    }
  }

  const handlePauseAutopilot = async () => {
    await pauseAutopilot()
    toast({
      title: "后台巡航已请求暂停",
      description: "当前任务将在安全检查点后暂停。",
      variant: "default",
      className: "bg-amber-50 border-amber-200 text-amber-800",
    })
  }

  const handleStopAutopilot = async () => {
    await stopAndClearAutopilot()
    toast({
      title: "后台巡航已停止",
      description: "任务队列已清空，可重新配置后再次启动。",
      variant: "default",
      className: "bg-slate-100 border-slate-200 text-slate-800",
    })
  }

  if (userRole === null || userRole === undefined || featureGate.loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6" data-stage="search">
        <div className="flex items-center justify-center h-40">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6" data-stage="search">
        <div className="flex flex-col gap-6">
        {/* 第一行：唯一全渠道盲搜输入 */}
        <div className="grid gap-4">
          <div className="flex-[2] flex flex-col gap-1.5 w-full">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium text-muted-foreground">智能全渠道盲搜输入框</label>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">{OMNI_SEARCH_MODE_LABEL}</span>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleSearch()
                  }
                }}
                placeholder="🤖 支持直接输入纯自然语言描述，例如：帮我找 50 家在德国做高性能储能电池的独立站经销商，要求有采购高管邮箱且能做批发..."
                className="w-full h-10 pl-9 pr-4 rounded-lg border border-input bg-slate-50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-primary transition-all"
              />
            </div>
            <p className="text-xs text-slate-500">系统会先自动解构意图、翻译并突变为高价值 B2B 英文词，再并发检索地图、网页与多源穿透数据。</p>
          </div>
        </div>

        <Accordion type="single" collapsible className="w-full rounded-xl border border-border bg-card p-5 shadow-sm">
          <AccordionItem value="b2b-search-syntax" className="border-none">
            <AccordionTrigger className="py-0 text-sm font-semibold text-slate-900 hover:no-underline">
              ✨ 高质量 B2B 搜索语法与模板
            </AccordionTrigger>
            <AccordionContent className="pb-0 pt-4">
              <p className="text-xs leading-relaxed text-slate-500">
                提示：加入 distributor / importer / OEM / integrator 等角色词，可显著提升 B2B 客户质量。
              </p>
              <div className="mt-4 grid w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    title: "渠道定位",
                    syntax: `\"{产品词}\" distributor {国家}`,
                    desc: "精确锁定渠道商与分销商",
                  },
                  {
                    title: "本土企业筛选",
                    syntax: `site:.{国家域名} \"{产品词}\" importer`,
                    desc: "限定国家本土进口企业",
                  },
                  {
                    title: "官网合作页",
                    syntax: `intitle:partner \"{产品词}\"`,
                    desc: "优先命中官网合作与招募页面",
                  },
                  {
                    title: "制造能力排查",
                    syntax: `\"{产品词}\" OEM manufacturer -job -news`,
                    desc: "排除招聘页与资讯页干扰",
                  },
                ].map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => setSearchKeyword(item.syntax)}
                    className="group flex min-h-[186px] w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                        {item.title}
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600">
                        点击填入
                      </span>
                    </div>
                    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 font-mono text-[11px] leading-5 text-slate-800 break-words whitespace-normal">
                      {item.syntax}
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-slate-500 whitespace-normal">
                      {item.desc}
                    </p>
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* 第二行：目标地区和城市并排 */}
        <div className="grid grid-cols-2 gap-4">
          {/* Country Input - Global Search */}
          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-xs font-medium text-muted-foreground">目标国家/地区</label>
            <input
              type="text"
              value={searchCountry}
              onChange={(e) => setSearchCountry(e.target.value)}
              placeholder="输入国家/地区（支持全球）"
              className="w-full h-10 px-3 rounded-lg border border-input bg-slate-50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-primary transition-all"
            />
          </div>

          {/* City Input */}
          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-xs font-medium text-muted-foreground">目标城市 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={searchCity}
              onChange={(e) => setSearchCity(e.target.value)}
              placeholder="例如：Los Angeles 或 全选"
              className="w-full h-10 px-3 rounded-lg border border-input bg-slate-50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-primary transition-all"
            />
            <p className="text-slate-400 text-xs mt-1">💡 提示：谷歌地图依赖具体城市名。若识别受阻，系统将自动切换至全球网页搜索模式。</p>
          </div>
        </div>

        {/* Hint for global search */}
        <p className="text-xs text-[hsl(var(--neutral-gray))]">提示：支持多语言输入，系统将自动匹配 Google 全球商业线索。</p>

        {/* 第四行：操作按钮 */}
        <div className="space-y-2">
          {showLlmKeyReminder ? (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle className="size-4" />
              <AlertDescription>
                检测到未配置 AI 评分密钥，ICP 打分将显示为基础状态。
              </AlertDescription>
            </Alert>
          ) : null}
            <Button
              className="h-12 w-full rounded-lg bg-blue-600 font-medium text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-70 hover:bg-blue-700"
              data-testid="btn-search-execute"
              disabled={isLoading || autopilotBusy}
              isLoading={isLoading}
              onClick={handleSearch}
            >
              {!isLoading ? <Sparkles className="size-4" /> : null}
              {isLoading ? "AI 正在全球检索中..." : "立即开始 AI 获客"}
            </Button>
          </div>

        <Accordion type="single" collapsible className="rounded-2xl border border-slate-200 bg-slate-50 px-4 shadow-sm">
          <AccordionItem value="autopilot-console" className="border-none">
            <AccordionTrigger className="py-4 text-sm font-semibold text-slate-900 hover:no-underline">
              🚀 伴随式后台巡航
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">批量任务输入</label>
                    <p className="text-xs text-muted-foreground">当前任务将通过 [{currentDataSourceLabel}] 进行透视搜索。</p>
                      <Textarea
                        value={autopilotRawText}
                        onChange={(event) => {
                          void setAutopilotDraftText(event.target.value)
                        }}
                        placeholder={"国家, 关键词, 数量\n例如: Poland, lithium battery, 30\nGermany, energy storage distributor, 20"}
                        className="min-h-[124px] resize-none rounded-xl border-slate-200 bg-white/90 text-sm text-slate-700 placeholder:text-slate-400 focus-visible:ring-blue-500/20"
                      />
                    <input
                      ref={csvFileInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(event) => {
                        void handleImportCsvFile(event)
                      }}
                    />
                      <p className="text-[11px] leading-5 text-slate-500">支持使用逗号、竖线或空格分隔。例如：Poland, lithium battery, 30</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleImportCsvClick}
                      disabled={autopilotRuntime.lifecycle === "running"}
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      📁 导入 CSV
                    </Button>
                    <Button
                      onClick={handleStartAutopilot}
                      disabled={autopilotStartDisabled}
                      isLoading={isStartingAutopilot}
                        className="bg-blue-600 text-white hover:bg-blue-700"
                    >
                      {isStartingAutopilot ? "启动中..." : autopilotRuntime.lifecycle === "running" ? "巡航运行中" : "启动巡航"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handlePauseAutopilot}
                      disabled={autopilotRuntime.lifecycle !== "running"}
                      className="border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
                    >
                      暂停
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleStopAutopilot}
                      disabled={autopilotJobs.length === 0 && !autopilotRawText.trim()}
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      停止并清空
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">巡航状态</div>
                      <div className="text-xs text-slate-500">最小化后仍可后台静默运行</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${autopilotRuntime.lifecycle === "running" ? "bg-emerald-50 text-emerald-700" : autopilotRuntime.lifecycle === "paused" ? "bg-amber-50 text-amber-700" : autopilotRuntime.lifecycle === "error" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                      {autopilotRuntime.lifecycle === "running" ? "运行中" : autopilotRuntime.lifecycle === "paused" ? "已暂停" : autopilotRuntime.lifecycle === "completed" ? "已完成" : autopilotRuntime.lifecycle === "error" ? "异常中断" : "待命"}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] text-slate-500">任务进度</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">{autopilotProgressLabel}</div>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] text-slate-500">静默入库</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">{autopilotRuntime.totalSaved}</div>
                      <button
                        type="button"
                        onClick={handleNavigateLeads}
                        className="mt-2 text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-600"
                      >
                        🔗 前往线索管理查看
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">当前任务</div>
                    <div className="mt-1 text-sm font-medium text-slate-800">
                      {autopilotCurrentJobLabel}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                      <span>发现 {autopilotCurrentJob?.discoveredCount || 0}</span>
                      <span className="inline-flex items-center gap-1">
                        命中 {autopilotCurrentJob?.qualifiedCount || 0}
                        {(autopilotCurrentJob?.qualifiedCount || 0) === 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">i</button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[260px]">
                              注：系统已自动为您过滤低评分线索，仅保留优质 B2B 客户。
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        已存 {autopilotCurrentJob?.savedCount || 0}
                        {(autopilotCurrentJob?.savedCount || 0) === 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">i</button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[260px]">
                              注：系统已自动为您过滤低评分线索，仅保留优质 B2B 客户。
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </span>
                    </div>
                    {shouldShowAutopilotFilterHint ? <div className="mt-2 text-[11px] text-slate-400">系统正在优先保留高质量 B2B 线索，低评分结果不会进入线索库。</div> : null}
                    {autopilotRuntime.lastError ? (
                      <div className="mt-2 text-[11px] text-red-600">{autopilotRuntime.lastError}</div>
                    ) : null}
                    {!autopilotRuntime.lastError && autopilotStatusReason ? (
                      <div className="mt-2 text-[11px] text-amber-600">{autopilotStatusReason}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* 搜索结果区域 */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-900">线索展示区</h3>
              <p className="text-xs text-slate-500">AI 搜索结果可一键保存至线索库</p>
            </div>
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2 text-[11px] text-slate-500">
                <input
                  type="checkbox"
                  checked={autoSortEnabled}
                  onChange={(e) => setAutoSortEnabled(e.target.checked)}
                  className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
                />
                自动按评估排序
              </label>
              {hasSearched && (
                <div className="text-xs text-slate-500">当前结果 {Math.min(displayedResults.length, OMNI_SEARCH_RESULT_LIMIT)} 条</div>
              )}
              <div className="text-[11px] text-slate-400">
                ⚡ 数据源: 实时全网商业搜索
              </div>
            </div>
          </div>
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-800">高级质量控制</div>
                <div className="text-xs text-slate-500">面向 B2B 商用场景，优先保留更像真实采购客户的线索。</div>
              </div>
              <div className="text-xs text-slate-500">当前展示 {Math.min(displayedResults.length, OMNI_SEARCH_RESULT_LIMIT)} / {Math.min(searchResults.length, OMNI_SEARCH_RESULT_LIMIT)}</div>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <input type="checkbox" checked={officialOnlyEnabled} onChange={(e) => setOfficialOnlyEnabled(e.target.checked)} className="mt-0.5 size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20" />
                <span><span className="font-medium text-slate-900">优先官网</span><br />降低目录站、社媒页与信息聚合页干扰</span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <input type="checkbox" checked={localDomainOnlyEnabled} onChange={(e) => setLocalDomainOnlyEnabled(e.target.checked)} className="mt-0.5 size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20" />
                <span><span className="font-medium text-slate-900">优先本土域名</span><br />尽量保留与目标国家更匹配的本地官网</span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <input type="checkbox" checked={highRelevanceOnlyEnabled} onChange={(e) => setHighRelevanceOnlyEnabled(e.target.checked)} className="mt-0.5 size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20" />
                <span><span className="font-medium text-slate-900">只看高相关</span><br />仅展示 ICP 综合评估 60 分及以上的线索</span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <input type="checkbox" checked={b2bRoleOnlyEnabled} onChange={(e) => setB2bRoleOnlyEnabled(e.target.checked)} className="mt-0.5 size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20" />
                <span><span className="font-medium text-slate-900">优先 B2B 角色词</span><br />更关注 distributor / importer / OEM / integrator 信号</span>
              </label>
            </div>
          </div>
          {isStreaming ? (
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-white/80 px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <div className="size-2 rounded-full bg-blue-600 animate-pulse" />
                  <span>{streamStageMessage || '🤖 AI 正在处理搜索任务...'}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {streamStage === 'scoring' ? `${Math.min(analyzedCount, OMNI_SEARCH_RESULT_LIMIT)} / ${Math.min(streamTotal, OMNI_SEARCH_RESULT_LIMIT)}` : '处理中'}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-slate-800">🤖 AI 深度分析中... {Math.min(analyzedCount, OMNI_SEARCH_RESULT_LIMIT)} / {Math.min(streamTotal, OMNI_SEARCH_RESULT_LIMIT)}</div>
                <div className="text-xs text-slate-500">实时更新线索评分与风险判断</div>
              </div>
              {anySearchDegradeHint && (
                <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-700 leading-relaxed">
                  💡 提示：检测到您未在前台配置 AnySearch 专用密钥，系统已为您自动无感激活【四级弹性自愈协议】，正在无头补位常规 Google 地图/网页数据，请放心查看列表。
                </div>
              )}
              <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-700 leading-relaxed">
                {OMNI_COMPLIANCE_GUIDE}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${streamTotal > 0 ? Math.min(100, (analyzedCount / streamTotal) * 100) : 0}%` }}
                />
              </div>
            </div>
          ) : null}
          {searchErrorMessage ? (
            <div className="border-b border-red-100 bg-red-50/80 px-5 py-4">
              <Alert variant="destructive" className="border-red-200 bg-white/70">
                <AlertCircle className="size-4" />
                <AlertTitle>{searchResults.length > 0 ? "本次搜索出现网络异常" : "当前搜索服务暂不可用"}</AlertTitle>
                <AlertDescription>
                  <div>{searchErrorMessage}</div>
                  {showRetryHint ? <div className="text-xs text-red-700/80">建议稍后重试；如问题持续，可能是冷启动、网络波动或代理限流导致。</div> : null}
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          {isLoading && searchResults.length === 0 ? (
            <div className="p-6">
              <div className="mb-4 text-sm font-medium text-slate-700">{isStreaming ? `正在并发分析 ${Math.min(streamTotal || 0, OMNI_SEARCH_RESULT_LIMIT)} 条线索...` : '正在搜索...'}</div>
              <div className="space-y-3">
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
              </div>
            </div>
          ) : !hasSearched ? (
            <div className="p-8 text-center text-sm text-slate-500">
              <div className="text-base font-medium text-slate-700">欢迎使用 Kone AI 智能获客工作台</div>
              <div className="mt-2">请输入目标客户搜索词，系统将优先识别更接近 B2B 渠道、采购与合作角色的商业线索。</div>
              <div className="mt-3 text-[11px] text-slate-400">示例：&quot;energy storage distributor&quot; germany / intitle:partner solar</div>
            </div>
          ) : trialExpired ? (
            <div className="p-8">
              <div className="mx-auto flex max-w-2xl flex-col items-center rounded-2xl border border-amber-200 bg-white px-6 py-8 text-center shadow-sm">
                <div className="text-lg font-semibold text-amber-900">⚠️ 当前授权已失效</div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  请前往激活中心完成授权后，继续使用智能获客与高级分析功能。
                </p>
              </div>
            </div>
          ) : searchErrorMessage && searchResults.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              <div className="font-medium text-red-600">当前搜索服务暂不可用</div>
              <div className="mt-2">{searchErrorMessage}</div>
              {showRetryHint ? <div className="mt-2 text-[11px] text-slate-400">建议稍后重试；如问题持续，请联系专属顾问协助排查。</div> : null}
            </div>
          ) : displayedResults.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {searchResults.length > 0 ? (
                <>
                  <div>当前质量筛选已隐藏全部结果，请关闭优先官网/高相关筛选后查看。</div>
                  <div className="mt-2 text-[11px] text-slate-400">原始结果 {Math.min(searchResults.length, OMNI_SEARCH_RESULT_LIMIT)} 条，当前展示 0 条</div>
                </>
              ) : (
                <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm">
                  <div className="text-lg font-semibold text-slate-800">未找到符合条件的企业</div>
                  <div className="mt-3 text-sm leading-6 text-slate-500">
                    {emptyStateMessage || "目标地区可能没有直接相关的企业。建议：1. 尝试更宽泛的行业关键词；2. 扩大搜索的国家/城市范围。"}
                  </div>
                <div className="mt-3 text-[11px] text-slate-400">当前筛选条件下找到 0 条线索 | 来源：实时全网商业搜索</div>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
            {pagedResults.map((lead, index) => {
              const settlementMeta = getLeadSettlementMeta(lead)

              return (
              <div key={stableHash(`${lead.id}-${index}`)} className="flex flex-col gap-3 px-5 py-4 hover:bg-slate-50 transition-all">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{lead.company}</span>
                        {hasAnalysisResult(lead.analysisCache) ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            <Radar className="size-3" />
                            已分析
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">{lead.industry}</span>
                        {typeof lead.isB2B === 'boolean' ? (
                          <span
                            className={`rounded-full px-2 py-0.5 ${lead.isB2B ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                          >
                            {lead.isB2B ? "B2B" : "B2C"}
                          </span>
                        ) : null}
                        <span>{lead.country || "Global"}</span>
                        <span>
                        {typeof lead.matchScore === 'number'
                          ? `ICP 综合评估 ${lead.matchScore}%`
                          : settlementMeta.state === 'ai_skipped'
                            ? 'ICP 综合评估 未启用 AI 评分'
                            : settlementMeta.state === 'fallback'
                              ? 'ICP 综合评估 待人工复核'
                              : 'ICP 综合评估 待评估'}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="text-[11px] text-slate-400 underline decoration-dotted underline-offset-2 cursor-help">
                              说明
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[260px]">
                            该分值为 AI 基于产品、角色、商业信号等生成的综合评估，建议结合人工判断使用。
                          </TooltipContent>
                        </Tooltip>
                        {lead.website ? (
                          <a
                            href={normalizeWebsiteHref(lead.website)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate max-w-[220px] text-blue-600 hover:underline hover:text-blue-700"
                          >
                            {lead.website}
                          </a>
                        ) : null}
                        {lead.phone ? <span>{lead.phone}</span> : null}
                        {"address" in lead && lead.address ? (
                          <span className="truncate max-w-[240px]">{lead.address}</span>
                        ) : null}
                      </div>
                      {settlementMeta.showPending ? (
                        <div className="mt-1 inline-flex items-center gap-2 text-xs text-blue-500">
                          <div className="size-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                          🤖 AI 正在分析该线索...
                        </div>
                      ) : null}
                      {settlementMeta.showFallback ? (
                        <div className={`mt-1 inline-flex items-center gap-2 text-xs ${settlementMeta.fallbackTone === 'blue' ? 'text-blue-700' : 'text-amber-500'}`}>
                          {settlementMeta.fallbackTone === 'blue' ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}
                          {settlementMeta.fallbackReason}
                        </div>
                      ) : null}
                      {stripInternalMarkers(lead.matchReasons).length > 0 && !settlementMeta.showFallback ? (
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-emerald-700">
                          {stripInternalMarkers(lead.matchReasons).slice(0, 2).map((reason, reasonIndex) => (
                            <span key={stableHash(`${lead.id}-reason-${reasonIndex}`)} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5">
                              <Check className="size-3" />
                              {reason}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {lead.inferredRole ? (
                        <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                          <span className="font-medium text-blue-900">推断角色</span>
                          <span>{lead.inferredRole}</span>
                        </div>
                      ) : null}
                      {lead.salesStrategy ? (
                        <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs leading-5 text-slate-700">
                          <span className="font-medium text-blue-900">跟进建议：</span>
                          <span>{lead.salesStrategy}</span>
                        </div>
                      ) : null}
                      {stripInternalMarkers(lead.riskFlags).length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-amber-700">
                          {stripInternalMarkers(lead.riskFlags).slice(0, 1).map((risk, riskIndex) => (
                            <span key={stableHash(`${lead.id}-risk-${riskIndex}`)} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5">
                              <AlertTriangle className="size-3" />
                              {risk}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="bg-blue-600 text-white hover:bg-blue-700 transition-all"
                        data-testid="btn-save-lead"
                        disabled={savingLeadId === lead.id || savedLeadIds.has(lead.id)}
                        isLoading={savingLeadId === lead.id}
                        onClick={() => void handleSaveLead(lead)}
                      >
                        {savedLeadIds.has(lead.id) || savingLeadId === lead.id ? "已保存" : "一键保存"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => {
                          toast({
                            title: "请先保存线索",
                            description: "云端发送队列属于高级版能力，请先将线索保存至本地线索库后在推荐线索区或智能触达工作流中提交。",
                            variant: "default",
                            className: "bg-blue-50 border-blue-200 text-blue-800",
                          })
                        }}
                      >
                        保存后可云端触达
                      </Button>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>

        {displayedResults.length > SEARCH_PAGE_SIZE ? (
          <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-500">当前第 {currentPage} 页 / 共 {totalPages} 页，每页 30 条</div>
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(event) => {
                        event.preventDefault()
                        goToSearchPage(currentPage - 1)
                      }}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700">
                      {currentPage} / {totalPages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(event) => {
                        event.preventDefault()
                        goToSearchPage(currentPage + 1)
                      }}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
        ) : null}

        {/* 网页深度分析模块 (Pro Only) */}
        {currentRole === 'pro' && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="size-4 text-[hsl(var(--deep-blue))]" />
              <h4 className="text-sm font-semibold text-slate-800">网页深度分析</h4>
              <span className="text-xs text-slate-500">(基于 KnowledgeBase 行业预设)</span>
            </div>

            {!searchLimit.allowDeepAnalysis ? (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                当前授权仅支持基础搜索，网页深度分析功能已锁定。
              </div>
            ) : null}
            
            <div className="flex gap-2">
              <input
                type="text"
                value={analyzingUrl}
                onChange={(e) => setAnalyzingUrl(e.target.value)}
                placeholder="输入目标公司官网 URL，如: solartech.de"
                className="flex-1 h-10 px-3 rounded-lg border border-slate-200 bg-[hsl(var(--background))] text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[hsl(var(--deep-blue))] transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeUrl()}
              />
              <Button
                onClick={handleAnalyzeUrl}
                disabled={isAnalyzing || !searchLimit.allowDeepAnalysis}
                isLoading={isAnalyzing}
                className="bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition-all font-medium"
              >
                {!isAnalyzing ? <TrendingUp className="size-4 mr-1" /> : null}
                {isAnalyzing ? "分析中..." : "深度分析"}
              </Button>
            </div>

            {/* 分析结果展示 */}
            {analysisResult && (
              <div className="mt-4 p-4 bg-[hsl(var(--background))] rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="size-4 text-emerald-500" />
                    <span className="text-sm font-semibold text-slate-800">ICP 综合评估</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-bold ${typeof analysisResult.matchScore === 'number' ? (analysisResult.matchScore >= 70 ? 'text-emerald-600' : analysisResult.matchScore >= 50 ? 'text-amber-600' : 'text-red-500') : 'text-slate-500'}`}>
                      {typeof analysisResult.matchScore === 'number' ? `${analysisResult.matchScore}%` : '待评估'}
                    </span>
                    {typeof analysisResult.matchScore === 'number' ? <Progress value={analysisResult.matchScore} className="w-20 h-2" /> : null}
                  </div>
                </div>
                
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-xs text-slate-500">官网标题:</span>
                    <p className="text-slate-700 font-medium">{analysisResult.title}</p>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Meta 描述:</span>
                    <p className="text-slate-600 text-xs">{analysisResult.description}</p>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-slate-500">匹配行业:</span>
                    <div className="flex gap-1">
                      {analysisResult.industryTags.map((tag: string, index: number) => (
                        <span key={stableHash(`${tag}-${index}`)} className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-400">
              <AlertCircle className="size-3" />
              <span>该分值为 AI 基于产品、角色、商业信号等生成的综合评估，建议结合人工判断使用。</span>
            </div>
          </div>
        )}

        {/* 提示文字 */}
        <p className="text-[10px] text-slate-400 text-center -mt-2">
          提示：组合使用关键词与特定城市，可获得更精准的 Google 搜索B2B商业线索。
        </p>
      </div>
    </div>
  )
}
