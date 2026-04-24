"use client"

import { Lock } from "lucide-react"

export function PremiumAccessBlocked({
  title,
  description,
  ctaLabel,
  onUpgrade,
}: {
  title: string
  description: string
  ctaLabel: string
  onUpgrade: () => void
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-5 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
          <Lock className="size-6" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <p className="mx-auto max-w-xl text-sm leading-6 text-slate-600">{description}</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onUpgrade}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-md"
          >
            {ctaLabel}
          </button>
          <p className="text-xs text-slate-400">升级后即可唤起私域客服入口与授权流程</p>
        </div>
      </div>
    </section>
  )
}
