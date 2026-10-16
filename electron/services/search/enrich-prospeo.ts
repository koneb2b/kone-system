/**
 * enrich-prospeo.ts — Prospeo 联系人富化适配器（**Fail-Closed**，Apollo 的**低成本前置**）
 *
 * ## 解决什么（2026-10-13）
 * 用户需用**高级版 WhatsApp** 触达 → 但 WhatsApp 只能发**手机号**，而官网/Google Maps 公开的
 * 商家电话**几乎都是座机**（US 号码因 LNP 无法从号段区分）。Prospeo 直接返回
 * **已验证邮箱 + 已验证手机号**（含国家码），一次补齐「邮箱 + WhatsApp 手机」两块短板。
 *
 * ## 实测成本（2026-10-13，FREE 计划 100 credits/月）
 * | 调用 | 成本 | 实测结果 |
 * |---|---|---|
 * | `search-person`（按域名，25 人/页；30 天内同页**免费**） | **1 credit** | 6 个 dealer 域名命中 5 人 |
 * | `enrich-person`（仅邮箱，VERIFIED） | **1 credit** | `cgrasmick@golfcartservices.com` |
 * | `enrich-person`（邮箱 + **手机**，VERIFIED US mobile） | **10 credits** | `+1 717-579-2681` |
 *
 * → 邮箱比 Apollo 便宜一个数量级 ⇒ 作为**前置**：命中邮箱即**跳过 Apollo**（省成本）；
 *   手机昂贵（10 credits）⇒ 仅在「高价值 + 缺手机 + 预算剩余」时按需揭示。
 *
 * ## 宪法合规
 * 单条线索富化步骤内**串行追加**查询，**不提升并行线索数**
 * （`SEARCH_ENRICH_CONCURRENCY = 2` 约束的是并行线索数，不是单线索数据源数）→ 不触碰红线。
 * 额度由调用方传入的**专用预算计数器**守护（总量域）。
 *
 * ## Fail-Closed 契约
 * 任何异常（无密钥 / 超时 / 非 2xx / JSON 解析失败 / 无命中 / 额度不足）一律返回
 * `{ used: false }`，**绝不抛错** —— 调用方据此降级到既有官网抓取 / Apollo，绝不中断搜索。
 */

import { fetchWithTimeout } from '../proxy-service'
import { getSecret } from '../secret-manager'
import { SECRET_KEYS } from '../config-service'
import { resolveCountryCode } from '../../../src/lib/country-code'
import { classifyPhoneKind, buildWhatsAppDigits } from '../../utils/contact-validation'
import { extractDomainFromUrl } from './text-utils'

const PROSPEO_SEARCH_ENDPOINT = 'https://api.prospeo.io/search-person'
const PROSPEO_ENRICH_ENDPOINT = 'https://api.prospeo.io/enrich-person'

/**
 * 读取 Prospeo API Key（走 secret-manager 加密落盘，与 Apollo/LLM 同级）。
 * **永不抛错**：密钥存储不可用一律视为「未配置」返回 `''`（Fail-Closed 第一道关口）。
 */
export const getUserProspeoApiKey = (): string => {
  try {
    return String(getSecret(SECRET_KEYS.PROSPEO_API_KEY) || '').trim()
  } catch {
    return ''
  }
}

