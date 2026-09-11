'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { HelpDialog } from '@/components/help-dialog'
import logoUrl from '@/logo.png'
import {
  Search,
  Users,
  BarChart3,
  Settings,
  ChevronRight,
  BookOpen,
  Crown,
  UsersRound,
  Workflow,
  Lock,
  ArrowUpRight,
  ShieldCheck,
  Bot,
  KeyRound,
} from 'lucide-react'
import { useLicenseStore } from '@/store/licenseStore'

import type { LicenseTier } from '@/shared/ipc-contracts'

type NavItem = {
  id: string
  label: string
  icon: typeof Search
  premium?: boolean
  badge?: string
}

const navItems: NavItem[] = [
  { id: 'search', label: '智能获客', icon: Search },
  { id: 'leads', label: '线索管理', icon: Users },
  { id: 'data', label: '数据中心', icon: BarChart3 },
  { id: 'knowledge', label: '知识库', icon: BookOpen },
  { id: 'settings', label: '系统设置', icon: Settings },
]

const premiumNavItems: NavItem[] = [
  { id: 'accounts', label: '账号管理', icon: ShieldCheck, premium: true, badge: '高级' },
  { id: 'agents', label: 'AI 销售团队', icon: Bot, premium: true, badge: '高级' },
  { id: 'automation', label: '自动化序列', icon: Workflow, premium: true, badge: '高级' },
  { id: 'team-dashboard', label: '团队协作', icon: UsersRound, premium: true, badge: '高级' },
]

const navTestIds: Partial<Record<string, string>> = {
  search: 'nav-search',
  leads: 'nav-leads',
  settings: 'nav-settings',
}

const formatExpiryDate = (ts: number) => {
  if (!ts || ts <= 0) return '--'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type UpgradeIntent = 'basic' | 'premium'

function LicenseStatusPanel({
  isTrial,
  daysRemaining,
  expiresAt,
  tier,
  isLicensed,
  loading,
  onUpgradeClick,
}: {
  isTrial: boolean
  daysRemaining: number
  expiresAt: number
  tier: LicenseTier
  isLicensed: boolean
  loading: boolean
  onUpgradeClick?: (intent: UpgradeIntent) => void
}) {
  if (loading) return null

  const isExpired = tier === 'expired'
  const isTrialUrgent = isTrial && daysRemaining <= 2
  const paidPlanLabel = tier === 'premium' ? '高级版' : '基础版'

  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2.5 border transition-colors',
        isExpired
          ? 'bg-red-500/10 border-red-500/20'
          : isTrialUrgent
            ? 'bg-amber-500/10 border-amber-500/20'
            : 'bg-white/[0.03] border-white/[0.06]',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        {isExpired ? (
          <>
            <span className="size-1.5 rounded-full bg-red-500" />
            <span className="text-[11px] font-semibold text-red-400">授权已过期</span>
          </>
        ) : isTrial ? (
          <>
            <span
              className={cn('size-1.5 rounded-full', isTrialUrgent ? 'bg-amber-500 animate-pulse' : 'bg-amber-500')}
            />
            <span className={cn('text-[11px] font-semibold', isTrialUrgent ? 'text-amber-400' : 'text-amber-400/80')}>
              试用版: 剩余 {daysRemaining} 天
            </span>
          </>
        ) : isLicensed ? (
          <>
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span className="text-[11px] font-semibold text-slate-400">
              {paidPlanLabel}: {formatExpiryDate(expiresAt)} 到期
            </span>
          </>
        ) : (
          <>
            <span className="size-1.5 rounded-full bg-slate-500" />
            <span className="text-[11px] font-semibold text-slate-400">未激活</span>
          </>
        )}
      </div>

      {isTrial && daysRemaining <= 3 && !isExpired && (
        <p className="text-[10px] text-slate-400 mb-2 leading-tight">
          {daysRemaining <= 1 ? '试用即将到期，请尽快升级以免数据中断' : `试用期将在 ${daysRemaining} 天后结束`}
        </p>
      )}

      <button
        onClick={() => onUpgradeClick?.(isTrial ? 'basic' : 'premium')}
        data-testid="btn-license-upgrade-panel"
        className={cn(
          'w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-all',
          isExpired
            ? 'bg-rose-600/15 text-rose-300 hover:bg-rose-600/25'
            : isTrial
              ? 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-300'
              : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-300',
        )}
      >
        <ArrowUpRight className="size-3" />
        {isExpired ? '立即续费' : isTrial ? '升级正式版' : '续费 / 升级'}
      </button>
    </div>
  )
}

