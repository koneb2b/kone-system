const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const originalLoad = Module._load

const electronMock = {
  app: {
    isPackaged: true,
    getPath: () => path.join(process.cwd(), '.tmp-test-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
}

Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return electronMock
  }
  return originalLoad.call(this, request, parent, isMain)
}

const { getUserLlmApiKey } = require('../dist-electron/electron/services/config-service.js')
const { parseStructuredAnalysisResponse } = require('../dist-electron/electron/services/search-service.js')

const createStoreMock = (values = {}) => ({
  get(key) {
    return values[key]
  },
  set(key, value) {
    values[key] = value
  },
})

test('e2e journey: search result save to analysis/email draft path stays available', async () => {
  const store = createStoreMock({
    user_config: {
      llmApiKey: 'legacy-test-key',
      providers: [{ id: 'llm', baseUrl: 'https://api.openai.com/v1' }],
      selectedModel: 'gpt-4o-mini',
      icpProfile: {
        targetProduct: 'Industrial battery system',
        buyerPersona: 'distributor',
        coreAdvantage: 'stable delivery and OEM support',
      },
    },
  })

  const llmKey = getUserLlmApiKey(store)
  assert.equal(llmKey, 'legacy-test-key')

  const searchResults = [
    {
      id: 1,
      company: 'Alpha Energy GmbH',
      website: 'https://alpha.example',
      matchScore: 82,
      matchReasons: ['与工业电池分销场景高度相关'],
      riskFlags: [],
      snippet: 'Industrial battery distributor in Germany',
    },
    {
      id: 2,
      company: 'Blocked Parts Co',
      website: 'https://blocked.example',
      matchScore: undefined,
      matchReasons: ['⚠️ 官网存在防爬限制，且 AI 盲评超时失败，建议稍后重试或人工复核'],
      riskFlags: ['website_403', 'blind_score_failed', '官网访问受限，建议人工复核'],
      snippet: 'Auto-generated fallback record',
    },
  ]

  assert.equal(searchResults.length, 2)
  assert.equal(searchResults[0].matchScore, 82)
  assert.deepEqual(searchResults[1].riskFlags.slice(0, 2), ['website_403', 'blind_score_failed'])

  const savedLeads = []
  const leadToSave = {
    id: 1001,
    company: searchResults[0].company,
    website: searchResults[0].website,
    industry: 'Industrial battery',
    country: 'Germany',
    snippet: searchResults[0].snippet,
    salesStrategy: 'Focus on OEM replacement and distributor margin uplift',
  }
  savedLeads.push(leadToSave)
  assert.equal(savedLeads.length, 1)

  const mockAnalysisPayload = JSON.stringify({
    companyProfile: '德国工业电池分销商，覆盖 OEM 与售后渠道。',
    painPoints: '需要稳定交付、认证资料与低 MOQ 支持。',
    valueMapping: '可用 OEM 支持与交付稳定性切入。',
    emailSubject: 'Reliable industrial battery supply for your distribution pipeline',
    emailBody: 'Hi Alpha Energy team, we support industrial battery distributors with stable OEM delivery and faster commercial response.',
    confidence: 86,
  })

  const analysisResponse = parseStructuredAnalysisResponse(mockAnalysisPayload)
  assert.ok(analysisResponse)
  assert.equal(typeof analysisResponse.content, 'string')
  assert.ok(analysisResponse.content.length > 0)
  assert.doesNotMatch(analysisResponse.content, /暂不可用/)
  assert.equal(analysisResponse.emailSubject, 'Reliable industrial battery supply for your distribution pipeline')
  assert.ok(analysisResponse.emailBody.includes('Alpha Energy'))
})

test.after(() => {
  Module._load = originalLoad
})
