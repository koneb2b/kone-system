'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Check, Copy, Crown, Fingerprint, Headset, QrCode, Rocket, Shield } from 'lucide-react'
import { submitLicense } from '@/lib/electron-api'
import { useLicenseStore } from '@/store/licenseStore'
import wechatQrUrl from '@/assets/wechat-qr.png'
import { useToast } from '@/hooks/use-toast'

type UpgradeIntent = 'basic' | 'premium'

type UpgradeModalProps = {
  open: boolean
  intent?: UpgradeIntent
  onOpenChange: (open: boolean) => void
  onActivated?: () => void
}

const INTENT_COPY: Record<
  UpgradeIntent,
  {
    title: string
    subtitle: string
    description: string
    activationHint: string
    activateButtonLabel: string
    emptyKeyMessage: string
  }
> = {
  basic: {
    title: '升级 Kone 基础版',
    subtitle: '解除试用限制，打造专属外贸获客引擎',
    description: '扫码添加专属顾问 | 获取基础版授权。解锁无限次本地搜索、深度邮箱挖掘与线索全量导出，AI深度分析跟进。',
    activationHint: '粘贴专属顾问交付的基础版离线授权码后，系统将立即完成校验并解除试用限制，切换为正式商业授权。',
    activateButtonLabel: '立即解锁基础版',
    emptyKeyMessage: '请输入基础版离线授权码',
  },
  premium: {
    title: '升级 Kone 企业高级版',
    subtitle: 'B2B 私域协同 + 云端自动化序列',
    description: '扫码添加专属顾问 | 获取高级版授权。解锁云端防撞单检测、团队线索共享与多节点自动化发信引擎。',
    activationHint:
      '粘贴专属顾问交付的 Premium 离线授权码后，系统将立即完成校验并瞬间覆盖当前试用状态，解锁云端高级能力。',
    activateButtonLabel: '立即解锁高级版',
    emptyKeyMessage: '请输入高级版离线授权码',
  },
}

export function UpgradeModal({ open, intent = 'premium', onOpenChange, onActivated }: UpgradeModalProps) {
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const machineId = useLicenseStore((state) => state.machineId)
  const refreshLicenseStatus = useLicenseStore((state) => state.refreshLicenseStatus)
  const copy = INTENT_COPY[intent]
  const { toast } = useToast()

  const handleCopyMachineId = async () => {
    try {
      await navigator.clipboard.writeText(machineId || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch (error) {
      setCopied(false)
      toast({
        title: '错误',
        description: error instanceof Error ? error.message : '复制设备识别码失败',
        variant: 'destructive',
      })
    }
  }

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      const message = copy.emptyKeyMessage
      setErrorMessage(message)
      toast({ title: '激活失败', description: message, variant: 'destructive' })
      return
    }

    setActivating(true)
    setErrorMessage('')
    try {
      const result = await submitLicense({ licenseKey: licenseKey.trim() })
      if (result.isExpired) {
        const message = result.message || '授权已过期，请联系专属顾问续费'
        setErrorMessage(message)
        toast({ title: '激活失败', description: message, variant: 'destructive' })
        return
      }
      if (result.tier === 'unregistered') {
        const message = result.message || '激活码无效，请核对后重新输入'
        setErrorMessage(message)
        toast({ title: '激活失败', description: message, variant: 'destructive' })
        return
      }
      await refreshLicenseStatus(true)
      onOpenChange(false)
      onActivated?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : '验证失败，请稍后重试'
      setErrorMessage(message)
      toast({ title: '激活失败', description: message, variant: 'destructive' })
    } finally {
      setActivating(false)
    }
  }

  const handleClose = (next: boolean) => {
    if (!next) {
      setLicenseKey('')
      setErrorMessage('')
      setCopied(false)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        data-testid="upgrade-modal"
        className="gap-0 overflow-hidden border border-slate-200 bg-white p-0 text-slate-900 shadow-md sm:max-w-[920px]"
        showCloseButton={false}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr]" role="dialog" aria-label="升级激活弹窗">
          <section className="relative border-b border-slate-200 bg-slate-50 px-8 py-8 lg:border-b-0 lg:border-r">
            <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-slate-100 blur-3xl" />
            <div className="absolute -bottom-10 right-0 h-40 w-40 rounded-full bg-blue-50 blur-3xl" />

            <DialogHeader className="relative z-10 gap-3 text-left">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-blue-600 shadow-md">
                  <Crown className="size-5 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">{copy.title}</DialogTitle>
                  <DialogDescription className="mt-1 text-xs text-slate-500">{copy.subtitle}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="relative z-10 mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Headset className="size-4 text-blue-600" />
                扫码添加专属顾问
              </div>
              <p className="mt-2 min-h-[44px] text-sm leading-relaxed text-slate-500">{copy.description}</p>

              <div className="mt-5 flex flex-col items-center gap-4">
                <div className="relative flex size-48 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-md">
                  <img
                    src={wechatQrUrl}
                    alt="微信顾问二维码"
                    className="size-full object-contain"
                    onError={(e) => {
                      const target = e.currentTarget
                      target.style.display = 'none'
                      target.parentElement?.querySelector('[data-placeholder]')?.removeAttribute('hidden')
                    }}
                  />
                  <div
                    data-placeholder
                    hidden
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400"
                  >
                    <QrCode className="size-12 text-slate-300" />
                    <span className="px-3 text-center text-[11px] leading-relaxed">请替换为真实微信二维码</span>
                  </div>
                </div>

                <div className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <Fingerprint className="size-3.5 text-blue-400" />
                    设备识别码
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-700">
                      {machineId || '正在获取...'}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyMachineId}
                      disabled={!machineId}
                      className="size-9 shrink-0 border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    >
                      {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    将设备识别码发送给顾问，可快速生成与本机绑定的高级版离线授权码。
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white px-8 py-8">
            <div className="flex h-full flex-col justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Shield className="size-4 text-blue-400" />
                  离线授权激活
                </div>
                <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">已获取离线授权码？ 请在此粘贴</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{copy.activationHint}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <Textarea
                  data-testid="upgrade-license-textarea"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="已获取离线授权码？ 请在此粘贴"
                  className="min-h-44 resize-none border-slate-200 bg-white font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500/50 focus:ring-blue-500/20"
                />
                {errorMessage ? (
                  <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                    {errorMessage}
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">
                    支持粘贴完整离线授权文件或单行激活码。验证通过后将立即切换为
                    {intent === 'basic' ? '基础版' : '高级版'}。
                  </p>
                )}

                <Button
                  data-testid="btn-upgrade-unlock"
                  onClick={handleActivate}
                  disabled={activating || !licenseKey.trim()}
                  isLoading={activating}
                  className="mt-5 h-12 w-full rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-md transition-colors hover:bg-blue-700"
                >
                  {!activating ? <Rocket className="size-4.5" /> : null}
                  {activating ? `正在解锁${intent === 'basic' ? '基础版' : '高级版'}...` : copy.activateButtonLabel}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
