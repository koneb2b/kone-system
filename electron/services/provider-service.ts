import { IPC_CHANNELS } from '../ipc/channels'
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

export function registerProviderHandlers(ipcMain: Electron.IpcMain, store: ConfigStore): void {
  const registry = getOrCreateProviderRegistry()

  ipcMain.handle(IPC_CHANNELS.PROVIDER.LIST, () => {
    const config = buildProviderConfig(store)
    return registry.getProviderStatusList(config)
  })

  ipcMain.handle(IPC_CHANNELS.PROVIDER.STATUS, (_event, id: string) => {
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
