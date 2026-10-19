import { app } from './electron-bridge'
import * as fs from 'fs'
import * as path from 'path'
import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc, registry } from '../ipc/registry'
import {
  autopilotGetStateContract,
  autopilotSetStateContract,
  autopilotClearLegacyContract,
} from '../ipc/contracts/autopilot.contract'
import type { AutopilotStateEnvelope, AutopilotStateKind } from '../../src/shared/ipc-contracts'
import { getPublicUserConfig, setConfigValue, type ConfigStore } from './config-service'
import { buildFeatureDeniedResponse } from './license-service'

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

/**
 * 第三批 registry 迁移：AUTOPILOT.GET_STATE / SET_STATE / CLEAR_LEGACY 三个无授权
 * 包装的 plain 通道经 `registerIpc()` 收敛到注册中心，由 `registry.attach(ipcMain)`
 * 统一绑定（见函数末尾自绑定）。契约在 dev 模式做响应信封校验，production 跳过。
 *
 * 注意：`AUTOPILOT.SYNC_STATE` 由 `main.ts` 直接 `ipcMain.handle` 注册，不在本处。
 */
/* D5（2026-10-19）：`licenseGuard` 由 main.ts 注入（createLicenseService 的**唯一**实例）。
   不得在本服务内另建第二个 guard —— 授权判断必须收敛到单实例，否则重现
   license-features.ts 注释里所述"多份可独立演化的副本"缺陷。 */
export const registerAutopilotStateHandlers = (
  ipcMain: Electron.IpcMain,
  store: ConfigStore,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
) => {
  registerIpc(IPC_CHANNELS.AUTOPILOT.GET_STATE, autopilotGetStateContract, async () => {
    try {
      return { success: true, data: readAutopilotStateEnvelope() }
    } catch (error: any) {
      console.error(' [AutopilotState] Get failed:', error)
      return { success: false, error: error?.message || 'Autopilot state read failed', code: error?.code }
    }
  })

  registerIpc(
    IPC_CHANNELS.AUTOPILOT.SET_STATE,
    autopilotSetStateContract,
    async (_event: unknown, payload: unknown) => {
      try {
        const p = payload as { state?: unknown }
        writeAutopilotState(p?.state ?? null)
        return { success: true, data: null }
      } catch (error: any) {
        console.error(' [AutopilotState] Set failed:', error)
        return { success: false, error: error?.message || 'Autopilot state write failed', code: error?.code }
      }
    },
  )

  registerIpc(IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY, autopilotClearLegacyContract, async () => {
    /* D5（2026-10-19 修复）：本通道此前**无任何门禁**——试用版可直接清理巡航遗留节点。
       与同族 AUTOPILOT.* 一致，按 `local_autopilot`（付费基础版起）拦截。 */
    try {
      licenseGuard.requireFeature('local_autopilot', '巡航遗留清理')
    } catch (error: any) {
      return buildFeatureDeniedResponse('巡航遗留清理', error)
    }
    try {
      clearLegacyAutopilotNode(store)
      return { success: true, data: null }
    } catch (error: any) {
      console.error(' [AutopilotState] Legacy clear failed:', error)
      return { success: false, error: error?.message || 'Autopilot legacy clear failed', code: error?.code }
    }
  })

  /* 自绑定兼容层（与 agent-service 同构）：历史 e2e / 独立测试直接调用本函数而未
     显式 attach，迁移后 3 个 plain 通道需落到 ipcMain 才能被 getHandler 取到。
     attach 按 ipcMain 实例幂等，主进程末尾的 attach 不会重复绑定。 */
  registry.attach(ipcMain)
}
