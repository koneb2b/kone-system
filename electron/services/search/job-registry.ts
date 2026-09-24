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

let currentActiveJobId: string | null = null
const activeJobIds = new Map<number, string>()

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
}

/** 读取某 owner 的活跃 job（无则回退全局最新） */
export const getActiveJobIdFor = (ownerKey: number): string | null => activeJobIds.get(ownerKey) ?? currentActiveJobId
