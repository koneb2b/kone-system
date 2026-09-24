/**
 * autopilot IPC 合约（autopilot-state-service 第三批 registry 迁移）
 *
 * 通道命名事实源是 `electron/ipc/channels.ts` 的 `IPC_CHANNELS.AUTOPILOT.*`；
 * 本文件定义请求/响应运行时校验规则，供 `registerIpc()` 在 dev 模式做
 * 响应契约校验（production 模式跳过校验保性能）。
 *
 * 迁移批次：AUTOPILOT.GET_STATE / AUTOPILOT.SET_STATE / AUTOPILOT.CLEAR_LEGACY
 * （共 3 个 plain 通道）。
 *
 * 说明：`AUTOPILOT.SYNC_STATE` 由 `main.ts` 直接 `ipcMain.handle` 注册（生命周期
 * 变更广播，不属于本服务的 registerAutopilotStateHandlers），不在本批次迁移范围内，
 * 其合约仅保留请求侧生命周期枚举校验。
 *
 * ── 本轮修正（SSOT 治理）────────────────────────────────────────────
 * 原文件把通道硬编码为 camelCase 字符串（'autopilot:getState' / 'autopilot:setState' /
 * 'autopilot:clearLegacy' / 'autopilot:syncLifecycle'），而 `channels.ts` SSOT 实际为
 * kebab-case（'autopilot:get-state' / 'autopilot:set-state' / 'autopilot:clear-legacy' /
 * 'sync-autopilot-state'）——两者永不相等，合约事实上处于失效/死代码状态
 * （见《KONE-V1.3-规范文档与架构数据交互深度梳理报告》"全仓 0 引用 / P2-2"）。
 * 本轮统一改为引用 `IPC_CHANNELS`，消除硬编码漂移。
 *
 * 设计取舍：请求侧统一放宽为 `any`，与 agent.contract / config.contract 同构——
 * handler 自身对异常返回 `{ success: false, error, code }` 信封；若此处做强类型
 * 请求校验，dev 模式会抢先拒绝、导致渲染层丢失 `code` 字段、行为与 production
 * 不一致。响应侧统一校验结构化信封 `{ success, data?, error?, code? }`。
 */

import { IPC_CHANNELS } from '../channels'
import type { Contract, FieldRule } from './types'

// ── 类型定义 ──────────────────────────────────────

export type AutopilotStateKind =
  | 'hydrating'
  | 'ready_empty'
  | 'queued_idle'
  | 'running'
  | 'paused'
  | 'cooldown'
  | 'completed'
  | 'error'
  | 'state_unavailable'
  | 'environment_mock'

export type AutopilotLifecycle = 'idle' | 'running' | 'paused' | 'completed' | 'error'

export type AutopilotAction = 'pause' | 'resume' | 'stop'

export interface AutopilotStateEnvelope<T = unknown> {
  stateKind: AutopilotStateKind
  state: T | null
  source?: 'runtime' | 'persisted'
  statusReason?: string
}

export interface AutopilotStatePayload<T = unknown> {
  state: T
}

/** 三个迁移 handler 统一返回的结构化信封（与 agent.contract 同构，便于审计） */
export interface AutopilotIpcEnvelope {
  success: boolean
  data?: unknown
  error?: string
  code?: number | string
}

// ── 校验规则 ──────────────────────────────────────

const stateKindRule: FieldRule = {
  type: 'string',
  required: true,
  pattern:
    /^(hydrating|ready_empty|queued_idle|running|paused|cooldown|completed|error|state_unavailable|environment_mock)$/,
}

const lifecycleRule: FieldRule = {
  type: 'string',
  required: true,
  pattern: /^(idle|running|paused|completed|error)$/,
}

const autopilotEnvelopeResponseRule: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    success: { type: 'boolean', required: true },
    data: { type: 'any' },
    error: { type: 'string', required: false },
    code: { type: 'any', required: false },
  },
}

// 请求侧放宽（见文件头设计取舍）
const anyRequestRule: FieldRule = {
  type: 'any',
}

// getState — 无请求参数；响应为结构化信封（data 内为 AutopilotStateEnvelope）
export const autopilotGetStateContract: Contract<unknown, AutopilotIpcEnvelope> = {
  channel: IPC_CHANNELS.AUTOPILOT.GET_STATE,
  requestRule: anyRequestRule,
  responseRule: autopilotEnvelopeResponseRule,
}

// setState — 请求为 { state }（handler 自行容错）；响应为结构化信封
export const autopilotSetStateContract: Contract<unknown, AutopilotIpcEnvelope> = {
  channel: IPC_CHANNELS.AUTOPILOT.SET_STATE,
  requestRule: anyRequestRule,
  responseRule: autopilotEnvelopeResponseRule,
}

// clearLegacy — 无请求参数；响应为结构化信封
export const autopilotClearLegacyContract: Contract<unknown, AutopilotIpcEnvelope> = {
  channel: IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY,
  requestRule: anyRequestRule,
  responseRule: autopilotEnvelopeResponseRule,
}

// syncLifecycle — 由 main.ts 直接注册，不在 registry 迁移范围；
// 保留请求侧生命周期枚举校验（ipc-contracts-v2 测试依赖该校验语义）。
export const autopilotSyncLifecycleContract: Contract<{ lifecycle: AutopilotLifecycle }, null> = {
  channel: IPC_CHANNELS.AUTOPILOT.SYNC_STATE,
  requestRule: {
    type: 'object',
    required: true,
    fields: {
      lifecycle: lifecycleRule,
    },
  },
  responseRule: { type: 'any', required: false },
}

// 保留导出（原文件即导出，避免下游类型引用断裂）
export { stateKindRule }
