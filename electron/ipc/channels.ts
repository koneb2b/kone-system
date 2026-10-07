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
    /* Phase 1 · Cloudflare 云端引擎测试连接 */
    CLOUDFLARE_TEST_CONNECTION: 'cloud:cloudflare-test-connection',
    CLOUDFLARE_CONFIGURED: 'cloud:cloudflare-configured',
    /* [V1.3.8] Phase 2.7 · 云端触达看板（投递漏斗 + 30 日趋势） */
    CLOUDFLARE_DASHBOARD_STATS: 'cloud:cloudflare-dashboard-stats',
    CLOUDFLARE_POLL_OUTREACH_STATUS: 'cloud:cloudflare-poll-outreach-status',
    /* [V1.4.0] Phase 2.9 · 审批（AGENTS.md 宪法第 5 条：审批是投递的必要前提）
       仅 2 个通道：待审批队列复用本地 leads（status='pending_approval'），无需额外通道。 */
    CREATE_APPROVAL: 'cloud:create-approval',
    LIST_APPROVALS: 'cloud:list-approvals',
  },
  AUTOMATION: {
    VERIFY_EMAILS: 'automation:verify-emails',
    START_CAMPAIGN: 'automation:start-campaign',
    /* Phase 2: Outreach 投递闭环 */
    QUEUE_OUTREACH: 'automation:queue-outreach',
    /* Phase 2.5: 本地 IMAP 回复检测（In-Reply-To 匹配 outreach.provider_message_id） */
    IMAP_POLL: 'automation:imap-poll',
    IMAP_STATUS: 'automation:imap-status',
    /* [V1.3.11] Phase 2.8c · IMAP 自动轮询开关切换后即时重启 timer */
    IMAP_RESTART: 'automation:imap-restart',
    /* [V1.3.12] Phase 2.8d · IMAP 主机连接测试（仅连通性，不拉邮件） */
    IMAP_TEST_CONNECTION: 'automation:imap-test-connection',
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
    /* L1-1/F2：per-lead 触达状态实时推送（线索表徽标即时刷新通道） */
    LEAD_STATUS_UPDATED: 'agent:lead-status-updated',
    GET_LOG: 'agent:get-log',
    /* P0-1 双管道读端：按 leadKey 读取持久化线索态 agentStatus */
    GET_STATUS: 'agent:get-status',
    /* P1-4 邮件合规：退订/DNC 抑制名单管理 */
    SUPPRESS_LIST: 'agent:suppress-list',
    SUPPRESS_ADD: 'agent:suppress-add',
    SUPPRESS_REMOVE: 'agent:suppress-remove',
  },
  /* V1.3 多账号沙箱管理 */
  ACCOUNT: {
    CONNECT: 'account:connect',
    DISCONNECT: 'account:disconnect',
    GET_LIST: 'account:get-list',
    STATUS_UPDATE: 'account:status-update',
  },
  /* V1.4 Provider 注册表宪法 */
  PROVIDER: {
    LIST: 'provider:list',
    STATUS: 'provider:status',
  },
} as const

/**
 * 仅推送（事件广播）通道：由主进程经 `webContents.send` 发出、渲染层监听，无 invoke handler。
 * 列出此处作为 `assertAllRegistered()` 启动门禁的排除集——门禁只断言 invoke 通道已登记，
 * 不要求推送通道有 handler。`verify-ipc-consistency.cjs` 的 push 检测（`PUSH_RE`）是同一事实源的
 * 可观测校验：本集合应与扫描结果一致（11 个），若两者漂移说明有通道被误分类。
 */
export const PUSH_CHANNELS: readonly string[] = [
  'autopilot-action', // SYSTEM.AUTOPILOT_ACTION
  'account:status-update', // ACCOUNT.STATUS_UPDATE
  'agent:status-changed', // AGENT.STATUS_CHANGED
  'agent:lead-status-updated', // AGENT.LEAD_STATUS_UPDATED
  'cloud:realtime-lead-event', // CLOUD.REALTIME_LEAD_EVENT
  'search:basic-results', // SEARCH.BASIC_RESULTS
  'search:lead-scored', // SEARCH.LEAD_SCORED
  'search:stage', // SEARCH.STAGE
  'search:stream-complete', // SEARCH.STREAM_COMPLETE
  'search:stream-error', // SEARCH.STREAM_ERROR
  'search:stream-start', // SEARCH.STREAM_START
] as const

/** 收集全部 invoke 通道字符串（排除仅推送通道），供启动门禁 `assertAllRegistered()` 使用。 */
export function collectInvokeChannels(): string[] {
  const all: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node === 'string') all.push(node)
    else if (node && typeof node === 'object') Object.values(node as Record<string, unknown>).forEach(walk)
  }
  walk(IPC_CHANNELS)
  const push = new Set<string>(PUSH_CHANNELS)
  return all.filter((c) => !push.has(c))
}

export type IpcChannelTree = typeof IPC_CHANNELS

type NestedValueOf<T> = T extends string ? T : T extends Record<string, unknown> ? NestedValueOf<T[keyof T]> : never

export type IpcChannel = NestedValueOf<IpcChannelTree>
