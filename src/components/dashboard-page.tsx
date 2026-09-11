"use client"

import { Suspense, lazy, useState, useCallback, useEffect } from "react"
import { Shield, Wifi } from "lucide-react"
import { AppSidebar } from "@/components/app-sidebar"
import { UpgradeModal } from "@/components/upgrade-modal"
import { ContactModal } from "@/components/contact-modal"
import { PremiumAccessBlocked } from "@/components/premium-access-blocked"
import { startCampaign } from "@/lib/electron-api"
import { useLicenseStore } from "@/store/licenseStore"

import type { LeadItem } from "@/store/leads-store"

const SearchEngine = lazy(() => import("@/components/search-engine").then((module) => ({ default: module.SearchEngine })))
const StatsCards = lazy(() => import("@/components/stats-cards").then((module) => ({ default: module.StatsCards })))
const LeadsTable = lazy(() => import("@/components/leads-table").then((module) => ({ default: module.LeadsTable })))
const AnalysisDrawer = lazy(() => import("@/components/analysis-drawer").then((module) => ({ default: module.AnalysisDrawer })))
const LeadsManagement = lazy(() => import("@/components/leads-management").then((module) => ({ default: module.LeadsManagement })))
const DataCenter = lazy(() => import("@/components/data-center").then((module) => ({ default: module.DataCenter })))
const KnowledgeBase = lazy(() => import("@/components/knowledge-base").then((module) => ({ default: module.KnowledgeBase })))
const SystemSettings = lazy(() => import("@/components/system-settings").then((module) => ({ default: module.SystemSettings })))
const TeamDashboard = lazy(() => import("@/components/team-dashboard").then((module) => ({ default: module.TeamDashboard })))
const AutomationWorkflow = lazy(() => import("@/components/automation-workflow").then((module) => ({ default: module.AutomationWorkflow })))

type UserRole = 'trial' | 'pro' | 'enterprise'
type UpgradeIntent = "basic" | "premium"

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  search: { title: "海外客户智能搜索", subtitle: "AI 驱动的全球 B2B 客户精准挖掘" },
  leads: { title: "线索管理", subtitle: "管理和跟踪所有客户线索" },
  data: { title: "数据中心", subtitle: "全面的业务数据分析与洞察" },
  knowledge: { title: "企业知识库", subtitle: "构建您的私域 AI 大脑" },
  settings: { title: "系统设置", subtitle: "API 密钥、搜索配置与账户管理" },
  "team-dashboard": { title: "团队协作看板", subtitle: "实时团队线索协同与防撞单管理" },
  automation: { title: "智能触达工作流", subtitle: "客户清洗、模板配置与云端发送的协同引擎" },
}

