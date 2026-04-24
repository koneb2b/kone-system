"use client"

export function LockedScreen() {
  return (
    <div
      className="fixed inset-0 z-[9999] flex min-h-screen items-center justify-center bg-slate-950 text-white"
      data-stage="locked"
    >
      <div className="mx-6 max-w-3xl rounded-2xl border border-rose-600/30 bg-rose-950/20 px-8 py-10 shadow-md">
        <p className="text-center text-xl font-bold leading-relaxed text-rose-600 md:text-2xl">
          检测到系统时间异常被篡改。安全防线已启动，软件已锁定。请联系专属顾问。
        </p>
      </div>
    </div>
  )
}
