/**
 * search/scoring.ts — ICP 评分与评分提示词
 *
 * O1 拆分（P5）：从 `search-service.ts` 抽出的评分基元与提示词构造。
 * 覆盖 Stage-1 确定性 40/30/20/10 预筛分（`computeIcpMatchScore`）、
 * Stage-2 结构化机会分（`OpportunityScore` / `normalizeOpportunityScore`）、
 * 白名单序列化（`applySchemaDefaults`）与评分提示词。
 * 纯函数，无 Electron/网络依赖，可独立定向单测。
 */

import * as crypto from 'crypto'
import { matchesProductTerm } from './scout'
import { clampInt, extractDomainFromUrl, mergePromptParts } from './text-utils'
import type { OpportunityScore, SearchExecuteResult } from './types'

/* ── S4a（2026-10-13）：用户自定义「负向 ICP」的**确定性护栏** ──────────────
 *
 * ## 为什么需要
 * `negativeIcp` 此前**只出现在 LLM 评分 prompt**（`buildSearchScoringPrompt`）里，属**软约束** ——
 * LLM 完全可能忽略它，把明显不符合的线索仍打高分，从而进入 Agent 管道浪费触达额度。
 *
 * ## 为什么用「封顶降权」而非「直接剔除」
 * 用户输入的负向词是**自由文本**，误伤风险不可忽略。封顶让线索**仍然可见**（透明、可人工复核），
 * 但**无法跨过 `matchScore >= 60` 的 Agent 管道门槛** —— 既不误伤，也不放过。
 * 纯函数，导出供测试。
 */

/** 命中负向 ICP 时的分数上限（低于管道门槛 60 → 不进入自动触达）。 */
export const NEGATIVE_ICP_SCORE_CAP = 20

/** 解析用户负向 ICP 自由文本为词项（逗号/顿号/分号/竖线/换行分隔；去空白，剔除 <2 字符项）。 */
export const parseNegativeIcpTerms = (negativeIcp?: string): string[] => {
  const raw = String(negativeIcp || '').trim()
  if (!raw) return []
  return Array.from(
    new Set(
      raw
        .split(/[,，、;；|\n\r]+/)
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length >= 2),
    ),
  )
}

/** 该线索命中哪些负向 ICP 词项（返回命中项，便于**可解释**展示；未命中返回空数组）。 */
export const matchNegativeIcp = (candidate: Partial<SearchExecuteResult>, negativeIcp?: string): string[] => {
  const terms = parseNegativeIcpTerms(negativeIcp)
  if (terms.length === 0) return []
  const text = [candidate.company, candidate.snippet, candidate.reason, (candidate.matchReasons || []).join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!text) return []
  return terms.filter((term) => text.includes(term))
}

/**
 * 应用负向 ICP **封顶**：命中即把 `matchScore` 封顶到 `NEGATIVE_ICP_SCORE_CAP`，
 * 并追加**可解释**的 `riskFlags`（写明命中了哪个词）。未命中时**原样返回**（零副作用）。
 */
export const applyNegativeIcpPenalty = <T extends Partial<SearchExecuteResult>>(lead: T, negativeIcp?: string): T => {
  const hits = matchNegativeIcp(lead, negativeIcp)
  if (hits.length === 0) return lead
  const current = typeof lead.matchScore === 'number' ? lead.matchScore : null
  const capped = current === null ? NEGATIVE_ICP_SCORE_CAP : Math.min(current, NEGATIVE_ICP_SCORE_CAP)
  const flag = `命中负向 ICP：${hits.slice(0, 2).join('、')}`
  /* **前置**插入：`applySchemaDefaults` 只保留首个 riskFlag，前置才能保证
     「为什么被降权」这条**可解释信息**不被丢弃。 */
  const riskFlags = Array.from(new Set([flag, ...(lead.riskFlags || [])])).slice(0, 2)
  return { ...lead, matchScore: capped, riskFlags }
}

