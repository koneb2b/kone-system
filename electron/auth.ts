import { shell } from './services/electron-bridge'
import * as crypto from 'crypto'
import * as http from 'http'
import { clearSecret, getSecret, setSecret } from './services/secret-manager'

export type StoredTokens = {
  accessToken?: string
  refreshToken?: string
  idToken?: string
  tokenType?: string
  scope?: string
  expiresAt?: number
}

export type StartAuthFlowOptions = {
  issuerBaseUrl: string
  realm: string
  clientId: string
  scopes?: string[]
  callbackPath?: string
  timeoutMs?: number
  extraAuthParams?: Record<string, string | undefined>
  webContents?: Electron.WebContents
  successEventChannel?: string
  errorEventChannel?: string
}

export type AuthFlowResult = {
  code: string
  state: string
  redirectUri: string
  codeVerifier: string
}

export type SessionState = {
  authenticated: boolean
  hasRefreshToken: boolean
  expiresAt?: number
}

const TOKEN_SECRET_KEYS = {
  ACCESS_TOKEN: 'secrets.auth.accessToken',
  REFRESH_TOKEN: 'secrets.auth.refreshToken',
  ID_TOKEN: 'secrets.auth.idToken',
  TOKEN_META: 'secrets.auth.meta',
} as const

const SESSION_REFRESH_WINDOW_MS = 5 * 60 * 1000

const base64UrlEncode = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const sha256 = (input: string) => crypto.createHash('sha256').update(input).digest()

const getTokenEndpoint = (issuerBaseUrl: string, realm: string) => {
  const normalizedIssuer = String(issuerBaseUrl || '')
    .trim()
    .replace(/\/+$/g, '')
  return `${normalizedIssuer}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`
}

const getLogoutEndpoint = (issuerBaseUrl: string, realm: string) => {
  const normalizedIssuer = String(issuerBaseUrl || '')
    .trim()
    .replace(/\/+$/g, '')
  return `${normalizedIssuer}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/logout`
}

const setTokenMeta = (meta: {
  issuerBaseUrl: string
  realm: string
  clientId: string
  scope?: string
  tokenType?: string
  expiresAt?: number
}) => {
  setSecret(TOKEN_SECRET_KEYS.TOKEN_META, JSON.stringify(meta))
}

const getTokenMeta = () => {
  const raw = getSecret(TOKEN_SECRET_KEYS.TOKEN_META)
  if (!raw) return null
  try {
    return JSON.parse(raw) as {
      issuerBaseUrl: string
      realm: string
      clientId: string
      scope?: string
      tokenType?: string
      expiresAt?: number
    }
  } catch {
    return null
  }
}

export const saveTokens = (
  tokens: StoredTokens,
  context?: { issuerBaseUrl: string; realm: string; clientId: string },
) => {
  if (tokens.accessToken) setSecret(TOKEN_SECRET_KEYS.ACCESS_TOKEN, tokens.accessToken)
  if (tokens.refreshToken) setSecret(TOKEN_SECRET_KEYS.REFRESH_TOKEN, tokens.refreshToken)
  if (tokens.idToken) setSecret(TOKEN_SECRET_KEYS.ID_TOKEN, tokens.idToken)

  const previousMeta = getTokenMeta()
  if (context || previousMeta) {
    setTokenMeta({
      issuerBaseUrl: context?.issuerBaseUrl || previousMeta?.issuerBaseUrl || '',
      realm: context?.realm || previousMeta?.realm || '',
      clientId: context?.clientId || previousMeta?.clientId || '',
      scope: tokens.scope || previousMeta?.scope,
      tokenType: tokens.tokenType || previousMeta?.tokenType,
      expiresAt: tokens.expiresAt,
    })
  }
}

export const getTokens = (): StoredTokens | null => {
  const accessToken = getSecret(TOKEN_SECRET_KEYS.ACCESS_TOKEN)
  const refreshToken = getSecret(TOKEN_SECRET_KEYS.REFRESH_TOKEN)
  const idToken = getSecret(TOKEN_SECRET_KEYS.ID_TOKEN)
  const meta = getTokenMeta()

  if (!accessToken && !refreshToken && !idToken && !meta) return null

  return {
    accessToken: accessToken || undefined,
    refreshToken: refreshToken || undefined,
    idToken: idToken || undefined,
    tokenType: meta?.tokenType,
    scope: meta?.scope,
    expiresAt: meta?.expiresAt,
  }
}

