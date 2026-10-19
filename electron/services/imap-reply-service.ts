/**
 * imap-reply-service.ts — 本地 IMAP 回复检测（Phase 2.5）
 *
 * 目的：云端投递的 outreach 目前只到 Resend 侧闭环（sent / delivered / bounced）。
 * 客户回复邮件的接收由本地 IMAP 承担——Kone 通过 IMAP 拉取 INBOX，
 * 用 `In-Reply-To` 头匹配 `outreach.provider_message_id`，命中即调用
 * `POST /v1/outreach/reply` 上报云端（把 outreach 推到 'replied' 终态），
 * 并把状态回写到本地 agentStatus（AGENT.LEAD_STATUS_UPDATED 推送）。
 *
 * 与 email-agent.checkReply 的差异（不重叠，各司其职）：
 * - `checkReply(leadEmail, sinceDate)`：按发件人域名判断"该 lead 是否回过邮件"，
 *   服务本地 Agent 序列推进；不区分具体是哪一条 outreach。
 * - `pollReplies()`：按 In-Reply-To 匹配**具体某一条 outreach** 的 provider_message_id，
 *   服务云端投递闭环（云端 outreach 状态收敛到 'replied'）。
 *
 * 依赖与配置：
 * - Cloudflare provider 已配置（走 reportOutreachReply）
 * - user_config.accounts.email.imapHost 已显式设置（IMAP 与 SMTP 主机不同，不做派生兜底）
 * - imapUser / imapPass 缺省回退到 smtpUser / smtpPass（后者含 secret-manager 加密）
 *
 * 幂等与安全：
 * - 云端 UNIQUE(outreach_id, message_id) 保证重复上报幂等
 * - IMAP 拉取窗口 = 配置 lookbackDays（默认 3 天），避免扫描整个 INBOX
 * - Fail-Closed：任一前置缺失即返回 skip 语义，不抛错、不阻塞其他 sync
 */

import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc, registry } from '../ipc/registry'
import { isCloudflareConfigured, pollOutreachStatus, reportOutreachReply } from './cloudflare-service'
import { getSecret } from './secret-manager'
import { SECRET_KEYS, type ConfigStore } from './config-service'
import { buildFeatureDeniedResponse } from './license-service'
import type { AgentStatus } from '../../src/shared/ipc-contracts'

/* ──────────────────────────────────────────────
 *  Types
 * ────────────────────────────────────────────── */

type ImapReplyConfig = {
  enabled: boolean
  intervalMs: number
  lookbackDays: number
}

