# KONE IPC AGENT PROTOCOL

## 1. Main-Process Communication Law
1. All external API calls belong in `electron/` services.
2. Renderer code must not directly call paid acquisition, LLM, or cloud automation endpoints.
3. Channel names must stay centralized in `electron/ipc/channels.ts`.
4. Preload exposure must remain minimal and typed.

---

## 2. Fail-Closed Authorization Requirement
1. Any IPC with business or billing value must default to deny unless explicitly authorized.
2. Trial, Basic, and Premium separation must be enforced in main process, never trusted to renderer-only gating.
3. Premium-only cloud execution includes:
   - email verification
   - cloud send / webhook handoff
   - team collision and realtime collaboration paths
4. V1.3 new IPC families (`account:connect`、`account:disconnect`、`account:get-list`、`agent:list`、`agent:control`、`dns:health-check`) follow the same Fail-Closed discipline:
   - `account:connect` gating: Basic tier → single email account + WhatsApp Web local session where enabled; Premium/Enterprise → social media + multiple email + official API paths
   - `agent:list` gating: Trial → upgrade surface only; Paid Basic → Email + low-volume WhatsApp Web when configured; Premium/Enterprise → full authorized panel including LinkedIn read-only helper
   - `agent:control` gating: `agent:control` requires `local_autopilot` feature at minimum
   - `dns:health-check` gating: `cloud_send` feature required (Premium/Enterprise only)

---

## 3. Progressive ICP Streaming Contract
Kone uses a progressive two-phase search contract.

### Phase A: basic arrival
Meaning:
- lead skeletons arrive first
- scoring is not yet complete
- `matchScore` is still `undefined`

Required semantic event alias:
- `LEAD_BASIC_ARRIVED`

Current concrete channel family:
- `search:stream-start`
- `search:basic-results`

Payload expectation:
- identity and source skeleton only
- no fake zero score

### Phase B: score update
Meaning:
- LLM-derived score and reasoning arrive incrementally
- only valid numeric scores may mutate score state

Required semantic event alias:
- `LEAD_SCORE_UPDATE`

Current concrete channel family:
- `search:lead-scored`

Payload expectation:
- candidate payload
- `completedCount`
- `totalCount`

### Phase C: stage update
Required semantic alias:
- `STREAM_STAGE_UPDATE`

Current concrete channel:
- `search:stage`

Stages currently recognized by product flow (full set, aligned with `emitStage` type union in `search-service.ts`):
- `anysearch` (level 0 multi-source acquisition)
- `fetching`
- `normalizing`
- `prefiltering`
- `scoring`
- `blind_scoring` (tertiary Organic fallback with snippet blind-score)
- `enriching`
- `complete`
- `localized_search` (local-language variant search)

Mandatory downgrade visibility law:
- `search:stage` must be able to express at least: AnySearch multi-source acquisition (level 0), normal acquisition, secondary keyword retry, tertiary Organic fallback, scoring degradation, and recoverable missing-key state
- downgrade semantics must be forwarded to renderer rather than being trapped only in backend logs
- missing AI key is a recoverable degraded state and must be exposed through dedicated IPC semantics or fields so UI can show a non-blocking notice
- any started stream must end with explicit `complete` or `error + complete` closure so UI cannot deadlock under extreme timeout or upstream failure conditions

### Phase D: stream closure
Required semantic aliases:
- `STREAM_ERROR`
- `STREAM_COMPLETE`

Current concrete channels:
- `search:stream-error`
- `search:stream-complete`

Hard rule:
- any stream error must still terminate with complete semantics so the UI cannot deadlock

---

## 4. Search and Score Payload Rules
1. LLM-cleaned payloads must remain strict and parseable.
2. Score payloads must prefer structured JSON and preserve:
   - `matchScore`
   - `matchReasons`
   - `riskFlags`
   - `inferredRole`
   - `salesStrategy`
   - `isB2B`
3. If a score is absent or invalid, do not coerce it to numeric zero.
4. Merge logic must protect prior state from invalid overwrite.
5. Scout weighted pre-filtering is mandatory before Brain scoring; it must use positive roots, negative roots, keyword context, and commercial role signals, and it must remain explicit and observable.
6. Typical noise such as auto repair shops, body shop, mechanic, tire, car wash, and similar automotive-service candidates must be silently removed at Scout stage.
7. Advanced quality controls such as `优先官网`、`优先本土域名`、`高相关优先`、`B2B 角色优先` are contract-bound inputs; renderer state must be passed to main process and main process must execute real filtering/sorting based on them.
8. Snippet blind scoring is allowed when website fetch fails. In that case:
    - `matchScore` may still be numeric
    - `matchReasons` must explicitly state that the score is based on lightweight snippet judgment
    - the event must remain a normal score update, not a fake hard error
