/**
 * search/contact-extract.ts — 官网联系方式提取的**纯函数**（零网络、零状态、可单测）
 *
 * O1 拆分：从 `search-service.ts` 抽出联系页 URL 构造 / 抓取 UA / JSON-LD 解析。
 * 目的：提升**免费**邮箱/电话命中率，降低对付费富化（Apollo）的依赖。
 *
 * 边界：本模块**不触碰**任何宪法并发/总量常量（无网络、无状态）；
 * 抓取 UA 仅用于读取**公开展示**的联系方式，不得用于绕过登录/付费墙或伪装身份规避访问控制。
 */
import { extractEmailsFromText, extractPhonesFromText, normalizeWebsiteUrl } from './text-utils'

/**
 * 官网抓取使用的 User-Agent。
 * 原 `Kone-AI/1.0` 会被大量站点 WAF 直接 403（未知 bot UA）——实测为"官网不可达"空结果的主因之一。
 * 改用通用桌面浏览器 UA 读取公开页面。
 */
export const WEBSITE_PROBE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/**
 * 联系页候选路径（按命中价值排序）。
 * 德国 `Impressum` **法律强制**载明电话/邮箱，命中价值最高；
 * 其余为常见英文/多语言联系页。
 */
export const CONTACT_PAGE_PATHS = [
  '/contact',
  '/contact-us',
  '/about',
  '/about-us',
  '/impressum', // 德国：法律强制载明联系方式
  '/kontakt', // 德语
  '/contacto', // 西语
  '/contatti', // 意语
  '/contactez-nous', // 法语
  '/company',
  '/team',
]

/**
 * 单条线索**最多并行**抓取的联系页数量。
 * 防延迟/连接数放大：并行抓取下单条线索 wall-time 仍为一次超时上限，
 * **不改变**"富化线索并发 = SEARCH_ENRICH_CONCURRENCY = 2"这一宪法约束。
 */
export const CONTACT_PAGE_FETCH_LIMIT = 6

/** 构造联系页 URL（相对站点根解析；非法 URL 返回空数组，绝不抛错）。 */
export const buildContactPageUrls = (website: string, limit: number = CONTACT_PAGE_FETCH_LIMIT): string[] => {
  try {
    const base = new URL(normalizeWebsiteUrl(website))
    const capped = Math.max(0, Math.floor(Number(limit) || 0))
    return CONTACT_PAGE_PATHS.slice(0, capped).map((pathname) => new URL(pathname, base).toString())
  } catch {
    return []
  }
}

/** 联系页链接线索词（href 或锚文本命中即视为候选；含中/英/德/西/意/法/日）。 */
const CONTACT_LINK_HINT =
  /(contact|about|impressum|kontakt|contacto|contatti|contactez|get-?in-?touch|reach-?us|联系|关于|会社概要|お問い合わせ)/i

/** 非网页资源后缀（联系页不可能是这些）。 */
const NON_HTML_ASSET = /\.(pdf|jpe?g|png|gif|svg|webp|ico|zip|rar|mp4|mp3|css|js)$/i

/**
 * 从**首页 HTML 的 `<a>` 链接**中提取「站内联系页」候选 URL。
 *
 * 为什么比固定路径更优：公司联系页 URL 千奇百怪（`/get-in-touch`、`/company/contact-us`…），
 * 猜固定路径会漏。而首页几乎总有一条指向自己联系页的链接 —— **解析它，零 API 成本、命中真实 URL**。
 * 纯函数、零网络；仅取**同站**、非资源、去重，且受 `limit` 约束。
 */
