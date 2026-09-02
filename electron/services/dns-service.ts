import { promises as dns } from 'dns'
import { IPC_CHANNELS } from '../ipc/channels'
import { ConfigStore } from './config-service'
import { createLicenseService, registerSecureFeatureIpc } from './license-service'

type DnsRecord = { type: string; value: string; ttl?: number }

const MAX_CONCURRENT_DNS_CHECKS = 2
let activeDnsChecks = 0

const withConcurrencyGuard = async <T>(fn: () => Promise<T>): Promise<T> => {
  while (activeDnsChecks >= MAX_CONCURRENT_DNS_CHECKS) {
    await new Promise<void>((resolve) => setTimeout(resolve, 200))
  }
  activeDnsChecks += 1
  try {
    return await fn()
  } finally {
    activeDnsChecks -= 1
  }
}

const extractDomain = (emailOrDomain: string) => {
  const trimmed = String(emailOrDomain || '').trim()
  if (trimmed.includes('@')) return trimmed.split('@').pop() || trimmed
  return trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./i, '')
}

const resolveDns = async (domain: string, rrtype: string): Promise<DnsRecord[]> => {
  try {
    const records = await dns.resolve(domain, rrtype as any)
    return (Array.isArray(records) ? records : [records]).map((r) => ({
      type: rrtype,
      value: typeof r === 'string' ? r : String((r as any)?.exchange || (r as any)?.join?.(' ') || r),
    }))
  } catch {
    return []
  }
}

const checkSpamhausBlacklist = async (domain: string): Promise<boolean> => {
  try {
    const reversed = domain.split('.').reverse().join('.')
    await dns.resolve4(`${reversed}.zen.spamhaus.org`)
    return true
  } catch {
    return false
  }
}

/* P2-4：DKIM selector 探测列表 —— 默认列表 + 用户配置合并（防误报：自定义
   selector 不替换默认列表，仅追加）。配置键：user_config.dnsShield.dkimSelectors */
const DEFAULT_DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'mail']

export const resolveDkimSelectors = (raw?: unknown): string[] => {
  const configured = Array.isArray(raw)
    ? raw.map((s) => String(s || '').trim()).filter(Boolean)
    : String(raw || '')
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
  return [...new Set([...DEFAULT_DKIM_SELECTORS, ...configured.map((s) => s.toLowerCase())])]
}

const checkDnsHealth = async (domain: string, dkimSelectors?: string[]) => {
  const results: DnsRecord[] = []

  const mxRecords = await resolveDns(domain, 'MX')
  results.push(...mxRecords)
  const hasMX = mxRecords.length > 0

  const txtRecords = await resolveDns(domain, 'TXT')
  results.push(...txtRecords)
  const hasSPF = txtRecords.some((r) => r.value.toLowerCase().includes('v=spf1'))

  let hasDKIM = false
  for (const sel of dkimSelectors || DEFAULT_DKIM_SELECTORS) {
    const dkimRecords = await resolveDns(`${sel}._domainkey.${domain}`, 'TXT')
    if (dkimRecords.length > 0) {
      results.push(...dkimRecords)
      hasDKIM = true
      break
    }
  }

  const dmarcRecords = await resolveDns(`_dmarc.${domain}`, 'TXT')
  results.push(...dmarcRecords)
  const hasDMARC = dmarcRecords.length > 0

  const isBlacklisted = await checkSpamhausBlacklist(domain)

  return {
    domain,
    hasMX,
    hasSPF,
    hasDKIM,
    hasDMARC,
    records: results,
    valid: hasMX && hasSPF && hasDKIM && !isBlacklisted,
    error: isBlacklisted
      ? '域名已被 Spamhaus 全球反垃圾邮件黑名单拉黑，发信将被拦截'
      : !hasMX
        ? '域名缺少 MX 邮件交换记录，无法接收邮件回复'
        : !hasSPF
          ? '域名缺少 SPF 发信人策略记录，邮件可能被标为垃圾'
          : !hasDKIM
            ? '未检测到 DKIM 数字签名密钥，发信信誉度偏低'
            : undefined,
  }
}

export const registerDnsHandlers = (ipcMain: Electron.IpcMain, store: ConfigStore) => {
  const { licenseGuard } = createLicenseService(store)

  registerSecureFeatureIpc(
    ipcMain,
    IPC_CHANNELS.DNS.HEALTH_CHECK,
    store,
    licenseGuard,
    'cloud_send',
    async (_event, payload: { domain: string }) => {
      try {
        const rawDomain = String(payload?.domain || '').trim()
        if (!rawDomain) {
          return { success: false, error: '域名参数缺失', code: 400 }
        }

        const domain = extractDomain(rawDomain)
        /* P2-4：读取用户配置的自定义 DKIM selector（默认列表永远保留） */
        let dkimSelectors: string[] | undefined
        try {
          const userConfig = store.get('user_config') as { dnsShield?: { dkimSelectors?: unknown } } | undefined
          dkimSelectors = resolveDkimSelectors(userConfig?.dnsShield?.dkimSelectors)
        } catch {
          /* config unavailable → defaults */
        }
        const result = await withConcurrencyGuard(() => checkDnsHealth(domain, dkimSelectors))
        return { success: true, data: result }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'DNS 域名健康检测异常',
          code: 500,
        }
      }
    },
    '发信域名信誉检测',
  )
}
