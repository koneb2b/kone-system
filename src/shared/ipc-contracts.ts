export type IpcResponse<T = unknown> = {
  success: boolean;
  canceled?: boolean;
  data?: T;
  error?: string;
  code?: number;
  meta?: Record<string, unknown>;
};

export type AuthLoginRequest = {
  issuerBaseUrl: string;
  realm: string;
  clientId: string;
  scopes?: string[];
  callbackPath?: string;
  timeoutMs?: number;
  extraAuthParams?: Record<string, string | undefined>;
};

export type AuthLoginData = {
  state: string;
  redirectUri: string;
  authenticated: boolean;
};

export type AuthLogoutData = {
  loggedOut: boolean;
};

export type AuthSessionData = {
  authenticated: boolean;
  hasRefreshToken: boolean;
  expiresAt?: number;
};

export type LicenseVerifyData = {
  status: 'active' | 'expired';
  expiresAt: number;
  features: string[];
  plan?: 'trial' | 'basic' | 'premium' | 'pro' | 'enterprise';
  type?: 'trial' | 'license';
  isExpired?: boolean;
  machineId?: string;
  tier?: 'unregistered' | 'basic' | 'premium';
};

export type LicenseStatusData = {
  status: 'active' | 'expired';
  expiresAt: number;
  features: string[];
  plan?: 'trial' | 'basic' | 'premium' | 'pro' | 'enterprise';
  type?: 'trial' | 'license';
  isExpired?: boolean;
  machineId?: string;
  tier?: 'unregistered' | 'basic' | 'premium';
};

export type LicenseTier = 'unregistered' | 'basic' | 'premium' | 'expired';

export type LicenseInfoData = {
  tier: LicenseTier;
  machineId: string;
  isDev: boolean;
  isTrial: boolean;
  isLocked?: boolean;
  daysLeft: number;
  hasLlmApiKey: boolean;
  plan: string;
  expiresAt: number;
  features: string[];
  message?: string;
};

export type LicenseSubmitRequest = {
  licenseKey: string;
  llmApiKey?: string;
};

export type LicenseSubmitData = {
  tier: LicenseTier;
  status: 'active' | 'expired';
  expiresAt: number;
  features: string[];
  plan?: string;
  type?: 'trial' | 'license';
  isExpired?: boolean;
  isTrial?: boolean;
  machineId?: string;
  message?: string;
};

export type TrialRequestData = {
  success: boolean;
  tier?: LicenseTier;
  daysLeft?: number;
  expiresAt?: number;
  message?: string;
};

export type SystemDeviceStatusData = {
  available: boolean;
  machineId?: string;
};

export type ConfigSetRequest<T = unknown> = {
  key: string;
  value: T;
};

export type AutopilotAction = 'pause' | 'resume' | 'stop';
export type AutopilotLifecycle = 'idle' | 'running' | 'paused' | 'completed' | 'error';
export type AutopilotStateKind = 'hydrating' | 'ready_empty' | 'queued_idle' | 'running' | 'paused' | 'cooldown' | 'completed' | 'error' | 'state_unavailable' | 'environment_mock';

export type AnalysisSemanticCode =
  | 'missing_llm_key'
  | 'missing_llm_base_url'
  | 'missing_icp_profile'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'invalid_scenario'
  | 'insufficient_lead_data'
  | 'dev_mock_active';

export type AnalysisSemanticMeta = {
  code: AnalysisSemanticCode;
  degraded?: boolean;
  mockMode?: boolean;
  degradedReason?: AnalysisSemanticCode;
  source?: 'website' | 'snippet' | 'reply_coach' | 'dev_mock';
  settingsActionable?: boolean;
};

export type AutopilotStateEnvelope<T = unknown> = {
  stateKind: AutopilotStateKind;
  statusReason?: string;
  source?: 'persisted' | 'runner' | 'dev_shell' | 'main_process';
  state: T | null;
};

export type AutopilotStatePayload<T = unknown> = {
  state: T;
};

export type SecretSetRequest = {
  key: string;
  value: string;
};

export type SecretCheckData = {
  exists: boolean;
  masked?: string;
};

export type FetchModelsRequest = {
  apiKey: string;
  baseUrl: string;
};

export type FetchModelsData = {
  models: string[];
};

export type TestConnectionRequest = {
  provider: string;
  key?: string;
  baseUrl?: string;
};

export type TestConnectionData = {
  status?: number;
  details?: string;
  testedUrl?: string;
};

export type ProxyRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

export type ProxyData = {
  status?: number;
  data?: unknown;
};

