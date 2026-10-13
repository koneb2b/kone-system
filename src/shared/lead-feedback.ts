/**
 * lead-feedback.ts — 用户「相关 / 不相关」反馈的单一事实源（**双端共用 SSOT**）
 *
 * ## 为什么需要（2026-10-13 S4c）
 * 「匹配精度」是 Kone 的核心价值。ICP 与 LLM 评分是**静态规则**，不会因用户判断而改进。
 * 本模块提供**用户反馈闭环**：用户标「不相关」的线索，下一轮不再被高分推荐；
 * 标「相关」的获得可见的正向信号。**全部本地、零成本、不上云**。
 *
 * ## 设计原则（与 `contact-provenance` 一脉相承）
 * - **诚实**：调整必须**可解释**（写入 `riskFlags` / `matchReasons`），**不得静默改分**。
 * - **保守**：不相关 → **封顶**（不直接剔除，仍可见可复核）；相关 → **小幅**加分（不虚高）。
 * - **可逆**：用户可改判（同 key 覆盖）。
 */

export type LeadFeedbackVerdict = 'relevant' | 'irrelevant'

export type LeadFeedbackEntry = {
  verdict: LeadFeedbackVerdict
  at: number
}

/** 反馈表：key = `deriveFeedbackKey(lead)`（域名优先，跨轮次稳定）。 */
export type LeadFeedbackMap = Record<string, LeadFeedbackEntry>

/** 命中「不相关」时的分数上限（低于 Agent 管道门槛 60 → 不再自动触达）。 */
export const FEEDBACK_IRRELEVANT_SCORE_CAP = 20

/** 命中「相关」时的**小幅**加分（保守，不虚高）。 */
export const FEEDBACK_RELEVANT_BONUS = 5

/** 反馈来源标注（可解释性，UI 与日志共用同一口径）。 */
export const FEEDBACK_IRRELEVANT_REASON = '你曾标记为「不相关」'
export const FEEDBACK_RELEVANT_REASON = '你曾标记为「相关」'

/**
 * 派生反馈键：**优先域名**（跨轮次、跨公司名改写都稳定），缺失时回退公司名小写。
 * 与搜索侧去重键同源（`extractDomainFromUrl`），保证反馈能命中同一实体。
 */
export const deriveFeedbackKey = (lead: { website?: string; company?: string }): string => {
  const website = String(lead?.website || '').trim()
  if (website) {
    try {
      const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
      const host = url.hostname.replace(/^www\./i, '').toLowerCase()
      if (host) return host
    } catch {
      /* 非法 URL → 回退公司名 */
    }
  }
  return String(lead?.company || '')
    .trim()
    .toLowerCase()
}

/**
 * 应用用户反馈调整（**纯函数、幂等、零副作用**）：
 * - `irrelevant` → `matchScore` **封顶**到 `FEEDBACK_IRRELEVANT_SCORE_CAP` + `riskFlags` 写明原因；
 * - `relevant`   → `matchScore` **加** `FEEDBACK_RELEVANT_BONUS`（上限 100）+ `matchReasons` 写明原因；
 * - 无反馈 → **原样返回**。
 *
 * 注：`riskFlags` 采用**前置**插入 —— 因为 `applySchemaDefaults` 只保留首项，
 * 前置才能保证"为什么被降权"这条**可解释信息**不被丢弃。
 */
export const applyFeedbackAdjustment = <
  T extends { matchScore?: number | null; riskFlags?: string[]; matchReasons?: string[] },
>(
  lead: T,
  feedback?: LeadFeedbackEntry,
): T => {
  if (!feedback) return lead
  const current = typeof lead.matchScore === 'number' ? lead.matchScore : null

  if (feedback.verdict === 'irrelevant') {
    const capped = current === null ? FEEDBACK_IRRELEVANT_SCORE_CAP : Math.min(current, FEEDBACK_IRRELEVANT_SCORE_CAP)
    return {
      ...lead,
      matchScore: capped,
      riskFlags: Array.from(new Set([FEEDBACK_IRRELEVANT_REASON, ...(lead.riskFlags || [])])).slice(0, 2),
    }
  }

  return {
    ...lead,
    ...(current === null ? {} : { matchScore: Math.min(100, current + FEEDBACK_RELEVANT_BONUS) }),
    matchReasons: Array.from(new Set([FEEDBACK_RELEVANT_REASON, ...(lead.matchReasons || [])])).slice(0, 2),
  }
}
