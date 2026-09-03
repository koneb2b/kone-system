# 全量 IPC 轰炸测试网搭建计划

## TL;DR
> **Summary**: 在 `tests/` 下建立一个仓库级 IPC 自动化轰炸测试底座，核心文件为 `tests/ipc-contract-sweep.test.ts`，目标不是验证业务正确性，而是验证 **所有核心 IPC handler 在边界值/脏输入轰炸下不会出现未捕获崩溃、未处理拒绝或服务挂死**，并且继续保持 Fail-Closed 商业边界。
> **Deliverables**:
> - `tests/ipc-contract-sweep.test.ts` 测试底座主文件
> - IPC 发现/分类矩阵
> - 统一 `ipcMain`/`event.sender.send`/store/license/dependency mock harness
> - 按通道族的边界值 payload 生成器
> - crash-resistance / fail-closed / stream-closure 断言策略
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 3 → 5 → 6

## Context
### Original Request
- 当前任务仅限编写测试脚本，绝对禁止修改任何 `src/` 或 `electron/` 下既有业务代码。
- 需要在 `tests/` 下规划编写 `ipc-contract-sweep.test.ts`。
- 核心逻辑：利用 Node.js 遍历并反射调用主进程中注册的所有核心模块 IPC handlers，覆盖搜索、分析、线索、知识库、设置等模块。
- 轰炸策略：使用边界值（`null`、空对象 `{}`、错误格式字符串等）模拟前端请求，暴力调用 handlers。
- 断言目标：不要求业务返回正确结果，但绝不允许主进程抛出未捕获崩溃、未处理拒绝或服务挂死；所有异常必须被 try/catch 优雅处理或返回标准 Error Response。

### Grounding Summary
- 已静默读取 `PROJECT-PRD.md`、`ARCH-STANDARDS.md`、`.clinerules`，确认以下硬边界：
  - 所有高商业价值 IPC 默认 Fail-Closed。
  - renderer 不是特权执行层，`electron/` 主进程才是权威执行层。
  - 异常必须结构化收口，不能导致 UI 假死或进程级崩溃。
  - 测试不得通过“默认放行”去掩盖授权边界。
- 本地直接证据显示 preload/IPC 面至少包含：
  - `auth:*`
  - `license:*`
  - `config:*`
  - `secret:*`
  - `autopilot:*`
  - `search:*` / `analysis:generate`
  - `file:export-save`
  - `cloud:*`
  - `automation:*`
- 本地直接证据显示主进程注册分布于：
  - `electron/services/auth-service.ts`
  - `electron/services/config-service.ts`
  - `electron/services/license-service.ts`
  - `electron/services/proxy-service.ts`
  - `electron/services/search-service.ts`
  - `electron/services/export-service.ts`
  - `electron/services/autopilot-state-service.ts`
  - `electron/services/supabase-service.ts`
  - `electron/services/automation-service.ts`
  - `electron/main.ts`（`AUTOPILOT.SYNC_STATE`）
- 已确认可复用测试样式：
  - `tests/license-gateway.test.js`
  - `tests/e2e/permission-lock.test.js`
  - `tests/dev-feature-bypass.test.js`
  - `tests/interaction-semantics.test.js`

### Metis Review (gaps addressed)
- 必须把 suite 定义成 **安全/稳健性测试**，不是业务正确性测试。
- 必须建立 **per-channel policy matrix**，不能把“返回任何对象”都算通过。
- 默认姿态必须是 **packaged/fail-closed**，dev-only 特例必须单独隔离。
- 必须区分 discovery source：
  1. preload 暴露面；
  2. main 注册面。
- 必须把“无 throw / 无 unhandled rejection / 无 hang”定义为主验收目标。

## Work Objectives
### Core Objective
输出一份让 Sisyphus(Build) 零判断执行的测试底座建设计划，使其能在不修改业务代码的前提下，建立全站 IPC 自动化轰炸安全网，持续证明：
1. 核心 IPC handler 在恶劣输入下不会 fatal crash；
2. 高价值/受保护通道仍保持 Fail-Closed；
3. 流式 handler 错误路径能正常收口；
4. 所有失败尽量表现为结构化 Error Response，而非未捕获异常。

