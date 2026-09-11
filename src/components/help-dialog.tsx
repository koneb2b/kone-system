'use client'

import { BookOpen, Globe2, KeyRound, Save, Target, Download, Cloud } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface HelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const QUICK_START_STEPS = [
  {
    icon: KeyRound,
    title: '第一步：配置 AI 密钥',
    body: '进入【系统设置 → 基础配置】，填写 LLM 与搜索提供商的 API 密钥，点击“测试连接”确认可用。未配置评分密钥时搜索仍可返回基础线索，但无法进行 ICP 智能评分。',
  },
  {
    icon: Target,
    title: '第二步：描绘 ICP 画像',
    body: '进入【系统设置 → ICP 画像】，填写目标产品、买家角色、核心优势与负向 ICP。画像越具体，AI 评分与角色推断越精准。',
  },
  {
    icon: Globe2,
    title: '第三步：发起智能搜索',
    body: '在【智能获客】页输入产品关键词、目标国家与城市后点击搜索。可按需勾选高级质量控制（优先官网、优先本土域名、只看高相关、优先 B2B 角色词）。',
  },
  {
    icon: Save,
    title: '第四步：保存与深度分析',
    body: '对高价值线索点击“一键保存”写入线索库；在【线索管理】中流转状态、生成开发信，或对已保存线索发起 AI 深度分析。',
  },
  {
    icon: Download,
    title: '第五步：导出与云端交接',
    body: '筛选后可导出 CSV 到本地。高级版用户可在【自动化序列】中完成邮箱清洗并推送云端发送队列，由 N8N 云端持续执行。',
  },
]

const FAQ_ITEMS = [
  {
    title: '搜索提示“地图定位受限 / 已补位全局网页线索”是什么意思？',
    body: '这是系统的弹性降级能力，不是故障：地图定位受限时会自动扩大识别范围；地图商户不足时会自动补位全局网页线索。全过程自动完成，无需手动重试。',
  },
  {
    title: '伴随式后台巡航有什么运行边界？',
    body: '巡航是本地后台功能：需要电脑保持开机、应用保持运行、系统不休眠且网络在线。它与高级版的云端自动化不同——云端交接完成后，即使本机关机，N8N 流程仍会继续执行。',
  },
  {
    title: '试用版与付费版的能力差异？',
    body: '试用版可体验本地搜索、ICP 评分与导出（每次搜索结果上限 10 条、搜索间隔 15 秒）。付费基础版解除上述限制并开放 AI 深度分析；云端自动化与团队协作为高级版专属能力。',
  },
  {
    title: 'AI 销售团队会自动给客户发消息吗？',
    body: '不会。AI 销售团队采用“人在回路”设计：搜索管道只把合格线索暂存到待触达列表，必须由您点击“开始触达”才会执行；WhatsApp/邮件发送前还需扫码登录或人工确认，且受每日限额约束。',
  },
  {
    title: '我的数据存在哪里？',
    body: '线索与搜索结果仅保存在本机应用中，不会自动上传。只有您主动执行“发送至云端”时，系统才会推送经过筛选与裁剪的精选线索。',
  },
]

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[82vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="size-5 text-blue-600" />
            使用指南
          </DialogTitle>
          <DialogDescription>按以下五步即可完成从配置到获客的完整闭环</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {QUICK_START_STEPS.map((step) => (
            <div key={step.title} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                <step.icon className="size-4 text-blue-600" />
                <span className="text-sm font-semibold text-slate-900">{step.title}</span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <Cloud className="size-4 text-slate-600" />
            <span className="text-sm font-semibold text-slate-900">常见问题</span>
          </div>
          <div className="mt-2 space-y-3">
            {FAQ_ITEMS.map((item) => (
              <div key={item.title}>
                <p className="text-xs font-medium text-slate-800">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] leading-5 text-slate-400">
          如需进一步帮助，请联系您的专属客户经理，或发送邮件至 support@kone.ai。
        </p>
      </DialogContent>
    </Dialog>
  )
}
