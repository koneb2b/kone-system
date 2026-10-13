/**
 * enrich-prospeo.business.test.js — Prospeo 富化适配器守护测试
 *
 * 背景（2026-10-13）：Prospeo 作为 **Apollo 的低成本前置**补齐「已验证邮箱 + 已验证手机号」
 * （用户需用高级版 WhatsApp 触达，而官网/Google Maps 公开电话几乎都是座机）。
 *
 * 本测试锁定 **Fail-Closed 契约**：无密钥 / 非 2xx / 业务 error / 无命中 / 网络异常
 * 一律返回 `{ used: false }` 且**绝不抛错**（否则会反过来中断整条搜索富化链路）。
 * 并锁定「揭示到的手机 → phoneKind=mobile」这一 WhatsApp 可达性关键语义。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const modPath = path.join(ROOT, 'dist-electron', 'electron', 'services', 'search', 'enrich-prospeo.js')

const { withModuleMocks, resetModule } = require('./helpers.js')

/** 用给定 apiKey + 自定义 fetch 行为加载适配器 */
const loadAdapter = async (apiKey, fetchImpl) => {
  let mod = null
  await withModuleMocks(
    {
      [`../proxy-service::${modPath}`]: { fetchWithTimeout: fetchImpl },
      [`../secret-manager::${modPath}`]: { getSecret: () => apiKey },
      [`../config-service::${modPath}`]: { SECRET_KEYS: { PROSPEO_API_KEY: 'secrets.prospeo.apiKey' } },
    },
    async () => {
      resetModule(modPath)
      mod = require(modPath)
    },
  )
  return mod
}

const jsonResponse = (obj, ok = true) => ({ ok, json: async () => obj, text: async () => JSON.stringify(obj) })

const SEARCH_OK = jsonResponse({
  error: false,
  results: [
    { person: { person_id: 'p1', full_name: 'Jane Doe', current_job_title: 'Owner', email: { status: 'VERIFIED' } } },
  ],
})

test('无密钥 → used:false（Fail-Closed，不发起任何请求）', async () => {
  let called = 0
  const mod = await loadAdapter('', async () => {
    called += 1
    return SEARCH_OK
  })
  const r = await mod.enrichFromProspeo({ domain: 'acme.com' })
  assert.equal(r.used, false)
  assert.equal(called, 0, '无密钥时不得发起网络请求')
})

test('正常路径：search → enrich 返回已验证邮箱', async () => {
  const mod = await loadAdapter('KEY', async (url) => {
    if (url.includes('search-person')) return SEARCH_OK
    return jsonResponse({
      error: false,
      person: { email: { status: 'VERIFIED', revealed: true, email: 'jane@acme.com' }, mobile: { revealed: false } },
    })
  })
  const r = await mod.enrichFromProspeo({ domain: 'https://acme.com' })
  assert.equal(r.used, true)
  assert.equal(r.email, 'jane@acme.com')
  assert.equal(r.source, 'prospeo')
})

test('揭示手机 → phoneKind=mobile（WhatsApp 可达的关键语义）', async () => {
  const mod = await loadAdapter('KEY', async (url) => {
    if (url.includes('search-person')) return SEARCH_OK
    return jsonResponse({
      error: false,
      person: {
        email: { status: 'VERIFIED', revealed: true, email: 'jane@acme.com' },
        mobile: { revealed: true, mobile: '+1 717-579-2681', mobile_country_code: 'US' },
      },
    })
  })
  const r = await mod.enrichFromProspeo({ domain: 'acme.com', country: 'US', wantMobile: true })
  assert.equal(r.used, true)
  assert.equal(r.phoneKind, 'mobile')
  assert.equal(r.phone, '+1 717-579-2681')
})

test('search 业务 error:true → used:false（不抛错）', async () => {
  const mod = await loadAdapter('KEY', async () => jsonResponse({ error: true, error_code: 'INVALID_API_KEY' }))
  const r = await mod.enrichFromProspeo({ domain: 'acme.com' })
  assert.equal(r.used, false)
})

test('search 非 2xx（429 限流/额度）→ used:false（不抛错）', async () => {
  const mod = await loadAdapter('KEY', async () => jsonResponse({}, false))
  const r = await mod.enrichFromProspeo({ domain: 'acme.com' })
  assert.equal(r.used, false)
})

test('search 无命中（results 为空）→ used:false', async () => {
  const mod = await loadAdapter('KEY', async () => jsonResponse({ error: false, results: [] }))
  const r = await mod.enrichFromProspeo({ domain: 'acme.com' })
  assert.equal(r.used, false)
})

test('enrich 未揭示邮箱（revealed:false）→ used:false', async () => {
  const mod = await loadAdapter('KEY', async (url) => {
    if (url.includes('search-person')) return SEARCH_OK
    return jsonResponse({
      error: false,
      person: { email: { status: 'VERIFIED', revealed: false }, mobile: { revealed: false } },
    })
  })
  const r = await mod.enrichFromProspeo({ domain: 'acme.com' })
  assert.equal(r.used, false)
})

test('网络异常（fetch 抛错）→ used:false（绝不抛错）', async () => {
  const mod = await loadAdapter('KEY', async () => {
    throw new Error('network down')
  })
  await assert.doesNotReject(async () => {
    const r = await mod.enrichFromProspeo({ domain: 'acme.com' })
    assert.equal(r.used, false)
  })
})

test('无有效域名 → used:false（不发起请求）', async () => {
  let called = 0
  const mod = await loadAdapter('KEY', async () => {
    called += 1
    return SEARCH_OK
  })
  const r = await mod.enrichFromProspeo({ domain: '' })
  assert.equal(r.used, false)
  assert.equal(called, 0)
})

test('决策者职位优先（Owner 排在普通职位之前）', async () => {
  let enrichedPersonId = ''
  const mod = await loadAdapter('KEY', async (url, init) => {
    if (url.includes('search-person')) {
      return jsonResponse({
        error: false,
        results: [
          {
            person: {
              person_id: 'plain',
              full_name: 'A Plain',
              current_job_title: 'Support',
              email: { status: 'VERIFIED' },
            },
          },
          {
            person: {
              person_id: 'owner',
              full_name: 'B Owner',
              current_job_title: 'Owner',
              email: { status: 'VERIFIED' },
            },
          },
        ],
      })
    }
    enrichedPersonId = JSON.parse(init.body).data.person_id
    return jsonResponse({
      error: false,
      person: { email: { status: 'VERIFIED', revealed: true, email: 'owner@acme.com' }, mobile: { revealed: false } },
    })
  })
  await mod.enrichFromProspeo({ domain: 'acme.com' })
  assert.equal(enrichedPersonId, 'owner', '应优先富化决策者职位的联系人')
})