export type SearchExecuteRequest = {
  keyword: string;
  country?: string;
  city?: string;
  filterOptions?: {
    priorityWebsite?: boolean;
    localDomainOnly?: boolean;
    highRelevanceOnly?: boolean;
    b2bRoleOnly?: boolean;
  };
};

export type SearchExecuteResult = {
  id?: string;
  company: string;
  website: string;
  contact?: string;
  contactTitle?: string;
  email?: string;
  phone: string;
  address: string;
  isB2B?: boolean | null;
  matchReasons?: string[];
  riskFlags?: string[];
  matchScore?: number | null;
  source?: string;
  country?: string;
  city?: string;
  snippet?: string;
  inferredRole?: string;
  salesStrategy?: string;
  fallbackStatus?: 'social_blind_score';
  status?: 'new' | 'contacting' | 'replied' | 'archived';
  analysisCache?: Record<string, unknown>;
};

export type SearchExecuteData = {
  warning?: string;
  results: SearchExecuteResult[];
};

export type SearchLeadScoredPayload = {
  candidate: SearchExecuteResult;
  completedCount: number;
  totalCount: number;
};

export type SearchStagePayload = {
  stage: 'fetching' | 'normalizing' | 'scoring' | 'enriching' | 'complete';
  message: string;
  searchMode?: 'maps' | 'maps-keyword-fallback' | 'organic-fallback';
};

export type AnalysisGenerateRequest = {
  lead: {
    company: string;
    industry?: string;
    country?: string;
    website?: string;
    address?: string;
    phone?: string;
    contact?: string;
    contactTitle?: string;
    snippet?: string;
    matchReasons?: string[];
    riskFlags?: string[];
    inferredRole?: string;
    source?: string;
    salesStrategy?: string;
    customerText?: string;
  };
  scenario: string;
};

export type AnalysisGenerateData = {
  semantic?: AnalysisSemanticMeta;
  content?: string;
  companyProfile?: string;
  painPoints?: string;
  valueMapping?: string;
  emailSubject?: string;
  emailBody?: string;
  confidence?: number;
  rawContent?: string;
  parseFallback?: boolean;
  usedKnowledgeTitles?: string[];
  usedFallback?: boolean;
  source?: string;
  analysis?: string;
  suggestion?: string;
  customerText?: string;
  negotiationRisk?: string;
  pricingAdvice?: string;
  replyTemplate?: string;
  nextAction?: string;
};

export type FileExportSaveRequest = {
  fileName: string;
  content: string;
};

export type FileExportSaveData = {
  filePath?: string;
  canceled?: boolean;
};

/* ── Cloud / Team Sync Types ── */

export type DomainCollisionResult = {
  collision: boolean;
  ownerLabel?: string;
  ownerMachineId?: string;
  domain: string;
};

export type CloudSyncResult = {
  synced: boolean;
  reason?: string;
};

export type CloudLeadEntry = {
  id: string;
  domain: string;
  email?: string;
  company?: string;
  country?: string;
  ai_tags?: string[];
  score: number;
  owner_machine_id: string;
  owner_label?: string;
  status?: string;
  is_opened?: boolean;
  opened_at?: string;
  opened_geo?: string;
  created_at: string;
  updated_at?: string;
};

export type TeamLeadsData = {
  leads: CloudLeadEntry[];
  offline: boolean;
};

export type TrackingStatusData = {
  tracking: Record<string, { isOpened: boolean; openedAt?: string; openedGeo?: string }>;
  offline: boolean;
};

export type RealtimeLeadEvent = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: CloudLeadEntry | null;
  old: Partial<CloudLeadEntry> | null;
};

export type ClaimedDomainsData = {
  domains: string[];
  offline: boolean;
};

/* ── Cloud CRUD Types ── */

export type UpsertLeadRequest = {
  lead: Record<string, unknown>;
  force?: boolean;
};

export type UpsertLeadData = {
  upserted: boolean;
  id?: string;
  reason?: string;
};

export type CheckDomainsRequest = {
  domains: string[];
};

export type CheckDomainsData = {
  claimedDomains: string[];
  offline: boolean;
};

export type CreateCampaignRequest = {
  leadId?: string;
  domain: string;
  email: string;
  templateId: string;
  sequenceStep?: number;
};

export type CreateCampaignData = {
  created: boolean;
  campaignId?: string;
  status?: string;
  error?: string;
};

/* ── Automation Types ── */

export type EmailVerifyResult = {
  email: string;
  valid: boolean;
  reason?: string;
};

export type EmailVerifyData = {
  results: EmailVerifyResult[];
};

export type CampaignStartRequest = {
  leads: Array<Record<string, unknown>>;
  templateId?: string;
};

export type CampaignStartData = {
  triggered: boolean;
  accepted?: number;
  rejected?: number;
  error?: string;
  message?: string;
};

