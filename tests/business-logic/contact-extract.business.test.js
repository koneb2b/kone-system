/**
 * contact-extract.business.test.js — 官网联系方式提取（免费富化增强）守护测试
 *
 * 背景（2026-10-12）：官网深探是**免费**获取邮箱/电话的主路径，但原实现有两处明显短板：
 *   ① UA = `Kone-AI/1.0` → 被大量站点 WAF 403（"官网不可达"空结果的主因）；
 *   ② 只抓 `/contact`、`/contact-us`，且**不解析 JSON-LD**（结构化联系方式白丢）。
 * 本测试锁定增强后的不变量，并含**变异视角**（回退即失败）。
 *
 * 加载**已编译产物**（与项目其它 business 测试一致）：运行前需 `npm run build:electron:dev`。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const modPath = path.join(ROOT, 'dist-electron', 'electron', 'services', 'search', 'contact-extract.js')
const {
  WEBSITE_PROBE_USER_AGENT,
  buildContactPageUrls,
  parseJsonLdContacts,
  extractContactLinksFromHtml,
  extractWhatsAppNumbers,
  extractLabelledMobileNumbers,
  decodeContactHrefValue,
  CONTACT_PAGE_FETCH_LIMIT,
} = require(modPath)

test('UA 为浏览器形态（不再是被 WAF 拦截的自定义 bot UA）', () => {
  assert.match(WEBSITE_PROBE_USER_AGENT, /Mozilla\/5\.0/)
  assert.doesNotMatch(WEBSITE_PROBE_USER_AGENT, /Kone-AI/i)
})

test('buildContactPageUrls 覆盖 /about 与德国法律强制的 /impressum（防回退到仅 2 条路径）', () => {
  const urls = buildContactPageUrls('https://example.com')
  assert.ok(
    urls.some((u) => u.endsWith('/contact')),
    '缺少 /contact',
  )
  assert.ok(
    urls.some((u) => u.endsWith('/contact-us')),
    '缺少 /contact-us',
  )
  assert.ok(
    urls.some((u) => u.endsWith('/about')),
    '缺少 /about（回退即失败）',
  )
  assert.ok(
    urls.some((u) => u.endsWith('/impressum')),
    '缺少 /impressum（德国法律强制载明联系方式）',
  )
  assert.ok(urls.length >= 6, `路径数应≥6，实际 ${urls.length}`)
})

test('buildContactPageUrls 受 limit 约束且默认不超上限', () => {
  assert.equal(buildContactPageUrls('https://example.com', 2).length, 2)
  assert.ok(buildContactPageUrls('https://example.com').length <= CONTACT_PAGE_FETCH_LIMIT)
})

test('buildContactPageUrls 对非法输入返回空数组且不抛错', () => {
  assert.deepEqual(buildContactPageUrls(''), [])
  assert.deepEqual(buildContactPageUrls('not a url'), [])
})

test('extractContactLinksFromHtml 从首页锚点发现真实联系页（href 或锚文本命中）', () => {
  const html =
    '<a href="/get-in-touch">Reach us</a>' +
    '<a href="/company/about-us">About</a>' +
    '<a href="/products">Products</a>'
  const links = extractContactLinksFromHtml(html, 'https://example.com')
  assert.ok(links.includes('https://example.com/get-in-touch'), `缺 /get-in-touch：${JSON.stringify(links)}`)
  assert.ok(links.includes('https://example.com/company/about-us'), '缺 /company/about-us')
  assert.ok(!links.some((u) => u.endsWith('/products')), '非联系页不应被收录')
})

test('extractContactLinksFromHtml 仅取同站链接（防外部/资源/协议链接）', () => {
  const html =
    '<a href="https://evil.example/contact">Contact</a>' +
    '<a href="mailto:info@example.com">Email</a>' +
    '<a href="tel:+123">Call</a>' +
    '<a href="/brochure.pdf">Contact PDF</a>' +
    '<a href="#contact">Jump</a>' +
    '<a href="/kontakt">Kontakt</a>'
  const links = extractContactLinksFromHtml(html, 'https://example.com')
  assert.deepEqual(links, ['https://example.com/kontakt'])
})

test('extractContactLinksFromHtml 去重并受 limit 约束', () => {
  const html =
    '<a href="/contact">Contact</a><a href="/contact/">Contact again</a>' +
    '<a href="/about">About</a><a href="/impressum">Impressum</a><a href="/kontakt">Kontakt</a>'
  assert.deepEqual(extractContactLinksFromHtml(html, 'https://example.com', 10), [
    'https://example.com/contact',
    'https://example.com/about',
    'https://example.com/impressum',
    'https://example.com/kontakt',
  ])
  assert.equal(extractContactLinksFromHtml(html, 'https://example.com', 2).length, 2)
})

test('extractContactLinksFromHtml 非法 baseUrl 返回空数组且不抛错', () => {
  assert.deepEqual(extractContactLinksFromHtml('<a href="/contact">x</a>', ''), [])
})

/* ── WhatsApp 手机号深挖（2026-10-13）：这是**免费**拿到「可用于 WhatsApp 的手机号」的关键来源 ── */

