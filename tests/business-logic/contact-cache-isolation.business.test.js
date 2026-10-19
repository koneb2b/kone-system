/**
 * contact-cache-isolation.business.test.js — Phase 1 / R1 守护测试（2026-10-17）
 *
 * 覆盖审计 R1「字段级缓存未做联系人级隔离」的修复不变量：
 *   ① 联系人级隔离：同域不同联系人**不得**命中同一缓存项（防串值）；
 *   ② 字段级 TTL：身份（30d）与邮箱/手机（14d）**分别**过期（用注入时钟验证，不真等）；
 *   ③ 旧 3 段键（`provider|domain|field`）**不得**与新的联系人级键混用；
 *   ④ 作用域派生优先级与归一（稳定 ID > LinkedIn > 邮箱 > 姓名 > `-`）；
 *   ⑤ 邮箱可用性 SSOT：INVALID 不可用；CATCH_ALL/RISKY/VALID/无状态**绝不**算已验证。
 *
 * 变异验证（手工复核点）：
 *   - 去掉 `contactScope` 第 4 段 → 隔离用例判红；
 *   - 用 identity 的 30d TTL 写邮箱/手机 → 字段级 TTL 用例判红；
 *   - 让 `assessEmailUsability` 把 CATCH_ALL 当 verified → 可用性用例判红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..', '..')
const CACHE = require(path.join(ROOT, 'dist-electron', 'electron', 'services', 'search', 'enrichment-cache.js'))
const PROV = require(path.join(ROOT, 'dist-electron', 'src', 'shared', 'contact-provenance.js'))
const AVAIL = require(path.join(ROOT, 'dist-electron', 'src', 'shared', 'email-availability.js'))

const DAY = 24 * 60 * 60 * 1000
const T0 = 1_700_000_000_000

/* ══ ① 联系人级隔离：不同联系人不得共用缓存项 ══════════════════════════════ */

test('R1: 同域不同联系人 → 缓存键不同（不得互相命中）', () => {
  const a = CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'email', 'em:a@acme.com')
  const b = CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'email', 'em:b@acme.com')
  assert.notEqual(a, b, '同域不同联系人必须隔离')

  CACHE.clearEnrichmentCache()
  CACHE.setEnrichmentCached(a, { email: 'a@acme.com', attempted: true })
  assert.deepEqual(CACHE.getEnrichmentCached(a), { email: 'a@acme.com', attempted: true })
  assert.equal(CACHE.getEnrichmentCached(b), undefined, '另一联系人不得命中他人邮箱')
  CACHE.clearEnrichmentCache()
})

test('R1: 联系人级键与公司级（作用域 `-`）互不命中', () => {
  const companyScoped = CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'email', '-')
  const contactScoped = CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'email', 'nm:jane')
  assert.notEqual(companyScoped, contactScoped)
  CACHE.clearEnrichmentCache()
  CACHE.setEnrichmentCached(companyScoped, { email: 'info@acme.com', attempted: true })
  assert.equal(CACHE.getEnrichmentCached(contactScoped), undefined, '指定联系人不得读取公司级候选')
  CACHE.clearEnrichmentCache()
})

test('R1: 旧 3 段键（provider|domain|field）与联系人级 4 段键不冲突', () => {
  const legacy = CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'email')
  const scoped = CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'email', 'em:a@acme.com')
  assert.equal(legacy, 'prospeo|acme.com|email')
  assert.notEqual(legacy, scoped, '旧键不得被当作联系人级读取')
})

/* ══ ② 字段级 TTL：身份与联系方式分别过期 ═════════════════════════════════ */

