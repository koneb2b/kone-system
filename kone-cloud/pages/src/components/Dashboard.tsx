import { useEffect, useState } from 'react'
import { fetchDashboardStats, fetchEvents, fetchLeads, type Credentials, type DashboardStats, type EventRow, type LeadRow } from '../lib/api'
import { StatsCards } from './StatsCards'
import { LeadTable } from './LeadTable'
import { EventStream } from './EventStream'

type ThemeToggle = {
  onClick: () => void
  title: string
  children: string
}

const REFRESH_INTERVAL_MS = 30_000

export const Dashboard = ({
  creds,
  onDisconnect,
  themeToggle,
}: {
  creds: Credentials
  onDisconnect: () => void
  themeToggle: ThemeToggle
}) => {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const [statsRes, leadsRes, eventsRes] = await Promise.all([
        fetchDashboardStats(creds),
        fetchLeads(creds, { status: statusFilter || undefined, limit: 50 }),
        fetchEvents(creds, { limit: 50 }),
      ])
      setStats(statsRes)
      setLeads(leadsRes)
      setEvents(eventsRes)
      setError('')
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    refresh()
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds, statusFilter])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight">Kone Cloud</h1>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              团队线索台账
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                更新于 {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={refresh}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              刷新
            </button>
            <button
              onClick={themeToggle.onClick}
              title={themeToggle.title}
              className="rounded-lg bg-slate-100 p-2 text-sm hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              {themeToggle.children}
            </button>
            <button
              onClick={onDisconnect}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              断开
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && !stats ? (
          <div className="flex h-64 items-center justify-center text-slate-500">加载中…</div>
        ) : (
          <>
            <StatsCards stats={stats!} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <LeadTable
                  leads={leads}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                />
              </div>
              <div>
                <EventStream events={events} />
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Kone Cloud · Cloudflare Workers + D1 · v1.0.0
      </footer>
    </div>
  )
}
