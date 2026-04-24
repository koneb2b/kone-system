[2026-04-21] Permission-lock E2E decisions
- Used dist-electron imports for registerSearchHandlers/registerAutomationHandlers/registerSupabaseHandlers to validate production registration behavior.
- Mocked ./license-service for dist-electron search/automation/supabase modules so trial-key assertions can follow required store-key scenarios exactly.
