# Kone Engineering Standards and AI Architecture

## 1. Purpose
This document defines the hard architectural boundary of Kone V1.2: local heavy computation, progressive AI scoring, strict billing isolation, and Fail-Closed execution for any commercially meaningful capability.

---

## 2. Product and Runtime Positioning
1. Kone is a B2B outbound acquisition workstation, not a generic CRM.
2. The product is built on a hybrid model:
   - local machine handles search, ICP scoring, analysis, and Autopilot computation
   - cloud services handle only compact Premium collaboration and automation workloads
3. Kone must preserve the distinction between:
   - local Basic productivity engine
   - remote Premium execution engine
4. Performance baseline is practical, not luxurious: Kone must remain usable on `4G-8G RAM`, low-power CPU, and integrated graphics office machines.

---

## 3. Directory Responsibilities

### `src/` - Renderer only
Allowed:
- React components, routes, hooks, state orchestration, and presentation logic
- reading state from Zustand stores
- using `window.electronAPI`

Forbidden:
- Node.js and Electron privileged modules
- direct external paid network access
- secret access
- cloud write authority
- embedding core commercial logic that bypasses main-process checks

### `electron/` - Main process and privileged services
Allowed:
- IPC handler registration
- IPC contract validation (see `electron/ipc/registry.ts`)
- IPC type-safe contract definitions (see `electron/ipc/contracts/`)
- license and trial enforcement
- external API access
- cloud webhook delivery
- scoring pipelines, enrichment, payload shaping, and collision checks

Mandatory principle:
- any high-value operation must default to Fail-Closed authorization
- all IPC channel registration must go through `electron/ipc/registry.ts` (single source of truth at runtime) — **目标态**；存量迁移进度见 §`electron/ipc/registry.ts` 迁移状态注记

### `electron/ipc/contracts/` - IPC type-safe contract definitions
Allowed:
- channel payload schema definitions via `defineContract()`
- input validation using `validateContractInput()`
- channel contract objects with `channelName`, `schema`, and `validate` fields

Forbidden:
- IPC handler registration (belongs in handler files)
- business logic
- network access
- preload exposure

### `electron/ipc/registry.ts` - IPC channel runtime registry
Responsibilities:
- single source of truth for all registered IPC channels at runtime
- channel whitelist enforcement (unknown channels rejected)
- contract-aware validation via `registerHandler()` wrapper
- testable gateway: `dumpRegistry()` for debug, `resetRegistry()` for test isolation
- runtime binding via `attach(ipcMain)` — wires every registered channel to `ipcMain.handle` (called once at the end of `registerIpcHandlers()` in `main.ts`; idempotent against double-binding)

> ⚠️ **迁移状态注记（P0-4）**：注册中心基础设施已完整落地（register/dispatch/lock/assert/dump/reset/attach），`main.ts` 已在启动时调用 `registry.attach(ipcMain)`。但**存量生产 handler 仍走各 `register*Handlers()` 直挂 `ipcMain.handle`，尚未迁移到 `registerIpc()`**。迁移须按服务逐批进行（每批附带契约定义 + 单测），迁移完成后 `assertAllRegistered()` 才作为启动门禁启用。在迁移完成前，"all IPC channel registration must go through registry" 是**目标态**而非现状。

### `preload/` - Minimal secure bridge
Allowed:
- narrow `window.electronAPI` exposure

Forbidden:
- business logic
- billing logic
- cloud orchestration
- secret storage

---

## 4. State and Data Ownership
1. Dynamic lead data must live in Zustand memory state, centered on `src/store/leads-store.ts`.
2. `searchResults` and `leads` are the operational truth for renderer workflows.
3. Long-lived config storage must not absorb volatile business payloads like raw search result batches.
4. Team collaboration state may be mirrored locally for rendering, but cloud-side collaboration data remains SSOT.

---

## 5. Progressive Scout -> Brain Architecture
1. Search is progressive by design:
   - basic candidate data arrives first
   - LLM-derived `matchScore`, `matchReasons`, `riskFlags`, `inferredRole`, and `salesStrategy` arrive later