export const computeIcpMatchScore = (candidate: Partial<SearchExecuteResult>, coreProductTerms: string[]): number => {
  let score = 0
  const domain = extractDomainFromUrl(candidate.website)
  const hasWebsite = Boolean(domain)
  score += hasWebsite ? 40 : 10
  const text =
    `${candidate.company || ''} ${candidate.snippet || ''} ${candidate.reason || ''} ${(candidate.matchReasons || []).join(' ')}`.toLowerCase()
  const productMatch = coreProductTerms.some((term) => matchesProductTerm(text, term))
  score += productMatch ? 30 : 0
  const b2bSignals = ['wholesale', 'distribute', 'import', 'b2b', 'shop', 'dealer', 'supplier', 'manufacturer']
  const b2bHits = b2bSignals.filter((signal) => text.includes(signal))
  if (b2bHits.length >= 3) score += 20
  else if (b2bHits.length >= 1) score += 10
  /* §0.5 宪法算法（kone-PRD §L203）：联系人资产 = `contact || email || phone ||
     decisionMakers[].email || decisionMakers[].phone || decisionMakers[].linkedinUrl` 任一非空。
     此前实现漏了 decisionMakers 三项——仅有决策人邮箱/电话/领英的线索会少 10 分，
     可能被 `>= 60` 的 Gold Filter 挡在 Agent 管道之外（错失可触达线索）。 */
  const hasDecisionMakerContact = (candidate.decisionMakers || []).some((dm) =>
    Boolean(dm?.email || dm?.phone || dm?.linkedinUrl),
  )
  const hasContact = Boolean(candidate.contact || candidate.email || candidate.phone || hasDecisionMakerContact)
  score += hasContact ? 10 : 0
  return Math.min(100, Math.max(0, score))
}

/* P2-3 Stage-2 机会分模型（kone-PRD §0.5.1）：ICP Fit 55 + Intent(Why-Now) 35 +
   Evidence 10 − Risk Penalty(0-20)。钳制各维度并按公式重算 finalScore；
   输入缺失/非法 → undefined（诚实缺省，不臆造）。纯函数，导出供测试。
   `OpportunityScore` 类型见 ./types（P5 外提，避免子模块反向依赖）。 */
export const normalizeOpportunityScore = (raw: unknown): OpportunityScore | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const hasAnyField = ['icpFit', 'intent', 'evidence', 'riskPenalty', 'finalScore'].some((k) => obj[k] !== undefined)
  if (!hasAnyField) return undefined
  const icpFit = clampInt(obj.icpFit, 0, 55)
  const intent = clampInt(obj.intent, 0, 35)
  const evidence = clampInt(obj.evidence, 0, 10)
  const riskPenalty = clampInt(obj.riskPenalty, 0, 20)
  const finalScore = Math.max(0, Math.min(100, icpFit + intent + evidence - riskPenalty))
  return { icpFit, intent, evidence, riskPenalty, finalScore }
}

/**
 * 排序法典（kone-PRD §0.5.1 / §L145）：`matchScore` 降序，未评分项统一按 `-1` 兜底。
 *
 * 用途：确定性预评分（40/30/20/10）须"为**初始排序与预筛漏斗**服务"（L207）——
 * 在 LLM 评分前按此排序，保证 `slice(0, N)` 取到的是**最相关的前 N 条**，
 * 而非"按数据源合并顺序的前 N 条"。纯函数，导出供测试。
 */
export const rankByMatchScore = <T extends { matchScore?: number | null }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => {
    const scoreA = typeof a.matchScore === 'number' ? a.matchScore : -1
    const scoreB = typeof b.matchScore === 'number' ? b.matchScore : -1
    return scoreB - scoreA
  })

/**
 * `matchScore` 三态语义法典（kone-PRD §L147，V1.2 不变红线）：
 *   `undefined` = 未评分（Scout 骨架态）｜有效数字 = 已评分｜`null` = 上游判定无效值。
 * **任何映射层不得将 `undefined`/`null` 静默转换为 `0`**——0 分是"评估过且极差"，
 * 与"尚未评估"是完全不同的商业语义，混淆即破坏高潜推荐漏斗的可信度。
 *
 * 仍保留对**数字字符串**（如 LLM 偶发返回 `"85"`）的防御性转换；
 * 但空串（`''`）不得折算为 0（此前 `Number('')===0` 会误判为"0 分"）。
 */
export const normalizeMatchScore = (raw: unknown): number | null | undefined => {
  if (raw === null) return null
  if (typeof raw === 'string' && raw.trim() === '') return undefined
  const num = Number(raw)
  if (!Number.isFinite(num)) return undefined
  return Math.max(0, Math.min(100, num))
}

