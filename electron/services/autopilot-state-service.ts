import { app } from './electron-bridge'
import * as fs from 'fs'
import * as path from 'path'
import { IPC_CHANNELS } from '../ipc/channels'
import type { AutopilotStateEnvelope, AutopilotStateKind } from '../../src/shared/ipc-contracts'
import { getPublicUserConfig, setConfigValue, type ConfigStore } from './config-service'

const AUTOPILOT_STATE_FILE = 'autopilot_state.json'
const AUTOPILOT_STATE_TMP_FILE = 'autopilot_state.json.tmp'

const getAutopilotStatePath = () => path.join(app.getPath('userData'), AUTOPILOT_STATE_FILE)
const getAutopilotStateTmpPath = () => path.join(app.getPath('userData'), AUTOPILOT_STATE_TMP_FILE)

const ensureAutopilotStateDir = () => {
  fs.mkdirSync(path.dirname(getAutopilotStatePath()), { recursive: true })
}

const readAutopilotStateEnvelope = <T = unknown>(): AutopilotStateEnvelope<T> => {
  try {
    const filePath = getAutopilotStatePath()
    if (!fs.existsSync(filePath)) {
      return { stateKind: 'ready_empty', source: 'persisted', state: null }
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    if (!raw.trim()) {
      return { stateKind: 'ready_empty', source: 'persisted', state: null, statusReason: '巡航状态文件为空' }
    }
    return {
      stateKind: 'queued_idle',
      source: 'persisted',
      state: JSON.parse(raw) as T,
    }
  } catch (error: any) {
    console.error(' [AutopilotState] Read failed:', error)
    return {
      stateKind: 'state_unavailable',
      source: 'persisted',
      statusReason: String(error?.message || 'Autopilot state read failed'),
      state: null,
    }
  }
}

export const readAutopilotState = <T = unknown>(): T | null => readAutopilotStateEnvelope<T>().state

export const writeAutopilotState = <T = unknown>(state: T) => {
  ensureAutopilotStateDir()
  const filePath = getAutopilotStatePath()
  const tmpPath = getAutopilotStateTmpPath()
  const payload = JSON.stringify(state, null, 2)
  const fd = fs.openSync(tmpPath, 'w')

  try {
    fs.writeFileSync(fd, payload, 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }

  fs.renameSync(tmpPath, filePath)
}

export const clearLegacyAutopilotNode = (store: ConfigStore) => {
  const current = getPublicUserConfig(store) as Record<string, unknown>
  if (!current || typeof current !== 'object' || !('autopilot' in current)) {
    return
  }

  const next = { ...current }
  delete next.autopilot
  setConfigValue(store, 'user_config', next)
}

export const registerAutopilotStateHandlers = (ipcMain: Electron.IpcMain, store: ConfigStore) => {
  ipcMain.handle(IPC_CHANNELS.AUTOPILOT.GET_STATE, () => {
    try {
      return { success: true, data: readAutopilotStateEnvelope() }
    } catch (error: any) {
      console.error(' [AutopilotState] Get failed:', error)
      return { success: false, error: error?.message || 'Autopilot state read failed', code: error?.code }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTOPILOT.SET_STATE, (_event, payload: { state: unknown }) => {
    try {
      writeAutopilotState(payload?.state ?? null)
      return { success: true, data: null }
    } catch (error: any) {
      console.error(' [AutopilotState] Set failed:', error)
      return { success: false, error: error?.message || 'Autopilot state write failed', code: error?.code }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY, () => {
    try {
      clearLegacyAutopilotNode(store)
      return { success: true, data: null }
    } catch (error: any) {
      console.error(' [AutopilotState] Legacy clear failed:', error)
      return { success: false, error: error?.message || 'Autopilot legacy clear failed', code: error?.code }
    }
  })
}
