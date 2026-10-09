import * as crypto from 'crypto'
import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpc, registry } from '../ipc/registry'
import {
  agentListContract,
  agentGetLogContract,
  agentGetStatusContract,
  agentSuppressListContract,
  agentSuppressAddContract,
  agentSuppressRemoveContract,
} from '../ipc/contracts/agent.contract'
import { app } from './electron-bridge'
import { ConfigStore, SECRET_KEYS, getUserLlmApiKey } from './config-service'
import { getSecret } from './secret-manager'
import { buildLlmEndpoint, fetchWithTimeout } from './proxy-service'
import { resolveDkimSelectors } from './dns-service'
import { createLicenseService, registerSecureFeatureIpc } from './license-service'
import type { AgentLogEntry, AgentStatus, SalesAgentType, SalesAgentState } from '../../src/shared/ipc-contracts'
import type { AgentTaskQueue } from './agent-pipeline'
import { isStaleTask, markPipelineStaged } from './agent-pipeline'
import { getSandboxPathForAccount, findAccountByType } from './sandbox-service'
import { EmailAgent } from './agents/email-agent'
import { WhatsAppAgent } from './agents/whatsapp-agent'
import { LinkedinAgent } from './agents/linkedin-agent'
import {
  createPlan,
  upsertPlan,
  getDuePlans,
  advancePlan,
  markReplied,
  nextStage,
  describeCadence,
  STAGE_INTERVAL_MS,
} from './followup-scheduler'
import { isEmailSuppressed, addSuppression, removeSuppression, readSuppressionList } from './email-suppression'
import { readKnowledgeSource, renderKnowledgePromptBlock, selectKnowledgeForAgent } from './agent-knowledge'
// Hourly cadence for the follow-up scheduler tick.
const FOLLOWUP_TICK_INTERVAL_MS = 60 * 60 * 1000

const DEFAULT_AGENT_DAILY_LIMITS: Record<SalesAgentType, { trial: number; basic: number; premium: number }> = {
  whatsapp: { trial: 3, basic: 5, premium: 100 },
  linkedin: { trial: 3, basic: 30, premium: 100 },
  email: { trial: 3, basic: 20, premium: 200 },
}

const DEFAULT_FULL_LIMIT = 50
const AGENT_TARGET_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes per target

let globalSender: Electron.WebContents | null = null
let appQuitHandlerRegistered = false

