import { useState } from 'react'
import { testConnection } from '../lib/api'

export type Credentials = {
  apiUrl: string
  apiKey: string
}

type ThemeToggle = {
  onClick: () => void
  title: string
  children: string
}

export const AuthPanel = ({
  onSubmit,
  themeToggle,
}: {
  onSubmit: (creds: Credentials) => void
  themeToggle: ThemeToggle
}) => {
  const [apiUrl, setApiUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs: number } | null>(null)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!apiUrl.trim() || !apiKey.trim()) {
      setError('请填写 API URL 与 API Key')
      return
    }
    setTesting(true)
    const result = await testConnection({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim() })
    setTestResult(result)
    setTesting(false)
    if (result.ok) {
      onSubmit({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim() })
    } else {
      setError(result.message)
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kone Cloud</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">团队线索台账 · 云端控制台</p>
        </div>
        <button
          type="button"
          onClick={themeToggle.onClick}
          title={themeToggle.title}
          className="rounded-lg bg-slate-100 p-2 text-lg hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
        >
          {themeToggle.children}
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="apiUrl" className="block text-sm font-medium">
              Cloudflare Worker URL
            </label>
            <input
              id="apiUrl"
              type="url"
              placeholder="https://kone-cloud.your-account.workers.dev"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/20 dark:border-slate-700 dark:bg-slate-800"
              required
            />
          </div>

          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium">
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              placeholder="Bearer token（本地存储于浏览器 localStorage）"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/20 dark:border-slate-700 dark:bg-slate-800"
              required
            />
          </div>
        </div>

        {testResult && (
          <div
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              testResult.ok
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
            }`}
          >
            {testResult.message}（{testResult.latencyMs}ms）
          </div>
        )}

        {error && !testResult?.ok && (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={testing}
          className="mt-6 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {testing ? '测试连接中…' : '连接并进入控制台'}
        </button>

        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          凭证仅存储于当前浏览器 localStorage，不会上传至任何第三方服务器。生产部署建议配置服务端代理转发。
        </p>
      </form>
    </div>
  )
}