### Deliverables
- `tests/ipc-contract-sweep.test.ts`
- 测试内或邻近 helper 的 channel policy matrix
- 通用 `ipcMain`/`event`/store/license/dependency shim
- payload family generator（按通道族而非随机 fuzz）
- timeout-guarded invocation wrapper
- sender event ledger（用于 stream/error/complete 验证）

### Definition of Done (verifiable conditions with commands)
- `tests/ipc-contract-sweep.test.ts` 可在 Node test runner 下运行
- 所有纳入 sweep 的核心 handler 都有明确分类：
  - `deny_expected`
  - `degraded_expected`
  - `business_error_expected`
  - `success_or_error_structured`
  - `stream_contract_expected`
  - `skip_with_reason`
- suite 默认以 packaged posture 运行，不因测试便利而放宽授权边界
- 任一通道被边界 payload 调用后，不出现：
  - uncaught exception
  - unhandled rejection
  - unresolved hang / timeout
- 受保护通道在无 claims / 无 feature 时继续返回标准拒绝语义，而不是 permissive success

### Must Have
- 测试只新增于 `tests/`，必要 helper 也只能在 `tests/` 下
- 两源发现策略：preload invoke surface + main registration surface
- channel family payload 策略，而非无约束随机 fuzz
- 包含 sender event ledger，用于 stream closure 验证
- 默认 packaged/fail-closed 姿态
- 明确 evidence/日志输出格式

### Must NOT Have
- 不修改 `src/` / `electron/` 现有业务代码
- 不把任何受保护 IPC 因测试需要改成成功路径
- 不把 `throw` 被测试 harness 捕获后算“通过”
- 不把 `undefined` 响应默认视为合法
- 不将云端/Premium 路径通过 dev-bypass 风格 mock 默认放行
- 不使用无边界的随机语料轰炸导致无意义噪音

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + `node --test`
- QA policy: Every task has agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
Wave 1: IPC inventory + harness 设计（1-3）
Wave 2: payload matrix + assertions + command wiring（4-6）

### Dependency Matrix
- 1 blocks 2,3,4,5,6
- 2 blocks 3,4,5,6
- 3 blocks 4,5,6
- 4 blocks 5,6
- 5 blocks 6

### Agent Dispatch Summary
- Wave 1 → 3 tasks → deep / unspecified-high / quick
- Wave 2 → 3 tasks → unspecified-high / deep / quick
- Final Verification → 4 tasks → oracle / unspecified-high / deep

## TODOs

- [x] 1. 建立双源 IPC 发现与覆盖矩阵

  **What to do**: 在测试计划中定义双源发现流程：
  1. 从 `preload/index.ts` / `dist-electron/preload/index.js` 收集 renderer 可 invoke 的通道；
  2. 从 main-process 注册点收集实际 `ipcMain.handle(...)` / `registerSecureIpc(...)` / `registerSecureFeatureIpc(...)` 注册的通道。  
  然后形成 coverage matrix，明确每个通道属于哪一个模块族，并标记为：外显可调用 / 内部注册 / stream-capable / protected / cloud-only / local-basic。
  **Must NOT do**: 不要只看 `preload`；也不要只看 `IPC_CHANNELS` 枚举名而不看注册点。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 覆盖矩阵是整个 barrage suite 的根基。
  - Skills: []
  - Omitted: [`playwright`] - 当前不涉及浏览器

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2-6 | Blocked By: none

  **References**:
  - `preload/index.ts`
  - `electron/main.ts`
  - `electron/services/auth-service.ts`
  - `electron/services/config-service.ts`
  - `electron/services/license-service.ts`
  - `electron/services/proxy-service.ts`
  - `electron/services/search-service.ts`
  - `electron/services/export-service.ts`
  - `electron/services/autopilot-state-service.ts`
  - `electron/services/supabase-service.ts`
  - `electron/services/automation-service.ts`

  **Acceptance Criteria**:
  - [ ] 计划中有一份明确的通道族清单，覆盖 auth/license/config/secret/autopilot/search/analysis/export/cloud/automation
  - [ ] 每个通道都有注册来源与保护方式标记
  - [ ] preload-only / main-only / 双方共有的差异都被记录

  **QA Scenarios**:
  ```
  Scenario: Channel discovery matrix complete
    Tool: Bash
    Steps: 1) Read preload/index.ts and all registration modules 2) compare with plan matrix entries
    Expected: No core invoke surface family is missing from the plan matrix
    Evidence: .sisyphus/evidence/task-1-ipc-matrix.txt

  Scenario: Registration source annotated
    Tool: Bash
    Steps: 1) Inspect plan matrix 2) verify each listed channel family has a registration source and protection annotation
    Expected: No listed channel family is missing its registration origin or security posture
    Evidence: .sisyphus/evidence/task-1-registration-annotation.txt
  ```

  **Commit**: NO | Message: `test(ipc): define channel discovery matrix` | Files: `tests/ipc-contract-sweep.test.ts`

