"use client"

import { useState, useEffect, useCallback } from "react"
import { Zap, MessageCircle, Linkedin, Mail, Play, Pause, Square, AlertTriangle, Clock, CheckCircle, XCircle, Crown, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { agentGetList, agentControl, onAgentStatusChanged, accountGetList, agentGetLog, submitLicense } from "@/lib/electron-api"
import { useToast } from "@/hooks/use-toast"
import { useLicenseStore } from "@/store/licenseStore"
import { UpgradeModal } from "@/components/upgrade-modal"
import type { SalesAgentState, SalesAgentType, AccountSessionEntry, AgentLogEntry } from "@/shared/ipc-contracts"

const AGENT_META: Record<SalesAgentType, { icon: typeof Zap; color: string; accent: string }> = {
  whatsapp: { icon: MessageCircle, color: "bg-emerald-500", accent: "border-emerald-500/30" },
  linkedin: { icon: Linkedin, color: "bg-sky-600", accent: "border-sky-600/30" },
  email: { icon: Mail, color: "bg-blue-500", accent: "border-blue-500/30" },
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  idle: { label: "待命", color: "bg-slate-100 text-slate-600" },
  running: { label: "执行中", color: "bg-emerald-100 text-emerald-700" },
  paused: { label: "已暂停", color: "bg-amber-100 text-amber-700" },
  error: { label: "异常", color: "bg-red-100 text-red-700" },
}

export function AgentsPanel() {
  const { toast } = useToast()
  const tier = useLicenseStore((s) => s.tier)
  const plan = useLicenseStore((s) => s.plan)
  const refreshLicenseStatus = useLicenseStore((s) => s.refreshLicenseStatus)
  const canAccessPremium = tier === "premium" || plan === "enterprise"
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const [agents, setAgents] = useState<SalesAgentState[]>([])
  const [loading, setLoading] = useState(true)
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountSessionEntry[]>([])
  const [licenseKey, setLicenseKey] = useState("")
  const [activating, setActivating] = useState(false)
  const [activationError, setActivationError] = useState("")
  const [logDrawerTarget, setLogDrawerTarget] = useState<SalesAgentState | null>(null)
  const [logEntries, setLogEntries] = useState<AgentLogEntry[]>([])
  const [loadingLog, setLoadingLog] = useState(false)

  const refreshList = useCallback(async () => {
    try {
      const data = await agentGetList()
      setAgents(data.agents)
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取智能体失败"
      if (!/FEATURE_DENIED|TRIAL_EXPIRED|额度/.test(message)) {
        toast({ title: "读取失败", description: message, variant: "destructive" })
      }
    } finally {
      setLoading(false)
    }
  }, [toast])

  const refreshAccounts = useCallback(async () => {
    try {
      const data = await accountGetList()
      setAccounts(data.accounts)
    } catch {
      // 静默失败，非高级用户无法访问账号列表
    }
  }, [])

  useEffect(() => {
    void refreshList()
    void refreshAccounts()
  }, [refreshList, refreshAccounts])

  useEffect(() => {
    const unsub = onAgentStatusChanged((state) => {
      setAgents((prev) => {
        const idx = prev.findIndex((a) => a.agentId === state.agentId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = state
          return next
        }
        return [...prev, state]
      })
    })
    return () => unsub()
  }, [])

  const isAccountConnected = useCallback((agentType: SalesAgentType): boolean => {
    if (agentType === 'email') {
      return accounts.some((a) => a.accountType === 'email_smtp' || a.accountType === 'email_imap')
    }
    return accounts.some((a) => a.accountType === agentType)
  }, [accounts])

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      setActivationError("请输入商业授信码")
      return
    }
    setActivating(true)
    setActivationError("")
    try {
      const result = await submitLicense({ licenseKey: licenseKey.trim() })
      if (result.isExpired || result.tier === "unregistered") {
        setActivationError(result.message || "激活码无效，请核对后重新输入")
        return
      }
      await refreshLicenseStatus(true)
      setLicenseKey("")
      toast({ title: "激活成功", description: "商业高级版已激活，AI 销售团队功能已解锁" })
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : "验证失败，请稍后重试")
    } finally {
      setActivating(false)
    }
  }

  const fetchLog = async (agent: SalesAgentState) => {
    setLogDrawerTarget(agent)
    setLoadingLog(true)
    setLogEntries([])
    try {
      const data = await agentGetLog(agent.agentId)
      setLogEntries(data.logEntries)
    } catch {
      setLogEntries([])
    } finally {
      setLoadingLog(false)
    }
  }

  const handleControl = async (agentId: string, action: 'start' | 'stop' | 'pause') => {
    const agent = agents.find(a => a.agentId === agentId)
    if (!agent) return

    const isHighEndAgent = agent.agentType === 'whatsapp' || agent.agentType === 'linkedin'

    if (action === 'start' && isHighEndAgent && !canAccessPremium) {
      setUpgradeModalOpen(true)
      return
    }

    if (action === 'start') {
      if (!isAccountConnected(agent.agentType)) {
        const labels: Record<SalesAgentType, string> = {
          whatsapp: 'WhatsApp 拓客猎手',
          linkedin: 'LinkedIn 商务买手',
          email: '企业邮箱沙箱',
        }
        toast({
          title: "启动失败",
          description: `⚠️ 启动失败：检测到您的本地 [${labels[agent.agentType]}] 尚未连接安全持久化沙箱环境。请先前去 [账号管理] 页面配置连接并登录您的${agent.agentType === 'email' ? 'SMTP/IMAP' : '社媒环境'}，激活本地 Autopilot 伴随巡航助理。`,
          variant: "destructive",
        })
        return
      }
    }

    setBusyAgentId(agentId)
    try {
      const result = await agentControl({ agentId, action })
      toast({ title: action === 'start' ? "智能体已启动" : action === 'stop' ? "智能体已停止" : "智能体已暂停" }); void result;
      await refreshList()
    } catch (error) {
      const message = error instanceof Error ? error.message : "控制失败"
      toast({ title: "操作失败", description: message, variant: "destructive" })
    } finally {
      setBusyAgentId(null)
    }
  }

  const totalUsed = agents.reduce((sum, a) => sum + a.dailyUsed, 0)
  const totalLimit = agents[0]?.dailyLimit || 50
  const isTrialLicense = totalLimit === 3
  const isPremium = tier === "premium" || plan === "enterprise"

  if (!isPremium) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-slate-900">我的 AI 销售团队</h2>
          <p className="text-sm text-slate-500">该功能仅对商业高级版完全开放</p>
        </div>
        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-white shadow-sm">
          <CardContent className="py-10 px-8">
            <div className="flex flex-col items-center text-center max-w-2xl mx-auto gap-5">
              <div className="size-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-md">
                <Crown className="size-8 text-white" />
              </div>
              <p className="text-base leading-relaxed text-slate-700">
                💎 专属特权：AI 销售团队功能目前仅对【商业高级版】完全开放。升级高级版将即刻为您解锁本地多开防指纹独立沙箱、住宅IP安全巡航环境，让 WhatsApp 拓客猎手与领英买手辅助您高效跟进破冰（需人工确认发送）
              </p>
              <p className="text-sm font-semibold text-blue-600">[立即输入商业授信码激活]</p>
              <div className="flex gap-2 w-full max-w-md">
                <Input
                  placeholder="粘贴商业授信码"
                  value={licenseKey}
                  onChange={(e) => { setLicenseKey(e.target.value); setActivationError("") }}
                />
                <Button onClick={handleActivate} disabled={activating} className="shrink-0">
                  {activating ? "激活中..." : "激活"}
                </Button>
              </div>
              {activationError && (
                <p className="text-xs text-red-600">{activationError}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">我的 AI 销售团队</h2>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1">
              <Clock className="size-3" />
              今日配额: {totalUsed}/{totalLimit}
            </Badge>
            {isTrialLicense && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
                试用版 · 每日限制 3 条
              </Badge>
            )}
          </div>
        </div>
        <p className="text-sm text-slate-500">
          3 大本地原生智能体协同工作，复用真实住宅 IP 与持久化沙箱登录态，全程在您电脑上安全运行。
        </p>
      </div>

      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="flex items-start gap-3 py-4 px-4">
          <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-amber-800">本地 Autopilot 伴随巡航红线</p>
            <p className="text-sm text-amber-700 leading-relaxed">
              本地 AI 智能体群正在安全复用您本机的住宅网络和独立沙箱环境。后台巡航作业期间，电脑设备必须保持开机、联网且系统不能进入休眠状态。一旦断网或关机，队列将自动安全挂起，重新联网后队列自动挂起等待人工恢复。
            </p>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-5 w-28 bg-slate-200 rounded" />
                <div className="h-3 w-44 bg-slate-100 rounded mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-20 bg-slate-100 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const meta = AGENT_META[agent.agentType]
            const statusMeta = STATUS_META[agent.status]
            const AgentIcon = meta.icon
            const isBusy = busyAgentId === agent.agentId
            const connected = isAccountConnected(agent.agentType)
            const displayCompleted = connected ? agent.completedCount : 0
            const displayFailed = connected ? agent.failedCount : 0
            const displayTotal = connected ? (agent.totalTargets || 0) : 0
            const displayProgress = connected ? agent.progress : 0
            const notConfigured = !connected && agent.status === 'idle'

            return (
              <Card
                key={agent.agentId}
                className={`relative overflow-hidden group border-l-4 ${notConfigured ? 'border-slate-300' : meta.accent}`}
              >
                <div className={`absolute top-0 left-0 right-0 h-1 ${notConfigured ? 'bg-slate-300' : meta.color}`} />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`size-9 rounded-xl ${notConfigured ? 'bg-slate-300' : meta.color} flex items-center justify-center`}>
                        <AgentIcon className="size-4.5 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold">{agent.label}</CardTitle>
                        <CardDescription className="text-xs">{agent.description}</CardDescription>
                      </div>
                    </div>
                    <Badge className={`text-xs font-medium ${notConfigured ? 'bg-slate-100 text-slate-500' : statusMeta.color}`}>
                      {notConfigured ? '未连接 / 待配置' : statusMeta.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>执行进度</span>
                        <span>
                          {displayCompleted}/{displayTotal || (agent.status === 'running' ? '...' : notConfigured ? '0' : '-')}
                        </span>
                      </div>
                      <Progress value={displayProgress} className="h-1.5" />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <CheckCircle className="size-3 text-emerald-500" />
                          成功 {displayCompleted}
                        </span>
                        <span className="flex items-center gap-1">
                          <XCircle className="size-3 text-red-400" />
                          失败 {displayFailed}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] text-slate-400 hover:text-blue-600 px-1.5"
                        onClick={() => fetchLog(agent)}
                      >
                        <FileText className="size-3 mr-1" />
                        查看运行日志
                      </Button>
                    </div>

                    {agent.errorMessage && (
                      <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">
                        <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                        {agent.errorMessage}
                      </div>
                    )}

                    {agent.lastActivity && connected && (
                      <p className="text-[10px] text-slate-400">
                        最近活动: {new Date(agent.lastActivity).toLocaleTimeString()}
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 mt-1">
                      {agent.status === 'idle' || agent.status === 'error' ? (
                        <Button
                          size="sm"
                          variant={notConfigured ? "outline" : "default"}
                          className={`h-7 text-xs ${notConfigured ? 'border-slate-300 text-slate-500' : ''}`}
                          disabled={isBusy || agent.dailyUsed >= agent.dailyLimit || notConfigured}
                          onClick={() => handleControl(agent.agentId, 'start')}
                        >
                          <Play className="size-3 mr-1" />
                          {agent.dailyUsed >= agent.dailyLimit ? '今日已满' : notConfigured ? '未配置' : '启动'}
                        </Button>
                      ) : agent.status === 'running' ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={isBusy}
                            onClick={() => handleControl(agent.agentId, 'pause')}
                          >
                            <Pause className="size-3 mr-1" />
                            暂停
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-slate-400 hover:text-red-600"
                            disabled={isBusy}
                            onClick={() => handleControl(agent.agentId, 'stop')}
                          >
                            <Square className="size-3 mr-1" />
                            停止
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          disabled={isBusy || notConfigured}
                          onClick={() => handleControl(agent.agentId, 'start')}
                        >
                          <Play className="size-3 mr-1" />
                          {notConfigured ? '未配置' : '继续'}
                        </Button>
                      )}
                      {agent.dailyUsed >= agent.dailyLimit && (
                        <span className="text-[10px] text-amber-600">今日已满</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      <Sheet open={!!logDrawerTarget} onOpenChange={(open) => { if (!open) setLogDrawerTarget(null) }}>
        <SheetContent side="right" className="w-[40%] max-w-[40%]">
          <SheetHeader>
            <SheetTitle className="text-base font-semibold">
              {logDrawerTarget ? `${logDrawerTarget.label} - 运行日志` : '运行日志'}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {loadingLog ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-slate-400">加载中...</p>
              </div>
            ) : logEntries.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-slate-400">暂无本地沙箱运行记录，请先激活启动</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {logEntries.map((entry, idx) => (
                  <div key={idx} className="flex flex-col gap-0.5 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-400">{new Date(entry.timestamp).toLocaleString()}</span>
                      <Badge variant="outline" className={`text-[10px] font-medium ${entry.event === '成功' ? 'text-emerald-600 border-emerald-200 bg-emerald-50' : entry.event === '失败' ? 'text-red-600 border-red-200 bg-red-50' : 'text-slate-600 border-slate-200'}`}>
                        {entry.event}
                      </Badge>
                    </div>
                    {entry.detail && (
                      <p className="text-slate-600 mt-0.5">{entry.detail}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <UpgradeModal open={upgradeModalOpen} intent="premium" onOpenChange={setUpgradeModalOpen} />
    </div>
  )
}
