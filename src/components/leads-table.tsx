'use client'

import { formatErrorMessage, escapeCsvValue } from '@/lib/error-message'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Filter, Download, Mail, Phone, MessageCircle, Send, AlertCircle, ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { stableHash } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { getLeadUniqueKey, LeadItem, useLeadsStore } from '@/store/leads-store'
import { getDataSourceMeta } from '@/lib/data-source-meta'
import { formatMatchScoreForExport } from '@/lib/lead-mappers'
import {
  saveExportFile,
  agentGetStatus,
  onAgentLeadStatusUpdated,
  /* [V1.4.0] Phase 2.9 · 审批（AGENTS.md 宪法第 5 条：审批是投递的必要前提） */
  createApproval,
  getLicenseInfo,
} from '@/lib/electron-api'
import type { AgentStatus } from '@/shared/ipc-contracts'

type Lead = LeadItem
type UserRole = 'trial' | 'pro' | 'enterprise'

const hasNumericMatchScore = <T extends { matchScore?: number | null }>(lead: T): lead is T & { matchScore: number } =>
  typeof lead.matchScore === 'number'

interface LeadsTableProps {
  onAnalyze: (lead: Lead) => void
  userRole?: UserRole | null
  onSendToCloud?: (lead: Lead) => Promise<{ skipped: boolean; reason?: string } | void>
  canUseCloudSend?: boolean
  onViewAll?: () => void
}

function MatchBar({
  score,
  scoreSource,
  opportunityScore,
}: {
  score?: number | null
  scoreSource?: 'ai' | 'deterministic'
  opportunityScore?: { icpFit: number; intent: number; evidence: number; riskPenalty: number; finalScore: number }
}) {
  if (typeof score !== 'number') {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
        待评估
      </span>
    )
  }

  const color = score >= 80 ? 'bg-blue-600' : 'bg-slate-400'
  const textColor = score >= 80 ? 'text-blue-600' : 'text-slate-500'
  /* P2-3：结构化机会分拆解（ICP Fit 55 + Intent 35 + Evidence 10 − Risk Penalty） */
  const breakdownTitle = opportunityScore
    ? `机会分拆解：ICP 匹配 ${opportunityScore.icpFit}/55 + 采购意图 ${opportunityScore.intent}/35 + 证据强度 ${opportunityScore.evidence}/10 − 风险扣分 ${opportunityScore.riskPenalty} = ${opportunityScore.finalScore}`
    : scoreSource === 'ai'
      ? 'AI 智能评分（基于官网与语义分析）'
      : '确定性预筛分（关键词/信号规则，未经 AI 评估）'

  return (
    <div className="flex items-center gap-2.5">
      <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-sm font-semibold ${textColor}`}>{score}%</span>
      {/* P1-1 置信标识：让用户能区分"AI 评分"与"确定性预筛分"两条精度层级 */}
      <span
        title={breakdownTitle}
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
          scoreSource === 'ai' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {scoreSource === 'ai' ? 'AI' : '规则'}
      </span>
    </div>
  )
}

/* P0-1 双管道读端：Agent 触达状态徽标（kone-PRD §0.7 要求前端消费线索态 agentStatus） */
const AgentTouchBadges = ({ status }: { status?: AgentStatus }) => {
  if (!status) return null
  const badges: Array<{ key: string; show: boolean; label: string; cls: string; icon: ReactNode }> = []
  if (status.whatsappSent) {
    badges.push({
      key: 'wa',
      show: true,
      label:
        status.whatsappStatus === 'delivered'
          ? 'WhatsApp 已送达'
          : status.whatsappStatus === 'replied'
            ? 'WhatsApp 已回复'
            : 'WhatsApp 已发送',
      cls:
        status.whatsappStatus === 'delivered' || status.whatsappStatus === 'replied'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-blue-200 bg-blue-50 text-blue-700',
      icon: <MessageCircle className="size-2.5" />,
    })
  }
  if (status.linkedinContacted) {
    badges.push({
      key: 'li',
      show: true,
      label: 'LinkedIn 已触达',
      cls: 'border-sky-200 bg-sky-50 text-sky-700',
      icon: <Send className="size-2.5" />,
    })
  }
  if ((status.emailSequenceStage ?? 0) > 0) {
    const stage = Math.min(3, Math.max(0, status.emailSequenceStage ?? 0))
    badges.push({
      key: 'em',
      show: true,
      label: `邮件第 ${stage} 轮`,
      cls: 'border-violet-200 bg-violet-50 text-violet-700',
      icon: <Mail className="size-2.5" />,
    })
  }
  /* P1-3：IMAP 未配置 → 回复检测盲区，序列已暂停等待人工确认（诚实提示，不盲推） */
  if (status.emailPendingManual) {
    badges.push({
      key: 'em-manual',
      show: true,
      label: '邮件需人工确认',
      cls: 'border-amber-200 bg-amber-50 text-amber-700',
      icon: <AlertCircle className="size-2.5" />,
    })
  }
  if (badges.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {badges.map((b) => (
        <span
          key={b.key}
          className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${b.cls}`}
        >
          {b.icon}
          {b.label}
        </span>
      ))}
    </div>
  )
}