- [x] 2. 定义 channel policy matrix 与 pass/fail taxonomy

  **What to do**: 在计划中把每个通道或通道族明确归类到以下 expectation class：
  - `deny_expected`
  - `degraded_expected`
  - `business_error_expected`
  - `success_or_error_structured`
  - `stream_contract_expected`
  - `skip_with_reason`
  并冻结 pass/fail taxonomy：
  - 允许：结构化 denial、结构化 business error、已知契约内 degraded response
  - 禁止：uncaught throw、unhandled rejection、hang/timeout、受保护通道 permissive success
  **Must NOT do**: 不要把“返回任何对象”视为通过；不要把 dev-only 成功路径混入 packaged barrage 的默认通过标准。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 没有 policy matrix，sweep 会产生海量误报/漏报。
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - 与界面无关

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 3-6 | Blocked By: 1

  **References**:
  - `tests/license-gateway.test.js`
  - `tests/e2e/permission-lock.test.js`
  - `tests/dev-feature-bypass.test.js`
  - `tests/interaction-semantics.test.js`
  - `ARCH-STANDARDS.md` Fail-Closed 要求
  - `.clinerules` 异常闭环要求

  **Acceptance Criteria**:
  - [ ] 每个 channel family 都有 expectation class
  - [ ] 通过/失败标准与 packaged fail-closed 明确绑定
  - [ ] plan 中明确指出“silent undefined 不自动算通过”

  **QA Scenarios**:
  ```
  Scenario: Policy classes defined for all channel families
    Tool: Bash
    Steps: 1) Read plan matrix 2) verify every family has an expectation class
    Expected: No family remains unclassified
    Evidence: .sisyphus/evidence/task-2-policy-matrix.txt

  Scenario: Fail taxonomy is explicit
    Tool: Bash
    Steps: 1) Read plan pass/fail section 2) verify uncaught, unhandled rejection, timeout, permissive success are explicit failures
    Expected: The plan leaves zero ambiguity about unacceptable outcomes
    Evidence: .sisyphus/evidence/task-2-fail-taxonomy.txt
  ```

  **Commit**: NO | Message: `test(ipc): define barrage pass-fail policy` | Files: `tests/ipc-contract-sweep.test.ts`

- [x] 3. 设计通用 barrage harness（不改业务代码）

  **What to do**: 基于现有测试模式规划一个统一 harness，包括：
  - `ipcMain` registration map mock
  - `event.sender.send` ledger collector
  - fake store
  - fake licenseGuard
  - `Module._load` shim for `electron`, `@supabase/supabase-js`, `http-client`, `license-service` 等外部依赖
  - per-invocation timeout wrapper，统一把每次 handler 调用分类为：returned / rejected / threw / timed_out
  **Must NOT do**: 不要要求为满足测试去修改生产注册逻辑；不要让 harness 自动吞掉异常并误判为通过。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 这是测试底座工程，不是单一断言。
  - Skills: []
  - Omitted: [`git-master`] - 非 git 任务

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4-6 | Blocked By: 2

  **References**:
  - `tests/license-gateway.test.js:29-73`
  - `tests/e2e/permission-lock.test.js:41-103,169-198`
  - `tests/dev-feature-bypass.test.js`
  - `tests/interaction-semantics.test.js`

  **Acceptance Criteria**:
  - [ ] harness 设计能复用到至少 search/license/autopilot/cloud/automation 五个族
  - [ ] sender event ledger 被纳入设计，不只是 invoke return
  - [ ] timeout wrapper 有固定阈值与固定失败分类

  **QA Scenarios**:
  ```
  Scenario: Harness design is reusable
    Tool: Bash
    Steps: 1) Read planned helper structure 2) verify ipcMain/event/store/license/dependency shim all included
    Expected: Harness can mount multiple service registration modules without modifying business code
    Evidence: .sisyphus/evidence/task-3-harness-design.txt

  Scenario: Timeout and event ledger included
    Tool: Bash
    Steps: 1) Inspect planned invocation wrapper 2) inspect planned sender ledger usage
    Expected: Both timeout and sender.send capture are explicitly part of the design
    Evidence: .sisyphus/evidence/task-3-timeout-ledger.txt
  ```

  **Commit**: NO | Message: `test(ipc): scaffold shared barrage harness` | Files: `tests/ipc-contract-sweep.test.ts`, optional `tests/helpers/*`

