'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Mail,
  Linkedin,
  Facebook,
  MessageCircle,
  Plus,
  Trash2,
  Wifi,
  WifiOff,
  AlertTriangle,
  Clock,
  Shield,
  Lock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  accountConnect,
  accountDisconnect,
  accountGetList,
  onAccountStatusUpdate,
  secretSet,
  secretCheck,
} from '@/lib/electron-api'
import { updateUserConfig, getUserConfig } from '@/lib/user-config'
import { useToast } from '@/hooks/use-toast'
import { useLicenseStore } from '@/store/licenseStore'
import { UpgradeModal } from '@/components/upgrade-modal'
import type { AccountSessionEntry, AccountType } from '@/shared/ipc-contracts'

type EmailDraft = {
  smtpHost: string
  smtpPort: string
  smtpUser: string
  smtpPass: string
  senderEmail: string
  senderName: string
}

const EMPTY_EMAIL_DRAFT: EmailDraft = {
  smtpHost: '',
  smtpPort: '587',
  smtpUser: '',
  smtpPass: '',
  senderEmail: '',
  senderName: '',
}

const ACCOUNT_TYPE_META: Record<AccountType, { label: string; icon: typeof Mail; color: string; desc: string }> = {
  email_smtp: {
    label: '企业邮箱 (SMTP)',
    icon: Mail,
    color: 'bg-blue-500',
    desc: '自备企业发信服务器，直达客户收件箱',
  },
  email_imap: { label: '企业邮箱 (IMAP)', icon: Mail, color: 'bg-indigo-500', desc: '本地托管收信监听与多轮跟进检测' },
  linkedin: { label: 'LinkedIn', icon: Linkedin, color: 'bg-sky-600', desc: '复用本机IP浏览公开Profile辅助触达决策人' },
  facebook: { label: 'Facebook', icon: Facebook, color: 'bg-blue-700', desc: '多账号运营，独立沙箱环境互不干扰' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: 'bg-emerald-500', desc: '本地住宅IP Web WA 多渠道直连' },
}

const STATUS_META: Record<string, { label: string; color: string; icon: typeof Wifi }> = {
  connected: { label: '已连接', color: 'text-emerald-500', icon: Wifi },
  disconnected: { label: '已断开', color: 'text-slate-400', icon: WifiOff },
  rate_limited: { label: '被限速', color: 'text-amber-500', icon: AlertTriangle },
  error: { label: '异常', color: 'text-red-500', icon: AlertTriangle },
}

