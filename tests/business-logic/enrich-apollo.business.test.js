/**
 * enrich-apollo 守护测试（2026-10-11）
 *
 * ## 背景
 * 现有富化 100% 依赖「官网深探」：商家官网普遍**不公开邮箱**、公开电话**几乎都是座机**
 * →「邮箱覆盖低 + WhatsApp 用不了」的根因。Apollo 直接返回**已验证邮箱 + 手机号（含类型）**。
 *
 * 本测试锁定三条不变量：
 *   ① **Fail-Closed 是绝对底线**：无密钥 / 无标识 / 429 / 超时 / 无命中 一律
 *     `{ used:false }`，**绝不抛错、绝不中断搜索**，且**无密钥时零网络请求**（不烧额度）。
 *   ② **Apollo 的 mobile 类型是权威来源**（不靠号段猜测）→ phoneKind='mobile' 且可达；
 *     非 mobile → 走 phone-kind SSOT 复判，**不得夸大为 mobile**。
 *   ③ **宪法合规**：每轮搜索查询预算上限 = 20（总量护栏），
 *     且接线仅在「高价值线索 + 预算剩余 + 已配置密钥」时触发。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const REPO_ROOT = path.join(__dirname, '..', '..')
const ADAPTER_JS = path.join(REPO_ROOT, 'dist-electron', 'electron', 'services', 'search', 'enrich-apollo.js')
const PHONE_KIND_JS = path.join(REPO_ROOT, 'dist-electron', 'src', 'shared', 'phone-kind.js')
const ADAPTER_TS = path.join(REPO_ROOT, 'electron', 'services', 'search', 'enrich-apollo.ts')
const SEARCH_SERVICE_TS = path.join(REPO_ROOT, 'electron', 'services', 'search-service.ts')
const CONFIG_SERVICE_TS = path.join(REPO_ROOT, 'electron', 'services', 'config-service.ts')
const CONSTANTS_TS = path.join(REPO_ROOT, 'electron', 'services', 'search', 'constants.ts')
const CONTACT_VALIDATION_TS = path.join(REPO_ROOT, 'electron', 'utils', 'contact-validation.ts')
const BASE_SETTINGS_TS = path.join(REPO_ROOT, 'src', 'components', 'settings', 'base-settings-tab.tsx')
const SYSTEM_SETTINGS_TS = path.join(REPO_ROOT, 'src', 'components', 'system-settings.tsx')
const PRD_MD = path.join(REPO_ROOT, 'kone-PRD.md')

const readSrc = (p) => fs.readFileSync(p, 'utf8')

const electronMock = {
  app: { isPackaged: false, name: 'Kone AI', getPath: () => path.join(REPO_ROOT, '.tmp-enrich-apollo-test') },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (v) => Buffer.from(v, 'utf8'),
    decryptString: (b) => b.toString('utf8'),
  },
}

/**
 * 以受控的 secret / fetch 实现加载编译产物。
 * fetch 调用被完整记录，用于断言「零请求」「请求体契约」。
 */
const loadAdapter = ({ secretValue = '', fetchImpl = null } = {}) => {
  const phoneKind = require(PHONE_KIND_JS)
  const fetchCalls = []
  const originalLoad = require('node:module')._load

  require('node:module')._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock
    if (parent && /search[\\/]enrich-apollo\.js$/.test(parent.filename)) {
      if (request === '../secret-manager') return { getSecret: () => secretValue }
      if (request === '../config-service') return { SECRET_KEYS: { APOLLO_API_KEY: 'secrets.apollo.apiKey' } }
      if (request === '../proxy-service')
        return {
          fetchWithTimeout: async (url, init, timeoutMs) => {
            fetchCalls.push({ url, init, timeoutMs })
            if (typeof fetchImpl === 'function') return fetchImpl(url, init, timeoutMs)
            return { ok: true, status: 200, json: async () => ({}) }
          },
        }
      /* contact-validation 会连带引入 email-verification 等重依赖；此处直接给它 SSOT 本体，
         保证被测代码走的是**真实的** classifyPhoneKind / buildWhatsAppDigits。 */
      if (request === '../../utils/contact-validation') return phoneKind
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    delete require.cache[require.resolve(ADAPTER_JS)]
    return { adapter: require(ADAPTER_JS), fetchCalls }
  } finally {
    require('node:module')._load = originalLoad
  }
}

