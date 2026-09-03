'use client'

interface LocationInputsProps {
  country: string
  city: string
  onCountryChange: (value: string) => void
  onCityChange: (value: string) => void
}

export function LocationInputs({ country, city, onCountryChange, onCityChange }: LocationInputsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5 w-full">
          <label className="text-xs font-medium text-muted-foreground">目标国家/地区</label>
          <input
            type="text"
            value={country}
            onChange={(e) => onCountryChange(e.target.value)}
            placeholder="输入国家/地区（支持全球）"
            className="w-full h-10 px-3 rounded-lg border border-input bg-slate-50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-primary transition-all"
          />
        </div>

        <div className="flex flex-col gap-1.5 w-full">
          <label className="text-xs font-medium text-muted-foreground">
            目标城市 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            placeholder="例如：Los Angeles 或 全选"
            className="w-full h-10 px-3 rounded-lg border border-input bg-slate-50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-primary transition-all"
          />
          <p className="text-slate-400 text-xs mt-1">
            💡 提示：谷歌地图依赖具体城市名。若识别受阻，系统将自动切换至全球网页搜索模式。
          </p>
        </div>
      </div>
      <p className="text-xs text-[hsl(var(--neutral-gray))]">
        提示：支持多语言输入，系统将自动匹配 Google 全球商业线索。
      </p>
    </>
  )
}
