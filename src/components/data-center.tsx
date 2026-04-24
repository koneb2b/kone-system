"use client"

import { useEffect, useMemo, useState } from "react"
import {
  TrendingUp,
  TrendingDown,
  Globe,
  Users,
  Zap,
  BarChart3,
  ArrowUpRight,
  Calendar,
  Download,
  RefreshCw,
  Phone,
  Clock3,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { stableHash } from "@/lib/utils"
import { normalizeLeadStatus, type LeadStatus, useLeadsStore } from "@/store/leads-store"
import { saveExportFile } from "@/lib/electron-api"
import { useFeatureGate } from "@/lib/feature-gate"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
} from "recharts"

const formatErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback
  const normalized = message.toLowerCase()
  if (/403|401|授权|license|无权/.test(normalized)) return `授权异常：${message}`
  if (/network|timeout|fetch|socket|econn|enet/.test(normalized)) return `网络异常：${message}`
  if (/write|file|export|downloads|path/.test(normalized)) return `文件写入异常：${message}`
  if (/config|missing|base url|key/.test(normalized)) return `配置异常：${message}`
  return `系统异常：${message}`
}

const emptyTrend = [{ date: "--", leads: 0 }]

const hasNumericMatchScore = <T extends { matchScore?: number | null }>(lead: T): lead is T & { matchScore: number } => typeof lead.matchScore === "number"

