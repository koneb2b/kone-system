const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P1-4: Email suppression list (退订/bounce/do-not-contact) enforcement.
// PROJECT-PRD §3.7.7 forbids mass send with no unsubscribe path. Every send must
// consult a persistent suppression list; suppressed recipients are never contacted.
// This test drives the compiled email-suppression module + EmailAgent gate.

const repoRoot = path.join(__dirname, '..', '..')

// In-memory ConfigStore stand-in (mirrors NativeStore get/set contract).
const makeStore = () => {
  const data = {}
  return {
    get: (k) => data[k],
    set: (k, v) => {
      data[k] = v
    },
  }
}

const suppression = require(path.join(repoRoot, 'dist-electron', 'electron', 'services', 'email-suppression.js'))

test('P1-4: addSuppression persists and isEmailSuppressed matches exact address (case-insensitive)', () => {
  const store = makeStore()
  suppression.addSuppression(store, 'Buyer@Example.com', 'unsubscribe')
  assert.equal(suppression.isEmailSuppressed(store, 'buyer@example.com'), true, 'exact match, case-insensitive')
  assert.equal(
    suppression.isEmailSuppressed(store, 'someone@example.com'),
    false,
    'different local part not suppressed',
  )
  const list = suppression.readSuppressionList(store)
  assert.equal(list.length, 1, 'one entry persisted')
  assert.equal(list[0].reason, 'unsubscribe', 'reason recorded')
})

test('P1-4: domain-wide suppression (@domain) blocks all addresses at that domain', () => {
  const store = makeStore()
  suppression.addSuppression(store, '@spam-target.com', 'complaint')
  assert.equal(
    suppression.isEmailSuppressed(store, 'anyone@spam-target.com'),
    true,
    'domain rule blocks any local part',
  )
  assert.equal(
    suppression.isEmailSuppressed(store, 'ceo@spam-target.com'),
    true,
    'domain rule blocks another local part',
  )
  assert.equal(suppression.isEmailSuppressed(store, 'ceo@other.com'), false, 'other domain unaffected')
})

test('P1-4: addSuppression is idempotent (no duplicate entries)', () => {
  const store = makeStore()
  suppression.addSuppression(store, 'dupe@x.com', 'bounce')
  suppression.addSuppression(store, 'dupe@x.com', 'manual', 'note')
  const list = suppression.readSuppressionList(store)
  assert.equal(list.length, 1, 'upsert, not duplicate')
})

test('P1-4: removeSuppression restores deliverability', () => {
  const store = makeStore()
  suppression.addSuppression(store, 'back@x.com', 'unsubscribe')
  assert.equal(suppression.isEmailSuppressed(store, 'back@x.com'), true)
  suppression.removeSuppression(store, 'back@x.com')
  assert.equal(suppression.isEmailSuppressed(store, 'back@x.com'), false, 'removed → deliverable again')
})

test('P1-4: EmailAgent.sendEmail refuses to contact a suppressed recipient', async () => {
  const store = makeStore()
  suppression.addSuppression(store, 'blocked@lead.com', 'unsubscribe')

  const { EmailAgent } = require(
    path.join(repoRoot, 'dist-electron', 'electron', 'services', 'agents', 'email-agent.js'),
  )
  const state = { agentId: 'agent-email', dailyUsed: 0, dailyLimit: 20, completedCount: 0, failedCount: 0 }
  const agent = new EmailAgent(
    {
      smtpHost: 'smtp.test',
      smtpPort: 587,
      smtpUser: 'u',
      smtpPass: 'p',
      senderEmail: 'me@sender.com',
      dailyLimit: 20,
      isSuppressed: (email) => suppression.isEmailSuppressed(store, email),
    },
    state,
  )

  // Force a fake transporter so we reach the suppression gate without real SMTP.
  agent.transporter = {
    sendMail: async () => {
      throw new Error('SHOULD NOT SEND to suppressed recipient')
    },
  }

  const result = await agent.sendEmail({ email: 'blocked@lead.com', company: 'BlockedCo' }, 'Subj', 'Body')
  assert.equal(result.success, false, 'send blocked')
  assert.match(result.error || '', /suppress/i, 'error names suppression')
  assert.equal(state.dailyUsed, 0, 'suppressed send does not consume daily quota')
})
