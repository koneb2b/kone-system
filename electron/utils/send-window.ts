/**
 * send-window.ts — 冷邮件收件人时区感知发送窗口（P1-4，缺口8）
 *
 * 产品主张：自动化触达仅在收件人当地时间 09:00-18:00 投递，避免深夜打扰与
 * 垃圾邮件信号。国家 → IANA 时区映射覆盖常用出口市场；映射缺失的国家**不拦截**
 * （诚实降级：宁可放行也不凭空猜测时区误伤投递）。
 */

const COUNTRY_IANA_TZ_MAP: Record<string, string> = {
  usa: 'America/New_York',
  'united states': 'America/New_York',
  'united states of america': 'America/New_York',
  canada: 'America/Toronto',
  mexico: 'America/Mexico_City',
  brazil: 'America/Sao_Paulo',
  argentina: 'America/Argentina/Buenos_Aires',
  chile: 'America/Santiago',
  colombia: 'America/Bogota',
  peru: 'America/Lima',
  uk: 'Europe/London',
  'united kingdom': 'Europe/London',
  ireland: 'Europe/Dublin',
  germany: 'Europe/Berlin',
  france: 'Europe/Paris',
  italy: 'Europe/Rome',
  spain: 'Europe/Madrid',
  portugal: 'Europe/Lisbon',
  netherlands: 'Europe/Amsterdam',
  belgium: 'Europe/Brussels',
  switzerland: 'Europe/Zurich',
  austria: 'Europe/Vienna',
  poland: 'Europe/Warsaw',
  'czech republic': 'Europe/Prague',
  hungary: 'Europe/Budapest',
  romania: 'Europe/Bucharest',
  greece: 'Europe/Athens',
  sweden: 'Europe/Stockholm',
  norway: 'Europe/Oslo',
  denmark: 'Europe/Copenhagen',
  finland: 'Europe/Helsinki',
  turkey: 'Europe/Istanbul',
  russia: 'Europe/Moscow',
  ukraine: 'Europe/Kyiv',
  japan: 'Asia/Tokyo',
  'south korea': 'Asia/Seoul',
  korea: 'Asia/Seoul',
  china: 'Asia/Shanghai',
  india: 'Asia/Kolkata',
  thailand: 'Asia/Bangkok',
  vietnam: 'Asia/Ho_Chi_Minh',
  indonesia: 'Asia/Jakarta',
  malaysia: 'Asia/Kuala_Lumpur',
  singapore: 'Asia/Singapore',
  philippines: 'Asia/Manila',
  pakistan: 'Asia/Karachi',
  bangladesh: 'Asia/Dhaka',
  uae: 'Asia/Dubai',
  'united arab emirates': 'Asia/Dubai',
  'saudi arabia': 'Asia/Riyadh',
  israel: 'Asia/Jerusalem',
  egypt: 'Africa/Cairo',
  'south africa': 'Africa/Johannesburg',
  nigeria: 'Africa/Lagos',
  australia: 'Australia/Sydney',
  'new zealand': 'Pacific/Auckland',
}

export const SEND_WINDOW_START_HOUR = 9
export const SEND_WINDOW_END_HOUR = 18

/* 收件人当地时间小时；时区不可解析时 resolved=false（调用方不拦截） */
export const resolveRecipientLocalHour = (
  country: string | undefined,
  date: Date = new Date(),
): { resolved: boolean; hour?: number } => {
  const key = String(country || '')
    .trim()
    .toLowerCase()
  const timeZone = COUNTRY_IANA_TZ_MAP[key]
  if (!timeZone) return { resolved: false }

  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    }).format(date)
    const hour = Number(formatted) % 24
    return Number.isFinite(hour) ? { resolved: true, hour } : { resolved: false }
  } catch {
    return { resolved: false }
  }
}

export type SendWindowDecision = {
  allowed: boolean
  resolved: boolean
  localHour?: number
  reason?: string
}

/* 09:00-18:00（含起点不含终点）窗口判定。时区未知 → 放行（resolved=false）。 */
export const isWithinSendWindow = (country: string | undefined, date: Date = new Date()): SendWindowDecision => {
  const { resolved, hour } = resolveRecipientLocalHour(country, date)
  if (!resolved) {
    return { allowed: true, resolved: false, reason: '时区未知，不拦截（诚实降级）' }
  }
  const allowed = hour! >= SEND_WINDOW_START_HOUR && hour! < SEND_WINDOW_END_HOUR
  return {
    allowed,
    resolved: true,
    localHour: hour,
    reason: allowed ? undefined : `收件人当地时间 ${hour} 时，超出 09:00-18:00 发送窗口`,
  }
}
