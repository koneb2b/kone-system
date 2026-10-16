import * as crypto from 'crypto'
import type { SalesAgentType } from '../../src/shared/ipc-contracts'
import { canReachWhatsApp } from '../utils/contact-validation'
/* 联系方式来源与可信度（三档 SSOT）：`inferred` 一律不得**自动**派发（需人工确认） */
import { canAutoDispatch, type ContactProvenance } from '../../src/shared/contact-provenance'
/* S5a：买家证据抽取（差异化首封用），纯函数 */
import { buildBuyerEvidence, type BuyerEvidenceLead } from './agents/outreach-quality'

/** 管道内「WhatsApp 可达」判定的最小入参（与 `SearchExecuteResult` 对齐）。 */
type WhatsAppReachLead = {
  phone?: string
  phoneKind?: 'mobile' | 'landline' | 'unknown'
  countryCode?: string
}

/** 管道内「来源与可信度」判定的最小入参。 */
type ContactProvenanceLead = {
  contactProvenance?: ContactProvenance
}

/**
 * 该线索的电话**能否用于 WhatsApp**（座机 / 无法判定 → `false`）。
 *
 * ## 为什么必须判定（2026-10-13 修复真实缺陷）
 * `buildAgentTaskQueue` 原为 `if (lead.phone) queue.whatsapp.push(task)` —— 对**任何电话（含座机）**
 * 都入队 WhatsApp。这与双端 SSOT `src/shared/phone-kind.ts`（WhatsApp 是手机 App，**座机无法注册/接收**）
 * **直接矛盾**，也与 UI 侧口径不一致（`leads-management.tsx` 早已用 `classifyPhoneKind` 门禁）。
 * 后果：高级版自动巡航会对座机线索发起**必然失败**的 WhatsApp 任务（浪费额度、污染运行日志、
 * 且"给座机发 WhatsApp"本身就不专业）。
 *
 * ## 判定顺序
 * 1. 优先采信后端已贯通字段 `phoneKind`（Prospeo 已验证手机 / `wa.me` 直链 → `mobile`；
 *    这样美国号码不会因 LNP 被判 `unknown` 而被误拒）；
 * 2. 缺失时回退双端 SSOT `canReachWhatsApp(phone, countryCode)`（保守：拿不准即不可用）。
 */
export const isWhatsAppReachable = (lead: WhatsAppReachLead): boolean => {
  const phone = String(lead?.phone || '').trim()
  if (!phone) return false
  if (lead?.phoneKind === 'mobile') return true
  if (lead?.phoneKind === 'landline') return false
  return canReachWhatsApp(phone, lead?.countryCode)
}

/**
 * 该线索的**电话**是否允许**自动**派发（S3）。
 * 除「号码可用于 WhatsApp」外，还要求**来源档位允许自动派发**：
 * 显式 `inferred`（推测号码）一律拦下，需人工确认；无标注按 `extracted` 放行（向后兼容）。
 */
export const canAutoDispatchPhone = (lead: WhatsAppReachLead & ContactProvenanceLead): boolean =>
  isWhatsAppReachable(lead) && canAutoDispatch(lead?.contactProvenance?.phone?.tier)

/** 该线索的**邮箱**是否允许**自动**派发（S3）：显式 `inferred` 一律拦下。 */
export const canAutoDispatchEmail = (lead: { email?: string } & ContactProvenanceLead): boolean =>
  Boolean(String(lead?.email || '').trim()) && canAutoDispatch(lead?.contactProvenance?.email?.tier)

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
  /* S5a 差异化首封：线索上**真实存在**的买家证据（官网片段 / 匹配理由 / 机会分依据 / 深度探测结论）。
     供开发信 prompt 引用，使首封有据可依而非模板；缺失时为空数组（不臆造）。 */
  buyerEvidence?: string[]
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
  lead: {
    email?: string
    phone?: string
    phoneKind?: 'mobile' | 'landline' | 'unknown'
    countryCode?: string
    contactProvenance?: ContactProvenance
    linkedinUrl?: string
    decisionMakers?: Array<{ linkedinUrl?: string }>
  },
): boolean => {
  if (matchScore == null || matchScore < 60) return false
  const hasDmLinkedin = Array.isArray(lead.decisionMakers) && lead.decisionMakers.some((dm) => Boolean(dm.linkedinUrl))
  /* 「可触达资产」= 邮箱 / LinkedIn / **可用于 WhatsApp 的手机**，且**允许自动派发**。
     座机不是可触达资产（WhatsApp 用不了、本产品无外呼能力）；
     显式 `inferred`（推测）联系方式**不得自动派发** → 不得占用管道名额。
     （2026-10-13：S1 修正座机口径；S3 叠加来源档位口径。） */
  return Boolean(lead.linkedinUrl || hasDmLinkedin || canAutoDispatchEmail(lead) || canAutoDispatchPhone(lead))
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
    /* 号码类型（WhatsApp 可用性）：由采集/富化层贯通（Prospeo 已验证手机 / wa.me 直链 → mobile） */
    phoneKind?: 'mobile' | 'landline' | 'unknown'
    countryCode?: string
    /* 联系方式来源与可信度（三档）：显式 `inferred` 不得自动派发 */
    contactProvenance?: ContactProvenance
    linkedinUrl?: string
    matchScore?: number | null
    decisionMakers?: Array<{ linkedinUrl?: string }>
    aiEmail?: { subject: string; body: string }
    country?: string
    /* S5a：买家证据来源字段（与 SearchExecuteResult 对齐，仅取抽取所需） */
    snippet?: string
    matchReasons?: string[]
    salesStrategy?: string
    opportunityScore?: BuyerEvidenceLead['opportunityScore']
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
      /* S5a：买家证据（确定性抽取；无则空数组） */
      buyerEvidence: buildBuyerEvidence(lead),
      country: lead.country,
      createdAt: Date.now(),
      priority: lead.matchScore ?? 0,
    }

    /* 座机/无法判定 → **不入队 WhatsApp**（见 `isWhatsAppReachable`）；
       S3：显式 `inferred`（推测号码）同样不入队，需人工确认。 */
    if (canAutoDispatchPhone(lead)) queue.whatsapp.push(task)
    if (linkedinUrl) queue.linkedin.push(task)
    /* S3：显式 `inferred`（推测邮箱）不得自动入队，需人工确认。 */
    if (canAutoDispatchEmail(lead)) queue.email.push(task)
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
