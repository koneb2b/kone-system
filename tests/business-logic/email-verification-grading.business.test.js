const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P0-3 邮箱验证五级分级（G3 缺口闭环）：verified / probable / catch_all / risky / invalid。
// 本套件只驱动零网络的静态分类层与五级 valid 映射；SMTP/catch-all/灰名单探测
// 属网络行为，不在 mock-only 套件内执行。

const engine = require(path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'utils', 'email-verification.js'))

test('P0-3: RFC 深度格式校验 —— 缺失/非法格式直接 invalid', async () => {
  const cases = ['', 'not-an-email', 'a@b', '@no-local.com', 'user@-bad-.com', 'user@domain']
  for (const email of cases) {
    const result = await engine.verifyEmailDetailed(email)
    assert.equal(result.grade, 'invalid', `${JSON.stringify(email)} 应为 invalid`)
    assert.equal(result.valid, false)
  }
})

test('P0-3: disposable 一次性域名 → risky 且 valid=false', async () => {
  const result = await engine.verifyEmailDetailed('buyer@mailinator.com')
  assert.equal(result.grade, 'risky')
  assert.equal(result.valid, false, '一次性域名不得进入触达队列')
  assert.match(result.reason, /一次性/)
})

test('P0-3: role-account（info@/sales@）→ risky 而非 Valid', async () => {
  for (const email of ['info@acme.de', 'sales@acme.de', 'support@acme.de', 'contact@acme.de']) {
    const result = await engine.verifyEmailDetailed(email)
    assert.equal(result.grade, 'risky', `${email} 应为 risky`)
    assert.equal(result.valid, false)
  }
})

test('P0-3: 静态分类对正常地址不武断定级（留给 SMTP 探测）', () => {
  const result = engine.classifyEmailStatic('john.miller@acme.de')
  assert.equal(result.grade, undefined, '静态层不得无证据定级')
  assert.equal(result.domain, 'acme.de')
})

test('P0-3: classifyEmailStatic 大小写归一', () => {
  const result = engine.classifyEmailStatic('INFO@Mailinator.COM')
  assert.equal(result.grade, 'risky')
  assert.equal(result.localPart, 'info')
  assert.equal(result.domain, 'mailinator.com')
})

test('P0-3: verifyEmailDetailed 永不 reject（异常路径也返回五级结果）', async () => {
  const result = await engine.verifyEmailDetailed('user@nonexistent-domain-xyz-abc123.com', { timeoutMs: 500 })
  // 无 MX → invalid；即便 DNS 环境异常也必须是结构化结果
  assert.ok(['invalid', 'probable'].includes(result.grade))
  assert.equal(typeof result.valid, 'boolean')
})
