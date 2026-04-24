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
- license and trial enforcement
- external API access
- cloud webhook delivery
- scoring pipelines, enrichment, payload shaping, and collision checks

Mandatory principle:
- any high-value operation must default to Fail-Closed authorization

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
3. Search resilience must obey the mandatory `三级弹性搜索协议`:
   - level 1: call Google Maps with independent `location` parameter for precise geography
   - level 2: if level 1 returns location-related `400`, retry automatically with empty `location` and append geography into `q`
   - level 3: if level 2 returns `localCount === 0`, switch automatically to Google Organic and normalize results back into Scout candidates
4. On 429 or network interruption:
    - keep existing results intact
    - notify clearly
    - avoid destructive resets
5. Stream failures must end with a completion signal so UI cannot deadlock.
6. Prompt construction should keep stable system rules separate from dynamic business content to maximize cache efficiency.
7. Advanced quality controls such as `优先官网`、`优先本土域名`、`高相关优先`、`B2B 角色优先` are contract-bound search inputs; renderer state must be passed into main process and main process must perform real Scout-stage filtering or sorting from them.
8. Search scoring and website enrichment concurrency is a hard performance law: maximum concurrent jobs must remain fixed at `2`.
9. Website content sent into LLM must be reduced to high-value plain text only, stripped of HTML/script/style noise, and strictly truncated to no more than `3000` characters before prompt assembly.
10. Any implementation or commit that exceeds the `2` concurrency ceiling or the `3000`-character website-text ceiling is an architecture violation.
11. CPU- or memory-heavy changes that only work on high-end devices fail the architecture standard.

---

## 10. Security and Secret Rules
1. No secrets in renderer code.
2. No shipping of private key materials.
3. License validation must remain cryptographically protected and resistant to time rollback abuse.
4. Sensitive logs must be redacted or omitted.

---

## 11. Definition of Done for Architecture Changes
An architecture-affecting change is complete only when all are true:
1. renderer, preload, IPC contracts, and main handlers are aligned
2. billing and trial boundaries remain Fail-Closed
3. progressive Scout -> Brain semantics remain intact
4. non-numeric score math is safe
5. 429/network failure preserves user assets
6. low-spec office hardware remains within safe CPU and memory behavior
7. build and packaging rules remain clean
