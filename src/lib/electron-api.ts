import type {
  AccountConnectData,
  AccountConnectRequest,
  AccountDisconnectRequest,
  AccountListData,
  AccountSessionEntry,
  AgentControlData,
  AgentControlRequest,
  AgentListData,
  AgentLogData,
  AgentLeadStatusEvent,
  AgentStatusData,
  AnalysisGenerateData,
  AnalysisGenerateRequest,
  AutopilotAction,
  AutopilotLifecycle,
  AutopilotStatePayload,
  CampaignStartData,
  CampaignStartRequest,
  CheckDomainsData,
  ClaimedDomainsData,
  ConfigSetRequest,
  CreateCampaignData,
  CreateCampaignRequest,
  DnsHealthCheckResult,
  DomainCollisionResult,
  EmailVerifyData,
  FetchModelsData,
  FetchModelsRequest,
  FileExportPdfData,
  FileExportPdfRequest,
  FileExportSaveData,
  FileExportSaveRequest,
  IpcResponse,
  LicenseInfoData,
  LicenseSubmitData,
  LicenseSubmitRequest,
  ProviderListData,
  ProxyData,
  ProxyRequest,
  RealtimeLeadEvent,
  SalesAgentState,
  SecretCheckData,
  SecretSetRequest,
  SearchExecuteData,
  SearchExecuteRequest,
  SearchLeadScoredPayload,
  SearchExecuteResult,
  SearchStagePayload,
  TeamLeadsData,
  TestConnectionData,
  TestConnectionRequest,
  TrackingStatusData,
  TrialRequestData,
  UpsertLeadData,
} from '@/shared/ipc-contracts'

export class ElectronApiError extends Error {
  code?: number
  canceled?: boolean
  meta?: Record<string, unknown>

  constructor(message: string, code?: number, options?: { canceled?: boolean; meta?: Record<string, unknown> }) {
    super(message)
    this.name = 'ElectronApiError'
    this.code = code
    this.canceled = options?.canceled
    this.meta = options?.meta
  }
}

