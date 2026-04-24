# IPC 边界抗崩溃修复清单与执行计划

## TL;DR
> **Summary**: 本计划针对 IPC 轰炸测试暴露出的 29 项边界稳健性缺陷，给出一份严格受限的抗崩溃修复方案。修复目标不是改变业务结果，而是保证所有 IPC 在 malformed payload / 配置缺失 / 非法输入下都通过 **handler 外壳层** 优雅收口为 structured error，绝不抛出未捕获异常、未处理拒绝或导致主进程服务挂死。
> **Deliverables**:
> - wrapper 层统一错误桥接策略
> - P0/P1/P2 分级修复清单
> - 仅限 `ipcMain.handle` / `registerSecureIpc` / `registerSecureFeatureIpc` 外壳层的最小补丁方案
> - 使用 `tests/ipc-contract-sweep.test.ts` 的回归验证方案
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 3 → 5 → 6

## Context
### Original Request
- 用户要求输出《IPC 边界抗崩溃修复清单与执行计划》。
- 红线限制：
  - **最小化修改（MVM）**
  - **绝对禁止修改任何底层业务 Service 逻辑**
  - 所有修复**只能发生在 `ipcMain.handle` 外壳层**
  - 对暴露出的脆弱通道统一增加入参校验和 try/catch 兜底
  - 所有错误必须转化为 `{ success: false, error: '...' }` 风格的 structured error
  - 计划必须按 P0 / P1 / P2 分级

### Grounding Summary
- 已静默读取 `PROJECT-PRD.md`、`ARCH-STANDARDS.md`、`.clinerules`。
- 关键硬边界已确认：
  - 高价值 IPC 必须保持 Fail-Closed
  - renderer 不能承担特权业务逻辑
  - 异常必须结构化收口
  - 不允许测试或修复为方便而放宽授权边界
- 已有轰炸测试 `tests/ipc-contract-sweep.test.ts` 首轮运行结果：
  - 总样本：101
  - structuredSuccess：35
  - structuredError：36
  - skipped：1
  - 硬失败/非结构化：29
- Oracle 结论：这些失败**大多数是合法的 IPC 边界稳健性缺陷**，不是测试误报；其中部分是“预期业务拒绝/配置缺失”但错误收口方式不合格。

### Key Existing Patterns
- `electron/services/license-service.ts:459-496`
  - `registerSecureIpc` / `registerSecureFeatureIpc` 是跨模块共享 wrapper seam
  - 当前只负责 trial/feature denial，不负责 downstream handler 的通用异常桥接
- `electron/services/config-service.ts:261-307`
  - `CONFIG.SET` / `SECRET.SET` 属于直接 payload 读取脆弱点
- `electron/services/supabase-service.ts`
  - 多个 `CLOUD.*` handler 直接读取 `payload.domain` / `payload.lead` / `payload.domains`
- `electron/services/automation-service.ts:275-319`
  - `AUTOMATION.VERIFY_EMAILS` / `START_CAMPAIGN` 是另一组直接 payload 边界

### Metis Review (gaps addressed)
- 必须明确区分三类结果：
  1. malformed transport shape → structured validation error
  2. valid request but denied by trial/feature/business rule → 保持原语义
  3. unexpected throw/rejection → structured generic shell error
- shell-only patching足够处理：
  - `undefined / null / {}`
  - 缺少 required top-level key
  - 顶层关键字段类型错误
  - downstream throw/rejection 的统一收口
- shell-only patching**不**负责：
  - 业务规则修复
  - 云端逻辑修复
  - 搜索/评分/分析业务语义修复

## Work Objectives
### Core Objective
在不触碰底层业务 Service 逻辑的前提下，把所有已暴露的 IPC 边界异常收口问题修成：
- invalid/malformed input → structured error
- expected denial → 保持当前 structured denial
- unexpected throw/rejection → structured shell error
- 任意情况下都不允许未捕获崩溃、未处理拒绝或 handler 级挂死

### Deliverables
- `registerSecureIpc` / `registerSecureFeatureIpc` 的统一 shell hardening 方案
- direct `ipcMain.handle` 通道的顶层 payload guard 方案
- P0/P1/P2 分级修复矩阵
- 使用 `tests/ipc-contract-sweep.test.ts` 的验证方案与回归门禁

