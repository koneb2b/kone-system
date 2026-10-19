const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')

/* Kone 分级 B2B 联系人补全 —— 最小完整链路的守护测试（Step 1–5）
 *
 * 覆盖：
 *   Step 2B 决策人身份必须交付（审计缺陷 D-2：Prospeo 已解析的人名/职位曾被丢弃）
 *   Step 3  成本摘要口径（跳过不计费 / 缓存不计费 / 未知不伪造）+ 字段级去重键
 *   Step 4  可信规则（verified 优先于 extracted；冲突保留证据不覆盖；不冒认已验证）
 *   Step 2E 分级补全的默认授权（邮箱开 / 手机关）
 *
 * 变异验证（手工复核点）：
 *   - 把 `pickContactWithProvenance` 改回「第一个非空即胜」→ 优先级用例判红；
 *   - 让 Prospeo 在无邮箱无手机时仍返回 `used:false` → 身份交付用例判红；
 *   - 让 `resolveEnrichmentOptions` 的 mobile 默认 true → 默认授权用例判红；
 *   - 去掉手机授权门禁 → 源码守卫用例判红。
 */

const TMP_USER_DATA = path.join(process.cwd(), '.tmp-enrichment-tiered-user-data')
const originalLoad = Module._load
const electronMock = {
  app: { isPackaged: false, name: 'Kone AI', getPath: () => TMP_USER_DATA },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (v) => Buffer.from(String(v), 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8'),
  },
}
const SECRET_STUB = {
  /* 打桩密钥读取：让适配器真正走到 HTTP 出口（否则会因「未配置密钥」提前 Fail-Closed 返回，
     导致用例变成假通过）。其余密钥一律返回空串，保持诚实缺省。 */
  getSecret: (key) => {
    const k = String(key || '').toUpperCase()
    if (k.includes('PROSPEO')) return 'prospeo-test-key'
    if (k.includes('APOLLO')) return 'apollo-test-key'
    return ''
  },
}
Module._load = (request, parent, isMain) => {
  if (request === 'electron') return electronMock
  if (/secret-manager$/.test(String(request))) return SECRET_STUB
  return originalLoad.call(this, request, parent, isMain)
}

const ROOT = path.join(__dirname, '..', '..')
const PROV = require(path.join(ROOT, 'dist-electron', 'src', 'shared', 'contact-provenance.js'))
const COST = require(path.join(ROOT, 'dist-electron', 'src', 'shared', 'enrichment-cost.js'))
const LEDGER = require(path.join(ROOT, 'dist-electron', 'electron', 'services', 'search', 'enrichment-ledger.js'))
const CACHE = require(path.join(ROOT, 'dist-electron', 'electron', 'services', 'search', 'enrichment-cache.js'))
const PROSPEO = require(path.join(ROOT, 'dist-electron', 'electron', 'services', 'search', 'enrich-prospeo.js'))
const APOLLO = require(path.join(ROOT, 'dist-electron', 'electron', 'services', 'search', 'enrich-apollo.js'))

const { pickContactWithProvenance, CONTACT_TIER_RANK } = PROV
const { summarizeEnrichmentCalls, resolveEnrichmentOptions, DEFAULT_ENRICHMENT_OPTIONS } = COST

/* ══ Step 4：取值优先级（低可信不得覆盖高可信） ══════════════════════════ */

test('Step4: verified 必须优先于 extracted —— 即使 extracted 排在数组更前面', () => {
  const pick = pickContactWithProvenance([
    { value: 'guessed@acme.com', tier: 'extracted', source: '搜索结果' },
    { value: 'jane@acme.com', tier: 'verified', source: 'Prospeo' },
  ])
  assert.equal(pick.value, 'jane@acme.com', '高可信必须胜出（低可信不得覆盖高可信）')
  assert.equal(pick.provenance.tier, 'verified')
  assert.equal(pick.provenance.source, 'Prospeo', '来源与取值同源，不得错标')
})

test('Step4: 同档位保持传入顺序（业务优先级不被排序打乱）', () => {
  const pick = pickContactWithProvenance([
    { value: 'a@acme.com', tier: 'extracted', source: '官网' },
    { value: 'b@acme.com', tier: 'extracted', source: '目录站' },
  ])
  assert.equal(pick.value, 'a@acme.com')
})

