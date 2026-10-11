import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'
import type { ElectronApi } from './shared/ipc-contracts'

const DEV_ENTERPRISE_FEATURES = [
  'enterprise',
  'search_basic',
  'search_deep',
  'analysis_basic',
  'analysis_advanced',
  'lead_export',
  'export_full',
  'local_autopilot',
  'cloud_send',
  'team_collaboration',
] as const

const DEV_ENTERPRISE_LICENSE = {
  status: 'active',
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  features: [...DEV_ENTERPRISE_FEATURES],
  plan: 'enterprise' as const,
}

const devConfigState: Record<string, unknown> = {}

const buildDevAnalysis = (payload: {
  lead?: { company?: string; industry?: string; country?: string; website?: string; customerText?: string } | null
  scenario?: string
}) => {
  const company = payload.lead?.company?.trim() || 'Target Account'
  const industry = payload.lead?.industry?.trim() || 'energy storage'
  const country = payload.lead?.country?.trim() || 'global market'
  const website = payload.lead?.website?.trim() || 'official website'

  if (payload.scenario === 'reply_coach') {
    const customerText = payload.lead?.customerText?.trim() || 'Please share your best price and lead time.'
    const negotiationRisk = `${company} is likely testing price and lead time before committing. The signal is positive, but it still lacks firm volume and timeline commitment.`
    const pricingAdvice =
      'Keep the baseline offer stable first, then exchange better pricing for clearer quantity, project timing, or sample confirmation.'
    const replyTemplate = [
      `Hi ${company} team,`,
      '',
      'Thank you for your reply.',
      '',
      'To provide the most suitable offer, could you please share your target quantity, application details, and expected timeline? Based on that, we can align the right specification and commercial proposal for your project.',
      '',
      'If helpful, we can also arrange a sample or a tiered quotation once the requirement is clearer.',
      '',
      'Best regards,',
      'Kone Team',
    ].join('\n')

    return {
      content: replyTemplate,
      analysis: negotiationRisk,
      suggestion: pricingAdvice,
      customerText,
      negotiationRisk,
      pricingAdvice,
      replyTemplate,
      nextAction: '继续推进',
      usedFallback: false,
      source: 'dev-shell',
    }
  }

  const templates: Record<string, string> = {
    direct_quote: [
      `Subject: Faster quote support for ${company}`,
      `Hi ${company} team, I reviewed your ${website} footprint and your focus on ${industry} in ${country}.`,
      'Kone can support faster RFQ turnaround with stable manufacturing scheduling and clearer cost breakdowns for recurring programs.',
      'If you are comparing suppliers on lead time, consistency, or project response speed, we can prepare a targeted quotation path instead of a generic catalog reply.',
      'Send me one active SKU or project spec and I will return a concrete proposal for your team.',
    ].join('\n\n'),
    competitor_switch: [
      `Subject: Benchmark option for ${company}`,
      `Hi ${company} team, your public positioning suggests a serious sourcing standard for ${industry}.`,
      'If an incumbent supplier is causing pressure on price, delivery, or engineering responsiveness, Kone can act as a benchmark source with a cleaner communication loop and faster decision support.',
      'We usually help procurement and product teams compare risk on MOQ, lead time, and customization before a switch decision is made.',
      'If useful, reply with the current brand or part family you are evaluating and I will structure a replacement conversation for you.',
    ].join('\n\n'),
    factory_strength: [
      `Subject: Manufacturing support for ${company}`,
      `Hi ${company} team, I looked at your website and it appears your market requires dependable execution rather than just low pricing.`,
      'Kone can support that with factory-backed delivery control, stable quality follow-through, and practical communication from sampling to mass production.',
      `For teams in ${industry}, this usually matters most when projects are scaling and supplier coordination becomes a bottleneck.`,
      `If you want, I can map our production strengths against one live requirement from ${company}.`,
    ].join('\n\n'),
  }

  return templates[payload.scenario || 'direct_quote'] || templates.direct_quote
}

