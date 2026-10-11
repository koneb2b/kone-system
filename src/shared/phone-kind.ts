/**
 * phone-kind.ts — 电话号码类型判定（**双端共用 SSOT**）
 *
 * ## 为什么需要（2026-10-11，用户实测反馈）
 * WhatsApp 是**手机 App**，**固定电话（座机）无法注册/接收 WhatsApp 消息**。
 * 而 Google Maps / Yellow Pages 等来源返回的商家电话**绝大多数是座机**——
 * 实测 17 条线索中 15 条为美国 `(XXX) XXX-XXXX` 格式的商家座机。
 *
 * 此前只有 `normalizePhoneE164` 做**格式**校验，座机也被判 `valid: true`，
 * 前端据此直接拼 `wa.me/<digits>` → **链接必然无效**。
 *
 * ## 放在 shared 的原因
 * 主进程（`electron/utils/contact-validation.ts`）与渲染进程
 * （`leads-management.tsx` 的 WhatsApp 按钮）**都需要同一判定**，
 * 各写一份必然漂移。故收敛到 `src/shared/` 单一事实源。
 */

export type PhoneKind = 'mobile' | 'landline' | 'unknown'

/**
 * 判定号码能否用于 WhatsApp。
 *
 * **保守策略**：拿不准就返回 `unknown`，由调用方按「不可用」处理，
 * **绝不猜测** —— 宁可少给一个按钮，不可给错链接（用户点了却打不开最伤体验）。
 *
 * 分国家策略：
 * - **CN**：`1[3-9]xxxxxxxxx`（11 位）→ mobile；`0xx(x)-xxxxxxx` → landline
 * - **DE**：`+49 15x/16x/17x` → mobile；其余 → landline
 * - **US/CA**：**号码可携带（LNP），无法从号段区分手机与座机** → `unknown`
 *   （且此类来源多为商家座机，实际几乎都不可用于 WhatsApp）
 * - 其他国家：`unknown`
 */
export const classifyPhoneKind = (raw: string, countryCode?: string): PhoneKind => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return 'unknown'
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return 'unknown'
  const cc = String(countryCode || '')
    .trim()
    .toUpperCase()

  /* 中国：手机号段 1[3-9]，11 位；座机 0 开头带区号 */
  if (cc === 'CN' || digits.startsWith('86')) {
    const local = digits.startsWith('86') ? digits.slice(2) : digits
    if (/^1[3-9]\d{9}$/.test(local)) return 'mobile'
    if (/^0\d{2,3}\d{7,8}$/.test(local)) return 'landline'
    return 'unknown'
  }

  /* 德国：移动号段 015x / 016x / 017x */
  if (cc === 'DE' || digits.startsWith('49')) {
    const local = digits.startsWith('49') ? digits.slice(2).replace(/^0/, '') : digits.replace(/^0/, '')
    if (/^1[5-7]\d{8,10}$/.test(local)) return 'mobile'
    if (/^[2-9]\d{5,}$/.test(local)) return 'landline'
    return 'unknown'
  }

  /* 美国 / 加拿大：号码可携带，**无法从号段区分**，保守返回 unknown */
  if (cc === 'US' || cc === 'CA' || /^1\d{10}$/.test(digits)) return 'unknown'

  return 'unknown'
}

/** 该号码是否**可用于 WhatsApp**（仅 mobile 为 true）。 */
export const canReachWhatsApp = (raw: string, countryCode?: string): boolean =>
  classifyPhoneKind(raw, countryCode) === 'mobile'

/**
 * 为 `wa.me` 构造号码：**必须带国家码**（E.164 无 `+`）。
 *
 * 若号码已是国际格式（带 `+` 或已知国家码前缀）→ 直接取数字；
 * 否则**无法可靠补全**，返回 `null`（调用方应提示用户手动确认）。
 */
export const buildWhatsAppDigits = (raw: string, countryCode?: string): string | null => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  const cc = String(countryCode || '')
    .trim()
    .toUpperCase()

  /* 已带国际前缀 */
  if (trimmed.startsWith('+')) return digits

  /* 已知国家码映射（仅覆盖我们能确定补全的国家） */
  const dialCode: Record<string, string> = {
    CN: '86',
    DE: '49',
    US: '1',
    CA: '1',
    GB: '44',
    FR: '33',
    IT: '39',
    ES: '34',
  }
  const code = dialCode[cc]
  if (!code) return null
  if (digits.startsWith(code)) return digits
  /* 本地号码补国家码（去掉本地前导 0，如 DE 的 030 → 30） */
  const local = digits.replace(/^0+/, '')
  return `${code}${local}`
}