### Definition of Done (verifiable conditions with commands)
- 所有纳入 P0/P1 清单的脆弱通道在 malformed payload 下不再 reject
- 所有相关通道都返回结构化对象，而不是裸 `throw` / rejected promise
- packaged/fail-closed 商业边界不被放宽
- `node --test tests/ipc-contract-sweep.test.ts` 不再报告：
  - `emitted uncaught exception`
  - `emitted unhandled rejection`
  - `rejected instead of returning structured response`
  - `hung on payload`
  - `produced non-structured outcome`

### Must Have
- 仅修改 IPC shell/wrapper 层
- 保持现有业务服务调用顺序不变
- 对 malformed payload 增加最小必需校验
- 对 unexpected throw/rejection 增加统一 try/catch 兜底
- 对 valid payload 的 trial/feature/business-denial 语义保持原样

### Must NOT Have
- 不得修改任何底层业务 Service 逻辑
- 不得改搜索、评分、分析、云端、授权、Gold Filter 语义
- 不得添加校验框架依赖（如 zod/yup）
- 不得把 valid denial 改成 generic 400
- 不得把受保护通道默认放行为成功
- 不得修改 preload / shared contract / renderer 业务逻辑作为本计划实施手段

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + `node --test`
- QA policy: Every task has agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
Wave 1: Shared wrapper hardening + P0 direct channels（1-3）
Wave 2: P1 direct channels + regression verification（4-6）

### Dependency Matrix
- 1 blocks 2,3,4,5,6
- 2 blocks 3,4,5,6
- 3 blocks 5,6
- 4 blocks 5,6
- 5 blocks 6

### Agent Dispatch Summary
- Wave 1 → 3 tasks → deep / quick / unspecified-high
- Wave 2 → 3 tasks → quick / deep / unspecified-high
- Final Verification → 4 tasks → oracle / unspecified-high / deep

## Priority Matrix

### P0 — 高危易崩溃，必须先修
这些通道在 malformed payload 下已明确表现为同步/异步 reject，而不是 structured error：
- `CONFIG.SET`
- `SECRET.SET`
- `FILES.EXPORT_SAVE`
- `CLOUD.CHECK_COLLISION`
- `CLOUD.SYNC_LEAD`
- `CLOUD.UPSERT_LEAD`
- `CLOUD.CHECK_DOMAINS`
- `AUTOMATION.VERIFY_EMAILS`

### P1 — 逻辑中断 / 收口不优雅，下一波修
这些通道多数是“预期业务拒绝/配置缺失”但错误桥接方式仍需硬化：
- `CLOUD.CREATE_CAMPAIGN`
- `CLOUD.FETCH_TEAM_LEADS`
- `CLOUD.FETCH_TRACKING`
- `CLOUD.SUBSCRIBE_REALTIME`
- `CLOUD.FETCH_CLAIMED_DOMAINS`
- `CONFIG.GET`
- `SECRET.CHECK`
- `CONFIG.FETCH_MODELS`
- `SEARCH.API_PROXY`
- `SEARCH.API_TEST_CONNECTION`

### P2 — 噪音 / 仅验证，无需优先动
这些通道当前未显示明显 shell crash，原则上只做验证，不主动修改：
- `AUTH.LOGOUT`
- `AUTH.GET_SESSION`
- `LICENSE.*`
- `AUTOPILOT.GET_STATE`
- `AUTOPILOT.SET_STATE`
- `AUTOPILOT.CLEAR_LEGACY`
- `AUTOPILOT.SYNC_STATE`
- `SEARCH.EXECUTE`
- `SEARCH.ANALYSIS_GENERATE`
- `AUTOMATION.START_CAMPAIGN`
- `CLOUD.UNSUBSCRIBE_REALTIME`

## TODOs