2. The renderer must show real candidate results before AI scoring completes.
3. `matchScore` is semantically tri-state in practice:
   - `undefined`: not yet scored or no valid score
   - numeric: valid scored result
   - invalid non-number values must be ignored during merge and math
4. Any score-derived computation must explicitly filter non-numeric values before calculating percentages, rankings, averages, or badges.
5. Never coerce unscored records to fake zero if that changes product meaning.
6. Scout pre-filtering is a mandatory step before Brain scoring, not an optional optimization.
7. The pre-filter must use positive roots, negative roots, keyword context, and commercial role signals to remove obviously off-topic candidates before they consume local compute budget.
8. Typical noise such as auto repair shops, body shop, mechanic, tire, car wash, oil change, and similar automotive-service records must be silently removed at Scout stage.
9. Pre-filter output must remain observable through structured probes, including kept count, discarded count, and major reason categories.
10. When website fetch fails, snippet/title-based blind scoring is allowed if the reason clearly states that the result is based on lightweight snippet judgment.
11. When `country` or natural language constrains a target nation, Scout must expand search intent into English product terms plus the country's official-language product terms. English remains the backbone; localized variants are additive.
12. Multi-source acquisition must normalize every provider result into `SearchExecuteResult` and preserve `dataSourceType`; provider-specific payloads must not leak into renderer-only logic.

---

## 6. IPC Contract and Authorization Law
1. IPC channel names must have a single source of truth in `electron/ipc/channels.ts`.
2. Renderer contracts must stay aligned with shared IPC types and preload exposure.
3. High-value handlers must be protected by `ensureTrialAccess`, `registerSecureFeatureIpc`, `licenseGuard.requireFeature`, or equivalent main-process authorization.
4. Stream workflows must provide full lifecycle semantics:
   - start
   - stage
   - basic payload arrival
   - score update payloads
   - error
   - complete
5. `search:stage` or equivalent stage semantics must be able to express normal acquisition, secondary keyword retry, tertiary Organic fallback, scoring degradation, and other recoverable downgrade states, and those states must be forwarded to renderer.
6. Missing AI key is a recoverable degraded state and must be expressed through dedicated IPC semantics or fields so the renderer can show a non-blocking notice.
7. Error paths must always release the UI from loading state.
8. Any stream flow must end with an explicit completion or error-close sequence; silent termination is an IPC contract violation.

---

## 7. Commercial Architecture and Billing Isolation
1. Kone uses `7-day Trial -> Paid Basic -> Paid Premium / Enterprise`.
2. Trial is temporary access to Basic-local capabilities only.
3. Basic includes the local heavy-work set:
   - complete search flow
   - ICP scoring
   - advanced AI analysis and drafting
   - local export
   - local Autopilot
4. Premium and Enterprise exclusively include remote commercial capabilities:
   - n8n cloud email automation
   - cloud send and verification chain
   - team collision detection
   - team dashboard and collaborative visibility
5. If a capability touches cloud execution, team-shared state, or remote automation, it must never leak into Trial or Basic through UI aliases, preload shortcuts, or optimistic routing.

---

## 8. Hybrid Edge-Cloud Boundary
1. Edge-heavy means search normalization, HTML extraction, ICP scoring, and local Autopilot all run on the user's machine.
2. Cloud-light means only compact, filtered, business-safe payloads are sent to remote systems.
3. Payloads for Premium automation must be size-controlled and field-whitelisted.
4. Raw HTML, bulk unfiltered leads, and oversized local artifacts must not be shipped to cloud systems.

### Critical physical boundary
Autopilot is local-only and depends on:
- powered-on machine
- active desktop app
- non-sleeping system
- working network

By contrast, Premium n8n automation may continue remotely after payload handoff, even when the user's machine is offline.

---

## 9. Reliability, Cost, and Performance Controls
1. No infinite retries against SerpApi, LLM providers, or remote mail/cloud services.
2. `400/401/403/429` class failures must fail fast.
3. Search resilience must obey the mandatory `四级弹性搜索协议`:
   - level 0 (V1.3): call AnySearch B2B entity API to resolve natural-language input against multi-source databases (customs, trade shows, yellow pages, LinkedIn search, Facebook search), extracting structured company profiles and decision maker network graphs
   - level 1: call Google Maps with independent `location` parameter for precise geography
   - level 2: if level 1 returns location-related `400`, retry automatically with empty `location` and append geography into `q`
   - level 3: if level 2 returns `localCount === 0`, switch automatically to Google Organic and normalize results back into Scout candidates
