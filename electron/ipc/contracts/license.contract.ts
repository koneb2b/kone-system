/**
 * license / system IPC 合约（license-service 第四批 registry 迁移）
 *
 * 通道命名事实源是 `electron/ipc/channels.ts` 的 `IPC_CHANNELS.LICENSE.*` 与
 * `IPC_CHANNELS.SYSTEM.GET_DEVICE_STATUS`；本文件定义请求/响应运行时校验规则，
 * 供 `registerIpc()` 在 dev 模式做响应契约校验（production 模式跳过校验保性能）。
 *
 * 迁移批次（共 6 个 plain 通道）：
 *   SYSTEM.GET_DEVICE_STATUS / LICENSE.GET_INFO / LICENSE.REQUEST_TRIAL /
 *   LICENSE.SUBMIT / LICENSE.VERIFY / LICENSE.CHECK_STATUS
 *
 * 设计取舍：请求侧统一放宽为 `any`，与 agent.contract / config.contract /
 * autopilot.contract / auth.contract / account.contract / automation.contract 同构——
 * handler 自身对缺码返回 400、对试用锁定返回 403、对过期/不匹配返回 403/400 信封；
 * 若此处做强类型请求校验，dev 模式会抢先拒绝、导致渲染层丢失 `code` 字段、
 * 行为与 production 不一致。响应侧统一校验结构化信封
 * `{ success, data?, error?, code? }`。
 *
 * 注意：本服务同时导出 `registerSecureIpc` / `registerSecureFeatureIpc`（Fail-Closed
 * 包装器定义）。那 20 处包装器调用点不在本批次迁移范围，故此处不为它们定义合约，
 * 避免产生"定义了却无人消费"的死契约（见《规范文档与架构数据交互深度梳理报告》P2-2）。
 */

import { IPC_CHANNELS } from '../channels'
import type { Contract, FieldRule } from './types'

export interface LicenseEnvelope {
  success: boolean
  data?: unknown
  error?: string
  code?: number | string
}

// 六个 handler 统一返回的结构化信封（与 agent.contract 同构，便于审计）
const licenseEnvelopeResponseRule: FieldRule = {
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

export const systemGetDeviceStatusContract: Contract<unknown, LicenseEnvelope> = {
  channel: IPC_CHANNELS.SYSTEM.GET_DEVICE_STATUS,
  requestRule: anyRequestRule,
  responseRule: licenseEnvelopeResponseRule,
}

/* 2026-10-11 新增：用**系统默认浏览器**打开外部链接（用于 `wa.me` 一键 WhatsApp 触达）。
   handler 侧**白名单校验协议**（仅 http/https），拒绝 `file://` 与自定义协议，
   防止该通道被滥用为本地文件读取或任意程序唤起。 */
export const systemOpenExternalContract: Contract<unknown, LicenseEnvelope> = {
  channel: IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL,
  requestRule: anyRequestRule,
  responseRule: licenseEnvelopeResponseRule,
}

export const licenseGetInfoContract: Contract<unknown, LicenseEnvelope> = {
  channel: IPC_CHANNELS.LICENSE.GET_INFO,
  requestRule: anyRequestRule,
  responseRule: licenseEnvelopeResponseRule,
}

export const licenseRequestTrialContract: Contract<unknown, LicenseEnvelope> = {
  channel: IPC_CHANNELS.LICENSE.REQUEST_TRIAL,
  requestRule: anyRequestRule,
  responseRule: licenseEnvelopeResponseRule,
}

export const licenseSubmitContract: Contract<unknown, LicenseEnvelope> = {
  channel: IPC_CHANNELS.LICENSE.SUBMIT,
  requestRule: anyRequestRule,
  responseRule: licenseEnvelopeResponseRule,
}

export const licenseVerifyContract: Contract<unknown, LicenseEnvelope> = {
  channel: IPC_CHANNELS.LICENSE.VERIFY,
  requestRule: anyRequestRule,
  responseRule: licenseEnvelopeResponseRule,
}

export const licenseCheckStatusContract: Contract<unknown, LicenseEnvelope> = {
  channel: IPC_CHANNELS.LICENSE.CHECK_STATUS,
  requestRule: anyRequestRule,
  responseRule: licenseEnvelopeResponseRule,
}
