export type IpcResponse<T = unknown> = {
  success: boolean
  canceled?: boolean
  data?: T
  error?: string
  code?: number
  meta?: Record<string, unknown>
}

export type AuthLoginRequest = {
  issuerBaseUrl: string
  realm: string
  clientId: string
  scopes?: string[]
  callbackPath?: string
  timeoutMs?: number
  extraAuthParams?: Record<string, string | undefined>
}

export type AuthLoginData = {
  state: string
  redirectUri: string
  authenticated: boolean
}

export type AuthLogoutData = {
  loggedOut: boolean
}

export type AuthSessionData = {
  authenticated: boolean
  hasRefreshToken: boolean
  expiresAt?: number
}

export type LicenseVerifyData = {
  status: 'active' | 'expired'
  expiresAt: number
  features: string[]
  plan?: 'trial' | 'basic' | 'premium' | 'pro' | 'enterprise'
  type?: 'trial' | 'license'
  isExpired?: boolean
  machineId?: string
  tier?: LicenseTier
}

export type LicenseStatusData = {
  status: 'active' | 'expired'
  expiresAt: number
  features: string[]
  plan?: 'trial' | 'basic' | 'premium' | 'pro' | 'enterprise'
  type?: 'trial' | 'license'
  isExpired?: boolean
  machineId?: string
  tier?: LicenseTier
}

export type LicenseTier = 'unregistered' | 'basic' | 'premium' | 'expired'

export type LicenseInfoData = {
  tier: LicenseTier
  machineId: string
  isDev: boolean
  isTrial: boolean
  isLocked?: boolean
  daysLeft: number
  hasLlmApiKey: boolean
  plan: string
  expiresAt: number
  features: string[]
  message?: string
}

export type LicenseSubmitRequest = {
  licenseKey: string
  llmApiKey?: string
}

export type LicenseSubmitData = {
  tier: LicenseTier
  status: 'active' | 'expired'
  expiresAt: number
  features: string[]
  plan?: string
  type?: 'trial' | 'license'
  isExpired?: boolean
  isTrial?: boolean
  machineId?: string
  message?: string
}

export type TrialRequestData = {
  success: boolean
  tier?: LicenseTier
  daysLeft?: number
  expiresAt?: number
  message?: string
}

export type SystemDeviceStatusData = {
  available: boolean
  machineId?: string
}

export type ConfigSetRequest<T = unknown> = {
  key: string
  value: T
}

export type AutopilotAction = 'pause' | 'resume' | 'stop'
export type AutopilotLifecycle = 'idle' | 'running' | 'paused' | 'completed' | 'error'
export type AutopilotStateKind =
  | 'hydrating'
  | 'ready_empty'
  | 'queued_idle'
  | 'running'
  | 'paused'
  | 'cooldown'
  | 'completed'
  | 'error'
  | 'state_unavailable'
  | 'environment_mock'

export type AnalysisSemanticCode =
  | 'missing_llm_key'
  | 'missing_llm_base_url'
  | 'missing_icp_profile'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'invalid_scenario'
  | 'insufficient_lead_data'
  | 'dev_mock_active'

export type AnalysisSemanticMeta = {
  code: AnalysisSemanticCode
  degraded?: boolean
  mockMode?: boolean
  degradedReason?: AnalysisSemanticCode
  source?: 'website' | 'snippet' | 'reply_coach' | 'dev_mock'
  settingsActionable?: boolean
}

export type AutopilotStateEnvelope<T = unknown> = {
  stateKind: AutopilotStateKind
  statusReason?: string
  source?: 'persisted' | 'runner' | 'dev_shell' | 'main_process'
  state: T | null
}

export type AutopilotStatePayload<T = unknown> = {
  state: T
}

export type SecretSetRequest = {
  key: string
  value: string
}

export type SecretCheckData = {
  exists: boolean
  masked?: string
}

export type FetchModelsRequest = {
  apiKey: string
  baseUrl: string
}

export type FetchModelsData = {
  models: string[]
}

export type TestConnectionRequest = {
  provider: string
  key?: string
  baseUrl?: string
}

export type TestConnectionData = {
  status?: number
  details?: string
  testedUrl?: string
}

