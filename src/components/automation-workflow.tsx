'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Mail,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  Trash2,
  Eye,
  Globe,
  Clock,
  ShieldCheck,
  ChevronRight,
  Crown,
  AlertTriangle,
  Workflow,
  MailCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { verifyEmails, startCampaign, fetchTrackingStatus, dnsHealthCheck } from '@/lib/electron-api'
import type { EmailVerifyResult, DnsHealthCheckResult } from '@/shared/ipc-contracts'
import { useToast } from '@/hooks/use-toast'
import { useLicenseStore } from '@/store/licenseStore'
import { UpgradeModal } from '@/components/upgrade-modal'
import { useLeadsStore } from '@/store/leads-store'
import { getUserConfig, updateUserConfig } from '@/lib/user-config'

const TEMPLATES = [
  {
    id: 'intro',
    name: '首次触达',
    subject: '合作探讨 — {{company}}',
    body: 'Hi {{contact}},\n\n我们注意到贵司在 {{country}} 市场的出色表现，希望就 B2B 合作方案与您交流。\n\n期待回复。',
  },
  {
    id: 'followup',
    name: '二次跟进',
    subject: 'Re: 合作探讨 — {{company}}',
    body: 'Hi {{contact}},\n\n上次沟通后未收到回复，特此跟进。如果时间方便，我们可以安排一次 15 分钟的快速通话。',
  },
  {
    id: 'value',
    name: '价值案例',
    subject: '{{company}} 的同行正在这样做',
    body: 'Hi {{contact}},\n\n近期帮助贵司同行业的 XX 公司实现了 30% 的线索转化率提升。附上案例供参考。',
  },
]

const normalizeVerifyReason = (reason?: string) => {
  const text = String(reason || '')
    .trim()
    .toLowerCase()
  if (!text) return '暂未通过校验'
  if (text.includes('smtp') || text.includes('handshake') || text.includes('timeout')) return '邮箱服务器暂未响应'
  if (text.includes('invalid') || text.includes('format')) return '邮箱格式异常'
  if (text.includes('mx')) return '域名邮件能力异常'
  if (text.includes('disposable')) return '疑似临时邮箱'
  if (text.includes('unknown')) return '邮箱状态待确认'
  return '连接异常，请稍后重试'
}

const normalizeEmail = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()