test('Step4: 冲突保留证据、不静默覆盖', () => {
  const pick = pickContactWithProvenance([
    { value: 'jane@acme.com', tier: 'verified', source: 'Prospeo' },
    { value: 'info@acme.com', tier: 'extracted', source: '官网' },
    { value: 'jane@acme.com', tier: 'extracted', source: '官网' }, // 与胜出值相同 → 不算冲突
  ])
  assert.equal(pick.value, 'jane@acme.com')
  assert.deepEqual(pick.provenance.conflicts, [{ source: '官网', value: 'info@acme.com' }], '落选且取值不同者须留证据')
})

test('Step4: 无冲突时不产生 conflicts 键（保持既有数据形状）', () => {
  const pick = pickContactWithProvenance([{ value: 'jane@acme.com', tier: 'verified', source: 'Prospeo' }])
  assert.equal('conflicts' in pick.provenance, false)
})

test('Step4: 全空 → 空值且无来源（不臆造档位）', () => {
  const pick = pickContactWithProvenance([
    { value: '', tier: 'verified', source: 'Prospeo' },
    { value: null, tier: 'extracted', source: '官网' },
  ])
  assert.equal(pick.value, '')
  assert.equal(pick.provenance, undefined)
})

test('Step4: 档位优先级表完整（三档齐全且单调）', () => {
  assert.ok(CONTACT_TIER_RANK.verified > CONTACT_TIER_RANK.extracted)
  assert.ok(CONTACT_TIER_RANK.extracted > CONTACT_TIER_RANK.inferred)
})

/* ══ Step 3：成本摘要口径 ═════════════════════════════════════════════ */

test('Step3: 跳过类状态不计入调用次数（未发生请求）', () => {
  const summary = summarizeEnrichmentCalls([
    {
      provider: 'prospeo',
      field: 'identity',
      status: 'skipped_not_opted_in',
      at: 1,
      billingUnit: 'credit',
      cost: null,
    },
    { provider: 'prospeo', field: 'identity', status: 'skipped_budget', at: 1, billingUnit: 'credit', cost: null },
    {
      provider: 'apollo',
      field: 'identity',
      status: 'skipped_not_high_value',
      at: 1,
      billingUnit: 'credit',
      cost: null,
    },
  ])
  assert.equal(summary.calls, 0)
  assert.equal(summary.unknownCostCalls, 0)
  assert.deepEqual(summary.providers, [])
})

test('Step3: 缓存命中计入调用次数但**不计费**', () => {
  const summary = summarizeEnrichmentCalls([
    {
      provider: 'prospeo',
      field: 'identity',
      status: 'hit',
      at: 1,
      billingUnit: 'credit',
      cost: null,
      fromCache: true,
    },
  ])
  assert.equal(summary.calls, 1)
  assert.equal(summary.unknownCostCalls, 0, '缓存命中不消耗额度，不得计入未知费用')
  assert.deepEqual(summary.byUnit, {})
})

test('Step3: 未确认计费记为未知，不伪造精确成本；不同计费单位分别求和', () => {
  const summary = summarizeEnrichmentCalls([
    { provider: 'prospeo', field: 'identity', status: 'hit', at: 1, billingUnit: 'credit', cost: null },
    { provider: 'apollo', field: 'identity', status: 'hit', at: 1, billingUnit: 'credit', cost: 3 },
    { provider: 'website', field: 'email', status: 'hit', at: 1, billingUnit: 'free', cost: 0 },
  ])
  assert.equal(summary.calls, 3)
  assert.equal(summary.unknownCostCalls, 1, 'cost=null 必须如实计入未知')
  assert.deepEqual(summary.byUnit, { credit: 3, free: 0 }, '不同单位分别求和，不跨单位合并')
  assert.deepEqual(summary.providers.sort(), ['apollo', 'prospeo', 'website'])
})

/* ══ Step 3：字段级去重键与缓存 ═══════════════════════════════════════ */

test('Step3: 去重键按 provider|domain|field 归一（www/协议/大小写不产生重复购买）', () => {
  const a = CACHE.buildEnrichmentCacheKey('prospeo', 'https://www.Acme.com/about', 'email')
  const b = CACHE.buildEnrichmentCacheKey('prospeo', 'http://acme.com', 'email')
  assert.equal(a, b, '同一域名必须归一到同一键')
  assert.notEqual(a, CACHE.buildEnrichmentCacheKey('apollo', 'acme.com', 'email'), '不同供应商不得共用键')
  assert.notEqual(a, CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'identity'), '不同字段不得共用键')
})

