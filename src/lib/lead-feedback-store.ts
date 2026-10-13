/**
 * lead-feedback-store.ts — 用户「相关 / 不相关」反馈的渲染层读写（本地持久化，零成本）
 *
 * ## 存储位置
 * `user_config.leadFeedback`（整表读写）—— 复用既有 `config:get` / `config:set` 通道，
 * **不新增 IPC 通道**。**刻意不按域名逐键写**：配置键走点号路径解析，
 * 而域名本身含点（`acme.com`）会被误拆成嵌套层级，故整表读-改-写。
 *
 * ## 与搜索侧的关系
 * 主进程在每轮搜索的**排序/预筛前**与**最终结果**两处读取本表（`applyFeedbackAdjustment`），
 * 使「曾标不相关」的线索下一轮**不再被高分推荐**、「曾标相关」的获得小幅加分 → **越用越准**。
 */
import { configGet, configSet } from '@/lib/electron-api'
import { deriveFeedbackKey, type LeadFeedbackMap, type LeadFeedbackVerdict } from '@/shared/lead-feedback'

const FEEDBACK_CONFIG_KEY = 'user_config.leadFeedback'

/** 模块级缓存：避免结果卡片逐张重复读取配置。 */
let cache: LeadFeedbackMap | null = null
let inflight: Promise<LeadFeedbackMap> | null = null

/** 读取反馈表（带缓存）。任何异常 → 空表（**绝不阻断搜索/展示**）。 */
export const loadLeadFeedback = async (): Promise<LeadFeedbackMap> => {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const config = (await configGet<Record<string, unknown>>('user_config')) as Record<string, unknown> | undefined
      const raw = config?.leadFeedback
      cache = raw && typeof raw === 'object' ? (raw as LeadFeedbackMap) : {}
    } catch {
      cache = {}
    } finally {
      inflight = null
    }
    return cache as LeadFeedbackMap
  })()
  return inflight
}

/** 读取单条线索的反馈判定（无 → null）。 */
export const getLeadFeedbackVerdict = async (lead: {
  website?: string
  company?: string
}): Promise<LeadFeedbackVerdict | null> => {
  const map = await loadLeadFeedback()
  return map[deriveFeedbackKey(lead)]?.verdict ?? null
}

/**
 * 写入/改判某条线索的反馈（**整表读-改-写**，可逆：同 key 覆盖）。
 * 返回写入后的判定；失败返回 `null`（调用方据此提示，不静默失败）。
 */
export const setLeadFeedbackVerdict = async (
  lead: { website?: string; company?: string },
  verdict: LeadFeedbackVerdict | null,
): Promise<LeadFeedbackVerdict | null> => {
  const key = deriveFeedbackKey(lead)
  if (!key) return null
  const map = { ...(await loadLeadFeedback()) }
  if (verdict === null) {
    delete map[key]
  } else {
    map[key] = { verdict, at: Date.now() }
  }
  try {
    /* `configSet` 成功返回 data、失败**抛错**（`unwrapIpc` 语义）→ 失败走 catch 返回 null。 */
    await configSet<LeadFeedbackMap>({ key: FEEDBACK_CONFIG_KEY, value: map })
    cache = map
    return verdict
  } catch {
    return null
  }
}
