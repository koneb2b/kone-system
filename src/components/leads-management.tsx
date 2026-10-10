'use client'

import { formatErrorMessage } from '@/lib/error-message'
import {
  buildLeadExportCsv,
  buildLeadExportHeaders,
  buildReachabilityChannel,
  DEFAULT_EXPORT_GROUPS,
  LEAD_EXPORT_GROUPS,
  type LeadExportGroupKey,
} from '@/lib/lead-export'
import { useEffect, useMemo, useState } from 'react'
import {
  Search,
  Download,
  Plus,
  Star,
  StarOff,
  MoreHorizontal,
  MapPin,
  Building2,
  ArrowUpDown,
  Eye,
  Trash2,
  Clock,
  Users,
  UserPlus,
  Target,
  TrendingUp,
  Radar,
  MessageSquare,
  ShieldCheck,
  Copy,
  CheckCircle2,
  Mail,
  PenLine,
  Reply,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { stableHash } from '@/lib/utils'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from '@/components/ui/pagination'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Checkbox } from '@/components/ui/checkbox'
import { AnalysisDrawer } from '@/components/analysis-drawer'
import { LeadItem, LeadStatus, useLeadsStore } from '@/store/leads-store'
import { analysisGenerate, ElectronApiError, saveExportFile } from '@/lib/electron-api'
import { useFeatureGate } from '@/lib/feature-gate'

type ReplyCoachAnalysis = {
  nextAction?: string
}

const getReplyCoachAnalysis = (lead: LeadItem): ReplyCoachAnalysis | null => {
  const entry = lead.analysisCache?.reply_coach?.replyCoaching
  return entry && typeof entry === 'object' ? (entry as ReplyCoachAnalysis) : null
}

const formatAnalysisActionError = (error: unknown, fallback: string) => {
  const semantic =
    error instanceof ElectronApiError
      ? (error.meta?.analysisSemantic as
          | { code?: string; mockMode?: boolean; settingsActionable?: boolean }
          | undefined)
      : undefined
  if (semantic?.mockMode) return '当前为开发模式，本次邮件草稿来自本地模拟分析。'
  if (
    semantic?.code === 'missing_llm_key' ||
    semantic?.code === 'missing_llm_base_url' ||
    semantic?.code === 'missing_icp_profile' ||
    semantic?.settingsActionable
  ) {
    return '请先前往【系统设置】配置您的 AI 模型密钥与 ICP 目标画像。'
  }
  if (semantic?.code === 'provider_timeout') return 'AI 数据流连接异常，请稍后重试。'
  if (semantic?.code === 'provider_unavailable') return '当前智能分析服务响应异常，请稍后重试。'
  if (semantic?.code === 'insufficient_lead_data') return '当前线索信息不足，暂时无法生成更高质量草稿。'
  return formatErrorMessage(error, fallback)
}

type UserRole = 'trial' | 'pro' | 'enterprise'

type EmailComposerDraft = {
  subject: string
  body: string
}

type ColdEmailLanguageOption = {
  value: string
  label: string
}

const CUSTOM_LANGUAGE_VALUE = 'custom'

const COLD_EMAIL_LANGUAGE_OPTIONS: ColdEmailLanguageOption[] = [
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Russian', label: 'Russian' },
  { value: 'Arabic', label: 'Arabic' },
  { value: CUSTOM_LANGUAGE_VALUE, label: '其他自定义...' },
]

const COUNTRY_LANGUAGE_HINTS: Array<{ match: RegExp; language: string; label: string }> = [
  { match: /germany|deutschland/i, language: 'German', label: '德语' },
  { match: /france/i, language: 'French', label: '法语' },
  { match: /spain|españa/i, language: 'Spanish', label: '西班牙语' },
  { match: /russia/i, language: 'Russian', label: '俄语' },
  {
    match: /saudi|uae|united arab emirates|egypt|morocco|algeria|qatar|kuwait|arab/i,
    language: 'Arabic',
    label: '阿拉伯语',
  },
  { match: /mexico|argentina|colombia|chile|peru/i, language: 'Spanish', label: '西班牙语' },
  { match: /canada/i, language: 'French', label: '法语' },
]

/* 语言显示名 → ISO 639-1 码（小语种翻译传给后端）。未识别语言回退 'en' */
const LANGUAGE_LABEL_TO_ISO: Record<string, string> = {
  English: 'en',
  Chinese: 'zh',
  简体中文: 'zh',
  German: 'de',
  德语: 'de',
  French: 'fr',
  法语: 'fr',
  Spanish: 'es',
  西班牙语: 'es',
  Italian: 'it',
  意大利语: 'it',
  Japanese: 'ja',
  日语: 'ja',
  Korean: 'ko',
  韩语: 'ko',
  Portuguese: 'pt',
  葡萄牙语: 'pt',
  Russian: 'ru',
  俄语: 'ru',
  Dutch: 'nl',
  荷兰语: 'nl',
  Polish: 'pl',
  波兰语: 'pl',
  Turkish: 'tr',
  土耳其语: 'tr',
  Vietnamese: 'vi',
  越南语: 'vi',
  Thai: 'th',
  泰语: 'th',
  Indonesian: 'id',
  印尼语: 'id',
  Malay: 'ms',
  马来语: 'ms',
  Arabic: 'ar',
  阿拉伯语: 'ar',
}

const languageLabelToIso = (label?: string): string | undefined => {
  const key = String(label || '').trim()
  if (!key) return undefined
  return LANGUAGE_LABEL_TO_ISO[key] || (key.length === 2 ? key.toLowerCase() : undefined)
}

const leadStatusConfig: Record<LeadStatus, { label: string; color: string; bgColor: string; borderColor: string }> = {
  new: { label: '待跟进', color: 'text-primary', bgColor: 'bg-primary/10', borderColor: 'border-slate-200' },
  contacting: { label: '联系中', color: 'text-blue-700', bgColor: 'bg-blue-100', borderColor: 'border-blue-200' },
  replied: { label: '已回复', color: 'text-emerald-700', bgColor: 'bg-emerald-100', borderColor: 'border-emerald-200' },
  archived: { label: '已归档', color: 'text-amber-700', bgColor: 'bg-amber-100', borderColor: 'border-amber-200' },
}

