const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

// 离线授权安全属性验证（补审计缺口：换机拒绝负例）。
// verifyOfflineLicensePayload 内嵌公钥无法在测试中直接签发，
// 这里将 createVerify 重定向到测试密钥对，聚焦验证机器绑定/状态/有效期分支。

const { generateKeyPairSync, createSign } = crypto
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

const originalCreateVerify = crypto.createVerify
crypto.createVerify = function patchedCreateVerify(algorithm) {
  const verifier = originalCreateVerify.call(crypto, algorithm)
  const originalVerify = verifier.verify.bind(verifier)
  verifier.verify = (options, signature) => originalVerify(publicKey, signature)
  return verifier
}

const { verifyOfflineLicensePayload } = require('../dist-electron/electron/services/offline-license.js')

const MACHINE_A = 'device-aaaa-1111'
const MACHINE_B = 'device-bbbb-2222'

const buildClaims = (overrides = {}) => ({
  licenseKey: 'KONE-TEST-0001',
  machineId: MACHINE_A,
  plan: 'premium',
  status: 'active',
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  features: ['search_basic', 'cloud_send'],
  issuedAt: Date.now(),
  ...overrides,
})

const signEnvelope = (claims) => {
  const signer = createSign('RSA-SHA256')
  signer.update(JSON.stringify(claims))
  signer.end()
  const signature = signer.sign(privateKey)
  return Buffer.from(JSON.stringify({ claims, signature: signature.toString('base64') }), 'utf8').toString('base64')
}

test('本机授权码校验通过并返回 claims', () => {
  const claims = buildClaims()
  const verified = verifyOfflineLicensePayload(signEnvelope(claims), MACHINE_A)
  assert.equal(verified.machineId, MACHINE_A)
  assert.equal(verified.plan, 'premium')
})

test('换机拒绝：A 机授权码在 B 机必须被拒', () => {
  const payload = signEnvelope(buildClaims())
  assert.throws(
    () => verifyOfflineLicensePayload(payload, MACHINE_B),
    /当前授权与本设备不匹配/
  )
})

test('过期授权必须被拒', () => {
  const expired = buildClaims({ expiresAt: Date.now() - 1000 })
  assert.throws(
    () => verifyOfflineLicensePayload(signEnvelope(expired), MACHINE_A),
    /授权已过期/
  )
})

test('非 active 状态授权必须被拒', () => {
  const inactive = buildClaims({ status: 'expired' })
  assert.throws(
    () => verifyOfflineLicensePayload(signEnvelope(inactive), MACHINE_A),
    /授权状态异常/
  )
})

test('签名被篡改的授权必须被拒', () => {
  const claims = buildClaims()
  const envelope = { claims: { ...claims, plan: 'enterprise' }, signature: '' }
  const signer = createSign('RSA-SHA256')
  signer.update(JSON.stringify(claims))
  signer.end()
  envelope.signature = signer.sign(privateKey).toString('base64')
  // claims 被改后签名不再匹配 → 结构化拒绝
  assert.throws(
    () => verifyOfflineLicensePayload(Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64'), MACHINE_A),
    /授权文件无效/
  )
})

test('垃圾输入必须返回结构化拒绝而非崩溃', () => {
  assert.throws(() => verifyOfflineLicensePayload('not-a-license', MACHINE_A), /授权文件无效/)
  assert.throws(() => verifyOfflineLicensePayload('', MACHINE_A), /授权文件无效/)
})
