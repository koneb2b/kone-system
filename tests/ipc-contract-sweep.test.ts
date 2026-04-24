const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const originalLoad = Module._load
const originalUnhandledListeners = process.listeners('unhandledRejection')
const originalUncaughtListeners = process.listeners('uncaughtException')

const electronMock = {
  app: {
    isPackaged: true,
    name: 'Kone AI',
    getPath: () => path.join(process.cwd(), '.tmp-ipc-sweep-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
}

const safeFetchStub = async () => ({
  ok: true,
  status: 200,
  async json() {
    return {}
  },
})

const supabaseModuleMock = {
  createClient() {
    return {
      from() {
        return {
          select() { return this },
          eq() { return this },
          neq() { return this },
          in() { return this },
          limit() { return this },
          single() { return Promise.resolve({ data: null, error: null }) },
          maybeSingle() { return Promise.resolve({ data: null, error: null }) },
          upsert() { return Promise.resolve({ data: null, error: null }) },
          insert() { return Promise.resolve({ data: null, error: null }) },
          order() { return this },
        }
      },
      removeChannel() {},
      channel() {
        return {
          on() { return this },
          subscribe() { return this },
        }
      },
    }
  },
}

Module._load = function mockLoad(request, parent, isMain) {
  if (request === 'electron') {
    return electronMock
  }
  if (request === '@supabase/supabase-js') {
    return supabaseModuleMock
  }
  if (request === '../utils/http-client' && parent && /automation-service\.js$/.test(parent.filename)) {
    return { safeFetch: safeFetchStub }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const channelsModulePath = '../dist-electron/electron/ipc/channels.js'
const authServicePath = '../dist-electron/electron/services/auth-service.js'
const configServicePath = '../dist-electron/electron/services/config-service.js'
const licenseServicePath = '../dist-electron/electron/services/license-service.js'
const proxyServicePath = '../dist-electron/electron/services/proxy-service.js'
const searchServicePath = '../dist-electron/electron/services/search-service.js'
const exportServicePath = '../dist-electron/electron/services/export-service.js'
const autopilotStateServicePath = '../dist-electron/electron/services/autopilot-state-service.js'
const supabaseServicePath = '../dist-electron/electron/services/supabase-service.js'
const automationServicePath = '../dist-electron/electron/services/automation-service.js'

const createIpcMainMock = () => {
  const handlers = new Map()
  return {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    getHandler(channel) {
      const handler = handlers.get(channel)
      assert.ok(handler, `Missing handler for channel: ${channel}`)
      return handler
    },
  }
}

const createEventMock = () => {
  const sent = []
  return {
    event: {
      sender: {
        send(channel, payload) {
          sent.push({ channel, payload })
        },
      },
    },
    sent,
  }
}

const createStoreMock = (values = {}) => ({
  get(key) {
    return values[key]
  },
  set(key, value) {
    values[key] = value
  },
  path: path.join(process.cwd(), '.tmp-ipc-sweep-user-data', 'kone-config.json'),
})

const createLicenseGuardMock = ({ claims = null, featureError = null } = {}) => ({
  getStoredClaims() {
    return claims
  },
  requireFeature() {
    if (featureError) throw featureError
    return { claims, featureSet: new Set(claims?.features || []) }
  },
  requireAnyFeature() {
    if (featureError) throw featureError
    return { claims, featureSet: new Set(claims?.features || []) }
  },
  enforceExportLimit(content) {
    return String(content || '')
  },
})

const packagedClaims = {
  status: 'active',
  expiresAt: Date.now() + 60_000,
  features: ['search_basic', 'analysis_advanced', 'lead_export', 'export_full', 'cloud_send', 'team_collaboration'],
  licenseKey: 'KONE-SWEEP',
  plan: 'enterprise',
}

const stripAnsi = (value) => String(value || '').replace(/\u001b\[[0-9;]*m/g, '')

const normalizeResultKind = (result) => {
  if (result && typeof result === 'object' && 'success' in result) {
    if (result.success === false) return 'structured_error'
    if (result.success === true) return 'structured_success'
  }
  return 'unknown'
}

const invokeWithGuard = async (handler, args, timeoutMs = 1500) => {
  const unhandled = []
  const uncaught = []
  const onUnhandled = (reason) => {
    unhandled.push(reason)
  }
  const onUncaught = (error) => {
    uncaught.push(error)
  }

  process.on('unhandledRejection', onUnhandled)
  process.on('uncaughtException', onUncaught)

  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('IPC_SWEEP_TIMEOUT')), timeoutMs)
    })
    const value = await Promise.race([handler(...args), timeoutPromise])
    return { status: 'returned', value, unhandled, uncaught }
  } catch (error) {
    return {
      status: error instanceof Error && error.message === 'IPC_SWEEP_TIMEOUT' ? 'timed_out' : 'rejected',
      error,
      unhandled,
      uncaught,
    }
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
    process.removeListener('uncaughtException', onUncaught)
  }
}

