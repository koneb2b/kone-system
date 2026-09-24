/**
 * search/constants.ts — 搜索域词表与模式常量
 *
 * O1 拆分（P2）：从 `search-service.ts` 抽出的 Scout 词表与垃圾线索模式。
 * 纯数据常量，无副作用，可独立引用。
 *
 * 注：8 个**宪法常量**（SEARCH_LLM_SCORE_LIMIT / SEARCH_TARGETED_LEAD_LIMIT /
 * MAX_SEARCH_CANDIDATES / SEARCH_CHANNEL_FETCH_LIMIT / SEARCH_LLM_CONCURRENCY /
 * SEARCH_ENRICH_CONCURRENCY / SEARCH_FANOUT_CONCURRENCY / MAX_WEBSITE_TEXT_FOR_LLM）
 * **刻意保留在 `search-service.ts`**：`scripts/verify-doc-consistency.cjs` 以该文件为
 * 代码侧读取源做宪法常量比对，保持单一代码事实源，避免为纯搬迁而改动治理脚本。
 */

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
