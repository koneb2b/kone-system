/**
 * cloud-outreach-dashboard.tsx — 云端触达看板（Phase 2.7）
 *
 * 目的：把 Phase 2.4/2.5/2.6 落地的云端基础设施（投递、回复检测、IMAP 配置）
 * 通过可视化面板呈现出来——用户 30 秒掌握整体战况。
 *
 * 数据源：
 *  - CLOUD.CLOUDFLARE_DASHBOARD_STATS → KPI 聚合
 *  - CLOUD.CLOUDFLARE_POLL_OUTREACH_STATUS → 明细（漏斗 + 30 日趋势聚合）
 *  - AUTOMATION.IMAP_STATUS → 回复检测运行状态
 *
 * 三态展示：
 *  - configured=false（云端未连接）→ 顶部提示条 + 引导去设置
 *  - loading → skeleton 占位
 *  - ready → 8 张 KPI + IMAP 状态 + 漏斗 + 趋势 + 更新时间
 *
 * 计算口径（诚实标注，避免用户误读）：
 *  - 送达率 = delivered / (sent - bounced - complained)；分母为 0 显示 "—"
 *  - 回复率 = replied / sent；分母为 0 显示 "—"
 *  - 退信率 = bounced / sent；分母为 0 显示 "—"
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  ArrowDown,
  BarChart3,
  CheckCircle2,
  Circle,
  Download,
  Info,
  Inbox,
  Loader2,
  MailOpen,
  PlugZap,
  RefreshCw,
  Settings2,
  Send,
  ShieldAlert,
  ShieldCheck,
  Table2,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  cloudflareDashboardStats,
  cloudflarePollOutreachStatus,
  imapPoll,
  imapStatus,
  imapTestConnection,
} from '@/lib/electron-api'
import type { CloudDashboardStats, CloudImapTestResult, CloudOutreachRecord } from '../shared/ipc-contracts'

/* ─────────────── 视图状态 ─────────────── */

type ViewState = 'idle' | 'loading' | 'ready' | 'error'

/** 时间窗口：过滤漏斗 + 趋势 + 明细表；KPI 卡不受影响（始终展示云端聚合总量） */
type TimeWindow = '7d' | '30d' | '90d' | 'all'

const TIME_WINDOW_OPTIONS: Array<{ id: TimeWindow; label: string }> = [
  { id: '7d', label: '近 7 天' },
  { id: '30d', label: '近 30 天' },
  { id: '90d', label: '近 90 天' },
  { id: 'all', label: '全部' },
]

interface ImapStatusData {
  enabled: boolean
  intervalMs: number
  lookbackDays: number
  cloudflareConfigured: boolean
  imapConfigured: boolean
  running: boolean
  lastPoll: {
    at: string
    result: { polled: number; matched: number; reported: number; idempotent: number; errors: string[] }
  } | null
}

/* ─────────────── 展示工具 ─────────────── */

const pct = (num: number, den: number): string => {
  if (!den || den <= 0) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

const relTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s} 秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return d.toLocaleDateString('zh-CN')
}

const dayKey = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ─────────────── 子组件 ─────────────── */

interface KpiProps {
  label: string
  value: number | string
  hint?: string
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  icon: ReactNode
}

const KpiCard = ({ label, value, hint, tone = 'default', icon }: KpiProps) => {
  const toneClass = {
    default: 'border-slate-200 bg-card text-foreground',
    success: 'border-emerald-200 bg-emerald-50/60 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50/60 text-amber-800',
    danger: 'border-rose-200 bg-rose-50/60 text-rose-800',
    info: 'border-blue-200 bg-blue-50/60 text-blue-800',
  }[tone]

  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between text-xs font-medium opacity-70">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums leading-none">{value}</div>
      {hint ? <div className="mt-1 text-[11px] opacity-60">{hint}</div> : null}
    </div>
  )
}