/* ── ① Fail-Closed 绝对底线 ───────────────────────────────────── */

test('Apollo 富化：未配置密钥必须 Fail-Closed，且**零网络请求**（不得烧额度）', async () => {
  const { adapter, fetchCalls } = loadAdapter({ secretValue: '' })

  const result = await adapter.enrichFromApollo({ domain: 'https://acme.com', company: 'ACME' })

  assert.equal(result.used, false)
  assert.equal(result.source, 'apollo')
  assert.equal(result.email, undefined)
  assert.equal(result.phone, undefined)
  assert.equal(result.phoneKind, 'unknown')
  assert.equal(result.phoneReachable, false)
  assert.equal(fetchCalls.length, 0, '无密钥不得发起任何 Apollo 请求')
})

test('Apollo 富化：既无域名也无公司名必须 Fail-Closed（不发请求）', async () => {
  const { adapter, fetchCalls } = loadAdapter({ secretValue: 'mock-key-123456' })

  const result = await adapter.enrichFromApollo({})

  assert.equal(result.used, false)
  assert.equal(fetchCalls.length, 0, '无可匹配标识不得浪费一次查询')
})

test('Apollo 富化：429 / 5xx 必须 Fail-Closed，不得抛错', async () => {
  for (const status of [429, 500, 503]) {
    const { adapter, fetchCalls } = loadAdapter({
      secretValue: 'mock-key-123456',
      fetchImpl: () => ({ ok: false, status, json: async () => ({}) }),
    })

    const result = await adapter.enrichFromApollo({ domain: 'https://acme.com' })

    assert.equal(result.used, false, `HTTP ${status} 必须降级为 used:false`)
    assert.equal(result.email, undefined)
    assert.equal(fetchCalls.length, 1, `HTTP ${status} 确实发起过一次查询`)
  }
})

test('Apollo 富化：网络异常 / 超时（fetch 抛错）必须 Fail-Closed', async () => {
  const { adapter } = loadAdapter({
    secretValue: 'mock-key-123456',
    fetchImpl: () => {
      throw new Error('request timeout')
    },
  })

  const result = await adapter.enrichFromApollo({ domain: 'https://acme.com' })

  assert.equal(result.used, false, '网络异常必须吞掉并降级')
  assert.equal(result.phoneKind, 'unknown')
})

test('Apollo 富化：有密钥但无命中（空 person）必须 Fail-Closed', async () => {
  const { adapter } = loadAdapter({
    secretValue: 'mock-key-123456',
    fetchImpl: () => ({ ok: true, status: 200, json: async () => ({}) }),
  })

  const result = await adapter.enrichFromApollo({ domain: 'https://acme.com', company: 'ACME' })

  assert.equal(result.used, false)
  assert.equal(result.email, undefined)
  assert.equal(result.phone, undefined)
})

/* ── ② 命中时的回填契约与号码类型判定 ─────────────────────────── */

