import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../electron/ipc/channels'
import type {
  AnalysisGenerateRequest,
  AccountConnectRequest,
  AccountDisconnectRequest,
  AuthLoginRequest,
  CampaignStartRequest,
  CheckDomainsRequest,
  ConfigSetRequest,
  CreateCampaignRequest,
  ElectronApi,
  FetchModelsRequest,
  FileExportPdfRequest,
  FileExportSaveRequest,
  LicenseSubmitRequest,
  ProxyRequest,
  SecretSetRequest,
  SearchExecuteRequest,
  TestConnectionRequest,
  UpsertLeadRequest,
} from '../src/shared/ipc-contracts'

const electronAPI: ElectronApi = {
  // 1. 系统基础
  system: {
    getDeviceStatus: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_DEVICE_STATUS),
  },
  auth: {
    login: (options: AuthLoginRequest) => ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGIN, options),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGOUT),
    getSession: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH.GET_SESSION),
  },
  license: {
    verify: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.LICENSE.VERIFY, key),
    checkStatus: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSE.CHECK_STATUS),
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSE.GET_INFO),
    submit: (payload: LicenseSubmitRequest) => ipcRenderer.invoke(IPC_CHANNELS.LICENSE.SUBMIT, payload),
    requestTrial: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSE.REQUEST_TRIAL),
  },
  config: {
    get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET, key),
    set: (data: ConfigSetRequest) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG.SET, data),
    save: (data: ConfigSetRequest) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG.SET, data),
    fetchModels: (payload: FetchModelsRequest) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG.FETCH_MODELS, payload),
  },
  autopilot: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.AUTOPILOT.GET_STATE),
    setState: (payload) => ipcRenderer.invoke(IPC_CHANNELS.AUTOPILOT.SET_STATE, payload),
    clearLegacy: () => ipcRenderer.invoke(IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY),
    // 包装为 { lifecycle } 对象以匹配 autopilotSyncLifecycleContract 请求契约
    // （preload 的职责即构造线协议形态；渲染层公开 API 仍传原始 lifecycle 字符串）。
    syncLifecycle: (lifecycle) => ipcRenderer.invoke(IPC_CHANNELS.AUTOPILOT.SYNC_STATE, { lifecycle }),
  },
  secret: {
    set: (payload: SecretSetRequest) => ipcRenderer.invoke(IPC_CHANNELS.SECRET.SET, payload),
    check: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.SECRET.CHECK, key),
  },
  api: {
    testConnection: (payload: TestConnectionRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.SEARCH.API_TEST_CONNECTION, payload),
    proxy: (payload: ProxyRequest) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH.API_PROXY, payload),
  },
  search: {
    execute: (query: SearchExecuteRequest) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH.EXECUTE, query),
  },
  onSearchStreamStart: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, total: unknown) => {
      callback(typeof total === 'number' ? total : 0)
    }
    ipcRenderer.on(IPC_CHANNELS.SEARCH.STREAM_START, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SEARCH.STREAM_START, listener)
  },
  onSearchStage: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      // DATA-08 修复：流式事件校验增强——拒绝非对象 payload 并记录警告
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        callback(payload as any)
      } else {
        console.warn('[Preload] onSearchStage: 丢弃非法 payload', typeof payload)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.SEARCH.STAGE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SEARCH.STAGE, listener)
  },
  onSearchBasicResults: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, results: unknown) => {
      callback(Array.isArray(results) ? (results as any) : [])
    }
    ipcRenderer.on(IPC_CHANNELS.SEARCH.BASIC_RESULTS, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SEARCH.BASIC_RESULTS, listener)
  },
  onSearchLeadScored: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object') {
        callback(payload as any)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.SEARCH.LEAD_SCORED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SEARCH.LEAD_SCORED, listener)
  },
  onSearchStreamComplete: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(IPC_CHANNELS.SEARCH.STREAM_COMPLETE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SEARCH.STREAM_COMPLETE, listener)
  },
  onSearchStreamError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, error: unknown) => {
      callback(typeof error === 'string' ? error : 'Search stream failed')
    }
    ipcRenderer.on(IPC_CHANNELS.SEARCH.STREAM_ERROR, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SEARCH.STREAM_ERROR, listener)
  },
  onAutopilotAction: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (action === 'pause' || action === 'resume' || action === 'stop') {
        callback(action)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.SYSTEM.AUTOPILOT_ACTION, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SYSTEM.AUTOPILOT_ACTION, listener)
  },
  analysis: {
    generate: (payload: AnalysisGenerateRequest) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE, payload),
  },
  files: {
    saveExport: (payload: FileExportSaveRequest) => ipcRenderer.invoke(IPC_CHANNELS.FILES.EXPORT_SAVE, payload),
    exportPdf: (payload: FileExportPdfRequest) => ipcRenderer.invoke(IPC_CHANNELS.FILES.EXPORT_PDF, payload),
  },
  cloud: {
    checkCollision: (payload: { domain: string }) => ipcRenderer.invoke(IPC_CHANNELS.CLOUD.CHECK_COLLISION, payload),
    syncLead: (payload: { lead: Record<string, unknown>; force?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CLOUD.SYNC_LEAD, payload),
    upsertLead: (payload: UpsertLeadRequest) => ipcRenderer.invoke(IPC_CHANNELS.CLOUD.UPSERT_LEAD, payload),
    checkDomains: (payload: CheckDomainsRequest) => ipcRenderer.invoke(IPC_CHANNELS.CLOUD.CHECK_DOMAINS, payload),
    createCampaign: (payload: CreateCampaignRequest) => ipcRenderer.invoke(IPC_CHANNELS.CLOUD.CREATE_CAMPAIGN, payload),
    fetchTeamLeads: (payload?: { limit?: number }) => ipcRenderer.invoke(IPC_CHANNELS.CLOUD.FETCH_TEAM_LEADS, payload),
    fetchTracking: (payload: { domains: string[] }) => ipcRenderer.invoke(IPC_CHANNELS.CLOUD.FETCH_TRACKING, payload),
    subscribeRealtime: () => ipcRenderer.invoke(IPC_CHANNELS.CLOUD.SUBSCRIBE_REALTIME),
    unsubscribeRealtime: () => ipcRenderer.invoke(IPC_CHANNELS.CLOUD.UNSUBSCRIBE_REALTIME),
    fetchClaimedDomains: () => ipcRenderer.invoke(IPC_CHANNELS.CLOUD.FETCH_CLAIMED_DOMAINS),
  },
  onCloudRealtimeLeadEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object') callback(payload as any)
    }
    ipcRenderer.on(IPC_CHANNELS.CLOUD.REALTIME_LEAD_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CLOUD.REALTIME_LEAD_EVENT, listener)
  },
  automation: {
    verifyEmails: (payload: { emails: string[] }) => ipcRenderer.invoke(IPC_CHANNELS.AUTOMATION.VERIFY_EMAILS, payload),
    startCampaign: (payload: CampaignStartRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOMATION.START_CAMPAIGN, payload),
  },
  accounts: {
    connect: (payload: AccountConnectRequest) => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT.CONNECT, payload),
    disconnect: (payload: AccountDisconnectRequest) => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT.DISCONNECT, payload),
    getList: () => ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT.GET_LIST),
  },
  onAccountStatusUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object') {
        callback(payload as any)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.ACCOUNT.STATUS_UPDATE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ACCOUNT.STATUS_UPDATE, listener)
  },
  agents: {
    getList: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT.LIST),
    control: (payload: { agentId: string; action: string }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT.CONTROL, payload),
    getLog: (agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT.GET_LOG, agentId),
    getStatus: (leadKey: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT.GET_STATUS, leadKey),
    getSuppressionList: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT.SUPPRESS_LIST),
    addSuppression: (payload: { email: string; reason?: string; note?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT.SUPPRESS_ADD, payload),
    removeSuppression: (payload: { email: string }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT.SUPPRESS_REMOVE, payload),
  },
  onAgentStatusChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object') {
        callback(payload as any)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.AGENT.STATUS_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT.STATUS_CHANGED, listener)
  },
  onAgentLeadStatusUpdated: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object') {
        callback(payload as any)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.AGENT.LEAD_STATUS_UPDATED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT.LEAD_STATUS_UPDATED, listener)
  },
  dns: {
    healthCheck: (payload: { domain: string }) => ipcRenderer.invoke(IPC_CHANNELS.DNS.HEALTH_CHECK, payload),
  },
  providers: {
    getList: () => ipcRenderer.invoke(IPC_CHANNELS.PROVIDER.LIST),
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
