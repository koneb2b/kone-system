'use client'

import { formatSearchErrorMessage } from '@/lib/error-message'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { useLeadsStore, LeadSearchResult } from '@/store/leads-store'
import { useAutopilotStore } from '@/store/autopilot-store'
import { useFeatureGate } from '@/lib/feature-gate'
import { useConfigStore } from '@/store/config-store'
import {
  onSearchBasicResults,
  onSearchLeadScored,
  onSearchStage,
  onSearchStreamComplete,
  onSearchStreamError,
  onSearchStreamStart,
  searchExecute,
  secretCheck,
} from '@/lib/electron-api'
import type { SearchExecuteResult } from '@/shared/ipc-contracts'

// ── Constants ──────────────────────────────────────────────
const SEARCH_PAGE_SIZE = 30
const OMNI_SEARCH_RESULT_LIMIT = 50

// ── Module-level helpers (moved from search-engine.tsx) ────

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

type SearchDataSource =
  | 'google_maps'
  | 'google_organic'
  | 'customs_shipment'
  | 'trade_show'
  | 'yellow_pages'
  | 'linkedin_search'
  | 'facebook_search'

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
  item: Partial<SearchExecuteResult> & Record<string, unknown>,
  idx: number,
  context: { keyword: string; country: string },
): LeadSearchResult => ({
  id: Number(item.id) || Date.now() + idx,
  company: (item.company as string) || '',
  industry: context.keyword.trim(),
  matchScore: typeof item.matchScore === 'number' ? Number(item.matchScore) : undefined,
  fallbackStatus: item.fallbackStatus === 'social_blind_score' ? ('social_blind_score' as const) : undefined,
  scoreSource: item.scoreSource === 'ai' || item.scoreSource === 'deterministic' ? item.scoreSource : undefined,
  opportunityScore:
    item.opportunityScore && typeof item.opportunityScore === 'object' ? item.opportunityScore : undefined,
  contact: (item.contact as string) || '',
  contactTitle: (item.contactTitle as string) || '',
  email: (item.email as string) || '',
  phone: (item.phone as string) || '',
  unlocked: Boolean(item.unlocked),
  source: (item.source as string) || 'Google Maps',
  country: context.country || 'Global',
  countryCode: context.country ? context.country.slice(0, 2).toUpperCase() : 'GL',
  website: (item.website as string) || '',
  matchReasons: Array.isArray(item.matchReasons) ? (item.matchReasons as string[]) : [],
  riskFlags: Array.isArray(item.riskFlags) ? (item.riskFlags as string[]) : [],
  address: (item.address as string) || '',
  isB2B: typeof item.isB2B === 'boolean' ? (item.isB2B as boolean) : undefined,
  snippet: (item.snippet as string) || '',
  inferredRole: (item.inferredRole as string) || '',
  salesStrategy: (item.salesStrategy as string) || '',
  status: (item.status as LeadSearchResult['status']) || 'new',
  dataSourceType: item.dataSourceType as LeadSearchResult['dataSourceType'],
  exhibitionFootprints: Array.isArray(item.exhibitionFootprints)
    ? (item.exhibitionFootprints as LeadSearchResult['exhibitionFootprints'])
    : undefined,
  customsData: item.customsData as LeadSearchResult['customsData'],
  decisionMakers: Array.isArray(item.decisionMakers)
    ? (item.decisionMakers as LeadSearchResult['decisionMakers'])
    : undefined,
  agentStatus: item.agentStatus as LeadSearchResult['agentStatus'],
  dataSourceNote: (item.dataSourceNote as string) || undefined,
  /* P0-1：保留搜索产物稳定 UUID，供 agentStatus 写回关联（agent:get-status） */
  leadKey: typeof item.id === 'string' ? item.id : undefined,
})

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
  const corpus = [lead.company, lead.website, lead.snippet, ...(lead.matchReasons || []), ...(lead.riskFlags || [])]
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
  const normalizedCountry = String(country || '')
    .trim()
    .toLowerCase()
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

