import { searchExecute } from '@/lib/electron-api'
import { mapSearchResultToLeadItem } from '@/lib/lead-mappers'
import { useAutopilotStore, type AutopilotJob } from '@/store/autopilot-store'
import { getLeadUniqueKey, useLeadsStore } from '@/store/leads-store'

const INTERRUPT_POLL_MS = 250
const SAVE_LEAD_DELAY_MS = 150
const BATCH_PROGRESS_COUNT = 5
const BATCH_PROGRESS_INTERVAL_MS = 500
const RATE_LIMIT_BASE_COOLDOWN_MS = 60_000
const MAX_JOB_ATTEMPTS = 3
const MAX_CONSECUTIVE_FAILURES = 3

let runnerPromise: Promise<void> | null = null
let runnerRunId: string | null = null

type ErrorCategory = 'fatal' | 'rate_limit' | 'transient' | 'unknown'

const isCurrentRun = (runId: string) => useAutopilotStore.getState().runtime.runId === runId

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const classifyError = (error: unknown): { category: ErrorCategory; message: string } => {
  const message = error instanceof Error ? error.message : String(error || '静默获客执行失败')
  const normalized = message.toLowerCase()

  if (/401|403|license|授权|token|api key|missing config|配置缺失|forbidden|unauthorized/.test(normalized)) {
    return { category: 'fatal', message }
  }
  if (/429|quota|rate limit|too many requests|额度/.test(normalized)) {
    return { category: 'rate_limit', message }
  }
  if (/timeout|timed out|econnreset|enet|socket|fetch failed|network|temporar|5\d\d/.test(normalized)) {
    return { category: 'transient', message }
  }
  return { category: 'unknown', message }
}

const getRuntimeFlags = () => {
  const runtime = useAutopilotStore.getState().runtime
  return {
    abortRequested: runtime.abortRequested,
    pauseRequested: runtime.pauseRequested,
    lifecycle: runtime.lifecycle,
  }
}

const syncLifecycleFromFlags = (runId: string) => {
  if (!isCurrentRun(runId)) {
    return true
  }

  const { abortRequested, pauseRequested } = getRuntimeFlags()
  if (abortRequested) {
    useAutopilotStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        lifecycle: 'idle',
        currentJobId: undefined,
        finishedAt: Date.now(),
      },
    }))
    return true
  }

  if (pauseRequested) {
    useAutopilotStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        lifecycle: 'paused',
        currentJobId: undefined,
      },
    }))
    return true
  }

  return false
}

const pickNextPendingJob = () => {
  const { jobs } = useAutopilotStore.getState()
  return jobs.find((job) => job.status === 'pending')
}

const markJobRunning = async (runId: string, job: AutopilotJob) => {
  if (!isCurrentRun(runId)) {
    return false
  }

  await useAutopilotStore.getState().updateJobProgress(job.id, {
    status: 'running',
    startedAt: Date.now(),
    lastError: undefined,
    cooldownUntil: undefined,
  })

  useAutopilotStore.setState((state) => ({
    runtime: {
      ...state.runtime,
      lifecycle: 'running',
      currentJobId: job.id,
      lastError: undefined,
    },
  }))
  return isCurrentRun(runId)
}

const finalizeJob = async (runId: string, jobId: string, patch: Partial<AutopilotJob>) => {
  if (!isCurrentRun(runId)) {
    return false
  }

  await useAutopilotStore.getState().updateJobProgress(jobId, {
    ...patch,
    finishedAt: patch.status === 'completed' || patch.status === 'failed' ? Date.now() : undefined,
  })

  useAutopilotStore.setState((state) => ({
    runtime: {
      ...state.runtime,
      currentJobId: state.runtime.currentJobId === jobId ? undefined : state.runtime.currentJobId,
    },
  }))
  return isCurrentRun(runId)
}

