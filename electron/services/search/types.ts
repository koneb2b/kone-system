/**
 * search/types.ts — 搜索域共享类型
 *
 * O1 拆分（P5）：从 `search-service.ts` 抽出的本地类型定义，供 search 子模块
 * 与 search-service 共享（避免子模块反向 import search-service）。
 *
 * 注意：此处的 `SearchExecuteResult` 是 search-service 的**本地镜像类型**
 * （`id: string`、含 `reason?: string`），与 `src/shared/ipc-contracts.ts` 的
 * 同名类型**不完全相同**（后者 `id?: string` 且无 `reason`）。P1-3 注释要求
 * 二者字段对齐以防序列化丢字段，但当前仍是两份定义——统一为单一 SSOT 属后续
 * 独立重构项，本轮仅做**无损外提**，不改变任何类型语义。
 */

import type {
  AgentStatus,
  CustomsData,
  DataSourceType,
  DecisionMaker,
  OpportunityScoreRationale,
} from '../../../src/shared/ipc-contracts'
import type { PhoneKind } from '../../../src/shared/phone-kind'
import type { ContactProvenance } from '../../../src/shared/contact-provenance'
import type { EnrichmentCostSummary } from '../../../src/shared/enrichment-cost'

/* S4b：机会分逐维度评分依据（与 src/shared/ipc-contracts 同源），供本子模块与 scoring 共享。 */
export type { OpportunityScoreRationale }

/* P2-3 Stage-2 结构化机会分（55/35/10 − Risk Penalty） */
export type OpportunityScore = {
  icpFit: number
  intent: number
  evidence: number
  riskPenalty: number
  finalScore: number
  /* S4b（2026-10-16）：逐维度评分依据（引用官网原文片段 / 搜索命中），可解释可复核。
     缺失时不臆造 —— `normalizeOpportunityScore` 仅在存在有效依据时才落该键。 */
  rationale?: OpportunityScoreRationale
}

export type SearchExecuteResult = {
  id: string
  company: string
  website: string
  contact?: string
  contactTitle?: string
  email?: string
  phone: string
  /* 号码类型（WhatsApp 可用性）：来自网页 wa.me 直链的号码定义上为 mobile。
     P1-3 对齐要求：与 src/shared/ipc-contracts.ts 同名类型保持一致，防序列化丢字段。 */
  phoneKind?: PhoneKind
  /* 联系方式来源与可信度（三档）。P1-3 对齐要求：与 src/shared/ipc-contracts.ts 同名类型保持一致。 */
  contactProvenance?: ContactProvenance
  /* Step 3：本轮补全成本摘要（与 ipc-contracts 对齐） */
  enrichmentCost?: EnrichmentCostSummary
  address: string
  isB2B?: boolean | null
  source?: string
  reason?: string
  matchReasons?: string[]
  riskFlags?: string[]
  matchScore?: number | null
  snippet?: string
  inferredRole?: string
  salesStrategy?: string
  fallbackStatus?: 'social_blind_score'
  /* P1-1 置信标识: ai = LLM 评分；deterministic = 40/30/20/10 确定性预筛分。
     P1-3：与 src/shared/ipc-contracts.ts SearchExecuteResult 对齐，防止序列化丢字段 */
  scoreSource?: 'ai' | 'deterministic'
  /* P2-3 Stage-2 结构化机会分（55/35/10 − Risk Penalty） */
  opportunityScore?: OpportunityScore
  country?: string
  city?: string
  status?: 'new' | 'contacting' | 'replied' | 'archived'
  dataSourceType?: DataSourceType
  dataSourceNote?: string
  exhibitionFootprints?: string[]
  customsData?: CustomsData
  decisionMakers?: DecisionMaker[]
  agentStatus?: AgentStatus
}
