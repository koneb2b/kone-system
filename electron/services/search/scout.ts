/**
 * search/scout.ts — Scout 预筛与准入硬否决
 *
 * O1 拆分（P3）：从 `search-service.ts` 抽出的 Scout 阶段纯逻辑。
 * 对应 ARCH-STANDARDS §9.6（Eligibility Gate Stage 0.5 一票否决 +
 * 词边界产品词匹配）与 §5（Scout 预筛为 Brain 评分前的强制步骤）。
 * 纯函数，无 Electron/网络依赖，可独立定向单测。
 */

import type { SearchExecuteResult } from '../../../src/shared/ipc-contracts'
import { KEYWORD_STOP_TERMS, SCOUT_B2B_TERMS, SCOUT_NEGATIVE_TERMS, TRASH_LEAD_PATTERNS } from './constants'

/* P0-2 Eligibility Gate（kone-PRD §0.5.1 Stage 0.5 对齐）：
   结构化 0/1 一票否决。computeScoutRelevance 是"软"过滤（一个锚点词命中即可保留
   含负向信号的候选），本门在其后执行：命中即剔除，杜绝维修店/B2C/二手/平台卖家
   混入高分池。仅覆盖可从候选文本可靠判定的类目；制裁国与 CRM 保护期重复企业
   需要候选之外的上下文数据，暂不在此层实现（诚实边界，不虚报）。 */
export const ELIGIBILITY_HARD_VETO_RULES: Array<{ category: string; patterns: RegExp[] }> = [
  {
    category: '维修/保养服务',
    patterns: [
      /\brepair\s*(shop|service|center|centre)/i,
      /\bauto\s*repair\b/i,
      /\bbody\s*shop\b/i,
      /\bmechanic\b/i,
      /\btire\s*(shop|service)/i,
      /\boil\s*change\b/i,
      /\bcollision\s*(center|centre|repair)/i,
      /\bmaintenance\s*service/i,
      /维修服务/i,
      /汽修/i,
      /维修厂/i,
    ],
  },
  {
    category: 'B2C/零售终端',
    patterns: [
      /\bretail\s*store\b/i,
      /\bboutique\b/i,
      /\bonline\s*(store|shop)\b/i,
      /\bweb\s*shop\b/i,
      /\bwebshop\b/i,
      /\be-?commerce\s*store\b/i,
      /\bdirect\s*to\s*consumers?\b/i,
      /\bfor\s*households\s*only\b/i,
      /零售店/i,
      /专卖店/i,
      /旗舰店/i,
    ],
  },
  {
    category: '二手/翻新',
    patterns: [
      /\bused\s*(goods|equipment|cars?|machinery|parts)\b/i,
      /\brefurbished\b/i,
      /\bsecond-?hand\b/i,
      /\bsalvage\s*(yard|parts)/i,
      /\bscrap\s*(yard|metal)/i,
      /二手(设备|汽车|机械)/i,
      /翻新/i,
    ],
  },
  {
    category: '电商平台卖家',
    patterns: [
      /\b(amazon|ebay|aliexpress|shopee|wish|temu)\.(com|de|co\.uk|fr|es|it)/i,
      /\bseller\s*on\s*(amazon|ebay|aliexpress|shopee)\b/i,
      /\b(amazon|ebay)\s*(store|shop|seller)\b/i,
      /\betsy\.com\b/i,
      /电商店铺/i,
    ],
  },
  {
    category: '纯内容/资讯站',
    patterns: [
      /\b(blog|blogger)\b/i,
      /\bnews\s*(portal|website|site)\b/i,
      /\bmagazine\b/i,
      /\bpress\s*release\b/i,
      /\breview\s*site\b/i,
      /\bpinterest\.com\b/i,
      /博客/i,
      /资讯网/i,
      /门户网/i,
    ],
  },
]

