/**
 * 云端 outreach 字段映射契约测试（P0-1 回归守卫）
 *
 * 背景：
 *   kone-cloud 的 D1 以 **snake_case** 返回 outreach 行（sent_at / workspace_id / lead_id ...），
 *   而本地契约 `OutreachStatus` 为 **camelCase**（sentAt / workspaceId / leadId ...）。
 *   此前 `pollOutreachStatus` 直接 `return body.data as PollOutreachResult` 裸强转——
 *   TypeScript 的 `as` 只在编译期生效，运行时字段名仍是 snake_case，
 *   于是除 id / status / subject / provider / error 五个同名字段外，**所有时间戳恒为 undefined**，
 *   导致看板漏斗全 0、趋势恒空、明细表被时间窗口整表过滤为空、CSV 时间戳列全空、
 *   IMAP 轮询恒 skipped:'no_outstanding_outreach'。
 *   而既有门禁（typecheck / 单测 / IPC 一致性）均不覆盖跨进程字段命名，故全绿放行。
 *
 * 本测试锁定三件事：
 *   1. mapOutreachRow 确实把 snake_case 映射为 camelCase（关键时间戳有值）
 *   2. 映射结果不得残留 snake_case 字段（防止新增列时漏映射）
 *   3. 覆盖本地契约的全部字段，NULL 回落为 null 而非 undefined
 *
 * 关联：kone-cloud/src/worker.ts（返回 D1 原始行）、
 *       electron/services/cloudflare-service.ts（mapOutreachRow）、
 *       src/shared/ipc-contracts.ts（CloudOutreachRecord）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const servicePath = '../dist-electron/electron/services/cloudflare-service.js'
const { mapOutreachRow } = require(servicePath)

/** 与 kone-cloud D1 SELECT 列名完全一致的 snake_case 行 */
const D1_ROW = {
  id: 'out_1',
  workspace_id: 'ws_1',
  lead_id: 'lead_1',
  campaign_id: 'camp_1',
  sequence_stage: 2,
  scheduled_at: '2026-10-01T00:00:00.000Z',
  sent_at: '2026-10-01T01:00:00.000Z',
  delivered_at: '2026-10-01T01:05:00.000Z',
  bounced_at: null,
  complained_at: null,
  replied_at: '2026-10-02T09:00:00.000Z',
  provider: 'resend',
  resend_id: 're_123',
  provider_message_id: '<abc@example.com>',
  subject: 'Hello',
  status: 'replied',
  bounce_type: null,
  error: null,
  send_attempts: 1,
  next_retry_at: null,
  created_at: '2026-09-30T00:00:00.000Z',
  updated_at: '2026-10-02T09:00:00.000Z',
}

test('mapOutreachRow 把 D1 snake_case 行映射为本地 camelCase 契约', () => {
  const m = mapOutreachRow(D1_ROW)
  // 核心断言：这些字段此前恒为 undefined（看板数据全空的直接原因）
  assert.equal(m.sentAt, D1_ROW.sent_at, 'sent_at → sentAt')
  assert.equal(m.deliveredAt, D1_ROW.delivered_at, 'delivered_at → deliveredAt')
  assert.equal(m.repliedAt, D1_ROW.replied_at, 'replied_at → repliedAt')
  assert.equal(m.createdAt, D1_ROW.created_at, 'created_at → createdAt')
  assert.equal(m.workspaceId, D1_ROW.workspace_id, 'workspace_id → workspaceId')
  assert.equal(m.leadId, D1_ROW.lead_id, 'lead_id → leadId')
  assert.equal(m.providerMessageId, D1_ROW.provider_message_id, 'provider_message_id → providerMessageId')
  assert.equal(m.bouncedAt, null, 'bounced_at 为 NULL 时回落 null')
  assert.equal(m.sendAttempts, 1, 'send_attempts → sendAttempts')
})

test('映射结果不得残留 snake_case 字段（新增列漏映射时报警）', () => {
  const m = mapOutreachRow(D1_ROW)
  const snakeKeys = Object.keys(m).filter((k) => k.includes('_'))
  assert.deepEqual(snakeKeys, [], `映射结果残留 snake_case 字段: ${snakeKeys.join(', ')}`)
})

test('映射结果覆盖 CloudOutreachRecord 契约的全部字段', () => {
  const m = mapOutreachRow(D1_ROW)
  const required = [
    'id',
    'workspaceId',
    'leadId',
    'campaignId',
    'sequenceStage',
    'scheduledAt',
    'sentAt',
    'deliveredAt',
    'bouncedAt',
    'complainedAt',
    'repliedAt',
    'provider',
    'resendId',
    'providerMessageId',
    'subject',
    'status',
    'bounceType',
    'error',
    'sendAttempts',
    'nextRetryAt',
    'createdAt',
    'updatedAt',
  ]
  for (const key of required) {
    assert.ok(key in m, `映射结果缺少契约字段 ${key}`)
  }
})

test('缺失 / NULL 字段回落为 null 或空串，不产生 undefined', () => {
  const m = mapOutreachRow({ ...D1_ROW, sent_at: null, campaign_id: null, send_attempts: null })
  assert.equal(m.sentAt, null, 'sent_at NULL → null（而非 undefined）')
  assert.equal(m.campaignId, '', 'campaign_id NULL → 空串（契约要求 string）')
  assert.equal(m.sendAttempts, 0, 'send_attempts NULL → 0')
  // 兜底：不得出现 undefined 值
  const undefKeys = Object.keys(m).filter((k) => m[k] === undefined)
  assert.deepEqual(undefKeys, [], `映射结果出现 undefined 字段: ${undefKeys.join(', ')}`)
})