test('Step3: 缓存 TTL 按数据类型区分（身份长于联系方式）', () => {
  assert.ok(CACHE.ENRICHMENT_CACHE_TTL_MS.identity > CACHE.ENRICHMENT_CACHE_TTL_MS.email)
  assert.ok(CACHE.ENRICHMENT_CACHE_TTL_MS.email > 0)
})

test('Step3: 缓存写入/命中/深拷贝/清理', () => {
  CACHE.clearEnrichmentCache()
  const key = CACHE.buildEnrichmentCacheKey('prospeo', 'acme.com', 'email')
  assert.equal(CACHE.getEnrichmentCached(key), undefined, '未写入即未命中')
  CACHE.setEnrichmentCached(key, { email: 'jane@acme.com' })
  const hit = CACHE.getEnrichmentCached(key)
  assert.deepEqual(hit, { email: 'jane@acme.com' })
  hit.email = 'mutated'
  assert.equal(CACHE.getEnrichmentCached(key).email, 'jane@acme.com', '命中返回深拷贝，调用方改写不得污染缓存')
  CACHE.clearEnrichmentCache()
})

/* ══ Step 3：调用账本 ════════════════════════════════════════════════ */

test('Step3: 账本记录六要素且可汇总', () => {
  LEDGER.clearEnrichmentLedger()
  const recorded = LEDGER.recordEnrichmentCall({
    provider: 'prospeo',
    field: 'email',
    status: 'hit',
    billingUnit: 'credit',
    detail: 'enrich-person',
    now: 1700000000000,
  })
  assert.equal(recorded.at, 1700000000000, '时间可注入（可测）')
  assert.equal(recorded.cost, null, '未传 cost 一律记 null（未知），不猜')
  assert.equal(LEDGER.getEnrichmentLedger().length, 1)
  assert.equal(LEDGER.summarizeEnrichmentLedger().calls, 1)
  LEDGER.clearEnrichmentLedger()
})

/* ══ Step 2E：分级补全的默认授权 ═════════════════════════════════════ */

test('Step2E: 默认策略 —— 邮箱放行、手机**关闭**（高成本须显式开启）', () => {
  assert.equal(DEFAULT_ENRICHMENT_OPTIONS.email, true)
  assert.equal(DEFAULT_ENRICHMENT_OPTIONS.mobile, false, '手机补全不得默认开启')
  assert.deepEqual(resolveEnrichmentOptions(undefined), { email: true, mobile: false })
  assert.deepEqual(resolveEnrichmentOptions({}), { email: true, mobile: false })
  assert.deepEqual(resolveEnrichmentOptions({ email: false }), { email: false, mobile: false })
  assert.deepEqual(resolveEnrichmentOptions({ mobile: true }), { email: true, mobile: true })
  assert.deepEqual(resolveEnrichmentOptions({ email: false, mobile: true }), { email: false, mobile: true })
})

test('Step2E: 非法值回落到默认（不因脏数据开启高成本补全）', () => {
  assert.deepEqual(resolveEnrichmentOptions({ mobile: 'yes' }), { email: true, mobile: false })
})

/* ══ Step 2B / Step 4：适配器出口（打桩网络出口，其余全真实） ══════════ */

let captured = []
const realFetch = globalThis.fetch
const installFetchSpy = (responder) => {
  captured = []
  globalThis.fetch = async (url, init) => {
    let body
    try {
      body = JSON.parse(init?.body)
    } catch {
      body = null
    }
    captured.push({ url: String(url), body, headers: init?.headers })
    const payload = responder(String(url), body)
    return { ok: true, status: 200, json: async () => payload }
  }
}
test.after(() => {
  globalThis.fetch = realFetch
})

