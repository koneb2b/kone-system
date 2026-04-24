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

### Mandatory resilient search law: 三级弹性搜索协议
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
- webhook handoff to n8n
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
4. n8n webhook handoff occurs
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
- Premium n8n automation may continue after handoff with no local uptime requirement

---

## 7. Failure and Recovery Blueprint
1. Search/scoring failures must preserve current candidate state.
2. 429 or quota failures must fail fast and protect already acquired data.
3. Stream flows must always end with completion semantics.
4. Trial expiry blocks new privileged work, not historical user assets.
5. Cloud failure must not poison local Data Center state.
6. Website fetch failure should prefer blind scoring over immediate total downgrade when snippet/title data is still available.

---

## 8. Blueprint Maintenance Rule
Whenever state shape, commercial boundaries, stream lifecycle, fallback semantics, or Autopilot execution semantics change, this blueprint must be updated together with the PRD and root standards.
