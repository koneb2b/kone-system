/**
 * SerpApi 响应内存缓存（成本优化）
 *
 * 背景：SerpApi 免费额度约 250 次/月，而单次多语言搜索会产生数十次调用。
 * 同一关键词组合（engine+query+location+start）在一次会话内多次搜索时
 * （例如调整 ICP 参数后重搜、多语言变体词近似重合），响应高度可复用。
 *
 * 设计约束：
 * - 仅内存缓存（绝不落盘）——缓存键直接使用请求 URL，其中含 api_key，
 *   任何磁盘持久化都会导致密钥泄露，故严格内存态。
 * - TTL 24h；超过容量按 FIFO 逐出最旧条目。
 * - 仅缓存 HTTP 200 且解析成功的响应；缓存命中返回深拷贝，防调用方改写。
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 200

interface SerpApiCacheEntry {
  json: unknown
  expiresAt: number
}

const cache = new Map<string, SerpApiCacheEntry>()
let hits = 0
let misses = 0

export const getSerpApiCacheStats = () => ({ hits, misses, size: cache.size })

/** 尝试命中缓存；命中返回深拷贝，未命中返回 undefined */
export const getSerpApiCached = (url: string): unknown | undefined => {
  const entry = cache.get(url)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(url)
    misses += 1
    return undefined
  }
  hits += 1
  return JSON.parse(JSON.stringify(entry.json))
}

/** 写入缓存；超容量时按 FIFO 逐出最旧条目 */
export const setSerpApiCached = (url: string, json: unknown): void => {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(url, { json, expiresAt: Date.now() + CACHE_TTL_MS })
}

export const clearSerpApiCache = (): void => {
  cache.clear()
  hits = 0
  misses = 0
}
