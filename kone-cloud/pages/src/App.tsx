import { useEffect, useMemo, useState } from 'react'
import { AuthPanel, type Credentials } from './components/AuthPanel'
import { Dashboard } from './components/Dashboard'
import { isConfigured } from './lib/api'

const STORAGE_KEY = 'kone-cloud-creds'

const loadCreds = (): Credentials | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isConfigured(parsed) ? parsed : null
  } catch {
    return null
  }
}

const saveCreds = (creds: Credentials) => localStorage.setItem(STORAGE_KEY, JSON.stringify(creds))
const clearCreds = () => localStorage.removeItem(STORAGE_KEY)

const App = () => {
  const [creds, setCreds] = useState<Credentials | null>(loadCreds)
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
    localStorage.setItem('kone-theme', theme)
  }, [theme])

  const handleAuth = (next: Credentials) => {
    saveCreds(next)
    setCreds(next)
  }

  const handleDisconnect = () => {
    clearCreds()
    setCreds(null)
  }

  const themeToggle = useMemo(() => ({
    onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    title: theme === 'dark' ? '切换到亮色' : '切换到暗色',
    children: theme === 'dark' ? '☀️' : '🌙',
  }), [theme])

  if (!creds) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <AuthPanel onSubmit={handleAuth} themeToggle={themeToggle} />
      </div>
    )
  }

  return (
    <Dashboard
      creds={creds}
      onDisconnect={handleDisconnect}
      themeToggle={themeToggle}
    />
  )
}

export default App
