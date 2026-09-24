/**
 * agent IPC 合约（agent-service 第二批 registry 迁移）
 *
 * 通道命名事实源仍是 `electron/ipc/channels.ts` 的 `IPC_CHANNELS.AGENT.*`；
 * 本文件仅定义请求/响应运行时校验规则，供 `registerIpc()` 在 dev 模式做
 * 响应契约校验（production 模式跳过校验保性能）。
 *
 * 迁移批次：AGENT.LIST / AGENT.GET_LOG / AGENT.GET_STATUS / AGENT.SUPPRESS_LIST /
 * AGENT.SUPPRESS_ADD / AGENT.SUPPRESS_REMOVE（共 6 个 plain 通道）。
 * 注意：`AGENT.CONTROL` 仍由 `registerSecureFeatureIpc` 包装（Fail-Closed 授权），
 * 不经本批次迁移，保留在 `ipcMain.handle` 而非注册中心。
 *
 * 设计取舍：请求侧统一放宽为 `any`，与 config.contract 一致——handler 自身对
 * 空参数返回 `{ success: false, code: 400 }` 信封；若此处做强类型请求校验，dev 模式
 * 会抢先拒绝、导致渲染层丢失 `code` 字段、行为与 production 不一致。响应侧统一校验
 * 结构化信封 `{ success, data?, error?, code? }`，保证所有 handler 都返回可预期形状。
 */

import { IPC_CHANNELS } from '../channels'
import type { Contract, FieldRule } from './types'

export interface AgentEnvelope {
  success: boolean
  data?: unknown
  error?: string
  code?: number | string
}

// 六个 handler 统一返回的结构化信封（与 config.contract 同构，便于审计）
const agentEnvelopeResponseRule: FieldRule = {
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

export const agentListContract: Contract<unknown, AgentEnvelope> = {
  channel: IPC_CHANNELS.AGENT.LIST,
  requestRule: anyRequestRule,
  responseRule: agentEnvelopeResponseRule,
}

export const agentGetLogContract: Contract<unknown, AgentEnvelope> = {
  channel: IPC_CHANNELS.AGENT.GET_LOG,
  requestRule: anyRequestRule,
  responseRule: agentEnvelopeResponseRule,
}

export const agentGetStatusContract: Contract<unknown, AgentEnvelope> = {
  channel: IPC_CHANNELS.AGENT.GET_STATUS,
  requestRule: anyRequestRule,
  responseRule: agentEnvelopeResponseRule,
}

export const agentSuppressListContract: Contract<unknown, AgentEnvelope> = {
  channel: IPC_CHANNELS.AGENT.SUPPRESS_LIST,
  requestRule: anyRequestRule,
  responseRule: agentEnvelopeResponseRule,
}

export const agentSuppressAddContract: Contract<unknown, AgentEnvelope> = {
  channel: IPC_CHANNELS.AGENT.SUPPRESS_ADD,
  requestRule: anyRequestRule,
  responseRule: agentEnvelopeResponseRule,
}

export const agentSuppressRemoveContract: Contract<unknown, AgentEnvelope> = {
  channel: IPC_CHANNELS.AGENT.SUPPRESS_REMOVE,
  requestRule: anyRequestRule,
  responseRule: agentEnvelopeResponseRule,
}
