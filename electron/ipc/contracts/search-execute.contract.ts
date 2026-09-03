/**
 * search:execute IPC 合约
 *
 * 搜索执行通道的请求/响应类型定义与运行时校验规则。
 */

import type { Contract, FieldRule } from './types'

// ── 类型定义 ──────────────────────────────────────

export interface SearchExecuteRequest {
  query: string
  country?: string
  city?: string
  industry?: string
  language?: string
  maxResults?: number
  providers?: string[]
  myJobId?: string
  signal?: AbortSignal
}

export interface SearchExecuteResult {
  success: boolean
  data?: unknown[]
  error?: string
  totalResults?: number
  providerResults?: Record<string, number>
  searchId?: string
  socialBlindScore?: number
  durationMs?: number
}

// ── 校验规则 ──────────────────────────────────────

const requestRule: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    query: { type: 'string', required: true, min: 1, max: 500 },
    country: { type: 'string', required: false, max: 100 },
    city: { type: 'string', required: false, max: 100 },
    industry: { type: 'string', required: false, max: 200 },
    language: { type: 'string', required: false, max: 50 },
    maxResults: { type: 'number', required: false, min: 1, max: 200 },
    providers: {
      type: 'array',
      required: false,
      arrayOf: { type: 'string' },
    },
    myJobId: { type: 'string', required: false },
  },
}

const responseRule: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    success: { type: 'boolean', required: true },
    data: { type: 'array', required: false },
    error: { type: 'string', required: false },
    totalResults: { type: 'number', required: false },
    providerResults: { type: 'object', required: false },
    searchId: { type: 'string', required: false },
    socialBlindScore: { type: 'number', required: false },
    durationMs: { type: 'number', required: false },
  },
}

// ── 合约导出 ──────────────────────────────────────

export const searchExecuteContract: Contract<SearchExecuteRequest, SearchExecuteResult> = {
  channel: 'search:execute',
  requestRule,
  responseRule,
}
