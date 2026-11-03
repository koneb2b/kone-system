/**
 * license-generator.business.test.js
 *
 * 回归测试：离线授权签发脚本（scripts/generate-offline-license.cjs）
 *
 * 缺陷背景（2026-11-03）：脚本曾内置手写 `featureMap`，且**没有 basic 项**，
 * 取值表达式为 `featureMap[plan] || featureMap.enterprise` ——
 * 给客户签 `basic` 会签出 **enterprise 能力集**（cloud_send / team_collaboration /
 * export_full 全放行），属商业泄漏；premium/trial 项也各有遗漏。
 *
 * 修复后：能力集直接取自 `src/shared/license-features.ts` 的编译产物（SSOT），
 * 未知套餐 Fail-Closed（不再静默回落 enterprise）。
 *
 * 本用例真实执行签发脚本并校验：
 *   1. 各套餐的 claims.features 与 SSOT 完全一致
 *   2. RSA-SHA256 签名可用对应公钥验签
 *   3. 未知套餐 / 缺少必填参数时退出码非 0
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'generate-offline-license.cjs')
const ssot = require(path.join(ROOT, 'dist-electron', 'src', 'shared', 'license-features.js'))

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const MACHINE = 'test-machine-0001'
const EXPIRES = Date.now() + 30 * 24 * 60 * 60 * 1000

const run = (args, extraEnv = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, KONE_OFFLINE_PRIVATE_KEY: privateKey, ...extraEnv },
  })

const extractLicense = (stdout) => {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 80 && /^[A-Za-z0-9+/=]+$/.test(l))
    .sort((a, b) => b.length - a.length)[0]
  assert.ok(line, '未在输出中找到 base64 激活码')
  return JSON.parse(Buffer.from(line, 'base64').toString('utf8'))
}

for (const plan of ['trial', 'basic', 'premium', 'enterprise']) {
  test(`签发 ${plan}：能力集必须与 SSOT 完全一致（禁止回落 enterprise）`, () => {
    const res = run([MACHINE, plan, String(EXPIRES), `KONE-${plan.toUpperCase()}`])
    assert.equal(res.status, 0, `签发失败: ${res.stderr}`)

    const envelope = extractLicense(res.stdout)
    const expected = Array.from(ssot.getFeaturesForPlan(plan))

    assert.deepEqual(envelope.claims.features, expected, `${plan} 的能力集与 SSOT 不一致`)
    assert.equal(envelope.claims.plan, plan)
    assert.equal(envelope.claims.machineId, MACHINE)
    assert.equal(envelope.claims.expiresAt, EXPIRES)
    assert.equal(envelope.claims.status, 'active')

    // 签名必须能用对应公钥验证（客户端内嵌公钥的验签路径）
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(JSON.stringify(envelope.claims))
    verify.end()
    assert.equal(verify.verify(publicKey, Buffer.from(envelope.signature, 'base64')), true, '签名验签失败')
  })
}

test('basic 不得包含 enterprise 专属能力（历史泄漏点）', () => {
  const res = run([MACHINE, 'basic', String(EXPIRES), 'KONE-BASIC'])
  assert.equal(res.status, 0)
  const features = extractLicense(res.stdout).claims.features
  // 注意：`local_autopilot` 属于 Basic 的合法能力（PRD：付费基础版含低量本地
  // Autopilot），不在禁用清单内。此处只拦截 Premium/Enterprise 专属项。
  for (const forbidden of ['enterprise', 'cloud_send', 'team_collaboration', 'export_full']) {
    assert.ok(!features.includes(forbidden), `basic 不应包含 ${forbidden}`)
  }
})

test('未知套餐必须 Fail-Closed（不得静默回落 enterprise）', () => {
  const res = run([MACHINE, 'platinum', String(EXPIRES), 'KONE-X'])
  assert.notEqual(res.status, 0, '未知套餐必须拒绝签发')
  assert.match(res.stderr, /未知套餐/, '错误信息应明确指出套餐非法')
})

test('缺少必填参数必须拒绝签发', () => {
  const res = run([MACHINE])
  assert.notEqual(res.status, 0)
})
