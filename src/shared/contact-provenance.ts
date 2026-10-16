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
  /**
   * 该字段**被取得/验证的时间**（epoch ms）。
   * Step 5 要求 UI 展示「验证时间」——低可信数据是否仍有效必须可判断，故随字段一起落库。
   * 缺失时不臆造（历史数据无该字段，UI 诚实降级为「未记录」）。
   */
  verifiedAt?: number
  /**
   * **多源冲突证据**（Step 4）：同一字段被多个来源给出**不同取值**时，
   * 保留落选方的来源与取值供人工复核 —— **绝不静默覆盖**。
   * 仅记录，不参与取值决策；为空/缺失表示无冲突。
   */
  conflicts?: Array<{ source: string; value: string }>
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
 * 档位优先级（数值越大越可信）——用于「**低可信不得覆盖高可信**」（Step 4）。
 */
export const CONTACT_TIER_RANK: Record<ContactTier, number> = { inferred: 0, extracted: 1, verified: 2 }

/**
 * 按**档位优先、同档位保持传入顺序**挑选候选，并**同时返回其来源与可信度**。
 *
 * 为什么必须「取值与来源同源」：若先按 A 链取值、再按 B 链推断来源，
 * 极易出现「值来自官网、来源却标成 Prospeo」的**静默错标**（比不标更伤信任）。
 * 故把取值与标注**合并为一次操作**。
 *
 * 为什么是**档位优先**而非「第一个非空」（2026-10-16 数据链路审计 Step 4）：
 * 原先「第一个非空即胜」会让**调用方传入顺序**隐式决定可信度 ——
 * 实测 `search-service.ts` 曾把 `extracted`（搜索结果）排在 `verified`（Prospeo）之前，
 * 一旦候选自带邮箱，就会用**低可信值压掉高可信值**。现改为按档位排序，
 * 同档位仍保留调用方的业务优先级（稳定排序）。
 *
 * **冲突不覆盖**：落选的非空且**取值不同**的候选会被记录进 `provenance.conflicts`
 * （去重、按可信度降序），供人工复核 —— 绝不静默丢弃。
 */
export const pickContactWithProvenance = (
  candidates: Array<{
    value?: string | null
    tier: ContactTier
    source: string
    grade?: string
    kind?: 'mobile' | 'landline' | 'unknown'
    verifiedAt?: number
  }>,
): { value: string; provenance?: ContactFieldProvenance } => {
  const nonEmpty = (candidates || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => String(candidate?.value || '').trim())

  if (nonEmpty.length === 0) return { value: '' }

  const ranked = nonEmpty.sort((a, b) => {
    const byTier = (CONTACT_TIER_RANK[b.candidate.tier] ?? 0) - (CONTACT_TIER_RANK[a.candidate.tier] ?? 0)
    return byTier !== 0 ? byTier : a.index - b.index
  })

  const best = ranked[0].candidate
  const value = String(best.value || '').trim()

  const conflicts = Array.from(
    new Map(
      ranked
        .slice(1)
        .map(({ candidate }) => ({
          source: String(candidate.source || '').trim(),
          value: String(candidate.value || '').trim(),
        }))
        .filter((entry) => entry.value && entry.value !== value)
        .map((entry) => [entry.value, entry] as const),
    ).values(),
  )

  const provenance: ContactFieldProvenance = {
    tier: best.tier,
    source: best.source,
    grade: best.grade,
    kind: best.kind,
  }
  if (typeof best.verifiedAt === 'number') provenance.verifiedAt = best.verifiedAt
  if (conflicts.length > 0) provenance.conflicts = conflicts

  return { value, provenance }
}