4. V1.3 AnySearch is a source-selection layer, not a replacement for the resilient search law:
   - `google_organic` may enter Organic-only acquisition directly when explicitly selected
   - `customs_shipment`, `trade_show`, `yellow_pages`, `linkedin_search`, and `facebook_search` are routed through AnySearch when implemented
   - no source expansion may weaken stream closure, billing isolation, or Scout normalization
5. On 429 or network interruption:
    - keep existing results intact
    - notify clearly
    - avoid destructive resets
6. Stream failures must end with a completion signal so UI cannot deadlock.
7. Prompt construction should keep stable system rules separate from dynamic business content to maximize cache efficiency.
8. Advanced quality controls such as `优先官网`、`优先本土域名`、`高相关优先`、`B2B 角色优先` are contract-bound search inputs; renderer state must be passed into main process and main process must perform real Scout-stage filtering or sorting from them.
9. Search scoring and website enrichment concurrency is a hard performance law: maximum concurrent jobs must remain fixed at `2`.
10. Website content sent into LLM must be reduced to high-value plain text only, stripped of HTML/script/style noise, and strictly truncated to no more than `3000` characters before prompt assembly.
11. Any implementation or commit that exceeds the `2` concurrency ceiling or the `3000`-character website-text ceiling is an architecture violation.
12. CPU- or memory-heavy changes that only work on high-end devices fail the architecture standard.
13. Multi-language search may increase provider API usage by approximately `2x`, but it must not increase LLM scoring or website enrichment concurrency beyond `2`.
14. Provider failures must be isolated with `Promise.allSettled`; a failed LinkedIn/customs/trade-show/Facebook source must not break Maps, Organic, AnySearch, or stream closure.

---

## 9.5 Local Agent Real-Execution Boundary
1. Agent implementations must perform real external work or real platform-state checks before incrementing success counters.
2. `setTimeout`-only simulation is forbidden for WhatsApp, LinkedIn, and Email agents.
3. LinkedIn automation is limited to user-authorized Session Cookie import, Profile read-only browsing, public data extraction, and AI icebreaker generation for manual user action.
4. LinkedIn automatic Connect requests, automatic direct messages, and batch social actions are prohibited unless this standard and `kone-PRD.md` are explicitly revised.
5. WhatsApp Basic execution is limited to low-volume Puppeteer + Web WhatsApp DOM automation (`data-testid` selectors, labeled experimental·Beta — NOT the `whatsapp-web.js` protocol layer) with QR/session health handling; Premium execution may use official WhatsApp Cloud API.
6. Email execution must use SMTP/IMAP plus DNS deliverability checks; high-risk SPF/DKIM/DMARC states must soft-lock sends.
7. Agent completion must update both persistent lead `agentStatus` and runtime `AgentState`; UI must not infer success locally.

---

## 9.6 Precision & Differentiation Closure (P0, G1–G4)

