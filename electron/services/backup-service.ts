/**
 * Kone User Data Backup Service
 *
 * Automatically backs up critical user data (config, license, settings)
 * to a rotating set of backup files. Each backup includes integrity
 * verification via checksum.
 *
 * Retention: max 7 backups, oldest auto-deleted on rotation.
 * Frequency: checks every 24 hours at startup.
 */

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'
import { app } from './electron-bridge'

const BACKUP_DIR = 'backups'
const BACKUP_PREFIX = 'backup-'
const MAX_BACKUPS = 7
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB

interface BackupEntry {
  filePath: string
  checksum: string
  content: string // JSON data
}

interface BackupResult {
  success: boolean
  path?: string
  error?: string
  timestamp?: string
}

interface BackupMeta {
  timestamp: string
  files: Record<string, { path: string; checksum: string; size: number }>
}

let _initialized = false
let _lastBackupTime = 0

function getBackupDir(): string {
  const userData = app.getPath('userData')
  const dir = path.join(userData, BACKUP_DIR)
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (e) {
      throw new Error(`Cannot create backup directory: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
  }
  return dir
}

function computeChecksum(data: string): string {
  return crypto.createHash('md5').update(data, 'utf-8').digest('hex')
}

function getSourceFiles(): Record<string, string> {
  const userData = app.getPath('userData')
  const files: Record<string, string> = {}

  // Config store files
  const configCandidates = ['config.json', 'config-store.json', 'user-config.json']
  for (const name of configCandidates) {
    const p = path.join(userData, name)
    if (fs.existsSync(p)) {
      files[name] = p
      break
    }
  }

  // License/anchor files
  const anchorCandidates = ['anchor.bin', '.anchor.bin', '.anchor']
  for (const name of anchorCandidates) {
    const p = path.join(userData, name)
    if (fs.existsSync(p)) {
      files[name] = p
      break
    }
  }

  // Root anchor files
  const homeAnchorCandidates = ['.kone-config/anchor.bin', '.kone-config/.anchor.bin']
  for (const name of homeAnchorCandidates) {
    const p = path.join(os.homedir(), name)
    if (fs.existsSync(p)) {
      files[`home-${name.replace('/', '-')}`] = p
      break
    }
  }

  return files
}

function readSourceFile(filePath: string): { data: string; size: number } | null {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      console.warn(`[BackupService] Skipping large file: ${filePath} (${stat.size} bytes > ${MAX_FILE_SIZE_BYTES})`)
      return null
    }
    const data = fs.readFileSync(filePath, 'utf-8')
    return { data, size: stat.size }
  } catch (e) {
    console.warn(`[BackupService] Cannot read source file ${filePath}: ${e}`)
    return null
  }
}

function rotateBackups(): void {
  try {
    const dir = getBackupDir()
    const entries = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.json'))
      .map((name) => ({
        name,
        path: path.join(dir, name),
        mtime: fs.statSync(path.join(dir, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime) // newest first

    // Delete excess backups
    if (entries.length >= MAX_BACKUPS) {
      const toDelete = entries.slice(MAX_BACKUPS - 1) // keep MAX_BACKUPS-1 + the one we're about to create
      for (const entry of toDelete) {
        try {
          fs.unlinkSync(entry.path)
        } catch {
          // Delete failure - non-critical
        }
      }
    }
  } catch {
    // Rotation failure - non-critical
  }
}

/**
 * Perform a full backup of all tracked source files.
 * Returns the backup result with path and integrity info.
 */
export function triggerBackup(): BackupResult {
  try {
    const sourceFiles = getSourceFiles()
    if (Object.keys(sourceFiles).length === 0) {
      return { success: false, error: 'No source files found to back up' }
    }

    const backupData: Record<string, { path: string; checksum: string; content: string }> = {}

    for (const [key, filePath] of Object.entries(sourceFiles)) {
      const result = readSourceFile(filePath)
      if (result) {
        backupData[key] = {
          path: filePath,
          checksum: computeChecksum(result.data),
          content: result.data,
        }
      }
    }

    if (Object.keys(backupData).length === 0) {
      return { success: false, error: 'All source files are empty or unreadable' }
    }

    const meta: BackupMeta = {
      timestamp: new Date().toISOString(),
      files: Object.fromEntries(
        Object.entries(backupData).map(([key, val]) => [
          key,
          { path: val.path, checksum: val.checksum, size: val.content.length },
        ]),
      ),
    }

    const backupPayload = JSON.stringify({ meta, data: backupData }, null, 2)
    const fullChecksum = computeChecksum(backupPayload)
    const backupEntry: BackupEntry = {
      filePath: '',
      checksum: fullChecksum,
      content: backupPayload,
    }

    // Rotate old backups before writing
    rotateBackups()

    const dir = getBackupDir()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${BACKUP_PREFIX}${timestamp}.json`
    const filepath = path.join(dir, filename)
    backupEntry.filePath = filepath

    // Write backup with checksum envelope
    const envelope = JSON.stringify({
      checksum: fullChecksum,
      data: backupPayload,
    })
    fs.writeFileSync(filepath, envelope, 'utf-8')

    _lastBackupTime = Date.now()

    return {
      success: true,
      path: filepath,
      timestamp: meta.timestamp,
    }
  } catch (e) {
    return {
      success: false,
      error: String(e),
    }
  }
}

/**
 * Verify the integrity of a specific backup file.
 * @param backupPath Absolute path to the backup JSON file
 */
export function verifyBackup(backupPath: string): boolean {
  try {
    if (!fs.existsSync(backupPath)) return false
    const raw = fs.readFileSync(backupPath, 'utf-8')
    const envelope = JSON.parse(raw)

    // Verify checksum
    const storedChecksum = envelope.checksum
    const data = envelope.data
    const computedChecksum = computeChecksum(data)

    if (storedChecksum !== computedChecksum) {
      console.error(`[BackupService] Checksum mismatch for ${backupPath}`)
      return false
    }

    // Verify JSON structure
    const parsed = JSON.parse(data)
    if (!parsed.meta || !parsed.data) {
      console.error(`[BackupService] Invalid backup structure for ${backupPath}`)
      return false
    }

    return true
  } catch (e) {
    console.error(`[BackupService] Verification failed for ${backupPath}: ${e}`)
    return false
  }
}

/**
 * List all available backups.
 * Returns array of { path, timestamp, size, valid } objects.
 */
export function getBackupList(): Array<{
  path: string
  timestamp: string | null
  size: number
  valid: boolean
}> {
  try {
    const dir = getBackupDir()
    const entries = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.json'))
      .map((name) => {
        const fullPath = path.join(dir, name)
        try {
          const stat = fs.statSync(fullPath)
          const valid = verifyBackup(fullPath)
          let timestamp: string | null = null
          try {
            const raw = fs.readFileSync(fullPath, 'utf-8')
            const envelope = JSON.parse(raw)
            const parsed = JSON.parse(envelope.data)
            timestamp = parsed.meta?.timestamp || null
          } catch {
            // Cannot parse timestamp
          }
          return {
            path: fullPath,
            timestamp,
            size: stat.size,
            valid,
          }
        } catch {
          return {
            path: fullPath,
            timestamp: null,
            size: 0,
            valid: false,
          }
        }
      })
      .sort((a, b) => {
        // Sort newest first (by filename timestamp if available)
        if (a.timestamp && b.timestamp) return b.timestamp.localeCompare(a.timestamp)
        return b.path.localeCompare(a.path)
      })

    return entries
  } catch {
    return []
  }
}

/**
 * Initialize the backup service.
 * Checks if a backup is needed (last backup > 24h ago) and triggers one if so.
 * Called once at app startup.
 */
export function initBackupService(): void {
  if (_initialized) return
  _initialized = true

  // Check last backup time
  try {
    const backups = getBackupList()
    if (backups.length > 0) {
      const newest = backups[0]
      if (newest.timestamp) {
        const lastTime = new Date(newest.timestamp).getTime()
        if (Date.now() - lastTime < BACKUP_INTERVAL_MS) {
          console.log('[BackupService] Recent backup exists, skipping auto-backup')
          return
        }
      }
    }
  } catch {
    // Check failed - proceed to backup
  }

  // Trigger backup in background (don't block startup)
  setTimeout(() => {
    const result = triggerBackup()
    if (result.success) {
      console.log(`[BackupService] Auto-backup completed: ${result.path}`)
    } else {
      console.warn(`[BackupService] Auto-backup failed: ${result.error}`)
    }
  }, 5000) // 5 second delay to avoid impacting startup
}
