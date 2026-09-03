/**
 * ipc-contracts.test.ts — IPC 合约系统验证测试
 *
 * Coverage:
 *   1. validateRequest / validateResponse 校验逻辑
 *   2. registry 注册与分发
 *   3. 开发/生产模式行为差异
 *   4. channel 白名单（未注册 channel 拒绝）
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const DIST = path.join(process.cwd(), 'dist-electron')

// ── electron mock ─────────────────────────────────

const originalLoad = Module._load
const electronMock = {
  app: { isPackaged: true, getPath: () => path.join(process.cwd(), '.tmp-test-user-data') },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (v: string) => Buffer.from(v),
    decryptString: (b: Buffer) => b.toString(),
  },
}

Module._load = function mockElectron(request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return electronMock
  return originalLoad.call(this, request, parent, isMain)
}

function loadModule(modPath: string) {
  delete require.cache[require.resolve(modPath)]
  // also clear electron-bridge cache
  const bridgePath = path.join(DIST, 'electron/services/electron-bridge.js')
  delete require.cache[require.resolve(bridgePath)]
  return require(modPath)
}

// ── Tests ─────────────────────────────────────────

test('validateRequest rejects missing required field', () => {
  electronMock.app.isPackaged = false
  const { validateRequest } = loadModule(path.join(DIST, 'electron/ipc/contracts/types.js'))
  const { searchExecuteContract } = loadModule(path.join(DIST, 'electron/ipc/contracts/search-execute.contract.js'))

  const valid = validateRequest(searchExecuteContract, { query: '', country: 'CN' })
  assert.equal(valid.valid, false, 'empty query should fail')
  assert.ok((valid as any).error.includes('query'), 'error should mention query field')
})

test('validateRequest accepts valid payload', () => {
  electronMock.app.isPackaged = false
  const { validateRequest } = loadModule(path.join(DIST, 'electron/ipc/contracts/types.js'))
  const { searchExecuteContract } = loadModule(path.join(DIST, 'electron/ipc/contracts/search-execute.contract.js'))

  const valid = validateRequest(searchExecuteContract, { query: 'test company', country: 'CN' })
  assert.equal(valid.valid, true)
})

test('validateRequest skips validation in packaged mode', () => {
  electronMock.app.isPackaged = true
  const { validateRequest } = loadModule(path.join(DIST, 'electron/ipc/contracts/types.js'))
  const { searchExecuteContract } = loadModule(path.join(DIST, 'electron/ipc/contracts/search-execute.contract.js'))

  const valid = validateRequest(searchExecuteContract, {})
  assert.equal(valid.valid, true, 'packaged mode should skip validation')
})

test('validateResponse rejects missing response field', () => {
  electronMock.app.isPackaged = false
  const { validateResponse } = loadModule(path.join(DIST, 'electron/ipc/contracts/types.js'))
  const { searchExecuteContract } = loadModule(path.join(DIST, 'electron/ipc/contracts/search-execute.contract.js'))

  const valid = validateResponse(searchExecuteContract, {})
  assert.equal(valid.valid, false, 'missing success field should fail')
})

test('registry dispatches registered handler', async () => {
  electronMock.app.isPackaged = false
  loadModule(path.join(DIST, 'electron/ipc/contracts/types.js'))
  const { registry, registerIpc } = loadModule(path.join(DIST, 'electron/ipc/registry.js'))
  const { searchExecuteContract } = loadModule(path.join(DIST, 'electron/ipc/contracts/search-execute.contract.js'))

  registerIpc('test:ping', searchExecuteContract, async (_event: any, ...args: unknown[]) => {
    return { success: true, data: [{ result: 'pong', input: args[0] }], totalResults: 1 }
  })

  const result = await registry.dispatch('test:ping', {}, { query: 'hello' })
  assert.ok(result)
  assert.equal((result as any).success, true)
  assert.equal((result as any).totalResults, 1)
  assert.equal((result as any).data[0].result, 'pong')
})

test('registry rejects unknown channel in dev mode', async () => {
  electronMock.app.isPackaged = false
  const { registry } = loadModule(path.join(DIST, 'electron/ipc/registry.js'))

  await assert.rejects(() => registry.dispatch('unknown:channel', {}, {}), /未知通道/)
})

test('registry returns error object for unknown channel in packaged mode', async () => {
  electronMock.app.isPackaged = true
  const { registry } = loadModule(path.join(DIST, 'electron/ipc/registry.js'))

  const result = await registry.dispatch('unknown:channel', {}, {})
  assert.ok(result)
  assert.equal((result as any).success, false)
  assert.ok((result as any).error.includes('未知通道'))
})

test('analysis contract validates scenario enum', () => {
  electronMock.app.isPackaged = false
  const { validateRequest } = loadModule(path.join(DIST, 'electron/ipc/contracts/types.js'))
  const { analysisGenerateContract } = loadModule(
    path.join(DIST, 'electron/ipc/contracts/analysis-generate.contract.js'),
  )

  // Invalid scenario
  const bad = validateRequest(analysisGenerateContract, {
    lead: { company: 'Test' },
    scenario: 'invalid_scenario',
  })
  assert.equal(bad.valid, false, 'invalid scenario should fail')

  // Valid scenario
  const good = validateRequest(analysisGenerateContract, {
    lead: { company: 'Test' },
    scenario: 'direct_quote',
  })
  assert.equal(good.valid, true)
})

test('assertAllRegistered ensures core channels are present', () => {
  const { registry } = loadModule(path.join(DIST, 'electron/ipc/registry.js'))

  // Register some channels
  registry.register('core:alpha', {
    contract: { channel: 'core:alpha', requestRule: { type: 'any' }, responseRule: { type: 'any' } },
    handler: async () => ({ ok: true }),
  })
  registry.register('core:beta', {
    contract: { channel: 'core:beta', requestRule: { type: 'any' }, responseRule: { type: 'any' } },
    handler: async () => ({ ok: true }),
  })

  // Should pass
  registry.assertAllRegistered(['core:alpha', 'core:beta'])

  // Should throw for missing
  assert.throws(() => registry.assertRegistered('core:gamma'))
})

test('registry rejects duplicate registration', () => {
  const { registry } = loadModule(path.join(DIST, 'electron/ipc/registry.js'))
  const dummy = {
    contract: { channel: 'dup:test', requestRule: { type: 'any' }, responseRule: { type: 'any' } },
    handler: async () => ({}),
  }

  registry.register('dup:test', dummy)
  assert.throws(() => registry.register('dup:test', dummy), /重复注册/)
})

test('registry lock prevents new registrations', () => {
  const { registry } = loadModule(path.join(DIST, 'electron/ipc/registry.js'))
  const dummy = {
    contract: { channel: 'pre:lock', requestRule: { type: 'any' }, responseRule: { type: 'any' } },
    handler: async () => ({}),
  }

  // Create fresh registry for this test
  const freshRegistry = new (Object.getPrototypeOf(registry).constructor)()
  freshRegistry.register('pre:lock', dummy)
  freshRegistry.lock()
  assert.throws(() => freshRegistry.register('post:lock', dummy), /已锁定/)
})

test('handler errors are caught and returned as structured error', async () => {
  const { registry } = loadModule(path.join(DIST, 'electron/ipc/registry.js'))

  registry.register('error:test', {
    contract: { channel: 'error:test', requestRule: { type: 'any' }, responseRule: { type: 'any' } },
    handler: async () => {
      throw new Error('模拟异常')
    },
  })

  const result = await registry.dispatch('error:test', {}, {})
  assert.ok(result)
  assert.equal((result as any).success, false)
  assert.ok((result as any).error.includes('模拟异常'))
})

test('autopilot contracts validate stateKind', () => {
  electronMock.app.isPackaged = false
  const { validateRequest } = loadModule(path.join(DIST, 'electron/ipc/contracts/types.js'))
  const { autopilotSyncLifecycleContract } = loadModule(path.join(DIST, 'electron/ipc/contracts/autopilot.contract.js'))

  const valid = validateRequest(autopilotSyncLifecycleContract, { lifecycle: 'invalid' })
  assert.equal(valid.valid, false, 'invalid lifecycle should fail')

  const good = validateRequest(autopilotSyncLifecycleContract, { lifecycle: 'running' })
  assert.equal(good.valid, true)
})