const resetModule = (modulePath) => {
  delete require.cache[require.resolve(modulePath)]
}

const loadAllHandlers = () => {
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    user_config: {
      providers: [{ id: 'llm', baseUrl: 'https://mock-llm.example/v1' }],
      llmApiKey: 'mock-llm-key',
      selectedModel: 'gpt-4o-mini',
      icpProfile: { targetProduct: 'battery', buyerPersona: 'procurement', coreAdvantage: 'fast quote' },
      n8n: { webhookUrl: '' },
    },
    'system.machineId': 'ipc-sweep-device',
    'system.hardwareMachineId': 'ipc-sweep-device',
  })
  const licenseGuard = createLicenseGuardMock({ claims: packagedClaims })
  const { registerAuthHandlers } = require(authServicePath)
  const { registerConfigHandlers } = require(configServicePath)
  const { createLicenseService } = require(licenseServicePath)
  const { registerProxyHandlers } = require(proxyServicePath)
  const { registerSearchHandlers } = require(searchServicePath)
  const { registerExportHandlers } = require(exportServicePath)
  const { registerAutopilotStateHandlers } = require(autopilotStateServicePath)
  const { registerSupabaseHandlers } = require(supabaseServicePath)
  const { registerAutomationHandlers } = require(automationServicePath)

  registerAuthHandlers(ipcMain)
  registerConfigHandlers(ipcMain, store)
  const { registerHandlers: registerLicenseHandlers } = createLicenseService(store)
  registerLicenseHandlers(ipcMain, electronMock.app)
  registerProxyHandlers(ipcMain, licenseGuard, store)
  registerSearchHandlers(ipcMain, store)
  registerExportHandlers(ipcMain, licenseGuard, store)
  registerAutopilotStateHandlers(ipcMain, store)
  registerSupabaseHandlers(ipcMain, store, licenseGuard)
  registerAutomationHandlers(ipcMain, store, licenseGuard)
  ipcMain.handle('sync-autopilot-state', async () => ({ success: true, data: null }))

  return { ipcMain }
}