export type ProxyRequest = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export type ProxyData = {
  status?: number
  data?: unknown
}

export type SearchExecuteRequest = {
  keyword: string
  country?: string
  city?: string
  dataSourceType?: DataSourceType
  filterOptions?: {
    priorityWebsite?: boolean
    localDomainOnly?: boolean
    highRelevanceOnly?: boolean
    b2bRoleOnly?: boolean
  }
}

export type SearchExecuteResult = {
  id?: string
  company: string
  website: string
  contact?: string
  contactTitle?: string
  email?: string
  phone: string
  address: string
  isB2B?: boolean | null
  matchReasons?: string[]
  riskFlags?: string[]
  matchScore?: number | null
  source?: string
  country?: string
  city?: string
  snippet?: string
  inferredRole?: string
  salesStrategy?: string
  fallbackStatus?: 'social_blind_score'
  /* P1-1 置信标识: ai = LLM 评分；deterministic = 40/30/20/10 确定性预筛分 */
  scoreSource?: 'ai' | 'deterministic'
  /* P2-3 Stage-2 结构化机会分: icpFit(0-55) + intent(0-35) + evidence(0-10) − riskPenalty(0-20) */
  opportunityScore?: {
    icpFit: number
    intent: number
    evidence: number
    riskPenalty: number
    finalScore: number
  }
  status?: 'new' | 'contacting' | 'replied' | 'archived'
  analysisCache?: Record<string, unknown>
  dataSourceNote?: string
  /* V1.3 多源融合字段 */
  dataSourceType?: DataSourceType
  exhibitionFootprints?: string[]
  customsData?: CustomsData
  decisionMakers?: DecisionMaker[]
  agentStatus?: AgentStatus
}

export type SearchExecuteData = {
  warning?: string
  results: SearchExecuteResult[]
}

export type SearchLeadScoredPayload = {
  candidate: SearchExecuteResult
  completedCount: number
  totalCount: number
}

export type SearchStagePayload = {
  stage:
    | 'anysearch'
    | 'fetching'
    | 'normalizing'
    | 'prefiltering'
    | 'scoring'
    | 'blind_scoring'
    | 'enriching'
    | 'complete'
    | 'localized_search'
  message: string
  searchMode?: 'anysearch' | 'maps' | 'maps-keyword-fallback' | 'organic-fallback'
}

export type AnalysisGenerateRequest = {
  lead: {
    company: string
    industry?: string
    country?: string
    website?: string
    address?: string
    phone?: string
    contact?: string
    contactTitle?: string
    snippet?: string
    matchReasons?: string[]
    riskFlags?: string[]
    inferredRole?: string
    source?: string
    salesStrategy?: string
    customerText?: string
  }
  scenario: string
  /* 邮件生成语言（ISO 639-1，如 en/de/fr/es/zh）。缺省时后端按 lead.country
     推导官方语言；推导不出则回退英文。 */
  language?: string
}

export type AnalysisGenerateData = {
  semantic?: AnalysisSemanticMeta
  content?: string
  companyProfile?: string
  painPoints?: string
  valueMapping?: string
  emailSubject?: string
  emailBody?: string
  confidence?: number
  rawContent?: string
  parseFallback?: boolean
  usedKnowledgeTitles?: string[]
  usedFallback?: boolean
  source?: string
  analysis?: string
  suggestion?: string
  customerText?: string
  negotiationRisk?: string
  pricingAdvice?: string
  replyTemplate?: string
  nextAction?: string
}

export type FileExportSaveRequest = {
  fileName: string
  content: string
}

export type FileExportSaveData = {
  filePath?: string
  canceled?: boolean
}

export type FileExportPdfRequest = {
  html?: string
  fileName?: string
  company?: string
  website?: string
  country?: string
  customsData?: Record<string, unknown>
  exhibitionFootprints?: string[]
  decisionMakers?: Array<Record<string, unknown>>
  strategies?: Array<{ scenario: string; subject: string; body: string }>
}

export type FileExportPdfData = {
  filePath?: string
  canceled?: boolean
  trialRemaining?: number
}

/* ── V1.3 Multi-Source Fusion Types ── */

