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
- IPC 的**命名与类型事实源**始终是 `src/shared/ipc-contracts.ts` + `electron/ipc/channels.ts`（唯一命名源，现行生效）
- IPC 的**运行时注册路由**目标是收敛到 `electron/ipc/registry.ts`（`registerIpc()` → `attach()`），使注册、白名单、契约校验、`assertAllRegistered()` 启动门禁可统一治理 — **目标态**；存量迁移进度见 §`electron/ipc/registry.ts` 迁移状态注记
- 二者职责不重叠：`channels.ts` 定义"有哪些通道、叫什么"，`registry.ts` 定义"谁注册、如何被校验与绑定"。不得以 `registry.ts` 取代 `channels.ts` 的命名源地位。

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
- 已注册通道的**运行时注册表**（注册路由的唯一收敛点；通道命名源仍是 `electron/ipc/channels.ts`）
- channel whitelist enforcement (unknown channels rejected)
- contract-aware validation via `registerHandler()` wrapper
- testable gateway: `dumpRegistry()` for debug, `resetRegistry()` for test isolation
- runtime binding via `attach(ipcMain)` — wires every registered channel to `ipcMain.handle` (called once at the end of `registerIpcHandlers()` in `main.ts`; idempotent against double-binding)

> ⚠️ **迁移状态注记（P0-4）**：注册中心基础设施已完整落地（register/dispatch/lock/assert/dump/reset/attach），`main.ts` 已在启动时调用 `registry.attach(ipcMain)`。存量生产 handler 正按服务逐批从直挂 `ipcMain.handle` 迁移到 `registerIpc()`——截至 2026-10-19 复核：`channels.ts` 定义 72 个通道，其中 **41 个已迁移到 `registerIpc()`**（AUTOPILOT.SYNC_STATE、AGENT.LIST / AGENT.GET_LOG / AGENT.GET_STATUS / AGENT.SUPPRESS_LIST / AGENT.SUPPRESS_ADD / AGENT.SUPPRESS_REMOVE、CONFIG.GET / CONFIG.SET / SECRET.SET / SECRET.CHECK、PROVIDER.LIST / PROVIDER.STATUS、AUTOPILOT.GET_STATE / AUTOPILOT.SET_STATE / AUTOPILOT.CLEAR_LEGACY、AUTH.LOGIN / AUTH.LOGOUT / AUTH.GET_SESSION、ACCOUNT.CONNECT / ACCOUNT.DISCONNECT / ACCOUNT.GET_LIST、AUTOMATION.START_CAMPAIGN、SYSTEM.GET_DEVICE_STATUS、LICENSE.GET_INFO / LICENSE.REQUEST_TRIAL / LICENSE.SUBMIT / LICENSE.VERIFY / LICENSE.CHECK_STATUS），剩余 20 个（**全部 20 处**经 `registerSecureIpc`/`registerSecureFeatureIpc` Fail-Closed 包装器；**0 处**直挂——最后一处直挂 `main.ts` 的 AUTOPILOT.SYNC_STATE 已在第四批收口），11 个为仅推送通道。**所有 plain（`ipcMain.handle` 直挂）通道已清零**；第四批收口后，全部 20 处 Fail-Closed 包装通道也经 `registerSecureIpc`/`registerSecureFeatureIpc` **治理登记**进注册中心（标记 `skipAttach`：真实 `ipcMain.handle` 绑定仍由包装器完成、`attach()` 不重复绑定，Fail-Closed 授权语义零变化），故 **61 个 invoke 通道已全部 registry-known**（41 经 `registerIpc` 显式迁移 + 20 经包装器治理登记，0 处直挂）。契约见 `electron/ipc/contracts/{agent,config,provider,autopilot,auth,account,automation,license}.contract.ts`；单测见 `tests/ipc-registry-{agent,config,provider}-migration.test.ts`、`tests/ipc-registry-plain-batch3-migration.test.ts`、`tests/ipc-registry-license-migration.test.ts` 与 `tests/ipc-registry-secure-wrapper.test.ts`。`verify-ipc-consistency.cjs` **如实上报** `registry` 已知通道数（含包装器治理登记；此前为硬编码 0 的假可观测指标，已修复）。
>
> 迁移配套约定（第三批起）：①每个迁移的 `register*Handlers` 末尾自绑定 `registry.attach(ipcMain)`，使直接调用该函数而未显式 attach 的历史 e2e / 独立测试仍能经 `ipcMain.getHandler()` 触达迁移通道；`attach` **按 ipcMain 实例幂等**（`WeakMap<ipcMain, Set<channel>>`），既不会在 production 主进程唯一 ipcMain 上重复绑定触发 Electron "second handler" 报错，也允许不同测试各自的 ipcMain mock 都拿到绑定，并会在下次 attach 时补齐后注册的通道。②`registry.register()` 对**已注册通道的重复注册幂等覆盖**（dev 模式 warn）：注册中心是全局单例，测试进程内 `register*Handlers` 会被多个测试文件复用（如 `agent-persistence` 模拟重启的双次加载、`gate-e2e` 的 4 次调用），抛错会令跨文件污染整批用例崩溃；production 中每个通道仅注册一次，幂等覆盖不改变运行时行为。真正的启动后护栏是 `lock()`——锁定后禁止任何新增注册（见 `tests/ipc-contracts-v2.test.ts`）。
>
> **迁移已完成 + 启动门禁已启用**：61 个 invoke 通道（41 经 `registerIpc` 显式迁移 + 20 经 Fail-Closed 包装器治理登记 `skipAttach`）已全部 registry-known，**0 处 plain 直挂**，"all IPC channel registration must go through registry" 已达成事实态。`main.ts` 已在 `whenReady()` 末尾（`registerIpcHandlers()` 与 `AUTOPILOT.SYNC_STATE` 登记完成之后）调用 `registry.assertAllRegistered(collectInvokeChannels())` 并 `registry.lock()`：
> - `collectInvokeChannels()`（`electron/ipc/channels.ts`）递归收集 `IPC_CHANNELS` 全部通道后排除 `PUSH_CHANNELS`（11 个仅推送通道），精确返回 61 个 invoke 通道；`PUSH_CHANNELS` 与 `verify-ipc-consistency.cjs` 的 `PUSH_RE` 扫描器互为可观测校验，若两者漂移说明通道被误分类。
> - 断言通过后 `registry.lock()`：运行期禁止新增注册，构成真正的启动后护栏（`register()` 的重复注册幂等只服务于测试复用场景）。
>
> 门禁的**非空守卫**由 `tests/ipc-startup-gate.test.ts` 证明：①忠实复刻 `main.ts` 注册序列后，`assertAllRegistered` 通过、`lock()` 生效且此后新增注册被拒；②故意漏注册（跳过 `registerAuthHandlers`）时 `assertAllRegistered` 抛错并指明缺失通道——证明门禁不是空断言。`tests/ipc-registry-secure-wrapper.test.ts` 已证明包装器治理登记后 Fail-Closed 仍返回 403、授权通过仍放行。
>
> **授权分层复核与缺陷收口（2026-10-19）**：复核依据 `docs/reports/ipc-plain-register-license-mapping-2026-10-19.md`，41 个 plain `registerIpc` 通道按 public/trial/paid 重新分层（**16 免门禁**——启动/激活/配置/密钥类，加门禁会造成激活死锁；**22 需 feature 门禁**；**3 条件/参数化门禁**）。关键判据：`ensureTrialAccess`（`license-service.ts`）是**授权/过期门禁，不是付费墙**——活跃 claims 一律放行；真正的套餐墙只有 `registerSecureFeatureIpc` → `licenseGuard.requireFeature`。已落地 2 处 Fail-Closed 修正：
> - `AUTOMATION.QUEUE_OUTREACH`：原仅 `ensureTrialAccess` → 活跃 Trial 与 Basic 均可直连云端入队；现补 `requireFeature('cloud_send')`，返回 `FEATURE_DENIED` / 403（与 `AUTOMATION.START_CAMPAIGN` 同信封）。
> - `ACCOUNT.CONNECT / DISCONNECT / GET_LIST`：代理键原为 `search_basic`（`TRIAL_FEATURES` 亦持有）→ 活跃 Trial 可绑定/读取/断开真实邮箱账号；现统一改为 `local_autopilot`（仅替换代理键，不新增/移除 feature 定义；参数级 `isEmailType` 限制保持原样）。
>
> 回归证据：`tests/ipc-license-gate-d1-d6.test.ts`（10 项；撤销修复即 `exit 1`，修复后全绿）。**D2–D5、D7 未裁决前，不得对其余 plain 通道批量追加门禁。**

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
3. `matchScore` is semantically tri-state — **authoritative definition is `kone-PRD.md` §2.4 (V1.2 invariant red line)**; this section must not redefine it:
   - `undefined`: not yet scored (Scout skeleton state)
   - numeric: valid scored result
   - `null`: upstream-invalid marker — a **distinct third state**, never collapsed into `undefined`
   - No mapping layer may silently coerce `undefined`/`null` to `0`: `0` means "assessed and very poor", which is commercially different from "not yet assessed". (Historical drift: `applySchemaDefaults` coerced `null`/`''` to `0`; fixed 2026-09-25.)
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
2. Trial is a **time-boxed, limited** taste of the local capability set — **not full Basic**. Search is capped (10 results / 15s cooldown), export is capped (100 rows), AI analysis/drafting is locked, and the agent panel renders an upgrade surface only (`kone-PRD.md §6.0`). The phrase "Basic-local capabilities only" means *not premium/cloud* — it does **not** grant the whole Basic feature set. (Clarified 2026-09-25; previously ambiguous and contradicted by `kone-PRD.md §6.0`, `AGENTS.md` and `.opencode/agents/ipc-agent.md`.)
3. Basic includes the local heavy-work set:
   - complete search flow
   - ICP scoring
   - advanced AI analysis and drafting
   - local export
   - local Autopilot
