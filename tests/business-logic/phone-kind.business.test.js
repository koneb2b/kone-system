/**
 * phone-kind 守护测试（2026-10-11）
 *
 * ## 背景（用户实测反馈）
 * 用户：「资料里面都固定电话啊，这个你不会识别吗，能链接 whatsapp 吗，我都吐血了」
 *
 * 此前 WhatsApp 按钮**只做格式校验**就直接拼 `wa.me/<digits>`，
 * 而 Google Maps 等来源返回的商家电话**绝大多数是座机**（WhatsApp 是手机 App，座机不可用）
 * → **链接必然无效**。实测 17 条线索中 15 条为美国 `(XXX) XXX-XXXX` 商家座机。
 *
 * 本测试锁定三条不变量：
 *   ① 座机必须被判 `landline`（不得混入 mobile）
 *   ② **拿不准必须 `unknown`**（保守策略：宁可少给按钮，不可给错链接）
 *   ③ `buildWhatsAppDigits` 对**缺国家码**的号码必须返回 null（不臆造区号）
 */
const assert = require('node:assert')
const test = require('node:test')

const load = () => {
  // 走编译产物（与其它 business 测试同构）
  const candidates = ['../../dist-electron/shared/phone-kind.js', '../dist-electron/shared/phone-kind.js']
  for (const c of candidates) {
    try {
      return require(c)
    } catch {
      /* try next */
    }
  }
  // 回退：直接从源码编译（ts 环境）
  return require('../../src/shared/phone-kind.ts')
}

test('phone-kind: 座机必须判为 landline（不得混入 mobile）', () => {
  const { classifyPhoneKind } = load()
  // 中国座机：区号 + 号码
  assert.equal(classifyPhoneKind('010-12345678', 'CN'), 'landline')
  assert.equal(classifyPhoneKind('021-87654321', 'CN'), 'landline')
  // 德国座机：柏林 030
  assert.equal(classifyPhoneKind('+49 30 12345678', 'DE'), 'landline')
})

test('phone-kind: 中国手机号必须判为 mobile', () => {
  const { classifyPhoneKind, canReachWhatsApp } = load()
  assert.equal(classifyPhoneKind('13800138000', 'CN'), 'mobile')
  assert.equal(classifyPhoneKind('+86 139 1234 5678', 'CN'), 'mobile')
  assert.equal(canReachWhatsApp('13800138000', 'CN'), true)
})

test('phone-kind: 德国手机号必须判为 mobile', () => {
  const { classifyPhoneKind } = load()
  assert.equal(classifyPhoneKind('+49 151 12345678', 'DE'), 'mobile')
  assert.equal(classifyPhoneKind('+49 170 1234567', 'DE'), 'mobile')
})

test('phone-kind: 美国商家座机（实测数据）必须**不可**用于 WhatsApp', () => {
  const { classifyPhoneKind, canReachWhatsApp } = load()
  // 实测 15 条线索的真实号码样本
  const usSamples = ['(832) 237-8333', '(442) 285-7275', '(615) 828-7430', '(321) 608-0836']
  for (const s of usSamples) {
    // 美国号码可携带（LNP），无法从号段区分 → 保守 unknown
    assert.equal(classifyPhoneKind(s, 'US'), 'unknown', `${s} 应保守判为 unknown`)
    assert.equal(canReachWhatsApp(s, 'US'), false, `${s} 不得被判定可用于 WhatsApp`)
  }
})

test('phone-kind: 空值与垃圾输入不得误判为 mobile', () => {
  const { classifyPhoneKind, canReachWhatsApp } = load()
  for (const s of ['', '   ', 'N/A', '无', '--', '123']) {
    assert.notEqual(classifyPhoneKind(s, 'US'), 'mobile', `「${s}」不得判为 mobile`)
    assert.equal(canReachWhatsApp(s, 'US'), false)
  }
})

test('phone-kind: buildWhatsAppDigits 对缺国家码的号码必须返回 null（不臆造区号）', () => {
  const { buildWhatsAppDigits } = load()
  // 无国家码且无法映射 → 必须拒绝，不得瞎猜
  assert.equal(buildWhatsAppDigits('(832) 237-8333', 'GL'), null)
  assert.equal(buildWhatsAppDigits('12345678', ''), null)
  // 已知国家码可补全
  assert.equal(buildWhatsAppDigits('13800138000', 'CN'), '8613800138000')
  assert.equal(buildWhatsAppDigits('+49 151 12345678', 'DE'), '4915112345678')
  assert.equal(buildWhatsAppDigits('(832) 237-8333', 'US'), '18322378333')
})