export interface ProspeoEnrichResult {
  /** 邮箱（`only_verified_email: true` 请求下的结果）。 */
  email?: string
  /**
   * 邮箱的**供应商自报验证状态**（原样回传，如 `VERIFIED` / `UNKNOWN` / `RISKY` / `CATCH_ALL`）。
   *
   * Step 4（2026-10-16 数据链路审计 D-4）：此前实现是「非 `INVALID` 即采信」并一律标 `verified`，
   * 与文件头注释「仅采信 `status === 'VERIFIED'`」**不一致**。
   * 现改为**如实回传状态**，由调用方按状态决定可信档 —— **不接受的状态不得冒认 `verified`**。
   */
  emailStatus?: string
  /** 揭示到的手机号（国际格式）。 */
  phone?: string
  /** 号码类型：Prospeo 揭示的手机**定义上**为 mobile。 */
  phoneKind: 'mobile' | 'landline' | 'unknown'
  /** 该号码是否可用于 WhatsApp。 */
  phoneReachable: boolean
  /* ── Step 2B（审计缺陷 D-2）：决策人身份 ────────────────────────────
     此前 `pickBestPerson` 已解析出 `fullName` / `title`，但**适配器出口未暴露**，
     导致「按域名找人」的结果只剩邮箱/手机，**决策人姓名与职位被静默丢弃**。
     现如实回传，由调用方落地到 `decisionMakers[]` / `contact` / `contactTitle`。 */
  /** 决策人姓名 */
  contactName?: string
  /** 决策人职位 */
  contactTitle?: string
  /** 决策人 LinkedIn（供应商返回时才有；缺失不臆造） */
  contactLinkedinUrl?: string
  /** 是否真正拿到可用数据。 */
  used: boolean
  source: 'prospeo'
}

const EMPTY_RESULT: ProspeoEnrichResult = {
  email: undefined,
  emailStatus: undefined,
  phone: undefined,
  phoneKind: 'unknown',
  phoneReachable: false,
  contactName: undefined,
  contactTitle: undefined,
  contactLinkedinUrl: undefined,
  used: false,
  source: 'prospeo',
}

/** Prospeo 自报为「已验证」的邮箱状态（大小写不敏感比较）。 */
export const PROSPEO_VERIFIED_EMAIL_STATUS = 'VERIFIED'

/** 决策者优先的职位关键词（对齐 B2B 采购/负责人画像）。 */
const DECISION_TITLE =
  /owner|founder|ceo|president|partner|proprietor|general\s+manager|director|head\s+of|sales|purchas|operations/i

/**
 * 从 `search-person` 结果中挑选**最佳联系人**：优先决策者职位，其次有邮箱线索者，最后取首位。
 * 按姓名去重（Prospeo 同一人可能有多条 job_key 记录）。
 */
const pickBestPerson = (
  results: Array<{ person?: Record<string, any> }>,
): { personId: string; fullName: string; title: string; linkedinUrl?: string } | null => {
  if (!Array.isArray(results) || results.length === 0) return null
  const seen = new Set<string>()
  const candidates: Array<{ personId: string; fullName: string; title: string; linkedinUrl?: string; rank: number }> =
    []
  for (const item of results) {
    const person = item?.person || {}
    const personId = String(person.person_id || '').trim()
    const fullName = String(person.full_name || '').trim()
    if (!personId || !fullName) continue
    const key = fullName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const title = String(person.current_job_title || '').trim()
    /* 邮箱状态非 NONE 者优先（说明有邮箱记录），决策者职位再加权。 */
    const hasEmailRecord = String(person?.email?.status || '').toUpperCase() !== 'NONE' && Boolean(person?.email)
    candidates.push({
      personId,
      fullName,
      title,
      /* Step 2B：LinkedIn 原样回传（供应商未返回则 undefined，不臆造） */
      linkedinUrl: person.linkedin_url ? String(person.linkedin_url).trim() : undefined,
      rank: (DECISION_TITLE.test(title) ? 2 : 0) + (hasEmailRecord ? 1 : 0),
    })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.rank - a.rank)
  const best = candidates[0]
  return { personId: best.personId, fullName: best.fullName, title: best.title, linkedinUrl: best.linkedinUrl }
}

/**
 * Prospeo 富化（Fail-Closed）。给定公司域：
 *   ① `search-person` 按域名找人（1 credit）→ 选最佳联系人；
 *   ② `enrich-person` 揭示联系方式（仅邮箱 1 credit / 含手机 10 credits）。
 * `wantMobile` 由调用方按「高价值 + 缺手机 + 预算」决定。
 */
