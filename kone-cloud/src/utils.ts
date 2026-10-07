// ───────────────────────────────────────────────────────────────
// Shared utilities for Kone Cloud Worker
// ───────────────────────────────────────────────────────────────

/** Generate a UUID-like ID (UUIDv7 approximation for D1) */
export function generateId(): string {
  const now = BigInt(Date.now())
  const random = crypto.getRandomValues(new Uint8Array(8))
  const randHex = Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('')
  return `id_${now.toString(16)}_${randHex}`
}

/** Current UTC time as ISO8601 string */
export function nowUTC(): string {
  return new Date().toISOString()
}

/** Normalize email: trim, lowercase */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Normalize domain: trim, lowercase, strip www. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '')
}

/** JSON response helper */
export function jsonResponse<T>(body: ApiSuccess<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Error response helper */
export function errorResponse(code: string, message: string, requestId: string, status = 400): Response {
  const statusMap: Record<string, number> = {
    AUTHENTICATION_FAILED: 401,
    UNAUTHORIZED: 401,
    TENANT_MISMATCH: 403,
    SCHEMA_VERSION_MISMATCH: 400,
    VALIDATION_ERROR: 400,
    NOT_FOUND: 404,
    TEAM_COLLISION: 409,
    SUPPRESSED: 403,
    IDEMPOTENCY_CONFLICT: 409,
    LEAD_NOT_FOUND: 404,
    LEAD_NOT_APPROVED: 400,
    OUTREACH_NOT_FOUND: 404,
    CIRCUIT_OPEN: 423,
    RATE_LIMITED: 429,
    INTERNAL_ERROR: 500,
  }
  const httpStatus = statusMap[code] ?? status
  return new Response(
    JSON.stringify({ success: false, code, message, requestId } satisfies ApiError),
    { status: httpStatus, headers: { 'Content-Type': 'application/json' } }
  )
}

/** Parse JSON body safely */
export async function parseJson<T = unknown>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

/** SHA-256 hash (hex string) */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Map with bounded concurrency */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runnerCount = Math.max(1, Math.min(limit, items.length || 1))
  const runner = async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: runnerCount }, () => runner()))
  return results
}

// ── Type exports ──
export type ApiError = {
  success: false
  code: string
  message: string
  suggestion?: string
  requestId: string
}

export type ApiSuccess<T> = {
  success: true
  data: T
  requestId: string
}
