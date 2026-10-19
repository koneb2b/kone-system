// ───────────────────────────────────────────────────────────────
// Worker integration tests — Vitest + Miniflare
// Uses `cloudflare:workers` env bindings for automatic D1 injection
// ───────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { env } from 'cloudflare:workers'
import { SELF } from 'cloudflare:test'
import { setTestSendResult } from '../src/resend.js'

// ── Helper: seed a workspace into D1 ──
async function setupWorkspace(name: string): Promise<{ token: string; workspaceId: string }> {
  const token = `test-token-${name}-${Date.now()}`
  const tokenHash = await crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(token))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''))

  const workspaceId = `ws-${name}-${Date.now()}`
  await env.DB.prepare(
    `INSERT INTO workspaces (id, name, api_token_hash) VALUES (?, ?, ?)`
  ).bind(workspaceId, name, tokenHash).run()

  return { token, workspaceId }
}

function bearerHeader(token: string): Headers {
  return new Headers({
    'Authorization': `Bearer ${token}`,
    'X-Schema-Version': '1.0.0',
  })
}

async function fetchWorker(url: string, init?: RequestInit): Promise<Response> {
  return await SELF.fetch(`https://api.example.com${url}`, init)
}

// ── Helper: Svix-style Resend webhook signature ──
// Mirrors https://docs.svix.com/receiving/verifying-payloads/how-manual
// signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
// signature     = base64(HMAC-SHA256(keyBytes, signedContent))
// keyBytes      = base64Decode(secret without `whsec_` prefix)
const TEST_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test_webhook_secret_123').toString('base64')

async function svixSignature(payload: string): Promise<{
  'svix-id': string
  'svix-timestamp': string
  'svix-signature': string
}> {
  const id = `msg_${Date.now()}_${Math.floor(Math.random() * 100000)}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const secretBase64 = TEST_WEBHOOK_SECRET.replace('whsec_', '')
  const keyBytes = Uint8Array.from(Buffer.from(secretBase64, 'base64'))

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signedContent = `${id}.${timestamp}.${payload}`
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(signedContent)))
  let binary = ''
  for (const b of sig) binary += String.fromCharCode(b)
  const sigBase64 = Buffer.from(binary, 'binary').toString('base64')

  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${sigBase64}`,
  }
}

