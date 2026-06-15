import * as crypto from 'crypto'
import { IPC_CHANNELS } from '../ipc/channels'
import { ConfigStore } from './config-service'
import { createLicenseService, registerSecureFeatureIpc } from './license-service'
import type { AgentLogEntry, AgentStatus, SalesAgentType, SalesAgentState } from '../../src/shared/ipc-contracts'
import type { AgentTaskQueue } from './agent-pipeline'
import { isStaleTask } from './agent-pipeline'
import { getSandboxPathForAccount, findAccountByType } from './sandbox-service'
import { EmailAgent } from './agents/email-agent'
import { WhatsAppAgent } from './agents/whatsapp-agent'
import { LinkedinAgent } from './agents/linkedin-agent'

const DEFAULT_AGENT_DAILY_LIMITS: Record<SalesAgentType, { trial: number; basic: number; premium: number }> = {
  whatsapp: { trial: 3, basic: 5, premium: 100 },
  linkedin: { trial: 3, basic: 30, premium: 100 },
  email: { trial: 3, basic: 20, premium: 200 },
}

const DEFAULT_FULL_LIMIT = 50

let globalSender: Electron.WebContents | null = null

const agentLogs: Map<string, AgentLogEntry[]> = new Map()
const agentStatusStore: Map<string, AgentStatus> = new Map()

const addLogEntry = (agentId: string, event: string, detail?: string) => {
  if (!agentLogs.has(agentId)) {
    agentLogs.set(agentId, [])
  }
  agentLogs.get(agentId)!.push({
    timestamp: new Date().toISOString(),
    event,
    detail,
  })
}

const agents: Map<string, SalesAgentState> = new Map([
  ['agent-whatsapp', {
    agentId: 'agent-whatsapp',
    agentType: 'whatsapp',
    status: 'idle',
    label: 'WhatsApp 拓客猎手',
    description: '通过 WhatsApp Web 真实发送消息，需扫码登录；Basic 低频 3-5 条/天，Premium 高频自动发送',
    progress: 0,
    totalTargets: 0,
    completedCount: 0,
    failedCount: 0,
    dailyLimit: DEFAULT_AGENT_DAILY_LIMITS.whatsapp.basic,
    dailyUsed: 0,
  }],
  ['agent-linkedin', {
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
  }],
  ['agent-email', {
    agentId: 'agent-email',
    agentType: 'email',
    status: 'idle',
    label: '邮件长效跟随助理',
    description: '直连企业 SMTP 真实发信，DNS 信誉检测软锁定，Basic 20 封/天，Premium 高频序列',
    progress: 0,
    totalTargets: 0,
    completedCount: 0,
    failedCount: 0,
    dailyLimit: DEFAULT_AGENT_DAILY_LIMITS.email.basic,
    dailyUsed: 0,
  }],
])

let emailAgentInstance: EmailAgent | null = null
let whatsappAgentInstance: WhatsAppAgent | null = null
let linkedinAgentInstance: LinkedinAgent | null = null

const emitAgentStatus = (agent: SalesAgentState) => {
  if (globalSender && !globalSender.isDestroyed()) {
    globalSender.send(IPC_CHANNELS.AGENT.STATUS_CHANGED, agent)
  }
}

export const writeBackAgentStatus = (
  leadIdOrCompany: number | string,
  agentType: SalesAgentType,
  status: Partial<AgentStatus>
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
  addLogEntry(`agent-${agentType}`, 'status_written', `Lead=${key} Agent=${agentType} Status=${JSON.stringify(status)}`)

  const agent = agents.get(`agent-${agentType}`)
  if (agent) {
    emitAgentStatus(agent)
  }
}

export const getAgentStatus = (leadIdOrCompany: number | string): AgentStatus | undefined => {
  return agentStatusStore.get(String(leadIdOrCompany))
}