export function AccountsManagement() {
  const { toast } = useToast()
  const tier = useLicenseStore((s) => s.tier)
  const plan = useLicenseStore((s) => s.plan)
  const canAccessPremium = tier === 'premium' || plan === 'enterprise'
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const [accounts, setAccounts] = useState<AccountSessionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  /* P0-2：邮箱 SMTP 配置表单（Email Agent 链路修复） */
  const [editingEmailType, setEditingEmailType] = useState<AccountType | null>(null)
  const [emailDraft, setEmailDraft] = useState<EmailDraft>(EMPTY_EMAIL_DRAFT)
  const [savingEmail, setSavingEmail] = useState(false)
  /* L0-3/F5：已保存密码标志（回显提示用，密码本体永不回显） */
  const [emailPassSaved, setEmailPassSaved] = useState(false)

  /* L0-3/F5：打开表单时回显已保存的非密字段；密码留空表示"保持不变" */
  const openEmailForm = useCallback(async (type: AccountType) => {
    setEmailDraft(EMPTY_EMAIL_DRAFT)
    setEditingEmailType(type)
    setEmailPassSaved(false)
    try {
      const config = await getUserConfig()
      const email = config.accounts?.email
      if (email) {
        setEmailDraft({
          smtpHost: String(email.smtpHost || ''),
          smtpPort: String(email.smtpPort || 587),
          smtpUser: String(email.smtpUser || ''),
          smtpPass: '',
          senderEmail: String(email.senderEmail || ''),
          senderName: String(email.senderName || ''),
        })
      }
    } catch {
      // 读取失败时保持空表单（新建语义）
    }
    try {
      const meta = await secretCheck('secrets.email.smtpPass')
      setEmailPassSaved(Boolean(meta?.exists))
    } catch {
      // secret 状态读取失败不影响表单打开
    }
  }, [])

  const refreshList = useCallback(async () => {
    try {
      const data = await accountGetList()
      setAccounts(data.accounts)
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取账号列表失败'
      if (!/FEATURE_DENIED|TRIAL_EXPIRED/.test(message)) {
        toast({ title: '读取账号列表失败', description: message, variant: 'destructive' })
      }
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  useEffect(() => {
    const unsub = onAccountStatusUpdate((entry) => {
      setAccounts((prev) => {
        const idx = prev.findIndex((a) => a.accountId === entry.accountId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = entry
          return next
        }
        return [...prev, entry]
      })
    })
    return () => unsub()
  }, [])

  const handleConnect = async (accountType: AccountType) => {
    const isEmailType = accountType === 'email_smtp' || accountType === 'email_imap'
    if (!canAccessPremium && !isEmailType) {
      setUpgradeModalOpen(true)
      return
    }
    setConnecting(true)
    try {
      await accountConnect({
        accountType,
        label: `${ACCOUNT_TYPE_META[accountType].label} 账号`,
        credentials: {},
      })
      toast({ title: '沙箱已激活', description: `${ACCOUNT_TYPE_META[accountType].label} 沙箱环境已建立` })
      await refreshList()
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败'
      toast({ title: '沙箱创建失败', description: message, variant: 'destructive' })
    } finally {
      setConnecting(false)
    }
  }

  /* P0-2 + L0-3/B3：保存 SMTP 配置 —— 非密字段写 user_config，密码写 secret-manager
     （safeStorage 加密）；密码留空 = 保持已存密码不变；user_config 的明文遗留字段
     一律清空（旧安装由主进程读端回退兼容）。 */
  const handleSaveEmail = async () => {
    if (!editingEmailType) return
    setSavingEmail(true)
    try {
      const newPass = String(emailDraft.smtpPass || '').trim()
      await updateUserConfig((current) => ({
        ...current,
        accounts: {
          ...(current.accounts || {}),
          email: {
            smtpHost: String(emailDraft.smtpHost || '').trim(),
            smtpPort: Number(emailDraft.smtpPort) || 587,
            smtpUser: String(emailDraft.smtpUser || '').trim(),
            smtpPass: '',
            senderEmail: String(emailDraft.senderEmail || '').trim(),
            senderName: String(emailDraft.senderName || '').trim(),
          },
        },
      }))
      if (newPass) {
        await secretSet({ key: 'secrets.email.smtpPass', value: newPass })
      }
      await accountConnect({
        accountType: editingEmailType,
        label: `${ACCOUNT_TYPE_META[editingEmailType].label} 账号`,
        credentials: {},
      })
      toast({
        title: '邮箱已配置',
        description: newPass
          ? 'SMTP 配置与密码（已加密存储）已保存，沙箱实例已建立'
          : 'SMTP 配置已保存（沿用已存密码），沙箱实例已建立',
      })
      await refreshList()
      setEditingEmailType(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      toast({ title: '邮箱配置失败', description: message, variant: 'destructive' })
    } finally {
      setSavingEmail(false)
    }
  }

  const handleDisconnect = async (accountId: string) => {
    try {
      await accountDisconnect({ accountId })
      toast({ title: '已断开', description: '沙箱会话已安全清除' })
      setAccounts((prev) => prev.filter((a) => a.accountId !== accountId))
    } catch (error) {
      const message = error instanceof Error ? error.message : '断开失败'
      toast({ title: '断开失败', description: message, variant: 'destructive' })
    }
  }

  const accountTypes: AccountType[] = ['email_smtp', 'email_imap', 'linkedin', 'facebook', 'whatsapp']

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-slate-900">已绑定的账号沙箱</h2>
          <p className="text-sm text-slate-500">
            每个账号享有独立持久化沙箱，Cookie 与本地存储完全隔离，复用本地真实住宅 IP。
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-5 w-32 bg-slate-200 rounded" />
                <div className="h-3 w-48 bg-slate-100 rounded mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-24 bg-slate-100 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200 bg-white">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Shield className="size-12 text-slate-300" />
            <div className="text-center">
              <p className="text-lg font-medium text-slate-600">尚未绑定任何账号沙箱</p>
              <p className="text-sm text-slate-400 mt-1 max-w-md text-center">
                💡 操作向导：本工作台采用本地独立沙箱环境，复用您本机真实的住宅网络 IP
                执行安全外拓。请先点击下方卡片，连接您的企业发信箱（试用版放行）或社盟大号（高级版独占），为 AI
                销售智能体注入巡航燃料。
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => {
            const meta = ACCOUNT_TYPE_META[account.accountType]
            const statusMeta = STATUS_META[account.status]
            const StatusIcon = statusMeta.icon
            const AccountIcon = meta.icon

            return (
              <Card key={account.accountId} className="relative overflow-hidden group">
                <div className={`absolute top-0 left-0 right-0 h-1 ${meta.color}`} />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`size-8 rounded-lg ${meta.color} flex items-center justify-center`}>
                        <AccountIcon className="size-4 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold">{account.label}</CardTitle>
                        <CardDescription className="text-xs">{meta.label}</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-xs gap-1 ${statusMeta.color}`}>
                      <StatusIcon className="size-3" />
                      {statusMeta.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-2">
                    {account.email && <p className="text-xs text-slate-500 truncate">{account.email}</p>}
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Clock className="size-3" />
                      {account.lastCheckedAt
                        ? `上次检测: ${new Date(account.lastCheckedAt).toLocaleTimeString()}`
                        : '等待首次轮询...'}
                    </div>
                    {account.errorMessage && (
                      <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1">{account.errorMessage}</p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 text-xs text-slate-400 hover:text-red-600 justify-start px-0 h-7"
                      onClick={() => handleDisconnect(account.accountId)}
                    >
                      <Trash2 className="size-3 mr-1" />
                      断开并清除沙箱
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">新增账号沙箱</span>
          <span className="text-xs text-slate-400">选择一个平台创建独立持久化沙箱实例</span>
        </div>

        {editingEmailType && (
          <Card className="border-blue-200 bg-blue-50/40">
            <CardContent className="py-4 px-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-700">
                  配置企业邮箱（{ACCOUNT_TYPE_META[editingEmailType].label}）
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs text-slate-500"
                  onClick={() => setEditingEmailType(null)}
                >
                  取消
                </Button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                填写自备 SMTP 发信配置，保存后将建立沙箱实例；Email Agent
                与多轮跟进将读取该配置。密码经系统加密存储，永不明文落盘。
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">SMTP 服务器 *</label>
                  <Input
                    placeholder="smtp.example.com"
                    value={emailDraft.smtpHost}
                    onChange={(e) => setEmailDraft((d) => ({ ...d, smtpHost: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">SMTP 端口</label>
                  <Input
                    placeholder="587"
                    inputMode="numeric"
                    value={emailDraft.smtpPort}
                    onChange={(e) => setEmailDraft((d) => ({ ...d, smtpPort: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">发件人邮箱 *</label>
                  <Input
                    placeholder="sender@example.com"
                    value={emailDraft.senderEmail}
                    onChange={(e) => setEmailDraft((d) => ({ ...d, senderEmail: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">SMTP 用户名</label>
                  <Input
                    placeholder="登录账号（可留空）"
                    value={emailDraft.smtpUser}
                    onChange={(e) => setEmailDraft((d) => ({ ...d, smtpUser: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">
                    SMTP 密码{emailPassSaved ? '（已保存，留空保持不变）' : ''}
                  </label>
                  <Input
                    type="password"
                    placeholder={emailPassSaved ? '留空保持当前密码' : '应用专用密码'}
                    value={emailDraft.smtpPass}
                    onChange={(e) => setEmailDraft((d) => ({ ...d, smtpPass: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">发件人名称</label>
                  <Input
                    placeholder="Kone Agent"
                    value={emailDraft.senderName}
                    onChange={(e) => setEmailDraft((d) => ({ ...d, senderName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={savingEmail || !emailDraft.smtpHost.trim() || !emailDraft.senderEmail.trim()}
                  onClick={() => void handleSaveEmail()}
                >
                  {savingEmail ? '保存中...' : '保存并连接'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {accountTypes.map((type) => {
            const meta = ACCOUNT_TYPE_META[type]
            const AccountIcon = meta.icon
            const isConnecting = connecting
            const isEmailType = type === 'email_smtp' || type === 'email_imap'
            const isLocked = !canAccessPremium && !isEmailType
            const existingEmailCount = accounts.filter(
              (a) => a.accountType === 'email_smtp' || a.accountType === 'email_imap',
            ).length
            const emailLimitReached = !canAccessPremium && isEmailType && existingEmailCount >= 1
            const isDisabled = isLocked || emailLimitReached

            return (
              <Card
                key={type}
                className={`relative cursor-pointer transition-all ${isDisabled ? 'opacity-60 pointer-events-none select-none' : 'hover:border-blue-300 hover:shadow-sm'}`}
              >
                {isLocked && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/40 backdrop-blur-[2px]">
                    <div className="flex flex-col items-center gap-2 px-3 py-2 rounded-lg bg-white/90 shadow-sm border border-slate-200">
                      <Lock className="size-4 text-slate-400" />
                      <span className="text-[11px] font-semibold text-slate-500">高级版专属</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] pointer-events-auto"
                        onClick={(e) => {
                          e.stopPropagation()
                          setUpgradeModalOpen(true)
                        }}
                      >
                        了解高级版
                      </Button>
                    </div>
                  </div>
                )}
                {emailLimitReached && !isLocked && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/40 backdrop-blur-[2px]">
                    <div className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg bg-white/90 shadow-sm border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500">基础版仅支持 1 个邮箱实例</span>
                    </div>
                  </div>
                )}
                <CardContent className="flex items-center gap-4 py-4">
                  <div className={`size-10 rounded-xl ${meta.color} flex items-center justify-center shrink-0`}>
                    <AccountIcon className="size-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
                    <p className="text-xs text-slate-400 truncate">{meta.desc}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={isConnecting || isDisabled}
                    onClick={() => {
                      if (isEmailType) {
                        void openEmailForm(type)
                        return
                      }
                      void handleConnect(type)
                    }}
                  >
                    <Plus className="size-3.5 mr-1" />
                    {isLocked ? '升级解锁' : emailLimitReached ? '已达上限' : isEmailType ? '配置邮箱' : '连接'}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
      <UpgradeModal open={upgradeModalOpen} intent="premium" onOpenChange={setUpgradeModalOpen} />
    </div>
  )
}