const leadStatusOrder: LeadStatus[] = ['new', 'contacting', 'replied', 'archived']
const LEADS_PAGE_SIZE = 50

const hasAnalysisResult = (analysisCache?: Record<string, unknown>) =>
  Boolean(
    analysisCache &&
    ['direct_quote', 'competitor_switch', 'factory_strength'].some((key) => {
      const entry = analysisCache[key]
      return Boolean(entry && typeof entry === 'object' && Object.keys(entry as Record<string, unknown>).length > 0)
    }),
  )

const emptyStats = [
  { label: '总线索数', value: 0, icon: Users, color: 'text-primary', bgColor: 'bg-primary/10' },
  { label: '本月新增', value: 0, icon: UserPlus, color: 'text-primary', bgColor: 'bg-primary/10' },
  { label: '跟进中', value: 0, icon: Target, color: 'text-primary', bgColor: 'bg-primary/10' },
  {
    label: '成交转化率',
    value: '0%',
    icon: TrendingUp,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
  },
]

function MatchBar({ score }: { score?: number | null }) {
  if (typeof score !== 'number') {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
        待评估
      </span>
    )
  }

  const color =
    score >= 90
      ? 'bg-[hsl(var(--brand-green))]'
      : score >= 80
        ? 'bg-emerald-400'
        : score >= 70
          ? 'bg-amber-400'
          : 'bg-slate-400'
  const textColor =
    score >= 90
      ? 'text-[hsl(var(--brand-green))]'
      : score >= 80
        ? 'text-emerald-500'
        : score >= 70
          ? 'text-amber-500'
          : 'text-slate-500'

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${textColor}`}>{score}%</span>
    </div>
  )
}

const getRecommendedLanguage = (lead: LeadItem | null) => {
  const country = String(lead?.country || lead?.countryCode || '').trim()
  if (!country) return null
  return COUNTRY_LANGUAGE_HINTS.find((item) => item.match.test(country)) || null
}

const getExternalEmailBody = (body: string) => {
  const normalized = String(body || '')
  const [foreignBody] = normalized.split(/\n?---\n?/)
  return foreignBody?.trim() || normalized.trim()
}

const buildColdEmailPrompt = (lead: LeadItem, targetLanguage: string) => {
  const normalizedTargetLanguage = String(targetLanguage || 'English').trim() || 'English'

  return [
    '你是一名资深 B2B 外贸销售，请为以下客户撰写一封简短、专业、定制化的 Cold Email。',
    '要求：',
    '1. 邮件必须短，不要冗长，不超过 180 英文单词。',
    '2. 语气专业、自然，避免模板化和夸张营销口吻。',
    '3. 必须结合客户公司、国家、行业、官网/摘要线索，体现定制化。',
    '4. 邮件目标是促成对方回复，而不是一次性讲完所有信息。',
    '5. 输出需包含吸引人的主题和可直接发送的正文。',
    '6. 如果信息不足，不要编造联系人姓名或具体采购事实。',
    `7. 第一步：请使用【${normalizedTargetLanguage}】撰写正式的邮件主题和正文。`,
    '8. 第二步：使用 `---` 作为分隔符。',
    '9. 第三步：在分隔符下方，提供这段邮件的【中文对照翻译】，帮助销售人员快速理解。',
    '10. 中文对照必须只出现在 Body 内，且位于分隔符下方。',
    '11. 你的输出必须严格遵守以下格式，不要添加任何解释、前言、备注或 markdown：',
    'Subject: [邮件标题]',
    'Body:',
    `[使用${normalizedTargetLanguage}撰写的邮件正文]`,
    '---',
    '[上述正文的中文对照翻译]',
    '12. Subject 必须使用目标语言，不要使用中文。',
    '13. Body 上半部分必须仅包含目标语言正文，下半部分必须仅包含中文对照。',
    '14. 禁止输出类似“好的，这是为您生成的邮件”之类的废话。',
    '客户信息：',
    `- Company: ${lead.company || 'Unknown'}`,
    `- Country: ${lead.country || lead.countryCode || 'Unknown'}`,
    `- Industry: ${lead.industry || 'Unknown'}`,
    `- Website: ${lead.website || 'Unknown'}`,
    `- Snippet: ${lead.snippet || 'N/A'}`,
    `- Suggested angle: ${lead.salesStrategy || 'Use a concise value-first introduction.'}`,
  ].join('\n')
}

const buildDefaultEmailSubject = (lead: LeadItem) => `Quick idea for ${lead.company}`

const buildFallbackColdEmail = (lead: LeadItem): EmailComposerDraft => {
  const company = lead.company || 'your team'
  const country = lead.country || lead.countryCode || 'your market'
  const industry = lead.industry || 'your category'
  const website = lead.website || 'your online business'
  const subject = buildDefaultEmailSubject(lead)
  const body = [
    `Hi ${company} team,`,
    '',
    `I came across ${website} and noticed your focus on ${industry} in ${country}.`,
    'We support B2B teams that need a responsive supplier with clearer communication, stable delivery, and faster commercial follow-up.',
    'If you are currently evaluating options, I would be glad to share one concise proposal based on a live requirement from your side.',
    '',
    'Best regards,',
    'Kone Team',
  ].join('\n')

  return { subject, body }
}

const parseGeneratedEmailDraft = (raw: string | undefined, lead: LeadItem): EmailComposerDraft => {
  const fallback = buildFallbackColdEmail(lead)
  const normalized = String(raw || '').trim()
  if (!normalized) return fallback

  const cleaned = normalized
    .replace(/^```(?:text|markdown|md)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  const structuredMatch = cleaned.match(/subject\s*:\s*([\s\S]*?)(?:\n+|\r\n+)?body\s*:\s*([\s\S]*)/i)
  if (structuredMatch) {
    const parsedSubject = structuredMatch[1].trim().replace(/^[-\s:]+/, '')
    const parsedBody = structuredMatch[2].trim()
    return {
      subject: parsedSubject || fallback.subject,
      body: parsedBody || fallback.body,
    }
  }

  const subjectOnlyMatch = cleaned.match(/subject\s*:\s*(.+)/i)
  const subject = subjectOnlyMatch?.[1]?.trim() || fallback.subject
  const body = cleaned
    .replace(/^subject\s*:\s*.+$/im, '')
    .replace(/^body\s*:\s*/im, '')
    .replace(/^(好的[,，:]?\s*)?(这是|以下是).{0,40}(邮件|开发信)[:：]?/i, '')
    .trim()

  return {
    subject,
    body: body || cleaned || fallback.body,
  }
}

