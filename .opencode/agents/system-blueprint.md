# KONE SYSTEM BLUEPRINT

## 1. System Positioning
Kone is a local-first B2B outbound operating system. Its architecture is intentionally split into four business modules:
- Scout: basic acquisition and candidate generation
- Brain: asynchronous ICP scoring and enrichment
- Data Center: local truth store and operator workspace
- Automation: Premium cloud execution and team collaboration

This split exists to preserve cost control, billing isolation, and resilient UX.

---

## 2. Core Runtime Principles
1. Local heavy work first. Search normalization, scoring, enrichment, and Autopilot all execute on the local device.
2. Cloud execution later. Premium automation begins only after filtered payload handoff.
3. Zustand is the local operational truth for renderer-facing lead state.
4. Progressive UX beats blocking UX: basic records appear first; AI-derived value arrives later.
5. Commercial boundaries are physical and architectural, not just visual.
6. Kone must stay practical on low-spec office hardware, not only on development machines.

### Mandatory resilient search law: 四级弹性搜索协议
- level 0 (V1.3): AnySearch B2B entity API resolves natural-language queries against multi-source databases, extracting structured company profiles and decision maker networks
- level 1: precise geography via Google Maps `location` parameter
- level 2: if level 1 hits location-related `400`, retry immediately with empty `location` and move geography text into query `q`
- level 3: if level 2 yields `localCount === 0`, switch silently to Google Organic and normalize results into Scout candidate shape

No future blueprint change may weaken, skip, or reorder this fallback ladder.

---

## 3. Four-Module Operational Blueprint

### 3.1 Scout - Acquisition pipeline
Primary goal:
- turn user query input into normalized lead candidates quickly

Observed business stages:
1. user enters keyword / country / city
2. renderer triggers `search:execute`
3. main process calls external acquisition source
4. raw records are normalized and deduplicated
5. keyword-based relevance pre-filter runs
6. stream starts
7. basic results arrive first
8. renderer writes them into `searchResults`

Scout output contract:
- company identity
- website
- address/contact skeleton
- source/snippet when available
- `matchScore: undefined` until Brain finishes numeric scoring

Architectural law:
- Scout must not block on LLM
- failed Brain scoring must not destroy Scout output
- obvious泛化结果 should be removed before Brain spends compute budget on them
- Scout weighted pre-filtering is mandatory before Brain: positive roots, negative roots, keyword context, and commercial role signals must be used together
- automotive-service noise such as auto repair shops, body shop, mechanic, tire, car wash, and similar records must be silently removed at Scout stage
- pre-filter counts and main discard reasons must remain observable through structured probes

### 3.2 Brain - Streaming ICP scoring and enrichment
Primary goal:
- convert candidate skeletons into ranked, explainable B2B targets

Brain responsibilities:
- ingest ICP profile
- score candidates with LLM
- infer `matchScore`, `matchReasons`, `riskFlags`, `inferredRole`, `salesStrategy`, `isB2B`
- enrich websites, contact details, and outreach signals
- stream partial progress back to renderer

Required scoring semantics:
1. `matchScore` starts as `undefined`
2. only valid numeric values may replace prior score state
3. UI math must filter out non-numbers before computing score summaries
4. `undefined` is not failure and is not zero

Why this matters:
- avoids fake low-score interpretation
- avoids `0NaN%`
- preserves honest lifecycle from basic arrival to scored state

Performance law:
- Brain must remain stable on `4G-8G RAM` office machines
- concurrent scoring / enrichment jobs must stay fixed at maximum `2`
- HTML sent into LLM must be reduced to high-value plain text only, stripped of HTML/script/style noise, and truncated to no more than `3000` characters
- any implementation exceeding the `2` concurrency limit or the `3000`-character website-text limit is a performance-law violation

Blind-score fallback law:
- if website fetch fails, Brain may still score from `title + snippet + company + keyword`
- blind scoring is valid if it is explicitly labeled as lightweight snippet judgment
- full downgrade should be the last resort, not the default fallback

### 3.3 Data Center - Local truth and operator workspace
Primary goal:
- maintain the single local source of truth for the operator

State ownership:
- `searchResults`: current candidate workspace
- `leads`: saved local lead pool
- `teamClaimedDomains`: collaboration projection for collision UI

