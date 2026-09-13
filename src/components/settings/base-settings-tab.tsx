import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, RefreshCw, XCircle, Wifi, WifiOff } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { fetchModels, providerList, secretCheck, secretSet, testConnection } from '@/lib/electron-api'
import type { ProviderStatusEntry } from '@/shared/ipc-contracts'

export interface ApiKeyConfig {
  id: string
  name: string
  icon: any
  key: string
  masked?: string
  exists?: boolean
  baseUrl: string
  status: 'connected' | 'error' | 'pending'
}

const secretKeysByProvider: Record<string, string> = {
  llm: 'secrets.llm.apiKey',
  'google-leads': 'secrets.google-leads.apiKey',
  'google-maps': 'secrets.google-maps.apiKey',
  anysearch: 'secrets.anysearch.apiKey',
}

const providerBaseUrlHints: Record<string, { placeholder: string; hint: string }> = {
  llm: {
    placeholder: '例如：https://api.openai.com/v1 或中转/私有部署地址（通常以 /v1 结尾）',
    hint: '模型服务接口地址，通常以 /v1 结尾；使用中转或私有部署请填对应地址。',
  },
  'google-leads': {
    placeholder: '例如：https://serpapi.com',
    hint: '谷歌获客引擎通过 SerpApi 账号校验，密钥即 SerpApi 的 API Key。',
  },
  'google-maps': {
    placeholder: '例如：https://serpapi.com',
    hint: '谷歌地图搜索与获客引擎共用 SerpApi 账号体系。',
  },
  anysearch: {
    placeholder: '例如：https://api.anysearch.example.com',
    hint: '以 AnySearch 服务商控制台提供的接口地址为准。',
  },
}

const providerDescriptions: Record<string, string> = {
  anysearch:
    '安全保存 AnySearch 垂直实体级 API 密钥，用于在获客时深度穿透潜客高管个人邮箱、海关提单与全球展会足迹，燃料自理支持本地持久化。',
}

type SecretState = {
  exists: boolean
  masked?: string
}

type DraftState = Record<string, { key: string; baseUrl: string }>

const normalizeBaseUrl = (value?: string) => {
  const next = value?.trim() || ''
  return next === 'dev-mock' ? '' : value || ''
}

const getEffectiveStatus = (status: 'connected' | 'error' | 'pending') => {
  if (status === 'connected' || status === 'error') return status
  return 'pending'
}

const getMaskedPlaceholder = (saved?: SecretState, api?: ApiKeyConfig) => {
  return saved?.masked || api?.masked || (saved?.exists || api?.exists ? 'sk-*******' : '请输入 API Key')
}

interface BaseSettingsTabProps {
  apiKeys: ApiKeyConfig[]
  connectionStatus: Record<string, 'connected' | 'error' | 'pending'>
  showKeys: Record<string, boolean>
  modelLoading: boolean
  modelList: string[]
  selectedModel: string
  onToggleKey: (id: string) => void
  onUpdateConfig: (id: string, patch: Partial<ApiKeyConfig>) => void
  onSelectModel: (model: string) => void
  onPersistProviderConfig: (
    id: string,
    patch: Partial<ApiKeyConfig>,
    options?: { connectionStatus?: 'connected' | 'error' | 'pending' },
  ) => Promise<void>
  onSave: () => void
  isSaving: boolean
  manualSaving: boolean
}

