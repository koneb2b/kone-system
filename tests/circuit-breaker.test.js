/* global URL */
const test = require('node:test')
const assert = require('node:assert/strict')

const { safeFetch, resetCircuitBreaker } = require('../dist-electron/electron/utils/http-client.js')

const createResponse = (status, body = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  async json() {
    return body
  },
  async text() {
    return JSON.stringify(body)
  },
})

test('should isolate circuit breakers by host', async () => {
  resetCircuitBreaker()

  const originalFetch = global.fetch
  const serpResponses = [429, 429, 429, 429]
  try {
    global.fetch = async (url) => {
      const host = new URL(String(url)).host
      if (host === 'serpapi.com') {
        const nextStatus = serpResponses.shift()
        return createResponse(nextStatus || 429, { source: 'serpapi' })
      }

      if (host === 'api.openai.com') {
        return createResponse(200, { source: 'openai', ok: true })
      }

      throw new Error(`Unexpected host: ${host}`)
    }

    /* 宪法（kone-PRD §0.3）：连续 3 次失败即断开。故前 3 次正常返回 429，第 4 次被熔断拒绝。 */
    await safeFetch('https://serpapi.com/search.json?q=1')
    await safeFetch('https://serpapi.com/search.json?q=2')
    await safeFetch('https://serpapi.com/search.json?q=3')

    await assert.rejects(
      () => safeFetch('https://serpapi.com/search.json?q=4'),
      (error) => {
        assert.equal(error.code, 'CIRCUIT_BREAKER_OPEN')
        return true
      },
    )

    const openAiResponse = await safeFetch('https://api.openai.com/v1/chat/completions')
    assert.equal(openAiResponse.status, 200)
    assert.deepEqual(await openAiResponse.json(), { source: 'openai', ok: true })
  } finally {
    global.fetch = originalFetch
    resetCircuitBreaker()
  }
})

test('宪法阈值边界：连续 2 次失败不得断开，第 3 次才断开', async () => {
  resetCircuitBreaker()

  const originalFetch = global.fetch
  let calls = 0
  try {
    global.fetch = async () => {
      calls += 1
      return createResponse(429, {})
    }

    await safeFetch('https://threshold.example.com/a') // 失败 1
    await safeFetch('https://threshold.example.com/b') // 失败 2 —— 尚未达阈值
    await safeFetch('https://threshold.example.com/c') // 失败 3 —— 达到阈值，熔断打开
    assert.equal(calls, 3, '前 3 次均应真实发起请求（2 次失败不应提前断开）')

    await assert.rejects(
      () => safeFetch('https://threshold.example.com/d'),
      (error) => {
        assert.equal(error.code, 'CIRCUIT_BREAKER_OPEN')
        return true
      },
    )
    assert.equal(calls, 3, '熔断后不得再发起真实请求')
  } finally {
    global.fetch = originalFetch
    resetCircuitBreaker()
  }
})
