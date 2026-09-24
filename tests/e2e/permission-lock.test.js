const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const originalLoad = Module._load

let safeFetchCallCount = 0

const DAY_MS = 24 * 60 * 60 * 1000
const TRIAL_DURATION_MS = 7 * DAY_MS

const buildTrialDenied = (store, operationName) => {
  const firstActivation = Number(store?.get?.('trial.firstActivationTimestamp') || 0)
  const lastKnownGood = Number(store?.get?.('trial.lastKnownGoodTimestamp') || 0)
  if (!firstActivation) return null

  if (lastKnownGood > Date.now()) {
    return {
      success: false,
      error: 'SYSTEM_TIME_ABNORMAL',
      message: '系统环境异常，请恢复标准北京时间',
      operationName,
      code: 403,
    }
  }

  if (Date.now() - firstActivation > TRIAL_DURATION_MS) {
    return {
      success: false,
      error: 'TRIAL_EXPIRED',
      message: `${operationName}不可用：试用期已过期，请完成授权后继续使用`,
      operationName,
      code: 403,
    }
  }

  return null
}

const registerSecureIpcMock = (ipcMain, channel, store, licenseGuard, handler, operationName = channel) => {
  ipcMain.handle(channel, async (event, ...args) => {
    const claims = licenseGuard?.getStoredClaims?.()
    if (!(claims && claims.status === 'active' && claims.expiresAt > Date.now())) {
      const trialDenied = buildTrialDenied(store, operationName)
      if (trialDenied) return trialDenied
    }
    return handler(event, ...args)
  })
}

const registerSecureFeatureIpcMock = (
  ipcMain,
  channel,
  store,
  licenseGuard,
  featureName,
  handler,
  operationName = channel,
) => {
  registerSecureIpcMock(
    ipcMain,
    channel,
    store,
    licenseGuard,
    async (event, ...args) => {
      try {
        if (Array.isArray(featureName)) {
          licenseGuard.requireAnyFeature(featureName, operationName)
        } else {
          licenseGuard.requireFeature(featureName, operationName)
        }
      } catch (error) {
        return {
          success: false,
          error: 'FEATURE_DENIED',
          message: String(error?.message || `当前授权无权执行${operationName}`),
          operationName,
          code: Number(error?.code) || 403,
        }
      }
      return handler(event, ...args)
    },
    operationName,
  )
}

const licenseServiceMock = {
  registerSecureIpc: registerSecureIpcMock,
  registerSecureFeatureIpc: registerSecureFeatureIpcMock,
  ensureTrialAccess(store, licenseGuard, operationName) {
    const claims = licenseGuard?.getStoredClaims?.()
    if (claims && claims.status === 'active' && claims.expiresAt > Date.now()) return null
    return buildTrialDenied(store, operationName)
  },
  getPhysicalMachineId(store) {
    return String(store?.get?.('system.machineId') || 'mock-machine-id')
  },
  createLicenseService() {
    return {
      licenseGuard: {
        getStoredClaims() {
          return null
        },
        requireFeature() {},
        requireAnyFeature() {},
      },
    }
  },
}