export type DataSourceType =
  | 'google_maps'
  | 'google_organic'
  | 'customs_shipment'
  | 'trade_show'
  | 'yellow_pages'
  | 'linkedin_search'
  | 'facebook_search'
  | 'anysearch'

export type DecisionMaker = {
  name: string
  title: string
  email: string
  phone: string
  linkedinUrl?: string
  source: string
  confidenceScore: number
  /* P0-4 静态验证标注: email 五级分级（verified/probable/catch_all/risky/invalid，
     采集层仅做零网络静态分类，故实际只会出现 risky/invalid）与 phone E.164 校验 */
  emailGrade?: string
  phoneValid?: boolean
}

export type CustomsData = {
  annualImportVolume?: string
  topSuppliers?: string[]
  originCountries?: string[]
  lastShipmentDate?: string
}

export type AgentStatus = {
  whatsappSent: boolean
  whatsappStatus?: 'pending' | 'delivered' | 'replied' | 'failed'
  linkedinContacted: boolean
  emailSequenceStage: 0 | 1 | 2 | 3
  /* P1-3：IMAP 未配置 → 回复检测盲区，邮件序列暂停等待人工确认后推进 */
  emailPendingManual?: boolean
}

/* ── V1.3 DNS Health Check Types ── */

export type DnsHealthCheckRequest = {
  domain: string
}

export type DnsRecordType = 'MX' | 'A' | 'AAAA' | 'TXT' | 'CNAME' | 'NS'

export type DnsRecord = {
  type: DnsRecordType
  value: string
  ttl?: number
}

export type DnsHealthCheckResult = {
  domain: string
  hasMX: boolean
  hasSPF: boolean
  hasDKIM?: boolean
  hasDMARC?: boolean
  records: DnsRecord[]
  valid: boolean
  error?: string
}

/* ── V1.4 Provider Registry Types ── */

export type ProviderStatusEntry = {
  id: DataSourceType
  name: string
  available: boolean
  requiredConfig: string[]
}

export type ProviderListData = {
  providers: ProviderStatusEntry[]
}

/* ── V1.3 Agent / Sandbox Types ── */

export type AgentControlRequest = {
  agentId: string
  action: 'start' | 'stop' | 'pause' | 'resume'
}

export type AgentExecutionState = {
  agentId: string
  agentType: 'scout' | 'brain' | 'data_center' | 'messaging'
  status: 'idle' | 'running' | 'paused' | 'error'
  progress?: number
  lastActivity?: string
}

/* ── V1.3 Sales Agent Types ── */

export type SalesAgentType = 'whatsapp' | 'linkedin' | 'email'

export type SalesAgentState = {
  agentId: string
  agentType: SalesAgentType
  status: 'idle' | 'running' | 'paused' | 'error'
  label: string
  description: string
  progress: number
  totalTargets: number
  completedCount: number
  failedCount: number
  lastActivity?: string
  errorMessage?: string
  dailyLimit: number
  dailyUsed: number
  queuedCount?: number
}

export type AgentListData = {
  agents: SalesAgentState[]
}

/* P0-1 双管道读端：按 leadKey 返回持久化线索态 agentStatus */
export type AgentStatusData = {
  leadKey: string
  agentStatus?: AgentStatus
}

/* L1-1/F2：per-lead 触达状态实时事件（agent:lead-status-updated，writeBackAgentStatus 时推送） */
export type AgentLeadStatusEvent = {
  leadKey: string
  agentStatus: AgentStatus
}

/* P1-4 邮件合规：退订/退信/投诉/手动 抑制名单 */
export type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint' | 'manual'

export type SuppressionEntry = {
  value: string
  reason: SuppressionReason
  addedAt: number
  note?: string
}

export type SuppressionListData = {
  entries: SuppressionEntry[]
}

export type SuppressionAddRequest = {
  email: string
  reason?: SuppressionReason
  note?: string
}

export type AgentControlData = {
  agentId: string
  status: SalesAgentState['status']
}

export type AgentLogEntry = {
  timestamp: string
  event: string
  detail?: string
}

export type AgentLogData = {
  agentId: string
  logEntries: AgentLogEntry[]
}

/* ── V1.3 Multi-Account Sandbox Types ── */

