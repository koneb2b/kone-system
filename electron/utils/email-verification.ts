/**
 * email-verification.ts — 商用级邮箱五级验证引擎（P0-3，G3 缺口闭环）
 *
 * 五级分级（对齐路线图 Verified/Probable/Catch_all/Risky/Invalid）:
 * - verified : RCPT 250 且域名非 catch-all、非 role/disposable
 * - probable : 灰名单退避后仍 4xx、SMTP 无定论（超时/连接失败）——不可假 verified
 * - catch_all: RCPT 250 但服务器对任意不存在地址同样接受，真实可投递性未知
 * - risky    : 一次性域名 / role-account（info@ sales@ 等）——邮箱真实但非决策人
 * - invalid  : 格式非法 / 无 MX / RCPT 硬拒（5xx）
 *
 * valid 映射: verified/probable/catch_all → true；risky/invalid → false。
 * 所有网络探测均带超时并 resolve（永不 reject），串行调用方（automation-service）
 * 依赖此语义。
 */
import * as net from 'net'
import * as dns from 'dns'

export type EmailGrade = 'verified' | 'probable' | 'catch_all' | 'risky' | 'invalid'

export type EmailVerificationResult = {
  email: string
  grade: EmailGrade
  valid: boolean
  reason?: string
}

/* RFC 5322 子集（实用主义版）：local part 限制为常见安全字符集，域名按 RFC 1035 标签。 */
const EMAIL_FORMAT_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i

/* 内置一次性邮箱域名黑名单（可按需扩充；外部源接入属 P2 范围）。 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  '10minutemail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'sharklasers.com',
  'yopmail.com',
  'yopmail.fr',
  'trashmail.com',
  'trashmail.de',
  'tempmail.com',
  'temp-mail.org',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
  'mailnesia.com',
  'throwawaymail.com',
  'maildrop.com',
  'fakeinbox.com',
  'spamgourmet.com',
  'burnermail.io',
  'tempr.email',
  'discard.email',
  'mailcatch.com',
  'mohmal.com',
  'emailondeck.com',
  'mail7.io',
  'linshiyouxiang.net',
  '027168.com',
  'mailtemp.net',
  'tempmail.plus',
  'minuteinbox.com',
])

/* role-account：真实存在但通常非决策人本人，触达转化率低，标记 risky。 */
const ROLE_ACCOUNT_LOCALPARTS = new Set([
  'info',
  'sales',
  'support',
  'contact',
  'admin',
  'hello',
  'office',
  'enquiries',
  'inquiry',
  'service',
  'marketing',
  'help',
  'noreply',
  'no-reply',
  'donotreply',
  'webmaster',
  'postmaster',
  'abuse',
  'billing',
  'careers',
  'jobs',
  'hr',
  'press',
])

export const classifyEmailStatic = (
  email: string,
): { localPart: string; domain: string; grade?: EmailGrade; reason?: string } => {
  const trimmed = String(email || '')
    .trim()
    .toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (!trimmed || at <= 0 || !EMAIL_FORMAT_RE.test(trimmed)) {
    return { localPart: '', domain: '', grade: 'invalid', reason: '格式无效' }
  }
  const localPart = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { localPart, domain, grade: 'risky', reason: '一次性邮箱域名' }
  }
  if (ROLE_ACCOUNT_LOCALPARTS.has(localPart) || ROLE_ACCOUNT_LOCALPARTS.has(localPart.split(/[.+]/)[0])) {
    return { localPart, domain, grade: 'risky', reason: '公共角色邮箱（info@/sales@ 等），非决策人' }
  }
  return { localPart, domain }
}

const resolveMx = (domain: string): Promise<string | null> =>
  new Promise((resolve) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err || !addresses?.length) return resolve(null)
      const sorted = addresses.sort((a, b) => a.priority - b.priority)
      resolve(sorted[0].exchange)
    })
  })

type RcptProbeResult = {
  accepted: boolean
  code: number
  /* 4xx（421/450 等）——灰名单或临时拒绝，可退避重试 */
  greylisted: boolean
  error?: string
}

const SMTP_PROBE_TIMEOUT_MS = 8000
const GREYLIST_RETRY_DELAY_MS = 1500