const getSweepCases = (IPC_CHANNELS) => [
  { channel: IPC_CHANNELS.AUTH.LOGIN, label: 'AUTH.LOGIN', expectation: 'skip_with_reason', skipReason: '认证流会启动本地回调服务与浏览器交互，不适合纳入无交互 barrage', payloads: [undefined, {}, { issuerBaseUrl: '', realm: '', clientId: '' }] },
  { channel: IPC_CHANNELS.AUTH.LOGOUT, label: 'AUTH.LOGOUT', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.AUTH.GET_SESSION, label: 'AUTH.GET_SESSION', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.LICENSE.VERIFY, label: 'LICENSE.VERIFY', expectation: 'business_error_expected', payloads: [undefined, null, '', 'bad-license-key'] },
  { channel: IPC_CHANNELS.LICENSE.CHECK_STATUS, label: 'LICENSE.CHECK_STATUS', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.LICENSE.GET_INFO, label: 'LICENSE.GET_INFO', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.LICENSE.SUBMIT, label: 'LICENSE.SUBMIT', expectation: 'business_error_expected', payloads: [undefined, {}, { licenseKey: '' }, { licenseKey: 'bad-license-key' }] },
  { channel: IPC_CHANNELS.LICENSE.REQUEST_TRIAL, label: 'LICENSE.REQUEST_TRIAL', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.CONFIG.GET, label: 'CONFIG.GET', expectation: 'success_or_error_structured', payloads: [undefined, null, '', 'user_config'] },
  { channel: IPC_CHANNELS.CONFIG.SET, label: 'CONFIG.SET', expectation: 'business_error_expected', payloads: [undefined, {}, { key: '', value: null }, { key: 'user_config', value: {} }] },
  { channel: IPC_CHANNELS.CONFIG.FETCH_MODELS, label: 'CONFIG.FETCH_MODELS', expectation: 'business_error_expected', payloads: [undefined, {}, { apiKey: '', baseUrl: '' }] },
  { channel: IPC_CHANNELS.SECRET.SET, label: 'SECRET.SET', expectation: 'business_error_expected', payloads: [undefined, {}, { key: '', value: '' }, { key: 'forbidden.key', value: 'x' }] },
  { channel: IPC_CHANNELS.SECRET.CHECK, label: 'SECRET.CHECK', expectation: 'success_or_error_structured', payloads: [undefined, '', 'secrets.llm.apiKey'] },
  { channel: IPC_CHANNELS.AUTOPILOT.GET_STATE, label: 'AUTOPILOT.GET_STATE', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.AUTOPILOT.SET_STATE, label: 'AUTOPILOT.SET_STATE', expectation: 'success_or_error_structured', payloads: [undefined, {}, { state: null }, { state: { foo: 'bar' } }] },
  { channel: IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY, label: 'AUTOPILOT.CLEAR_LEGACY', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.AUTOPILOT.SYNC_STATE, label: 'AUTOPILOT.SYNC_STATE', expectation: 'business_error_expected', payloads: [undefined, null, {}, 'running', 'invalid-state'] },
  { channel: IPC_CHANNELS.SEARCH.API_TEST_CONNECTION, label: 'SEARCH.API_TEST_CONNECTION', expectation: 'success_or_error_structured', payloads: [undefined, {}, { provider: 'llm', key: '', baseUrl: '' }, { provider: 'google-leads', key: '', baseUrl: '' }] },
  { channel: IPC_CHANNELS.SEARCH.API_PROXY, label: 'SEARCH.API_PROXY', expectation: 'business_error_expected', payloads: [undefined, {}, { url: 'http://example.com' }, { url: 'https://example.com', method: 'POST', body: {} }] },
  { channel: IPC_CHANNELS.SEARCH.EXECUTE, label: 'SEARCH.EXECUTE', expectation: 'stream_contract_expected', payloads: [undefined, {}, { keyword: '' }, { keyword: 'golf cart battery', country: 'US', city: '' }] },
  { channel: IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE, label: 'SEARCH.ANALYSIS_GENERATE', expectation: 'degraded_expected', payloads: [undefined, {}, { lead: {}, scenario: 'direct_quote' }, { lead: { company: 'Example GmbH' }, scenario: 'reply_coach' }] },
  { channel: IPC_CHANNELS.FILES.EXPORT_SAVE, label: 'FILES.EXPORT_SAVE', expectation: 'business_error_expected', payloads: [undefined, {}, { fileName: '', content: '' }, { fileName: 'test.csv', content: 'a,b' }] },
  { channel: IPC_CHANNELS.CLOUD.CHECK_COLLISION, label: 'CLOUD.CHECK_COLLISION', expectation: 'success_or_error_structured', payloads: [undefined, {}, { domain: '' }, { domain: 'example.com' }] },
  { channel: IPC_CHANNELS.CLOUD.SYNC_LEAD, label: 'CLOUD.SYNC_LEAD', expectation: 'success_or_error_structured', payloads: [undefined, {}, { lead: null }, { lead: { company: 'Example', website: 'https://example.com' } }] },
  { channel: IPC_CHANNELS.CLOUD.UPSERT_LEAD, label: 'CLOUD.UPSERT_LEAD', expectation: 'success_or_error_structured', payloads: [undefined, {}, { lead: null }, { lead: { company: 'Example', website: 'https://example.com' } }] },
  { channel: IPC_CHANNELS.CLOUD.CHECK_DOMAINS, label: 'CLOUD.CHECK_DOMAINS', expectation: 'success_or_error_structured', payloads: [undefined, {}, { domains: [] }, { domains: ['example.com'] }] },
  { channel: IPC_CHANNELS.CLOUD.CREATE_CAMPAIGN, label: 'CLOUD.CREATE_CAMPAIGN', expectation: 'success_or_error_structured', payloads: [undefined, {}, { domain: '', email: '', templateId: '' }, { domain: 'example.com', email: 'dev@example.com', templateId: 'default' }] },
  { channel: IPC_CHANNELS.CLOUD.FETCH_TEAM_LEADS, label: 'CLOUD.FETCH_TEAM_LEADS', expectation: 'success_or_error_structured', payloads: [undefined, {}, { limit: 10 }] },
  { channel: IPC_CHANNELS.CLOUD.FETCH_TRACKING, label: 'CLOUD.FETCH_TRACKING', expectation: 'success_or_error_structured', payloads: [undefined, {}, { domains: [] }, { domains: ['example.com'] }] },
  { channel: IPC_CHANNELS.CLOUD.SUBSCRIBE_REALTIME, label: 'CLOUD.SUBSCRIBE_REALTIME', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.CLOUD.UNSUBSCRIBE_REALTIME, label: 'CLOUD.UNSUBSCRIBE_REALTIME', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.CLOUD.FETCH_CLAIMED_DOMAINS, label: 'CLOUD.FETCH_CLAIMED_DOMAINS', expectation: 'success_or_error_structured', payloads: [undefined] },
  { channel: IPC_CHANNELS.AUTOMATION.VERIFY_EMAILS, label: 'AUTOMATION.VERIFY_EMAILS', expectation: 'success_or_error_structured', payloads: [undefined, {}, { emails: [] }, { emails: ['dev@example.com'] }] },
  { channel: IPC_CHANNELS.AUTOMATION.START_CAMPAIGN, label: 'AUTOMATION.START_CAMPAIGN', expectation: 'success_or_error_structured', payloads: [undefined, {}, { leads: [] }, { leads: [{ email: 'dev@example.com', company: 'Example', website: 'https://example.com' }], templateId: 'default' }] },
]

