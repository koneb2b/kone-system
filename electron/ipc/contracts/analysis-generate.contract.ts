/**
 * analysis:generate IPC 合约
 *
 * 分析生成通道的请求/响应类型定义与运行时校验规则。
 */

import type { Contract, FieldRule } from './types'

// ── 类型定义 ──────────────────────────────────────

export type AnalysisScenario = 'direct_quote' | 'competitor_switch' | 'factory_strength' | 'reply_coach'

export interface AnalysisGenerateRequest {
  lead: {
    company?: string
    website?: string
    snippet?: string
    industry?: string
    country?: string
  }
  scenario: AnalysisScenario
  customerText?: string
  language?: string
}

export interface AnalysisSemanticMeta {
  code: string
  degraded?: boolean
  mockMode?: boolean
  settingsActionable?: boolean
  source?: string
  degradedReason?: string
}

export interface AnalysisGenerateData {
  semantic?: AnalysisSemanticMeta
  content?: string
  suggestion?: string
  analysis?: string
}

// ── 校验规则 ──────────────────────────────────────

const requestRule: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    lead: {
      type: 'object',
      required: true,
      fields: {
        company: { type: 'string', required: false, max: 200 },
        website: { type: 'string', required: false, max: 500 },
        snippet: { type: 'string', required: false, max: 5000 },
        industry: { type: 'string', required: false, max: 100 },
        country: { type: 'string', required: false, max: 100 },
      },
    },
    scenario: {
      type: 'string',
      required: true,
      pattern: /^(direct_quote|competitor_switch|factory_strength|reply_coach)$/,
    },
    customerText: { type: 'string', required: false, max: 10000 },
    language: { type: 'string', required: false, max: 20 },
  },
}

const responseRule: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    semantic: {
      type: 'object',
      required: false,
      fields: {
        code: { type: 'string', required: true },
        degraded: { type: 'boolean', required: false },
        mockMode: { type: 'boolean', required: false },
        settingsActionable: { type: 'boolean', required: false },
        source: { type: 'string', required: false },
        degradedReason: { type: 'string', required: false },
      },
    },
    content: { type: 'string', required: false },
    suggestion: { type: 'string', required: false },
    analysis: { type: 'string', required: false },
  },
}

// ── 合约导出 ──────────────────────────────────────

export const analysisGenerateContract: Contract<AnalysisGenerateRequest, AnalysisGenerateData> = {
  channel: 'analysis:generate',
  requestRule,
  responseRule,
}
