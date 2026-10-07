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
      /** Cron 共享密钥（/cron/send 双重门禁） */
      CRON_SECRET?: string
      /**
       * 云端二次门禁总开关（Phase 2.9）。字符串 'true' 才启用，默认关闭。
       * 必须等本地审批 UI 就绪后才能开启 —— 否则用户无审批入口，
       * 所有投递会被门禁 ⑦ 永久拒绝。
       */
      APPROVAL_GATE_ENABLED?: string
    }
  }
}

export {}