export function BaseSettingsTab({
  apiKeys,
  connectionStatus,
  showKeys,
  modelLoading,
  modelList,
  selectedModel,
  onToggleKey,
  onUpdateConfig,
  onSelectModel,
  onPersistProviderConfig,
  onSave,
  isSaving,
  manualSaving,
}: BaseSettingsTabProps) {
  const { toast } = useToast()
  const [drafts, setDrafts] = useState<DraftState>({})
  const [secretState, setSecretState] = useState<Record<string, SecretState>>({})
  const [localModelOptions, setLocalModelOptions] = useState<string[]>(modelList)
  const [localConnectionStatus, setLocalConnectionStatus] = useState(connectionStatus)
  const [testingById, setTestingById] = useState<Record<string, boolean>>({})
  const [fetchingModels, setFetchingModels] = useState(false)
  const [providerStatus, setProviderStatus] = useState<ProviderStatusEntry[]>([])
  const sanitizedBaseUrlIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setDrafts((prev) => {
      const next: DraftState = {}

      for (const api of apiKeys) {
        const previous = prev[api.id]
        const normalizedBaseUrl = normalizeBaseUrl(api.baseUrl)

        if (api.baseUrl === 'dev-mock' && !sanitizedBaseUrlIdsRef.current.has(api.id)) {
          sanitizedBaseUrlIdsRef.current.add(api.id)
          onUpdateConfig(api.id, { baseUrl: '' })
        }

        next[api.id] = {
          key: previous?.key ?? api.key ?? '',
          baseUrl: previous?.baseUrl ?? normalizedBaseUrl,
        }
      }

      return next
    })
  }, [apiKeys])

  useEffect(() => {
    setLocalModelOptions(modelList)
  }, [modelList])

  useEffect(() => {
    setLocalConnectionStatus(connectionStatus)
  }, [connectionStatus])

  useEffect(() => {
    let cancelled = false
    providerList()
      .then((data) => {
        if (!cancelled) setProviderStatus(data.providers)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const checkSavedSecrets = async () => {
      const entries = await Promise.all(
        apiKeys.map(async (api) => {
          const secretKey = secretKeysByProvider[api.id]

          if (!secretKey) {
            return [api.id, { exists: false, masked: '' }] as const
          }

          try {
            const result = await secretCheck(secretKey)

            return [
              api.id,
              {
                exists: Boolean(result?.exists),
                masked: result?.masked || '',
              },
            ] as const
          } catch {
            return [api.id, { exists: false, masked: '' }] as const
          }
        }),
      )

      if (!cancelled) {
        const nextSecretState = Object.fromEntries(entries)
        setSecretState(nextSecretState)
      }
    }

    void checkSavedSecrets()

    return () => {
      cancelled = true
    }
  }, [apiKeys])

  /* 状态自愈（P0 体验修复）：持久化 connectionStatus 为 error 的 provider，
     挂载时对已保存密钥做一次静默重校验。旧 error 标记可能是历史网络抖动/
     额度耗尽时期写入的，API 已恢复时自动刷新为 connected，避免设置页长期
     误显示"未联通"；仍失败则保持 error 不打扰用户。 */
  useEffect(() => {
    let cancelled = false

    const revalidateStaleErrors = async () => {
      const staleProviders = apiKeys.filter((api) => {
        const status = connectionStatus[api.id]
        const saved = secretState[api.id]
        return status === 'error' && (saved?.exists || Boolean(secretKeysByProvider[api.id]))
      })
      if (staleProviders.length === 0) return

      await Promise.all(
        staleProviders.map(async (api) => {
          try {
            await testConnection({ provider: api.id, key: '', baseUrl: api.baseUrl })
            if (!cancelled) {
              setLocalConnectionStatus((prev) => ({ ...prev, [api.id]: 'connected' }))
              onUpdateConfig(api.id, { status: 'connected' })
            }
          } catch {
            // 仍失败：保留 error 状态，等待用户手动测试连接
          }
        }),
      )
    }

    void revalidateStaleErrors()

    return () => {
      cancelled = true
    }
    // 依赖 connectionStatus/secretState：两者就绪后触发一次自愈
  }, [apiKeys, connectionStatus, secretState])

  const updateDraft = (id: string, patch: Partial<{ key: string; baseUrl: string }>) => {
    setDrafts((prev) => {
      const current = prev[id] ?? { key: '', baseUrl: '' }
      const nextValue = { ...current, ...patch }
      return { ...prev, [id]: nextValue }
    })
  }

  const handleKeyChange = (id: string, value: string) => {
    updateDraft(id, { key: value })
    onUpdateConfig(id, { key: value })
  }

  const handleBaseUrlChange = (id: string, value: string) => {
    const nextValue = normalizeBaseUrl(value)
    updateDraft(id, { baseUrl: nextValue })
    onUpdateConfig(id, { baseUrl: nextValue })
  }

  const handleSaveSecret = async (api: ApiKeyConfig) => {
    const secretKey = secretKeysByProvider[api.id]
    const value = drafts[api.id]?.key?.trim() || ''

    if (!secretKey) return
    if (!value) {
      toast({ title: '请先输入 API Key', description: '在上方密钥输入框填写后再点击保存。', variant: 'destructive' })
      return
    }

    try {
      const result = await secretSet({ key: secretKey, value })

      await onPersistProviderConfig(
        api.id,
        {
          key: '',
          baseUrl: drafts[api.id]?.baseUrl?.trim() || api.baseUrl || '',
          exists: true,
          masked: result?.masked || secretState[api.id]?.masked || '',
          status: localConnectionStatus[api.id] || api.status || 'pending',
        },
        { connectionStatus: localConnectionStatus[api.id] || api.status || 'pending' },
      )

      setSecretState((prev) => ({
        ...prev,
        [api.id]: {
          exists: Boolean(result?.exists),
          masked: result?.masked || '',
        },
      }))

      updateDraft(api.id, { key: '' })
      onUpdateConfig(api.id, {
        key: '',
        exists: true,
        masked: result?.masked || secretState[api.id]?.masked || '',
        status: localConnectionStatus[api.id] || api.status || 'pending',
      })
    } catch (error) {
      const description = error instanceof Error ? error.message : '保存密钥失败'
      toast({ title: '保存密钥失败', description, variant: 'destructive' })
    }
  }

  const handleTestConnection = async (api: ApiKeyConfig) => {
    const secretKey = secretKeysByProvider[api.id]
    const key = drafts[api.id]?.key?.trim() || ''
    const baseUrl = drafts[api.id]?.baseUrl?.trim() || ''

    if (!secretKey || !key || !baseUrl) {
      setLocalConnectionStatus((prev) => ({ ...prev, [api.id]: 'error' }))
      onUpdateConfig(api.id, { status: 'error' })
      toast({
        title: '无法开始校验',
        description: !key
          ? '请先在上方填写 API Key（或此前已保存过密钥则无需重复填写）。'
          : '请先填写 Base URL（接口地址通常以 /v1 结尾）。',
        variant: 'destructive',
      })
      return
    }

    setTestingById((prev) => ({ ...prev, [api.id]: true }))
    setLocalConnectionStatus((prev) => ({ ...prev, [api.id]: 'pending' }))

    try {
      await testConnection({ provider: api.id, key, baseUrl })

      const result = await secretSet({ key: secretKey, value: key })

      await onPersistProviderConfig(
        api.id,
        {
          key: '',
          baseUrl,
          exists: true,
          masked: result?.masked || secretState[api.id]?.masked || '',
          status: 'connected',
        },
        { connectionStatus: 'connected' },
      )

      setSecretState((prev) => ({
        ...prev,
        [api.id]: {
          exists: Boolean(result?.exists),
          masked: result?.masked || '',
        },
      }))

      setLocalConnectionStatus((prev) => ({ ...prev, [api.id]: 'connected' }))
      updateDraft(api.id, { key: '', baseUrl })
      onUpdateConfig(api.id, { key: '', baseUrl, exists: true, masked: result?.masked || '', status: 'connected' })
    } catch (error) {
      setLocalConnectionStatus((prev) => ({ ...prev, [api.id]: 'error' }))
      onUpdateConfig(api.id, { status: 'error' })
      const detail = error instanceof Error ? error.message : ''
      toast({
        title: '测试连接失败',
        description: detail ? `${api.name}：${detail}` : `校验失败：${api.name} 密钥无效或连接服务器超时，请检查网络。`,
        variant: 'destructive',
      })
    } finally {
      setTestingById((prev) => ({ ...prev, [api.id]: false }))
    }
  }

  const handleFetchModels = async (api: ApiKeyConfig) => {
    /* 密钥加密存于 secret-manager，前端 drafts.key 恒为空串（hydrateConfigs 强制
       key:''）。因此不能要求 apiKey 非空——后端 fetch-models handler 有
       getUserLlmApiKey(store) fallback 能取回已保存密钥；只有 baseUrl 必填。 */
    const apiKey = drafts[api.id]?.key?.trim() || ''
    const baseUrl = drafts[api.id]?.baseUrl?.trim() || ''

    if (!baseUrl) {
      toast({
        title: '识别模型失败',
        description: '请先填写 LLM Base URL（接口地址通常以 /v1 结尾）。',
        variant: 'destructive',
      })
      return
    }
    if (!apiKey && !secretState[api.id]?.exists) {
      toast({
        title: '识别模型失败',
        description: '请先填写 API Key 并保存，或直接输入密钥后再识别。',
        variant: 'destructive',
      })
      return
    }

    setFetchingModels(true)

    try {
      const data = await fetchModels({ apiKey, baseUrl })

      const models = Array.isArray(data?.models) ? data.models : []
      setLocalModelOptions(models)

      if (!selectedModel && models[0]) {
        onSelectModel(models[0])
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : '模型识别失败'
      toast({ title: '识别模型失败', description, variant: 'destructive' })
    } finally {
      setFetchingModels(false)
    }
  }

  const isModelBusy = modelLoading || fetchingModels

  return (
    <div className="mt-6 space-y-5">
      <div className="grid gap-4">
        {apiKeys.map((api) => {
          const draft = drafts[api.id] ?? { key: '', baseUrl: api.baseUrl ?? '' }
          const saved = secretState[api.id]
          const status = getEffectiveStatus(localConnectionStatus[api.id] ?? 'pending')

          return (
            <Card
              key={api.id}
              className="border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <CardHeader className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <api.icon className="size-4 text-primary" />
                    {api.name}
                  </CardTitle>
                  <Badge variant={status === 'connected' ? 'secondary' : 'outline'}>
                    {status === 'connected' ? '已联通' : status === 'error' ? '未联通' : '待校验'}
                  </Badge>
                </div>
                <CardDescription>
                  {providerDescriptions[api.id] || '安全保存密钥与服务地址，支持本地持久化。'}
                </CardDescription>
              </CardHeader>

              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor={`${api.id}-key`}>API Key</Label>
                  <div className="relative">
                    <Input
                      id={`${api.id}-key`}
                      type={showKeys[api.id] ? 'text' : 'password'}
                      value={draft.key}
                      placeholder={!draft.key ? getMaskedPlaceholder(saved, api) : undefined}
                      onChange={(e) => handleKeyChange(api.id, e.target.value)}
                      className="h-10 pr-10 focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onToggleKey(api.id)}
                      className="absolute right-1 top-1 text-muted-foreground"
                    >
                      {showKeys[api.id] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor={`${api.id}-base`}>Base URL</Label>
                  <Input
                    id={`${api.id}-base`}
                    value={draft.baseUrl}
                    placeholder={providerBaseUrlHints[api.id]?.placeholder}
                    onChange={(e) => handleBaseUrlChange(api.id, e.target.value)}
                    className="h-10 focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
                  />
                  {providerBaseUrlHints[api.id] ? (
                    <p className="text-xs text-slate-500">{providerBaseUrlHints[api.id].hint}</p>
                  ) : null}
                </div>

                {api.id === 'llm' ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleFetchModels(api)}
                      className="gap-2"
                      disabled={isModelBusy}
                      isLoading={isModelBusy}
                    >
                      {!isModelBusy ? <RefreshCw className="size-4" /> : null}
                      {isModelBusy ? '识别中' : '识别模型'}
                    </Button>
                    <Badge variant={selectedModel ? 'secondary' : 'outline'} className="text-xs">
                      {selectedModel ? `当前模型：${selectedModel}` : '模型未生效'}
                    </Badge>
                    <select
                      value={selectedModel}
                      onChange={(e) => onSelectModel(e.target.value)}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
                    >
                      {localModelOptions.length > 0 ? (
                        localModelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))
                      ) : (
                        <option value="">请点击识别</option>
                      )}
                    </select>
                  </div>
                ) : null}

                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    {saved?.exists ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="size-3.5 text-slate-400" />
                    )}
                    {saved?.exists ? '已保存自定义密钥' : '未配置'}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => void handleSaveSecret(api)}
                    >
                      保存密钥
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => void handleTestConnection(api)}
                      disabled={testingById[api.id]}
                      isLoading={testingById[api.id]}
                    >
                      {testingById[api.id] ? '测试中' : '测试连接'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {providerStatus.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-800">数据源状态</h3>
            <p className="text-[11px] text-slate-500">当前搜索管道已注册并可能投入使用的数据源</p>
          </div>
          <div className="px-5 py-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {providerStatus.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${p.available ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'}`}
                >
                  {p.available ? (
                    <Wifi className="size-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <WifiOff className="size-3.5 shrink-0 text-slate-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className={`truncate font-medium ${p.available ? 'text-emerald-800' : 'text-slate-500'}`}>
                      {p.name}
                    </div>
                    <div className="truncate text-[10px] text-slate-400">
                      {p.available
                        ? '已配置'
                        : p.requiredConfig.length
                          ? `需配置 ${p.requiredConfig.join(', ')}`
                          : '已弃用'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" onClick={onSave} className="gap-2" disabled={isSaving} isLoading={manualSaving}>
          {manualSaving ? '保存中' : '保存基础配置'}
        </Button>
      </div>
    </div>
  )
}
