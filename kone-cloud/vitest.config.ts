import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig, defineProject } from 'vitest/config'

export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname ?? '.', 'migrations')
  const migrations = await readD1Migrations(migrationsPath)

  return defineProject({
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // Add a test-only binding so we can apply migrations in a setup file
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Phase 2: deterministic test values for cron auth + Resend client
            CRON_SECRET: 'test-cron-secret',
            RESEND_API_KEY: 'test-resend-key',
            // Phase 2 · P2-13: Svix-format webhook signing secret
            // (24-byte base64 payload; tests compute HMAC-SHA256 over it)
            RESEND_WEBHOOK_SECRET: 'whsec_' + Buffer.from('test_webhook_secret_123').toString('base64'),
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./tests/setup.ts'],
    },
  })
})
