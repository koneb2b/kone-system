/**
 * automation IPC 合约（automation-service 第三批 registry 迁移）
 *
 * 通道命名事实源是 `electron/ipc/channels.ts` 的 `IPC_CHANNELS.AUTOMATION.*`；
 * 本文件定义请求/响应运行时校验规则，供 `registerIpc()` 在 dev 模式做
 * 响应契约校验（production 模式跳过校验保性能）。
 *
 * 迁移批次：AUTOMATION.START_CAMPAIGN（1 个 plain 通道）。
 *
 * 注意：`AUTOMATION.VERIFY_EMAILS` 仍由 `registerSecureFeatureIpc` 包装
 * （Fail-Closed 授权，特征 `cloud_send`），不在本批次迁移范围，故此处不定义其合约，
 * 避免产生"定义了却无人消费"的死契约（见《规范文档与架构数据交互深度梳理报告》P2-2）。
 *
 * 说明：START_CAMPAIGN 虽无外层包装，但 handler 内部仍执行 Fail-Closed 授权
 * （`ensureTrialAccess` + `licenseGuard.requireFeature('cloud_send')`）。迁移只改变
 * 注册方式（registry 收敛），不触碰授权判定。
 *
 * 设计取舍：请求侧放宽为 `any`——handler 自身对无权限返回
 * `{ success:false, error:'FEATURE_DENIED', message, operationName, code:403 }` 信封；
 * 若此处做强类型请求校验，dev 模式会抢先拒绝、导致渲染层丢失 `code` 字段、
 * 行为与 production 不一致。响应侧统一校验结构化信封 `{ success, data?, error?, code? }`。
 */

import { IPC_CHANNELS } from '../channels'
import type { Contract, FieldRule } from './types'

export interface AutomationEnvelope {
  success: boolean
  data?: unknown
  error?: string
  code?: number | string
}

const automationEnvelopeResponseRule: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    success: { type: 'boolean', required: true },
    data: { type: 'any' },
    error: { type: 'string', required: false },
    code: { type: 'any', required: false },
  },
}

const anyRequestRule: FieldRule = {
  type: 'any',
}

export const automationStartCampaignContract: Contract<unknown, AutomationEnvelope> = {
  channel: IPC_CHANNELS.AUTOMATION.START_CAMPAIGN,
  requestRule: anyRequestRule,
  responseRule: automationEnvelopeResponseRule,
}
