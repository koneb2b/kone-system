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
            // 测试默认门禁关闭：与生产部署开关**解耦**。
            // 生产已于 2026-11-03 开启（wrangler.toml = "true"）。若测试继承该值，
            // 既有 HTTP 用例（SELF.fetch）在 queue 阶段会被 403 拦截而误报失败。
            // 门禁行为由 tests/approval-gate.test.ts 显式注入 gatedEnv/openEnv 覆盖，
            // 不依赖此默认值，也不受生产开关变更影响。
            APPROVAL_GATE_ENABLED: 'false',
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
