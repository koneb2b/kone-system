import type { DashboardStats } from '../lib/api'

const Card = ({
  label,
  value,
  accent,
  sub,
}: {
  label: string
  value: number | string
  accent: string
  sub?: string
}) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
    <div className={`mt-2 text-2xl font-bold ${accent}`}>{value}</div>
    {sub && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
  </div>
)

export const StatsCards = ({ stats }: { stats: DashboardStats }) => {
  const approvalRate =
    stats.leads.total > 0 ? Math.round((stats.leads.approved / stats.leads.total) * 100) : 0
  const deliveryRate =
    stats.outreach.total > 0 ? Math.round((stats.outreach.delivered / stats.outreach.total) * 100) : 0
  const bounceRate =
    stats.outreach.total > 0 ? Math.round((stats.outreach.bounced / stats.outreach.total) * 100) : 0

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Card
        label="线索总数"
        value={stats.leads.total}
        accent="text-slate-900 dark:text-white"
        sub={`已评分 ${stats.leads.scored} · 待审批 ${stats.leads.pendingApproval}`}
      />
      <Card
        label="已批准"
        value={stats.leads.approved}
        accent="text-emerald-600 dark:text-emerald-400"
        sub={`通过率 ${approvalRate}%`}
      />
      <Card
        label="投递进度"
        value={`${stats.outreach.sent}/${stats.outreach.total}`}
        accent="text-blue-600 dark:text-blue-400"
        sub={`送达 ${deliveryRate}% · 退信 ${bounceRate}%`}
      />
      <Card
        label="回复 / 抑制"
        value={`${stats.leads.replied} / ${stats.suppressions}`}
        accent="text-purple-600 dark:text-purple-400"
        sub={`已发送 ${stats.outreach.sent} · 已回复 ${stats.leads.replied}`}
      />
    </div>
  )
}
