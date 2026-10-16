/**
 * enrichment-cost.ts — 联系人补全的**调用记录与成本口径**（双端共用 SSOT）
 *
 * ## 为什么需要（2026-10-16 数据链路审计结论 D-5）
 * 审计发现：每轮搜索的富化预算（`ENRICH_LOOKUP_BUDGET` / `PROSPEO_*_BUDGET`）只是
 * `search-service.ts` 内的**函数局部变量**，搜索结束即消失；`getSerpApiCacheStats()` /
 * `getLlmScoreCacheStats()` 虽已实现却**无任何消费方**。结果是用户**完全无法追踪
 * API 支出**，也无法判断「这一轮到底买了什么、花了多少」。
 *
 * ## 设计原则（对齐审计纪律）
 * 1. **不伪造精确成本**：拿不到真实计费信息时 `cost` 必须为 `null`（未知），
 *    绝不用估算值冒充实际消耗。
 * 2. **计费单位必须显式**：不同供应商单位不同（Prospeo/Apollo = credit，
 *    SerpApi = request，官网抓取 = free），**不得跨单位求和**。
 * 3. **缓存命中不消耗额度**：`fromCache: true` 的记录计入调用次数，但不计费。
 * 4. **纯类型 + 纯函数**：无 Electron / 网络依赖，可独立单测。
 */

/** 参与联系人补全的供应方（含非付费来源，便于如实展示「免费」）。 */
export type EnrichmentProviderId = 'prospeo' | 'apollo' | 'serpapi' | 'website' | 'llm'

/** 计费单位。`free` = 本地/无额度消耗；`unknown` = 无法确认计费口径。 */
export type EnrichmentBillingUnit = 'credit' | 'request' | 'free' | 'unknown'

/** 本次调用尝试补全的字段类别。 */
export type EnrichmentField = 'identity' | 'email' | 'mobile'

/**
 * 调用状态。`skipped_*` 一律表示**未发生真实请求**（未消耗额度），
 * 必须与 `miss`（请求了但无结果）区分——后者通常仍会计费。
 */
export type EnrichmentCallStatus =
  | 'hit'
  | 'miss'
  | 'error'
  | 'skipped_budget'
  | 'skipped_not_opted_in'
  | 'skipped_cache'
  | 'skipped_not_high_value'

export type EnrichmentCallRecord = {
  provider: EnrichmentProviderId
  field: EnrichmentField
  status: EnrichmentCallStatus
  /** epoch ms */
  at: number
  billingUnit: EnrichmentBillingUnit
  /** 可确认的费用（以 `billingUnit` 计）；**未知时为 `null`，绝不伪造** */
  cost: number | null
  /** 缓存命中：计入调用次数但不计费 */
  fromCache?: boolean
  detail?: string
}

/** 单条线索上的**成本摘要**（紧凑，随线索下发；完整流水留在账本模块）。 */
export type EnrichmentCostSummary = {
  /** 实际发起（或命中缓存）的调用次数 */
  calls: number
  /** 按计费单位分组、**可确认**的费用小计（如 `{ credit: 4, request: 2 }`） */
  byUnit: Record<string, number>
  /** 无法确认计费的调用次数（对应 `cost === null`） */
  unknownCostCalls: number
  /** 实际参与的供应方（去重） */
  providers: EnrichmentProviderId[]
}

/** 空摘要（无任何补全调用）。 */
export const EMPTY_ENRICHMENT_COST_SUMMARY: EnrichmentCostSummary = {
  calls: 0,
  byUnit: {},
  unknownCostCalls: 0,
  providers: [],
}

/** 该状态是否代表**真实发生了对外请求**（用于区分「跳过」与「尝试」）。 */
export const isRealCall = (status: EnrichmentCallStatus): boolean =>
  status === 'hit' || status === 'miss' || status === 'error'

/* ── 分级补全的用户授权开关（Step 2E）──────────────────────────────────────
 * 默认值即产品策略：**邮箱放行（低成本前置）、手机关闭（高成本，需显式开启）**。
 * 收敛到单一函数，避免主进程与渲染层各自硬编码默认值而漂移。
 */
export type EnrichmentOptions = { email: boolean; mobile: boolean }

export const DEFAULT_ENRICHMENT_OPTIONS: EnrichmentOptions = { email: true, mobile: false }

/** 解析请求中的补全开关；缺失/非法一律回落到**默认策略**（手机关闭）。 */
export const resolveEnrichmentOptions = (raw?: { email?: boolean; mobile?: boolean } | null): EnrichmentOptions => ({
  email: raw?.email !== false,
  mobile: raw?.mobile === true,
})

/**
 * 把调用流水**确定性**汇总为紧凑摘要。
 *
 * 规则：
 * - 跳过类状态（`skipped_*`）**不计入** `calls`，也不计费（它们没有发生请求）；
 * - `fromCache` 的记录计入 `calls`，但**不累加费用**（缓存命中不消耗额度）；
 * - `cost === null` 且是真实调用 → 计入 `unknownCostCalls`（如实标注未知）。
 */
export const summarizeEnrichmentCalls = (records: readonly EnrichmentCallRecord[]): EnrichmentCostSummary => {
  const byUnit: Record<string, number> = {}
  const providers = new Set<EnrichmentProviderId>()
  let calls = 0
  let unknownCostCalls = 0

  for (const record of records || []) {
    if (!record || !isRealCall(record.status)) continue
    calls += 1
    providers.add(record.provider)
    if (record.fromCache) continue
    if (record.cost === null || record.cost === undefined) {
      unknownCostCalls += 1
      continue
    }
    const unit = record.billingUnit || 'unknown'
    byUnit[unit] = (byUnit[unit] || 0) + record.cost
  }

  return { calls, byUnit, unknownCostCalls, providers: Array.from(providers) }
}
