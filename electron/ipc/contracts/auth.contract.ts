/**
 * auth IPC 合约（auth-service 第三批 registry 迁移）
 *
 * 通道命名事实源是 `electron/ipc/channels.ts` 的 `IPC_CHANNELS.AUTH.*`；
 * 本文件定义请求/响应运行时校验规则，供 `registerIpc()` 在 dev 模式做
 * 响应契约校验（production 模式跳过校验保性能）。
 *
 * 迁移批次：AUTH.LOGIN / AUTH.LOGOUT / AUTH.GET_SESSION（共 3 个 plain 通道）。
 *
 * 设计取舍：请求侧统一放宽为 `any`，与 agent.contract / config.contract /
 * autopilot.contract 同构——handler 自身对异常返回 `{ success:false, error, code }`
 * 信封；若此处做强类型请求校验，dev 模式会抢先拒绝、导致渲染层丢失 `code` 字段、
 * 行为与 production 不一致。响应侧统一校验结构化信封
 * `{ success, data?, error?, code? }`。
 */

import { IPC_CHANNELS } from '../channels'
import type { Contract, FieldRule } from './types'

export interface AuthEnvelope {
  success: boolean
  data?: unknown
  error?: string
  code?: number | string
}

// 三个 handler 统一返回的结构化信封（与 agent.contract 同构，便于审计）
const authEnvelopeResponseRule: FieldRule = {
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

export const authLoginContract: Contract<unknown, AuthEnvelope> = {
  channel: IPC_CHANNELS.AUTH.LOGIN,
  requestRule: anyRequestRule,
  responseRule: authEnvelopeResponseRule,
}

export const authLogoutContract: Contract<unknown, AuthEnvelope> = {
  channel: IPC_CHANNELS.AUTH.LOGOUT,
  requestRule: anyRequestRule,
  responseRule: authEnvelopeResponseRule,
}

export const authGetSessionContract: Contract<unknown, AuthEnvelope> = {
  channel: IPC_CHANNELS.AUTH.GET_SESSION,
  requestRule: anyRequestRule,
  responseRule: authEnvelopeResponseRule,
}
