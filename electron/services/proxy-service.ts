import { IPC_CHANNELS } from '../ipc/channels'
import { isCircuitBreakerOpenError, safeFetch } from '../utils/http-client'
import {
  ConfigStore,
  DEFAULT_SEARCH_TIMEOUT_MS,
  getN8nConfig,
  getProviderSecretKey,
  getPublicUserConfig,
  getUserLlmApiKey,
  SECRET_KEYS,
  shouldAllowN8nPush,
} from './config-service'
import { registerSecureFeatureIpc, registerSecureIpc } from './license-service'
import { getSecret } from './secret-manager'

const ALLOWED_PROXY_METHODS = new Set(['GET', 'POST', 'HEAD'])
const ALLOWED_PROXY_HEADERS = new Set(['content-type', 'accept'])
const MAX_PROXY_BODY_BYTES = 64 * 1024
const DEFAULT_SERPAPI_TIMEOUT_MS = 30000

const sanitizeProxyHeaders = (headers?: Record<string, string>) => {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers || {})) {
    const normalizedKey = key.trim().toLowerCase()
    if (!ALLOWED_PROXY_HEADERS.has(normalizedKey)) continue
    next[normalizedKey] = String(value || '').slice(0, 512)
  }
  return next
}

const normalizeProxyBody = (body?: unknown) => {
  if (body === undefined) return undefined
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  if (Buffer.byteLength(raw, 'utf8') > MAX_PROXY_BODY_BYTES) {
    throw new Error('Proxy body too large')
  }
  return raw
}

export const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await safeFetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

export const isTimeoutError = (error: any) =>
  error?.name === 'AbortError' ||
  String(error?.message || '')
    .toLowerCase()
    .includes('timeout')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const getDefaultSerpApiTimeoutMs = (timeoutMs?: number) =>
  Math.max(DEFAULT_SERPAPI_TIMEOUT_MS, Number(timeoutMs) || 0)

type FetchRetryOptions = {
  retries?: number
  retryDelayMs?: number
  shouldRetry?: (response: Response | null, error: unknown, attempt: number) => boolean
}

export const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  timeoutMs: number,
  retryOptions: FetchRetryOptions = {},
) => {
  const { retries = 0, retryDelayMs = 800, shouldRetry } = retryOptions
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs)
      const retryable = shouldRetry ? shouldRetry(response, null, attempt) : false
      if (!retryable || attempt === retries) {
        return response
      }
    } catch (error) {
      lastError = error
      const retryable = shouldRetry ? shouldRetry(null, error, attempt) : false
      if (!retryable || attempt === retries) {
        throw error
      }
    }

    await sleep(retryDelayMs * (attempt + 1))
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed after retries')
}

export const buildSearchEndpoint = (baseUrl: string) => {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/search')) return trimmed
  return `${trimmed}/search`
}