const FunnelStage = ({
  label,
  value,
  ratio,
  color,
}: {
  label: string
  value: number
  ratio: number
  color: string
}) => {
  const widthPct = Math.max(12, Math.min(100, ratio * 100))
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="flex-1 h-7 rounded-md bg-slate-100 overflow-hidden relative">
        <div
          className="h-full flex items-center justify-end pr-2 transition-all duration-500"
          style={{ width: `${widthPct}%`, backgroundColor: color }}
        >
          <span className="text-[11px] font-medium text-white drop-shadow-sm">
            {value} · {ratio > 0 ? `${(ratio * 100).toFixed(1)}%` : '—'}
          </span>
        </div>
      </div>
      <div className="w-14 shrink-0 text-right text-xs tabular-nums text-foreground">{value}</div>
    </div>
  )
}

/* ─────────────── 主组件 ─────────────── */

export function CloudOutreachDashboard() {
  const { toast } = useToast()

  const [view, setView] = useState<ViewState>('idle')
  const [stats, setStats] = useState<CloudDashboardStats | null>(null)
  const [records, setRecords] = useState<CloudOutreachRecord[]>([])
  const [imap, setImap] = useState<ImapStatusData | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [configErr, setConfigErr] = useState<string | null>(null)
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('30d')
  /* [V1.3.12] Phase 2.8d · IMAP 主机连接测试 */
  const [imapTesting, setImapTesting] = useState(false)
  const [imapTestResult, setImapTestResult] = useState<CloudImapTestResult | null>(null)

  const load = useCallback(async () => {
    setView('loading')
    setConfigErr(null)
    try {
      const [statsRes, pollRes, imapRes] = await Promise.all([
        cloudflareDashboardStats(),
        cloudflarePollOutreachStatus({ limit: 300 }),
        imapStatus(),
      ])
      setStats(statsRes)
      setRecords(pollRes.outreach ?? [])
      setImap(imapRes as unknown as ImapStatusData)
      setLoadedAt(new Date())
      setView('ready')
    } catch (err) {
      setConfigErr(err instanceof Error ? err.message : String(err))
      setView('error')
    }
  }, [])

  /* ── [V1.3.13] Phase 2.8e · 静默刷新（不打断当前视图，仅更新数据） ── */
  const refreshSilent = useCallback(async () => {
    if (viewRef.current !== 'ready') return // 只在 ready 态做后台刷新
    try {
      const [statsRes, pollRes, imapRes] = await Promise.all([
        cloudflareDashboardStats(),
        cloudflarePollOutreachStatus({ limit: 300 }),
        imapStatus(),
      ])
      setStats(statsRes)
      setRecords(pollRes.outreach ?? [])
      setImap(imapRes as unknown as ImapStatusData)
      setLoadedAt(new Date())
    } catch {
      // 静默刷新失败不打扰用户（下一次周期会重试）
    }
  }, [])

  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    void load()
  }, [load])

  /* ── [V1.3.13] Phase 2.8e · 60s 自动刷新（仅前台可见时） ─────────────── */
  useEffect(() => {
    const interval = 60_000
    let timer: ReturnType<typeof setInterval> | null = null
    let paused = false

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        paused = false
        // 回到前台立即拉一次
        void refreshSilent()
      } else {
        paused = true
      }
    }

    timer = setInterval(() => {
      if (paused) return
      if (document.visibilityState !== 'visible') {
        paused = true
        return
      }
      void refreshSilent()
    }, interval)

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refreshSilent])

  /* ── 时间窗口过滤后的明细 ─────────────────── */
  const filteredRecords = useMemo(() => {
    if (timeWindow === 'all') return records
    const days = timeWindow === '7d' ? 7 : timeWindow === '30d' ? 30 : 90
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return records.filter((r) => {
      const ts = r.sentAt ? new Date(r.sentAt).getTime() : r.createdAt ? new Date(r.createdAt).getTime() : 0
      return ts >= cutoff
    })
  }, [records, timeWindow])

  /* ── 漏斗 & 趋势派生（按时间窗口过滤后计算） ────────────────────────────── */
  const funnel = useMemo(() => {
    if (!stats) return null
    if (filteredRecords.length === 0) {
      return [
        { label: '排队中', value: 0, ratio: 0, color: 'hsl(var(--neutral-gray) / 0.55)' },
        { label: '已发送', value: 0, ratio: 0, color: 'hsl(var(--deep-blue))' },
        { label: '已送达', value: 0, ratio: 0, color: 'hsl(var(--brand-green))' },
        { label: '退信', value: 0, ratio: 0, color: 'hsl(0 60% 55%)' },
        { label: '客户投诉', value: 0, ratio: 0, color: 'hsl(28 90% 55%)' },
        { label: '已回复', value: 0, ratio: 0, color: 'hsl(var(--brand-green))' },
      ]
    }
    const total = filteredRecords.length
    const sentCount = filteredRecords.filter((r) => r.sentAt).length
    const deliveredCount = filteredRecords.filter((r) => r.deliveredAt).length
    const bouncedCount = filteredRecords.filter((r) => r.bouncedAt).length
    const complainedCount = filteredRecords.filter((r) => r.complainedAt).length
    const repliedCount = filteredRecords.filter((r) => r.repliedAt).length
    const pendingCount = filteredRecords.filter((r) => !r.sentAt).length
    const sentDenom = Math.max(sentCount, 1)
    return [
      { label: '排队中', value: pendingCount, ratio: pendingCount / total, color: 'hsl(var(--neutral-gray) / 0.55)' },
      { label: '已发送', value: sentCount, ratio: sentCount / total, color: 'hsl(var(--deep-blue))' },
      { label: '已送达', value: deliveredCount, ratio: deliveredCount / sentDenom, color: 'hsl(var(--brand-green))' },
      { label: '退信', value: bouncedCount, ratio: bouncedCount / sentDenom, color: 'hsl(0 60% 55%)' },
      { label: '客户投诉', value: complainedCount, ratio: complainedCount / sentDenom, color: 'hsl(28 90% 55%)' },
      { label: '已回复', value: repliedCount, ratio: repliedCount / sentDenom, color: 'hsl(var(--brand-green))' },
    ]
  }, [stats, filteredRecords])

  const trend30 = useMemo(() => {
    if (filteredRecords.length === 0) return []
    const now = new Date()
    const rangeDays = timeWindow === '7d' ? 7 : timeWindow === '30d' ? 30 : timeWindow === '90d' ? 90 : 30
    const buckets = new Map<
      string,
      { date: string; sent: number; delivered: number; bounced: number; replied: number }
    >()
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      buckets.set(key, { date: key.slice(5), sent: 0, delivered: 0, bounced: 0, replied: 0 })
    }
    for (const r of filteredRecords) {
      if (r.sentAt) {
        const k = dayKey(r.sentAt)
        const b = buckets.get(k)
        if (b) b.sent++
      }
      if (r.deliveredAt) {
        const k = dayKey(r.deliveredAt)
        const b = buckets.get(k)
        if (b) b.delivered++
      }
      if (r.bouncedAt) {
        const k = dayKey(r.bouncedAt)
        const b = buckets.get(k)
        if (b) b.bounced++
      }
      if (r.repliedAt) {
        const k = dayKey(r.repliedAt)
        const b = buckets.get(k)
        if (b) b.replied++
      }
    }
    return Array.from(buckets.values())
  }, [filteredRecords, timeWindow])

  /* ── 计算率 ────────────────────────────── */
  const ratios = useMemo(() => {
    if (!stats) return { deliveryRate: '—', replyRate: '—', bounceRate: '—' }
    const sent = stats.outreach.sent
    if (sent <= 0) return { deliveryRate: '—', replyRate: '—', bounceRate: '—' }
    const effectiveDelivered = stats.outreach.delivered
    const effectiveBounced = stats.outreach.bounced
    const effectiveComplained = stats.outreach.complained
    // 送达率分母：只统计"已发且非终态退回"的量（sent - bounced - complained），避免投诉被计入送达
    const denominator = Math.max(sent - effectiveBounced - effectiveComplained, 0)
    return {
      deliveryRate: pct(effectiveDelivered, denominator),
      replyRate: pct(stats.leads.replied, sent),
      bounceRate: pct(effectiveBounced, sent),
    }
  }, [stats])

  /* ── 手动触发 IMAP 轮询 ───────────────────── */
  const handleTriggerImapPoll = useCallback(async () => {
    try {
      await imapPoll()
      void load()
      toast({ title: 'IMAP 轮询已触发', description: '结果将出现在上方 IMAP 状态区。' })
    } catch (err) {
      toast({
        title: 'IMAP 轮询失败',
        description: err instanceof Error ? err.message : '请检查 IMAP 配置或稍后重试。',
        variant: 'destructive',
      })
    }
  }, [load, toast])

  /* ── [V1.3.12] Phase 2.8d · IMAP 主机连接测试 ───────────────────── */
  const handleTestImapConnection = useCallback(async () => {
    setImapTesting(true)
    setImapTestResult(null)
    try {
      const res = await imapTestConnection()
      setImapTestResult(res)
    } catch (err) {
      setImapTestResult({
        ok: false,
        message: err instanceof Error ? err.message : '连接测试请求失败',
        latencyMs: 0,
      })
    } finally {
      setImapTesting(false)
    }
  }, [])

  /* ── 导出 CSV（当前时间窗口过滤后的明细） ─────────────── */
  const exportCsv = useCallback((rows: CloudOutreachRecord[]) => {
    const header = ['发送时间', '主题', '状态', '错误', 'Provider', 'MessageID', '发送尝试次数', 'LeadID', 'CampaignID']
    const escape = (v: unknown): string => {
      const s = v == null ? '' : String(v)
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push(
        [
          escape(r.sentAt ?? r.createdAt),
          escape(r.subject),
          escape(r.status),
          escape(r.error),
          escape(r.provider),
          escape(r.providerMessageId),
          escape(r.sendAttempts),
          escape(r.leadId),
          escape(r.campaignId),
        ].join(','),
      )
    }
    // UTF-8 BOM 让 Excel 打开中文不乱码
    const csv = '\uFEFF' + lines.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `cloud-outreach-${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  /* ── 空态：云端未配置或加载失败 ─────────────────────── */
  if (view === 'idle' || view === 'error') {
    return (
      <section className="rounded-xl border border-dashed border-amber-300 bg-amber-50/40 p-6 text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-amber-100">
          <Info className="size-5 text-amber-700" />
        </div>
        <h3 className="text-sm font-semibold text-amber-900">云端触达看板暂未启用</h3>
        <p className="mt-1 text-xs text-amber-700">
          {configErr ? `Cloudflare 云端引擎未连接或调用失败：${configErr}` : '请先到「设置 · 云端引擎」完成连接配置。'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
            重试
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void window.dispatchEvent(new CustomEvent('kone:navigate', { detail: 'settings' }))}
          >
            <Settings2 className="size-3.5" />
            前往设置
          </Button>
        </div>
      </section>
    )
  }

  /* ── 加载中 ─────────────────────── */
  if (view === 'loading') {
    return (
      <section className="rounded-xl border border-slate-200 bg-card p-6 flex items-center justify-center gap-3">
        <Loader2 className="size-5 animate-spin text-blue-600" />
        <span className="text-sm text-muted-foreground">正在同步云端触达数据…</span>
      </section>
    )
  }

  /* ── 就绪：完整看板 ─────────────────────── */
  const totalFunnel = stats!.outreach.total
  const denomMax = Math.max(
    stats!.outreach.pending,
    stats!.outreach.sent,
    stats!.outreach.delivered,
    stats!.outreach.bounced,
    stats!.outreach.complained,
    stats!.leads.replied,
    1,
  )

  return (
    <section className="rounded-xl border border-slate-200 bg-card p-5 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-foreground">云端触达看板</h3>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            投递漏斗 · 30 日趋势 · IMAP 回复检测状态
            {loadedAt && (
              <span className="ml-2 text-slate-400">
                更新于 {loadedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          刷新
        </Button>
      </div>

      {/* KPI 网格：8 卡 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="排队中" value={stats!.outreach.pending} tone="default" icon={<Inbox className="size-3.5" />} />
        <KpiCard label="已发送" value={stats!.outreach.sent} tone="info" icon={<Send className="size-3.5" />} />
        <KpiCard
          label="已送达"
          value={stats!.outreach.delivered}
          tone="success"
          icon={<CheckCircle2 className="size-3.5" />}
        />
        <KpiCard label="已回复" value={stats!.leads.replied} tone="success" icon={<MailOpen className="size-3.5" />} />
        <KpiCard label="退信" value={stats!.outreach.bounced} tone="danger" icon={<XCircle className="size-3.5" />} />
        <KpiCard
          label="投诉"
          value={stats!.outreach.complained}
          tone="warning"
          icon={<ShieldAlert className="size-3.5" />}
        />
        <KpiCard
          label="发送失败"
          value={stats!.outreach.failed}
          tone="warning"
          icon={<Circle className="size-3.5" />}
        />
        <KpiCard label="同步版本" value={stats!.syncVersion} tone="default" icon={<Activity className="size-3.5" />} />
      </div>

      {/* 三大比率 */}
      <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-col items-center">
          <div className="text-[11px] text-muted-foreground">送达率</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">{ratios.deliveryRate}</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-[11px] text-muted-foreground">回复率</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-blue-700">{ratios.replyRate}</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-[11px] text-muted-foreground">退信率</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-rose-700">{ratios.bounceRate}</div>
        </div>
      </div>

      {/* 时间窗口筛选（影响下方漏斗 / 趋势 / 明细） */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-card px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>时间窗口</span>
          <div className="flex gap-1">
            {TIME_WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTimeWindow(opt.id)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  timeWindow === opt.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            当前窗口共 <span className="font-medium text-foreground tabular-nums">{filteredRecords.length}</span> 条投递
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportCsv(filteredRecords)}
            disabled={filteredRecords.length === 0}
          >
            <Download className="size-3" />
            导出 CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* 左：投递漏斗 */}
        <div className="rounded-xl border border-slate-200 bg-card p-4 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowDown className="size-4 text-blue-600" />
              <span className="text-sm font-semibold">投递漏斗</span>
            </div>
            <span className="text-[11px] text-muted-foreground">总量 {totalFunnel}</span>
          </div>
          <div className="flex flex-col gap-2">
            {funnel!.map((stage) => (
              <FunnelStage
                key={stage.label}
                label={stage.label}
                value={stage.value}
                ratio={Math.max(stage.value / denomMax, 0)}
                color={stage.color}
              />
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
            注：送达/退信/投诉/回复均以「已发送」为分母；送达率进一步扣除退信与投诉，反映真实到达客户邮箱的比例。
          </p>
        </div>

        {/* 右：IMAP 状态 + 趋势 */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* IMAP 状态 */}
          <div className="rounded-xl border border-slate-200 bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-600" />
                <span className="text-sm font-semibold">IMAP 回复检测</span>
              </div>
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-medium ${imap!.imapConfigured ? 'text-emerald-700' : 'text-amber-700'}`}
              >
                <span className={`size-1.5 rounded-full ${imap!.imapConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                {imap!.imapConfigured ? '已配置' : '未配置'}
              </span>
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <div className="flex justify-between">
                <span>云端引擎</span>
                <span className="text-foreground">{imap!.cloudflareConfigured ? '已连接' : '未连接'}</span>
              </div>
              <div className="flex justify-between">
                <span>轮询间隔</span>
                <span className="text-foreground">
                  {imap!.enabled ? `${(imap!.intervalMs / 60000).toFixed(0)} 分钟` : '未启用'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>回溯天数</span>
                <span className="text-foreground">{imap!.lookbackDays}</span>
              </div>
              <div className="flex justify-between">
                <span>运行状态</span>
                <span className="text-foreground">{imap!.running ? '运行中' : '空闲'}</span>
              </div>
              {imap!.lastPoll && (
                <>
                  <div className="mt-2 pt-2 border-t border-slate-100 text-[10px]">
                    <div className="flex justify-between">
                      <span>上次轮询</span>
                      <span className="text-foreground">{relTime(imap!.lastPoll.at)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>扫描邮件</span>
                      <span className="text-foreground">{imap!.lastPoll.result.polled}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>命中回复</span>
                      <span className="text-foreground">{imap!.lastPoll.result.matched}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>上报成功</span>
                      <span className="text-foreground">{imap!.lastPoll.result.reported}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>幂等跳过</span>
                      <span className="text-foreground">{imap!.lastPoll.result.idempotent}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={imapTesting}
                onClick={() => void handleTestImapConnection()}
              >
                {imapTesting ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                {imapTesting ? '测试中…' : '测试连接'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleTriggerImapPoll()}>
                <RefreshCw className="size-3.5" />
                立即轮询一次
              </Button>
            </div>
            {imapTestResult && (
              <div
                className={`mt-2 rounded-md border px-2.5 py-1.5 text-[11px] ${imapTestResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}
              >
                <div className="flex items-start gap-1.5">
                  {imapTestResult.ok ? (
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
                  ) : (
                    <XCircle className="mt-0.5 size-3 shrink-0" />
                  )}
                  <div className="flex-1 break-all">
                    <div className="font-medium">{imapTestResult.ok ? '连接成功' : '连接失败'}</div>
                    <div className="mt-0.5 leading-relaxed">{imapTestResult.message}</div>
                    {typeof imapTestResult.latencyMs === 'number' && imapTestResult.latencyMs > 0 && (
                      <div className="mt-1 text-[10px] opacity-80">延迟 {imapTestResult.latencyMs}ms</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 30 日趋势 */}
          <div className="rounded-xl border border-slate-200 bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="size-4 text-blue-600" />
              <span className="text-sm font-semibold">
                {timeWindow === 'all'
                  ? '投递趋势'
                  : `近 ${timeWindow === '7d' ? '7' : timeWindow === '30d' ? '30' : '90'} 天投递趋势`}
              </span>
            </div>
            {trend30.every((d) => d.sent + d.delivered + d.replied === 0) ? (
              <div className="flex h-28 items-center justify-center text-xs text-muted-foreground">
                当前时间窗口内无投递数据
              </div>
            ) : (
              <SimpleTrendChart data={trend30} />
            )}
          </div>
        </div>
      </div>

      {/* 投递明细表 */}
      <div className="rounded-xl border border-slate-200 bg-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Table2 className="size-4 text-blue-600" />
            <span className="text-sm font-semibold">投递明细</span>
            <span className="text-[11px] text-muted-foreground">
              最近 {Math.min(filteredRecords.length, 50)} / {filteredRecords.length} 条
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportCsv(filteredRecords)}
            disabled={filteredRecords.length === 0}
          >
            <Download className="size-3" />
            导出全部 CSV
          </Button>
        </div>
        <OutreachTable records={filteredRecords.slice(0, 50)} />
      </div>
    </section>
  )
}

