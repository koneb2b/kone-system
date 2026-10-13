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
/* 单次搜索的**总时长硬上限**（涵盖所有阶段：意图变异 → 扇出搜索 → 评分 → 官网富化）。
 *
 * 各阶段虽有独立超时，但**串行累加**后可远超用户可接受范围：
 * `search-service.ts` 原注释已自承「50 条 × 并发 2 × LLM 20s ≈ 25 分钟以上」。
 * 实测（2026-10-11）LLM 上游 503 熔断后，搜索**永久卡住**：
 * 日志停止输出 5 分钟以上、前端一直「搜索中」、**无取消入口**，
 * 用户唯一出路是重启应用。
 *
 * 超过本上限即**停止推进剩余线索**，用已得结果完成本轮并如实告知用户，
 * 把「可能永久等待」变成「最多等 5 分钟」—— 这是商用交付的底线要求。 */
export const SEARCH_TOTAL_TIMEOUT_MS = 5 * 60 * 1000

/* ── 2026-10-11 新增：搜索**总量**域上限（防额度烧光） ──────────────────
 * 此前宪法只约束了**并发**（防打爆上游），未约束**总量**（防烧光用户额度）。
 * 实测单次搜索派发 17 个关键词变体 → SerpApi 53 次调用 →
 * SerpApi 免费额度（100 次/月）**2 次搜索即耗尽**。
 *
 * 权威值见 `kone-PRD.md §零.3`。与并发域（扇出 3 / 评分 2）是**不同维度**，不得混读。 */
export const SEARCH_PRODUCT_TERM_LIMIT = 2
/* 2026-10-11 校准：用户明确「不能为省配额牺牲搜索数量与覆盖深度」。
 * 原定 8 偏紧（2 产品词 × 4 角色词即用满，本地语言变体全被砍）。
 * 放宽到 12 —— 在**保留多语言覆盖**的前提下仍设硬顶，防乘数爆炸。
 * 成本控制优先靠「产品词清洗」（剔除垃圾变体）与缓存复用，而非压低覆盖。 */
export const SEARCH_VARIANT_LIMIT = 12

/* 2026-10-11 新增：Apollo 联系人富化**总量**护栏（每轮搜索最多 N 次富化查询）。
 *
 * 与 `SEARCH_VARIANT_LIMIT` 同属「总量域」，但与搜索额度（SerpApi/LLM）无关——
 * 这是**外部付费 API（Apollo credits）**的护栏：每查一次消耗 credits。
 * 用户强调「不能烧光额度」，故默认保守；高价值线索（matchScore ≥ 60，会进入 Agent 管道）
 * 才触发富化，预算仅作硬顶兜底。
 *
 * 注意：本常量**不触碰宪法并发红线**（`SEARCH_ENRICH_CONCURRENCY=2` 约束的是
 * 「并行线索数」，不是「单条线索的数据源数」）。Apollo 查询是在单条线索的富化步骤内
 * **串行追加**一次，不提升并行度 → 合规。 */
export const ENRICH_LOOKUP_BUDGET = 20

/**
 * Prospeo 每轮搜索的**邮箱**富化预算（条数）。
 *
 * 2026-10-13 新增。Prospeo 实测成本（FREE 计划 100 credits/月）：
 *   · `search-person` 1 credit（25 人/页，30 天内同页**免费**）
 *   · `enrich-person` 仅邮箱 **1 credit**；邮箱+手机 **10 credits**
 * 即「邮箱」约 **2 credits/条**（找人 1 + 揭示 1）。Prospeo 作为 **Apollo 的前置**：
 * 命中邮箱即跳过 Apollo（Apollo 单条成本更高）→ 总体更省。
 * 默认 10 条/轮 ≈ 20 credits，对 100 credits/月 的 FREE 计划保守可承受。
 */
export const PROSPEO_EMAIL_BUDGET = 10

/**
 * Prospeo 每轮搜索的**手机号**富化预算（条数）。
 *
 * 手机揭示 **10 credits/条**（昂贵）→ 仅对「高价值 + 尚无手机号」的线索按需揭示，
 * 默认 2 条/轮 ≈ 20 credits，避免一轮烧光额度。与邮箱预算**独立计数**。
 */
export const PROSPEO_MOBILE_BUDGET = 2

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
