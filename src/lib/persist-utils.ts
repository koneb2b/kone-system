/**
 * Shared throttled persister factory.
 * Eliminates duplicate `electron-store` IPC serialization patterns across stores.
 *
 * Usage:
 *   const persister = createThrottledPersister({
 *     persist: (data) => myIpcSave(data),
 *     throttleMs: 1000,
 *   })
 *   persister.persist({ key: 'value' })   // throttled save
 *   persister.destroy()                     // cleanup timer on unmount
 */

export type ThrottledPersister<T> = {
  persist: (data: T) => void
  flush: () => Promise<void>
  destroy: () => void
}

export type ThrottledPersisterOptions<T> = {
  persist: (data: T) => Promise<void>
  throttleMs: number
}

export function createThrottledPersister<T>(options: ThrottledPersisterOptions<T>): ThrottledPersister<T> {
  const { persist: persistFn, throttleMs } = options
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastPersistAt = 0
  let pendingData: T | null = null
  let inFlight: Promise<void> | null = null

  const doPersist = async (data: T) => {
    try {
      await persistFn(data)
    } catch (error) {
      console.error('[Persist] write failed:', error)
    }
  }

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pendingData !== null && !inFlight) {
      const data = pendingData
      pendingData = null
      lastPersistAt = Date.now()
      inFlight = doPersist(data)
      await inFlight
      inFlight = null
    }
    // If another persist was queued while we were flushing, run it too
    if (pendingData !== null) {
      return flush()
    }
  }

  const persist = (data: T) => {
    pendingData = data
    if (inFlight) {
      // Back-pressure: data will be picked up after current write completes
      return
    }
    const now = Date.now()
    const elapsed = now - lastPersistAt
    const delay = elapsed >= throttleMs ? 0 : throttleMs - elapsed

    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => {
      timer = null
      if (pendingData !== null) {
        const data = pendingData
        pendingData = null
        lastPersistAt = Date.now()
        inFlight = doPersist(data)
        inFlight.finally(() => {
          inFlight = null
          // If new data arrived during write, schedule another persist
          if (pendingData !== null) {
            persist(pendingData)
          }
        })
      }
    }, delay)
  }

  const destroy = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    pendingData = null
  }

  return { persist, flush, destroy }
}
