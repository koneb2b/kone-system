const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

// AGENT.* 通道门禁分类守护。
//
// ## 为什么需要
// 审计遗留建议要求「遍历所有 AGENT.* 通道，断言写通道与读通道 feature 键一致」。
// 但**照字面实现会制造新的过度约束**：AGENT 通道分三类，只有一类该门禁。
// 若一律要求门禁，会误伤两处**正确的设计**：
//   · GET_STATUS —— 线索级触达徽标（P0-1 双管道读端），线索是 Trial 的合法数据
//   · SUPPRESS_* —— 邮件合规（PROJECT-PRD §3.7.7），退订请求**任何套餐都必须能登记**
//
// ## 已发生的同类缺陷（本测试防的就是"下一处"）
// 1. `AGENT.LIST` 无门禁 → Trial 可直连 IPC 读取全部智能体 dailyLimit/status 运行指标
// 2. `AGENT.GET_LOG` 无门禁 → 日志在启动时由 `hydrateAgentPersistence` **无条件**从
//    `user_config.agent_logs` 恢复（与授权解耦），Trial / 降级用户可读取完整历史触达日志
//
// ## 做法
// 维护**显式分类清单**（下方 GUARDED / UNGUARDED），双向断言：
//   · GUARDED 通道必须真的带 `requireFeature('local_autopilot', ...)`
//   · UNGUARDED 通道必须**不带**任何 feature 门禁（且清单里写明豁免理由）
//   · 源码中新出现、却不在任何清单里的 AGENT.* invoke 通道 → **直接失败**
// 这样"新增通道忘记定级"会被立刻拦下，而"定错级"需要人写进清单并给出理由。
//
// ## 本测试是静态断言 —— 已知边界（诚实记录）
// 它验证"门禁代码在不在"，不验证"运行时真的返回 403"。后者需要实例化
// `registerAgentHandlers` 并打桩 registerIpc/licenseGuard 等模块依赖，成本较高。
// 之所以接受这个边界：
//   · `AGENT.GET_LOG` 的**唯一消费方**是 `agents-panel.tsx:181 fetchLog`，其调用
//     有 `catch → setLogEntries([])` 兜底 → 403 只会得到空日志抽屉，不会崩 UI
//   · 该 UI 入口本身在 `AGENT.LIST` 门禁之后（Trial 拿不到 agent 列表，进不来此面板）
//     —— 本次修复堵的是 IPC **直连**（DevTools）绕过渲染层的路径
//   · `requireFeature` 的 403 语义已被 `AGENT.LIST` 在生产路径验证过（同一调用形态）
// 若将来 GET_LOG 出现新的消费方，应补运行时场景到 `tests/e2e/permission-lock.test.js`。

const repoRoot = path.join(__dirname, '..', '..')
const AGENT_SERVICE = path.join(repoRoot, 'electron', 'services', 'agent-service.ts')

const source = fs.readFileSync(AGENT_SERVICE, 'utf8')

/** 受门禁通道：暴露智能体运行指标，宪法禁止向 Trial 提供。 */
const GUARDED = {
  'AGENT.LIST': '智能体列表，含 dailyLimit/status 等运行指标',
  'AGENT.GET_LOG': '智能体运行日志（含 company/detail），同属运行指标',
  'AGENT.CONTROL': '启停智能体（Fail-Closed 包装器）',
}

/** 免门禁通道：**必须**对 Trial 可用，附豁免理由。 */
const UNGUARDED = {
  'AGENT.GET_STATUS': '线索级触达状态徽标（P0-1 双管道读端）——线索是 Trial 合法数据',
  'AGENT.SUPPRESS_LIST': '邮件合规：退订名单查询（PROJECT-PRD §3.7.7）',
  'AGENT.SUPPRESS_ADD': '邮件合规：登记退订请求，任何套餐都必须可用',
  'AGENT.SUPPRESS_REMOVE': '邮件合规：撤销退订登记，任何套餐都必须可用',
}

/** 提取源码中出现的 AGENT.* invoke 通道（PUSH 推送通道不在其列）。 */
const collectAgentChannels = () => {
  const found = new Set()
  const re = /IPC_CHANNELS\.(AGENT)\.([A-Z_]+)/g
  let m
  while ((m = re.exec(source))) found.add(`AGENT.${m[2]}`)
  return found
}