const getAgentInstanceForType = (
  agentType: SalesAgentType,
  state: SalesAgentState,
  store?: ConfigStore
): WhatsAppAgent | LinkedinAgent | EmailAgent | null => {
  if (agentType === 'email') {
    // Read SMTP config from store; require at minimum a host to proceed
    let smtpConfig: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; senderEmail: string; senderName: string } | null = null
    try {
      const raw = store?.get?.('user_config') as Record<string, unknown> | undefined
      const accounts = (raw?.accounts ?? {}) as Record<string, unknown>
      const emailAccount = (accounts.email ?? {}) as Record<string, unknown>
      const host = String(emailAccount.smtpHost || emailAccount.host || '').trim()
      if (host) {
        smtpConfig = {
          smtpHost: host,
          smtpPort: Number(emailAccount.smtpPort || emailAccount.port || 587),
          smtpUser: String(emailAccount.smtpUser || emailAccount.user || '').trim(),
          smtpPass: String(emailAccount.smtpPass || emailAccount.pass || '').trim(),
          senderEmail: String(emailAccount.senderEmail || emailAccount.email || '').trim(),
          senderName: String(emailAccount.senderName || emailAccount.name || 'Kone Agent').trim(),
        }
      }
    } catch { /* no smtp config in store — fall through to null */ }

    if (!smtpConfig) return null

    if (!emailAgentInstance) {
      emailAgentInstance = new EmailAgent({
        ...smtpConfig,
        dailyLimit: state.dailyLimit || DEFAULT_AGENT_DAILY_LIMITS.email.basic,
      }, state)
    }
    return emailAgentInstance
  }
  if (agentType === 'whatsapp') {
    if (!whatsappAgentInstance) {
      const sandboxPath = getSandboxPathForAccount('whatsapp')
      whatsappAgentInstance = new WhatsAppAgent({
        dailyLimit: state.dailyLimit || DEFAULT_AGENT_DAILY_LIMITS.whatsapp.basic,
        sessionPath: sandboxPath,
      }, state)
    }
    return whatsappAgentInstance
  }
  if (agentType === 'linkedin') {
    if (!linkedinAgentInstance) {
      const sandboxPath = getSandboxPathForAccount('linkedin')
      linkedinAgentInstance = new LinkedinAgent({
        dailyLimit: state.dailyLimit || DEFAULT_AGENT_DAILY_LIMITS.linkedin.basic,
        sessionPath: sandboxPath,
      }, state)
    }
    return linkedinAgentInstance
  }
  return null
}

const runLimitedConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
) => {
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

const executeWhatsAppAgent = async (agent: SalesAgentState, targets: Array<{ company: string; phone: string; website: string }>, runId?: string) => {
  if (runId && isStaleTask(runId)) {
    addLogEntry(agent.agentId, 'pipeline_expired', `Pipeline ${runId} stale — discarding ${targets.length} WhatsApp targets`)
    return
  }
  agent.totalTargets = targets.length
  agent.completedCount = 0
  agent.failedCount = 0
  agent.progress = 0
  addLogEntry(agent.agentId, 'start', `WhatsApp agent starting with ${targets.length} targets`)
  emitAgentStatus(agent)

  const instance = getAgentInstanceForType('whatsapp', agent) as WhatsAppAgent | null
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
      addLogEntry(agent.agentId, 'pipeline_expired', `Pipeline ${runId} became stale mid-execution — stopping WhatsApp agent`)
      break
    }
    if (agent.dailyUsed >= agent.dailyLimit) {
      addLogEntry(agent.agentId, 'limit_reached', 'Daily WhatsApp limit reached')
      break
    }
    const result = await instance.sendMessage({
      id: crypto.randomUUID(),
      leadId: 0,
      company: target.company,
      website: target.website,
      phone: target.phone,
      createdAt: Date.now(),
      priority: 0,
    })
    if (result.success) {
      agent.completedCount += 1
      writeBackAgentStatus(target.company, 'whatsapp', { whatsappSent: true, whatsappStatus: 'delivered' })
    } else {
      agent.failedCount += 1
    }
    agent.progress = Math.round(((agent.completedCount + agent.failedCount) / agent.totalTargets) * 100)
    agent.lastActivity = new Date().toISOString()
    emitAgentStatus(agent)
  }

  addLogEntry(agent.agentId, 'complete', `WhatsApp done: ${agent.completedCount} success, ${agent.failedCount} failed`)
}

