'use client'

const OMNI_COMPLIANCE_GUIDE =
  '💡 规范向导：系统已依据 [Kone AI 商业全能版合规大坝] 自动为您死锁前 50 条最高相关度黄金买家资产，正在为您执行精细化清洗与高管穿透...'
const OMNI_SEARCH_RESULT_LIMIT = 50

interface SearchProgressProps {
  isStreaming: boolean
  streamStageMessage: string
  streamStage: string
  analyzedCount: number
  streamTotal: number
  anySearchDegradeHint: boolean
}

export function SearchProgress({
  isStreaming,
  streamStageMessage,
  streamStage,
  analyzedCount,
  streamTotal,
  anySearchDegradeHint,
}: SearchProgressProps) {
  if (!isStreaming) return null

  return (
    <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-white/80 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <div className="size-2 rounded-full bg-blue-600 animate-pulse" />
          <span>{streamStageMessage || '🤖 AI 正在处理搜索任务...'}</span>
        </div>
        <div className="text-xs text-slate-500">
          {streamStage === 'scoring'
            ? `${Math.min(analyzedCount, OMNI_SEARCH_RESULT_LIMIT)} / ${Math.min(streamTotal, OMNI_SEARCH_RESULT_LIMIT)}`
            : '处理中'}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-800">
          🤖 AI 深度分析中... {Math.min(analyzedCount, OMNI_SEARCH_RESULT_LIMIT)} /{' '}
          {Math.min(streamTotal, OMNI_SEARCH_RESULT_LIMIT)}
        </div>
        <div className="text-xs text-slate-500">实时更新线索评分与风险判断</div>
      </div>
      {anySearchDegradeHint && (
        <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-700 leading-relaxed">
          💡 提示：检测到您未在前台配置 AnySearch 专用密钥，系统已为您自动无感激活【四级弹性自愈协议】，正在无头补位常规
          Google 地图/网页数据，请放心查看列表。
        </div>
      )}
      <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-700 leading-relaxed">
        {OMNI_COMPLIANCE_GUIDE}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-300"
          style={{ width: `${streamTotal > 0 ? Math.min(100, (analyzedCount / streamTotal) * 100) : 0}%` }}
        />
      </div>
    </div>
  )
}
