'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Users,
  Shield,
  RefreshCw,
  WifiOff,
  AlertTriangle,
  Star,
  MapPin,
  Radio,
  Settings,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  fetchTeamLeads,
  checkDomainCollision,
  subscribeCloudRealtime,
  unsubscribeCloudRealtime,
  onCloudRealtimeLeadEvent,
} from '@/lib/electron-api'
import type { CloudLeadEntry, DomainCollisionResult, RealtimeLeadEvent } from '@/shared/ipc-contracts'

const maskOwner = (machineId?: string, label?: string) => {
  if (label) return label
  if (!machineId) return '未知'
  return `业务员-${machineId.slice(0, 4).toLowerCase()}`
}

function useCollisionCheck() {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<DomainCollisionResult | null>(null)
  const [inputValue, setInputValue] = useState('')
  const { toast } = useToast()

  const check = useCallback(
    async (d: string) => {
      const trimmed = d.trim()
      if (!trimmed) return
      setInputValue(trimmed)
      setChecking(true)
      try {
        setResult(await checkDomainCollision(trimmed))
      } catch (error) {
        setResult(null)
        toast({
          title: '错误',
          description: error instanceof Error ? error.message : '域名检测失败，请稍后重试',
          variant: 'destructive',
        })
      } finally {
        setChecking(false)
      }
    },
    [toast],
  )

  return { checking, result, inputValue, setInputValue, check }
}

