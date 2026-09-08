/**
 * LLM ICP 评分结果内存缓存（成本优化 · 第二阶段）
 *
 * 背景：每次搜索对 `leadsForScoring`（≤ SEARCH_LLM_SCORE_LIMIT=50 条）逐条调用
 * LLM 评分。用户调整 ICP 参数后重搜、或连续搜索相似关键词时，同一家公司
 * （同一 domain / 归一化公司名）会被重复调用 LLM——这是评分阶段的重复成本主源。
 *
 * 设计约束：
 * - key 必须绑定 { ICP 指纹 + 关键词 + 公司指纹 } 三元组：
 *   ICP 或关键词变化 → key 不同 → 不复用旧评分，保证评估上下文一致。
 * - 仅缓存 LLM 语义字段（评分/理由/风险/策略），不含线索 UUID——命中后走
 *   与真实评分完全相同的 mergeLlmResultsWithCandidates + applySchemaDefaults
 *   合并路径，字段口径与新鲜评分零差异。
 * - 仅内存态，绝不落盘（线索业务数据不进磁盘，与 serpapi-cache 同原则）。
 * - TTL 24h；超容量 FIFO 逐出；命中返回深拷贝防调用方改写污染。
 * - 命中时进度条照常推进（emitLeadScored 仍按 completedCount 递增），
 *   用户体验与新鲜评分一致，且更快（零网络等待）。
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 500

interface LlmScoreCacheEntry {
  value: unknown
  expiresAt: number
}

const cache = new Map<string, LlmScoreCacheEntry>()
let hits = 0
let misses = 0

export const getLlmScoreCacheStats = () => ({ hits, misses, size: cache.size })

/** ICP 指纹：icpProfile 结构化字段序列化（字段变化即换 key，避免跨 ICP 误用评分） */
export const buildIcpFingerprint = (icpProfile?: {
  targetProduct?: string
  buyerPersona?: string
  coreAdvantage?: string
  negativeIcp?: string
}): string => {
  const profile = icpProfile || {}
  const payload = [
    String(profile.targetProduct || '')
      .trim()
      .toLowerCase(),
    String(profile.buyerPersona || '')
      .trim()
      .toLowerCase(),
    String(profile.coreAdvantage || '')
      .trim()
      .toLowerCase(),
    String(profile.negativeIcp || '')
      .trim()
      .toLowerCase(),
  ].join('|')
  return payload || '__empty_icp__'
}

/** 公司指纹：优先 domain，其次归一化公司名（与 mergeLeadFacts 的 key 同源语义） */
export const buildLeadFingerprint = (lead: { company?: string; website?: string; address?: string }): string => {
  const website = String(lead?.website || '').trim()
  const domain = extractDomain(website)
  if (domain) return `domain:${domain}`
  const company = String(lead?.company || '')
    .trim()
    .toLowerCase()
  const address = String(lead?.address || '')
    .trim()
    .toLowerCase()
  return company ? `company:${company}|${address}` : ''
}

/** 评分缓存 key：ICP + 关键词 + 公司三元组 */
export const buildLlmScoreCacheKey = (
  icpProfile: Parameters<typeof buildIcpFingerprint>[0],
  keyword: string,
  lead: { company?: string; website?: string; address?: string },
): string =>
  `${buildIcpFingerprint(icpProfile)}||${String(keyword || '')
    .trim()
    .toLowerCase()}||${buildLeadFingerprint(lead)}`

/** 命中返回深拷贝，未命中返回 undefined */
export const getLlmScoreCached = <T = unknown>(key: string): T | undefined => {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    misses += 1
    return undefined
  }
  hits += 1
  return JSON.parse(JSON.stringify(entry.value)) as T
}

/** 写入缓存；超容量 FIFO 逐出最旧条目 */
export const setLlmScoreCached = (key: string, value: unknown): void => {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

export const clearLlmScoreCache = (): void => {
  cache.clear()
  hits = 0
  misses = 0
}

/** 复用 serpapi-cache 的 domain 提取语义，独立实现避免跨模块依赖 */
const extractDomain = (value?: string): string => {
  try {
    const normalized = /^https?:\/\//i.test(value || '') ? value! : `https://${value}`
    return new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}
