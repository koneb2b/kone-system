/**
 * provider IPC 合约（PROVIDER 服务首批 registry 迁移）
 *
 * 通道命名事实源仍是 `electron/ipc/channels.ts` 的 `IPC_CHANNELS.PROVIDER.*`；
 * 本文件仅定义请求/响应运行时校验规则，供 `registerIpc()` 在 dev 模式做
 * 请求/响应契约校验（production 模式跳过校验保性能）。
 *
 * 迁移批次：PROVIDER.LIST / PROVIDER.STATUS（共 2 个通道）。
 */

import { IPC_CHANNELS } from '../channels'
import type { Contract, FieldRule } from './types'

// ── 类型定义 ──────────────────────────────────────

export interface ProviderStatusItem {
  id: string
  name: string
  available: boolean
  requiredConfig: string[]
}

export type ProviderListResult = ProviderStatusItem[]

// ── 校验规则 ──────────────────────────────────────

// PROVIDER.LIST：渲染层无参 invoke，请求侧不约束。
const listRequestRule: FieldRule = {
  type: 'any',
}

// 响应必须是一个数组，且每个元素具备 provider 状态四元组。
const listResponseRule: FieldRule = {
  type: 'array',
  required: true,
  arrayOf: {
    type: 'object',
    fields: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true },
      available: { type: 'boolean', required: true },
      requiredConfig: { type: 'array', required: true, arrayOf: { type: 'string' } },
    },
  },
}

// PROVIDER.STATUS：请求为 provider id（字符串）。
const statusRequestRule: FieldRule = {
  type: 'string',
  required: true,
  min: 1,
  max: 100,
}

// 响应可为对象（命中）或 null（未命中）——dev 模式不做形状否定。
const statusResponseRule: FieldRule = {
  type: 'any',
}

// ── 合约导出 ──────────────────────────────────────

export const providerListContract: Contract<void, ProviderListResult> = {
  channel: IPC_CHANNELS.PROVIDER.LIST,
  requestRule: listRequestRule,
  responseRule: listResponseRule,
}

export const providerStatusContract: Contract<string, ProviderStatusItem | null> = {
  channel: IPC_CHANNELS.PROVIDER.STATUS,
  requestRule: statusRequestRule,
  responseRule: statusResponseRule,
}
