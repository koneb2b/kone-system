/**
 * enrichment-ledger.ts — 联系人补全的**调用流水账本**（Step 3）
 *
 * ## 解决什么（2026-10-16 数据链路审计 D-5）
 * 审计结论：**成本完全不可追踪** —— 预算计数器只是 `search-service.ts` 内的函数局部变量，
 * 搜索结束即消失；`getSerpApiCacheStats()` / `getLlmScoreCacheStats()` 已实现却无任何消费方。
 * 用户既看不到「这一轮买了什么」，也看不到「花了多少」。
 *
 * ## 设计原则（对齐审计纪律）
 * 1. **只记录事实**：`provider` / `field` / `status` / `at` / `billingUnit` / `cost` 六要素。
 * 2. **未知即未知**：拿不到真实计费信息时 `cost` 写 `null`，**绝不用估算值冒充实际消耗**。
 * 3. **跳过不等于调用**：`skipped_*`（未 opt-in / 超预算 / 命中缓存）与 `miss`（请求了但无结果）
 *    语义完全不同 —— 后者通常仍会计费，必须可区分。
 * 4. **有界**：内存保留最近 `MAX_LEDGER_RECORDS` 条，避免长会话内存膨胀。
 *
 * ## 持久化现状（诚实标注）
 * 当前**仅内存**（与 `serpapi-cache` / `llm-score-cache` 同原则）。
 * 跨会话留存需要在 `user_config` 落盘，属后续工作；本模块不假装已持久化。
 */

import type {
  EnrichmentCallRecord,
  EnrichmentCallStatus,
  EnrichmentField,
  EnrichmentProviderId,
} from '../../../src/shared/enrichment-cost'
import { summarizeEnrichmentCalls } from '../../../src/shared/enrichment-cost'

const MAX_LEDGER_RECORDS = 500

let ledger: EnrichmentCallRecord[] = []

export type RecordEnrichmentCallInput = {
  provider: EnrichmentProviderId
  field: EnrichmentField
  status: EnrichmentCallStatus
  /** 计费单位；缺省 `unknown`（未知，不猜） */
  billingUnit?: EnrichmentCallRecord['billingUnit']
  /** 可确认费用；**未知传 `null` 或不传**（缺省即 `null`） */
  cost?: number | null
  fromCache?: boolean
  detail?: string
  now?: number
}

/**
 * 记录一次补全调用（**永不抛错**：账本是可观测性设施，不得反过来中断搜索）。
 */
export const recordEnrichmentCall = (input: RecordEnrichmentCallInput): EnrichmentCallRecord | null => {
  try {
    const record: EnrichmentCallRecord = {
      provider: input.provider,
      field: input.field,
      status: input.status,
      at: typeof input.now === 'number' ? input.now : Date.now(),
      billingUnit: input.billingUnit || 'unknown',
      cost: typeof input.cost === 'number' ? input.cost : null,
      fromCache: input.fromCache,
      detail: input.detail,
    }
    ledger.push(record)
    if (ledger.length > MAX_LEDGER_RECORDS) ledger = ledger.slice(ledger.length - MAX_LEDGER_RECORDS)
    return record
  } catch {
    return null
  }
}

export const getEnrichmentLedger = (): EnrichmentCallRecord[] => ledger.slice()

export const clearEnrichmentLedger = (): void => {
  ledger = []
}

/** 汇总当前账本（供可观测性 / 测试使用）。 */
export const summarizeEnrichmentLedger = () => summarizeEnrichmentCalls(ledger)
