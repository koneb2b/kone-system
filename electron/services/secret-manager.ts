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

/**
 * 将被隔离的密钥文件**留档重命名**（绝不静默删除）。
 * 解密失败的历史文件先备份为 `kone-secrets.json.corrupt-<ts>`，再由后续写入生成新的可解密文件。
 */
const quarantineCorruptSecretFile = (filePath: string) => {
  try {
    const backup = `${filePath}.corrupt-${Date.now()}`
    fs.renameSync(filePath, backup)
    console.error(`[Secret] 已将被隔离的密钥文件留档为：${backup}`)
  } catch (renameError: any) {
    console.error('[Secret] 密钥文件留档重命名失败：', renameError?.message || renameError)
  }
}

const readSecretMap = (): SecretMap => {
  const filePath = getSecretFilePath()
  if (!fs.existsSync(filePath)) return {}

  const raw = fs.readFileSync(filePath, 'utf8')
  if (!raw.trim()) return {}

  let payload: SecretStorePayload
  try {
    payload = JSON.parse(raw) as SecretStorePayload
  } catch {
    return {}
  }
  if (!payload?.encrypted || typeof payload.data !== 'string') return {}

  ensureEncryptionAvailable()
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(payload.data, 'base64'))
    const parsed = JSON.parse(decrypted)
    return parsed && typeof parsed === 'object' ? (parsed as SecretMap) : {}
  } catch (error: any) {
    /* 解密失败（常见原因：secrets 文件由**其它机器 / 其它 DPAPI 上下文**写入，或文件损坏）。
     *
     * 绝不能抛错 —— 否则会引发**连锁致命**后果：
     *   · `getSecret` 全线抛错 → Provider/搜索取不到密钥；
     *   · `migrateSecrets` 抛错 → `main.ts` 的 whenReady 链中断 → **createMainWindow 不执行 → 应用无窗口、彻底变砖**，
     *     用户连"进设置页重新录入密钥"这条唯一恢复路径都走不到（2026-10-12 实测复现）。
     *
     * 正确语义：Fail-Closed 应作用于**单个能力**（取不到密钥即视为"未配置"），而非整个应用。
     * 处置：把无法解密的历史文件**留档**，本次返回空映射；用户重新录入密钥即可恢复。 */
    quarantineCorruptSecretFile(filePath)
    console.error('[Secret] 密钥文件无法解密（已留档并降级为"无密钥"）：', error?.message || error)
    return {}
  }
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