export const applySchemaDefaults = (item: Partial<SearchExecuteResult>): SearchExecuteResult => ({
  id: String(item.id || crypto.randomUUID()),
  company: String(item.company || '').trim(),
  website: String(item.website || '').trim(),
  contact: item.contact ? String(item.contact).trim() : '',
  contactTitle: item.contactTitle ? String(item.contactTitle).trim() : '',
  email: item.email ? String(item.email).trim() : '',
  phone: String(item.phone || '').trim(),
  /* 号码类型（WhatsApp 可用性）：来自 wa.me 直链的号码为 'mobile'；缺失时不臆造。 */
  phoneKind: item.phoneKind === 'mobile' || item.phoneKind === 'landline' ? item.phoneKind : undefined,
  /* 联系方式来源与可信度（三档）：透传，缺失时不臆造（前端诚实降级）。 */
  contactProvenance:
    item.contactProvenance && typeof item.contactProvenance === 'object' ? item.contactProvenance : undefined,
  address: String(item.address || '').trim(),
  isB2B: typeof item.isB2B === 'boolean' ? item.isB2B : (item.isB2B ?? undefined),
  source: String(item.source || '').trim() || 'Google Maps',
  reason: item.reason ? String(item.reason).trim() : '',
  matchReasons: Array.isArray(item.matchReasons)
    ? item.matchReasons
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 2)
    : [],
  riskFlags: Array.isArray(item.riskFlags)
    ? item.riskFlags
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 1)
    : [],
  /* L147 三态法典：null 保留为 null（不再静默转 0）；见 normalizeMatchScore */
  matchScore: normalizeMatchScore(item.matchScore),
  snippet: item.snippet ? String(item.snippet).trim() : undefined,
  fallbackStatus: item.fallbackStatus === 'social_blind_score' ? 'social_blind_score' : undefined,
  /* P1-3：以下五个字段此前在序列化时被丢弃，导致前端"跟进建议/推断角色"永久空白
     （src/hooks/use-search-engine.ts:552-559 与 search-result-card.tsx:175-184 依赖它们） */
  inferredRole: item.inferredRole ? String(item.inferredRole).trim() : undefined,
  salesStrategy: item.salesStrategy ? String(item.salesStrategy).trim() : undefined,
  country: item.country ? String(item.country).trim() : undefined,
  city: item.city ? String(item.city).trim() : undefined,
  status: item.status === 'contacting' || item.status === 'replied' || item.status === 'archived' ? item.status : 'new',
  /* P1-1 置信标识：评分来源（ai=LLM 评分 / deterministic=确定性 40/30/20/10 预筛分） */
  scoreSource: item.scoreSource === 'ai' ? 'ai' : item.scoreSource === 'deterministic' ? 'deterministic' : undefined,
  /* P2-3 结构化机会分透传（白名单序列化，非法输入在此归一/剔除） */
  opportunityScore: normalizeOpportunityScore(item.opportunityScore),
  dataSourceType: item.dataSourceType || 'google_maps',
  dataSourceNote: item.dataSourceNote ? String(item.dataSourceNote).trim() : undefined,
  exhibitionFootprints: Array.isArray(item.exhibitionFootprints) ? item.exhibitionFootprints : [],
  customsData:
    item.customsData &&
    typeof item.customsData === 'object' &&
    Object.keys(item.customsData as Record<string, unknown>).length > 0
      ? item.customsData
      : {},
  decisionMakers: Array.isArray(item.decisionMakers) ? item.decisionMakers : [],
  agentStatus:
    item.agentStatus &&
    typeof item.agentStatus === 'object' &&
    Object.keys(item.agentStatus as Record<string, unknown>).length > 0
      ? item.agentStatus
      : { whatsappSent: false, linkedinContacted: false, emailSequenceStage: 0 as const },
})

export const mapHttpError = (status: number, provider: string) => {
  if (status === 401 || status === 403) return `${provider} API 密钥无效或未授权，请检查设置`
  if (status === 429) return `${provider} API 调用额度已耗尽，请前往平台充值`
  if (status >= 500) return `${provider} 服务暂时拥堵，请稍后重试`
  return `${provider} HTTP ${status}`
}