const requeueJob = async (runId: string, jobId: string, patch: Partial<AutopilotJob>) => {
  if (!isCurrentRun(runId)) {
    return false
  }

  await useAutopilotStore.getState().updateJobProgress(jobId, {
    status: 'pending',
    cooldownUntil: undefined,
    ...patch,
  })

  useAutopilotStore.setState((state) => ({
    runtime: {
      ...state.runtime,
      currentJobId: state.runtime.currentJobId === jobId ? undefined : state.runtime.currentJobId,
    },
  }))
  return isCurrentRun(runId)
}

const pauseWithReason = async (runId: string, reason: string) => {
  if (!isCurrentRun(runId)) {
    return false
  }

  await useAutopilotStore.getState().pause()
  useAutopilotStore.setState((state) => ({
    runtime: {
      ...state.runtime,
      lifecycle: 'paused',
      currentJobId: undefined,
      lastError: reason,
    },
  }))
  return isCurrentRun(runId)
}

const stopWithFatalError = async (runId: string, reason: string) => {
  if (!isCurrentRun(runId)) {
    return false
  }

  await useAutopilotStore.getState().stop()
  useAutopilotStore.setState((state) => ({
    runtime: {
      ...state.runtime,
      abortRequested: true,
      lifecycle: 'error',
      currentJobId: undefined,
      lastError: reason,
      finishedAt: Date.now(),
    },
  }))
  return isCurrentRun(runId)
}

const interruptibleSleep = async (runId: string, ms: number) => {
  const totalMs = Math.max(0, ms)
  let elapsed = 0

  while (elapsed < totalMs) {
    if (syncLifecycleFromFlags(runId)) {
      return false
    }

    const chunk = Math.min(INTERRUPT_POLL_MS, totalMs - elapsed)
    await sleep(chunk)
    elapsed += chunk
  }

  return !syncLifecycleFromFlags(runId)
}

const filterQualifiedResults = (job: AutopilotJob, results: Awaited<ReturnType<typeof searchExecute>>['results']) => {
  const leadsStore = useLeadsStore.getState()
  const existingLeadKeys = new Set(leadsStore.leads.map((lead) => getLeadUniqueKey(lead)))
  const accepted = [] as typeof results
  let dedupedCount = 0

  for (const result of results) {
    const score = Number.isFinite(Number(result.matchScore)) ? Number(result.matchScore) : 0
    if (score < job.threshold) {
      continue
    }

    const mapped = mapSearchResultToLeadItem(result, {
      country: job.country,
      industry: job.keyword,
    })
    const uniqueKey = getLeadUniqueKey(mapped)
    if (existingLeadKeys.has(uniqueKey)) {
      dedupedCount += 1
      continue
    }

    existingLeadKeys.add(uniqueKey)
    accepted.push(result)

    if (accepted.length >= job.targetLeads) {
      break
    }
  }

  return {
    qualifiedResults: accepted,
    dedupedCount,
  }
}

const flushSavedProgress = async (
  runId: string,
  jobId: string,
  payload: { savedCount: number; qualifiedCount: number; discoveredCount: number },
  force = false,
) => {
  if (!isCurrentRun(runId)) {
    return false
  }

  await useAutopilotStore.getState().updateJobProgress(jobId, payload)
  return force ? isCurrentRun(runId) : true
}