export type AccountType = 'email_smtp' | 'email_imap' | 'linkedin' | 'facebook' | 'whatsapp'

export type AccountSessionStatus = 'connected' | 'disconnected' | 'rate_limited' | 'error'

export type AccountSessionEntry = {
  accountId: string
  accountType: AccountType
  label: string
  email?: string
  status: AccountSessionStatus
  connectedAt?: string
  lastCheckedAt?: string
  errorMessage?: string
}

export type AccountConnectRequest = {
  accountType: AccountType
  label: string
  credentials: Record<string, string>
}

export type AccountConnectData = {
  accountId: string
  status: AccountSessionStatus
}

export type AccountDisconnectRequest = {
  accountId: string
}

export type AccountListData = {
  accounts: AccountSessionEntry[]
}

/* ── Cloud / Team Sync Types ── */

export type DomainCollisionResult = {
  collision: boolean
  ownerLabel?: string
  ownerMachineId?: string
  domain: string
}

export type CloudSyncResult = {
  synced: boolean
  reason?: string
}

export type CloudLeadEntry = {
  id: string
  domain: string
  email?: string
  company?: string
  country?: string
  ai_tags?: string[]
  score: number
  owner_machine_id: string
  owner_label?: string
  status?: string
  is_opened?: boolean
  opened_at?: string
  opened_geo?: string
  created_at: string
  updated_at?: string
}

export type TeamLeadsData = {
  leads: CloudLeadEntry[]
  offline: boolean
}

export type TrackingStatusData = {
  tracking: Record<string, { isOpened: boolean; openedAt?: string; openedGeo?: string }>
  offline: boolean
}

export type RealtimeLeadEvent = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: CloudLeadEntry | null
  old: Partial<CloudLeadEntry> | null
}

export type ClaimedDomainsData = {
  domains: string[]
  offline: boolean
}

/* ── Cloud CRUD Types ── */

export type UpsertLeadRequest = {
  lead: Record<string, unknown>
  force?: boolean
}

export type UpsertLeadData = {
  upserted: boolean
  id?: string
  reason?: string
}

export type CheckDomainsRequest = {
  domains: string[]
}

export type CheckDomainsData = {
  claimedDomains: string[]
  offline: boolean
}

export type CreateCampaignRequest = {
  leadId?: string
  domain: string
  email: string
  templateId: string
  sequenceStep?: number
}

export type CreateCampaignData = {
  created: boolean
  campaignId?: string
  status?: string
  error?: string
}

/* ── Cloud Outreach Dashboard Types (Phase 2.7) ── */

/**
 * 云端触达看板聚合统计（KPI 卡数据源）。
 * 结构镜像 electron/services/cloudflare-service.ts 的 DashboardStats。
 */
export type CloudDashboardStats = {
  leads: {
    total: number
    scored: number
    pendingApproval: number
    approved: number
    queued: number
    sent: number
    replied: number
    suppressed: number
  }
  outreach: {
    total: number
    pending: number
    sent: number
    delivered: number
    bounced: number
    complained: number
    failed: number
  }
  suppressions: number
  syncVersion: number
}

/** 单条云端 outreach 记录（用于漏斗 + 趋势聚合） */
export type CloudOutreachRecord = {
  id: string
  workspaceId: string
  leadId: string
  campaignId: string
  sequenceStage: number
  scheduledAt: string
  sentAt?: string | null
  deliveredAt?: string | null
  bouncedAt?: string | null
  complainedAt?: string | null
  repliedAt?: string | null
  provider: string
  resendId?: string | null
  providerMessageId?: string | null
  subject: string
  status: string
  bounceType?: string | null
  error?: string | null
  sendAttempts: number
  nextRetryAt?: string | null
  createdAt: string
  updatedAt: string
}

export type CloudPollOutreachData = {
  outreach: CloudOutreachRecord[]
  limit: number
  offset: number
}

/** IMAP 单次轮询结果（对应 electron/services/imap-reply-service.ts 的 ImapPollResult） */
export type CloudImapPollResult = {
  polled: number
  matched: number
  reported: number
  idempotent: number
  skipped?: string
  errors: string[]
  since: string
  at: string
}