- [ ] 1. 统一加固 shared IPC wrappers（P0 foundation）

  **What to do**: 只在 `electron/services/license-service.ts` 的 `registerSecureIpc` 与 `registerSecureFeatureIpc` 外壳层增加通用异常桥接：
  - 保留当前 trial/feature gating 顺序
  - 对 handler 调用增加统一 try/catch
  - 任何 unexpected throw/rejection 一律转成 `{ success: false, error: '...', code?: 500 }`
  - 对现有 `FEATURE_DENIED` / `TRIAL_EXPIRED` / `SYSTEM_TIME_ABNORMAL` 等结构化拒绝保持原语义
  **Must NOT do**: 不要修改底层 service；不要把 valid business denial 改成 generic error；不要改变 handler 的业务调用顺序。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 这是跨模块的 primary seam。
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - 不涉及前端

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2-6 | Blocked By: none

  **References**:
  - `electron/services/license-service.ts:459-496`
  - `tests/license-gateway.test.js`
  - `tests/ipc-contract-sweep.test.ts`

  **Acceptance Criteria**:
  - [ ] 包装器中的 downstream throw/rejection 不再直接逃逸
  - [ ] feature/trial denial 仍维持现有 structured shape
  - [ ] 未新增业务语义变更

  **QA Scenarios**:
  ```
  Scenario: Shared wrapper bridges unexpected handler throw
    Tool: Bash
    Steps: 1) Build Electron 2) run node --test tests/ipc-contract-sweep.test.ts
    Expected: No failure message containing 'rejected instead of returning structured response' for channels routed through secure wrappers when payload malformed
    Evidence: .sisyphus/evidence/task-1-wrapper-hardening.txt

  Scenario: Fail-Closed semantics preserved
    Tool: Bash
    Steps: 1) Re-run existing auth/license permission tests 2) inspect outputs
    Expected: FEATURE_DENIED / TRIAL_EXPIRED paths remain structured and unchanged in meaning
    Evidence: .sisyphus/evidence/task-1-fail-closed-preserved.txt
  ```

  **Commit**: NO | Message: `fix(ipc): harden shared secure wrappers against raw handler throws` | Files: `electron/services/license-service.ts`

- [ ] 2. 修补 P0 direct handle 通道的 top-level payload guards

  **What to do**: 只在这些注册入口的最外层增加 minimal guards，不进入 service internals：
  - `CONFIG.SET`
  - `SECRET.SET`
  - `FILES.EXPORT_SAVE`
  - `CLOUD.CHECK_COLLISION`
  - `CLOUD.SYNC_LEAD`
  - `CLOUD.UPSERT_LEAD`
  - `CLOUD.CHECK_DOMAINS`
  - `AUTOMATION.VERIFY_EMAILS`
  每个通道只做：
  - payload object-like 校验
  - required top-level key 存在性/基础类型校验
  - malformed 立即 `{ success:false, error:'...', code:400 }`
  **Must NOT do**: 不要对嵌套业务字段做重度验证；不要 reshape lead payload；不要碰 service body。

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 通道多，但补丁模式高度一致。
  - Skills: []
  - Omitted: [`review-work`] - 统一在最终验证做

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5,6 | Blocked By: 1

  **References**:
  - `electron/services/config-service.ts:261-307`
  - `electron/services/export-service.ts`
  - `electron/services/supabase-service.ts`
  - `electron/services/automation-service.ts:275-319`
  - 首轮 sweep 结果中的 8 个 P0 通道

  **Acceptance Criteria**:
  - [ ] P0 通道在 `undefined/null/{}` 输入下不再 reject
  - [ ] malformed payload 返回 structured 400 风格错误
  - [ ] valid payload 时仍进入原有业务路径

  **QA Scenarios**:
  ```
  Scenario: P0 malformed payloads return structured errors
    Tool: Bash
    Steps: 1) Run node --test tests/ipc-contract-sweep.test.ts 2) inspect P0 channel outcomes
    Expected: P0 channels no longer appear under raw rejection failures
    Evidence: .sisyphus/evidence/task-2-p0-structured-errors.txt

  Scenario: Valid payload forwarding preserved
    Tool: Bash
    Steps: 1) Run existing focused tests touching config/cloud/automation handlers 2) compare with prior pass expectations
    Expected: Validly shaped requests still reach existing denial/business logic instead of being blocked at shell
    Evidence: .sisyphus/evidence/task-2-valid-forwarding.txt
  ```

  **Commit**: NO | Message: `fix(ipc): add top-level payload guards to P0 handlers` | Files: `electron/services/config-service.ts`, `electron/services/export-service.ts`, `electron/services/supabase-service.ts`, `electron/services/automation-service.ts`