/** 取某个通道注册块（注册起、到下一个 registerIpc/registerSecure 或 1200 字符内）。 */
const channelBlock = (channel) => {
  const idx = source.indexOf(`IPC_CHANNELS.${channel}`)
  if (idx < 0) return null
  const rest = source.slice(idx)
  const nextReg = rest.slice(1).search(/registerIpc\(|registerSecureFeatureIpc\(|registerSecureIpc\(/)
  const end = nextReg > 0 ? nextReg + 1 : Math.min(rest.length, 1200)
  return rest.slice(0, end)
}

/** 只出现一次的 PUSH 通道（仅推送事件，不是 invoke 请求通道）。 */
const PUSH_ONLY = new Set(['AGENT.STATUS_CHANGED', 'AGENT.LEAD_STATUS_UPDATED'])

test('AGENT 门禁守护：受门禁通道必须带 requireFeature(local_autopilot)', () => {
  for (const [channel, why] of Object.entries(GUARDED)) {
    // AGENT.CONTROL 走 registerSecureFeatureIpc 包装器，feature 键以首参传入
    if (channel === 'AGENT.CONTROL') {
      assert.ok(
        /registerSecureFeatureIpc\(\s*\n?\s*'local_autopilot'[\s\S]{0,200}?AGENT\.CONTROL/.test(source) ||
          /AGENT\.CONTROL[\s\S]{0,400}?'local_autopilot'/.test(source),
        `${channel} 必须由 registerSecureFeatureIpc 以 'local_autopilot' 包装（${why}）`,
      )
      continue
    }
    const block = channelBlock(channel)
    assert.ok(block, `未找到 ${channel} 注册块`)
    assert.ok(
      /requireFeature\(\s*'local_autopilot'/.test(block),
      `${channel} 必须带 requireFeature('local_autopilot') 门禁（${why}）`,
    )
  }
})

test('AGENT 门禁守护：免门禁通道必须真的没有门禁（防过度约束）', () => {
  for (const [channel, why] of Object.entries(UNGUARDED)) {
    const block = channelBlock(channel)
    assert.ok(block, `未找到 ${channel} 注册块`)
    assert.ok(!/requireFeature\(/.test(block), `${channel} 不应有任何 feature 门禁（${why}）——误加会阻断合规/线索徽标`)
  }
})

test('AGENT 门禁守护：受门禁通道不得退化为免门禁（反向断言）', () => {
  // 防止有人把 GUARDED 通道的门禁删掉后，仅靠 removeGuarded 就"通过"
  for (const channel of Object.keys(GUARDED)) {
    const block = channelBlock(channel)
    assert.ok(block, `未找到 ${channel} 注册块`)
    assert.ok(/local_autopilot/.test(block), `${channel} 的运行指标必须继续受 local_autopilot 保护`)
  }
})

test('AGENT 门禁守护：新增 AGENT 通道必须先在清单中定级', () => {
  const known = new Set([...Object.keys(GUARDED), ...Object.keys(UNGUARDED), ...PUSH_ONLY])
  const unclassified = [...collectAgentChannels()].filter((c) => !known.has(c))
  assert.deepEqual(
    unclassified,
    [],
    `发现未定级的 AGENT 通道：${unclassified.join(', ')}\n` +
      '请在 feature-gate-tier 测试的 GUARDED / UNGUARDED 清单中显式定级，' +
      '并在 agent-service.ts 中落实门禁——否则该通道会绕过授权边界。',
  )
})

test('AGENT 门禁守护：分类清单与源码通道总数一致（防清单腐烂）', () => {
  const declared = new Set([...Object.keys(GUARDED), ...Object.keys(UNGUARDED), ...PUSH_ONLY])
  const actual = collectAgentChannels()
  // 清单里的每个通道都应真实存在于源码
  for (const c of declared) {
    assert.ok(actual.has(c), `清单中的 ${c} 在源码中已不存在 —— 请更新清单（清单腐烂）`)
  }
})
