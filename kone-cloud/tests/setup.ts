// ───────────────────────────────────────────────────────────────
// Test setup — apply D1 migrations once per test file
// Setup files run outside the per-test-file storage isolation,
// and may be run multiple times. `applyD1Migrations()` only applies
// migrations that haven't already been applied, so this is safe.
// ───────────────────────────────────────────────────────────────

import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