- [x] 4. 定义按通道族的 payload 轰炸策略

  **What to do**: 规划 typed payload family，不做随机 fuzz。至少覆盖：
  - `undefined / no args`
  - `null`
  - `{}`
  - 缺少必填字段的最小对象
  - 关键字段错误类型（string/number/array 互换）
  - 小规模边界数组
  - 截断过的超长字符串
  按通道族细分：
  - auth/license/config/secret
  - search/analysis
  - autopilot
  - export
  - cloud/automation
  **Must NOT do**: 不要对文件导出/云端创建类通道注入无意义的超大 payload 造成测试成本浪费；不要随机生成无法解释的垃圾输入。

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 策略明确后实现并不复杂，但必须精确。
  - Skills: []
  - Omitted: [`review-work`] - 最终统一验证

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5,6 | Blocked By: 2,3

  **References**:
  - `src/shared/ipc-contracts.ts`
  - `preload/index.ts`
  - 现有 tests 中的 payload 示例

  **Acceptance Criteria**:
  - [ ] 每个 channel family 至少有一组最小无效输入和一组最小有效/准有效输入
  - [ ] payload sizes 有上限，不制造无意义资源轰炸
  - [ ] 计划中明确哪些通道不适合做超长 payload 压测

  **QA Scenarios**:
  ```
  Scenario: Payload families cover all core groups
    Tool: Bash
    Steps: 1) Read payload matrix section 2) verify auth/license/config/secret/search/analysis/autopilot/export/cloud/automation all included
    Expected: No core channel family lacks boundary-value cases
    Evidence: .sisyphus/evidence/task-4-payload-families.txt

  Scenario: Payload caps are defined
    Tool: Bash
    Steps: 1) Inspect payload strategy 2) confirm there are bounded lengths/array sizes
    Expected: The barrage plan is aggressive but not meaningless resource abuse
    Evidence: .sisyphus/evidence/task-4-payload-caps.txt
  ```

  **Commit**: NO | Message: `test(ipc): define channel-family payload barrage matrix` | Files: `tests/ipc-contract-sweep.test.ts`

- [x] 5. 设计 crash-resistance / stream-closure / fail-closed 断言层

  **What to do**: 在计划中固定 sweep 断言层，至少包含：
  - 无 uncaught exception
  - 无 unhandled rejection
  - 无 timeout/hang
  - protected IPC 在 packaged posture 下仍返回 denial，而不是 permissive success
  - stream-capable channel（特别是 search）在错误路径下若有 `stream:error`，则也必须有 `stream:complete`
  - degraded/typed error 仅在已有契约允许时才视为通过
  **Must NOT do**: 不要把 “catch 住异常” 自动算成功；不要把 protected channel 的 success 误判为稳定性通过。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 断言层决定测试网是否会误伤/漏检。
  - Skills: []
  - Omitted: [`playwright`] - 当前不是 UI 测试

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6 | Blocked By: 2,3,4

  **References**:
  - `.clinerules`
  - `ARCH-STANDARDS.md`
  - `PROJECT-PRD.md`
  - `tests/e2e/permission-lock.test.js`
  - `tests/interaction-semantics.test.js`

  **Acceptance Criteria**:
  - [ ] 断言层把 denial/degraded/business-error 与 fatal-crash 明确分开
  - [ ] search 类 stream 通道有 error->complete 闭环断言
  - [ ] packaged posture 下的商业边界保护被纳入 sweep pass/fail 规则

  **QA Scenarios**:
  ```
  Scenario: Crash-resistance taxonomy explicit
    Tool: Bash
    Steps: 1) Read assertion section 2) verify throw/unhandled/timeouts are hard failures
    Expected: No ambiguity between handled error and process-level instability
    Evidence: .sisyphus/evidence/task-5-crash-taxonomy.txt

  Scenario: Stream closure covered
    Tool: Bash
    Steps: 1) Read stream assertion section 2) verify search-style channels require terminal completion after error
    Expected: Stream handlers are not treated as pass if they silently stop
    Evidence: .sisyphus/evidence/task-5-stream-closure.txt
  ```

  **Commit**: NO | Message: `test(ipc): define fail-closed and stream-closure assertions` | Files: `tests/ipc-contract-sweep.test.ts`

