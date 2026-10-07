const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const {
  createIpcMainMock,
  createEventMock,
  createStoreMock,
  createElectronMock,
  withModuleMocks,
  resetModule,
  createLicenseGuardMock,
} = require('./helpers.js')

const originalFetch = global.fetch
const originalLoad = Module._load
const automationServicePath = '../../dist-electron/electron/services/automation-service.js'
const channelsPath = '../../dist-electron/electron/ipc/channels.js'

const capturedRequests = []

test(
  'cloud handoff returns target-state degradation when Cloudflare not configured',
  async () => {
    const electronMock = createElectronMock()
    capturedRequests.length = 0

    global.fetch = async (url, options = {}) => {
      capturedRequests.push({ url: String(url), options })
      return {
        ok: true,
        status: 200,
        async json() {
          return {}
        },
        async text() {
          return ''
        },
      }
    }

    await withModuleMocks(
      {
        electron: electronMock,
        [`../utils/http-client::${path.join(process.cwd(), 'dist-electron', 'electron', 'services', 'automation-service.js')}`]:
          {
            safeFetch: global.fetch,
          },
      },
      async () => {
        resetModule(automationServicePath)
        resetModule(channelsPath)
        const { registerAutomationHandlers } = require(automationServicePath)
        const { IPC_CHANNELS } = require(channelsPath)
        const ipcMain = createIpcMainMock()
        // No cloudflare config — should return target-state degradation
        const store = createStoreMock({
          user_config: {},
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
        const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOMATION.START_CAMPAIGN)(createEventMock(), {
          templateId: 'default',
          leads: [
            { email: 'valid@example.com', company: 'Valid Lead', matchScore: 88 },
            { email: '', company: 'No Email Lead', matchScore: 95 },
            { email: 'low-score@example.com', company: 'Low Score Lead', matchScore: 40 },
            { email: 'unscored@example.com', company: 'Unscored Lead' },
          ],
        })

        assert.equal(result?.success, true)
        assert.equal(result?.data?.triggered, false)
        assert.equal(result?.data?.pushed, false)
        assert.equal(result?.data?.accepted, 0)
        assert.equal(result?.data?.rejected, 4)
        assert.ok(result?.data?.message?.includes('云端投递闭环为目标态'))
      },
    )

    // No actual fetch calls — Cloudflare not configured
    assert.equal(capturedRequests.length, 0)
  },
  { timeout: 10000 },
)

test(
  'cloud handoff pushes leads when Cloudflare is configured',
  async () => {
    const electronMock = createElectronMock()
    capturedRequests.length = 0

    global.fetch = async (url, options = {}) => {
      capturedRequests.push({ url: String(url), options })
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            data: {
              id: 'lead-id-123',
              status: 'scored',
              approvalRequired: true,
              collision: false,
            },
          }
        },
        async text() {
          return ''
        },
      }
    }

    await withModuleMocks(
      {
        electron: electronMock,
        [`../utils/http-client::${path.join(process.cwd(), 'dist-electron', 'electron', 'services', 'automation-service.js')}`]:
          {
            safeFetch: global.fetch,
          },
      },
      async () => {
        resetModule(automationServicePath)
        resetModule(channelsPath)
        const { registerAutomationHandlers } = require(automationServicePath)
        const { IPC_CHANNELS } = require(channelsPath)
        const ipcMain = createIpcMainMock()
        // Cloudflare configured
        const store = createStoreMock({
          user_config: {},
          'system.machineId': 'cloud-handoff-device',
          'cloud.provider': 'cloudflare',
          'cloud.cloudflareUrl': 'https://kone-cloud.example.workers.dev',
          'cloud.cloudflareApiKey': 'test-api-key-123',
          'cloud.cloudflareWorkspaceId': 'ws-test-001',
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
        const result = await ipcMain.getHandler(IPC_CHANNELS.AUTOMATION.START_CAMPAIGN)(createEventMock(), {
          templateId: 'default',
          leads: [
            { id: 'lead-1', email: 'valid@example.com', company: 'Valid Lead', matchScore: 88 },
            { id: 'lead-2', email: 'team@team.com', company: 'Team Lead', matchScore: 75 },
          ],
        })

        assert.equal(result?.success, true)
        assert.equal(result?.data?.triggered, true)
        assert.equal(result?.data?.pushed, 2)
        assert.equal(result?.data?.accepted, 2)
        assert.equal(result?.data?.rejected, 0)

        // Verify fetch calls were made with correct headers
        assert.equal(capturedRequests.length, 2)
        const firstRequest = capturedRequests[0]
        assert.ok(firstRequest.url.includes('/v1/leads'))
        assert.ok(firstRequest.options.headers['Authorization'].startsWith('Bearer '))
        assert.ok(firstRequest.options.headers['Idempotency-Key'])
        assert.ok(firstRequest.options.headers['X-Schema-Version'])
      },
    )
  },
  { timeout: 10000 },
)

test.after(() => {
  Module._load = originalLoad
  global.fetch = originalFetch
})