export const buildLlmEndpoint = (baseUrl: string) => {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1/chat/completions')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

export const buildModelsEndpoint = (baseUrl: string) => {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1/models')) return trimmed
  if (trimmed.endsWith('/models')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/models`
  return `${trimmed.replace(/\/chat\/completions$/, '')}/v1/models`
}

export const registerProxyHandlers = (
  ipcMain: Electron.IpcMain,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  store?: ConfigStore,
) => {
  registerSecureIpc(
    ipcMain,
    IPC_CHANNELS.CONFIG.FETCH_MODELS,
    store,
    licenseGuard,
    async (_event, config: { apiKey: string; baseUrl: string }) => {
      try {
        const apiKey = config?.apiKey?.trim() || (store ? getUserLlmApiKey(store) : '')
        const baseUrl = config?.baseUrl?.trim()
        if (!apiKey || !baseUrl) {
          return { success: false, error: 'Missing apiKey or baseUrl' }
        }

        const response = await safeFetch(buildModelsEndpoint(baseUrl), {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data: any = await response.json()
        const models = Array.isArray(data?.data) ? data.data.map((m: any) => m.id).filter(Boolean) : []
        return { success: true, data: { models } }
      } catch (error: any) {
        if (isCircuitBreakerOpenError(error)) {
          return { success: false, error: '服务暂不可用，已触发系统保护，请稍后再试', code: error?.status }
        }
        return { success: false, error: error?.message || 'Fetch models failed' }
      }
    },
  )

  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.SEARCH.API_PROXY,
    store,
    licenseGuard,
    'cloud_send',
    async (
      _event,
      payload: { url: string; method?: string; headers?: Record<string, string>; body?: any; timeoutMs?: number },
    ) => {
      try {
        const { url, method = 'GET', headers = {}, body, timeoutMs = 12000 } = payload || {}
        if (!url) throw new Error('Missing url')

        const normalizedMethod = String(method || 'GET')
          .trim()
          .toUpperCase()
        if (!ALLOWED_PROXY_METHODS.has(normalizedMethod)) {
          throw new Error(`Proxy method not allowed: ${normalizedMethod}`)
        }

        const parsed = new URL(url)
        if (parsed.protocol !== 'https:') {
          throw new Error('Proxy only allows https')
        }
        if (parsed.username || parsed.password) {
          throw new Error('Proxy credentials are not allowed in URL')
        }

        const hostname = parsed.hostname.toLowerCase()
        const allowedRoots = ['serpapi.com', 'api.openai.com']
        const n8nConfig = store
          ? getN8nConfig(store)
          : { webhookUrl: '', autoPush: false, minScore: 60, roleFilter: '' }
        const configuredWebhook = n8nConfig.webhookUrl
        let configuredHostname = ''
        if (configuredWebhook) {
          try {
            const webhookUrl = new URL(configuredWebhook)
            if (webhookUrl.protocol !== 'https:') {
              throw new Error('Configured webhook must use https')
            }
            configuredHostname = webhookUrl.hostname.toLowerCase()
          } catch {
            throw new Error('Configured webhook URL is invalid')
          }
        }
        const allowed =
          allowedRoots.some((root) => hostname === root || hostname.endsWith(`.${root}`)) ||
          Boolean(configuredHostname && hostname === configuredHostname)
        if (!allowed) {
          throw new Error(`Proxy target not allowed: ${hostname}`)
        }

        if (store && configuredHostname && hostname === configuredHostname && normalizedMethod === 'POST') {
          const normalizedBody =
            body && typeof body === 'object' ? (body as { matchScore?: number; inferredRole?: string }) : undefined
          const routeDecision = shouldAllowN8nPush(n8nConfig, {
            matchScore: normalizedBody?.matchScore,
            inferredRole: normalizedBody?.inferredRole,
          })

          if (!routeDecision.allowed) {
            return { success: true, data: { status: 202, data: { skipped: true, reason: routeDecision.reason } } }
          }
        }

        const isSerpApi = /(^|\.)serpapi\.com$/i.test(hostname)
        const requestOptions = {
          method: normalizedMethod,
          headers: sanitizeProxyHeaders(headers),
          body: normalizeProxyBody(body),
        }
        const response = isSerpApi
          ? await fetchWithRetry(parsed.toString(), requestOptions, getDefaultSerpApiTimeoutMs(timeoutMs), {
              retries: 2,
              shouldRetry: (retryResponse, retryError) => {
                if (retryError) return true
                return Boolean(retryResponse && [408, 425, 429, 500, 502, 503, 504].includes(retryResponse.status))
              },
            })
          : await fetchWithTimeout(parsed.toString(), requestOptions, timeoutMs)

        const contentType = response.headers.get('content-type') || ''
        const data = contentType.includes('application/json') ? await response.json() : await response.text()
        return { success: response.ok, data: { status: response.status, data } }
      } catch (error: any) {
        if (isCircuitBreakerOpenError(error)) {
          return { success: false, error: '服务暂不可用，已触发系统保护，请稍后再试', code: error?.status }
        }
        return { success: false, error: error?.message || 'Proxy request failed', code: error?.code }
      }
    },
    '云端代理请求',
  )

  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.SEARCH.API_TEST_CONNECTION,
    store,
    licenseGuard,
    (_event, payload: { provider?: string }) => (payload?.provider === 'llm' ? 'analysis_basic' : 'search_basic'),
    async (_event, payload: { provider?: string; key?: string; baseUrl?: string }) => {
      try {
        const provider = payload?.provider || ''

        // LLM provider: 优先从 payload 获取，fallback 到用户本地持久化配置（物理隔离）
        const key =
          provider === 'llm'
            ? payload?.key?.trim() || (store ? getUserLlmApiKey(store) : '')
            : payload?.key?.trim() || getSecret(getProviderSecretKey(provider)).trim()
        const baseUrl = payload?.baseUrl?.trim()
        if (!key || !baseUrl) {
          return { success: false, error: 'Missing API key or base URL' }
        }

        if (provider === 'llm') {
          const response = await fetchWithTimeout(
            buildModelsEndpoint(baseUrl),
            { method: 'GET', headers: { Authorization: `Bearer ${key}` } },
            DEFAULT_SEARCH_TIMEOUT_MS,
          )
          if (!response.ok) return { success: false, error: `LLM HTTP ${response.status}` }
          return { success: true, data: {} }
        }

        if (provider === 'google-leads') {
          const isSerpApi = /serpapi\.com/i.test(baseUrl)
          const url = /serpapi\.com/i.test(baseUrl)
            ? `https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`
            : buildSearchEndpoint(baseUrl)
          const response = isSerpApi
            ? await fetchWithRetry(url, { method: 'GET' }, Math.max(DEFAULT_SEARCH_TIMEOUT_MS, 30000), {
                retries: 2,
                shouldRetry: (retryResponse, retryError) => {
                  if (retryError) return true
                  return Boolean(retryResponse && [408, 425, 429, 500, 502, 503, 504].includes(retryResponse.status))
                },
              })
            : await fetchWithTimeout(
                url,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                  body: JSON.stringify({ ping: true }),
                },
                DEFAULT_SEARCH_TIMEOUT_MS,
              )
          if (!response.ok) return { success: false, error: `Search HTTP ${response.status}` }

          if (isSerpApi) {
            const body: any = await response.json().catch(() => null)
            if (!body || typeof body !== 'object') {
              throw new Error('SerpApi account validation returned an invalid JSON payload')
            }

            const semanticError = typeof body?.error === 'string' ? body.error.trim() : ''
            const hasExpectedAccountFields = Boolean(
              body?.account_id || body?.total_searches_left !== undefined || body?.plan_searches_left !== undefined,
            )

            if (semanticError) {
              throw new Error(semanticError)
            }

            if (!hasExpectedAccountFields) {
              throw new Error('SerpApi account validation failed: missing expected account fields')
            }
          }

          return { success: true, data: {} }
        }

        return { success: true, data: {} }
      } catch (error: any) {
        if (isCircuitBreakerOpenError(error)) {
          return { success: false, error: '服务暂不可用，已触发系统保护，请稍后再试', code: error?.status }
        }
        return { success: false, error: error?.message || 'Test connection failed' }
      }
    },
    (_event, payload: { provider?: string }) =>
      payload?.provider === 'llm' ? '智能分析连接测试' : '海外客户搜索连接测试',
  )
}
