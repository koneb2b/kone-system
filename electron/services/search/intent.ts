/**
 * search/intent.ts — 搜索意图解析与目标语言解析
 *
 * O1 拆分（P4）：从 `search-service.ts` 抽出的意图/语言纯逻辑
 * （目标语言映射、意图国家归一、Omni 控制词剥离、意图突变提示词与解析）。
 * 除 `mutateSearchIntent`（异步 LLM 调用，属编排层，暂留 search-service）外均为纯函数。
 */

import { OMNI_CONTROL_TERMS } from './constants'
import { mergePromptParts, normalizeLlmJsonText } from './text-utils'

export type SearchIntentMutation = {
  country: string
  city: string
  pureEnglishProducts: string[]
  keywords: string[]
  countryOfficialLanguages?: string[]
  localizedProducts?: Record<string, string[]>
  localizedKeywords?: Record<string, string[]>
}

/* 邮件生成目标语言的显示标签（ISO 639-1 → 语言名），供 prompt 与前端使用 */
export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  zh: 'Chinese',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  ru: 'Russian',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  ar: 'Arabic',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  cs: 'Czech',
  el: 'Greek',
  hu: 'Hungarian',
  ro: 'Romanian',
  uk: 'Ukrainian',
  he: 'Hebrew',
  hi: 'Hindi',
}

export const COUNTRY_LANGUAGE_MAP: Record<string, string[]> = {
  germany: ['de', 'en'],
  france: ['fr', 'en'],
  italy: ['it', 'en'],
  spain: ['es', 'en'],
  netherlands: ['nl', 'en'],
  belgium: ['nl', 'fr', 'en'],
  poland: ['pl', 'en'],
  portugal: ['pt', 'en'],
  austria: ['de', 'en'],
  switzerland: ['de', 'fr', 'it', 'en'],
  uk: ['en'],
  'united kingdom': ['en'],
  usa: ['en'],
  'united states': ['en'],
  canada: ['en', 'fr'],
  australia: ['en'],
  japan: ['ja', 'en'],
  china: ['zh', 'en'],
  'south korea': ['ko', 'en'],
  brazil: ['pt', 'en'],
  mexico: ['es', 'en'],
  india: ['hi', 'en'],
  russia: ['ru', 'en'],
  turkey: ['tr', 'en'],
  vietnam: ['vi', 'en'],
  thailand: ['th', 'en'],
  indonesia: ['id', 'en'],
  malaysia: ['ms', 'en'],
  singapore: ['en', 'zh', 'ms', 'ta'],
}

/* 按国家解析邮件目标语言：优先显式 language，缺省取国家官方语言（非英文
   返回首个非 en 语言，英文国家回 en）；无法推导回退 en。 */
export const resolveEmailLanguage = (country?: string, explicitLanguage?: string): string => {
  const explicit = String(explicitLanguage || '')
    .trim()
    .toLowerCase()
  if (explicit && LANGUAGE_LABELS[explicit]) return explicit
  if (explicit) return explicit // 合法 ISO 但未在标签表，仍透传
  const langs =
    COUNTRY_LANGUAGE_MAP[
      String(country || '')
        .trim()
        .toLowerCase()
    ] || []
  const nonEnglish = langs.find((l) => l !== 'en')
  return nonEnglish || 'en'
}

export const normalizeIntentCountry = (value?: string) => {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  const lower = normalized.toLowerCase()
  if (/美国|usa|u\.s\.|united states|america/.test(lower)) return 'USA'
  if (/英国|uk|u\.k\.|united kingdom/.test(lower)) return 'UK'
  if (/德国|germany|deutschland/.test(lower)) return 'Germany'
  if (/法国|france/.test(lower)) return 'France'
  if (/意大利|italy/.test(lower)) return 'Italy'
  if (/西班牙|spain/.test(lower)) return 'Spain'
  if (/加拿大|canada/.test(lower)) return 'Canada'
  if (/澳大利亚|australia/.test(lower)) return 'Australia'
  return normalized
}

