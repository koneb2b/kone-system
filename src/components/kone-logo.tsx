import { cn } from '@/lib/utils'

export function KoneLogo({ className, variant = 'dark' }: { className?: string; variant?: 'dark' | 'light' }) {
  return (
    <div className={cn('flex items-center', className)}>
      <span className={cn('font-bold text-xl tracking-wide', variant === 'light' ? 'text-white' : 'text-foreground')}>
        Kone 智能获客
      </span>
    </div>
  )
}