1. **Eligibility Gate (Stage 0.5, one-vote veto)** — after `computeScoutRelevance` and before ICP scoring, `computeEligibilityVeto()` applies structural hard-veto categories (B2C/retail terminal, repair services, used/refurbished, marketplace sellers, pure content/news sites). A vetoed candidate never enters ICP scoring or the Agent pipeline; the discard is recorded as `准入硬否决:<category>` in the structured probe. Sanctioned-country and CRM-protection vetoes require candidate-external data and remain documented gaps — they must not be faked.
2. **Word-boundary product-term matching** — `computeIcpMatchScore` must match product terms via `matchesProductTerm()`: ASCII terms use `\b` word boundaries (substring false-positives like `car`→`carpet` are forbidden); non-ASCII localized variants fall back to `includes`. `coreProductTerms` must include localized language product variants from intent mutation (multi-language search constitution).
3. **Five-grade email verification** — `electron/utils/email-verification.ts` emits `verified / probable / catch_all / risky / invalid`. Valid mapping: `verified|probable|catch_all → true`, `risky|invalid → false`. Disposable domains and role-accounts (`info@`, `sales@`, …) are `risky`. Catch-all domains require a decoy RCPT probe; greylist (421/450/451) gets exactly one backoff retry, then `probable`. SMTP-inconclusive results must degrade to `probable`, never fake `verified`. The verification layer is batch-serial, capped at 50/batch, and stays behind the `cloud_send` premium gate.
4. **Differentiated email content chain** — `EmailAgent.executeSequence` content priority: `task.aiEmail` (AI pitch carried on the lead, Stage 0 only) → injected `emailContentProvider` (real-time LLM 150-word personalized draft, 20s timeout) → stage templates as final fallback. Every send logs `email_content_source` for auditability. Content-layer failure must never abort the send chain; suppression, DNS soft-lock, and daily-limit gates keep their existing order.
5. **Decision-maker static validation** — collected decision makers pass zero-network static validation (`electron/utils/contact-validation.ts`): email static grading (format/disposable/role) and phone E.164 format check, annotated as `emailGrade`/`phoneValid`. Confidence must not be fabricated; the renderer shows the "AI 推测，未验证" degrade badge when `confidenceScore <= 0`. SMTP-level verification belongs to the pre-send gate, not the acquisition layer.

### P1 enhancements (same closure wave)

6. **Full LLM scoring coverage + confidence labeling** — `SEARCH_LLM_SCORE_LIMIT` equals `SEARCH_TARGETED_LEAD_LIMIT` (both `50`): every displayed lead receives LLM scoring + website enrichment under the unchanged concurrency-2 ceiling. `scoreSource` (`'ai' | 'deterministic'`) travels from the scoring path through `applySchemaDefaults`/mappers to the renderer, where the leads table and search cards label "AI" vs "规则" so users can always tell the two precision tiers apart.
7. **Real LLM icebreaker generation** — `LinkedinAgent` accepts an injected `icebreakerProvider`; generated copy must be grounded in actually extracted profile fields (name/headline/industry/about) and logged via `icebreaker_source`. Template fallback (`buildIcebreakerTemplate`) applies on failure. The read-only boundary is untouched: copy is for manual outreach only.
8. **Follow-up manual hold** — when IMAP is unconfigured the reply state is unknowable; the follow-up tick must NOT auto-advance. The plan is marked `pendingManual`, excluded from `isPlanDue`, and the renderer shows a "邮件需人工确认" badge via `AgentStatus.emailPendingManual`. The hold clears automatically once IMAP is configured and the sequence resumes.
9. **Recipient send window + interval jitter** — cold email is delivered only within the recipient's local 09:00-18:00 (`electron/utils/send-window.ts`, country→IANA map). Window deferrals return `outside_recipient_send_window` before any counter mutation: no daily-quota consumption, no failure count, plan deferred to the next tick. Unknown timezones are allowed (honest degradation — never guess). Stage intervals carry a ±20% random jitter (`jitteredInterval`, injectable random source) to avoid metronomic send patterns.

### P2/P3 enhancements (same closure wave)

