/**
 * config / secret IPC 合约（config-service 首批 registry 迁移）
 *
 * 通道命名事实源仍是 `electron/ipc/channels.ts` 的 `IPC_CHANNELS.CONFIG.*` /
 * `IPC_CHANNELS.SECRET.*`；本文件仅定义请求/响应运行时校验规则，供
 * `registerIpc()` 在 dev 模式做响应契约校验（production 模式跳过校验保性能）。
 *
 * 迁移批次：CONFIG.GET / CONFIG.SET / SECRET.SET / SECRET.CHECK（共 4 个通道）。
 *
 * 设计取舍：请求侧统一放宽为 `any`，因为 handler 自身对 null/undefined/类型错误
 * 返回 `{ success: false, code: 400/403 }` 信封；若此处做强类型请求校验，dev 模式
 * 会抢先拒绝、导致渲染层丢失 `code` 字段、行为与 production 不一致。响应侧统一校验
 * 结构化信封 `{ success, data?, error?, code? }`，保证所有 handler 都返回可预期形状。
 */

import { IPC_CHANNELS } from '../channels'
import type { Contract, FieldRule } from './types'

export interface ConfigResult {
  success: boolean
  data?: unknown
  error?: string
  code?: number | string
}

// 四个 handler 统一返回的结构化信封
const configResultResponseRule: FieldRule = {
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

export const configGetContract: Contract<unknown, ConfigResult> = {
  channel: IPC_CHANNELS.CONFIG.GET,
  requestRule: anyRequestRule,
  responseRule: configResultResponseRule,
}

export const configSetContract: Contract<unknown, ConfigResult> = {
  channel: IPC_CHANNELS.CONFIG.SET,
  requestRule: anyRequestRule,
  responseRule: configResultResponseRule,
}

export const secretSetContract: Contract<unknown, ConfigResult> = {
  channel: IPC_CHANNELS.SECRET.SET,
  requestRule: anyRequestRule,
  responseRule: configResultResponseRule,
}

export const secretCheckContract: Contract<unknown, ConfigResult> = {
  channel: IPC_CHANNELS.SECRET.CHECK,
  requestRule: anyRequestRule,
  responseRule: configResultResponseRule,
}
