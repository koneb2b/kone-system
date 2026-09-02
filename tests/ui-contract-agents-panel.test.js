const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const panelPath = path.join(process.cwd(), 'src', 'components', 'agents-panel.tsx')
const source = fs.readFileSync(panelPath, 'utf8')

test('agents panel has trial meltdown guard: non-premium shows upgrade instead of agent cards', () => {
  // P0-5 分层授权：Trial/未授权（isTrialOrFree）直接熔断渲染升级墙，不输出智能体卡片
  assert.match(source, /const isTrialOrFree = !isPremium && !isPaidBasic/)
  assert.match(source, /if \(isTrialOrFree\) \{/)
  assert.match(source, /该功能仅对商业高级版完全开放/)
  assert.match(source, /\[立即输入商业授信码激活\]/)
  assert.match(source, /placeholder="粘贴商业授信码"/)
})

test('agents panel has trial badge when trial limit active', () => {
  // P0-5 分层授权：Paid Basic 只开放本地 Email + 低量 WhatsApp，LinkedIn 必须隐藏
  assert.match(source, /const isPaidBasic = plan === "basic"/)
  assert.match(source, /isPaidBasic \? agents\.filter\(\(a\) => a\.agentType !== "linkedin"\) : agents/)
})

test('agents panel has autopilot cruise safety warning', () => {
  assert.match(source, /本地 Autopilot 伴随巡航红线/)
  assert.match(source, /本地 AI 智能体群正在安全复用/)
})

test('agents panel renders agent cards only for premium users', () => {
  // The upgrade path returns first, so agent cards only render in the premium path
  assert.match(source, /if \(isTrialOrFree\) \{/)
  // Agent cards are in the premium return path (after the upgrade guard)
  assert.match(source, /agentType === 'whatsapp'/)
  assert.match(source, /agentType === 'linkedin'/)
  assert.match(source, /agentType === 'email'/)
})

test('agents panel has activation form for inline license key entry', () => {
  assert.match(source, /setLicenseKey\(/)
  assert.match(source, /activationError/)
  assert.match(source, /handleActivate/)
})

// ─────────────────────────────────────────────────────
// Data-source meta: badge colors for all DataSourceType
// ─────────────────────────────────────────────────────

test('U5-BADGE: all DataSourceType values have defined badge colors in DATASOURCE_META_MAP', () => {
  const metaPath = path.join(process.cwd(), 'src', 'lib', 'data-source-meta.ts')
  const metaSource = fs.readFileSync(metaPath, 'utf8')

  // Verify each DataSourceType is defined with label, shortLabel, and color
  const requiredTypes = [
    'google_maps',
    'google_organic',
    'customs_shipment',
    'trade_show',
    'yellow_pages',
    'linkedin_search',
    'facebook_search',
    'anysearch',
  ]

  for (const dsType of requiredTypes) {
    assert.match(metaSource, new RegExp(`${dsType}:\\s*\\{`), `DATASOURCE_META_MAP must contain entry for ${dsType}`)
    assert.match(metaSource, new RegExp(`${dsType}[^}]+label:`), `${dsType} must have a label field`)
    assert.match(metaSource, new RegExp(`${dsType}[^}]+color:`), `${dsType} must have a color field`)
    assert.match(metaSource, new RegExp(`${dsType}[^}]+shortLabel:`), `${dsType} must have a shortLabel field`)
  }

  // Verify anysearch badge is distinct (level 0 tier)
  assert.match(metaSource, /anysearch[^}]+bg-teal/, 'anysearch badge should use teal background')
})

// ─────────────────────────────────────────────────────
// DNS Health Check: IPC channel contract exists
// ─────────────────────────────────────────────────────

test('U6-DNS: dns:health-check IPC channel is defined', () => {
  const channelsPath = path.join(process.cwd(), 'electron', 'ipc', 'channels.ts')
  const channelsSource = fs.readFileSync(channelsPath, 'utf8')

  assert.match(channelsSource, /DNS\s*:\s*\{/, 'IPC_CHANNELS must have DNS namespace')
  assert.match(channelsSource, /HEALTH_CHECK:\s*'dns:health-check'/, 'dns:health-check IPC channel must be defined')
})

test('U6-DNS: dns service handler is registered in main.ts', () => {
  const mainPath = path.join(process.cwd(), 'electron', 'main.ts')
  const mainSource = fs.readFileSync(mainPath, 'utf8')

  assert.match(mainSource, /registerDnsHandlers/, 'main.ts must register dns handlers')
  assert.match(mainSource, /dns-service/, 'main.ts must import dns-service')
})
