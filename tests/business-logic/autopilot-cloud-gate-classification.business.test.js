const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

// AUTOPILOT.* / CLOUD.CLOUDFLARE_* 通道门禁分类守护。
//
// ## 为什么需要（与 agent-gate-classification 同源的纪律）
// 审计把这两个域标记为「疑似能力泄漏 / 收口未完成」。但**照直觉逐通道加门禁会制造
// 第三处过度约束事故**（前两处已知：AGENT.GET_STATUS / AGENT.SUPPRESS_* 被误门禁后
// 由全量 test:unit 拦下并回滚）。本测试把"判定依据"固化为可执行断言，使
// "新增通道忘记定级"或"把门禁加到错误位置"立刻失败。
//
// ## 判定结论（依据源码实测，2026-10-20）
// · AUTOPILOT 的**真实执行边界在搜索层，不在本域通道**：
//   `src/lib/autopilot-runner.ts:319` → `searchExecute()`；Trial 已被搜索层限额约束
//   （10 条/次、间隔 15 秒）。故 GET/SET/SYNC 属**状态管道**，非能力授予面。
// · `AUTOPILOT.SET_STATE` 是 `createThrottledPersister` 的持久化底座，随草稿输入频繁触发
//   （`autopilot-store.ts:335/369/398/.../556`）——加门禁 = 每次输入批次返回 FEATURE_DENIED
//   = 对 Trial 搜索页的**可见降级**。
// · `AUTOPILOT.SYNC_STATE` 是系统托盘生命周期遥测；其**注册顺序**已被
//   `autopilot-sync-attach-guard.business.test.js` 锁定，加门禁有重现托盘 P0 的风险。
// · CLOUD.CLOUDFLARE_* 门禁的**前置条件是渲染层降级**：`CloudSettingsTab` 目前**无条件挂载**
//   （`system-settings.tsx:514`）且内部 `Promise.all`（`cloud-settings-tab.tsx:43`）。
//   渲染层未条件化之前加门禁会重演 P0-2「整页降级」。故当前不门禁（见 PENDING 清单）。
//
// ## 已知陷阱（本测试显式锁定，避免未来把门禁写成死代码）
// `CLOUD.CLOUDFLARE_TEST_CONNECTION` 被**双重注册**：`cloudflare-service.ts` 先注册，
// `outreach-sync-service.ts` 后注册并**覆盖**（其注释自述此前因此产生过"测试连接永远失败"
// 的真实缺陷）。且 `registerOutreachSyncHandlers` **未接收 licenseGuard**。
// → 任何只写在 cloudflare-service 内的门禁，对 TEST_CONNECTION 都是**死代码**。
//
// ## 边界（诚实记录）
// 本测试是**静态断言**：验证"门禁代码在不在、在哪儿"，不验证运行时 403 语义。
// 运行时语义由 `tests/ipc-license-gate-d1-d6.test.ts` / `ipc-license-gate-d2-d5.test.ts` 覆盖。

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

const autopilotStateSrc = read(path.join('electron', 'services', 'autopilot-state-service.ts'))
const mainSrc = read(path.join('electron', 'main.ts'))
const cloudflareSrc = read(path.join('electron', 'services', 'cloudflare-service.ts'))
const outreachSrc = read(path.join('electron', 'services', 'outreach-sync-service.ts'))

/** 受门禁通道：能力授予面 / 配置写动作，必须带 feature 门禁。 */
const GUARDED = {
  'AUTOPILOT.CLEAR_LEGACY': '巡航遗留配置清理（写动作）——按 local_autopilot（Paid Basic 起）',
}

/** 免门禁通道：**必须**保持无门禁，附豁免理由。 */
const UNGUARDED = {
  'AUTOPILOT.GET_STATE': '状态读取——Trial 搜索页 hydrateFromStorage 合法调用（同 AGENT.GET_STATUS 先例）',
  'AUTOPILOT.SET_STATE': '节流持久化底座（随草稿输入触发）——加门禁 = Trial 可见降级',
  'AUTOPILOT.SYNC_STATE': '系统托盘生命周期遥测——注册顺序已被 autopilot-sync-attach-guard 锁定',
}

/** 暂不门禁（**前置条件未满足**，非永久豁免）：渲染层降级落地后方可收口。 */
const PENDING_GUARD_AFTER_RENDERER_DEGRADE = {
  'CLOUD.CLOUDFLARE_CONFIGURED': '配置探测——CloudSettingsTab 无条件挂载，先做渲染层条件化',
  'CLOUD.CLOUDFLARE_TEST_CONNECTION': '⚠ 有效 handler 在 outreach-sync（后注册覆盖），此处加门禁为死代码',
  'CLOUD.CLOUDFLARE_DASHBOARD_STATS': '云端看板聚合——渲染层 Promise.all 会导致整页降级',
  'CLOUD.CLOUDFLARE_POLL_OUTREACH_STATUS': '云端触达明细——同 DASHBOARD_STATS',
}

