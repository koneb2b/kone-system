"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDownAZ, BookOpen, Plus, Save, Search, Tag, Trash2 } from "lucide-react"
import { stableHash } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { getUserConfig, updateUserConfig } from "@/lib/user-config"

type KnowledgeEntry = {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt?: string
  updatedAt?: string
}

type KnowledgeBaseConfig = {
  knowledgeBase?: {
    entries?: KnowledgeEntry[]
    updatedAt?: string
  }
}

const quickTags = ["竞品替换", "直接报价", "工厂实力", "公司介绍"]

const createEmptyEntry = (): KnowledgeEntry => ({
  id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  title: "",
  content: "",
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

export function KnowledgeBase() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest")
  const { toast } = useToast()

  useEffect(() => {
    const loadKnowledgeBase = async () => {
      try {
        const config = await getUserConfig<KnowledgeBaseConfig>()
        setEntries(Array.isArray(config.knowledgeBase?.entries) ? config.knowledgeBase.entries : [createEmptyEntry()])
      } catch (error) {
        toast({ title: "错误", description: error instanceof Error ? error.message : "知识库加载失败，请稍后重试", variant: "destructive" })
        setEntries([createEmptyEntry()])
      } finally {
        setHydrated(true)
      }
    }

    void loadKnowledgeBase()
  }, [])

  const completedCount = useMemo(() => entries.filter((entry) => entry.title.trim() && entry.content.trim()).length, [entries])
  const visibleEntries = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    const filtered = keyword
      ? entries.filter((entry) => [entry.title, entry.content, entry.tags.join(" ")].join(" ").toLowerCase().includes(keyword))
      : entries

    return [...filtered].sort((a, b) => {
      const left = Date.parse(a.createdAt || "") || 0
      const right = Date.parse(b.createdAt || "") || 0
      return sortOrder === "newest" ? right - left : left - right
    })
  }, [entries, searchQuery, sortOrder])

  const updateEntry = (id: string, patch: Partial<KnowledgeEntry>) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id
          ? { ...entry, ...patch, updatedAt: new Date().toISOString() }
          : entry
      )
    )
  }

  const addEntry = () => {
    setEntries((current) => [...current, createEmptyEntry()])
  }

  const removeEntry = (id: string) => {
    setEntries((current) => {
      const next = current.filter((entry) => entry.id !== id)
      return next.length > 0 ? next : [createEmptyEntry()]
    })
  }

  const handleTagsChange = (id: string, raw: string) => {
    updateEntry(id, {
      tags: raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    })
  }

  const handleAppendQuickTag = (id: string, quickTag: string) => {
    setEntries((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry
        if (entry.tags.includes(quickTag)) return entry
        return {
          ...entry,
          tags: [...entry.tags, quickTag],
          updatedAt: new Date().toISOString(),
        }
      })
    )
  }

  const handleSave = async () => {
    try {
      setIsSaving(true)
      const normalized = entries
        .map((entry) => ({
          id: entry.id,
          title: entry.title.trim(),
          content: entry.content.trim(),
          tags: entry.tags.map((tag) => tag.trim()).filter(Boolean),
          createdAt: entry.createdAt || new Date().toISOString(),
          updatedAt: entry.updatedAt || new Date().toISOString(),
        }))
        .filter((entry) => entry.title || entry.content)

      await updateUserConfig<KnowledgeBaseConfig>((current) => ({
        ...current,
        knowledgeBase: {
          ...current.knowledgeBase,
          entries: normalized,
          updatedAt: new Date().toISOString(),
        },
      }))

      toast({ title: "知识库已保存", description: "知识条目已写入配置中心，AI 分析会直接引用。", variant: "default", className: "bg-emerald-50 border-emerald-200 text-emerald-800" })
    } catch (error) {
      toast({ title: "保存失败", description: error instanceof Error ? error.message : "请稍后重试", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  if (!hydrated) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500 shadow-sm">正在加载知识库...</div>
  }

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><BookOpen className="size-5 text-blue-600" /><h2 className="text-lg font-semibold text-slate-900">企业知识库</h2></div>
            <p className="mt-2 text-sm text-slate-500">把卖点、客户画像、销售话术拆成可管理的知识条目，AI 会按条注入分析链路。</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-xs">有效条目 {completedCount}/{entries.length}</Badge>
            <Button variant="outline" onClick={addEntry} className="gap-2"><Plus className="size-4" />新增条目</Button>
            <Button onClick={() => void handleSave()} disabled={isSaving} isLoading={isSaving} className="gap-2 bg-blue-600 text-white hover:bg-blue-700">{!isSaving ? <Save className="size-4" /> : null}{isSaving ? "保存中" : "保存知识库"}</Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 md:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="按标题、内容或标签搜索知识条目..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setSortOrder((current) => (current === "newest" ? "oldest" : "newest"))}>
            <ArrowDownAZ className="size-4" />
            {sortOrder === "newest" ? "按创建时间倒序" : "按创建时间正序"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {visibleEntries.map((entry, index) => (
          <div key={stableHash(`${entry.id}-${index}`)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 grid gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-800">标题</label>
                  <input value={entry.title} onChange={(e) => updateEntry(entry.id, { title: e.target.value })} placeholder="例如：循环寿命优势" className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/20" />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-800">内容</label>
                  <textarea value={entry.content} onChange={(e) => updateEntry(entry.id, { content: e.target.value })} placeholder="填写该条知识的具体内容，AI 会直接引用。" className="min-h-[140px] w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-500/20" />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium text-slate-800">标签</label>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <Tag className="size-4 text-slate-400" />
                    <input value={entry.tags.join(", ")} onChange={(e) => handleTagsChange(entry.id, e.target.value)} placeholder="例如：产品卖点, 话术, ICP" className="w-full bg-transparent text-sm text-slate-700 outline-none" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {quickTags.map((tag) => (
                      <Button key={tag} type="button" variant="outline" size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => handleAppendQuickTag(entry.id, tag)}>
                        + {tag}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">{entry.tags.map((tag, tagIndex) => <Badge key={stableHash(`${tag}-${tagIndex}`)} variant="secondary" className="text-xs">{tag}</Badge>)}</div>
                </div>
                <div className="text-[11px] text-slate-400">创建时间：{entry.createdAt ? new Date(entry.createdAt).toLocaleString("zh-CN") : "-"}</div>
              </div>
              <Button variant="ghost" size="sm" className="text-slate-400 hover:bg-red-50 hover:text-red-500" onClick={() => removeEntry(entry.id)}><Trash2 className="size-4" /></Button>
            </div>
          </div>
        ))}

        {visibleEntries.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">未找到匹配的知识条目，请调整搜索关键词。</div> : null}
      </div>
    </div>
  )
}
