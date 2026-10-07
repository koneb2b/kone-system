'use client'

import { useState, useEffect, useRef } from 'react'
import { Key, Globe, Cpu, Save, Radar } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useConfigStore, type IcpProfile } from '@/store/config-store'
import { secretCheck } from '@/lib/electron-api'
import { BaseSettingsTab, type ApiKeyConfig } from '@/components/settings/base-settings-tab'
import { IcpSettingsTab } from '@/components/settings/icp-settings-tab'
import { CloudSettingsTab } from '@/components/settings/cloud-settings-tab'
import { UpgradeModal } from '@/components/upgrade-modal'
import { getUserConfig, updateUserSettingsConfig, type UserSettingsConfig } from '@/lib/user-config'

type PersistedApiKeyConfig = { id: string; baseUrl: string }

type PersistedUserConfig = UserSettingsConfig & {
  providers?: PersistedApiKeyConfig[]
  icpProfile?: IcpProfile
  connectionStatus?: Record<string, 'connected' | 'error' | 'pending'>
  selectedModel?: string
}

const defaultIcpProfile: IcpProfile = {
  targetProduct: '',
  buyerPersona: '',
  coreAdvantage: '',
  negativeIcp: '',
}

const secretKeysByProvider: Record<string, string> = {
  llm: 'secrets.llm.apiKey',
  'google-leads': 'secrets.google-leads.apiKey',
  'google-maps': 'secrets.google-maps.apiKey',
  anysearch: 'secrets.anysearch.apiKey',
}

interface SystemSettingsProps {
  userRole?: 'trial' | 'pro' | 'enterprise'
}

