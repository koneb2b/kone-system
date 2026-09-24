const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { transpileTypeScriptModule } = require('./helpers.js')

// ─────────────────────────────────────────────────────────────
// P1-1: Durable lead persistence.
//
// The saved lead pool (`leads`) must survive app restarts by round-tripping
// through the local config store. searchResults must NEVER be persisted
// (ARCH-STANDARDS §4.3: config storage must not absorb volatile business
// payloads). This test drives the real Zustand store with a mocked
// electron-api config layer and asserts the persistence contract.
// ─────────────────────────────────────────────────────────────

const repoRoot = path.join(__dirname, '..', '..')
const storePath = path.join(repoRoot, 'src', 'store', 'leads-store.ts')

// Shared capture of config get/set traffic across the transpiled module.
const configState = { store: {}, setCalls: [], getCalls: [] }

const loadStore = () =>
  transpileTypeScriptModule(storePath, {
    require(request) {
      if (request === '@/shared/ipc-contracts') return {}
      if (request === '@/lib/electron-api') {
        return {
          fetchClaimedDomains: async () => ({ domains: [] }),
          checkDomainsCollision: async () => ({ claimedDomains: [], offline: true }),
          configGet: async (key) => {
            configState.getCalls.push(key)
            return configState.store[key] ?? null
          },
          configSet: async ({ key, value }) => {
            configState.setCalls.push({ key, value })
            configState.store[key] = value
            return null
          },
        }
      }
      if (request === 'zustand') return require('zustand')
      return require(request)
    },
  })

const mkLead = (id, company, website) => ({
  id,
  company,
  website,
  contact: '',
  contactTitle: '',
  email: '',
  phone: '',
  country: '',
  countryCode: '',
  industry: '',
  source: '',
  status: 'new',
  followUp: 'new',
  starred: false,
  lastActivity: '',
  addedDate: new Date().toISOString(),
  tags: [],
  unlocked: false,
  website2: '',
  estimatedValue: '',
})

test('P1-1: saveLeads persists the pool to config store', async () => {
  configState.store = {}
  configState.setCalls = []
  configState.getCalls = []
  const { useLeadsStore } = loadStore()
  await useLeadsStore.getState().saveLeads([mkLead(1, 'AlphaCorp', 'https://alpha.com')])
  const leadsWrite = configState.setCalls.filter((c) => c.key === 'leads')
  assert.equal(leadsWrite.length, 1, 'saveLeads writes leads to config exactly once')
  assert.equal(leadsWrite[0].value.length, 1, 'persisted pool has 1 lead')
  assert.equal(leadsWrite[0].value[0].company, 'AlphaCorp', 'persisted lead content correct')
})

test('P1-1: hydrateFromConfig re-loads the persisted pool (survives restart)', async () => {
  configState.store = { leads: [mkLead(7, 'BetaInc', 'https://beta.com')] }
  configState.setCalls = []
  configState.getCalls = []
  const { useLeadsStore } = loadStore()
  assert.equal(useLeadsStore.getState().leads.length, 0, 'fresh store starts empty')
  await useLeadsStore.getState().hydrateFromConfig()
  const leads = useLeadsStore.getState().leads
  assert.ok(configState.getCalls.includes('leads'), 'hydrate reads the leads key')
  assert.equal(leads.length, 1, 'persisted lead re-hydrated after restart')
  assert.equal(leads[0].company, 'BetaInc', 'hydrated lead content correct')
  assert.equal(useLeadsStore.getState().hydrated, true, 'hydrated flag set')
})

test('P1-1: mergeLeads / updateLead / deleteLead each persist', async () => {
  configState.store = {}
  configState.setCalls = []
  configState.getCalls = []
  const { useLeadsStore } = loadStore()
  await useLeadsStore.getState().mergeLeads([mkLead(1, 'AlphaCorp', 'https://alpha.com')])
  await useLeadsStore.getState().updateLead(1, { starred: true })
  await useLeadsStore.getState().deleteLead(1)
  const leadsWrites = configState.setCalls.filter((c) => c.key === 'leads')
  assert.equal(leadsWrites.length, 3, 'merge + update + delete each persist once')
  assert.equal(leadsWrites[2].value.length, 0, 'final persisted pool empty after delete')
})

test('P1-1: setSearchResults must NEVER persist (volatile payload, ARCH §4.3)', async () => {
  configState.store = {}
  configState.setCalls = []
  configState.getCalls = []
  const { useLeadsStore } = loadStore()
  await useLeadsStore.getState().setSearchResults([
    {
      id: 'x',
      company: 'Volatile',
      industry: '',
      contact: '',
      contactTitle: '',
      email: '',
      phone: '',
      unlocked: false,
    },
  ])
  assert.equal(configState.setCalls.length, 0, 'searchResults must not trigger ANY config write')
  assert.equal(useLeadsStore.getState().searchResults.length, 1, 'searchResults still held in memory')
})
