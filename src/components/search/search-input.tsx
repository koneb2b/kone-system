'use client'

import { Search } from 'lucide-react'

const OMNI_SEARCH_MODE_LABEL = 'AI 全渠道盲搜'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onSearch: () => void
}

export function SearchInput({ value, onChange, onSearch }: SearchInputProps) {
  return (
    <div className="flex-[2] flex flex-col gap-1.5 w-full">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-medium text-muted-foreground">智能全渠道盲搜输入框</label>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
          {OMNI_SEARCH_MODE_LABEL}
        </span>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onSearch()
            }
          }}
          placeholder="支持直接输入纯自然语言描述，例如：帮我找 50 家在德国做高性能储能电池的独立站经销商，要求有采购高管邮箱且能做批发..."
          className="w-full h-10 pl-9 pr-4 rounded-lg border border-input bg-slate-50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-primary transition-all"
        />
      </div>
      <p className="text-xs text-slate-500">
        系统会先自动解构意图、翻译并突变为高价值 B2B 英文词，再并发检索地图、网页与多源穿透数据。
      </p>
    </div>
  )
}