/* 产品词命中判定（P0-2）：`text.includes(term)` 的子串匹配会把产品词 "car"
   误伤到 "carpet"、"card"。ASCII 词用词边界正则；本地语言变体（CJK/西里尔等）
   无 \b 语义，退回 includes。 */
export const matchesProductTerm = (text: string, term: string): boolean => {
  const normalized = String(term || '')
    .trim()
    .toLowerCase()
  if (!normalized) return false
  if (/^[\x20-\x7e]+$/.test(normalized)) {
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`).test(text)
  }
  return text.includes(normalized)
}

export const computeEligibilityVeto = (
  candidate: Partial<SearchExecuteResult> & { reason?: string },
): { blocked: boolean; category?: string } => {
  const haystack = [
    candidate.company,
    candidate.website,
    candidate.source,
    candidate.reason,
    candidate.snippet,
    candidate.address,
  ]
    .filter(Boolean)
    .join(' ')
  for (const rule of ELIGIBILITY_HARD_VETO_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return { blocked: true, category: rule.category }
    }
  }
  return { blocked: false }
}

export const isTrashLead = (candidate: Partial<SearchExecuteResult> & { reason?: string }) => {
  const haystack = [
    candidate.company,
    candidate.website,
    candidate.source,
    candidate.reason,
    candidate.snippet,
    candidate.address,
  ]
    .filter(Boolean)
    .join(' ')
  return TRASH_LEAD_PATTERNS.some((pattern) => pattern.test(haystack))
}

export const extractKeywordAnchors = (keyword: string) => {
  const normalized = String(keyword || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
  return Array.from(
    new Set(
      normalized
        .split(/\s+/g)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !KEYWORD_STOP_TERMS.has(term)),
    ),
  )
}

export const computeScoutRelevance = (
  candidate: Partial<SearchExecuteResult> & { reason?: string },
  keyword: string,
  options?: { priorityWebsite?: boolean; b2bRoleOnly?: boolean; localDomainOnly?: boolean; countryTlds?: string[] },
) => {
  const anchors = extractKeywordAnchors(keyword)
  const text =
    `${candidate.company || ''} ${candidate.reason || ''} ${candidate.snippet || ''} ${candidate.website || ''}`.toLowerCase()
  const anchorHits = anchors.filter((term) => text.includes(term))
  const b2bHits = SCOUT_B2B_TERMS.filter((term) => text.includes(term))
  const negativeHits = SCOUT_NEGATIVE_TERMS.filter((term) => text.includes(term))
  const noWebsitePenalty = Boolean(options?.priorityWebsite && !String(candidate.website || '').trim())
  const missingB2BSignalPenalty = Boolean(options?.b2bRoleOnly && b2bHits.length === 0)
  /* L1-2/N1：优先本土域名 —— 激活主进程 COUNTRY_TLD_MAP（此前为死代码，
     仅前端二次过滤生效）。未知国家（无 TLD 映射）不强制，镜像前端语义。 */
  const allowedTlds = Array.isArray(options?.countryTlds) ? options!.countryTlds! : []
  const websiteHost = String(candidate.website || '')
    .trim()
    .toLowerCase()
  const notLocalDomain = Boolean(
    options?.localDomainOnly &&
    allowedTlds.length > 0 &&
    (!websiteHost || !allowedTlds.some((tld) => websiteHost.endsWith(String(tld).toLowerCase()))),
  )
  const keep =
    !(negativeHits.length > 0 && anchorHits.length === 0 && b2bHits.length === 0) &&
    !noWebsitePenalty &&
    !missingB2BSignalPenalty &&
    !notLocalDomain

  return {
    keep,
    reason: keep
      ? ''
      : notLocalDomain
        ? '非本土域名'
        : noWebsitePenalty
          ? '缺少官网信号'
          : missingB2BSignalPenalty
            ? '缺少 B2B 信号'
            : '行业偏离',
    anchorHits,
    b2bHits,
    negativeHits,
  }
}
