import * as crypto from 'crypto'
import type { SalesAgentType } from '../../src/shared/ipc-contracts'

export type AgentTask = {
  id: string
  taskRunId?: string
  leadId: number
  // Stable lead identity that survives the search→pipeline→agent chain.
  // Sourced from SearchExecuteResult.id (a crypto UUID) so agentStatus write-back
  // keys on an immutable identifier instead of the mutable company name.
  // Falls back to company at the write-back site when absent (kone-PRD §0.7 / §3.7.3).
  leadKey?: string
  company: string
  website: string
  phone?: string
  email?: string
  linkedinUrl?: string
  // P0-1 差异化触达（G1）：线索上已生成的 AI 定制开发信（如 analysisCache 中
  // 的 emailSubject/emailBody）。Stage0 首封优先消费；缺失时 EmailAgent 走
  // LLM 实时生成或模板兜底。
  aiEmail?: { subject: string; body: string }
  /* P1-4：收件人国家 → 冷邮件时区发送窗口判定（09:00-18:00 当地时间） */
  country?: string
  preferredAgent?: SalesAgentType
  createdAt: number
  priority: number
}

export type AgentTaskQueue = {
  whatsapp: AgentTask[]
  linkedin: AgentTask[]
  email: AgentTask[]
}

let currentPipelineRunId: string | null = null

/**
 * P0-3 修复：最近一次**真实暂存过目标**的管道 runId。
 *
 * 原缺陷：`isStaleTask` 只与 `currentPipelineRunId`（暂存窗口内的瞬时值）比较，
 * 而 `withPipelineIsolation` 在 finally 中必然把它清空。用户点击"开始触达"时
 * `currentPipelineRunId` 恒为 null，`isStaleTask` 恒返回 false —— 陈旧任务防重
 * 实际从未生效。
 *
 * 修复：引入"最近一次成功暂存的 runId"作为暂存窗口关闭后的比较基准。
 * 只有真正暂存过目标（>=1 条）的管道才更新它，避免"新一轮搜索没有产出合格线索"
 * 反而误杀上一轮尚未确认的暂存目标。
 */
let latestStagedRunId: string | null = null

export const getCurrentPipelineRunId = () => currentPipelineRunId
export const getLatestStagedRunId = () => latestStagedRunId

/** 由暂存层（stageAgentsFromPipeline）在确实暂存到目标后调用。 */
export const markPipelineStaged = (runId: string): void => {
  latestStagedRunId = runId
}

/** 测试隔离用：清空暂存基准，避免用例间互相污染。 */
export const resetPipelineIsolation = (): void => {
  currentPipelineRunId = null
  latestStagedRunId = null
}

export const qualifiesForPipeline = (
  matchScore: number | null | undefined,
  lead: { email?: string; phone?: string; linkedinUrl?: string; decisionMakers?: Array<{ linkedinUrl?: string }> },
): boolean => {
  if (matchScore == null || matchScore < 60) return false
  const hasDmLinkedin = Array.isArray(lead.decisionMakers) && lead.decisionMakers.some((dm) => Boolean(dm.linkedinUrl))
  return Boolean(lead.email || lead.phone || lead.linkedinUrl || hasDmLinkedin)
}

/**
 * P0-3 修复：SearchExecuteResult 无顶层 linkedinUrl（ipc-contracts.ts:201-230），
 * LinkedIn 数据仅存在于 decisionMakers[].linkedinUrl（search-service.ts:1757）。
 * 在此聚合回退，保证 LinkedIn Agent 队列可被真实填充。
 */
const resolveLinkedinUrl = (lead: {
  linkedinUrl?: string
  decisionMakers?: Array<{ linkedinUrl?: string }>
}): string | undefined => {
  if (lead.linkedinUrl) return lead.linkedinUrl
  if (Array.isArray(lead.decisionMakers)) {
    for (const dm of lead.decisionMakers) {
      if (dm && dm.linkedinUrl) return dm.linkedinUrl
    }
  }
  return undefined
}

export const buildAgentTaskQueue = (
  leads: Array<{
    id?: string
    company: string
    website: string
    email?: string
    phone?: string
    linkedinUrl?: string
    matchScore?: number | null
    decisionMakers?: Array<{ linkedinUrl?: string }>
    aiEmail?: { subject: string; body: string }
    country?: string
  }>,
): AgentTaskQueue => {
  const queue: AgentTaskQueue = { whatsapp: [], linkedin: [], email: [] }

  for (const lead of leads) {
    if (!qualifiesForPipeline(lead.matchScore, lead)) continue

    const linkedinUrl = resolveLinkedinUrl(lead)

    const task: AgentTask = {
      id: crypto.randomUUID(),
      taskRunId: currentPipelineRunId ?? undefined,
      leadId: 0,
      // Carry the search result's stable id so downstream write-back keys on it.
      leadKey: lead.id ? String(lead.id) : undefined,
      company: lead.company,
      website: lead.website,
      phone: lead.phone,
      email: lead.email,
      linkedinUrl,
      aiEmail:
        lead.aiEmail?.subject && lead.aiEmail?.body
          ? { subject: lead.aiEmail.subject, body: lead.aiEmail.body }
          : undefined,
      country: lead.country,
      createdAt: Date.now(),
      priority: lead.matchScore ?? 0,
    }

    if (lead.phone) queue.whatsapp.push(task)
    if (linkedinUrl) queue.linkedin.push(task)
    if (lead.email) queue.email.push(task)
  }

  for (const key of Object.keys(queue) as (keyof AgentTaskQueue)[]) {
    queue[key].sort((a, b) => b.priority - a.priority)
  }

  return queue
}

export const withPipelineIsolation = <T>(fn: (runId: string) => Promise<T>): Promise<T> => {
  const runId = crypto.randomUUID()
  currentPipelineRunId = runId
  return fn(runId).finally(() => {
    if (currentPipelineRunId === runId) {
      currentPipelineRunId = null
    }
  })
}

export const isStaleTask = (taskRunId: string): boolean => {
  if (!currentPipelineRunId) {
    // 暂存窗口已关闭（例如用户在搜索完成后点击"开始触达"）。
    // 此时以"最近一次成功暂存的 runId"为基准：来自更早管道的任务即为陈旧。
    // 若从未有过成功暂存，则无比较基准，返回 false（保持 null-safe）。
    if (!latestStagedRunId) return false
    return taskRunId !== latestStagedRunId
  }
  return taskRunId !== currentPipelineRunId
}
