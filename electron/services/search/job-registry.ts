/**
 * search/job-registry.ts — 活跃搜索作业注册表（时间隔离）
 *
 * O1 拆分（P8）：从 `search-service.ts` 抽出的活跃作业状态与判定原语。
 *
 * **架构价值**：本模块是 search 域与 Provider 之间的**中立依赖点**。此前 7 个 Provider 通过
 * `await import('../search-service')` 反向回引 search-service（因 search-service 又依赖
 * provider-service，构成循环依赖，靠动态 import 在加载期打破）。抽到本模块后，
 * Provider 与 search-service 均静态依赖 job-registry，**循环依赖消除**。
 *
 * 语义（P3-2 多窗口时空隔离）：
 *   - `activeJobIds`: ownerKey（sender WebContents id）→ 最新 jobId（多窗口并发按 owner 解析）
 *   - `currentActiveJobId`: 全局最新 job（单窗口语义 + 旧路径回退，始终指向最新 job）
 */

import { SEARCH_TOTAL_TIMEOUT_MS } from './constants'

let currentActiveJobId: string | null = null
const activeJobIds = new Map<number, string>()

/* 每个 job 的启动时刻 —— 用于**总时长硬上限**判定。
   各阶段虽有独立超时，但串行累加后可远超用户可接受范围
   （代码原注释已自承最坏路径 25 分钟以上）。
   实测 2026-10-11：LLM 上游 503 熔断后搜索**永久卡住**（日志停 5 分钟以上、
   前端一直「搜索中」、无取消入口），用户唯一出路是重启应用。 */
const jobStartedAt = new Map<string, number>()

/** 全局最新活跃 job（兼容旧路径） */
export const getCurrentActiveJobId = () => currentActiveJobId

/** 判定某 jobId 是否为**任一**窗口的活跃 job */
export const isKnownActiveJobId = (jobId: string | undefined): boolean => {
  if (!jobId) return false
  if (jobId === currentActiveJobId) return true
  for (const value of activeJobIds.values()) {
    if (value === jobId) return true
  }
  return false
}

/** 登记某 owner 的最新活跃 job，并同步全局最新（兼容） */
export const registerActiveJob = (ownerKey: number, jobId: string): void => {
  activeJobIds.set(ownerKey, jobId)
  currentActiveJobId = jobId
  jobStartedAt.set(jobId, Date.now())
  /* 清理已不被任何 owner 引用的旧时间戳，避免长会话下 Map 无限增长 */
  if (jobStartedAt.size > 64) {
    const live = new Set<string>([...activeJobIds.values(), jobId])
    for (const key of jobStartedAt.keys()) {
      if (!live.has(key)) jobStartedAt.delete(key)
    }
  }
}

/** 读取某 owner 的活跃 job（无则回退全局最新）。
 *
 * **总超时保护**：超过 `SEARCH_TOTAL_TIMEOUT_MS` 后返回 `null`（视为过期），
 * 使主流程中所有 `if (myJobId !== activeJobIdFor()) break` 检查点**自动退出**，
 * 用已得结果完成本轮 —— 把「可能永久等待」变成「最多等 5 分钟」。 */
export const getActiveJobIdFor = (ownerKey: number): string | null => {
  const jobId = activeJobIds.get(ownerKey) ?? currentActiveJobId
  if (!jobId) return null
  const startedAt = jobStartedAt.get(jobId)
  if (startedAt !== undefined && Date.now() - startedAt > SEARCH_TOTAL_TIMEOUT_MS) {
    return null
  }
  return jobId
}
