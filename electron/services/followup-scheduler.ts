import type { ConfigStore } from './config-service'

// Persistent multi-round email follow-up plan (P0-2).
// A plan advances 0 → 1 → 2 → 3 over time and stops as soon as the lead replies.
// State lives in the config store so it survives app restarts.

export type FollowupStage = 0 | 1 | 2 | 3

export type FollowupPlan = {
  leadKey: string // stable key = company (matches writeBackAgentStatus key)
  email: string
  company: string
  country?: string // P1-4: 收件人国家 → 时区发送窗口判定
  stage: FollowupStage
  lastSentAt: number // epoch ms of the most recent send
  nextSendAt: number // epoch ms when the next stage becomes due
  repliedAt?: number // set once a reply is detected; stops the sequence
  /* P1-3（缺口5）：IMAP 未配置 → 回复检测盲区，序列暂停等待人工确认；
     置 true 期间 tick 不自动发送，IMAP 配置恢复后自动续推并清零。 */
  pendingManual?: boolean
  /* S5b（2026-10-16）：首封使用的买家证据（差异化首封），随计划持久化，
     使 stage 1–3 跟进信保持**证据连续性**。可选 —— 旧计划缺该字段时按空处理（向后兼容）。 */
  buyerEvidence?: string[]
  done: boolean // true when finished (replied or stage 3 sent)
}

const STORE_KEY = 'followup_plans'

// Days between stages: stage0→1 after 3d, 1→2 after 4d, 2→3 after 7d.
export const STAGE_INTERVAL_MS: Record<FollowupStage, number> = {
  0: 3 * 24 * 60 * 60 * 1000,
  1: 4 * 24 * 60 * 60 * 1000,
  2: 7 * 24 * 60 * 60 * 1000,
  3: 0, // terminal
}

/* P1-4（缺口8）：轮次间隔随机抖动幅度 ±20%（拟泊松到达，避免整点节律指纹）。
   随机源可注入以便测试断言区间。 */
export const INTERVAL_JITTER_RATIO = 0.2
export const jitteredInterval = (intervalMs: number, random: () => number = Math.random): number => {
  if (intervalMs <= 0) return intervalMs
  const factor = 1 - INTERVAL_JITTER_RATIO + 2 * INTERVAL_JITTER_RATIO * random()
  return Math.round(intervalMs * factor)
}

export const nextStage = (stage: FollowupStage): FollowupStage => (stage < 3 ? ((stage + 1) as FollowupStage) : 3)

// Build a fresh plan right after the first (stage 0) email is sent.
export const createPlan = (
  company: string,
  email: string,
  now: number = Date.now(),
  leadKey?: string,
  country?: string,
  buyerEvidence?: string[],
): FollowupPlan => ({
  leadKey: leadKey || company,
  email,
  company,
  country: country?.trim() || undefined,
  stage: 0,
  lastSentAt: now,
  nextSendAt: now + jitteredInterval(STAGE_INTERVAL_MS[0]),
  buyerEvidence:
    Array.isArray(buyerEvidence) && buyerEvidence.filter((item) => String(item ?? '').trim()).length > 0
      ? buyerEvidence.map((item) => String(item ?? '').trim()).filter(Boolean)
      : undefined,
  done: false,
})

// A plan is due when it is active, not replied, not held for manual confirmation,
// and its nextSendAt has passed.
export const isPlanDue = (plan: FollowupPlan, now: number = Date.now()): boolean =>
  !plan.done && plan.repliedAt == null && !plan.pendingManual && plan.stage < 3 && now >= plan.nextSendAt

// Advance a plan after a successful next-stage send (clears the manual hold).
export const advancePlan = (plan: FollowupPlan, now: number = Date.now()): FollowupPlan => {
  const advanced = nextStage(plan.stage)
  const done = advanced >= 3
  return {
    ...plan,
    stage: advanced,
    lastSentAt: now,
    nextSendAt: done ? now : now + jitteredInterval(STAGE_INTERVAL_MS[advanced]),
    pendingManual: false,
    done,
  }
}

// Mark a plan as replied — terminates the sequence.
export const markReplied = (plan: FollowupPlan, now: number = Date.now()): FollowupPlan => ({
  ...plan,
  repliedAt: now,
  done: true,
})

/* P2-2（部分落地）：14 天全渠道协同节律的邮件阶段定位。
   Day0 邮件首封（由 Agent 管道完成）→ Day3-5 LinkedIn 同行交流（人工）→
   Day7-10 Follow-up 1 → Day12-14 Follow-up 2。
   统一编排器依赖产品面尚未存在的前端装配范式（商机卡 Day0、LinkedIn 人工
   触点 UI），本函数先以纯函数 + 阶段推进日志的形式提供节律指引；完整编排
   器保留为路线图（kone-PRD §六，诚实标注）。 */
export type CadencePhase = {
  stage: FollowupStage
  dayWindow: string
  channel: 'email' | 'linkedin_manual'
  action: string
  automated: boolean
}

export const CADENCE_PHASES: CadencePhase[] = [
  { stage: 0, dayWindow: 'Day 0-1', channel: 'email', action: '发送首轮定制开发信（AI 差异化内容）', automated: true },
  {
    stage: 1,
    dayWindow: 'Day 3-5',
    channel: 'linkedin_manual',
    action: 'LinkedIn 无推销感同行交流（人工执行，仅参考破冰文案）',
    automated: false,
  },
  { stage: 2, dayWindow: 'Day 7-10', channel: 'email', action: 'Follow-up 1（行业白皮书/痛点洞察）', automated: true },
  { stage: 3, dayWindow: 'Day 12-14', channel: 'email', action: 'Follow-up 2（Break-up 礼貌确认）', automated: true },
]

export const describeCadence = (stage: FollowupStage): string => {
  const current = CADENCE_PHASES.find((p) => p.stage === stage)
  if (!current) return `Stage ${stage} 已完成`
  return `${current.dayWindow}: ${current.action}${current.automated ? '' : '（需人工）'}`
}

// ── Persistence (ConfigStore) ─────────────────────────────

export const readPlans = (store: ConfigStore): FollowupPlan[] => {
  const raw = store.get(STORE_KEY)
  return Array.isArray(raw) ? (raw as FollowupPlan[]) : []
}

export const writePlans = (store: ConfigStore, plans: FollowupPlan[]): void => {
  store.set(STORE_KEY, plans)
}

// Insert or replace a plan by leadKey.
export const upsertPlan = (store: ConfigStore, plan: FollowupPlan): void => {
  const plans = readPlans(store)
  const idx = plans.findIndex((p) => p.leadKey === plan.leadKey)
  if (idx >= 0) plans[idx] = plan
  else plans.push(plan)
  writePlans(store, plans)
}

export const getDuePlans = (store: ConfigStore, now: number = Date.now()): FollowupPlan[] =>
  readPlans(store).filter((p) => isPlanDue(p, now))
