/* Agent 侧知识库注入工具（P0：让「产品资料 → 开发信/话术」真正跑通）。
 *
 * 背景：`createLlmEmailContentProvider` 的 system prompt 严格要求
 *   "Ground every claim in the company signals provided; never invent facts,
 *    certifications, or statistics."
 * 但改造前 user prompt 只给了 Company / Website / Stage —— LLM 手上**一个字的产品
 * 资料都没有**，只能写出空洞、无说服力的信。本模块负责把 user_config.knowledgeBase
 * 的相关条目挑出来注入 prompt。
 *
 * 设计取舍：
 *  1) 不套用 search/analysis.ts 的三场景枚举（direct_quote / competitor_switch /
 *     factory_strength）—— Agent 发信只有 stage 概念，没有场景概念，硬套会引入假语义。
 *     改为「线索上下文关键词」自然匹配（公司名/行业/国家/网站 + stage 定位）。
 *  2) **绝不按长度兜底填充**（这是 search 侧已确认的有害行为）。无命中就返回空，
 *     由调用方走诚实降级。
 *  3) 只读，不产生任何副作用。
 */

export type KnowledgeEntry = {
  id?: string
  title?: string
  content?: string
  tags?: string[]
  createdAt?: string
  updatedAt?: string
}

export type AgentKnowledgeSelection = {
  /** 命中的知识条目（已按相关度排序、已截断 limit） */
  entries: Array<{ title: string; content: string; tags: string[] }>
  /** 用户配置里实际存在的有效条目总数（用于区分「没配」和「配了但没命中」） */
  totalEntries: number
  /** 是否成功注入（entries.length > 0） */
  injected: boolean
  /** 诚实降级原因：none=正常注入 / empty=用户未配置 / no_match=配了但与本客户不相关 */
  reason: 'none' | 'empty' | 'no_match'
}

const MAX_ENTRY_CONTENT_CHARS = 1200

/** 从 store 读取知识库原始条目（宽松解析，字段缺失即跳过）。 */
export const readKnowledgeEntries = (store?: {
  get?: (key: string) => unknown
}): Array<{ title: string; content: string; tags: string[] }> => {
  try {
    const raw = store?.get?.('user_config') as Record<string, unknown> | undefined
    const kb = (raw?.knowledgeBase ?? {}) as { entries?: unknown }
    if (!Array.isArray(kb.entries)) return []
    return kb.entries
      .map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>
        return {
          title: String(e.title ?? '').trim(),
          content: String(e.content ?? '').trim(),
          tags: Array.isArray(e.tags) ? e.tags.map((t) => String(t ?? '').trim()).filter(Boolean) : [],
        }
      })
      .filter((entry) => entry.title || entry.content)
  } catch {
    return []
  }
}

/** 由线索 + stage 构造匹配关键词（去重、小写、过滤过短噪声词）。
 *
 * 关键词来源分三类：
 *  1) 线索自身上下文（公司/行业/国家）—— 与产品资料里提到的行业、地区对上
 *  2) stage 意图词 —— 与产品资料的主题标签对上
 *  3) 用户知识库 UI 的内置快捷标签（竞品替换/直接报价/工厂实力/公司介绍）
 *     —— 这是用户最可能直接采用的标题措辞，必须纳入，否则命中率极低
 */
const STAGE_INTENT_KEYWORDS: Record<number, string[]> = {
  0: ['优势', '卖点', '差异', '报价', '产品', '介绍', '实力', '认证', '工厂', '案例', '服务'],
  1: ['案例', '痛点', '行业', '方案', '实力', '产品'],
  2: ['案例', '客户', '成效', '认证', '实力', '工厂'],
  3: ['服务', '支持', '合作', '介绍'],
}

/* 与 knowledge-base.tsx 的 quickTags 对齐：用户最常用的资料标题措辞。
   故意在两端重复字面量——若 UI 侧增删标签，这里应同步（见守护测试）。 */
const BUILTIN_KNOWLEDGE_TAGS = ['竞品替换', '直接报价', '工厂实力', '公司介绍']

const buildMatchKeywords = (
  task: { company?: string; website?: string; industry?: string; country?: string },
  stage: number,
): string[] => {
  const raw = [
    task.company,
    task.industry,
    task.country,
    (STAGE_INTENT_KEYWORDS[stage] || STAGE_INTENT_KEYWORDS[0]).join(' '),
    BUILTIN_KNOWLEDGE_TAGS.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return Array.from(
    new Set(
      // 中文没有空格分词，按标点/空白切分即可；英文词按空白切分。
      raw
        .split(/[\s,，。；;、|/]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  )
}

/**
 * 选取与当前线索/阶段相关的知识条目。
 * **只返回真实命中的条目**；命中的条目按 命中数 → 原始顺序 稳定排序。
 */
export const selectKnowledgeForAgent = (
  task: { company?: string; website?: string; industry?: string; country?: string },
  stage: number,
  entries: Array<{ title: string; content: string; tags: string[] }>,
  limit = 3,
): AgentKnowledgeSelection => {
  const totalEntries = entries.length
  if (!totalEntries) return { entries: [], totalEntries: 0, injected: false, reason: 'empty' }

  const keywords = buildMatchKeywords(task, stage)
  const scored = entries.map((entry, index) => {
    const haystack = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase()
    const score = keywords.reduce((sum, kw) => (haystack.includes(kw) ? sum + 1 : sum), 0)
    return { entry, score, index }
  })

  const hits = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .slice(0, limit)
    .map((item) => ({
      title: item.entry.title || '(未命名资料)',
      content: item.entry.content.slice(0, MAX_ENTRY_CONTENT_CHARS),
      tags: item.entry.tags,
    }))

  if (!hits.length) return { entries: [], totalEntries, injected: false, reason: 'no_match' }
  return { entries: hits, totalEntries, injected: true, reason: 'none' }
}

/** 把选中的知识条目渲染成 prompt 片段（无命中返回空串，调用方据此走降级）。 */
export const renderKnowledgePromptBlock = (selection: AgentKnowledgeSelection): string => {
  if (!selection.injected) return ''
  return selection.entries
    .map(
      (entry, index) =>
        `${index + 1}. ${entry.title}${entry.tags.length ? ` [${entry.tags.join(', ')}]` : ''}\n${entry.content}`,
    )
    .join('\n\n')
}
