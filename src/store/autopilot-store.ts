import { create } from 'zustand'
import type { AutopilotStateKind } from '@/shared/ipc-contracts'
import { clearLegacyAutopilotConfig, getAutopilotConfig, setAutopilotConfig } from '@/lib/autopilot-config'
import { createThrottledPersister } from '@/lib/persist-utils'

export type AutopilotLifecycle = 'idle' | 'running' | 'paused' | 'completed' | 'error'

export type AutopilotJobStatus = 'pending' | 'running' | 'cooldown' | 'completed' | 'failed'

export type AutopilotJob = {
  id: string
  keyword: string
  country: string
  targetLeads: number
  threshold: number
  attempts: number
  status: AutopilotJobStatus
  discoveredCount: number
  qualifiedCount: number
  savedCount: number
  dedupedCount: number
  failedCount: number
  lastError?: string
  startedAt?: number
  updatedAt?: number
  finishedAt?: number
  cooldownUntil?: number
}

export type AutopilotRuntime = {
  runId: string
  lifecycle: AutopilotLifecycle
  currentJobId?: string
  totalJobs: number
  completedJobs: number
  failedJobs: number
  totalDiscovered: number
  totalQualified: number
  totalSaved: number
  totalDeduped: number
  abortRequested: boolean
  pauseRequested: boolean
  startedAt?: number
  updatedAt?: number
  finishedAt?: number
  lastError?: string
}

export type AutopilotSettings = {
  cooldownMs: number
  scoreThreshold: number
  persistThrottleMs: number
}

type AutopilotPersistedState = {
  draftText: string
  jobs: AutopilotJob[]
  runtime: AutopilotRuntime
  settings: AutopilotSettings
}

type JobProgressPatch = Partial<
  Pick<
    AutopilotJob,
    | 'status'
    | 'attempts'
    | 'discoveredCount'
    | 'qualifiedCount'
    | 'savedCount'
    | 'dedupedCount'
    | 'failedCount'
    | 'lastError'
    | 'startedAt'
    | 'finishedAt'
    | 'cooldownUntil'
  >
>

type AutopilotState = {
  draftText: string
  jobs: AutopilotJob[]
  runtime: AutopilotRuntime
  settings: AutopilotSettings
  hydrated: boolean
  stateKind: AutopilotStateKind
  statusReason?: string
  hydrateFromStorage: () => Promise<void>
  setDraftText: (draftText: string) => Promise<void>
  addBatchJobs: (rawText: string) => Promise<AutopilotJob[]>
  start: () => Promise<void>
  pause: () => Promise<void>
  stop: () => Promise<void>
  stopAndClear: () => Promise<void>
  updateJobProgress: (jobId: string, data: JobProgressPatch) => Promise<void>
  reset: () => Promise<void>
}

const DEFAULT_COOLDOWN_MS = 30_000
const DEFAULT_SCORE_THRESHOLD = 60
const DEFAULT_PERSIST_THROTTLE_MS = 1_000

const defaultSettings: AutopilotSettings = {
  cooldownMs: DEFAULT_COOLDOWN_MS,
  scoreThreshold: DEFAULT_SCORE_THRESHOLD,
  persistThrottleMs: DEFAULT_PERSIST_THROTTLE_MS,
}

const defaultRuntime: AutopilotRuntime = {
  runId: '',
  lifecycle: 'idle',
  totalJobs: 0,
  completedJobs: 0,
  failedJobs: 0,
  totalDiscovered: 0,
  totalQualified: 0,
  totalSaved: 0,
  totalDeduped: 0,
  abortRequested: false,
  pauseRequested: false,
}

// Shared throttled persister — replaces module-level persistTimer + lastPersistAt globals
const autopilotPersister = createThrottledPersister({
  persist: (data) => setAutopilotConfig(data),
  throttleMs: DEFAULT_PERSIST_THROTTLE_MS,
})