interface LeadsManagementProps {
  userRole?: UserRole
  onAcquireNavigate?: () => void
}

export function LeadsManagement({ userRole = 'trial', onAcquireNavigate }: LeadsManagementProps) {
  const currentRole = userRole || 'trial'
  const { leads, hydrateFromConfig, hydrated, updateLead, deleteLead } = useLeadsStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [matchFilter, setMatchFilter] = useState<string>('all')
  const [unlockedFilter, setUnlockedFilter] = useState<string>('all')
  const [nextActionFilter, setNextActionFilter] = useState('')
  const [sortField, setSortField] = useState<string>('matchScore')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedLead, setSelectedLead] = useState<LeadItem | null>(null)
  /* P1-1：删除线索是**不可逆**操作（deleteLead 立即持久化），必须先经用户确认。 */
  const [pendingDelete, setPendingDelete] = useState<LeadItem | null>(null)
  const [focusReplyCoachInputKey, setFocusReplyCoachInputKey] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  /* 客户资料下载端：字段组勾选（默认全选，行为与收敛前一致）。
     让用户按需取舍列，并能在导出前看到「可触达渠道」分布，
     直接回答「这批线索能不能进自动化触达」。 */
  const [exportCenterOpen, setExportCenterOpen] = useState(false)
  const [exportGroups, setExportGroups] = useState<LeadExportGroupKey[]>(DEFAULT_EXPORT_GROUPS)
  const [analyzingId, setAnalyzingId] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [emailComposerOpen, setEmailComposerOpen] = useState(false)
  const [emailComposerLead, setEmailComposerLead] = useState<LeadItem | null>(null)
  const [emailLanguage, setEmailLanguage] = useState<string>('English')
  const [customEmailLanguage, setCustomEmailLanguage] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailPromptPreview, setEmailPromptPreview] = useState('')
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false)
  const [copiedEmailField, setCopiedEmailField] = useState<'subject' | 'body' | ''>('')
  const { toast } = useToast()
  const featureGate = useFeatureGate()
  const recommendedLanguage = useMemo(() => getRecommendedLanguage(emailComposerLead), [emailComposerLead])
  const effectiveEmailLanguage = useMemo(() => {
    if (emailLanguage === CUSTOM_LANGUAGE_VALUE) {
      return String(customEmailLanguage || '').trim() || 'English'
    }
    return String(emailLanguage || 'English').trim() || 'English'
  }, [customEmailLanguage, emailLanguage])

  /* P1-3：来源筛选项**从实际数据动态派生**。
     原实现硬编码 `LinkedIn / Trade Show / AI Search`，而真实 source 值来自各 Provider
     （'Google Maps' / 'Google Organic' / 'AnySearch' …），三者永不匹配 →
     「点了没反应」的死选项，且缺 AnySearch 这一真实来源。动态派生保证选项与数据不脱节。 */
  const sourceOptions = useMemo(() => {
    const set = new Set<string>()
    for (const lead of leads) {
      const value = String(lead.source || '').trim()
      if (value) set.add(value)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [leads])

  useEffect(() => {
    if (!hydrated) {
      void hydrateFromConfig()
    }
  }, [hydrateFromConfig, hydrated])

  const filteredLeads = useMemo(
    () =>
      leads
        .filter((lead) => {
          if (
            searchQuery &&
            !lead.company.toLowerCase().includes(searchQuery.toLowerCase()) &&
            !lead.contact.toLowerCase().includes(searchQuery.toLowerCase())
          )
            return false
          if (statusFilter !== 'all' && lead.status !== statusFilter) return false
          if (sourceFilter !== 'all' && lead.source !== sourceFilter) return false
          if (matchFilter !== 'all') {
            if (typeof lead.matchScore !== 'number') return false
            if (lead.matchScore < Number(matchFilter)) return false
          }
          if (unlockedFilter === 'unlocked' && !lead.unlocked) return false
          if (nextActionFilter) {
            const nextAction = getReplyCoachAnalysis(lead)?.nextAction?.trim() || ''
            if (!nextAction.includes(nextActionFilter)) return false
          }
          return true
        })
        .sort((a, b) => {
          if (sortField === 'date') {
            return new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime()
          }
          const scoreA = typeof a.matchScore === 'number' ? a.matchScore : -1
          const scoreB = typeof b.matchScore === 'number' ? b.matchScore : -1
          return scoreB - scoreA
        }),
    [leads, matchFilter, nextActionFilter, searchQuery, sortField, sourceFilter, statusFilter, unlockedFilter],
  )

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / LEADS_PAGE_SIZE))
  const pagedLeads = useMemo(
    () => filteredLeads.slice((currentPage - 1) * LEADS_PAGE_SIZE, currentPage * LEADS_PAGE_SIZE),
    [currentPage, filteredLeads],
  )

  const nextActionChips = useMemo(() => {
    const counts = new Map<string, number>()
    const visibleLeads = statusFilter === 'all' ? pagedLeads : filteredLeads
    visibleLeads.forEach((lead) => {
      const nextAction = getReplyCoachAnalysis(lead)?.nextAction?.trim()
      if (!nextAction) return
      counts.set(nextAction, (counts.get(nextAction) || 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
  }, [filteredLeads, pagedLeads, statusFilter])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, sourceFilter, matchFilter, unlockedFilter, nextActionFilter, sortField])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const goToLeadsPage = (page: number) => {
    const nextPage = Math.max(1, Math.min(totalPages, page))
    setCurrentPage(nextPage)
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const funnelStats =
    leads.length > 0
      ? [
          { label: '总线索数', value: leads.length, icon: Users, color: 'text-primary', bgColor: 'bg-primary/10' },
          {
            label: '本月新增',
            value: leads.filter((lead) => lead.addedDate.slice(0, 7) === new Date().toISOString().slice(0, 7)).length,
            icon: UserPlus,
            color: 'text-primary',
            bgColor: 'bg-primary/10',
          },
          {
            label: '跟进中',
            value: leads.filter((lead) => lead.status === 'contacting').length,
            icon: Target,
            color: 'text-primary',
            bgColor: 'bg-primary/10',
          },
          {
            label: '已回复占比',
            value: `${Math.round((leads.filter((lead) => lead.status === 'replied').length / leads.length) * 100)}%`,
            icon: TrendingUp,
            color: 'text-primary',
            bgColor: 'bg-primary/10',
          },
        ]
      : emptyStats

  const toggleStar = (lead: LeadItem) => {
    void updateLead(lead.id, { starred: !lead.starred })
  }

  const updateLeadStatus = (lead: LeadItem, status: LeadStatus) => {
    void updateLead(lead.id, { followUp: status, status })
    toast({
      title: '线索状态已更新',
      description: `已更新为 ${leadStatusConfig[status].label}`,
      variant: 'default',
      className: 'bg-blue-50 border-blue-200 text-blue-800',
    })
  }

  /* P1-1：删除是不可逆的（deleteLead 立即持久化），先弹确认再执行。
     原实现点一下即永久删除，误操作无法挽回。 */
  const handleDeleteLead = (lead: LeadItem) => {
    setPendingDelete(lead)
  }

  const confirmDeleteLead = async () => {
    const lead = pendingDelete
    if (!lead) return
    setPendingDelete(null)
    await deleteLead(lead.id)
    toast({
      title: '线索已删除',
      description: `已将 ${lead.company} 从线索库移除`,
      variant: 'default',
      className: 'bg-amber-50 border-amber-200 text-amber-800',
    })
  }

  const handleAnalyze = async (lead: LeadItem, options?: { focusReplyCoachInput?: boolean }) => {
    if (analyzingId === lead.id) return
    setAnalyzingId(lead.id)
    try {
      setSelectedLead(lead)
      if (options?.focusReplyCoachInput) {
        setFocusReplyCoachInputKey((value) => value + 1)
      } else {
        setFocusReplyCoachInputKey(0)
      }
      setDrawerOpen(true)
      await Promise.resolve()
    } finally {
      setAnalyzingId(null)
    }
  }

  const generateColdEmail = async (lead: LeadItem, language: string = effectiveEmailLanguage) => {
    if (isGeneratingEmail) return

    if (featureGate.loading || !featureGate.canAccess('analysis_basic')) {
      toast({ title: 'AI 撰写暂不可用', description: '当前授权未开启 AI 邮件撰写能力。', variant: 'destructive' })
      return
    }

    setIsGeneratingEmail(true)
    setEmailComposerLead(lead)
    setEmailComposerOpen(true)
    setEmailPromptPreview(buildColdEmailPrompt(lead, language))

    const fallbackDraft = buildFallbackColdEmail(lead)
    setEmailSubject((current) => current || fallbackDraft.subject)
    setEmailBody((current) => current || fallbackDraft.body)

    try {
      const response = await analysisGenerate({
        lead: {
          company: lead.company,
          industry: lead.industry,
          country: lead.country,
          website: lead.website,
          snippet: [lead.snippet, lead.salesStrategy, buildColdEmailPrompt(lead, language)]
            .filter(Boolean)
            .join('\n\n'),
          salesStrategy: lead.salesStrategy,
        },
        scenario: 'direct_quote',
        /* 小语种同步翻译：将 UI 选择的目标语言（如 German/French）映射为
           ISO 码传给后端，LLM 直接按目标语言生成邮件 */
        language: languageLabelToIso(language),
      })

      const draft = parseGeneratedEmailDraft(
        `${response.emailSubject ? `Subject: ${response.emailSubject}\n\n` : ''}${response.emailBody || response.content || ''}`,
        lead,
      )
      setEmailSubject(draft.subject)
      setEmailBody(draft.body)

      toast({
        title: response.semantic?.mockMode ? '已加载模拟草稿' : '开发信已生成',
        description: response.semantic?.mockMode
          ? `当前为开发模式，已为 ${lead.company} 填入可编辑的本地模拟邮件草稿。`
          : `已为 ${lead.company} 生成可编辑邮件草稿。`,
        variant: 'default',
        className: response.semantic?.mockMode
          ? 'bg-amber-50 border-amber-200 text-amber-900'
          : 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
    } catch (error) {
      const draft = buildFallbackColdEmail(lead)
      setEmailSubject(draft.subject)
      setEmailBody(draft.body)
      toast({
        title: 'AI 生成失败',
        description: `${formatAnalysisActionError(error, '邮件生成失败')}，已为你填入可手动编辑的草稿。`,
        variant: 'destructive',
      })
    } finally {
      setIsGeneratingEmail(false)
    }
  }

  const handleOpenEmailComposer = async (lead: LeadItem) => {
    const recommended = getRecommendedLanguage(lead)
    const defaultLanguage = recommended?.language || 'English'
    setEmailLanguage(defaultLanguage)
    setCustomEmailLanguage('')
    setEmailSubject('')
    setEmailBody('')
    await generateColdEmail(lead, defaultLanguage)
  }

  const handleRegenerateColdEmail = async () => {
    if (!emailComposerLead) return
    await generateColdEmail(emailComposerLead, effectiveEmailLanguage)
  }

  const handleLaunchMailClient = () => {
    if (!emailComposerLead) return

    const trimmedSubject = emailSubject.trim()
    const trimmedBody = getExternalEmailBody(emailBody)
    if (!trimmedSubject || !trimmedBody) {
      toast({ title: '邮件内容不完整', description: '请先补充主题和正文，再唤起本地邮箱。', variant: 'destructive' })
      return
    }

    const recipient = String(emailComposerLead.email || '').trim()
    const query = [`subject=${encodeURIComponent(trimmedSubject)}`, `body=${encodeURIComponent(trimmedBody)}`].join('&')
    const mailtoUrl = `mailto:${recipient}?${query}`

    if (mailtoUrl.length > 1800) {
      toast({
        title: '邮件内容较长',
        description: '当前邮件超出本地邮箱协议安全长度，请使用“复制主题 / 仅复制外文”手动发送。',
        variant: 'destructive',
      })
      return
    }

    if (!recipient) {
      toast({
        title: '未检测到邮箱地址',
        description: '将以空收件人方式唤起本地邮箱，请手动补充收件人后发送。',
        variant: 'default',
        className: 'bg-amber-50 border-amber-200 text-amber-800',
      })
    }

    window.location.href = mailtoUrl
  }

  const handleCopyEmailField = async (field: 'subject' | 'body') => {
    const value = field === 'subject' ? emailSubject.trim() : getExternalEmailBody(emailBody)
    if (!value) {
      toast({
        title: '暂无可复制内容',
        description: field === 'subject' ? '请先生成或填写邮件主题。' : '请先生成或填写邮件正文。',
        variant: 'destructive',
      })
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopiedEmailField(field)
      toast({
        title: '已复制',
        description: field === 'subject' ? '邮件主题已复制到剪贴板。' : '邮件正文已复制到剪贴板。',
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
      setTimeout(() => {
        setCopiedEmailField((current) => (current === field ? '' : current))
      }, 1200)
    } catch {
      toast({ title: '复制失败', description: '请手动复制内容。', variant: 'destructive' })
    }
  }

  /* 可触达渠道分布 —— 导出前的「闭环」预览：
     让用户一眼看出这批线索里有多少能进 WhatsApp / 邮件自动化、多少还是「—」（需补数据）。 */
  const reachabilityStats = useMemo(() => {
    let whatsapp = 0
    let email = 0
    let linkedin = 0
    let none = 0
    for (const lead of filteredLeads) {
      const channel = buildReachabilityChannel(lead)
      if (channel === '—') {
        none += 1
        continue
      }
      if (channel.includes('WhatsApp')) whatsapp += 1
      if (channel.includes('邮件')) email += 1
      if (channel.includes('LinkedIn')) linkedin += 1
    }
    return { whatsapp, email, linkedin, none, total: filteredLeads.length }
  }, [filteredLeads])

  const handleExport = async () => {
    if (isExporting) return
    if (exportGroups.length === 0) {
      toast({
        title: '请至少选择一个字段组',
        description: '未勾选任何字段组，导出的文件将没有内容。',
        variant: 'destructive',
      })
      return
    }
    try {
      setIsExporting(true)
      // 导出列定义统一收敛到 `@/lib/lead-export`（共享单一事实源）。
      // 此前此处仅有 14 列且**完全不含决策人** —— 用户从「搜索结果」导出能拿到
      // 核心关键人，从「线索管理」导出却一个都没有，同一份数据两种结果。
      // 现支持按「字段组」勾选导出（默认全选 = 与收敛前一致）。
      const content = buildLeadExportCsv(filteredLeads, exportGroups)
      const response = await saveExportFile({
        fileName: `kone-leads-export-${new Date().toISOString().slice(0, 10)}.csv`,
        content,
      })
      if (response.canceled) {
        return
      }
      toast({
        title: '报表已生成',
        description: `已导出 ${filteredLeads.length} 条线索（${exportGroups.length} 个字段组）到指定位置`,
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
    } catch (error) {
      toast({ title: '导出失败', description: formatErrorMessage(error, '导出失败'), variant: 'destructive' })
    } finally {
      setIsExporting(false)
    }
  }

  if (!hydrated) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500 shadow-sm">
        正在加载线索库...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {funnelStats.map((stat, index) => {
          const Icon = stat.icon
          return (
            <div
              key={stableHash(`${stat.label}-${index}`)}
              className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center gap-4 shadow-sm relative overflow-hidden"
            >
              <div className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,21,41,0.12),rgba(0,21,41,0))]" />
              <div className={`size-12 rounded-xl ${stat.bgColor} flex items-center justify-center shrink-0`}>
                <Icon className={`size-6 ${stat.color}`} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-500 font-medium">{stat.label}</span>
                <span className="text-3xl font-extrabold text-slate-900 tabular-nums">{stat.value}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 w-full lg:w-auto">
            <div className="relative flex-1 lg:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索公司名称或联系人..."
                className="w-full h-9 pl-9 pr-4 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[120px] text-xs">
                <SelectValue placeholder="状态筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="new">待跟进</SelectItem>
                <SelectItem value="contacting">联系中</SelectItem>
                <SelectItem value="replied">已回复</SelectItem>
                <SelectItem value="archived">已归档</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-9 w-[130px] text-xs">
                <SelectValue placeholder="来源筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部来源</SelectItem>
                {sourceOptions.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={matchFilter} onValueChange={setMatchFilter}>
              <SelectTrigger className="h-9 w-[120px] text-xs">
                <SelectValue placeholder="匹配度" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部匹配度</SelectItem>
                <SelectItem value="70">≥70%</SelectItem>
                <SelectItem value="80">≥80%</SelectItem>
                <SelectItem value="90">≥90%</SelectItem>
              </SelectContent>
            </Select>
            <Select value={unlockedFilter} onValueChange={setUnlockedFilter}>
              <SelectTrigger className="h-9 w-[120px] text-xs">
                <SelectValue placeholder="解锁状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部线索</SelectItem>
                <SelectItem value="unlocked">仅已解锁</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-9"
              onClick={() => setSortField(sortField === 'matchScore' ? 'date' : 'matchScore')}
            >
              <ArrowUpDown className="size-3.5" />
              {sortField === 'matchScore' ? '匹配度排序' : '时间排序'}
            </Button>
            <Sheet open={exportCenterOpen} onOpenChange={setExportCenterOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-9"
                  data-testid="btn-export-csv"
                  disabled={isExporting}
                  isLoading={isExporting}
                >
                  {!isExporting ? <Download className="size-3.5" /> : null}
                  {isExporting ? '导出中' : '客户资料下载'}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[420px] sm:w-[460px] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Download className="size-4 text-blue-600" />
                    客户资料下载端
                  </SheetTitle>
                  <SheetDescription>
                    共 <span className="font-semibold text-foreground">{filteredLeads.length}</span> 条线索。
                    按需勾选字段组后导出 CSV（UTF-8 BOM，Excel 可直接打开）。
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-5 space-y-5">
                  {/* 可触达渠道分布 —— 闭环关键视图 */}
                  <div className="rounded-xl border border-border bg-muted/30 p-3.5">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">可触达渠道分布</span>
                      <span className="text-[10px] text-muted-foreground">依据 Agent 消费字段判定</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        /* 配色跟随项目既有惯例（见 data-center 指标卡）：
                           同类指标统一用 UI 主色蓝，不用彩虹配色 ——
                           避免稀释「绿=成功 / 琥珀=警告」的状态语义。
                           「待补数据」用中性灰：它是**待办提示**而非错误状态。 */
                        { label: 'WhatsApp', value: reachabilityStats.whatsapp, tone: 'text-blue-600' },
                        { label: '邮件', value: reachabilityStats.email, tone: 'text-blue-600' },
                        { label: 'LinkedIn', value: reachabilityStats.linkedin, tone: 'text-blue-600' },
                        { label: '待补数据', value: reachabilityStats.none, tone: 'text-slate-500' },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="flex items-baseline justify-between rounded-lg bg-background px-2.5 py-2"
                        >
                          <span className="text-[11px] text-muted-foreground">{item.label}</span>
                          <span className={`text-sm font-semibold tabular-nums ${item.tone}`}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                    {reachabilityStats.none > 0 && (
                      <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">
                        「待补数据」= 缺少电话/邮箱/LinkedIn，无法进入自动化触达。数据源本身不覆盖全部字段，
                        建议先通过官网深探或人工补全后再触达。
                      </p>
                    )}
                  </div>

                  {/* 字段组勾选 */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">导出字段组</span>
                      <button
                        type="button"
                        className="text-[11px] text-blue-600 hover:underline"
                        onClick={() =>
                          setExportGroups(
                            exportGroups.length === LEAD_EXPORT_GROUPS.length ? [] : DEFAULT_EXPORT_GROUPS,
                          )
                        }
                      >
                        {exportGroups.length === LEAD_EXPORT_GROUPS.length ? '全部取消' : '全部选择'}
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {LEAD_EXPORT_GROUPS.map((group) => {
                        const checked = exportGroups.includes(group.key)
                        return (
                          <label
                            key={group.key}
                            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-muted/40"
                          >
                            <Checkbox
                              checked={checked}
                              className="mt-0.5"
                              onCheckedChange={(value) =>
                                setExportGroups((prev) =>
                                  value ? [...prev, group.key] : prev.filter((k) => k !== group.key),
                                )
                              }
                            />
                            <span className="flex-1">
                              <span className="block text-xs font-medium text-foreground">{group.label}</span>
                              <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                                {group.hint}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* 列预览 + 导出 */}
                  <div className="space-y-3 border-t border-border pt-4 pb-6">
                    <div className="text-[11px] text-muted-foreground">
                      将导出{' '}
                      <span className="font-semibold text-foreground">
                        {buildLeadExportHeaders(exportGroups).length}
                      </span>{' '}
                      列 ：{buildLeadExportHeaders(exportGroups).slice(0, 6).join('、')}
                      {buildLeadExportHeaders(exportGroups).length > 6 ? ' …' : ''}
                    </div>
                    <Button
                      className="w-full bg-blue-600 text-white hover:bg-blue-700"
                      onClick={() => void handleExport()}
                      disabled={isExporting || exportGroups.length === 0}
                      isLoading={isExporting}
                    >
                      {!isExporting ? <Download className="size-4" /> : null}
                      {isExporting ? '导出中' : `导出 CSV（${filteredLeads.length} 条）`}
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <Button
              size="sm"
              className="text-xs h-9 bg-blue-600 text-white hover:bg-blue-700"
              disabled
              title="当前版本暂未开放手动添加"
            >
              <Plus className="size-3.5" />
              手动添加（即将开放）
            </Button>
          </div>
        </div>

        {nextActionChips.length > 0 || nextActionFilter ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
            <div className="text-sm font-medium text-slate-700">动作筛选</div>
            {nextActionChips.map((chip) => {
              const active = chip.label === nextActionFilter
              return (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setNextActionFilter((current) => (current === chip.label ? '' : chip.label))}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${active ? 'border border-violet-300 bg-violet-100 text-violet-800 shadow-sm' : 'border border-violet-200/80 bg-violet-50/70 text-violet-700 hover:border-violet-300 hover:bg-violet-100/80'}`}
                >
                  <span>{chip.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/90 text-violet-700' : 'bg-white/70 text-violet-500'}`}
                  >
                    {chip.count}
                  </span>
                </button>
              )
            })}
            {nextActionFilter ? (
              <button
                type="button"
                onClick={() => setNextActionFilter('')}
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
              >
                清除动作筛选
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="border-b border-slate-100 px-5 py-3">
          <Tabs value={statusFilter} onValueChange={setStatusFilter}>
            <TabsList className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
              <TabsTrigger
                value="all"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white"
              >
                全部 {leads.length}
              </TabsTrigger>
              {leadStatusOrder.map((status) => (
                <TabsTrigger
                  key={status}
                  value={status}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white"
                >
                  {leadStatusConfig[status].label} {leads.filter((lead) => lead.status === status).length}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="overflow-x-auto">
          {leads.length > 0 && filteredLeads.length === 0 ? (
            /* P2 修复：库中有线索但**筛选后无匹配**时，此前渲染 4 列空看板 ——
               用户无法区分「筛选没结果」与「数据未加载」。补明确空态 + 一键清除筛选。 */
            <div className="py-16 text-center text-sm text-slate-500">
              <div className="text-base font-semibold text-slate-700">没有符合条件的线索</div>
              <div className="mt-2 text-xs text-slate-500">当前筛选条件下无匹配结果，试试放宽条件或清除筛选。</div>
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery('')
                    setStatusFilter('all')
                    setSourceFilter('all')
                    setMatchFilter('all')
                    setUnlockedFilter('all')
                    setNextActionFilter('')
                  }}
                >
                  清除全部筛选
                </Button>
              </div>
            </div>
          ) : leads.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">
              <div className="text-base font-semibold text-slate-700">暂无线索</div>
              <div className="mt-2 text-xs text-slate-500">去智能获客搜索并保存第一条线索</div>
              <div className="mt-4 flex justify-center">
                <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => onAcquireNavigate?.()}>
                  去智能获客
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-4 lg:grid-cols-4">
              {leadStatusOrder.map((status) => {
                const sourceLeads = statusFilter === 'all' ? pagedLeads : filteredLeads
                const columnLeads = sourceLeads.filter((lead) => lead.status === status)
                const config = leadStatusConfig[status]
                const totalInColumn = filteredLeads.filter((lead) => lead.status === status)
                const highScoreCount = totalInColumn.filter(
                  (lead) => typeof lead.matchScore === 'number' && lead.matchScore >= 80,
                ).length
                return (
                  <div key={status} className={`rounded-2xl border ${config.borderColor} bg-slate-50/70`}>
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${config.bgColor} ${config.color}`}
                        >
                          {config.label}
                        </span>
                        <span className="font-medium text-slate-500">{totalInColumn.length}</span>
                        <span className="text-slate-300">|</span>
                        <span className="font-medium text-amber-600">高分 {highScoreCount}</span>
                      </div>
                    </div>
                    <div className="space-y-3 p-3">
                      {columnLeads.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-400">
                          当前阶段暂无线索
                        </div>
                      ) : (
                        columnLeads.map((lead, index) => (
                          <div
                            key={stableHash(`${lead.id}-${status}-${index}`)}
                            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                          >
                            {(() => {
                              const replyCoach = getReplyCoachAnalysis(lead)
                              const hasReplyCoach = Boolean(replyCoach)
                              const nextAction = replyCoach?.nextAction?.trim()
                              return (
                                <>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <div className="truncate text-sm font-semibold text-slate-900">
                                          {lead.company}
                                        </div>
                                        {hasAnalysisResult(lead.analysisCache) ? (
                                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                            <Radar className="size-3" />
                                            已分析
                                          </span>
                                        ) : null}
                                        {lead.status === 'replied' && !hasReplyCoach ? (
                                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                            <MessageSquare className="size-3" />
                                            待拆解回信
                                          </span>
                                        ) : null}
                                        {lead.status === 'replied' && hasReplyCoach ? (
                                          <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                            <ShieldCheck className="size-3" />
                                            已制定对策
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                        <span className="flex items-center gap-1">
                                          <MapPin className="size-3" />
                                          {lead.countryCode || 'GL'}
                                        </span>
                                        <span className="flex items-center gap-1">
                                          <Building2 className="size-3" />
                                          {lead.industry}
                                        </span>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => toggleStar(lead)}
                                      className="text-slate-400 hover:text-amber-500 transition-colors"
                                    >
                                      {lead.starred ? (
                                        <Star className="size-4 fill-amber-500 text-amber-500" />
                                      ) : (
                                        <StarOff className="size-4" />
                                      )}
                                    </button>
                                  </div>
                                  <div className="mt-3">
                                    <MatchBar score={lead.matchScore} />
                                  </div>
                                  <div className="mt-3 text-xs text-slate-600">
                                    <div className="font-medium text-slate-700">{lead.contact || '暂无联系人'}</div>
                                    <div className="mt-1 text-slate-500">
                                      {lead.contactTitle || lead.inferredRole || '待补充角色信息'}
                                    </div>
                                  </div>
                                  {lead.salesStrategy ? (
                                    <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-5 text-slate-700">
                                      <span className="font-medium text-blue-900">跟进建议：</span>
                                      {lead.salesStrategy}
                                    </div>
                                  ) : null}
                                  <div className="mt-3 flex items-center gap-2">
                                    <Select
                                      value={lead.status}
                                      onValueChange={(next) => updateLeadStatus(lead, next as LeadStatus)}
                                    >
                                      <SelectTrigger className="h-8 flex-1 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="new">待跟进</SelectItem>
                                        <SelectItem value="contacting">联系中</SelectItem>
                                        <SelectItem value="replied">已回复</SelectItem>
                                        <SelectItem value="archived">已归档</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-8 p-0"
                                      data-testid="btn-analyze-lead"
                                      onClick={() => void handleAnalyze(lead)}
                                      disabled={analyzingId === lead.id}
                                      isLoading={analyzingId === lead.id}
                                    >
                                      {analyzingId === lead.id ? null : <Eye className="size-4" />}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 gap-1.5 rounded-full border-blue-200 bg-blue-50 px-2.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                                      onClick={() => void handleOpenEmailComposer(lead)}
                                      disabled={isGeneratingEmail && emailComposerLead?.id === lead.id}
                                      isLoading={isGeneratingEmail && emailComposerLead?.id === lead.id}
                                    >
                                      {!(isGeneratingEmail && emailComposerLead?.id === lead.id) ? (
                                        <PenLine className="size-3.5" />
                                      ) : null}
                                      撰写开发信
                                    </Button>
                                    {lead.status === 'replied' && !hasReplyCoach ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1.5 rounded-full border-amber-200/90 bg-amber-50/80 px-2.5 text-[11px] font-medium text-amber-700 shadow-[0_0_0_1px_rgba(251,191,36,0.06)] transition-all hover:border-amber-300 hover:bg-amber-100/80 animate-[pulse_2.6s_ease-in-out_infinite]"
                                        onClick={() => void handleAnalyze(lead, { focusReplyCoachInput: true })}
                                      >
                                        <Reply className="size-3.5" />
                                        拆解回信
                                      </Button>
                                    ) : null}
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                          <MoreHorizontal className="size-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-44">
                                        <DropdownMenuItem
                                          className={`text-xs gap-2 ${currentRole === 'trial' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                          disabled={currentRole === 'trial'}
                                          onSelect={() => {
                                            if (currentRole !== 'trial') void handleAnalyze(lead)
                                          }}
                                        >
                                          <Eye className="size-3.5" />
                                          AI 深度分析
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-xs gap-2 text-destructive focus:text-destructive"
                                          onClick={() => void handleDeleteLead(lead)}
                                        >
                                          <Trash2 className="size-3.5" />
                                          删除线索
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                                    <span>{lead.source}</span>
                                    <span className="flex items-center gap-1">
                                      <Clock className="size-3" />
                                      {lead.lastActivity}
                                    </span>
                                  </div>
                                  {lead.status === 'replied' && hasReplyCoach && nextAction ? (
                                    <div className="mt-3 flex items-center justify-between rounded-lg border border-violet-100 bg-violet-50/70 px-3 py-2 text-[11px] text-slate-600">
                                      <span className="text-slate-500">下一轮动作</span>
                                      <button
                                        type="button"
                                        className="inline-flex items-center rounded-full bg-white/85 px-2.5 py-1 font-medium text-violet-700 ring-1 ring-violet-200/80 transition hover:bg-white hover:text-violet-800"
                                        onClick={() => setNextActionFilter(nextAction || '')}
                                      >
                                        {nextAction}
                                      </button>
                                    </div>
                                  ) : null}
                                </>
                              )
                            })()}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {leads.length > 0 && statusFilter === 'all' ? (
          <div className="flex flex-col gap-3 border-t border-border bg-muted/20 px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-3">
              <span>共 {filteredLeads.length} 条线索，按生命周期分列展示</span>
              <span>状态切换会实时同步到本地线索库</span>
            </div>
            <div className="text-xs text-slate-500">待跟进 -&gt; 联系中 -&gt; 已回复 -&gt; 已归档</div>
          </div>
        ) : null}

        {filteredLeads.length > LEADS_PAGE_SIZE ? (
          <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-500">
                当前第 {currentPage} 页 / 共 {totalPages} 页，每页 50 条
              </div>
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(event) => {
                        event.preventDefault()
                        goToLeadsPage(currentPage - 1)
                      }}
                      className={
                        currentPage === 1
                          ? 'pointer-events-none opacity-50'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }
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
                        goToLeadsPage(currentPage + 1)
                      }}
                      className={
                        currentPage === totalPages
                          ? 'pointer-events-none opacity-50'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
        ) : null}
      </div>
      <AnalysisDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        lead={selectedLead}
        focusReplyCoachInputKey={focusReplyCoachInputKey}
      />
      {/* P1-1：删除确认 —— 不可逆操作必须二次确认 */}
      <Dialog open={pendingDelete !== null} onOpenChange={(open) => (!open ? setPendingDelete(null) : undefined)}>
        <DialogContent className="max-w-md rounded-2xl border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-slate-900">确认删除该线索？</DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              将永久移除「{pendingDelete?.company || '该线索'}」及其分析缓存，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => void confirmDeleteLead()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailComposerOpen} onOpenChange={setEmailComposerOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-2xl border-slate-200 bg-white p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-slate-200 px-6 py-5">
            <DialogTitle className="text-base font-semibold text-slate-900">AI 开发信撰写器</DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {emailComposerLead
                ? `面向 ${emailComposerLead.company}${emailComposerLead.country ? ` · ${emailComposerLead.country}` : ''} 生成简短、专业、可直接发送的开发信。`
                : '生成并编辑外贸开发信草稿。'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <div className="font-medium text-slate-800">AI 提示词策略</div>
              <div className="mt-1 whitespace-pre-wrap leading-5 text-slate-500">{emailPromptPreview}</div>
            </div>

            <div className="grid gap-1.5 sm:max-w-[240px]">
              <label className="text-xs font-medium text-slate-600">输出语言 (Language)</label>
              <Select value={emailLanguage} onValueChange={setEmailLanguage}>
                <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm text-slate-700">
                  <SelectValue placeholder="选择输出语言" />
                </SelectTrigger>
                <SelectContent>
                  {COLD_EMAIL_LANGUAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {recommendedLanguage ? (
                <p className="text-xs text-slate-400">
                  建议语言：根据该客户位于 {emailComposerLead?.country || emailComposerLead?.countryCode}，推荐使用
                  {recommendedLanguage.label}。
                </p>
              ) : null}
              {emailLanguage === CUSTOM_LANGUAGE_VALUE ? (
                <input
                  value={customEmailLanguage}
                  onChange={(event) => setCustomEmailLanguage(event.target.value)}
                  placeholder="请输入语言名称，如：葡萄牙语"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-slate-600">主题 (Subject)</label>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="h-8 gap-1.5 border-slate-200 text-xs"
                  onClick={() => void handleCopyEmailField('subject')}
                >
                  {copiedEmailField === 'subject' ? (
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  复制主题
                </Button>
              </div>
              <input
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.target.value)}
                placeholder="输入邮件主题"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-slate-600">正文 (Body)</label>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="h-8 gap-1.5 border-slate-200 text-xs"
                  onClick={() => void handleCopyEmailField('body')}
                >
                  {copiedEmailField === 'body' ? (
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  仅复制外文
                </Button>
              </div>
              <Textarea
                value={emailBody}
                onChange={(event) => setEmailBody(event.target.value)}
                placeholder="AI 正在为你起草邮件正文..."
                className="min-h-[320px] rounded-xl border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus-visible:ring-blue-500/20"
              />
              <p className="text-xs text-slate-400">你可以在发送前自由修改语气、卖点与 CTA。</p>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 px-6 py-4 sm:justify-between">
            <Button variant="ghost" onClick={() => setEmailComposerOpen(false)}>
              取消
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => void handleRegenerateColdEmail()}
                disabled={!emailComposerLead || isGeneratingEmail}
                isLoading={isGeneratingEmail}
              >
                重新生成
              </Button>
              <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={handleLaunchMailClient}>
                <Mail className="size-4" />
                唤起本地邮箱发送
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
