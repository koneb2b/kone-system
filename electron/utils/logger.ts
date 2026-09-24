/**
 * logger.ts — 轻量结构化日志（商用加固 · 审计 G1「可观测性」）
 *
 * 设计目标（低侵入、高覆盖）：
 *   1. `createLogger(module)` —— 结构化日志 API（级别 + 模块标签 + 时间戳 + 元数据），供新代码使用。
 *   2. `initFileLogging(logDir)` —— **console 文件镜像**：包装 console.{log,warn,error,info}，
 *      使**既有**散落的 console 调用**无需逐个改写**即自动落盘（滚动文件，按天命名 + 保留 N 天）。
 *
 * 级别：debug(10) < info(20) < warn(30) < error(40)；阈值由 KONE_LOG_LEVEL 控制（默认 info；
 * 开发期 NODE_ENV!=='production' 时为 debug）。纯函数（格式化/过滤/命名）单独导出以便单测。
 */

/* eslint-disable no-console -- 本模块的职责即"console 输出 + 文件镜像"，console 调用是有意为之 */
import fs from 'fs'
import path from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** 纯函数：解析日志级别阈值（非法值回退 info） */
export const resolveThreshold = (raw?: string, isProduction = false): LogLevel => {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
  if (v in LEVEL_WEIGHT) return v as LogLevel
  return isProduction ? 'info' : 'debug'
}

/** 纯函数：判断某级别是否应输出 */
export const shouldLog = (level: LogLevel, threshold: LogLevel): boolean =>
  LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[threshold]

/** 纯函数：滚动日志文件名（按天） */
export const logFileName = (date: Date): string => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `kone-${y}${m}${d}.log`
}

/** 纯函数：单行结构化格式（人类可读；元数据 JSON 化） */
export const formatLogLine = (
  level: LogLevel,
  module: string,
  message: string,
  meta?: unknown,
  now = new Date(),
): string => {
  const ts = now.toISOString()
  const metaStr = meta === undefined ? '' : ` ${safeJson(meta)}`
  return `[${ts}] ${level.toUpperCase().padEnd(5)} [${module}] ${message}${metaStr}`
}

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

let logDirPath: string | null = null
let threshold: LogLevel = resolveThreshold(process.env.KONE_LOG_LEVEL, process.env.NODE_ENV === 'production')
let consoleSinkInstalled = false

const LOG_RETENTION_DAYS = 7

/** 删除超过保留期的日志文件（纯副作用，失败静默——日志不可影响主流程） */
const pruneOldLogs = (dir: string, now: Date): void => {
  try {
    const cutoff = now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    for (const name of fs.readdirSync(dir)) {
      if (!/^kone-\d{8}\.log$/.test(name)) continue
      const full = path.join(dir, name)
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full)
    }
  } catch {
    /* 日志清理失败不影响主流程 */
  }
}

const appendToFile = (line: string): void => {
  if (!logDirPath) return
  try {
    fs.appendFileSync(path.join(logDirPath, logFileName(new Date())), line + '\n', 'utf-8')
  } catch {
    /* 写日志失败不得影响主流程 */
  }
}

export type Logger = {
  debug: (message: string, meta?: unknown) => void
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

/** 结构化 logger 工厂（新代码使用） */
export const createLogger = (module: string): Logger => {
  const emit = (level: LogLevel, message: string, meta?: unknown) => {
    if (!shouldLog(level, threshold)) return
    const line = formatLogLine(level, module, message, meta)
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(line)
    appendToFile(line)
  }
  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
  }
}

/**
 * 初始化文件日志：建立 logDir 并把既有 console.{log,warn,error,info} 镜像到滚动文件。
 * 幂等（重复调用无副作用）。返回是否成功启用文件落盘。
 */
export const initFileLogging = (baseDir: string): boolean => {
  try {
    logDirPath = path.join(baseDir, 'logs')
    fs.mkdirSync(logDirPath, { recursive: true })
    pruneOldLogs(logDirPath, new Date())
  } catch {
    logDirPath = null
    return false
  }

  if (!consoleSinkInstalled) {
    consoleSinkInstalled = true
    const wrap = (method: 'log' | 'info' | 'warn' | 'error') => {
      const original = console[method].bind(console)
      console[method] = (...args: unknown[]) => {
        original(...args)
        appendToFile(
          `[${new Date().toISOString()}] ${method.toUpperCase().padEnd(5)} [console] ${args
            .map((a) => (typeof a === 'string' ? a : safeJson(a)))
            .join(' ')}`,
        )
      }
    }
    wrap('log')
    wrap('info')
    wrap('warn')
    wrap('error')
  }

  return true
}

/** 仅供测试：重置内部状态 */
export const __resetLoggerForTest = (): void => {
  logDirPath = null
  consoleSinkInstalled = false
  threshold = resolveThreshold(process.env.KONE_LOG_LEVEL, process.env.NODE_ENV === 'production')
}
