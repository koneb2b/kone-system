'use client'

import { memo, useEffect, useState } from 'react'
import { Check, AlertTriangle, Radar, Mail, Loader2, Copy, X, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { analysisGenerate } from '@/lib/electron-api'
import { stableHash } from '@/lib/utils'
import { getLeadSettlementMeta } from '@/lib/lead-mappers'
// 注意：此处必须**值导入** useLeadsStore（不可用 import type）——
// 第 113 行的组件级 selector 订阅在运行时真实调用它，若仅保留类型导入，
// 编译期会被擦除，渲染该卡片时抛出 ReferenceError: useLeadsStore is not defined。
import { useLeadsStore, type LeadSearchResult } from '@/store/leads-store'
import { CONTACT_TIER_LABEL, type ContactTier } from '@/shared/contact-provenance'
/* S4c：用户反馈闭环（标「相关 / 不相关」→ 本地落库 → 下一轮排序据此调整） */
import { getLeadFeedbackVerdict, setLeadFeedbackVerdict } from '@/lib/lead-feedback-store'
import type { LeadFeedbackVerdict } from '@/shared/lead-feedback'

/**
 * 联系方式**来源 / 可信度徽标**（三档，2026-10-13 S2）。
 *
 * 产品原则：**明确区分「已验证 / 官网提取 / 推测」**，`source` 以 tooltip 展示（来源明细可见）。
 * 配色刻意区分信任度：`verified` 正向色、`extracted` 中性色、`inferred` **警示色**（不诱导信任）。
 * 缺失档位时**不渲染**（诚实：宁可不标，不可谎报 verified）。
 */
const renderTierBadge = (tier?: ContactTier, source?: string) => {
  if (!tier) return null
  const tone =
    tier === 'verified'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tier === 'inferred'
        ? 'border-amber-300 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-600'
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${tone}`}
      title={source ? `来源：${source}` : undefined}
    >
      {CONTACT_TIER_LABEL[tier]}
    </span>
  )
}

const INTERNAL_FALLBACK_MARKERS = new Set(['website_403', 'blind_score_failed'])

const DATA_SOURCE_LABELS: Record<string, string> = {
  google_maps: 'Google Maps',
  google_organic: 'Google 网页',
  linkedin_search: 'LinkedIn',
  customs_shipment: '海关数据',
  trade_show: '展会名录',
  facebook_search: 'Facebook',
  yellow_pages: '黄页',
  anysearch: 'AnySearch',
}

const DATA_SOURCE_COLORS: Record<string, string> = {
  google_maps: 'bg-green-50 text-green-700 border-green-200',
  google_organic: 'bg-blue-50 text-blue-700 border-blue-200',
  linkedin_search: 'bg-sky-50 text-sky-700 border-sky-200',
  customs_shipment: 'bg-orange-50 text-orange-700 border-orange-200',
  trade_show: 'bg-purple-50 text-purple-700 border-purple-200',
  facebook_search: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  yellow_pages: 'bg-amber-50 text-amber-700 border-amber-200',
  anysearch: 'bg-slate-100 text-slate-700 border-slate-200',
}

const stripInternalMarkers = (items?: string[]) =>
  Array.isArray(items) ? items.filter((item) => !INTERNAL_FALLBACK_MARKERS.has(String(item || '').trim())) : []

const normalizeWebsiteHref = (website?: string) => {
  const raw = String(website || '').trim()
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

const hasAnalysisResult = (analysisCache?: Record<string, unknown>) =>
  Boolean(
    analysisCache &&
    ['direct_quote', 'competitor_switch', 'factory_strength'].some((key) => {
      const entry = analysisCache[key]
      return Boolean(entry && typeof entry === 'object' && Object.keys(entry as Record<string, unknown>).length > 0)
    }),
  )

/* 国家 → 邮件语言（ISO 639-1）。非英文国家生成对应语言开发信；未知回退英文 */
const COUNTRY_LANG: Array<{ match: RegExp; lang: string }> = [
  { match: /germany|deutschland|austria|switzerland/i, lang: 'de' },
  { match: /france|belgium|canada/i, lang: 'fr' },
  { match: /spain|mexico|argentina|colombia|chile|peru/i, lang: 'es' },
  { match: /italy|italia/i, lang: 'it' },
  { match: /japan/i, lang: 'ja' },
  { match: /korea/i, lang: 'ko' },
  { match: /brazil|portugal/i, lang: 'pt' },
  { match: /russia/i, lang: 'ru' },
  { match: /netherlands|holland/i, lang: 'nl' },
  { match: /poland/i, lang: 'pl' },
  { match: /turkey/i, lang: 'tr' },
  { match: /vietnam/i, lang: 'vi' },
  { match: /thailand/i, lang: 'th' },
  { match: /indonesia/i, lang: 'id' },
  { match: /malaysia/i, lang: 'ms' },
  { match: /saudi|uae|united arab|egypt|qatar|kuwait/i, lang: 'ar' },
  { match: /sweden/i, lang: 'sv' },
  { match: /denmark/i, lang: 'da' },
  { match: /norway/i, lang: 'no' },
  { match: /finland/i, lang: 'fi' },
]

const inferCountryLanguage = (country?: string): string | undefined => {
  const raw = String(country || '').trim()
  if (!raw) return undefined
  const hit = COUNTRY_LANG.find(({ match }) => match.test(raw))
  return hit?.lang
}

interface SearchResultCardProps {
  fallbackLead: LeadSearchResult
  leadKey?: string
  index: number
  isStreaming: boolean
  aiScoringSkipped: boolean
  savingLeadId: number | null
  savedLeadIds: Set<number>
  onSaveLead: (lead: LeadSearchResult) => void
  onCloudSendHint?: () => void
}

export const SearchResultCard = memo(function SearchResultCard({
  fallbackLead,
  leadKey,
  index,
  isStreaming,
  aiScoringSkipped,
  savingLeadId,
  savedLeadIds,
  onSaveLead,
  onCloudSendHint,
}: SearchResultCardProps) {
  const { toast } = useToast()
  /* 组件级 selector 订阅（P1-3 续）：按 leadKey 订阅自身线索切片，
   * 流式评分增量更新时仅被更新的卡片重渲染；无 leadKey 或索引缺失时回退到父级传入的
   * fallbackLead，保证任何情况下卡片都有可渲染数据（不依赖订阅一定命中）。 */
  const liveLead = useLeadsStore((s) => (leadKey ? s.searchResultsByKey[leadKey] : undefined))
  const lead = liveLead ?? fallbackLead
  const settlementMeta = getLeadSettlementMeta(lead, { isStreaming, aiScoringSkipped })
  const [generatingEmail, setGeneratingEmail] = useState(false)
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string } | null>(null)
  const [copied, setCopied] = useState(false)
  /* S4c：该线索的用户反馈判定（null = 未标记）。 */
  const [feedbackVerdict, setFeedbackVerdict] = useState<LeadFeedbackVerdict | null>(null)
  useEffect(() => {
    let alive = true
    void getLeadFeedbackVerdict(lead).then((verdict) => {
      if (alive) setFeedbackVerdict(verdict)
    })
    return () => {
      alive = false
    }
  }, [lead])

  /** 切换反馈（再点一次即取消）。写入失败**明确提示**，绝不静默失败。 */
  const toggleFeedback = async (verdict: LeadFeedbackVerdict) => {
    const next = feedbackVerdict === verdict ? null : verdict
    const saved = await setLeadFeedbackVerdict(lead, next)
    if (next !== null && saved === null) {
      toast({ title: '反馈保存失败', description: '本地配置写入失败，请稍后重试。', variant: 'destructive' })
      return
    }
    setFeedbackVerdict(saved)
    toast({
      title: next === null ? '已取消标记' : next === 'relevant' ? '已标记为「相关」' : '已标记为「不相关」',
      description:
        next === null
          ? '该线索已恢复为未标记状态。'
          : next === 'relevant'
            ? '下一轮搜索会对该域名小幅加分。'
            : '下一轮搜索会将该域名封顶降权（仍可见、可复核）。',
    })
  }

  /* 针对性开发信一键生成（个性化输出）：基于该线索真实情报（角色/跟进建议/
     风险/官网/行业）调用 LLM 生成 subject + body，就地展示可复制。 */
  const handleGenerateEmail = async () => {
    if (generatingEmail) return
    setGeneratingEmail(true)
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
        },
        scenario: 'direct_quote',
        /* 小语种同步翻译：按线索国家推导官方语言，非英文客户生成对应语言开发信 */
        language: inferCountryLanguage(lead.country),
      })
      const subject = String(response?.emailSubject || '').trim()
      const body = String(response?.emailBody || response?.content || '').trim()
      if (!body) throw new Error('AI 生成失败')
      setEmailDraft({ subject, body })
    } catch (error) {
      toast({
        title: '生成开发信失败',
        description: error instanceof Error ? error.message : 'AI 生成失败',
        variant: 'destructive',
      })
    } finally {
      setGeneratingEmail(false)
    }
  }

  const handleCopyEmail = async () => {
    const text = `${emailDraft?.subject || ''}\n\n${emailDraft?.body || ''}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: '复制失败', description: '无法访问剪贴板，请手动复制', variant: 'destructive' })
    }
  }

  return (
    <div
      key={stableHash(`${lead.id}-${index}`)}
      className="flex flex-col gap-3 px-5 py-4 hover:bg-slate-50 transition-all"
    >
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
                className={`rounded-full px-2 py-0.5 ${lead.isB2B ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
              >
                {lead.isB2B ? 'B2B' : 'B2C'}
              </span>
            ) : null}
            {lead.dataSourceType ? (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${DATA_SOURCE_COLORS[lead.dataSourceType] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
              >
                {DATA_SOURCE_LABELS[lead.dataSourceType] || lead.dataSourceType}
              </span>
            ) : null}
            <span>{lead.country || 'Global'}</span>
            <span>
              {typeof lead.matchScore === 'number'
                ? `ICP 综合评估 ${lead.matchScore}%${lead.scoreSource === 'deterministic' ? '（规则）' : ''}`
                : settlementMeta.state === 'ai_skipped'
                  ? 'ICP 综合评估 未启用 AI 评分'
                  : settlementMeta.state === 'fallback'
                    ? 'ICP 综合评估 待人工复核'
                    : 'ICP 综合评估 待评估'}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-[11px] text-slate-400 underline decoration-dotted underline-offset-2 cursor-help"
                >
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
            {lead.phone ? (
              <span className="inline-flex items-center gap-1">
                {lead.phone}
                {renderTierBadge(lead.contactProvenance?.phone?.tier, lead.contactProvenance?.phone?.source)}
                {lead.phoneKind === 'mobile' ? (
                  <span
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"
                    title="已验证手机号，可直接用于 WhatsApp 触达"
                  >
                    WhatsApp 可触达
                  </span>
                ) : null}
              </span>
            ) : null}
            {/* 邮箱此前**完全不显示**（结果区零 email 引用）→ 用户看不到哪些线索有邮箱。
                现补上 mailto 直链 + **来源/可信度徽标**（点击不触发卡片选中，避免误触）。 */}
            {lead.email ? (
              <span className="inline-flex items-center gap-1">
                <a
                  href={`mailto:${lead.email}`}
                  className="truncate max-w-[220px] text-blue-600 hover:underline hover:text-blue-700"
                  onClick={(event) => event.stopPropagation()}
                >
                  {lead.email}
                </a>
                {renderTierBadge(lead.contactProvenance?.email?.tier, lead.contactProvenance?.email?.source)}
              </span>
            ) : null}
            {'address' in lead && lead.address ? <span className="truncate max-w-[240px]">{lead.address}</span> : null}
            {/* Step 2B / Step 5：**决策人身份**（姓名·职位·来源·公司关联依据）。
                用户必须能区分「只发现了公司」与「已识别出决策人」；未独立验证时明确标注，
                绝不把供应商匹配结果说成「已验证」。 */}
            {lead.decisionMakers && lead.decisionMakers.length > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700">
                    <UserRound className="size-2.5" />
                    决策人 {lead.decisionMakers.length}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[320px] text-xs">
                  {lead.decisionMakers.slice(0, 3).map((dm, index) => (
                    <div key={`${dm.name || 'dm'}-${index}`}>
                      {[dm.name, dm.title].filter(Boolean).join(' · ') || '（未提供姓名）'}
                      {dm.source ? ` — 来源：${dm.source}` : ''}
                      {dm.matchBasis ? `（${dm.matchBasis}）` : ''}
                    </div>
                  ))}
                  {lead.decisionMakers.every((dm) => !(Number(dm.confidenceScore) > 0)) ? (
                    <div className="mt-1 text-amber-600">以上为数据源匹配结果，尚未独立验证</div>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">未识别决策人</span>
            )}
            {/* Step 5：**本轮补全成本摘要** —— 未知计费如实标注，不伪造精确成本 */}
            {lead.enrichmentCost && lead.enrichmentCost.calls > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                    补全 {lead.enrichmentCost.calls} 次
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[300px] text-xs">
                  <div>调用次数：{lead.enrichmentCost.calls}</div>
                  <div>参与来源：{lead.enrichmentCost.providers.join('、') || '—'}</div>
                  {Object.keys(lead.enrichmentCost.byUnit).length > 0 ? (
                    <div>
                      可确认费用：
                      {Object.entries(lead.enrichmentCost.byUnit)
                        .map(([unit, amount]) => `${amount} ${unit}`)
                        .join('、')}
                    </div>
                  ) : null}
                  {lead.enrichmentCost.unknownCostCalls > 0 ? (
                    <div className="text-amber-600">
                      其中 {lead.enrichmentCost.unknownCostCalls} 次费用未知（未与账单核对，不估算）
                    </div>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {lead.dataSourceNote ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 cursor-help border border-amber-200">
                    <AlertTriangle className="size-2.5" />
                    数据来源说明
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[280px] text-xs">
                  {lead.dataSourceNote}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          {settlementMeta.showPending ? (
            <div className="mt-1 inline-flex items-center gap-2 text-xs text-blue-500">
              <div className="size-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              AI 正在分析该线索...
            </div>
          ) : null}
          {settlementMeta.showFallback ? (
            <div
              className={`mt-1 inline-flex items-center gap-2 text-xs ${settlementMeta.fallbackTone === 'blue' ? 'text-blue-700' : 'text-amber-500'}`}
            >
              {settlementMeta.fallbackTone === 'blue' ? (
                <Check className="size-3" />
              ) : (
                <AlertTriangle className="size-3" />
              )}
              {settlementMeta.fallbackReason}
            </div>
          ) : null}
          {stripInternalMarkers(lead.matchReasons).length > 0 && !settlementMeta.showFallback ? (
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-emerald-700">
              {stripInternalMarkers(lead.matchReasons)
                .slice(0, 2)
                .map((reason, reasonIndex) => (
                  <span
                    key={stableHash(`${lead.id}-reason-${reasonIndex}`)}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5"
                  >
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
              {stripInternalMarkers(lead.riskFlags)
                .slice(0, 1)
                .map((risk, riskIndex) => (
                  <span
                    key={stableHash(`${lead.id}-risk-${riskIndex}`)}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5"
                  >
                    <AlertTriangle className="size-3" />
                    {risk}
                  </span>
                ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {/* S4c 用户反馈闭环：标记后**本地落库**，下一轮搜索据此调整排序（越用越准、零成本）。
              刻意做成可撤销（再点一次取消），避免一次误点永久影响结果。 */}
          <div className="mr-auto flex items-center gap-1" data-testid="lead-feedback">
            <button
              type="button"
              aria-pressed={feedbackVerdict === 'relevant'}
              onClick={() => void toggleFeedback('relevant')}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                feedbackVerdict === 'relevant'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
              title="标记为相关：下一轮搜索会对该域名小幅加分"
            >
              相关
            </button>
            <button
              type="button"
              aria-pressed={feedbackVerdict === 'irrelevant'}
              onClick={() => void toggleFeedback('irrelevant')}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                feedbackVerdict === 'irrelevant'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
              title="标记为不相关：下一轮搜索会将该域名封顶降权（仍可见、可复核）"
            >
              不相关
            </button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs gap-1.5"
            onClick={handleGenerateEmail}
            disabled={generatingEmail}
            isLoading={generatingEmail}
            data-testid="btn-gen-email"
          >
            {!generatingEmail ? <Mail className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
            {generatingEmail ? '生成中...' : emailDraft ? '重新生成' : '生成开发信'}
          </Button>
          <Button
            size="sm"
            className="bg-blue-600 text-white hover:bg-blue-700 transition-all"
            data-testid="btn-save-lead"
            disabled={savingLeadId === lead.id || savedLeadIds.has(lead.id)}
            isLoading={savingLeadId === lead.id}
            onClick={() => onSaveLead(lead)}
          >
            {savedLeadIds.has(lead.id) || savingLeadId === lead.id ? '已保存' : '一键保存'}
          </Button>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => onCloudSendHint?.()}>
            保存后可云端触达
          </Button>
        </div>
      </div>
      {emailDraft ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-900">
              <Mail className="size-3.5" />
              针对性开发信
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1" onClick={handleCopyEmail}>
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? '已复制' : '复制'}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEmailDraft(null)}>
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="mt-2 text-xs font-medium text-slate-800">主题：{emailDraft.subject || '（无主题）'}</div>
          <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600 max-h-44 overflow-y-auto">
            {emailDraft.body}
          </div>
        </div>
      ) : null}
    </div>
  )
})
