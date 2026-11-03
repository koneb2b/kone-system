/**
 * license-anchor-claims-reconcile.test.ts
 *
 * 回归测试：2026-11-03 打包版实测确认的两处授权缺陷
 *
 *   D-1 · anchor 密文密钥由 `sha256("kone-anchor|machineId|app.name|vN")` 派生。
 *         构建间 app.name / ANCHOR_VERSION 一旦变化，旧 anchor 永久不可解密，
 *         而解密失败被静默当作"无 anchor" → 合法试用被静默降级为「未激活」。
 *
 *   D-2 · `LICENSE.CHECK_STATUS` 只认 anchor，`LICENSE.GET_INFO` 却读 secrets 里的
 *         claims → 同一进程内一个说"剩 6 天"、一个说"未激活"（状态分裂脑）。
 *
 * 修复策略：把 claims 作为只增不减的兜底证据参与 anchor 对账。
 * 本文件直接验证纯函数，不触网、不写注册表、不依赖 Electron 运行时。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')

const originalLoad = Module._load
const electronMock = {
  app: {
    name: 'Kone AI',
    isPackaged: true,
    getPath: (name) => path.join(os.tmpdir(), 'kone-license-reconcile-test', String(name)),
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (v) => Buffer.from(String(v), 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8'),
  },
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
  shell: { openExternal: () => Promise.resolve() },
}

Module._load = function mockLoad(request, parent, isMain) {
  if (request === 'electron') return electronMock
  return originalLoad.call(this, request, parent, isMain)
}

const mod = require(path.join(__dirname, '..', 'dist-electron', 'electron', 'services', 'license-service.js'))

const DAY = 24 * 60 * 60 * 1000
const TRIAL_MS = 7 * DAY
const NOW = Date.now()
const MACHINE = 'test-machine'

const expiredAnchor = {
  version: 2,
  machineId: MACHINE,
  firstTrialAt: NOW - 30 * DAY,
  expiresAt: NOW - 20 * DAY,
  lastCheckDate: NOW - 20 * DAY,
  trialConsumed: true,
  updatedAt: NOW - 20 * DAY,
}

const trialClaims = {
  status: 'active',
  plan: 'trial',
  expiresAt: NOW + 6 * DAY,
  features: ['search_basic', 'lead_export'],
  licenseKey: 'TRIAL-TEST',
  machineId: MACHINE,
}

test('D-1/D-2: 有效 trial claims 必须能把已过期 anchor 抬回有效（只增不减）', () => {
  const merged = mod.reconcileTrialAnchor([expiredAnchor], trialClaims, MACHINE, TRIAL_MS)
  assert.ok(merged, '对账结果不得为 null')
  assert.equal(merged.expiresAt, trialClaims.expiresAt, '到期时间必须取 claims 的较晚值')
  assert.equal(merged.trialConsumed, true)
  assert.equal(merged.machineId, MACHINE)
})

test('D-1: anchor 完全不可读时，claims 仍可独立恢复授权', () => {
  const merged = mod.reconcileTrialAnchor([null, null], trialClaims, MACHINE, TRIAL_MS)
  assert.ok(merged)
  assert.equal(merged.expiresAt, trialClaims.expiresAt)
  assert.equal(merged.firstTrialAt, trialClaims.expiresAt - TRIAL_MS, '首次试用时间由有效期倒推')
})

test('D-1: 更晚的 anchor 不被较早的 claims 覆盖（单调不减）', () => {
  const newerAnchor = { ...expiredAnchor, expiresAt: NOW + 20 * DAY }
  const olderClaims = { ...trialClaims, expiresAt: NOW + 2 * DAY }
  const merged = mod.reconcileTrialAnchor([newerAnchor], olderClaims, MACHINE, TRIAL_MS)
  assert.equal(merged.expiresAt, newerAnchor.expiresAt, '不得因 claims 较早而缩短授权')
})

test('D-1: 付费 claims 不参与 trial anchor 对账（由付费分支处理）', () => {
  const premiumClaims = { ...trialClaims, plan: 'premium' }
  assert.equal(mod.claimsToTrialAnchor(premiumClaims, MACHINE, TRIAL_MS), null)
  const merged = mod.reconcileTrialAnchor([expiredAnchor], premiumClaims, MACHINE, TRIAL_MS)
  assert.equal(merged.expiresAt, expiredAnchor.expiresAt, '付费 claims 不得改写 trial anchor')
})

test('D-1: 已过期/非 active 的 claims 不得续命', () => {
  const expiredClaims = { ...trialClaims, status: 'expired' }
  assert.equal(mod.claimsToTrialAnchor(expiredClaims, MACHINE, TRIAL_MS), null)
  assert.equal(mod.claimsToTrialAnchor({ ...trialClaims, expiresAt: 0 }, MACHINE, TRIAL_MS), null)
})

test('D-1: 机器码不匹配的 claims 必须被丢弃（防跨设备搬运）', () => {
  const foreign = { ...trialClaims, machineId: 'another-machine' }
  assert.equal(mod.claimsToTrialAnchor(foreign, MACHINE, TRIAL_MS), null)
})

test('D-1: 历史 claims 缺 machineId 时按本机处理（向后兼容）', () => {
  const legacy = { ...trialClaims, machineId: undefined }
  const anchor = mod.claimsToTrialAnchor(legacy, MACHINE, TRIAL_MS)
  assert.ok(anchor)
  assert.equal(anchor.machineId, MACHINE)
})

test('D-1: time_rollback 锁定标记在对账后必须保留', () => {
  const lockedAnchor = { ...expiredAnchor, lockedReason: 'time_rollback' }
  const merged = mod.reconcileTrialAnchor([lockedAnchor], trialClaims, MACHINE, TRIAL_MS)
  assert.equal(merged.lockedReason, 'time_rollback', '时钟回拨锁定不得被 claims 兜底解除')
})

test('D-1: 无 anchor 且无 claims 时返回 null（未试用用户语义不变）', () => {
  assert.equal(mod.reconcileTrialAnchor([null, null], null, MACHINE, TRIAL_MS), null)
})