10. **Structured opportunity score (Stage 2)** — the LLM scoring prompt requires `opportunityScore: { icpFit(0-55), intent(0-35), evidence(0-10), riskPenalty(0-20), finalScore }` with `totalScore = finalScore`; `normalizeOpportunityScore()` clamps dimensions and recomputes `finalScore` from the formula. Missing/invalid LLM output → `undefined` (never fabricated). The Stage-1 deterministic 40/30/20/10 constants and the concurrency-2 / 3000-char red lines are untouched.
11. **Configurable DKIM selectors** — `user_config.dnsShield.dkimSelectors` (settings UI: DNS card in the outreach console) is MERGED with the built-in default selector list (append-only, never replaces) in both `dns-service` and `EmailAgent.checkDnsHealth`; the SPF/blacklist critical soft-lock rule is unchanged.
12. **Five-grade verification queues** — `buildVerificationQueues()` routes verification results: verified/probable → primary, catch_all → throttled (content-reliant), risky → deprioritized, invalid → suppression candidates. `EmailAgent` hard-blocks disposable/format-invalid recipients before any counter mutation and logs role-account sends (`send_role_account`) without blocking.
13. **Multi-window temporal isolation (P3-2)** — `activeJobIds: Map<senderId, jobId>` scopes stale-job checks per window; providers discard via `isKnownActiveJobId(myJobId)` (matches ANY active window's job). `getCurrentActiveJobId()` remains as the global-latest fallback for backward compatibility.
14. **Cadence guidance (P2-2, partial)** — `describeCadence(stage)` emits the 14-day omni-channel rhythm (Day0 email → Day3-5 LinkedIn manual touch → Day7-10 FU1 → Day12-14 FU2) into stage-transition logs. The unified cross-channel orchestrator stays roadmap until its product surface exists — do not claim it as shipped.

---

## 10. Security and Secret Rules
1. No secrets in renderer code.
2. No shipping of private key materials.
3. License validation must remain cryptographically protected and resistant to time rollback abuse.
4. Sensitive logs must be redacted or omitted.

---

## 11. Electron Bridge Fallback Protocol

### 11.1 Trigger Condition
- `electron/services/electron-bridge.ts` activates fallback stubs when the `electron` module cannot be loaded (known Electron 33+ Windows bug #49034)
- Detection: `isUsingStubs` flag at module load time

### 11.2 Fallback Behavior (P0 hard requirement)
When fallback stubs are activated, the application MUST:
1. Write a critical error log to `$userData/.fallback-critical.log` with timestamp and error context
2. Attempt to display a Windows message box via `msg.exe` (child_process) with Chinese-language error
3. Call `process.exit(1)` after 5 seconds via `setTimeout`
4. **NOT** keep the process alive silently with `setInterval` or any other mechanism

### 11.3 Packaging Boundary
- Fallback stubs must remain in the production build (Electron module loading can fail in packaged environments)
- The `setTimeout(exit, 5000)` ensures the process terminates even if the dialog fails
- All user-facing messages must be in Simplified Chinese

---

## 12. Crash Reporter

### 12.1 Implementation
- File: `electron/services/crash-reporter.ts`
- Exported function: `initCrashReporter()` called from `electron/main.ts` at startup
- Source map support: `source-map-support` integrated for packaged stack trace symbolication

### 12.2 Capture Scope
- `process.on('uncaughtException')` — writes crash dump, shows error dialog, exits after 5s
- `process.on('unhandledRejection')` — writes crash dump, console.error (does not exit)

### 12.3 Crash Dump Format
- JSON file stored at `$userData/crash-reports/crash-{YYYYMMDD-HHmmss}-{random4}.json`
- Fields: `timestamp`, `type`, `message`, `stack`, `version`, `platform`, `arch`, `userData`, `notes`

### 12.4 Remote Upload (Optional)
- Default: disabled
- Configurable via `$userData/crash-reporter-config.json`: `{ enabled: boolean, remoteUrl?: string }`
- User must explicitly opt in from Settings

---

## 13. User Data Backup

### 13.1 Implementation
- File: `electron/services/backup-service.ts`
- Exported functions: `initBackupService()`, `triggerBackup()`, `getBackupList()`

### 13.2 Backup Scope
- Source: `$userData/config.json`, anchor/license files, user settings
- Target: `$userData/backups/backup-{YYYYMMDD-HHmmss}.json`
- Frequency: auto every 24 hours (checked at startup)

### 13.3 Integrity
- Pre-write: JSON.stringify + MD5 checksum stored with data
- On restore: checksum verification + JSON.parse validation

### 13.4 Rotation
- Maximum 7 backup files retained; oldest auto-deleted
- Files larger than 50MB are skipped with a log warning

---

## 14. Definition of Done for Architecture Changes
An architecture-affecting change is complete only when all are true:
1. renderer, preload, IPC contracts, and main handlers are aligned
2. billing and trial boundaries remain Fail-Closed
3. progressive Scout -> Brain semantics remain intact
4. non-numeric score math is safe
5. 429/network failure preserves user assets
6. low-spec office hardware remains within safe CPU and memory behavior
7. build and packaging rules remain clean
8. multi-language search, provider contracts, and Agent write-back remain consistent across PRD, PROJECT-PRD, AGENTS.md, IPC contracts, and renderer behavior