export const extractContactLinksFromHtml = (html: string, baseUrl: string, limit = 4): string[] => {
  let base: URL
  try {
    base = new URL(normalizeWebsiteUrl(baseUrl))
  } catch {
    return []
  }
  const capped = Math.max(0, Math.floor(Number(limit) || 0))
  if (capped === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  const anchors = String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  for (const match of anchors) {
    const href = (match[1] || '').trim()
    const text = (match[2] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!href || /^(mailto:|tel:|javascript:|#|data:)/i.test(href)) continue
    if (!CONTACT_LINK_HINT.test(href) && !CONTACT_LINK_HINT.test(text)) continue
    let resolved: URL
    try {
      resolved = new URL(href, base)
    } catch {
      continue
    }
    if (resolved.hostname !== base.hostname) continue // 仅同站，避免外部链接
    if (NON_HTML_ASSET.test(resolved.pathname)) continue
    const normalized = resolved.origin + resolved.pathname.replace(/\/+$/, '')
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= capped) break
  }
  return out
}

/**
 * 从 HTML 中提取 **WhatsApp 直链号码**（`wa.me` / `api.whatsapp.com` / `web.whatsapp.com` / `whatsapp.com/send`）。
 *
 * 为什么这是最高价值的**免费**手机号来源：直链里带的号码**定义上就是 WhatsApp 账号**
 * （网站主动挂出的「一键 WhatsApp」按钮），因此**无需猜测号码类型** —— 直接可用于 WhatsApp 触达。
 * 而 Google Maps 等来源返回的商家电话绝大多数是**座机**（US 号码可携带 LNP，无法从号段区分）。
 *
 * 返回**规范化国际格式**（`+<digits>`），便于下游 `buildWhatsAppDigits` 直接构造 `wa.me` 链接。
 * 纯函数、零网络；长度 8–15 位（E.164 上限）才收，去重。
 */
export const extractWhatsAppNumbers = (html: string): string[] => {
  const source = String(html || '')
  const patterns = [
    /wa\.me\/(\+?\d[\d\s().-]{6,}\d)/gi,
    /(?:api|web)\.whatsapp\.com\/send\?[^"'#>\s]*?phone=(\+?\d[\d\s().-]{6,}\d)/gi,
    /whatsapp\.com\/send\?[^"'#>\s]*?phone=(\+?\d[\d\s().-]{6,}\d)/gi,
  ]
  const out: string[] = []
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const digits = String(match[1] || '').replace(/\D/g, '')
      if (digits.length >= 8 && digits.length <= 15) out.push(`+${digits}`)
    }
  }
  return Array.from(new Set(out))
}

/** 「手机/WhatsApp」类标记词（中/英/德/法/西）。 */
const MOBILE_LABEL_SOURCE = 'whatsapp|mobile|cell(?:ular)?|mobil|handy|手机|移动电话|便携'

/**
 * 解码 `mailto:` / `tel:` 链接值中的 URL 编码（如 `%20` → 空格）。
 *
 * 实测缺陷（2026-10-13 真实搜索）：部分站点的 `tel:` href 写成 `tel:%20615-828-7430`，
 * 直接取用会把 `%20` 残留带进电话字段 → 前端显示/拨号异常（曾实测到 `%20615-828-7430`）。
 * 纯函数；解码失败（非法百分号序列）**原样返回**，绝不抛错。
 */
export const decodeContactHrefValue = (raw: string): string => {
  const value = String(raw || '').trim()
  if (!value) return ''
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return value
  }
}

/**
 * 从**纯文本**中提取带「手机 / WhatsApp / Mobile / Cell」标记的号码（如 `Mobile: +1 555 0100`）。
 * 保守：要求标记词与号码**相邻**，避免把普通座机误判为手机。返回 `+<digits>`，去重。
 */
export const extractLabelledMobileNumbers = (text: string): string[] => {
  /* `(?<![a-z])` 防止在单词内部误匹配（如 "automobile" 含 "mobile"）。 */
  const re = new RegExp(`(?<![a-z])(?:${MOBILE_LABEL_SOURCE})\\s*[:：\\-]?\\s*(\\+?\\d[\\d\\s().-]{6,}\\d)`, 'gi')
  const out: string[] = []
  for (const match of String(text || '').matchAll(re)) {
    const digits = String(match[1] || '').replace(/\D/g, '')
    if (digits.length >= 8 && digits.length <= 15) out.push(`+${digits}`)
  }
  return Array.from(new Set(out))
}

/** JSON-LD 中承载联系方式的节点类型（只采信组织/商户/联系点，避免误采 Person/Article）。 */
const CONTACT_NODE_TYPE = /organization|localbusiness|corporation|store|company|professionalservice|contactpoint/i

const collectJsonLdContacts = (node: unknown, emails: string[], phones: string[]): void => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdContacts(item, emails, phones)
    return
  }
  const record = node as Record<string, unknown>
  const rawType = record['@type']
  const types = (Array.isArray(rawType) ? rawType : [rawType]).map((t) => String(t ?? ''))
  if (types.some((t) => CONTACT_NODE_TYPE.test(t))) {
    if (typeof record.email === 'string') emails.push(...extractEmailsFromText(record.email))
    if (typeof record.telephone === 'string') phones.push(...extractPhonesFromText(record.telephone))
  }
  // 递归 @graph / contactPoint / 嵌套组织
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectJsonLdContacts(value, emails, phones)
  }
}

/**
 * 解析页面内 `<script type="application/ld+json">` 的结构化数据，提取 `telephone` / `email`。
 * JSON-LD 命中率高、噪声低，是**免费**联系方式的重要来源。
 * 纯函数、零网络；单块解析失败静默跳过（页面常有非严格 JSON-LD）。
 */
export const parseJsonLdContacts = (html: string): { emails: string[]; phones: string[] } => {
  const emails: string[] = []
  const phones: string[] = []
  const blocks = String(html || '').matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const block of blocks) {
    const raw = (block[1] || '').trim()
    if (!raw) continue
    try {
      collectJsonLdContacts(JSON.parse(raw), emails, phones)
    } catch {
      continue
    }
  }
  return {
    emails: Array.from(new Set(emails.map((item) => item.trim()).filter(Boolean))),
    phones: Array.from(new Set(phones.map((item) => item.trim()).filter(Boolean))),
  }
}