Data Center responsibilities:
- merge and normalize saved leads
- preserve cached analysis artifacts
- keep local workflows productive even when cloud systems are unavailable

Law of state:
- no volatile lead batches in long-term config storage
- renderer reads from Zustand, not ad hoc duplicate caches

### 3.4 Automation - Premium cloud execution and collaboration
Primary goal:
- move filtered, high-value leads into remote execution systems

Automation responsibilities:
- email verification
- compact payload generation
- webhook handoff to the cloud delivery backend (Cloudflare Workers + Resend; see `CLOUD-COLLABORATION-DELIVERY.md`)
- cloud campaign creation
- team-collaboration and collision workflows

Commercial law:
- these operations are Premium / Enterprise only
- cloud and team paths must remain Fail-Closed
- if cloud is unavailable, local lead state must survive intact

---

## 4. End-to-End Dataflow Timing

### 4.1 Scout -> Brain -> Data Center sequence
1. renderer issues `search:execute`
2. main process normalizes acquisition results
3. relevance pre-filter removes obviously off-topic candidates
4. stream lifecycle begins
5. basic results are sent immediately
6. renderer stores them in `searchResults`
7. Brain scores and enriches incrementally
8. score updates merge into existing results
9. operator saves selected records
10. mapped `LeadItem` records enter `leads`
11. optional deep analysis writes cached artifacts back into saved lead state

### 4.2 Premium automation sequence
1. operator selects high-value leads
2. Premium gate validates access
3. payload is compacted and filtered
4. payload is handed off to the cloud delivery backend (Cloudflare Workers + Resend); the full closed loop remains target-state and is governed by `CLOUD-COLLABORATION-DELIVERY.md`
5. remote automation continues independently of local machine uptime

---

## 5. Autopilot Silent Funnel Blueprint
Autopilot is a companion-style background funnel, not a flashy foreground workflow.

### 5.1 Input stage
Users provide batch tasks in queue form:
- country
- keyword
- target lead count

### 5.2 Queue stage
The system converts input lines into `AutopilotJob` records and places them in a local queue.

### 5.3 Execution stage
The runner processes pending jobs quietly with low concurrency and backoff discipline.

### 5.4 Scout stage
Each job triggers local search execution and receives candidate records.

### 5.5 Pre-filter stage
Before Brain invests in scoring, Scout-level keyword and snippet filtering removes obviously unrelated records.

### 5.6 Brain stage
Remaining candidates are scored and screened against threshold rules.

### 5.7 Gold Filter stage
Only qualified results pass through:
- threshold must be met
- duplicates are removed
- low-value records are discarded silently

### 5.8 Persistence stage
Qualified records are mapped and merged into local `leads`.

### 5.9 Reporting stage
UI may show:
- lifecycle
- current job
- discovered count
- qualified count
- saved count
- deduped count
- last error

But it must not flood the main workspace with distracting noise.

---

## 6. Autopilot Physical Boundary
Autopilot is local-only by law.

It requires:
- running desktop app
- powered-on machine
- no sleep state
- active network

Therefore:
- it cannot be marketed or documented as a cloud daemon
- it cannot promise offline continuation after app shutdown

Contrast rule:
- Autopilot stops when the local machine stops
- Premium cloud delivery automation (Cloudflare Workers + Resend) may continue after handoff with no local uptime requirement

---

## 7. Failure and Recovery Blueprint
1. Search/scoring failures must preserve current candidate state.
2. 429 or quota failures must fail fast and protect already acquired data.
3. Stream flows must always end with completion semantics.
4. Trial expiry blocks new privileged work, not historical user assets.
5. Cloud failure must not poison local Data Center state.
6. Website fetch failure should prefer blind scoring over immediate total downgrade when snippet/title data is still available.
7. **HTTP Circuit Breaker (`electron/utils/http-client.ts`)**: Each external API host has an independent circuit breaker. 计入连续失败次数：`429`、`5xx`、网络异常/超时；不计入、直接 fail-fast：`400` / `401` / `403`（口径以 kone-PRD.md §0.3 为准）。After 3 consecutive counted failures the circuit opens for 60 seconds. While open, requests are rejected immediately with a `CIRCUIT_BREAKER_OPEN` error. A successful request closes the circuit and resets the failure count. This applies at the HTTP client layer and is consumed by `proxy-service.ts` via `safeFetch()`. Provider-level failures are further isolated by `ProviderRegistry.executeAll()` using `Promise.allSettled`.

