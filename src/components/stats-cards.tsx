import { useEffect, useMemo, useState } from 'react'
import { TrendingUp, Target, Zap } from 'lucide-react'
import { useLeadsStore } from '@/store/leads-store'

const getScoredLeads = (leads: Array<{ matchScore?: number | null }>) =>
  leads.filter((lead) => typeof lead.matchScore === 'number')

export function StatsCards({ onLeadsNavigate }: { onLeadsNavigate?: () => void }) {
  const { leads, searchResults } = useLeadsStore()
  const scoredLeads = useMemo(() => getScoredLeads(leads), [leads])
  const matchedAvg = scoredLeads.length
    ? Math.round(scoredLeads.reduce((sum, lead) => sum + (lead.matchScore || 0), 0) / scoredLeads.length)
    : 0
  const stats = [
    {
      label: '今日挖掘量',
      value: `${searchResults.length}`,
      icon: TrendingUp,
      trend: searchResults.length ? '实时' : '等待搜索',
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: 'AI 匹配准确率',
      value: `${matchedAvg}%`,
      icon: Target,
      trend: scoredLeads.length ? '动态' : '暂无',
      color: 'text-success',
      bgColor: 'bg-success/10',
    },
    {
      /* 口径澄清：本卡统计的是**用户主动保存**的线索（store.leads），
         与「今日挖掘量」（搜索结果）是两个不同口径。
         实测中用户搜索得到 17 条却看到「线索库总量 0」，容易误判为数据丢失。
         改称「已保存线索」并标注来源，避免歧义。 */
      label: '已保存线索',
      value: `${leads.length}`,
      icon: Zap,
      trend: leads.length ? '本地库' : '待保存',
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
      action: onLeadsNavigate,
    },
  ]
  const targets = useMemo(
    () =>
      stats.map((stat) => {
        const numeric = parseFloat(stat.value.replace(/,/g, ''))
        const suffix = stat.value.replace(/[0-9.,]/g, '')
        return { numeric: Number.isFinite(numeric) ? numeric : 0, suffix }
      }),
    [],
  )
  const [animated, setAnimated] = useState(targets.map(() => 0))

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const duration = 900
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      setAnimated(targets.map((target) => Math.round(target.numeric * progress * 10) / 10))
      if (progress < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [targets])

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {stats.map((stat, index) => {
        const Icon = stat.icon
        const value = animated[index]
        const formatted = Number.isFinite(value)
          ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
          : stat.value
        const content = (
          <>
            <div className={`size-11 rounded-xl ${stat.bgColor} flex items-center justify-center shrink-0`}>
              <Icon className={`size-5 ${stat.color}`} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground font-medium">{stat.label}</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-card-foreground tabular-nums">
                  {formatted}
                  {targets[index]?.suffix}
                </span>
                <span className={`text-xs font-medium ${stat.color}`}>{stat.trend}</span>
              </div>
            </div>
          </>
        )
        if (stat.action) {
          return (
            <button
              key={stat.label}
              onClick={stat.action}
              className="bg-card rounded-2xl border border-border p-5 flex items-center gap-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              {content}
            </button>
          )
        }
        return (
          <div
            key={stat.label}
            className="bg-card rounded-2xl border border-border p-5 flex items-center gap-4 shadow-sm"
          >
            {content}
          </div>
        )
      })}
    </div>
  )
}
