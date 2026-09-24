/**
 * search/llm-results.ts — LLM 评分结果的抽取与候选合并
 *
 * O1 拆分（P6）：从 `search-service.ts` 抽出的 LLM 响应解析与候选/评分合并。
 * 依赖 scoring（白名单序列化 + 机会分归一）、probe（探针日志）、text-utils（JSON 归一）。
 */

import { probeError, probeLog } from './probe'
import { applySchemaDefaults, normalizeOpportunityScore } from './scoring'
import { extractDomainFromUrl, normalizeLlmJsonText } from './text-utils'
import type { SearchExecuteResult } from './types'

export const extractLlmResults = (llmPayload: any) => {
  const content = llmPayload?.choices?.[0]?.message?.content || llmPayload?.choices?.[0]?.text || ''
  if (!content || typeof content !== 'string') return []
  try {
    const parsed = JSON.parse(normalizeLlmJsonText(content))
    const results = Array.isArray(parsed)
      ? parsed
      : parsed?.results ||
        parsed?.data?.results ||
        parsed?.candidates ||
        parsed?.data?.candidates ||
        parsed?.items ||
        parsed?.data?.items ||
        (parsed && typeof parsed === 'object' ? [parsed] : [])
    probeLog('[Probe-LLM-Parse] Extract results shape:', {
      contentPreview: content.slice(0, 240),
      parsedType: Array.isArray(parsed) ? 'array' : typeof parsed,
      resultCount: Array.isArray(results) ? results.length : 0,
      keys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 12) : [],
    })
    if (!Array.isArray(results)) return []
    return results.map((item: any) => ({
      ...applySchemaDefaults({
        ...item,
        matchScore: item?.totalScore ?? item?.matchScore,
        matchReasons: [item?.matchReason].filter(Boolean),
      }),
      inferredRole: String(item?.inferredRole || '').trim(),
      salesStrategy: String(item?.salesStrategy || '').trim(),
      riskFlags: Array.isArray(item?.riskFlags)
        ? item.riskFlags
            .map((entry: unknown) => String(entry || '').trim())
            .filter(Boolean)
            .slice(0, 1)
        : [],
      isB2B: typeof item?.isB2B === 'boolean' ? item.isB2B : undefined,
      /* P2-3 Stage-2 机会分结构化输出（非法/缺失 → undefined，不臆造） */
      opportunityScore: normalizeOpportunityScore(item?.opportunityScore),
    }))
  } catch (error) {
    probeError('[Probe-LLM-Parse-Error] Failed to parse scoring response:', {
      message: error instanceof Error ? error.message : String(error || ''),
      stack: error instanceof Error ? error.stack : '',
      contentPreview: content.slice(0, 500),
    })
    return []
  }
}

/* 候选归一结果的宽松结构类型（原为 `ReturnType<typeof normalizeSearchCandidates>`；
   P6 外提后改用等价结构类型，避免子模块反向依赖 search-service）。 */
export type NormalizedCandidate = Partial<SearchExecuteResult> & { company: string; website: string }

export const mergeLlmResultsWithCandidates = (candidates: NormalizedCandidate[], llmResults: SearchExecuteResult[]) => {
  const resultPool = Array.isArray(llmResults) ? llmResults : []
  const usedResultIndexes = new Set<number>()

  return candidates.map((candidate) => {
    const normalizedCandidateCompany = candidate.company.trim().toLowerCase()
    const normalizedCandidateWebsite = extractDomainFromUrl(candidate.website)

    const matchedIndex = resultPool.findIndex((result, index) => {
      if (usedResultIndexes.has(index)) return false
      const normalizedResultCompany = String(result.company || '')
        .trim()
        .toLowerCase()
      const normalizedResultWebsite = extractDomainFromUrl(result.website)

      if (
        normalizedCandidateWebsite &&
        normalizedResultWebsite &&
        normalizedCandidateWebsite === normalizedResultWebsite
      ) {
        return true
      }

      return normalizedCandidateCompany.length > 0 && normalizedCandidateCompany === normalizedResultCompany
    })

    const matched = matchedIndex >= 0 ? resultPool[matchedIndex] : null
    if (matchedIndex >= 0) {
      usedResultIndexes.add(matchedIndex)
    }

    return {
      ...applySchemaDefaults({
        ...candidate,
        ...matched,
        company: matched?.company || candidate.company,
        website: matched?.website || candidate.website,
        address: matched?.address || candidate.address,
        matchReasons:
          matched?.matchReasons ||
          [candidate.reason || candidate.snippet || '基础信息与搜索词存在一定相关性'].filter(Boolean).slice(0, 2),
        riskFlags: matched?.riskFlags || ['需人工复核其 B2B 采购意图'],
        snippet: matched?.snippet || candidate.snippet,
      }),
      inferredRole: matched?.inferredRole || '',
      salesStrategy: matched?.salesStrategy || '',
    }
  })
}
