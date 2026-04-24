import * as crypto from 'crypto'

export type OfflineLicenseClaims = {
  licenseKey: string
  machineId: string
  plan: 'trial' | 'basic' | 'premium' | 'pro' | 'enterprise'
  status: 'active' | 'expired'
  expiresAt: number
  features: string[]
  issuedAt: number
}

export type OfflineLicenseEnvelope = {
  claims: OfflineLicenseClaims
  signature: string
}

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2JEazHZuA3xwm15OCoID
trHjyZrWpXeDD7xWhzHry0Ej2+8M8MOWOd1gU4KMiTHuAnbSOeEPhkXGQNGdsfjZ
hFOyqfIWRy8bNJSJsbI0NXlomn3qIqwiprnCju3LD5nz8loXun1/QUuG/hV1wwcn
x2GlOU6kQohjFi4ToK/UO2BmSi6mPScaDpbsCD4zePCWaRbb+SdRO1yQayI1A3uW
X0PoydDOG78zBLqkAZcCWF8+2bTNZytxlG9MdnTA8YrqvKxonEmnlUWKBTc3qwnw
Lq/JOztKhC2TzefES0S9Iuc9s2FTRuL40ZSRqIkFah586tmcifNSukW3yHh/9pu+
UwIDAQAB
-----END PUBLIC KEY-----`;

const LICENSE_INVALID_MESSAGE = '授权文件无效，请联系顾问重新生成'

const parseEnvelope = (value: string): OfflineLicenseEnvelope => {
  const parsed = JSON.parse(value) as OfflineLicenseEnvelope
  if (!parsed?.claims || typeof parsed.signature !== 'string') {
    throw new Error(LICENSE_INVALID_MESSAGE)
  }
  return parsed
}

const normalizeEnvelope = (payload: string): OfflineLicenseEnvelope => {
  const trimmed = String(payload || '').trim()
  if (!trimmed) throw new Error(LICENSE_INVALID_MESSAGE)

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8').trim()

    if (decoded) {
      return parseEnvelope(decoded)
    }
  } catch {
    // Fallback to legacy raw JSON payload below.
  }

  try {
    return parseEnvelope(trimmed)
  } catch {
    throw new Error(LICENSE_INVALID_MESSAGE)
  }
}

export const verifyOfflineLicensePayload = (payload: string, machineId: string) => {
  const envelope = normalizeEnvelope(payload)
  const claims = envelope.claims

  const verify = crypto.createVerify('RSA-SHA256')
  verify.update(JSON.stringify(claims))
  verify.end()

  const signatureValid = verify.verify(PUBLIC_KEY_PEM, Buffer.from(envelope.signature, 'base64'))
  if (!signatureValid) {
    throw new Error(LICENSE_INVALID_MESSAGE)
  }

  if (claims.machineId !== machineId) {
    throw new Error('当前授权与本设备不匹配，请核对设备识别码')
  }

  if (claims.status !== 'active') {
    throw new Error('授权状态异常，请联系顾问处理')
  }

  if (!claims.expiresAt || claims.expiresAt <= Date.now()) {
    throw new Error('授权已过期，请联系顾问续费')
  }

  return claims
}
