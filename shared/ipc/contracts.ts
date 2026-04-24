export type IpcResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
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
  plan?: 'trial' | 'pro' | 'enterprise';
  type?: 'trial' | 'license';
  isExpired?: boolean;
  machineId?: string;
};

export type LicenseStatusData = {
  status: 'active' | 'expired';
  expiresAt: number;
  features: string[];
  plan?: 'trial' | 'pro' | 'enterprise';
  type?: 'trial' | 'license';
  isExpired?: boolean;
  machineId?: string;
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
  isB2B: boolean;
  matchReasons?: string[];
  riskFlags?: string[];
  matchScore?: number;
  source?: string;
  country?: string;
  city?: string;
  snippet?: string;
  fallbackStatus?: 'social_blind_score';
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
    snippet?: string;
    salesStrategy?: string;
    customerText?: string;
  };
  scenario: string;
};

export type AnalysisGenerateData = {
  content?: string;
  insights?: string;
  icebreakers?: string[];
  englishPitch?: string;
  cta?: string;
  rawContent?: string;
  parseFallback?: boolean;
  usedKnowledgeTitles?: string[];
  usedFallback?: boolean;
  source?: string;
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
    getState: <T = unknown>() => Promise<IpcResponse<T | null>>;
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
};