const createJobId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `autopilot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const createRunId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const clampInteger = (value: number, minimum = 0) => {
  if (!Number.isFinite(value)) return minimum
  return Math.max(minimum, Math.floor(value))
}

const normalizeSettings = (input?: Partial<AutopilotSettings>): AutopilotSettings => ({
  cooldownMs: clampInteger(Number(input?.cooldownMs), 0) || DEFAULT_COOLDOWN_MS,
  scoreThreshold: Math.max(0, Math.min(100, clampInteger(Number(input?.scoreThreshold), 0) || DEFAULT_SCORE_THRESHOLD)),
  persistThrottleMs: clampInteger(Number(input?.persistThrottleMs), 1) || DEFAULT_PERSIST_THROTTLE_MS,
})

const normalizeRuntime = (input?: Partial<AutopilotRuntime>): AutopilotRuntime => ({
  ...defaultRuntime,
  ...input,
  runId: String(input?.runId || ''),
  lifecycle: input?.lifecycle || defaultRuntime.lifecycle,
  totalJobs: clampInteger(Number(input?.totalJobs), 0),
  completedJobs: clampInteger(Number(input?.completedJobs), 0),
  failedJobs: clampInteger(Number(input?.failedJobs), 0),
  totalDiscovered: clampInteger(Number(input?.totalDiscovered), 0),
  totalQualified: clampInteger(Number(input?.totalQualified), 0),
  totalSaved: clampInteger(Number(input?.totalSaved), 0),
  totalDeduped: clampInteger(Number(input?.totalDeduped), 0),
  abortRequested: Boolean(input?.abortRequested),
  pauseRequested: Boolean(input?.pauseRequested),
})

const normalizeJob = (job: Partial<AutopilotJob>, settings: AutopilotSettings): AutopilotJob => ({
  id: String(job.id || createJobId()),
  keyword: String(job.keyword || '').trim(),
  country: String(job.country || '').trim(),
  targetLeads: Math.max(1, clampInteger(Number(job.targetLeads), 1) || 1),
  threshold: Math.max(0, Math.min(100, clampInteger(Number(job.threshold), 0) || settings.scoreThreshold)),
  attempts: clampInteger(Number(job.attempts), 0),
  status: job.status || 'pending',
  discoveredCount: clampInteger(Number(job.discoveredCount), 0),
  qualifiedCount: clampInteger(Number(job.qualifiedCount), 0),
  savedCount: clampInteger(Number(job.savedCount), 0),
  dedupedCount: clampInteger(Number(job.dedupedCount), 0),
  failedCount: clampInteger(Number(job.failedCount), 0),
  lastError: job.lastError ? String(job.lastError) : undefined,
  startedAt: Number.isFinite(Number(job.startedAt)) ? Number(job.startedAt) : undefined,
  updatedAt: Number.isFinite(Number(job.updatedAt)) ? Number(job.updatedAt) : undefined,
  finishedAt: Number.isFinite(Number(job.finishedAt)) ? Number(job.finishedAt) : undefined,
  cooldownUntil: Number.isFinite(Number(job.cooldownUntil)) ? Number(job.cooldownUntil) : undefined,
})

const buildPersistedState = (
  state: Pick<AutopilotState, 'draftText' | 'jobs' | 'runtime' | 'settings'>,
): AutopilotPersistedState => ({
  draftText: state.draftText,
  jobs: state.jobs,
  runtime: state.runtime,
  settings: state.settings,
})

const recalculateRuntimeTotals = (jobs: AutopilotJob[], runtime: AutopilotRuntime): AutopilotRuntime => ({
  ...runtime,
  totalJobs: jobs.length,
  completedJobs: jobs.filter((job) => job.status === 'completed').length,
  failedJobs: jobs.filter((job) => job.status === 'failed').length,
  totalDiscovered: jobs.reduce((sum, job) => sum + job.discoveredCount, 0),
  totalQualified: jobs.reduce((sum, job) => sum + job.qualifiedCount, 0),
  totalSaved: jobs.reduce((sum, job) => sum + job.savedCount, 0),
  totalDeduped: jobs.reduce((sum, job) => sum + job.dedupedCount, 0),
  updatedAt: Date.now(),
})

const normalizeAutopilotLine = (line: string) =>
  line
    .replace(/[|，\t]/g, ',')
    .replace(/\s*,\s*/g, ',')
    .trim()

const splitAutopilotSegments = (line: string) => {
  const normalized = normalizeAutopilotLine(line)
  if (!normalized) return []

  const commaSegments = normalized
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (commaSegments.length >= 2) {
    return commaSegments
  }

  const whitespaceSegments = normalized
    .split(/\s{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
  return whitespaceSegments.length >= 2 ? whitespaceSegments : []
}

const parseBatchLine = (line: string, threshold: number): AutopilotJob | null => {
  const trimmed = line.trim()
  if (!trimmed) return null

  const segments = splitAutopilotSegments(trimmed)
  if (segments.length < 2) return null

  const [country, keyword, targetText] = segments
  if (!country || !keyword) return null

  const parsedTarget = clampInteger(Number(targetText), 1)

  return {
    id: createJobId(),
    country,
    keyword,
    targetLeads: parsedTarget || 1,
    threshold,
    attempts: 0,
    status: 'pending',
    discoveredCount: 0,
    qualifiedCount: 0,
    savedCount: 0,
    dedupedCount: 0,
    failedCount: 0,
    updatedAt: Date.now(),
  }
}

export const useAutopilotStore = create<AutopilotState>((set, get) => ({
  draftText: '',
  jobs: [],
  runtime: defaultRuntime,
  settings: defaultSettings,
  hydrated: false,
  stateKind: 'hydrating',
  statusReason: undefined,

  hydrateFromStorage: async () => {
    try {
      const envelope = await getAutopilotConfig<Partial<AutopilotPersistedState>>()
      const persisted = envelope?.state
      const nextSettings = normalizeSettings(persisted?.settings)
      const draftText = String(persisted?.draftText || '')
      const nextJobs = Array.isArray(persisted?.jobs)
        ? persisted.jobs.map((job) => normalizeJob(job, nextSettings))
        : []
      const persistedRuntime = normalizeRuntime(persisted?.runtime)
      const nextRuntime = recalculateRuntimeTotals(nextJobs, {
        ...persistedRuntime,
        lifecycle: persistedRuntime.lifecycle === 'running' ? 'paused' : persistedRuntime.lifecycle,
        pauseRequested: persistedRuntime.lifecycle === 'running' ? false : persistedRuntime.pauseRequested,
        abortRequested: false,
        currentJobId: undefined,
      })
      const derivedStateKind =
        envelope?.stateKind === 'state_unavailable'
          ? 'state_unavailable'
          : nextJobs.length === 0
            ? 'ready_empty'
            : nextRuntime.lifecycle === 'paused'
              ? 'paused'
              : nextRuntime.lifecycle === 'running'
                ? 'running'
                : nextRuntime.lifecycle === 'completed'
                  ? 'completed'
                  : nextRuntime.lifecycle === 'error'
                    ? 'error'
                    : 'queued_idle'

      set({
        draftText,
        jobs: nextJobs,
        runtime: nextRuntime,
        settings: nextSettings,
        hydrated: true,
        stateKind: derivedStateKind,
        statusReason: envelope?.statusReason,
      })
      await clearLegacyAutopilotConfig()
      return
    } catch (error) {
      console.error(error)
    }

    set({
      draftText: '',
      jobs: [],
      runtime: defaultRuntime,
      settings: defaultSettings,
      hydrated: true,
      stateKind: 'state_unavailable',
      statusReason: '巡航状态读取失败',
    })
  },

  setDraftText: async (draftText) => {
    const state = get()
    const nextDraftText = String(draftText || '')
    set({ draftText: nextDraftText })
    autopilotPersister.persist(
      buildPersistedState({
        draftText: nextDraftText,
        jobs: state.jobs,
        runtime: state.runtime,
        settings: state.settings,
      }),
    )
  },

  addBatchJobs: async (rawText) => {
    const state = get()
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const newJobs = lines
      .map((line) => parseBatchLine(line, state.settings.scoreThreshold))
      .filter((job): job is AutopilotJob => Boolean(job))

    const nextJobs = [...state.jobs, ...newJobs]
    const nextRuntime = recalculateRuntimeTotals(nextJobs, {
      ...state.runtime,
      lifecycle: nextJobs.length > 0 && state.runtime.lifecycle === 'completed' ? 'idle' : state.runtime.lifecycle,
      finishedAt: nextJobs.length > 0 ? undefined : state.runtime.finishedAt,
      lastError: undefined,
    })

    set({
      jobs: nextJobs,
      runtime: nextRuntime,
      stateKind: nextJobs.length === 0 ? 'ready_empty' : 'queued_idle',
      statusReason: undefined,
    })
    autopilotPersister.persist(
      buildPersistedState({
        draftText: state.draftText,
        jobs: nextJobs,
        runtime: nextRuntime,
        settings: state.settings,
      }),
    )
    return newJobs
  },

  start: async () => {
    const state = get()
    if (state.jobs.length === 0) {
      return
    }

    const nextRuntime = recalculateRuntimeTotals(state.jobs, {
      ...state.runtime,
      runId: createRunId(),
      lifecycle: 'running',
      abortRequested: false,
      pauseRequested: false,
      startedAt: state.runtime.startedAt || Date.now(),
      finishedAt: undefined,
      lastError: undefined,
    })

    set({ runtime: nextRuntime, stateKind: 'running', statusReason: undefined })
    autopilotPersister.persist(
      buildPersistedState({
        draftText: state.draftText,
        jobs: state.jobs,
        runtime: nextRuntime,
        settings: state.settings,
      }),
    )

    // 同步等待 runner 加载并启动，确保启动失败时能向调用方抛出异常
    try {
      const { startAutopilotRunner } = await import('@/lib/autopilot-runner')
      void startAutopilotRunner(nextRuntime.runId)
    } catch (error) {
      const failedRuntime = recalculateRuntimeTotals(get().jobs, {
        ...get().runtime,
        lifecycle: 'error',
        lastError: error instanceof Error ? error.message : '后台巡航启动失败',
        finishedAt: Date.now(),
      })
      set({ runtime: failedRuntime, stateKind: 'error', statusReason: failedRuntime.lastError })
      autopilotPersister.persist(
        buildPersistedState({
          draftText: get().draftText,
          jobs: get().jobs,
          runtime: failedRuntime,
          settings: get().settings,
        }),
      )
      throw error
    }
  },

  pause: async () => {
    const state = get()
    const nextRuntime = recalculateRuntimeTotals(state.jobs, {
      ...state.runtime,
      pauseRequested: true,
    })

    set({ runtime: nextRuntime, stateKind: state.jobs.length === 0 ? 'ready_empty' : 'paused' })
    autopilotPersister.persist(
      buildPersistedState({
        draftText: state.draftText,
        jobs: state.jobs,
        runtime: nextRuntime,
        settings: state.settings,
      }),
    )
  },

  stop: async () => {
    const state = get()
    const nextRuntime = recalculateRuntimeTotals(state.jobs, {
      ...state.runtime,
      abortRequested: true,
      pauseRequested: false,
    })

    set({ runtime: nextRuntime, stateKind: state.jobs.length === 0 ? 'ready_empty' : 'error' })
    autopilotPersister.persist(
      buildPersistedState({
        draftText: state.draftText,
        jobs: state.jobs,
        runtime: nextRuntime,
        settings: state.settings,
      }),
    )
  },

  stopAndClear: async () => {
    const state = get()
    const nextRuntime = {
      ...defaultRuntime,
      runId: createRunId(),
      updatedAt: Date.now(),
      finishedAt: Date.now(),
    }
    set({ draftText: '', jobs: [], runtime: nextRuntime, stateKind: 'ready_empty', statusReason: undefined })
    autopilotPersister.persist(
      buildPersistedState({ draftText: '', jobs: [], runtime: nextRuntime, settings: state.settings }),
    )
  },

  updateJobProgress: async (jobId, data) => {
    const state = get()
    if (!state.jobs.some((job) => job.id === jobId)) {
      return
    }
    const now = Date.now()
    const nextJobs = state.jobs.map((job) => {
      if (job.id !== jobId) return job
      return normalizeJob(
        {
          ...job,
          ...data,
          updatedAt: now,
        },
        state.settings,
      )
    })

    const currentJob = nextJobs.find((job) => job.id === jobId)
    const allSettled =
      nextJobs.length > 0 && nextJobs.every((job) => job.status === 'completed' || job.status === 'failed')
    const hasFailures = nextJobs.some((job) => job.status === 'failed')
    const nextRuntime = recalculateRuntimeTotals(nextJobs, {
      ...state.runtime,
      currentJobId: currentJob ? jobId : state.runtime.currentJobId,
      lifecycle: allSettled
        ? hasFailures
          ? 'error'
          : 'completed'
        : currentJob?.status === 'failed'
          ? 'error'
          : state.runtime.lifecycle,
      lastError: currentJob?.lastError || state.runtime.lastError,
      finishedAt: allSettled ? now : undefined,
    })

    set({
      jobs: nextJobs,
      runtime: nextRuntime,
      stateKind: allSettled
        ? hasFailures
          ? 'error'
          : 'completed'
        : currentJob?.status === 'cooldown'
          ? 'cooldown'
          : nextRuntime.lifecycle === 'paused'
            ? 'paused'
            : nextJobs.length === 0
              ? 'ready_empty'
              : nextRuntime.lifecycle === 'running'
                ? 'running'
                : 'queued_idle',
      statusReason: nextRuntime.lastError,
    })
    autopilotPersister.persist(
      buildPersistedState({
        draftText: state.draftText,
        jobs: nextJobs,
        runtime: nextRuntime,
        settings: state.settings,
      }),
    )
  },

  reset: async () => {
    const nextRuntime = { ...defaultRuntime, runId: createRunId() }
    set({
      draftText: '',
      jobs: [],
      runtime: nextRuntime,
      settings: defaultSettings,
      stateKind: 'ready_empty',
      statusReason: undefined,
    })
    autopilotPersister.persist(
      buildPersistedState({ draftText: '', jobs: [], runtime: nextRuntime, settings: defaultSettings }),
    )
  },
}))
