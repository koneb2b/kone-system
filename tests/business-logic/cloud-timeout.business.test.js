const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// P0-6 回归防护：云端与 webhook 全链路超时。
//
// 缺陷背景：supabase-service 的 9 处 await client.from(...) 与 automation-service 的
// safeFetch(webhookUrl, ...) 均无超时，网络挂起即永久 pending，UI 无法收敛到错误态。
// 修复方式：safeFetch 内置默认超时；Supabase 通过注入 global.fetch 一次性覆盖全部调用点。

const { safeFetch, resetCircuitBreaker, DEFAULT_FETCH_TIMEOUT_MS } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'utils', 'http-client.js'),
)

test('P0-6: safeFetch 在网络挂起时按超时失败，不永久 pending', async () => {
  const originalFetch = globalThis.fetch
  // 模拟"连接已建立但永不返回"的挂起请求，仅在 abort 时拒绝
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
    })

  try {
    const startedAt = Date.now()
    await assert.rejects(
      () => safeFetch('https://slow.example.com/webhook', undefined, 150),
      /请求超时/,
      '超时必须转成可读错误向上抛出',
    )
    const elapsed = Date.now() - startedAt
    assert.ok(elapsed < 5000, `必须在超时窗口内失败，实际 ${elapsed}ms`)
  } finally {
    globalThis.fetch = originalFetch
    resetCircuitBreaker()
  }
})

test('P0-6: 正常响应不受超时包装影响', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"ok":true}', { status: 200 })

  try {
    const res = await safeFetch('https://ok.example.com/api', undefined, 500)
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '{"ok":true}')
  } finally {
    globalThis.fetch = originalFetch
    resetCircuitBreaker()
  }
})

test('P0-6: 默认超时常量为有限正值', () => {
  assert.ok(Number.isFinite(DEFAULT_FETCH_TIMEOUT_MS))
  assert.ok(DEFAULT_FETCH_TIMEOUT_MS > 0 && DEFAULT_FETCH_TIMEOUT_MS <= 60_000)
})

test('P0-6: Supabase 客户端注入带超时的 fetch', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'electron', 'services', 'supabase-service.ts'),
    'utf8',
  )
  assert.match(source, /global:\s*\{\s*fetch:/, 'createClient 必须注入 global.fetch 以覆盖全部调用点')
  assert.match(source, /AbortController/, '必须使用 AbortController 实现超时')
  assert.match(source, /setTimeout\(\(\)\s*=>\s*controller\.abort\(\)/, '必须在超时后主动 abort')
})
