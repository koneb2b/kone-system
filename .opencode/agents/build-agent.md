# KONE BUILD AGENT PROTOCOL

## 1. Build Mission
The build pipeline exists to produce a clean, reproducible desktop deliverable without leaking secrets, stale artifacts, or internal authoring assets.

---

## 2. Core Environment Rules
1. Validate `package.json` scripts before relying on them.
2. Electron-facing Vite output must remain compatible with local file loading.
3. Reuse existing dependencies wherever possible; avoid adding heavy infrastructure packages unless absolutely necessary and approved.
4. If architecture, state shape, or commercial boundaries change, companion standards documents must be updated together.
5. Kone packaging and runtime verification must assume low-spec office hardware as a first-class target, not an afterthought.

---

## 3. Core Asset Isolation
Never allow the following into production packaging:
- private key material such as `*.pem`
- `.opencode` caches or authoring artifacts
- `tests/` directories
- temporary debug outputs
- local-only regression scaffolding that has no runtime purpose

If packaging include/exclude rules are touched, explicit deny rules must be used.

---

## 4. Zero-Residue Cleaning
1. Clean old artifacts before each production build.
2. At minimum, stale output in `release/`, `dist/`, and `dist-electron/` must not pollute a fresh package.
3. Never trust a build result that may contain previous binaries or prior obfuscation output.

### 4.1 V1.3 New Service Packaging
The following V1.3 services have been added to the main-process handler registry in `electron/main.ts` and must be included in packaging:
- `electron/services/agent-service.ts` — 3 local sales agents (WhatsApp/LinkedIn/Email)
- `electron/services/sandbox-service.ts` — Multi-account session partition isolation
- `electron/services/dns-service.ts` — DNS deliverability shield

These services are registered via `registerIpcHandlers()` in `main.ts` lines 82-84. The Electron packaging config at `package.json#build.files` already includes all of `dist-electron/**/*`, so no special packaging exclusion is needed for these new services.

### 4.2 V1.3 New UI Components
The following V1.3 components are lazy-loaded in `dashboard-page.tsx`:
- `src/components/agents-panel.tsx` — `/agents` route
- `src/components/accounts-management.tsx` — `/accounts` route

These are included in the Vite renderer build automatically via lazy imports.

---

## 5. Production Logging Floor
1. Production bundles must not preserve noisy `console.log` or `console.debug` traces.
2. Only necessary irrecoverable diagnostics may survive as `console.error`.
3. Build-time debugging is allowed temporarily, but must not ship.
4. **DEV bypass safety (confirmed):** `import.meta.env.DEV` in `src/lib/feature-gate.ts:189` is statically replaced with `false` by Vite during production renderer build, preventing enterprise fallback leakage. The obfuscation script (`scripts/obfuscate.cjs`) further hardens the main-process JS output.
5. **Probe logging note:** renderer-side store diagnostics should stay no-op or be compile-time stripped; main-process probe logs must use the existing `probeLog(...)` helper so production bundles remain quiet.

---

## 6. Commercial Packaging Awareness
1. Trial, Basic, and Premium boundaries are code-level law and must not be blurred by dev-only package shortcuts.
2. Local Basic assets and Premium cloud capabilities may coexist in one binary, but privilege activation must still remain Fail-Closed at runtime.
3. Build steps must never weaken license validation, offline signature checks, or time-defense behavior.

---

## 7. Autopilot and Cloud Boundary Reminder
1. Autopilot is a local feature and does not require cloud packaging privilege by itself.
2. Premium cloud automation is a separate runtime entitlement and must stay authorization-gated after build.
3. Packaging must not imply that local background cruise can continue after machine shutdown; product copy and bundled docs must preserve that distinction.

---

## 8. Low-Spec Runtime Verification
1. Release verification should include a practical startup and memory sanity check on a low-spec office environment target.
2. Minimum validation baseline:
   - app launches cleanly on `4G-8G RAM` machine profile
   - no abnormal idle memory climb after startup
   - no obvious CPU saturation during basic search flow
3. Search enrichment, website probing, blind scoring, and `四级弹性搜索协议` fallback changes must preserve the hard resource ceiling: search scoring and website enrichment concurrency fixed at `2`, and website text passed to LLM stripped of HTML/script/style noise and capped at `3000` characters.
4. If an `.exe` is only smooth on development hardware, the build is not release-ready.
5. Multi-language Provider expansion may increase search API calls, but packaged runtime must still keep LLM scoring, website enrichment, Agent health polling, and account health polling within low-spec constraints.
6. Agent runtime dependencies for real execution (SMTP/IMAP, WhatsApp Web, browser automation) must be explicitly reviewed before packaging. Do not ship mock-only `setTimeout` agent behavior as a completed V1.3 feature.

Any build candidate that exceeds the `2` concurrency ceiling or the `3000`-character website-text ceiling fails release sign-off.

---

## 9. Production Fallback Detection

### 9.1 Electron Bridge Fallback
- `electron/services/electron-bridge.ts` includes a stub fallback mode for when the Electron module cannot be loaded (Electron 33+ Windows bug #49034)
- In production builds, the fallback MUST:
  1. Write a critical error log to `$userData/.fallback-critical.log`
  2. Attempt a `msg.exe` dialog with Chinese-language error
  3. Exit via `process.exit(1)` after 5 seconds
- The `setTimeout(exit, 5000)` ensures termination even if dialog and log both fail
- The fallback code is NOT a dev-only stub; it must be included in packaging
- Production builds must never keep an invisible process alive silently

### 9.2 Crash Reporter
- `electron/services/crash-reporter.ts` initializes at app startup via `initCrashReporter()`
- Captures `uncaughtException` and `unhandledRejection`
- Writes crash dumps to `$userData/crash-reports/`
- Remote upload disabled by default; user opts in
- `source-map-support` must be bundled for packaged stack trace symbolication

### 9.3 Backup Service
- `electron/services/backup-service.ts` provides automatic daily backups
- Backups stored at `$userData/backups/`
- Maximum 7 backups retained; integrity verified via checksum
- Initialized at startup; does not block app boot

---

## 10. Definition of Build Done
A build-oriented task is complete only when:
1. authoring residue is excluded
2. stale outputs are cleaned
3. production logging remains quiet
4. commercial isolation remains intact
5. low-spec startup and memory behavior are acceptable
6. generated package artifacts come from a fresh, successful build path
