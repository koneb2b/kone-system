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

    await safeFetch('https://serpapi.com/search.json?q=1')
    await safeFetch('https://serpapi.com/search.json?q=2')
    await safeFetch('https://serpapi.com/search.json?q=3')
    await safeFetch('https://serpapi.com/search.json?q=4')

    await assert.rejects(
      () => safeFetch('https://serpapi.com/search.json?q=5'),
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
