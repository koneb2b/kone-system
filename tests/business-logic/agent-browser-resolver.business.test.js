const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

/**
 * L0-2/B2 回归防护：Agent 浏览器解析与启动。
 *
 * 缺陷背景（商用上线就绪度审计 B2）：完整版 puppeteer 的 Chromium 只存在于
 * 开发机缓存（~/.cache/puppeteer），打包产物在用户干净机器上调用
 * puppeteer.launch() 会因 "Could not find Chrome" 失败 ——
 * 开发机正常、用户机器失败，属于典型"发布级阻断"。
 *
 * `browser-resolver.ts` 的解析顺序即该问题的修复：
 *   KONE_BROWSER_PATH → Chrome → Edge → puppeteer 默认（dev 兜底）
 * 且失败必须如实报错并给出中文可操作指引（宪法：严禁假成功）。
 *
 * 本文件通过注入 fs / puppeteer 桩覆盖各分支，无需真实浏览器即可回归。
 */

const repoRoot = path.join(__dirname, '..', '..')
const resolverPath = path.join(repoRoot, 'electron', 'services', 'agents', 'browser-resolver.ts')

const realRequire = Module.createRequire(__filename)

const CHROME_PF = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const EDGE_PF = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'

/** 仅让给定路径"存在且为文件"，其余一律视为不存在 */
const makeFsStub = (existing) => ({
  existsSync: (p) => existing.has(String(p)),
  statSync: (p) => ({ isFile: () => existing.has(String(p)) }),
})

const loadResolver = ({ existing = new Set(), puppeteerStub = null, fsStub = null } = {}) => {
  const effectiveFs = fsStub || makeFsStub(existing)
  const customRequire = (id) => {
    if (id === 'fs') return effectiveFs
    if (id === 'puppeteer' && puppeteerStub) return puppeteerStub
    return realRequire(id)
  }
  const source = fs.readFileSync(resolverPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: resolverPath,
  }).outputText
  const moduleObj = { exports: {} }
  const ctx = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: customRequire,
    __dirname: path.dirname(resolverPath),
    __filename: resolverPath,
    process,
    console,
    Buffer,
  })
  new vm.Script(transpiled, { filename: resolverPath }).runInContext(ctx)
  return moduleObj.exports
}

/** 在用例内安全地改写 KONE_BROWSER_PATH 并保证还原（异步安全） */
const withEnv = async (value, fn) => {
  const key = 'KONE_BROWSER_PATH'
  const prev = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
}

test('L0-2/B2: KONE_BROWSER_PATH 显式指定且文件存在时优先使用', async () => {
  await withEnv('D:\\custom\\mybrowser.exe', async () => {
    const mod = loadResolver({ existing: new Set(['D:\\custom\\mybrowser.exe', CHROME_PF]) })
    const r = mod.resolveBrowserExecutable()
    assert.equal(r.executablePath, 'D:\\custom\\mybrowser.exe')
    assert.equal(r.label, 'custom (KONE_BROWSER_PATH)')
  })
})

test('L0-2/B2: KONE_BROWSER_PATH 指向不存在的文件时回退到系统浏览器（不误用坏路径）', async () => {
  await withEnv('D:\\missing\\nope.exe', async () => {
    const mod = loadResolver({ existing: new Set([CHROME_PF]) })
    const r = mod.resolveBrowserExecutable()
    assert.equal(r.executablePath, CHROME_PF)
    assert.equal(r.label, 'Chrome (Program Files)')
  })
})

test('L0-2/B2: Chrome 优先于 Edge（Windows 主战场）', async () => {
  await withEnv(undefined, async () => {
    const mod = loadResolver({ existing: new Set([EDGE_PF, CHROME_PF]) })
    const r = mod.resolveBrowserExecutable()
    assert.equal(r.executablePath, CHROME_PF)
    assert.match(r.label, /Chrome/)
  })
})

test('L0-2/B2: 无 Chrome 时回退到 Edge（Win10/11 预装命中率极高）', async () => {
  await withEnv(undefined, async () => {
    const mod = loadResolver({ existing: new Set([EDGE_PF]) })
    const r = mod.resolveBrowserExecutable()
    assert.equal(r.executablePath, EDGE_PF)
    assert.match(r.label, /Edge/)
  })
})

test('L0-2/B2: 系统浏览器均不存在时回退 puppeteer 默认（dev 兜底不报错）', async () => {
  await withEnv(undefined, async () => {
    const mod = loadResolver({ existing: new Set() })
    const r = mod.resolveBrowserExecutable()
    assert.equal(r.executablePath, undefined)
    assert.equal(r.label, 'puppeteer-default (no system browser found)')
  })
})

test('L0-2/B2: 路径存在但不是文件时跳过（防止目录被当作可执行文件）', async () => {
  await withEnv(undefined, async () => {
    const dirOnly = { existsSync: () => true, statSync: () => ({ isFile: () => false }) }
    const mod = loadResolver({ fsStub: dirOnly })
    const r = mod.resolveBrowserExecutable()
    assert.equal(r.executablePath, undefined, '目录不得被当作浏览器可执行文件')
  })
})

test('L0-2/B2: 无可用浏览器时启动失败必须抛出中文可操作指引（严禁假成功）', async () => {
  const puppeteerStub = {
    launch: async () => {
      throw new Error('Could not find Chrome (ver. 131.0.6778.85)')
    },
  }
  await withEnv(undefined, async () => {
    const mod = loadResolver({ existing: new Set(), puppeteerStub })
    await assert.rejects(
      () => mod.launchPersistentBrowser('C:\\tmp\\profile'),
      /请在本机安装 Google Chrome 或 Microsoft Edge|KONE_BROWSER_PATH/,
      '必须给出可操作指引，而不是裸抛 puppeteer 原始错误',
    )
  })
})

test('L0-2/B2: 已定位到浏览器但启动失败时如实抛出原始错误（不伪造指引）', async () => {
  const puppeteerStub = {
    launch: async () => {
      throw new Error('Target closed')
    },
  }
  await withEnv(undefined, async () => {
    const mod = loadResolver({ existing: new Set([CHROME_PF]), puppeteerStub })
    await assert.rejects(
      () => mod.launchPersistentBrowser('C:\\tmp\\profile'),
      /Target closed/,
      '已定位浏览器时不应误导用户去安装浏览器，应如实暴露真实原因',
    )
  })
})

test('L0-2/B2: 启动成功时返回可审计的浏览器来源 label 并透传 executablePath', async () => {
  let capturedOptions = null
  const fakeBrowser = { close: async () => undefined }
  const puppeteerStub = {
    launch: async (opts) => {
      capturedOptions = opts
      return fakeBrowser
    },
  }
  await withEnv(undefined, async () => {
    const mod = loadResolver({ existing: new Set([CHROME_PF]), puppeteerStub })
    const { browser, label } = await mod.launchPersistentBrowser('C:\\tmp\\profile', ['--lang=zh-CN'])
    assert.equal(browser, fakeBrowser)
    assert.equal(label, 'Chrome (Program Files)', 'label 供 Agent 运行日志审计浏览器来源')
    assert.equal(capturedOptions.executablePath, CHROME_PF)
    assert.equal(capturedOptions.userDataDir, 'C:\\tmp\\profile')
    assert.ok(capturedOptions.args.includes('--no-sandbox'))
    assert.ok(capturedOptions.args.includes('--lang=zh-CN'), 'extraArgs 必须透传')
  })
})