test('R1: 字段级 TTL —— 邮箱 14d 过期时身份（30d）仍有效', () => {
  CACHE.clearEnrichmentCache()
  const idKey = CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'identity', 'li:jane')
  const emKey = CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'email', 'li:jane')
  CACHE.setEnrichmentCached(idKey, { contactId: 'p1', contactName: 'Jane' }, undefined, T0)
  CACHE.setEnrichmentCached(emKey, { email: 'jane@acme.com', attempted: true }, undefined, T0)

  const t15 = T0 + 15 * DAY
  assert.equal(CACHE.getEnrichmentCached(emKey, t15), undefined, '邮箱应在 14 天后过期')
  assert.deepEqual(CACHE.getEnrichmentCached(idKey, t15), { contactId: 'p1', contactName: 'Jane' }, '身份 30 天仍有效')

  const t31 = T0 + 31 * DAY
  assert.equal(CACHE.getEnrichmentCached(idKey, t31), undefined, '身份应在 30 天后过期')
  CACHE.clearEnrichmentCache()
})

test('R1: 手机与邮箱同为 14d；身份 TTL 严格长于联系方式 TTL', () => {
  assert.ok(CACHE.ENRICHMENT_CACHE_TTL_MS.identity > CACHE.ENRICHMENT_CACHE_TTL_MS.email)
  assert.equal(CACHE.ENRICHMENT_CACHE_TTL_MS.email, CACHE.ENRICHMENT_CACHE_TTL_MS.mobile)
})

/* ══ ④ 作用域派生：优先级与归一 ═══════════════════════════════════════════ */

test('R1: 作用域优先级 稳定ID > LinkedIn > 邮箱 > 姓名 > `-`', () => {
  assert.equal(
    PROV.deriveContactScopeKey({ personId: 'p1', linkedinUrl: 'https://linkedin.com/in/x', email: 'a@a.com' }),
    'pid:p1',
  )
  assert.equal(PROV.deriveContactScopeKey({ linkedinUrl: 'https://linkedin.com/in/x', email: 'a@a.com' }), 'li:x')
  assert.equal(PROV.deriveContactScopeKey({ email: 'a@a.com', contactName: 'Jane' }), 'em:a@a.com')
  assert.equal(PROV.deriveContactScopeKey({ contactName: 'Jane Doe' }), 'nm:jane doe')
  assert.equal(PROV.deriveContactScopeKey({}), '-')
  assert.equal(PROV.deriveContactScopeKey(null), '-')
})

test('R1: 作用域归一 —— LinkedIn slug 提取、邮箱小写、剔除 `|`', () => {
  assert.equal(
    PROV.deriveContactScopeKey({ linkedinUrl: 'https://www.linkedin.com/in/Jane-Doe/?trk=x' }),
    'li:jane-doe',
  )
  assert.equal(PROV.deriveContactScopeKey({ email: '  Jane@Acme.COM ' }), 'em:jane@acme.com')
  assert.ok(!PROV.deriveContactScopeKey({ contactName: 'a|b' }).includes('|'), '作用域不得含键分隔符 |')
  assert.equal(PROV.deriveContactScopeKey({ linkedinUrl: 'https://example.com/not-linkedin' }), '-')
})

/* ══ ⑤ 邮箱可用性 SSOT ═══════════════════════════════════════════════════ */

test('R2: 只有 VERIFIED/verified 才算已验证（大小写归一）', () => {
  assert.equal(AVAIL.assessEmailUsability({ email: 'x@a.com', status: 'VERIFIED' }).tier, 'verified')
  assert.equal(AVAIL.assessEmailUsability({ email: 'x@a.com', status: 'verified' }).tier, 'verified')
  assert.equal(AVAIL.isVerifiedEmail({ email: 'x@a.com', status: 'VERIFIED' }), true)
  assert.equal(AVAIL.isVerifiedEmail({ email: 'x@a.com', status: 'verified' }), true)
})

test('R2: 未经证实的 VALID **不得**越级为 verified；邮箱取值保留、降档 extracted', () => {
  /* 无供应商契约支撑（Prospeo 仅 VERIFIED / Apollo 仅 verified）→ VALID 不属已验证。
     同时验证：非空邮箱**不因状态未知而被丢弃**（usable:true），且**不终止**第二供应商回退
     （回退门控为 `.tier === 'verified'`，VALID 不满足 → 回退继续）。 */
  for (const status of ['VALID', 'valid', 'Valid']) {
    const r = AVAIL.assessEmailUsability({ email: 'x@a.com', status })
    assert.equal(r.tier, 'extracted', `${status} 不得冒认 verified`)
    assert.equal(r.usable, true, `${status} 邮箱非空 → 取值保留可用（不得丢值）`)
    assert.equal(r.reason, 'unverified', `${status} 归入未验证档`)
    assert.equal(AVAIL.isVerifiedEmail({ email: 'x@a.com', status }), false, `${status} 不满足回退终止判据`)
  }
})