9. Country-constrained natural-language search must preserve multi-language intent metadata: `language`, `country`, `city`, `intentProducts`, `b2bAttributes`, and `myJobId` must be available to Provider execution.
10. Provider failures must be isolated. A failed localized query or failed social/customs/trade-show Provider may emit a downgrade stage, but must not clear candidate state or block stream closure.

---

## 5. Search Fallback and Status Semantics
The renderer must be able to distinguish three practical states:
1. normal scoring success
2. blind scoring success
3. full downgrade without numeric score

Mandatory fallback law: `四级弹性搜索协议`
- level 0 (V1.3): AnySearch B2B entity API resolves natural-language input, retrieves multi-source data and decision maker networks
- level 1: Google Maps with standalone `location`
- level 2: on location-related `400`, retry with `location` cleared and geography appended into query `q`
- level 3: if level 2 yields `localCount === 0`, switch silently to Google Organic and keep Scout fed with normalized lead payloads

Mandatory user-facing copy law:
- level 0 UI copy: `🤖 AnySearch 正在通过全网海关数据、全球展会名录及社媒多渠道深度穿透高管决策人...`
- level 2 UI copy: `地图定位受限，正在尝试扩大识别范围...`
- level 3 UI copy: `未发现地图商户，已自动为您补位全局网页线索...`
- these copies must be delivered via stage/progress semantics, not inferred only from local renderer heuristics

Recommended payload semantics:
- blind scoring success: `matchScore` is numeric and `matchReasons` contains `基于简介轻量评估（官网无法访问）`
- full downgrade: `matchScore` remains `undefined` and `matchReasons/riskFlags` explain why

This avoids UI ambiguity while preserving the existing stream contract.

---

## 6. Autopilot Progress Contract
Autopilot is a background local queue and needs a disciplined reporting contract.

Required semantic progress events for background execution:
- `AUTOPILOT_QUEUE_UPDATED`
- `AUTOPILOT_JOB_STARTED`
- `AUTOPILOT_JOB_PROGRESS`
- `AUTOPILOT_JOB_COOLDOWN`
- `AUTOPILOT_JOB_FAILED`
- `AUTOPILOT_LIFECYCLE_CHANGED`

Whether these are implemented as dedicated channels or persisted-state polling, the reporting contract must still expose:
- lifecycle
- current job id
- completed job count
- failed job count
- discovered / qualified / saved / deduped totals
- `lastError`
- cooldown timing when relevant

Hard rule:
- Autopilot progress reporting must remain low-noise and must not spam the main search UI with foreground-style alerts

---

## 7. Error Bridge Discipline
1. Catch blocks may not be empty.
2. Service failures must return structured errors: `success`, `error`, `code`, and contextual message where applicable.
3. Stream failures must send error then completion.
4. On 429, timeout, or network failure:
   - preserve current local state
   - expose a clear message
   - never trigger destructive search-result resets

---

## 8. Probe and Diagnosis Rules
1. Backend diagnosis comes before UI diagnosis.
2. Required probe shapes:
   - `[Probe-API]`
   - `[Probe-Payload]`
   - `[Probe-Store]`
3. When acquisition or automation fails, inspect:
   - request building
   - provider response status
   - payload parsing
   - IPC routing
   - webhook response semantics
4. For relevance filtering and blind scoring, log before/after candidate counts and fallback mode counts.
5. For Scout weighted pre-filtering, preserve probes for kept count, discarded count, and dominant discard reasons so noise-removal behavior remains auditable.

---

## 9. Data Contract for LLM Scoring
Any LLM scoring or cleaning task must constrain output to structured fields compatible with Kone scoring semantics.

Minimum structured output should cover:
```json
{
  "company": "string",
  "website": "string",
  "address": "string",
  "isB2B": true,
  "matchScore": 78,
  "reason": "string",
  "matchReasons": ["string"],
  "riskFlags": ["string"],
  "inferredRole": "string",
  "salesStrategy": "string"
}
```

If the provider cannot produce a valid number for `matchScore`, the downstream system must preserve unscored semantics instead of manufacturing a zero.
