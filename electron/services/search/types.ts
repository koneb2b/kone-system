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

import type { AgentStatus, CustomsData, DataSourceType, DecisionMaker } from '../../../src/shared/ipc-contracts'

/* P2-3 Stage-2 结构化机会分（55/35/10 − Risk Penalty） */
export type OpportunityScore = {
  icpFit: number
  intent: number
  evidence: number
  riskPenalty: number
  finalScore: number
}

export type SearchExecuteResult = {
  id: string
  company: string
  website: string
  contact?: string
  contactTitle?: string
  email?: string
  phone: string
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