const chartColors = {
  primary: "hsl(var(--deep-blue))",
  success: "hsl(var(--brand-green))",
  primarySoft: "hsl(var(--chart-blue-soft))",
  successSoft: "hsl(var(--chart-green-soft))",
  warning: "hsl(var(--deep-blue) / 0.55)",
  purple: "hsl(var(--deep-blue) / 0.4)",
  muted: "hsl(var(--brand-green) / 0.45)",
  border: "hsl(var(--chart-axis))",
  axisText: "hsl(var(--neutral-gray))",
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border rounded-lg shadow-lg backdrop-blur-sm p-3">
        <p className="text-xs font-medium text-foreground/80 mb-1">{label}</p>
        {payload.map((entry, index) => (
          <p key={stableHash(`${entry.name || "item"}-${index}`)} className="text-xs" style={{ color: entry.color }}>
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    )
  }
  return null
}

function MetricInsightCard({
  eyebrow,
  metricLabel,
  metricValue,
  formula,
  title,
  tone,
  children,
}: {
  eyebrow: string
  metricLabel: string
  metricValue: string
  formula: string
  title: string
  tone: "healthy" | "warning" | "good" | "excellent" | "critical"
  children: string | string[]
}) {
  const toneClassMap = {
    healthy: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
    excellent: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
    good: "border-blue-200 bg-blue-50/70 text-slate-800",
    warning: "border-amber-200 bg-amber-50/80 text-amber-900",
    critical: "border-rose-200 bg-rose-50 text-rose-800",
  } as const

  return (
    <section className={`rounded-xl border px-4 py-4 ${toneClassMap[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] opacity-70">{eyebrow}</div>
          <div className="mt-2 text-xs opacity-80">{metricLabel}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{metricValue}</div>
          <div className="mt-1 max-w-[180px] text-[10px] leading-4 text-slate-400">{formula}</div>
        </div>
      </div>
      <div className="mt-3 border-t border-current/10 pt-3">
        <div className="text-sm font-semibold">{title}</div>
        {Array.isArray(children) ? (
          <div className="mt-2 space-y-2 text-sm leading-6">
            <div>{children[0]}</div>
            {children.length > 1 ? (
              <ul className="list-disc space-y-1 pl-5">
                {children.slice(1).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="mt-2 text-sm leading-6">{children}</div>
        )}
      </div>
    </section>
  )
}

const getDateWindow = (period: string) => {
  const days = period === "week" ? 7 : period === "quarter" ? 90 : 30
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

const normalizeDateKey = (value?: string) => {
  if (!value) return ""
  return value.slice(0, 10)
}

const stageLabels: Record<LeadStatus, string> = {
  new: "待跟进",
  contacting: "联系中",
  replied: "已回复",
  archived: "已归档",
}

const stageColors: Record<LeadStatus, string> = {
  new: chartColors.primary,
  contacting: chartColors.warning,
  replied: chartColors.success,
  archived: chartColors.muted,
}

const getLeadStage = (lead: { status?: string; followUp?: string }): LeadStatus =>
  normalizeLeadStatus(lead.status || lead.followUp)

const parseActivityRank = (lead: { addedDate?: string; lastActivity?: string }) => {
  const addedTs = Date.parse(normalizeDateKey(lead.addedDate))
  const activity = String(lead.lastActivity || "")
  if (/刚刚/.test(activity)) return Number.isFinite(addedTs) ? addedTs + 1000 : Date.now()
  const minuteMatch = activity.match(/(\d+)\s*分钟/)
  if (minuteMatch) return Date.now() - Number(minuteMatch[1]) * 60 * 1000
  const hourMatch = activity.match(/(\d+)\s*小时/)
  if (hourMatch) return Date.now() - Number(hourMatch[1]) * 60 * 60 * 1000
  return Number.isFinite(addedTs) ? addedTs : 0
}

export function DataCenter({ onLeadsNavigate, onAcquireNavigate }: { onLeadsNavigate?: () => void; onAcquireNavigate?: () => void }) {
  const [period, setPeriod] = useState("month")
  const [isMounted, setIsMounted] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const { leads, hydrateFromConfig, hydrated } = useLeadsStore()
  const featureGate = useFeatureGate()
  const exportLimit = featureGate.getExportLimit()
  const { toast } = useToast()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!hydrated) {
      void hydrateFromConfig()
    }
  }, [hydrateFromConfig, hydrated])

  const todayKey = new Date().toISOString().slice(0, 10)
  const contactedCount = useMemo(() => leads.filter((lead) => getLeadStage(lead) !== "new").length, [leads])
  const highScoreCount = useMemo(() => leads.filter((lead) => hasNumericMatchScore(lead) && lead.matchScore > 80).length, [leads])
  const stageCounts = useMemo(() => {
    const counts: Record<LeadStatus, number> = {
      new: 0,
      contacting: 0,
      replied: 0,
      archived: 0,
    }
    leads.forEach((lead) => {
      counts[getLeadStage(lead)] += 1
    })
    return counts
  }, [leads])

  const executionBase = stageCounts.contacting + stageCounts.replied
  const executionRate = leads.length > 0 ? executionBase / leads.length : 0
  const replyRate = executionBase > 0 ? stageCounts.replied / executionBase : 0

  const executionInsight = useMemo(() => {
    if (executionRate < 0.3) {
      return {
        tone: "warning" as const,
        label: "执行预警",
        title: "线索消化率偏低",
        value: `${Math.round(executionRate * 100)}%`,
        body: "高分线索积压严重。请勿盲目突增单日发信量（极易触发垃圾邮件拦截）。建议规划合理的日均发送上限，匀速消化 >80 分的核心线索。",
      }
    }

    return {
      tone: "healthy" as const,
      label: "执行健康",
      title: "线索消化节奏稳定",
      value: `${Math.round(executionRate * 100)}%`,
      body: "线索消化节奏健康。发信频率处于安全区间，建议继续保持。",
    }
  }, [executionRate])

  const replyInsight = useMemo(() => {
    const value = `${Math.round(replyRate * 100)}%`
    if (replyRate < 0.05) {
      return {
        tone: "critical" as const,
        label: "深度警告",
        title: "回复率异常偏低 (< 5%)",
        value,
        body: [
          "回复率异常偏低 (< 5%)。",
          "诊断建议：",
          "1. 技术面：排查发信域名 SPF/DKIM/DMARC 配置，防范 Spam 拦截；",
          "2. 内容面：清理邮件冗余链接与敏感营销词；",
          "3. 策略面：优化 ICP 核心优势设定。",
        ],
      }
    }

    if (replyRate <= 0.12) {
      return {
        tone: "good" as const,
        label: "表现良好",
        title: "回复率处于健康区间",
        value,
        body: "回复率处于健康区间。建议对‘联系中’的线索规划节奏合理的二次跟进 (Follow-up) 以激活沉睡客户。",
      }
    }

    return {
      tone: "excellent" as const,
      label: "表现优异",
      title: "回复表现优异",
      value,
      body: "回复表现优异，说明当前名单质量、发信基础设施与话术匹配度较高。建议优先复盘高回复样本，沉淀可复制的行业模板与优势表达。",
    }
  }, [replyRate])

  const overviewStats = useMemo(() => {
    const total = leads.length
    const todayAdded = leads.filter((lead) => normalizeDateKey(lead.addedDate) === todayKey).length
    const validLeads = leads.filter(hasNumericMatchScore)
    const avgMatch = validLeads.length > 0 ? Math.round(validLeads.reduce((sum, lead) => sum + lead.matchScore, 0) / validLeads.length) : null
    return [
      { label: "总线索数", value: total.toLocaleString(), change: total ? "实时" : "-", up: true, icon: Users, color: "text-[hsl(var(--deep-blue))]", bgColor: "bg-blue-50" },
      { label: "今日新增", value: todayAdded.toLocaleString(), change: todayAdded ? "新增" : "-", up: todayAdded > 0, icon: Calendar, color: "text-[hsl(var(--brand-green))]", bgColor: "bg-emerald-50" },
      { label: "已触达客户", value: contactedCount.toLocaleString(), change: contactedCount ? "跟进中" : "-", up: true, icon: Phone, color: "text-amber-600", bgColor: "bg-amber-50" },
      { label: "高分线索数", value: highScoreCount.toLocaleString(), change: typeof avgMatch === "number" ? `均值 ${avgMatch}%` : "--", up: highScoreCount > 0, icon: BarChart3, color: "text-[hsl(var(--deep-blue))]", bgColor: "bg-blue-50" },
    ]
  }, [contactedCount, highScoreCount, leads, todayKey])

  const regionData = useMemo(() => {
    const totals = new Map<string, number>()
    leads.forEach((lead) => {
      const key = lead.country || "未知"
      totals.set(key, (totals.get(key) || 0) + 1)
    })
    return Array.from(totals.entries())
      .map(([region, count]) => ({ region, leads: count }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 8)
  }, [leads])

  const industryData = useMemo(() => {
    const totals = new Map<string, { count: number; score: number }>()
    leads.forEach((lead) => {
      if (typeof lead.matchScore !== "number") return
      const key = lead.industry || "其他"
      const current = totals.get(key) || { count: 0, score: 0 }
      current.count += 1
      current.score += lead.matchScore
      totals.set(key, current)
    })
    return Array.from(totals.entries())
      .map(([industry, meta]) => ({
        industry,
        leads: meta.count,
        matchRate: meta.count > 0 ? Math.round(meta.score / meta.count) : 0,
      }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 6)
  }, [leads])

  const funnelData = useMemo(() => {
      const total = leads.length
      const stages = (["new", "contacting", "replied", "archived"] as LeadStatus[]).map((stage) => ({
        stage: stageLabels[stage],
        count: stageCounts[stage],
        color: stageColors[stage],
      }))
      return stages.map((stage) => ({
        ...stage,
        rate: total ? `${Math.round((stage.count / total) * 100)}%` : "0%",
      }))
  }, [leads, stageCounts])

  const statusData = useMemo(() => {
    const items = (["new", "contacting", "replied", "archived"] as LeadStatus[]).map((stage) => ({
      name: stageLabels[stage],
      value: stageCounts[stage],
      color: stageColors[stage],
    }))
    return items.filter((item) => item.value > 0)
  }, [stageCounts])

  const latestPriorityLeads = useMemo(() => {
    return leads
      .filter(hasNumericMatchScore)
      .sort((a, b) => {
        const scoreDelta = b.matchScore - a.matchScore
        if (scoreDelta !== 0) return scoreDelta
        return parseActivityRank(b) - parseActivityRank(a)
      })
      .slice(0, 5)
  }, [leads])

  const dailyTrend = useMemo(() => {
    if (!leads.length) return emptyTrend
    const { start, end } = getDateWindow(period)
    const dayMap = new Map<string, number>()
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      dayMap.set(cursor.toISOString().slice(5, 10), 0)
    }
    leads.forEach((lead) => {
      const date = new Date(normalizeDateKey(lead.addedDate))
      if (Number.isNaN(date.getTime())) return
      if (date < start || date > end) return
      const key = date.toISOString().slice(5, 10)
      dayMap.set(key, (dayMap.get(key) || 0) + 1)
    })
    return Array.from(dayMap.entries()).map(([date, count]) => ({ date, leads: count }))
  }, [leads, period])

  const handleExportReport = async () => {
    if (isExporting) return
    if (!exportLimit.enabled) {
      toast({ title: "当前套餐不可导出", description: "请升级授权后再导出完整报表。", variant: "destructive" })
      return
    }
    try {
      setIsExporting(true)
      const headers = ["date", "leads"]
      const limitedTrend = exportLimit.maxRows === null ? dailyTrend : dailyTrend.slice(0, exportLimit.maxRows)
      const rows = limitedTrend.map((item) => [item.date, item.leads].join(","))
      const response = await saveExportFile({ fileName: `kone-data-report-${new Date().toISOString().slice(0, 10)}.csv`, content: [headers.join(","), ...rows].join("\n") })
      if (response.canceled) {
        return
      }
      toast({ title: "报表已导出", description: "请在所选位置查看", variant: "default", className: "bg-emerald-50 border-emerald-200 text-emerald-800" })
    } catch (error) {
      toast({ title: "导出失败", description: formatErrorMessage(error, "导出失败"), variant: "destructive" })
    } finally {
      setIsExporting(false)
    }
  }

  const handleRefresh = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await hydrateFromConfig()
      toast({ title: "刷新完成", description: "已同步最新线索统计", variant: "default", className: "bg-emerald-50 border-emerald-200 text-emerald-800" })
    } catch (error) {
      toast({ title: "刷新失败", description: formatErrorMessage(error, "刷新失败"), variant: "destructive" })
    } finally {
      setIsRefreshing(false)
    }
  }

  if (!hydrated) {
    return <div className="rounded-2xl border border-border bg-card p-10 text-sm text-muted-foreground">正在加载数据中心...</div>
  }

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">数据概览</h2>
          <p className="text-xs text-muted-foreground">实时基于统一线索池统计</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 w-[120px] border-slate-200 bg-white text-xs text-slate-500 transition-colors hover:border-blue-600">
              <Calendar className="size-3.5 text-slate-500" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">近 7 天</SelectItem>
              <SelectItem value="month">近 30 天</SelectItem>
              <SelectItem value="quarter">近 90 天</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50" onClick={() => void handleRefresh()} disabled={isRefreshing} isLoading={isRefreshing}>{!isRefreshing ? <RefreshCw className="size-3.5" /> : null}刷新</Button>
          <Button variant="outline" size="sm" className="h-9 border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50" onClick={handleExportReport} disabled={isExporting || !exportLimit.enabled || featureGate.loading} isLoading={isExporting}>{!isExporting ? <Download className="size-3.5" /> : null}{isExporting ? "导出中" : "导出报表"}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {overviewStats.map((stat, index) => {
          const Icon = stat.icon
          return (
            <div key={stableHash(`${stat.label}-${index}`)} className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3 shadow-sm relative overflow-hidden">
              <div className="pointer-events-none absolute -right-8 -top-10 size-36 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,21,41,0.12),rgba(0,21,41,0))]" />
              <div className={`size-10 rounded-xl ${stat.bgColor} flex items-center justify-center shrink-0`}><Icon className={`size-5 ${stat.color}`} /></div>
              <div className="flex flex-col gap-0.5 min-w-0"><span className="text-xs text-muted-foreground font-medium truncate">{stat.label}</span><div className="flex items-baseline gap-2"><span className="text-xl font-bold text-foreground tabular-nums">{stat.value}</span><span className={`text-xs font-medium flex items-center gap-0.5 ${stat.up ? "text-[hsl(var(--brand-green))]" : "text-red-500"}`}>{stat.up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}{stat.change}</span></div></div>
            </div>
          )
        })}
      </div>

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center"><div className="text-base font-semibold text-foreground">暂无线索数据</div><div className="mt-2 text-xs text-muted-foreground">完成一次智能获客搜索后，数据中心将展示真实统计图表</div><div className="mt-4 flex justify-center"><Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => onAcquireNavigate?.()}>去智能获客</Button></div></div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-card rounded-2xl border border-border overflow-hidden shadow-sm"><div className="flex items-center justify-between px-5 py-4 border-b border-border/60"><h3 className="text-sm font-semibold text-foreground">线索新增趋势</h3></div><div className="p-5 min-h-[300px] h-72">{isMounted ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={dailyTrend}><defs><linearGradient id="leadGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={chartColors.primarySoft} stopOpacity={0.32} /><stop offset="95%" stopColor={chartColors.primarySoft} stopOpacity={0.04} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11, fill: chartColors.axisText }} axisLine={{ stroke: chartColors.border }} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: chartColors.axisText }} axisLine={{ stroke: chartColors.border }} tickLine={false} /><Tooltip content={<CustomTooltip />} /><Area type="monotone" dataKey="leads" stroke={chartColors.primarySoft} fill="url(#leadGradient)" strokeWidth={2} name="新增线索" /></AreaChart></ResponsiveContainer> : null}</div></div>
            <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm"><div className="px-5 py-4 border-b border-border/60"><h3 className="text-sm font-semibold text-foreground">线索状态分布</h3></div><div className="p-5 flex flex-col items-center"><div className="min-h-[300px] h-48 w-full">{isMounted ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">{statusData.map((entry, index) => <Cell key={stableHash(`${entry.name}-${index}`)} fill={entry.color} />)}</Pie><Tooltip content={<CustomTooltip />} /></PieChart></ResponsiveContainer> : null}</div><div className="flex flex-wrap gap-x-4 gap-y-2 mt-2 justify-center">{statusData.map((item, index) => <div key={stableHash(`${item.name}-${index}`)} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 rounded-full" style={{ background: item.color }} />{item.name} ({item.value})</div>)}</div></div></div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm"><div className="flex items-center justify-between px-5 py-4 border-b border-border/60"><h3 className="text-sm font-semibold text-foreground">目标区域分析</h3><Badge variant="secondary" className="text-xs bg-muted text-muted-foreground border-border"><Globe className="size-3 mr-1" />{regionData.length} 个区域</Badge></div><div className="p-5 min-h-[300px] h-72">{isMounted ? <ResponsiveContainer width="100%" height="100%"><BarChart data={regionData} layout="vertical" barSize={14}><CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} horizontal={false} /><XAxis type="number" tick={{ fontSize: 11, fill: chartColors.axisText }} axisLine={{ stroke: chartColors.border }} tickLine={false} /><YAxis dataKey="region" type="category" tick={{ fontSize: 11, fill: chartColors.axisText }} axisLine={{ stroke: chartColors.border }} tickLine={false} width={64} /><Tooltip content={<CustomTooltip />} /><Bar dataKey="leads" fill={chartColors.successSoft} radius={[0, 4, 4, 0]} name="线索数" /></BarChart></ResponsiveContainer> : null}</div></div>
            <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm"><div className="flex items-center justify-between px-5 py-4 border-b border-border/60"><h3 className="text-sm font-semibold text-foreground">行业分布与匹配度</h3></div><div className="p-5 flex flex-col gap-3">{industryData.map((item, index) => <div key={stableHash(`${item.industry}-${index}`)} className="flex items-center gap-3"><span className="text-xs text-muted-foreground w-20 shrink-0 text-right">{item.industry}</span><div className="flex-1 flex items-center gap-2"><div className="flex-1 h-6 bg-muted rounded-md overflow-hidden relative"><div className="h-full bg-blue-100 rounded-md flex items-center" style={{ width: `${(item.leads / Math.max(industryData[0]?.leads || 1, 1)) * 100}%` }}><div className="h-full bg-[hsl(var(--deep-blue)/0.8)] rounded-md" style={{ width: `${item.matchRate}%` }} /></div></div><div className="flex items-center gap-2 shrink-0"><span className="text-xs font-semibold text-foreground/80 w-8 text-right">{item.leads}</span><span className="text-xs text-[hsl(var(--brand-green))] font-medium w-10 text-right">{item.matchRate}%</span></div></div></div>)}</div></div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm"><div className="px-5 py-4 border-b border-border/60"><h3 className="text-sm font-semibold text-foreground">转化漏斗</h3></div><div className="p-5 flex flex-col gap-2">{funnelData.map((stage, index) => { const maxCount = Math.max(funnelData[0]?.count || 1, 1); const widthPct = (stage.count / maxCount) * 100; return <div key={stableHash(`${stage.stage}-${index}`)} className="flex items-center gap-3"><span className="text-xs text-muted-foreground w-16 shrink-0 text-right">{stage.stage}</span><div className="flex-1 relative"><div className="h-10 rounded-lg flex items-center px-3 transition-all" style={{ width: `${Math.max(widthPct, 16)}%`, background: `linear-gradient(90deg, ${stage.color} 0%, ${chartColors.primarySoft} 100%)` }}><span className="text-xs font-semibold text-white">{stage.count.toLocaleString()}</span></div></div><span className="text-xs font-medium text-muted-foreground w-12 text-right">{stage.rate}</span></div> })}</div></div>
            <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm"><div className="flex items-center justify-between px-5 py-4 border-b border-border/60"><div><h3 className="text-sm font-semibold text-foreground">数据罗盘转化诊断</h3><div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-slate-400">Pro-Level Manager Insights</div></div><Badge variant="secondary" className="text-xs bg-emerald-50 text-emerald-600 border-emerald-200"><Zap className="size-3 mr-1" />业务诊断</Badge></div><div className="p-5 flex flex-col gap-4"><div className="grid gap-3 md:grid-cols-2"><MetricInsightCard eyebrow="Execution Rate" metricLabel="线索消化率" metricValue={executionInsight.value} formula={`计算方式: (联系中 ${stageCounts.contacting} + 已回复 ${stageCounts.replied}) / 总线索 ${leads.length}`} title={executionInsight.title} tone={executionInsight.tone}>{executionInsight.body}</MetricInsightCard><MetricInsightCard eyebrow="Reply Rate" metricLabel="回复转化率" metricValue={replyInsight.value} formula={`计算方式: 已回复 ${stageCounts.replied} / (联系中 ${stageCounts.contacting} + 已回复 ${stageCounts.replied})`} title={replyInsight.title} tone={replyInsight.tone}>{replyInsight.body}</MetricInsightCard></div><div className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-border bg-muted/30 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Pipeline Base</div><div className="mt-2 text-xs text-muted-foreground">总线索基数</div><div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{leads.length}</div></div><div className="rounded-xl border border-border bg-muted/30 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">In Execution</div><div className="mt-2 text-xs text-muted-foreground">联系中 + 已回复</div><div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{executionBase}</div></div><div className="rounded-xl border border-border bg-muted/30 px-4 py-3"><div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">High Score</div><div className="mt-2 text-xs text-muted-foreground">高分线索 (&gt; 80)</div><div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{highScoreCount}</div></div></div></div></div>
          </div>

          <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm"><div className="flex items-center justify-between px-5 py-4 border-b border-border/60"><h3 className="text-sm font-semibold text-foreground">最新高优线索</h3><Button variant="ghost" size="sm" className="text-xs text-[hsl(var(--deep-blue))]" onClick={() => onLeadsNavigate?.()}>查看全部 <ArrowUpRight className="size-3.5 ml-1" /></Button></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border/60 bg-muted/60"><th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">公司名称</th><th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">国家</th><th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">匹配度</th><th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">最近活动</th><th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">预估价值</th></tr></thead><tbody>{latestPriorityLeads.map((lead, index) => { const score = lead.matchScore; return <tr key={stableHash(`${lead.company}-${index}`)} className="border-b border-border/60 last:border-b-0 hover:bg-muted/60 transition-colors"><td className="px-5 py-3 font-medium text-foreground">{lead.company}</td><td className="px-3 py-3"><Badge variant="outline" className="text-xs">{lead.countryCode || "--"}</Badge></td><td className="px-3 py-3"><span className={`text-xs font-semibold tabular-nums ${score >= 90 ? "text-[hsl(var(--brand-green))]" : score >= 80 ? "text-emerald-500" : "text-amber-500"}`}>{score}%</span></td><td className="px-3 py-3"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{lead.lastActivity || lead.addedDate}</span></td><td className="px-5 py-3 text-right font-semibold text-foreground text-xs">{lead.estimatedValue || "-"}</td></tr>})}</tbody></table></div></div>
        </>
      )}
    </div>
  )
}