type ImapCredentials = {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

export type ImapPollResult = {
  polled: number
  matched: number
  reported: number
  idempotent: number
  skipped?: string
  errors: string[]
  since: string
  at: string
}

type LastPollState = {
  result: ImapPollResult | null
  at: string | null
  running: boolean
}

/* ──────────────────────────────────────────────
 *  Module state
 * ────────────────────────────────────────────── */

let pollTimer: NodeJS.Timeout | null = null
let firstPollTimeout: NodeJS.Timeout | null = null
const lastState: LastPollState = { result: null, at: null, running: false }

/* ──────────────────────────────────────────────
 *  Config / Credentials loaders
 * ────────────────────────────────────────────── */

export const getImapReplyConfig = (store: ConfigStore): ImapReplyConfig => ({
  enabled: store.get('cloud.imapReplyDetectionEnabled') === true,
  intervalMs: Number(store.get('cloud.imapReplyInterval')) || 15 * 60 * 1000,
  lookbackDays: Number(store.get('cloud.imapReplyLookbackDays')) || 3,
})

/**
 * 读取 IMAP 凭证。策略：
 * - host/port：仅从 user_config.accounts.email 显式读取（不派生自 smtpHost）
 * - user：imapUser → smtpUser
 * - pass：imapPass 加密槽 → imapPass 明文遗留 → smtpPass 加密槽 → smtpPass 明文遗留
 * - 任一必需字段缺失即返回 null（Fail-Closed）
 *
 * 密码存储优先级：imap 独立槽 > imap 明文 > smtp 槽 > smtp 明文。
 * 允许"共用同一账户密码"的场景直接留空 imapPass 复用 SMTP 槽。
 */
export const readImapCredentials = (store: ConfigStore): ImapCredentials | null => {
  const raw = store.get('user_config') as Record<string, unknown> | undefined
  const accounts = (raw?.accounts ?? {}) as Record<string, unknown>
  const emailAccount = (accounts.email ?? {}) as Record<string, unknown>

  const host = String(emailAccount.imapHost || '').trim()
  if (!host) return null

  const port = Number(emailAccount.imapPort || 993)
  const user = String(emailAccount.imapUser || emailAccount.smtpUser || '').trim()
  if (!user) return null

  const explicitImapSecret = getSecret(SECRET_KEYS.EMAIL_IMAP_PASS).trim()
  const legacyImapPlain = String(emailAccount.imapPass || '').trim()
  const smtpSecret = getSecret(SECRET_KEYS.EMAIL_SMTP_PASS).trim()
  const legacySmtpPlain = String(emailAccount.smtpPass || '').trim()
  const pass = explicitImapSecret || legacyImapPlain || smtpSecret || legacySmtpPlain
  if (!pass) return null

  return {
    host,
    port,
    secure: port === 993,
    user,
    pass,
  }
}

/* ──────────────────────────────────────────────
 *  Message-id helpers
 * ────────────────────────────────────────────── */

/**
 * 归一化 message-id 用于匹配。
 * RFC 5322 允许 message-id 带 <> 角括号（IMAP envelope 里通常不带，但 header 字符串里可能带），
 * 也可能有空白。统一剥离并小写，避免大小写/前后空白导致漏匹配。
 */
const normalizeMessageId = (raw: string | undefined | null): string => {
  if (!raw) return ''
  return raw
    .trim()
    .replace(/^<+|>+/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 从 References 头（空格分隔的多个 message-id）拆出归一化的集合 */
const extractReferences = (referencesHeader: string | undefined): Set<string> => {
  const set = new Set<string>()
  if (!referencesHeader) return set
  for (const part of referencesHeader.split(/\s+/)) {
    const normalized = normalizeMessageId(part)
    if (normalized) set.add(normalized)
  }
  return set
}

/* ──────────────────────────────────────────────
 *  Core poll logic
 * ────────────────────────────────────────────── */

/**
 * 单次 IMAP 回复轮询。
 *
 * 步骤：
 *  1. 前置检查（cloudflare 配置 / IMAP 配置）——不满足即 skip
 *  2. 从云端拉取 status='sent' 的 outreach 列表，构建 message-id → outreachId map
 *     （'delivered' 亦加入，因为部分客户回复发生在云端 webhook 尚未回填 delivered 时）
 *  3. IMAP 连接 INBOX，搜索 since=lookbackDays 以来的消息
 *  4. 对每条消息读 envelope + References 头，归一化后与 map 匹配
 *  5. 命中即调用 reportOutreachReply 上报（云端幂等）
 *  6. 上报成功后推送 AGENT.LEAD_STATUS_UPDATED（本地状态即时刷新）
 *
 * 返回值：
 *  - polled / matched / reported / idempotent 计数
 *  - skipped 表示"因为前置缺失而未执行"（非错误），errors 表示执行中的单条失败
 */
export const pollReplies = async (
  store: ConfigStore,
  mainWindow: Electron.BrowserWindow | null,
): Promise<ImapPollResult> => {
  const startedAt = new Date().toISOString()
  const errors: string[] = []
  const baseResult: ImapPollResult = {
    polled: 0,
    matched: 0,
    reported: 0,
    idempotent: 0,
    errors,
    since: startedAt,
    at: startedAt,
  }

  if (lastState.running) {
    return { ...baseResult, skipped: 'poll_in_progress' }
  }
  lastState.running = true

  try {
    // ── 1. 前置检查 ───────────────────────────────────────────
    if (!isCloudflareConfigured(store)) {
      return { ...baseResult, skipped: 'cloudflare_not_configured' }
    }
    const creds = readImapCredentials(store)
    if (!creds) {
      return { ...baseResult, skipped: 'imap_not_configured' }
    }

    // ── 2. 拉云端 sent/delivered outreach 建索引 ──────────────
    const messageIndex = new Map<string, { outreachId: string; leadId: string }>()
    for (const status of ['sent', 'delivered']) {
      try {
        const result = await pollOutreachStatus(store, { status, limit: 200 })
        for (const o of result.outreach || []) {
          const normalized = normalizeMessageId(o.providerMessageId)
          if (normalized) messageIndex.set(normalized, { outreachId: o.id, leadId: o.leadId })
        }
      } catch (err) {
        errors.push(`poll cloud status=${status}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (messageIndex.size === 0) {
      return { ...baseResult, skipped: 'no_outstanding_outreach' }
    }

    // ── 3. IMAP 连接 + 拉取 INBOX ─────────────────────────────
    const since = new Date()
    since.setDate(since.getDate() - getImapReplyConfig(store).lookbackDays)
    baseResult.since = since.toISOString()

    const { ImapFlow } = await import('imapflow')
    const client = new ImapFlow({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth: { user: creds.user, pass: creds.pass },
      logger: false,
      // 保守的连接超时：避免网络抖动导致轮询挂起
      socketTimeout: 30_000,
    })

    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const uids = await client.search({ since }, { uid: true })
        if (!uids || uids.length === 0) {
          return { ...baseResult }
        }

        baseResult.polled = uids.length

        // ── 4. 逐条读 envelope + References 头匹配 ────────────
        for await (const msg of client.fetch(
          { uid: uids.join(',') },
          {
            envelope: true,
            headers: ['In-Reply-To', 'References', 'Message-Id'],
          },
          { uid: true },
        )) {
          const envelope = (msg as any).envelope || {}
          const headers = ((msg as any).headers || {}) as Record<string, string | string[]>

          const inReplyTo = normalizeMessageId(envelope.inReplyTo || firstHeader(headers['In-Reply-To']))
          const references = extractReferences(firstHeader(headers['References']))
          const myMessageId = normalizeMessageId(envelope.messageId || firstHeader(headers['Message-Id']))

          // 命中判定：In-Reply-To 或 References 链里出现被投递 outreach 的 message-id
          let matchedOutreachId: string | undefined
          let matchedLeadId: string | undefined
          const candidates: string[] = []
          if (inReplyTo) candidates.push(inReplyTo)
          for (const ref of references) candidates.push(ref)

          for (const candidate of candidates) {
            const hit = messageIndex.get(candidate)
            if (hit) {
              matchedOutreachId = hit.outreachId
              matchedLeadId = hit.leadId
              break
            }
          }
          if (!matchedOutreachId) continue

          baseResult.matched++

          // 提取回复元数据
          const sender = firstAddress(envelope.from)
          const subject = envelope.subject || firstHeader(headers['Subject'])
          const receivedAt = envelope.date ? new Date(envelope.date).toISOString() : undefined

          // ── 5. 上报云端 ─────────────────────────────────────
          try {
            const resp = await reportOutreachReply(store, {
              outreachId: matchedOutreachId,
              messageId: myMessageId || `imap-uid-${msg.uid}`,
              inReplyTo: inReplyTo || undefined,
              sender: sender || creds.user,
              subject,
              receivedAt,
            })
            if (resp.success) {
              if (resp.data?.idempotent) {
                baseResult.idempotent++
              } else {
                baseResult.reported++
              }
              // ── 6. 推送本地状态 ─────────────────────────────
              if (matchedLeadId && !resp.data?.idempotent) {
                await pushRepliedStatus(mainWindow, matchedLeadId, baseResult.reported === 1 ? undefined : undefined)
              }
            } else {
              errors.push(
                `report reply outreach=${matchedOutreachId}: ${resp.error?.message || resp.error?.code || 'unknown'}`,
              )
            }
          } catch (err) {
            errors.push(
              `report reply outreach=${matchedOutreachId}: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      } finally {
        lock.release()
      }
    } finally {
      try {
        await client.logout()
      } catch {
        /* ignore */
      }
    }

    return baseResult
  } finally {
    lastState.running = false
    lastState.result = baseResult
    lastState.at = baseResult.at
  }
}

/* ──────────────────────────────────────────────
 *  Header / envelope helpers
 * ────────────────────────────────────────────── */

const firstHeader = (value: string | string[] | undefined): string => {
  if (!value) return ''
  return Array.isArray(value) ? value[0] || '' : value
}

const firstAddress = (addresses: any[] | undefined): string => {
  if (!addresses || !addresses.length) return ''
  return String(addresses[0]?.address || addresses[0]?.text || '').trim()
}

/* ──────────────────────────────────────────────
 *  Local status push
 * ────────────────────────────────────────────── */

const pushRepliedStatus = async (
  mainWindow: Electron.BrowserWindow | null,
  leadKey: string,
  _unused: undefined,
): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const agentStatus: Partial<AgentStatus> = {
    whatsappStatus: 'replied',
    whatsappSent: true,
    emailSequenceStage: 0 as AgentStatus['emailSequenceStage'],
  }
  mainWindow.webContents.send(IPC_CHANNELS.AGENT.LEAD_STATUS_UPDATED, {
    leadKey,
    agentStatus,
  })
}

/* ──────────────────────────────────────────────
 *  Timer management（与 outreach-sync-service 对齐）
 *
 *  [V1.3.10] P2.8b：main.ts 已在 `registry.lock()` 之后调用 startImapReplyPoll()，
 *  并在 `before-quit` 中调用 stopImapReplyPoll()。首次轮询延迟 5 秒，与 outreach-sync
 *  的启动节奏一致，避免 IMAP 连接风暴与 Cloudflare 认证风暴。
 *
 *  开关：`cloud.imapReplyDetectionEnabled` 默认 false（需客户显式开启），
 *  与 `cloud.outreachSyncEnabled`（默认 true）形成"IMAP 是可选增强"的语义。
 *  未开启时 startImapReplyPoll 立即返回，timer 保持 null。
 * ────────────────────────────────────────────── */

export const startImapReplyPoll = (store: ConfigStore, mainWindow: Electron.BrowserWindow | null): void => {
  stopImapReplyPoll()

  const config = getImapReplyConfig(store)
  if (!config.enabled) return

  pollTimer = setInterval(async () => {
    try {
      await pollReplies(store, mainWindow)
    } catch (err) {
      console.error('[ImapReply] unhandled poll error:', err instanceof Error ? err.message : err)
    }
  }, config.intervalMs)

  // 首次轮询延迟 5 秒，对齐 outreach-sync-service 的启动节奏
  firstPollTimeout = setTimeout(async () => {
    try {
      await pollReplies(store, mainWindow)
    } catch (err) {
      console.error('[ImapReply] first-poll error:', err instanceof Error ? err.message : err)
    }
  }, 5000)
}

export const stopImapReplyPoll = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (firstPollTimeout) {
    clearTimeout(firstPollTimeout)
    firstPollTimeout = null
  }
}

/* ──────────────────────────────────────────────
 *  Connection test（[V1.3.12] P2.8d）
 *
 *  纯连通性验证：仅 connect + getMailboxLock('INBOX')，不拉邮件、不做 message-id 匹配。
 *  目的：让客户配好 IMAP 后立即自检，避免"填错主机名/密码错/防火墙拦截"三种常见坑。
 *  Fail-Closed：未配置时返回 ok=false，不抛错。
 *  隐私：仅返回 mailbox 名 + totalMessages，不泄露邮件内容或发件人。
 * ────────────────────────────────────────────── */

export type ImapTestResult = {
  ok: boolean
  message: string
  mailbox?: string
  totalMessages?: number
  latencyMs?: number
}

export const testImapConnection = async (store: ConfigStore): Promise<ImapTestResult> => {
  const creds = readImapCredentials(store)
  if (!creds) {
    return {
      ok: false,
      message: 'IMAP 未配置：请在账户管理邮箱表单中填写 IMAP 主机（imap.gmail.com 等，与 smtp.gmail.com 不同）',
    }
  }
  const t0 = Date.now()
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
    socketTimeout: 30_000,
  })
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const mb = await client.mailboxOpen('INBOX')
      if (!mb || !mb.exists) {
        return {
          ok: false,
          message: `INBOX 邮箱未找到或不可访问（${creds.host}:${creds.port}）`,
          latencyMs: Date.now() - t0,
        }
      }
      return {
        ok: true,
        message: `已连接到 ${creds.host}:${creds.port}，INBOX 共 ${mb.exists} 封邮件`,
        mailbox: 'INBOX',
        totalMessages: mb.exists,
        latencyMs: Date.now() - t0,
      }
    } finally {
      lock.release()
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - t0,
    }
  } finally {
    try {
      await client.logout()
    } catch {
      /* ignore */
    }
  }
}

