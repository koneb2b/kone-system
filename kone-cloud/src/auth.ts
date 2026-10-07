// ───────────────────────────────────────────────────────────────
// Bearer token authentication middleware
// Aligned with: ARCH-STANDARDS.md §15.4 (identity, tenant validation)
// ───────────────────────────────────────────────────────────────

import { hashToken } from './utils.js'

export type AuthResult =
  | { ok: true; workspace: { id: string; name: string } }
  | { ok: false; code: string; message: string }

export type Env = {
  DB: D1Database
  SCHEMA_VERSION: string
}

/**
 * Authenticate Bearer token against workspaces.api_token_hash.
 * Fail-Closed: any failure results in authentication denied.
 */
export async function authenticate(
  request: Request,
  env: Env
): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, code: 'AUTHENTICATION_FAILED', message: 'Missing or invalid Authorization header' }
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    return { ok: false, code: 'AUTHENTICATION_FAILED', message: 'Empty bearer token' }
  }

  // Hash token and look up workspace
  const tokenHash = await hashToken(token)
  const workspace = await env.DB.prepare(
    `SELECT id, name FROM workspaces WHERE api_token_hash = ?`
  ).bind(tokenHash).first<{ id: string; name: string }>()

  if (!workspace) {
    return { ok: false, code: 'AUTHENTICATION_FAILED', message: 'Invalid API token' }
  }

  return { ok: true, workspace }
}
