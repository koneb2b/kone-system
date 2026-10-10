const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const vm = require('node:vm')

const originalLoad = Module._load

const createIpcMainMock = () => {
  const handlers = new Map()
  return {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    getHandler(channel) {
      const handler = handlers.get(channel)
      if (!handler) {
        throw new Error(`Missing handler for channel: ${channel}`)
      }
      return handler
    },
  }
}

const createEventMock = () => ({
  sender: {
    sent: [],
    send(channel, payload) {
      this.sent.push({ channel, payload })
    },
  },
})

const createStoreMock = (values = {}) => ({
  values: { ...values },
  get(key) {
    return this.values[key]
  },
  set(key, value) {
    this.values[key] = value
  },
})

const createElectronMock = () => ({
  app: {
    isPackaged: true,
    name: 'Kone AI',
    getPath: () => path.join(process.cwd(), '.tmp-business-logic-user-data'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8'),
  },
})

const createLicenseGuardMock = ({ claims = null, featureError = null } = {}) => ({
  getStoredClaims() {
    return claims
  },
  requireFeature() {
    if (featureError) throw featureError
    return { claims, featureSet: new Set(claims?.features || []) }
  },
  requireAnyFeature() {
    if (featureError) throw featureError
    return { claims, featureSet: new Set(claims?.features || []) }
  },
  enforceExportLimit(content) {
    return String(content || '')
  },
})

const withModuleMocks = async (mocks, runner) => {
  Module._load = function mockLoad(request, parent, isMain) {
    if (request in mocks) {
      return mocks[request]
    }
    if (parent) {
      const key = `${request}::${parent.filename}`
      if (key in mocks) {
        return mocks[key]
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    return await runner()
  } finally {
    Module._load = originalLoad
  }
}

const resetModule = (modulePath) => {
  delete require.cache[require.resolve(modulePath)]
}

const REPO_ROOT = path.join(__dirname, '..', '..')

/* 让 `@/` 别名在测试里可解析到 `src/**` 的 **.ts** 源文件。
 *
 * 背景：测试通过 ts.transpileModule + vm 加载 src 侧模块，Node 原生不认 `.ts`。
 * 此前各测试靠"把每个 `@/` 依赖手动 stub 掉"绕过 —— 一旦被测模块**新增**一个
 * `@/` 值导入（如 `@/lib/country-code`），所有引用它的测试都会 MODULE_NOT_FOUND。
 * 这里提供递归加载能力：先让调用方自己的 require（stub）优先，仅在
 * MODULE_NOT_FOUND 时回退到 `@/` → `.ts` 解析。 */
const createTsAwareRequire = (customRequire) => {
  const fs = require('node:fs')
  const cache = new Map()

  const loadTs = (absPath) => {
    if (cache.has(absPath)) return cache.get(absPath)
    const exportsObj = transpileTypeScriptModule(absPath, { require: tsAwareRequire })
    cache.set(absPath, exportsObj)
    return exportsObj
  }

  const tsAwareRequire = (request) => {
    if (typeof customRequire === 'function') {
      try {
        return customRequire(request)
      } catch (error) {
        // 仅当"找不到模块"时才回退到 @/ 解析；其他错误应如实抛出。
        if (error?.code !== 'MODULE_NOT_FOUND') throw error
      }
    }
    if (typeof request === 'string' && request.startsWith('@/')) {
      const base = path.join(REPO_ROOT, 'src', request.slice(2))
      if (fs.existsSync(`${base}.ts`)) return loadTs(`${base}.ts`)
    }
    return require(request)
  }

  return tsAwareRequire
}

const transpileTypeScriptModule = (filePath, contextOverrides = {}) => {
  const fs = require('node:fs')
  const source = fs.readFileSync(filePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
    fileName: filePath,
  }).outputText

  const module = { exports: {} }
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: createTsAwareRequire(contextOverrides.require),
    __dirname: path.dirname(filePath),
    __filename: filePath,
    process,
    console,
    setTimeout,
    clearTimeout,
    Buffer,
    ...contextOverrides.globals,
  })

  const script = new vm.Script(transpiled, { filename: filePath })
  script.runInContext(context)
  return module.exports
}

module.exports = {
  createIpcMainMock,
  createEventMock,
  createStoreMock,
  createElectronMock,
  createLicenseGuardMock,
  withModuleMocks,
  resetModule,
  transpileTypeScriptModule,
  /* 供自实现 customRequire 的测试复用：让 `@/` 别名回退解析到 src 下的 .ts 源文件 */
  createTsAwareRequire,
}