const executeLinkedinAgent = async (agent: SalesAgentState, targets: Array<{ company: string; linkedinUrl: string; website: string }>, runId?: string) => {
  if (runId && isStaleTask(runId)) {
    addLogEntry(agent.agentId, 'pipeline_expired', `Pipeline ${runId} stale — discarding ${targets.length} LinkedIn targets`)
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
      addLogEntry(agent.agentId, 'pipeline_expired', `Pipeline ${runId} became stale mid-execution — stopping LinkedIn agent`)
      break
    }
    if (agent.dailyUsed >= agent.dailyLimit) {
      addLogEntry(agent.agentId, 'limit_reached', 'Daily LinkedIn limit reached')
      break
    }
    const result = await instance.readProfile({
      id: crypto.randomUUID(),
      leadId: 0,
      company: target.company,
      website: target.website,
      linkedinUrl: target.linkedinUrl,
      createdAt: Date.now(),
      priority: 0,
    })
    if (result.success) {
      agent.completedCount += 1
      addLogEntry(agent.agentId, 'profile_read', `Profile: ${result.profileData?.name} Icebreaker: ${result.icebreakerCopy?.substring(0, 80)}...`)
      writeBackAgentStatus(target.company, 'linkedin', { linkedinContacted: false })
    } else {
      agent.failedCount += 1
    }
    agent.progress = Math.round(((agent.completedCount + agent.failedCount) / agent.totalTargets) * 100)
    agent.lastActivity = new Date().toISOString()
    emitAgentStatus(agent)
  }

  addLogEntry(agent.agentId, 'complete', `LinkedIn done: ${agent.completedCount} success, ${agent.failedCount} failed`)
}

const executeEmailAgent = async (agent: SalesAgentState, targets: Array<{ company: string; email: string; website: string }>, runId?: string, store?: ConfigStore) => {
  if (runId && isStaleTask(runId)) {
    addLogEntry(agent.agentId, 'pipeline_expired', `Pipeline ${runId} stale — discarding ${targets.length} Email targets`)
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
      addLogEntry(agent.agentId, 'pipeline_expired', `Pipeline ${runId} became stale mid-execution — stopping Email agent`)
      break
    }
    if (agent.dailyUsed >= agent.dailyLimit) {
      addLogEntry(agent.agentId, 'limit_reached', 'Daily email limit reached')
      break
    }
    const result = await instance.executeSequence({
      id: crypto.randomUUID(),
      leadId: 0,
      company: target.company,
      website: target.website,
      email: target.email,
      createdAt: Date.now(),
      priority: 0,
    }, 0)
    if (result.success) {
      agent.completedCount += 1
      writeBackAgentStatus(target.company, 'email', { emailSequenceStage: 1 })
    } else {
      agent.failedCount += 1
    }
    agent.progress = Math.round(((agent.completedCount + agent.failedCount) / agent.totalTargets) * 100)
    agent.lastActivity = new Date().toISOString()
    emitAgentStatus(agent)
  }

  addLogEntry(agent.agentId, 'complete', `Email done: ${agent.completedCount} success, ${agent.failedCount} failed`)
}

