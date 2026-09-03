/**
 * autopilot IPC 合约
 *
 * autopilot.getState / setState / clearLegacy / syncLifecycle 通道的合约定义。
 */

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

// getState — 无请求参数，响应有 envelope
export const autopilotGetStateContract: Contract<void, AutopilotStateEnvelope> = {
  channel: 'autopilot:getState',
  requestRule: { type: 'any', required: false },
  responseRule: {
    type: 'object',
    required: true,
    fields: {
      stateKind: stateKindRule,
      state: { type: 'any', required: false },
      source: { type: 'string', required: false, pattern: /^(runtime|persisted)$/ },
      statusReason: { type: 'string', required: false },
    },
  },
}

// setState — 请求有 payload
export const autopilotSetStateContract: Contract<AutopilotStatePayload, null> = {
  channel: 'autopilot:setState',
  requestRule: {
    type: 'object',
    required: true,
    fields: {
      stateKind: stateKindRule,
      state: { type: 'any', required: false },
    },
  },
  responseRule: { type: 'any', required: false },
}

// clearLegacy — 无请求参数
export const autopilotClearLegacyContract: Contract<void, null> = {
  channel: 'autopilot:clearLegacy',
  requestRule: { type: 'any', required: false },
  responseRule: { type: 'any', required: false },
}

// getState — 带 lifecycle 参数
export const autopilotSyncLifecycleContract: Contract<{ lifecycle: AutopilotLifecycle }, null> = {
  channel: 'autopilot:syncLifecycle',
  requestRule: {
    type: 'object',
    required: true,
    fields: {
      lifecycle: lifecycleRule,
    },
  },
  responseRule: { type: 'any', required: false },
}
