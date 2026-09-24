/**
 * account IPC 合约（sandbox-service 第三批 registry 迁移）
 *
 * 通道命名事实源是 `electron/ipc/channels.ts` 的 `IPC_CHANNELS.ACCOUNT.*`；
 * 本文件定义请求/响应运行时校验规则，供 `registerIpc()` 在 dev 模式做
 * 响应契约校验（production 模式跳过校验保性能）。
 *
 * 迁移批次：ACCOUNT.CONNECT / ACCOUNT.DISCONNECT / ACCOUNT.GET_LIST
 * （共 3 个 plain 通道）。
 *
 * 注意：这三个通道虽无 `registerSecureFeatureIpc` 外层包装，但 handler 内部仍执行
 * Fail-Closed 授权（`hasFeature('team_collaboration' | 'search_basic')` +
 * `buildFeatureResult(..., 403)`）。迁移只改变注册方式（registry 收敛），
 * 不触碰授权判定——授权语义保持原样，见 ARCH-STANDARDS §3。
 *
 * 设计取舍：请求侧统一放宽为 `any`，与 agent.contract / config.contract /
 * autopilot.contract / auth.contract 同构——handler 自身对缺参/未找到/无权限分别
 * 返回 `{ success:false, error, code: 400 | 404 | 403 | 500 }` 信封；若此处做强类型
 * 请求校验，dev 模式会抢先拒绝、导致渲染层丢失 `code` 字段、行为与 production 不一致。
 * 响应侧统一校验结构化信封 `{ success, data?, error?, code? }`。
 */

import { IPC_CHANNELS } from '../channels'
import type { Contract, FieldRule } from './types'

export interface AccountEnvelope {
  success: boolean
  data?: unknown
  error?: string
  code?: number | string
}

// 三个 handler 统一返回的结构化信封（与 agent.contract 同构，便于审计）
const accountEnvelopeResponseRule: FieldRule = {
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

export const accountConnectContract: Contract<unknown, AccountEnvelope> = {
  channel: IPC_CHANNELS.ACCOUNT.CONNECT,
  requestRule: anyRequestRule,
  responseRule: accountEnvelopeResponseRule,
}

export const accountDisconnectContract: Contract<unknown, AccountEnvelope> = {
  channel: IPC_CHANNELS.ACCOUNT.DISCONNECT,
  requestRule: anyRequestRule,
  responseRule: accountEnvelopeResponseRule,
}

export const accountGetListContract: Contract<unknown, AccountEnvelope> = {
  channel: IPC_CHANNELS.ACCOUNT.GET_LIST,
  requestRule: anyRequestRule,
  responseRule: accountEnvelopeResponseRule,
}
