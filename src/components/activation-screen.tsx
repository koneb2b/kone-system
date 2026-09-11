'use client'

import { useEffect, useState } from 'react'
import { Shield, Copy, Check, Cpu, Lock, BadgeCheck } from 'lucide-react'
import brandLogoWhiteUrl from '@/assets/kone-logo-white.png'
import brandLogoDarkUrl from '@/assets/kone-logo-transparent.png'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getLicenseInfo, submitLicense, requestTrial } from '@/lib/electron-api'
import { useLicenseStore } from '@/store/licenseStore'
import { useToast } from '@/hooks/use-toast'

type ActivationScreenProps = {
  onActivated: () => void
}

export function ActivationScreen({ onActivated }: ActivationScreenProps) {
  const [machineId, setMachineId] = useState('')
  const [licenseKey, setLicenseKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [activating, setActivating] = useState(false)
  const [requestingTrial, setRequestingTrial] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const refreshLicenseStatus = useLicenseStore((state) => state.refreshLicenseStatus)
  const { toast } = useToast()

  useEffect(() => {
    const loadInfo = async () => {
      try {
        const info = await getLicenseInfo()
        setMachineId(info.machineId || '')
      } catch {
        setMachineId('')
      }
    }
    void loadInfo()
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(machineId || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      const message = '请输入激活码'
      setErrorMessage(message)
      toast({ title: '激活失败', description: message, variant: 'destructive' })
      return
    }
    setActivating(true)
    setErrorMessage('')
    try {
      const result = await submitLicense({
        licenseKey: licenseKey.trim(),
      })
      if (result.isExpired) {
        const message = result.message || '授权已过期，请联系商务续费'
        setErrorMessage(message)
        toast({ title: '激活失败', description: message, variant: 'destructive' })
        return
      }
      if (result.tier === 'unregistered') {
        const message = result.message || '激活失败，请检查激活码是否正确'
        setErrorMessage(message)
        toast({ title: '激活失败', description: message, variant: 'destructive' })
        return
      }
      await refreshLicenseStatus(true)
      await refreshLicenseStatus(true)
      onActivated()
    } catch (error) {
      const message = error instanceof Error ? error.message : '授权验证失败，请稍后重试'
      setErrorMessage(message)
      toast({ title: '激活失败', description: message, variant: 'destructive' })
    } finally {
      setActivating(false)
    }
  }

  const handleRequestTrial = async () => {
    setRequestingTrial(true)
    setErrorMessage('')
    try {
      const result = await requestTrial()
      if (!result.success) {
        const message = result.message || '试用申请失败，该设备可能已试用过'
        setErrorMessage(message)
        toast({ title: '试用开启失败', description: message, variant: 'destructive' })
        return
      }
      onActivated()
    } catch (error) {
      const message = error instanceof Error ? error.message : '试用申请失败，请稍后重试'
      setErrorMessage(message)
      toast({ title: '试用开启失败', description: message, variant: 'destructive' })
    } finally {
      setRequestingTrial(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !activating) {
      void handleActivate()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex min-h-screen bg-background"
      style={{ userSelect: 'none' }}
      data-stage="activation-screen"
    >
      {/* ── Left Branding Panel ── */}
      <div className="relative hidden w-[42%] flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-900 via-blue-800 to-cyan-500 p-10 lg:flex">
        {/* Decorative circles */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-16 left-8 w-64 h-64 rounded-full border border-white/30" />
          <div className="absolute bottom-24 right-8 w-80 h-80 rounded-full border border-white/20" />
          <div className="absolute top-1/2 left-1/4 w-40 h-40 rounded-full border border-white/15" />
        </div>

        {/* 品牌 logo：靠上独立放置（不贴顶），与居中的标题组由面板高度自然拉开大间距 */}
        <img
          src={brandLogoWhiteUrl}
          alt="Kone 智能获客"
          className="relative z-10 mt-10 block h-9 w-auto object-contain self-start"
        />

        <div className="relative z-10 flex-1 flex flex-col justify-center gap-7">
          <h1 className="text-4xl font-bold text-white leading-tight text-balance">
            Kone AI
            <br />
            B2B 智能获客系统
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-white/85">
            面向全球企业市场的智能获客操作系统，融合 AI 线索挖掘与精细化风控能力，帮助销售团队稳定、可持续地拓展高质量
            B2B 客户。
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-3 text-sm text-white/80">
          <Shield className="size-4" />
          <span>企业级数据安全保障 &middot; 本地化部署</span>
        </div>
      </div>

      {/* ── Right Activation Form ── */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-10 overflow-y-auto">
        <div className="w-full max-w-lg flex flex-col gap-7">
          {/* Mobile logo */}
          <div className="lg:hidden">
            <img src={brandLogoDarkUrl} alt="Kone 智能获客" className="h-9 w-auto object-contain" />
          </div>

          {/* Header */}
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <Lock className="size-5 text-primary" />
              软件激活
            </h2>
            <p className="text-muted-foreground text-sm">请完成以下步骤激活您的许可证，或直接开启免费试用</p>
          </div>

          {/* ── Step 1: Machine ID ── */}
          <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center size-6 rounded-full bg-primary/10">
                <Cpu className="size-3.5 text-primary" />
              </div>
              <label className="text-sm font-semibold text-foreground">步骤 1：复制设备识别码</label>
            </div>
            <p className="text-xs text-muted-foreground">将下方设备识别码发送给您的专属顾问，用于生成激活文件</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-background rounded-lg px-4 py-2.5 font-mono text-sm text-muted-foreground select-all border border-border break-all">
                {machineId || '正在获取设备识别码...'}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 size-10"
                onClick={handleCopy}
                disabled={!machineId}
              >
                {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                <span className="sr-only">复制设备识别码</span>
              </Button>
            </div>
          </div>

          {/* ── Step 2: License Key ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center size-6 rounded-full bg-primary/10">
                <Shield className="size-3.5 text-primary" />
              </div>
              <label className="text-sm font-semibold text-foreground">步骤 2：输入激活码</label>
            </div>
            <Textarea
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="请粘贴专属顾问提供的离线授权文件或激活码"
              className="min-h-28 font-mono text-sm"
            />
          </div>

          {/* Error */}
          {errorMessage ? (
            <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-4 py-2.5">
              {errorMessage}
            </p>
          ) : null}

          {/* ── Activate Button ── */}
          <Button
            className="h-12 w-full rounded-xl bg-blue-600 text-base font-semibold text-white shadow-md transition-colors duration-200 hover:bg-blue-700"
            onClick={handleActivate}
            disabled={activating || !licenseKey.trim()}
            isLoading={activating}
          >
            {!activating ? <Shield className="size-5" /> : null}
            {activating ? '正在验证...' : '立即激活'}
          </Button>

          {/* ── Divider ── */}
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">或者</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* ── Trial Button ── */}
          <Button
            className="h-14 w-full rounded-xl bg-blue-600 text-lg font-bold text-white shadow-md transition-colors duration-200 hover:bg-blue-700"
            onClick={handleRequestTrial}
            disabled={requestingTrial || activating}
            isLoading={requestingTrial}
          >
            {!requestingTrial ? <BadgeCheck className="size-6" /> : null}
            {requestingTrial ? '正在开启试用...' : '开启 7 天免费试用'}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            如需帮助，请联系您的专属客户经理或发送邮件至 support@kone.ai
            <br />
            <span className="text-[10px] opacity-70">AI 服务密钥可在试用/激活后于「系统设置」中配置</span>
          </p>
        </div>
      </div>
    </div>
  )
}
