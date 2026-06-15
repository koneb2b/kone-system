import * as crypto from 'crypto'
import type { SalesAgentType } from '../../src/shared/ipc-contracts'

export type AgentTask = {
  id: string
  taskRunId?: string
  leadId: number
  company: string
  website: string
  phone?: string
  email?: string
  linkedinUrl?: string
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
  lead: { email?: string; phone?: string; linkedinUrl?: string }
): boolean => {
  if (matchScore == null || matchScore < 60) return false
  return Boolean(lead.email || lead.phone || lead.linkedinUrl)
}

export const buildAgentTaskQueue = (
  leads: Array<{
    company: string
    website: string
    email?: string
    phone?: string
    linkedinUrl?: string
    matchScore?: number | null
  }>
): AgentTaskQueue => {
  const queue: AgentTaskQueue = { whatsapp: [], linkedin: [], email: [] }

  for (const lead of leads) {
    if (!qualifiesForPipeline(lead.matchScore, lead)) continue

    const task: AgentTask = {
      id: crypto.randomUUID(),
      taskRunId: currentPipelineRunId ?? undefined,
      leadId: 0,
      company: lead.company,
      website: lead.website,
      phone: lead.phone,
      email: lead.email,
      linkedinUrl: lead.linkedinUrl,
      createdAt: Date.now(),
      priority: lead.matchScore ?? 0,
    }

    if (lead.phone) queue.whatsapp.push(task)
    if (lead.linkedinUrl) queue.linkedin.push(task)
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
  if (!currentPipelineRunId) return false  // No active pipeline — no stale comparison
  return taskRunId !== currentPipelineRunId
}
