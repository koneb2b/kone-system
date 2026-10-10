# V1.2 Packaged Blocking Issues Repair Plan

## TL;DR
> **Summary**: Repair the packaged V1.2 commercial build by hardening Electron single-instance/lifecycle behavior, making anchor persistence permission-fault-tolerant without hanging Machine ID flows, guaranteeing activation IPC response closure, and refreshing the activation page left panel to a blue-to-cyan brand gradient.
> **Deliverables**:
> - Electron main-process single-instance lock and explicit non-macOS quit behavior
> - Dev/prod userData isolation plus anchor write/open try-catch downgrade for permission failures
> - Activation/trial IPC handlers that always return structured responses and renderer flows that always clear loading and show Simplified Chinese errors
> - Activation page left panel visual refresh from dark solid background to readable blue-cyan gradient
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Final Verification

## Context
### Original Request
修复打包后的 V1.2 商业版两个严重阻断问题，按用户给定的 4 项核心修复任务直接收敛到实现计划：主进程单例锁与退出、anchor.bin 容错与 dev/prod 隔离、激活页 IPC 不挂起、激活页品牌色改造。

### Interview Summary
- 用户确认不再需要阶段一问题汇报，直接结束自查阶段。
- 用户已明确病灶根源，并给出 4 项具体改动要求。
- 需要优先解决 packaged 环境下锚点写入异常导致的挂起，以及激活页按钮加载态无法解除的问题。
- UI 变更范围仅限激活页面左侧大区块背景与文本对比度，不做整页重设计。

### Metis Review (gaps addressed)
- 严格限制为 4 个修复交付物，禁止扩展到授权策略、套餐、搜索、Autopilot、云端功能。
- 保持 Fail-Closed 商业边界：只对 anchor 写入/open 权限异常做降级放行，不能放宽签名校验、时间回拨、授权过期或特性校验。
- 所有 activation/trial IPC 路径必须显式返回结构化对象；Renderer 成功/失败均必须解除 loading。
- 验证脚本必须先校验命令是否真实可运行；`package.json` 中 `test:security-audit` 指向缺失文件，不能直接作为唯一验收门禁，除非该脚本被纳入本次修复。
- 激活页渐变仅限左侧品牌面板，保持专业 B2B 风格，不增加花哨动效。

## Work Objectives
### Core Objective
消除 packaged V1.2 商业版在激活/试用链路中的主进程阻塞、IPC 无响应和激活页静默死锁，并把激活页左侧品牌面板调整为符合 Kone 品牌的蓝青渐变风格。

### Deliverables
- Electron 主进程入口具备单例锁与明确的非 macOS 退出逻辑。
- 授权锚点目录与 `anchor.bin` 的写入/打开流程具备 dev/prod 物理隔离与严格 try-catch 容错。
- 试用与激活 IPC 无论成功还是异常都返回结构化响应对象。
- 前端激活页在 trial/submit 成功或失败时都清除 loading，并展示简体中文错误提示。
- 激活页左侧背景改为深海蓝到青绿色渐变，白字保持高对比度。
- 验证链路明确说明现有 `test:security-audit` 入口不一致，并采用可执行的替代/修复方案。

### Definition of Done (verifiable conditions with commands)
- `npm run build:electron:dev` 成功，且 Electron 主进程相关类型检查通过。
- 相关 Node 测试覆盖主进程容错、IPC 返回与 renderer loading 解除路径并通过。
- 可执行的 packaged smoke / targeted tests 证明激活页不会因底层异常而永久 loading。
- 激活页左侧样式通过 DOM/class 断言或截图证据证明已切换为蓝青渐变，并保持白字可读。

### Must Have
- 仅修复以下 4 项：
  1. Electron 单例锁 + 非 macOS 显式退出
  2. anchor 持久化容错 + dev/prod userData 隔离
  3. activation/trial IPC 明确返回 + renderer loading/error 闭环
  4. 激活页左侧品牌渐变改造
