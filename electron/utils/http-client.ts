// 熔断只针对暂时性失败（额度受限/服务端异常）。
// 400/401/403 属确定性配置错误（密钥无效等），计入熔断会让用户在反复
// 输错密钥后整体锁死该服务地址 60 秒，与"4xx 配置错误不熔断"的成本
// 保护设计冲突；429 保留——连续限流说明该 host 确实不可持续调用。
const FAILURE_STATUSES = new Set([429])
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
    console.warn(
      `[HTTP] Circuit opened | host=${host} | status=${status} | failures=${circuitState.consecutiveFailures} | url=${redactUrl(url)}`,
    )
  }
}

const recordSuccess = (host: string) => {
  const circuitState = getCircuitState(host)
  circuitState.consecutiveFailures = 0
  circuitState.openUntil = 0
}

/* P0-6：safeFetch 原先不设超时，网络挂起即永久 pending（webhook 推送、
   云端协同等调用点会一直卡住，UI 无法收敛到错误态）。此处统一加默认超时。 */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000

const combineSignals = (upstream: AbortSignal | null | undefined, fallback: AbortSignal): AbortSignal => {
  if (!upstream) return fallback
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  return typeof anyFn === 'function' ? anyFn([upstream, fallback]) : fallback
}

export const safeFetch = async (url: string, options?: RequestInit, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) => {
  const host = normalizeHost(url)

  if (isCircuitOpen(host)) {
    throw createCircuitBreakerError(host)
  }

  const controller = new AbortController()
  /* 注意：请求超时定时器**不得** unref()。unref 会让事件循环认为无待处理工作，
     在没有其他句柄时提前退出，导致超时永不触发（表现为永久 pending）。
     长驻内务定时器（防抖落盘、跟进调度）才应 unref。 */
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, { ...(options || {}), signal: combineSignals(options?.signal, controller.signal) })
  } catch (error) {
    if (controller.signal.aborted) {
      /* preserve-caught-error：把原始异常挂到 cause，便于排查底层网络原因 */
      throw new Error(`请求超时（${timeoutMs}ms）：${host}`, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }

  if (FAILURE_STATUSES.has(response.status)) {
    recordProtectedFailure(host, url, response.status)
  } else if (response.ok) {
    recordSuccess(host)
  }

  return response
}

export const isCircuitBreakerOpenError = (error: unknown) =>
  (error as SafeFetchError | undefined)?.code === 'CIRCUIT_BREAKER_OPEN'