test('Step2B: Prospeo 已解析的决策人身份必须交付（此前被丢弃 —— 审计 D-2）', async () => {
  installFetchSpy((url) => {
    if (url.includes('search-person')) {
      return {
        results: [
          {
            person: {
              person_id: 'p1',
              full_name: 'Jane Doe',
              current_job_title: 'Owner',
              linkedin_url: 'https://linkedin.com/in/janedoe',
            },
          },
        ],
      }
    }
    /* enrich-person：只返回未揭示状态（无邮箱无手机）—— 身份仍必须保留 */
    return { person: { email: { revealed: false }, mobile: { revealed: false } } }
  })

  const result = await PROSPEO.enrichFromProspeo({ domain: 'acme.com', country: 'US' })
  assert.equal(result.used, true, '找到人即视为有效产出（search-person 已消耗额度）')
  assert.equal(result.contactName, 'Jane Doe')
  assert.equal(result.contactTitle, 'Owner')
  assert.equal(result.contactLinkedinUrl, 'https://linkedin.com/in/janedoe')
  assert.equal(result.email, undefined, '未揭示即不得臆造邮箱')
  assert.equal(result.phone, undefined)
})

test('Step4/D-4: Prospeo 邮箱状态**如实回传**（不再自行认定已验证）', async () => {
  installFetchSpy((url) => {
    if (url.includes('search-person')) {
      return { results: [{ person: { person_id: 'p1', full_name: 'Jane Doe', current_job_title: 'Owner' } }] }
    }
    return { person: { email: { revealed: true, status: 'UNKNOWN', email: 'jane@acme.com' } } }
  })
  const result = await PROSPEO.enrichFromProspeo({ domain: 'acme.com' })
  assert.equal(result.email, 'jane@acme.com')
  assert.equal(result.emailStatus, 'UNKNOWN', '状态必须原样回传，由调用方决定可信档')
  assert.notEqual(
    String(result.emailStatus).toUpperCase(),
    PROSPEO.PROSPEO_VERIFIED_EMAIL_STATUS,
    'UNKNOWN 不得被当作已验证',
  )
})

test('Step4/D-3: Apollo 邮箱状态与匹配置信度**如实回传**（不再无条件标 verified）', async () => {
  installFetchSpy(() => ({
    person: {
      name: 'John Smith',
      title: 'Purchasing Manager',
      email: 'john@acme.com',
      email_status: 'guessed',
      match_confidence: 'low',
      phone_numbers: [],
    },
  }))
  const result = await APOLLO.enrichFromApollo({ domain: 'acme.com', person: { name: 'John Smith' } })
  assert.equal(result.emailStatus, 'guessed')
  assert.notEqual(result.emailStatus, APOLLO.APOLLO_VERIFIED_EMAIL_STATUS, 'guessed 不得被当作已验证')
  assert.equal(result.matchConfidence, 'low')
  assert.equal(result.contactName, 'John Smith')
})

test('Step4: Apollo `match_confidence=none` → 不得当作真实联系人', async () => {
  installFetchSpy(() => ({
    person: {
      name: '',
      title: '',
      email: 'placeholder@acme.com',
      email_status: 'unavailable',
      match_confidence: 'none',
    },
  }))
  const result = await APOLLO.enrichFromApollo({ domain: 'acme.com', person: { name: 'John Smith' } })
  assert.equal(result.used, false, '未匹配到记录时不得产出数据')
  assert.equal(result.email, undefined)
})

/* ══ 源码守卫：主进程必须真正执行门禁（静态断言，补充行为覆盖） ══════ */

const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

test('源码守卫: 手机补全必须受用户授权门禁（allowMobileEnrich）约束', () => {
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'electron', 'services', 'search-service.ts'), 'utf8'))
  assert.match(
    src,
    /const allowMobileEnrich = payload\.enrichmentOptions\?\.mobile === true/,
    '手机授权必须显式 === true',
  )
  assert.match(src, /allowMobileEnrich &&/, 'wantMobile 必须由授权门禁参与判定')
  assert.ok(!/const wantMobile = Boolean\(mobileBudget\)/.test(src), '不得退回「仅凭预算即揭示手机」的旧行为')
})

test('源码守卫: 邮箱取值必须由 pickContactWithProvenance 按档位裁决（不得手写 || 链）', () => {
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'electron', 'services', 'search-service.ts'), 'utf8'))
  assert.match(src, /pickContactWithProvenance\(\[/)
  assert.ok(!/const email = String\(\s*payload\.candidate\.email \|\|/.test(src))
})