- 所有用户可见错误文案保持简体中文。
- 复用/扩展现有测试，优先参考 `tests/env-isolation.test.ts` 等现成覆盖。

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不修改 Trial 7 天规则、套餐边界、签名校验、时间回拨防护、Feature Gate 规则。
- 不扩展到搜索、Autopilot、云端自动化、团队协作等无关模块。
- 不做 preload/IPC 契约扩容，除非仅为维持现有 activation contract 的显式返回语义。
- 不做激活页整页重构、动画特效、花哨装饰或额外品牌营销改版。
- 不把所有异常一概吞掉；仅对 anchor 写入/open 权限类异常按要求降级放行。

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + existing Node/Electron test framework (`node --test`, existing smoke tooling)
- QA policy: Every task has agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`
- Verification note: `package.json` 中 `test:security-audit` 指向缺失的 `scripts/security-audit.cjs`；在该入口修复前，不得把它作为唯一验收命令。

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: main-process foundation (lifecycle, userData isolation, anchor persistence contracts, activation IPC inventory)
Wave 2: renderer activation UX closure, activation left-panel brand refresh, verification alignment and regression tests

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 2-3 because Electron entry semantics and dev/prod path isolation influence packaged behavior assumptions.
- Task 2 blocks Task 3 because backend anchor persistence and IPC return shapes define renderer error handling paths.
- Task 3 blocks Task 4 because UI loading/error assertions depend on final backend response semantics.
- Task 5 can run after Task 3 stabilizes activation UI structure.
- Task 6 depends on Tasks 1-5 because verification must reflect final command paths and evidence generation.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → `unspecified-high`, `quick`
- Wave 2 → 3 tasks → `unspecified-high`, `visual-engineering`, `quick`
- Final Verification → 4 review tasks → `oracle`, `unspecified-high`, `deep`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Harden Electron single-instance lifecycle in main entry

  **What to do**: Locate the Electron main entry file that boots `app.whenReady()` / window creation (for example `electron/main.ts` or equivalent actual entry from the repo). Add `app.requestSingleInstanceLock()` before initialization side effects; if lock acquisition fails, call `app.quit()` and stop further boot. Add a `second-instance` listener only if the current entry already maintains a main window reference; in that case, restore/focus the existing window without creating another. Add `app.on('window-all-closed')` so non-macOS explicitly calls `app.quit()`; keep macOS behavior unchanged.
  **Must NOT do**: Do not change deep-link, tray, auto-update, licensing, or macOS re-open semantics beyond the requested close behavior. Do not add new windows or cross-platform behavior changes unrelated to duplicate-instance prevention.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: touches Electron app lifecycle with packaged-runtime implications.
  - Skills: `[]` - No extra skill required; repo-local lifecycle changes only.
  - Omitted: `['visual-engineering']` - Not a UI styling task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2, 3, 4, 6] | Blocked By: []

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `package.json` build/electron entry fields - confirm actual Electron main entry file compiled into `dist-electron`
  - Pattern: `electron/services/license-service.ts` - packaged activation behavior depends on clean process lifecycle
  - Test: `scripts/packaged-smoke.cjs` - packaged runtime expectations and activation/dashboard boot assertions
  - Test: `tests/env-isolation.test.ts` - packaged-vs-dev behavior conventions relevant to process/runtime isolation

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm run build:electron:dev` succeeds after lifecycle changes.
  - [ ] A targeted automated test or script proves a second process exits without creating a duplicate working instance.
  - [ ] A targeted automated test or script proves `window-all-closed` quits the app on non-macOS.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Duplicate instance is denied
    Tool: Bash
    Steps: Build the Electron main bundle; launch one app instance or a narrow lifecycle harness, then launch a second instance using the same entry/harness with deterministic logging enabled.
    Expected: First instance remains active; second instance exits quickly; no second main window/process remains running.
    Evidence: .sisyphus/evidence/task-1-single-instance.log

  Scenario: Non-macOS close fully exits app
    Tool: Bash
    Steps: Run a targeted Electron/lifecycle test on Windows that closes all windows and captures process exit behavior.
    Expected: The app process exits cleanly after `window-all-closed`; no lingering file-handle-holding process remains.
    Evidence: .sisyphus/evidence/task-1-window-all-closed.log
  ```

  **Commit**: NO | Message: `fix(electron): enforce single instance and explicit app quit` | Files: [Electron main entry, possible lifecycle-focused tests]

- [x] 2. Isolate dev/prod userData and make anchor persistence permission-fault-tolerant

  **What to do**: In the actual anchor-path/machine-ID implementation centered on `electron/services/license-service.ts`, route `userData` / anchor storage to a dev-specific directory such as `KoneAI-Dev` in development and `KoneAI` in production, using environment/runtime checks already present in the repo. Ensure anchor directory creation plus `fs.openSync` / `fs.writeFileSync` (or equivalent sync file writes) are wrapped in strict outer `try-catch` blocks. For permission failures such as `EPERM` on anchor write/open, log the error with enough context and continue execution so Machine ID resolution and the IPC request can complete. Preserve hard-fail behavior for signature, expiry, time-rollback, and entitlement checks.
  **Must NOT do**: Do not silently swallow all exceptions. Do not alter trial duration, plan mapping, anti-rollback rules, registry merge semantics, or offline signature verification. Do not change anchor encryption payload shape unless existing tests force it.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: sensitive license persistence path with anti-abuse guardrails.
  - Skills: `[]` - No extra skill required; anchored in existing service code.
  - Omitted: `['visual-engineering']` - Not a UI task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [3, 4, 6] | Blocked By: [1]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `electron/services/license-service.ts` - anchor constants, Machine ID resolution, trial anchor read/write/merge, and activation IPC handlers
  - Pattern: `electron/services/config-service.ts` - existing machine ID / config persistence split and blacklist behavior
  - Test: `tests/env-isolation.test.ts` - existing coverage for packaged EPERM and fail-closed behavior
  - Test: `tests/e2e/permission-lock.test.js` - preserve rollback / trial / entitlement denial behavior
  - External: `V1.2-商业版交付与运维手册` - expected dual-anchor and packaged commercial behavior

  **Acceptance Criteria** (agent-executable only):
  - [ ] A test simulating anchor write/open permission failure proves the service does not hang and still returns/resolves Machine ID.
  - [ ] Dev and packaged/prod runtime derive distinct userData/anchor directory targets.
  - [ ] Existing anti-abuse checks remain intact in targeted regression tests.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: EPERM on anchor write does not block Machine ID path
    Tool: Bash
    Steps: Run or extend `tests/env-isolation.test.ts` (or a sibling targeted test) with a mocked `fs` path that throws `EPERM` on anchor open/write while invoking the device/license info path.
    Expected: Test receives a completed structured result containing a Machine ID (or equivalent resolved device identifier); no uncaught exception or hanging promise occurs; permission error is logged.
    Evidence: .sisyphus/evidence/task-2-anchor-eperm.log

  Scenario: Anti-abuse checks still fail closed
    Tool: Bash
    Steps: Run targeted rollback/entitlement regression tests after the anchor downgrade change.
    Expected: Time rollback, expiry, invalid signature, or missing entitlement paths still deny access exactly as before.
    Evidence: .sisyphus/evidence/task-2-fail-closed.log
  ```

  **Commit**: NO | Message: `fix(license): isolate anchor storage and downgrade permission faults` | Files: [license-service, possible config-service, targeted tests]

