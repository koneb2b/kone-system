/**
 * 通用 mock Electron 桥 —— 供各视觉探针复用。
 *
 * ## 为什么需要
 * 视觉探针脱离 Electron、直接连 Vite dev server，因此必须自行提供 `window.electronAPI`。
 * 若 mock 的键名与真实 preload 不一致（如真实是 `accounts` 而非 `account`），
 * 渲染层会在挂载期抛错并命中 ErrorBoundary，**整页渲染失败**，
 * 导致探针产出的截图毫无意义（甚至误报为产品缺陷）。
 *
 * ## 做法
 * 1. 顶层键**严格对齐** `preload/index.ts` 的 16 个命名空间；
 * 2. 每个命名空间用 **Proxy** 兜底：任何未显式 mock 的方法都返回成功空响应，
 *    避免"改一处 preload 就崩一批探针"；
 * 3. 只有需要被断言的通道（config.get / files.saveExport / license.*）显式实现。
 */

/** preload/index.ts 的顶层命名空间（改 preload 时须同步此行）。 */
const NAMESPACES = [
  'system',
  'auth',
  'license',
  'config',
  'autopilot',
  'secret',
  'api',
  'cloud',
  'search',
  'providers',
  'analysis',
  'files',
  'accounts',
  'agents',
  'automation',
  'dns',
]

/**
 * preload 顶层的事件订阅方法（**不在命名空间内**，直接挂 `electronAPI` 上）。
 * 遗漏它们会让渲染层在 useEffect 里抛
 * `TypeError: window.electronAPI.onXxx is not a function` → 整页命中 ErrorBoundary。
 * （preload/index.ts:102-217）
 */
const EVENT_SUBSCRIBERS = [
  'onSearchStreamStart',
  'onSearchStage',
  'onSearchBasicResults',
  'onSearchLeadScored',
  'onSearchStreamComplete',
  'onSearchStreamError',
  'onAutopilotAction',
  'onCloudRealtimeLeadEvent',
  'onAccountStatusUpdate',
  'onAgentStatusChanged',
  'onAgentLeadStatusUpdated',
]

/**
 * 生成注入用的 mock 桥源码字符串。
 *
 * @param {{ leads?: unknown[]; license?: Record<string, unknown>; exportSink?: boolean }} opts
 * @returns {string} 可在 `page.evaluateOnNewDocument` 中执行的 IIFE 源码
 */
