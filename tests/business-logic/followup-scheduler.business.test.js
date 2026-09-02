const test = require('node:test')
const assert = require('node:assert/strict')

const sched = require('../../dist-electron/electron/services/followup-scheduler.js')

const {
  createPlan,
  isPlanDue,
  advancePlan,
  markReplied,
  nextStage,
  STAGE_INTERVAL_MS,
  INTERVAL_JITTER_RATIO,
  jitteredInterval,
  upsertPlan,
  readPlans,
  getDuePlans,
} = sched

// In-memory ConfigStore stub (dot-path get/set on a single key is enough here).
const makeStore = () => {
  const data = {}
  return {
    get(key) {
      return data[key]
    },
    set(key, value) {
      data[key] = value
    },
  }
}

test('createPlan starts at stage 0 with a jittered 3-day nextSendAt (P1-4 ±20%)', () => {
  const now = 1_000_000
  const plan = createPlan('AlphaCorp', 'ceo@alpha.com', now)
  assert.equal(plan.stage, 0, 'starts at stage 0')
  assert.equal(plan.leadKey, 'AlphaCorp', 'leadKey = company')
  assert.equal(plan.done, false, 'not done')
  assert.equal(plan.repliedAt, undefined, 'no reply yet')
  const interval = plan.nextSendAt - now
  const lo = STAGE_INTERVAL_MS[0] * (1 - INTERVAL_JITTER_RATIO)
  const hi = STAGE_INTERVAL_MS[0] * (1 + INTERVAL_JITTER_RATIO)
  assert.ok(interval >= lo && interval <= hi, `nextSendAt jittered within ±20% (got ${interval})`)
})

test('jitteredInterval with injected random: bounds and determinism', () => {
  assert.equal(
    jitteredInterval(0, () => 0.5),
    0,
    'non-positive interval unchanged',
  )
  assert.equal(
    jitteredInterval(1000, () => 0),
    800,
    'random=0 → lower bound 0.8x',
  )
  assert.equal(
    jitteredInterval(1000, () => 1),
    1200,
    'random=1 → upper bound 1.2x',
  )
  assert.equal(
    jitteredInterval(1000, () => 0.5),
    1000,
    'random=0.5 → exact interval',
  )
  assert.equal(
    jitteredInterval(1000, () => 0.25),
    900,
    'deterministic interpolation',
  )
})

test('isPlanDue: not due before window, due after (jitter-aware boundaries)', () => {
  const now = 1_000_000
  const plan = createPlan('AlphaCorp', 'ceo@alpha.com', now)
  assert.equal(isPlanDue(plan, now), false, 'not due immediately')
  assert.equal(isPlanDue(plan, plan.nextSendAt - 1), false, 'not due 1ms early')
  assert.equal(isPlanDue(plan, plan.nextSendAt), true, 'due exactly at nextSendAt')
})

test('P1-3: pendingManual holds the plan even past nextSendAt', () => {
  const now = 1_000_000
  const plan = createPlan('GammaLtd', 'ceo@gamma.com', now)
  const held = { ...plan, nextSendAt: now - 1, pendingManual: true }
  assert.equal(isPlanDue(held, now), false, 'manual-hold plan is never auto-due')
  assert.equal(isPlanDue({ ...held, pendingManual: false }, now), true, 'releasing hold makes it due again')
})

test('advancePlan: stage progression 0 -> 1 -> 2 -> 3 then done', () => {
  let now = 1_000_000
  let plan = createPlan('AlphaCorp', 'ceo@alpha.com', now)

  now += STAGE_INTERVAL_MS[0]
  plan = advancePlan(plan, now)
  assert.equal(plan.stage, 1, 'advanced to stage 1')
  assert.equal(plan.done, false, 'not done at stage 1')

  now += STAGE_INTERVAL_MS[1]
  plan = advancePlan(plan, now)
  assert.equal(plan.stage, 2, 'advanced to stage 2')

  now += STAGE_INTERVAL_MS[2]
  plan = advancePlan(plan, now)
  assert.equal(plan.stage, 3, 'advanced to stage 3')
  assert.equal(plan.done, true, 'done after final stage')
  assert.equal(isPlanDue(plan, now + 999_999_999), false, 'terminal plan never due again')
})

test('markReplied: reply interrupts the sequence permanently', () => {
  const now = 1_000_000
  let plan = createPlan('BetaInc', 'buyer@beta.com', now)
  plan = markReplied(plan, now + 5000)
  assert.ok(plan.repliedAt, 'repliedAt set')
  assert.equal(plan.done, true, 'done after reply')
  assert.equal(isPlanDue(plan, now + STAGE_INTERVAL_MS[0] + 1), false, 'replied plan is never due even past window')
})

test('nextStage caps at 3', () => {
  assert.equal(nextStage(0), 1)
  assert.equal(nextStage(2), 3)
  assert.equal(nextStage(3), 3, 'stage 3 stays at 3')
})

test('store CRUD: upsert is idempotent by leadKey and getDuePlans filters correctly', () => {
  const store = makeStore()
  const now = 1_000_000

  upsertPlan(store, createPlan('AlphaCorp', 'ceo@alpha.com', now))
  upsertPlan(store, createPlan('AlphaCorp', 'ceo@alpha.com', now)) // duplicate leadKey
  assert.equal(readPlans(store).length, 1, 'duplicate leadKey does not create a second plan')

  upsertPlan(store, createPlan('BetaInc', 'buyer@beta.com', now))
  assert.equal(readPlans(store).length, 2, 'distinct leadKey adds a plan')

  // Nothing due yet.
  assert.equal(getDuePlans(store, now).length, 0, 'no plans due immediately')
  // After the stage-0 window (incl. max jitter), both are due.
  assert.equal(
    getDuePlans(store, now + STAGE_INTERVAL_MS[0] * (1 + INTERVAL_JITTER_RATIO)).length,
    2,
    'both due after window',
  )

  // Mark one replied → only one remains due.
  const [alpha] = readPlans(store)
  upsertPlan(store, markReplied(alpha, now + 10))
  assert.equal(
    getDuePlans(store, now + STAGE_INTERVAL_MS[0] * (1 + INTERVAL_JITTER_RATIO)).length,
    1,
    'replied plan excluded from due set',
  )
})
