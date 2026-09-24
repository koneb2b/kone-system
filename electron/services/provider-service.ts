import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc } from '../ipc/registry'
import { providerListContract, providerStatusContract } from '../ipc/contracts/provider.contract'
import { createDefaultProviderRegistry } from './providers/index'
import type { ProviderConfig, ProviderRegistry } from './provider-registry'
import { ConfigStore, getGoogleConfig, SECRET_KEYS } from './config-service'
import { getSecret } from './secret-manager'

let registrySingleton: ProviderRegistry | null = null

export function getOrCreateProviderRegistry(): ProviderRegistry {
  if (!registrySingleton) {
    registrySingleton = createDefaultProviderRegistry()
  }
  return registrySingleton
}

function buildProviderConfig(store: ConfigStore): ProviderConfig {
  const { googleLeads } = getGoogleConfig(store)
  const googleKey = getSecret(googleLeads.secretKey).trim()
  const anysearchApiKey = getSecret(SECRET_KEYS.ANYSEARCH_API_KEY).trim()
  const anysearchBaseUrl = getSecret(SECRET_KEYS.ANYSEARCH_BASE_URL).trim()

  return {
    googleKey: googleKey || undefined,
    anysearchApiKey: anysearchApiKey || undefined,
    anysearchBaseUrl: anysearchBaseUrl || undefined,
  }
}

/**
 * PROVIDER 服务 handler 注册。
 *
 * 按 ARCH-STANDARDS §3 迁移注记，本服务作为首批经 `registerIpc()` 收敛到
 * 注册中心的批次：通道经由 `electron/ipc/registry.ts` 的 `attach(ipcMain)`
 * 在 `registerIpcHandlers()` 末尾统一绑定，契约在 dev 模式做请求/响应校验。
 * `ipcMain` 参数保留以维持 `main.ts` 调用签名一致，注册动作改由 registry 完成。
 */
export function registerProviderHandlers(_ipcMain: Electron.IpcMain, store: ConfigStore): void {
  const registry = getOrCreateProviderRegistry()

  registerIpc(IPC_CHANNELS.PROVIDER.LIST, providerListContract, async () => {
    const config = buildProviderConfig(store)
    return registry.getProviderStatusList(config)
  })

  registerIpc(IPC_CHANNELS.PROVIDER.STATUS, providerStatusContract, async (_event: unknown, id: unknown) => {
    const config = buildProviderConfig(store)
    const provider = registry.get(id as any)
    if (!provider) return null
    return {
      id: provider.id,
      name: provider.name,
      available: provider.isAvailable(config),
      requiredConfig: provider.requiredConfigKeys,
    }
  })
}