function SectionSkeleton({ label = "模块加载中..." }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-slate-500">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const [activeNav, setActiveNav] = useState("search")
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedLead, setSelectedLead] = useState<LeadItem | null>(null)
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const [upgradeIntent, setUpgradeIntent] = useState<UpgradeIntent>("premium")
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [cloudMode, setCloudMode] = useState<"connected" | "local">("connected")
  const plan = useLicenseStore((s) => s.plan)
  const tier = useLicenseStore((s) => s.tier)
  const isTrial = useLicenseStore((s) => s.isTrial)
  const loading = useLicenseStore((s) => s.loading)
  const refreshLicenseStatus = useLicenseStore((s) => s.refreshLicenseStatus)

  const currentRole: UserRole = loading ? 'trial' : isTrial ? 'trial' : tier === 'premium' ? 'enterprise' : 'pro'
  const isExpired = tier === "expired"

  useEffect(() => {
    if (isExpired) {
      setContactModalOpen(true)
    }
  }, [isExpired])

  useEffect(() => {
    const handleNavigateSettings = () => setActiveNav("settings")
    const handleNavigateLeads = () => setActiveNav("leads")
    const handleCloudMode = (event: Event) => {
      const customEvent = event as CustomEvent<{ mode?: "connected" | "local" }>
      setCloudMode(customEvent.detail?.mode === "local" ? "local" : "connected")
    }
    window.addEventListener("kone:navigate-settings", handleNavigateSettings)
    window.addEventListener("kone:navigate-leads", handleNavigateLeads)
    window.addEventListener("kone:cloud-mode", handleCloudMode as EventListener)
    return () => {
      window.removeEventListener("kone:navigate-settings", handleNavigateSettings)
      window.removeEventListener("kone:navigate-leads", handleNavigateLeads)
      window.removeEventListener("kone:cloud-mode", handleCloudMode as EventListener)
    }
  }, [])

  const handleAnalyze = (lead: LeadItem) => {
    setSelectedLead(lead)
    setDrawerOpen(true)
  }

  const handlePremiumNavClick = useCallback((_id: string) => {
    setUpgradeIntent("premium")
    setUpgradeModalOpen(true)
  }, [])

  const handleNavChange = useCallback((id: string) => {
    setActiveNav(id)
  }, [])

  const handleUpgradeActivated = useCallback(async () => {
    await refreshLicenseStatus(true)
    setUpgradeModalOpen(false)
  }, [refreshLicenseStatus])

  const handleSendToCloud = async (lead: LeadItem) => {
    const analysisCache = typeof lead.analysisCache === "object" && lead.analysisCache
      ? (lead.analysisCache as Record<string, any>)
      : {}
    const bestAnalysis = analysisCache.direct_quote
      || analysisCache.competitor_switch
      || analysisCache.factory_strength
      || {}

    const response = await startCampaign({
      templateId: "single_lead_handoff",
      leads: [
        {
          email: lead.email || "",
          company: lead.company,
          website: lead.website || "",
          domain: lead.website || "",
          country: lead.country || "",
          contact: lead.contact || "",
          contactTitle: lead.contactTitle || lead.inferredRole || "",
          phone: lead.phone || "",
          address: lead.address || "",
          source: lead.source || "",
          matchScore: typeof lead.matchScore === "number" ? lead.matchScore : undefined,
          matchReasons: lead.matchReasons || [],
          riskFlags: lead.riskFlags || [],
          inferredRole: lead.inferredRole || "",
          snippet: lead.snippet || "",
          verificationStatus: "unverified",
          aiAnalysis: {
            companyProfile: String(bestAnalysis.companyProfile || "").trim(),
            painPoints: String(bestAnalysis.painPoints || "").trim(),
            valueMapping: String(bestAnalysis.valueMapping || "").trim(),
            confidence: typeof bestAnalysis.confidence === "number" ? bestAnalysis.confidence : undefined,
            source: String(bestAnalysis.source || "").trim(),
          },
          aiGeneratedPitch: {
            emailSubject: String(bestAnalysis.emailSubject || "").trim(),
            emailBody: String(bestAnalysis.emailBody || "").trim(),
          },
          userSettings: {},
        },
      ],
    })

    if (response.triggered === false && response.error) {
      throw new Error(response.error)
    }

    if (response.triggered === false) {
      return {
        skipped: true,
        reason: String(response.message || '推送被系统路由规则拦截'),
      }
    }

    return { skipped: false }
  }

  const currentPage = pageTitles[activeNav] || pageTitles.search
  const showLocalEnhancedMode = activeNav === "team-dashboard" && cloudMode === "local"
  const canAccessPremiumWorkspace = tier === "premium" || plan === "enterprise"
  const shouldBlockPremiumPage = (activeNav === "team-dashboard" || activeNav === "automation") && !loading && !canAccessPremiumWorkspace

  return (
    <div className="flex min-h-screen bg-background" data-stage="dashboard">
      <AppSidebar
        activeNav={activeNav}
        onNavChange={handleNavChange}
        onPremiumNavClick={handlePremiumNavClick}
        onUpgradeClick={(intent) => {
          setUpgradeIntent(intent)
          setUpgradeModalOpen(true)
        }}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-card/80 backdrop-blur-sm border-b border-border px-6 py-3.5 flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-lg font-semibold text-foreground">{currentPage.title}</h1>
            <p className="text-xs text-muted-foreground">{currentPage.subtitle}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <span className="relative flex size-2">
                <span className={`absolute inline-flex size-full rounded-full opacity-75 ${showLocalEnhancedMode ? "bg-slate-400" : "animate-ping bg-success"}`} />
                <span className={`relative inline-flex size-2 rounded-full ${showLocalEnhancedMode ? "bg-slate-400" : "bg-success"}`} />
              </span>
              {showLocalEnhancedMode ? <Shield className="size-3.5" /> : <Wifi className="size-3.5" />}
              {showLocalEnhancedMode ? "本地增强模式" : "系统已联通"}
            </div>
          </div>
        </header>

        <div className="flex-1 p-6 flex flex-col gap-5 overflow-auto">
          {activeNav === "search" && (
            <Suspense fallback={<SectionSkeleton label="搜索模块加载中..." />}>
              <>
                <SearchEngine userRole={currentRole} onSendToCloud={handleSendToCloud} />
                <StatsCards onLeadsNavigate={() => setActiveNav("leads")} />
                <LeadsTable
                  onAnalyze={handleAnalyze}
                  userRole={currentRole}
                  onSendToCloud={handleSendToCloud}
                  onViewAll={() => setActiveNav("leads")}
                />
              </>
            </Suspense>
          )}
          {activeNav === "leads" && (
            <Suspense fallback={<SectionSkeleton label="线索模块加载中..." />}>
              <LeadsManagement userRole={currentRole} onAcquireNavigate={() => setActiveNav("search")} onAnalyze={handleAnalyze} />
            </Suspense>
          )}
          {activeNav === "data" && (
            <Suspense fallback={<SectionSkeleton label="数据中心加载中..." />}>
              <DataCenter onLeadsNavigate={() => setActiveNav("leads")} onAcquireNavigate={() => setActiveNav("search")} />
            </Suspense>
          )}
          {activeNav === "knowledge" && (
            <Suspense fallback={<SectionSkeleton label="知识库加载中..." />}>
              <KnowledgeBase />
            </Suspense>
          )}
          {activeNav === "settings" && (
            <Suspense fallback={<SectionSkeleton label="系统设置加载中..." />}>
              <SystemSettings userRole={currentRole} />
            </Suspense>
          )}
          {activeNav === "team-dashboard" && tier === "premium" && (
            <Suspense fallback={<SectionSkeleton label="团队看板加载中..." />}>
              <TeamDashboard />
            </Suspense>
          )}
          {activeNav === "automation" && canAccessPremiumWorkspace && (
            <Suspense fallback={<SectionSkeleton label="协同引擎加载中..." />}>
              <AutomationWorkflow />
            </Suspense>
          )}
          {shouldBlockPremiumPage && (
            <PremiumAccessBlocked
              title={activeNav === "automation" ? "智能触达工作流暂未开放" : "团队协作看板暂未开放"}
              description={
                activeNav === "automation"
                  ? "当前账号仍处于 Trial / Basic 范围，仅可使用本地获客与线索管理。升级后即可开启云端自动化、发送队列与追踪能力。"
                  : "当前账号仍处于 Trial / Basic 范围，仅可使用本地线索闭环。升级后即可开启团队协作、防撞单与高级联动能力。"
              }
              ctaLabel="联系顾问升级"
              onUpgrade={() => {
                setUpgradeIntent("premium")
                setUpgradeModalOpen(true)
              }}
            />
          )}
        </div>
      </main>

      <Suspense fallback={null}>
        <AnalysisDrawer open={drawerOpen} onOpenChange={setDrawerOpen} lead={selectedLead} />
      </Suspense>

      <UpgradeModal
        open={upgradeModalOpen}
        intent={upgradeIntent}
        onOpenChange={setUpgradeModalOpen}
        onActivated={handleUpgradeActivated}
      />

      <ContactModal
        open={contactModalOpen}
        onOpenChange={(next) => {
          if (!next && isExpired) return
          setContactModalOpen(next)
        }}
      />
    </div>
  )
}
