/**
 * search/constants.ts — 搜索域常量（宪法常量 + 词表/模式 + 时限）
 *
 * O1 拆分：P2 从 `search-service.ts` 抽出 Scout 词表与垃圾线索模式；
 * P7b 进一步迁入**宪法常量与时限常量**（因富化模块与 search-service 共同消费，
 * 且 `verify-doc-consistency.cjs` 的宪法常量比对需单一代码事实源）。
 *
 * 8 个**宪法常量**（SEARCH_LLM_SCORE_LIMIT / SEARCH_TARGETED_LEAD_LIMIT /
 * MAX_SEARCH_CANDIDATES / SEARCH_CHANNEL_FETCH_LIMIT / SEARCH_LLM_CONCURRENCY /
 * SEARCH_ENRICH_CONCURRENCY / SEARCH_FANOUT_CONCURRENCY / MAX_WEBSITE_TEXT_FOR_LLM）
 * 自 P7b 起**以本文件为代码事实源**；`scripts/verify-doc-consistency.cjs` 已同步读取本文件。
 */

/* ── 宪法常量（kone-PRD §零.3 ↔ 代码事实源） ─────────────────── */
export const MAX_SEARCH_CANDIDATES = 200
export const SEARCH_CHANNEL_FETCH_LIMIT = 100
export const SEARCH_TARGETED_LEAD_LIMIT = 50
/* P1-1：与 SEARCH_TARGETED_LEAD_LIMIT 对齐——全部 50 条目标线索都进入 LLM 评分
   与官网富化，消除"20 真富化 / 50 展示"的非对称（假高分/精度盲区）。
   并发上限仍为 SEARCH_LLM_CONCURRENCY=2（宪法红线，调用总数不改变并发）。 */
export const SEARCH_LLM_SCORE_LIMIT = 50
export const SEARCH_LLM_CONCURRENCY = 2
export const SEARCH_ENRICH_CONCURRENCY = 2
/* P1-2：搜索扇出（关键词变体）并发上限。
   注意并发域划分：`SEARCH_LLM_CONCURRENCY` / `SEARCH_ENRICH_CONCURRENCY` 的 `2`
   是 **LLM 评分与官网富化** 的宪法红线（不得突破）；搜索扇出是**另一个独立并发域**，
   原先完全无界——关键词数 = 英文变体 ≤4 + 各本地语言 ≤4/语言，多语言扩面时可一次性
   打出十几个并发 HTTP 请求，触发上游限流或本机 socket 耗尽。此处显式设闸。 */
export const SEARCH_FANOUT_CONCURRENCY = 3
export const MAX_WEBSITE_TEXT_FOR_LLM = 3000

/* ── 时限 / 可重试集合（非宪法常量） ─────────────────────────── */
export const SERPAPI_RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504])
export const SEARCH_LLM_TIMEOUT_MS = 20_000
export const WEBSITE_PROBE_TIMEOUT_MS = 15_000

export const SCOUT_NEGATIVE_TERMS = [
  'auto repair',
  'body shop',
  'mechanic',
  'tire',
  'car wash',
  'oil change',
  'collision',
  'tow',
  'detailing',
  'smog',
]

export const SCOUT_B2B_TERMS = [
  'dealer',
  'wholesale',
  'supplier',
  'distributor',
  'manufacturer',
  'factory',
  'industrial',
  'commercial',
  'b2b',
]

export const KEYWORD_STOP_TERMS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'usa',
  'us',
  'global',
  'company',
  'companies',
])

export const OMNI_CONTROL_TERMS = [
  /请搜索/g,
  /帮我找/g,
  /帮我寻找/g,
  /搜索/g,
  /查找/g,
  /寻找/g,
  /必须包含/g,
  /包含/g,
  /客户的/g,
  /核心信息/g,
  /条/g,
  /家/g,
  /please\s*(search|find)/gi,
  /must\s*include/gi,
  /with\s*(email|phone|website)/gi,
  /\b\d+\s*(results|leads|items)?\b/gi,
]

export const TRASH_LEAD_PATTERNS = [
  /reddit\.com/i,
  /wikipedia\.org/i,
  /\.edu(?:\/|$)/i,
  /\.gov(?:\/|$)/i,
  /imf\.org/i,
  /worldbank\.org/i,
  /招生简章/i,
  /人才简章/i,
  /招聘/i,
  /白皮书/i,
  /行业白皮书/i,
  /论坛/i,
  /报告/i,
  /reddit/i,
  /forum/i,
]