4. Premium and Enterprise exclusively include remote commercial capabilities:
   - Cloudflare Workers cloud email automation (target state — Phase 1)
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

By contrast, Premium Cloudflare automation (target state) may continue remotely after payload handoff, even when the user's machine is offline.

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
   - `customs_shipment`, `trade_show`, `linkedin_search`, and `facebook_search` are implemented as **independent SerpApi-backed providers** registered in `electron/services/providers/index.ts` (NOT routed through AnySearch); `yellow_pages` keeps its enum value for backward compatibility while its provider is deprecated and returns `DEPRECATED`. Real availability is owned solely by `PROVIDER-CAPABILITY.md`
   - no source expansion may weaken stream closure, billing isolation, or Scout normalization
5. On 429 or network interruption:
    - keep existing results intact
    - notify clearly
    - avoid destructive resets
6. Stream failures must end with a completion signal so UI cannot deadlock.
7. Prompt construction should keep stable system rules separate from dynamic business content to maximize cache efficiency.
8. Advanced quality controls such as `优先官网`、`优先本土域名`、`高相关优先`、`B2B 角色优先` are contract-bound search inputs; renderer state must be passed into main process and main process must perform real Scout-stage filtering or sorting from them.
9. Search scoring and website enrichment concurrency is a hard performance law: maximum concurrent jobs must remain fixed at `2`. (This ceiling governs **scoring and enrichment only**; search **fan-out** is a separate domain with its own ceiling `SEARCH_FANOUT_CONCURRENCY = 3` — see `kone-PRD.md §0.3`. Do not apply one domain's ceiling to the other.)
10. Website content sent into LLM must be reduced to high-value plain text only, stripped of HTML/script/style noise, and strictly truncated to no more than `3000` characters before prompt assembly.
11. Any implementation or commit that exceeds the `2` concurrency ceiling (scoring / enrichment domain, per item 9) or the `3000`-character website-text ceiling is an architecture violation.
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
4a. **Seller-knowledge injection into content generation** — `electron/services/agent-knowledge.ts` is the single source for reading `user_config.knowledgeBase` on the Agent side. `createLlmEmailContentProvider` must inject a `[SELLER KNOWLEDGE BASE]` block built by `selectKnowledgeForAgent` (relevance-matched on lead context + stage intent + the knowledge-base UI's built-in quick tags); `createKnowledgeWhatsAppTextBuilder` applies the same selection with a deterministic, non-LLM template so the real outbound path is never blocked. **Selection returns only genuine matches** — length-based fallback padding is forbidden (it pollutes the prompt while the system prompt declares the knowledge base the primary source of seller strengths). When nothing matches, generation degrades honestly: the prompt forbids claiming any product capability/certification/statistic, and the renderer surfaces the unused state via `KnowledgeSourceCard` (`analysis-drawer.tsx`) with a direct link to the knowledge base. `usedKnowledgeTitles` is collected, persisted, **and rendered** — a field that is only collected but never shown is not a delivered capability.
4b. **User-defined knowledge tags must actually participate in retrieval** — `user_config.knowledgeBase.customTags` is the user's own tag vocabulary, managed in the knowledge-base UI. It **must** be (i) persisted on save, (ii) rehydrated on load, and (iii) merged into the Agent-side match keywords by `selectKnowledgeForAgent` (via `readKnowledgeSource`). Rationale: matching only against the four built-in quick tags makes "customizable tags" a **false affordance** — a user who names their material with their own terminology (e.g. 「交期承诺」) would never have it retrieved. Passing an empty `customTags` array must reproduce the pre-change behaviour exactly (no gate, no scoring drift). Built-in tags remain **undeletable** in the UI (removing them would silently destroy built-in retrieval), while custom tags are freely addable/removable. Scope note: this governs the **Agent side** (email/WhatsApp content generation) only; the search-side scenario prefilter (`scenarioKnowledgeKeywords` in `search/analysis.ts`) is a separate dimension and deliberately NOT merged with the tag pool. UI copy must therefore not over-promise.
4c. **The prompt-assembly step is itself under test** — verifying that `renderKnowledgePromptBlock` returns the right string is **not** sufficient: the core claim ("the AI actually received the seller's material") lives in the assembly inside `agent-service.ts` (block concatenation into `system`/`user`, and the honest-degrade rule selection). A reversed condition or a dropped `knowledgeBlock` would be invisible to both the retrieval unit tests and the UI visual probes, yet ships an email with **no product selling points**. Therefore `createLlmEmailContentProvider` / `createKnowledgeWhatsAppTextBuilder` stay **exported**, and `tests/business-logic/agent-prompt-knowledge.business.test.js` captures the real outbound request body (by stubbing global `fetch`, the sole network egress) to assert what actually reaches the LLM. Mutation-verified: dropping the block fails 2 tests; inverting the degrade condition fails 3.
4d. **Three structural invariants (2026-10-09 P0 closure)** — each was a shipped defect; all three are now guarded by `tests/business-logic/p0-fixes-guard.business.test.js`.
    - **Secret whitelist must match its call sites.** Every `secret:set` key the renderer actually calls must be in `SECRET_SET_WHITELIST` (`config-service.ts`). A key that is written by the UI but missing from the whitelist silently 403s — and if the caller clears a plaintext fallback slot *before* writing the encrypted one, the value is **lost** (this is exactly how the email password vanished). Order matters: **write the encrypted slot first, clear the plaintext slot only after it succeeds.**
    - **Config read/write symmetry.** Any namespace writable via `config:set` must be readable via `config:get` (`CONFIG_GET_ALLOWED_NAMESPACES`). An asymmetric boundary produces "saved but unreadable" — the UI then reports a bogus failure while the value is in fact persisted (`cloud.*` was the offender).
    - **Every agent execution loop needs a start/stop checkpoint.** `stopAgent`/`pause` only mutate `agent.status`; if the loop never reads it, the agent keeps sending — and `sendMessage` **auto-reconnects** on a dropped session, so "stopped" still means "sending" (a compliance red line). The loop must call `waitWhilePaused(agent)` each iteration (`paused` → suspend, `idle` → break), and `startAgent` must return early on `paused` (recovering the state only) rather than launching a second concurrent loop.

4e. **UI truthfulness & destructive-action guards (2026-10-09 P1 closure)** — four rules, each was a shipped defect, guarded by `tests/business-logic/p1-fixes-guard.business.test.js`.
    - **Filter options must be derived from data, not hardcoded.** The lead-source filter listed `LinkedIn / Trade Show / AI Search` while real `source` values come from providers (`Google Maps` / `Google Organic` / `AnySearch` …) — three options could never match (dead options, "click does nothing"). Derive options from the actual dataset so they cannot drift.
    - **Export must use the full filtered set; display limits apply to rendering only.** `leads-table` capped the list at 50 for render performance but exported the same capped list, so users silently received a truncated file while the other export entry point sent everything. Split `filteredLeads` (full) from `displayLeads` (capped) and export the former.
    - **Irreversible actions require confirmation.** Deleting a lead (immediately persisted) and submitting a cloud bulk-send (unrecallable) both executed on a single click. Both now go through a confirmation dialog.
    - **Never fabricate verification grades.** Approval must not hardcode `emailVerificationGrade: 'verified'` — the cloud layer's honest default for a missing value is `'unverified'`, and overriding it marks unverified addresses as deliverable (compliance risk). Resolve the real grade from the matching decision maker, else degrade to `'unverified'`.
5. **Decision-maker static validation** — collected decision makers pass zero-network static validation (`electron/utils/contact-validation.ts`): email static grading (format/disposable/role) and phone E.164 format check, annotated as `emailGrade`/`phoneValid`. Confidence must not be fabricated; the renderer shows the "AI 推测，未验证" degrade badge when `confidenceScore <= 0`. SMTP-level verification belongs to the pre-send gate, not the acquisition layer.
5a. **AGENT.\* channel gate classification** — `AGENT.*` invoke channels are **explicitly classified**, never gated by blanket rule. **Guarded** (expose agent runtime metrics; the constitution forbids showing them to Trial): `AGENT.LIST`, `AGENT.GET_LOG`, `AGENT.CONTROL` — all must carry the `local_autopilot` feature gate, with 403 propagated verbatim so the renderer can distinguish "no permission" from "server fault". **Unguarded by design**: `AGENT.GET_STATUS` (per-lead reach badge, P0-1 dual-pipeline read; leads are legitimate Trial data) and `AGENT.SUPPRESS_LIST/ADD/REMOVE` (email compliance, PROJECT-PRD §3.7.7 — an unsubscribe request must be recordable on **any** plan). A new `AGENT.*` channel that is not in either list fails `tests/business-logic/agent-gate-classification.business.test.js`, which asserts both directions (guarded ⇒ gate present; unguarded ⇒ no gate) so the check cannot be satisfied by simply deleting a gate.

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

---

## 15. Local-Cloud Collaboration Architecture (Target-State Hard Boundary)

> Product behavior is defined in `kone-PRD.md §5.1`; approval, cloud handoff, delivery, suppression, webhook, reply, quota, circuit-breaker and tenant rules are defined only in `CLOUD-COLLABORATION-DELIVERY.md`. This section defines architecture boundaries and completion gates, not duplicate business fields.

1. Local and cloud form one pipeline: local discovery/scoring/approval -> minimal cloud handoff -> cloud second gate -> queue/delivery -> event write-back.
2. High score or `cloud_send` entitlement is never send authorization. A valid approval record and matching draft version are mandatory.
3. Renderer has no cloud write authority and no secrets. Every privileged operation passes main-process authorization and server-side workspace authorization.
4. Cloud must independently validate identity, tenant, schema version, idempotency, collision, suppression, approval, email grade/exception, domain health, quota and circuit breaker.
5. Raw HTML, candidate batches, unapproved contacts, secrets, cookies and sessions are prohibited from cloud handoff.
6. Business, outreach and follow-up states are separate contracts. `delivered != replied`; reply, unsubscribe, complaint and hard bounce stop future follow-up.
7. Suppression is global and higher priority than import, scoring, approval, queue and retry.
8. Cloud events are append-only audit evidence; aggregated status may change but original approval/delivery events must not be overwritten.
9. Every cloud response and write-back failure must be observable and actionable. Optimistic success and silent downgrade are architecture violations.
10. New cloud API/event schemas are independently versioned; they must not silently reuse local `LeadStatus` or `AgentStatus` strings.

## 16. Specification and Change Governance

1. SSOT ownership:
   - product behavior/state/user journey: `kone-PRD.md`;
   - architecture/security/performance: this file;
   - cloud collaboration/delivery: `CLOUD-COLLABORATION-DELIVERY.md`;
   - local IPC（命名与类型）: `src/shared/ipc-contracts.ts` + `electron/ipc/channels.ts`; 其**运行时注册路由**收敛点为 `electron/ipc/registry.ts`（目标态，见 §3 迁移状态注记）;
   - Provider truth: `PROVIDER-CAPABILITY.md`;
   - field shapes（代码事实源）: `src/shared/ipc-contracts.ts`，人类可读索引见 `FIELD-DICTIONARY.md`;
   - state machine **mapping**: `STATE-MACHINES.md`（各状态机的语义仍归 `kone-PRD.md` 与 `CLOUD-COLLABORATION-DELIVERY.md`）;
   - terminology: `GLOSSARY.md`;
   - change timeline / implementation-to-spec write-back: `CHANGELOG.md`;
   - deployment/operations/release evidence: operations manual.
2. Other documents may reference an SSOT but must not independently redefine the same rule. 数值型常量**只允许**在 `kone-PRD.md §零.3` 定义一次；`.clinerules` 等工具入口文件只允许写流程与指针，不得复述数值。
3. Changes to state, data, permission, delivery, events, public API or compliance require motivation, affected SSOTs, compatibility, migration, rollback, tests, acceptance, owner and effective version.
4. Missing any required change artifact blocks Release Candidate admission.
5. CI must fail on broken references, stale function names, duplicate normative definitions, schema/example drift, and every workflow result other than explicit `success`.

## 17. Release Evidence Gate

Any unmet item is `NO-GO`:

1. lint/build/unit/IPC/E2E/security/packaged smoke evidence is incomplete or red;
   - **类型检查（`npm run typecheck`，即 `tsc --noEmit -p tsconfig.json`）是独立且不可省略的一项**，不得因 `vite build` 通过就判定类型安全：`vite build` 经 esbuild **仅做转译、不做类型检查**，因此"漏导入 → 运行时 `ReferenceError`"一类缺陷不会让构建变红（实例：`search-result-card.tsx` 曾只做 `import type` 却在运行时调用 `useLeadsStore`，渲染即崩溃，而 vite build 与全部既有门禁均为绿）。electron 侧的 `build:electron:dev` 同样只覆盖 `electron/`，**不覆盖 `src/`**。
2. approval, suppression, idempotency, quota, webhook verification, reply-stop or write-back recovery is untested;
3. workspace/tenant isolation has no negative cross-tenant tests;
4. SMTP/API secrets appear in normal config, Renderer, logs or package;
5. clean-machine Agent/delivery behavior cannot be reproduced;
6. the artifact lacks commit, dependency lock, hash, test result, signature, gray-release threshold, rollback trigger or owner;
7. CI treats `timed_out`, `action_required`, empty or any non-success result as pass;
8. Provider truth, sales claims, UI and implementation remain in unresolved conflict.
