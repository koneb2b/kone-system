const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { transpileTypeScriptModule } = require('./helpers.js')

const repoRoot = path.join(__dirname, '..', '..')
const storePath = path.join(repoRoot, 'src', 'store', 'leads-store.ts')

const storeModule = transpileTypeScriptModule(storePath, {
  require(request) {
    if (request === '@/shared/ipc-contracts') {
      return {} // types only, not needed at runtime
    }
    if (request === '@/lib/electron-api') {
      return {
        fetchClaimedDomains: async () => ({ domains: [] }),
        checkDomainsCollision: async () => ({ claimedDomains: [], offline: true }),
      }
    }
    if (request === 'zustand') {
      const actualZustand = require('zustand')
      return actualZustand
    }
    return require(request)
  },
})

test('mergeLeads preserves existing lead IDs when websites match', () => {
  const existing = [
    {
      id: 1,
      company: 'Tokyo Battery Co',
      website: 'https://tokyo.example',
      contact: '',
      contactTitle: '',
      email: '',
      phone: '',
      country: 'Japan',
      countryCode: 'JP',
      industry: 'Battery',
      source: 'Google',
      status: 'new',
      followUp: 'new',
      starred: false,
      lastActivity: '2026-01-01',
      addedDate: '2026-01-01',
      tags: [],
      unlocked: false,
      estimatedValue: '-',
    },
  ]
  const incoming = [
    {
      id: 99,
      company: 'Tokyo Battery Co Ltd',
      website: 'https://tokyo.example',
      contact: 'Tanaka',
      contactTitle: 'CEO',
      email: 'tanaka@test.example',
      phone: '+81-xxx',
      country: 'Japan',
      countryCode: 'JP',
      industry: 'Battery',
      source: 'AnySearch',
      status: 'new',
      followUp: 'new',
      starred: false,
      lastActivity: '2026-05-20',
      addedDate: '2026-05-20',
      tags: [],
      unlocked: true,
      estimatedValue: '-',
    },
  ]
  const merged = storeModule.mergeLeads(existing, incoming)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 1)
  assert.equal(merged[0].contact, 'Tanaka')
  assert.equal(merged[0].email, 'tanaka@test.example')
})

test('mergeLeads deep-merges decisionMakers by email collision', () => {
  const existing = [
    {
      id: 1,
      company: 'Test Corp',
      website: 'https://test.example',
      contact: '',
      contactTitle: '',
      email: '',
      phone: '',
      country: 'US',
      countryCode: 'US',
      industry: 'Energy',
      source: 'Google',
      status: 'new',
      followUp: 'new',
      starred: false,
      lastActivity: '2026-01-01',
      addedDate: '2026-01-01',
      tags: [],
      unlocked: false,
      estimatedValue: '-',
      decisionMakers: [
        {
          name: 'Alice',
          title: 'Procurement',
          email: 'alice@test.example',
          phone: '',
          source: 'web',
          confidenceScore: 70,
        },
      ],
    },
  ]
  const incoming = [
    {
      id: 99,
      company: 'Test Corp',
      website: 'https://test.example',
      contact: '',
      contactTitle: '',
      email: '',
      phone: '',
      country: 'US',
      countryCode: 'US',
      industry: 'Energy',
      source: 'AnySearch',
      status: 'new',
      followUp: 'new',
      starred: false,
      lastActivity: '2026-05-20',
      addedDate: '2026-05-20',
      tags: [],
      unlocked: false,
      estimatedValue: '-',
      decisionMakers: [
        {
          name: 'Alice',
          title: 'Procurement Director',
          email: 'alice@test.example',
          phone: '+1-555',
          source: 'anysearch',
          confidenceScore: 85,
        },
        {
          name: 'Bob',
          title: 'Sourcing Manager',
          email: 'bob@test.example',
          phone: '+1-556',
          source: 'anysearch',
          confidenceScore: 60,
        },
      ],
    },
  ]
  const merged = storeModule.mergeLeads(existing, incoming)
  assert.equal(merged.length, 1)
  const dms = merged[0].decisionMakers
  assert.ok(dms)
  assert.equal(dms.length, 2)
  const alice = dms.find((d) => d.email === 'alice@test.example')
  assert.ok(alice)
  assert.equal(alice.confidenceScore, 85)
  assert.equal(alice.title, 'Procurement Director')
  assert.equal(alice.phone, '+1-555')
  const bob = dms.find((d) => d.email === 'bob@test.example')
  assert.ok(bob)
  assert.equal(bob.confidenceScore, 60)
})

