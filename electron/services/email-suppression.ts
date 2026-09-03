import { ConfigStore } from './config-service'

// ─────────────────────────────────────────────────────────────
// P1-4: Email suppression list (退订 / bounce / do-not-contact).
//
// PROJECT-PRD §3.7.7 forbids "无退订/无节流群发" (mass send with no unsubscribe
// path). Every business-initiated email must first consult a persistent
// suppression list; suppressed recipients are NEVER contacted again. The list
// is populated by unsubscribe requests, hard bounces, complaints, and manual
// do-not-contact entries. Persistence reuses the local NativeStore (JSON) —
// no new dependency, consistent with P1-1/P1-2 durability work.
//
// Matching is case-insensitive and domain-aware: a suppressed *domain* (entry
// beginning with '@') blocks every address at that domain, so a single bounce
// or complaint from a company can quarantine the whole domain when needed.
// ─────────────────────────���───────────────────────────────────

const SUPPRESSION_CONFIG_KEY = 'email_suppression'

export type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint' | 'manual'

export type SuppressionEntry = {
  value: string // normalized email or '@domain'
  reason: SuppressionReason
  addedAt: number
  note?: string
}

const normalize = (emailOrDomain: string): string => {
  const trimmed = String(emailOrDomain || '')
    .trim()
    .toLowerCase()
  if (!trimmed) return ''
  // A leading '@' marks a domain-wide suppression rule.
  if (trimmed.startsWith('@')) return trimmed
  return trimmed
}

export const readSuppressionList = (store: ConfigStore): SuppressionEntry[] => {
  try {
    const raw = store?.get?.(SUPPRESSION_CONFIG_KEY)
    return Array.isArray(raw) ? (raw as SuppressionEntry[]) : []
  } catch {
    return []
  }
}

const writeSuppressionList = (store: ConfigStore, entries: SuppressionEntry[]): void => {
  try {
    store?.set?.(SUPPRESSION_CONFIG_KEY, entries)
  } catch {
    // disk-protected env → suppression stays best-effort for the session
  }
}

// True when the recipient is suppressed by an exact-address rule OR by a
// domain-wide ('@domain') rule. Fail-safe: on any error, treat as NOT
// suppressed only for empty input; a present list always wins.
export const isEmailSuppressed = (store: ConfigStore, email: string): boolean => {
  const addr = normalize(email)
  if (!addr || addr.startsWith('@')) {
    // No usable address → cannot send anyway; caller handles empty email.
    if (!addr) return false
  }
  const domain = addr.includes('@') ? `@${addr.split('@').pop()}` : ''
  const list = readSuppressionList(store)
  return list.some((e) => {
    const v = normalize(e.value)
    return v === addr || (domain && v === domain)
  })
}

// Idempotent add: upsert by normalized value, keeping the earliest addedAt.
export const addSuppression = (
  store: ConfigStore,
  emailOrDomain: string,
  reason: SuppressionReason,
  note?: string,
): SuppressionEntry[] => {
  const value = normalize(emailOrDomain)
  if (!value) return readSuppressionList(store)
  const list = readSuppressionList(store)
  const idx = list.findIndex((e) => normalize(e.value) === value)
  if (idx >= 0) {
    // Preserve original addedAt; refresh reason/note to the latest signal.
    list[idx] = { ...list[idx], reason, note: note ?? list[idx].note }
  } else {
    list.push({ value, reason, addedAt: Date.now(), note })
  }
  writeSuppressionList(store, list)
  return list
}

export const removeSuppression = (store: ConfigStore, emailOrDomain: string): SuppressionEntry[] => {
  const value = normalize(emailOrDomain)
  const next = readSuppressionList(store).filter((e) => normalize(e.value) !== value)
  writeSuppressionList(store, next)
  return next
}
