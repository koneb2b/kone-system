import { app, safeStorage } from './electron-bridge'
import * as fs from 'fs'
import * as path from 'path'

type SecretStorePayload = {
  v: 1
  encrypted: true
  data: string
  updatedAt: number
}

export type SecretDescriptor = {
  exists: boolean
  masked?: string
  updatedAt?: number
}

type SecretMap = Record<string, string>

const SECRET_FILE_NAME = 'kone-secrets.json'

const getSecretFilePath = () => path.join(app.getPath('userData'), SECRET_FILE_NAME)

const ensureEncryptionAvailable = () => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统不支持 safeStorage 加密')
  }
}

const maskSecret = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return '****'
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`
  }
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`
}

const readSecretMap = (): SecretMap => {
  const filePath = getSecretFilePath()
  if (!fs.existsSync(filePath)) return {}

  const raw = fs.readFileSync(filePath, 'utf8')
  if (!raw.trim()) return {}

  const payload = JSON.parse(raw) as SecretStorePayload
  if (!payload?.encrypted || typeof payload.data !== 'string') return {}

  ensureEncryptionAvailable()
  const decrypted = safeStorage.decryptString(Buffer.from(payload.data, 'base64'))
  const parsed = JSON.parse(decrypted)
  return parsed && typeof parsed === 'object' ? (parsed as SecretMap) : {}
}

const writeSecretMap = (secrets: SecretMap) => {
  ensureEncryptionAvailable()
  const encrypted = safeStorage.encryptString(JSON.stringify(secrets))
  const payload: SecretStorePayload = {
    v: 1,
    encrypted: true,
    data: encrypted.toString('base64'),
    updatedAt: Date.now(),
  }
  fs.writeFileSync(getSecretFilePath(), JSON.stringify(payload), 'utf8')
}

export const setSecret = (key: string, value: string) => {
  const secretKey = key.trim()
  if (!secretKey) throw new Error('Secret key is required')
  const secrets = readSecretMap()
  secrets[secretKey] = value
  writeSecretMap(secrets)
  return { exists: true, masked: maskSecret(value) }
}

export const getSecret = (key: string) => {
  const secrets = readSecretMap()
  return secrets[key] || ''
}

export const checkSecret = (key: string): SecretDescriptor => {
  const secrets = readSecretMap()
  const value = secrets[key]
  if (!value) return { exists: false }
  return { exists: true, masked: maskSecret(value) }
}

export const clearSecret = (key: string) => {
  const secrets = readSecretMap()
  if (!(key in secrets)) return
  delete secrets[key]
  writeSecretMap(secrets)
}

export const migrateSecrets = (entries: Array<{ key: string; value?: string | null }>) => {
  const secrets = readSecretMap()
  let changed = false

  for (const entry of entries) {
    const secretKey = entry.key?.trim()
    const secretValue = entry.value?.trim()
    if (!secretKey || !secretValue) continue
    if (secrets[secretKey] === secretValue) continue
    secrets[secretKey] = secretValue
    changed = true
  }

  if (changed) {
    writeSecretMap(secrets)
  }

  return changed
}
