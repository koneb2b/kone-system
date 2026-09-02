'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles,
  Globe,
  MapPin,
  Copy,
  CheckCircle2,
  Target,
  ShieldAlert,
  Building2,
  MessageSquareQuote,
  Users,
  FileDown,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useLeadsStore } from '@/store/leads-store'
import type { LeadAnalysisCacheEntry, LeadItem } from '@/store/leads-store'
import { getDataSourceBadge, getDataSourceMeta } from '@/lib/data-source-meta'
import { analysisGenerate, ElectronApiError, exportPdfFile } from '@/lib/electron-api'
import { useFeatureGate } from '@/lib/feature-gate'

const formatErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback
  const semantic =
    error instanceof ElectronApiError
      ? (error.meta?.analysisSemantic as
          | { code?: string; mockMode?: boolean; settingsActionable?: boolean }
          | undefined)
      : undefined
  if (semantic?.mockMode) return '开发模式：未配置 AI 能力所需参数，已切换为本地模拟分析结果。'
  if (
    semantic?.code === 'missing_llm_key' ||
    semantic?.code === 'missing_llm_base_url' ||
    semantic?.code === 'missing_icp_profile' ||
    semantic?.settingsActionable
  ) {
    return SETTINGS_GUIDE_MESSAGE
  }
  if (semantic?.code === 'provider_timeout') return 'AI 数据流连接异常，请稍后重试。'
  if (semantic?.code === 'provider_unavailable') return '当前智能分析服务响应异常，请稍后重试。'
  if (semantic?.code === 'insufficient_lead_data') return '当前线索信息不足，请补充官网、简介或客户回信后再试。'
  if (semantic?.code === 'invalid_scenario') return '当前分析场景暂不可用，请稍后重试或联系顾问。'
  const normalized = message.toLowerCase()
  if (/403|401|授权|license|无权/.test(normalized)) return '当前授权状态异常，请联系顾问协助处理。'
  if (/network|timeout|fetch|socket|econn|enet|数据流/.test(normalized)) return 'AI 数据流连接异常，请稍后重试。'
  if (/config|base url|key|配置/.test(normalized)) return SETTINGS_GUIDE_MESSAGE
  return '当前智能分析服务暂不可用，请稍后重试或联系顾问。'
}

const SETTINGS_GUIDE_MESSAGE =
  '⚠️ 请先前往【系统设置】配置您的 AI 模型密钥与 ICP 目标画像，即可解锁深度分析与自动写信功能。'

const scenarioLabels = {
  direct_quote: '直接报价切入',
  competitor_switch: '竞品替代切入',
  factory_strength: '工厂实力展示',
} as const

type StrategyKey = keyof typeof scenarioLabels

type StructuredStrategy = {
  companyProfile: string
  painPoints: string
  valueMapping: string
  emailSubject: string
  emailBody: string
  confidence?: number
  rawContent?: string
  parseFallback?: boolean
  usedKnowledgeTitles?: string[]
  usedFallback?: boolean
  source?: string
}

type ReplyCoachingCache = {
  customerText: string
  negotiationRisk: string
  pricingAdvice: string
  replyTemplate: string
  nextAction: string
  timestamp: number
}

type AnalysisUiState = 'idle' | 'ready' | 'error'

interface AnalysisDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lead: LeadItem | null
  focusReplyCoachInputKey?: number
}

const getFallbackDimensionText = () => 'AI 分析中缺失该维度数据'
const SOCIAL_BLIND_SCORE_MESSAGE = '官网受保护，已使用 LinkedIn / 行业目录公开信息完成盲评'