### 7.1 V1.3 Source Expansion Boundary

AnySearch belongs to the Scout acquisition layer. It may select a source strategy such as `google_organic`, but it must still output normalized Scout candidates and preserve progressive Scout -> Brain timing.

Current verified boundary:
- `google_organic` can run as an Organic-only acquisition path.
- `customs_shipment`, `trade_show`, `linkedin_search` and `facebook_search` are **independent SerpApi-backed providers** (site-scoped public-web approximation for customs/trade-show; `engine=linkedin`; `site:facebook.com`) — all four are already implemented and registered separately. **Only `yellow_pages` is deprecated** and its capability is routed through AnySearch.
- Authoritative provider capability and public wording: `PROVIDER-CAPABILITY.md` (single source of truth). Do not restate provider routing here.
- Source expansion must not bypass stream completion, Fail-Closed authorization, pre-filtering, or low-spec performance constraints.
- Country-constrained search expands into English plus official local-language product variants. Localized search is additive and may double provider calls, but it must not increase Brain concurrency.
- Provider results must enter the same normalized Scout shape with `dataSourceType`; providers do not write renderer state or persist leads directly.

---

## 7.5 V1.3 Local Agent Matrix (Multi-Agent Automation)

Three built-in sales agents run locally under the `/agents` panel:

### WhatsApp Hunter
- Basic path uses Puppeteer + Web WhatsApp DOM automation (`data-testid` selectors, experimental·Beta — NOT the `whatsapp-web.js` protocol layer) with local QR login, real session health checks, low-volume 3-5/day sends, and explicit reconnect prompts
- Premium path uses official WhatsApp Cloud API where configured
- Validates phone numbers from discovered decision makers when platform state allows
- Must never claim immunity from platform anti-fraud systems

### LinkedIn Buyer
- Reads local browser LinkedIn session cookies (no cloud credential storage)
- Visits target decision maker profiles in read-only mode
- Extracts public profile signals where available
- Auto-generates personalized scenario-based icebreaker notes from ICP + knowledge base for manual user action
- Prohibited: one-click batch connect requests, automatic DMs, automated Connect clicking

### Email Sequence Assistant
- Direct SMTP/IMAP connection via local Nodemailer to user's enterprise mailbox
- 3-round long-cycle follow-up sequence: Day 1 cold outreach → Day 3 follow-up → Day 7 case study
- IMAP reply detection pauses sequence when prospect responds

### Agent Permission Model
- Trial: upgrade/promo surface only for Agent panel; no protected metrics exposure
- Basic: Email 20/day by default; WhatsApp Web 3-5/day when configured
- Premium/Enterprise: LinkedIn read-only helper, WhatsApp Cloud API, account sandbox expansion, team collaboration, and cloud automation according to licensed features

---

## 7.6 V1.3 DNS Deliverability Shield

Before any SMTP sending sequence starts, the system runs a local DNS audit on the sender's email domain:
- Checks MX records for mail server existence
- Validates SPF sender policy whitelist coverage
- Probes DKIM digital signature key presence
- Audits DMARC enforcement policy strength
- Verifies Spamhaus global blacklist status

If critical SPF/DKIM records are missing or the domain is blacklisted, the UI soft-locks the campaign send button with a red warning, preventing blind mass-sending that would damage the company's domain reputation.

---

## 7.7 V1.3 Multi-Account Sandbox Isolation

Kone uses Electron's `session.fromPartition('persist:account_id')` for physical sandbox isolation:
- Each account (LinkedIn, Facebook, WhatsApp, SMTP/IMAP) gets its own persistent session partition
- Cookies, LocalStorage, and cache are fully independent between accounts
- From the platform's anti-fraud perspective, each account appears as a separate physical machine
- Basic tier: 1 email account allowed; Premium/Enterprise: multiple social + email accounts

Health polling runs at 30-second intervals with max concurrency of 2 to stay within low-spec hardware limits.

---

## 8. Blueprint Maintenance Rule
Whenever state shape, commercial boundaries, stream lifecycle, fallback semantics, or Autopilot execution semantics change, this blueprint must be updated together with the PRD and root standards.
