import { createRequire } from 'node:module'
import path from 'node:path'

import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

const logBuffer: string[] = []
const originalError = console.error

console.error = (...args: unknown[]) => {
  logBuffer.push(args.map((item) => String(item)).join(' '))
  originalError(...args)
}

const currentFile = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(currentFile), '..')

async function verifyStoreProbe() {
  ;(globalThis as any).window = {
    electronAPI: {
      config: {
        get: async () => ({ success: true, data: {} }),
        set: async () => ({ success: true, data: null }),
      },
    },
  }

  const { useLeadsStore } = await import(pathToFileURL(path.join(projectRoot, 'src/store/leads-store.ts')).href)
  const beforeCount = useLeadsStore.getState().leads.length
  await useLeadsStore.getState().addLead({
    id: Date.now(),
    company: 'Verify Probe Corp',
    contact: 'QA Bot',
    contactTitle: 'Procurement Director',
    email: 'qa@verify-probe.example',
    phone: '+1-555-0100',
    country: 'United States',
    countryCode: 'US',
    industry: 'Energy Storage',
    source: 'Verify Script',
    matchScore: 85,
    status: 'new',
    followUp: 'new',
    starred: false,
    lastActivity: 'verify',
    addedDate: new Date().toISOString(),
    tags: [],
    unlocked: true,
    website: 'verify-probe.example',
    estimatedValue: '--',
  })
  const afterCount = useLeadsStore.getState().leads.length
  const probeHit = logBuffer.find((line) => line.includes('📊 [Probe-Store] addLead 执行完毕'))
  if (!probeHit) {
    throw new Error('未捕获到 Probe-Store 日志')
  }
  return { beforeCount, afterCount, probeHit }
}

async function verifyLlmProbe() {
  const electronPath = require.resolve('electron')
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => process.cwd(), isPackaged: true },
      ipcMain: { handle: () => undefined },
    },
  } as NodeModule

  const { verifyLlmProbeFailure } = await import(pathToFileURL(path.join(projectRoot, 'electron/services/search-service.ts')).href)
  let thrown: Error | null = null
  try {
    await verifyLlmProbeFailure('https://invalid-llm.local')
  } catch (error) {
    thrown = error as Error
  }
  const requestHit = logBuffer.find((line) => line.includes('📊 [Probe-LLM] 请求发起'))
  const crashHit = logBuffer.find((line) => line.includes('📊 [Probe-LLM] 请求崩溃'))
  if (!requestHit || !crashHit || !thrown) {
    throw new Error('未完整捕获到 Probe-LLM 日志')
  }
  return { requestHit, crashHit, thrownMessage: thrown.message }
}

async function main() {
  const storeResult = await verifyStoreProbe()
  const llmResult = await verifyLlmProbe()

  originalError('\n=== VERIFY RESULT ===')
  originalError('[Store]', JSON.stringify(storeResult, null, 2))
  originalError('[LLM]', JSON.stringify(llmResult, null, 2))
}

main().catch((error) => {
  originalError('[VERIFY FAILED]', error)
  process.exitCode = 1
}).finally(() => {
  console.error = originalError
})
