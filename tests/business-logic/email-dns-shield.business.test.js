const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

// ─────────────────────────────────────────────────────────────
// P0-3: Deliverability Shield — DNS risk classification must
// SOFT-LOCK (critical) on genuinely high-risk states.
//
// Spec: ARCH-STANDARDS §9.5.6 / kone-PRD §六.2 / system-blueprint §7.6
//   "critical SPF/DKIM missing OR domain blacklisted → soft-lock sends".
//
// Contract enforced here (EmailAgent.checkDnsHealth):
//   - blacklisted OR missing SPF        → 'critical' (sendEmail hard-blocks)
//   - missing MX / DKIM / DMARC (only)  → 'warning'  (send allowed, surfaced)
//   - all present, not blacklisted      → 'safe'
//
// DNS is mocked deterministically — NEVER hit live DNS in tests, it is
// non-deterministic in sandboxed/offline environments.
// ─────────────────────────────────────────────────────────────

const originalLoad = Module._load

// Build a mock `dns` module whose promises.resolve() answers from a fixture.
const installDnsMock = (fixture) => {
  const dnsMock = {
    promises: {
      resolve: async (name, rrtype) => {
        const key = `${name}|${rrtype}`
        if (key in fixture) return fixture[key]
        const err = new Error(`ENOTFOUND ${key}`)
        err.code = 'ENOTFOUND'
        throw err
      },
      resolve4: async (name) => {
        const key = `${name}|A`
        if (key in fixture) return fixture[key]
        const err = new Error(`ENOTFOUND ${key}`)
        err.code = 'ENOTFOUND'
        throw err
      },
    },
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'dns') return dnsMock
    return originalLoad.call(this, request, parent, isMain)
  }
}

const restore = () => {
  Module._load = originalLoad
}

const loadFreshEmailAgent = () => {
  const modPath = require.resolve('../../dist-electron/electron/services/agents/email-agent.js')
  delete require.cache[modPath]
  return require(modPath).EmailAgent
}

const mkAgent = (EmailAgent) =>
  new EmailAgent(
    { smtpHost: 'x', smtpPort: 587, smtpUser: 'u', smtpPass: 'p', senderEmail: 'a@d.com', dailyLimit: 20 },
    { agentId: 'agent-email', dailyUsed: 0, completedCount: 0, failedCount: 0 },
  )

const SPF = [['v=spf1 include:_spf.example.com ~all']]
const MX = [{ exchange: 'mail.d.com', priority: 10 }]
const DMARC = [['v=DMARC1; p=none']]
const DKIM = [['v=DKIM1; k=rsa; p=MIGf...']]

test('P0-3: missing SPF is CRITICAL (send hard-blocked)', async () => {
  installDnsMock({
    'd.com|MX': MX,
    'd.com|TXT': [], // no SPF
    'd.com|A': undefined,
    '_dmarc.d.com|TXT': DMARC,
  })
  try {
    const EmailAgent = loadFreshEmailAgent()
    const r = await mkAgent(EmailAgent).checkDnsHealth('d.com')
    assert.equal(r.risk, 'critical', 'missing SPF must be critical')
    assert.equal(r.valid, false, 'missing SPF must be invalid (blocks send)')
    assert.match(r.error || '', /SPF/, 'error explains missing SPF')
  } finally {
    restore()
  }
})

test('P0-3: Spamhaus blacklisted is CRITICAL even with full auth', async () => {
  installDnsMock({
    'd.com|MX': MX,
    'd.com|TXT': SPF,
    'default._domainkey.d.com|TXT': DKIM,
    '_dmarc.d.com|TXT': DMARC,
    'com.d.zen.spamhaus.org|A': ['127.0.0.2'], // reversed domain listed
  })
  try {
    const EmailAgent = loadFreshEmailAgent()
    const r = await mkAgent(EmailAgent).checkDnsHealth('d.com')
    assert.equal(r.risk, 'critical', 'blacklisted must be critical')
    assert.equal(r.valid, false, 'blacklisted must be invalid (blocks send)')
  } finally {
    restore()
  }
})

test('P0-3: fully configured, not blacklisted is SAFE', async () => {
  installDnsMock({
    'd.com|MX': MX,
    'd.com|TXT': SPF,
    'default._domainkey.d.com|TXT': DKIM,
    '_dmarc.d.com|TXT': DMARC,
    // spamhaus lookup throws ENOTFOUND → not blacklisted
  })
  try {
    const EmailAgent = loadFreshEmailAgent()
    const r = await mkAgent(EmailAgent).checkDnsHealth('d.com')
    assert.equal(r.risk, 'safe', 'fully configured domain is safe')
    assert.equal(r.valid, true, 'safe domain is valid (send allowed)')
  } finally {
    restore()
  }
})

test('P0-3: SPF present but DKIM/DMARC missing is WARNING (not blocked, no false lock)', async () => {
  installDnsMock({
    'd.com|MX': MX,
    'd.com|TXT': SPF,
    // no DKIM selector answers, no DMARC
  })
  try {
    const EmailAgent = loadFreshEmailAgent()
    const r = await mkAgent(EmailAgent).checkDnsHealth('d.com')
    assert.equal(r.risk, 'warning', 'SPF present + DKIM/DMARC missing → warning, not critical')
    assert.equal(r.valid, false, 'valid is false only for safe==true')
    assert.match(r.error || '', /DKIM/, 'warning surfaces DKIM gap')
  } finally {
    restore()
  }
})
