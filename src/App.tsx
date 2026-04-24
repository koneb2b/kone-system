import { useState, useEffect } from 'react'
import Dashboard from './pages/Dashboard'
import { ActivationScreen } from '@/components/activation-screen'
import { LockedScreen } from '@/components/locked-screen'
import { Toaster } from '@/components/ui/toaster'
import { getLicenseInfo } from '@/lib/electron-api'
import { useLicenseStore } from '@/store/licenseStore'

type AppStage = 'loading' | 'activation-screen' | 'locked' | 'dashboard'

export default function App() {
  const [stage, setStage] = useState<AppStage>('loading')
  const refreshLicenseStatus = useLicenseStore((s) => s.refreshLicenseStatus)

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const info = await getLicenseInfo()

        if (info.isDev) {
          await refreshLicenseStatus(true)
          setStage('dashboard')
          return
        }

        if (info.isLocked) {
          setStage('locked')
          return
        }

        if (info.tier === 'unregistered' || info.tier === 'expired') {
          setStage('activation-screen')
          return
        }

        await refreshLicenseStatus(true)
        setStage('dashboard')
      } catch (error) {
        console.error('Failed to initialize app:', error)
        if (import.meta.env.DEV) {
          await refreshLicenseStatus(true)
          setStage('dashboard')
          return
        }
        setStage('activation-screen')
      }
    }

    void initializeApp()
  }, [refreshLicenseStatus])

  if (stage === 'loading') {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center bg-[hsl(210_40%_98%)]">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-500 text-sm">加载中...</p>
          </div>
        </div>
        <Toaster />
      </>
    )
  }

  if (stage === 'locked') {
    return (
      <>
        <LockedScreen />
        <Toaster />
      </>
    )
  }

  if (stage === 'activation-screen') {
    return (
      <>
        <ActivationScreen onActivated={() => setStage('dashboard')} />
        <Toaster />
      </>
    )
  }

  return (
    <>
      <Dashboard />
      <Toaster />
    </>
  )
}