test('Apollo 富化：命中时必须回填已验证邮箱 + mobile 手机号，并携带 reveal 参数', async () => {
  const { adapter, fetchCalls } = loadAdapter({
    secretValue: 'mock-key-123456',
    fetchImpl: () => ({
      ok: true,
      status: 200,
      json: async () => ({
        person: {
          email: 'buyer@acme.com',
          phone_numbers: [{ sanitized_number: '+1 832 555 1234', type: 'mobile' }],
        },
      }),
    }),
  })

  const result = await adapter.enrichFromApollo({ domain: 'https://acme.com', company: 'ACME', country: 'US' })

  assert.equal(result.used, true)
  assert.equal(result.source, 'apollo')
  assert.equal(result.email, 'buyer@acme.com')
  assert.equal(result.phone, '+1 832 555 1234')
  /* Apollo 自报 mobile 是权威来源：即使美国 LNP 号码无法靠号段区分，也必须采信 */
  assert.equal(result.phoneKind, 'mobile')
  assert.equal(result.phoneReachable, true, 'Apollo 确认的 mobile 应判为 WhatsApp 可达')

  assert.equal(fetchCalls.length, 1)
  const body = JSON.parse(fetchCalls[0].init.body)
  assert.equal(body.api_key, 'mock-key-123456')
  assert.equal(body.domain, 'acme.com')
  assert.equal(body.company, 'ACME')
  assert.equal(body.reveal_personal_emails, true, '必须请求个人邮箱')
  assert.equal(body.reveal_phone_number, true, '必须请求手机号')
})

test('Apollo 富化：CN 手机号（Apollo mobile）必须可达 WhatsApp', async () => {
  const { adapter } = loadAdapter({
    secretValue: 'mock-key-123456',
    fetchImpl: () => ({
      ok: true,
      status: 200,
      json: async () => ({
        person: {
          email: 'sales@cnfirm.cn',
          phone_numbers: [{ sanitized_number: '+86 139 1234 5678', type: 'mobile' }],
        },
      }),
    }),
  })

  const result = await adapter.enrichFromApollo({ domain: 'https://cnfirm.cn', company: 'CNFIRM', country: 'CN' })

  assert.equal(result.phoneKind, 'mobile')
  assert.equal(result.phoneReachable, true)
})

test('Apollo 富化：座机 / 非 mobile 类型**不得**被夸大为 mobile', async () => {
  const { adapter } = loadAdapter({
    secretValue: 'mock-key-123456',
    fetchImpl: () => ({
      ok: true,
      status: 200,
      json: async () => ({
        person: {
          email: 'info@usfirm.com',
          phone_numbers: [{ sanitized_number: '+1 832 555 9999', type: 'main' }],
        },
      }),
    }),
  })

  const result = await adapter.enrichFromApollo({ domain: 'https://usfirm.com', country: 'US' })

  assert.equal(result.used, true)
  assert.equal(result.phone, '+1 832 555 9999')
  assert.notEqual(result.phoneKind, 'mobile', 'Apollo 未标 mobile 的号码不得判为 mobile')
  assert.equal(result.phoneReachable, false, '非 mobile 不得标记为 WhatsApp 可达')
})

test('Apollo 富化：多条电话必须**优先选 mobile** 类型', async () => {
  const { adapter } = loadAdapter({
    secretValue: 'mock-key-123456',
    fetchImpl: () => ({
      ok: true,
      status: 200,
      json: async () => ({
        person: {
          phone_numbers: [
            { sanitized_number: '+1 832 555 0001', type: 'main' },
            { sanitized_number: '+1 832 555 0002', type: 'mobile' },
          ],
        },
      }),
    }),
  })

  const result = await adapter.enrichFromApollo({ domain: 'https://usfirm.com', country: 'US' })

  assert.equal(result.phone, '+1 832 555 0002', '必须优先返回 mobile 类型号码')
  assert.equal(result.phoneKind, 'mobile')
})

test('Apollo 富化：仅邮箱或仅电话命中都算 used（部分回填仍有价值）', async () => {
  const emailOnly = loadAdapter({
    secretValue: 'mock-key-123456',
    fetchImpl: () => ({ ok: true, status: 200, json: async () => ({ person: { email: 'a@b.com' } }) }),
  })
  const emailResult = await emailOnly.adapter.enrichFromApollo({ domain: 'https://b.com' })
  assert.equal(emailResult.used, true)
  assert.equal(emailResult.email, 'a@b.com')
  assert.equal(emailResult.phone, undefined)
  assert.equal(emailResult.phoneKind, 'unknown')

  const phoneOnly = loadAdapter({
    secretValue: 'mock-key-123456',
    fetchImpl: () => ({
      ok: true,
      status: 200,
      json: async () => ({ person: { phone_numbers: [{ sanitized_number: '+49 151 1234567', type: 'mobile' }] } }),
    }),
  })
  const phoneResult = await phoneOnly.adapter.enrichFromApollo({ domain: 'https://d.de', country: 'DE' })
  assert.equal(phoneResult.used, true)
  assert.equal(phoneResult.phoneKind, 'mobile')
})

