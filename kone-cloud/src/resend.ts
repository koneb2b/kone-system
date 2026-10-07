// ───────────────────────────────────────────────────────────────
// Kone Cloud Worker · Resend API Client
// Isolated to enable deterministic E2E testing via module hook.
// ───────────────────────────────────────────────────────────────

export interface SendEmailParams {
  from: string
  to: string[]
  subject: string
  html: string
}

export interface SendEmailResult {
  id: string
}

// ── Test hook ──────────────────────────────────────────────────
// Cloudflare Workers forbids crossing I/O (ReadableStream, Response bodies)
// between request contexts — including from a test-file to the worker's
// service-worker context. To keep E2E tests deterministic without real
// network access, tests may call `setTestSendResult()` from the same
// module scope (via `cloudflare:workers`) to short-circuit the network.
let testSendResult: (() => Promise<SendEmailResult>) | null = null

export function setTestSendResult(fn: (() => Promise<SendEmailResult>) | null): void {
  testSendResult = fn
}

/**
 * Send a single email through the Resend API.
 *
 * @param params - Email content
 * @param apiKey - Resend API key
 * @returns Resend's response envelope containing the message ID.
 */
export async function sendEmailViaResend(
  params: SendEmailParams,
  apiKey: string,
): Promise<SendEmailResult> {
  if (testSendResult) {
    return testSendResult()
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Resend API returned ${response.status}: ${text}`)
  }

  const data = (await response.json()) as SendEmailResult
  if (!data.id) {
    throw new Error('Resend API response missing message id')
  }
  return data
}
