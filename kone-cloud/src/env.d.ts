// ───────────────────────────────────────────────────────────────
// Environment bindings — augment Cloudflare.Env for TypeScript
// Matches bindings declared in wrangler.toml + test-only TEST_MIGRATIONS
// ───────────────────────────────────────────────────────────────

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      SCHEMA_VERSION: string
      TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>
    }
  }
}

export {}
