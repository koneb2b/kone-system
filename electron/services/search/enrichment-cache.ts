/**
 * enrichment-cache.ts — 联系人补全的**字段级去重缓存**（Step 3）
 *
 * ## 解决什么（2026-10-16 数据链路审计 D-5 / Step 3「不重复购买已有且仍有效的数据」）
 * 富化调用按**域名**发起。同一家公司在不同轮次搜索、不同关键词下会被反复命中，
 * 每次都会重新消耗 Prospeo/Apollo 额度。`serpapi-cache.ts` / `llm-score-cache.ts`
 * 已为搜索与评分做了这件事，**但富化层没有对应机制**。
 *
 * ## 设计约束（与既有缓存保持一致）
 * - **仅内存**，绝不落盘（与 `serpapi-cache.ts` 同原则；且避免把第三方 PII 写入磁盘副本）。
 * - 键为**稳定的字段级去重键** `provider|domain|field`（Step 3 要求），
 *   与「域名归一」共用 `extractDomainFromUrl`，避免 `www.` / 大小写造成的重复购买。
 * - TTL **按数据类型区分**（Step 3 要求「按供应商条款及数据类型设置缓存期限」）：
 *   身份（姓名/职位）变化慢 → 长 TTL；邮箱/手机可能失效 → 短 TTL。
 * - 命中返回**深拷贝**，防调用方改写污染缓存。
 * - 超容量 FIFO 逐出。
 *
 * ## 与「缓存命中不消耗额度」的关系
 * 命中本缓存时调用方**根本不发起 HTTP 请求**，因此天然不消耗供应商额度；
 * 该次命中会在成本账本中记为 `fromCache: true`（计入调用次数、不计费）。
 */

import type { EnrichmentField, EnrichmentProviderId } from '../../../src/shared/enrichment-cost'
import { extractDomainFromUrl } from './text-utils'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 按**数据类型**设置的缓存期限。
 *
 * 取值理由（保守优先，宁可少复用也不交付过期联系方式）：
 * - `identity`（姓名/职位/公司归属）：组织变动以月计 → 30 天；
 * - `email` / `mobile`：人员离职/换号会快速使数据失效 → 14 天。
 *
 * 说明：具体期限**尚未逐家比对供应商条款**（审计报告 §7.3 已列为待核实项）；
 * 在条款核实前取偏保守值，且缓存**仅存在于本机内存**、不跨设备传播。
 */
export const ENRICHMENT_CACHE_TTL_MS: Record<EnrichmentField, number> = {
  identity: 30 * DAY_MS,
  email: 14 * DAY_MS,
  mobile: 14 * DAY_MS,
}

const CACHE_MAX_ENTRIES = 500

type CacheEntry = { value: unknown; expiresAt: number }

const cache = new Map<string, CacheEntry>()
let hits = 0
let misses = 0

export const getEnrichmentCacheStats = () => ({ hits, misses, size: cache.size })

/** 稳定的**字段级去重键**：`provider|domain|field`。域名缺失时回退公司名小写归一。 */
export const buildEnrichmentCacheKey = (
  provider: EnrichmentProviderId,
  domainOrCompany: string,
  field: EnrichmentField,
): string => {
  const normalized =
    extractDomainFromUrl(String(domainOrCompany || '')) ||
    String(domainOrCompany || '')
      .trim()
      .toLowerCase()
  return `${provider}|${normalized}|${field}`
}

/** 命中返回深拷贝；未命中/已过期返回 `undefined`。 */
export const getEnrichmentCached = <T>(key: string): T | undefined => {
  const entry = cache.get(key)
  if (!entry) {
    misses += 1
    return undefined
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    misses += 1
    return undefined
  }
  hits += 1
  return JSON.parse(JSON.stringify(entry.value)) as T
}

/** 写入缓存；超容量按 FIFO 逐出最旧条目。`ttlMs` 缺省按字段类别推导。 */
export const setEnrichmentCached = (key: string, value: unknown, ttlMs?: number): void => {
  const field = key.split('|')[2] as EnrichmentField
  const ttl =
    typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : ENRICHMENT_CACHE_TTL_MS[field] || ENRICHMENT_CACHE_TTL_MS.email
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, { value, expiresAt: Date.now() + ttl })
}

export const clearEnrichmentCache = (): void => {
  cache.clear()
  hits = 0
  misses = 0
}