test('ipc contract sweep: handlers resist boundary-value barrage without fatal crash', async () => {
  const { IPC_CHANNELS } = require(channelsModulePath)
  const { ipcMain } = loadAllHandlers()
  const cases = getSweepCases(IPC_CHANNELS)
  const results = []
  const failures = []

  for (const sweepCase of cases) {
    if (sweepCase.expectation === 'skip_with_reason') {
      results.push({
        channel: sweepCase.label,
        expectation: sweepCase.expectation,
        outcome: 'skipped',
        returnedSuccess: undefined,
        returnedError: sweepCase.skipReason,
        eventChannels: [],
      })
      continue
    }

    const handler = ipcMain.getHandler(sweepCase.channel)
    for (const payload of sweepCase.payloads) {
      const { event, sent } = createEventMock()
      const invocationArgs = typeof payload === 'undefined' ? [event] : [event, payload]
      const outcome = await invokeWithGuard(handler, invocationArgs)
      const resultKind = outcome.status === 'returned' ? normalizeResultKind(outcome.value) : outcome.status
      const record = {
        channel: sweepCase.label,
        expectation: sweepCase.expectation,
        payload,
        outcome: resultKind,
        returnedSuccess: outcome.value?.success,
        returnedError: stripAnsi(outcome.value?.error || outcome.error?.message || ''),
        eventChannels: sent.map((entry) => entry.channel),
      }

      if (outcome.uncaught.length > 0) {
        failures.push(`${sweepCase.label} emitted uncaught exception for payload ${JSON.stringify(payload)}`)
      }
      if (outcome.unhandled.length > 0) {
        failures.push(`${sweepCase.label} emitted unhandled rejection for payload ${JSON.stringify(payload)}`)
      }
      if (outcome.status === 'timed_out') {
        failures.push(`${sweepCase.label} hung on payload ${JSON.stringify(payload)}`)
      }
      if (outcome.status === 'rejected') {
        failures.push(`${sweepCase.label} rejected instead of returning structured response on payload ${JSON.stringify(payload)}: ${record.returnedError}`)
      }
      if (sweepCase.expectation === 'stream_contract_expected' && sent.some((entry) => entry.channel === IPC_CHANNELS.SEARCH.STREAM_ERROR) && !sent.some((entry) => entry.channel === IPC_CHANNELS.SEARCH.STREAM_COMPLETE)) {
        failures.push(`${sweepCase.label} emitted stream error without stream complete`)
      }
      if (sweepCase.expectation === 'deny_expected' && outcome.value?.success === true) {
        failures.push(`${sweepCase.label} unexpectedly succeeded under deny_expected policy`)
      }
      if (resultKind === 'unknown') {
        failures.push(`${sweepCase.label} produced non-structured outcome on payload ${JSON.stringify(payload)}`)
      }

      results.push(record)
    }
  }

  const summary = results.reduce((acc, entry) => {
    acc.total += 1
    if (entry.outcome === 'skipped') acc.skipped += 1
    else if (entry.outcome === 'structured_success') acc.structuredSuccess += 1
    else if (entry.outcome === 'structured_error') acc.structuredError += 1
    else acc.other += 1
    return acc
  }, { total: 0, structuredSuccess: 0, structuredError: 0, skipped: 0, other: 0 })

  const byChannel = Array.from(results.reduce((map, entry) => {
    const current = map.get(entry.channel) || { channel: entry.channel, expectation: entry.expectation, outcomes: new Set(), sampleErrors: new Set() }
    current.outcomes.add(entry.outcome)
    if (entry.returnedError) current.sampleErrors.add(entry.returnedError)
    map.set(entry.channel, current)
    return map
  }, new Map()).values()).map((entry) => ({
    channel: entry.channel,
    expectation: entry.expectation,
    outcomes: Array.from(entry.outcomes).join(', '),
    sampleErrors: Array.from(entry.sampleErrors).slice(0, 2).join(' | '),
  }))

  console.log('[ipc-sweep-summary]', JSON.stringify(summary))
  console.log('[ipc-sweep-by-channel]', JSON.stringify(byChannel, null, 2))

  assert.equal(failures.length, 0, `IPC sweep found ${failures.length} hard failures:\n${failures.join('\n')}`)
})

test.after(() => {
  Module._load = originalLoad
  for (const listener of process.listeners('unhandledRejection')) {
    if (!originalUnhandledListeners.includes(listener)) {
      process.removeListener('unhandledRejection', listener)
    }
  }
  for (const listener of process.listeners('uncaughtException')) {
    if (!originalUncaughtListeners.includes(listener)) {
      process.removeListener('uncaughtException', listener)
    }
  }
})