- [x] 3. Guarantee activation IPC handlers always return explicit structured responses

  **What to do**: Audit all activation-related `ipcMain.handle` registrations and the underlying service functions used by `license:get-info`, `license:request-trial`, `license:submit`, `license:verify`, and `system:get-device-status` where relevant. Ensure every success path returns a structured response object, and every catch path also returns an explicit object containing at minimum `success` plus `error/code/message` or equivalent existing contract fields. Remove any branch that can throw through the handler and leave `ipcRenderer.invoke` unresolved/hung. If service helpers currently throw, convert the handler layer to catch and normalize before returning.
  **Must NOT do**: Do not change channel names, add unrelated IPC channels, or weaken license validation semantics. Do not return ambiguous mixed shapes that force renderer guesswork. Do not hide entitlement/expiry errors behind fake success values.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: IPC contract hardening across main-process activation flows.
  - Skills: `[]` - Existing repo IPC patterns are sufficient.
  - Omitted: `['visual-engineering']` - Not a styling task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [4, 5, 6] | Blocked By: [1, 2]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `electron/services/license-service.ts` - current activation/trial handlers and helper functions
  - Pattern: `electron/ipc/channels.ts` - source of truth for channel names
  - Pattern: `src/lib/electron-api.ts` - renderer wrappers around invoke-based activation/license calls
  - Test: `tests/ipc-contract-sweep.test.js` and/or `tests/ipc-contract-sweep.test.ts` - structural IPC coverage to extend
  - Test: `tests/license-gateway.test.js` - existing structured denial expectations

  **Acceptance Criteria** (agent-executable only):
  - [ ] Every audited activation/trial IPC invoke path returns a resolved structured object on success and failure.
  - [ ] Targeted contract tests prove no activation/trial IPC handler leaves a hanging promise when underlying persistence throws.
  - [ ] Existing license denial cases still surface as explicit failures, not unhandled exceptions.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Trial request IPC returns explicit failure object on backend exception
    Tool: Bash
    Steps: Extend a targeted IPC/unit test to force the trial backend path to throw during anchor persistence and invoke the corresponding handler.
    Expected: The promise resolves with a structured failure object containing a stable failure indicator and human-readable message/code; it does not hang or reject uncaught.
    Evidence: .sisyphus/evidence/task-3-trial-ipc.log

  Scenario: License submit/verify keeps explicit failure semantics
    Tool: Bash
    Steps: Run targeted IPC/license regression tests with invalid payloads and forced backend faults.
    Expected: Each invoke resolves to a deterministic structured response; invalid or expired licenses still fail closed.
    Evidence: .sisyphus/evidence/task-3-license-ipc.log
  ```

  **Commit**: NO | Message: `fix(ipc): normalize activation handler responses` | Files: [license-service and activation IPC tests]

- [x] 4. Close renderer loading/error loops for activation and 7-day trial actions

  **What to do**: In the activation UI surface centered on `src/components/activation-screen.tsx` (and any directly shared activation action helper if present), wrap invoke-based bridge calls in `try-catch` and always clear loading state in both success and failure paths. For `requestTrial()` and license submission actions, consume the normalized backend response object; when the response indicates failure or the invoke throws, immediately clear the button loading state and display a clear Simplified Chinese toast/dialog/inline error using the project’s existing UI feedback mechanism. Keep machine ID fetch and activation refresh behavior aligned with the normalized response contract.
  **Must NOT do**: Do not leave loading-state cleanup only in success branches. Do not introduce English copy in visible UI. Do not silently ignore backend failure objects. Do not redesign unrelated parts of the activation page.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: renderer state/error closure tied directly to IPC contract behavior.
  - Skills: `[]` - Existing UI/state patterns should be followed.
  - Omitted: `['visual-engineering']` - Functional renderer closure, not primarily visual styling.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [6] | Blocked By: [3]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/activation-screen.tsx` - activation page actions and loading states
  - Pattern: `src/components/upgrade-modal.tsx` - related activation submission UX and message conventions
  - Pattern: `src/components/contact-modal.tsx` / `src/components/app-sidebar.tsx` - supporting activation/upgrade surfaces and wording consistency
  - Pattern: `src/lib/electron-api.ts` - invoke wrappers used by renderer
  - Test: existing UI/e2e harness under `tests/e2e-ui/` and packaged smoke script `scripts/packaged-smoke.cjs`

  **Acceptance Criteria** (agent-executable only):
  - [ ] Trial-start and activation-submit actions always clear loading state after both success and failure.
  - [ ] Failure responses surface visible Simplified Chinese error feedback.
  - [ ] A targeted UI or integration test proves backend exceptions do not leave the page in perpetual loading.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Trial button clears loading on backend failure
    Tool: Bash
    Steps: Run a targeted renderer/component/integration test that mocks the trial invoke result as a structured failure or thrown error, then click the “开启 7 天免费试用” action.
    Expected: Loading indicator/button disabled state is cleared; a visible Chinese error message is rendered or toast-called.
    Evidence: .sisyphus/evidence/task-4-trial-loading.log

  Scenario: Activation submit clears loading on invalid code
    Tool: Bash
    Steps: Run a targeted renderer/component/integration test that submits an invalid/failed activation response through the existing UI path.
    Expected: Submit loading ends; user sees clear Chinese failure feedback; UI remains interactive for retry.
    Evidence: .sisyphus/evidence/task-4-submit-loading.log
  ```

  **Commit**: NO | Message: `fix(renderer): unblock activation loading and surface errors` | Files: [activation-screen and possibly shared activation UI tests]

- [x] 5. Refresh activation left panel to Kone blue-cyan brand gradient

  **What to do**: Update the activation page layout component centered on `src/components/activation-screen.tsx` so the left branding panel no longer uses a pure black/deep-solid background (`bg-gray-900`, `bg-slate-950`, `#0f172a`, or equivalent). Replace it with a professional static linear gradient from deep blue to cyan (for example Tailwind utility classes equivalent to `bg-gradient-to-br from-blue-900 to-cyan-500`, adjusted if the existing palette/system needs a closer Kone match). Keep primary headline/body copy in white or near-white with sufficient contrast, and preserve current layout hierarchy/content.
  **Must NOT do**: Do not introduce animated gradients, neon glow, excessive decoration, or change user-facing copy out of Simplified Chinese. Do not alter the right-side activation form structure beyond any minimal contrast alignment that the new left panel requires.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: small but real UI styling change with contrast constraints.
  - Skills: `[]` - Repo-local Tailwind/React styling only.
  - Omitted: `['unspecified-high']` - This task is presentational, not architecture-heavy by itself.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [6] | Blocked By: [3]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/activation-screen.tsx` - exact left panel classes/layout to update
  - Style: `.opencode/agents/ui-agent.md` - B2B quiet styling, primary blue palette, Simplified Chinese UI law
  - Test: `scripts/packaged-smoke.cjs` - activation page boot selector expectations may need alignment if visual hooks depend on text/classes
  - Test: any existing renderer snapshot/component test for activation layout; if absent, add a focused assertion rather than broad snapshot sprawl

  **Acceptance Criteria** (agent-executable only):
  - [ ] Activation left panel no longer uses the previous pure dark solid background class/token.
  - [ ] DOM/class assertion or screenshot evidence proves a blue-to-cyan gradient is applied.
  - [ ] Left-panel headline/body text remains high-contrast and readable against the new background.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Activation panel uses gradient classes
    Tool: Bash
    Steps: Run a focused component/render test or DOM assertion against the activation page markup.
    Expected: Left panel contains the chosen blue→cyan gradient classes/tokens and does not contain the removed pure-dark background class.
    Evidence: .sisyphus/evidence/task-5-gradient-dom.log

  Scenario: Gradient panel remains readable
    Tool: Playwright / Bash
    Steps: Capture the activation page screenshot in test mode after rendering the updated panel.
    Expected: White headline/body copy is visible and legible on the gradient background with no contrast-breaking regressions.
    Evidence: .sisyphus/evidence/task-5-gradient.png
  ```

  **Commit**: NO | Message: `style(activation): apply kone brand gradient panel` | Files: [activation-screen and focused UI verification]