export const stripOmniControlTerms = (keyword: string) => {
  let cleaned = String(keyword || '').trim()
  for (const pattern of OMNI_CONTROL_TERMS) {
    cleaned = cleaned.replace(pattern, ' ')
  }
  return cleaned
    .replace(/[，。；：、]/g, ' ')
    .replace(/\b(email|phone|website|contact|information|info)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const B2B_ROLE_TERMS = ['dealer', 'distributor', 'importer', 'wholesaler', 'supplier', 'manufacturer']

export const fallbackMutateB2BKeywords = (keyword: string): { pureEnglishProducts: string[]; keywords: string[] } => {
  const cleaned = stripOmniControlTerms(keyword)
  const lower = cleaned.toLowerCase()
  const rawProduct = /高尔夫|golf\s*cart/.test(lower)
    ? 'Golf cart'
    : cleaned
        .replace(
          /在?美国|usa|united states|品牌|经销商|批发商|独立站|批发|dealer|distributor|wholesaler|supplier|manufacturer|importer/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase()) ||
      cleaned ||
      keyword

  const raw = rawProduct.replace(/\s+/g, ' ').trim()
  const products = raw
    .split(/[,，、/]/)
    .map((p) => p.trim())
    .filter(Boolean)
  const pureEnglishProducts = products.length > 0 ? products : [raw]
  return {
    pureEnglishProducts,
    keywords: Array.from(new Set(pureEnglishProducts.flatMap((p) => B2B_ROLE_TERMS.map((role) => `${p} ${role}`))))
      .filter(Boolean)
      .slice(0, 4),
  }
}

export const crossProductB2BKeywords = (products: string[], country: string): string[] =>
  Array.from(
    new Set(
      products.flatMap((product) =>
        B2B_ROLE_TERMS.slice(0, 4).map((role) => (country ? `${product} ${role} ${country}` : `${product} ${role}`)),
      ),
    ),
  )
    .filter(Boolean)
    .slice(0, 4)

/* 产品词清洗（2026-10-11，宪法 `SEARCH_PRODUCT_TERM_LIMIT` 的前置守卫）：
 * LLM 偶尔会回吐**不可检索**的条目 —— 含控制词（请搜索/帮我找/要求…）、
 * 中文原文、或超长自然语言。这类词打给上游只会返回垃圾结果，**纯浪费配额**。
 * 实测曾把整句中文（"请深度 在德国做电动叉车 … dealer"）当作关键词派发。
 *
 * 只保留"可检索的英文商品词"：无中文、无控制词、长度合理。 */
export const sanitizeProductTerms = (products: string[]): string[] => {
  const cleaned = products
    .map((term) =>
      String(term || '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((term) => {
      if (!term || term.length > 40) return false
      if (/[\u4e00-\u9fa5]/.test(term)) return false // 含中文 → 非英文商品词
      return !OMNI_CONTROL_TERMS.some((re) => new RegExp(re.source, re.flags.replace('g', '')).test(term))
    })
  return Array.from(new Set(cleaned))
}

export const buildIntentMutationPrompt = (payload: { keyword: string; country: string; city: string }) => ({
  system: mergePromptParts(
    'You are an intent parser for a B2B lead search engine. ',
    'Never pass the raw user sentence downstream. ',
    'Remove control words such as search, find, 50 leads, must include email, phone, website. ',
    'Extract ALL discrete CORE PRODUCT terms and TARGET LOCATION from the user input. ',
    'Split compound or multi-product input into separate product entries. ',
    'Return pureEnglishProducts as an ARRAY of individual product terms, never concatenated. ',
    'Then cross-multiply each core product with exactly 3 B2B role suffixes from: dealer, distributor, importer, wholesaler, supplier, manufacturer. ',
    'Optionally append location as a qualifier for natural keyword phrasing. ',
    'If a country is specified, detect its official language(s). For each official language (other than English), translate pureEnglishProducts into that language and generate localized B2B keywords. Use distributor/dealer/importer/wholesaler equivalents in the local language. ',
    'Return ONLY valid JSON with the following structure: {"country":"USA","city":"","pureEnglishProducts":["Golf cart","car monitor"],"b2bAttributes":["wholesaler","distributor","importer","dealer"],"keywords":["Golf cart dealer","Golf cart distributor","car monitor wholesaler","car monitor importer"],"countryOfficialLanguages":["en"],"localizedProducts":{"es":["carro de golf","monitor de coche"]},"localizedKeywords":{"es":["carro de golf distribuidor","carro de golf importador","monitor de coche mayorista"]}}. ',
    'countryOfficialLanguages must be an array of ISO language codes (en, fr, de, es, it, ja, zh, etc). ',
    'localizedProducts maps each non-English language code to translated product term arrays. ',
    'localizedKeywords maps each non-English language code to translated B2B keyword arrays. ',
    'If country is empty or English-only, set countryOfficialLanguages to ["en"] and omit localizedProducts/localizedKeywords. ',
    'Never use raw user control words like "50条", "必须包含邮箱", "search", "find", "帮我找" in keywords. ',
    'pureEnglishProducts must always be an array, never a single string. ',
    'localizedProducts and localizedKeywords must also be arrays, never single strings.',
  ),
  user: JSON.stringify(payload),
})

export const parseIntentMutation = (raw: string): Partial<SearchIntentMutation> | null => {
  try {
    const parsed = JSON.parse(normalizeLlmJsonText(raw))
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}
