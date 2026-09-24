/**
 * search/text-utils.ts — 搜索域纯文本 / URL 工具
 *
 * O1 拆分（P1）：从 `search-service.ts` 抽出的**无副作用纯函数**。
 * 本模块不依赖 Electron、网络、配置或任何服务，可独立定向单测。
 * 仅为降低 `search-service.ts` 体积与耦合；行为与抽取前逐字一致。
 */

export const getHostFromUrl = (url: string) => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

export const normalizeLlmJsonText = (raw: string) => {
  let text = raw.replace(/\uFEFF/g, '').trim()
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    text = fencedMatch[1].trim()
  }
  text = text
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
  text = text.replace(/^json\s*/i, '').trim()
  const first = text.search(/[[{]/)
  const lastObj = text.lastIndexOf('}')
  const lastArr = text.lastIndexOf(']')
  const last = Math.max(lastObj, lastArr)
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1).trim()
  }
  return text
}

export const extractJsonObjectFromText = (raw: string) => {
  try {
    const parsed = JSON.parse(normalizeLlmJsonText(raw))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const sanitizePlainText = (value: string, maxLen = 2800) =>
  value
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex -- 剥离 C0 控制字符是本函数的唯一职责
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen)

export const normalizeWebsiteUrl = (value?: string) => {
  const website = String(value || '').trim()
  if (!website) return ''
  return /^https?:\/\//i.test(website) ? website : `https://${website}`
}

export const normalizeGeoText = (value?: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const LOCATION_TERM_ALIASES: Record<string, string[]> = {
  usa: ['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america'],
  us: ['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america'],
  uk: ['uk', 'u.k.', 'united kingdom', 'great britain', 'britain'],
  uae: ['uae', 'u.a.e.', 'united arab emirates'],
}

export const extractLocationTerms = (locationString?: string) =>
  Array.from(
    new Set(
      normalizeGeoText(locationString)
        .split(/[;,/|]/)
        .flatMap((part) => part.split(/\s+/g))
        .map((part) => part.trim())
        .filter((part) => part.length >= 2)
        .flatMap((part) => LOCATION_TERM_ALIASES[part] || [part]),
    ),
  )

export const extractDomainFromUrl = (value?: string) => {
  try {
    const normalized = normalizeWebsiteUrl(value)
    if (!normalized) return ''
    return new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

export const extractEmailsFromText = (input: string) =>
  Array.from(new Set((input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((item) => item.trim())))

export const extractPhonesFromText = (input: string) =>
  Array.from(
    new Set(
      (input.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [])
        .map((item) => item.replace(/\s+/g, ' ').trim())
        .filter((item) => item.replace(/\D/g, '').length >= 8),
    ),
  )

export const mergePromptParts = (...parts: string[]) => parts.join('')

export const mergeUniqueValues = (...collections: string[][]) =>
  Array.from(
    new Set(
      collections
        .flat()
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )

export const clampInt = (value: unknown, min: number, max: number): number => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min
}
