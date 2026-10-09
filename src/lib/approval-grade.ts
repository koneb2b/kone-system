/* P1-10：审批单的邮箱验证等级判定。
 *
 * ## 为什么不能硬编码
 * `leads-table.tsx` 原先在提交审批时写死 `emailVerificationGrade: 'verified'`。
 * 但云端对缺省值的处理是 `'unverified'`（`electron/services/cloudflare-service.ts`：
 * `emailGrade: lead.emailVerificationGrade || 'unverified'`）—— 即**系统原本的诚实默认**。
 * 渲染层硬编码 `'verified'` 会把它覆盖掉，把**未经 SMTP 验证的邮箱标记为已验证**，
 * 构成合规风险（误判为可投递）。
 *
 * ## 规则
 * 1) 优先取与该线索邮箱**匹配的决策人**的 `emailGrade`（采集层 `contact-validation.ts` 生成）；
 * 2) 无匹配 / 无等级 → 诚实降级为 `'unverified'`（与云端默认一致），**绝不谎报**。
 */

export type ApprovalGradeLead = {
  email?: string
  decisionMakers?: Array<{ email?: string; emailGrade?: string }>
}

/** 云端对缺省等级的兜底值 —— 保持与 `cloudflare-service` 一致。 */
export const DEFAULT_EMAIL_VERIFICATION_GRADE = 'unverified'

export const resolveEmailVerificationGrade = (lead: ApprovalGradeLead): string => {
  const target = String(lead?.email || '')
    .trim()
    .toLowerCase()
  if (target) {
    const matched = (lead?.decisionMakers || []).find(
      (dm) =>
        String(dm?.email || '')
          .trim()
          .toLowerCase() === target,
    )
    const grade = String(matched?.emailGrade || '').trim()
    if (grade) return grade
  }
  return DEFAULT_EMAIL_VERIFICATION_GRADE
}