const buildMockBridgeSource = (opts = {}) => {
  const leads = opts.leads || []
  const license = opts.license || { plan: 'premium', status: 'active', features: [], expiresAt: null }
  const captureExport = opts.exportSink !== false

  return `(() => {
    const NAMESPACES = ${JSON.stringify(NAMESPACES)}
    const LEADS = ${JSON.stringify(leads)}
    const LICENSE = ${JSON.stringify(license)}
    const CAPTURE_EXPORT = ${captureExport}

    window.__KONE_PROBE__ = { exportCalls: [], configKeys: [], calls: [] }

    const ok = (data) => Promise.resolve({ success: true, data })

    /* 真实内存配置存储（localStorage 持久化）。
       原实现 config.set 是 no-op、config.get 恒返回 null —— 那会让任何
       「保存后是否持久化」的断言**永远无法真正验证**（写进去读不出来）。
       改为真 KV：set 写入、get 读出，使持久化断言具备实际意义。

       注意：用 localStorage 而非纯内存对象 —— evaluateOnNewDocument 在每次
       导航（刷新）时都会重新执行，纯内存 store 会被重置，导致「刷新后仍在」
       类断言必然失败（那是探针自身的假阳性，不是产品缺陷）。 */
    const LS_KEY = '__KONE_MOCK_CONFIG__'
    const loadStore = () => {
      try {
        return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
      } catch {
        return {}
      }
    }
    const CONFIG_STORE = Object.assign({ leads: LEADS }, loadStore())
    const persist = () => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(CONFIG_STORE))
      } catch {
        /* 隐私模式等场景下忽略 */
      }
    }
    window.__MOCK_STORE__ = {
      get: (key) => (key in CONFIG_STORE ? CONFIG_STORE[key] : undefined),
      set: (key, value) => {
        CONFIG_STORE[key] = value
        persist()
      },
      reset: () => {
        try {
          localStorage.removeItem(LS_KEY)
        } catch {
          /* ignore */
        }
      },
    }

    // 显式实现：需要被断言或需要真实数据形状的通道
    const overrides = {
      config: {
        get: (key) => {
          window.__KONE_PROBE__.configKeys.push(key)
          return ok(key in CONFIG_STORE ? CONFIG_STORE[key] : null)
        },
        set: ({ key, value }) => {
          CONFIG_STORE[key] = value
          persist()
          return ok(null)
        },
        save: () => ok(null),
        fetchModels: () => ok({ models: [] }),
      },
      files: {
        saveExport: (payload) => {
          if (CAPTURE_EXPORT) window.__KONE_PROBE__.exportCalls.push(payload)
          return Promise.resolve({ success: true, data: { path: 'C:\\\\probe\\\\export.csv', canceled: false } })
        },
        savePdf: (payload) => {
          if (CAPTURE_EXPORT) window.__KONE_PROBE__.exportCalls.push(payload)
          return Promise.resolve({ success: true, data: { path: 'C:\\\\probe\\\\doc.pdf', canceled: false } })
        },
      },
      license: {
        checkStatus: () => ok(LICENSE),
        getInfo: () => ok(LICENSE),
        verify: () => ok({ valid: true, ...LICENSE }),
        getFeatures: () => ok({ features: LICENSE.features || [] }),
      },
      system: { getDeviceStatus: () => ok({ machineId: 'probe-machine', trialDaysLeft: 30 }) },
      auth: { getSession: () => ok(null), login: () => ok(null), logout: () => ok(null) },
      accounts: { getList: () => ok({ accounts: [] }), list: () => ok({ accounts: [] }) },
      agents: { list: () => ok({ agents: [] }), getLog: () => ok({ entries: [] }) },
      secret: { check: () => ok({ configured: false }), set: () => ok(null) },
      search: { execute: () => ok(null) },
      cloud: { checkCollision: () => ok({ collided: false }) },
      autopilot: { getState: () => ok(null), setState: () => ok(null), clearLegacy: () => ok(null) },
    }

    // 每个命名空间都用 Proxy 兜底：未显式实现的方法 → 成功空响应
    const makeNamespace = (name) => {
      const impl = overrides[name] || {}
      return new Proxy(impl, {
        get(target, prop) {
          if (prop in target) return target[prop]
          if (typeof prop === 'symbol') return undefined
          // 兜底：任何未 mock 的方法都返回成功，避免探针因 preload 演进而崩
          return (...args) => {
            window.__KONE_PROBE__.calls.push({ ns: name, method: String(prop), args })
            return ok(null)
          }
        },
      })
    }

    const api = {}
    for (const ns of NAMESPACES) api[ns] = makeNamespace(ns)

    // 顶层事件订阅：真实实现在 preload 里返回 unsubscribe 函数，
    // 渲染层会把它当清理回调调用 —— 必须返回可调用的函数，否则卸载期抛错。
    for (const name of ${JSON.stringify(EVENT_SUBSCRIBERS)}) {
      api[name] = (callback) => {
        window.__KONE_PROBE__.calls.push({ ns: 'root', method: name, args: [] })
        // 不真正推送事件（探针只验证渲染，不验证推送链路）
        return () => {}
      }
    }

    // 顶层兜底：访问未列出的命名空间也不崩
    window.electronAPI = new Proxy(api, {
      get(target, prop) {
        if (prop in target) return target[prop]
        if (typeof prop === 'symbol') return undefined
        // 顶层未知属性：返回一个既可调用、又可继续取属性的 Proxy，
        // 兼容 onXxx(cb) 与 ns.method() 两种形态
        return makeNamespace(String(prop))
      },
    })
  })()`
}

module.exports = { NAMESPACES, buildMockBridgeSource }
