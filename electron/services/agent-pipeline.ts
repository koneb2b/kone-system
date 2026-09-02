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

export const getCurrentPipelineRunId = () => currentPipelineRunId

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
  if (!currentPipelineRunId) return false // No active pipeline — no stale comparison
  return taskRunId !== currentPipelineRunId
}
