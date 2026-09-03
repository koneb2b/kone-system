'use client'

import * as RechartsPrimitive from 'recharts'
import type { TooltipProps } from 'recharts'
import { cn, stableHash } from '@/lib/utils'

interface DataPoint {
  name: string
  value: number
  color?: string
  [key: string]: any
}

interface TooltipEntry {
  name: string
  value: number
  color?: string
  dataKey?: string
  payload?: any
}

type CustomTooltipProps = TooltipProps<any, any> & {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) {
    return null
  }

  return (
    <div className="bg-background border border-border/50 rounded-lg px-3 py-2 shadow-lg">
      <p className="text-sm font-medium mb-1">{label}</p>
      {payload.map((entry: TooltipEntry, index: number) => (
        <p key={stableHash(`${entry.name || 'item'}-${index}`)} className="text-xs text-muted-foreground">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  )
}

function ChartLegend({ className, payload = [] }: { className?: string; payload?: Array<DataPoint> }) {
  if (!payload?.length) {
    return null
  }

  return (
    <div className={cn('flex items-center justify-center gap-4', className)}>
      {payload.map((entry: DataPoint, index: number) => (
        <div key={stableHash(`${entry.name || 'item'}-${index}`)} className="flex items-center gap-2">
          <div className="h-3 w-3 rounded" style={{ backgroundColor: entry.color }} />
          <span className="text-sm text-muted-foreground">{entry.name}</span>
        </div>
      ))}
    </div>
  )
}

export { RechartsPrimitive as Recharts, CustomTooltip as Tooltip, ChartLegend as Legend }
