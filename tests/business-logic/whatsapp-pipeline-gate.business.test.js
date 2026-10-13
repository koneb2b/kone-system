/**
 * whatsapp-pipeline-gate.business.test.js
 *
 * 背景（2026-10-13 修复真实缺陷）：
 * `electron/services/agent-pipeline.ts` 原为 `if (lead.phone) queue.whatsapp.push(task)`
 * —— 对**任何电话（含座机）**都入队 WhatsApp。这与双端 SSOT `src/shared/phone-kind.ts`
 * （WhatsApp 是手机 App，**座机无法注册/接收**）**直接矛盾**，且与 UI 侧口径不一致
 * （`leads-management.tsx` 早已用 `classifyPhoneKind` 门禁）。
 * 后果：高级版自动巡航会对座机线索发起**必然失败**的 WhatsApp 任务。
 *
 * 本测试锁定：
 *   ① **源码守卫**：不得回退为「有 phone 就入队」；
 *   ② **行为契约**：`isWhatsAppReachable` 只放行手机；
 *   ③ **资格口径**：座机不是「可触达资产」，不得占用管道名额。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'electron', 'services', 'agent-pipeline.ts')
const MOD = path.join(ROOT, 'dist-electron', 'electron', 'services', 'agent-pipeline.js')
const PROV = path.join(ROOT, 'dist-electron', 'src', 'shared', 'contact-provenance.js')

/** 剥离注释，避免被说明性注释误触发（历史踩坑：注释里写了反例字符串）。 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n]*/g, '')

test('源码守卫：WhatsApp 入队必须经可达性 + 来源档位判定，不得回退为「有 phone 就入队」', () => {
  const src = stripComments(fs.readFileSync(SRC, 'utf8'))
  assert.ok(
    !/if \(lead\.phone\) queue\.whatsapp\.push/.test(src),
    '不得出现 `if (lead.phone) queue.whatsapp.push(...)`：座机也会被入队（与 phone-kind SSOT 矛盾）',
  )
  /* S3 后门禁升级为 `canAutoDispatchPhone`（可达性 + 来源档位），语义**更强**。 */
  assert.match(
    src,
    /if \(canAutoDispatchPhone\(lead\)\) queue\.whatsapp\.push/,
    'WhatsApp 入队必须经 `canAutoDispatchPhone(lead)` 门禁（可达性 + 来源档位）',
  )
  assert.match(src, /export const isWhatsAppReachable/, '必须导出 isWhatsAppReachable 供复用与测试')
  assert.match(src, /export const canAutoDispatchPhone/, '必须导出 canAutoDispatchPhone（S3 档位门禁）')
})

test('行为契约：isWhatsAppReachable 只放行手机号', async () => {
  const pipeline = require(MOD)
  assert.equal(typeof pipeline.isWhatsAppReachable, 'function')
  // 手机（后端已判定）→ 放行
  assert.equal(pipeline.isWhatsAppReachable({ phone: '+1 415 555 0100', phoneKind: 'mobile' }), true)
  // 座机 → 拒绝
  assert.equal(pipeline.isWhatsAppReachable({ phone: '(415) 555-0100', phoneKind: 'landline' }), false)
  // 无号码 → 拒绝
  assert.equal(pipeline.isWhatsAppReachable({ phone: '' }), false)
  assert.equal(pipeline.isWhatsAppReachable({}), false)
  // 无 phoneKind 的美国号码（LNP 无法从号段区分）→ 保守拒绝
  assert.equal(pipeline.isWhatsAppReachable({ phone: '+14155550100' }), false)
  // 无 phoneKind 但国家可判定（CN 手机段）→ 放行
  assert.equal(pipeline.isWhatsAppReachable({ phone: '13800138000', countryCode: 'CN' }), true)
})

test('资格口径：座机不是可触达资产，不得占用管道名额', async () => {
  const pipeline = require(MOD)
  assert.equal(pipeline.qualifiesForPipeline(80, { phone: '+14155550100', phoneKind: 'landline' }), false)
  assert.equal(pipeline.qualifiesForPipeline(80, { phone: '+14155550100', phoneKind: 'mobile' }), true)
  // 座机 + 邮箱 → 因邮箱可触达而 qualify
  assert.equal(
    pipeline.qualifiesForPipeline(80, { phone: '+14155550100', phoneKind: 'landline', email: 'a@b.com' }),
    true,
  )
})

