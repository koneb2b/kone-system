/**
 * enrich-apollo.ts — Apollo.io 联系人富化适配器（**Fail-Closed**）
 *
 * ## 解决什么
 * 现有富化 100% 依赖「官网深探」（`enrichLeadWithDeepProbe`）：
 * 商家官网普遍**不公开邮箱**（多用联系表单）、公开电话**几乎都是座机** ——
 * 这是「邮箱覆盖低 + WhatsApp 用不了」的根因。**Apollo 是直接返回
 * 已验证邮箱 + 手机号（含类型）的 B2B 数据源**，补上这块短板。
 *
 * ## 宪法合规
 * Apollo 查询在单条线索富化步骤内**串行追加**一次，**不提升并行线索数**
 * （`SEARCH_ENRICH_CONCURRENCY = 2` 约束的是并行线索数，不是单线索数据源数）
 * → 不触碰红线。额度由 `ENRICH_LOOKUP_BUDGET`（每轮搜索硬顶）守护，属「总量域」。
 *
 * ## Fail-Closed 契约
 * 任何异常（无密钥 / 超时 / 非 2xx / JSON 解析失败 / 无命中）一律返回
 * `{ used: false }`，**绝不抛错**——调用方据此降级到既有官网抓取，绝不中断搜索。
 */

import { fetchWithTimeout } from '../proxy-service'
import { getSecret } from '../secret-manager'
import { SECRET_KEYS } from '../config-service'
import { resolveCountryCode } from '../../../src/lib/country-code'
import { classifyPhoneKind, buildWhatsAppDigits } from '../../utils/contact-validation'
import { extractDomainFromUrl } from './text-utils'

const APOLLO_PEOPLE_MATCH_ENDPOINT = 'https://api.apollo.io/api/v1/people/match'

/**
 * 读取 Apollo API Key（与 LLM/Google 同级，走 secret-manager 加密落盘）。
 *
 * **永不抛错**：密钥存储不可用（如 safeStorage 未启用、容器未就绪、
 * 解密失败）一律视为「未配置」返回 `''`。Apollo 只是官网抓取的**增量补充**，
 * 密钥读取异常绝不能反过来中断整条富化链路（Fail-Closed 的第一道关口）。
 */
export const getUserApolloApiKey = (): string => {
  try {
    return String(getSecret(SECRET_KEYS.APOLLO_API_KEY) || '').trim()
  } catch {
    return ''
  }
}

export type ApolloPhoneKind = 'mobile' | 'landline' | 'unknown'

export interface ApolloEnrichResult {
  /** 已验证邮箱（Apollo personal_emails 首项）。 */
  email?: string
  /** 选中的最佳电话（优先 mobile 类型）。 */
  phone?: string
  /** 该电话经 phone-kind 分类后的类型。 */
  phoneKind: ApolloPhoneKind
  /** 该电话是否可用于 WhatsApp（= phoneKind 为 mobile 且能补全国家码）。 */
  phoneReachable: boolean
  /** 是否真正消耗了一次 Apollo 查询并得到可用数据。 */
  used: boolean
  source: 'apollo'
}

const EMPTY_RESULT: ApolloEnrichResult = {
  email: undefined,
  phone: undefined,
  phoneKind: 'unknown',
  phoneReachable: false,
  used: false,
  source: 'apollo',
}

/**
 * 从 Apollo `phone_numbers[]` 中挑选最佳电话：
 * 优先 `type === 'mobile'`，其次任意 `sanitized_number` 非空者。
 * 返回 `{ raw, kind }`，无可用项返回 null。
 */
const pickBestApolloPhone = (
  phoneNumbers: Array<{ raw_number?: string; sanitized_number?: string; type?: string }> | undefined,
): { raw: string; fromApolloMobile: boolean } | null => {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null
  const mobile = phoneNumbers.find((p) => String(p?.type || '').toLowerCase() === 'mobile')
  const pick = mobile || phoneNumbers.find((p) => String(p?.sanitized_number || p?.raw_number || '').trim())
  if (!pick) return null
  const raw = String(pick.sanitized_number || pick.raw_number || '').trim()
  if (!raw) return null
  return { raw, fromApolloMobile: Boolean(mobile) }
}

/**
 * Apollo People Enrichment（Fail-Closed）。
 * 给定公司域 + 公司名，返回已验证邮箱 + 最佳电话（含 WhatsApp 可达性）。
 */
export const enrichFromApollo = async (payload: {
  domain?: string
  company?: string
  country?: string
  /** 单次请求超时（默认 15s，与 WEBSITE_PROBE_TIMEOUT_MS 同量级）。 */
  timeoutMs?: number
}): Promise<ApolloEnrichResult> => {
  const apiKey = getUserApolloApiKey()
  if (!apiKey) {
    return EMPTY_RESULT
  }

  const domain = extractDomainFromUrl(payload.domain || payload.company || '') || ''
  if (!domain && !payload.company) {
    return EMPTY_RESULT
  }

  const body = {
    api_key: apiKey,
    domain: domain || undefined,
    company: payload.company || undefined,
    reveal_personal_emails: true,
    reveal_phone_number: true,
  }

  try {
    const response = await fetchWithTimeout(
      APOLLO_PEOPLE_MATCH_ENDPOINT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: JSON.stringify(body),
      },
      payload.timeoutMs ?? 15_000,
    )

    /* Fail-Closed：429（限流/额度）或任一非 2xx → 不抛错，降级到官网抓取。 */
    if (!response.ok) {
      return EMPTY_RESULT
    }

    const json: any = await response.json().catch(() => ({}))
    const person = json?.person || (Array.isArray(json?.people) ? json.people[0] : undefined) || {}

    const email = String(
      person?.email || (Array.isArray(person?.personal_emails) ? person.personal_emails[0] : '') || '',
    ).trim()
    const bestPhone = pickBestApolloPhone(person?.phone_numbers)

    if (!email && !bestPhone) {
      return EMPTY_RESULT
    }

    const countryCode = resolveCountryCode(payload.country) || ''
    let phoneKind: ApolloPhoneKind = 'unknown'
    let phoneReachable = false
    if (bestPhone) {
      /* Apollo 自报 mobile 类型 → **直接采信**（Apollo 是号码类型的权威来源；
         而 phone-kind 仅按号段推断，对美国 LNP 号码只能返回 unknown）。
         否则用 phone-kind 双端 SSOT 再判一次。
         可达性 = 已判为 mobile **且** 能补全可拨号格式（buildWhatsAppDigits 非 null）。 */
      phoneKind = bestPhone.fromApolloMobile ? 'mobile' : classifyPhoneKind(bestPhone.raw, countryCode)
      phoneReachable = phoneKind === 'mobile' && buildWhatsAppDigits(bestPhone.raw, countryCode) !== null
    }

    return {
      email: email || undefined,
      phone: bestPhone?.raw,
      phoneKind,
      phoneReachable,
      used: Boolean(email || bestPhone),
      source: 'apollo',
    }
  } catch {
    /* 网络异常 / 超时 / 解析失败 → Fail-Closed。 */
    return EMPTY_RESULT
  }
}