export const clearTokens = () => {
  clearSecret(TOKEN_SECRET_KEYS.ACCESS_TOKEN)
  clearSecret(TOKEN_SECRET_KEYS.REFRESH_TOKEN)
  clearSecret(TOKEN_SECRET_KEYS.ID_TOKEN)
  clearSecret(TOKEN_SECRET_KEYS.TOKEN_META)
}

const exchangeTokenRequest = async (tokenEndpoint: string, body: URLSearchParams) => {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const raw = await response.text()
  let data: any
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error('Token 响应解析失败')
  }

  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || `Token HTTP ${response.status}`)
  }

  return data
}

export const exchangeCodeForTokens = async (
  authResult: AuthFlowResult,
  context: { issuerBaseUrl: string; realm: string; clientId: string },
) => {
  const tokenEndpoint = getTokenEndpoint(context.issuerBaseUrl, context.realm)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authResult.code,
    client_id: context.clientId,
    redirect_uri: authResult.redirectUri,
    code_verifier: authResult.codeVerifier,
  })

  const tokenData = await exchangeTokenRequest(tokenEndpoint, body)
  const tokens: StoredTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    idToken: tokenData.id_token,
    tokenType: tokenData.token_type,
    scope: tokenData.scope,
    expiresAt: Date.now() + Math.max(0, Number(tokenData.expires_in || 0)) * 1000,
  }

  saveTokens(tokens, context)
  return tokens
}

export const refreshAccessToken = async () => {
  const tokens = getTokens()
  const meta = getTokenMeta()
  if (!tokens?.refreshToken || !meta?.issuerBaseUrl || !meta?.realm || !meta?.clientId) {
    throw new Error('缺少刷新令牌或认证上下文')
  }

  const tokenEndpoint = getTokenEndpoint(meta.issuerBaseUrl, meta.realm)
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: meta.clientId,
  })

  const tokenData = await exchangeTokenRequest(tokenEndpoint, body)
  const nextTokens: StoredTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || tokens.refreshToken,
    idToken: tokenData.id_token || tokens.idToken,
    tokenType: tokenData.token_type || tokens.tokenType,
    scope: tokenData.scope || tokens.scope,
    expiresAt: Date.now() + Math.max(0, Number(tokenData.expires_in || 0)) * 1000,
  }

  saveTokens(nextTokens)
  return nextTokens
}

export const getValidAccessToken = async () => {
  const tokens = getTokens()
  if (!tokens?.accessToken) return null

  const expiresAt = tokens.expiresAt || 0
  const remainingMs = expiresAt - Date.now()
  if (remainingMs > SESSION_REFRESH_WINDOW_MS) {
    return tokens.accessToken
  }

  if (!tokens.refreshToken) {
    clearTokens()
    return null
  }

  try {
    const refreshed = await refreshAccessToken()
    return refreshed.accessToken || null
  } catch {
    clearTokens()
    return null
  }
}

export const getSessionState = async (): Promise<SessionState> => {
  const validAccessToken = await getValidAccessToken()
  const tokens = getTokens()
  return {
    authenticated: Boolean(validAccessToken),
    hasRefreshToken: Boolean(tokens?.refreshToken),
    expiresAt: tokens?.expiresAt,
  }
}

export const logoutSession = async () => {
  const meta = getTokenMeta()
  const tokens = getTokens()

  try {
    if (meta?.issuerBaseUrl && meta?.realm && tokens?.refreshToken) {
      const logoutEndpoint = getLogoutEndpoint(meta.issuerBaseUrl, meta.realm)
      const body = new URLSearchParams({
        client_id: meta.clientId,
        refresh_token: tokens.refreshToken,
      })
      await fetch(logoutEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }).catch(() => undefined)
    }
  } finally {
    clearTokens()
  }
}

