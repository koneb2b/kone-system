/**
 * search/analysis.ts — 深度分析 / 回复教练 / 知识库选取
 *
 * O1 拆分（P7a）：从 `search-service.ts` 抽出的分析域逻辑——
 * 配置错误语义、降级语义、开发期 mock、分析/回复教练提示词与响应解析、知识库条目选取。
 */

import { app } from '../electron-bridge'
import { isTimeoutError } from '../proxy-service'
import { LANGUAGE_LABELS } from './intent'
import { mergePromptParts, normalizeLlmJsonText } from './text-utils'
import type { AnalysisSemanticCode, AnalysisSemanticMeta } from '../../../src/shared/ipc-contracts'

export const getAnalysisConfigError = (
  userConfig: any,
  llmKey: string,
  llmBaseUrl?: string,
): { message: string; semantic: AnalysisSemanticMeta } | null => {
  if (!llmKey) {
    return {
      message: '未检测到 AI API Key，请先前往系统设置完成配置',
      semantic: { code: 'missing_llm_key', settingsActionable: true },
    }
  }
  if (!llmBaseUrl) {
    return {
      message: '未检测到 AI Base URL，请先前往系统设置完成配置',
      semantic: { code: 'missing_llm_base_url', settingsActionable: true },
    }
  }

  const icpProfile = userConfig?.icpProfile || {}
  const hasIcpProfile = [icpProfile?.targetProduct, icpProfile?.buyerPersona, icpProfile?.coreAdvantage].some((value) =>
    String(value || '').trim(),
  )
  if (!hasIcpProfile) {
    return {
      message: '未检测到 ICP 目标画像，请先前往系统设置补全目标产品、买家角色或核心优势',
      semantic: { code: 'missing_icp_profile', settingsActionable: true },
    }
  }

  return null
}

export const buildAnalysisErrorResponse = (message: string, semantic: AnalysisSemanticMeta, code?: number) => ({
  success: false as const,
  error: message,
  code,
  meta: {
    analysisSemantic: semantic,
  },
})

export const shouldUseDevMockAnalysis = (semantic: AnalysisSemanticMeta) =>
  !app.isPackaged && semantic.settingsActionable === true

export const getAnalysisFailureSemantic = (error: unknown): AnalysisSemanticMeta => {
  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.toLowerCase()

  if (isTimeoutError(error) || /timeout|timed out|econn|enet|socket/.test(normalized)) {
    return { code: 'provider_timeout' }
  }

  if (/api key|base url|配置|provider|forbidden|unauthorized|http 4\d\d|http 5\d\d/.test(normalized)) {
    return { code: 'provider_unavailable' }
  }

  return { code: 'provider_unavailable' }
}

export const buildDevMockAnalysisData = (payload: {
  lead: any
  scenario: 'direct_quote' | 'competitor_switch' | 'factory_strength' | 'reply_coach'
  degradedReason: AnalysisSemanticCode
}) => {
  const company = String(payload.lead?.company || 'Target Account').trim() || 'Target Account'
  const website = String(payload.lead?.website || '').trim() || '官网公开信息'
  const snippet = String(payload.lead?.snippet || '').trim() || '公开行业资料'
  const semantic: AnalysisSemanticMeta = {
    code: 'dev_mock_active',
    degraded: true,
    mockMode: true,
    degradedReason: payload.degradedReason,
    source: payload.scenario === 'reply_coach' ? 'reply_coach' : 'dev_mock',
    settingsActionable: true,
  }

  if (payload.scenario === 'reply_coach') {
    const customerText =
      String(payload.lead?.customerText || '').trim() || 'Please share your best price and lead time.'
    return {
      semantic,
      content: `Hi ${company} team,\n\n感谢回复。为了给您更准确的价格与交期建议，能否请您补充采购数量、目标应用以及预计项目时间？\n\n如果方便，我们也可以先基于当前信息提供分档报价参考。\n\nBest regards,\nKone Team`,
      analysis: `${company} 当前更像是在试探价格和交期，而不是已经给出完整采购承诺。`,
      suggestion: '保持基础报价稳定，并用数量、时间线、样品确认来交换更优条件。',
      customerText,
      negotiationRisk: `${company} 当前更像是在试探价格和交期，而不是已经给出完整采购承诺。`,
      pricingAdvice: '保持基础报价稳定，并用数量、时间线、样品确认来交换更优条件。',
      replyTemplate: `Hi ${company} team,\n\n感谢回复。为了给您更准确的价格与交期建议，能否请您补充采购数量、目标应用以及预计项目时间？\n\n如果方便，我们也可以先基于当前信息提供分档报价参考。\n\nBest regards,\nKone Team`,
      nextAction: '继续推进',
      usedFallback: true,
      source: 'dev_mock',
    }
  }

  return {
    semantic,
    content: `${company} 当前可基于 ${website} 与 ${snippet} 生成开发模式模拟分析结果。`,
    companyProfile: `${company} 公开资料显示其正在围绕目标市场进行采购或渠道扩张。`,
    painPoints: '可能缺少更快的报价响应、更稳定的交期控制或更清晰的方案沟通。',
    valueMapping: '可强调更快 RFQ 响应、稳定交付、以及面向项目型采购的协同支持。',
    emailSubject: `关于 ${company} 的合作建议`,
    emailBody: `Hi ${company} team,\n\n我们基于公开信息注意到贵司在相关市场具备明确的采购/渠道拓展信号。若您当前正在寻找更快响应、稳定交付或更高协同效率的供应支持，我们可以基于具体项目需求提供更聚焦的建议。\n\n欢迎回复一个当前项目或 SKU，我们将进一步细化方案。`,
    confidence: 72,
    usedFallback: true,
    source: 'dev_mock',
  }
}

