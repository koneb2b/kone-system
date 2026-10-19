const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Phase 2B-Lite.1：Serper 单源独立搜索——接线守卫（零网络，源码级断言）。
// 验证目标（任务书 §六）：
//  1) 显式选择 serper 时只派发 Serper（跳过 SerpApi 主源 / AnySearch / 其它 Provider）
//  2) 原有 google_organic / 盲搜语义不变（门禁未删、organic 唯一路由保留）
//  3) 单源唯一来源失败必须真实冒泡（不伪装「成功但 0 条」，不自动回退）
//  4) 前端「默认」不改变既有 payload（dataSourceType 仍 undefined）
//  5) 密钥不出现在错误/日志路径（SerperProvider 层另行有行为测试）
// 真实 HTTP 行为由 tests/business-logic/serper-provider.business.test.js 的 mock 覆盖。

const readSource = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')

const searchService = readSource('electron/services/search-service.ts')
const useSearchEngine = readSource('src/hooks/use-search-engine.ts')
const searchEngineTsx = readSource('src/components/search-engine.tsx')
const serperProvider = readSource('electron/services/providers/serper-provider.ts')

/* 空白规整器：把源码压成单空白序列，用于对多行结构做稳健 includes 匹配 */
const flat = (src) => src.replace(/\s+/g, ' ')

test('守卫-1: serper 单源判定 + 门禁条件分支（原 SerpApi 门禁语义未删除）', () => {
  assert.equal(flat(searchService).includes("const serperOnlyMode = dataSourceType === 'serper'"), true)
  // 门禁保留但放行条件显式化：未配置 SerpApi 时，仅 serper 单源 + 已有 serper 密钥才放行
  assert.equal(flat(searchService).includes('(!googleKey || !googleBaseUrl) && !serperBypassesSerpGate'), true)
  // serper 单源但无密钥 ⇒ 明确报错（不得静默回退消耗 SerpApi/AnySearch 额度）
  assert.equal(flat(searchService).includes('serperOnlyMode && !serperKey'), true)
  assert.equal(searchService.includes('尚未配置 Serper 密钥'), true)
  // 原 SerpApi 配置缺失错误必须仍然存在（旧语义未回退）
  assert.equal(searchService.includes('搜索服务尚未配置'), true)
})

test('守卫-2: serper 单源跳过 AnySearch（不并行调用）', () => {
  const flatService = flat(searchService)
  const anySearchEnabledIdx = searchService.indexOf('const anySearchEnabled = Boolean(')
  const anySearchEndIdx = searchService.indexOf(')', anySearchEnabledIdx)
  const anySearchBlock = flat(searchService.slice(anySearchEnabledIdx, anySearchEndIdx))
  assert.equal(
    anySearchBlock.includes('!serperOnlyMode'),
    true,
    'anySearchEnabled 必须排除 serper 单源模式（不消耗 AnySearch 额度）',
  )
})

test('守卫-3: serper 单源走双波分支且 SerpApi 主源被跳过', () => {
  const flatService = flat(searchService)
  assert.equal(flatService.includes('if (isSerpApi || serperOnlyMode)'), true)
  // 单源不运行 SerpApi 主源：serpPromise 在 serperOnlyMode 下解析为空 plan
  assert.equal(
    flatService.includes(
      "serperOnlyMode ? Promise.resolve({ allOrganic: [], allLocal: [], activeSearchMode: 'serper-only' }) : resolveSerpSearchPlan",
    ),
    true,
    '显式选择 serper 时不得调用 resolveSerpSearchPlan（SerpApi 主源）',
  )
})

test('守卫-4: providerIds 单源路由只含 serper，原有 organic 路由不变', () => {
  const flatService = flat(searchService)
  assert.equal(
    flatService.includes(
      "dataSourceType === 'google_organic' ? ['google_organic'] : dataSourceType === 'serper' ? ['serper'] : undefined",
    ),
    true,
  )
})

test('守卫-5: 单源唯一来源失败必须真实冒泡（不伪装成功，不回退）', () => {
  const flatService = flat(searchService)
  // providerPromise 收集 serper-only 的真实错误（error + 0 结果即失败，不得丢弃）
  assert.equal(flatService.includes('const serperOnlyFailures: string[] = []'), true)
  assert.equal(flatService.includes('serperOnlyFailures.push(result.error)'), true)
  // 全部变体失败（mergedFinal 为空）时抛出真实错误 → 外层 catch → stream:error
  assert.equal(
    flatService.includes('if (serperOnlyMode && mergedFinal.length === 0 && serperOnlyFailures.length > 0)'),
    true,
    '唯一来源失败必须抛错冒泡，不得伪装为搜索成功',
  )
})

test('守卫-6: 前端默认值保持既有盲搜 payload（undefined），显式选择才传 serper', () => {
  assert.equal(
    flat(useSearchEngine).includes("dataSourceType: manualSearchSource === 'serper' ? 'serper' : undefined"),
    true,
  )
  assert.equal(flat(useSearchEngine).includes("useState<'default' | 'serper'>('default')"), true)
  // UI 必须提供显式选择入口（否则用户无法「明确选择 serper」）
  assert.equal(searchEngineTsx.includes('data-testid="select-search-source"'), true)
  assert.equal(searchEngineTsx.includes('单源：Serper'), true)
})

test('守卫-7: SerperProvider 不自动重试（fetchWithRetry 单次调用）', () => {
  assert.equal(/SERPER_RETRYABLE_STATUS/.test(serperProvider), false)
  assert.equal(/shouldRetry/.test(serperProvider), false)
  assert.equal(/retries:/.test(serperProvider), false, '不得出现 retries 配置（重试=重复消耗自备额度）')
})
