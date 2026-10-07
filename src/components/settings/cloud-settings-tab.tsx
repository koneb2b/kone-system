import { useEffect, useState } from 'react'
import { Cloud, Save, Wifi, WifiOff, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cloudflareConfigured, cloudflareTestConnection, configGet, configSet } from '@/lib/electron-api'

type Provider = 'supabase' | 'cloudflare'

type CloudState = {
  provider: Provider
  cloudflareUrl: string
  cloudflareApiKey: string
  cloudflareWorkspaceId: string
  configured: boolean
}

const defaultState: CloudState = {
  provider: 'supabase',
  cloudflareUrl: '',
  cloudflareApiKey: '',
  cloudflareWorkspaceId: '',
  configured: false,
}

const CONFIG_KEYS = {
  provider: 'cloud.provider',
  url: 'cloud.cloudflareUrl',
  apiKey: 'cloud.cloudflareApiKey',
  workspaceId: 'cloud.cloudflareWorkspaceId',
}

const loadState = async (): Promise<CloudState> => {
  const [provider, url, apiKey, workspaceId, configuredRes] = await Promise.all([
    configGet<string>(CONFIG_KEYS.provider),
    configGet<string>(CONFIG_KEYS.url),
    configGet<string>(CONFIG_KEYS.apiKey),
    configGet<string>(CONFIG_KEYS.workspaceId),
    cloudflareConfigured(),
  ])
  return {
    provider: (provider as Provider) || 'supabase',
    cloudflareUrl: (url as string) || '',
    cloudflareApiKey: (apiKey as string) || '',
    cloudflareWorkspaceId: (workspaceId as string) || '',
    configured: configuredRes?.configured ?? false,
  }
}

export function CloudSettingsTab() {
  const { toast } = useToast()
  const [state, setState] = useState<CloudState>(defaultState)
  const [draft, setDraft] = useState<CloudState>(defaultState)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadState()
      .then((next) => {
        if (cancelled) return
        setState(next)
        setDraft(next)
        setLoading(false)
      })
      .catch((err) => {
        console.error('[CloudSettingsTab] load failed', err)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleProviderChange = (next: Provider) => {
    setDraft((prev) => ({ ...prev, provider: next }))
  }

  const handleFieldChange = (field: keyof CloudState, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await Promise.all([
        configSet({ key: CONFIG_KEYS.provider, value: draft.provider }),
        configSet({ key: CONFIG_KEYS.url, value: draft.cloudflareUrl.trim() }),
        configSet({ key: CONFIG_KEYS.apiKey, value: draft.cloudflareApiKey.trim() }),
        configSet({ key: CONFIG_KEYS.workspaceId, value: draft.cloudflareWorkspaceId.trim() }),
      ])
      const next = await loadState()
      setState(next)
      setDraft(next)
      toast({ title: '云端配置已保存', variant: 'default' })
    } catch (err) {
      toast({
        title: '保存失败',
        description: err instanceof Error ? err.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // 先保存再测试，确保后端读到最新配置
      await Promise.all([
        configSet({ key: CONFIG_KEYS.provider, value: draft.provider }),
        configSet({ key: CONFIG_KEYS.url, value: draft.cloudflareUrl.trim() }),
        configSet({ key: CONFIG_KEYS.apiKey, value: draft.cloudflareApiKey.trim() }),
        configSet({ key: CONFIG_KEYS.workspaceId, value: draft.cloudflareWorkspaceId.trim() }),
      ])
      const result = await cloudflareTestConnection()
      setTestResult(result)
      if (result.ok) {
        toast({ title: '连接测试成功', description: `${result.message}（${result.latencyMs}ms）` })
      } else {
        toast({ title: '连接测试失败', description: result.message, variant: 'destructive' })
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : '连接失败', latencyMs: 0 })
      toast({
        title: '连接测试失败',
        description: err instanceof Error ? err.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-slate-500">
        <Loader2 className="mr-2 size-4 animate-spin" /> 加载云端配置…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="size-4" />
            云端引擎
          </CardTitle>
          <CardDescription>
            选择云端引擎后端。Supabase 为旧版团队同步引擎（Phase 0 已停止 N8N 自动化投递）； Cloudflare 为新版 Worker +
            D1 台账引擎（Phase 1 新增）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={draft.provider} onValueChange={(v) => handleProviderChange(v as Provider)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="supabase">Supabase（旧版团队同步）</SelectItem>
              <SelectItem value="cloudflare">Cloudflare（新版 Worker + D1 台账）</SelectItem>
            </SelectContent>
          </Select>
          <div className="mt-3 flex items-center gap-2 text-xs">
            {state.configured ? (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <Wifi className="mr-1 size-3" /> 已配置
              </Badge>
            ) : (
              <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                <WifiOff className="mr-1 size-3" /> 未配置
              </Badge>
            )}
            <span className="text-slate-500">
              云端投递闭环为目标态，Phase 1 仅推送台账至 D1；本地 SMTP 仍为主发送通道。
            </span>
          </div>
        </CardContent>
      </Card>

      {draft.provider === 'cloudflare' && (
        <Card>
          <CardHeader>
            <CardTitle>Cloudflare Worker 凭证</CardTitle>
            <CardDescription>
              从 Cloudflare Dashboard 创建 Worker 后，复制 Worker URL 与 API Token。 Token 建议仅授予该 Worker 的 D1
              写入权限。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="cf-url">Worker URL</Label>
              <Input
                id="cf-url"
                type="url"
                placeholder="https://kone-cloud.your-account.workers.dev"
                value={draft.cloudflareUrl}
                onChange={(e) => handleFieldChange('cloudflareUrl', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cf-key">API Key（Bearer Token）</Label>
              <Input
                id="cf-key"
                type="password"
                placeholder="粘贴从 Cloudflare Dashboard 获取的 API Token"
                value={draft.cloudflareApiKey}
                onChange={(e) => handleFieldChange('cloudflareApiKey', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cf-workspace">Workspace ID</Label>
              <Input
                id="cf-workspace"
                type="text"
                placeholder="ws-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={draft.cloudflareWorkspaceId}
                onChange={(e) => handleFieldChange('cloudflareWorkspaceId', e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                在 Cloudflare Worker 部署后，通过控制台或初始化接口创建；同一团队共享同一 Workspace。
              </p>
            </div>

            {testResult && (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  testResult.ok
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                }`}
              >
                {testResult.message}（{testResult.latencyMs}ms）
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button onClick={handleTest} disabled={testing || !draft.cloudflareUrl || !draft.cloudflareApiKey}>
                {testing ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />}
                {testing ? '测试中…' : '测试连接'}
              </Button>
              <Button variant="outline" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saving ? '保存中' : '保存配置'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
