import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc, registry } from '../ipc/registry'
import { authLoginContract, authLogoutContract, authGetSessionContract } from '../ipc/contracts/auth.contract'
import { exchangeCodeForTokens, getSessionState, logoutSession, startAuthFlow } from '../auth'

/**
 * 第三批 registry 迁移：AUTH.LOGIN / AUTH.LOGOUT / AUTH.GET_SESSION 三个无授权
 * 包装的 plain 通道经 `registerIpc()` 收敛到注册中心，由 `registry.attach(ipcMain)`
 * 统一绑定（见函数末尾自绑定）。契约在 dev 模式做响应信封校验，production 跳过。
 */
export const registerAuthHandlers = (ipcMain: Electron.IpcMain) => {
  registerIpc(IPC_CHANNELS.AUTH.LOGIN, authLoginContract, async (event: unknown, payload: unknown) => {
    try {
      // registerIpc 的 handler 签名统一为 (event: unknown, ...args: unknown[])，
      // 与 strictFunctionTypes 兼容的写法是先收 unknown 再显式收窄：
      // LOGIN 需要 event.sender（webContents）驱动授权窗口。
      const invokeEvent = event as Electron.IpcMainInvokeEvent
      const p = (payload || {}) as {
        issuerBaseUrl: string
        realm: string
        clientId: string
        scopes?: string[]
        callbackPath?: string
        timeoutMs?: number
        extraAuthParams?: Record<string, string | undefined>
      }
      const result = await startAuthFlow({
        ...p,
        webContents: invokeEvent.sender,
        successEventChannel: 'auth:login-success',
        errorEventChannel: 'auth:login-error',
      })

      const tokens = await exchangeCodeForTokens(result, {
        issuerBaseUrl: p.issuerBaseUrl,
        realm: p.realm,
        clientId: p.clientId,
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
      console.error(' [Auth] Login failed:', error)
      return { success: false, error: error?.message || 'Login failed', code: error?.code }
    }
  })

  registerIpc(IPC_CHANNELS.AUTH.LOGOUT, authLogoutContract, async () => {
    try {
      await logoutSession()
      return { success: true, data: { loggedOut: true } }
    } catch (error: any) {
      console.error(' [Auth] Logout failed:', error)
      return { success: false, error: error?.message || 'Logout failed', code: error?.code }
    }
  })

  registerIpc(IPC_CHANNELS.AUTH.GET_SESSION, authGetSessionContract, async () => {
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
      console.error(' [Auth] Get session failed:', error)
      return { success: false, error: error?.message || 'Get session failed', code: error?.code }
    }
  })

  /* 自绑定兼容层（与 agent-service / autopilot-state-service 同构）：历史 e2e /
     独立测试直接调用本函数而未显式 attach，迁移后 3 个 plain 通道需落到 ipcMain
     才能被 getHandler 取到。attach 按 ipcMain 实例幂等，主进程末尾的 attach 不重复绑定。 */
  registry.attach(ipcMain)
}
