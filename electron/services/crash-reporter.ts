/**
 * Kone Crash Reporter
 *
 * Captures uncaught exceptions and unhandled rejections,
 * writes crash dumps to local disk, and optionally uploads
 * to a remote endpoint (user opt-in).
 *
 * Integrated with source-map-support for packaged stack
 * trace symbolication.
 */

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'
import { app } from './electron-bridge'

interface CrashDump {
  timestamp: string
  type: 'uncaughtException' | 'unhandledRejection'
  message: string
  stack: string
  version: string
  platform: string
  arch: string
  userData: string
  notes: string
}

interface CrashReporterConfig {
  enabled: boolean
  remoteUrl?: string
}

const CRASH_DIR = 'crash-reports'
const CONFIG_FILE = 'crash-reporter-config.json'

let _initialized = false
let _config: CrashReporterConfig = { enabled: false }

function getCrashDir(): string {
  const userData = app.getPath('userData')
  const dir = path.join(userData, CRASH_DIR)
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      // Cannot create crash dir - will try to write elsewhere
    }
  }
  return dir
}

function loadConfig(): CrashReporterConfig {
  try {
    const userData = app.getPath('userData')
    const configPath = path.join(userData, CONFIG_FILE)
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      return {
        enabled: parsed.enabled === true,
        remoteUrl: typeof parsed.remoteUrl === 'string' ? parsed.remoteUrl : undefined,
      }
    }
  } catch {
    // Config read failed - use defaults
  }
  return { enabled: false }
}

function saveConfig(config: CrashReporterConfig): void {
  try {
    const userData = app.getPath('userData')
    const configPath = path.join(userData, CONFIG_FILE)
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch {
    // Config write failed - non-critical
  }
}

function writeDump(dump: CrashDump): string | null {
  try {
    const dir = getCrashDir()
    const rand = crypto.randomBytes(2).toString('hex')
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
    const filename = `crash-${ts}-${rand}.json`
    const filepath = path.join(dir, filename)
    fs.writeFileSync(filepath, JSON.stringify(dump, null, 2), 'utf-8')
    return filepath
  } catch {
    return null
  }
}

function uploadDump(dump: CrashDump, filepath: string | null): void {
  if (!_config.enabled || !_config.remoteUrl) return
  try {
    const http = require('http')
    const https = require('https')
    const url = new URL(_config.remoteUrl)
    const mod = url.protocol === 'https:' ? https : http
    const payload = JSON.stringify({ dump, dumpPath: filepath })
    const req = mod.request(
      url.toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10000,
      },
      () => {
        // Upload completed (or failed)
      },
    )
    req.on('error', () => {
      // Upload failed - non-critical
    })
    req.write(payload)
    req.end()
  } catch {
    // Upload setup failed - non-critical
  }
}

function handleUncaughtException(error: Error): void {
  const dump: CrashDump = {
    timestamp: new Date().toISOString(),
    type: 'uncaughtException',
    message: error.message || String(error),
    stack: error.stack || '(no stack)',
    version: app.getVersion(),
    platform: os.platform(),
    arch: os.arch(),
    userData: app.getPath('userData'),
    notes: 'Uncaught exception - application will exit',
  }

  const filepath = writeDump(dump)
  uploadDump(dump, filepath)

  // Show error dialog
  try {
    const { exec } = require('child_process')
    const title = 'Kone AI - 发生错误'
    const msg = `应用遇到意外错误，即将关闭。\n\n${dump.message}`
    exec(`msg "%username%" "${title}: ${msg}"`, () => {})
  } catch {
    // Dialog not available
  }

  // Exit after short delay
  setTimeout(() => {
    process.exit(1)
  }, 5000)
}

function handleUnhandledRejection(reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack || '(no stack)' : '(no stack)'

  const dump: CrashDump = {
    timestamp: new Date().toISOString(),
    type: 'unhandledRejection',
    message,
    stack,
    version: app.getVersion(),
    platform: os.platform(),
    arch: os.arch(),
    userData: app.getPath('userData'),
    notes: 'Unhandled promise rejection - application continues',
  }

  const filepath = writeDump(dump)
  uploadDump(dump, filepath)

  console.error(`[CrashReporter] Unhandled rejection: ${message}`)
}

/**
 * Enable remote crash report upload.
 * @param remoteUrl The HTTP/HTTPS endpoint to POST crash dumps to
 */
export function enableRemoteUpload(remoteUrl: string): void {
  _config.enabled = true
  _config.remoteUrl = remoteUrl
  saveConfig(_config)
}

/**
 * Disable remote crash report upload.
 */
export function disableRemoteUpload(): void {
  _config.enabled = false
  _config.remoteUrl = undefined
  saveConfig(_config)
}

/**
 * Get current remote upload config.
 */
export function getRemoteUploadConfig(): { enabled: boolean; remoteUrl?: string } {
  return { enabled: _config.enabled, remoteUrl: _config.remoteUrl }
}

/**
 * Initialize the crash reporter.
 * Must be called once at app startup, before any other code.
 */
export function initCrashReporter(): void {
  if (_initialized) return
  _initialized = true

  // Integrate source-map-support for stack symbolication in packaged builds
  try {
    require('source-map-support/register')
  } catch {
    // source-map-support not available - stack traces won't be symbolicated
  }

  _config = loadConfig()

  process.on('uncaughtException', (error: Error) => {
    handleUncaughtException(error)
  })

  process.on('unhandledRejection', (reason: unknown) => {
    handleUnhandledRejection(reason)
  })

  console.log('[CrashReporter] Initialized. Remote upload:', _config.enabled ? 'enabled' : 'disabled')
}