const SEARCH_EXECUTE_TIMEOUT_MS = 300_000
const ANALYSIS_GENERATE_TIMEOUT_MS = 60_000

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      console.error(`⏰ [IPC调用超时] ${label} 超时，阈值: ${timeoutMs}ms`)
      reject(new ElectronApiError(`${label} 超时（${timeoutMs}ms）`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export const unwrapIpc = <T>(response: IpcResponse<T> | undefined | null, fallbackMessage = 'IPC 调用失败'): T => {
  if (!response?.success) {
    throw new ElectronApiError(response?.error || fallbackMessage, response?.code, { meta: response?.meta })
  }
  return response.data as T
}

export const configGet = async <T = unknown>(key: string) =>
  unwrapIpc<T | null>(await window.electronAPI.config.get<T | null>(key), `读取配置失败: ${key}`)

export const configSet = async <T = unknown>(payload: ConfigSetRequest<T>) =>
  unwrapIpc(await window.electronAPI.config.set(payload), `保存配置失败: ${payload.key}`)

export const autopilotStateGet = async <T = unknown>() =>
  unwrapIpc(await window.electronAPI.autopilot.getState<T>(), '读取巡航状态失败')

export const autopilotStateSet = async <T = unknown>(payload: AutopilotStatePayload<T>) =>
  unwrapIpc(await window.electronAPI.autopilot.setState(payload), '保存巡航状态失败')

export const autopilotClearLegacy = async () =>
  unwrapIpc(await window.electronAPI.autopilot.clearLegacy(), '清理旧巡航配置失败')

export const autopilotSyncLifecycle = async (lifecycle: AutopilotLifecycle) =>
  unwrapIpc(await window.electronAPI.autopilot.syncLifecycle(lifecycle), '同步巡航状态失败')

export const secretSet = async (payload: SecretSetRequest): Promise<SecretCheckData> =>
  unwrapIpc(await window.electronAPI.secret.set(payload), `保存密钥失败: ${payload.key}`)

export const secretCheck = async (key: string): Promise<SecretCheckData> =>
  unwrapIpc(await window.electronAPI.secret.check(key), `读取密钥状态失败: ${key}`)

export const fetchModels = async (payload: FetchModelsRequest): Promise<FetchModelsData> =>
  unwrapIpc(await window.electronAPI.config.fetchModels(payload), '模型识别失败')

export const testConnection = async (payload: TestConnectionRequest): Promise<TestConnectionData> =>
  unwrapIpc(await window.electronAPI.api.testConnection(payload), '连接失败')

export const proxyRequest = async (payload: ProxyRequest): Promise<ProxyData> =>
  unwrapIpc(await window.electronAPI.api.proxy(payload), '代理请求失败')

export const searchExecute = async (payload: SearchExecuteRequest): Promise<SearchExecuteData> => {
  const response = await withTimeout(
    window.electronAPI.search.execute(payload),
    SEARCH_EXECUTE_TIMEOUT_MS,
    'searchExecute',
  )
  const normalized = unwrapIpc<SearchExecuteData>(response, '搜索失败')
  return {
    warning: normalized.warning,
    results: Array.isArray(normalized.results) ? normalized.results : [],
  }
}

export const onSearchBasicResults = (callback: (results: SearchExecuteResult[]) => void) =>
  window.electronAPI.onSearchBasicResults(callback)

export const onSearchLeadScored = (callback: (payload: SearchLeadScoredPayload) => void) =>
  window.electronAPI.onSearchLeadScored(callback)

export const onSearchStreamStart = (callback: (total: number) => void) =>
  window.electronAPI.onSearchStreamStart(callback)

export const onSearchStage = (callback: (payload: SearchStagePayload) => void) =>
  window.electronAPI.onSearchStage(callback)

export const onSearchStreamComplete = (callback: () => void) => window.electronAPI.onSearchStreamComplete(callback)

export const onSearchStreamError = (callback: (error: string) => void) =>
  window.electronAPI.onSearchStreamError(callback)

export const onAutopilotAction = (callback: (action: AutopilotAction) => void) =>
  window.electronAPI.onAutopilotAction(callback)

export const analysisGenerate = async (payload: AnalysisGenerateRequest): Promise<AnalysisGenerateData> =>
  unwrapIpc(
    await withTimeout(window.electronAPI.analysis.generate(payload), ANALYSIS_GENERATE_TIMEOUT_MS, 'analysisGenerate'),
    'AI 分析失败',
  )

export const saveExportFile = async (payload: FileExportSaveRequest): Promise<FileExportSaveData> => {
  const response = await window.electronAPI.files.saveExport(payload)
  if (response?.canceled) {
    return { canceled: true }
  }
  if (!response?.success) {
    throw new ElectronApiError(response?.error || '导出失败', response?.code, { canceled: false })
  }
  return (response.data as FileExportSaveData) ?? {}
}

export const exportPdfFile = async (payload: FileExportPdfRequest): Promise<FileExportPdfData> => {
  const response = await window.electronAPI.files.exportPdf(payload)
  if (response?.canceled) {
    return { canceled: true }
  }
  if (!response?.success) {
    throw new ElectronApiError(response?.error || 'PDF 导出失败', response?.code, {
      canceled: false,
      meta: response?.meta,
    })
  }
  return (response.data as FileExportPdfData) ?? {}
}

export const verifyLicense = async (key: string) =>
  unwrapIpc(await window.electronAPI.license.verify(key), '授权验证失败')

export const getLicenseStatus = async () =>
  unwrapIpc(await window.electronAPI.license.checkStatus(), '读取授权状态失败')

export const getAuthSession = async () => unwrapIpc(await window.electronAPI.auth.getSession(), '读取会话状态失败')

export const getLicenseInfo = async (): Promise<LicenseInfoData> =>
  unwrapIpc(await window.electronAPI.license.getInfo(), '读取授权信息失败')

export const submitLicense = async (payload: LicenseSubmitRequest): Promise<LicenseSubmitData> =>
  unwrapIpc(await window.electronAPI.license.submit(payload), '授权提交失败')

export const requestTrial = async (): Promise<TrialRequestData> =>
  unwrapIpc(await window.electronAPI.license.requestTrial(), '试用申请失败')

/* ── Cloud / Team Sync ── */

export const checkDomainCollision = async (domain: string): Promise<DomainCollisionResult> =>
  unwrapIpc(await window.electronAPI.cloud.checkCollision({ domain }), '防撞单检测失败')

export const fetchTeamLeads = async (limit?: number): Promise<TeamLeadsData> =>
  unwrapIpc(await window.electronAPI.cloud.fetchTeamLeads(limit ? { limit } : undefined), '团队线索拉取失败')

export const fetchTrackingStatus = async (domains: string[]): Promise<TrackingStatusData> =>
  unwrapIpc(await window.electronAPI.cloud.fetchTracking({ domains }), '追踪状态查询失败')

export const upsertLeadToCloud = async (lead: Record<string, unknown>, force?: boolean): Promise<UpsertLeadData> =>
  unwrapIpc(await window.electronAPI.cloud.upsertLead({ lead, force }), '线索写入失败')

export const checkDomainsCollision = async (domains: string[]): Promise<CheckDomainsData> =>
  unwrapIpc(await window.electronAPI.cloud.checkDomains({ domains }), '批量撞单检测失败')

export const createCloudCampaign = async (payload: CreateCampaignRequest): Promise<CreateCampaignData> =>
  unwrapIpc(await window.electronAPI.cloud.createCampaign(payload), '创建发信任务失败')

/* ── Automation ── */

export const verifyEmails = async (emails: string[]): Promise<EmailVerifyData> =>
  unwrapIpc(await window.electronAPI.automation.verifyEmails({ emails }), '邮箱验证失败')

export const startCampaign = async (payload: CampaignStartRequest): Promise<CampaignStartData> =>
  unwrapIpc(await window.electronAPI.automation.startCampaign(payload), '发信启动失败')

/* ── Realtime ── */

export const subscribeCloudRealtime = async () =>
  unwrapIpc(await window.electronAPI.cloud.subscribeRealtime(), 'Realtime 订阅失败')

export const unsubscribeCloudRealtime = async () =>
  unwrapIpc(await window.electronAPI.cloud.unsubscribeRealtime(), 'Realtime 退订失败')

export const fetchClaimedDomains = async (): Promise<ClaimedDomainsData> =>
  unwrapIpc(await window.electronAPI.cloud.fetchClaimedDomains(), '已认领域名查询失败')

export const onCloudRealtimeLeadEvent = (callback: (event: RealtimeLeadEvent) => void) =>
  window.electronAPI.onCloudRealtimeLeadEvent(callback)

/* ── V1.3 Multi-Account Sandbox ── */

export const accountConnect = async (payload: AccountConnectRequest): Promise<AccountConnectData> =>
  unwrapIpc(await window.electronAPI.accounts.connect(payload), '账号连接失败')

export const accountDisconnect = async (payload: AccountDisconnectRequest): Promise<void> => {
  unwrapIpc(await window.electronAPI.accounts.disconnect(payload), '账号断开失败')
}

export const accountGetList = async (): Promise<AccountListData> =>
  unwrapIpc(await window.electronAPI.accounts.getList(), '读取账号列表失败')

export const onAccountStatusUpdate = (callback: (entry: AccountSessionEntry) => void) =>
  window.electronAPI.onAccountStatusUpdate(callback)

/* ── V1.3 Sales Agents ── */

export const agentGetList = async (): Promise<AgentListData> =>
  unwrapIpc(await window.electronAPI.agents.getList(), '读取智能体列表失败')

export const agentControl = async (payload: AgentControlRequest): Promise<AgentControlData> =>
  unwrapIpc(await window.electronAPI.agents.control(payload), '智能体控制指令失败')

export const onAgentStatusChanged = (callback: (state: SalesAgentState) => void) =>
  window.electronAPI.onAgentStatusChanged(callback)

/* L1-1/F2：per-lead 触达状态实时事件（线索表徽标即时刷新） */
export const onAgentLeadStatusUpdated = (callback: (event: AgentLeadStatusEvent) => void) =>
  window.electronAPI.onAgentLeadStatusUpdated(callback)

export const agentGetLog = async (agentId: string): Promise<AgentLogData> =>
  unwrapIpc(await window.electronAPI.agents.getLog(agentId), '读取智能体运行日志失败')

/* P0-1 双管道读端：按 leadKey 读取持久化线索态 agentStatus */
export const agentGetStatus = async (leadKey: string): Promise<AgentStatusData> =>
  unwrapIpc(await window.electronAPI.agents.getStatus(leadKey), '读取线索触达状态失败')

/* ── V1.3 DNS Health Check ── */

export const dnsHealthCheck = async (domain: string): Promise<DnsHealthCheckResult> =>
  unwrapIpc(await window.electronAPI.dns.healthCheck({ domain }), 'DNS 健康检测失败')

/* ── V1.4 Provider Status ── */

export const providerList = async (): Promise<ProviderListData> =>
  unwrapIpc(await window.electronAPI.providers.getList(), '读取 Provider 状态失败')
