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
    require: contextOverrides.require,
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
}
