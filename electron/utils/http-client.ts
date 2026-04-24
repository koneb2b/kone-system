const FAILURE_STATUSES = new Set([400, 401, 403, 429])
const FAILURE_THRESHOLD = 3
const CIRCUIT_OPEN_MS = 60_000

type CircuitState = {
  consecutiveFailures: number
  openUntil: number
}

type SafeFetchError = Error & {
  code?: string
  status?: number
}

const circuitStates = new Map<string, CircuitState>()

const normalizeHost = (url: string) => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return '__unknown__'
  }
}

const getCircuitState = (host: string): CircuitState => {
  const existing = circuitStates.get(host)
  if (existing) {
    return existing
  }

  const nextState: CircuitState = {
    consecutiveFailures: 0,
    openUntil: 0,
  }
  circuitStates.set(host, nextState)
  return nextState
}

const createCircuitBreakerError = (host: string) => {
  const error = new Error(`服务暂不可用，已触发系统保护，请稍后再试 (${host})`) as SafeFetchError
  error.code = 'CIRCUIT_BREAKER_OPEN'
  error.status = 503
  return error
}

const isCircuitOpen = (host: string) => getCircuitState(host).openUntil > Date.now()

export const resetCircuitBreaker = (host?: string) => {
  if (!host) {
    circuitStates.clear()
    return
  }

  circuitStates.delete(host.trim().toLowerCase())
}

const redactUrl = (url: string): string => {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}?[REDACTED]`
  } catch {
    return '[INVALID_URL]'
  }
}

const recordProtectedFailure = (host: string, url: string, status: number) => {
  const circuitState = getCircuitState(host)
  circuitState.consecutiveFailures += 1
  if (circuitState.consecutiveFailures > FAILURE_THRESHOLD) {
    circuitState.openUntil = Date.now() + CIRCUIT_OPEN_MS
    console.warn(`[HTTP] Circuit opened | host=${host} | status=${status} | failures=${circuitState.consecutiveFailures} | url=${redactUrl(url)}`)
  }
}

const recordSuccess = (host: string) => {
  const circuitState = getCircuitState(host)
  circuitState.consecutiveFailures = 0
  circuitState.openUntil = 0
}

export const safeFetch = async (url: string, options?: RequestInit) => {
  const host = normalizeHost(url)

  if (isCircuitOpen(host)) {
    throw createCircuitBreakerError(host)
  }

  const response = await fetch(url, options)

  if (FAILURE_STATUSES.has(response.status)) {
    recordProtectedFailure(host, url, response.status)
  } else if (response.ok) {
    recordSuccess(host)
  }

  return response
}

export const isCircuitBreakerOpenError = (error: unknown) =>
  (error as SafeFetchError | undefined)?.code === 'CIRCUIT_BREAKER_OPEN'