const findBlock = (channel, span = 1400) => {
  const sources = channel.startsWith('AUTOPILOT.') ? [autopilotStateSrc, mainSrc] : [cloudflareSrc, outreachSrc]
  for (const src of sources) {
    const idx = src.indexOf(`IPC_CHANNELS.${channel}`)
    if (idx < 0) continue
    const rest = src.slice(idx)
    const next = rest.slice(1).search(/registerIpc\(/)
    return next > 0 ? rest.slice(0, next + 1) : rest.slice(0, Math.min(rest.length, span))
  }
  return null
}

const collectChannels = (sources, domain, prefix) => {
  const re = new RegExp(`IPC_CHANNELS\\.${domain}\\.${prefix}[A-Z_]+`, 'g')
  const found = new Set()
  for (const src of sources) {
    let m
    while ((m = re.exec(src))) found.add(m[0].replace('IPC_CHANNELS.', ''))
  }
  return found
}

test('AUTOPILOT/CLOUD 门禁守护：受门禁通道必须带 requireFeature(local_autopilot)', () => {
  for (const [channel, why] of Object.entries(GUARDED)) {
    const block = findBlock(channel)
    assert.ok(block, `未找到 ${channel} 注册块`)
    assert.ok(
      /requireFeature\(\s*'local_autopilot'/.test(block),
      `${channel} 必须带 requireFeature('local_autopilot') 门禁（${why}）`,
    )
    assert.ok(
      /buildFeatureDeniedResponse\(/.test(block),
      `${channel} 的拒绝分支必须走统一信封 buildFeatureDeniedResponse（${why}）`,
    )
  }
})

test('AUTOPILOT 门禁守护：状态管道必须真的没有门禁（防过度约束）', () => {
  for (const [channel, why] of Object.entries(UNGUARDED)) {
    const block = findBlock(channel)
    assert.ok(block, `未找到 ${channel} 注册块`)
    assert.ok(
      !/requireFeature\(/.test(block),
      `${channel} 不应有任何 feature 门禁（${why}）——误加会降级 Trial 搜索页/托盘`,
    )
  }
})

test('CLOUD 门禁守护：渲染层降级落地前不得门禁 CLOUDFLARE_*（防 P0-2 整页降级）', () => {
  for (const [channel, why] of Object.entries(PENDING_GUARD_AFTER_RENDERER_DEGRADE)) {
    const block = findBlock(channel)
    assert.ok(block, `未找到 ${channel} 注册块`)
    assert.ok(
      !/requireFeature\(/.test(block),
      `${channel} 暂不得门禁（${why}）。若已完成渲染层条件化，请同步更新本清单与 docs/release-gate.md。`,
    )
  }
})

test('CLOUD 陷阱锁定：CLOUDFLARE_TEST_CONNECTION 双重注册且后注册者胜出', () => {
  assert.ok(
    cloudflareSrc.includes('IPC_CHANNELS.CLOUD.CLOUDFLARE_TEST_CONNECTION'),
    'cloudflare-service.ts 应先注册 TEST_CONNECTION',
  )
  assert.ok(
    outreachSrc.includes('IPC_CHANNELS.CLOUD.CLOUDFLARE_TEST_CONNECTION'),
    'outreach-sync-service.ts 应后注册（覆盖）TEST_CONNECTION',
  )

  const idxCf = mainSrc.indexOf('registerCloudflareHandlers(ipcMain')
  const idxOs = mainSrc.indexOf('registerOutreachSyncHandlers(ipcMain')
  assert.ok(idxCf > 0, '未找到 registerCloudflareHandlers 调用点')
  assert.ok(idxOs > 0, '未找到 registerOutreachSyncHandlers 调用点')
  assert.ok(idxOs > idxCf, 'outreach-sync 必须晚于 cloudflare 注册——否则"测试连接"被覆盖为仅 sync 动作，历史缺陷复发')

  const defStart = outreachSrc.indexOf('registerOutreachSyncHandlers')
  assert.ok(defStart >= 0, '未找到 registerOutreachSyncHandlers 定义')
  assert.ok(
    !/licenseGuard/.test(outreachSrc.slice(defStart, defStart + 300)),
    'registerOutreachSyncHandlers 不接收 licenseGuard —— 故 TEST_CONNECTION 的门禁须在此处补装授权参数，' +
      '仅写在 cloudflare-service 内是死代码',
  )
})

test('AUTOPILOT/CLOUD 门禁守护：新增通道必须先在清单中定级', () => {
  const known = new Set([
    ...Object.keys(GUARDED),
    ...Object.keys(UNGUARDED),
    ...Object.keys(PENDING_GUARD_AFTER_RENDERER_DEGRADE),
  ])

  const autopilotChannels = collectChannels([autopilotStateSrc, mainSrc], 'AUTOPILOT', '')
  const cloudflareChannels = collectChannels([cloudflareSrc, outreachSrc], 'CLOUD', 'CLOUDFLARE_')

  const unclassified = [...autopilotChannels, ...cloudflareChannels].filter((c) => !known.has(c))
  assert.deepEqual(
    unclassified,
    [],
    `发现未定级的通道：${unclassified.join(', ')}\n` +
      '请在本测试的 GUARDED / UNGUARDED / PENDING_GUARD_AFTER_RENDERER_DEGRADE 中显式定级并给出理由，' +
      '否则该通道会静默绕过授权边界（或误加门禁造成过度约束）。',
  )
})

test('AUTOPILOT/CLOUD 门禁守护：清单与源码通道一致（防清单腐烂）', () => {
  const declared = [
    ...Object.keys(GUARDED),
    ...Object.keys(UNGUARDED),
    ...Object.keys(PENDING_GUARD_AFTER_RENDERER_DEGRADE),
  ]
  const actual = new Set([
    ...collectChannels([autopilotStateSrc, mainSrc], 'AUTOPILOT', ''),
    ...collectChannels([cloudflareSrc, outreachSrc], 'CLOUD', 'CLOUDFLARE_'),
  ])
  for (const c of declared) {
    assert.ok(actual.has(c), `清单中的 ${c} 在源码中已不存在 —— 请更新清单（清单腐烂）`)
  }
})
