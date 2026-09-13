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

// Provider 配置链路错误中文化：把底层 HTTP/网络异常映射为可操作的中文指引。
// context: models=识别模型, connection=测试连接
const NETWORK_FAILURE_PATTERN = /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout|aborted|socket|network/i

const translateProviderError = (error: unknown): { error: string; code?: number } => {
  if (isCircuitBreakerOpenError(error)) {
    return { error: '服务暂不可用，已触发系统保护，请稍后再试', code: (error as any)?.status }
  }
  const raw = String((error as any)?.message || error || '')
  const statusMatch = raw.match(/HTTP\s+(\d{3})/i)
  const status = statusMatch ? Number(statusMatch[1]) : Number((error as any)?.status) || 0
  if (status === 401 || status === 403) {
    return { error: '密钥无效或未授权：请核对 API Key 是否填写正确、是否具备该服务权限' }
  }
  if (status === 404) {
    return { error: '校验地址不存在（404）：请确认 Base URL 是否正确，模型类地址通常以 /v1 结尾' }
  }
  if (status === 429) {
    return { error: '调用额度受限（429）：请前往服务商平台确认余额或稍后再试' }
  }
  if (status >= 500) {
    return { error: `服务商暂时拥堵或异常（${status}）：请稍后再试` }
  }
  if (status) {
    return { error: `服务返回异常状态（${status}）：请核对 Base URL 与密钥配置` }
  }
  if (NETWORK_FAILURE_PATTERN.test(raw)) {
    return { error: '无法访问该地址：请检查 Base URL 拼写、本机网络与代理设置；海外直连地址需网络可达' }
  }
  return { error: raw || '请求失败，请稍后再试' }
}

// SerpApi 账号校验（测试连接）：account.json 语义校验，供谷歌获客/谷歌地图共用
const validateSerpApiAccount = async (apiKey: string) => {
  const response = await fetchWithRetry(
    `https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`,
    { method: 'GET' },
    Math.max(DEFAULT_SEARCH_TIMEOUT_MS, 30000),
    {
      retries: 2,
      shouldRetry: (retryResponse, retryError) => {
        if (retryError) return true
        return Boolean(retryResponse && [408, 425, 429, 500, 502, 503, 504].includes(retryResponse.status))
      },
    },
  )
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const body: any = await response.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw new Error('SerpApi account validation returned an invalid JSON payload')
  }
  const semanticError = typeof body?.error === 'string' ? body.error.trim() : ''
  if (semanticError) {
    throw new Error(semanticError)
  }
  const hasExpectedAccountFields = Boolean(
    body?.account_id || body?.total_searches_left !== undefined || body?.plan_searches_left !== undefined,
  )
  if (!hasExpectedAccountFields) {
    throw new Error('SerpApi account validation failed: missing expected account fields')
  }
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
          return { success: false, error: '缺少 API Key 或 Base URL：请先填写并保存密钥，再填写 Base URL 后识别' }
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
        return { success: false, ...translateProviderError(error) }
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
          return { success: false, error: '缺少 API Key 或 Base URL：请先填写密钥并保存，再填写 Base URL' }
        }

        if (provider === 'llm') {
          const response = await fetchWithTimeout(
            buildModelsEndpoint(baseUrl),
            { method: 'GET', headers: { Authorization: `Bearer ${key}` } },
            DEFAULT_SEARCH_TIMEOUT_MS,
          )
          if (!response.ok) return { success: false, ...translateProviderError(new Error(`HTTP ${response.status}`)) }
          return { success: true, data: {} }
        }

        if (provider === 'google-leads') {
          const isSerpApi = /serpapi\.com/i.test(baseUrl)
          if (isSerpApi) {
            await validateSerpApiAccount(key)
            return { success: true, data: {} }
          }
          const response = await fetchWithTimeout(
            buildSearchEndpoint(baseUrl),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
              body: JSON.stringify({ ping: true }),
            },
            DEFAULT_SEARCH_TIMEOUT_MS,
          )
          if (!response.ok) return { success: false, ...translateProviderError(new Error(`HTTP ${response.status}`)) }
          return { success: true, data: {} }
        }

        if (provider === 'google-maps') {
          // 谷歌地图与获客引擎共用 SerpApi 账号体系，此前该分支无条件返回成功（假连通）
          await validateSerpApiAccount(key)
          return { success: true, data: {} }
        }

        if (provider === 'anysearch') {
          // AnySearch 校验端点以服务商定义为准：网络可达且密钥未被明确拒绝即视为连通
          const pingUrl = `${baseUrl.replace(/\/+$/, '')}/`
          const response = await fetchWithTimeout(
            pingUrl,
            { method: 'GET', headers: { Authorization: `Bearer ${key}` } },
            DEFAULT_SEARCH_TIMEOUT_MS,
          )
          if (response.status === 401 || response.status === 403) {
            return { success: false, ...translateProviderError(new Error(`HTTP ${response.status}`)) }
          }
          return { success: true, data: {} }
        }

        return { success: true, data: {} }
      } catch (error: any) {
        const raw = String(error?.message || '')
        if (raw.includes('SerpApi')) {
          return { success: false, error: `SerpApi 校验失败：${raw}` }
        }
        return { success: false, ...translateProviderError(error) }
      }
    },
    (_event, payload: { provider?: string }) =>
      payload?.provider === 'llm' ? '智能分析连接测试' : '海外客户搜索连接测试',
  )
}