export function TeamDashboard() {
  const [leads, setLeads] = useState<CloudLeadEntry[]>([])
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [realtimeActive, setRealtimeActive] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const collision = useCollisionCheck()
  const listRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const loadTeamLeads = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchTeamLeads(50)
      setLeads(data.leads)
      setOffline(data.offline)
    } catch (error) {
      setOffline(true)
      toast({
        title: '错误',
        description: error instanceof Error ? error.message : '团队数据拉取失败，请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    void loadTeamLeads()

    subscribeCloudRealtime()
      .then(() => {
        if (!cancelled) setRealtimeActive(true)
      })
      .catch((error) => {
        if (!cancelled) {
          toast({
            title: '错误',
            description: error instanceof Error ? error.message : '实时订阅失败，已切换为静态模式',
            variant: 'destructive',
          })
        }
      })

    const unsubEvent = onCloudRealtimeLeadEvent((evt: RealtimeLeadEvent) => {
      if (cancelled) return
      if (evt.eventType === 'INSERT' && evt.new) {
        const entry = evt.new as CloudLeadEntry
        if (entry.score >= 80) {
          setLeads((prev) => {
            if (prev.some((l) => l.id === entry.id)) return prev
            return [entry, ...prev].slice(0, 50)
          })
          setFlashId(entry.id)
          setTimeout(() => setFlashId(null), 2000)
        }
      } else if (evt.eventType === 'UPDATE' && evt.new) {
        const entry = evt.new as CloudLeadEntry
        setLeads((prev) => prev.map((l) => (l.id === entry.id ? { ...l, ...entry } : l)))
        setFlashId(entry.id)
        setTimeout(() => setFlashId(null), 2000)
      }
    })

    return () => {
      cancelled = true
      unsubEvent()
      void unsubscribeCloudRealtime().catch(() => {})
    }
  }, [loadTeamLeads])

  useEffect(() => {
    const mode = offline && leads.length === 0 && !loading ? 'local' : 'connected'
    window.dispatchEvent(new CustomEvent('kone:cloud-mode', { detail: { mode } }))
    return () => {
      window.dispatchEvent(new CustomEvent('kone:cloud-mode', { detail: { mode: 'connected' } }))
    }
  }, [offline, leads.length, loading])

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts)
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch {
      return ts
    }
  }

  const showConnectivityBadge = !(offline && leads.length === 0 && !loading)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600 shadow-md">
            <Users className="size-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">团队实时看板</h2>
            <p className="text-xs text-muted-foreground">全员高分线索流 · 防撞单实时检测</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showConnectivityBadge && realtimeActive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600">
              <Radio className="size-3 animate-pulse" /> 系统已联通
            </span>
          ) : null}
          {showConnectivityBadge && offline ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-600">
              <WifiOff className="size-3" /> 离线模式
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={loadTeamLeads} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            刷新
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Shield className="size-4 text-blue-500" />
          <span className="text-sm font-semibold text-foreground">防撞单检测</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={collision.inputValue}
            onChange={(e) => collision.setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void collision.check(collision.inputValue)
            }}
            placeholder="输入域名检测是否已被同事跟进..."
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <Button
            size="sm"
            onClick={() => void collision.check(collision.inputValue)}
            disabled={collision.checking || !collision.inputValue.trim()}
          >
            {collision.checking ? <Loader2 className="size-3.5 animate-spin" /> : <Shield className="size-3.5" />}
            {collision.checking ? '检测中...' : '检测'}
          </Button>
        </div>
        {collision.result ? (
          <div
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${collision.result.collision ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-emerald-200 bg-emerald-50 text-emerald-700'}`}
          >
            {collision.result.collision ? (
              <>
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  <strong>{collision.result.domain}</strong> 已由{' '}
                  {maskOwner(collision.result.ownerMachineId, collision.result.ownerLabel)} 跟进中，建议避免重复触达
                </span>
              </>
            ) : (
              <>
                <Shield className="size-4 shrink-0" />
                <span>
                  <strong>{collision.result.domain}</strong> 暂无团队成员跟进，可安全开发
                </span>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card" ref={listRef}>
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">全员高分线索流</span>
            <span className="text-xs text-muted-foreground">{leads.length} 条高价值线索</span>
          </div>
        </div>

        {loading && leads.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="size-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
              <span className="text-sm">正在拉取团队数据...</span>
            </div>
          </div>
        ) : leads.length === 0 ? (
          <div className="px-6 py-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                    <Sparkles className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">企业云端引擎尚未启用</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                      开启企业云端引擎，实现全员高分线索实时防撞单、跨成员协作同步与关键客户动态回传。
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    onClick={() => window.dispatchEvent(new Event('kone:navigate-settings'))}
                  >
                    <Settings className="size-4" />
                    前往系统设置配置
                  </Button>
                  <span className="text-xs text-slate-500">完成配置后，此处将自动呈现团队高分线索流。</span>
                </div>

                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      示例协同视图
                    </span>
                    <span className="text-[11px] text-slate-400">Preview</span>
                  </div>
                  <div className="space-y-3 opacity-55">
                    {[
                      { score: 95, company: 'Hulk Energy', desc: 'LiFePO4 采购需求', owner: '业务员-a3f2' },
                      { score: 91, company: 'Nordic Grid', desc: '储能逆变器年度寻源', owner: '业务员-c8d1' },
                      { score: 88, company: 'Solvex Marine', desc: '港口设备电池替换项目', owner: '业务员-0f72' },
                    ].map((item) => (
                      <div
                        key={item.company}
                        className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3"
                      >
                        <div className="flex size-10 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
                          {item.score}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800">
                            [示例] {item.company}: {item.desc}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">高价值需求线索 · 已纳入团队协同跟进视图</div>
                        </div>
                        <div className="shrink-0 text-xs text-slate-400">{item.owner}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-h-[520px] divide-y divide-border overflow-y-auto">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className={`flex items-center gap-4 px-4 py-3 transition-all duration-500 ${flashId === lead.id ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-muted/20'}`}
              >
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white ${lead.score >= 90 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                >
                  {lead.score}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{lead.company || lead.domain}</span>
                    {lead.is_opened ? (
                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <Star className="size-2.5" /> 已查阅
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3">
                    <span className="truncate text-xs text-muted-foreground">{lead.domain}</span>
                    {lead.email ? <span className="truncate text-xs text-muted-foreground">{lead.email}</span> : null}
                    {lead.country ? (
                      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                        <MapPin className="size-2.5" />
                        {lead.country}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-medium text-muted-foreground">
                    {maskOwner(lead.owner_machine_id, lead.owner_label)}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60">{formatDate(lead.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
