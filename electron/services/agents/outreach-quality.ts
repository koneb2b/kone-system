/**
 * agents/outreach-quality.ts — S5a「策略质量」纯函数基元
 *
 * 覆盖两件事（计划文档 `KONE-V1.3-数据可信度与匹配精度-下阶段落地优化计划-2026-10-13.md` §六 P1-2）：
 *  1. **差异化首封**：把线索上**真实存在**的买家证据（官网片段 / 匹配理由 / S4b 机会分依据 /
 *     深度探测结论）整理成 `buyerEvidence`，供 LLM 开发信 prompt 引用 —— 让首封**非模板**、有据可依。
 *  2. **质量度量**：`measureEvidenceCitation` **确定性**判定「首封引用了几条证据」，
 *     产出可观测的「引用证据率」（不靠感觉，可复核）。
 *
 * 纯函数、无 Electron / 网络依赖，可独立定向单测。
 */

/** 单条买家证据最长字符数（超出截断，防整段网页文本进入 prompt）。 */
export const BUYER_EVIDENCE_MAX_LEN = 200
/** 进入 prompt 的买家证据条数上限（越多越易稀释、越易触发 LLM 复述）。 */
export const BUYER_EVIDENCE_MAX_ITEMS = 4

/** `buildBuyerEvidence` 的最小入参（与 `SearchExecuteResult` 对齐，仅取需要的字段）。 */
export type BuyerEvidenceLead = {
  snippet?: string
  matchReasons?: string[]
  salesStrategy?: string
  opportunityScore?: {
    rationale?: {
      icpFit?: string
      intent?: string
      evidence?: string
      riskPenalty?: string
    }
  }
}

const clip = (text: unknown, max = BUYER_EVIDENCE_MAX_LEN): string => {
  const value = String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!value) return ''
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/**
 * 从线索提取**买家侧证据**（按「Why-Now 信号 → ICP 契合 → 匹配理由 → 引用片段 → 深度探测结论」优先级）。
 *
 * 取舍：
 * - **只用真实存在的字段**，缺失即跳过（不臆造、不用占位符）；
 * - `rationale.riskPenalty` **刻意不取** —— 那是风险信号，不该出现在外发首封里；
 * - 去重（大小写不敏感）+ 截断 + 条数封顶，保证 prompt 稳定可控。
 */
export const buildBuyerEvidence = (lead: BuyerEvidenceLead | null | undefined): string[] => {
  if (!lead || typeof lead !== 'object') return []
  const rationale = lead.opportunityScore?.rationale || {}
  const candidates: Array<unknown> = [
    rationale.intent,
    rationale.icpFit,
    ...(Array.isArray(lead.matchReasons) ? lead.matchReasons : []),
    rationale.evidence,
    lead.snippet,
    lead.salesStrategy,
  ]

  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of candidates) {
    const item = clip(raw)
    if (!item) continue
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= BUYER_EVIDENCE_MAX_ITEMS) break
  }
  return out
}

/* ── 引用率度量 ─────────────────────────────────────────────────────────────
 *
 * 定义（确定性、可复核）：把每条证据与邮件正文各自切为「实词 token」，
 * 单条证据被判定「**已引用**」当且仅当正文覆盖了它 **≥ `CITATION_ITEM_THRESHOLD`** 的实词。
 * 「引用证据率」= 已引用条数 / 证据总条数。
 *
 * 为什么用 token 重合而非子串匹配：LLM 写的是**改写**而非逐字复制，子串匹配会系统性低估。
 * 为什么不用语义相似度：那需要 embedding / 网络，会让度量**不可复现**，违背「不靠感觉」。
 */

/** 单条证据被判定「已引用」所需的关键词覆盖率。 */
export const CITATION_ITEM_THRESHOLD = 0.34
/** 计入判定的拉丁实词最短长度（更短的几乎都是虚词/缩写噪声）。 */
export const CITATION_TOKEN_MIN_LEN = 4

/** 高频虚词（不承载证据语义，参与判定会虚高覆盖率）。 */
const CITATION_STOPWORDS = new Set([
  'this',
  'that',
  'with',
  'from',
  'your',
  'yours',
  'have',
  'has',
  'had',
  'will',
  'would',
  'could',
  'should',
  'they',
  'their',
  'them',
  'there',
  'these',
  'those',
  'which',
  'about',
  'into',
  'more',
  'than',
  'been',
  'were',
  'also',
  'such',
  'when',
  'what',
  'where',
  'while',
  'other',
  'others',
  'here',
  'over',
  'under',
  'after',
  'before',
  'between',
  'through',
  'during',
  'without',
  'within',
  'along',
  'across',
  'because',
  'however',
  'therefore',
  'including',
  'include',
  'includes',
  'based',
  'using',
  'used',
  'uses',
  'make',
  'makes',
  'made',
  'very',
  'much',
  'many',
  'some',
  'each',
  'both',
  'does',
  'doing',
  'done',
  'than',
  'then',
  'them',
])

/** 切分为引用判定用的实词 token：拉丁词取长度 ≥ 4 且非虚词；中文取 2-gram（无分词器时的确定性近似）。 */
export const tokenizeForCitation = (text: unknown): string[] => {
  const normalized = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
  const tokens: string[] = []
  for (const chunk of normalized.split(' ')) {
    if (!chunk) continue
    if (/^[0-9a-z]+$/.test(chunk)) {
      if (chunk.length >= CITATION_TOKEN_MIN_LEN && !CITATION_STOPWORDS.has(chunk)) tokens.push(chunk)
    } else if (/^[\u4e00-\u9fff]+$/.test(chunk)) {
      for (let i = 0; i + 2 <= chunk.length; i += 1) tokens.push(chunk.slice(i, i + 2))
    }
  }
  return tokens
}

export type EvidenceCitation = {
  /** 证据总条数 */
  total: number
  /** 判定为「已引用」的条数 */
  cited: number
  /** 引用证据率（cited / total，保留两位小数；无证据时为 0） */
  rate: number
  /** 被引用的证据原文（便于**可解释**展示与人工复核） */
  citedItems: string[]
}

/** 确定性度量「正文引用了几条买家证据」。无证据时返回全 0（诚实缺省，不臆造分母）。 */
export const measureEvidenceCitation = (
  body: unknown,
  evidence: readonly unknown[] | null | undefined,
): EvidenceCitation => {
  const items = (Array.isArray(evidence) ? evidence : []).map((item) => String(item ?? '').trim()).filter(Boolean)
  if (items.length === 0) return { total: 0, cited: 0, rate: 0, citedItems: [] }

  const bodyTokens = new Set(tokenizeForCitation(body))
  const citedItems = items.filter((item) => {
    const tokens = Array.from(new Set(tokenizeForCitation(item)))
    if (tokens.length === 0) return false
    const hits = tokens.filter((token) => bodyTokens.has(token)).length
    const needed = Math.max(1, Math.ceil(tokens.length * CITATION_ITEM_THRESHOLD))
    return hits >= needed
  })

  return {
    total: items.length,
    cited: citedItems.length,
    rate: Math.round((citedItems.length / items.length) * 100) / 100,
    citedItems,
  }
}
