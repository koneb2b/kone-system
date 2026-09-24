const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

// 商用加固（审计 G1）回归防护：结构化日志的**纯函数**（级别阈值、级别过滤、滚动文件命名、
// 结构化行格式）。这些是 logger 的行为契约，与文件/console 副作用解耦，可独立单测。

const repoRoot = path.join(__dirname, '..', '..')
const loggerPath = path.join(repoRoot, 'electron', 'utils', 'logger.ts')

const realRequire = Module.createRequire(__filename)
const transpileLogger = () => {
  const source = fs.readFileSync(loggerPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: loggerPath,
  }).outputText
  const moduleObj = { exports: {} }
  const ctx = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: (id) => realRequire(id),
    __dirname: path.dirname(loggerPath),
    __filename: loggerPath,
    process,
    console,
    Buffer,
  })
  new vm.Script(transpiled, { filename: loggerPath }).runInContext(ctx)
  return moduleObj.exports
}

test('resolveThreshold: 合法级别透传，非法回退（生产 info / 非生产 debug）', () => {
  const { resolveThreshold } = transpileLogger()
  assert.equal(resolveThreshold('warn'), 'warn')
  assert.equal(resolveThreshold('ERROR'), 'error')
  assert.equal(resolveThreshold('nonsense'), 'debug') // 非生产默认 debug
  assert.equal(resolveThreshold('nonsense', false), 'debug')
  assert.equal(resolveThreshold('nonsense', true), 'info') // 生产回退 info
  assert.equal(resolveThreshold(undefined, true), 'info')
})

test('shouldLog: 级别阈值过滤（>= 阈值才输出）', () => {
  const { shouldLog } = transpileLogger()
  assert.equal(shouldLog('error', 'warn'), true)
  assert.equal(shouldLog('warn', 'warn'), true)
  assert.equal(shouldLog('info', 'warn'), false)
  assert.equal(shouldLog('debug', 'info'), false)
  assert.equal(shouldLog('debug', 'debug'), true)
})

test('logFileName: 按天命名 kone-YYYYMMDD.log', () => {
  const { logFileName } = transpileLogger()
  assert.equal(logFileName(new Date(2026, 8, 25)), 'kone-20260925.log') // 月份 0-based：8=九月
  assert.equal(logFileName(new Date(2026, 0, 3)), 'kone-20260103.log')
})

test('formatLogLine: 结构化行含 ISO 时间 / 级别 / 模块 / 消息 / 元数据', () => {
  const { formatLogLine } = transpileLogger()
  const line = formatLogLine(
    'warn',
    'BackupService',
    'checksum mismatch',
    { file: 'a.json' },
    new Date('2026-09-25T00:00:00.000Z'),
  )
  assert.match(line, /^\[2026-09-25T00:00:00\.000Z\] WARN {2}\[BackupService\] checksum mismatch \{"file":"a\.json"\}$/)
  // 无元数据时不追加 JSON
  const plain = formatLogLine('info', 'M', 'hello', undefined, new Date('2026-09-25T00:00:00.000Z'))
  assert.match(plain, /\[M\] hello$/)
})

test('formatLogLine: 循环引用元数据不抛错（降级为字符串）', () => {
  const { formatLogLine } = transpileLogger()
  const circular = {}
  circular.self = circular
  const line = formatLogLine('error', 'M', 'boom', circular)
  assert.match(line, /\[M\] boom/)
})