export const buildSearchScoringSystemPrompt = () =>
  mergePromptParts(
    'You are a B2B lead ',
    'scoring analyst. ',
    'Score ALL candidates against the ICP. ',
    'DO NOT filter or remove any item. ',
    'If irrelevant, assign low score (0-20). ',
    'Return ALL items in valid JSON array with fields: ',
    'company, website, address, matchScore, matchReasons, riskFlags. ',
    'matchReasons must contain 1-2 short specific reasons why the lead fits the ICP. ',
    'riskFlags must contain exactly 1 short risk flag explaining why the lead might not be ideal, such as retail-focused, weak website, unclear B2B intent, or low procurement signal. ',
    'NEVER return empty if candidates > 0. ',
    'NEVER filter data.',
  )

export const buildUniversalIcpPrompt = (userConfig?: {
  icpProfile?: {
    targetProduct?: string
    buyerPersona?: string
    coreAdvantage?: string
    negativeIcp?: string
  }
}) => {
  const icpProfile = userConfig?.icpProfile || {}
  const targetProduct = String(icpProfile.targetProduct || '').trim() || '未提供'
  const buyerPersona = String(icpProfile.buyerPersona || '').trim() || '未提供'
  const coreAdvantage = String(icpProfile.coreAdvantage || '').trim() || '未提供'
  const negativeIcp = String(icpProfile.negativeIcp || '').trim() || '未提供'

  return mergePromptParts(
    'You are a senior B2B key account manager with 15 years of experience in global industrial sales. ',
    'Score every candidate against the ICP and return ONLY valid JSON. ',
    'You must output ONLY valid JSON. No explanations, no markdown tags. Strictly match the schema. ',
    /* P2-3 Stage-2 机会分模型（kone-PRD §0.5.1）：ICP Fit 55 + Intent(Why-Now) 35 + Evidence 10 − Risk Penalty 0-20。
       与 Stage-1 确定性 40/30/20/10 是分层关系，互不替代。 */
    'Evaluate with 4 dimensions: business synergy, role match, advantage resonance, and company strength. ',
    'Then derive a structured opportunityScore: icpFit (0-55: product application fit, distributor/importer/OEM positioning, regional coverage, purchasing capacity), intent (0-35: Why-Now buying signals such as RFQ/tender/new line/certification/expansion — 0 when no verifiable signal), evidence (0-10: strength of the cited evidence), riskPenalty (0-20: generic-email-only or info@ contact +5~10, no identified decision maker +5, minimal website +5). ',
    'finalScore = icpFit + intent + evidence − riskPenalty, clamped to 0-100. ',
    'If a candidate clearly matches the Negative ICP, set icpFit to 0 immediately and keep finalScore very low. ',
    `Target product: ${targetProduct}. `,
    `Preferred buyer role: ${buyerPersona}. `,
    `Core advantage: ${coreAdvantage}. `,
    `Negative ICP: ${negativeIcp}. `,
    'Do not remove any item. Return a top-level JSON object with key "results". ',
    'Each item must contain: company, website, address, totalScore, opportunityScore, inferredRole, matchReason, salesStrategy, riskFlags, isB2B. ',
    'totalScore must equal opportunityScore.finalScore (number 0-100). opportunityScore must be an object {icpFit, intent, evidence, riskPenalty, finalScore} of integers. ',
    'inferredRole must be a short inferred buying/company role. ',
    'matchReason must be one short conclusion. salesStrategy must be one short follow-up suggestion tied to the core advantage. ',
    'riskFlags must contain exactly 1 short risk flag. isB2B must be boolean. ',
    'Never invent contact names, emails, or phone numbers. Never output markdown or explanations outside JSON.',
  )
}

export const buildSearchScoringPrompt = (payload: {
  keyword: string
  icpProfile?: { targetProduct?: string; buyerPersona?: string; coreAdvantage?: string; negativeIcp?: string }
  candidates: Array<{ company: string; website: string; snippet?: string; reason?: string }>
}) => ({
  system: buildUniversalIcpPrompt({ icpProfile: payload.icpProfile }),
  user: JSON.stringify({
    keyword: payload.keyword,
    icpProfile: {
      targetProduct: payload.icpProfile?.targetProduct || '',
      buyerPersona: payload.icpProfile?.buyerPersona || '',
      coreAdvantage: payload.icpProfile?.coreAdvantage || '',
      negativeIcp: payload.icpProfile?.negativeIcp || '',
    },
    candidates: payload.candidates,
  }),
})
