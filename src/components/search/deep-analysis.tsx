'use client'

import { Globe, TrendingUp, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { stableHash } from '@/lib/utils'

export type AnalysisResult = {
  url: string
  title: string
  description: string
  matchScore?: number | null
  industryTags: string[]
}

interface DeepAnalysisProps {
  role: string | null | undefined
  allowDeepAnalysis: boolean
  analyzingUrl: string
  isAnalyzing: boolean
  analysisResult: AnalysisResult | null
  onUrlChange: (url: string) => void
  onAnalyze: () => void
}

export function DeepAnalysis({
  role,
  allowDeepAnalysis,
  analyzingUrl,
  isAnalyzing,
  analysisResult,
  onUrlChange,
  onAnalyze,
}: DeepAnalysisProps) {
  if (role !== 'pro') return null

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      <div className="flex items-center gap-2 mb-3">
        <Globe className="size-4 text-[hsl(var(--deep-blue))]" />
        <h4 className="text-sm font-semibold text-slate-800">网页深度分析</h4>
        <span className="text-xs text-slate-500">(基于 KnowledgeBase 行业预设)</span>
      </div>

      {!allowDeepAnalysis ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          当前授权仅支持基础搜索，网页深度分析功能已锁定。
        </div>
      ) : null}

      <div className="flex gap-2">
        <input
          type="text"
          value={analyzingUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="输入目标公司官网 URL，如: solartech.de"
          className="flex-1 h-10 px-3 rounded-lg border border-slate-200 bg-[hsl(var(--background))] text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[hsl(var(--deep-blue))] transition-all"
          onKeyDown={(e) => e.key === 'Enter' && onAnalyze()}
        />
        <Button
          onClick={onAnalyze}
          disabled={isAnalyzing || !allowDeepAnalysis}
          isLoading={isAnalyzing}
          className="bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition-all font-medium"
        >
          {!isAnalyzing ? <TrendingUp className="size-4 mr-1" /> : null}
          {isAnalyzing ? '分析中...' : '深度分析'}
        </Button>
      </div>

      {analysisResult && (
        <div className="mt-4 p-4 bg-[hsl(var(--background))] rounded-xl border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-emerald-500" />
              <span className="text-sm font-semibold text-slate-800">ICP 综合评估</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-lg font-bold ${typeof analysisResult.matchScore === 'number' ? (analysisResult.matchScore >= 70 ? 'text-emerald-600' : analysisResult.matchScore >= 50 ? 'text-amber-600' : 'text-red-500') : 'text-slate-500'}`}
              >
                {typeof analysisResult.matchScore === 'number' ? `${analysisResult.matchScore}%` : '待评估'}
              </span>
              {typeof analysisResult.matchScore === 'number' ? (
                <Progress value={analysisResult.matchScore} className="w-20 h-2" />
              ) : null}
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs text-slate-500">官网标题:</span>
              <p className="text-slate-700 font-medium">{analysisResult.title}</p>
            </div>
            <div>
              <span className="text-xs text-slate-500">Meta 描述:</span>
              <p className="text-slate-600 text-xs">{analysisResult.description}</p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-slate-500">匹配行业:</span>
              <div className="flex gap-1">
                {analysisResult.industryTags.map((tag: string, idx: number) => (
                  <span
                    key={stableHash(`${tag}-${idx}`)}
                    className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-400">
        <AlertCircle className="size-3" />
        <span>该分值为 AI 基于产品、角色、商业信号等生成的综合评估，建议结合人工判断使用。</span>
      </div>
    </div>
  )
}