const startAgent = async (agentId: string, targets?: Array<{ company: string; website: string; phone?: string; email?: string; linkedinUrl?: string }>, runId?: string, store?: ConfigStore) => {
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
      const phoneTargets = (targets || []).filter((t) => t.phone).map((t) => ({ company: t.company, phone: t.phone!, website: t.website }))
      await executeWhatsAppAgent(agent, phoneTargets, runId)
    } else if (agent.agentType === 'linkedin') {
      const liTargets = (targets || []).filter((t) => t.linkedinUrl).map((t) => ({ company: t.company, linkedinUrl: t.linkedinUrl!, website: t.website }))
      await executeLinkedinAgent(agent, liTargets, runId)
    } else if (agent.agentType === 'email') {
      const emailTargets = (targets || []).filter((t) => t.email).map((t) => ({ company: t.company, email: t.email!, website: t.website }))
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
  const isBasic = plan === 'basic'
  const isTrial = plan === 'trial'

  // Try store.user_config.agentDailyLimits first; fall back to hardcoded defaults
  let userConfigLimits: Record<string, { trial: number; basic: number; premium: number }> | undefined | null
  try {
    const raw = store?.get?.('user_config') as Record<string, unknown> | undefined
    userConfigLimits = raw?.agentDailyLimits as typeof userConfigLimits
  } catch { /* ignore */ }

  for (const agent of agents.values()) {
    const defaults = DEFAULT_AGENT_DAILY_LIMITS[agent.agentType]
    const userOverride = userConfigLimits?.[agent.agentType]
    const limits = userOverride ?? defaults
    agent.dailyLimit = isPremiumPlan(plan) ? limits.premium : (isTrial ? limits.trial : limits.basic)
    if (isTrial) agent.dailyUsed = 0
  }
}

const isPremiumPlan = (plan?: string): boolean => {
  return plan === 'premium' || plan === 'enterprise' || plan === 'pro'
}

// Called by pipeline after search:stream-complete to auto-dispatch qualified leads to agents
export const dispatchAgentsFromPipeline = (
  queue: AgentTaskQueue,
  sender: Electron.WebContents,
  store: ConfigStore,
  runId?: string
): void => {
  globalSender = sender
  const { licenseGuard } = createLicenseService(store)
  const claims = licenseGuard.getStoredClaims?.()
  applyLicenseLimits(claims, store)

  const agentMapping: Array<[string, keyof AgentTaskQueue]> = [
    ['agent-whatsapp', 'whatsapp'],
    ['agent-linkedin', 'linkedin'],
    ['agent-email', 'email'],
  ]

  for (const [agentId, taskKey] of agentMapping) {
    const tasks = queue[taskKey]
    if (tasks.length === 0) continue

    // Temporal isolation: discard stale tasks before dispatching
    if (runId && tasks.some((t) => t.taskRunId && isStaleTask(t.taskRunId))) {
      addLogEntry(agentId, 'pipeline_stale', `Discarding ${tasks.length} stale tasks (runId mismatch) for ${agentId}`)
      continue
    }

    const agent = agents.get(agentId)
    if (!agent || agent.dailyUsed >= agent.dailyLimit || agent.status === 'running') continue

    const targets = tasks.map((t) => ({
      company: t.company,
      website: t.website,
      phone: t.phone,
      email: t.email,
      linkedinUrl: t.linkedinUrl,
    }))

    addLogEntry(agentId, 'pipeline_trigger', `Pipeline dispatched ${tasks.length} tasks to ${agent.label}`)
    void startAgent(agentId, targets, runId, store)
  }
}

export const registerAgentHandlers = (
  ipcMain: Electron.IpcMain,
  store: ConfigStore
) => {
  const { licenseGuard } = createLicenseService(store)

  ipcMain.handle(IPC_CHANNELS.AGENT.LIST, async (_event) => {
    try {
      const claims = licenseGuard.getStoredClaims?.()
      applyLicenseLimits(claims, store)
      const entries = Array.from(agents.values())
      return { success: true, data: { agents: entries } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agents',
        code: 500,
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT.GET_LOG, async (_event, agentId: string) => {
    try {
      const entry = agentLogs.get(agentId) || []
      return { success: true, data: { agentId, logEntries: entry } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read agent logs',
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
    async (_event, payload: { agentId: string; action: string; targets?: Array<{ company: string; website: string; phone?: string; email?: string; linkedinUrl?: string }> }) => {
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
          void startAgent(agentId, payload?.targets)
        } else if (action === 'stop') {
          await stopAgent(agentId)
        } else if (action === 'pause') {
          agent.status = 'paused'
          emitAgentStatus(agent)
        } else if (action === 'resume') {
          void startAgent(agentId, payload?.targets)
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
    'Sales Agent Control'
  )
}