test('Apollo 富化：密钥读取必须 trim 空值视为未配置', async () => {
  const { adapter } = loadAdapter({ secretValue: '   ' })
  const result = await adapter.enrichFromApollo({ domain: 'https://acme.com' })
  assert.equal(result.used, false, '纯空白密钥必须等同未配置（不得带空密钥发请求）')
})

/* ── ③ 宪法合规：预算上限 + 接线门禁 + 归因 ───────────────────── */

test('宪法常量：ENRICH_LOOKUP_BUDGET = 20（每轮搜索 Apollo 查询硬顶）', () => {
  const src = readSrc(CONSTANTS_TS)
  assert.match(src, /export const ENRICH_LOOKUP_BUDGET = 20/, '预算上限必须为 20')
})

test('归口合规：Apollo 预算属「总量护栏」，不触碰并发红线 SEARCH_ENRICH_CONCURRENCY', () => {
  const src = readSrc(CONSTANTS_TS)
  assert.match(src, /SEARCH_ENRICH_CONCURRENCY = 2/, '富化并发红线仍为 2，未被本次改动改动')
})

test('接线门禁：仅「高价值 + 预算剩余 + 已配置密钥」三者同时成立才触发 Apollo', () => {
  const src = readSrc(SEARCH_SERVICE_TS)
  assert.match(
    src,
    /if \(payload\.highValue && payload\.enrichBudget && getUserApolloApiKey\(\)/,
    'Apollo 触发必须同时满足 highValue + enrichBudget + 密钥存在（可再叠加前置条件，如 Prospeo 已命中则跳过）',
  )
  assert.match(src, /if \(payload\.enrichBudget\.used < payload\.enrichBudget\.limit\)/, '预算用尽后必须停止追加查询')
  assert.match(
    src,
    /const enrichBudget = \{ used: 0, limit: ENRICH_LOOKUP_BUDGET \}/,
    '每轮搜索必须新建独立预算计数器（跨轮次不串账）',
  )
})

test('数据归因：仅 Apollo/Prospeo 真正贡献数据时才标注，不得虚标', () => {
  const src = readSrc(SEARCH_SERVICE_TS)
  assert.match(
    src,
    /const enrichSourceSuffix = \(prospeo\?\.used \? ' · Prospeo' : ''\) \+ \(apollo\?\.used \? ' · Apollo' : ''\)/,
    '后缀仅在各自 used 时追加（Prospeo / Apollo 均不得虚标）',
  )
  assert.match(src, /\+ enrichSourceSuffix\)\.trim\(\)/, '归因必须落到返回的 source 字段上')
})

test('数据溯源闭环：Apollo 归因必须落在 403 降级路径的**同一 return 对象**内', () => {
  /* 反例（已真实发生过）：归因只写在正常返回路径上，403 降级路径靠 `...blindLead` 顺带带入；
   * 但 blindLead 为 null（LLM 盲评超时/失败）时不展开任何字段 → source 退回
   * `payload.candidate.source`，于是「邮箱/电话来自 Apollo，来源却只显示 Google Maps」，
   * 静默丢失数据溯源。
   *
   * 断言手法：不做全局计数（那样会把 403 路径内部 blindLead **入参对象**里的 source 也算进来，
   * 形成自证循环、测不出真缺陷——此坑已实际踩过一次），而是定位到含
   * `fallbackStatus: usedSocialFallback` 的 403 降级 return 对象，
   * 要求 `source:` 覆盖就在**同一个对象字面量内**。 */
  const src = readSrc(SEARCH_SERVICE_TS)
  const marker = 'fallbackStatus: usedSocialFallback'
  const at = src.indexOf(marker)
  assert.ok(at !== -1, '必须存在 403 降级路径的 fallbackStatus 字段')
  const retAt = src.lastIndexOf('return {', at)
  assert.ok(retAt !== -1, 'fallbackStatus 必须位于某个 return 对象内')
  assert.ok(
    at - retAt < 1500,
    `fallbackStatus 距最近的 return { 为 ${at - retAt} 字符，已超出对象字面量尺度，断言失去定位意义`,
  )
  const block = src.slice(retAt, at)
  assert.match(
    block,
    /\+ enrichSourceSuffix\)\.trim\(\)/,
    '403 降级路径的同一 return 对象内必须有数据源归因覆盖（blindLead 为 null 时不得丢失溯源）',
  )
})

