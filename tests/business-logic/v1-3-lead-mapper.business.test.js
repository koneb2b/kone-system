const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { transpileTypeScriptModule } = require('./helpers.js')

const repoRoot = path.join(__dirname, '..', '..')
const mapperPath = path.join(repoRoot, 'src', 'lib', 'lead-mappers.ts')

const mapperModule = transpileTypeScriptModule(mapperPath, {
  require(request) {
    if (request === '@/lib/utils') {
      return {
        stableHash(input) {
          let hash = 5381
          for (let i = 0; i < String(input).length; i += 1) {
            hash = (hash * 33) ^ String(input).charCodeAt(i)
          }
          return (hash >>> 0).toString(36)
        },
      }
    }
    return require(request)
  },
})

test('V1.3 lead mapper preserves multi-source intelligence fields', () => {
  const mapped = mapperModule.mapSearchResultToLeadItem({
    id: 'not-a-number',
    company: 'Tokyo Battery Trading',
    website: 'https://tokyobattery.example',
    contact: 'Aiko Tanaka',
    contactTitle: 'Procurement Director',
    email: 'aiko@example.test',
    phone: '+81-00-0000-0000',
    address: 'Tokyo, Japan',
    country: 'Japan',
    source: 'Google Organic',
    matchScore: 82,
    fallbackStatus: 'social_blind_score',
    dataSourceType: 'google_organic',
    exhibitionFootprints: ['Battery Expo 2026'],
    customsData: {
      annualImportVolume: '120 shipments',
      topSuppliers: ['Supplier A'],
    },
    decisionMakers: [
      {
        name: 'Aiko Tanaka',
        title: 'Procurement Director',
        email: 'aiko@example.test',
        phone: '+81-00-0000-0000',
        linkedinUrl: 'https://linkedin.com/in/aikotanaka',
        source: 'public profile',
        confidenceScore: 92,
      },
    ],
    agentStatus: {
      whatsappSent: true,
      whatsappStatus: 'delivered',
      linkedinContacted: false,
      emailSequenceStage: 1,
    },
  }, {
    countryCode: 'JP',
    industry: 'Industrial Batteries',
    addedDate: '2026-05-26',
  })

  assert.equal(typeof mapped.id, 'number')
  assert.equal(mapped.company, 'Tokyo Battery Trading')
  assert.equal(mapped.countryCode, 'JP')
  assert.equal(mapped.matchScore, 82)
  assert.equal(mapped.fallbackStatus, 'social_blind_score')
  assert.equal(mapped.dataSourceType, 'google_organic')
  assert.deepEqual(mapped.exhibitionFootprints, ['Battery Expo 2026'])
  assert.ok(mapped.customsData)
  assert.equal(mapped.customsData.annualImportVolume, '120 shipments')
  assert.deepEqual(mapped.customsData.topSuppliers, ['Supplier A'])
  assert.ok(mapped.decisionMakers)
  assert.equal(mapped.decisionMakers.length, 1)
  const dm = mapped.decisionMakers[0]
  assert.equal(dm.name, 'Aiko Tanaka')
  assert.equal(dm.title, 'Procurement Director')
  assert.equal(dm.email, 'aiko@example.test')
  assert.equal(dm.phone, '+81-00-0000-0000')
  assert.equal(dm.linkedinUrl, 'https://linkedin.com/in/aikotanaka')
  assert.equal(dm.source, 'public profile')
  assert.equal(dm.confidenceScore, 92)
  assert.ok(mapped.agentStatus)
  assert.equal(mapped.agentStatus.whatsappSent, true)
  assert.equal(mapped.agentStatus.whatsappStatus, 'delivered')
  assert.equal(mapped.agentStatus.linkedinContacted, false)
  assert.equal(mapped.agentStatus.emailSequenceStage, 1)
})

test('V1.3 lead mapper keeps unscored results undefined instead of fake zero', () => {
  const mapped = mapperModule.mapSearchResultToLeadItem({
    company: 'Unscored Battery Lead',
    website: 'https://unscored.example',
    phone: '',
    address: 'Osaka, Japan',
    matchScore: null,
    fallbackStatus: 'unexpected_status',
    dataSourceType: 'customs_shipment',
    exhibitionFootprints: 'Battery Expo 2026',
    decisionMakers: 'not-array',
  })

  assert.equal(mapped.matchScore, undefined)
  assert.equal(mapped.fallbackStatus, undefined)
  assert.equal(mapped.dataSourceType, 'customs_shipment')
  assert.equal(mapped.exhibitionFootprints, undefined)
  assert.equal(mapped.decisionMakers, undefined)
})
