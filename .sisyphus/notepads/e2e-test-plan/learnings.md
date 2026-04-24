[2026-04-21] Permission-lock E2E learnings
- For dist-electron service-level E2E, helper trio from license-gateway (createIpcMainMock/createStoreMock/createLicenseGuardMock) is stable and reusable.
- Automation start-campaign denial is best verified by intercepting http-client safeFetch call count to prove business logic short-circuited.
- Supabase handler matrix can be asserted at IPC layer via cloud channels without touching frontend gates.