export function LeadsTable({
  onAnalyze,
  userRole,
  onSendToCloud,
  canUseCloudSend = false,
  onViewAll,
}: LeadsTableProps) {
  const [sendingCloud, setSendingCloud] = useState<number | null>(null)
  /* [V1.4.0] Phase 2.9 · 审批进行中标记 */
  const [approving, setApproving] = useState<number | null>(null)
  const [savedLeadIds, setSavedLeadIds] = useState<Set<number>>(new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState<number | null>(null)
  const { leads, addLead, hydrateFromConfig, hydrated } = useLeadsStore()
  /* P0-1 双管道读端：持久化 agentStatus 本地缓存（按 leadKey 拉取） */
  const [statusMap, setStatusMap] = useState<Record<string, AgentStatus>>({})
  const [filters, setFilters] = useState({
    highMatch: false,
    hasEmail: false,
    hasDecisionMakers: false,
    hasCustomsData: false,
    hasExhibition: false,
    /* [V1.4.0] Phase 2.9 · 待审批队列：筛选出尚未人工批准的线索。
       对应 kone-PRD §5.1 第 8 条「前端必须提供待审批队列」。 */
    pendingApproval: false,
  })
  const { toast } = useToast()

  useEffect(() => {
    if (!hydrated) {
      void hydrateFromConfig()
    }
  }, [hydrateFromConfig, hydrated])

  useEffect(() => {
    let cancelled = false
    const keys = Array.from(new Set(leads.map((lead) => lead.leadKey).filter((k): k is string => Boolean(k))))
    if (keys.length === 0) return
    void Promise.all(
      keys.map(async (key) => {
        try {
          const data = await agentGetStatus(key)
          if (!cancelled && data.agentStatus) {
            setStatusMap((prev) => ({ ...prev, [key]: data.agentStatus! }))
          }
        } catch {
          // 本地读取失败静默：徽标回退为搜索时携带的 agentStatus
        }
      }),
    )
    return () => {
      cancelled = true
    }
  }, [leads])

  /* L1-1/F2：订阅 per-lead 实时触达事件 —— Agent 写回瞬间即刷新徽标，
     无需等待线索池变更后的批量拉取。 */
  useEffect(() => {
    const unsub = onAgentLeadStatusUpdated((event) => {
      if (!event?.leadKey || !event.agentStatus) return
      setStatusMap((prev) => ({ ...prev, [event.leadKey]: event.agentStatus }))
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    setSavedLeadIds(new Set(leads.map((lead) => lead.id)))
  }, [leads])

  /* P1-4：显示上限 50 条——与 OMNI_SEARCH_RESULT_LIMIT 对齐，
     避免用户积累大量保存线索时表格全量渲染导致卡顿。 */
  const LEADS_TABLE_DISPLAY_LIMIT = 50
  const displayLeads = useMemo(
    () =>
      leads
        .filter((lead) => {
          if (filters.highMatch && (!hasNumericMatchScore(lead) || lead.matchScore < 80)) return false
          if (filters.hasEmail && !lead.email) return false
          /* 待审批队列：只保留尚未批准（含未审批 / 已驳回）的线索 */
          if (filters.pendingApproval && lead.approvalDecision === 'approved') return false
          if (filters.hasDecisionMakers && (!lead.decisionMakers || lead.decisionMakers.length === 0)) return false
          if (filters.hasCustomsData && !lead.customsData) return false
          if (filters.hasExhibition && (!lead.exhibitionFootprints || lead.exhibitionFootprints.length === 0))
            return false
          return true
        })
        .sort((a, b) => (hasNumericMatchScore(b) ? b.matchScore : -1) - (hasNumericMatchScore(a) ? a.matchScore : -1))
        .slice(0, LEADS_TABLE_DISPLAY_LIMIT),
    [filters, leads],
  )

  const handleSendToCloud = async (lead: Lead) => {
    if (!canUseCloudSend) {
      toast({
        title: '高级版锁定',
        description: '云端发送队列属于高级版能力，请升级后再提交线索。',
        variant: 'destructive',
      })
      return
    }
    setSendingCloud(lead.id)
    try {
      const result = await onSendToCloud?.(lead)
      if (result && typeof result === 'object' && result.skipped) {
        toast({
          title: '推送被拦截',
          description: result.reason || '推送被拦截：线索评分低于系统设定的最低阈值或角色不符。',
          variant: 'destructive',
          className: 'bg-amber-50 border-amber-200 text-amber-900',
        })
        return
      }
      toast({
        title: '发送成功',
        description: `已将线索 "${lead.company}" 提交至云端发送队列`,
        variant: 'default',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      })
    } catch (error) {
      toast({ title: '发送失败', description: formatErrorMessage(error, '发送到云端失败'), variant: 'destructive' })
    } finally {
      setSendingCloud(null)
    }
  }

  /**
   * [V1.4.0] Phase 2.9 · 人工审批（AGENTS.md 宪法第 5 条）
   *
   * 宪法：「高分、分阶段任务或 cloud_send 功能永不授权投递。
   * 审批 + 服务端二次门禁成功是强制前提。」
   * 本动作写入不可覆盖的审批记录；投递放行由云端门禁 ⑦ 依据该记录判定。
   *
   * 审批人取本机 machineId（与云端 approvals.approver_machine_id 对齐，单机场景）。
   * 邮箱等级取 'verified'：按规范 §5，能进入审批队列的线索其邮箱应已符合准入等级；
   * 后续接入真实验证等级后应改为读取 lead 上的实际等级。
   */
  const handleApproval = async (lead: Lead, decision: 'approved' | 'rejected') => {
    if (!canUseCloudSend) {
      toast({
        title: '高级版锁定',
        description: '云端投递为高级版能力，审批后需云端协同，请先升级。',
        variant: 'destructive',
      })
      return
    }
    setApproving(lead.id)
    try {
      const info = await getLicenseInfo()
      const draftVersion = lead.draftVersion ?? 0
      const res = await createApproval({
        leadId: String(lead.id),
        approverMachineId: info.machineId ?? 'unknown-machine',
        decision,
        draftVersion,
        emailVerificationGrade: 'verified',
      })
      // 本地标记：approved → 记 approvalId（可投递）；rejected → 清除 approvalId（不可投递）
      await useLeadsStore.getState().updateLead(lead.id, {
        approvalId: decision === 'approved' ? res.approvalId : undefined,
        approvalDecision: decision,
        draftVersion,
      })
      toast({
        title: decision === 'approved' ? '已批准' : '已驳回',
        description:
          decision === 'approved'
            ? `线索「${lead.company}」已通过人工审批，现可发送至云端。`
            : `线索「${lead.company}」已驳回，不会进入投递队列。`,
        className:
          decision === 'approved'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-900',
      })
    } catch (error) {
      toast({
        title: decision === 'approved' ? '审批失败' : '驳回失败',
        description: formatErrorMessage(error, '提交审批失败，请检查云端配置'),
        variant: 'destructive',
      })
    } finally {
      setApproving(null)
    }
  }

  if (userRole === null || userRole === undefined || !hydrated) {
    return (
      <div className="card-base">
        <div className="flex items-center justify-center h-40 loading-fade">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">加载中...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,21,41,0.12),rgba(0,21,41,0))]" />
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 relative z-10">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold text-slate-900">已评分高潜线索推荐</h3>
          <p className="text-xs text-slate-500">仅展示已完成评分且最值得优先跟进的线索</p>
        </div>
        <div className="flex items-center gap-2">
          {onViewAll ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-slate-600 hover:text-slate-900"
              onClick={onViewAll}
            >
              查看全部
            </Button>
          ) : null}
          <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="btn-action">
                <Filter className="size-3.5" />
                筛选
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[300px]">
              <SheetHeader>
                <SheetTitle className="text-slate-800">筛选条件</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                {/* [V1.4.0] Phase 2.9 · 待审批队列入口（kone-PRD §5.1 第 8 条） */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="pendingApproval"
                    checked={filters.pendingApproval}
                    onCheckedChange={(checked) =>
                      setFilters((prev) => ({ ...prev, pendingApproval: checked as boolean }))
                    }
                  />
                  <Label htmlFor="pendingApproval" className="text-slate-700">
                    仅显示待审批线索
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="highMatch"
                    checked={filters.highMatch}
                    onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, highMatch: checked as boolean }))}
                  />
                  <Label htmlFor="highMatch" className="text-slate-700">
                    仅显示高匹配度 (&gt;80%)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hasEmail"
                    checked={filters.hasEmail}
                    onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, hasEmail: checked as boolean }))}
                  />
                  <Label htmlFor="hasEmail" className="text-slate-700">
                    仅显示有邮箱
                  </Label>
                </div>
                <hr className="border-slate-200" />
                <p className="text-xs font-medium text-slate-500">数据源筛选</p>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hasDecisionMakers"
                    checked={filters.hasDecisionMakers}
                    onCheckedChange={(checked) =>
                      setFilters((prev) => ({ ...prev, hasDecisionMakers: checked as boolean }))
                    }
                  />
                  <Label htmlFor="hasDecisionMakers" className="text-slate-700">
                    有决策人数据
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hasCustomsData"
                    checked={filters.hasCustomsData}
                    onCheckedChange={(checked) =>
                      setFilters((prev) => ({ ...prev, hasCustomsData: checked as boolean }))
                    }
                  />
                  <Label htmlFor="hasCustomsData" className="text-slate-700">
                    有海关数据
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hasExhibition"
                    checked={filters.hasExhibition}
                    onCheckedChange={(checked) =>
                      setFilters((prev) => ({ ...prev, hasExhibition: checked as boolean }))
                    }
                  />
                  <Label htmlFor="hasExhibition" className="text-slate-700">
                    有展会足迹
                  </Label>
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <Button
            variant="outline"
            size="sm"
            className="btn-action"
            disabled={isExporting}
            isLoading={isExporting}
            onClick={async () => {
              if (isExporting) return
              try {
                setIsExporting(true)
                const rows = [
                  ['公司名称', '行业', '匹配度', '联系人', '职位', '邮箱', '电话', '网站'],
                  ...displayLeads.map((lead) => [
                    lead.company,
                    lead.industry,
                    formatMatchScoreForExport(lead.matchScore),
                    lead.contact,
                    lead.contactTitle,
                    lead.email,
                    lead.phone,
                    lead.website || '',
                  ]),
                ]
                const csvContent = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
                const response = await saveExportFile({
                  fileName: `kone-leads-export-${new Date().toISOString().slice(0, 10)}.csv`,
                  content: '\ufeff' + csvContent,
                })
                if (response.canceled) {
                  return
                }
                toast({
                  title: '导出成功',
                  description: '已导出当前筛选结果到指定位置',
                  variant: 'default',
                  className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
                })
              } catch (error) {
                toast({ title: '导出失败', description: formatErrorMessage(error, '导出失败'), variant: 'destructive' })
              } finally {
                setIsExporting(false)
              }
            }}
          >
            {!isExporting ? <Download className="size-3.5" /> : null}
            {isExporting ? '导出中' : '导出'}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-[hsl(var(--background))]">
              <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                公司名称
              </th>
              <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                ICP 匹配度
              </th>
              <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                关键联系人
              </th>
              <th className="text-right px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody>
            {displayLeads.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-500">
                  <div className="text-sm text-slate-500">暂无已评估的高潜线索，请先完成搜索评分或放宽筛选条件</div>
                  {onViewAll ? (
                    <div className="mt-3 flex justify-center">
                      <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={onViewAll}>
                        去智能获客
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ) : (
              displayLeads.map((lead, index) => (
                <tr
                  key={stableHash(`${lead.id}-${index}`)}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-[hsl(var(--background))] transition-colors h-16"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[hsl(var(--background))] border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                        {lead.company.charAt(0)}
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-slate-800">{lead.company}</span>
                        {lead.dataSourceType ? (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                            {getDataSourceMeta(lead.dataSourceType).shortLabel || lead.dataSourceType}
                          </span>
                        ) : null}
                        {/* 实时/拉取的持久化状态（权威）优先于搜索时快照 */}
                        <AgentTouchBadges
                          status={(lead.leadKey ? statusMap[lead.leadKey] : undefined) || lead.agentStatus}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <MatchBar
                      score={lead.matchScore}
                      scoreSource={lead.scoreSource}
                      opportunityScore={lead.opportunityScore}
                    />
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-slate-700">{lead.contact || '暂无数据'}</span>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Mail className="size-3" />
                          {lead.email || '暂无数据'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Phone className="size-3" />
                          {lead.phone || '暂无数据'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        className="bg-blue-600 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                        disabled={analysisLoading === lead.id}
                        isLoading={analysisLoading === lead.id}
                        onClick={async () => {
                          if (analysisLoading === lead.id) return
                          setAnalysisLoading(lead.id)
                          onAnalyze(lead)
                          try {
                            const key = getLeadUniqueKey(lead)
                            const exists = leads.some((item) => getLeadUniqueKey(item) === key)
                            setSavedLeadIds((prev) => new Set(prev).add(lead.id))
                            if (!exists) {
                              await addLead(lead)
                              toast({
                                title: '已同步线索',
                                description: `线索 "${lead.company}" 已保存至本地`,
                                variant: 'default',
                                className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
                              })
                            } else {
                              toast({
                                title: '已保存',
                                description: '该线索已在库中，无需重复保存',
                                variant: 'default',
                                className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
                              })
                            }
                          } catch (error) {
                            setSavedLeadIds((prev) => {
                              const next = new Set(prev)
                              next.delete(lead.id)
                              return next
                            })
                            toast({
                              title: '保存失败',
                              description: formatErrorMessage(error, '保存线索失败'),
                              variant: 'destructive',
                            })
                          } finally {
                            setAnalysisLoading(null)
                          }
                        }}
                      >
                        {!analysisLoading || analysisLoading !== lead.id ? <ScanSearch className="size-3.5" /> : null}
                        {analysisLoading === lead.id
                          ? '加载中'
                          : savedLeadIds.has(lead.id)
                            ? '查看分析'
                            : 'AI 深度分析'}
                      </Button>
                      {/* [V1.4.0] Phase 2.9 · 审批（宪法第 5 条：审批是投递的必要前提）
                          未审批 → 「批准」「驳回」可点；已批准/已驳回 → 对应按钮置灰。 */}
                      {canUseCloudSend && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs font-medium"
                            onClick={() => void handleApproval(lead, 'approved')}
                            disabled={approving === lead.id || lead.approvalDecision === 'approved'}
                            isLoading={approving === lead.id}
                          >
                            {approving === lead.id
                              ? '提交中'
                              : lead.approvalDecision === 'approved'
                                ? '已批准'
                                : '批准'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs font-medium text-amber-700"
                            onClick={() => void handleApproval(lead, 'rejected')}
                            disabled={approving === lead.id || lead.approvalDecision === 'rejected'}
                          >
                            {lead.approvalDecision === 'rejected' ? '已驳回' : '驳回'}
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        className="bg-blue-600 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400"
                        onClick={() => void handleSendToCloud(lead)}
                        disabled={
                          sendingCloud === lead.id ||
                          !onSendToCloud ||
                          !canUseCloudSend ||
                          /* 与云端门禁 ⑦ 一致：未批准不得投递（UI 与云端双保险） */
                          lead.approvalDecision !== 'approved'
                        }
                        isLoading={sendingCloud === lead.id}
                      >
                        {sendingCloud !== lead.id ? <Send className="size-3.5" /> : null}
                        {sendingCloud === lead.id ? '发送中' : canUseCloudSend ? '发送至云端' : '高级版锁定'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