/* 原 mergeTopRankedResults（按 website::company 合并顶 K）已由 leads-store 的
   `updateScoredLead` + `reinsertTopRanked` 取代（按 leadKey 定位，见 L0-4/F1），
   该实现自 P1-3 起不再被调用，属死代码，移除以避免误导后续维护者。 */

const buildPersistentErrorMessage = (error: unknown, fallback: string) => {
  const rawMessage = error instanceof Error ? error.message : String(error || fallback)
  const normalized = rawMessage.toLowerCase()
  const friendlyMessage = formatSearchErrorMessage(error, fallback)

  if (/trial_expired|试用已结束/.test(normalized)) return friendlyMessage
  if (/network|timeout|fetch|failed to fetch|socket|econn|enet|429|5\d\d/.test(normalized)) {
    const detail = rawMessage.trim()
    return detail && detail !== friendlyMessage ? `${friendlyMessage}（详细原因：${detail}）` : friendlyMessage
  }

  return rawMessage.trim() || friendlyMessage
}

const resolveSearchStageMessage = (payload?: {
  stage?: string
  message?: string
  searchMode?: 'anysearch' | 'maps' | 'maps-keyword-fallback' | 'organic-fallback'
  intentMutated?: { country?: string; keywords?: string[] }
}) => {
  if (payload?.intentMutated) {
    const country = payload.intentMutated.country || 'Global'
    const keywords = Array.isArray(payload.intentMutated.keywords) ? payload.intentMutated.keywords : []
    return `AI 智能解构成功！当前目标国家 [${country}]，正在全渠道并发穿透以下高价值 B2B 变种词：${keywords.map((item) => `[${item}]`).join(', ')}`
  }
  if (payload?.stage === 'prefiltering') {
    return '正在执行相关度预筛，剔除泛化结果...'
  }
  if (payload?.stage === 'blind_scoring' || payload?.searchMode === 'anysearch') {
    return 'AnySearch 正在通过全网海关数据、全球展会名录及社媒多渠道深度穿透高管决策人...'
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

type StreamStage =
  | 'fetching'
  | 'normalizing'
  | 'prefiltering'
  | 'blind_scoring'
  | 'scoring'
  | 'enriching'
  | 'complete'
  | 'localized_search'
  | 'anysearch'
  | ''

// ── Hook return type ───────────────────────────────────────
export interface UseSearchEngineReturn {
  // Search state
  isLoading: boolean
  hasSearched: boolean
  searchKeyword: string
  setSearchKeyword: (keyword: string) => void
  searchCountry: string
  setSearchCountry: (country: string) => void
  searchCity: string
  setSearchCity: (city: string) => void
  emptyStateMessage: string
  searchErrorMessage: string
  showRetryHint: boolean
  isStreaming: boolean
  streamTotal: number
  analyzedCount: number
  streamStageMessage: string
  streamStage: string
  trialExpired: boolean
  aiScoringSkipped: boolean
  anySearchDegradeHint: boolean
  showLlmKeyReminder: boolean
  hasLlmKey: boolean

  // Pagination & filters
  currentPage: number
  autoSortEnabled: boolean
  setAutoSortEnabled: (enabled: boolean) => void
  officialOnlyEnabled: boolean
  setOfficialOnlyEnabled: (enabled: boolean) => void
  localDomainOnlyEnabled: boolean
  setLocalDomainOnlyEnabled: (enabled: boolean) => void
  highRelevanceOnlyEnabled: boolean
  setHighRelevanceOnlyEnabled: (enabled: boolean) => void
  b2bRoleOnlyEnabled: boolean
  setB2bRoleOnlyEnabled: (enabled: boolean) => void

  // Derived
  searchResults: LeadSearchResult[]
  displayedResults: LeadSearchResult[]
  pagedResults: LeadSearchResult[]
  totalPages: number

  // Actions
  handleSearch: () => Promise<void>
  debouncedHandleSearch: () => void
  goToSearchPage: (page: number) => void
}

// ── Hook ───────────────────────────────────────────────────
export function useSearchEngine(): UseSearchEngineReturn {
  const { toast } = useToast()
  const featureGate = useFeatureGate()
  const { hydrateFromStorage: hydrateUserConfig, hydrated: configHydrated } = useConfigStore()
  const { searchResults, setSearchResults, hydrateFromConfig, hydrated } = useLeadsStore()
  const searchLimit = featureGate.getSearchLimit()

  // ── Search state ───────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchDataSource] = useState<SearchDataSource>('google_maps')
  const [searchCountry, setSearchCountry] = useState('')
  const [searchCity, setSearchCity] = useState('')
  const [emptyStateMessage, setEmptyStateMessage] = useState('')
  const [searchErrorMessage, setSearchErrorMessage] = useState('')
  const [showRetryHint, setShowRetryHint] = useState(false)
  const [lastSearchAt, setLastSearchAt] = useState(0)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamTotal, setStreamTotal] = useState(0)
  const [analyzedCount, setAnalyzedCount] = useState(0)
  const [streamStageMessage, setStreamStageMessage] = useState('')
  const [streamStage, setStreamStage] = useState<StreamStage>('')
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

  // ── Autopilot store (needed for handleSearch guard) ──────
  const autopilotRuntime = useAutopilotStore((state) => state.runtime)

  // ── Refs ───────────────────────────────────────────────────
  const streamTotalRef = useRef(0)
  const streamStartedRef = useRef(false)
  const intentMutatedKeywordsRef = useRef<string>('')
  const streamRetryCountRef = useRef(0)
  const consecutiveFailureRef = useRef(0)
  const handleSearchRef = useRef<() => Promise<void> | undefined>(undefined)
  const isAutoRetryRef = useRef(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Derived ────────────────────────────────────────────────
  const displayedResults = useMemo(() => {
    return searchResults
      .filter((lead) => {
        if (officialOnlyEnabled && !isLikelyOfficialWebsite(lead)) return false
        if (localDomainOnlyEnabled && !matchesLocalDomain(lead, searchCountry)) return false
        if (highRelevanceOnlyEnabled && (typeof lead.matchScore === 'number' ? lead.matchScore : 0) < 60) return false
        if (b2bRoleOnlyEnabled && !matchesB2BRoleSignal(lead)) return false
        return true
      })
      .slice(0, OMNI_SEARCH_RESULT_LIMIT)
  }, [
    b2bRoleOnlyEnabled,
    highRelevanceOnlyEnabled,
    localDomainOnlyEnabled,
    officialOnlyEnabled,
    searchCountry,
    searchResults,
  ])

  const totalPages = Math.max(1, Math.ceil(displayedResults.length / SEARCH_PAGE_SIZE))
  const pagedResults = useMemo(
    () => displayedResults.slice((currentPage - 1) * SEARCH_PAGE_SIZE, currentPage * SEARCH_PAGE_SIZE),
    [currentPage, displayedResults],
  )

  const autopilotBusy = autopilotRuntime.lifecycle === 'running' || autopilotRuntime.lifecycle === 'paused'

  // ── Effects ────────────────────────────────────────────────

  // Hydrate leads store
  useEffect(() => {
    if (!hydrated) {
      void hydrateFromConfig()
    }
  }, [hydrateFromConfig, hydrated])

  // Hydrate user config
  useEffect(() => {
    if (!configHydrated) {
      void hydrateUserConfig()
    }
  }, [configHydrated, hydrateUserConfig])

  // Check LLM key availability
  useEffect(() => {
    let alive = true

    const checkLlmKey = async () => {
      try {
        const meta = await secretCheck('secrets.llm.apiKey')
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

  // Reset page when filters change.
  // 注意：不得把 `searchResults` 列入依赖——否则评分流式期间每帧（每条
  // emitLeadScored）都会触发此处，使分页不断跳回第 1 页，用户永远无法翻页。
  // 过滤条件变化才需要重置分页。
  useEffect(() => {
    setCurrentPage(1)
  }, [
    searchKeyword,
    searchCountry,
    searchCity,
    officialOnlyEnabled,
    localDomainOnlyEnabled,
    highRelevanceOnlyEnabled,
    b2bRoleOnlyEnabled,
  ])

  // Clamp current page
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  // Stream subscription
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
      setStreamStage((payload?.stage as StreamStage) || '')
      setStreamStageMessage(resolveSearchStageMessage(payload as Parameters<typeof resolveSearchStageMessage>[0]))
      if (isAiSkippedStageMessage(payload?.message)) {
        setAiScoringSkipped(true)
      }
      const mutated = (payload as Record<string, unknown>)?.intentMutated as { keywords?: string[] } | undefined
      if (mutated && Array.isArray(mutated.keywords)) {
        intentMutatedKeywordsRef.current = mutated.keywords.join(' | ')
      }
    })

    const unsubscribeBasic = onSearchBasicResults((results) => {
      const industryKeyword = intentMutatedKeywordsRef.current || searchKeyword
      const normalizedResults: LeadSearchResult[] = (Array.isArray(results) ? results : [])
        .map((item: Record<string, unknown>, idx: number) =>
          mapSearchExecuteResultToSearchResult(item, idx, {
            keyword: industryKeyword,
            country: searchCountry,
          }),
        )
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
      /* P1-3：单点增量更新——按 leadKey / website / company 定位目标条目，
         仅替换该条目并维护顶 K 排序，避免每帧 O(n) 重建 + 引用替换
         导致 10 处整对象订阅者全部重渲染。 */
      const updated = useLeadsStore.getState().updateScoredLead(scoredLead as Record<string, unknown>, {
        reposition: autoSortEnabled,
        topCount: 8,
      })
      if (!updated) return
    })

    const unsubscribeComplete = onSearchStreamComplete(() => {
      streamStartedRef.current = false
      setIsStreaming(false)
      setIsLoading(false)
      // Reset failure counters on successful completion
      consecutiveFailureRef.current = 0
      streamRetryCountRef.current = 0
      const finalResults = useLeadsStore.getState().searchResults
      const total = streamTotalRef.current || finalResults.length
      setAnalyzedCount(total || finalResults.filter((item) => typeof item.matchScore === 'number').length)
      const sortedResults = (autoSortEnabled ? sortSearchResults(finalResults) : finalResults).slice(
        0,
        OMNI_SEARCH_RESULT_LIMIT,
      )
      void setSearchResults(sortedResults)
      /* L1-3 口径诚实化：完成提示必须报告【真实评分数】而非线索总数——
         主进程仅对 Top20 执行 LLM 评分（SEARCH_LLM_SCORE_LIMIT），
         把总数说成"已完成评分"是对用户的误导。 */
      const scoredCount = finalResults.filter((item) => typeof item.matchScore === 'number').length
      const totalCount = total || finalResults.length
      toast({
        title: '分析完成',
        description:
          scoredCount > 0
            ? `已完成 ${scoredCount} 条线索评分（共获取 ${totalCount} 条，深度评分按优先级限量执行）`
            : `已获取 ${totalCount} 条线索（本轮未产出评分结果）`,
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
    })

    const unsubscribeError = onSearchStreamError((error) => {
      streamStartedRef.current = false
      setIsStreaming(false)
      setIsLoading(false)
      const hasExistingResults = useLeadsStore.getState().searchResults.length > 0
      setEmptyStateMessage('')
      setSearchErrorMessage(error)
      const isNetworkError = /network|timeout|fetch|failed to fetch|econn|enet|socket|429/i.test(
        String(error || '').toLowerCase(),
      )
      setShowRetryHint(isNetworkError)

      // Auto-retry on network errors with exponential backoff (max 3 attempts)
      const MAX_RETRIES = 3
      const retryDelays = [1000, 2000, 4000]
      if (isNetworkError && streamRetryCountRef.current < MAX_RETRIES) {
        const attempt = streamRetryCountRef.current + 1
        streamRetryCountRef.current = attempt
        const delay = retryDelays[attempt - 1] || 4000
        toast({
          title: `正在自动重试 (${attempt}/${MAX_RETRIES})`,
          description: `AI 数据流连接异常，${Math.round(delay / 1000)} 秒后自动重试...`,
          variant: 'default',
        })
        setTimeout(() => {
          isAutoRetryRef.current = true
          if (handleSearchRef.current) {
            void handleSearchRef.current()
          }
        }, delay)
        return
      }

      toast({
        title: hasExistingResults ? 'AI 增强处理中断' : '搜索流处理中断',
        description: hasExistingResults ? 'AI 增强处理中断，已保留基础搜索结果。' : error,
        variant: 'destructive',
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

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [])

  // ── Handlers ───────────────────────────────────────────────

  const goToSearchPage = (page: number) => {
    let nextPage = page
    if (nextPage < 1) nextPage = totalPages
    if (nextPage > totalPages) nextPage = 1
    setCurrentPage(nextPage)
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleSearch = async () => {
    if (autopilotBusy) {
      toast({
        title: '后台巡航正在占用搜索资源',
        description: '请先暂停或停止伴随式后台巡航，再执行手动搜索。',
        variant: 'destructive',
      })
      return
    }

    if (featureGate.status !== 'active' || !featureGate.canAccess('search_basic')) {
      toast({
        title: '当前授权不可搜索',
        description: '请先激活有效授权后再使用 AI 获客搜索',
        variant: 'destructive',
      })
      return
    }

    const now = Date.now()
    const elapsed = now - lastSearchAt
    // Exponential backoff on consecutive failures: multiply cooldown by 1.5x per failure, capped at 4x
    const backoffMultiplier =
      consecutiveFailureRef.current > 0 ? Math.min(Math.pow(1.5, consecutiveFailureRef.current), 4) : 1
    const effectiveCooldownMs = Math.round(searchLimit.cooldownMs * backoffMultiplier)
    if (!isAutoRetryRef.current && searchLimit.cooldownMs > 0 && elapsed < effectiveCooldownMs) {
      const remainSeconds = Math.ceil((effectiveCooldownMs - elapsed) / 1000)
      toast({
        title: '搜索频率受限',
        description: `请等待 ${remainSeconds} 秒后再次搜索（连续失败冷却）。`,
        variant: 'destructive',
      })
      return
    }
    // Reset auto-retry and retry counters at the start of a fresh search
    isAutoRetryRef.current = false
    streamRetryCountRef.current = 0

    if (!searchKeyword.trim()) {
      toast({
        title: '请输入关键词',
        description: '请先填写关键词再开始搜索',
        variant: 'destructive',
      })
      return
    }

    setIsLoading(true)
    setHasSearched(true)
    setEmptyStateMessage('')
    setSearchErrorMessage('')
    setShowRetryHint(false)
    setTrialExpired(false)
    setLastSearchAt(now)
    setStreamTotal(0)
    setAnalyzedCount(0)
    setStreamStage('')
    setStreamStageMessage('')
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
      const rawResults: LeadSearchResult[] = targetData.map((item: Record<string, unknown>, idx: number) =>
        mapSearchExecuteResultToSearchResult(item, idx, {
          keyword: industryKeyword,
          country: searchCountry,
        }),
      )

      const results = rawResults.slice(0, Math.min(searchLimit.maxResults, OMNI_SEARCH_RESULT_LIMIT))

      if (rawResults.length > results.length) {
        toast({
          title: '已应用搜索深度限制',
          description: `当前仅展示前 ${Math.min(searchLimit.maxResults, OMNI_SEARCH_RESULT_LIMIT)} 条结果。`,
          variant: 'default',
          className: 'bg-amber-50 border-amber-200 text-amber-800',
        })
      }

      // Reset consecutive failure counter on successful search initiation
      consecutiveFailureRef.current = 0
      await setSearchResults(results)
      if (results.length > 0) {
        toast({
          title: isStreaming ? '搜索结果已返回' : '搜索完成',
          description: `已返回 ${results.length} 条线索`,
          variant: 'default',
          className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        })
      }
      if (results.length === 0) {
        setEmptyStateMessage(
          '目标地区可能没有直接相关的企业。建议：1. 尝试更宽泛的行业关键词；2. 扩大搜索的国家/城市范围。',
        )
      }
    } catch (error) {
      if (!streamStartedRef.current) {
        setIsLoading(false)
      }
      const rawMessage = error instanceof Error ? error.message : String(error || '')
      if (/TRIAL_EXPIRED/i.test(rawMessage)) {
        // P1-1 fix: 严禁清空已有结果
        setTrialExpired(true)
        setSearchErrorMessage('')
        setShowRetryHint(false)
        toast({
          title: '授权已失效',
          description: '当前授权已失效，请先完成激活后继续使用。',
          variant: 'destructive',
        })
        return
      }
      const message = buildPersistentErrorMessage(error, 'Search failed')
      const normalizedMessage = rawMessage.toLowerCase()
      const isNetworkError = /network|timeout|fetch|failed to fetch|econn|enet|socket/.test(normalizedMessage)

      const existingResults = useLeadsStore.getState().searchResults
      const hasExistingResults = Array.isArray(existingResults) && existingResults.length > 0

      setEmptyStateMessage('')
      setSearchErrorMessage(message)
      setShowRetryHint(isNetworkError)

      toast({
        title: hasExistingResults ? 'AI 增强处理异常' : '搜索失败',
        description: hasExistingResults
          ? '已保留基础搜索结果，可稍后重试 AI 评分。'
          : isNetworkError
            ? 'AI 数据流连接异常，请稍后重试。'
            : message,
        variant: 'destructive',
      })
    } finally {
      if (!searchTriggered && !streamStartedRef.current) {
        setIsLoading(false)
      }
    }
  }

  // Sync handleSearch ref for auto-retry access from stream error handler
  handleSearchRef.current = handleSearch

  // Debounce search trigger: prevent rapid re-submissions within 300ms
  const debouncedHandleSearch = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null
      void handleSearch()
    }, 300)
  }, [handleSearch])

  return {
    // State
    isLoading,
    hasSearched,
    searchKeyword,
    setSearchKeyword,
    searchCountry,
    setSearchCountry,
    searchCity,
    setSearchCity,
    emptyStateMessage,
    searchErrorMessage,
    showRetryHint,
    isStreaming,
    streamTotal,
    analyzedCount,
    streamStageMessage,
    streamStage,
    trialExpired,
    aiScoringSkipped,
    anySearchDegradeHint,
    showLlmKeyReminder,
    hasLlmKey,

    // Pagination & filters
    currentPage,
    autoSortEnabled,
    setAutoSortEnabled,
    officialOnlyEnabled,
    setOfficialOnlyEnabled,
    localDomainOnlyEnabled,
    setLocalDomainOnlyEnabled,
    highRelevanceOnlyEnabled,
    setHighRelevanceOnlyEnabled,
    b2bRoleOnlyEnabled,
    setB2bRoleOnlyEnabled,

    // Derived
    searchResults,
    displayedResults,
    pagedResults,
    totalPages,

    // Actions
    handleSearch,
    debouncedHandleSearch,
    goToSearchPage,
  }
}
