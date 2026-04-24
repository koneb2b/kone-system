const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { createIpcMainMock, createEventMock, createStoreMock, createElectronMock, withModuleMocks, resetModule, createLicenseGuardMock } = require('./helpers.js')

const originalFetch = global.fetch
const originalLoad = Module._load
const automationServicePath = '../../dist-electron/electron/services/automation-service.js'
const channelsPath = '../../dist-electron/electron/ipc/channels.js'

const capturedRequests = []

test('cloud handoff payload obeys compact slice caps and filters invalid email leads', async () => {
  const electronMock = createElectronMock()
  capturedRequests.length = 0

  global.fetch = async (url, options = {}) => {
    capturedRequests.push({ url: String(url), options })
    return {
      ok: true,
      status: 200,
      async json() { return {} },
      async text() { return '' },
    }
  }

  await withModuleMocks({
    electron: electronMock,
    [`../utils/http-client::${path.join(process.cwd(), 'dist-electron', 'electron', 'services', 'automation-service.js')}`]: {
      safeFetch: global.fetch,
    },
  }, async () => {
    resetModule(automationServicePath)
    resetModule(channelsPath)
    const { registerAutomationHandlers } = require(automationServicePath)
    const { IPC_CHANNELS } = require(channelsPath)
    const ipcMain = createIpcMainMock()
    const store = createStoreMock({
      user_config: {
        n8n: { webhookUrl: 'https://n8n.example.com/webhook/start' },
      },
      'system.machineId': 'cloud-handoff-device',
    })
    const licenseGuard = createLicenseGuardMock({
      claims: {
        status: 'active',
        expiresAt: Date.now() + 60_000,
        features: ['cloud_send'],
        licenseKey: 'KONE-CLOUD',
        plan: 'enterprise',
      },
    })

    registerAutomationHandlers(ipcMain, store, licenseGuard)
    const long = 'X'.repeat(5000)
    const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOMATION.START_CAMPAIGN)(createEventMock(), {
      templateId: 'default',
      leads: [
        {
          email: 'valid@example.com',
          company: long,
          website: 'https://example.com',
          country: long,
          contact: long,
          contactTitle: long,
          phone: long,
          address: long,
          source: long,
          inferredRole: long,
          matchReasons: ['a', 'b', 'c', 'd', 'e'],
          riskFlags: ['r1', 'r2', 'r3', 'r4'],
          snippet: long,
          aiAnalysis: {
            companyProfile: long,
            painPoints: long,
            valueMapping: long,
            source: long,
          },
          aiGeneratedPitch: {
            emailSubject: long,
            emailBody: long,
          },
          userSettings: {
            selectedModel: long,
            icpProfile: {
              targetProduct: long,
              buyerPersona: long,
              coreAdvantage: long,
              negativeIcp: long,
            },
          },
        },
        {
          email: '',
          company: 'No Email Lead',
          website: 'https://no-email.example.com',
        },
      ],
    })

    assert.equal(result?.success, true)
  })

  assert.ok(capturedRequests.length > 0)
  const requestBody = JSON.parse(String(capturedRequests[0].options.body || '{}'))
  const first = requestBody.leads[0]
  assert.equal(requestBody.leads.length, 1)
  assert.ok(first.lead_info.company.length <= 200)
  assert.ok(first.lead_info.country.length <= 50)
  assert.ok(first.lead_info.contact.length <= 100)
  assert.ok(first.lead_info.contact_title.length <= 120)
  assert.ok(first.lead_info.phone.length <= 80)
  assert.ok(first.lead_info.address.length <= 240)
  assert.ok(first.lead_info.source.length <= 120)
  assert.ok(first.lead_info.inferred_role.length <= 120)
  assert.ok(first.lead_info.snippet.length <= 500)
  assert.ok(first.ai_analysis.companyProfile.length <= 800)
  assert.ok(first.ai_analysis.painPoints.length <= 800)
  assert.ok(first.ai_analysis.valueMapping.length <= 1000)
  assert.ok(first.ai_generated_pitch.emailSubject.length <= 200)
  assert.ok(first.ai_generated_pitch.emailBody.length <= 2400)
  assert.ok(first.user_settings.selectedModel.length <= 120)
  assert.ok(first.user_settings.icpProfile.targetProduct.length <= 500)
  assert.ok(first.user_settings.icpProfile.buyerPersona.length <= 100)
  assert.ok(first.user_settings.icpProfile.coreAdvantage.length <= 500)
  assert.ok(first.user_settings.icpProfile.negativeIcp.length <= 300)
  assert.ok(first.lead_info.match_reasons.length <= 4)
  assert.ok(first.lead_info.risk_flags.length <= 3)
})

test.after(() => {
  Module._load = originalLoad
  global.fetch = originalFetch
})