export type ElectronApi = {
  system: {
    getDeviceStatus: () => Promise<IpcResponse<SystemDeviceStatusData>>;
  };
  auth: {
    login: (options: AuthLoginRequest) => Promise<IpcResponse<AuthLoginData>>;
    logout: () => Promise<IpcResponse<AuthLogoutData>>;
    getSession: () => Promise<IpcResponse<AuthSessionData>>;
  };
  license: {
    verify: (key: string) => Promise<IpcResponse<LicenseVerifyData>>;
    checkStatus: () => Promise<IpcResponse<LicenseStatusData>>;
    getInfo: () => Promise<IpcResponse<LicenseInfoData>>;
    submit: (payload: LicenseSubmitRequest) => Promise<IpcResponse<LicenseSubmitData>>;
    requestTrial: () => Promise<IpcResponse<TrialRequestData>>;
  };
  config: {
    get: <T = unknown>(key: string) => Promise<IpcResponse<T>>;
    set: <T = unknown>(payload: ConfigSetRequest<T>) => Promise<IpcResponse<null>>;
    save: <T = unknown>(payload: ConfigSetRequest<T>) => Promise<IpcResponse<null>>;
    fetchModels: (payload: FetchModelsRequest) => Promise<IpcResponse<FetchModelsData>>;
  };
  secret: {
    set: (payload: SecretSetRequest) => Promise<IpcResponse<SecretCheckData>>;
    check: (key: string) => Promise<IpcResponse<SecretCheckData>>;
  };
  api: {
    testConnection: (payload: TestConnectionRequest) => Promise<IpcResponse<TestConnectionData>>;
    proxy: (payload: ProxyRequest) => Promise<IpcResponse<ProxyData>>;
  };
  search: {
    execute: (payload: SearchExecuteRequest) => Promise<IpcResponse<SearchExecuteData>>;
  };
  onSearchStreamStart: (callback: (total: number) => void) => () => void;
  onSearchStage: (callback: (payload: SearchStagePayload) => void) => () => void;
  onSearchBasicResults: (callback: (results: SearchExecuteResult[]) => void) => () => void;
  onSearchLeadScored: (callback: (payload: SearchLeadScoredPayload) => void) => () => void;
  onSearchStreamComplete: (callback: () => void) => () => void;
  onSearchStreamError: (callback: (error: string) => void) => () => void;
  autopilot: {
    getState: <T = unknown>() => Promise<IpcResponse<AutopilotStateEnvelope<T>>>;
    setState: <T = unknown>(payload: AutopilotStatePayload<T>) => Promise<IpcResponse<null>>;
    clearLegacy: () => Promise<IpcResponse<null>>;
    syncLifecycle: (lifecycle: AutopilotLifecycle) => Promise<IpcResponse<null>>;
  };
  onAutopilotAction: (callback: (action: AutopilotAction) => void) => () => void;
  analysis: {
    generate: (payload: AnalysisGenerateRequest) => Promise<IpcResponse<AnalysisGenerateData>>;
  };
  files: {
    saveExport: (payload: FileExportSaveRequest) => Promise<IpcResponse<FileExportSaveData>>;
  };
  cloud: {
    checkCollision: (payload: { domain: string }) => Promise<IpcResponse<DomainCollisionResult>>;
    syncLead: (payload: { lead: Record<string, unknown>; force?: boolean }) => Promise<IpcResponse<CloudSyncResult>>;
    upsertLead: (payload: UpsertLeadRequest) => Promise<IpcResponse<UpsertLeadData>>;
    checkDomains: (payload: CheckDomainsRequest) => Promise<IpcResponse<CheckDomainsData>>;
    createCampaign: (payload: CreateCampaignRequest) => Promise<IpcResponse<CreateCampaignData>>;
    fetchTeamLeads: (payload?: { limit?: number }) => Promise<IpcResponse<TeamLeadsData>>;
    fetchTracking: (payload: { domains: string[] }) => Promise<IpcResponse<TrackingStatusData>>;
    subscribeRealtime: () => Promise<IpcResponse<null>>;
    unsubscribeRealtime: () => Promise<IpcResponse<null>>;
    fetchClaimedDomains: () => Promise<IpcResponse<ClaimedDomainsData>>;
  };
  onCloudRealtimeLeadEvent: (callback: (event: RealtimeLeadEvent) => void) => () => void;
  automation: {
    verifyEmails: (payload: { emails: string[] }) => Promise<IpcResponse<EmailVerifyData>>;
    startCampaign: (payload: CampaignStartRequest) => Promise<IpcResponse<CampaignStartData>>;
  };
};
