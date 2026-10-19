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
  /** 邮箱（`email` 或 `personal_emails[0]`）。 */
  email?: string
  /**
   * Apollo 自报的**邮箱状态**（原样回传，如 `verified` / `guessed` / `unavailable` / `bounced` / `locked`）。
   *
   * Step 4（2026-10-16 数据链路审计 D-3）：此前实现**完全未读取该字段**，
   * 却在调用方被无条件标为 `tier: 'verified'` —— 属「未校验即冒认已验证」。
   * 现如实回传，由调用方按状态决定可信档。
   */
  emailStatus?: string
  /** 选中的最佳电话（优先 mobile 类型）。 */
  phone?: string
  /** 该电话经 phone-kind 分类后的类型。 */
  phoneKind: ApolloPhoneKind
  /** 该电话是否可用于 WhatsApp（= phoneKind 为 mobile 且能补全国家码）。 */
  phoneReachable: boolean
  /* ── Step 2B：决策人身份（与 Prospeo 对齐；Apollo 是「匹配」而非定向搜索，故附 matchConfidence） ── */
  contactName?: string
  contactTitle?: string
  contactLinkedinUrl?: string
  /** Apollo 自报的匹配置信度（`high` / `medium` / `low` / `none`）；缺失时不臆造。 */
  matchConfidence?: string
  /** Phase 1 / R1：供应商稳定人员 ID（Apollo `person.id`），用作联系人级缓存隔离最强标识。 */
  contactId?: string
  /**
   * Phase 1 / R2（2026-10-17）：本次请求是否**基于真实人员标识**（邮箱/姓名/LinkedIn/ID）。
   * `false` 表示仅按公司字段匹配 —— `people/match` 契约下不可靠，**不得冒认**为某指定联系人的已确认数据。
   */
  matchedPersonIdentity?: boolean
  /** 是否真正消耗了一次 Apollo 查询并得到可用数据。 */
  used: boolean
  source: 'apollo'
  /** Phase 1 / R2：失败**原因类别**（`used:false` 时为具体原因），供调用方如实记账。 */
  failureKind?: ApolloFailureKind
}

/** Apollo 富化的失败原因类别（Fail-Closed 下 `used:false` 的细分）。 */
export type ApolloFailureKind =
  | 'missing_key'
  | 'no_target'
  | 'insufficient_identifier'
  | 'http_error'
  | 'api_error'
  | 'no_match'
  | 'network_error'

const EMPTY_RESULT: ApolloEnrichResult = {
  email: undefined,
  emailStatus: undefined,
  phone: undefined,
  phoneKind: 'unknown',
  phoneReachable: false,
  contactName: undefined,
  contactTitle: undefined,
  contactLinkedinUrl: undefined,
  matchConfidence: undefined,
  contactId: undefined,
  matchedPersonIdentity: undefined,
  used: false,
  source: 'apollo',
}

/** Fail-Closed 出口：附带**失败原因类别**（`used:false`），供调用方如实记账。 */
const fail = (kind: ApolloFailureKind): ApolloEnrichResult => ({ ...EMPTY_RESULT, failureKind: kind })

/** Apollo 自报为「已验证」的邮箱状态（大小写不敏感比较）。 */
export const APOLLO_VERIFIED_EMAIL_STATUS = 'verified'

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
  /**
   * Phase 1 / R2：**人员标识**（`people/match` 契约要求）。
   * 仅凭 domain/company 的请求不满足契约 → 不发起（见函数体注释）。
   */
  person?: { email?: string; name?: string; linkedinUrl?: string; id?: string }
  /**
   * 是否请求手机揭示（默认 `false`）。
   * 标准同步端点**不支持**手机揭示（需 `webhook_url`/`poll_only`），开启会被官方
   * `400 WEBHOOK_URL_REQUIRED` 拒绝；接入异步通道前保持关闭。
   */
  revealPhone?: boolean
  /** 单次请求超时（默认 15s，与 WEBSITE_PROBE_TIMEOUT_MS 同量级）。 */
  timeoutMs?: number
}): Promise<ApolloEnrichResult> => {
  const apiKey = getUserApolloApiKey()
  if (!apiKey) {
    return fail('missing_key')
  }

  const domain = extractDomainFromUrl(payload.domain || payload.company || '') || ''
  const email = String(payload.person?.email || '').trim()
  const name = String(payload.person?.name || '').trim()
  const linkedinUrl = String(payload.person?.linkedinUrl || '').trim()
  const personId = String(payload.person?.id || '').trim()
  const hasPersonIdentifier = Boolean(email || name || linkedinUrl || personId)
  const hasTarget = Boolean(domain || payload.company || email || linkedinUrl || personId)
  if (!hasTarget) {
    return fail('no_target')
  }
  /* Phase 1 / R2（B1）：`people/match` **不是**公司范围内的「找人」接口。仅凭 company/domain
     无法满足契约 → **不发起请求**。域名 → 决策人 的已授权能力是 Prospeo `search-person`；
     公司级 Apollo 搜索属独立后续设计（不在本轮范围）。 */
  if (!hasPersonIdentifier) {
    return fail('insufficient_identifier')
  }

  const body: Record<string, unknown> = {
    api_key: apiKey,
    domain: domain || undefined,
    company: payload.company || undefined,
    reveal_personal_emails: true,
    /* Phase 1 / R2（B2）：无异步通道时恒为 false（避免 400 WEBHOOK_URL_REQUIRED 拖垮整个请求）。 */
    reveal_phone_number: Boolean(payload.revealPhone),
  }
  if (email) body.email = email
  if (name) body.name = name
  if (linkedinUrl) body.linkedin_url = linkedinUrl
  if (personId) body.id = personId

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
      return fail('http_error')
    }

    const json: any = await response.json().catch(() => ({}))
    if (json?.error) return fail('api_error')
    const person = json?.person || (Array.isArray(json?.people) ? json.people[0] : undefined) || {}

    /* Step 4：Apollo 自报的匹配置信度。`none` = 未找到匹配记录 ——
       此时响应里可能仍带占位字段，**不得当作真实联系人**。 */
    const matchConfidence = String(person?.match_confidence || '')
      .trim()
      .toLowerCase()
    const noMatch = matchConfidence === 'none'

    const email = noMatch
      ? ''
      : String(person?.email || (Array.isArray(person?.personal_emails) ? person.personal_emails[0] : '') || '').trim()
    /* Step 4（D-3）：如实回传邮箱状态；调用方据此决定是否可标 `verified`。 */
    const emailStatus = email ? String(person?.email_status || '').trim() : ''
    const bestPhone = noMatch ? null : pickBestApolloPhone(person?.phone_numbers)

    const contactName = noMatch ? '' : String(person?.name || '').trim()
    const contactTitle = noMatch ? '' : String(person?.title || '').trim()
    const contactLinkedinUrl = noMatch ? '' : String(person?.linkedin_url || '').trim()

    if (!email && !bestPhone && !contactName) {
      return fail('no_match')
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
      emailStatus: emailStatus || undefined,
      phone: bestPhone?.raw,
      phoneKind,
      phoneReachable,
      contactName: contactName || undefined,
      contactTitle: contactTitle || undefined,
      contactLinkedinUrl: contactLinkedinUrl || undefined,
      matchConfidence: matchConfidence || undefined,
      contactId: String(person?.id || '').trim() || undefined,
      matchedPersonIdentity: hasPersonIdentifier,
      used: Boolean(email || bestPhone || contactName),
      source: 'apollo',
    }
  } catch {
    /* 网络异常 / 超时 / 解析失败 → Fail-Closed。 */
    return fail('network_error')
  }
}
