const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// P0-9 回归防护：CI 发布门禁本身不得静默失效。
//
// 缺陷背景：ci.yml 的 gate job 曾写成 `steps:` 直接跟一个映射（缺少 `-` 列表项），
// 这在 GitHub Actions 中是非法结构（steps 必须是数组）——整份 workflow 无法解析，
// 等于所有门禁从未真正执行。本用例把"门禁结构正确 + 拒绝一切非 success"固化为断言。

const CI_PATH = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml')
const source = fs.readFileSync(CI_PATH, 'utf8')

let yaml = null
try {
  yaml = require('js-yaml')
} catch {
  yaml = null
}

const loadWorkflow = () => {
  if (!yaml) return null
  return yaml.load(source)
}

test('CI: workflow 可被解析且每个 job 的 steps 均为数组', (t) => {
  const doc = loadWorkflow()
  if (!doc) {
    t.skip('js-yaml 不可用，跳过结构解析（仍执行下方文本契约断言）')
    return
  }
  const jobs = doc.jobs || {}
  assert.ok(Object.keys(jobs).length > 0, 'workflow 必须定义至少一个 job')

  for (const [name, job] of Object.entries(jobs)) {
    if (job.steps === undefined) continue
    assert.ok(Array.isArray(job.steps), `job "${name}" 的 steps 必须是数组（否则 GitHub 直接判定 workflow 非法）`)
    job.steps.forEach((step, index) => {
      assert.ok(
        step && typeof step === 'object' && (step.uses || step.run),
        `job "${name}" 第 ${index + 1} 个 step 必须包含 uses 或 run`,
      )
    })
  }
})

test('CI: gate job 必须依赖全部作业并在任一非 success 时判红', (t) => {
  const doc = loadWorkflow()
  if (!doc) {
    t.skip('js-yaml 不可用')
    return
  }
  const jobs = doc.jobs || {}
  const gate = jobs.gate
  assert.ok(gate, '必须存在 gate job')
  assert.equal(gate.if, 'always()', 'gate 必须使用 if: always() 以便上游失败时仍能评估')

  const needs = Array.isArray(gate.needs) ? gate.needs : [gate.needs]
  for (const jobName of Object.keys(jobs)) {
    if (jobName === 'gate') continue
    assert.ok(needs.includes(jobName), `gate.needs 必须包含 "${jobName}"，否则该作业失败不会阻断发布`)
  }

  const script = (gate.steps || []).map((s) => s.run || '').join('\n')
  for (const marker of ['timed_out', 'action_required', 'cancelled', 'skipped', 'startup_failure', 'stale']) {
    assert.ok(script.includes(marker), `gate 脚本必须显式拒绝 "${marker}" 状态`)
  }
  assert.match(script, /-ne 'success'|-ne "success"|nonSuccess/, 'gate 必须以 success 为唯一通过条件')
})

test('CI: 内容一致性门禁已接入且不可被移除', () => {
  assert.match(source, /verify:consistency/, 'CI 必须执行 npm run verify:consistency')
  assert.match(source, /consistency:/, '必须存在 consistency job')
})

test('CI: 打包冒烟与安全审计在非 PR 事件下为必过项', (t) => {
  const doc = loadWorkflow()
  if (!doc) {
    t.skip('js-yaml 不可用')
    return
  }
  const jobs = doc.jobs || {}
  for (const name of ['packaged', 'security']) {
    assert.ok(jobs[name], `必须存在 ${name} job（发布证据）`)
    assert.match(String(jobs[name].if || ''), /pull_request/, `${name} 应在非 PR 事件下执行`)
  }
  const gateScript = (jobs.gate.steps || []).map((s) => s.run || '').join('\n')
  assert.match(gateScript, /packaged/, 'gate 必须在推送事件下把 packaged 计入必过项')
  assert.match(gateScript, /security/, 'gate 必须在推送事件下把 security 计入必过项')
})
