import type { EventRow } from '../lib/api'

const EVENT_COLORS: Record<string, string> = {
  'lead.created': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'lead.approved': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'lead.rejected': 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  'outreach.queued': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'outreach.sent': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'outreach.delivered': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'outreach.bounced': 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  'outreach.complained': 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  'outreach.replied': 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  'suppression.added': 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  'suppression.removed': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'approval.created': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'manual.action': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'sync.failed': 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  'sync.retried': 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
}

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

const parsePayload = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const EventStream = ({ events }: { events: EventRow[] }) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold">事件流</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">最近 {events.length} 条</p>
      </div>

      {events.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-slate-500">暂无事件</div>
      ) : (
        <ul className="max-h-[600px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {events.map((event) => {
            const payload = parsePayload(event.payload)
            return (
              <li key={event.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      EVENT_COLORS[event.type] || EVENT_COLORS['manual.action']
                    }`}
                  >
                    {event.type}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDate(event.occurred_at)}
                  </span>
                </div>
                {payload && (
                  <pre className="mt-2 overflow-x-auto rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
