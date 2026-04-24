import type { AutopilotStateEnvelope } from '@/shared/ipc-contracts'
import { autopilotClearLegacy, autopilotStateGet, autopilotStateSet } from '@/lib/electron-api'

export const getAutopilotConfig = async <T = unknown>(): Promise<AutopilotStateEnvelope<T>> => {
  return autopilotStateGet<T>()
}

export const setAutopilotConfig = async <T = unknown>(state: T) => {
  await autopilotStateSet<T>({ state })
}

export const clearLegacyAutopilotConfig = async () => {
  await autopilotClearLegacy()
}