const electronMock = {
  app: {
    isPackaged: true,
    getPath: () => path.join(process.cwd(), '.tmp-test-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
}

const supabaseModuleMock = {
  createClient() {
    return {
      from() {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          neq() {
            return this
          },
          in() {
            return this
          },
          limit() {
            return this
          },
          single() {
            return Promise.resolve({ data: null, error: null })
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null })
          },
          upsert() {
            return Promise.resolve({ data: null, error: null })
          },
          insert() {
            return Promise.resolve({ data: null, error: null })
          },
          order() {
            return this
          },
        }
      },
      removeChannel() {},
      channel() {
        return {
          on() {
            return this
          },
          subscribe() {
            return this
          },
        }
      },
    }
  },
}

Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return electronMock
  }
  if (request === '@supabase/supabase-js') {
    return supabaseModuleMock
  }
  if (
    request === '../../dist-electron/electron/services/license-service.js' ||
    request === '../dist-electron/electron/services/license-service.js' ||
    (request === './license-service' &&
      parent &&
      /dist-electron[\\/]electron[\\/]services[\\/](search|automation|supabase)-service\.js$/.test(parent.filename))
  ) {
    return licenseServiceMock
  }
  if (
    request === '../utils/http-client' &&
    parent &&
    /electron[\\/]services[\\/]automation-service\.js$/.test(parent.filename)
  ) {
    return {
      safeFetch: async () => {
        safeFetchCallCount += 1
        return { ok: true, status: 200 }
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const {
  registerSecureIpc,
  registerSecureFeatureIpc,
} = require('../../dist-electron/electron/services/license-service.js')
const { registerSearchHandlers } = require('../../dist-electron/electron/services/search-service.js')
const { registerAutomationHandlers } = require('../../dist-electron/electron/services/automation-service.js')
const { registerSupabaseHandlers } = require('../../dist-electron/electron/services/supabase-service.js')
const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

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

const createEventMock = () => ({
  sender: {
    send() {},
  },
})

const createStoreMock = (values = {}) => ({
  get(key) {
    return values[key]
  },
  set(key, value) {
    values[key] = value
  },
})

const createLicenseGuardMock = ({ claims = null, featureError = null } = {}) => ({
  getStoredClaims() {
    return claims
  },
  requireFeature() {
    if (featureError) throw featureError
    return { claims, featureSet: new Set() }
  },
  requireAnyFeature() {
    if (featureError) throw featureError
    return { claims, featureSet: new Set() }
  },
})

const createActiveTrialStore = (extra = {}) =>
  createStoreMock({
    'trial.firstActivationTimestamp': Date.now() - 1 * 24 * 60 * 60 * 1000,
    'trial.lastKnownGoodTimestamp': Date.now() - 1000,
    'trial.deviceId': 'device-active',
    'system.machineId': 'device-active',
    ...extra,
  })

test('scenario A: trial 过期拦截搜索 search:execute', async () => {
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    'trial.firstActivationTimestamp': Date.now() - 9 * 24 * 60 * 60 * 1000,
    'trial.lastKnownGoodTimestamp': Date.now() - 1000,
    'trial.deviceId': 'device-a',
    'system.machineId': 'device-a',
  })

  let handlerExecuted = false
  const event = {
    sender: {
      send() {
        handlerExecuted = true
      },
    },
  }

  registerSearchHandlers(ipcMain, store)
  const result = await ipcMain.getHandler(IPC_CHANNELS.SEARCH.EXECUTE)(event, {
    keyword: 'industrial battery dealer',
    country: 'Germany',
    city: '',
  })

  assert.equal(handlerExecuted, false)
  assert.equal(result.success, false)
  assert.equal(result.error, 'TRIAL_EXPIRED')
  assert.equal(result.code, 403)
})

test('scenario B: trial 过期拦截深度分析 analysis:generate', async () => {
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    'trial.firstActivationTimestamp': Date.now() - 9 * 24 * 60 * 60 * 1000,
    'trial.lastKnownGoodTimestamp': Date.now() - 1000,
    'trial.deviceId': 'device-b',
    'system.machineId': 'device-b',
  })

  registerSearchHandlers(ipcMain, store)
  const result = await ipcMain.getHandler(IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE)(createEventMock(), {
    lead: {
      company: 'Example GmbH',
      website: 'https://example.com',
    },
    scenario: 'direct_quote',
  })

  assert.equal(result.success, false)
  assert.equal(result.error, 'TRIAL_EXPIRED')
  assert.equal(result.code, 403)
})

test('scenario C: Basic 用户访问 automation:verify-emails 被 cloud_send 拒绝', async () => {
  const ipcMain = createIpcMainMock()
  const store = createActiveTrialStore()
  const featureError = Object.assign(new Error('当前授权无权执行自动化发信'), { code: 403 })
  const licenseGuard = createLicenseGuardMock({
    claims: {
      status: 'active',
      expiresAt: Date.now() + 60_000,
      features: [],
      licenseKey: 'KONE-BASIC',
    },
    featureError,
  })

  registerAutomationHandlers(ipcMain, store, licenseGuard)
  const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOMATION.VERIFY_EMAILS)(createEventMock(), {
    emails: ['x@example.com'],
  })

  assert.equal(result.success, false)
  assert.equal(result.error, 'FEATURE_DENIED')
  assert.equal(result.code, 403)
})