describe('Kone Cloud Worker', () => {
  let token: string
  let workspaceId: string

  beforeAll(async () => {
    const setup = await setupWorkspace('test')
    token = setup.token
    workspaceId = setup.workspaceId
  })

  // ── Health check (no auth) ──
  describe('GET /healthz', () => {
    it('returns ok without auth', async () => {
      const response = await fetchWorker('/healthz')
      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: { status: string } }
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('ok')
    })
  })

  // ── Auth ──
  describe('Authentication', () => {
    it('rejects request without Authorization header', async () => {
      const response = await fetchWorker('/v1/leads', {
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        body: '{}',
      })
      expect(response.status).toBe(401)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('AUTHENTICATION_FAILED')
    })

    it('rejects invalid token', async () => {
      const headers = bearerHeader('invalid-token-12345')
      headers.set('Content-Type', 'application/json')
      const response = await fetchWorker('/v1/leads', {
        method: 'POST',
        headers,
        body: '{}',
      })
      expect(response.status).toBe(401)
    })
  })

  // ── POST /leads ──
  describe('POST /leads', () => {
    it('creates a lead successfully', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')
      headers.set('Idempotency-Key', `idem-${Date.now()}`)

      const payload = {
        workspaceId,
        localRefId: `lead-${Date.now()}`,
        normalizedDomain: 'example.com',
        company: 'Example Inc',
        country: 'US',
        contact: { name: 'John Doe', normalizedEmail: 'john@example.com', title: 'CTO' },
        score: 85,
        evidenceSummary: { matchReasons: ['AI/ML'], urls: ['https://example.com'] },
        riskFlags: { dns: 'safe', emailGrade: 'verified' },
        emailVerificationGrade: 'verified',
        draftVersion: 1,
      }

      const response = await fetchWorker('/v1/leads', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        success: boolean
        data: { status: string; approvalRequired: boolean; collision: boolean }
        requestId: string
      }
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('scored')
      expect(body.data.approvalRequired).toBe(true)
      expect(body.data.collision).toBe(false)
      expect(body.requestId).toBeDefined()
    })

    it('returns idempotent response for duplicate Idempotency-Key', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')
      headers.set('Idempotency-Key', 'fixed-idempotency-key-123')

      const payload = {
        workspaceId,
        localRefId: `lead-idem-${Date.now()}`,
        normalizedDomain: 'idempotent.com',
        company: 'Idempotent Inc',
        contact: { name: 'Alice', normalizedEmail: 'alice@idempotent.com' },
        score: 90,
      }

      const r1 = await fetchWorker('/v1/leads', { method: 'POST', headers, body: JSON.stringify(payload) })
      const b1 = (await r1.json()) as { success: boolean; data: { id: string } }
      expect(b1.success).toBe(true)

      // Second call with same idempotency key
      const r2 = await fetchWorker('/v1/leads', { method: 'POST', headers, body: JSON.stringify(payload) })
      const b2 = (await r2.json()) as { success: boolean; data: { id: string; idempotent: boolean } }
      expect(b2.success).toBe(true)
      expect(b2.data.id).toBe(b1.data.id)
      expect(b2.data.idempotent).toBe(true)
    })

    it('rejects lead with suppressed email', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')
      headers.set('Idempotency-Key', `idem-suppressed-${Date.now()}`)

      // Insert a global suppression first
      await env.DB.prepare(
        `INSERT INTO suppressions (id, workspace_id, normalized_email, reason, source, added_at)
         VALUES ('supp-test-1', NULL, 'blocked@example.com', 'one_click_unsubscribe', 'webhook', ?)`
      ).bind(new Date().toISOString()).run()

      const payload = {
        workspaceId,
        localRefId: `lead-suppressed-${Date.now()}`,
        normalizedDomain: 'blocked.com',
        company: 'Blocked Inc',
        contact: { name: 'Blocked', normalizedEmail: 'blocked@example.com' },
        score: 95,
      }

      const response = await fetchWorker('/v1/leads', { method: 'POST', headers, body: JSON.stringify(payload) })
      expect(response.status).toBe(403)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('SUPPRESSED')
    })

    it('rejects workspace mismatch', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')
      headers.set('Idempotency-Key', `idem-mismatch-${Date.now()}`)

      const payload = {
        workspaceId: 'wrong-workspace-id',
        localRefId: `lead-mismatch-${Date.now()}`,
        normalizedDomain: 'mismatch.com',
        company: 'Mismatch Inc',
        contact: { name: 'Test', normalizedEmail: 'test@mismatch.com' },
        score: 50,
      }

      const response = await fetchWorker('/v1/leads', { method: 'POST', headers, body: JSON.stringify(payload) })
      expect(response.status).toBe(403)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('TENANT_MISMATCH')
    })

    it('rejects missing Idempotency-Key header', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')

      const payload = {
        workspaceId,
        localRefId: `lead-noidem-${Date.now()}`,
        normalizedDomain: 'noidem.com',
        company: 'NoIdem Inc',
        contact: { name: 'No Idem', normalizedEmail: 'no-idem@example.com' },
        score: 50,
      }

      const response = await fetchWorker('/v1/leads', { method: 'POST', headers, body: JSON.stringify(payload) })
      expect(response.status).toBe(400)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('VALIDATION_ERROR')
    })

    it('rejects wrong schema version', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')
      headers.set('Idempotency-Key', `idem-badver-${Date.now()}`)
      headers.set('X-Schema-Version', '9.9.9')

      const payload = {
        workspaceId,
        localRefId: `lead-badver-${Date.now()}`,
        normalizedDomain: 'badver.com',
        company: 'BadVer Inc',
        contact: { name: 'Bad Ver', normalizedEmail: 'bad-ver@example.com' },
        score: 50,
      }

      const response = await fetchWorker('/v1/leads', { method: 'POST', headers, body: JSON.stringify(payload) })
      expect(response.status).toBe(400)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('SCHEMA_VERSION_MISMATCH')
    })
  })

  // ── GET /leads ──
  describe('GET /leads', () => {
    it('returns an array of leads', async () => {
      const response = await fetchWorker('/v1/leads', { headers: bearerHeader(token) })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: { leads: unknown[] } }
      expect(body.success).toBe(true)
      expect(Array.isArray(body.data.leads)).toBe(true)
    })
  })

  // ── GET /events ──
  describe('GET /events', () => {
    it('returns an array of events', async () => {
      const response = await fetchWorker('/v1/events', { headers: bearerHeader(token) })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: { events: unknown[] } }
      expect(body.success).toBe(true)
      expect(Array.isArray(body.data.events)).toBe(true)
    })
  })

  // ── POST /suppressions/unsubscribe ──
  describe('POST /suppressions/unsubscribe', () => {
    it('adds email to suppression list', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')

      const payload = { email: 'unsubscribe-test@example.com' }
      const response = await fetchWorker('/v1/suppressions/unsubscribe', {
        method: 'POST', headers, body: JSON.stringify(payload),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: { suppressed: boolean } }
      expect(body.success).toBe(true)
      expect(body.data.suppressed).toBe(true)
    })

    it('rejects missing email field', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')

      const response = await fetchWorker('/v1/suppressions/unsubscribe', {
        method: 'POST', headers, body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('VALIDATION_ERROR')
    })
  })

  // ── GET /dashboard/stats ──
  describe('GET /dashboard/stats', () => {
    it('returns stats', async () => {
      const response = await fetchWorker('/v1/dashboard/stats', { headers: bearerHeader(token) })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: { leads: unknown; outreach: unknown; suppressions: number } }
      expect(body.success).toBe(true)
      expect(body.data).toHaveProperty('leads')
      expect(body.data).toHaveProperty('outreach')
      expect(body.data).toHaveProperty('suppressions')
    })
  })

  // ── 404 ──
  describe('Unknown routes', () => {
    it('returns NOT_FOUND for unknown route', async () => {
      const response = await fetchWorker('/v1/unknown-route', { headers: bearerHeader(token) })
      expect(response.status).toBe(404)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('NOT_FOUND')
    })
  })

  // ── Phase 2: Outreach 投递闭环 ──

  // Helper: create an approved lead for outreach testing
  async function createApprovedLead(): Promise<{ leadId: string }> {
    const headers = bearerHeader(token)
    headers.set('Content-Type', 'application/json')
    headers.set('Idempotency-Key', `idem-approved-${Date.now()}`)

    const localRefId = `lead-approved-${Date.now()}`
    const payload = {
      workspaceId,
      localRefId,
      normalizedDomain: 'approved.example.com',
      company: 'Approved Inc',
      contact: { name: 'Approved User', normalizedEmail: `approved-${Date.now()}@approved.example.com` },
      score: 95,
    }

    const response = await fetchWorker('/v1/leads', { method: 'POST', headers, body: JSON.stringify(payload) })
    const body = (await response.json()) as { success: boolean; data: { id: string } }
    expect(body.success).toBe(true)

    // Update lead status to 'approved'
    await env.DB.prepare(
      `UPDATE leads SET status = 'approved' WHERE id = ?`
    ).bind(body.data.id).run()

    return { leadId: body.data.id }
  }

  describe('POST /outreach/queue', () => {
    it('queues outreach for an approved lead', async () => {
      const { leadId } = await createApprovedLead()

      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')

      const payload = {
        leadId,
        subject: 'Test Outreach Subject',
        body: '<p>Test outreach body</p>',
      }

      const response = await fetchWorker('/v1/outreach/queue', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        success: boolean
        data: { id: string; status: string; queued: boolean }
      }
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('pending')
      expect(body.data.queued).toBe(true)
      expect(body.data.id).toBeDefined()
    })

    it('returns idempotent response for duplicate outreach queue', async () => {
      const { leadId } = await createApprovedLead()

      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')

      const payload = {
        leadId,
        subject: 'Duplicate Test',
        body: '<p>Duplicate body</p>',
      }

      const r1 = await fetchWorker('/v1/outreach/queue', { method: 'POST', headers, body: JSON.stringify(payload) })
      const b1 = (await r1.json()) as { success: boolean; data: { id: string } }
      expect(b1.success).toBe(true)

      // Second call for same lead
      const r2 = await fetchWorker('/v1/outreach/queue', { method: 'POST', headers, body: JSON.stringify(payload) })
      const b2 = (await r2.json()) as { success: boolean; data: { id: string; idempotent: boolean } }
      expect(b2.success).toBe(true)
      expect(b2.data.id).toBe(b1.data.id)
      expect(b2.data.idempotent).toBe(true)
    })

    it('rejects outreach for non-approved lead', async () => {
      // Create a lead but don't approve it
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')
      headers.set('Idempotency-Key', `idem-unapproved-${Date.now()}`)

      const leadPayload = {
        workspaceId,
        localRefId: `lead-unapproved-${Date.now()}`,
        normalizedDomain: 'unapproved.example.com',
        company: 'Unapproved Inc',
        contact: { name: 'Unapproved', normalizedEmail: `unapproved-${Date.now()}@unapproved.example.com` },
        score: 50,
      }

      const leadRes = await fetchWorker('/v1/leads', { method: 'POST', headers, body: JSON.stringify(leadPayload) })
      const leadBody = (await leadRes.json()) as { data: { id: string } }

      // Try to queue outreach for unapproved lead
      const outreachPayload = {
        leadId: leadBody.data.id,
        subject: 'Test',
        body: 'Test body',
      }

      const response = await fetchWorker('/v1/outreach/queue', {
        method: 'POST',
        headers,
        body: JSON.stringify(outreachPayload),
      })

      expect(response.status).toBe(400)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('LEAD_NOT_APPROVED')
    })

    it('rejects outreach with missing required fields', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')

      const response = await fetchWorker('/v1/outreach/queue', {
        method: 'POST',
        headers,
        body: JSON.stringify({ leadId: 'missing-fields' }),
      })

      expect(response.status).toBe(400)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /outreach/status', () => {
    it('returns an array of outreach', async () => {
      const response = await fetchWorker('/v1/outreach/status', { headers: bearerHeader(token) })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: { outreach: unknown[] } }
      expect(body.success).toBe(true)
      expect(Array.isArray(body.data.outreach)).toBe(true)
    })

    it('filters by status', async () => {
      const response = await fetchWorker('/v1/outreach/status?status=pending', { headers: bearerHeader(token) })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: { outreach: unknown[] } }
      expect(body.success).toBe(true)
      expect(Array.isArray(body.data.outreach)).toBe(true)
    })
  })

  describe('POST /cron/send', () => {
    it('rejects request without valid cron secret', async () => {
      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-Cron-Secret': 'invalid-secret',
      })

      const response = await fetchWorker('/v1/cron/send', {
        method: 'POST',
        headers,
        body: '{}',
      })

      expect(response.status).toBe(401)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('UNAUTHORIZED')
    })
  })

  // ── Phase 2.5: /outreach/reply endpoint (IMAP poller 上报回复) ──
  describe('POST /outreach/reply', () => {
    it('archives reply and marks outreach as replied', async () => {
      const { leadId } = await createApprovedLead()

      const queueHeaders = bearerHeader(token)
      queueHeaders.set('Content-Type', 'application/json')
      const queueRes = await fetchWorker('/v1/outreach/queue', {
        method: 'POST',
        headers: queueHeaders,
        body: JSON.stringify({ leadId, subject: 'Reply Test', body: '<p>hello</p>' }),
      })
      expect(queueRes.status).toBe(200)
      const queueBody = (await queueRes.json()) as { data: { id: string } }
      const outreachId = queueBody.data.id

      // Simulate a cron send so the outreach has a provider_message_id (a.k.a. resend_id)
      const replyMessageId = 'msg_reply_<original>'
      setTestSendResult(async () => ({ id: replyMessageId }))
      const cronHeaders = new Headers({
        'Content-Type': 'application/json',
        'X-Cron-Secret': 'test-cron-secret',
      })
      const cronRes = await fetchWorker('/v1/cron/send', { method: 'POST', headers: cronHeaders, body: '{}' })
      expect(cronRes.status).toBe(200)
      setTestSendResult(null)

      // Report a reply from the IMAP poller
      const reportHeaders = bearerHeader(token)
      reportHeaders.set('Content-Type', 'application/json')
      const reportBody = {
        outreachId,
        messageId: `reply-${Date.now()}@lead.example.com`,
        inReplyTo: replyMessageId,
        sender: 'lead@lead.example.com',
        subject: 'Re: Reply Test',
        replyBody: 'Hi, interested.',
      }
      const response = await fetchWorker('/v1/outreach/reply', {
        method: 'POST',
        headers: reportHeaders,
        body: JSON.stringify(reportBody),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        success: boolean
        data: { id: string; outreachId: string; status: string; idempotent: boolean }
      }
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('replied')
      expect(body.data.idempotent).toBe(false)
      expect(body.data.outreachId).toBe(outreachId)

      // Verify outreach row updated
      const outreachRow = await env.DB.prepare(
        `SELECT status, replied_at, provider_message_id FROM outreach WHERE id = ?`
      ).bind(outreachId).first<{ status: string; replied_at: string; provider_message_id: string }>()
      expect(outreachRow?.status).toBe('replied')
      expect(outreachRow?.replied_at).toBeDefined()
      expect(outreachRow?.provider_message_id).toBe(replyMessageId)

      // Verify reply archive row created
      const replyRow = await env.DB.prepare(
        `SELECT id, outreach_id, message_id, sender, subject FROM email_replies WHERE outreach_id = ?`
      ).bind(outreachId).first<{ id: string; message_id: string; sender: string; subject: string }>()
      expect(replyRow).toBeDefined()
      expect(replyRow?.sender).toBe('lead@lead.example.com')
      expect(replyRow?.subject).toBe('Re: Reply Test')

      // Verify audit event appended
      const events = await env.DB.prepare(
        `SELECT type, actor FROM events WHERE outreach_id = ? ORDER BY occurred_at DESC LIMIT 1`
      ).bind(outreachId).first<{ type: string; actor: string }>()
      expect(events?.type).toBe('outreach.replied')
      expect(events?.actor).toBe('imap_poller')
    })

    it('returns idempotent response for duplicate reply message', async () => {
      const { leadId } = await createApprovedLead()

      const queueHeaders = bearerHeader(token)
      queueHeaders.set('Content-Type', 'application/json')
      const queueRes = await fetchWorker('/v1/outreach/queue', {
        method: 'POST', headers: queueHeaders, body: JSON.stringify({ leadId, subject: 'Dup Reply', body: '<p>x</p>' }),
      })
      expect(queueRes.status).toBe(200)
      const outreachId = ((await queueRes.json()) as { data: { id: string } }).data.id

      const reportHeaders = bearerHeader(token)
      reportHeaders.set('Content-Type', 'application/json')
      const messageId = `dup-reply-${Date.now()}@lead.example.com`
      const reportBody = {
        outreachId, messageId, sender: 'lead@lead.example.com', subject: 'Re: Dup Reply',
      }
      const r1 = await fetchWorker('/v1/outreach/reply', { method: 'POST', headers: reportHeaders, body: JSON.stringify(reportBody) })
      const b1 = (await r1.json()) as { data: { idempotent: boolean } }
      expect(b1.data.idempotent).toBe(false)

      const r2 = await fetchWorker('/v1/outreach/reply', { method: 'POST', headers: reportHeaders, body: JSON.stringify(reportBody) })
      const b2 = (await r2.json()) as { success: boolean; data: { idempotent: boolean } }
      expect(b2.success).toBe(true)
      expect(b2.data.idempotent).toBe(true)
    })

    it('rejects reply with missing required fields', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')

      const response = await fetchWorker('/v1/outreach/reply', {
        method: 'POST',
        headers,
        body: JSON.stringify({ outreachId: 'only-one-field' }),
      })
      expect(response.status).toBe(400)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('VALIDATION_ERROR')
    })

    it('rejects reply for outreach in different workspace (tenant isolation)', async () => {
      const headers = bearerHeader(token)
      headers.set('Content-Type', 'application/json')

      const response = await fetchWorker('/v1/outreach/reply', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          outreachId: 'does-not-exist-in-this-ws',
          messageId: 'msg-1',
          sender: 'x@x.com',
        }),
      })
      expect(response.status).toBe(404)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('OUTREACH_NOT_FOUND')
    })
  })

  // ── Phase 2.5: email.opened / email.clicked webhook events ──
  describe('POST /webhooks/resend opened & clicked', () => {
    it('processes email.opened and sets email_opened_at + status=delivered', async () => {
      const { leadId } = await createApprovedLead()

      // Queue + send to have an outreach with resend_id
      const queueHeaders = bearerHeader(token)
      queueHeaders.set('Content-Type', 'application/json')
      const queueRes = await fetchWorker('/v1/outreach/queue', {
        method: 'POST', headers: queueHeaders, body: JSON.stringify({ leadId, subject: 'Open Click', body: '<p>x</p>' }),
      })
      const outreachId = ((await queueRes.json()) as { data: { id: string } }).data.id
      const mockId = `msg_opened_${Date.now()}`
      setTestSendResult(async () => ({ id: mockId }))
      const cronHeaders = new Headers({ 'Content-Type': 'application/json', 'X-Cron-Secret': 'test-cron-secret' })
      await fetchWorker('/v1/cron/send', { method: 'POST', headers: cronHeaders, body: '{}' })
      setTestSendResult(null)

      // Send email.opened webhook
      const payload = { type: 'email.opened', data: { id: mockId, to: ['lead@example.com'], subject: 'Open Click' } }
      const bodyStr = JSON.stringify(payload)
      const sig = await svixSignature(bodyStr)
      const headers = new Headers({
        'Content-Type': 'application/json',
        'svix-id': sig['svix-id'], 'svix-timestamp': sig['svix-timestamp'], 'svix-signature': sig['svix-signature'],
      })
      const response = await fetchWorker('/v1/webhooks/resend', { method: 'POST', headers, body: bodyStr })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: { processed: boolean; eventType: string } }
      expect(body.success).toBe(true)
      expect(body.data.eventType).toBe('email.opened')

      const row = await env.DB.prepare(
        `SELECT status, email_opened_at FROM outreach WHERE id = ?`
      ).bind(outreachId).first<{ status: string; email_opened_at: string }>()
      expect(row?.status).toBe('delivered')
      expect(row?.email_opened_at).toBeDefined()
    })

    it('processes email.clicked and sets email_clicked_at + status=delivered', async () => {
      const { leadId } = await createApprovedLead()

      const queueHeaders = bearerHeader(token)
      queueHeaders.set('Content-Type', 'application/json')
      const queueRes = await fetchWorker('/v1/outreach/queue', {
        method: 'POST', headers: queueHeaders, body: JSON.stringify({ leadId, subject: 'Click', body: '<p>x</p>' }),
      })
      const outreachId = ((await queueRes.json()) as { data: { id: string } }).data.id
      const mockId = `msg_clicked_${Date.now()}`
      setTestSendResult(async () => ({ id: mockId }))
      const cronHeaders = new Headers({ 'Content-Type': 'application/json', 'X-Cron-Secret': 'test-cron-secret' })
      await fetchWorker('/v1/cron/send', { method: 'POST', headers: cronHeaders, body: '{}' })
      setTestSendResult(null)

      const payload = { type: 'email.clicked', data: { id: mockId, to: ['lead@example.com'], subject: 'Click' } }
      const bodyStr = JSON.stringify(payload)
      const sig = await svixSignature(bodyStr)
      const headers = new Headers({
        'Content-Type': 'application/json',
        'svix-id': sig['svix-id'], 'svix-timestamp': sig['svix-timestamp'], 'svix-signature': sig['svix-signature'],
      })
      const response = await fetchWorker('/v1/webhooks/resend', { method: 'POST', headers, body: bodyStr })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { data: { eventType: string } }
      expect(body.data.eventType).toBe('email.clicked')

      const row = await env.DB.prepare(
        `SELECT status, email_clicked_at FROM outreach WHERE id = ?`
      ).bind(outreachId).first<{ status: string; email_clicked_at: string }>()
      expect(row?.status).toBe('delivered')
      expect(row?.email_clicked_at).toBeDefined()
    })
  })

  describe('POST /webhooks/resend', () => {
    it('processes webhook event and returns success', async () => {
      const payload = {
        type: 'email.sent',
        data: {
          id: `evt-${Date.now()}`,
          to: ['test@example.com'],
          subject: 'Test Subject',
          bounced: false,
        },
      }
      const bodyStr = JSON.stringify(payload)
      const sig = await svixSignature(bodyStr)
      const headers = new Headers({
        'Content-Type': 'application/json',
        'svix-id': sig['svix-id'],
        'svix-timestamp': sig['svix-timestamp'],
        'svix-signature': sig['svix-signature'],
      })

      const response = await fetchWorker('/v1/webhooks/resend', {
        method: 'POST',
        headers,
        body: bodyStr,
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: { processed: boolean } }
      expect(body.success).toBe(true)
      expect(body.data.processed).toBe(true)
    })

    it('rejects webhook without signature', async () => {
      const headers = new Headers({
        'Content-Type': 'application/json',
      })

      const payload = {
        type: 'email.sent',
        data: { id: 'test-event' },
      }

      const response = await fetchWorker('/v1/webhooks/resend', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      expect(response.status).toBe(401)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('UNAUTHORIZED')
    })

    it('rejects webhook with tampered signature', async () => {
      const payload = {
        type: 'email.sent',
        data: { id: `evt-tampered-${Date.now()}` },
      }
      const bodyStr = JSON.stringify(payload)
      const sig = await svixSignature(bodyStr)
      // Corrupt the signature to a different but structurally valid value
      const tampered = sig['svix-signature'].slice(0, 3) + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
      const headers = new Headers({
        'Content-Type': 'application/json',
        'svix-id': sig['svix-id'],
        'svix-timestamp': sig['svix-timestamp'],
        'svix-signature': tampered,
      })

      const response = await fetchWorker('/v1/webhooks/resend', {
        method: 'POST',
        headers,
        body: bodyStr,
      })

      expect(response.status).toBe(401)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('UNAUTHORIZED')
    })

    it('rejects webhook with stale timestamp (replay protection)', async () => {
      const payload = {
        type: 'email.sent',
        data: { id: `evt-stale-${Date.now()}` },
      }
      const bodyStr = JSON.stringify(payload)
      const sig = await svixSignature(bodyStr)

      // Backdate the timestamp by 20 minutes — well outside the 300s tolerance.
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 20 * 60)

      // Recompute a signature for the stale timestamp so only the timestamp check fails.
      const secretBase64 = TEST_WEBHOOK_SECRET.replace('whsec_', '')
      const keyBytes = Uint8Array.from(Buffer.from(secretBase64, 'base64'))
      const enc = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      )
      const signedContent = `${sig['svix-id']}.${staleTimestamp}.${bodyStr}`
      const sig2 = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(signedContent)))
      let binary = ''
      for (const b of sig2) binary += String.fromCharCode(b)
      const sig2Base64 = Buffer.from(binary, 'binary').toString('base64')

      const headers = new Headers({
        'Content-Type': 'application/json',
        'svix-id': sig['svix-id'],
        'svix-timestamp': staleTimestamp,
        'svix-signature': `v1,${sig2Base64}`,
      })

      const response = await fetchWorker('/v1/webhooks/resend', {
        method: 'POST',
        headers,
        body: bodyStr,
      })

      expect(response.status).toBe(401)
      const body = (await response.json()) as { code: string }
      expect(body.code).toBe('UNAUTHORIZED')
    })

    it('returns idempotent response for duplicate webhook event', async () => {
      const eventId = `evt-idempotent-${Date.now()}`
      const payload = {
        type: 'email.delivered',
        data: {
          id: eventId,
          to: ['test@example.com'],
          subject: 'Test',
          bounced: false,
        },
      }
      const bodyStr = JSON.stringify(payload)
      const sig = await svixSignature(bodyStr)
      const headers = new Headers({
        'Content-Type': 'application/json',
        'svix-id': sig['svix-id'],
        'svix-timestamp': sig['svix-timestamp'],
        'svix-signature': sig['svix-signature'],
      })

      const r1 = await fetchWorker('/v1/webhooks/resend', { method: 'POST', headers, body: bodyStr })
      const b1 = (await r1.json()) as { success: boolean; data: { processed: boolean } }
      expect(b1.success).toBe(true)

      // Second call with same event
      const r2 = await fetchWorker('/v1/webhooks/resend', { method: 'POST', headers, body: bodyStr })
      const b2 = (await r2.json()) as { success: boolean; data: { idempotent: boolean } }
      expect(b2.success).toBe(true)
      expect(b2.data.idempotent).toBe(true)
    })
  })

  // ── Phase 2 · P2-10: End-to-end Outreach Journey ──
  // Covers the full local → cloud → Resend → webhook → status loop with mocked Resend API.
  describe('Phase 2 · E2E Outreach Journey (Resend mocked)', () => {
    afterEach(() => {
      setTestSendResult(null)
    })

    it('full journey: approve → queue → cron send → webhook bounce → status reflects terminal state', async () => {
      // ── Step 1: Create lead and approve it ──
      const { leadId } = await createApprovedLead()

      // ── Step 2: Queue outreach ──
      const queueHeaders = bearerHeader(token)
      queueHeaders.set('Content-Type', 'application/json')
      const queuePayload = {
        leadId,
        subject: 'E2E Outreach',
        body: '<p>Hello from E2E</p>',
      }

      const queueResponse = await fetchWorker('/v1/outreach/queue', {
        method: 'POST', headers: queueHeaders, body: JSON.stringify(queuePayload),
      })
      expect(queueResponse.status).toBe(200)
      const queueBody = (await queueResponse.json()) as { success: boolean; data: { id: string; status: string; queued: boolean } }
      expect(queueBody.success).toBe(true)
      expect(queueBody.data.queued).toBe(true)
      const outreachId = queueBody.data.id

      // Verify lead status transitioned to 'queued'
      const leadAfterQueue = await env.DB.prepare(
        `SELECT status FROM leads WHERE id = ?`
      ).bind(leadId).first<{ status: string }>()
      expect(leadAfterQueue?.status).toBe('queued')

      // ── Step 3: Install a deterministic Resend mock and trigger cron send ──
      // Cloudflare Workers forbids crossing I/O (Response bodies, ReadableStreams)
      // between request contexts, so we inject the mock through the module-level
      // hook instead of stubbing globalThis.fetch.
      const mockResendId = 'msg_e2e_mock_1'
      let fetchCalls = 0
      setTestSendResult(async () => {
        fetchCalls += 1
        return { id: mockResendId }
      })

      const cronHeaders = new Headers({
        'Content-Type': 'application/json',
        'X-Cron-Secret': 'test-cron-secret',
      })
      const cronResponse = await fetchWorker('/v1/cron/send', {
        method: 'POST', headers: cronHeaders, body: '{}',
      })
      expect(cronResponse.status).toBe(200)
      const cronBody = (await cronResponse.json()) as { success: boolean; data: { sentCount: number; failedCount: number; resent: string[]; failed: string[] } }
      expect(cronBody.success).toBe(true)
      expect(cronBody.data.sentCount).toBeGreaterThanOrEqual(1)
      expect(cronBody.data.resent).toContain(outreachId)
      expect(fetchCalls).toBeGreaterThanOrEqual(1)

      // Verify outreach row persisted the resend message id and transitioned to 'sent'
      const outreachAfterSend = await env.DB.prepare(
        `SELECT status, resend_id, provider_message_id, send_attempts, sent_at, error FROM outreach WHERE id = ?`
      ).bind(outreachId).first<{
        status: string; resend_id: string; provider_message_id: string
        send_attempts: number; sent_at: string; error: string
      }>()
      expect(outreachAfterSend?.status).toBe('sent')
      expect(outreachAfterSend?.resend_id).toBe(mockResendId)
      expect(outreachAfterSend?.provider_message_id).toBe(mockResendId)
      expect(outreachAfterSend?.send_attempts).toBe(1)
      expect(outreachAfterSend?.sent_at).toBeDefined()

      // Verify event was appended
      const sentEvent = await env.DB.prepare(
        `SELECT type, actor, payload FROM events WHERE outreach_id = ? ORDER BY occurred_at DESC LIMIT 1`
      ).bind(outreachId).first<{ type: string; actor: string; payload: string }>()
      expect(sentEvent?.type).toBe('outreach.sent')
      expect(sentEvent?.actor).toBe('resend')

      // ── Step 4: Simulate Resend webhook for email.bounced ──
      // The webhook handler updates outreach by matching `resend_id = body.data.id`.
      // Send an event whose `data.id` matches the message id we stored during cron.
      const bouncePayload = {
        type: 'email.bounced',
        data: {
          id: mockResendId,
          to: ['approved@example.com'],
          subject: 'E2E Outreach',
          bounced: true,
          bounced_code: '550 5.1.1',
        },
      }
      const bounceBodyStr = JSON.stringify(bouncePayload)
      const bounceSig = await svixSignature(bounceBodyStr)
      const webhookHeaders = new Headers({
        'Content-Type': 'application/json',
        'svix-id': bounceSig['svix-id'],
        'svix-timestamp': bounceSig['svix-timestamp'],
        'svix-signature': bounceSig['svix-signature'],
      })
      const webhookResponse = await fetchWorker('/v1/webhooks/resend', {
        method: 'POST', headers: webhookHeaders, body: bounceBodyStr,
      })
      expect(webhookResponse.status).toBe(200)
      const webhookBody = (await webhookResponse.json()) as { success: boolean; data: { processed: boolean; eventType: string } }
      expect(webhookBody.success).toBe(true)
      expect(webhookBody.data.processed).toBe(true)
      expect(webhookBody.data.eventType).toBe('email.bounced')

      // Verify outreach terminal state
      const outreachAfterBounce = await env.DB.prepare(
        `SELECT status, bounced_at, provider_message_id FROM outreach WHERE id = ?`
      ).bind(outreachId).first<{ status: string; bounced_at: string; provider_message_id: string }>()
      expect(outreachAfterBounce?.status).toBe('bounced')
      expect(outreachAfterBounce?.bounced_at).toBeDefined()
      expect(outreachAfterBounce?.provider_message_id).toBe(mockResendId)

      // Verify webhook_events audit trail was appended
      const auditRows = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM webhook_events WHERE provider = 'resend' AND event_type = 'email.bounced'`
      ).first<{ n: number }>()
      expect(auditRows?.n).toBeGreaterThanOrEqual(1)

      // ── Step 5: Idempotency — resending the same event returns idempotent: true ──
      const webhookResponse2 = await fetchWorker('/v1/webhooks/resend', {
        method: 'POST', headers: webhookHeaders, body: bounceBodyStr,
      })
      expect(webhookResponse2.status).toBe(200)
      const webhookBody2 = (await webhookResponse2.json()) as { success: boolean; data: { idempotent: boolean } }
      expect(webhookBody2.success).toBe(true)
      expect(webhookBody2.data.idempotent).toBe(true)

      // ── Step 6: Cron no longer picks up the bounced outreach (terminal state) ──
      const cronResponse2 = await fetchWorker('/v1/cron/send', {
        method: 'POST', headers: cronHeaders, body: '{}',
      })
      expect(cronResponse2.status).toBe(200)
      const cronBody2 = (await cronResponse2.json()) as { success: boolean; data: { resent: string[] } }
      expect(cronBody2.success).toBe(true)
      expect(cronBody2.data.resent).not.toContain(outreachId)
    })

    it('cron send gracefully skips outreach when Resend API fails (exponential backoff applied)', async () => {
      const { leadId } = await createApprovedLead()

      const queueHeaders = bearerHeader(token)
      queueHeaders.set('Content-Type', 'application/json')
      const queuePayload = {
        leadId,
        subject: 'Backoff Test',
        body: '<p>Will fail</p>',
      }
      const queueResponse = await fetchWorker('/v1/outreach/queue', {
        method: 'POST', headers: queueHeaders, body: JSON.stringify(queuePayload),
      })
      expect(queueResponse.status).toBe(200)
      const queueBody = (await queueResponse.json()) as { data: { id: string } }
      const outreachId = queueBody.data.id

      // Force the Resend API to fail via the test hook.
      // The mock returns a pre-created rejected promise — we attach a no-op
      // `.catch()` to the same promise so any unhandled rejection is silenced
      // before the worker's own try/catch consumes it.
      const resendFailure: Promise<{ id: string }> = new Promise<{ id: string }>((_, reject) => {
        reject(new Error('Resend API returned 429: rate limited'))
      })
      resendFailure.catch(() => {}) // suppress unhandled rejection on creation
      setTestSendResult(async () => {
        return (await resendFailure) as unknown as { id: string }
      })

      const cronHeaders = new Headers({
        'Content-Type': 'application/json',
        'X-Cron-Secret': 'test-cron-secret',
      })
      const cronResponse = await fetchWorker('/v1/cron/send', {
        method: 'POST', headers: cronHeaders, body: '{}',
      })
      expect(cronResponse.status).toBe(200)
      const cronBody = (await cronResponse.json()) as { data: { sentCount: number; failedCount: number; failed: string[] } }
      expect(cronBody.data.sentCount).toBe(0)
      expect(cronBody.data.failedCount).toBeGreaterThanOrEqual(1)
      expect(cronBody.data.failed).toContain(outreachId)

      // Verify outreach keeps 'pending' status but increments send_attempts and next_retry_at
      const outreachAfterFail = await env.DB.prepare(
        `SELECT status, send_attempts, next_retry_at FROM outreach WHERE id = ?`
      ).bind(outreachId).first<{ status: string; send_attempts: number; next_retry_at: string }>()
      expect(outreachAfterFail?.status).toBe('pending')
      expect(outreachAfterFail?.send_attempts).toBe(1)
      expect(outreachAfterFail?.next_retry_at).toBeDefined()
    })
  })
})