const smtpRcptProbe = (mxHost: string, email: string, timeoutMs = SMTP_PROBE_TIMEOUT_MS): Promise<RcptProbeResult> =>
  new Promise((resolve) => {
    const socket = new net.Socket()
    let resolved = false
    const done = (result: RcptProbeResult) => {
      if (resolved) return
      resolved = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => done({ accepted: false, code: 0, greylisted: false, error: 'SMTP 连接超时' }))
    socket.on('error', () => done({ accepted: false, code: 0, greylisted: false, error: 'SMTP 连接失败' }))

    socket.connect(25, mxHost, () => {
      let phase = 0
      let buffer = ''

      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        if (!buffer.includes('\r\n')) return
        const code = parseInt(buffer.slice(0, 3), 10)
        buffer = ''

        if (phase === 0 && code === 220) {
          phase = 1
          socket.write('EHLO kone-verify.local\r\n')
        } else if (phase === 1 && (code === 250 || code === 220)) {
          phase = 2
          socket.write('MAIL FROM:<verify@kone-verify.local>\r\n')
        } else if (phase === 2 && code === 250) {
          phase = 3
          socket.write(`RCPT TO:<${email}>\r\n`)
        } else if (phase === 3) {
          socket.write('QUIT\r\n')
          done({
            accepted: code === 250,
            code,
            greylisted: code === 421 || code === 450 || code === 451,
            error: code !== 250 ? `RCPT 响应 ${code}` : undefined,
          })
        } else {
          socket.write('QUIT\r\n')
          done({ accepted: false, code, greylisted: false, error: `意外响应码 ${code}` })
        }
      })
    })
  })

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/* catch-all 探测：对真实地址 RCPT 250 的域名，再发一个必然不存在的地址。
   服务器同样接受 → catch-all 域名，本次 250 不构成可投递证据。 */
const probeCatchAll = async (mxHost: string, domain: string, timeoutMs?: number): Promise<boolean> => {
  const decoy = `verify-nonexist-${Math.random().toString(36).slice(2, 10)}@${domain}`
  const result = await smtpRcptProbe(mxHost, decoy, timeoutMs)
  return result.accepted
}

export const verifyEmailDetailed = async (
  email: string,
  options?: { greylistRetryDelayMs?: number; timeoutMs?: number },
): Promise<EmailVerificationResult> => {
  const trimmed = String(email || '')
    .trim()
    .toLowerCase()

  const finish = (grade: EmailGrade, reason?: string): EmailVerificationResult => ({
    email: trimmed,
    grade,
    valid: grade === 'verified' || grade === 'probable' || grade === 'catch_all',
    reason,
  })

  const staticResult = classifyEmailStatic(trimmed)
  if (staticResult.grade) {
    return finish(staticResult.grade, staticResult.reason)
  }
  const { domain } = staticResult

  const mxHost = await resolveMx(domain)
  if (!mxHost) {
    return finish('invalid', `域名 ${domain} 无 MX 记录`)
  }

  const probe = await smtpRcptProbe(mxHost, trimmed, options?.timeoutMs)

  if (probe.accepted) {
    const isCatchAll = await probeCatchAll(mxHost, domain, options?.timeoutMs)
    if (isCatchAll) {
      return finish('catch_all', '服务器接受任意地址（catch-all 域名），可投递性未证实')
    }
    return finish('verified')
  }

  if (probe.greylisted) {
    /* 灰名单退避重试一次；仍 4xx → probable（不可假 verified，也不武断 invalid）。 */
    await delay(options?.greylistRetryDelayMs ?? GREYLIST_RETRY_DELAY_MS)
    const retry = await smtpRcptProbe(mxHost, trimmed, options?.timeoutMs)
    if (retry.accepted) {
      const isCatchAll = await probeCatchAll(mxHost, domain, options?.timeoutMs)
      return isCatchAll ? finish('catch_all', 'catch-all 域名（灰名单退避后通过）') : finish('verified')
    }
    if (retry.greylisted) {
      return finish('probable', `灰名单未解除（RCPT ${retry.code}），无法确认`)
    }
    return finish('invalid', `RCPT 拒绝 (${retry.code})`)
  }

  if (probe.code >= 500 && probe.code < 600) {
    return finish('invalid', `RCPT 硬拒 (${probe.code})`)
  }

  /* 超时 / 连接失败 / 意外响应：证据不足，降级 probable 而非武断 invalid。 */
  return finish('probable', probe.error || 'SMTP 无定论')
}
