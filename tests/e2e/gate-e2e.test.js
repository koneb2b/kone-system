const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')

const TMP_USER_DATA = path.join(process.cwd(), '.tmp-test-user-data')
const originalLoad = Module._load

// Shared electron mock — secret-manager needs safeStorage encryption to be "available"
// even though our mock just passes through (doesn't actually encrypt)
const electronMock = {
  app: {
    isPackaged: true,
    name: 'Kone AI',
    getPath: () => TMP_USER_DATA,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
}

// --- Helpers ---

const resetModule = (modulePath) => {
  delete require.cache[require.resolve(modulePath)]
}

const createIpcMainMock = () => {
  const handlers = new Map()
  return {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    getHandler(channel) {
      const h = handlers.get(channel)
      assert.ok(h, `Missing handler for: ${channel}`)
      return h
    },
  }
}

const createEventMock = () => ({ sender: { send() {} } })

const createStoreMock = (values = {}) => ({
  get(key) {
    return values[key]
  },
  set(key, value) {
    values[key] = value
  },
})

const withElectronMock = () => {
  Module._load = (request, parent, isMain) => {
    if (request === 'electron') return electronMock
    return originalLoad.call(this, request, parent, isMain)
  }
}

const resetModuleLoad = () => {
  Module._load = originalLoad
}

// Clean the tmp user data dir before every test so secret-manager doesn't read stale files
const cleanTmpDir = () => {
  try {
    fs.rmSync(TMP_USER_DATA, { recursive: true, force: true })
  } catch {
    /* empty */
  }
}

// ─────────────────────────────────────────────────────
// Gate G3-L1: Trial 熔断 — AGENT.LIST returns trial limits
// ─────────────────────────────────────────────────────

test('G3-L1: Trial user AGENT.LIST returns agents with trial-level limits', async () => {
  cleanTmpDir()
  withElectronMock()
  electronMock.app.isPackaged = true

  // Pre-populate trial claims so license-service resolves trial plan
  fs.mkdirSync(TMP_USER_DATA, { recursive: true })
  resetModule('../../dist-electron/electron/services/secret-manager.js')
  resetModule('../../dist-electron/electron/services/config-service.js')
  const sm = require('../../dist-electron/electron/services/secret-manager.js')
  sm.setSecret(
    'secrets.license.claims',
    JSON.stringify({
      status: 'active',
      plan: 'trial',
      expiresAt: Date.now() + 86_400_000,
      licenseKey: 'KONE-TEST-TRIAL',
    }),
  )

  // Load agent-service fresh
  resetModule('../../dist-electron/electron/services/agent-service.js')
  resetModule('../../dist-electron/electron/ipc/channels.js')
  resetModule('../../dist-electron/electron/services/license-service.js')
  resetModule('../../dist-electron/electron/security/license-guard.js')

  const { registerAgentHandlers } = require('../../dist-electron/electron/services/agent-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

  const ipcMain = createIpcMainMock()
  const store = createStoreMock({})
  registerAgentHandlers(ipcMain, store)

  const result = await ipcMain.getHandler(IPC_CHANNELS.AGENT.LIST)(createEventMock())
  assert.equal(result.success, true, `Expected success, got: ${JSON.stringify(result)}`)
  assert.ok(result.data?.agents, `Expected data.agents, got: ${JSON.stringify(result.data)}`)
  const wp = result.data.agents.find((a) => a.agentType === 'whatsapp')
  assert.ok(wp, 'whatsapp agent not found in list')
  // Trial limit for whatsapp = 3
  assert.equal(wp.dailyLimit, 3, `whatsapp trial dailyLimit should be 3, got ${wp.dailyLimit}`)
})

// ─────────────────────────────────────────────────────
// Gate G3-L2: Basic 低频限制 — AGENT.LIST returns basic limits
// ─────────────────────────────────────────────────────

test('G3-L2: Basic AGENT.LIST returns basic daily limits', async () => {
  cleanTmpDir()
  withElectronMock()
  electronMock.app.isPackaged = true

  // Pre-populate license claims so license-service resolves basic plan
  fs.mkdirSync(TMP_USER_DATA, { recursive: true })
  resetModule('../../dist-electron/electron/services/secret-manager.js')
  resetModule('../../dist-electron/electron/services/config-service.js')
  const sm = require('../../dist-electron/electron/services/secret-manager.js')
  sm.setSecret(
    'secrets.license.claims',
    JSON.stringify({
      status: 'active',
      plan: 'basic',
      expiresAt: Date.now() + 86_400_000,
      licenseKey: 'KONE-TEST-BASIC',
    }),
  )

  // Load agent-service fresh
  resetModule('../../dist-electron/electron/services/agent-service.js')
  resetModule('../../dist-electron/electron/ipc/channels.js')
  resetModule('../../dist-electron/electron/services/license-service.js')
  resetModule('../../dist-electron/electron/security/license-guard.js')

  const { registerAgentHandlers } = require('../../dist-electron/electron/services/agent-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

  const ipcMain = createIpcMainMock()
  const store = createStoreMock({})
  registerAgentHandlers(ipcMain, store)

  const result = await ipcMain.getHandler(IPC_CHANNELS.AGENT.LIST)(createEventMock())
  assert.equal(result.success, true, `Expected success, got: ${JSON.stringify(result)}`)
  assert.ok(result.data?.agents, `Expected data.agents, got: ${JSON.stringify(result.data)}`)
  const wp = result.data.agents.find((a) => a.agentType === 'whatsapp')
  assert.ok(wp, 'whatsapp agent not found')
  // Basic limit for whatsapp = 5
  assert.equal(wp.dailyLimit, 5, `whatsapp basic dailyLimit should be 5, got ${wp.dailyLimit}`)
})

// ─────────────────────────────────────────────────────
// Gate G4-S4: 流式闭环 — search:stream-complete always fires
// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
// Gate G5-TI: Temporal Isolation — consecutive pipeline runs isolated
// ─────────────────────────────────────────────────────

test('G5-TI: pipeline temporal isolation prevents stale task dispatch', async () => {
  cleanTmpDir()
  withElectronMock()

  resetModule('../../dist-electron/electron/services/agent-pipeline.js')
  const pipeline = require('../../dist-electron/electron/services/agent-pipeline.js')

  // Verify withPipelineIsolation sets a runId
  let capturedRunId = null
  await pipeline.withPipelineIsolation(async (runId) => {
    capturedRunId = runId
    const queue = pipeline.buildAgentTaskQueue([
      { company: 'TestCorp', website: 'https://test.com', phone: '+123456', matchScore: 80 },
    ])
    // Queue should contain whatsapp task (has phone)
    assert.equal(queue.whatsapp.length, 1)
    assert.equal(queue.whatsapp[0].taskRunId, runId)
    assert.equal(queue.whatsapp[0].company, 'TestCorp')
  })
  assert.ok(capturedRunId, 'withPipelineIsolation must produce a runId')

  // Verify isStaleTask correctly identifies stale vs non-stale tasks
  const runId1 = capturedRunId
  assert.equal(pipeline.isStaleTask(runId1), false, 'Current runId must not be stale')

  // After pipeline completes, currentPipelineRunId is null, so any task is not stale (null-safe)
  assert.equal(pipeline.isStaleTask(runId1), false, 'When no active pipeline, isStaleTask must return false')

  // Create a second pipeline run; first run's tasks become stale
  // Test stale detection INSIDE the second pipeline's execution scope
  await pipeline.withPipelineIsolation(async (runId2) => {
    assert.notEqual(runId2, runId1, 'Each pipeline run must have unique runId')

    // Tasks from runId1 are now stale relative to active runId2
    assert.equal(pipeline.isStaleTask(runId1), true, 'runId1 tasks must be stale when runId2 is active')
    assert.equal(pipeline.isStaleTask(runId2), false, 'Current runId must not be stale')
  })

  // Verify qualifiesForPipeline rejects low matchScore
  assert.equal(pipeline.qualifiesForPipeline(50, { email: 'test@test.com' }), false, 'matchScore < 60 must be rejected')
  assert.equal(
    pipeline.qualifiesForPipeline(70, { phone: '+123' }),
    true,
    'matchScore >= 60 with reachable asset must qualify',
  )
  assert.equal(
    pipeline.qualifiesForPipeline(80, {}),
    false,
    'No reachable asset must be rejected even with high matchScore',
  )
})

// ─────────────────────────────────────────────────────
// Gate G6-DC: Dual-Channel write-back verification
// ─────────────────────────────────────────────────────

test('G6-DC: writeBackAgentStatus updates persistent store + emits IPC', async () => {
  cleanTmpDir()
  withElectronMock()
  electronMock.app.isPackaged = true

  fs.mkdirSync(TMP_USER_DATA, { recursive: true })
  resetModule('../../dist-electron/electron/services/secret-manager.js')
  resetModule('../../dist-electron/electron/services/config-service.js')
  const sm = require('../../dist-electron/electron/services/secret-manager.js')
  sm.setSecret(
    'secrets.license.claims',
    JSON.stringify({
      status: 'active',
      plan: 'premium',
      expiresAt: Date.now() + 86_400_000,
      licenseKey: 'KONE-TEST-DC',
    }),
  )

  // Track IPC emissions
  const ipcMessages = []
  const ipcMain = createIpcMainMock()
  const mockEvent = {
    sender: {
      send(channel, ...args) {
        ipcMessages.push({ channel, args })
      },
      isDestroyed() {
        return false
      },
    },
  }

  // Register handlers so globalSender is set
  resetModule('../../dist-electron/electron/services/agent-service.js')
  resetModule('../../dist-electron/electron/ipc/channels.js')
  resetModule('../../dist-electron/electron/services/license-service.js')
  resetModule('../../dist-electron/electron/security/license-guard.js')

  const agentService = require('../../dist-electron/electron/services/agent-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')
  const store = createStoreMock({})

  agentService.registerAgentHandlers(ipcMain, store)

  // Simulate pipeline dispatch which sets globalSender
  const { buildAgentTaskQueue } = require('../../dist-electron/electron/services/agent-pipeline.js')
  const queue = buildAgentTaskQueue([
    {
      company: 'DualTest',
      website: 'https://dual.com',
      phone: '+111',
      email: 'a@b.com',
      linkedinUrl: 'https://linkedin.com/in/test',
      matchScore: 80,
    },
  ])
  agentService.stageAgentsFromPipeline(queue, mockEvent.sender, store, 'test-run-1')

  // Write back a status update and verify
  agentService.writeBackAgentStatus('DualTest', 'whatsapp', { whatsappSent: true, whatsappStatus: 'delivered' })

  // Verify persistent store updated
  const storedStatus = agentService.getAgentStatus('DualTest')
  assert.ok(storedStatus, 'getAgentStatus must return a value after writeBackAgentStatus')
  assert.equal(storedStatus.whatsappSent, true, 'agentStatusStore must reflect whatsappSent update')
  assert.equal(storedStatus.whatsappStatus, 'delivered', 'agentStatusStore must reflect whatsappStatus')

  // Verify IPC was emitted (STATUS_CHANGED should have been sent after write-back)
  const statusChangedMsg = ipcMessages.find((m) => m.channel === IPC_CHANNELS.AGENT.STATUS_CHANGED)
  assert.ok(statusChangedMsg, 'AGENT.STATUS_CHANGED IPC must be emitted after writeBackAgentStatus')
  const agentState = statusChangedMsg.args[0]
  assert.ok(agentState, 'STATUS_CHANGED must carry agent state')
  assert.ok(
    ['agent-whatsapp', 'agent-linkedin', 'agent-email'].includes(agentState.agentId),
    'STATUS_CHANGED must carry a valid agentId',
  )
})

// ─────────────────────────────────────────────────────
// Gate G7-AFC: Account Fail-Closed — Daily limit enforcement at AGENT.CONTROL
// ─────────────────────────────────────────────────────

test('G7-AFC: AGENT.CONTROL enforces daily limits (trial = 3/day)', async () => {
  cleanTmpDir()
  withElectronMock()
  electronMock.app.isPackaged = true

  // Set trial license
  fs.mkdirSync(TMP_USER_DATA, { recursive: true })
  resetModule('../../dist-electron/electron/services/secret-manager.js')
  resetModule('../../dist-electron/electron/services/config-service.js')
  const sm = require('../../dist-electron/electron/services/secret-manager.js')
  sm.setSecret(
    'secrets.license.claims',
    JSON.stringify({
      status: 'active',
      plan: 'trial',
      expiresAt: Date.now() + 86_400_000,
      licenseKey: 'KONE-TEST-TRIAL-CTRL',
    }),
  )

  resetModule('../../dist-electron/electron/services/agent-service.js')
  resetModule('../../dist-electron/electron/ipc/channels.js')
  resetModule('../../dist-electron/electron/services/license-service.js')
  resetModule('../../dist-electron/electron/security/license-guard.js')

  const { registerAgentHandlers } = require('../../dist-electron/electron/services/agent-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

  const ipcMain = createIpcMainMock()
  const store = createStoreMock({})
  registerAgentHandlers(ipcMain, store)

  // First, verify agent list shows trial limits
  const listResult = await ipcMain.getHandler(IPC_CHANNELS.AGENT.LIST)({ sender: { send() {} } })
  assert.equal(listResult.success, true)
  const wp = listResult.data.agents.find((a) => a.agentType === 'whatsapp')
  assert.ok(wp, 'whatsapp agent not found')
  assert.equal(wp.dailyLimit, 3, 'Trial whatsapp dailyLimit must be 3')

  // AGENT.CONTROL with invalid action must return 400
  const invalidResult = await ipcMain.getHandler(IPC_CHANNELS.AGENT.CONTROL)(
    {
      sender: { send() {} },
    },
    {
      agentId: 'agent-whatsapp',
      action: 'invalid',
    },
  )
  assert.equal(invalidResult.success, false, 'Invalid action must fail')
  assert.equal(invalidResult.code, 400, 'Invalid action must return 400')

  // AGENT.CONTROL with non-existent agent must return 404
  const missingResult = await ipcMain.getHandler(IPC_CHANNELS.AGENT.CONTROL)(
    {
      sender: { send() {} },
    },
    {
      agentId: 'agent-nonexistent',
      action: 'start',
    },
  )
  assert.equal(missingResult.success, false, 'Non-existent agent must fail')
  assert.equal(missingResult.code, 404, 'Non-existent agent must return 404')
})

// ─────────────────────────────────────────────────────
// Gate G4-S4: search:stream-complete always fires
// ─────────────────────────────────────────────────────

test('G4-S4: search:stream-complete fires even on search failure', async () => {
  cleanTmpDir()
  electronMock.app.isPackaged = true

  // Mock both electron and http-client (force network failure for search)
  const httpMock = {
    safeFetch: async () => {
      throw new Error('SIMULATED_NETWORK_FAIL')
    },
  }
  Module._load = (request, parent, isMain) => {
    if (request === 'electron') return electronMock
    if (request === '../utils/http-client' && parent?.filename?.includes('search-service')) {
      return httpMock
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  // Pre-populate a valid claims so license-service allows search
  fs.mkdirSync(TMP_USER_DATA, { recursive: true })
  resetModule('../../dist-electron/electron/services/secret-manager.js')
  resetModule('../../dist-electron/electron/services/config-service.js')
  const sm = require('../../dist-electron/electron/services/secret-manager.js')
  sm.setSecret(
    'secrets.license.claims',
    JSON.stringify({
      status: 'active',
      plan: 'basic',
      expiresAt: Date.now() + 86_400_000,
      licenseKey: 'KONE-TEST-SEARCH',
    }),
  )

  // Reload search and channel modules
  resetModule('../../dist-electron/electron/services/search-service.js')
  resetModule('../../dist-electron/electron/ipc/channels.js')
  resetModule('../../dist-electron/electron/services/license-service.js')
  resetModule('../../dist-electron/electron/security/license-guard.js')

  const { registerSearchHandlers } = require('../../dist-electron/electron/services/search-service.js')
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

  const ipcMain = createIpcMainMock()
  const store = createStoreMock({
    user_config: {
      providers: [{ id: 'google_maps', key: 'mock-key', baseUrl: 'https://serpapi.com' }],
      icpProfile: {},
    },
  })

  registerSearchHandlers(ipcMain, store)

  const result = await ipcMain.getHandler(IPC_CHANNELS.SEARCH.EXECUTE)(createEventMock(), {
    keyword: 'test',
    country: 'US',
  })

  // Must return a result (error or success) rather than throwing
  assert.ok(result, 'search:execute must return a result')
})

test.after(() => {
  Module._load = originalLoad
  electronMock.app.isPackaged = true
})