/* ─────────────── 投递明细表 ─────────────── */

const STATUS_META: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'muted' }> = {
  pending: { label: '排队中', tone: 'muted' },
  sent: { label: '已发送', tone: 'info' },
  delivered: { label: '已送达', tone: 'success' },
  bounced: { label: '退信', tone: 'danger' },
  complained: { label: '投诉', tone: 'warning' },
  failed: { label: '失败', tone: 'warning' },
  replied: { label: '已回复', tone: 'success' },
}

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const OutreachTable = ({ records }: { records: CloudOutreachRecord[] }) => {
  if (records.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
        当前时间窗口内暂无投递明细
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/60 text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">时间</th>
            <th className="px-3 py-2 text-left font-medium">主题</th>
            <th className="px-3 py-2 text-left font-medium">状态</th>
            <th className="px-3 py-2 text-left font-medium">Provider</th>
            <th className="px-3 py-2 text-left font-medium">Message ID</th>
            <th className="px-3 py-2 text-left font-medium">尝试</th>
            <th className="px-3 py-2 text-left font-medium">失败原因</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const meta = STATUS_META[r.status] ?? { label: r.status, tone: 'muted' as const }
            const toneClass = {
              success: 'bg-emerald-100 text-emerald-800',
              info: 'bg-blue-100 text-blue-800',
              warning: 'bg-amber-100 text-amber-800',
              danger: 'bg-rose-100 text-rose-800',
              muted: 'bg-slate-100 text-slate-600',
            }[meta.tone]
            return (
              <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-foreground">
                  {fmtDateTime(r.sentAt ?? r.createdAt)}
                </td>
                <td className="max-w-[260px] truncate px-3 py-1.5 text-foreground" title={r.subject}>
                  {r.subject || '—'}
                </td>
                <td className="px-3 py-1.5">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${toneClass}`}>
                    {meta.label}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.provider || '—'}</td>
                <td
                  className="max-w-[180px] truncate px-3 py-1.5 font-mono text-[10px] text-muted-foreground"
                  title={r.providerMessageId || ''}
                >
                  {r.providerMessageId || '—'}
                </td>
                <td className="px-3 py-1.5 text-center tabular-nums text-muted-foreground">{r.sendAttempts}</td>
                <td className="max-w-[220px] truncate px-3 py-1.5 text-rose-600" title={r.error || ''}>
                  {r.error || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ─────────────── 迷你趋势图 ─────────────── */

/**
 * 极简 SVG 迷你趋势图（无第三方依赖），仅用于看板角落。
 * 主图表在 data-center 已用 recharts，此处用 SVG 避免引入额外复杂度。
 */
const SimpleTrendChart = ({ data }: { data: { date: string; sent: number; delivered: number; replied: number }[] }) => {
  const W = 280
  const H = 110
  const pad = 8
  const max = Math.max(1, ...data.map((d) => Math.max(d.sent, d.delivered, d.replied)))
  const xStep = data.length > 1 ? (W - pad * 2) / (data.length - 1) : 0

  const toPoints = (key: 'sent' | 'delivered' | 'replied') =>
    data
      .map((d, i) => {
        const x = pad + i * xStep
        const y = H - pad - (d[key] / max) * (H - pad * 2)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')

  const first = data[0]?.date ?? ''
  const last = data[data.length - 1]?.date ?? ''

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
        {/* 网格 */}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="hsl(var(--chart-axis))" strokeDasharray="2 3" />
        <line x1={pad} y1={pad} x2={W - pad} y2={pad} stroke="hsl(var(--chart-axis))" strokeDasharray="2 3" />
        {/* 三系列 */}
        <polyline points={toPoints('sent')} fill="none" stroke="hsl(var(--deep-blue))" strokeWidth="2" />
        <polyline points={toPoints('delivered')} fill="none" stroke="hsl(var(--brand-green))" strokeWidth="2" />
        <polyline
          points={toPoints('replied')}
          fill="none"
          stroke="hsl(160 70% 45%)"
          strokeWidth="2"
          strokeDasharray="3 2"
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{first}</span>
        <div className="flex gap-2">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-blue-600" />
            发送
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-emerald-600" />
            送达
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-teal-500" />
            回复
          </span>
        </div>
        <span>{last}</span>
      </div>
    </div>
  )
}