export const buildAnalysisSystemPrompt = (knowledgeBaseText: string, emailLanguage = 'en') => {
  const langLabel = LANGUAGE_LABELS[emailLanguage] || emailLanguage
  const emailLangInstr =
    emailLanguage === 'en'
      ? [
          'emailSubject must be a concise high-open-rate English subject line. ',
          'emailBody must be a professional English cold email body tailored to the target company, without markdown. ',
        ]
      : [
          `emailSubject must be a concise high-open-rate subject line written in ${langLabel}. `,
          `emailBody must be a professional cold email body written in ${langLabel}, tailored to the target company, without markdown. `,
          'Keep companyProfile/painPoints/valueMapping analysis fields in Chinese; only the email subject/body follow the target language. ',
        ]
  return mergePromptParts(
    'You are a world-class B2B export sales director and strategic account planner. ',
    'Your job is to analyze one target company and produce a conversion-ready outreach brief. ',
    'You must reason in three stages: 1) company profile and buying context, 2) map the customer pain points to the seller knowledge base, 3) generate a highly targeted outreach email. ',
    'Use the knowledge base as the primary source of seller strengths, products, differentiators, proof points, and messaging tone. ',
    'Never invent contacts, certifications, factories, purchase plans, or commercial facts that are not supported by the provided context. ',
    'If the context is weak, say so inside the relevant field instead of fabricating details. ',
    'Return ONLY valid JSON, with no markdown, code fences, commentary, or extra keys. ',
    'The JSON schema is strictly: ',
    '{"companyProfile":"string","painPoints":"string","valueMapping":"string","emailSubject":"string","emailBody":"string","confidence":0}. ',
    'companyProfile must summarize company scale cues, core business model, target market, and likely buying role in Chinese. ',
    "painPoints must infer the customer's likely operational or commercial pain points in Chinese. ",
    'valueMapping must explicitly map which seller advantage/product/knowledge point solves which customer pain point in Chinese. ',
    ...emailLangInstr,
    'confidence must be an integer from 0 to 100. ',
    'Keep static reasoning rules here; dynamic company and website data will be passed separately.\n\n',
    '[KNOWLEDGE BASE DATA:\n',
    knowledgeBaseText,
    '\n]',
  )
}

export const buildReplyCoachSystemPrompt = () =>
  mergePromptParts(
    'You are a top-tier B2B commercial negotiation expert. ',
    'Analyze the customer reply and the previous sales strategy. ',
    'Return ONLY valid JSON with keys: negotiationRisk, pricingAdvice, replyTemplate, nextAction. ',
    'negotiationRisk must deeply explain the hidden intent, risk points, and whether the customer is price testing, delaying, comparing suppliers, or showing genuine buying interest. ',
    'pricingAdvice must give concrete pricing game advice, such as holding price, tiered quotation, or exchanging better pricing for larger order commitment. ',
    'replyTemplate must be a ready-to-send professional English reply with clear logic and strong B2B tone. ',
    'nextAction must be a short Chinese action label for sales, 2-8 characters preferred, such as 继续推进, 建议索样, 换条件, 延后跟进. ',
    'Keep it practical, commercially sharp, and fully industry-agnostic. ',
    'Do not invent facts beyond the provided context.',
  )

export const buildAnalysisPrompt = (payload: {
  knowledgeBase: Array<{ title: string; content: string; tags?: string[] }>
  icpProfile: { targetProduct?: string; buyerPersona?: string; coreAdvantage?: string }
  lead: {
    company: string
    industry?: string
    country?: string
    website?: string
    address?: string
    phone?: string
    contact?: string
    contactTitle?: string
    snippet?: string
    matchReasons?: string[]
    riskFlags?: string[]
    inferredRole?: string
    source?: string
    salesStrategy?: string
  }
  scenario: 'direct_quote' | 'competitor_switch' | 'factory_strength'
  websiteText: string
  language?: string
}) => {
  const scenarioMap = {
    direct_quote: 'Direct Quote Entry',
    competitor_switch: 'Competitor Replacement',
    factory_strength: 'Factory Strength Proof',
  } as const
  const knowledgeBaseText = payload.knowledgeBase.length
    ? payload.knowledgeBase
        .map(
          (entry, index) =>
            `${index + 1}. ${entry.title}${entry.tags?.length ? ` [${entry.tags.join(', ')}]` : ''}\n${entry.content}`,
        )
        .join('\n\n')
    : '暂无知识库内容，请仅基于线索与网站信息分析。'
  return {
    system: buildAnalysisSystemPrompt(knowledgeBaseText, payload.language || 'en'),
    user: JSON.stringify({
      scenario: scenarioMap[payload.scenario],
      icpProfile: payload.icpProfile,
      lead: payload.lead,
      websiteText: payload.websiteText,
      requiredStages: {
        stage1: '拆解企业画像与买方角色',
        stage2: '映射知识库卖点与客户痛点',
        stage3: '生成主题与开发信正文',
      },
    }),
  }
}