test('scenario D: automation:start-campaign 双层拦截且业务未执行', async () => {
  safeFetchCallCount = 0
  const ipcMain = createIpcMainMock()
  const store = createActiveTrialStore({
    user_config: {
      n8n: { webhookUrl: 'https://n8n.example.com/webhook/start' },
    },
  })
  const featureError = Object.assign(new Error('当前授权无权执行自动化发信'), { code: 403 })
  const licenseGuard = createLicenseGuardMock({
    claims: {
      status: 'active',
      expiresAt: Date.now() + 60_000,
      features: [],
      licenseKey: 'KONE-BASIC',
    },
    featureError,
  })

  registerAutomationHandlers(ipcMain, store, licenseGuard)
  const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOMATION.START_CAMPAIGN)(createEventMock(), {
    leads: [{ email: 'ops@example.com', company: 'Ops Co', website: 'https://ops.example.com' }],
    templateId: 'default',
  })

  assert.equal(safeFetchCallCount, 0)
  assert.equal(result.success, false)
  assert.equal(result.error, 'FEATURE_DENIED')
  assert.equal(result.code, 403)
})

test('scenario E: Premium 用户正常通过 cloud_send verify-emails', async () => {
  const ipcMain = createIpcMainMock()
  const store = createActiveTrialStore()
  const licenseGuard = createLicenseGuardMock({
    claims: {
      status: 'active',
      expiresAt: Date.now() + 60_000,
      features: ['cloud_send'],
      licenseKey: 'KONE-PREMIUM',
    },
  })

  registerAutomationHandlers(ipcMain, store, licenseGuard)
  const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOMATION.VERIFY_EMAILS)(createEventMock(), {
    emails: ['invalid-email'],
  })

  assert.equal(result.success, true)
  assert.ok(Array.isArray(result.data.results))
  assert.equal(result.data.results.length, 1)
})

test('scenario F: 系统时间回拨锁定 SYSTEM_TIME_ABNORMAL', async () => {
  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    'trial.firstActivationTimestamp': Date.now() - 1 * 24 * 60 * 60 * 1000,
    'trial.lastKnownGoodTimestamp': Date.now() + 999999,
    'trial.deviceId': 'device-f',
    'system.machineId': 'device-f',
  })
  const licenseGuard = createLicenseGuardMock()

  registerSecureIpc(ipcMain, 'test:rollback', store, licenseGuard, async () => ({ success: true }), '测试回拨拦截')

  const result = await ipcMain.getHandler('test:rollback')(createEventMock())

  assert.equal(result.success, false)
  assert.equal(result.error, 'SYSTEM_TIME_ABNORMAL')
  assert.equal(result.message, '系统环境异常，请恢复标准北京时间')
  assert.equal(result.code, 403)
})

test('scenario G: Supabase 云服务权限矩阵全部 FEATURE_DENIED', async () => {
  const ipcMain = createIpcMainMock()
  const store = createActiveTrialStore()
  const featureError = Object.assign(new Error('当前授权无权执行云端能力'), { code: 403 })
  const licenseGuard = createLicenseGuardMock({
    claims: {
      status: 'active',
      expiresAt: Date.now() + 60_000,
      features: [],
      licenseKey: 'KONE-BASIC',
    },
    featureError,
  })

  registerSupabaseHandlers(ipcMain, store, licenseGuard)

  const collision = await ipcMain.getHandler(IPC_CHANNELS.CLOUD.CHECK_COLLISION)(createEventMock(), {
    domain: 'example.com',
  })
  const teamLeads = await ipcMain.getHandler(IPC_CHANNELS.CLOUD.FETCH_TEAM_LEADS)(createEventMock(), {
    limit: 10,
  })
  const realtime = await ipcMain.getHandler(IPC_CHANNELS.CLOUD.SUBSCRIBE_REALTIME)(createEventMock())

  for (const result of [collision, teamLeads, realtime]) {
    assert.equal(result.success, false)
    assert.equal(result.error, 'FEATURE_DENIED')
    assert.equal(result.code, 403)
  }
})

test.after(() => {
  Module._load = originalLoad
})