test('电话优先级：多来源电话中必须**优先选手机**（最大化 WhatsApp 可达性）', () => {
  const src = readSrc(SEARCH_SERVICE_TS)
  assert.match(src, /const mobile = ranked\.find\(\(r\) => r\.kind === 'mobile'\)/, '必须优先选 mobile')
  /* 2026-10-13（S2）：返回值改为 `{ phone, provenance }`（取值与来源同源），
     回退顺序改由 `fallbackOrder` 数组显式表达 —— **顺序本身不变**（候选 > 官网 > 提取）。 */
  assert.match(
    src,
    /const fallbackOrder = \[candidatePhone, websitePhone, extractedPhone\]/,
    '无手机时必须保持既有回退顺序（候选 > 官网 > 提取），不破坏历史行为',
  )
})

test('PRD §零.3 已同步 ENRICH_LOOKUP_BUDGET（文档与代码 SSOT 一致）', () => {
  const src = readSrc(PRD_MD)
  assert.match(src, /ENRICH_LOOKUP_BUDGET/, 'PRD 宪法常量表必须登记该常量')
  const row = src.split('\n').find((line) => line.includes('ENRICH_LOOKUP_BUDGET'))
  assert.ok(row, 'PRD 中必须存在该行')
  assert.match(row, /\*\*`20`\*\*/, 'PRD 必须给出权威值 20')
})

test('密钥通道：Apollo 密钥已加入白名单，设置页可写（否则 secret:set 返回 403）', () => {
  const src = readSrc(CONFIG_SERVICE_TS)
  assert.match(src, /APOLLO_API_KEY: 'secrets\.apollo\.apiKey'/, 'SECRET_KEYS 必须登记 Apollo 密钥')
  const wlBlock = src.slice(src.indexOf('SECRET_SET_WHITELIST'))
  assert.match(wlBlock, /SECRET_KEYS\.APOLLO_API_KEY/, 'Apollo 密钥必须在 SECRET_SET_WHITELIST 内')
})

test('双端 SSOT：contact-validation 必须继续导出号码判定（主进程不得另写一份）', () => {
  const src = readSrc(CONTACT_VALIDATION_TS)
  assert.match(src, /buildWhatsAppDigits/, '必须导出 buildWhatsAppDigits 供主进程复用')
  assert.match(src, /classifyPhoneKind/, '必须导出 classifyPhoneKind')
  assert.match(src, /from '\.\.\/\.\.\/src\/shared\/phone-kind'/, '必须来自双端 SSOT，不得本地重实现')
})

test('设置页：Apollo 已作为正式服务商出现，且走 secrets.apollo.apiKey', () => {
  const base = readSrc(BASE_SETTINGS_TS)
  const sys = readSrc(SYSTEM_SETTINGS_TS)
  assert.match(base, /apollo: 'secrets\.apollo\.apiKey'/, 'base-settings-tab 必须映射 Apollo 密钥键')
  assert.match(sys, /apollo: 'secrets\.apollo\.apiKey'/, 'system-settings 必须映射 Apollo 密钥键')
  assert.match(sys, /id: 'apollo'/, 'defaultConfigs 必须包含 Apollo 项')
})