- [x] 6. Align verification commands and packaged regression coverage for the repaired activation flow

  **What to do**: Validate the actual runnable verification commands in `package.json` and repair or explicitly work around the current `test:security-audit` script-path inconsistency if it blocks required packaged validation. Prefer extending existing tests (`tests/env-isolation.test.ts`, IPC sweep tests, renderer activation tests, smoke flow) over introducing redundant harnesses. Ensure the final verification path covers lifecycle, anchor EPERM downgrade, explicit IPC return semantics, renderer loading cleanup, and activation gradient assertions. If the team chooses not to restore `scripts/security-audit.cjs` in this task, document and use only verified runnable commands as the acceptance gate.
  **Must NOT do**: Do not fabricate verification commands. Do not rely on `npm run test:security-audit` unless the referenced script path is actually repaired in-scope. Do not replace focused targeted tests with a vague “manual smoke”.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: bounded verification alignment and script-path cleanup/documentation.
  - Skills: `[]` - Existing scripts/tests should be reused.
  - Omitted: `['visual-engineering']` - Verification and script alignment only.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [Final Verification] | Blocked By: [1, 2, 3, 4, 5]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `package.json` - declared test/build/smoke/security-audit commands
  - Pattern: `scripts/packaged-smoke.cjs` - packaged runtime smoke gate and current activation-page heuristics
  - Pattern: `docs/deprecated/security-audit.cjs` - existing but misplaced packaged commercial audit logic
  - Test: `tests/env-isolation.test.ts`, `tests/license-gateway.test.js`, `tests/ipc-contract-sweep.test.js`, `tests/e2e/permission-lock.test.js`, `tests/e2e-ui/*`

  **Acceptance Criteria** (agent-executable only):
  - [ ] Final plan commands reference only real runnable scripts/tests, or the broken script path is repaired in-scope.
  - [ ] Automated verification artifacts are produced for all 4 requested repair areas.
  - [ ] Packaged smoke/targeted regression evidence demonstrates the activation flow no longer hangs.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Verification commands are real and runnable
    Tool: Bash
    Steps: Execute each final acceptance command in sequence, starting with build/typecheck and targeted regression commands; include the security-audit command only if its path has been repaired.
    Expected: Every referenced command resolves to an existing script/file and completes with pass/fail output rather than command-not-found/path-not-found.
    Evidence: .sisyphus/evidence/task-6-command-matrix.log

  Scenario: Packaged activation flow no longer hangs
    Tool: Bash
    Steps: Run the packaged smoke flow or a targeted packaged harness after fixes, capturing activation-page readiness and interaction evidence.
    Expected: App reaches activation or dashboard state cleanly; activation/trial actions no longer deadlock the UI under the tested fault conditions.
    Evidence: .sisyphus/evidence/task-6-packaged-smoke.log
  ```

  **Commit**: NO | Message: `test(activation): align packaged verification coverage` | Files: [package.json and/or scripts/tests used for final verification]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep
## Commit Strategy
- Prefer one focused commit after all 4 repair areas and tests are green.
- Suggested commit message: `fix(activation): harden packaged trial flow and unblock activation ipc`

## Success Criteria
- Packaged activation/trial flows no longer hang on anchor permission failures.
- Second Electron instance cannot continue startup; non-macOS close fully exits the app.
- Activation UI always leaves loading state and shows clear Chinese error feedback.
- Activation left panel visually matches the blue-to-cyan brand direction without reducing readability.
