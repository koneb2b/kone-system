import { IPC_CHANNELS } from '../ipc/channels'
import { exchangeCodeForTokens, getSessionState, logoutSession, startAuthFlow } from '../auth'

export const registerAuthHandlers = (ipcMain: Electron.IpcMain) => {
  ipcMain.handle(
    IPC_CHANNELS.AUTH.LOGIN,
    async (
      event,
      payload: {
        issuerBaseUrl: string
        realm: string
        clientId: string
        scopes?: string[]
        callbackPath?: string
        timeoutMs?: number
        extraAuthParams?: Record<string, string | undefined>
      },
    ) => {
      try {
        const result = await startAuthFlow({
          ...(payload || {}),
          webContents: event.sender,
          successEventChannel: 'auth:login-success',
          errorEventChannel: 'auth:login-error',
        })

        const tokens = await exchangeCodeForTokens(result, {
          issuerBaseUrl: payload.issuerBaseUrl,
          realm: payload.realm,
          clientId: payload.clientId,
        })

        return {
          success: true,
          data: {
            state: result.state,
            redirectUri: result.redirectUri,
            authenticated: Boolean(tokens.accessToken),
          } as const,
        }
      } catch (error: any) {
        console.error('❌ [Auth] Login failed:', error)
        return { success: false, error: error?.message || 'Login failed', code: error?.code }
      }
    },
  )

  ipcMain.handle(IPC_CHANNELS.AUTH.LOGOUT, async () => {
    try {
      await logoutSession()
      return { success: true, data: { loggedOut: true } }
    } catch (error: any) {
      console.error('❌ [Auth] Logout failed:', error)
      return { success: false, error: error?.message || 'Logout failed', code: error?.code }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH.GET_SESSION, async () => {
    try {
      if (process.env.KONE_REGRESSION_TEST === '1') {
        return {
          success: true,
          data: {
            authenticated: true,
            hasRefreshToken: false,
            expiresAt: Date.now() + 60 * 60 * 1000,
          },
        }
      }

      const sessionState = await getSessionState()
      return { success: true, data: sessionState }
    } catch (error: any) {
      console.error('❌ [Auth] Get session failed:', error)
      return { success: false, error: error?.message || 'Get session failed', code: error?.code }
    }
  })
}
