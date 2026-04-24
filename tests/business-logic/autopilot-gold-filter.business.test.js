const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { transpileTypeScriptModule } = require('./helpers.js')

const autopilotRunnerPath = path.join(process.cwd(), 'src', 'lib', 'autopilot-runner.ts')
const autopilotState = {
  runtime: {
    runId: 'run-1',
    lifecycle: 'running',
    abortRequested: false,
    pauseRequested: false,
    currentJobId: undefined,
    totalJobs: 1,
    completedJobs: 0,
    failedJobs: 0,
    totalDiscovered: 0,
    totalQualified: 0,
    totalSaved: 0,
    totalDeduped: 0,
  },
  jobs: [
    {
      id: 'job-1',
      keyword: 'battery dealer',
      country: 'Japan',
      targetLeads: 3,
      threshold: 60,
      attempts: 0,
      status: 'pending',
      discoveredCount: 0,
      qualifiedCount: 0,
      savedCount: 0,
      dedupedCount: 0,
      failedCount: 0,
    },
  ],
  settings: {
    cooldownMs: 0,
    scoreThreshold: 60,
    persistThrottleMs: 1,
  },
}

const resetAutopilotState = () => {
  autopilotState.runtime = {
    runId: 'run-1',
    lifecycle: 'running',
    abortRequested: false,
    pauseRequested: false,
    currentJobId: undefined,
    totalJobs: 1,
    completedJobs: 0,
    failedJobs: 0,
    totalDiscovered: 0,
    totalQualified: 0,
    totalSaved: 0,
    totalDeduped: 0,
  }
  autopilotState.jobs = [
    {
      id: 'job-1',
      keyword: 'battery dealer',
      country: 'Japan',
      targetLeads: 3,
      threshold: 60,
      attempts: 0,
      status: 'pending',
      discoveredCount: 0,
      qualifiedCount: 0,
      savedCount: 0,
      dedupedCount: 0,
      failedCount: 0,
    },
  ]
}

test('gold filter keeps only high-potential leads and drops low/undefined scores', async () => {
  resetAutopilotState()
  const addedLeads = []
  const mockedSearchResults = [
    { id: 1, company: 'High Score Co', website: 'https://high.example', matchScore: 88 },
    { id: 2, company: 'Boundary Score Co', website: 'https://boundary.example', matchScore: 60 },
    { id: 3, company: 'Low Score Co', website: 'https://low.example', matchScore: 50 },
    { id: 4, company: 'Undefined Score Co', website: 'https://undefined.example', matchScore: undefined },
    { id: 5, company: 'High Score Co', website: 'https://high.example', matchScore: 88 },
  ]

  const useAutopilotStoreMock = {
    getState() {
      return {
        runtime: autopilotState.runtime,
        jobs: autopilotState.jobs,
        settings: autopilotState.settings,
        updateJobProgress: async (jobId, patch) => {
          autopilotState.jobs = autopilotState.jobs.map((job) => {
            if (job.id !== jobId) return job
            return {
              ...job,
              ...patch,
            }
          })
        },
        pause: async () => {
          autopilotState.runtime.pauseRequested = true
          autopilotState.runtime.lifecycle = 'paused'
        },
        stop: async () => {
          autopilotState.runtime.abortRequested = true
          autopilotState.runtime.lifecycle = 'idle'
        },
      }
    },
    setState(updater) {
      if (typeof updater === 'function') {
        const next = updater({ runtime: autopilotState.runtime, jobs: autopilotState.jobs })
        autopilotState.runtime = next.runtime || autopilotState.runtime
        autopilotState.jobs = next.jobs || autopilotState.jobs
      } else {
        autopilotState.runtime = updater.runtime || autopilotState.runtime
        autopilotState.jobs = updater.jobs || autopilotState.jobs
      }
    },
  }

  const moduleExports = transpileTypeScriptModule(autopilotRunnerPath, {
    require(request) {
      if (request === '@/lib/electron-api') {
        return {
          searchExecute: async () => ({ results: mockedSearchResults }),
        }
      }
      if (request === '@/lib/lead-mappers') {
        return {
          mapSearchResultToLeadItem: (result) => ({
            id: result.id,
            company: result.company,
            website: result.website,
            country: 'Japan',
            industry: 'battery dealer',
            source: 'Google Maps',
            contact: '',
            contactTitle: '',
            email: '',
            phone: '',
            countryCode: 'JP',
            status: 'new',
            followUp: 'new',
            starred: false,
            lastActivity: '',
            addedDate: '2026-01-01',
            tags: [],
            unlocked: false,
            estimatedValue: '',
            matchScore: result.matchScore,
          }),
        }
      }
      if (request === '@/store/autopilot-store') {
        return { useAutopilotStore: useAutopilotStoreMock }
      }
      if (request === '@/store/leads-store') {
        return {
          useLeadsStore: {
            getState() {
              return {
                leads: [],
                addLead: async (lead) => {
                  addedLeads.push(lead)
                },
              }
            },
          },
          getLeadUniqueKey: (lead) => `website:${lead.website}`,
        }
      }
      throw new Error(`Unexpected require in autopilot runner test: ${request}`)
    },
  })

  assert.equal(typeof moduleExports.startAutopilotRunner, 'function')
  await moduleExports.startAutopilotRunner('run-1')
  if (typeof moduleExports.stopAutopilotRunner === 'function') {
    await moduleExports.stopAutopilotRunner()
  }
  autopilotState.runtime.abortRequested = true
  autopilotState.runtime.lifecycle = 'idle'

  const addedCompanies = addedLeads.map((lead) => lead.company)
  assert.ok(addedCompanies.includes('High Score Co'))
  assert.ok(addedCompanies.includes('Boundary Score Co'))
  assert.ok(!addedCompanies.includes('Low Score Co'))
  assert.ok(!addedCompanies.includes('Undefined Score Co'))
  assert.equal(addedCompanies.filter((name) => name === 'High Score Co').length, 1)
  assert.ok(addedLeads.length <= 3)
})

test.after(() => {
  autopilotState.runtime.abortRequested = true
  autopilotState.runtime.pauseRequested = false
  autopilotState.runtime.lifecycle = 'idle'
})
