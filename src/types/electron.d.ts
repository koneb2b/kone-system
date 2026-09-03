import type { ElectronApi } from '../shared/ipc-contracts'

export {}

declare global {
  interface Window {
    electronAPI: ElectronApi
  }
}