export const buildReplyCoachPrompt = (payload: {
  icpProfile: { targetProduct?: string; buyerPersona?: string; coreAdvantage?: string; negativeIcp?: string }
  lead: {
    company: string
    industry?: string
    country?: string
    website?: string
    snippet?: string
    salesStrategy?: string
    customerText?: string
  }
}) => ({
  system: buildReplyCoachSystemPrompt(),
  user: JSON.stringify({
    icpProfile: payload.icpProfile,
    lead: {
      company: payload.lead.company,
      industry: payload.lead.industry || '',
      country: payload.lead.country || '',
      website: payload.lead.website || '',
      snippet: payload.lead.snippet || '',
    },
    previousSalesStrategy: payload.lead.salesStrategy || '',
    customerReply: payload.lead.customerText || '',
  }),
})

export const parseStructuredAnalysisResponse = (raw: string) => {
  const trimmed = typeof raw === 'string' ? normalizeLlmJsonText(raw) : ''
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    const emailBody = String(parsed?.emailBody || parsed?.content || '').trim()
    const confidenceValue = Number(parsed?.confidence)
    return {
      companyProfile: String(parsed?.companyProfile || '').trim(),
      painPoints: String(parsed?.painPoints || '').trim(),
      valueMapping: String(parsed?.valueMapping || '').trim(),
      emailSubject: String(parsed?.emailSubject || '').trim(),
      emailBody,
      confidence: Number.isFinite(confidenceValue)
        ? Math.max(0, Math.min(100, Math.round(confidenceValue)))
        : undefined,
      rawContent: trimmed,
      parseFallback: false,
      content: emailBody,
    }
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const fallbackBody = lines.slice(1).join('\n') || trimmed
    return {
      companyProfile: lines[0] || 'AI 分析中缺失该维度数据',
      painPoints: lines[1] || 'AI 分析中缺失该维度数据',
      valueMapping: lines[2] || 'AI 分析中缺失该维度数据',
      emailSubject: lines[3] || 'Following up on potential cooperation',
      emailBody: fallbackBody,
      confidence: undefined,
      rawContent: raw,
      parseFallback: true,
      content: fallbackBody,
    }
  }
}

export const parseReplyCoachResponse = (raw: string) => {
  const trimmed = typeof raw === 'string' ? normalizeLlmJsonText(raw) : ''
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    return {
      negotiationRisk: String(parsed?.negotiationRisk || '').trim(),
      pricingAdvice: String(parsed?.pricingAdvice || '').trim(),
      replyTemplate: String(parsed?.replyTemplate || '').trim(),
      nextAction: String(parsed?.nextAction || '').trim(),
      rawContent: trimmed,
      parseFallback: false,
    }
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return {
      negotiationRisk: lines[0] || trimmed.slice(0, 260),
      pricingAdvice: lines[1] || '建议先澄清需求范围、价格敏感点与采购体量，再决定是否采用阶梯报价。',
      replyTemplate: lines.slice(2).join('\n') || trimmed,
      nextAction: '继续推进',
      rawContent: raw,
      parseFallback: true,
    }
  }
}

const scenarioKnowledgeKeywords: Record<'direct_quote' | 'competitor_switch' | 'factory_strength', string[]> = {
  direct_quote: ['报价', '价格', '方案', '成本', 'quote'],
  competitor_switch: ['竞品', '替代', '对比', '替换', '竞争'],
  factory_strength: ['工厂', '产能', '交付', '认证', '制造', '实力'],
}

export const pickRelevantKnowledgeEntries = (
  entries: Array<{ title: string; content: string; tags?: string[] }>,
  scenario: 'direct_quote' | 'competitor_switch' | 'factory_strength',
  limit = 5,
) => {
  const keywords = scenarioKnowledgeKeywords[scenario] || []
  const scored = entries.map((entry) => {
    const text = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`.toLowerCase()
    const score = keywords.reduce((sum, keyword) => (text.includes(keyword.toLowerCase()) ? sum + 1 : sum), 0)
    return { entry, score }
  })

  const prioritized = scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.entry.content.length - a.entry.content.length
    })
    .map((item) => item.entry)

  const withHits = prioritized.filter((entry) => {
    const text = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`.toLowerCase()
    return keywords.some((keyword) => text.includes(keyword.toLowerCase()))
  })

  const fallback = prioritized.filter((entry) => !withHits.includes(entry))
  return [...withHits, ...fallback].slice(0, limit)
}
