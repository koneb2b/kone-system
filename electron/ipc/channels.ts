export const IPC_CHANNELS = {
  AUTH: {
    LOGIN: 'auth:login',
    LOGOUT: 'auth:logout',
    GET_SESSION: 'auth:get-session',
  },
  SYSTEM: {
    GET_DEVICE_STATUS: 'system:get-device-status',
    AUTOPILOT_ACTION: 'autopilot-action',
  },
  AUTOPILOT: {
    GET_STATE: 'autopilot:get-state',
    SET_STATE: 'autopilot:set-state',
    CLEAR_LEGACY: 'autopilot:clear-legacy',
    SYNC_STATE: 'sync-autopilot-state',
  },
  LICENSE: {
    VERIFY: 'license:verify',
    CHECK_STATUS: 'license:check-status',
    GET_INFO: 'license:get-info',
    SUBMIT: 'license:submit',
    REQUEST_TRIAL: 'license:request-trial',
  },
  CONFIG: {
    GET: 'config:get',
    SET: 'config:set',
    FETCH_MODELS: 'config:fetch-models',
  },
  SECRET: {
    SET: 'secret:set',
    CHECK: 'secret:check',
  },
  SEARCH: {
    API_TEST_CONNECTION: 'api:test-connection',
    API_PROXY: 'api:proxy',
    EXECUTE: 'search:execute',
    STREAM_START: 'search:stream-start',
    STAGE: 'search:stage',
    BASIC_RESULTS: 'search:basic-results',
    LEAD_SCORED: 'search:lead-scored',
    STREAM_COMPLETE: 'search:stream-complete',
    STREAM_ERROR: 'search:stream-error',
    ANALYSIS_GENERATE: 'analysis:generate',
  },
  FILES: {
    EXPORT_SAVE: 'file:export-save',
    EXPORT_PDF: 'file:export-pdf',
  },
  CLOUD: {
    CHECK_COLLISION: 'cloud:check-collision',
    SYNC_LEAD: 'cloud:sync-lead',
    UPSERT_LEAD: 'cloud:upsert-lead',
    CHECK_DOMAINS: 'cloud:check-domains',
    CREATE_CAMPAIGN: 'cloud:create-campaign',
    FETCH_TEAM_LEADS: 'cloud:fetch-team-leads',
    FETCH_TRACKING: 'cloud:fetch-tracking',
    SUBSCRIBE_REALTIME: 'cloud:subscribe-realtime',
    UNSUBSCRIBE_REALTIME: 'cloud:unsubscribe-realtime',
    REALTIME_LEAD_EVENT: 'cloud:realtime-lead-event',
    FETCH_CLAIMED_DOMAINS: 'cloud:fetch-claimed-domains',
  },
  AUTOMATION: {
    VERIFY_EMAILS: 'automation:verify-emails',
    START_CAMPAIGN: 'automation:start-campaign',
  },
  /* V1.3 DNS 域名健康探测 */
  DNS: {
    HEALTH_CHECK: 'dns:health-check',
  },
  /* V1.3 智能体多开控制 */
  AGENT: {
    LIST: 'agent:list',
    CONTROL: 'agent:control',
    STATUS_CHANGED: 'agent:status-changed',
    GET_LOG: 'agent:get-log',
  },
  /* V1.3 多账号沙箱管理 */
  ACCOUNT: {
    CONNECT: 'account:connect',
    DISCONNECT: 'account:disconnect',
    GET_LIST: 'account:get-list',
    STATUS_UPDATE: 'account:status-update',
  },
} as const;

export type IpcChannelTree = typeof IPC_CHANNELS;

type NestedValueOf<T> = T extends string
  ? T
  : T extends Record<string, unknown>
    ? NestedValueOf<T[keyof T]>
    : never;

export type IpcChannel = NestedValueOf<IpcChannelTree>;