/* ──────────────────────────────────────────────
 *  Status getter（供 IMAP_STATUS IPC 使用）
 * ────────────────────────────────────────────── */

export const getImapReplyStatus = (
  store: ConfigStore,
): {
  enabled: boolean
  intervalMs: number
  lookbackDays: number
  cloudflareConfigured: boolean
  imapConfigured: boolean
  lastPoll: { at: string; result: ImapPollResult } | null
  running: boolean
} => {
  const config = getImapReplyConfig(store)
  return {
    enabled: config.enabled,
    intervalMs: config.intervalMs,
    lookbackDays: config.lookbackDays,
    cloudflareConfigured: isCloudflareConfigured(store),
    imapConfigured: readImapCredentials(store) !== null,
    lastPoll: lastState.at && lastState.result ? { at: lastState.at, result: lastState.result } : null,
    running: lastState.running,
  }
}

/* ──────────────────────────────────────────────
 *  IPC Handler Registration
 * ────────────────────────────────────────────── */

/* D4（2026-10-19）：`licenseGuard` 由 main.ts 注入（唯一实例），紧邻 `store` 以与
   cloudflare/autopilot/config 三个服务的签名次序保持一致。 */
export const registerImapReplyHandlers = (
  ipcMain: Electron.IpcMain,
  store: ConfigStore,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  getWindow: () => Electron.BrowserWindow | null,
): void => {
  /* D4（2026-10-19 修复）：三个 IMAP 通道此前**无任何门禁**——试用版可读取 / 重启 / 测试
     邮件回信服务（属 Agent 域状态，PRD §6.0 禁止向 Trial 暴露）。统一按 `local_autopilot`
     拦截；Basic 持有该能力（AGENTS.md：Paid Basic 可用低量本地 Email），Trial 不持有。 */
  const requireLocalAutopilot = (operationName: string) => {
    try {
      licenseGuard.requireFeature('local_autopilot', operationName)
      return null
    } catch (error: any) {
      return buildFeatureDeniedResponse(operationName, error)
    }
  }

  // automation:imap-poll — 手动触发一次轮询
  registerIpc(
    IPC_CHANNELS.AUTOMATION.IMAP_POLL,
    {
      channel: IPC_CHANNELS.AUTOMATION.IMAP_POLL,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async (_event: unknown) => {
      const result = await pollReplies(store, getWindow())
      return { success: true, data: result }
    },
  )

  // automation:imap-status — 读取配置与最近一次轮询结果
  registerIpc(
    IPC_CHANNELS.AUTOMATION.IMAP_STATUS,
    {
      channel: IPC_CHANNELS.AUTOMATION.IMAP_STATUS,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async (_event: unknown) => {
      // D4：读端同拦——IMAP 状态即 Agent 域运行指标（PRD §6.0 禁向 Trial 暴露）。
      const denied = requireLocalAutopilot('IMAP 状态读取')
      if (denied) return denied
      return { success: true, data: getImapReplyStatus(store) }
    },
  )

  // [V1.3.11] automation:imap-restart — UI 切换"自动回复检测"开关后立即重启 timer
  // 场景：客户在 Accounts 表单保存 IMAP 配置并启用自动检测 → 前端 configSet 落盘 → 调此通道
  //       → 主进程重新读 config 并 stop + start poll timer，无需重启应用
  // Fail-Closed：若 enabled=false，startImapReplyPoll 立即返回，timer 保持 null；不抛错
  registerIpc(
    IPC_CHANNELS.AUTOMATION.IMAP_RESTART,
    {
      channel: IPC_CHANNELS.AUTOMATION.IMAP_RESTART,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async (_event: unknown) => {
      // D4：必须在**副作用之前**拦截——不得出现"拒绝但仍重启了 timer"的半执行状态。
      const denied = requireLocalAutopilot('IMAP 自动检测重启')
      if (denied) return denied
      startImapReplyPoll(store, getWindow())
      return { success: true, data: getImapReplyStatus(store) }
    },
  )

  // [V1.3.12] automation:imap-test-connection — 纯连接性验证，不拉邮件
  // 场景：客户配好 IMAP 后点"测试连接"按钮，立即得到 { ok, message, totalMessages, latencyMs }
  // 目的：让客户在开启自动检测前先验证主机/密码/防火墙是否通过，避免静默失败
  registerIpc(
    IPC_CHANNELS.AUTOMATION.IMAP_TEST_CONNECTION,
    {
      channel: IPC_CHANNELS.AUTOMATION.IMAP_TEST_CONNECTION,
      requestRule: { type: 'any' },
      responseRule: { type: 'any' },
    },
    async (_event: unknown) => {
      // D4：连接性探测同样向 Trial 暴露"是否已配置邮箱"，必须在发起前拦截。
      const denied = requireLocalAutopilot('IMAP 连接测试')
      if (denied) return denied
      const result = await testImapConnection(store)
      return { success: true, data: result }
    },
  )

  registry.attach(ipcMain)
}
