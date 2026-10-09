'use client'

import { formatSearchErrorMessage } from '@/lib/error-message'
import { useState, useRef, useEffect, useCallback } from 'react'
import { AlertCircle, AlertTriangle, BookMarked, Radar, FolderOpen, Link2, Activity, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { stableHash } from '@/lib/utils'
import { mapSearchResultToLeadItem } from '@/lib/lead-mappers'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SearchInput } from '@/components/search/search-input'
import { LocationInputs } from '@/components/search/location-inputs'
import { SearchProgress } from '@/components/search/search-progress'
import { SearchResultCard } from '@/components/search/search-result-card'
import { SearchPagination } from '@/components/search/search-pagination'
import { DeepAnalysis } from '@/components/search/deep-analysis'
import { useLeadsStore, LeadSearchResult, getLeadUniqueKey } from '@/store/leads-store'
import { useAutopilotStore } from '@/store/autopilot-store'
import { autopilotSyncLifecycle, onAutopilotAction, searchExecute } from '@/lib/electron-api'
import { useFeatureGate } from '@/lib/feature-gate'
import { useSearchEngine } from '@/hooks/use-search-engine'
import { useRecentSearches } from '@/hooks/use-recent-searches'

type AnalysisResult = {
  url: string
  title: string
  description: string
  matchScore?: number | null
  industryTags: string[]
}

type UserRole = 'trial' | 'pro' | 'enterprise'

type SearchDataSource =
  | 'google_maps'
  | 'google_organic'
  | 'customs_shipment'
  | 'trade_show'
  | 'yellow_pages'
  | 'linkedin_search'
  | 'facebook_search'

interface SearchEngineProps {
  userRole?: UserRole | null
}

const OMNI_SEARCH_RESULT_LIMIT = 50
const OMNI_SEARCH_MODE_LABEL = 'AI 全渠道盲搜'

const CSV_IMPORT_MAX_BYTES = 2 * 1024 * 1024
const CSV_IMPORT_MAX_LINES = 5_000

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

