/**
 * contact-validation.ts — 决策人联系方式静态验证（P0-4，G4 缺口闭环）
 *
 * 决策人数据来自实验性第三方 API（AnySearch），零独立验证时 confidenceScore
 * 缺省为 0。此处做零网络成本的静态校验：
 * - email → 复用五级验证引擎的静态分类（格式 / disposable / role-account）
 * - phone → E.164 规范化校验（可选 + 前缀，8-15 位数字）
 * 校验结果以增量字段标注（emailGrade / phoneValid），不臆造 confidenceScore；
 * 前端依据 confidenceScore<=0 渲染 "AI 推测，未验证" 降级徽标。
 * SMTP 级深度验证属发送前门禁（automation:verify-emails），不在采集层执行。
 */
import { classifyEmailStatic } from './email-verification'
import type { DecisionMaker } from '../../src/shared/ipc-contracts'

/* E.164 规范化：可选 '+' 前缀，去分隔符后 8-15 位纯数字。
   无法可靠推断国别区号，因此不做补全——只校验是否已是可拨号格式。 */
export const normalizePhoneE164 = (raw: string): { valid: boolean; normalized?: string } => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return { valid: false }
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[\s\-().]/g, '')
  if (hasPlus) {
    if (!/^\+\d{8,15}$/.test(digits)) return { valid: false }
    return { valid: true, normalized: digits }
  }
  if (!/^\d{8,15}$/.test(digits)) return { valid: false }
  /* 无国际前缀：仍视为格式合法的本地号码，保留原值，不臆造区号 */
  return { valid: true, normalized: digits }
}

/* emailGrade / phoneValid 已在 DecisionMaker 契约中声明（增量可选字段） */
export type DecisionMakerValidation = DecisionMaker

/* 号码类型判定已收敛到 `src/shared/phone-kind.ts`（**双端共用 SSOT**）——
   渲染进程的 WhatsApp 按钮需要同一判定，各写一份必然漂移。
   语义见该文件头注释：WhatsApp 是手机 App，**固定电话不可用**；
   实测 17 条线索中 15 条为美国商家座机（Google Maps 来源）。 */
export { buildWhatsAppDigits, canReachWhatsApp, classifyPhoneKind, type PhoneKind } from '../../src/shared/phone-kind'

export const validateDecisionMakerContacts = (
  decisionMakers?: DecisionMaker[],
): DecisionMakerValidation[] | undefined => {
  if (!Array.isArray(decisionMakers) || decisionMakers.length === 0) return undefined
  return decisionMakers.map((dm) => {
    const validated: DecisionMakerValidation = { ...dm }
    if (dm.email?.trim()) {
      const staticResult = classifyEmailStatic(dm.email)
      if (staticResult.grade) {
        validated.emailGrade = staticResult.grade as string
      }
    }
    if (dm.phone) {
      validated.phoneValid = normalizePhoneE164(dm.phone).valid
    } else {
      validated.phoneValid = false
    }
    return validated
  })
}