if (import.meta.env.DEV) {
  if (!window.electronAPI) {
    const getSession = async () => ({
      success: true,
      data: {
        authenticated: true,
        hasRefreshToken: true,
        expiresAt: DEV_ENTERPRISE_LICENSE.expiresAt,
      },
    })

    const getLicenseStatus = async () => ({ success: true, data: DEV_ENTERPRISE_LICENSE })

    const getConfigValue = async (key: string) => {
      return { success: true, data: devConfigState[key] ?? null }
    }

    const setConfigValue = async <T,>(payload: { key: string; value: T }) => {
      devConfigState[payload.key] = payload.value
      return { success: true, data: null }
    }

    const unsupported = async () => ({
      success: false,
      error: '本地引擎未连接，该能力需在桌面应用中使用。',
      code: 503,
    })

    const devShellApi: ElectronApi = {
      system: {
        getDeviceStatus: async () => ({ success: true, data: { available: true } }),
        /* 浏览器预览环境无 Electron shell：退化为 window.open（开发模式专用） */
        openExternal: async (url: string) => {
          window.open(url, '_blank')
          return { success: true, data: { opened: true } }
        },
      },
      license: {
        verify: (async () => ({
          success: true,
          data: {
            ...DEV_ENTERPRISE_LICENSE,
          },
        })) as ElectronApi['license']['verify'],
        checkStatus: getLicenseStatus as ElectronApi['license']['checkStatus'],
        getInfo: (async () => {
          /* dev-shell 预览开关：?view=activation / ?view=locked 可在浏览器预览
             登录/锁定界面（仅 devShell fallback 生效，打包版不受影响） */
          const previewView = new URLSearchParams(window.location.search).get('view')
          if (previewView === 'activation' || previewView === 'locked') {
            return {
              success: true,
              data: {
                tier: 'unregistered' as const,
                machineId: 'DEV-SHELL-MOCK',
                isDev: false,
                isTrial: false,
                daysLeft: 0,
                hasLlmApiKey: false,
                plan: 'basic' as const,
                expiresAt: 0,
                features: [],
              },
            }
          }
          return {
            success: true,
            data: {
              tier: 'premium' as const,
              machineId: 'DEV-SHELL-MOCK',
              isDev: true,
              isTrial: false,
              daysLeft: 365,
              hasLlmApiKey: false,
              plan: 'enterprise',
              expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
              features: [...DEV_ENTERPRISE_FEATURES],
            },
          }
        }) as ElectronApi['license']['getInfo'],
        submit: (async () => ({
          success: true,
          data: {
            tier: 'premium' as const,
            status: 'active' as const,
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
            features: [...DEV_ENTERPRISE_FEATURES],
            plan: 'enterprise',
            type: 'license' as const,
            isExpired: false,
            machineId: 'DEV-SHELL-MOCK',
          },
        })) as ElectronApi['license']['submit'],
        requestTrial: (async () => ({
          success: true,
          data: {
            success: true,
            tier: 'basic' as const,
            daysLeft: 7,
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
            message: '7 天试用已开启',
          },
        })) as ElectronApi['license']['requestTrial'],
      },
      auth: {
        login: (async () => ({
          success: true,
          data: {
            state: 'dev-enterprise',
            redirectUri: 'http://localhost/dev-auth',
            authenticated: true,
          } as any,
        })) as ElectronApi['auth']['login'],
        logout: async () => ({ success: true, data: { loggedOut: true } }),
        getSession: getSession as ElectronApi['auth']['getSession'],
      },
      config: {
        get: getConfigValue as ElectronApi['config']['get'],
        set: setConfigValue as ElectronApi['config']['set'],
        save: setConfigValue as ElectronApi['config']['save'],
        fetchModels: unsupported as ElectronApi['config']['fetchModels'],
      },
      autopilot: {
        getState: (async () => ({
          success: true,
          data: { stateKind: 'ready_empty', source: 'dev_shell', state: null },
        })) as ElectronApi['autopilot']['getState'],
        setState: (async () => ({ success: true, data: null })) as ElectronApi['autopilot']['setState'],
        clearLegacy: (async () => ({ success: true, data: null })) as ElectronApi['autopilot']['clearLegacy'],
        syncLifecycle: (async () => ({ success: true, data: null })) as ElectronApi['autopilot']['syncLifecycle'],
      },
      secret: {
        set: async () => ({ success: true, data: { exists: true, masked: '***' } }),
        check: async () => ({ success: true, data: { exists: true, masked: '***' } }),
      },
      api: {
        testConnection: unsupported as ElectronApi['api']['testConnection'],
        proxy: unsupported as ElectronApi['api']['proxy'],
      },
      search: {
        execute: (async () => ({
          success: true,
          data: {
            results: [],
          },
        })) as ElectronApi['search']['execute'],
      },
      onSearchStreamStart: (() => () => undefined) as ElectronApi['onSearchStreamStart'],
      onSearchStage: (() => () => undefined) as ElectronApi['onSearchStage'],
      onSearchBasicResults: (() => () => undefined) as ElectronApi['onSearchBasicResults'],
      onSearchLeadScored: (() => () => undefined) as ElectronApi['onSearchLeadScored'],
      onSearchStreamComplete: (() => () => undefined) as ElectronApi['onSearchStreamComplete'],
      onSearchStreamError: (() => () => undefined) as ElectronApi['onSearchStreamError'],
      onAutopilotAction: (() => () => undefined) as ElectronApi['onAutopilotAction'],
      analysis: {
        generate: (async (payload) => {
          const result = buildDevAnalysis(payload)
          return {
            success: true,
            data:
              typeof result === 'string'
                ? {
                    content: result,
                    usedFallback: false,
                    source: 'dev-shell',
                  }
                : result,
          }
        }) as ElectronApi['analysis']['generate'],
      },
      files: {
        saveExport: unsupported as ElectronApi['files']['saveExport'],
        exportPdf: unsupported as ElectronApi['files']['exportPdf'],
      },
      cloud: {
        checkCollision: (async () => ({
          success: true,
          data: { collision: false, domain: '' },
        })) as ElectronApi['cloud']['checkCollision'],
        syncLead: (async () => ({
          success: true,
          data: { synced: false, reason: 'Dev shell: 云端未连接' },
        })) as ElectronApi['cloud']['syncLead'],
        upsertLead: (async () => ({
          success: true,
          data: { upserted: false, reason: 'Dev shell: 云端未连接' },
        })) as ElectronApi['cloud']['upsertLead'],
        checkDomains: (async () => ({
          success: true,
          data: { claimedDomains: [], offline: true },
        })) as ElectronApi['cloud']['checkDomains'],
        createCampaign: (async () => ({
          success: true,
          data: { created: false, error: 'Dev shell: 云端未连接' },
        })) as ElectronApi['cloud']['createCampaign'],
        fetchTeamLeads: (async () => ({
          success: true,
          data: { leads: [], offline: true },
        })) as ElectronApi['cloud']['fetchTeamLeads'],
        fetchTracking: (async () => ({
          success: true,
          data: { tracking: {}, offline: true },
        })) as ElectronApi['cloud']['fetchTracking'],
        subscribeRealtime: (async () => ({ success: true, data: null })) as ElectronApi['cloud']['subscribeRealtime'],
        unsubscribeRealtime: (async () => ({
          success: true,
          data: null,
        })) as ElectronApi['cloud']['unsubscribeRealtime'],
        fetchClaimedDomains: (async () => ({
          success: true,
          data: { domains: [], offline: true },
        })) as ElectronApi['cloud']['fetchClaimedDomains'],
        cloudflareConfigured: (async () => ({
          success: true,
          data: { configured: false },
        })) as ElectronApi['cloud']['cloudflareConfigured'],
        cloudflareTestConnection: (async () => ({
          success: true,
          data: { ok: false, message: 'Dev shell: 云端未连接', latencyMs: 0 },
        })) as ElectronApi['cloud']['cloudflareTestConnection'],
        cloudflareDashboardStats: (async () => ({
          success: true,
          data: {
            leads: {
              total: 0,
              scored: 0,
              pendingApproval: 0,
              approved: 0,
              queued: 0,
              sent: 0,
              replied: 0,
              suppressed: 0,
            },
            outreach: { total: 0, pending: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0 },
            suppressions: 0,
            syncVersion: 0,
          },
        })) as ElectronApi['cloud']['cloudflareDashboardStats'],
        cloudflarePollOutreachStatus: (async () => ({
          success: true,
          data: { outreach: [], limit: 0, offset: 0 },
        })) as ElectronApi['cloud']['cloudflarePollOutreachStatus'],
        /* [V1.4.0] Phase 2.9 · 审批（dev shell 无云端，返回占位） */
        createApproval: (async () => ({
          success: true,
          data: {
            approvalId: 'dev-approval',
            leadId: 'dev-lead',
            decision: 'approved',
            draftVersion: 0,
            status: 'approved',
          },
        })) as ElectronApi['cloud']['createApproval'],
        listApprovals: (async () => ({
          success: true,
          data: { approvals: [], limit: 0 },
        })) as ElectronApi['cloud']['listApprovals'],
      },
      onCloudRealtimeLeadEvent: (() => () => undefined) as ElectronApi['onCloudRealtimeLeadEvent'],
      automation: {
        verifyEmails: (async () => ({
          success: true,
          data: { results: [] },
        })) as ElectronApi['automation']['verifyEmails'],
        startCampaign: (async () => ({
          success: true,
          data: { triggered: false, pushed: false, accepted: 0, rejected: 0, message: '云端投递闭环为目标态' },
        })) as ElectronApi['automation']['startCampaign'],
        imapPoll: (async () => ({
          success: true,
          data: {
            polled: 0,
            matched: 0,
            reported: 0,
            idempotent: 0,
            errors: [],
            since: '',
            at: '',
            skipped: 'dev-shell',
          },
        })) as ElectronApi['automation']['imapPoll'],
        imapStatus: (async () => ({
          success: true,
          data: {
            enabled: false,
            intervalMs: 0,
            lookbackDays: 3,
            cloudflareConfigured: false,
            imapConfigured: false,
            running: false,
            lastPoll: null,
          },
        })) as ElectronApi['automation']['imapStatus'],
        imapRestart: (async () => ({
          success: true,
          data: {
            enabled: false,
            intervalMs: 0,
            lookbackDays: 3,
            cloudflareConfigured: false,
            imapConfigured: false,
            running: false,
            lastPoll: null,
          },
        })) as ElectronApi['automation']['imapRestart'],
        imapTestConnection: (async () => ({
          success: true,
          data: {
            ok: false,
            message: '开发环境：未实际连接 IMAP 主机',
            totalMessages: 0,
            latencyMs: 0,
          },
        })) as ElectronApi['automation']['imapTestConnection'],
      },
      accounts: {
        connect: (async () => ({
          success: true,
          data: { accountId: 'dev-account', status: 'connected' },
        })) as ElectronApi['accounts']['connect'],
        disconnect: (async () => ({ success: true, data: null })) as ElectronApi['accounts']['disconnect'],
        getList: (async () => ({ success: true, data: { accounts: [] } })) as ElectronApi['accounts']['getList'],
      },
      onAccountStatusUpdate: (() => () => undefined) as ElectronApi['onAccountStatusUpdate'],
      agents: {
        getList: (async () => ({
          success: true,
          data: {
            agents: [
              {
                agentId: 'agent-whatsapp',
                agentType: 'whatsapp',
                status: 'idle',
                label: 'WhatsApp 拓客猎手',
                description: '本地引擎未连接：请在桌面应用中完成账号配置后使用自动触达。',
                progress: 0,
                totalTargets: 0,
                completedCount: 0,
                failedCount: 0,
                dailyLimit: 50,
                dailyUsed: 0,
              },
              {
                agentId: 'agent-linkedin',
                agentType: 'linkedin',
                status: 'idle',
                label: 'LinkedIn 商务买手',
                description: '本地引擎未连接：请在桌面应用中完成账号配置后使用沙箱会话。',
                progress: 0,
                totalTargets: 0,
                completedCount: 0,
                failedCount: 0,
                dailyLimit: 50,
                dailyUsed: 0,
              },
              {
                agentId: 'agent-email',
                agentType: 'email',
                status: 'idle',
                label: '邮件跟进助理',
                description: '本地引擎未连接：请在桌面应用中配置 SMTP/IMAP 后启用邮件跟进。',
                progress: 0,
                totalTargets: 0,
                completedCount: 0,
                failedCount: 0,
                dailyLimit: 50,
                dailyUsed: 0,
              },
            ],
          },
        })) as ElectronApi['agents']['getList'],
        control: unsupported as ElectronApi['agents']['control'],
        getLog: (async () => ({
          success: true,
          data: { agentId: '', logEntries: [] },
        })) as ElectronApi['agents']['getLog'],
        getStatus: (async () => ({
          success: true,
          data: { leadKey: '', agentStatus: undefined },
        })) as ElectronApi['agents']['getStatus'],
        getSuppressionList: (async () => ({
          success: true,
          data: { entries: [] },
        })) as ElectronApi['agents']['getSuppressionList'],
        addSuppression: (async () => ({
          success: true,
          data: { entries: [] },
        })) as ElectronApi['agents']['addSuppression'],
        removeSuppression: (async () => ({
          success: true,
          data: { entries: [] },
        })) as ElectronApi['agents']['removeSuppression'],
      },
      onAgentStatusChanged: (() => () => undefined) as ElectronApi['onAgentStatusChanged'],
      onAgentLeadStatusUpdated: (() => () => undefined) as ElectronApi['onAgentLeadStatusUpdated'],
      dns: {
        healthCheck: (async (payload) => ({
          success: true,
          data: {
            domain: payload.domain,
            hasMX: true,
            hasSPF: true,
            hasDKIM: false,
            hasDMARC: false,
            records: [],
            valid: true,
          },
        })) as ElectronApi['dns']['healthCheck'],
      },
      providers: {
        getList: (async () => ({
          success: true,
          data: {
            providers: [
              { id: 'google_maps', name: 'SerpApi Google Maps', available: true, requiredConfig: ['googleKey'] },
              { id: 'google_organic', name: 'SerpApi Google Organic', available: true, requiredConfig: ['googleKey'] },
              {
                id: 'anysearch',
                name: 'AnySearch Multi-Source',
                available: true,
                requiredConfig: ['anysearchApiKey', 'anysearchBaseUrl'],
              },
              {
                id: 'linkedin_search',
                name: 'SerpApi LinkedIn Search',
                available: true,
                requiredConfig: ['googleKey'],
              },
              {
                id: 'customs_shipment',
                name: 'SerpApi Customs Shipment Search',
                available: true,
                requiredConfig: ['googleKey'],
              },
              { id: 'trade_show', name: 'SerpApi Trade Show Search', available: true, requiredConfig: ['googleKey'] },
              {
                id: 'facebook_search',
                name: 'SerpApi Facebook Search',
                available: true,
                requiredConfig: ['googleKey'],
              },
              { id: 'yellow_pages', name: 'Yellow Pages (deprecated)', available: false, requiredConfig: [] },
            ],
          },
        })) as ElectronApi['providers']['getList'],
      },
    }
    window.electronAPI = devShellApi
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