export const enrichFromProspeo = async (payload: {
  domain?: string
  company?: string
  country?: string
  /** 是否揭示手机号（10 credits；默认 false —— 只取邮箱仅 1 credit）。 */
  wantMobile?: boolean
  timeoutMs?: number
}): Promise<ProspeoEnrichResult> => {
  const apiKey = getUserProspeoApiKey()
  if (!apiKey) return EMPTY_RESULT

  const domain = extractDomainFromUrl(payload.domain || '') || ''
  if (!domain) return EMPTY_RESULT

  const timeoutMs = payload.timeoutMs ?? 15_000
  const headers = { 'Content-Type': 'application/json', 'X-KEY': apiKey }

  try {
    /* ① 找人：按公司域名过滤（最多 500 域名/次；30 天内同页结果免费）。 */
    const searchResponse = await fetchWithTimeout(
      PROSPEO_SEARCH_ENDPOINT,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          page: 1,
          filters: { company: { websites: { include: [domain] } } },
        }),
      },
      timeoutMs,
    )
    if (!searchResponse.ok) return EMPTY_RESULT
    const searchJson: any = await searchResponse.json().catch(() => ({}))
    if (searchJson?.error) return EMPTY_RESULT
    const best = pickBestPerson(searchJson?.results || [])
    if (!best) return EMPTY_RESULT

    /* ② 揭示联系方式。`only_verified_email: true` 保证只返回已验证邮箱。 */
    const wantMobile = Boolean(payload.wantMobile)
    const enrichResponse = await fetchWithTimeout(
      PROSPEO_ENRICH_ENDPOINT,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          only_verified_email: true,
          enrich_mobile: wantMobile,
          data: { person_id: best.personId },
        }),
      },
      timeoutMs,
    )
    if (!enrichResponse.ok) return EMPTY_RESULT
    const enrichJson: any = await enrichResponse.json().catch(() => ({}))
    if (enrichJson?.error) return EMPTY_RESULT

    const person = enrichJson?.person || {}
    const emailBlock = person?.email || {}
    const emailRevealed = Boolean(emailBlock?.revealed)
    const emailStatus = String(emailBlock?.status || '').toUpperCase()
    /* Step 4（D-4）：如实回传状态，**不再自行认定「已验证」**；
       是否可标 `verified` 由调用方按 `PROSPEO_VERIFIED_EMAIL_STATUS` 判定。 */
    const email = emailRevealed && emailStatus !== 'INVALID' ? String(emailBlock?.email || '').trim() : ''

    const mobileBlock = person?.mobile || {}
    const mobileRevealed = Boolean(mobileBlock?.revealed)
    const mobileRaw = mobileRevealed
      ? String(mobileBlock?.mobile_international || mobileBlock?.mobile || '').trim()
      : ''

    const countryCode = resolveCountryCode(payload.country || mobileBlock?.mobile_country_code || '') || ''
    let phoneKind: ProspeoEnrichResult['phoneKind'] = 'unknown'
    let phoneReachable = false
    if (mobileRaw) {
      /* Prospeo 揭示的 `mobile` 是**手机号**（其字段语义即 mobile）→ 直接采信为 mobile；
         可达性再校验能否补全可拨号格式。 */
      phoneKind = 'mobile'
      phoneReachable = buildWhatsAppDigits(mobileRaw, countryCode) !== null
    }

    /* Step 2B（D-2）：**身份本身即有效产出**。
       此前只要没拿到邮箱/手机就返回 EMPTY_RESULT，把已经付费（`search-person` 1 credit）
       并已解析出的决策人姓名/职位一起丢弃。现如实回传身份。 */
    return {
      email: email || undefined,
      emailStatus: email ? emailStatus : undefined,
      phone: mobileRaw || undefined,
      phoneKind,
      phoneReachable,
      contactName: best.fullName || undefined,
      contactTitle: best.title || undefined,
      contactLinkedinUrl: best.linkedinUrl,
      used: true,
      source: 'prospeo',
    }
  } catch {
    /* 网络异常 / 超时 / 解析失败 → Fail-Closed。 */
    return EMPTY_RESULT
  }
}