test('R2: CATCH_ALL / RISKY / UNKNOWN 可用但**绝不**算已验证', () => {
  for (const status of ['CATCH_ALL', 'RISKY', 'UNKNOWN', 'PROBABLE', 'GUESSED', 'EXTRAPOLATED']) {
    const r = AVAIL.assessEmailUsability({ email: 'x@a.com', status })
    assert.equal(r.usable, true, `${status} 作为候选可用（降档标注）`)
    assert.equal(r.tier, 'extracted', `${status} 不得冒认 verified`)
    assert.equal(AVAIL.isVerifiedEmail({ email: 'x@a.com', status }), false)
  }
})

test('R2: INVALID/BOUNCED/UNAVAILABLE/NONE/LOCKED 一律不可用', () => {
  for (const status of ['INVALID', 'BOUNCED', 'UNAVAILABLE', 'NONE', 'LOCKED']) {
    const r = AVAIL.assessEmailUsability({ email: 'x@a.com', status })
    assert.equal(r.usable, false, `${status} 必须不可用`)
    assert.equal(r.tier, 'none')
  }
})

test('R2: 空值/缺状态不臆造 —— 无状态记为 UNKNOWN（extracted），非 verified', () => {
  assert.equal(AVAIL.assessEmailUsability({}).usable, false)
  assert.equal(AVAIL.assessEmailUsability({ email: '   ' }).reason, 'no_value')
  const noStatus = AVAIL.assessEmailUsability({ email: 'x@a.com' })
  assert.equal(noStatus.tier, 'extracted')
  assert.equal(noStatus.grade, 'UNKNOWN')
  assert.equal(noStatus.reason, 'unverified')
})

/* ══ 源码守卫：主进程确实走了新路径（静态断言，补充行为覆盖）═════════ */

const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const SEARCH_SERVICE = stripComments(
  fs.readFileSync(path.join(ROOT, 'electron', 'services', 'search-service.ts'), 'utf8'),
)

test('源码守卫: 富化缓存键必须携带 contactScope（联系人级隔离）', () => {
  assert.match(SEARCH_SERVICE, /deriveContactScopeKey\(/)
  assert.match(SEARCH_SERVICE, /readCachedProspeo\(enrichDomain, contactScope/)
  assert.match(SEARCH_SERVICE, /writeCachedProspeo\(enrichDomain, contactScope/)
  assert.match(SEARCH_SERVICE, /readCachedApollo\(enrichDomain, contactScope/)
  assert.ok(
    !/const identityCacheKey = buildEnrichmentCacheKey\(/.test(SEARCH_SERVICE),
    '不得退回「仅 provider|domain|field」的共享键',
  )
})

test('源码守卫: 第二供应商回退门控必须是"已验证"判据（不得退回 Boolean(prospeo.email)）', () => {
  assert.match(
    SEARCH_SERVICE,
    /assessEmailUsability\(\{ email: prospeo\?\.email, status: prospeo\?\.emailStatus \}\)\.tier === 'verified'/,
  )
  assert.ok(
    !/const prospeoHasQualifyingEmail = Boolean\(prospeo\?\.email\)/.test(SEARCH_SERVICE),
    '不得退回「只要有邮箱就停止回退」的旧行为',
  )
})

test('源码守卫: Apollo 缺少人员标识时必须跳过（skipped_no_identifier），不得仅凭公司字段发起', () => {
  assert.match(SEARCH_SERVICE, /hasApolloPersonIdentifier/)
  assert.match(SEARCH_SERVICE, /status: 'skipped_no_identifier'/)
  assert.match(SEARCH_SERVICE, /person: apolloPersonIdentifier/, '必须把人员标识下发给适配器')
})