export function AutomationWorkflow() {
  const { toast } = useToast()
  const searchResults = useLeadsStore((state) => state.searchResults)
  const leads = useLeadsStore((state) => state.leads)
  const loading = useLicenseStore((state) => state.loading)
  const tier = useLicenseStore((state) => state.tier)
  const plan = useLicenseStore((state) => state.plan)

  const [rawEmails, setRawEmails] = useState('')
  const [verifyResults, setVerifyResults] = useState<EmailVerifyResult[]>([])
  const [verifying, setVerifying] = useState(false)
  /* 待校验邮箱数量（诚实化后不再维护虚构的进度百分比，见 handleVerifyEmails 注释） */
  const [verifyingCount, setVerifyingCount] = useState(0)
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id)
  const [sending, setSending] = useState(false)
  const [campaignResult, setCampaignResult] = useState<{ triggered: boolean; message: string } | null>(null)
  const [trackingData, setTrackingData] = useState<
    Record<string, { isOpened: boolean; openedAt?: string; openedGeo?: string }>
  >({})
  const [trackingOffline, setTrackingOffline] = useState(false)
  const [loadingTracking, setLoadingTracking] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [dnsResult, setDnsResult] = useState<DnsHealthCheckResult | null>(null)
  const [dnsChecking, setDnsChecking] = useState(false)
  const [senderDomain, setSenderDomain] = useState('')
  /* P2-4：自定义 DKIM selector（与默认列表合并探测，防有限列表误报） */
  const [dkimSelectors, setDkimSelectors] = useState('')
  const [dkimSaved, setDkimSaved] = useState(false)

  const canUseCloudSend = tier === 'premium' || plan === 'enterprise'

  const leadLookup = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>()
    const upsert = (entry: any) => {
      const email = normalizeEmail(entry?.email)
      if (!email) return
      map.set(email, entry)
    }
    searchResults.forEach(upsert)
    leads.forEach(upsert)
    return map
  }, [leads, searchResults])

  const handleVerifyEmails = useCallback(async () => {
    const emails = rawEmails
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter(Boolean)
    if (!emails.length) return
    /* 诚实化：verifyEmails 是一次性的批量 IPC，主进程不推送逐条进度事件，
       因此无法展示真实百分比。改用真实待校验数量 + 不确定态（spinner），
       杜绝虚构进度（违反宪法"严禁假成功"）。 */
    setVerifying(true)
    setVerifyingCount(emails.length)

    try {
      const data = await verifyEmails(emails)
      setVerifyResults(data.results)
      toast({
        title: '邮箱清洗完成',
        description: `已完成 ${data.results.length} 个邮箱校验。`,
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
    } catch (error) {
      toast({
        title: '邮箱校验失败',
        description: error instanceof Error ? error.message : '邮箱校验失败',
        variant: 'destructive',
      })
    } finally {
      setVerifying(false)
      setVerifyingCount(0)
    }
  }, [rawEmails, toast])

  const validEmails = verifyResults.filter((r) => r.valid)
  const invalidEmails = verifyResults.filter((r) => !r.valid)
  /* P2-1 五级差异化队列：主队列（verified/probable）→ 限频（catch_all）→
     降权（risky：disposable/role）→ 抑制建议（invalid）。
     云端 campaign 只携带 primary + throttled（risky/invalid 被 valid=false 排除）。 */
  const verificationQueues = useMemo(() => {
    const queues = {
      primary: [] as EmailVerifyResult[],
      throttled: [] as EmailVerifyResult[],
      deprioritized: [] as EmailVerifyResult[],
      suppressionCandidates: [] as EmailVerifyResult[],
    }
    for (const r of verifyResults) {
      if (r.grade === 'verified' || r.grade === 'probable') queues.primary.push(r)
      else if (r.grade === 'catch_all') queues.throttled.push(r)
      else if (r.grade === 'risky') queues.deprioritized.push(r)
      else if (r.grade === 'invalid') queues.suppressionCandidates.push(r)
      else (r.valid ? queues.primary : queues.suppressionCandidates).push(r)
    }
    return queues
  }, [verifyResults])

  const removeInvalid = useCallback(() => {
    const validSet = new Set(validEmails.map((r) => normalizeEmail(r.email)))
    const lines = rawEmails
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => validSet.has(normalizeEmail(e)))
    setRawEmails(lines.join('\n'))
    setVerifyResults(validEmails)
  }, [rawEmails, validEmails])

  const handleOpenUpgrade = useCallback(() => {
    setUpgradeOpen(true)
  }, [])

  const buildLeadPayloads = useCallback(
    async (emails: string[], verificationStatus: 'verified' | 'unverified') => {
      const config = await getUserConfig()
      return emails.map((email) => {
        const normalized = normalizeEmail(email)
        const lead = leadLookup.get(normalized) || {}
        const analysisCache =
          typeof lead.analysisCache === 'object' && lead.analysisCache
            ? (lead.analysisCache as Record<string, any>)
            : {}
        const bestAnalysis =
          analysisCache.direct_quote || analysisCache.competitor_switch || analysisCache.factory_strength || {}
        return {
          email: normalized,
          company: String(lead.company || '').trim(),
          website: String(lead.website || '').trim(),
          domain: String(lead.website || lead.domain || '').trim(),
          country: String(lead.country || '').trim(),
          contact: String(lead.contact || '').trim(),
          contactTitle: String(lead.contactTitle || lead.inferredRole || '').trim(),
          phone: String(lead.phone || '').trim(),
          address: String(lead.address || '').trim(),
          source: String(lead.source || '').trim(),
          matchScore: typeof lead.matchScore === 'number' ? lead.matchScore : undefined,
          matchReasons: Array.isArray(lead.matchReasons) ? lead.matchReasons : [],
          riskFlags: Array.isArray(lead.riskFlags) ? lead.riskFlags : [],
          inferredRole: String(lead.inferredRole || '').trim(),
          snippet: String(lead.snippet || '').trim(),
          aiAnalysis: {
            companyProfile: String(bestAnalysis.companyProfile || '').trim(),
            painPoints: String(bestAnalysis.painPoints || '').trim(),
            valueMapping: String(bestAnalysis.valueMapping || '').trim(),
            confidence: typeof bestAnalysis.confidence === 'number' ? bestAnalysis.confidence : undefined,
            source: String(bestAnalysis.source || '').trim(),
          },
          aiGeneratedPitch: {
            emailSubject: String(bestAnalysis.emailSubject || '').trim(),
            emailBody: String(bestAnalysis.emailBody || '').trim(),
          },
          verificationStatus,
          userSettings: {
            templateId: selectedTemplate,
            selectedModel: String(config.selectedModel || '').trim(),
            icpProfile: config.icpProfile || {},
          },
        }
      })
    },
    [leadLookup, selectedTemplate],
  )

  const handleStartCampaign = useCallback(async () => {
    if (!canUseCloudSend) {
      handleOpenUpgrade()
      toast({
        title: '企业云端协同引擎暂未启用',
        description: '当前功能为 Premium 高级版专属，支持云端多员防撞单碰撞与脱机长效跟随，请联系管理员解锁。',
        variant: 'destructive',
      })
      return
    }

    const emails = (
      validEmails.length
        ? validEmails.map((r) => r.email)
        : rawEmails
            .split(/[\n,;]+/)
            .map((e) => e.trim())
            .filter(Boolean)
    ).map(normalizeEmail)
    if (!emails.length) return
    if (!senderDomain.trim()) {
      toast({
        title: '请先完成域名信誉检测',
        description: '请输入发信域名并完成 DNS 健康检测后，再提交云端发送队列。',
        variant: 'destructive',
      })
      return
    }
    if (
      !dnsResult ||
      dnsResult.domain !==
        senderDomain
          .trim()
          .replace(/^https?:\/\//i, '')
          .replace(/\/.*$/, '')
          .replace(/^www\./i, '')
    ) {
      toast({
        title: '请先完成域名信誉检测',
        description: '当前发信域名尚未完成 DNS 审计，请先点击“域名信誉检测”。',
        variant: 'destructive',
      })
      return
    }
    if (!dnsResult.valid || dnsResult.error) {
      toast({
        title: '发信域名存在安全风险',
        description: dnsResult.error || 'DNS 健康检测未通过，发送按钮已软锁定。',
        variant: 'destructive',
      })
      return
    }
    setSending(true)
    setCampaignResult(null)
    try {
      const payloadLeads = await buildLeadPayloads(emails, validEmails.length ? 'verified' : 'unverified')
      const data = await startCampaign({ leads: payloadLeads, templateId: selectedTemplate })
      const message =
        data.message ||
        (data.triggered ? `已成功同步 ${data.accepted || 0} 条线索至云端发送队列` : data.error || '推送失败')
      setCampaignResult({ triggered: data.triggered, message })
      toast({
        title: data.triggered ? '发送任务已受理' : '发送任务未完成',
        description: message,
        variant: data.triggered ? 'default' : 'destructive',
        className: data.triggered ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : undefined,
      })
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : '发送失败'
      const supabaseMessage = /supabase|URL.*Key|Anon|service_role|JWT/i.test(rawMessage)
        ? '企业云端协同引擎暂未启用。当前功能为 Premium 高级版专属，支持云端多员防撞单碰撞与脱机长效跟随，请联系管理员解锁。'
        : rawMessage
      setCampaignResult({ triggered: false, message: supabaseMessage })
      toast({ title: '发送失败', description: supabaseMessage, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }, [
    buildLeadPayloads,
    canUseCloudSend,
    dnsResult,
    handleOpenUpgrade,
    rawEmails,
    selectedTemplate,
    senderDomain,
    toast,
    validEmails,
  ])

  const loadTracking = useCallback(async () => {
    const emails = validEmails.length
      ? validEmails.map((r) => r.email)
      : rawEmails
          .split(/[\n,;]+/)
          .map((e) => e.trim())
          .filter(Boolean)
    const domains = [...new Set(emails.map((e) => e.split('@')[1]).filter(Boolean))]
    if (!domains.length) return
    setLoadingTracking(true)
    try {
      const data = await fetchTrackingStatus(domains)
      setTrackingData(data.tracking)
      setTrackingOffline(data.offline)
    } catch (error) {
      setTrackingOffline(true)
      toast({
        title: '追踪刷新失败',
        description: error instanceof Error ? error.message : '追踪刷新失败',
        variant: 'destructive',
      })
    } finally {
      setLoadingTracking(false)
    }
  }, [rawEmails, toast, validEmails])

  useEffect(() => {
    let cancelled = false
    getUserConfig()
      .then((config) => {
        if (!cancelled) {
          const shield = (config as { dnsShield?: { dkimSelectors?: string[] } }).dnsShield
          if (Array.isArray(shield?.dkimSelectors)) setDkimSelectors(shield.dkimSelectors.join(', '))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleSaveDkimSelectors = useCallback(async () => {
    const selectors = dkimSelectors
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      await updateUserConfig((current) => ({
        ...current,
        dnsShield: { ...(current as { dnsShield?: object }).dnsShield, dkimSelectors: selectors },
      }))
      setDkimSaved(true)
      toast({
        title: 'DKIM Selector 已保存',
        description: selectors.length
          ? `已追加 ${selectors.length} 个自定义选择器`
          : '已清空自定义选择器，仅使用默认列表',
      })
      setTimeout(() => setDkimSaved(false), 2000)
    } catch (error) {
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : '配置写入异常',
        variant: 'destructive',
      })
    }
  }, [dkimSelectors, toast])

  useEffect(() => {
    if (campaignResult?.triggered) void loadTracking()
  }, [campaignResult, loadTracking])

  const template = TEMPLATES.find((t) => t.id === selectedTemplate) || TEMPLATES[0]
  const openedCount = Object.values(trackingData).filter((t) => t.isOpened).length

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-600">Kone 协同引擎</p>
              <h3 className="mt-1 text-base font-semibold text-foreground">三步完成高质量触达流程</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Step 1 邮箱清洗 · Step 2 模板配置 · Step 3 云端发送队列
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { step: 'Step 1', title: '邮箱清洗', desc: '先筛掉死邮箱与高风险地址' },
                { step: 'Step 2', title: '模板配置', desc: '选择最适合当前客户的沟通脚本' },
                { step: 'Step 3', title: '云端发送队列', desc: '交由 Kone 协同引擎完成批量触达' },
              ].map((item) => (
                <div
                  key={item.step}
                  className="rounded-xl border border-white/80 bg-white/80 px-3 py-3 shadow-sm backdrop-blur"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                    <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                      {item.step}
                    </span>
                    <ChevronRight className="size-3 text-slate-400" />
                    <span>{item.title}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-blue-600 shadow-md">
            <Workflow className="size-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">智能触达工作流</h2>
            <p className="text-xs text-muted-foreground">邮箱清洗 &middot; 模板配置 &middot; 云端发送队列</p>
          </div>
          {!canUseCloudSend ? (
            <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">
              <Crown className="size-3.5" />
              Basic 套餐已锁定云端发送
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Mail className="size-4 text-blue-500" />
                <span className="text-sm font-semibold text-foreground">Step 1 · 邮箱清洗工作台</span>
              </div>
              <Textarea
                value={rawEmails}
                onChange={(e) => setRawEmails(e.target.value)}
                placeholder={
                  '粘贴邮箱列表（每行一个、逗号或分号分隔）\n\nceo@hulk-energy.com\npurchasing@target-domain.com'
                }
                className="min-h-36 font-mono text-xs"
              />
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={handleVerifyEmails} disabled={verifying || !rawEmails.trim()}>
                  {verifying ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                  {verifying ? '正在校验中...' : '一键清洗'}
                </Button>
                {invalidEmails.length > 0 && (
                  <Button size="sm" variant="outline" onClick={removeInvalid}>
                    <Trash2 className="size-3.5" />
                    剔除 {invalidEmails.length} 个死邮箱
                  </Button>
                )}
              </div>

              {verifying && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    <span>正在校验 {verifyingCount} 个邮箱…（批量请求，暂无可观测的逐条进度）</span>
                  </div>
                </div>
              )}
            </div>

            {verifyResults.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-foreground">验证结果</span>
                  <div className="flex gap-3 text-xs">
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="size-3" /> {validEmails.length} 存活
                    </span>
                    <span className="inline-flex items-center gap-1 text-red-500">
                      <XCircle className="size-3" /> {invalidEmails.length} 失效
                    </span>
                  </div>
                  {/* P2-1 五级差异化队列分布 */}
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span className="text-emerald-600">主队列 {verificationQueues.primary.length}</span>
                    <span className="text-amber-600">限频(Catch-all) {verificationQueues.throttled.length}</span>
                    <span className="text-orange-600">降权(Risky) {verificationQueues.deprioritized.length}</span>
                    <span className="text-red-600">建议抑制 {verificationQueues.suppressionCandidates.length}</span>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-border">
                  {verifyResults.map((r, i) => (
                    <div key={i} className={`flex items-center gap-2 py-1.5 text-xs ${r.valid ? '' : 'opacity-50'}`}>
                      {r.valid ? (
                        <CheckCircle2
                          className={`size-3.5 shrink-0 ${r.grade === 'catch_all' ? 'text-amber-500' : 'text-emerald-500'}`}
                        />
                      ) : (
                        <XCircle className="size-3.5 text-red-500 shrink-0" />
                      )}
                      <span className="font-mono flex-1 truncate text-foreground">{r.email}</span>
                      {r.grade === 'catch_all' ? (
                        <span className="text-amber-600 text-[10px] font-semibold shrink-0">Catch-all 域</span>
                      ) : r.grade === 'probable' && r.valid ? (
                        <span className="text-sky-600 text-[10px] font-semibold shrink-0">Probable</span>
                      ) : r.valid ? (
                        <span className="text-emerald-600 text-[10px] font-semibold shrink-0">Verified</span>
                      ) : (
                        <span className="text-muted-foreground shrink-0">{normalizeVerifyReason(r.reason)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Send className="size-4 text-blue-600" />
                <span className="text-sm font-semibold text-foreground">Step 2 · 触达模板配置</span>
              </div>
              <div className="flex gap-2 mb-3 flex-wrap">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTemplate(t.id)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${selectedTemplate === t.id ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-xs">
                <div className="font-semibold text-foreground mb-1">Subject: {template.subject}</div>
                <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed">{template.body}</div>
              </div>
              <div className="flex gap-2 mt-3">
                <input
                  type="text"
                  value={senderDomain}
                  onChange={(e) => setSenderDomain(e.target.value)}
                  placeholder="输入发信域名（如 example.com）"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={dnsChecking || !senderDomain.trim()}
                  onClick={async () => {
                    setDnsChecking(true)
                    try {
                      const result = await dnsHealthCheck(senderDomain.trim())
                      setDnsResult(result)
                      if (result.error) {
                        toast({ title: '域名安全警告', description: result.error, variant: 'destructive' })
                      } else {
                        toast({
                          title: '域名检测通过',
                          description: `MX ${result.hasMX ? '达标' : '未通过'} · SPF ${result.hasSPF ? '达标' : '未通过'} · DKIM ${result.hasDKIM ? '达标' : '未通过'} · DMARC ${result.hasDMARC ? '达标' : '未通过'}`,
                          variant: 'default',
                        })
                      }
                    } catch (error) {
                      toast({
                        title: 'DNS 检测失败',
                        description: error instanceof Error ? error.message : '检测异常',
                        variant: 'destructive',
                      })
                    } finally {
                      setDnsChecking(false)
                    }
                  }}
                  className="text-xs"
                >
                  <ShieldCheck className="size-3 mr-1" />
                  {dnsChecking ? '检测中...' : '域名信誉检测'}
                </Button>
              </div>
              {/* P2-4：自定义 DKIM selector —— 与默认列表合并探测，避免有限列表误报 */}
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={dkimSelectors}
                  onChange={(e) => setDkimSelectors(e.target.value)}
                  placeholder="自定义 DKIM selector（逗号分隔，如 selector1, s1）"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={dkimSaved}
                  onClick={handleSaveDkimSelectors}
                  className="text-xs"
                >
                  {dkimSaved ? '已保存' : '保存'}
                </Button>
              </div>
              {dnsResult && (
                <div
                  className={`mt-2 rounded-lg border px-3 py-2 text-xs flex flex-col gap-1 ${dnsResult.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}
                >
                  <div className="flex items-center gap-1 font-semibold">
                    <ShieldCheck className="size-3" />
                    {dnsResult.error ? '域名合规告警' : '域名信誉合格'}
                  </div>
                  {dnsResult.error && <p>{dnsResult.error}</p>}
                  <div className="flex gap-3 text-[10px] opacity-75">
                    <span>MX {dnsResult.hasMX ? '达标' : '未通过'}</span>
                    <span>SPF {dnsResult.hasSPF ? '达标' : '未通过'}</span>
                    <span>DKIM {dnsResult.hasDKIM ? '达标' : '未通过'}</span>
                    <span>DMARC {dnsResult.hasDMARC ? '达标' : '未通过'}</span>
                  </div>
                </div>
              )}
              {dnsResult?.error && canUseCloudSend && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
                  <AlertTriangle className="size-3.5" />
                  发信域名存在安全风险，<strong>发送按钮已软锁定</strong>
                  。请先修复域名配置后再执行群发，以保护公司主邮箱域名信誉。
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  onClick={() => {
                    if (!canUseCloudSend) {
                      handleOpenUpgrade()
                      toast({
                        title: '高级发送能力未开通',
                        description: '当前套餐无法使用云端协同发送，请升级到高级版。',
                        variant: 'destructive',
                      })
                      return
                    }
                    void handleStartCampaign()
                  }}
                  disabled={
                    sending ||
                    !rawEmails.trim() ||
                    loading ||
                    !dnsResult ||
                    !dnsResult.valid ||
                    (dnsResult?.error ? true : false)
                  }
                  className="bg-blue-600 text-white hover:bg-blue-700"
                >
                  {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  {sending ? '推送中...' : canUseCloudSend ? '提交至云端发送队列' : '联系顾问解锁高级版'}
                </Button>
              </div>
              {!canUseCloudSend ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  当前为试用版 / Basic 套餐，云端协同发送已锁定。点击发送按钮即可唤起高级版升级通道，解锁 N8N / Snov.io
                  闭环。
                </div>
              ) : null}
              {campaignResult && (
                <div
                  className={`mt-3 text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${campaignResult.triggered ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
                >
                  {campaignResult.triggered ? <MailCheck className="size-3.5" /> : <XCircle className="size-3.5" />}
                  {campaignResult.message}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Eye className="size-4 text-amber-500" />
                  <span className="text-sm font-semibold text-foreground">Step 3 · 触达反馈看板</span>
                  {openedCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                      {openedCount} 已查阅
                    </span>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={loadTracking} disabled={loadingTracking}>
                  {loadingTracking ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}
                  刷新追踪
                </Button>
              </div>
              {trackingOffline && (
                <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg mb-3">
                  Kone 协同引擎暂时不可达，追踪数据已切换为离线展示
                </div>
              )}
              {Object.keys(trackingData).length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-xs">
                  触达任务发出后，此处将展示客户查阅动态、地域线索与关键时间节点
                </div>
              ) : (
                <div className="divide-y divide-border max-h-48 overflow-y-auto">
                  {Object.entries(trackingData).map(([domain, info]) => (
                    <div
                      key={domain}
                      className={`flex items-center gap-3 py-2.5 text-xs transition-colors ${info.isOpened ? 'bg-emerald-50/50' : ''}`}
                    >
                      <div className="relative shrink-0">
                        <div className={`size-2.5 rounded-full ${info.isOpened ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        {info.isOpened && (
                          <div className="absolute inset-0 size-2.5 rounded-full bg-emerald-500 animate-ping opacity-50" />
                        )}
                      </div>
                      <span className="font-mono flex-1 truncate text-foreground">{domain}</span>
                      {info.isOpened ? (
                        <div className="flex items-center gap-3 shrink-0">
                          {info.openedGeo && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700 font-medium">
                              <Globe className="size-2.5" />
                              {info.openedGeo}
                            </span>
                          )}
                          {info.openedAt && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-600">
                              <Clock className="size-2.5" />
                              {new Date(info.openedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">未打开</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <UpgradeModal open={upgradeOpen} intent="premium" onOpenChange={setUpgradeOpen} />
    </>
  )
}