export function AppSidebar({
  activeNav,
  onNavChange,
  onPremiumNavClick,
  onUpgradeClick,
}: {
  activeNav: string
  onNavChange: (id: string) => void
  onPremiumNavClick?: (id: string) => void
  onUpgradeClick?: (intent: UpgradeIntent) => void
}) {
  const { loading, isLicensed, plan, tier, isTrial, daysRemaining, expiresAt, refreshLicenseStatus } = useLicenseStore()
  const [helpOpen, setHelpOpen] = useState(false)
  const displayName = 'Kone智能获客'
  const statusText = loading
    ? '正在同步权限...'
    : isTrial
      ? `试用版 · 剩余 ${daysRemaining} 天`
      : isLicensed && plan === 'enterprise'
        ? '企业版 (已激活)'
        : isLicensed
          ? '正式版授权'
          : '待激活'

  const canAccessPremiumWorkspace = tier === 'premium' || plan === 'enterprise'

  useEffect(() => {
    void refreshLicenseStatus()
  }, [refreshLicenseStatus])

  const handleNavClick = (item: NavItem) => {
    if (item.premium && !canAccessPremiumWorkspace) {
      onPremiumNavClick?.(item.id)
      return
    }
    onNavChange(item.id)
  }

  const renderNavButton = (item: NavItem) => {
    const Icon = item.icon
    const isActive = activeNav === item.id
    const isLocked = item.premium && !canAccessPremiumWorkspace

    return (
      <button
        key={item.id}
        onClick={() => handleNavClick(item)}
        data-nav-id={item.id}
        data-testid={navTestIds[item.id]}
        className={cn(
          'flex items-center justify-center md:justify-start gap-3 px-2 md:px-3 py-2.5 rounded-lg text-sm font-medium transition-all w-full text-left relative overflow-hidden group',
          isActive && !isLocked
            ? 'bg-blue-600/12 text-blue-600'
            : isLocked
              ? 'text-slate-500 hover:bg-white/5 hover:text-slate-300 cursor-pointer'
              : 'text-slate-400 hover:bg-white/5 hover:text-slate-300',
        )}
      >
        {isActive && !isLocked && (
          <div className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-blue-600" />
        )}
        <Icon className={cn('size-4.5', isLocked && 'opacity-60')} />
        <span className={cn('hidden md:inline flex-1', isLocked && 'opacity-80')}>{item.label}</span>
        {item.badge && (
          <span
            className={cn(
              'hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold leading-none tracking-wide',
              isLocked
                ? 'border border-slate-700 bg-white/5 text-slate-400'
                : 'border border-blue-600/25 bg-blue-600/10 text-blue-600',
            )}
          >
            {isLocked && <Lock className="size-2.5" />}
            {item.badge}
          </span>
        )}
        {isActive && !isLocked && <ChevronRight className="hidden md:inline size-3.5 text-white/60" />}
      </button>
    )
  }

  return (
    <aside className="w-16 md:w-60 shrink-0 bg-[hsl(var(--deep-blue))] flex flex-col h-screen sticky top-0">
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map(renderNavButton)}
        <div className="my-2 mx-2 border-t border-white/[0.06]" />
        <div className="hidden md:flex items-center gap-1.5 px-3 py-2">
          <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-slate-500">
            <KeyRound className="size-3" />
            Kone AI 自航拓客特权港 [高级版本]
          </span>
        </div>
        {premiumNavItems.map(renderNavButton)}
      </nav>

      <div className="hidden md:block px-3 pb-2 space-y-2">
        <button
          type="button"
          data-testid="btn-open-help"
          onClick={() => setHelpOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
        >
          <BookOpen className="size-3.5" />
          使用指南
        </button>
        <LicenseStatusPanel
          isTrial={isTrial}
          daysRemaining={daysRemaining}
          expiresAt={expiresAt}
          tier={tier}
          isLicensed={isLicensed}
          loading={loading}
          onUpgradeClick={onUpgradeClick}
        />
      </div>

      <div className="hidden md:block px-4 py-4 bg-transparent border-t-0">
        <div className="flex items-center gap-3">
          <Avatar className="size-10 rounded-full bg-white/6 p-0.5 ring-1 ring-white/12 shadow-md">
            <div className="flex size-full items-center justify-center overflow-hidden rounded-full bg-white/10">
              <AvatarImage src={logoUrl} alt="Kone 智能获客" className="aspect-square h-full w-full object-cover" />
              <AvatarFallback className="bg-transparent text-white text-[10px] font-semibold">KONE</AvatarFallback>
            </div>
          </Avatar>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-slate-200">{displayName}</span>
            {!isTrial ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400">
                {isLicensed && plan === 'enterprise' ? <Crown className="size-3.5 text-slate-400" /> : null}
                {statusText}
              </span>
            ) : null}
            {isTrial ? (
              <button
                type="button"
                data-testid="btn-trial-countdown-upgrade"
                onClick={() => onUpgradeClick?.('basic')}
                className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-400 transition hover:bg-white/10"
              >
                倒计时: 试用剩余 {daysRemaining} 天
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </aside>
  )
}