export function SystemSettings({ userRole: _userRole }: SystemSettingsProps) {
  const hasLoadedConfig = useRef(false)
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apiKeysRef = useRef<ApiKeyConfig[]>([])
  const connectionStatusRef = useRef<Record<string, 'connected' | 'error' | 'pending'>>({})
  const icpProfileRef = useRef<IcpProfile>(defaultIcpProfile)
  const selectedModelRef = useRef('')
  const persistVersionRef = useRef(0)
  const { toast } = useToast()
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const defaultConfigs: ApiKeyConfig[] = [
    { id: 'llm', name: '智能决策大脑 (LLM)', icon: Cpu, key: '', baseUrl: '', status: 'pending' },
    { id: 'google-leads', name: '谷歌获客引擎', icon: Globe, key: '', baseUrl: '', status: 'pending' },
    { id: 'google-maps', name: '谷歌地图', icon: Globe, key: '', baseUrl: '', status: 'pending' },
    { id: 'anysearch', name: '@ AnySearch B2B 多维数据穿透雷达', icon: Radar, key: '', baseUrl: '', status: 'pending' },
  ]
  const [apiKeys, setApiKeys] = useState<ApiKeyConfig[]>([])
  const [configLoading, setConfigLoading] = useState(true)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [modelLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [manualSaving, setManualSaving] = useState(false)
  const [modelList] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const { icpProfile, setIcpProfile, hydrateFromStorage } = useConfigStore()
  const [connectionStatus, setConnectionStatus] = useState<Record<string, 'connected' | 'error' | 'pending'>>({})

  useEffect(() => {
    apiKeysRef.current = apiKeys
  }, [apiKeys])

  useEffect(() => {
    connectionStatusRef.current = connectionStatus
  }, [connectionStatus])

  useEffect(() => {
    icpProfileRef.current = icpProfile
  }, [icpProfile])

  useEffect(() => {
    selectedModelRef.current = selectedModel
  }, [selectedModel])

  const hydrateConfigs = (saved?: PersistedApiKeyConfig[]) => {
    if (!saved || saved.length === 0) return defaultConfigs
    const byId = new Map(saved.map((item) => [item.id, item]))
    return defaultConfigs.map((base) => ({
      ...base,
      ...(byId.get(base.id) ?? {}),
      icon: base.icon,
    }))
  }

  const toPersisted = (configs: ApiKeyConfig[]) =>
    configs.map(({ icon: _icon, key: _key, masked: _masked, exists: _exists, status: _status, ...rest }) => rest)

  const assertProvidersPersisted = async (configs: ApiKeyConfig[]) => {
    const raw = await getUserConfig<PersistedUserConfig>()
    const persistedProviders = Array.isArray(raw?.providers) ? raw.providers : []
    const persistedById = new Map(persistedProviders.map((item) => [item.id, item]))

    for (const config of configs) {
      const persisted = persistedById.get(config.id)
      const expectedBaseUrl = config.baseUrl?.trim() || ''
      const actualBaseUrl = persisted?.baseUrl?.trim() || ''

      if (expectedBaseUrl !== actualBaseUrl) {
        throw new Error(
          `配置回读校验失败: ${config.id} baseUrl expected=[${expectedBaseUrl}] actual=[${actualBaseUrl}]`,
        )
      }

      if (config.exists) {
        const secretKey = secretKeysByProvider[config.id]
        if (secretKey) {
          const secretMeta = await secretCheck(secretKey)
          if (!secretMeta?.exists) {
            throw new Error(`配置回读校验失败: ${config.id} secret missing for key=[${secretKey}]`)
          }
        }
      }
    }
  }

  const hydrateSecretStatus = async (configs: ApiKeyConfig[]) => {
    const statuses = await Promise.all(
      configs.map(async (config) => {
        const meta = await secretCheck(secretKeysByProvider[config.id])
        return { id: config.id, ...meta }
      }),
    )

    const byId = new Map(statuses.map((item) => [item.id, item]))
    return configs.map((config) => {
      const status = byId.get(config.id)
      return {
        ...config,
        key: '',
        exists: status?.exists || false,
        masked: status?.masked || '',
        status: status?.exists ? 'connected' : config.status,
      }
    })
  }

  // 加载数据
  useEffect(() => {
    const loadData = async () => {
      try {
        let savedKeys: PersistedApiKeyConfig[] | undefined
        let savedModel: string | undefined
        let savedConnection: Record<string, 'connected' | 'error' | 'pending'> | undefined
        const raw = await getUserConfig<PersistedUserConfig>()
        if (Array.isArray(raw)) {
          savedKeys = raw
        } else if (raw && typeof raw === 'object') {
          const typed = raw as PersistedUserConfig
          if (Array.isArray(typed.providers)) savedKeys = typed.providers
          if (typed.selectedModel) savedModel = typed.selectedModel
          if (typed.connectionStatus) savedConnection = typed.connectionStatus
        }

        if (Array.isArray(savedKeys) && savedKeys.length > 0) {
          const hydratedKeys = await hydrateSecretStatus(hydrateConfigs(savedKeys))
          setApiKeys(hydratedKeys)
          setConnectionStatus(
            (prev) =>
              Object.fromEntries(
                hydratedKeys.map((item) => [
                  item.id,
                  item.exists ? 'connected' : savedConnection?.[item.id] || prev[item.id] || 'pending',
                ]),
              ) as Record<string, 'connected' | 'error' | 'pending'>,
          )
        } else {
          const hydratedKeys = await hydrateSecretStatus(defaultConfigs)
          setApiKeys(hydratedKeys)
          setConnectionStatus(
            (prev) =>
              Object.fromEntries(
                hydratedKeys.map((item) => [
                  item.id,
                  item.exists ? 'connected' : savedConnection?.[item.id] || prev[item.id] || 'pending',
                ]),
              ) as Record<string, 'connected' | 'error' | 'pending'>,
          )
        }
        if (savedModel) {
          setSelectedModel(savedModel)
        }
        if (savedConnection && Object.keys(savedConnection).length > 0) {
          setConnectionStatus(savedConnection)
        }
      } catch (e) {
        console.error(e)
        setApiKeys(defaultConfigs)
      } finally {
        hasLoadedConfig.current = true
        setConfigLoading(false)
      }
    }
    loadData()
    void hydrateFromStorage()
  }, [])

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current)
      }
    }
  }, [])

  const clearScheduledPersist = () => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current)
      persistTimeoutRef.current = null
    }
  }

  const buildPersistedValue = (
    configs: ApiKeyConfig[],
    overrides?: {
      connectionStatus?: Record<string, 'connected' | 'error' | 'pending'>
      icpProfile?: IcpProfile
      selectedModel?: string
    },
  ): PersistedUserConfig => ({
    providers: toPersisted(configs),
    icpProfile: overrides?.icpProfile ?? icpProfileRef.current,
    connectionStatus: overrides?.connectionStatus ?? connectionStatusRef.current,
    selectedModel: overrides?.selectedModel ?? selectedModelRef.current,
  })

  const schedulePersist = (
    buildPayload: () => {
      configs: ApiKeyConfig[]
      persistedValue: PersistedUserConfig
    },
    delayMs = 200,
  ) => {
    clearScheduledPersist()
    const version = ++persistVersionRef.current
    persistTimeoutRef.current = setTimeout(() => {
      if (version !== persistVersionRef.current) return
      const { configs, persistedValue } = buildPayload()
      void persist(configs, { persistedValue })
    }, delayMs)
  }

  // 持久化保存
  const persist = async (
    configs: ApiKeyConfig[],
    options?: { notify?: boolean; persistedValue?: PersistedUserConfig },
  ) => {
    if (!hasLoadedConfig.current || configLoading || configs.length === 0) return
    const persistedValue = options?.persistedValue ?? buildPersistedValue(configs)
    const shouldNotify = options?.notify
    try {
      clearScheduledPersist()
      persistVersionRef.current += 1
      if (shouldNotify) setManualSaving(true)
      setSaveStatus('saving')
      await updateUserSettingsConfig<PersistedUserConfig>(() => persistedValue)
      await assertProvidersPersisted(configs)
      setSaveStatus('saved')
      if (shouldNotify) {
        toast({
          title: '配置已保存',
          description: '已同步 ICP 策略与 API 配置',
          variant: 'default',
          className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        })
      }
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current)
      }
      persistTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle')
      }, 1200)
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存失败'
      setSaveStatus('error')
      toast({
        title: '保存失败',
        description: `${message}，请检查 API 密钥配置`,
        variant: 'destructive',
      })
    } finally {
      if (shouldNotify) setManualSaving(false)
    }
  }

  const persistProviderConfigAtomically = async (
    id: string,
    patch: Partial<ApiKeyConfig>,
    options?: { connectionStatus?: 'connected' | 'error' | 'pending' },
  ) => {
    clearScheduledPersist()
    persistVersionRef.current += 1
    const currentConfigs = apiKeysRef.current
    const currentConnectionStatus = connectionStatusRef.current
    const nextConfigs = currentConfigs.map((config) => (config.id === id ? { ...config, ...patch } : config))
    const nextConnectionStatus = {
      ...currentConnectionStatus,
      [id]: options?.connectionStatus || patch.status || currentConnectionStatus[id] || 'pending',
    } as Record<string, 'connected' | 'error' | 'pending'>

    apiKeysRef.current = nextConfigs
    connectionStatusRef.current = nextConnectionStatus
    setApiKeys(nextConfigs)
    setConnectionStatus(nextConnectionStatus)

    if (!hasLoadedConfig.current || configLoading || nextConfigs.length === 0) return

    const persistedValue = buildPersistedValue(nextConfigs, { connectionStatus: nextConnectionStatus })

    setSaveStatus('saving')
    await updateUserSettingsConfig<PersistedUserConfig>(() => persistedValue)
    await assertProvidersPersisted(nextConfigs)
    setSaveStatus('saved')

    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current)
    }
    persistTimeoutRef.current = setTimeout(() => {
      setSaveStatus('idle')
    }, 1200)
  }

  const updateIcp = (patch: Partial<IcpProfile>) => {
    const nextIcpProfile: IcpProfile = { ...icpProfileRef.current, ...patch }
    icpProfileRef.current = nextIcpProfile
    setIcpProfile(patch)
    schedulePersist(() => {
      const configs = apiKeysRef.current
      return {
        configs,
        persistedValue: buildPersistedValue(configs, { icpProfile: nextIcpProfile }),
      }
    })
  }

  const isSaving = saveStatus === 'saving'

  const updateConfig = (id: string, patch: Partial<ApiKeyConfig>) => {
    const next = apiKeysRef.current.map((k) => (k.id === id ? { ...k, ...patch } : k))
    const nextConnectionStatus = {
      ...connectionStatusRef.current,
      [id]:
        patch.status ||
        (patch.exists
          ? 'connected'
          : patch.key !== undefined || patch.baseUrl !== undefined
            ? 'pending'
            : connectionStatusRef.current[id] || 'pending'),
    } as Record<string, 'connected' | 'error' | 'pending'>

    apiKeysRef.current = next
    connectionStatusRef.current = nextConnectionStatus
    setApiKeys(next)
    setConnectionStatus(nextConnectionStatus)
    schedulePersist(() => ({
      configs: next,
      persistedValue: buildPersistedValue(next, { connectionStatus: nextConnectionStatus }),
    }))
  }

  if (configLoading) {
    return (
      <div className="min-h-[calc(100vh-2rem)] bg-slate-50" data-stage="settings">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="rounded-2xl border border-border bg-card shadow-sm px-8 py-10 text-sm text-muted-foreground">
            正在加载配置...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-2rem)] bg-slate-50" data-stage="settings">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-8 py-6">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Key className="size-5" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-semibold text-slate-900">Kone 系统设置</h1>
              <p className="text-sm text-slate-500">API 与模型、ICP 策略、Kone 协同引擎</p>
              {import.meta.env.DEV ? (
                <p className="mt-1 inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200">
                  开发预览环境：配置独立存放于 %APPDATA%\kone-system，与正式安装版的配置互不相通
                </p>
              ) : null}
            </div>
            <Badge variant="secondary" className="text-xs">
              {saveStatus === 'saving' && '正在保存'}
              {saveStatus === 'saved' && '已保存'}
              {saveStatus === 'error' && '保存异常'}
              {saveStatus === 'idle' && '配置自动保存'}
            </Badge>
          </div>

          <div className="px-8 py-6">
            <Tabs defaultValue="base" className="w-full">
              <TabsList className="grid w-full grid-cols-3 rounded-xl border border-slate-200 bg-slate-100/80 p-1 shadow-sm">
                <TabsTrigger
                  value="base"
                  className="text-slate-600 transition-all data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
                >
                  基础配置 (API & 模型)
                </TabsTrigger>
                <TabsTrigger
                  value="icp"
                  className="text-slate-600 transition-all data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
                >
                  ICP 智能画像引擎
                </TabsTrigger>
                <TabsTrigger
                  value="cloud"
                  className="text-slate-600 transition-all data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
                >
                  云端引擎
                </TabsTrigger>
              </TabsList>

              <TabsContent value="base">
                <BaseSettingsTab
                  apiKeys={apiKeys}
                  connectionStatus={connectionStatus}
                  showKeys={showKeys}
                  modelLoading={modelLoading}
                  modelList={modelList}
                  selectedModel={selectedModel}
                  onToggleKey={(id) => setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }))}
                  onUpdateConfig={updateConfig}
                  onSelectModel={(model) => {
                    selectedModelRef.current = model
                    setSelectedModel(model)
                    const configs = apiKeysRef.current
                    void persist(configs, {
                      persistedValue: buildPersistedValue(configs, { selectedModel: model }),
                    })
                  }}
                  onPersistProviderConfig={persistProviderConfigAtomically}
                  onSave={() => void persist(apiKeysRef.current, { notify: true })}
                  isSaving={isSaving}
                  manualSaving={manualSaving}
                />
              </TabsContent>

              <TabsContent value="icp">
                <IcpSettingsTab
                  icpProfile={icpProfile}
                  onUpdateIcp={updateIcp}
                  onSave={() => void persist(apiKeysRef.current, { notify: true })}
                  isSaving={isSaving}
                  manualSaving={manualSaving}
                />
              </TabsContent>

              <TabsContent value="cloud">
                <CloudSettingsTab />
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-8 py-6">
            <div className="text-xs text-slate-500">配置更改会自动保存，本地缓存会在异常时兜底。</div>
            <Button
              type="button"
              size="lg"
              onClick={() => persist(apiKeysRef.current, { notify: true })}
              className="gap-2"
              disabled={isSaving}
              isLoading={manualSaving}
            >
              {!manualSaving ? <Save className="size-4" /> : null}
              {manualSaving ? '保存中' : '保存全局配置'}
            </Button>
          </div>
        </div>
      </div>

      <UpgradeModal open={upgradeModalOpen} intent="premium" onOpenChange={setUpgradeModalOpen} />
    </div>
  )
}