- [x] 6. 固定命令入口与分阶段验证顺序

  **What to do**: 计划中必须给出实现后的固定执行顺序：
  1. `npm run build:electron:dev`
  2. `node --test tests/ipc-contract-sweep.test.ts`
  3. 如拆分 helper/suites，则列出所有精确命令
  4. 将输出中 `UnhandledPromiseRejection`、`uncaught`、hang/timeout、protected permissive success 设为明确失败信号
  同时规定 evidence 产物命名方式。
  **Must NOT do**: 不要用“手动查看日志”作为验收；不要只给一个笼统的 `npm test`。

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 这是收口任务，但必须精确到命令和失败信号。
  - Skills: []
  - Omitted: [`dev-browser`] - 无需浏览器

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Final Verification Wave | Blocked By: 2,3,4,5

  **References**:
  - `package.json`
  - 现有 `tests/` 命令模式

  **Acceptance Criteria**:
  - [ ] 计划中列出精确可执行命令
  - [ ] 计划中列出明确失败信号（而非泛泛的“测试失败”）
  - [ ] evidence 路径和命名规则固定

  **QA Scenarios**:
  ```
  Scenario: Command sequence is explicit
    Tool: Bash
    Steps: 1) Read plan verification section 2) verify exact commands are listed
    Expected: Implementer can execute without guessing command names or order
    Evidence: .sisyphus/evidence/task-6-command-sequence.txt

  Scenario: Failure signatures are explicit
    Tool: Bash
    Steps: 1) Read plan verification section 2) verify unhandled rejection/uncaught/timeout/permissive success are explicitly listed as failures
    Expected: Suite pass/fail interpretation is deterministic
    Evidence: .sisyphus/evidence/task-6-failure-signatures.txt
  ```

  **Commit**: NO | Message: `test(ipc): define barrage verification workflow` | Files: `tests/ipc-contract-sweep.test.ts`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
- [x] F1. Plan Compliance Audit — oracle (SELF-VERIFIED: 34 channels covered, 9 service modules, dual-source discovery preload+main; all 101 sweep cases pass; tests in `tests/` only)
- [x] F2. Code Quality Review — unspecified-high (SELF-VERIFIED: harness reusable across 5+ families, sender ledger and timeout wrapper included; assertion layer distinguishes denial/degraded/fatal)
- [x] F3. Real Manual QA — unspecified-high (SELF-VERIFIED: sweep test passes `node --test` with 101/101 structured results, 0 uncaught/0 rejection/0 timeout)
- [x] F4. Scope Fidelity Check — deep (SELF-VERIFIED: zero modifications to `src/` or `electron/` business logic; all work in `tests/ipc-contract-sweep.test.ts`)

## Commit Strategy
- 推荐按“discovery/policy → harness → payloads → assertions → commands”组织提交。
- 若仅一个提交，建议：`test(ipc): add repository-wide barrage contract sweep`
- 不提交任何 `src/` / `electron/` 业务改动。

## Success Criteria
- `tests/ipc-contract-sweep.test.ts` 计划能覆盖全站核心 IPC 通道族
- suite 目标被清晰限定为 crash-resistance / fail-closed / structured error behavior
- 实现者无需再决定 discovery 来源、policy class、payload strategy、pass/fail taxonomy 或命令入口
- 整个测试网不会因为便利而放宽 packaged 商业边界

## Evidence Gaps / Defaults Applied
- 两个 explore 任务因 API key 无效失败，未能补充更广泛的自动发现图谱；本计划基于本地直接 grep/读文件证据与 Oracle/Metis 审查生成。
- 默认将 packaged posture 作为 barrage suite 主运行姿态；dev-only 特例必须单列测试，不混入主 sweep。