test('端到端：座机-only 高分线索不进任何队列', async () => {
  const pipeline = require(MOD)
  const queue = await pipeline.withPipelineIsolation(async () =>
    pipeline.buildAgentTaskQueue([
      { company: 'LandlineCo', website: 'https://l.com', phone: '+14155550100', phoneKind: 'landline', matchScore: 95 },
      { company: 'MobileCo', website: 'https://m.com', phone: '+14155550101', phoneKind: 'mobile', matchScore: 95 },
    ]),
  )
  assert.equal(queue.whatsapp.length, 1, '仅手机线索入队')
  assert.equal(queue.whatsapp[0].company, 'MobileCo')
  assert.equal(queue.email.length, 0)
  assert.equal(queue.linkedin.length, 0)
})

/* ── S3：来源档位放行（显式 inferred 一律不得自动派发）────────────────── */

test('canAutoDispatch：仅显式 inferred 拦下；无标注按 extracted 放行（向后兼容）', () => {
  const { canAutoDispatch } = require(PROV)
  assert.equal(canAutoDispatch('verified'), true)
  assert.equal(canAutoDispatch('extracted'), true)
  assert.equal(canAutoDispatch('inferred'), false, '推测数据不得自动派发')
  assert.equal(canAutoDispatch(undefined), true, '无标注 = 历史数据，不得因此被整体排除')
})

test('canAutoDispatchPhone / canAutoDispatchEmail：档位 + 可达性双门禁', () => {
  const pipeline = require(MOD)
  const inferred = { tier: 'inferred', source: '模式推测' }
  const verified = { tier: 'verified', source: 'Prospeo' }
  // 手机：档位 inferred → 拦下
  assert.equal(
    pipeline.canAutoDispatchPhone({
      phone: '+14155550100',
      phoneKind: 'mobile',
      contactProvenance: { phone: inferred },
    }),
    false,
  )
  // 手机：verified + mobile → 放行
  assert.equal(
    pipeline.canAutoDispatchPhone({
      phone: '+14155550100',
      phoneKind: 'mobile',
      contactProvenance: { phone: verified },
    }),
    true,
  )
  // 手机：无档位（历史数据）+ mobile → 放行
  assert.equal(pipeline.canAutoDispatchPhone({ phone: '+14155550100', phoneKind: 'mobile' }), true)
  // 手机：无档位 + 座机 → 拦下（S1 语义仍生效）
  assert.equal(pipeline.canAutoDispatchPhone({ phone: '+14155550100', phoneKind: 'landline' }), false)
  // 邮箱：inferred → 拦下；无档位 → 放行；无邮箱 → 拦下
  assert.equal(pipeline.canAutoDispatchEmail({ email: 'a@b.com', contactProvenance: { email: inferred } }), false)
  assert.equal(pipeline.canAutoDispatchEmail({ email: 'a@b.com' }), true)
  assert.equal(pipeline.canAutoDispatchEmail({ email: '' }), false)
})

test('端到端：推测邮箱 + 推测手机 → 不 qualify 且不进任何队列', async () => {
  const pipeline = require(MOD)
  const inferred = { tier: 'inferred', source: '模式推测' }
  const lead = {
    company: 'GuessedCo',
    website: 'https://g.com',
    email: 'guess@guessed.co',
    phone: '+14155550100',
    phoneKind: 'mobile',
    contactProvenance: { email: inferred, phone: inferred },
    matchScore: 95,
  }
  assert.equal(pipeline.qualifiesForPipeline(95, lead), false, '推测数据不得占用管道名额')
  const queue = await pipeline.withPipelineIsolation(async () => pipeline.buildAgentTaskQueue([lead]))
  assert.equal(queue.whatsapp.length, 0, '推测手机不得自动入队')
  assert.equal(queue.email.length, 0, '推测邮箱不得自动入队')
})

test('端到端：已验证手机 + 推测邮箱 → 仅 WhatsApp 入队（按字段独立放行）', async () => {
  const pipeline = require(MOD)
  const queue = await pipeline.withPipelineIsolation(async () =>
    pipeline.buildAgentTaskQueue([
      {
        company: 'MixedCo',
        website: 'https://mx.com',
        email: 'guess@mixed.co',
        phone: '+14155550100',
        phoneKind: 'mobile',
        contactProvenance: {
          email: { tier: 'inferred', source: '模式推测' },
          phone: { tier: 'verified', source: 'Prospeo' },
        },
        matchScore: 95,
      },
    ]),
  )
  assert.equal(queue.whatsapp.length, 1, '已验证手机可自动入队')
  assert.equal(queue.email.length, 0, '推测邮箱不得自动入队（需人工确认）')
})
