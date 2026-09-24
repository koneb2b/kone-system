const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P1-11 回归防护：邮箱五级验证改为有界并发。
//
// 缺陷背景：verifyEmailsBatch 原为完全串行。单邮箱最坏约 17.5s
// （SMTP 8s + 灰名单回退 1.5s + catch-all 探测 8s），50 条最坏 >14 分钟，
// 期间 automation:verify-emails 这个 IPC 永不返回。
// 修复：有界并发（默认 4，可经 KONE_EMAIL_VERIFY_CONCURRENCY 覆盖），
// 结果顺序必须与入参严格对齐。

const { mapWithConcurrency } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'automation-service.js'),
)

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('P1-11: 乱序完成时结果仍按入参顺序对齐', async () => {
  const items = [90, 10, 50, 30, 70]
  const out = await mapWithConcurrency(items, 4, async (ms) => {
    await delay(ms)
    return ms
  })
  assert.deepEqual(out, [90, 10, 50, 30, 70], '结果顺序必须与入参一致')
})

test('P1-11: 并发度被严格限制在上限内', async () => {
  let inFlight = 0
  let peak = 0
  const items = Array.from({ length: 12 }, (_, i) => i)
  await mapWithConcurrency(items, 3, async (n) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await delay(15)
    inFlight -= 1
    return n
  })
  assert.ok(peak <= 3, `并发峰值不得超过 3，实际 ${peak}`)
  assert.ok(peak > 1, `必须真正并发（峰值 ${peak}），否则串行问题未修复`)
})

test('P1-11: 空输入返回空数组且不报错', async () => {
  const out = await mapWithConcurrency([], 4, async (x) => x)
  assert.deepEqual(out, [])
})

test('P1-11: 单个 worker 抛错时整体 reject（与原串行语义一致）', async () => {
  await assert.rejects(
    () =>
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    /boom/,
  )
})

test('P1-11: 并发批处理比串行显著更快', async () => {
  const items = Array.from({ length: 12 }, (_, i) => i)
  const work = async (n) => {
    await delay(40)
    return n
  }
  const startedParallel = Date.now()
  await mapWithConcurrency(items, 4, work)
  const parallelMs = Date.now() - startedParallel

  const startedSerial = Date.now()
  for (const item of items) await work(item)
  const serialMs = Date.now() - startedSerial

  assert.ok(parallelMs < serialMs, `并发(${parallelMs}ms) 必须快于串行(${serialMs}ms)`)
})
