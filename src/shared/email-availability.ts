/**
 * email-availability.ts — 邮箱**可用性判定**的单一事实源（双端共用 SSOT）
 *
 * ## 解决什么（Phase 1 / R2，2026-10-17）
 * 审计 R2 指出：第二供应商（Apollo）的回退门控此前是 `Boolean(prospeo.email)` ——
 * 只要首选供应商**返回了任何非空邮箱**就停止回退，**完全不看该邮箱的验证状态**。
 * 而 Prospeo 在 `only_verified_email: true` 下仍可能返回 `UNKNOWN/RISKY/CATCH_ALL` 等
 * **未经证实**的地址。于是「拿到了一个不可信的邮箱」= 「不再尝试已知更可靠的来源」，
 * 与「只有符合验证标准的结果才能终止回退」相悖。
 *
 * ## 判定原则（与 `contact-provenance.ts` 三档对齐）
 * - `INVALID` / `BOUNCED` / `UNAVAILABLE` / `NONE` / `LOCKED` → **不可用**（不得入库，不得回退给用户）；
 * - `VERIFIED` → **已验证**（最高档，可终止「要求已验证」的回退）；
 * - 其余（`UNKNOWN` / `PROBABLE` / `RISKY` / `CATCH_ALL` / `GUESSED` / `EXTRAPOLATED` / **`VALID`** …）
 *   → **可用但未验证**（按 `extracted` 档如实标注），**绝不冒认 `verified`**。
 *
 * ## `VALID` 为何不算已验证（2026-10-17 微调）
 * 仅有**供应商契约明确支持**的状态才可映射为 `verified`：Prospeo 文档化为 `VERIFIED`、
 * Apollo 文档化为 `verified`。`VALID` **不在**任何供应商契约中，故**刻意排除**：
 * 输入为 `VALID` 时**保留邮箱取值**（非空即可用），但**降档为 `extracted`**，绝不越级标 `verified`。
 *
 * 状态大小写归一后比较：Prospeo 用大写（`VERIFIED`）、Apollo 用小写（`verified`），
 * 二者共用本判定，避免「各写一份必然漂移」。
 *
 * 纯类型 + 纯函数：无 Electron / 网络依赖，可独立单测（沿用 `enrichment-cost.ts` 原则）。
 */

import type { ContactTier } from './contact-provenance'

/** 供应商自报的**不可用**邮箱状态（归一为大写比较）。 */
const INVALID_EMAIL_STATES = new Set(['INVALID', 'BOUNCED', 'UNAVAILABLE', 'NONE', 'LOCKED'])

/**
 * 供应商自报的**已验证**邮箱状态（归一为大写比较）。
 * **仅收录有契约依据者**：Prospeo `VERIFIED` / Apollo `verified`。
 * `VALID` **刻意排除**（无供应商契约支撑，见文件顶注）→ 归入 `extracted` 未验证档。
 */
const VERIFIED_EMAIL_STATES = new Set(['VERIFIED'])

export type EmailUsabilityReason = 'no_value' | 'invalid' | 'verified' | 'unverified'

export interface EmailUsability {
  /** 该邮箱是否**非空且非 INVALID**（可用作联系方式的底线）。 */
  usable: boolean
  /** 该邮箱能支撑的**最高可信档**：`verified` / `extracted` / `none`（无值或不可用）。 */
  tier: ContactTier | 'none'
  /** 归一后的状态（无状态时记 `UNKNOWN`，**不臆造** `VERIFIED`）。 */
  grade: string
  reason: EmailUsabilityReason
}

const NONE: EmailUsability = { usable: false, tier: 'none', grade: '', reason: 'no_value' }

/**
 * 评估一个供应商返回的邮箱是否可用、以及它能支撑何档可信度。
 *
 * **不臆造**：缺失状态一律记为 `UNKNOWN`（未验证），绝不默认 `VERIFIED`。
 */
export const assessEmailUsability = (
  input?: { email?: string | null; status?: string | null } | null,
): EmailUsability => {
  const email = String(input?.email || '').trim()
  if (!email) return NONE

  const grade =
    String(input?.status || '')
      .trim()
      .toUpperCase() || 'UNKNOWN'
  if (INVALID_EMAIL_STATES.has(grade)) return { usable: false, tier: 'none', grade, reason: 'invalid' }
  if (VERIFIED_EMAIL_STATES.has(grade)) return { usable: true, tier: 'verified', grade, reason: 'verified' }
  return { usable: true, tier: 'extracted', grade, reason: 'unverified' }
}

/**
 * 该邮箱是否达到**已验证**标准（用于「只有符合验证标准的结果才能终止回退」的判定）。
 * `CATCH_ALL` / `RISKY` / `UNKNOWN` 一律**不算**已验证。
 */
export const isVerifiedEmail = (input?: { email?: string | null; status?: string | null } | null): boolean =>
  assessEmailUsability(input).tier === 'verified'
