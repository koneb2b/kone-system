import type { LeadRow } from '../lib/api'

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'scored', label: '已评分' },
  { value: 'pending_approval', label: '待审批' },
  { value: 'approved', label: '已批准' },
  { value: 'queued', label: '已入队' },
  { value: 'sent', label: '已发送' },
  { value: 'replied', label: '已回复' },
  { value: 'suppressed', label: '已抑制' },
  { value: 'failed', label: '已失败' },
  { value: 'archived', label: '已归档' },
]

const STATUS_COLORS: Record<string, string> = {
  scored: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  queued: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  replied: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  suppressed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  archived: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  new: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export const LeadTable = ({
  leads,
  statusFilter,
  onStatusFilterChange,
}: {
  leads: LeadRow[]
  statusFilter: string
  onStatusFilterChange: (s: string) => void
}) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold">线索台账</h2>
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {leads.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-slate-500">
          暂无线索。请先在本地 KONE AI 中推送线索至云端。
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">分数</th>
                <th className="px-4 py-2">本地 ID</th>
                <th className="px-4 py-2">状态</th>
                <th className="px-4 py-2">版本</th>
                <th className="px-4 py-2">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2 font-semibold">{lead.score}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                    {lead.local_ref_id.slice(0, 12)}…
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLORS[lead.status] || STATUS_COLORS.scored
                      }`}
                    >
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">v{lead.draft_version}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{formatDate(lead.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