test('extractWhatsAppNumbers 提取 wa.me / api.whatsapp.com / web.whatsapp.com 直链号码（规范化 +国际格式）', () => {
  const html =
    '<a href="https://wa.me/4915112345678">WhatsApp</a>' +
    '<a href="https://api.whatsapp.com/send?phone=+14155550100&text=hi">Chat</a>' +
    '<a href="https://web.whatsapp.com/send?phone=8613800138000">WA</a>'
  const nums = extractWhatsAppNumbers(html)
  assert.ok(nums.includes('+4915112345678'), `缺 wa.me：${JSON.stringify(nums)}`)
  assert.ok(nums.includes('+14155550100'), '缺 api.whatsapp.com')
  assert.ok(nums.includes('+8613800138000'), '缺 web.whatsapp.com')
})

test('extractWhatsAppNumbers 去重，且不误收普通链接/邮箱', () => {
  const html =
    '<a href="https://wa.me/14155550100">a</a>' +
    '<a href="https://wa.me/14155550100">b</a>' +
    '<a href="/contact">c</a><a href="mailto:x@y.com">d</a>'
  assert.deepEqual(extractWhatsAppNumbers(html), ['+14155550100'])
})

test('extractWhatsAppNumbers 拒绝过短号码', () => {
  assert.deepEqual(extractWhatsAppNumbers('<a href="https://wa.me/123">x</a>'), [])
})

test('extractLabelledMobileNumbers 只收带「手机/WhatsApp/Mobile」标记的号码（未标注座机不采信）', () => {
  const text = 'Call us: +1 415 555 0100. Mobile: +1 415 555 0199. WhatsApp: +49 151 1234 5678'
  const nums = extractLabelledMobileNumbers(text)
  assert.ok(nums.includes('+14155550199'), `缺 Mobile 号码：${JSON.stringify(nums)}`)
  assert.ok(nums.includes('+4915112345678'), '缺 WhatsApp 号码')
  assert.ok(!nums.includes('+14155550100'), '未标注的座机不得被当作手机')
})

test('extractLabelledMobileNumbers 不在单词内部误匹配（automobile 不算 mobile）', () => {
  assert.deepEqual(extractLabelledMobileNumbers('automobile: +1 415 555 0100'), [])
})

/* ── URL 编码解码（修真实搜索中实测到的 `%20615-828-7430` 残留）── */

test('decodeContactHrefValue 解码 tel:/mailto: 中的 URL 编码', () => {
  assert.equal(decodeContactHrefValue('%20615-828-7430'), '615-828-7430')
  assert.equal(decodeContactHrefValue('sales%40acme.com'), 'sales@acme.com')
  assert.equal(decodeContactHrefValue('+1%20(555)%200100'), '+1 (555) 0100')
})

test('decodeContactHrefValue 对非法百分号序列原样返回且不抛错', () => {
  assert.equal(decodeContactHrefValue('100%'), '100%')
  assert.equal(decodeContactHrefValue(''), '')
})

test('parseJsonLdContacts 提取 Organization 的 email/telephone', () => {
  const html =
    '<html><head><script type="application/ld+json">' +
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Acme',
      email: 'sales@acme.example',
      telephone: '+49 30 1234567',
    }) +
    '</script></head></html>'
  const { emails, phones } = parseJsonLdContacts(html)
  assert.deepEqual(emails, ['sales@acme.example'])
  assert.ok(
    phones.some((p) => p.replace(/\D/g, '').includes('49301234567')),
    `电话未命中：${JSON.stringify(phones)}`,
  )
})

test('parseJsonLdContacts 支持 @graph 数组与 ContactPoint', () => {
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify({
      '@graph': [
        { '@type': 'Organization', name: 'A' },
        { '@type': 'ContactPoint', email: 'info@a.example', telephone: '+1 415 555 0100' },
      ],
    }) +
    '</script>'
  const { emails, phones } = parseJsonLdContacts(html)
  assert.ok(emails.includes('info@a.example'))
  assert.ok(phones.some((p) => p.replace(/\D/g, '').includes('14155550100')))
})

test('parseJsonLdContacts 不采信 Person/Article 节点（防误采个人邮箱）', () => {
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify([
      { '@type': 'Person', name: 'Jane', email: 'jane.personal@example.com' },
      { '@type': 'Article', author: { '@type': 'Person', email: 'author@blog.example' } },
    ]) +
    '</script>'
  const { emails } = parseJsonLdContacts(html)
  assert.deepEqual(emails, [], 'Person/Article 的邮箱不得被采信（去掉类型过滤即失败）')
})

test('parseJsonLdContacts 对非法 JSON / 空输入静默跳过，绝不抛错', () => {
  assert.deepEqual(parseJsonLdContacts(''), { emails: [], phones: [] })
  assert.deepEqual(parseJsonLdContacts('<script type="application/ld+json">{bad json</script>'), {
    emails: [],
    phones: [],
  })
  assert.deepEqual(parseJsonLdContacts('<html>no ld+json</html>'), { emails: [], phones: [] })
})

test('parseJsonLdContacts 去重', () => {
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify({
      '@type': 'Organization',
      email: 'dup@a.example',
      contactPoint: { '@type': 'ContactPoint', email: 'dup@a.example' },
    }) +
    '</script>'
  const { emails } = parseJsonLdContacts(html)
  assert.deepEqual(emails, ['dup@a.example'])
})