const saveQualifiedLeads = async (
  runId: string,
  job: AutopilotJob,
  qualifiedResults: Awaited<ReturnType<typeof searchExecute>>['results'],
  discoveredCount: number,
) => {
  const { addLead } = useLeadsStore.getState()
  let savedCount = 0
  let pendingSinceFlush = 0
  let lastFlushAt = Date.now()

  for (const result of qualifiedResults) {
    if (!isCurrentRun(runId) || syncLifecycleFromFlags(runId)) {
      break
    }

    const mappedLead = mapSearchResultToLeadItem(result, {
      country: job.country,
      industry: job.keyword,
    })

    await addLead(mappedLead)
    if (!isCurrentRun(runId)) {
      return savedCount
    }

    savedCount += 1
    pendingSinceFlush += 1

    const shouldFlush =
      pendingSinceFlush >= BATCH_PROGRESS_COUNT || Date.now() - lastFlushAt >= BATCH_PROGRESS_INTERVAL_MS
    if (shouldFlush) {
      await flushSavedProgress(runId, job.id, {
        savedCount,
        qualifiedCount: qualifiedResults.length,
        discoveredCount,
      })
      pendingSinceFlush = 0
      lastFlushAt = Date.now()
    }

    await sleep(SAVE_LEAD_DELAY_MS)
  }

  await flushSavedProgress(
    runId,
    job.id,
    {
      savedCount,
      qualifiedCount: qualifiedResults.length,
      discoveredCount,
    },
    true,
  )

  return savedCount
}

const computeBackoffMs = (attempts: number, baseMs: number) => baseMs * Math.max(1, 2 ** Math.max(0, attempts - 1))

const runSingleJob = async (runId: string, job: AutopilotJob) => {
  const canContinue = await markJobRunning(runId, job)
  if (!canContinue) {
    return false
  }

  const response = await searchExecute({
    keyword: job.keyword,
    country: job.country,
  })
  if (!isCurrentRun(runId)) {
    return false
  }

  const results = Array.isArray(response.results) ? response.results : []
  const { qualifiedResults, dedupedCount } = filterQualifiedResults(job, results)

  await useAutopilotStore.getState().updateJobProgress(job.id, {
    discoveredCount: results.length,
    qualifiedCount: qualifiedResults.length,
    dedupedCount,
    attempts: 0,
  })

  const savedCount = await saveQualifiedLeads(runId, job, qualifiedResults, results.length)

  if (!isCurrentRun(runId)) {
    return false
  }

  if (getRuntimeFlags().abortRequested || getRuntimeFlags().pauseRequested) {
    await requeueJob(runId, job.id, {
      lastError: getRuntimeFlags().abortRequested ? '任务已中断，等待重新启动' : '任务已暂停，等待继续执行',
    })
    return false
  }

  const hasNextPendingJob = Boolean(pickNextPendingJob())
  const cooldownMs = Math.max(0, useAutopilotStore.getState().settings.cooldownMs)

  await useAutopilotStore.getState().updateJobProgress(job.id, {
    status: hasNextPendingJob && cooldownMs > 0 ? 'cooldown' : 'completed',
    discoveredCount: results.length,
    qualifiedCount: qualifiedResults.length,
    savedCount,
    dedupedCount,
    attempts: 0,
    lastError: undefined,
    cooldownUntil: hasNextPendingJob && cooldownMs > 0 ? Date.now() + cooldownMs : undefined,
  })

  if (!hasNextPendingJob || cooldownMs === 0) {
    await finalizeJob(runId, job.id, {
      status: 'completed',
      cooldownUntil: undefined,
    })
    return true
  }

  const completedCooldown = await interruptibleSleep(runId, cooldownMs)
  if (!isCurrentRun(runId)) {
    return false
  }

  await useAutopilotStore.getState().updateJobProgress(job.id, {
    status: 'completed',
    cooldownUntil: undefined,
  })

  return completedCooldown
}