const buildSearchKeyword = (keyword: string, _dataSource: SearchDataSource) => {
  const normalizedKeyword = keyword
    .trim()
    .replace(/\bsite:linkedin\.com\/company\b/gi, '')
    .replace(/\bsite:facebook\.com\/pages\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return normalizedKeyword || keyword.trim()
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
      const segments = normalizedLine
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
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
  const { toast } = useToast()
  const engine = useSearchEngine()
  const { recentSearches, addSearch, clearRecent } = useRecentSearches()

  // Destructure search state from hook
  const {
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
    searchResults,
    displayedResults,
    pagedResults,
    totalPages,
    handleSearch,
    debouncedHandleSearch,
    goToSearchPage,
  } = engine

  // UI-only state (stays in component, not search-related)
  const [analyzingUrl, setAnalyzingUrl] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [savingLeadId, setSavingLeadId] = useState<number | null>(null)
  const [savedLeadIds, setSavedLeadIds] = useState<Set<number>>(new Set())
  const [isStartingAutopilot, setIsStartingAutopilot] = useState(false)
  const csvFileInputRef = useRef<HTMLInputElement | null>(null)

  // Autopilot store subscriptions
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

  // Feature gate (for searchLimit needed by handleAnalyzeUrl)
  const featureGate = useFeatureGate()
  const searchLimit = featureGate.getSearchLimit()

  // Search data source (used by handleStartAutopilot)
  const [searchDataSource] = useState<SearchDataSource>('google_maps')

  // Leads store (for save functionality)
  const { addLead, leads } = useLeadsStore()

  // Autopilot derived values
  const autopilotBusy = autopilotRuntime.lifecycle === 'running' || autopilotRuntime.lifecycle === 'paused'
  const autopilotStartDisabled =
    isStartingAutopilot ||
    autopilotRuntime.lifecycle === 'running' ||
    (!autopilotRawText.trim() && autopilotRuntime.lifecycle !== 'paused')
  const autopilotCompletedOrFailed = autopilotRuntime.completedJobs + autopilotRuntime.failedJobs
  const autopilotCurrentJob = autopilotJobs.find((job) => job.id === autopilotRuntime.currentJobId)
  const autopilotProgressLabel =
    autopilotStateKind === 'ready_empty'
      ? '暂无待执行任务'
      : autopilotStateKind === 'hydrating'
        ? '正在读取巡航状态...'
        : autopilotStateKind === 'state_unavailable'
          ? '巡航状态暂不可用'
          : `${autopilotCompletedOrFailed} / ${autopilotRuntime.totalJobs}`
  const autopilotCurrentJobLabel = autopilotCurrentJob
    ? `${autopilotCurrentJob.country} | ${autopilotCurrentJob.keyword}`
    : autopilotStateKind === 'paused'
      ? '巡航已暂停，等待继续执行'
      : autopilotStateKind === 'cooldown'
        ? '巡航正在冷却，等待自动继续'
        : autopilotStateKind === 'state_unavailable'
          ? '主进程巡航状态不可用'
          : '暂无执行中的任务'
  const currentDataSourceLabel = OMNI_SEARCH_MODE_LABEL
  const shouldShowAutopilotFilterHint =
    (autopilotCurrentJob?.qualifiedCount || 0) === 0 || (autopilotCurrentJob?.savedCount || 0) === 0

  const handleNavigateLeads = () => {
    window.dispatchEvent(new Event('kone:navigate-leads'))
  }

  // Sync savedLeadIds with leads store
  useEffect(() => {
    setSavedLeadIds(new Set(leads.map((item) => item.id)))
  }, [leads])

  // Autopilot effects
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

  const handleSaveLead = useCallback(
    async (lead: LeadSearchResult) => {
      const leadKey = getLeadUniqueKey({ company: lead.company, website: lead.website || '' })
      const hasExistingLead = useLeadsStore.getState().leads.some((item) => getLeadUniqueKey(item) === leadKey)

      if (savedLeadIds.has(lead.id) || hasExistingLead) {
        toast({
          title: '已保存',
          description: '该线索已在库中，无需重复保存',
          variant: 'default',
          className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
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
          title: '已保存',
          description: '该线索已在库中，无需重复保存',
          variant: 'default',
          className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
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
          country: lead.country || 'Global',
          countryCode: lead.countryCode || 'GL',
          industry: lead.industry,
        })
        await addLead(mapped)
        toast({
          title: '已保存线索',
          description: `已写入 ${lead.company}`,
          variant: 'default',
          className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
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
          title: '保存失败',
          description: formatSearchErrorMessage(error, '线索保存失败'),
          variant: 'destructive',
        })
      } finally {
        setSavingLeadId(null)
      }
    },
    [toast, savedLeadIds, savingLeadId, setSavedLeadIds, setSavingLeadId, addLead],
  )

  const handleCloudSendHint = useCallback(() => {
    toast({
      title: '请先保存线索',
      description: '云端发送队列属于高级版能力，请先将线索保存至本地线索库后在推荐线索区或智能触达工作流中提交。',
      variant: 'default',
      className: 'bg-blue-50 border-blue-200 text-blue-800',
    })
  }, [toast])

  const handleAnalyzeUrl = async () => {
    if (!searchLimit.allowDeepAnalysis) {
      toast({
        title: '深度分析已锁定',
        description: '当前授权不支持网页深度分析。',
        variant: 'destructive',
      })
      return
    }

    if (!analyzingUrl.trim()) {
      toast({
        title: '请输入目标网址',
        description: '请输入要分析的 company 官网 URL',
        variant: 'destructive',
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

      const summaryReason = response?.results?.[0]?.matchReasons?.[0] || response?.results?.[0]?.riskFlags?.[0] || ''
      const score = typeof response?.results?.[0]?.matchScore === 'number' ? response.results[0].matchScore : undefined

      setAnalysisResult({
        url,
        title: 'AI 已完成网站分析',
        description: summaryReason || '分析完成，暂无更多描述',
        matchScore: score,
        industryTags: ['B2B'],
      })

      toast({
        title: '分析完成',
        description: `ICP 综合评估: ${typeof score === 'number' ? `${score}%` : '待评估'}`,
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
    } catch (error) {
      toast({
        title: '分析失败',
        description: formatSearchErrorMessage(error, '无法分析该网页'),
        variant: 'destructive',
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
      const hasRunnableJobs = preparedJobs.length > 0 || autopilotJobs.some((job) => job.status === 'pending')
      if (!hasRunnableJobs) {
        toast({
          title: '未识别到有效巡航任务',
          description: '请使用逗号、竖线或空格分隔，例如：Poland, lithium battery, 30。',
          variant: 'destructive',
        })
        return
      }

      await startAutopilot()
      await setAutopilotDraftText('')
      toast({
        title: '后台巡航已启动',
        description: '系统将以低干扰方式串行执行静默获客任务。',
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
    } catch (error) {
      toast({
        title: '巡航启动失败',
        description: formatSearchErrorMessage(error, '后台巡航启动异常'),
        variant: 'destructive',
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
      title: '后台巡航已请求暂停',
      description: '当前任务将在安全检查点后暂停。',
      variant: 'default',
      className: 'bg-amber-50 border-amber-200 text-amber-800',
    })
  }

  const handleStopAutopilot = async () => {
    await stopAndClearAutopilot()
    toast({
      title: '后台巡航已停止',
      description: '任务队列已清空，可重新配置后再次启动。',
      variant: 'default',
      className: 'bg-slate-100 border-slate-200 text-slate-800',
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
        <SearchInput
          value={searchKeyword}
          onChange={setSearchKeyword}
          onSearch={() => {
            addSearch(searchKeyword, searchCountry, searchCity)
            debouncedHandleSearch()
          }}
        />

        <Accordion type="single" collapsible className="w-full rounded-xl border border-border bg-card p-5 shadow-sm">
          <AccordionItem value="b2b-search-syntax" className="border-none">
            <AccordionTrigger className="py-0 text-sm font-semibold text-slate-900 hover:no-underline">
              <span className="flex items-center gap-1.5">
                <BookMarked className="size-4 text-slate-400" />
                高质量 B2B 搜索语法与模板
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-0 pt-4">
              <p className="text-xs leading-relaxed text-slate-500">
                提示：加入 distributor / importer / OEM / integrator 等角色词，可显著提升 B2B 客户质量。
              </p>
              <div className="mt-4 grid w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    title: '渠道定位',
                    syntax: '"{产品词}" distributor {国家}',
                    desc: '精确锁定渠道商与分销商',
                  },
                  {
                    title: '本土企业筛选',
                    syntax: 'site:.{国家域名} "{产品词}" importer',
                    desc: '限定国家本土进口企业',
                  },
                  {
                    title: '官网合作页',
                    syntax: 'intitle:partner "{产品词}"',
                    desc: '优先命中官网合作与招募页面',
                  },
                  {
                    title: '制造能力排查',
                    syntax: '"{产品词}" OEM manufacturer -job -news',
                    desc: '排除招聘页与资讯页干扰',
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
                    <p className="mt-3 text-xs leading-relaxed text-slate-500 whitespace-normal">{item.desc}</p>
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* 第二行：目标地区和城市并排 */}
        <LocationInputs
          country={searchCountry}
          city={searchCity}
          onCountryChange={setSearchCountry}
          onCityChange={setSearchCity}
        />

        {/* 第四行：操作按钮 */}
        <div className="space-y-2">
          {showLlmKeyReminder ? (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle className="size-4" />
              <AlertDescription>检测到未配置 AI 评分密钥，ICP 打分将显示为基础状态。</AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="h-12 w-full rounded-lg bg-blue-600 font-medium text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-70 hover:bg-blue-700"
            data-testid="btn-search-execute"
            disabled={isLoading || autopilotBusy}
            isLoading={isLoading}
            onClick={handleSearch}
          >
            {!isLoading ? <Globe className="size-4" /> : null}
            {isLoading ? 'AI 正在全球检索中...' : '立即开始 AI 获客'}
          </Button>
        </div>

        <Accordion type="single" collapsible className="rounded-2xl border border-slate-200 bg-slate-50 px-4 shadow-sm">
          <AccordionItem value="autopilot-console" className="border-none">
            <AccordionTrigger className="py-4 text-sm font-semibold text-slate-900 hover:no-underline">
              <span className="flex items-center gap-1.5">
                <Radar className="size-4 text-slate-400" />
                伴随式后台巡航
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">批量任务输入</label>
                    <p className="text-xs text-muted-foreground">
                      当前任务将通过 [{currentDataSourceLabel}] 进行透视搜索。
                    </p>
                    <Textarea
                      value={autopilotRawText}
                      onChange={(event) => {
                        void setAutopilotDraftText(event.target.value)
                      }}
                      placeholder={
                        '国家, 关键词, 数量\n例如: Poland, lithium battery, 30\nGermany, energy storage distributor, 20'
                      }
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
                    <p className="text-[11px] leading-5 text-slate-500">
                      支持使用逗号、竖线或空格分隔。例如：Poland, lithium battery, 30
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleImportCsvClick}
                      disabled={autopilotRuntime.lifecycle === 'running'}
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      <FolderOpen className="size-4" />
                      导入 CSV
                    </Button>
                    <Button
                      onClick={handleStartAutopilot}
                      disabled={autopilotStartDisabled}
                      isLoading={isStartingAutopilot}
                      className="bg-blue-600 text-white hover:bg-blue-700"
                    >
                      {isStartingAutopilot
                        ? '启动中...'
                        : autopilotRuntime.lifecycle === 'running'
                          ? '巡航运行中'
                          : '启动巡航'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handlePauseAutopilot}
                      disabled={autopilotRuntime.lifecycle !== 'running'}
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
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${autopilotRuntime.lifecycle === 'running' ? 'bg-emerald-50 text-emerald-700' : autopilotRuntime.lifecycle === 'paused' ? 'bg-amber-50 text-amber-700' : autopilotRuntime.lifecycle === 'error' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}
                    >
                      {autopilotRuntime.lifecycle === 'running'
                        ? '运行中'
                        : autopilotRuntime.lifecycle === 'paused'
                          ? '已暂停'
                          : autopilotRuntime.lifecycle === 'completed'
                            ? '已完成'
                            : autopilotRuntime.lifecycle === 'error'
                              ? '异常中断'
                              : '待命'}
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
                        <Link2 className="mr-1 inline size-3.5 -translate-y-px" />
                        前往线索管理查看
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="text-[11px] text-slate-500">当前任务</div>
                    <div className="mt-1 text-sm font-medium text-slate-800">{autopilotCurrentJobLabel}</div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                      <span>发现 {autopilotCurrentJob?.discoveredCount || 0}</span>
                      <span className="inline-flex items-center gap-1">
                        命中 {autopilotCurrentJob?.qualifiedCount || 0}
                        {(autopilotCurrentJob?.qualifiedCount || 0) === 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600"
                              >
                                i
                              </button>
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
                              <button
                                type="button"
                                className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600"
                              >
                                i
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[260px]">
                              注：系统已自动为您过滤低评分线索，仅保留优质 B2B 客户。
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </span>
                    </div>
                    {shouldShowAutopilotFilterHint ? (
                      <div className="mt-2 text-[11px] text-slate-400">
                        系统正在优先保留高质量 B2B 线索，低评分结果不会进入线索库。
                      </div>
                    ) : null}
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
                <div className="text-xs text-slate-500">
                  当前结果 {Math.min(displayedResults.length, OMNI_SEARCH_RESULT_LIMIT)} 条
                </div>
              )}
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <Activity className="size-3.5 text-emerald-500" />
                数据源: 实时全网商业搜索
              </div>
            </div>
          </div>
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-800">高级质量控制</div>
                <div className="text-xs text-slate-500">面向 B2B 商用场景，优先保留更像真实采购客户的线索。</div>
              </div>
              <div className="text-xs text-slate-500">
                当前展示 {Math.min(displayedResults.length, OMNI_SEARCH_RESULT_LIMIT)} /{' '}
                {Math.min(searchResults.length, OMNI_SEARCH_RESULT_LIMIT)}
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={officialOnlyEnabled}
                  onChange={(e) => setOfficialOnlyEnabled(e.target.checked)}
                  className="mt-0.5 size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
                />
                <span>
                  <span className="font-medium text-slate-900">优先官网</span>
                  <br />
                  降低目录站、社媒页与信息聚合页干扰
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={localDomainOnlyEnabled}
                  onChange={(e) => setLocalDomainOnlyEnabled(e.target.checked)}
                  className="mt-0.5 size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
                />
                <span>
                  <span className="font-medium text-slate-900">优先本土域名</span>
                  <br />
                  尽量保留与目标国家更匹配的本地官网
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={highRelevanceOnlyEnabled}
                  onChange={(e) => setHighRelevanceOnlyEnabled(e.target.checked)}
                  className="mt-0.5 size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
                />
                <span>
                  <span className="font-medium text-slate-900">只看高相关</span>
                  <br />
                  仅展示 ICP 综合评估 60 分及以上的线索
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={b2bRoleOnlyEnabled}
                  onChange={(e) => setB2bRoleOnlyEnabled(e.target.checked)}
                  className="mt-0.5 size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
                />
                <span>
                  <span className="font-medium text-slate-900">优先 B2B 角色词</span>
                  <br />
                  更关注 distributor / importer / OEM / integrator 信号
                </span>
              </label>
            </div>
          </div>
          <SearchProgress
            isStreaming={isStreaming}
            streamStageMessage={streamStageMessage}
            streamStage={streamStage}
            analyzedCount={analyzedCount}
            streamTotal={streamTotal}
            anySearchDegradeHint={anySearchDegradeHint}
          />
          {searchErrorMessage ? (
            <div className="border-b border-red-100 bg-red-50/80 px-5 py-4">
              <Alert variant="destructive" className="border-red-200 bg-white/70">
                <AlertCircle className="size-4" />
                <AlertTitle>{searchResults.length > 0 ? '本次搜索出现网络异常' : '当前搜索服务暂不可用'}</AlertTitle>
                <AlertDescription>
                  <div>{searchErrorMessage}</div>
                  {showRetryHint ? (
                    <div className="text-xs text-red-700/80">
                      建议稍后重试；如问题持续，可能是冷启动、网络波动或代理限流导致。
                    </div>
                  ) : null}
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          {isLoading && searchResults.length === 0 ? (
            <div className="p-6">
              <div className="mb-4 text-sm font-medium text-slate-700">
                {isStreaming
                  ? `正在并发分析 ${Math.min(streamTotal || 0, OMNI_SEARCH_RESULT_LIMIT)} 条线索...`
                  : '正在搜索...'}
              </div>
              <div className="space-y-3">
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
              </div>
            </div>
          ) : !hasSearched ? (
            <div className="p-6 text-center text-sm text-slate-500">
              <div className="mx-auto max-w-xl">
                <div className="text-base font-medium text-slate-800">欢迎使用 Kone AI 智能获客工作台</div>
                <div className="mt-1.5 text-xs text-slate-500">
                  输入目标客户搜索词，系统将优先识别更接近 B2B 渠道、采购与合作角色的商业线索。
                </div>
                <div className="mt-2 text-[11px] text-slate-400">
                  示例：&quot;energy storage distributor&quot; germany / intitle:partner solar
                </div>
              </div>

              {recentSearches.length > 0 ? (
                <div className="mx-auto mt-6 max-w-xl">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-500">最近搜索</span>
                    <button
                      type="button"
                      onClick={clearRecent}
                      className="text-[10px] text-slate-400 hover:text-slate-600"
                    >
                      清除
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map((s, i) => (
                      <button
                        key={`${s.keyword}-${s.country}-${s.city}-${i}`}
                        type="button"
                        onClick={() => {
                          setSearchKeyword(s.keyword)
                          setSearchCountry(s.country)
                          setSearchCity(s.city)
                          addSearch(s.keyword, s.country, s.city)
                          debouncedHandleSearch()
                        }}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                      >
                        {[s.keyword, s.country, s.city].filter(Boolean).join(' · ')}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mx-auto mt-6 max-w-xl">
                <div className="mb-2 text-left text-[11px] font-medium text-slate-500">快速开始</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {[
                    {
                      label: 'Solar Distributor',
                      keyword: 'solar energy distributor',
                      country: 'Germany',
                      city: '',
                      desc: '德国太阳能分销商',
                    },
                    {
                      label: 'Medical Supplier',
                      keyword: 'medical device supplier',
                      country: 'Vietnam',
                      city: '',
                      desc: '越南医疗设备供应商',
                    },
                    {
                      label: 'Auto Parts Buyer',
                      keyword: 'auto parts importer',
                      country: 'UAE',
                      city: 'Dubai',
                      desc: '迪拜汽车零部件采购商',
                    },
                    {
                      label: 'Textile Manufacturer',
                      keyword: 'textile manufacturer',
                      country: 'Bangladesh',
                      city: 'Dhaka',
                      desc: '孟加拉纺织品制造商',
                    },
                  ].map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => {
                        setSearchKeyword(t.keyword)
                        setSearchCountry(t.country)
                        setSearchCity(t.city)
                        addSearch(t.keyword, t.country, t.city)
                        debouncedHandleSearch()
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/50"
                    >
                      <div className="text-[12px] font-medium text-slate-800">{t.label}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">{t.desc}</div>
                      <div className="mt-1 text-[10px] text-blue-500/70">
                        {t.keyword}
                        {t.country ? ` · ${t.country}` : ''}
                        {t.city ? ` · ${t.city}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : trialExpired ? (
            <div className="p-8">
              <div className="mx-auto flex max-w-2xl flex-col items-center rounded-2xl border border-amber-200 bg-white px-6 py-8 text-center shadow-sm">
                <div className="flex items-center justify-center gap-2 text-lg font-semibold text-amber-900">
                  <AlertTriangle className="size-5" />
                  当前授权已失效
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  请前往激活中心完成授权后，继续使用智能获客与高级分析功能。
                </p>
              </div>
            </div>
          ) : searchErrorMessage && searchResults.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              <div className="font-medium text-red-600">当前搜索服务暂不可用</div>
              <div className="mt-2">{searchErrorMessage}</div>
              {showRetryHint ? (
                <div className="mt-2 text-[11px] text-slate-400">
                  建议稍后重试；如问题持续，请联系专属顾问协助排查。
                </div>
              ) : null}
            </div>
          ) : displayedResults.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {searchResults.length > 0 ? (
                <>
                  <div>当前质量筛选已隐藏全部结果，请关闭优先官网/高相关筛选后查看。</div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    原始结果 {Math.min(searchResults.length, OMNI_SEARCH_RESULT_LIMIT)} 条，当前展示 0 条
                  </div>
                </>
              ) : (
                <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm">
                  <div className="text-lg font-semibold text-slate-800">未找到符合条件的企业</div>
                  <div className="mt-3 text-sm leading-6 text-slate-500">
                    {emptyStateMessage ||
                      '目标地区可能没有直接相关的企业。建议：1. 尝试更宽泛的行业关键词；2. 扩大搜索的国家/城市范围。'}
                  </div>
                  <div className="mt-3 text-[11px] text-slate-400">
                    当前筛选条件下找到 0 条线索 | 来源：实时全网商业搜索
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {pagedResults.map((lead, index) => {
                return (
                  <SearchResultCard
                    key={stableHash(`${lead.id}-${index}`)}
                    fallbackLead={lead}
                    leadKey={lead.leadKey}
                    index={index}
                    isStreaming={isStreaming}
                    aiScoringSkipped={aiScoringSkipped}
                    savingLeadId={savingLeadId}
                    savedLeadIds={savedLeadIds}
                    onSaveLead={handleSaveLead}
                    onCloudSendHint={handleCloudSendHint}
                  />
                )
              })}
            </div>
          )}
        </div>

        <SearchPagination currentPage={currentPage} totalPages={totalPages} onPageChange={goToSearchPage} />

        <DeepAnalysis
          allowDeepAnalysis={searchLimit.allowDeepAnalysis}
          analyzingUrl={analyzingUrl}
          isAnalyzing={isAnalyzing}
          analysisResult={analysisResult}
          onUrlChange={setAnalyzingUrl}
          onAnalyze={handleAnalyzeUrl}
        />

        {/* 提示文字 */}
        <p className="text-[10px] text-slate-400 text-center -mt-2">
          提示：组合使用关键词与特定城市，可获得更精准的 Google 搜索B2B商业线索。
        </p>
      </div>
    </div>
  )
}