- [ ] 3. 统一 unexpected shell errors 的结构化文案规范

  **What to do**: 在所有 shell-layer 补丁中统一 unexpected error bridge 规范：
  - malformed payload → `code: 400`
  - unknown shell failure → `code: 500` 或现有 channel 兼容 code
  - `error` 必须是简洁字符串，不返回 raw Error / stack / object
  - 尽量沿用当前中文风格，避免英文 stack trace 泄漏给前端
  **Must NOT do**: 不要把 business denial 文案改成通用 400；不要把原始 `error.stack` 拼进响应。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 要确保多个通道行为一致，但不能过度抽象。
  - Skills: []
  - Omitted: [`playwright`] - 无需 UI

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5,6 | Blocked By: 1,2

  **References**:
  - `electron/services/config-service.ts`
  - `electron/services/autopilot-state-service.ts`
  - `electron/services/automation-service.ts`
  - Oracle 结论：拒绝原因可以合理，但必须以 structured response surfaced

  **Acceptance Criteria**:
  - [ ] shell 层不再把 raw error stack 直接暴露到 renderer
  - [ ] malformed transport shape 与 business denial 可被区分
  - [ ] 响应对象保持可序列化

  **QA Scenarios**:
  ```
  Scenario: No raw stack trace leaks through shell bridge
    Tool: Bash
    Steps: 1) Run node --test tests/ipc-contract-sweep.test.ts 2) inspect failure messages
    Expected: Failure text is sanitized string, not raw stack dump object
    Evidence: .sisyphus/evidence/task-3-sanitized-errors.txt

  Scenario: 400 vs business denial remain distinguishable
    Tool: Bash
    Steps: 1) Compare malformed payload cases with valid-but-denied cases in sweep output
    Expected: Malformed cases surface as input validation style errors, valid denied cases keep their domain-specific semantics
    Evidence: .sisyphus/evidence/task-3-error-taxonomy.txt
  ```

  **Commit**: NO | Message: `fix(ipc): standardize shell-layer structured error responses` | Files: touched handler registration files only

- [ ] 4. 修补 P1 “预期拒绝但收口不优雅”的 cloud/config 通道

  **What to do**: 对 P1 通道进行同样的 top-level shell hardening，但优先目标不是改业务结果，而是把“缺云端凭证 / 缺配置 / 非法 payload”统一为 structured failure：
  - `CLOUD.CREATE_CAMPAIGN`
  - `CLOUD.FETCH_TEAM_LEADS`
  - `CLOUD.FETCH_TRACKING`
  - `CLOUD.SUBSCRIBE_REALTIME`
  - `CLOUD.FETCH_CLAIMED_DOMAINS`
  - `CONFIG.GET`
  - `SECRET.CHECK`
  - `CONFIG.FETCH_MODELS`
  - `SEARCH.API_PROXY`
  - `SEARCH.API_TEST_CONNECTION`
  **Must NOT do**: 不要把“未配置云端引擎凭证”改成 success；不要改变 Premium/Cloud 的 Fail-Closed。

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 修补模式与 P0 类似，但风险略低。
  - Skills: []
  - Omitted: [`git-master`] - 无需 git 技巧

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5,6 | Blocked By: 1,3

  **References**:
  - `electron/services/config-service.ts`
  - `electron/services/proxy-service.ts`
  - `electron/services/supabase-service.ts`
  - 首轮 sweep P1 列表

  **Acceptance Criteria**:
  - [ ] P1 通道在环境缺失或 malformed payload 下不再 reject
  - [ ] 云端未配置类问题改为 structured failure surfaced
  - [ ] 不改变 Premium/cloud 权限语义

  **QA Scenarios**:
  ```
  Scenario: P1 cloud/config channels return structured denials
    Tool: Bash
    Steps: 1) Run node --test tests/ipc-contract-sweep.test.ts 2) inspect P1 outcomes
    Expected: P1 channels no longer fail via raw rejections; they return structured failure objects
    Evidence: .sisyphus/evidence/task-4-p1-structured-denials.txt

  Scenario: Cloud credentials absence remains denied, not allowed
    Tool: Bash
    Steps: 1) Re-run sweep under no-cloud-credential fixture 2) inspect CLOUD.* channels
    Expected: Missing credentials still block operation but do so structurally
    Evidence: .sisyphus/evidence/task-4-cloud-denial-preserved.txt
  ```

  **Commit**: NO | Message: `fix(ipc): harden P1 shell denials for cloud and config channels` | Files: relevant IPC registration files only

