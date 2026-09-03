# 开发环境终极特权放行计划

## TL;DR
> **Summary**: 在 `!app.isPackaged` 条件下，为主进程底层特征鉴权函数增加统一短路放行，并补齐手写鉴权路径与验证矩阵，确保开发环境不再因 `FEATURE_DENIED` 阻塞搜索；打包环境继续保持 Fail-Closed。
> **Deliverables**:
> - 底层鉴权函数定位与统一 dev bypass 实施
> - 手写鉴权调用点补齐/对齐
> - renderer 预拦截核查与必要对齐
> - 自动化测试与命令级验证证据
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 3 → 5 → 6

## Context
### Original Request
- 用户确认：上次 EPERM 隔离已生效，UI 已显示高级版，但点击搜索时仍抛出 `FEATURE_DENIED`。
- 用户要求：只输出计划，禁止直接改代码。
- 用户要求：定位 `electron/security/license-guard.ts` 或实际处理拦截的模块中的 `requireFeature`、`requireAnyFeature`、`ensureFeature` 等底层核心函数。
- 用户要求：在这些函数最顶部注入开发环境终极放行逻辑，形式为 `if (!app.isPackaged) return;` 或按函数签名等价实现。
- 用户要求：该修改只在开发环境生效，绝不影响生产环境 Fail-Closed。
- 用户要求：拿到计划后切换到 Sisyphus(Build) 模式执行。

### Interview Summary
- 当前现象说明：`ensureTrialAccess` 不是唯一拦截源，因为 UI 显示高级版后，搜索仍然命中 `FEATURE_DENIED`。
- 本地搜索证据显示：
  - `electron/security/license-guard.ts` 中的 `requireFeature` / `requireAnyFeature` 是特征鉴权最底层核心。
  - `electron/services/license-service.ts` 中的 `registerSecureFeatureIpc` 会在执行 handler 前调用上述函数，并将抛错转换为 `FEATURE_DENIED` 返回。
  - `electron/services/license-service.ts` 中的 `ensureTrialAccess` 已经在 `!app.isPackaged` 下直接放行，因此当前问题更可能是 feature gate 而非 trial gate。
  - `electron/services/automation-service.ts` 存在手写 `licenseGuard.requireFeature('cloud_send', '自动化发信')` 调用，不完全依赖通用注册器。
  - `src/components/search-engine.tsx:732` 已知存在 `featureGate.canAccess('search_basic')` 的 renderer 前置拦截，执行时必须核查是否也要做 dev-only 对齐。
- 默认决策：按用户指定的注入位置与“终极特权放行”语义，将本次执行定义为 **开发环境全局特征放行**，而不是“仅搜索放行”。

### Metis Review (gaps addressed)
- Metis 指出：若把短路放在 `requireFeature / requireAnyFeature` 最底层，则会解锁所有 feature-gated 能力，而非仅搜索。
- 本计划已将该行为明确定义为 **开发环境全局放行（仅限 `!app.isPackaged`）**，避免执行者误以为只影响搜索。
- Metis 指出：renderer 侧可能仍有预拦截，导致主进程放行后 UI 依然阻塞。
- 本计划已要求对 renderer 预检查进行核查，并仅在确认存在实际阻断时做最小同步修复。
- Metis 指出：除通用注册器外，还有手写鉴权路径。
- 本计划已把 `automation-service.ts` 的手写调用列为显式核查与验证对象。

## Work Objectives
### Core Objective
在不改动生产授权语义的前提下，让所有基于主进程底层特征鉴权的开发环境请求在 `!app.isPackaged` 时直接放行，彻底消除开发期 `FEATURE_DENIED` 对搜索与其他 gated IPC 的阻断。

### Deliverables
- `electron/security/license-guard.ts` 中底层鉴权函数的统一 dev bypass 设计与实现
- `electron/services/license-service.ts` 调用链对齐确认
- `electron/services/automation-service.ts` 手写鉴权路径核查/必要对齐
- renderer 侧 feature gate 预拦截核查与必要最小修复（已知 `src/components/search-engine.tsx:732` 存在 `search_basic` 前置检查）
- `tests/` 下新增或扩展的自动化测试，覆盖 unpackaged 放行与 packaged fail-closed
- 命令执行证据，证明 dev 通畅与 prod fail-closed 保持不变

