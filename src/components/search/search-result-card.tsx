'use client'

import { useState } from 'react'
import { Check, AlertTriangle, Radar, Mail, Loader2, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { analysisGenerate } from '@/lib/electron-api'
import { stableHash } from '@/lib/utils'
import type { LeadSearchResult } from '@/store/leads-store'

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

type SettlementMeta = {
  state: string
  showPending: boolean
  showFallback: boolean
  fallbackTone: 'blue' | 'amber'
  fallbackReason: string
}

interface SearchResultCardProps {
  lead: LeadSearchResult
  index: number
  settlementMeta: SettlementMeta
  savingLeadId: number | null
  savedLeadIds: Set<number>
  onSaveLead: (lead: LeadSearchResult) => void
  onCloudSendHint?: () => void
}

export function SearchResultCard({
  lead,
  index,
  settlementMeta,
  savingLeadId,
  savedLeadIds,
  onSaveLead,
  onCloudSendHint,
}: SearchResultCardProps) {
  const { toast } = useToast()
  const [generatingEmail, setGeneratingEmail] = useState(false)
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string } | null>(null)
  const [copied, setCopied] = useState(false)

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
            {lead.phone ? <span>{lead.phone}</span> : null}
            {'address' in lead && lead.address ? <span className="truncate max-w-[240px]">{lead.address}</span> : null}
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
}
