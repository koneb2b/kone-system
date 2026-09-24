/**
 * search/probe.ts — 搜索域调试探针（日志）
 *
 * O1 拆分（P6）：从 `search-service.ts` 抽出的轻量日志探针。
 * 生产环境静默（`isProductionRuntime`），仅开发期输出结构化探针。
 */

export const isProductionRuntime = () => process.env.NODE_ENV === 'production'

export const probeLog = (tag: string, ...args: unknown[]) => {
  if (isProductionRuntime()) return
  console.log(tag, ...args)
}

export const probeError = (tag: string, ...args: unknown[]) => {
  console.error(tag, ...args)
}

export const probeLlmRequest = (llmBaseUrl?: string) => {
  probeLog('[Probe-LLM] 请求发起, URL:', llmBaseUrl || 'N/A')
}

export const probeLlmCrash = (error: unknown) => {
  probeError('[Probe-LLM] 请求崩溃:', error)
}

export const verifyLlmProbeFailure = async (llmBaseUrl?: string) => {
  probeLlmRequest(llmBaseUrl)
  try {
    throw new Error('VERIFY_LLM_PROBE_FAILURE')
  } catch (error) {
    probeLlmCrash(error)
    throw error
  }
}
