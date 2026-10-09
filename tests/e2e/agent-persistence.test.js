const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')

// ─────────────────────────────────────────────────────────────
// P1-2: Durable agent logs + agentStatus.
//
// agentLogs and agentStatusStore were memory-only Maps — every touch history
// and reach-status vanished on restart, breaking kone-PRD §3.7.8 (UI reads
// PERSISTED agentStatus; `agent:get-log` returns a real AgentLogEntry[] timeline)
// and AGENTS.md ("[查看运行日志] via agent:get-log returns backend AgentLogEntry[]").
//
// This test drives the compiled agent-service with a PERSISTENT mock config
// store, simulates an app restart (fresh module load, SAME store), and asserts
// the timeline + status survive. electron is mocked (no real windows/sessions).
// ─────────────────────────────────────────────────────────────

const TMP = path.join(process.cwd(), '.tmp-p1-2-agent-persistence')
const originalLoad = Module._load

const electronMock = {
  app: { isPackaged: true, name: 'Kone AI', getPath: () => TMP, on: () => {} },
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
    // license-guard 打桩：本测试关注的是**持久化幸存**（P1-2），不是授权判定。
    // 真实 guard 会校验 claims 签名/机器码绑定，而这里用的是手写 claims（无签名），
    // 且 electronMock.app.isPackaged = true 会让它直接 throw；若不打桩，
    // `AGENT.GET_LOG` 的 requireFeature 会抛 401，测试因"授权环境缺失"而失败，
    // 与它要验证的持久化能力无关。授权语义由 permission-lock.test.js 专门覆盖。
    if (/license-guard(\.js)?$/.test(request)) {
      return {
        createLicenseGuard: () => ({
          getStoredClaims: () => ({
            status: 'active',
            plan: 'basic',
            expiresAt: Date.now() + 86400000,
            features: ['local_autopilot'],
          }),
          requireFeature: () => ({ claims: null, featureSet: new Set() }),
          requireAnyFeature: () => ({ claims: null, featureSet: new Set() }),
        }),
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
}
const restore = () => {
  Module._load = originalLoad
}

// A PERSISTENT store whose data outlives module reloads (models on-disk config).
const makePersistentStore = () => {
  const data = {
    license_claims: JSON.stringify({
      status: 'active',
      plan: 'basic',
      expiresAt: Date.now() + 86400000,
      features: ['local_autopilot', 'search_basic', 'cloud_send'],
    }),
  }
  return {
    data,
    get(k) {
      return this.data[k]
    },
    set(k, v) {
      this.data[k] = v
    },
  }
}

const freshAgentService = () => {
  const p = require.resolve('../../dist-electron/electron/services/agent-service.js')
  delete require.cache[p]
  return require(p)
}

const ipcMainMock = () => ({
  handlers: new Map(),
  handle(ch, h) {
    this.handlers.set(ch, h)
  },
  getHandler(ch) {
    const h = this.handlers.get(ch)
    assert.ok(h, `missing ${ch}`)
    return h
  },
})

test('P1-2: agentStatus + logs survive an app restart (persisted → re-hydrated)', async () => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* dir may not exist */
  }
  fs.mkdirSync(TMP, { recursive: true })
  withElectronMock()
  try {
    const store = makePersistentStore()
    const { IPC_CHANNELS } = require('../../dist-electron/electron/ipc/channels.js')

    // ── Session 1: write status + logs, then "close" ──
    const svc1 = freshAgentService()
    const ipc1 = ipcMainMock()
    svc1.registerAgentHandlers(ipc1, store)
    svc1.writeBackAgentStatus('lead-uuid-xyz', 'whatsapp', { whatsappSent: true, whatsappStatus: 'delivered' })
    svc1.writeBackAgentStatus('lead-uuid-xyz', 'email', { emailSequenceStage: 2 })

    // Persistence must have hit the store (not just memory).
    assert.ok(store.get('agent_status'), 'agent_status persisted to config store')
    assert.ok(store.get('agent_logs'), 'agent_logs persisted to config store')

    // ── Session 2: SIMULATED RESTART — fresh module, SAME store ──
    const svc2 = freshAgentService()
    const ipc2 = ipcMainMock()
    svc2.registerAgentHandlers(ipc2, store)

    // Status timeline survived the restart.
    const status = svc2.getAgentStatus('lead-uuid-xyz')
    assert.ok(status, 'agentStatus re-hydrated after restart')
    assert.equal(status.whatsappSent, true, 'whatsappSent survived restart')
    assert.equal(status.whatsappStatus, 'delivered', 'whatsappStatus survived restart')
    assert.equal(status.emailSequenceStage, 2, 'emailSequenceStage survived restart')

    // Log timeline survived and is queryable via agent:get-log.
    const logRes = await ipc2.getHandler(IPC_CHANNELS.AGENT.GET_LOG)({}, 'agent-whatsapp')
    assert.equal(logRes.success, true, 'agent:get-log succeeds after restart')
    assert.ok(logRes.data.logEntries.length > 0, 'whatsapp log timeline survived restart (not empty)')
    assert.ok(
      logRes.data.logEntries.some((e) => e.event === 'status_written'),
      'persisted log contains the status_written entry',
    )
  } finally {
    restore()
    try {
      fs.rmSync(TMP, { recursive: true, force: true })
    } catch {
      /* dir may not exist */
    }
  }
})

test('P1-2: per-agent log history is capped (low-spec memory/disk budget)', async () => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* dir may not exist */
  }
  fs.mkdirSync(TMP, { recursive: true })
  withElectronMock()
  try {
    const store = makePersistentStore()
    const svc = freshAgentService()
    const ipc = ipcMainMock()
    svc.registerAgentHandlers(ipc, store)

    // Drive >200 log entries via repeated status writes (each writes one log line).
    for (let i = 0; i < 260; i++) {
      svc.writeBackAgentStatus('lead-cap-test', 'whatsapp', { whatsappSent: true })
    }
    const persisted = store.get('agent_logs')['agent-whatsapp']
    assert.ok(persisted.length <= 200, `log history capped at 200 (got ${persisted.length})`)
    // Cap keeps the MOST RECENT entries.
    assert.equal(persisted[persisted.length - 1].event, 'status_written', 'most recent entry retained')
  } finally {
    restore()
    try {
      fs.rmSync(TMP, { recursive: true, force: true })
    } catch {
      /* dir may not exist */
    }
  }
})