const withTargetTimeout = <T>(promise: Promise<T>, targetLabel: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Agent target timed out after ${AGENT_TARGET_TIMEOUT_MS}ms: ${targetLabel}`)),
        AGENT_TARGET_TIMEOUT_MS,
      )
      promise.finally(() => clearTimeout(timer)).catch(() => {})
    }),
  ])
}

const disconnectAllAgents = async () => {
  if (whatsappAgentInstance) {
    try {
      await whatsappAgentInstance.disconnect()
    } catch {
      /* ignore */
    }
  }
  if (linkedinAgentInstance) {
    try {
      await linkedinAgentInstance.disconnect()
    } catch {
      /* ignore */
    }
  }
  if (emailAgentInstance) {
    try {
      await emailAgentInstance.disconnect()
    } catch {
      /* ignore */
    }
  }
  whatsappAgentInstance = null
  linkedinAgentInstance = null
  emailAgentInstance = null
  for (const agent of agents.values()) {
    if (agent.status === 'running') {
      agent.status = 'idle'
      agent.errorMessage = 'Agent interrupted by app quit'
    }
  }
}

const agentLogs: Map<string, AgentLogEntry[]> = new Map()
const agentStatusStore: Map<string, AgentStatus> = new Map()

// ── P1-2: durable agent logs + agentStatus ──
// Both maps were memory-only and lost every touch history on restart, breaking
// the kone-PRD §3.7.8 promise that the UI reads persisted agentStatus and that
// `agent:get-log` returns a real AgentLogEntry[] timeline. We persist them to
// the local config store via a module-level reference (mirrors `globalSender`),
// set once at handler registration. Failures degrade silently (disk-protected
// env) — in-memory state stays the live session truth.
const AGENT_LOGS_CONFIG_KEY = 'agent_logs'
const AGENT_STATUS_CONFIG_KEY = 'agent_status'
// Cap per-agent log history so a long-lived install stays within low-spec
// memory/disk budgets (ARCH-STANDARDS §2: usable on 4G-8G office machines).
const MAX_LOG_ENTRIES_PER_AGENT = 200

let moduleStore: ConfigStore | null = null

const persistAgentLogs = () => {
  if (!moduleStore) return
  try {
    moduleStore.set(AGENT_LOGS_CONFIG_KEY, Object.fromEntries(agentLogs))
  } catch {
    /* disk-protected env → keep in-memory logs only */
  }
}

const persistAgentStatuses = () => {
  if (!moduleStore) return
  try {
    moduleStore.set(AGENT_STATUS_CONFIG_KEY, Object.fromEntries(agentStatusStore))
  } catch {
    /* disk-protected env → keep in-memory statuses only */
  }
}

// Re-load persisted logs + statuses so the touch timeline survives restarts.
const hydrateAgentPersistence = (store: ConfigStore) => {
  moduleStore = store
  try {
    const logs = store.get?.(AGENT_LOGS_CONFIG_KEY) as Record<string, AgentLogEntry[]> | undefined
    if (logs && typeof logs === 'object') {
      for (const [agentId, entries] of Object.entries(logs)) {
        if (Array.isArray(entries)) agentLogs.set(agentId, entries.slice(-MAX_LOG_ENTRIES_PER_AGENT))
      }
    }
    const statuses = store.get?.(AGENT_STATUS_CONFIG_KEY) as Record<string, AgentStatus> | undefined
    if (statuses && typeof statuses === 'object') {
      for (const [leadKey, status] of Object.entries(statuses)) {
        if (status && typeof status === 'object') agentStatusStore.set(leadKey, status)
      }
    }
  } catch {
    /* corrupt/absent persistence → start with empty in-memory maps */
  }
}

const addLogEntry = (agentId: string, event: string, detail?: string) => {
  if (!agentLogs.has(agentId)) {
    agentLogs.set(agentId, [])
  }
  const entries = agentLogs.get(agentId)!
  entries.push({
    timestamp: new Date().toISOString(),
    event,
    detail,
  })
  // Trim to the cap (keep most recent) before persisting.
  if (entries.length > MAX_LOG_ENTRIES_PER_AGENT) {
    entries.splice(0, entries.length - MAX_LOG_ENTRIES_PER_AGENT)
  }
  persistAgentLogs()
}

const agents: Map<string, SalesAgentState> = new Map([
  [
    'agent-whatsapp',
    {
      agentId: 'agent-whatsapp',
      agentType: 'whatsapp',
      status: 'idle',
      label: 'WhatsApp 拓客猎手',
      description:
        '实验性：通过 WhatsApp Web 半自动发送消息，需扫码登录并人工确认；受官方页面改版与风控影响可能不稳定。Basic 低频 3-5 条/天',
      progress: 0,
      totalTargets: 0,
      completedCount: 0,
      failedCount: 0,
      dailyLimit: DEFAULT_AGENT_DAILY_LIMITS.whatsapp.basic,
      dailyUsed: 0,
      queuedCount: 0,
    },
  ],
  [
    'agent-linkedin',
    {
      agentId: 'agent-linkedin',
      agentType: 'linkedin',
      status: 'idle',
      label: 'LinkedIn 商务猎手',
      description: '只读浏览高管公开主页 + AI 生成破冰文案供人工触达，不自动发送好友申请/私信',
      progress: 0,
      totalTargets: 0,
      completedCount: 0,
      failedCount: 0,
      dailyLimit: DEFAULT_AGENT_DAILY_LIMITS.linkedin.basic,
      dailyUsed: 0,
      queuedCount: 0,
    },
  ],
  [
    'agent-email',
    {
      agentId: 'agent-email',
      agentType: 'email',
      status: 'idle',
      label: '邮件长效跟随助理',
      description:
        '直连企业 SMTP 真实发信 + DNS 信誉检测软锁定；多轮定时序列（IMAP 回复检测已支持，未配置时人工挂起不盲推）。Basic 20 封/天',
      progress: 0,
      totalTargets: 0,
      completedCount: 0,
      failedCount: 0,
      dailyLimit: DEFAULT_AGENT_DAILY_LIMITS.email.basic,
      dailyUsed: 0,
      queuedCount: 0,
    },
  ],
])

let emailAgentInstance: EmailAgent | null = null
let whatsappAgentInstance: WhatsAppAgent | null = null
let linkedinAgentInstance: LinkedinAgent | null = null

// Human-in-the-loop gate: the search pipeline STAGES qualified targets here.
// Nothing is sent until the user explicitly triggers AGENT.CONTROL 'start'.
type StagedTarget = {
  leadKey?: string
  company: string
  website: string
  phone?: string
  email?: string
  linkedinUrl?: string
  aiEmail?: { subject: string; body: string }
  country?: string
}
const stagedTargets: Map<string, StagedTarget[]> = new Map()

/**
 * P0-3 修复：记录每个 Agent 当前暂存批次的来源管道 runId。
 * 用户确认触达时据此把 runId 传入 startAgent，使 `isStaleTask` 真正参与判定，
 * 丢弃"已被新一轮搜索取代"的旧批次。
 */
const stagedRunIds: Map<string, string> = new Map()

const emitAgentStatus = (agent: SalesAgentState) => {
  // Defensive: this runs from async pipeline callbacks that may fire after the
  // originating WebContents is gone. Guard against null, destroyed, and any
  // sender lacking the expected API so a late callback never throws an
  // unhandledRejection (which would otherwise crash the staging flow).
  const sender = globalSender
  if (!sender || typeof sender.isDestroyed !== 'function') return
  try {
    if (!sender.isDestroyed()) {
      sender.send(IPC_CHANNELS.AGENT.STATUS_CHANGED, agent)
    }
  } catch {
    // Sender became invalid between the guard and the send — ignore.
  }
}

export const writeBackAgentStatus = (
  leadIdOrCompany: number | string,
  agentType: SalesAgentType,
  status: Partial<AgentStatus>,
): void => {
  const key = String(leadIdOrCompany)
  const existing = agentStatusStore.get(key) || {
    whatsappSent: false,
    linkedinContacted: false,
    emailSequenceStage: 0 as const,
  }

  const updated: AgentStatus = {
    ...existing,
    ...status,
  }

  agentStatusStore.set(key, updated)
  persistAgentStatuses()
  addLogEntry(`agent-${agentType}`, 'status_written', `Lead=${key} Agent=${agentType} Status=${JSON.stringify(status)}`)

  // L1-1/F2：per-lead 实时推送（管道 A 读端）——线索表徽标订阅本通道即时刷新，
  // 不再等待线索池变更后的批量 agent:get-status 拉取。sender 失效时静默降级。
  try {
    globalSender?.send(IPC_CHANNELS.AGENT.LEAD_STATUS_UPDATED, { leadKey: key, agentStatus: updated })
  } catch {
    /* sender destroyed — 下次拉取兜底 */
  }

  const agent = agents.get(`agent-${agentType}`)
  if (agent) {
    emitAgentStatus(agent)
  }
}

export const getAgentStatus = (leadIdOrCompany: number | string): AgentStatus | undefined => {
  return agentStatusStore.get(String(leadIdOrCompany))
}

/* P1 通用 LLM JSON 调用底座：读取 user_config 的 LLM 配置并请求 JSON 输出。
   任何失败（未配 LLM / 网络错误 / 超时 / 响应异常）返回 null，由调用方降级。 */
const LLM_AGENT_TIMEOUT_MS = 20_000

const callLlmJson = async (
  store: ConfigStore | undefined,
  system: string,
  user: string,
): Promise<Record<string, unknown> | null> => {
  try {
    const llmKey = getUserLlmApiKey(store)
    const userConfig = store?.get?.('user_config') as Record<string, unknown> | undefined
    const providers = Array.isArray(userConfig?.providers)
      ? (userConfig.providers as Array<{ id?: string; baseUrl?: string }>)
      : []
    const llmBaseUrl = providers.find((p) => p.id === 'llm')?.baseUrl?.trim()
    if (!llmKey || !llmBaseUrl) return null

    const model = String(userConfig?.selectedModel || 'gpt-3.5-turbo')
    const response = await fetchWithTimeout(
      buildLlmEndpoint(llmBaseUrl),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
        }),
      },
      LLM_AGENT_TIMEOUT_MS,
    )
    if (!response.ok) return null
    const llmJson: any = await response.json().catch(() => null)
    const content = llmJson?.choices?.[0]?.message?.content || llmJson?.choices?.[0]?.text || ''
    const parsed = typeof content === 'string' ? JSON.parse(content) : null
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/* P0-1 差异化触达（G1）：LLM 实时生成 150 词定制开发信。
   输入 = 公司身份 + 线索信号（网站/行业/来源摘要）+ 阶段定位；输出 = 主题 + 正文。
   任何失败（未配 LLM / 网络错误 / 超时 / 响应异常）一律返回 null，由 EmailAgent
   降级到阶段模板——内容层永不阻断发送链路。 */

const STAGE_POSITIONING: Record<number, string> = {
  0: 'First outreach: Hook + Bridge + Value + Soft CTA. Do NOT push for a meeting in the first email.',
  1: 'Gentle follow-up: add one industry pain point or insight, no guilt-tripping.',
  2: 'Case study angle: reference a similar company result and invite interest.',
  3: 'Break-up note: polite last touch, leave the door open.',
}

const createLlmEmailContentProvider = (
  store?: ConfigStore,
): NonNullable<import('./agents/email-agent').EmailAgentConfig['emailContentProvider']> => {
  return async (task, stage) => {
    // P0 知识库注入：把用户配置的产品资料挑相关条目喂进 prompt。
    // 改造前这里只给 Company/Website/Stage，而 system prompt 又禁止编造资质，
    // 导致 LLM 无米下锅、只能写空洞信。命中失败时为 undefined，走下文诚实降级。
    const knowledgeSource = readKnowledgeSource(store)
    const knowledge = selectKnowledgeForAgent(
      { company: task.company, website: task.website },
      stage,
      knowledgeSource.entries,
      3,
      knowledgeSource.customTags,
    )
    const knowledgeBlock = renderKnowledgePromptBlock(knowledge)
    const knowledgeRule = knowledgeBlock
      ? 'Use the SELLER KNOWLEDGE BASE below as the primary source of the seller strengths, products, ' +
        'differentiators and proof points. Cite only what appears there. '
      : 'No seller knowledge base is available, so do NOT claim any specific product capability, ' +
        'certification, or statistic. Keep the email focused on the buyer context and a soft, honest value angle. '

    const system =
      'You are a senior B2B outbound sales copywriter. Write a highly personalized cold email of at most 150 words. ' +
      'Ground every claim in the company signals provided; never invent facts, certifications, or statistics. ' +
      knowledgeRule +
      'Return ONLY valid JSON: {"subject": string (max 80 chars, specific, no clickbait), "body": string (plain text, greeting + 2-3 short paragraphs + sign-off "Kone Agent")}.'
    const user =
      `Company: ${task.company}\n` +
      `Website: ${task.website || 'unknown'}\n` +
      `Stage instruction: ${STAGE_POSITIONING[stage] || STAGE_POSITIONING[0]}\n` +
      (knowledgeBlock ? `\n[SELLER KNOWLEDGE BASE]\n${knowledgeBlock}\n` : '') +
      'Write the email for this stage. Personalize with the company name and any inferable business context only.'

    const parsed = await callLlmJson(store, system, user)
    const subject = String(parsed?.subject || '').trim()
    const body = String(parsed?.body || '').trim()
    if (!subject || !body) return null
    return { subject: subject.slice(0, 200), body: body.slice(0, 2400) }
  }
}

/* P0 知识库注入（WhatsApp）：构造触达兜底文案。
   **刻意不用 LLM** —— 这是真实外发路径上的同步环节，LLM 超时/失败会影响发送。
   与 Email 侧的 provider 保持同一注入语义（都读 user_config.knowledgeBase），
   但用确定性的模板拼装，无网络、无超时、不会抛错。 */
const createKnowledgeWhatsAppTextBuilder = (
  store?: ConfigStore,
): NonNullable<import('./agents/whatsapp-agent').WhatsAppAgentConfig['fallbackTextBuilder']> => {
  return (task) => {
    const knowledgeSource = readKnowledgeSource(store)
    const selection = selectKnowledgeForAgent(
      { company: task.company, website: task.website },
      0,
      knowledgeSource.entries,
      3,
      knowledgeSource.customTags,
    )
    const name = task.company || 'there'
    if (!selection.injected) {
      // 诚实降级：无可用资料时不编造卖点，只保留中性问候。
      return `Hi ${name},\n\nWe came across your business and would like to explore whether there is a fit.\n\nBest regards,\nKone Agent`
    }
    const points = selection.entries
      .map((entry) => `- ${entry.title}${entry.tags.length ? `（${entry.tags.join('、')}）` : ''}`)
      .join('\n')
    return (
      `Hi ${name},\n\n` +
      `We would like to introduce what we can offer:\n${points}\n\n` +
      'Would you be open to a short chat?\n\nBest regards,\nKone Agent'
    )
  }
}

/* P1-2（缺口6）：LinkedIn 破冰文案 LLM 真生成。输入 = Profile 实际提取内容
   （name/headline/industry），输出 1-2 句无推销感的个性化破冰文案。
   只读边界不变：文案仅供人工触达，不触发任何自动动作。失败降级静态模板。 */
const createLlmIcebreakerProvider = (
  store?: ConfigStore,
): NonNullable<import('./agents/linkedin-agent').LinkedinAgentConfig['icebreakerProvider']> => {
  return async (task, profile) => {
    const system =
      'You write a 1-2 sentence, non-salesy personalized LinkedIn icebreaker in English. ' +
      'Ground it strictly in the profile facts provided; never invent facts. No call-to-action pressure, no pitch. ' +
      'Return ONLY valid JSON: {"icebreaker": string}.'
    const user =
      `Company: ${task.company}\n` +
      `Profile name: ${profile.name || 'unknown'}\n` +
      `Headline: ${profile.headline || 'unknown'}\n` +
      `Industry: ${profile.industry || 'unknown'}\n` +
      `About: ${(profile.summary || '').slice(0, 400)}\n` +
      'Write the icebreaker.'

    const parsed = await callLlmJson(store, system, user)
    const icebreaker = String(parsed?.icebreaker || '').trim()
    return icebreaker ? icebreaker.slice(0, 500) : null
  }
}

const getAgentInstanceForType = (
  agentType: SalesAgentType,
  state: SalesAgentState,
  store?: ConfigStore,
): WhatsAppAgent | LinkedinAgent | EmailAgent | null => {
  if (agentType === 'email') {
    // Read SMTP config from store; require at minimum a host to proceed.
    // L0-3/B3: smtpPass 加密读取 —— secret-manager 优先，user_config 明文仅作
    // 旧安装回退（新保存一律写 secret，渲染端保存时会清空白文遗留字段）。
    let smtpConfig: {
      smtpHost: string
      smtpPort: number
      smtpUser: string
      smtpPass: string
      senderEmail: string
      senderName: string
    } | null = null
    try {
      const raw = store?.get?.('user_config') as Record<string, unknown> | undefined
      const accounts = (raw?.accounts ?? {}) as Record<string, unknown>
      const emailAccount = (accounts.email ?? {}) as Record<string, unknown>
      const host = String(emailAccount.smtpHost || emailAccount.host || '').trim()
      if (host) {
        const encryptedPass = getSecret(SECRET_KEYS.EMAIL_SMTP_PASS).trim()
        const legacyPlainPass = String(emailAccount.smtpPass || emailAccount.pass || '').trim()
        smtpConfig = {
          smtpHost: host,
          smtpPort: Number(emailAccount.smtpPort || emailAccount.port || 587),
          smtpUser: String(emailAccount.smtpUser || emailAccount.user || '').trim(),
          smtpPass: encryptedPass || legacyPlainPass,
          senderEmail: String(emailAccount.senderEmail || emailAccount.email || '').trim(),
          senderName: String(emailAccount.senderName || emailAccount.name || 'Kone Agent').trim(),
        }
      }
    } catch {
      /* no smtp config in store — fall through to null */
    }

    if (!smtpConfig) return null

    if (!emailAgentInstance) {
      // P1-4: inject the persistent suppression gate so sendEmail never contacts
      // an unsubscribed / bounced / do-not-contact recipient (PROJECT-PRD §3.7.7).
      const suppressionStore = store
      emailAgentInstance = new EmailAgent(
        {
          ...smtpConfig,
          dailyLimit: state.dailyLimit || DEFAULT_AGENT_DAILY_LIMITS.email.basic,
          isSuppressed: suppressionStore ? (email: string) => isEmailSuppressed(suppressionStore, email) : undefined,
          // P0-1 差异化触达：LLM 实时生成定制开发信（失败自动降级模板）
          emailContentProvider: createLlmEmailContentProvider(store),
          // P2-4：用户配置的自定义 DKIM selector（与默认列表合并探测）
          dkimSelectors: resolveDkimSelectors(
            (store?.get?.('user_config') as { dnsShield?: { dkimSelectors?: unknown } } | undefined)?.dnsShield
              ?.dkimSelectors,
          ),
        },
        state,
      )
    }
    return emailAgentInstance
  }
  if (agentType === 'whatsapp') {
    if (!whatsappAgentInstance) {
      const sandboxPath = getSandboxPathForAccount('whatsapp')
      // Anti-ban pacing is configurable via userConfig; defaults live in WhatsAppAgent.
      let minSendIntervalMs: number | undefined
      let maxSendIntervalMs: number | undefined
      try {
        const raw = store?.get?.('user_config') as Record<string, unknown> | undefined
        const pacing = (raw?.whatsappPacing ?? {}) as Record<string, unknown>
        const min = Number(pacing.minSendIntervalMs)
        const max = Number(pacing.maxSendIntervalMs)
        if (Number.isFinite(min) && min > 0) minSendIntervalMs = min
        if (Number.isFinite(max) && max > 0) maxSendIntervalMs = max
      } catch {
        /* use defaults */
      }
      whatsappAgentInstance = new WhatsAppAgent(
        {
          dailyLimit: state.dailyLimit || DEFAULT_AGENT_DAILY_LIMITS.whatsapp.basic,
          sessionPath: sandboxPath,
          minSendIntervalMs,
          maxSendIntervalMs,
          // P0 知识库注入：用产品资料构造触达文案（同步纯函数，永不抛错）。
          // 单例只创建一次，但闭包捕获 store，读取的始终是最新配置。
          fallbackTextBuilder: createKnowledgeWhatsAppTextBuilder(store),
        },
        state,
      )
    }
    return whatsappAgentInstance
  }
  if (agentType === 'linkedin') {
    if (!linkedinAgentInstance) {
      const sandboxPath = getSandboxPathForAccount('linkedin')
      linkedinAgentInstance = new LinkedinAgent(
        {
          dailyLimit: state.dailyLimit || DEFAULT_AGENT_DAILY_LIMITS.linkedin.basic,
          sessionPath: sandboxPath,
          // P1-2：破冰文案 LLM 真生成（失败自动降级静态模板）
          icebreakerProvider: createLlmIcebreakerProvider(store),
        },
        state,
      )
    }
    return linkedinAgentInstance
  }
  return null
}

const runLimitedConcurrency = async <T>(items: T[], limit: number, worker: (item: T) => Promise<void>) => {
  let currentIndex = 0
  const normalizedLimit = Math.max(1, Math.min(limit, items.length || 1))
  const runner = async () => {
    while (true) {
      const index = currentIndex
      if (index >= items.length) return
      currentIndex += 1
      await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: normalizedLimit }, () => runner()))
}

const executeWhatsAppAgent = async (
  agent: SalesAgentState,
  targets: Array<{ leadKey?: string; company: string; phone: string; website: string }>,
  runId?: string,
  store?: ConfigStore,
) => {
  if (runId && isStaleTask(runId)) {
    addLogEntry(
      agent.agentId,
      'pipeline_expired',
      `Pipeline ${runId} stale — discarding ${targets.length} WhatsApp targets`,
    )
    return
  }
  agent.totalTargets = targets.length
  agent.completedCount = 0
  agent.failedCount = 0
  agent.progress = 0
  addLogEntry(agent.agentId, 'start', `WhatsApp agent starting with ${targets.length} targets`)
  emitAgentStatus(agent)

  const instance = getAgentInstanceForType('whatsapp', agent, store) as WhatsAppAgent | null
  if (!instance) {
    agent.status = 'error'
    agent.errorMessage = 'WhatsApp agent instance creation failed'
    emitAgentStatus(agent)
    return
  }

  const sessionOk = await instance.checkSession()
  if (sessionOk !== 'connected') {
    addLogEntry(agent.agentId, 'session_check', `WhatsApp session state: ${sessionOk}, attempting connect`)
    const connected = await instance.connect()
    if (!connected) {
      agent.status = 'error'
      agent.errorMessage = `WhatsApp session not available (${instance.getSessionState()})`
      addLogEntry(agent.agentId, 'connect_failed', agent.errorMessage)
      emitAgentStatus(agent)
      return
    }
  }

  for (const target of targets) {
    if (runId && isStaleTask(runId)) {
      addLogEntry(
        agent.agentId,
        'pipeline_expired',
        `Pipeline ${runId} became stale mid-execution — stopping WhatsApp agent`,
      )
      break
    }
    if (agent.dailyUsed >= agent.dailyLimit) {
      addLogEntry(agent.agentId, 'limit_reached', 'Daily WhatsApp limit reached')
      break
    }
    const result = await withTargetTimeout(
      instance.sendMessage({
        id: crypto.randomUUID(),
        leadId: 0,
        company: target.company,
        website: target.website,
        phone: target.phone,
        createdAt: Date.now(),
        priority: 0,
      }),
      `WhatsApp:${target.company}`,
    )
    if (result.success) {
      agent.completedCount += 1
      // Honest status: reflect the REAL delivery tick, never assume 'delivered'.
      const whatsappStatus = result.deliveryStatus === 'delivered' ? ('delivered' as const) : ('pending' as const)
      writeBackAgentStatus(target.leadKey || target.company, 'whatsapp', { whatsappSent: true, whatsappStatus })
    } else {
      agent.failedCount += 1
    }
    agent.progress = Math.round(((agent.completedCount + agent.failedCount) / agent.totalTargets) * 100)
    agent.lastActivity = new Date().toISOString()
    emitAgentStatus(agent)
  }

  addLogEntry(agent.agentId, 'complete', `WhatsApp done: ${agent.completedCount} success, ${agent.failedCount} failed`)
}

const executeLinkedinAgent = async (
  agent: SalesAgentState,
  targets: Array<{ leadKey?: string; company: string; linkedinUrl: string; website: string }>,
  runId?: string,
) => {
  if (runId && isStaleTask(runId)) {
    addLogEntry(
      agent.agentId,
      'pipeline_expired',
      `Pipeline ${runId} stale — discarding ${targets.length} LinkedIn targets`,
    )
    return
  }
  agent.totalTargets = targets.length
  agent.completedCount = 0
  agent.failedCount = 0
  agent.progress = 0
  addLogEntry(agent.agentId, 'start', `LinkedIn agent starting with ${targets.length} targets`)
  emitAgentStatus(agent)

  const instance = getAgentInstanceForType('linkedin', agent) as LinkedinAgent | null
  if (!instance) {
    agent.status = 'error'
    agent.errorMessage = 'LinkedIn agent instance creation failed'
    emitAgentStatus(agent)
    return
  }

  if (instance.getSessionState() !== 'connected') {
    const connected = await instance.connect()
    if (!connected) {
      agent.status = 'error'
      agent.errorMessage = `LinkedIn session not available (${instance.getSessionState()})`
      addLogEntry(agent.agentId, 'connect_failed', agent.errorMessage)
      emitAgentStatus(agent)
      return
    }
  }

  for (const target of targets) {
    if (runId && isStaleTask(runId)) {
      addLogEntry(
        agent.agentId,
        'pipeline_expired',
        `Pipeline ${runId} became stale mid-execution — stopping LinkedIn agent`,
      )
      break
    }
    if (agent.dailyUsed >= agent.dailyLimit) {
      addLogEntry(agent.agentId, 'limit_reached', 'Daily LinkedIn limit reached')
      break
    }
    const result = await withTargetTimeout(
      instance.readProfile({
        id: crypto.randomUUID(),
        leadId: 0,
        company: target.company,
        website: target.website,
        linkedinUrl: target.linkedinUrl,
        createdAt: Date.now(),
        priority: 0,
      }),
      `LinkedIn:${target.company}`,
    )
    if (result.success) {
      agent.completedCount += 1
      addLogEntry(
        agent.agentId,
        'profile_read',
        `Profile: ${result.profileData?.name} Icebreaker: ${result.icebreakerCopy?.substring(0, 80)}...`,
      )
      writeBackAgentStatus(target.leadKey || target.company, 'linkedin', { linkedinContacted: false })
    } else {
      agent.failedCount += 1
    }
    agent.progress = Math.round(((agent.completedCount + agent.failedCount) / agent.totalTargets) * 100)
    agent.lastActivity = new Date().toISOString()
    emitAgentStatus(agent)
  }

  addLogEntry(agent.agentId, 'complete', `LinkedIn done: ${agent.completedCount} success, ${agent.failedCount} failed`)
}

const executeEmailAgent = async (
  agent: SalesAgentState,
  targets: Array<{
    leadKey?: string
    company: string
    email: string
    website: string
    aiEmail?: { subject: string; body: string }
    country?: string
  }>,
  runId?: string,
  store?: ConfigStore,
) => {
  if (runId && isStaleTask(runId)) {
    addLogEntry(
      agent.agentId,
      'pipeline_expired',
      `Pipeline ${runId} stale — discarding ${targets.length} Email targets`,
    )
    return
  }
  agent.totalTargets = targets.length
  agent.completedCount = 0
  agent.failedCount = 0
  agent.progress = 0
  addLogEntry(agent.agentId, 'start', `Email agent starting with ${targets.length} targets`)
  emitAgentStatus(agent)

  const instance = getAgentInstanceForType('email', agent, store) as EmailAgent | null
  if (!instance) {
    agent.status = 'error'
    agent.errorMessage = 'Email SMTP not configured — set up email account in Accounts Management'
    addLogEntry(agent.agentId, 'smtp_unconfigured', agent.errorMessage)
    emitAgentStatus(agent)
    return
  }

  const connected = await instance.connect()
  if (!connected) {
    agent.status = 'error'
    agent.errorMessage = 'SMTP connection failed'
    addLogEntry(agent.agentId, 'smtp_failed', agent.errorMessage)
    emitAgentStatus(agent)
    return
  }

  for (const target of targets) {
    if (runId && isStaleTask(runId)) {
      addLogEntry(
        agent.agentId,
        'pipeline_expired',
        `Pipeline ${runId} became stale mid-execution — stopping Email agent`,
      )
      break
    }
    if (agent.dailyUsed >= agent.dailyLimit) {
      addLogEntry(agent.agentId, 'limit_reached', 'Daily email limit reached')
      break
    }
    const result = await withTargetTimeout(
      instance.executeSequence(
        {
          id: crypto.randomUUID(),
          leadId: 0,
          company: target.company,
          website: target.website,
          email: target.email,
          aiEmail: target.aiEmail,
          country: target.country,
          createdAt: Date.now(),
          priority: 0,
        },
        0,
      ),
      `Email:${target.company}`,
    )
    if (result.success) {
      agent.completedCount += 1
      // Stage 0 sent. Persist a follow-up plan so the scheduler drives stages 1-3
      // ONLY if the lead has not replied. Real stage is written back (0 -> next).
      writeBackAgentStatus(target.leadKey || target.company, 'email', {
        emailSequenceStage: 1,
        emailPendingManual: false,
      })
      if (store) {
        upsertPlan(store, createPlan(target.company, target.email, Date.now(), target.leadKey, target.country))
      }
    } else if (result.error === 'outside_recipient_send_window') {
      /* P1-4：收件人当地时间不在发送窗口 → 不计失败、不建计划，留给后续轮次 */
      addLogEntry(
        agent.agentId,
        'email_deferred_window',
        `Lead=${target.email} outside recipient send window — not counted as failure`,
      )
    } else {
      agent.failedCount += 1
    }
    agent.progress = Math.round(((agent.completedCount + agent.failedCount) / agent.totalTargets) * 100)
    agent.lastActivity = new Date().toISOString()
    emitAgentStatus(agent)
  }

  addLogEntry(agent.agentId, 'complete', `Email done: ${agent.completedCount} success, ${agent.failedCount} failed`)
}

// ── Multi-round follow-up scheduler (P0-2 / P1-3 / P1-4) ─────────────────
// Hourly tick: for each due plan, check IMAP for a reply. If replied → stop the
// sequence. If IMAP is unconfigured the reply state is unknowable, so the plan is
// held for manual confirmation instead of blindly advancing (P1-3). Otherwise send
// the next stage, advance the plan, and write back the REAL emailSequenceStage.
// A genuine IMAP error defers the plan one interval instead of blindly sending.
let followupTimer: ReturnType<typeof setInterval> | null = null

export const runFollowupTick = async (store: ConfigStore, now: number = Date.now()): Promise<void> => {
  const duePlans = getDuePlans(store, now)
  if (duePlans.length === 0) return

  const emailAgent = agents.get('agent-email')
  if (!emailAgent) return
  const instance = getAgentInstanceForType('email', emailAgent, store) as EmailAgent | null
  if (!instance) {
    addLogEntry('agent-email', 'followup_skipped', 'Email SMTP not configured — deferring follow-up tick')
    return
  }
  const connected = await instance.connect()
  if (!connected) {
    addLogEntry('agent-email', 'followup_skipped', 'SMTP connection failed — deferring follow-up tick')
    return
  }

  for (const plan of duePlans) {
    if (emailAgent.dailyUsed >= emailAgent.dailyLimit) {
      addLogEntry('agent-email', 'followup_limit', 'Daily email limit reached — pausing follow-up tick')
      break
    }

    const reply = await instance.checkReply(plan.email, new Date(plan.lastSentAt))
    if (reply.replied) {
      upsertPlan(store, markReplied(plan, now))
      writeBackAgentStatus(plan.leadKey, 'email', { emailSequenceStage: plan.stage, emailPendingManual: false })
      addLogEntry(
        'agent-email',
        'followup_stopped',
        `Lead=${plan.email} replied — sequence stopped at stage ${plan.stage}`,
      )
      continue
    }
    if (!reply.configured) {
      /* P1-3（缺口5）：IMAP 未配置 = 回复检测盲区。"按时间盲推"可能向已回复
         客户重复发送——此处不自动推进，标记需人工确认并暂停计划；
         IMAP 配置恢复后计划自动重新到期、续推并清零 pendingManual。 */
      upsertPlan(store, { ...plan, pendingManual: true, nextSendAt: now + STAGE_INTERVAL_MS[plan.stage] })
      writeBackAgentStatus(plan.leadKey, 'email', { emailSequenceStage: plan.stage, emailPendingManual: true })
      addLogEntry(
        'agent-email',
        'followup_manual_required',
        `Lead=${plan.email} IMAP 未配置，回复检测盲区——序列已暂停（stage ${plan.stage}），请配置 IMAP 或人工确认后推进`,
      )
      continue
    }
    if (reply.error) {
      // Genuine IMAP error: defer one interval, do NOT send blindly.
      upsertPlan(store, { ...plan, nextSendAt: now + STAGE_INTERVAL_MS[plan.stage] })
      addLogEntry('agent-email', 'followup_deferred', `Lead=${plan.email} IMAP error — deferring: ${reply.error}`)
      continue
    }

    const target = nextStage(plan.stage)
    const result = await withTargetTimeout(
      instance.executeSequence(
        {
          id: crypto.randomUUID(),
          leadId: 0,
          company: plan.company,
          website: '',
          email: plan.email,
          country: plan.country,
          createdAt: Date.now(),
          priority: 0,
        },
        target,
      ),
      `Followup:${plan.company}`,
    )

    if (result.success) {
      const advanced = advancePlan(plan, now)
      upsertPlan(store, advanced)
      writeBackAgentStatus(plan.leadKey, 'email', { emailSequenceStage: advanced.stage, emailPendingManual: false })
      /* P2-2：阶段推进日志附带 14 天全渠道协同节律指引（LinkedIn 人工触点等） */
      addLogEntry(
        'agent-email',
        'followup_sent',
        `Lead=${plan.email} advanced to stage ${advanced.stage} — cadence: ${describeCadence(advanced.stage)}`,
      )
    } else if (result.error === 'outside_recipient_send_window') {
      /* P1-4：收件人当地时间不在 09:00-18:00 → 短周期重试（下一 tick 复查），不消耗轮次 */
      upsertPlan(store, { ...plan, nextSendAt: now + FOLLOWUP_TICK_INTERVAL_MS })
      addLogEntry(
        'agent-email',
        'followup_deferred_window',
        `Lead=${plan.email} outside recipient send window — deferred to next tick`,
      )
    } else {
      // Send failed: defer one interval so a transient error doesn't burn the stage.
      upsertPlan(store, { ...plan, nextSendAt: now + STAGE_INTERVAL_MS[plan.stage] })
      addLogEntry('agent-email', 'followup_send_failed', `Lead=${plan.email} Error=${result.error}`)
    }
  }
}

export const startFollowupScheduler = (store: ConfigStore): void => {
  if (followupTimer) return
  followupTimer = setInterval(() => {
    void runFollowupTick(store).catch((err) => {
      addLogEntry('agent-email', 'followup_tick_error', err instanceof Error ? err.message : String(err || ''))
    })
  }, FOLLOWUP_TICK_INTERVAL_MS)
  /* P0-4：后台内务定时器不得阻止事件循环退出——否则 node --test 直接调用
     registerAgentHandlers 的用例会挂住，Electron 主进程退出也会被拖住。 */
  if (typeof followupTimer.unref === 'function') followupTimer.unref()
}

export const stopFollowupScheduler = (): void => {
  if (followupTimer) {
    clearInterval(followupTimer)
    followupTimer = null
  }
}

const startAgent = async (
  agentId: string,
  targets?: Array<{
    leadKey?: string
    company: string
    website: string
    phone?: string
    email?: string
    linkedinUrl?: string
    aiEmail?: { subject: string; body: string }
    country?: string
  }>,
  runId?: string,
  store?: ConfigStore,
) => {
  const agent = agents.get(agentId)
  if (!agent) throw new Error(`Agent ${agentId} not found`)

  if (agent.status === 'running') return
  if (agent.dailyUsed >= agent.dailyLimit) {
    agent.errorMessage = `Daily limit reached (${agent.dailyLimit})`
    agent.status = 'error'
    emitAgentStatus(agent)
    throw new Error(`Agent daily limit reached: ${agent.dailyLimit}`)
  }

  agent.status = 'running'
  agent.errorMessage = undefined
  emitAgentStatus(agent)

  try {
    if (agent.agentType === 'whatsapp') {
      const phoneTargets = (targets || [])
        .filter((t) => t.phone)
        .map((t) => ({ leadKey: t.leadKey, company: t.company, phone: t.phone!, website: t.website }))
      await executeWhatsAppAgent(agent, phoneTargets, runId, store)
    } else if (agent.agentType === 'linkedin') {
      const liTargets = (targets || [])
        .filter((t) => t.linkedinUrl)
        .map((t) => ({ leadKey: t.leadKey, company: t.company, linkedinUrl: t.linkedinUrl!, website: t.website }))
      await executeLinkedinAgent(agent, liTargets, runId)
    } else if (agent.agentType === 'email') {
      const emailTargets = (targets || [])
        .filter((t) => t.email)
        .map((t) => ({
          leadKey: t.leadKey,
          company: t.company,
          email: t.email!,
          website: t.website,
          aiEmail: t.aiEmail,
          country: t.country,
        }))
      await executeEmailAgent(agent, emailTargets, runId, store)
    }
    agent.status = 'idle'
    agent.errorMessage = undefined
    emitAgentStatus(agent)
  } catch (error) {
    agent.status = 'error'
    agent.errorMessage = error instanceof Error ? error.message : 'Agent execution failed'
    emitAgentStatus(agent)
  }
}

const stopAgent = async (agentId: string) => {
  const agent = agents.get(agentId)
  if (!agent || agent.status === 'idle') return
  if (agent.agentType === 'whatsapp' && whatsappAgentInstance) {
    await whatsappAgentInstance.disconnect()
    whatsappAgentInstance = null
  }
  if (agent.agentType === 'linkedin' && linkedinAgentInstance) {
    await linkedinAgentInstance.disconnect()
    linkedinAgentInstance = null
  }
  if (agent.agentType === 'email' && emailAgentInstance) {
    await emailAgentInstance.disconnect()
    emailAgentInstance = null
  }
  agent.status = 'idle'
  agent.errorMessage = undefined
  emitAgentStatus(agent)
}

const applyLicenseLimits = (claims: { plan?: string } | null | undefined, store?: ConfigStore) => {
  const plan = claims?.plan
  // Fail-Closed：claims 缺失（未激活/读取异常）时按最受限的试用档展示，绝不落入 Basic
  const isTrial = plan === 'trial' || !plan

  // Try store.user_config.agentDailyLimits first; fall back to hardcoded defaults
  let userConfigLimits: Record<string, { trial: number; basic: number; premium: number }> | undefined | null
  try {
    const raw = store?.get?.('user_config') as Record<string, unknown> | undefined
    userConfigLimits = raw?.agentDailyLimits as typeof userConfigLimits
  } catch {
    /* ignore */
  }

  for (const agent of agents.values()) {
    const defaults = DEFAULT_AGENT_DAILY_LIMITS[agent.agentType]
    const userOverride = userConfigLimits?.[agent.agentType]
    const limits = userOverride ?? defaults
    agent.dailyLimit = isPremiumPlan(plan) ? limits.premium : isTrial ? limits.trial : limits.basic
    if (isTrial) agent.dailyUsed = 0
  }
}

const isPremiumPlan = (plan?: string): boolean => {
  return plan === 'premium' || plan === 'enterprise' || plan === 'pro'
}

// Called by pipeline after search:stream-complete.
// HUMAN-IN-THE-LOOP: this STAGES qualified leads for review — it never auto-sends.
// The user must explicitly click "开始触达" (AGENT.CONTROL 'start') to dispatch.
export const stageAgentsFromPipeline = (
  queue: AgentTaskQueue,
  sender: Electron.WebContents,
  store: ConfigStore,
  runId?: string,
): void => {
  // Register app quit handler once to disconnect agents on shutdown
  if (!appQuitHandlerRegistered) {
    appQuitHandlerRegistered = true
    try {
      app.on('before-quit', () => {
        stopFollowupScheduler()
        void disconnectAllAgents()
      })
    } catch {
      /* not in Electron environment, skip */
    }
  }

  globalSender = sender
  const { licenseGuard } = createLicenseService(store)
  const claims = licenseGuard.getStoredClaims?.()
  applyLicenseLimits(claims, store)

  const agentMapping: Array<[string, keyof AgentTaskQueue]> = [
    ['agent-whatsapp', 'whatsapp'],
    ['agent-linkedin', 'linkedin'],
    ['agent-email', 'email'],
  ]

  let stagedAny = false

  for (const [agentId, taskKey] of agentMapping) {
    const tasks = queue[taskKey]
    if (tasks.length === 0) continue

    // Temporal isolation: discard stale tasks before staging
    if (runId && tasks.some((t) => t.taskRunId && isStaleTask(t.taskRunId))) {
      addLogEntry(agentId, 'pipeline_stale', `Discarding ${tasks.length} stale tasks (runId mismatch) for ${agentId}`)
      continue
    }

    const agent = agents.get(agentId)
    if (!agent) continue

    const targets: StagedTarget[] = tasks.map((t) => ({
      leadKey: t.leadKey,
      company: t.company,
      website: t.website,
      phone: t.phone,
      email: t.email,
      linkedinUrl: t.linkedinUrl,
      aiEmail: t.aiEmail,
      country: t.country,
    }))

    // Stage for human review — do NOT send.
    stagedTargets.set(agentId, targets)
    if (runId) stagedRunIds.set(agentId, runId)
    agent.queuedCount = targets.length
    addLogEntry(
      agentId,
      'pipeline_staged',
      `Staged ${targets.length} leads for ${agent.label} — awaiting user confirmation`,
    )
    emitAgentStatus(agent)
    stagedAny = true
  }

  // P0-3 修复：只有确实暂存过目标才更新"最近一次暂存 runId"。
  // 这样"新一轮搜索未产出合格线索"不会误杀上一轮尚未确认的暂存目标。
  if (stagedAny && runId) markPipelineStaged(runId)
}

// Retrieve (and clear) the staged targets a user confirmed for an agent.
export const consumeStagedTargets = (agentId: string): StagedTarget[] => {
  const targets = stagedTargets.get(agentId) || []
  stagedTargets.delete(agentId)
  stagedRunIds.delete(agentId)
  const agent = agents.get(agentId)
  if (agent) agent.queuedCount = 0
  return targets
}

/**
 * P0-3 修复：消费暂存批次时同时取出其来源 runId，供 startAgent 做时空隔离判定。
 * 保留 `consumeStagedTargets` 的既有签名（返回数组）以兼容现有测试与调用方。
 */
export const consumeStagedBatch = (agentId: string): { targets: StagedTarget[]; runId?: string } => {
  const runId = stagedRunIds.get(agentId)
  const targets = consumeStagedTargets(agentId)
  return { targets, runId }
}

export const registerAgentHandlers = (ipcMain: Electron.IpcMain, store: ConfigStore) => {
  const { licenseGuard } = createLicenseService(store)

  // P1-2: bind the durable store and re-load persisted logs + agentStatus so the
  // touch timeline and lead reach-status survive app restarts (kone-PRD §3.7.8).
  hydrateAgentPersistence(store)

  /* P0-4 修复：多轮邮件跟进调度器此前仅导出、从未接线 —— 而 executeEmailAgent 在
     stage0 首封成功时已通过 createPlan 写入持久化跟进计划，导致"计划被创建但永不推进"
     的能力悬空。此处于启动时接线，使重启后仍能续推历史计划。
     Fail-Closed 保障全部来自 runFollowupTick 自身门禁：必须有 SMTP 实例且 connect()
     成功、IMAP 已配置（否则 pendingManual 人工挂起，绝不盲推）、未超日频上限、
     未命中抑制名单、且处于收件人当地 09:00-18:00 发送窗口。 */
  try {
    applyLicenseLimits(licenseGuard.getStoredClaims?.(), store)
  } catch {
    /* 授权信息不可用时保留默认日频，tick 仍受 SMTP/IMAP 门禁保护 */
  }
  startFollowupScheduler(store)

  /* AGENT 服务 plain 通道第二批 registry 迁移（见 ARCH-STANDARDS §3 迁移注记）：
     6 个无授权包装的通道经 `registerIpc()` 收敛到注册中心，由 main.ts 末尾
     `registry.attach(ipcMain)` 统一绑定；契约在 dev 模式做响应校验。
     `AGENT.CONTROL` 仍由下方 `registerSecureFeatureIpc` 包装（Fail-Closed），不迁移。 */

  registerIpc(IPC_CHANNELS.AGENT.LIST, agentListContract, async (_event) => {
    try {
      // 宪法约束：「Trial 用户必须熔断拦截，严禁渲染任何智能体卡片或**暴露运行指标**」。
      // 此前本通道无 feature 门禁 → Trial 可绕过渲染层升级墙、直连 IPC 读取全部
      // 智能体及其 dailyLimit/status 等运行指标。与 AGENT.CONTROL 使用同一 feature 键，
      // 保证「看得到」与「用得了」的授权边界一致。
      // requireFeature 在无权时抛 403（下方 catch 转为结构化错误）。
      licenseGuard.requireFeature('local_autopilot', '查看 AI 销售团队')

      const claims = licenseGuard.getStoredClaims?.()
      applyLicenseLimits(claims, store)
      const entries = Array.from(agents.values())
      return { success: true, data: { agents: entries } }
    } catch (error) {
      // 授权拒绝（403）需原样透传，便于前端区分「无权限」与「服务端故障」
      const guardCode = (error as { code?: number } | null)?.code
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agents',
        code: guardCode === 403 ? 403 : 500,
      }
    }
  })

  registerIpc(IPC_CHANNELS.AGENT.GET_LOG, agentGetLogContract, async (_event, agentId: unknown) => {
    try {
      // 宪法约束：「Trial 必须熔断拦截，严禁渲染任何智能体卡片或**暴露运行指标**」。
      // 与 AGENT.LIST 同构的缺陷：日志在启动时由 hydrateAgentPersistence **无条件**
      // 从 user_config.agent_logs 恢复（与授权状态解耦），本通道此前又无门禁 →
      // Trial / 降级用户可直连 IPC 读取完整历史触达日志（含 company/detail）。
      // 日志同样属于「运行指标」，故与 AGENT.LIST / AGENT.CONTROL 使用同一 feature 键。
      licenseGuard.requireFeature('local_autopilot', '查看 AI 销售团队')

      const id = String(agentId || '')
      const entry = agentLogs.get(id) || []
      return { success: true, data: { agentId: id, logEntries: entry } }
    } catch (error) {
      // 授权拒绝（403）需原样透传，便于前端区分「无权限」与「服务端故障」
      const guardCode = (error as { code?: number } | null)?.code
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read agent logs',
        code: guardCode === 403 ? 403 : 500,
      }
    }
  })

  /* P0-1 双管道读端：渲染进程按 leadKey 读取持久化线索态 agentStatus
     （kone-PRD §0.7 要求前端消费"线索表格/抽屉中的 Agent 触达状态徽标"） */
  registerIpc(IPC_CHANNELS.AGENT.GET_STATUS, agentGetStatusContract, async (_event, leadKey: unknown) => {
    try {
      const key = String(leadKey || '').trim()
      if (!key) {
        return { success: false, error: 'leadKey 参数缺失', code: 400 }
      }
      return { success: true, data: { leadKey: key, agentStatus: getAgentStatus(key) } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read agent status',
        code: 500,
      }
    }
  })

  // P1-4 邮件合规：退订/DNC 抑制名单管理。发送前 sendEmail 会照合此名单，
  // 抑制对象（退订/退信/投诉/手动）永不再触达（PROJECT-PRD §3.7.7）。
  registerIpc(IPC_CHANNELS.AGENT.SUPPRESS_LIST, agentSuppressListContract, async (_event) => {
    try {
      return { success: true, data: { entries: readSuppressionList(store) } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read suppression list',
        code: 500,
      }
    }
  })

  registerIpc(IPC_CHANNELS.AGENT.SUPPRESS_ADD, agentSuppressAddContract, async (_event, payload: unknown) => {
    try {
      const p = payload as { email?: unknown; reason?: unknown; note?: unknown }
      const email = String(p?.email || '').trim()
      if (!email) return { success: false, error: '邮箱或域名参数缺失', code: 400 }
      const reason = ['unsubscribe', 'bounce', 'complaint', 'manual'].includes(String(p?.reason))
        ? (p.reason as 'unsubscribe' | 'bounce' | 'complaint' | 'manual')
        : 'manual'
      const entries = addSuppression(store, email, reason, p?.note as string | undefined)
      addLogEntry('agent-email', 'suppression_added', `Suppressed=${email} Reason=${reason}`)
      return { success: true, data: { entries } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add suppression',
        code: 500,
      }
    }
  })

  registerIpc(IPC_CHANNELS.AGENT.SUPPRESS_REMOVE, agentSuppressRemoveContract, async (_event, payload: unknown) => {
    try {
      const p = payload as { email?: unknown }
      const email = String(p?.email || '').trim()
      if (!email) return { success: false, error: '邮箱或域名参数缺失', code: 400 }
      const entries = removeSuppression(store, email)
      addLogEntry('agent-email', 'suppression_removed', `Unsuppressed=${email}`)
      return { success: true, data: { entries } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove suppression',
        code: 500,
      }
    }
  })

  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.AGENT.CONTROL,
    store,
    licenseGuard,
    'local_autopilot',
    async (
      _event,
      payload: {
        agentId: string
        action: string
        targets?: Array<{ company: string; website: string; phone?: string; email?: string; linkedinUrl?: string }>
      },
    ) => {
      try {
        globalSender = _event.sender
        const agentId = String(payload?.agentId || '').trim()
        const action = String(payload?.action || '').trim()

        if (!agentId || !['start', 'stop', 'pause', 'resume'].includes(action)) {
          return { success: false, error: 'Invalid action', code: 400 }
        }

        const agent = agents.get(agentId)
        if (!agent) {
          return { success: false, error: 'Agent not found', code: 404 }
        }

        const claims = licenseGuard.getStoredClaims?.()
        applyLicenseLimits(claims, store)

        if (action === 'start') {
          if (agent.dailyUsed >= agent.dailyLimit) {
            return {
              success: false,
              code: 429,
              error: `Agent [${agent.label}] daily limit reached (${agent.dailyLimit})`,
            }
          }
          // Human-in-the-loop: if the caller passes no explicit targets, consume
          // the pipeline-staged queue the user just confirmed by clicking start.
          // P0-3 修复：同时取出该批次的来源 runId，使时空隔离判定真正生效
          // （若期间又跑了一轮搜索并暂存了新目标，本批次将被判为陈旧并丢弃）。
          if (payload?.targets) {
            void startAgent(agentId, payload.targets, undefined, store)
          } else {
            const batch = consumeStagedBatch(agentId)
            void startAgent(agentId, batch.targets, batch.runId, store)
          }
        } else if (action === 'stop') {
          await stopAgent(agentId)
        } else if (action === 'pause') {
          agent.status = 'paused'
          emitAgentStatus(agent)
        } else if (action === 'resume') {
          if (payload?.targets) {
            void startAgent(agentId, payload.targets, undefined, store)
          } else {
            const batch = consumeStagedBatch(agentId)
            void startAgent(agentId, batch.targets, batch.runId, store)
          }
        }

        return {
          success: true,
          data: { agentId: agent.agentId, status: agent.status },
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Agent control failed',
          code: 500,
        }
      }
    },
    'Sales Agent Control',
  )

  /* P0-4/续：注册中心自绑定兼容层。
     registry 为全局单例，主进程统一在 `registerIpcHandlers()` 末尾经
     `registry.attach(ipcMain)` 绑定；但历史 e2e / 独立测试直接调用
     `registerAgentHandlers(ipcMain, store)` 而未显式 attach，导致迁移后的
     6 个 plain 通道未落到 ipcMain、调用方 `ipcMain.getHandler(...)` 抛 "missing"。
     此处于本函数末尾自绑定本批通道，使调用方无需改动即可触达；
     `attach` 内部以 `_attached` 幂等去重，主进程末尾的 attach 不会重复绑定（不会触发
     Electron "second handler" 报错），仅补齐本函数之后才注册的其他通道。 */
  registry.attach(ipcMain)
}
