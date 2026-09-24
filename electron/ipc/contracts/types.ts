/**
 * IPC 合约核心类型
 *
 * 每个 IPC channel 定义一个 Contract，包含：
 * - requestShape: 请求形状校验函数（运行时）
 * - responseShape: 响应形状校验函数（运行时）
 * - requestType / responseType: TypeScript 类型（编译时）
 *
 * dev 模式进行严格校验，production 模式跳过以保持性能。
 */

import { app } from '../../services/electron-bridge'

// ── 类型工具 ──────────────────────────────────────

/** 简单运行时类型检查器 */
export type TypeChecker<T> = (value: unknown) => value is T

/** 字段校验规则 */
export interface FieldRule {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any'
  required?: boolean
  min?: number // string: minLength, number: minimum
  max?: number // string: maxLength, number: maximum
  pattern?: RegExp // string 正则
  arrayOf?: FieldRule // 数组元素规则
  fields?: Record<string, FieldRule> // 对象字段规则
}

/** 合约定义 */
export interface Contract<I = unknown, O = unknown> {
  /** 通道名字（用于错误消息） */
  channel: string
  /** 请求校验规则 */
  requestRule: FieldRule
  /** 响应校验规则 */
  responseRule: FieldRule
  /** 请求 TypeScript 类型（编译时用） */
  _requestType?: I
  /** 响应 TypeScript 类型（编译时用） */
  _responseType?: O
}

/** 注册条目 */
export interface ContractEntry<I = unknown, O = unknown> {
  contract: Contract<I, O>
  handler: (event: unknown, ...args: unknown[]) => Promise<O>
  /** 是否跳过校验（某些内部 handler） */
  skipValidation?: boolean
  /**
   * 是否跳过 `attach` 的真实绑定（P0-4/续，Fail-Closed 包装器治理登记用）。
   * 设为 true 时，该通道仅登记进注册中心（供 `assertAllRegistered()` 门禁覆盖），
   * 其真实 `ipcMain.handle` 绑定仍由调用方（registerSecureIpc 等）自行完成，
   * `attach()` 不会重复绑定、避免 production 主进程触发 Electron "second handler" 报错。
   */
  skipAttach?: boolean
}

// ── 校验引擎 ──────────────────────────────────────

const isDev = (): boolean => !app.isPackaged

/** 单字段校验 */
function validateField(path: string, value: unknown, rule: FieldRule): string | null {
  if (value === undefined || value === null) {
    return rule.required ? `${path} 是必填字段` : null
  }

  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') return `${path} 必须是字符串`
      if (rule.min !== undefined && (value as string).length < rule.min) return `${path} 最少 ${rule.min} 个字符`
      if (rule.max !== undefined && (value as string).length > rule.max) return `${path} 最多 ${rule.max} 个字符`
      if (rule.pattern && !rule.pattern.test(value as string)) return `${path} 格式不正确`
      return null
    }
    case 'number': {
      if (typeof value !== 'number') return `${path} 必须是数字`
      if (rule.min !== undefined && (value as number) < rule.min) return `${path} 不能小于 ${rule.min}`
      if (rule.max !== undefined && (value as number) > rule.max) return `${path} 不能大于 ${rule.max}`
      return null
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return `${path} 必须是布尔值`
      return null
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path} 必须是对象`
      if (rule.fields) {
        for (const [key, fieldRule] of Object.entries(rule.fields)) {
          const err = validateField(`${path}.${key}`, (value as Record<string, unknown>)[key], fieldRule)
          if (err) return err
        }
      }
      return null
    }
    case 'array': {
      if (!Array.isArray(value)) return `${path} 必须是数组`
      if (rule.arrayOf) {
        for (let i = 0; i < (value as unknown[]).length; i++) {
          const err = validateField(`${path}[${i}]`, (value as unknown[])[i], rule.arrayOf)
          if (err) return err
        }
      }
      return null
    }
    case 'any':
      return null
    default:
      return null
  }
}

/** 校验请求载荷 */
export function validateRequest<I>(
  contract: Contract<I, unknown>,
  payload: unknown,
): { valid: true; data: I } | { valid: false; error: string } {
  if (!isDev()) return { valid: true, data: payload as I } // production 跳过

  const err = validateField(contract.channel, payload, contract.requestRule)
  if (err) return { valid: false, error: `[${contract.channel}] 请求校验失败: ${err}` }
  return { valid: true, data: payload as I }
}

/** 校验响应载荷 */
export function validateResponse<O>(
  contract: Contract<unknown, O>,
  payload: unknown,
): { valid: true; data: O } | { valid: false; error: string } {
  if (!isDev()) return { valid: true, data: payload as O } // production 跳过

  const err = validateField(contract.channel, payload, contract.responseRule)
  if (err) return { valid: false, error: `[${contract.channel}] 响应校验失败: ${err}` }
  return { valid: true, data: payload as O }
}

/** 判断当前是否为开发环境 */
export const isContractDevMode = isDev