/** IMAP 状态查询返回（对应 getImapReplyStatus） */
export type CloudImapStatusData = {
  enabled: boolean
  intervalMs: number
  lookbackDays: number
  cloudflareConfigured: boolean
  imapConfigured: boolean
  running: boolean
  lastPoll: { at: string; result: CloudImapPollResult } | null
}

/** IMAP 主机连接测试结果（对应 imap-reply-service.testImapConnection） */
export type CloudImapTestResult = {
  ok: boolean
  message: string
  mailbox?: string
  totalMessages?: number
  latencyMs?: number
}

/* ── Automation Types ── */

export type EmailVerifyResult = {
  email: string
  valid: boolean
  /* P0-3 五级分级: verified / probable / catch_all / risky / invalid */
  grade?: string
  reason?: string
}

export type EmailVerifyData = {
  results: EmailVerifyResult[]
}

export type CampaignStartRequest = {
  leads: Array<Record<string, unknown>>
  templateId?: string
}

export type CampaignStartData = {
  triggered: boolean
  accepted?: number
  rejected?: number
  error?: string
  message?: string
}

export type ElectronApi = {
  system: {
    getDeviceStatus: () => Promise<IpcResponse<SystemDeviceStatusData>>
  }
  auth: {
    login: (options: AuthLoginRequest) => Promise<IpcResponse<AuthLoginData>>
    logout: () => Promise<IpcResponse<AuthLogoutData>>
    getSession: () => Promise<IpcResponse<AuthSessionData>>
  }
  license: {
    verify: (key: string) => Promise<IpcResponse<LicenseVerifyData>>
    checkStatus: () => Promise<IpcResponse<LicenseStatusData>>
    getInfo: () => Promise<IpcResponse<LicenseInfoData>>
    submit: (payload: LicenseSubmitRequest) => Promise<IpcResponse<LicenseSubmitData>>
    requestTrial: () => Promise<IpcResponse<TrialRequestData>>
  }
  config: {
    get: <T = unknown>(key: string) => Promise<IpcResponse<T>>
    set: <T = unknown>(payload: ConfigSetRequest<T>) => Promise<IpcResponse<null>>
    save: <T = unknown>(payload: ConfigSetRequest<T>) => Promise<IpcResponse<null>>
    fetchModels: (payload: FetchModelsRequest) => Promise<IpcResponse<FetchModelsData>>
  }
  secret: {
    set: (payload: SecretSetRequest) => Promise<IpcResponse<SecretCheckData>>
    check: (key: string) => Promise<IpcResponse<SecretCheckData>>
  }
  api: {
    testConnection: (payload: TestConnectionRequest) => Promise<IpcResponse<TestConnectionData>>
    proxy: (payload: ProxyRequest) => Promise<IpcResponse<ProxyData>>
  }
  search: {
    execute: (payload: SearchExecuteRequest) => Promise<IpcResponse<SearchExecuteData>>
  }
  onSearchStreamStart: (callback: (total: number) => void) => () => void
  onSearchStage: (callback: (payload: SearchStagePayload) => void) => () => void
  onSearchBasicResults: (callback: (results: SearchExecuteResult[]) => void) => () => void
  onSearchLeadScored: (callback: (payload: SearchLeadScoredPayload) => void) => () => void
  onSearchStreamComplete: (callback: () => void) => () => void
  onSearchStreamError: (callback: (error: string) => void) => () => void
  autopilot: {
    getState: <T = unknown>() => Promise<IpcResponse<AutopilotStateEnvelope<T>>>
    setState: <T = unknown>(payload: AutopilotStatePayload<T>) => Promise<IpcResponse<null>>
    clearLegacy: () => Promise<IpcResponse<null>>
    syncLifecycle: (lifecycle: AutopilotLifecycle) => Promise<IpcResponse<null>>
  }
  onAutopilotAction: (callback: (action: AutopilotAction) => void) => () => void
  analysis: {
    generate: (payload: AnalysisGenerateRequest) => Promise<IpcResponse<AnalysisGenerateData>>
  }
  files: {
    saveExport: (payload: FileExportSaveRequest) => Promise<IpcResponse<FileExportSaveData>>
    exportPdf: (payload: FileExportPdfRequest) => Promise<IpcResponse<FileExportPdfData>>
  }
  cloud: {
    checkCollision: (payload: { domain: string }) => Promise<IpcResponse<DomainCollisionResult>>
    syncLead: (payload: { lead: Record<string, unknown>; force?: boolean }) => Promise<IpcResponse<CloudSyncResult>>
    upsertLead: (payload: UpsertLeadRequest) => Promise<IpcResponse<UpsertLeadData>>
    checkDomains: (payload: CheckDomainsRequest) => Promise<IpcResponse<CheckDomainsData>>
    createCampaign: (payload: CreateCampaignRequest) => Promise<IpcResponse<CreateCampaignData>>
    fetchTeamLeads: (payload?: { limit?: number }) => Promise<IpcResponse<TeamLeadsData>>
    fetchTracking: (payload: { domains: string[] }) => Promise<IpcResponse<TrackingStatusData>>
    subscribeRealtime: () => Promise<IpcResponse<null>>
    unsubscribeRealtime: () => Promise<IpcResponse<null>>
    fetchClaimedDomains: () => Promise<IpcResponse<ClaimedDomainsData>>
    /* Phase 1 · Cloudflare 云端引擎 */
    cloudflareConfigured: () => Promise<IpcResponse<{ configured: boolean }>>
    cloudflareTestConnection: () => Promise<IpcResponse<{ ok: boolean; message: string; latencyMs: number }>>
    /* [V1.3.8] Phase 2.7 · 云端触达看板 */
    cloudflareDashboardStats: () => Promise<IpcResponse<CloudDashboardStats>>
    cloudflarePollOutreachStatus: (opts?: {
      status?: string
      limit?: number
      offset?: number
    }) => Promise<IpcResponse<CloudPollOutreachData>>
  }
  onCloudRealtimeLeadEvent: (callback: (event: RealtimeLeadEvent) => void) => () => void
  automation: {
    verifyEmails: (payload: { emails: string[] }) => Promise<IpcResponse<EmailVerifyData>>
    startCampaign: (payload: CampaignStartRequest) => Promise<IpcResponse<CampaignStartData>>
    /* [V1.3.8] Phase 2.5 · IMAP 回复检测 */
    imapPoll: () => Promise<IpcResponse<CloudImapPollResult>>
    imapStatus: () => Promise<IpcResponse<CloudImapStatusData>>
    /* [V1.3.11] Phase 2.8c · IMAP 自动轮询开关切换后即时重启 timer */
    imapRestart: () => Promise<IpcResponse<CloudImapStatusData>>
    /* [V1.3.12] Phase 2.8d · IMAP 主机连接测试 */
    imapTestConnection: () => Promise<IpcResponse<CloudImapTestResult>>
  }
  accounts: {
    connect: (payload: AccountConnectRequest) => Promise<IpcResponse<AccountConnectData>>
    disconnect: (payload: AccountDisconnectRequest) => Promise<IpcResponse<null>>
    getList: () => Promise<IpcResponse<AccountListData>>
  }
  onAccountStatusUpdate: (callback: (entry: AccountSessionEntry) => void) => () => void
  agents: {
    getList: () => Promise<IpcResponse<AgentListData>>
    control: (payload: AgentControlRequest) => Promise<IpcResponse<AgentControlData>>
    getLog: (agentId: string) => Promise<IpcResponse<AgentLogData>>
    getStatus: (leadKey: string) => Promise<IpcResponse<AgentStatusData>>
    getSuppressionList: () => Promise<IpcResponse<SuppressionListData>>
    addSuppression: (payload: SuppressionAddRequest) => Promise<IpcResponse<SuppressionListData>>
    removeSuppression: (payload: { email: string }) => Promise<IpcResponse<SuppressionListData>>
  }
  onAgentStatusChanged: (callback: (state: SalesAgentState) => void) => () => void
  onAgentLeadStatusUpdated: (callback: (event: AgentLeadStatusEvent) => void) => () => void
  dns: {
    healthCheck: (payload: DnsHealthCheckRequest) => Promise<IpcResponse<DnsHealthCheckResult>>
  }
  providers: {
    getList: () => Promise<IpcResponse<ProviderListData>>
  }
}
