/**
 * 共享错误文案工具（P1-8：消除重复实现）。
 *
 * 背景：`formatErrorMessage` 曾在 5 个组件中各实现一份，其中 3 份逻辑近似但正则
 * 略有差异（`leads-table` 多匹配 `webhook`），属典型重复实现漂移风险。
 * 此处统一为**超集版本**（含 `webhook`），语义与原先三份一致。
 *
 * 注意：`search-engine` 与 `analysis-drawer` 各自保留**领域专用**文案
 * （前者是搜索场景固定提示语，后者需先解析 `ElectronApiError` 语义元数据），
 * 不属于本工具的适用范围。
 */

/** 分类前缀版错误文案：保留原始 message，便于用户与顾问定位。 */
export const formatErrorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : fallback
  const normalized = message.toLowerCase()
  if (/403|401|授权|license|无权/.test(normalized)) return `授权异常：${message}`
  if (/network|timeout|fetch|socket|econn|enet/.test(normalized)) return `网络异常：${message}`
  if (/write|file|export|downloads|path/.test(normalized)) return `文件写入异常：${message}`
  if (/config|missing|base url|key|webhook/.test(normalized)) return `配置异常：${message}`
  return `系统异常：${message}`
}

/**
 * 搜索场景专用错误文案（固定提示语，不透出原始 message）。
 * 原先在 `search-engine.tsx` 与 `hooks/use-search-engine.ts` 中逐字节重复两份。
 */
export const formatSearchErrorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : fallback
  const normalized = message.toLowerCase()
  if (/trial_expired|试用已结束/.test(normalized)) return '当前授权已失效，请先完成激活后继续使用。'
  if (/403|401|授权|license|无权/.test(normalized)) return '当前授权状态异常，请联系顾问协助处理。'
  if (/network|timeout|fetch|socket|econn|enet|数据流/.test(normalized)) return 'AI 数据流连接异常，请稍后重试。'
  if (/config|base url|key|配置/.test(normalized)) return '当前配置未完成，暂时无法执行智能搜索。'
  return '当前搜索服务暂不可用，请稍后重试或联系顾问。'
}

/** RFC 4180 CSV 字段转义。 */
export const escapeCsvValue = (value: string | number | boolean | undefined | null): string => {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}