test('mergeLeads deep-merges exhibitionFootprints with deduplication', () => {
  const existing = [
    {
      id: 1,
      company: 'Expo Corp',
      website: 'https://expo.example',
      contact: '',
      contactTitle: '',
      email: '',
      phone: '',
      country: 'DE',
      countryCode: 'DE',
      industry: 'Energy',
      source: 'Google',
      status: 'new',
      followUp: 'new',
      starred: false,
      lastActivity: '2026-01-01',
      addedDate: '2026-01-01',
      tags: [],
      unlocked: false,
      estimatedValue: '-',
      exhibitionFootprints: ['Battery Expo 2025', 'Solar Fair 2025'],
    },
  ]
  const incoming = [
    {
      id: 99,
      company: 'Expo Corp',
      website: 'https://expo.example',
      contact: '',
      contactTitle: '',
      email: '',
      phone: '',
      country: 'DE',
      countryCode: 'DE',
      industry: 'Energy',
      source: 'AnySearch',
      status: 'new',
      followUp: 'new',
      starred: false,
      lastActivity: '2026-05-20',
      addedDate: '2026-05-20',
      tags: [],
      unlocked: false,
      estimatedValue: '-',
      exhibitionFootprints: ['Battery Expo 2025', 'Intersolar 2026'],
    },
  ]
  const merged = storeModule.mergeLeads(existing, incoming)
  assert.equal(merged.length, 1)
  const footprints = merged[0].exhibitionFootprints
  assert.ok(footprints)
  assert.equal(footprints.length, 3)
  assert.ok(footprints.includes('Battery Expo 2025'))
  assert.ok(footprints.includes('Solar Fair 2025'))
  assert.ok(footprints.includes('Intersolar 2026'))
})

test('mergeLeads sorts by addedDate descending then matchScore descending', () => {
  const existing = [
    {
      id: 1,
      company: 'A',
      website: 'https://a.example',
      contact: '',
      contactTitle: '',
      email: '',
      phone: '',
      country: 'US',
      countryCode: 'US',
      industry: '',
      source: 'G',
      status: 'new',
      followUp: 'new',
      starred: false,
      lastActivity: '',
      addedDate: '2026-01-01',
      tags: [],
      unlocked: false,
      estimatedValue: '-',
      matchScore: 60,
    },
  ]
  const incoming = [
    {
      id: 2,
      company: 'B',
      website: 'https://b.example',
      contact: '',
      contactTitle: '',
      email: '',
      phone: '',
      country: 'US',
      countryCode: 'US',
      industry: '',
      source: 'G',
      status: 'new',
      followUp: 'new',
      starred: false,
      lastActivity: '',
      addedDate: '2026-05-20',
      tags: [],
      unlocked: false,
      estimatedValue: '-',
      matchScore: 40,
    },
    {
      id: 3,
      company: 'C',
      website: 'https://c.example',
      contact: '',
      contactTitle: '',
      email: '',
      phone: '',
      country: 'US',
      countryCode: 'US',
      industry: '',
      source: 'G',
      status: 'new',
      followUp: 'new',
      starred: false,
      lastActivity: '',
      addedDate: '2026-05-20',
      tags: [],
      unlocked: false,
      estimatedValue: '-',
      matchScore: 90,
    },
  ]
  const merged = storeModule.mergeLeads(existing, incoming)
  assert.equal(merged.length, 3)
  assert.equal(merged[0].company, 'C')
  assert.equal(merged[1].company, 'B')
  assert.equal(merged[2].company, 'A')
})

test('mergeLeads: 决策人碰撞时以 confidenceScore 较高者的属性为准（§L142）', () => {
  const base = {
    contact: '',
    contactTitle: '',
    email: '',
    phone: '',
    country: 'US',
    countryCode: 'US',
    industry: 'Energy',
    status: 'new',
    followUp: 'new',
    starred: false,
    tags: [],
    unlocked: false,
    estimatedValue: '-',
  }
  const existing = [
    {
      ...base,
      id: 1,
      company: 'Test Corp',
      website: 'https://test.example',
      source: 'web',
      lastActivity: '2026-01-01',
      addedDate: '2026-01-01',
      decisionMakers: [
        {
          name: 'Alice',
          title: 'Procurement Director',
          email: 'alice@test.example',
          phone: '+1-555',
          source: 'web',
          confidenceScore: 90,
        },
      ],
    },
  ]
  const incoming = [
    {
      ...base,
      id: 2,
      company: 'Test Corp',
      website: 'https://test.example',
      source: 'AnySearch',
      lastActivity: '2026-05-20',
      addedDate: '2026-05-20',
      decisionMakers: [
        // 低置信来源后到：其属性不得覆盖高置信属性；空 phone 不得抹掉已有的 +1-555
        {
          name: 'Alice',
          title: 'Procurement',
          email: 'alice@test.example',
          phone: '',
          source: 'anysearch',
          confidenceScore: 60,
        },
      ],
    },
  ]
  const merged = storeModule.mergeLeads(existing, incoming)
  const alice = merged[0].decisionMakers.find((d) => d.email === 'alice@test.example')
  assert.ok(alice)
  assert.equal(alice.confidenceScore, 90, '置信度取两者最大值')
  assert.equal(alice.title, 'Procurement Director', '高置信来源的属性胜出')
  assert.equal(alice.phone, '+1-555', '低置信来源的空字段不得抹掉已有资产')
})
