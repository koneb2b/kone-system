const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// P0-3 回归防护：Agent 管道时空隔离。
//
// 缺陷背景：isStaleTask 原先只与 currentPipelineRunId（暂存窗口内的瞬时值）比较，
// 而 withPipelineIsolation 在 finally 中必然将其清空。用户在搜索完成后点击
// “开始触达”时 currentPipelineRunId 恒为 null，导致 isStaleTask 恒返回 false ——
// 陈旧任务防重从未生效。修复后引入 latestStagedRunId 作为窗口关闭后的比较基准。
//
// 本用例零网络、零 Electron，直接验证 agent-pipeline 的隔离语义。

const pipeline = require(path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'agent-pipeline.js'))

const lead = (overrides = {}) => ({
  id: 'lead-1',
  company: 'ACME Industrial',
  website: 'https://acme.test',
  email: 'buyer@acme.test',
  matchScore: 82,
  ...overrides,
})

test('P0-3: 较旧管道批次在较新管道暂存后必须判为陈旧', () => {
  pipeline.resetPipelineIsolation()

  const runA = 'pipeline-run-A'
  pipeline.markPipelineStaged(runA)
  assert.equal(pipeline.getLatestStagedRunId(), runA, '最近暂存 runId 应被记录')
  assert.equal(pipeline.isStaleTask(runA), false, '当前暂存批次不得判为陈旧')

  const runB = 'pipeline-run-B'
  pipeline.markPipelineStaged(runB)
  assert.equal(pipeline.isStaleTask(runA), true, '旧管道批次必须被丢弃')
  assert.equal(pipeline.isStaleTask(runB), false, '最新暂存批次必须保持有效')
})

test('P0-3: 从未成功暂存时保持 null-safe（不得误杀）', () => {
  pipeline.resetPipelineIsolation()
  assert.equal(pipeline.getLatestStagedRunId(), null)
  assert.equal(pipeline.isStaleTask('any-run-id'), false, '无比较基准时必须返回 false')
})

test('P0-3: 暂存窗口内的其他 run 判为陈旧（保留原有窗口语义）', async () => {
  pipeline.resetPipelineIsolation()
  await pipeline.withPipelineIsolation(async (runId) => {
    assert.equal(pipeline.getCurrentPipelineRunId(), runId)
    assert.equal(pipeline.isStaleTask(runId), false, '当前窗口 run 不得判为陈旧')
    assert.equal(pipeline.isStaleTask('some-other-run'), true, '窗口内其他 run 必须判为陈旧')
  })
  assert.equal(pipeline.getCurrentPipelineRunId(), null, '窗口关闭后必须清空')
})

test('P0-3: buildAgentTaskQueue 用当前管道 runId 给任务打标', async () => {
  pipeline.resetPipelineIsolation()
  let stamped
  await pipeline.withPipelineIsolation(async (runId) => {
    const queue = pipeline.buildAgentTaskQueue([lead()])
    stamped = queue.email[0]?.taskRunId
    assert.equal(stamped, runId, 'AgentTask.taskRunId 必须等于当前管道 runId')
  })
  assert.ok(stamped, '任务应被真实打标')
  assert.equal(pipeline.isStaleTask(stamped), false, '未暂存时打标 run 不得判为陈旧')
})

test('P0-3: 端到端——旧管道任务在新管道暂存后被丢弃', async () => {
  pipeline.resetPipelineIsolation()

  let oldRunId
  await pipeline.withPipelineIsolation(async (runId) => {
    oldRunId = runId
    pipeline.buildAgentTaskQueue([lead()])
  })
  // 模拟旧管道确实暂存过目标（stageAgentsFromPipeline 的成功路径）
  pipeline.markPipelineStaged(oldRunId)
  assert.equal(pipeline.isStaleTask(oldRunId), false, '旧批次在尚无新管道时仍有效')

  let newRunId
  await pipeline.withPipelineIsolation(async (runId) => {
    newRunId = runId
  })
  pipeline.markPipelineStaged(newRunId)

  assert.notEqual(oldRunId, newRunId)
  assert.equal(pipeline.isStaleTask(oldRunId), true, '用户确认旧批次时必须被丢弃')
  assert.equal(pipeline.isStaleTask(newRunId), false, '新批次必须可用')
})

test('P0-3: 未达标线索不得进入队列（阈值回归）', () => {
  pipeline.resetPipelineIsolation()
  const queue = pipeline.buildAgentTaskQueue([
    lead({ id: 'low-score', matchScore: 59 }),
    lead({ id: 'no-asset', matchScore: 90, email: undefined, phone: undefined, linkedinUrl: undefined }),
    lead({ id: 'ok', matchScore: 60 }),
  ])
  const ids = queue.email.map((t) => t.leadKey)
  assert.deepEqual(ids, ['ok'], '仅 matchScore>=60 且含可触达资产的线索入队')
})