### Definition of Done (verifiable conditions with commands)
- `!app.isPackaged` 下，搜索相关主进程 gated path 不再返回 `FEATURE_DENIED`
- `app.isPackaged = true` 且缺少 entitlement 时，底层鉴权仍返回拒绝/抛出 403 语义
- `automation:start-campaign` 的手写 feature gate 在开发环境与生产环境表现符合预期矩阵
- renderer 若存在预拦截，则在开发环境不再阻断搜索入口；若不存在，则代码审计证明无需修改
- 至少一个自动化测试文件验证 unpackaged bypass 与 packaged fail-closed
- 执行并通过与本任务相关的测试命令

### Must Have
- dev bypass 的唯一门控条件为 `!app.isPackaged`
- bypass 注入位置优先在 `requireFeature` / `requireAnyFeature` 顶部
- 生产环境逻辑不变，不能放宽 packaged 下的任何特征校验
- 明确验证 search path 与 manual path (`automation:start-campaign`)
- 必须核查 renderer 侧 gating 是否仍会在 IPC 前阻断

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不得用 `process.env.NODE_ENV` 替代 `app.isPackaged` 作为本次 bypass 的主门控
- 不得修改商业套餐映射、claims 生成策略、trial 规则、offline license 校验逻辑
- 不得把本任务扩展成 licensing 重构
- 不得在生产环境加入任何短路放行
- 不得只修搜索而忽略底层全局放行的连带影响说明
- 不得仅凭 UI 状态判断通过，必须有自动化验证

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + Node test / existing package scripts
- QA policy: Every task has agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: 鉴权核心梳理与变更设计（1-3）
Wave 2: 调用点对齐、测试、验证（4-6）

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 3, 4, 5, 6
- 2 blocks 4, 5, 6
- 3 blocks 6
- 4 blocks 6
- 5 blocks 6
- 6 blocks Final Verification Wave

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → deep / quick / unspecified-low
- Wave 2 → 3 tasks → quick / unspecified-high / deep
- Final Verification → 4 tasks → oracle / unspecified-high / deep

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. 锁定底层 dev bypass 注入点

  **What to do**: 审核并确认 `electron/security/license-guard.ts` 中 `requireFeature`、`requireAnyFeature`、`requireActiveClaims` 的最终放行策略；明确本次实现采用“在 `requireFeature` / `requireAnyFeature` 顶部短路返回与合法返回结构”的方式，而不是修改 `requireActiveClaims` 或上层 wrapper，避免把 claims 语义和 feature 语义耦合得更深。
  **Must NOT do**: 不要把 bypass 放到 `verifyLicenseClaims`、`normalizeFeatureSet`、offline license 校验或试用锚点逻辑中。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 这是安全/授权底层决策点，必须先做正确边界判断。
  - Skills: [] - 无额外技能需求
  - Omitted: [`git-master`] - 本任务不涉及 git 操作

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2,3,4,5,6 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `electron/security/license-guard.ts:84-115` - 当前 `requireActiveClaims` / `requireFeature` / `requireAnyFeature` 的真实实现
  - Pattern: `electron/services/license-service.ts:473-496` - `registerSecureFeatureIpc` 如何将底层抛错转为 `FEATURE_DENIED`
  - Pattern: `electron/services/license-service.ts:400-434` - `ensureTrialAccess` 已在 dev 下短路，证明当前主要问题不是 trial gate
  - Test: `tests/env-isolation.test.ts` - 现有 dev/prod 隔离测试模式
  - Test: `tests/license-gateway.test.js` - IPC gate 的现有断言模式

  **Acceptance Criteria** (agent-executable only):
  - [ ] 代码中明确存在仅由 `!app.isPackaged` 控制的底层 bypass 设计，且落点位于 `requireFeature` / `requireAnyFeature`
  - [ ] 该设计不会修改 packaged 下 `requireActiveClaims` 的拒绝行为
  - [ ] 返回值与原函数签名兼容，不引入调用方解构错误

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Bottom-layer gate design confirmed
    Tool: Bash
    Steps: 1) Build agent reads target file 2) confirms bypass is in requireFeature/requireAnyFeature 3) confirms no new production short-circuit exists
    Expected: Exact diff location matches decision and packaged path remains unchanged in effect
    Evidence: .sisyphus/evidence/task-1-gate-design.txt

  Scenario: Wrong-layer bypass rejected
    Tool: Bash
    Steps: 1) Inspect diff for verifyLicenseClaims/ensureTrialAccess/offline-license changes 2) verify none were used as primary bypass layer
    Expected: No accidental bypass introduced into trial or offline license verification logic
    Evidence: .sisyphus/evidence/task-1-wrong-layer-check.txt
  ```

  **Commit**: NO | Message: `fix(auth): add dev-only feature gate bypass` | Files: `electron/security/license-guard.ts`

- [x] 2. 实现 dev-only 全局特征放行

  **What to do**: 在 `electron/security/license-guard.ts` 中为 `requireFeature` 与 `requireAnyFeature` 顶部注入 `!app.isPackaged` 早退逻辑；根据原函数返回值，返回一个兼容调用方的对象（至少包含 `claims` 与 `featureSet`），不要简单裸 `return` 造成 undefined 被上游消费。若需要共享逻辑，提炼本地私有 helper，但禁止扩散到无关模块。
  **Must NOT do**: 不要用 `return;` 破坏返回结构；不要只改其中一个函数；不要改生产分支；不要新增环境变量门控。

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 改动集中在单个核心文件，但要求精确。
  - Skills: []
  - Omitted: [`review-work`] - 之后统一做验证波

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 4,5,6 | Blocked By: 1

  **References**:
  - Pattern: `electron/security/license-guard.ts:98-115` - 现有两个函数返回 `{ claims, featureSet }`
  - Pattern: `electron/security/license-guard.ts:47-55` - 当前 `getStoredClaims` 的 dev mock claims 思路，可复用其 `app.isPackaged` 判定风格
  - API/Type: `electron/security/license-guard.ts:3-18` - `StoredLicenseClaims` 与 `GuardDeps` 类型
  - Pattern: `electron/services/automation-service.ts:297-307` - 手写 `requireFeature` 依赖返回/throw 行为

  **Acceptance Criteria**:
  - [ ] `requireFeature` 在 `!app.isPackaged` 下不再抛出 `FEATURE_DENIED` 对应错误
  - [ ] `requireAnyFeature` 在 `!app.isPackaged` 下不再抛出 `FEATURE_DENIED` 对应错误
  - [ ] `app.isPackaged = true` 下缺 feature 时仍保留现有拒绝逻辑

  **QA Scenarios**:
  ```
  Scenario: Unpackaged feature gate passes
    Tool: node --test
    Steps: 1) Mock electron app.isPackaged=false 2) instantiate createLicenseGuard 3) call requireFeature('search_basic','海外客户智能搜索') and requireAnyFeature(['lead_export','export_full'],'数据导出')
    Expected: Both calls return a valid object with no throw
    Evidence: .sisyphus/evidence/task-2-dev-bypass.txt

  Scenario: Packaged feature gate still fails closed
    Tool: node --test
    Steps: 1) Mock electron app.isPackaged=true 2) instantiate createLicenseGuard without claims 3) call requireFeature('search_basic','海外客户智能搜索')
    Expected: Throws/returns denial matching existing fail-closed semantics
    Evidence: .sisyphus/evidence/task-2-prod-fail-closed.txt
  ```

  **Commit**: NO | Message: `fix(auth): bypass feature checks in unpackaged runtime` | Files: `electron/security/license-guard.ts`

- [x] 3. 核查并对齐通用 IPC 拦截层

  **What to do**: 审核 `electron/services/license-service.ts` 中 `registerSecureIpc`、`registerSecureFeatureIpc`、`ensureTrialAccess` 的联动，确认无需再新增 dev bypass；如果执行者发现 search 仍被 wrapper 层标记为 `FEATURE_DENIED`，只允许做最小对齐修改，不允许改变 packaged 行为或 duplicate bypass 到多层。
  **Must NOT do**: 不要把同一 bypass 同时复制到多层形成不可维护的双保险；不要更改 `buildFeatureDeniedResponse` 的生产语义。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需要判断是否应保持单点放行还是最小补洞。
  - Skills: []
  - Omitted: [`ai-slop-remover`] - 不适用于该任务

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 6 | Blocked By: 1

  **References**:
  - Pattern: `electron/services/license-service.ts:459-496` - wrapper 的完整拦截路径
  - Pattern: `electron/services/license-service.ts:446-457` - `FEATURE_DENIED` 返回格式
  - Pattern: `electron/services/search-service.ts:1292-1294` - 搜索使用 `registerSecureFeatureIpc('search_basic')`
  - Pattern: `electron/services/search-service.ts:1662-1664` - analysis 也走同一路径

  **Acceptance Criteria**:
  - [ ] wrapper 层不再在 dev 中导致 search 命中 `FEATURE_DENIED`
  - [ ] 若无代码改动需要，也有代码审计证据证明底层 bypass 已足够覆盖 wrapper 路径
  - [ ] packaged 下 wrapper 对 feature error 的映射保持不变

  **QA Scenarios**:
  ```
  Scenario: Search wrapper reaches handler in dev
    Tool: node --test
    Steps: 1) Mock ipcMain and electron app.isPackaged=false 2) register a secure feature IPC with 'search_basic' 3) invoke handler
    Expected: Handler executes instead of returning FEATURE_DENIED
    Evidence: .sisyphus/evidence/task-3-dev-wrapper.txt

  Scenario: Search wrapper still denies in packaged runtime
    Tool: node --test
    Steps: 1) Same setup with app.isPackaged=true and missing claims 2) invoke handler
    Expected: Returns FEATURE_DENIED payload with code 403 and handler not executed
    Evidence: .sisyphus/evidence/task-3-prod-wrapper.txt
  ```

  **Commit**: NO | Message: `test(auth): verify secure feature IPC dev bypass` | Files: `electron/services/license-service.ts`, `tests/...`

- [x] 4. 补齐手写鉴权路径与高价值调用点审计

  **What to do**: 审核所有直接调用 `licenseGuard.requireFeature/requireAnyFeature` 的路径，至少覆盖 `electron/services/automation-service.ts` 中 `automation:start-campaign` 的手写特征校验；如果底层 bypass 已自然覆盖，只需加测试证明，不做多余代码改动。额外审计 search / analysis / export / cloud 路径，确认没有遗漏的手写阻断点。
  **Must NOT do**: 不要把任务扩展成全仓库授权重构；不要修改无关业务逻辑。

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: 主要是定向审计与最小补齐。
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - 与 UI 设计无关

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6 | Blocked By: 2

  **References**:
  - Pattern: `electron/services/automation-service.ts:289-307` - 手写 `ensureTrialAccess` + `licenseGuard.requireFeature`
  - Pattern: `electron/services/export-service.ts:13-38` - export path 通过 wrapper 进入底层 gate
  - Pattern: `electron/services/supabase-service.ts:377-508` - cloud paths 全部通过 wrapper 进入底层 gate
  - Search Evidence: `electron/services/search-service.ts:1292-1294`, `1662-1664`

  **Acceptance Criteria**:
  - [ ] 至少列出并核查所有直接 `licenseGuard.requireFeature/requireAnyFeature` 调用点
  - [ ] `automation:start-campaign` 在 dev 下不会再被 feature gate 手写调用拦截
  - [ ] packaged 下 `automation:start-campaign` 仍保持 `FEATURE_DENIED` / 403 语义

  **QA Scenarios**:
  ```
  Scenario: Manual auth path passes in dev
    Tool: node --test
    Steps: 1) Mock app.isPackaged=false 2) register automation handlers 3) invoke automation:start-campaign through mocked ipcMain with minimal payload
    Expected: Request proceeds beyond feature gate; any failure must be downstream/non-license, not FEATURE_DENIED
    Evidence: .sisyphus/evidence/task-4-dev-manual-path.txt

  Scenario: Manual auth path stays fail-closed in packaged runtime
    Tool: node --test
    Steps: 1) Mock app.isPackaged=true 2) register automation handlers without cloud_send entitlement 3) invoke automation:start-campaign
    Expected: Returns FEATURE_DENIED/403 and does not report bypass
    Evidence: .sisyphus/evidence/task-4-prod-manual-path.txt
  ```

  **Commit**: NO | Message: `test(auth): cover manual feature gate paths` | Files: `tests/...`, optionally `electron/services/automation-service.ts`

- [x] 5. 核查 renderer 预拦截并做必要最小对齐

  **What to do**: 搜索 renderer 中所有 `featureGate.canAccess(...)`、搜索按钮禁用、搜索入口提前 toast/return 的逻辑，重点核查 search 页面是否在 IPC 前就拦截了 `search_basic`。若 dev 下 UI 已正确放行，则只留下审计证据；若仍阻断，则做仅限 `!app.isPackaged` 的最小同步放行。
  **Must NOT do**: 不要改动与本任务无关的 UI 文案或页面结构；不要让 renderer 成为授权真相来源。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 需要从用户可见链路验证是否还有前端预拦截。
  - Skills: []
  - Omitted: [`playwright`] - 非必须，除非执行者选择浏览器验证

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6 | Blocked By: 2

  **References**:
  - Pattern: `src/components/search-engine.tsx:732` - 搜索入口在 IPC 前执行 `featureGate.canAccess('search_basic')`
  - Pattern: `src/lib/feature-gate.ts:84-89,171-173` - renderer 侧 search/basic/premium 能力映射与搜索限制逻辑
  - Pattern: `electron/services/search-service.ts:1292-1294` - 主进程对应的 search gate

  **Acceptance Criteria**:
  - [ ] 若 renderer 存在 dev 阻断，修改后开发环境点击搜索不会在 IPC 前被 UI 拦截
  - [ ] 若 renderer 不存在 dev 阻断，有代码审计证据证明无需改动
  - [ ] production / packaged 下 renderer 现有商业边界不被放宽

  **QA Scenarios**:
  ```
  Scenario: Renderer no longer blocks search in dev
    Tool: Playwright / Bash
    Steps: 1) Run dev app 2) open search UI 3) submit a valid search request
    Expected: No UI-side premium/feature denial toast before IPC; request proceeds
    Evidence: .sisyphus/evidence/task-5-dev-renderer.txt

  Scenario: Renderer commercial boundary unchanged in packaged logic
    Tool: Bash
    Steps: 1) Static review renderer feature checks 2) compare packaged-only conditions before/after
    Expected: No new production-side UI unlocks beyond unpackaged runtime
    Evidence: .sisyphus/evidence/task-5-prod-renderer.txt
  ```

  **Commit**: NO | Message: `fix(ui): align dev search gate with unpackaged auth bypass` | Files: `src/...` only if required

- [x] 6. 建立验证矩阵并执行命令级证明

  **What to do**: 新增或扩展测试文件，形成最小但完整的矩阵：`license-guard` 底层、`registerSecureFeatureIpc` 搜索路径、`automation:start-campaign` 手写路径、renderer 预拦截（如需要）。执行与现有仓库一致的测试命令，并收集结果作为证据。若适合，沿用 `tests/env-isolation.test.ts` 与 `tests/license-gateway.test.js` 的模式扩展新的 `.js`/`.ts` 测试。
  **Must NOT do**: 不要仅凭手工点击验证；不要把外部 API 成功作为通过条件；不要省略 packaged 负向测试。

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 主要是补测试与跑命令，但需要严谨矩阵。
  - Skills: []
  - Omitted: [`dev-browser`] - 可选，不是必需

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Final Verification Wave | Blocked By: 2,3,4,5

  **References**:
  - Test: `tests/env-isolation.test.ts` - packaged vs unpackaged 隔离断言模式
  - Test: `tests/license-gateway.test.js` - secure IPC handler mock 模式
  - Command: `package.json:18-25` - 可用测试脚本与 build 脚本
  - Pattern: `electron/services/license-service.ts:459-496` - wrapper 行为需要被测试命中
  - Pattern: `electron/services/automation-service.ts:289-317` - manual path 需要被测试命中

  **Acceptance Criteria**:
  - [ ] 存在自动化测试覆盖以下四项：unpackaged 底层放行、packaged 底层拒绝、unpackaged 搜索 wrapper 放行、packaged manual path 拒绝
  - [ ] `npm run build:electron:dev` 成功
  - [ ] 相关 `node --test ...` 命令全部通过
  - [ ] 证据文件明确区分“开发环境已通畅”与“生产 fail-closed 未破坏”

  **QA Scenarios**:
  ```
  Scenario: Full auth matrix passes
    Tool: Bash
    Steps: 1) run npm run build:electron:dev 2) run targeted node --test commands for new/updated test files
    Expected: All commands exit 0 and logs show no FEATURE_DENIED in dev test paths, while packaged tests still deny
    Evidence: .sisyphus/evidence/task-6-auth-matrix.txt

  Scenario: Negative production proof remains intact
    Tool: Bash
    Steps: 1) run packaged-mode mock tests for secure feature IPC and automation manual path 2) inspect outputs for 403/FEATURE_DENIED
    Expected: Packaged-mode denial semantics preserved exactly where expected
    Evidence: .sisyphus/evidence/task-6-prod-proof.txt
  ```

  **Commit**: NO | Message: `test(auth): prove dev bypass and prod fail-closed matrix` | Files: `tests/...`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- 实施阶段按“底层 gate → wrapper/手写路径 → renderer 对齐 → tests/verification”组织提交或单次集中提交。
- 若只允许一个提交，优先消息：`fix(auth): bypass unpackaged feature gates while preserving packaged fail-closed`
- 禁止提交无关格式化噪音。

## Success Criteria
- 开发环境下，点击搜索不再因为主进程或 renderer feature gate 返回/显示 `FEATURE_DENIED`
- 打包环境下，缺少 entitlement 的搜索/云端/手写鉴权路径仍然拒绝
- 变更只依赖 `!app.isPackaged`，无额外环境变量分支
- 自动化测试与命令输出能独立证明“dev open / prod fail-closed”