- [ ] 5. 用 sweep 回归验证 P0/P1 修复效果

  **What to do**: 不新增新的验收口径，以 `tests/ipc-contract-sweep.test.ts` 为主回归门禁，验证：
  - 原 29 项中的 raw rejection 数显著下降
  - P0 通道全部脱离 raw rejection 列表
  - P1 通道转为结构化失败
  - 受保护通道不出现 permissive success
  **Must NOT do**: 不要重写 sweep 规则来“掩盖”失败；修复必须让原测试自然转绿。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 这是本计划是否达标的主证明。
  - Skills: []
  - Omitted: [`dev-browser`] - 无需浏览器

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6 | Blocked By: 2,3,4

  **References**:
  - `tests/ipc-contract-sweep.test.ts`
  - 首轮 sweep 结果汇总

  **Acceptance Criteria**:
  - [ ] `node --test tests/ipc-contract-sweep.test.ts` 通过
  - [ ] 输出不再包含 raw rejection 关键失败信号
  - [ ] 受保护通道没有因为 shell hardening 而被放行

  **QA Scenarios**:
  ```
  Scenario: Sweep no longer reports shell-layer hard failures
    Tool: Bash
    Steps: 1) Run node --test tests/ipc-contract-sweep.test.ts
    Expected: No assertion lines containing 'rejected instead of returning structured response', 'emitted uncaught exception', 'emitted unhandled rejection', or 'hung on payload'
    Evidence: .sisyphus/evidence/task-5-sweep-green.txt

  Scenario: Protected channels remain fail-closed
    Tool: Bash
    Steps: 1) Inspect sweep output for protected channel families 2) confirm no permissive success is introduced
    Expected: Denial semantics preserved under packaged posture
    Evidence: .sisyphus/evidence/task-5-fail-closed-posture.txt
  ```

  **Commit**: NO | Message: `test(ipc): validate shell hardening against barrage sweep` | Files: tests/evidence only

- [ ] 6. 运行补充回归并交付修复战果报告

  **What to do**: 在完成 shell hardening 后，按固定顺序执行：
  1. `npm run build:electron:dev`
  2. `node --test tests/ipc-contract-sweep.test.ts`
  3. 必要时补跑已存在的相关 regression tests（如 `tests/license-gateway.test.js`, `tests/e2e/permission-lock.test.js`）
  4. 汇总：
     - 哪些通道由 hard failure 变成 structured failure
     - 哪些通道本来就健康
     - 是否还剩 residual P2 噪音
  **Must NOT do**: 不要用人工观感替代命令输出；不要只汇报“通过/失败”而不列通道级结果。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 需要综合回归与战果报告输出。
  - Skills: []
  - Omitted: [`playwright`] - 当前阶段不是 UI 问题

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Final Verification Wave | Blocked By: 5

  **References**:
  - `package.json`
  - `tests/ipc-contract-sweep.test.ts`
  - 首轮 sweep 输出摘要

  **Acceptance Criteria**:
  - [ ] build 通过
  - [ ] barrage sweep 通过
  - [ ] 报告中按通道族给出 hardening 战果
  - [ ] 若仍有残留项，必须明确归到 P2 或后续任务，不混入已完成项

  **QA Scenarios**:
  ```
  Scenario: Build and sweep both pass
    Tool: Bash
    Steps: 1) run npm run build:electron:dev 2) run node --test tests/ipc-contract-sweep.test.ts
    Expected: Both commands exit 0
    Evidence: .sisyphus/evidence/task-6-build-and-sweep.txt

  Scenario: Channel-level outcome report generated
    Tool: Bash
    Steps: 1) parse sweep stdout 2) summarize channel families by outcome class
    Expected: Final report names stabilized channels and any residual issues explicitly
    Evidence: .sisyphus/evidence/task-6-channel-report.txt
  ```

  **Commit**: NO | Message: `fix(ipc): harden shell boundaries and verify barrage regression` | Files: shell files + tests/evidence only

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- 按“shared wrapper → P0 direct channels → error contract unification → P1 → barrage regression”组织提交。
- 若只能一个提交，建议：`fix(ipc): harden handler shells against malformed payload crashes`
- 严禁提交任何底层 service 逻辑修改。

## Success Criteria
- 29 项中属于 shell-layer robustness defect 的通道被压缩到 0 或明确降为 residual P2
- 业务服务逻辑未被触碰
- packaged posture 下 Fail-Closed 保持不变
- malformed IPC 输入不再导致 raw rejection / uncaught / hang
- 所有错误都以结构化对象 surfaced 给前端

## Evidence Gaps / Defaults Applied
- 本计划基于本地 sweep 结果、直接代码证据、Oracle 与 Metis 审查生成；未依赖 explore 结果，因为相关任务因 API key 无效失败。
- 默认不对 `AUTH.LOGIN` 做无交互 barrage 修复/覆盖；其需要单独的交互式 auth 测试策略，不纳入本轮 shell hardening 目标。