export const startAutopilotRunner = (runId: string) => {
  if (runnerPromise && runnerRunId === runId) {
    return runnerPromise
  }

  runnerPromise = null
  runnerRunId = runId

  runnerPromise = (async () => {
    let consecutiveFailures = 0

    try {
      while (true) {
        const { runtime, jobs, settings } = useAutopilotStore.getState()
        if (!isCurrentRun(runId) || runtime.lifecycle !== 'running') {
          break
        }

        if (syncLifecycleFromFlags(runId)) {
          break
        }

        const nextJob = jobs.find((job) => job.status === 'pending')
        if (!nextJob) {
          useAutopilotStore.setState((state) => ({
            runtime: {
              ...state.runtime,
              lifecycle: 'completed',
              currentJobId: undefined,
              finishedAt: Date.now(),
            },
          }))
          break
        }

        try {
          const shouldContinue = await runSingleJob(runId, nextJob)
          if (!shouldContinue) {
            break
          }
          consecutiveFailures = 0
        } catch (error) {
          const { category, message } = classifyError(error)
          const latestJob = useAutopilotStore.getState().jobs.find((job) => job.id === nextJob.id) || nextJob
          const nextAttempts = (latestJob.attempts || 0) + 1
          consecutiveFailures += 1

          if (!isCurrentRun(runId)) {
            break
          }

          if (category === 'fatal') {
            await finalizeJob(runId, nextJob.id, {
              status: 'failed',
              failedCount: nextJob.failedCount + 1,
              lastError: `致命错误：${message}`,
            })
            await stopWithFatalError(runId, `静默巡航已停止：${message}`)
            break
          }

          const shouldTripBreaker = nextAttempts > MAX_JOB_ATTEMPTS || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
          if (shouldTripBreaker) {
            await requeueJob(runId, nextJob.id, {
              attempts: nextAttempts,
              lastError: `触发熔断保护：${message}`,
            })
            await pauseWithReason(
              runId,
              nextAttempts > MAX_JOB_ATTEMPTS
                ? `任务 ${nextJob.country} | ${nextJob.keyword} 连续失败超过 ${MAX_JOB_ATTEMPTS} 次，系统已自动暂停。`
                : `系统连续出现 ${MAX_CONSECUTIVE_FAILURES} 次异常，已自动暂停巡航保护网络信誉。`,
            )
            break
          }

          if (category === 'rate_limit') {
            const cooldownMs = computeBackoffMs(
              nextAttempts,
              Math.max(settings.cooldownMs, RATE_LIMIT_BASE_COOLDOWN_MS),
            )
            await requeueJob(runId, nextJob.id, {
              attempts: nextAttempts,
              lastError: `触发限流保护，${Math.ceil(cooldownMs / 1000)} 秒后自动重试。原因：${message}`,
            })
            useAutopilotStore.setState((state) => ({
              runtime: {
                ...state.runtime,
                lifecycle: 'running',
                currentJobId: undefined,
                lastError: `限流冷却中，预计 ${Math.ceil(cooldownMs / 1000)} 秒后继续：${message}`,
              },
            }))
            const shouldResume = await interruptibleSleep(runId, cooldownMs)
            if (!shouldResume) {
              break
            }
            continue
          }

          const transientCooldownMs = computeBackoffMs(nextAttempts, Math.max(settings.cooldownMs, 15_000))
          await requeueJob(runId, nextJob.id, {
            attempts: nextAttempts,
            lastError: `网络波动，${Math.ceil(transientCooldownMs / 1000)} 秒后重试（第 ${nextAttempts} 次）。原因：${message}`,
          })
          useAutopilotStore.setState((state) => ({
            runtime: {
              ...state.runtime,
              lifecycle: 'running',
              currentJobId: undefined,
              lastError: `巡航重试中：${message}`,
            },
          }))
          const shouldResume = await interruptibleSleep(runId, transientCooldownMs)
          if (!shouldResume) {
            break
          }
        }
      }

      const finalState = useAutopilotStore.getState()
      if (isCurrentRun(runId) && finalState.runtime.lifecycle === 'running') {
        useAutopilotStore.setState((state) => ({
          runtime: {
            ...state.runtime,
            lifecycle: pickNextPendingJob() ? state.runtime.lifecycle : 'completed',
            currentJobId: undefined,
            finishedAt: pickNextPendingJob() ? state.runtime.finishedAt : Date.now(),
          },
        }))
      }
    } finally {
      if (runnerRunId === runId) {
        runnerPromise = null
        runnerRunId = null
      }
    }
  })()

  return runnerPromise
}

export { interruptibleSleep }
