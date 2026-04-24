"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Copy,
  Check,
  QrCode,
  Fingerprint,
  Headset,
} from "lucide-react"
import { useLicenseStore } from "@/store/licenseStore"
import wechatQrUrl from "@/assets/wechat-qr.png"
import { useToast } from "@/hooks/use-toast"

type ContactModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ContactModal({ open, onOpenChange }: ContactModalProps) {
  const [copied, setCopied] = useState(false)
  const machineId = useLicenseStore((s) => s.machineId)
  const { toast } = useToast()

  const handleCopyMachineId = async () => {
    try {
      await navigator.clipboard.writeText(machineId || "")
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (error) {
      setCopied(false)
      toast({ title: "错误", description: error instanceof Error ? error.message : "复制机器码失败", variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden border border-slate-200 bg-white p-0 text-slate-900 shadow-md sm:max-w-[440px]"
        showCloseButton={false}
      >
        {/* ── Header ── */}
        <div className="relative px-7 pt-7 pb-5">
          <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-slate-100 blur-3xl" />

          <DialogHeader className="relative z-10 gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-blue-600 shadow-md">
                <Headset className="size-4.5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold tracking-tight text-slate-900">
                  联系专属顾问获取授权
                </DialogTitle>
                <DialogDescription className="text-slate-500 text-xs mt-0.5">
                  扫码添加客服，快速办理续费或升级
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <button
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 z-20 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* ── QR Code Area ── */}
        <div className="px-7 pb-5">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-5">
            {/* QR placeholder — 替换为真实二维码图片即可 */}
            <div className="relative flex size-44 items-center justify-center overflow-hidden rounded-xl bg-white shadow-md">
              <img
                src={wechatQrUrl}
                alt="微信客服二维码"
                className="size-full object-contain"
                onError={(e) => {
                  // 图片不存在时显示占位
                  const target = e.currentTarget
                  target.style.display = "none"
                  target.parentElement?.querySelector("[data-placeholder]")?.removeAttribute("hidden")
                }}
              />
              <div data-placeholder hidden className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 text-slate-400 gap-2">
                <QrCode className="size-12 text-slate-300" />
                <div className="mt-3 text-[11px] text-slate-400">请替换为真实微信二维码图片</div>
              </div>
            </div>
            <p className="text-xs text-slate-500 text-center leading-relaxed max-w-[280px]">
              请使用微信扫码添加专属客服。发送您的机器码，即可办理基础版续费或获取高级版激活码。
            </p>
          </div>
        </div>

        {/* ── Machine ID ── */}
        <div className="px-7 pb-7">
          <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <Fingerprint className="size-3.5 text-blue-400" />
              设备机器码
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-700 select-all">
                {machineId || "正在获取..."}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0 border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                onClick={handleCopyMachineId}
                disabled={!machineId}
              >
                {copied ? (
                  <Check className="size-3.5 text-emerald-400" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                <span className="sr-only">复制机器码</span>
              </Button>
            </div>
            {copied && (
              <p className="text-[11px] text-emerald-400 font-medium">机器码已复制，请发送给客服顾问</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
