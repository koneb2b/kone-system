/**
 * outreach-sync-service.ts — 云端 outreach 状态回写本地 agentStatus
 *
 * Phase 2: 实现云端投递状态到本地 Agent 状态的同步
 * - 定期轮询云端 outreach 状态
 * - 映射云端状态到本地 agentStatus
 * - 通过 IPC 推送状态更新事件
 */

import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc, registry } from '../ipc/registry'
import { pollOutreachStatus, isCloudflareConfigured, testConnection } from './cloudflare-service'
import type { ConfigStore } from './config-service'
import { buildFeatureDeniedResponse } from './license-service'
import type { AgentStatus } from '../../src/shared/ipc-contracts'

/* ──────────────────────────────────────────────
 *  Types
 * ────────────────────────────────────────────── */

type OutreachSyncConfig = {
  enabled: boolean
  intervalMs: number
  lastSyncAt?: string
}

/* ──────────────────────────────────────────────
 *  Sync State
 * ────────────────────────────────────────────── */

let syncTimer: NodeJS.Timeout | null = null
let isSyncing = false

/* ──────────────────────────────────────────────
 *  Config
 * ────────────────────────────────────────────── */

const getSyncConfig = (store: ConfigStore): OutreachSyncConfig => {
  return {
    enabled: store.get('cloud.outreachSyncEnabled') !== false,
    intervalMs: Number(store.get('cloud.outreachSyncInterval')) || 60000,
    lastSyncAt: store.get('cloud.outreachLastSyncAt') as string | undefined,
  }
}

/* ──────────────────────────────────────────────
 *  Core Sync Logic
 * ────────────────────────────────────────────── */

export const syncOutreachStatus = async (
  store: ConfigStore,
  mainWindow: Electron.BrowserWindow | null,
): Promise<{ synced: number; errors: string[] }> => {
  if (!isCloudflareConfigured(store)) {
    return { synced: 0, errors: ['Cloudflare 未配置'] }
  }

  if (isSyncing) {
    return { synced: 0, errors: ['Sync already in progress'] }
  }

  isSyncing = true
  const errors: string[] = []
  let synced = 0

  try {
    // 拉取云端 outreach 状态
    const statuses = ['pending', 'sent', 'delivered', 'bounced']

    for (const status of statuses) {
      const result = await pollOutreachStatus(store, {
        status,
        limit: 50,
      })

      for (const outreach of result.outreach) {
        try {
          const agentStatus = mapOutreachToAgentStatus(outreach)
          await pushStatusUpdate(mainWindow, outreach.leadId, agentStatus)
          synced++
        } catch (error) {
          errors.push(`Failed to sync ${outreach.id}: ${error instanceof Error ? error.message : 'Unknown'}`)
        }
      }
    }

    // 更新最后同步时间
    const now = new Date().toISOString()
    await store.set('cloud.outreachLastSyncAt', now)
  } catch (error) {
    errors.push(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  } finally {
    isSyncing = false
  }

  return { synced, errors }
}

/**
 * 将云端 outreach 状态映射到本地 agentStatus
 */
const mapOutreachToAgentStatus = (outreach: any): Partial<AgentStatus> => {
  const status = outreach.status
  const clamped = Math.min(3, Math.max(0, outreach.sequenceStage ?? 0))
  const emailStage = clamped as AgentStatus['emailSequenceStage']

  let whatsappStatus: AgentStatus['whatsappStatus']
  switch (status) {
    case 'delivered':
      whatsappStatus = 'delivered'
      break
    case 'bounced':
    case 'complained':
      whatsappStatus = 'failed'
      break
    case 'replied':
      whatsappStatus = 'replied'
      break
    default:
      whatsappStatus = 'pending'
  }

  return {
    whatsappSent: status !== 'pending',
    whatsappStatus,
    linkedinContacted: false,
    emailSequenceStage: emailStage,
    emailPendingManual: false,
  }
}

/**
 * 通过 IPC 推送状态更新事件到渲染进程
 */
const pushStatusUpdate = async (
  mainWindow: Electron.BrowserWindow | null,
  leadKey: string,
  agentStatus: Partial<AgentStatus>,
): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const event = {
    leadKey,
    agentStatus,
  }

  mainWindow.webContents.send(IPC_CHANNELS.AGENT.LEAD_STATUS_UPDATED, event)
}

/* ──────────────────────────────────────────────
 *  Timer Management
 * ────────────────────────────────────────────── */

export const startOutreachSync = (store: ConfigStore, mainWindow: Electron.BrowserWindow | null): void => {
  stopOutreachSync()

  const config = getSyncConfig(store)
  if (!config.enabled) return

  syncTimer = setInterval(async () => {
    await syncOutreachStatus(store, mainWindow)
  }, config.intervalMs)

  // 首次同步延迟 5 秒执行
  setTimeout(async () => {
    await syncOutreachStatus(store, mainWindow)
  }, 5000)
}

export const stopOutreachSync = (): void => {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

/* ──────────────────────────────────────────────
 *  IPC Handler Registration
 * ────────────────────────────────────────────── */

export const registerOutreachSyncHandlers = (
  ipcMain: Electron.IpcMain,
  store: ConfigStore,
  /* 2026-10-20：本函数注册的 `CLOUD.CLOUDFLARE_TEST_CONNECTION` **覆盖** cloudflare-service
     的同名通道（后注册者胜出，见下方注释）——因此该通道的**有效** handler 在此处，
     授权门禁必须装在这里，写在 cloudflare-service 内对有效路径无效。 */
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  getWindow: () => Electron.BrowserWindow | null,
): void => {
  // 手动触发同步（复用 CLOUDFLARE_TEST_CONNECTION 通道，payload 区分）
  registerIpc(
    IPC_CHANNELS.CLOUD.CLOUDFLARE_TEST_CONNECTION,
    {
      channel: IPC_CHANNELS.CLOUD.CLOUDFLARE_TEST_CONNECTION,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async (_event: unknown, payload: any) => {
      // 云端同步（sync-outreach）与连接测试同属高级版能力，统一按 `cloud_send` 收口。
      try {
        licenseGuard.requireFeature('cloud_send', '云端同步与连接测试')
      } catch (error: any) {
        return buildFeatureDeniedResponse('云端同步与连接测试', error)
      }
      if (payload?.action === 'sync-outreach') {
        const result = await syncOutreachStatus(store, getWindow())
        return { success: true, data: result }
      }
      // 非 sync action → 走「测试连接」逻辑。
      //
      // 此前此处直接返回 `Unknown action`，但注释写的是"走原有的测试连接逻辑"——
      // 注释与实现不符。由于本 handler 后注册、覆盖了 cloudflare-service 注册的同名通道，
      // 导致设置页「测试连接」**永远失败并返回 Unknown action**。
      // 现改为真实转发，与注释一致。
      try {
        return { success: true, data: await testConnection(store) }
      } catch (err) {
        return {
          success: false,
          error: {
            code: 'TEST_CONNECTION_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        }
      }
    },
  )

  registry.attach(ipcMain)
}