export function AnalysisDrawer({ open, onOpenChange, lead, focusReplyCoachInputKey = 0 }: AnalysisDrawerProps) {
  const [copied, setCopied] = useState(false)
  const [replyCopied, setReplyCopied] = useState(false)
  const [activeStrategy, setActiveStrategy] = useState<StrategyKey>('direct_quote')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isReplyAnalyzing, setIsReplyAnalyzing] = useState(false)
  const [strategyData, setStrategyData] = useState<Record<string, StructuredStrategy>>({})
  const [replyInput, setReplyInput] = useState('')
  const [replyResult, setReplyResult] = useState<ReplyCoachingCache | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [analysisUiState, setAnalysisUiState] = useState<AnalysisUiState>('idle')
  const [analysisStatus, setAnalysisStatus] = useState('')
  const [pdfExporting, setPdfExporting] = useState(false)
  const replyInputRef = useRef<HTMLTextAreaElement | null>(null)
  const { toast } = useToast()
  const { updateLead } = useLeadsStore()
  const featureGate = useFeatureGate()
  const analysisLocked = featureGate.loading || !featureGate.canAccess('analysis_advanced')

  const handleNavigateSettings = () => {
    onOpenChange(false)
    window.dispatchEvent(new Event('kone:navigate-settings'))
  }

  const leadMeta = useMemo(() => {
    if (!lead) return null
    const country = lead.country || 'Global'
    const website = lead.website?.trim() || ''
    const normalizedWebsite = website && !website.startsWith('http') ? `https://${website}` : website
    const hasNumericScore = typeof lead.matchScore === 'number'
    const hasSocialBlindScore = lead.fallbackStatus === 'social_blind_score' && hasNumericScore
    const fallbackHints = [
      ...(Array.isArray(lead.matchReasons) ? lead.matchReasons : []),
      ...(Array.isArray(lead.riskFlags) ? lead.riskFlags : []),
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    const needsManualReview = !hasNumericScore && fallbackHints.length === 0
    return {
      company: lead.company,
      industry: lead.industry || '未知行业',
      contact: lead.contact || '',
      contactTitle: lead.contactTitle || '',
      country,
      countryCode: lead.countryCode || country.slice(0, 2).toUpperCase() || 'GL',
      website: normalizedWebsite,
      source: lead.source || 'Google Maps',
      matchScore: lead.matchScore,
      hasSocialBlindScore,
      needsManualReview,
      /* V1.3 多源融合字段 */
      dataSourceType: lead.dataSourceType,
      decisionMakers: lead.decisionMakers,
      customsData: lead.customsData,
      exhibitionFootprints: lead.exhibitionFootprints,
      agentStatus: lead.agentStatus,
    }
  }, [lead])

  useEffect(() => {
    if (!open || !lead) {
      setCopied(false)
      setReplyCopied(false)
      setGenerateError(null)
      setReplyError(null)
      setAnalysisUiState('idle')
      setAnalysisStatus('')
      setStrategyData({})
      setReplyInput('')
      setReplyResult(null)
      return
    }

    const nextStrategies: Record<string, StructuredStrategy> = {}
    const cache = lead.analysisCache || {}
    ;(['direct_quote', 'competitor_switch', 'factory_strength'] as StrategyKey[]).forEach((key) => {
      const cached = cache[key]
      if (!cached) return
      nextStrategies[key] = {
        companyProfile: cached.companyProfile || '',
        painPoints: cached.painPoints || '',
        valueMapping: cached.valueMapping || '',
        emailSubject: cached.emailSubject || '',
        emailBody: cached.emailBody || lead.generatedStrategies?.[key] || '',
        confidence: cached.confidence,
        rawContent: cached.rawContent,
        parseFallback: cached.parseFallback,
        usedKnowledgeTitles: cached.usedKnowledgeTitles || [],
        usedFallback: cached.usedFallback,
        source: cached.source,
      }
    })
    setStrategyData(nextStrategies)
    setAnalysisUiState(Object.keys(nextStrategies).length > 0 ? 'ready' : 'idle')

    const replyCache = cache.reply_coach?.replyCoaching
    setReplyResult(replyCache || null)
    setReplyInput(replyCache?.customerText || '')
    setCopied(false)
    setReplyCopied(false)
    setGenerateError(null)
    setReplyError(null)
    setAnalysisStatus('')
  }, [open, lead])

  const currentStructured = strategyData[activeStrategy] || null
  const replyCoachVisible = lead?.status === 'replied'

  useEffect(() => {
    if (!open || !replyCoachVisible || !focusReplyCoachInputKey) return
    const frame = window.requestAnimationFrame(() => {
      replyInputRef.current?.focus()
      replyInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusReplyCoachInputKey, open, replyCoachVisible])

  const persistLeadAnalysisCache = async (patch: Record<string, LeadAnalysisCacheEntry>) => {
    if (!lead?.id) return
    const existingCache = lead.analysisCache || {}
    await updateLead(lead.id, {
      analysisCache: {
        ...existingCache,
        ...patch,
      },
    })
  }

  const handleGenerate = async () => {
    if (analysisLocked) {
      toast({
        title: '高级 AI 分析未开通',
        description: '当前授权仅支持基础查看能力，请升级后解锁高价值转化策略。',
        variant: 'destructive',
      })
      return
    }

    if (!lead || isGenerating) return
    setIsGenerating(true)
    setGenerateError(null)

    try {
      const cached = lead.analysisCache?.[activeStrategy]
      if (cached?.emailBody) {
        setStrategyData((prev) => ({
          ...prev,
          [activeStrategy]: {
            companyProfile: cached.companyProfile || '',
            painPoints: cached.painPoints || '',
            valueMapping: cached.valueMapping || '',
            emailSubject: cached.emailSubject || '',
            emailBody: cached.emailBody || '',
            confidence: cached.confidence,
            rawContent: cached.rawContent,
            parseFallback: cached.parseFallback,
            usedKnowledgeTitles: cached.usedKnowledgeTitles || [],
            usedFallback: cached.usedFallback,
            source: cached.source,
          },
        }))
        setAnalysisUiState('ready')
        setAnalysisStatus(`已读取缓存报告 · ${scenarioLabels[activeStrategy]}`)
        return
      }

      const response = await analysisGenerate({
        lead: {
          company: lead.company,
          industry: lead.industry,
          country: lead.country,
          website: lead.website,
          address: lead.address,
          phone: lead.phone,
          contact: lead.contact,
          contactTitle: lead.contactTitle,
          snippet: lead.snippet,
          matchReasons: lead.matchReasons,
          riskFlags: lead.riskFlags,
          inferredRole: lead.inferredRole,
          source: lead.source,
          salesStrategy: lead.salesStrategy,
        },
        scenario: activeStrategy,
      })

      if (!response?.content) throw new Error('AI 分析失败')

      const semantic = response.semantic
      if (semantic?.mockMode) {
        setAnalysisStatus(`开发模式模拟分析 · ${scenarioLabels[activeStrategy]}`)
        toast({
          title: '已加载模拟分析',
          description: '当前为开发模式，本次结果来自本地模拟分析。',
          variant: 'default',
          className: 'bg-amber-50 border-amber-200 text-amber-900',
        })
      }

      const nextStructured: StructuredStrategy = {
        companyProfile: response.companyProfile || '',
        painPoints: response.painPoints || '',
        valueMapping: response.valueMapping || '',
        emailSubject: response.emailSubject || '',
        emailBody: response.emailBody || response.content || '',
        confidence: typeof response.confidence === 'number' ? response.confidence : undefined,
        rawContent: response.rawContent,
        parseFallback: response.parseFallback,
        usedKnowledgeTitles: response.usedKnowledgeTitles || [],
        usedFallback: response.usedFallback,
        source: response.source,
      }

      setStrategyData((prev) => ({ ...prev, [activeStrategy]: nextStructured }))
      setAnalysisUiState('ready')

      if (lead.id) {
        const existingStrategies = lead.generatedStrategies || {}
        await updateLead(lead.id, {
          generatedStrategies: {
            ...existingStrategies,
            [activeStrategy]: nextStructured.emailBody,
          },
        })
        await persistLeadAnalysisCache({
          [activeStrategy]: {
            companyProfile: nextStructured.companyProfile,
            painPoints: nextStructured.painPoints,
            valueMapping: nextStructured.valueMapping,
            emailSubject: nextStructured.emailSubject,
            emailBody: nextStructured.emailBody,
            confidence: nextStructured.confidence,
            rawContent: nextStructured.rawContent,
            parseFallback: nextStructured.parseFallback,
            usedKnowledgeTitles: nextStructured.usedKnowledgeTitles,
            usedFallback: nextStructured.usedFallback,
            source: nextStructured.source,
            updatedAt: new Date().toISOString(),
          },
        })
      }

      setAnalysisStatus((current) => current || `情报报告已更新 · ${scenarioLabels[activeStrategy]}`)
      if (!semantic?.mockMode) {
        toast({
          title: '情报报告已生成',
          description: `${scenarioLabels[activeStrategy]} 报告已缓存，后续可直接读取。`,
          variant: 'default',
          className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        })
      }
    } catch (error) {
      const message = formatErrorMessage(error, '策略生成失败')
      setAnalysisUiState(strategyData[activeStrategy] || Object.keys(strategyData).length > 0 ? 'ready' : 'error')
      setAnalysisStatus('')
      setGenerateError(message)
      toast({ title: '生成失败', description: message, variant: 'destructive' })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleReplyCoach = async (forceRefresh = false) => {
    if (analysisLocked) {
      toast({
        title: '高级 AI 分析未开通',
        description: '当前授权仅支持基础查看能力，请升级后解锁 AI 回信教练。',
        variant: 'destructive',
      })
      return
    }

    if (!lead || isReplyAnalyzing) return
    const customerText = replyInput.trim()
    if (!customerText) {
      setReplyError('请先粘贴客户的回信原文，再开始拆解。')
      return
    }

    const cached = lead.analysisCache?.reply_coach?.replyCoaching
    if (!forceRefresh && cached && cached.customerText.trim() === customerText) {
      setReplyResult(cached)
      setReplyError(null)
      toast({
        title: '已读取缓存',
        description: '该客户回信已分析过，已优先展示缓存结果。',
        variant: 'default',
        className: 'bg-blue-50 border-blue-200 text-blue-800',
      })
      return
    }

    setIsReplyAnalyzing(true)
    setReplyError(null)
    try {
      const response = await analysisGenerate({
        lead: {
          company: lead.company,
          industry: lead.industry,
          country: lead.country,
          website: lead.website,
          address: lead.address,
          phone: lead.phone,
          contact: lead.contact,
          contactTitle: lead.contactTitle,
          snippet: lead.snippet,
          matchReasons: lead.matchReasons,
          riskFlags: lead.riskFlags,
          inferredRole: lead.inferredRole,
          source: lead.source,
          salesStrategy: lead.salesStrategy,
          customerText,
        },
        scenario: 'reply_coach',
      })

      const nextReplyResult: ReplyCoachingCache = {
        customerText,
        negotiationRisk: response.negotiationRisk || response.analysis || '',
        pricingAdvice: response.pricingAdvice || response.suggestion || '',
        replyTemplate: response.replyTemplate || response.content || '',
        nextAction: response.nextAction || '继续推进',
        timestamp: Date.now(),
      }

      if (response.semantic?.mockMode) {
        toast({
          title: '已加载模拟拆解',
          description: '当前为开发模式，本次客户回信拆解来自本地模拟分析。',
          variant: 'default',
          className: 'bg-amber-50 border-amber-200 text-amber-900',
        })
      }

      setReplyResult(nextReplyResult)

      await persistLeadAnalysisCache({
        reply_coach: {
          replyCoaching: nextReplyResult,
          rawContent: response.rawContent,
          parseFallback: response.parseFallback,
          source: response.source,
          updatedAt: new Date(nextReplyResult.timestamp).toISOString(),
        },
      })

      if (!response.semantic?.mockMode) {
        toast({
          title: '回信拆解完成',
          description: 'AI 已输出客户真实意图与推荐回复策略。',
          variant: 'default',
          className: 'bg-indigo-50 border-indigo-200 text-indigo-900',
        })
      }
    } catch (error) {
      const message = formatErrorMessage(error, '回信拆解失败')
      setReplyError(message)
      toast({ title: '拆解失败', description: message, variant: 'destructive' })
    } finally {
      setIsReplyAnalyzing(false)
    }
  }

  const handleCopy = async () => {
    if (!currentStructured?.emailBody) return
    try {
      await navigator.clipboard.writeText(
        [
          currentStructured.emailSubject ? `Subject: ${currentStructured.emailSubject}` : '',
          currentStructured.emailBody,
        ]
          .filter(Boolean)
          .join('\n\n'),
      )
      const shouldMoveToContacting = Boolean(lead?.id && lead?.status === 'new')
      if (shouldMoveToContacting && lead?.id) {
        await updateLead(lead.id, { status: 'contacting', followUp: 'contacting', lastActivity: '已复制 AI 开发信' })
      }
      setCopied(true)
      toast({
        title: '已复制',
        description: shouldMoveToContacting ? '动作已识别，线索已自动移至‘联系中’阶段' : '开发信已复制到剪贴板',
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
      setTimeout(() => setCopied(false), 1200)
    } catch {
      toast({ title: '复制失败', description: '请手动复制内容', variant: 'destructive' })
    }
  }

  const handleCopyReplyField = async (value: string, successText: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setReplyCopied(true)
      toast({
        title: '已复制',
        description: successText,
        variant: 'default',
        className: 'bg-indigo-50 border-indigo-200 text-indigo-900',
      })
      setTimeout(() => setReplyCopied(false), 1200)
    } catch {
      toast({ title: '复制失败', description: '请手动复制内容', variant: 'destructive' })
    }
  }

  const handleExportPdf = async () => {
    if (!leadMeta || pdfExporting) return
    setPdfExporting(true)
    try {
      const strategies = Object.entries(strategyData).map(([key, data]) => ({
        scenario: scenarioLabels[key as StrategyKey] || key,
        subject: data.emailSubject || '',
        body: data.emailBody || '',
      }))
      const result = await exportPdfFile({
        company: leadMeta.company,
        website: leadMeta.website,
        country: leadMeta.country,
        customsData: leadMeta.customsData as any,
        exhibitionFootprints: leadMeta.exhibitionFootprints,
        decisionMakers: leadMeta.decisionMakers as any,
        strategies,
      })
      if (result.canceled) return
      toast({
        title: 'PDF 已保存',
        description: '客户白皮书已成功写入本地安全路径',
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
    } catch (error: any) {
      if (error?.canceled) return
      const message = error instanceof Error ? error.message : 'PDF 生成失败'
      toast({ title: 'PDF 导出失败', description: message, variant: 'destructive' })
    } finally {
      setPdfExporting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full bg-white sm:max-w-[680px]" data-testid="drawer-analysis">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base font-semibold text-slate-900">AI 深度分析</SheetTitle>
          {leadMeta && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPdf}
              disabled={pdfExporting}
              className="text-xs gap-1 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
            >
              {pdfExporting ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
              {pdfExporting ? '生成中...' : '下载白皮书 PDF'}
            </Button>
          )}
        </SheetHeader>

        {!lead || !leadMeta ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-500">暂无可分析的线索</div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{leadMeta.company}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {leadMeta.country}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {leadMeta.industry}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {leadMeta.source}
                    </Badge>
                    {typeof leadMeta.matchScore === 'number' ? (
                      <Badge variant="outline" className="text-xs">
                        ICP {leadMeta.matchScore}%
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-slate-400">
                        ICP 待评估
                      </Badge>
                    )}
                    {leadMeta.hasSocialBlindScore ? (
                      <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700">
                        {SOCIAL_BLIND_SCORE_MESSAGE}
                      </span>
                    ) : null}
                    {leadMeta.needsManualReview ? (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
                        待人工复核
                      </span>
                    ) : null}
                    {leadMeta.dataSourceType ? (
                      <span className={getDataSourceBadge(leadMeta.dataSourceType)}>
                        {getDataSourceMeta(leadMeta.dataSourceType).label || leadMeta.dataSourceType}
                      </span>
                    ) : null}
                    {leadMeta.decisionMakers && leadMeta.decisionMakers.length > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700">
                        <Users className="size-3" />
                        {leadMeta.decisionMakers.length} 位决策人
                        {/* P0-4 可信度降级：决策人数据来自实验性第三方采集，未经独立
                            验证（confidenceScore 缺省 0）时明确标注，防止过度采信 */}
                        {leadMeta.decisionMakers.every((dm) => !(Number((dm as any)?.confidenceScore) > 0)) ? (
                          <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            AI 推测，未验证
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    {leadMeta.customsData &&
                    (leadMeta.customsData.annualImportVolume || leadMeta.customsData.topSuppliers) ? (
                      <span
                        title="基于公开贸易数据网页的近似海关信息（非官方海关提单数据库直连），仅供参考"
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700"
                      >
                        📦 海关数据（参考）
                        {leadMeta.customsData.annualImportVolume ? ` ${leadMeta.customsData.annualImportVolume}` : ''}
                      </span>
                    ) : null}
                    {leadMeta.exhibitionFootprints && leadMeta.exhibitionFootprints.length > 0 ? (
                      <span
                        title="基于公开展会目录网页的近似展会足迹（非官方展会名录接口），仅供参考"
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700"
                      >
                        🏛️ {leadMeta.exhibitionFootprints.length} 个展会足迹（参考）
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>{lead.contact || '暂无联系人'}</div>
                  <div>{lead.contactTitle || lead.inferredRole || '待补充角色'}</div>
                </div>
              </div>
              {leadMeta.website ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <Globe className="size-3" />
                  <span className="truncate max-w-[420px]">{leadMeta.website}</span>
                </div>
              ) : null}
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">AI 挖掘结果</div>
                    <div className="text-xs text-slate-500">先看情报，再决定是否生成开发动作</div>
                  </div>
                  {analysisStatus ? <span className="text-[11px] text-slate-400">{analysisStatus}</span> : null}
                </div>
              </div>
              {analysisUiState === 'error' && generateError ? (
                <div className="p-4">
                  <ConfigErrorBanner message={generateError} onNavigateSettings={handleNavigateSettings} />
                </div>
              ) : analysisUiState === 'ready' ? (
                <div className="grid gap-3 p-4">
                  <IntelCard
                    icon={<Building2 className="size-4 text-[hsl(var(--deep-blue))]" />}
                    title="对方业务核心"
                    content={currentStructured?.companyProfile || getFallbackDimensionText()}
                  />
                  <IntelCard
                    icon={<ShieldAlert className="size-4 text-amber-500" />}
                    title="潜在痛点"
                    content={currentStructured?.painPoints || getFallbackDimensionText()}
                  />
                  <IntelCard
                    icon={<Target className="size-4 text-emerald-600" />}
                    title="价值映射"
                    content={currentStructured?.valueMapping || getFallbackDimensionText()}
                  />
                </div>
              ) : (
                <div className="p-4 text-sm text-slate-500">暂未生成该线索的 AI 画像，请点击下方按钮开始深度分析。</div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">转化动作</div>
                    <div className="text-xs text-slate-500">按需生成开发信，不重复浪费 Token</div>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleGenerate}
                    disabled={!lead || isGenerating || analysisLocked}
                    isLoading={isGenerating}
                    className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {!isGenerating ? <Sparkles className="size-3.5" /> : null}
                    {isGenerating
                      ? '生成中'
                      : analysisLocked
                        ? '高级分析已锁定'
                        : currentStructured?.emailBody
                          ? '刷新报告'
                          : '生成报告与开发信'}
                  </Button>
                </div>
              </div>

              {analysisLocked ? (
                <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  当前套餐仅提供基础查看能力，高级情报推理与定制开发信已锁定。升级后可调用高价值算力生成完整转化建议。
                </div>
              ) : null}

              <Tabs value={activeStrategy} onValueChange={(value) => setActiveStrategy(value as StrategyKey)}>
                <TabsList className="grid w-full grid-cols-3 rounded-none border-b border-slate-200">
                  <TabsTrigger value="direct_quote">直接报价</TabsTrigger>
                  <TabsTrigger value="competitor_switch">竞品替代</TabsTrigger>
                  <TabsTrigger value="factory_strength">工厂实力</TabsTrigger>
                </TabsList>
                {(['direct_quote', 'competitor_switch', 'factory_strength'] as StrategyKey[]).map((key) => (
                  <TabsContent key={key} value={key} className="p-4">
                    <StrategyReportPanel
                      data={strategyData[key]}
                      error={generateError}
                      isLoading={isGenerating && activeStrategy === key}
                      copied={copied}
                      onCopy={handleCopy}
                      onNavigateSettings={handleNavigateSettings}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </section>

            {replyCoachVisible ? (
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">AI 回信教练</div>
                      <div className="text-xs text-slate-500">针对客户真实回信，拆解意图并给出更精准的回复建议</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleReplyCoach(Boolean(replyResult))}
                      disabled={isReplyAnalyzing || analysisLocked}
                      isLoading={isReplyAnalyzing}
                      className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      {replyResult ? '重新分析' : '开始拆解回信'}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 p-4">
                  <div className="grid gap-2">
                    <div className="text-sm font-medium text-slate-800">客户原话解读</div>
                    <Textarea
                      ref={replyInputRef}
                      value={replyInput}
                      onChange={(event) => setReplyInput(event.target.value)}
                      placeholder="粘贴客户的回信原文..."
                      className="min-h-[120px] border-slate-200 bg-white text-sm text-slate-700 focus-visible:ring-blue-500/20"
                    />
                  </div>

                  {replyError ? (
                    <ConfigErrorBanner message={replyError} onNavigateSettings={handleNavigateSettings} />
                  ) : null}

                  <div className="grid gap-4 lg:grid-cols-2">
                    <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <MessageSquareQuote className="size-4 text-blue-600" />
                          意图与风险
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void handleCopyReplyField(replyResult?.negotiationRisk || '', '意图与风险已复制到剪贴板')
                          }
                          disabled={!replyResult?.negotiationRisk}
                          className="gap-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        >
                          {replyCopied ? (
                            <CheckCircle2 className="size-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          复制
                        </Button>
                      </div>
                      <div className="text-sm whitespace-pre-line leading-6 text-slate-700">
                        {replyResult?.negotiationRisk ||
                          '客户回信可能隐藏价格试探、拖延、比价或真实采购信号。粘贴原文后可获得更精确拆解。'}
                      </div>
                    </section>
                    <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Sparkles className="size-4 text-blue-600" />
                          博弈策略
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void handleCopyReplyField(replyResult?.pricingAdvice || '', '博弈策略已复制到剪贴板')
                          }
                          disabled={!replyResult?.pricingAdvice}
                          className="gap-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        >
                          {replyCopied ? (
                            <CheckCircle2 className="size-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          复制
                        </Button>
                      </div>
                      <div className="text-sm whitespace-pre-line leading-6 text-slate-700">
                        {replyResult?.pricingAdvice || '结合你之前的跟进建议，AI 将输出更有分寸的报价博弈与谈判策略。'}
                      </div>
                    </section>
                    <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 lg:col-span-2">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Target className="size-4 text-blue-600" />
                          推荐回信
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void handleCopyReplyField(replyResult?.replyTemplate || '', '推荐回信已复制到剪贴板')
                          }
                          disabled={!replyResult?.replyTemplate}
                          className="gap-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        >
                          {replyCopied ? (
                            <CheckCircle2 className="size-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          复制
                        </Button>
                      </div>
                      <div className="text-sm whitespace-pre-line leading-6 text-slate-700">
                        {replyResult?.replyTemplate || 'AI 将在这里生成一份可直接发送的专业英文回信模板。'}
                      </div>
                    </section>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function IntelCard({ icon, title, content }: { icon: React.ReactNode; title: string; content: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        {icon}
        {title}
      </div>
      <div className="whitespace-pre-line text-sm leading-6 text-slate-700">{content}</div>
    </div>
  )
}

function StrategyReportPanel({
  data,
  error,
  isLoading,
  onCopy,
  copied,
  onNavigateSettings,
}: {
  data?: StructuredStrategy
  error: string | null
  isLoading: boolean
  onCopy: () => void
  copied: boolean
  onNavigateSettings: () => void
}) {
  if (error) {
    return <ConfigErrorBanner message={error} onNavigateSettings={onNavigateSettings} />
  }

  if (isLoading) {
    return (
      <div className="min-h-[220px] rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 text-xs text-blue-700">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 animate-pulse" />
          AI 正在生成情报报告与写信动作...
        </div>
        <div className="mt-4 space-y-2 text-[13px] leading-6 text-blue-700/95">
          <div>1. 拆解企业画像与采购角色</div>
          <div>2. 映射知识库卖点与客户痛点</div>
          <div>3. 输出定制主题与开发信正文</div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        暂未生成该场景报告。请按需点击“生成报告与开发信”。
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Building2 className="size-4 text-[hsl(var(--deep-blue))]" />
          企业画像
        </div>
        <div className="whitespace-pre-line text-sm text-slate-700">
          {data.companyProfile || getFallbackDimensionText()}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ShieldAlert className="size-4 text-amber-500" />
          潜在痛点
        </div>
        <div className="whitespace-pre-line text-sm text-slate-700">
          {data.painPoints || getFallbackDimensionText()}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Target className="size-4 text-emerald-600" />
          价值映射
        </div>
        <div className="whitespace-pre-line text-sm text-slate-700">
          {data.valueMapping || getFallbackDimensionText()}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">开发信（按需动作）</div>
            <div className="mt-1 text-xs text-slate-500">
              {typeof data.confidence === 'number' ? `AI 分析置信度 ${data.confidence}%` : getFallbackDimensionText()}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onCopy} disabled={!data.emailBody} className="gap-2">
            {copied ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            {copied ? '已复制' : '复制开发信'}
          </Button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          Subject: {data.emailSubject || getFallbackDimensionText()}
        </div>
        <div className="mt-3 min-h-[180px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs whitespace-pre-line text-slate-700">
          {data.emailBody || getFallbackDimensionText()}
        </div>
      </section>
    </div>
  )
}

function ConfigErrorBanner({ message, onNavigateSettings }: { message: string; onNavigateSettings: () => void }) {
  const isSettingsGuidance = message === SETTINGS_GUIDE_MESSAGE

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
      <span>{message}</span>
      {isSettingsGuidance ? (
        <button
          type="button"
          onClick={onNavigateSettings}
          className="ml-1 font-medium text-red-700 underline underline-offset-2 hover:text-red-800"
        >
          系统设置
        </button>
      ) : null}
    </div>
  )
}
