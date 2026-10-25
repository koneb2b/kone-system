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

/* kone-PRD §0.3「HTTP 熔断」：暂时性失败 = 429 / 5xx / 网络异常；
   400/401/403 属确定性配置错误，必须 fail-fast 且不计入开路。 */
test('5xx 属暂时性失败，连续 3 次即熔断', async () => {
  resetCircuitBreaker()
  const originalFetch = global.fetch
  let calls = 0
  try {
    global.fetch = async () => {
      calls += 1
      return createResponse(503, {})
    }

    await safeFetch('https://fivexx.example.com/a')
    await safeFetch('https://fivexx.example.com/b')
    await safeFetch('https://fivexx.example.com/c')

    await assert.rejects(
      () => safeFetch('https://fivexx.example.com/d'),
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

test('400/401/403 属确定性配置错误，连续多次也不得熔断', async () => {
  resetCircuitBreaker()
  const originalFetch = global.fetch
  let calls = 0
  try {
    global.fetch = async () => {
      calls += 1
      return calls <= 3 ? createResponse(401, {}) : createResponse(200, { ok: true })
    }

    await safeFetch('https://auth-err.example.com/a')
    await safeFetch('https://auth-err.example.com/b')
    await safeFetch('https://auth-err.example.com/c')

    const okResponse = await safeFetch('https://auth-err.example.com/d')
    assert.equal(okResponse.status, 200, '401 不应累计失败次数')
    assert.equal(calls, 4)
  } finally {
    global.fetch = originalFetch
    resetCircuitBreaker()
  }
})

test('网络异常属暂时性失败，连续 3 次即熔断', async () => {
  resetCircuitBreaker()
  const originalFetch = global.fetch
  let calls = 0
  try {
    global.fetch = async () => {
      calls += 1
      throw new Error('ECONNREFUSED')
    }

    await assert.rejects(() => safeFetch('https://offline.example.com/a'), /ECONNREFUSED/)
    await assert.rejects(() => safeFetch('https://offline.example.com/b'), /ECONNREFUSED/)
    await assert.rejects(() => safeFetch('https://offline.example.com/c'), /ECONNREFUSED/)

    await assert.rejects(
      () => safeFetch('https://offline.example.com/d'),
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

test('请求超时属暂时性失败，连续 3 次即熔断', async () => {
  resetCircuitBreaker()
  const originalFetch = global.fetch
  let calls = 0
  try {
    global.fetch = async (_url, options) => {
      calls += 1
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }

    await assert.rejects(() => safeFetch('https://slow.example.com/a', {}, 5), /请求超时/)
    await assert.rejects(() => safeFetch('https://slow.example.com/b', {}, 5), /请求超时/)
    await assert.rejects(() => safeFetch('https://slow.example.com/c', {}, 5), /请求超时/)

    await assert.rejects(
      () => safeFetch('https://slow.example.com/d', {}, 5),
      (error) => {
        assert.equal(error.code, 'CIRCUIT_BREAKER_OPEN')
        return true
      },
    )
    assert.equal(calls, 3)
  } finally {
    global.fetch = originalFetch
    resetCircuitBreaker()
  }
})

test('调用方主动取消不是上游健康信号，不得计入熔断', async () => {
  resetCircuitBreaker()
  const originalFetch = global.fetch
  let calls = 0
  try {
    global.fetch = async (_url, options) => {
      calls += 1
      if (options.signal.aborted) throw new Error('cancelled')
      return createResponse(200, {})
    }

    for (let i = 0; i < 4; i += 1) {
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(() => safeFetch('https://cancel.example.com/x', { signal: controller.signal }))
    }
    assert.equal(calls, 4, '主动取消不应触发熔断，每次都应真实发起请求')
  } finally {
    global.fetch = originalFetch
    resetCircuitBreaker()
  }
})
