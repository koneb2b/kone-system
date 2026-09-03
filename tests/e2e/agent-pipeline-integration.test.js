const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')

const TMP_USER_DATA = path.join(process.cwd(), '.tmp-test-user-data')
const originalLoad = Module._load

const electronMock = {
  app: { isPackaged: true, name: 'Kone AI', getPath: () => TMP_USER_DATA },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (v) => Buffer.from(v, 'utf8'),
    decryptString: (b) => b.toString('utf8'),
  },
  session: { fromPartition: () => ({ cookies: { get: async () => [] }, clearStorageData: async () => {} }) },
}

const withElectronMock = () => {
  Module._load = (request, parent, isMain) => {
    if (request === 'electron') return electronMock
    return originalLoad.call(this, request, parent, isMain)
  }
}

const cleanTmpDir = () => {
  try {
    fs.rmSync(TMP_USER_DATA, { recursive: true, force: true })
  } catch {
    /* dir may not exist */
  }
}

// ─────────────────────────────────────────────────────
// G8-E2E: Search → Pipeline → Agent full chain
// ─────────────────────────────────────────────────────

test('G8-E2E: full search→pipeline→agent flow', async () => {
  cleanTmpDir()
  fs.mkdirSync(TMP_USER_DATA, { recursive: true })
  withElectronMock()

  // ---- Phase 1: Pipeline module unit tests ----
  const pipeline = require('../../dist-electron/electron/services/agent-pipeline.js')

  // qualifiesForPipeline
  assert.equal(pipeline.qualifiesForPipeline(85, { phone: '+111' }), true, 'high score + phone qualifies')
  assert.equal(pipeline.qualifiesForPipeline(40, { email: 'a@b.com' }), false, 'low score rejects')
  assert.equal(pipeline.qualifiesForPipeline(null, { phone: '+333' }), false, 'null score rejects')
  assert.equal(pipeline.qualifiesForPipeline(95, {}), false, 'no reachable asset rejects')
  assert.equal(pipeline.qualifiesForPipeline(60, { email: 'a@b.com' }), true, 'score===60 with email qualifies')

  const leads = [
    {
      company: 'AlphaCorp',
      website: 'https://alpha.com',
      email: 'ceo@alpha.com',
      phone: '+111',
      linkedinUrl: 'https://linkedin.com/in/alpha-ceo',
      matchScore: 85,
    },
    { company: 'BetaInc', website: 'https://beta.com', phone: '+222', matchScore: 90 },
    { company: 'GammaLtd', website: 'https://gamma.com', email: 'info@gamma.com', matchScore: 75 },
    { company: 'DeltaCo', website: 'https://delta.com', email: 'info@delta.com', matchScore: 40 },
    { company: 'EpsilonLLC', website: 'https://epsilon.com', phone: '+333', matchScore: null },
    { company: 'ZetaInc', website: 'https://zeta.com', matchScore: 95 },
  ]

  // withPipelineIsolation + buildAgentTaskQueue
  let runId1, queue1, runId2, queue2

  await pipeline.withPipelineIsolation(async (runId) => {
    runId1 = runId
    queue1 = pipeline.buildAgentTaskQueue(leads)
  })

  await pipeline.withPipelineIsolation(async (runId) => {
    runId2 = runId
    queue2 = pipeline.buildAgentTaskQueue([leads[0]])
  })

  assert.ok(runId1, 'first runId set')
  assert.ok(runId2, 'second runId set')
  assert.notEqual(runId1, runId2, 'unique runIds')

  assert.equal(queue1.whatsapp.length, 2, 'whatsapp queue = AlphaCorp + BetaInc')
  assert.equal(queue1.linkedin.length, 1, 'linkedin queue = AlphaCorp')
  assert.equal(queue1.email.length, 2, 'email queue = AlphaCorp + GammaLtd')

  // Priority sorted
  assert.equal(queue1.whatsapp[0].company, 'BetaInc', 'priority sorted (90 > 85)')

  // Temporal isolation
  assert.equal(pipeline.isStaleTask(runId1), false, 'completed pipeline run not stale')
  assert.equal(pipeline.isStaleTask('nonexistent'), false, 'unknown runId not stale (null-safe)')

  await pipeline.withPipelineIsolation(async (runId) => {
    assert.equal(pipeline.isStaleTask(runId1), true, 'prev run stale during active pipeline')
    assert.equal(pipeline.isStaleTask(runId), false, 'current run not stale')
  })

  // Partition correctness
  assert.ok(
    queue1.whatsapp.some((t) => t.company === 'AlphaCorp'),
    'AlphaCorp in whatsapp',
  )
  assert.ok(
    queue1.linkedin.some((t) => t.company === 'AlphaCorp'),
    'AlphaCorp in linkedin',
  )
  assert.ok(
    queue1.email.some((t) => t.company === 'AlphaCorp'),
    'AlphaCorp in email',
  )
  assert.ok(!queue1.whatsapp.some((t) => t.company === 'GammaLtd'), 'GammaLtd not in whatsapp')
  assert.ok(!queue1.whatsapp.some((t) => t.company === 'DeltaCo'), 'DeltaCo not in any queue')
  assert.ok(!queue1.whatsapp.some((t) => t.company === 'ZetaInc'), 'ZetaInc not in any queue')

  // ---- Phase 2: agent-service integration ----
  const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')
  const {
    registerAgentHandlers,
    stageAgentsFromPipeline,
    consumeStagedTargets,
    writeBackAgentStatus,
    getAgentStatus,
  } = require('../../dist-electron/electron/services/agent-service.js')
  const sm = require('../../dist-electron/electron/services/secret-manager.js')

  sm.setSecret(
    'secrets.license.claims',
    JSON.stringify({
      status: 'active',
      plan: 'basic',
      expiresAt: Date.now() + 86400000,
      features: ['local_autopilot', 'search_basic', 'cloud_send'],
    }),
  )

  const ipcEvents = []
  const sender = {
    send(channel, data) {
      ipcEvents.push({ channel, data })
    },
    isDestroyed() {
      return false
    },
  }

  const createEventMock = () => ({ sender })

  const ipcMain = {
    handlers: new Map(),
    handle(ch, handler) {
      this.handlers.set(ch, handler)
    },
    getHandler(ch) {
      const h = this.handlers.get(ch)
      assert.ok(h, `Missing handler: ${ch}`)
      return h
    },
  }

  const store = {
    data: {
      license_claims: JSON.stringify({
        status: 'active',
        plan: 'basic',
        expiresAt: Date.now() + 86400000,
        features: ['local_autopilot', 'search_basic', 'cloud_send'],
      }),
    },
    get(key) {
      return this.data[key]
    },
    set(key, value) {
      this.data[key] = value
    },
  }

  registerAgentHandlers(ipcMain, store)

  // AGENT.LIST
  const listResult = await ipcMain.getHandler(IPC_CHANNELS.AGENT.LIST)(createEventMock())
  assert.equal(listResult.success, true, 'AGENT.LIST success')
  assert.ok(Array.isArray(listResult.data?.agents), 'AGENT.LIST returns agents array')
  assert.equal(listResult.data.agents.length, 3, '3 agents registered')
  const wp = listResult.data.agents.find((a) => a.agentType === 'whatsapp')
  assert.ok(wp, 'whatsapp agent found')
  assert.equal(wp.dailyLimit, 5, 'basic daily limit = 5 for whatsapp')

  // writeBackAgentStatus — persistent + IPC
  writeBackAgentStatus('company-alpha', 'whatsapp', { whatsappSent: true, whatsappStatus: 'delivered' })

  const stored = getAgentStatus('company-alpha')
  assert.ok(stored, 'agent status stored')
  assert.equal(stored.whatsappSent, true, 'whatsappSent persisted')
  assert.equal(stored.whatsappStatus, 'delivered', 'whatsappStatus persisted')
  assert.equal(stored.linkedinContacted, false, 'linkedinContacted defaults to false')
  assert.equal(stored.emailSequenceStage, 0, 'emailSequenceStage defaults to 0')

  // Merge preserves previous fields
  writeBackAgentStatus('company-alpha', 'linkedin', { linkedinContacted: true })
  const merged = getAgentStatus('company-alpha')
  assert.equal(merged.whatsappSent, true, 'merge preserves whatsappSent')
  assert.equal(merged.linkedinContacted, true, 'merge adds linkedinContacted')

  // ---- Phase 3: stageAgentsFromPipeline (HUMAN-IN-THE-LOOP) ----
  // Pipeline must STAGE qualified leads for review, NEVER auto-send.
  const freshPipeline = require('../../dist-electron/electron/services/agent-pipeline.js')
  const dispatchQueue = freshPipeline.buildAgentTaskQueue([
    {
      company: 'DispatchedCo',
      website: 'https://d.com',
      phone: '+999',
      email: 'ceo@d.com',
      linkedinUrl: 'https://linkedin.com/in/d',
      matchScore: 80,
    },
  ])

  stageAgentsFromPipeline(dispatchQueue, sender, store, 'dispatch-test-run-id')

  // Staging must NOT start any agent (no auto-send).
  const afterStage = await ipcMain.getHandler(IPC_CHANNELS.AGENT.LIST)(createEventMock())
  const stagedWa = afterStage.data.agents.find((a) => a.agentType === 'whatsapp')
  assert.equal(stagedWa.status, 'idle', 'staging must NOT auto-start whatsapp agent')
  assert.equal(stagedWa.queuedCount, 1, 'whatsapp queuedCount reflects staged leads')

  // User confirmation path: consumeStagedTargets returns staged targets and clears the queue.
  const consumed = consumeStagedTargets('agent-whatsapp')
  assert.equal(consumed.length, 1, 'consumeStagedTargets returns staged targets')
  assert.equal(consumed[0].company, 'DispatchedCo', 'staged target company preserved')
  assert.deepEqual(consumeStagedTargets('agent-whatsapp'), [], 'queue cleared after consume')

  // ---- Phase 4: stable lead identity (kone-PRD §0.7 / §3.7.3) ----
  // AgentTask must carry SearchExecuteResult.id as leadKey so agentStatus
  // write-back keys on an immutable id instead of the mutable company name.
  const identityQueue = freshPipeline.buildAgentTaskQueue([
    {
      id: 'lead-uuid-123',
      company: 'AlphaCorp',
      website: 'https://alpha.com',
      email: 'ceo@alpha.com',
      phone: '+111',
      linkedinUrl: 'https://linkedin.com/in/a',
      matchScore: 88,
    },
    { company: 'NoIdCo', website: 'https://noid.com', phone: '+222', matchScore: 77 },
  ])
  const alphaWa = identityQueue.whatsapp.find((t) => t.company === 'AlphaCorp')
  assert.equal(alphaWa.leadKey, 'lead-uuid-123', 'leadKey threaded from SearchExecuteResult.id')
  // Same stable key must appear across every channel the lead qualifies for.
  const alphaEmail = identityQueue.email.find((t) => t.company === 'AlphaCorp')
  const alphaLi = identityQueue.linkedin.find((t) => t.company === 'AlphaCorp')
  assert.equal(alphaEmail.leadKey, 'lead-uuid-123', 'email task shares the same stable leadKey')
  assert.equal(alphaLi.leadKey, 'lead-uuid-123', 'linkedin task shares the same stable leadKey')
  // Backward-compatible: leads without an id leave leadKey undefined (falls back to company at write-back).
  const noId = identityQueue.whatsapp.find((t) => t.company === 'NoIdCo')
  assert.equal(noId.leadKey, undefined, 'missing id leaves leadKey undefined (company fallback preserved)')

  // Staging must preserve the stable leadKey end-to-end.
  stageAgentsFromPipeline(identityQueue, sender, store, 'identity-run-id')
  const stagedWithKey = consumeStagedTargets('agent-email')
  const stagedAlpha = stagedWithKey.find((t) => t.company === 'AlphaCorp')
  assert.ok(stagedAlpha, 'AlphaCorp staged for email')
  assert.equal(stagedAlpha.leadKey, 'lead-uuid-123', 'staged target preserves stable leadKey for write-back')
})