export const startAuthFlow = (options: StartAuthFlowOptions): Promise<AuthFlowResult> => {
  const {
    issuerBaseUrl,
    realm,
    clientId,
    scopes = ['openid', 'profile', 'email', 'offline_access'],
    callbackPath = '/callback',
    timeoutMs = 5 * 60 * 1000,
    extraAuthParams = {},
    webContents,
    successEventChannel = 'auth:login-success',
    errorEventChannel = 'auth:login-error',
  } = options

  const normalizedIssuer = String(issuerBaseUrl || '')
    .trim()
    .replace(/\/+$/g, '')
  if (!normalizedIssuer) {
    return Promise.reject(new Error('认证服务地址未配置，请检查认证参数'))
  }
  const authEndpoint = `${normalizedIssuer}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/auth`

  const codeVerifier = base64UrlEncode(crypto.randomBytes(32))
  const codeChallenge = base64UrlEncode(sha256(codeVerifier))
  const state = base64UrlEncode(crypto.randomBytes(16))
  const nonce = base64UrlEncode(crypto.randomBytes(16))

  return new Promise<AuthFlowResult>((resolve, reject) => {
    let settled = false
    let serverPort = 0
    let redirectUri = ''

    const finish = (err: Error | null, result?: AuthFlowResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      try {
        server.close()
      } catch {
        // ignore
      }

      if (err) {
        webContents?.send(errorEventChannel, { success: false, error: err.message })
        reject(err)
      } else if (result) {
        webContents?.send(successEventChannel, { success: true, ...result })
        resolve(result)
      }
    }

    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${serverPort}`)

        if (requestUrl.pathname !== callbackPath) {
          res.writeHead(404)
          res.end('Not Found')
          return
        }

        const code = requestUrl.searchParams.get('code') || ''
        const returnedState = requestUrl.searchParams.get('state') || ''
        const error = requestUrl.searchParams.get('error')
        const errorDescription = requestUrl.searchParams.get('error_description')

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(
          '<!doctype html><html><head><meta charset="utf-8" /><title>Kone 登录</title></head><body style="font-family:sans-serif; text-align:center; padding-top:50px;"><h2>验证完成</h2><p>身份验证已成功处理，您可以关闭此窗口并返回应用。</p><script>setTimeout(() => window.close(), 3000);</script></body></html>',
        )

        if (error) {
          finish(new Error(`认证失败: ${error}${errorDescription ? ` (${errorDescription})` : ''}`))
          return
        }

        if (!code) {
          finish(new Error('未获取到 Authorization Code'))
          return
        }

        if (returnedState !== state) {
          finish(new Error('State 校验失败，请求可能已被篡改'))
          return
        }

        finish(null, { code, state, redirectUri, codeVerifier })
      } catch (e: any) {
        finish(new Error(e?.message || '处理回调时发生未知错误'))
      }
    })

    server.on('error', (err) => finish(err))

    server.listen(0, '127.0.0.1', () => {
      try {
        const addr = server.address()
        if (!addr || typeof addr === 'string') {
          finish(new Error('无法绑定本地回调服务器'))
          return
        }

        serverPort = addr.port
        redirectUri = `http://127.0.0.1:${serverPort}${callbackPath}`

        const u = new URL(authEndpoint)
        u.searchParams.set('client_id', clientId)
        u.searchParams.set('response_type', 'code')
        u.searchParams.set('redirect_uri', redirectUri)
        u.searchParams.set('scope', scopes.join(' '))
        u.searchParams.set('state', state)
        u.searchParams.set('nonce', nonce)
        u.searchParams.set('code_challenge', codeChallenge)
        u.searchParams.set('code_challenge_method', 'S256')

        for (const [k, v] of Object.entries(extraAuthParams)) {
          if (v !== undefined) u.searchParams.set(k, v)
        }

        void shell.openExternal(u.toString())
      } catch (e: any) {
        finish(new Error(e?.message || '构造认证请求失败，请检查认证服务地址配置'))
      }
    })

    const timer = setTimeout(() => {
      finish(new Error('认证流程超时，请重新尝试'))
    }, timeoutMs)
  })
}
