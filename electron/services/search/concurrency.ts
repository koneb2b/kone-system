/**
 * search/concurrency.ts — 有界并发调度器
 *
 * O1 拆分（P2）：从 `search-service.ts` 抽出的两个有界并发助手。纯函数，无副作用。
 * 调度语义：游标分配任务、按索引回填结果以保证顺序与入参一致（真并发调度）。
 *
 * 注（架构债 O13）：同名 `runLimitedConcurrency` 目前在 `agent-service.ts` 与
 * `sandbox-service.ts` 各有一份**独立副本**（未共享）。后续阶段应上提为
 * `electron/utils/concurrency.ts` 共享模块，消除三处重复。本阶段先做 search 域收敛。
 */

export const runLimitedConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) => {
  let currentIndex = 0
  const normalizedLimit = Math.max(1, Math.min(limit, items.length || 1))

  const runner = async () => {
    while (true) {
      const index = currentIndex
      if (index >= items.length) return
      currentIndex += 1
      await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: normalizedLimit }, () => runner()))
}

/* P1-2：结果版有界并发——与 runLimitedConcurrency 相同的调度语义，
   但回传结果数组且**严格按入参顺序对齐**（按索引回填）。
   用于搜索扇出（关键词变体），使并发受控而结果排序不漂移。 */
export const mapLimitedConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let currentIndex = 0
  const normalizedLimit = Math.max(1, Math.min(limit, items.length || 1))

  const runner = async () => {
    while (true) {
      const index = currentIndex
      if (index >= items.length) return
      currentIndex += 1
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: normalizedLimit }, () => runner()))
  return results
}
