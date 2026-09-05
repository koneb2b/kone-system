import { cn } from '@/lib/utils'
import iconLight from '@/logo.png'
import logoDark from '@/assets/kone-logo.png'

/* 品牌 Logo 图片组件。
   - variant="light"：用于深色背景（登录页左侧深蓝渐变面板）——白色方形图标
   - variant="dark" ：用于浅色背景（移动端顶部）——深色横版完整 logo */
export function KoneLogo({ className, variant = 'dark' }: { className?: string; variant?: 'dark' | 'light' }) {
  if (variant === 'light') {
    return <img src={iconLight} alt="Kone 智能获客" className={cn('h-12 w-12 object-contain', className)} />
  }
  return <img src={logoDark} alt="Kone 智能获客" className={cn('h-10 w-auto object-contain', className)} />
}
