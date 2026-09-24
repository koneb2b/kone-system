const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
  ARTIFACT_DIR,
  startElectronDevStack,
  stopElectronDevStack,
  waitForDebugEndpoint,
  connectElectronBrowser,
  getElectronPage,
  waitForAppReady,
  assertNoCrashUi,
  navigateViaSidebar,
  waitForStableModule,
  collectFailureArtifacts,
} = require('./helpers.js')

const MODULES = [
  {
    id: 'search',
    label: '智能获客',
    anchors: [
      { type: 'selector', value: '[data-stage="search"]' },
      { type: 'text', value: '海外客户智能搜索' },
      { type: 'text', value: '伴随式后台巡航' },
    ],
  },
  {
    id: 'data',
    label: '数据中心',
    anchors: [
      { type: 'text', value: '数据中心' },
      { type: 'text', value: '全面的业务数据分析与洞察' },
      { type: 'text', value: '正在加载数据中心' },
      { type: 'text', value: '暂无线索数据' },
    ],
  },
  {
    id: 'leads',
    label: '线索管理',
    anchors: [
      { type: 'text', value: '线索管理' },
      { type: 'text', value: '管理和跟踪所有客户线索' },
      { type: 'text', value: '暂无线索' },
    ],
  },
  {
    id: 'knowledge',
    label: '知识库',
    anchors: [
      { type: 'text', value: '企业知识库' },
      { type: 'text', value: '保存知识库' },
      { type: 'text', value: '正在加载知识库' },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    anchors: [
      { type: 'selector', value: '[data-stage="settings"]' },
      { type: 'text', value: 'Kone 系统设置' },
      { type: 'text', value: 'API 密钥、搜索配置与账户管理' },
    ],
  },
  {
    id: 'team-dashboard',
    label: '团队协作',
    anchors: [
      { type: 'text', value: '团队协作看板' },
      { type: 'text', value: '实时团队线索协同与防撞单管理' },
      { type: 'text', value: '团队协作看板暂未开放' },
    ],
  },
  {
    id: 'automation',
    label: '自动化序列',
    anchors: [
      { type: 'text', value: '智能触达工作流' },
      { type: 'text', value: '客户清洗、模板配置与云端发送的协同引擎' },
      { type: 'text', value: '智能触达工作流暂未开放' },
    ],
  },
]

test('router spider smoke: traverses 7 core modules in real Electron without white-screen crash', async () => {
  const { child, logs } = startElectronDevStack()
  const consoleMessages = []
  let browser = null
  let page

  try {
    const debugReady = await waitForDebugEndpoint(logs)
    assert.equal(debugReady, true, 'Electron debug endpoint did not become ready in time')

    browser = await connectElectronBrowser()
    page = await getElectronPage(browser)
    page.on('console', (msg) => {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
    })

    const ready = await waitForAppReady(page)
    assert.equal(ready, true, 'Electron app page did not become ready in time')

    const electronBridgeState = await page.evaluate(() => ({
      hasElectronApi: typeof window.electronAPI !== 'undefined',
      hasLicenseApi: Boolean(window.electronAPI?.license),
      hasSearchApi: Boolean(window.electronAPI?.search),
      hasAutopilotApi: Boolean(window.electronAPI?.autopilot),
    }))

    assert.equal(electronBridgeState.hasElectronApi, true, 'Electron preload bridge window.electronAPI is missing')
    assert.equal(electronBridgeState.hasLicenseApi, true, 'Electron license bridge is missing')
    assert.equal(electronBridgeState.hasSearchApi, true, 'Electron search bridge is missing')
    assert.equal(electronBridgeState.hasAutopilotApi, true, 'Electron autopilot bridge is missing')

    const results = []

    for (const module of MODULES) {
      try {
        await navigateViaSidebar(page, module.id)
        const matched = await waitForStableModule(page, module.anchors)
        await assertNoCrashUi(page)
        results.push({
          module: module.label,
          navId: module.id,
          status: 'passed',
          matched: `${matched.matched.type}:${matched.matched.value}`,
        })
      } catch (error) {
        const artifacts = await collectFailureArtifacts(
          page,
          module.label,
          'electron-router-spider-failure',
          error,
          consoleMessages,
          logs,
        )
        results.push({
          module: module.label,
          navId: module.id,
          status: 'failed',
          error: String(error?.message || error),
          artifacts,
        })
      }
    }

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
    const summaryPath = path.join(ARTIFACT_DIR, 'router-spider-summary.txt')
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          electronBridgeState,
          modules: results,
        },
        null,
        2,
      ),
      'utf8',
    )

    const failed = results.filter((item) => item.status === 'failed')
    assert.equal(
      failed.length,
      0,
      `Router spider failed on ${failed.length} module(s): ${failed.map((item) => `${item.module}: ${item.error}`).join(' | ')}`,
    )
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    await stopElectronDevStack(child)
  }
})
