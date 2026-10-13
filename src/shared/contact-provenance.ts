/**
 * contact-provenance.ts — 联系方式**来源与可信度**的单一事实源（**双端共用 SSOT**）
 *
 * ## 为什么需要（2026-10-13 产品定位校准）
 * Kone 是**专业严谨的 B2B 获客工作台**，核心价值是「**匹配精度 + 策略质量**」，
 * 联系方式只是其中一个环节。联系方式必须**说清来源与可信度** ——
 * 用低置信度数据静默填充会伤害信任；而完全不做低成本补充又浪费可得价值。
 * 故把联系方式分为**三档**，并在「展示 / 筛选 / 管道放行 / 发送前确认」全链路上体现。
 *
 * ## 三档（与产品定义一致）
 * | 档位 | 定义 | 典型来源 | 默认行为 |
 * |---|---|---|---|
 * | `verified`  | 第三方**验证过** | Prospeo `VERIFIED`、Apollo 已验证、SMTP/BOUNCEBAN 回执 | 可自动用于 Agent |
 * | `extracted` | 从**公开原文**提取 | 官网 `mailto:`/`tel:`/JSON-LD/联系页、`wa.me` 直链、搜索结果/目录 | 可自动用于 Agent |
 * | `inferred`  | **推断 / 猜测** | 邮箱模式（`first.last@domain`）、旁证 | **默认不自动发送**，发送前二次确认 |
 *
 * ## 放在 shared 的原因
 * 主进程（采集/富化/管道）与渲染进程（结果卡片徽标、筛选、发送前确认）**都需要同一判定**，
 * 各写一份必然漂移 —— 与 `phone-kind.ts` 同理，收敛到 `src/shared/` 单一事实源。
 */

export type ContactTier = 'verified' | 'extracted' | 'inferred'

export type ContactFieldProvenance = {
  tier: ContactTier
  /** 人类可读来源（如 `官网` / `Prospeo` / `Google Maps`）。 */
  source: string
  /** 邮箱验证等级（复用既有五级：`verified` / `probable` / `catch_all` / `risky` / `invalid`）。 */
  grade?: string
  /** 电话类型（复用双端 SSOT `phone-kind`）。 */
  kind?: 'mobile' | 'landline' | 'unknown'
}

export type ContactProvenance = {
  email?: ContactFieldProvenance
  phone?: ContactFieldProvenance
  contact?: ContactFieldProvenance
}

/** 档位显示名（UI 统一口径，避免各处硬编码漂移）。 */
export const CONTACT_TIER_LABEL: Record<ContactTier, string> = {
  verified: '已验证',
  extracted: '官网提取',
  inferred: '推测',
}

/**
 * **管道 / 发送放行**判定（含**向后兼容缺省**）。
 *
 * 唯一会被拦下的档位是**显式的 `inferred`**（推测数据一律不得自动发送）；
 * **无标注按 `extracted` 处理** —— 历史数据无标注，**不得因此被整体排除**
 * （且缺省即"来自搜索结果/官网提取"的事实）。
 *
 * 注：曾有一个更"严格"的 `canAutoUseContact`（无标注 = false，语义为"能否宣称可信"），
 * 但**生产代码从未使用**（只被测试引用）→ 已按"拒绝过度工程化"删除；
 * 若未来 UI 需要"是否敢宣称已验证"，再按需引入。
 */
export const canAutoDispatch = (tier?: ContactTier): boolean => tier !== 'inferred'

/**
 * 发送前是否需要**二次确认**（S3 产品原则：发送前二次提示风险）。
 * 仅显式 `inferred`（推测数据）需要 —— 无标注按既有流程（不打扰）。
 */
export const requiresSendConfirmation = (tier?: ContactTier): boolean => tier === 'inferred'

/**
 * 按**优先级顺序**挑选第一个非空候选，并**同时返回其来源与可信度**。
 *
 * 为什么必须「取值与来源同源」：若先按 A 链取值、再按 B 链推断来源，
 * 极易出现「值来自官网、来源却标成 Prospeo」的**静默错标**（比不标更伤信任）。
 * 故把取值与标注**合并为一次操作**。
 */
export const pickContactWithProvenance = (
  candidates: Array<{
    value?: string | null
    tier: ContactTier
    source: string
    grade?: string
    kind?: 'mobile' | 'landline' | 'unknown'
  }>,
): { value: string; provenance?: ContactFieldProvenance } => {
  for (const candidate of candidates) {
    const value = String(candidate.value || '').trim()
    if (!value) continue
    return {
      value,
      provenance: { tier: candidate.tier, source: candidate.source, grade: candidate.grade, kind: candidate.kind },
    }
  }
  return { value: '' }
}
