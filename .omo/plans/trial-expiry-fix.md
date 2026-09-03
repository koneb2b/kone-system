# Trial Expiry 拦截失效 Bug 修复计划

## TL;DR

> **Quick Summary**: 修复 `ensureTrialAccess` 中的 Fail-Open 安全缺陷 — 当无有效授权且无已消费试用锚点时，系统错误地放行请求。增加 Fail-Closed 兜底拒绝逻辑。
> 
> **Deliverables**:
> - `electron/services/license-service.ts` — `ensureTrialAccess` 增加 Fail-Closed 兜底
> - `tests/license-gateway.test.js` — 修复 store mock key 不匹配
> - 全量测试通过（含之前失败的 Scene A）
> 
> **Estimated Effort**: Quick（~10 行代码变更）
> **Parallel Execution**: NO — 顺序执行（2 个文件有依赖）
> **Critical Path**: Task 1 → Task 2 → Task 3

---

## Context

### Original Request
修复 `tests/license-gateway.test.js` Scene A 失败的历史 Bug。该测试验证试用期过期后 `registerSecureIpc` 应拦截请求，但实际 handler 被执行了。

### Root Cause Analysis

**调用链路**:
```
registerSecureIpc() [line 436-448]
  → ensureTrialAccess(store, licenseGuard, operationName) [line 445]
    → claims = licenseGuard.getStoredClaims() [line 399]
    → if (claims.status === 'active' && claims.expiresAt > Date.now()) return null [line 400]
    → checkTrialStatus(store) [line 404]
      → getPhysicalMachineId(store) [line 368]
        → store.get('system.hardwareMachineId') [line 115]
        → getHardwareMachineId() → 真实硬件 UUID [line 118]
      → readAnchor(deviceId) [line 369]
        → 从文件系统/注册表读取加密锚点 [line 243-247]
        → 无锚点文件 → 返回 null [line 370]
      → return { isExpired: false, available: true } [line 371-378]  ← Fail-Open!
    → if (!trialStatus.available && trialStatus.isExpired) [line 405]
      → false && false → 不拦截
    → return null → handler 执行 ← BUG
```

**两个缺陷**:
1. **安全缺陷（生产代码）**: `ensureTrialAccess` 在"无有效授权 + 无已消费试用"状态下返回 null（放行），违反 Fail-Closed 原则
2. **测试缺陷**: store mock 使用 `system.machineId` 但源码读 `system.hardwareMachineId`

### Interview Summary
**Key Discussions**:
- 确认锚点文件系统是试用状态的唯一事实源（store 中的 `trial.*` 字段不被 `checkTrialStatus` 使用）
- 确认 `available: true` 表示"试用未消费"（非"可用"），是 `readAnchor` 返回 null 的结果
- Metis 建议 Path 1：在 `ensureTrialAccess` 增加 Fail-Closed 兜底 + 修复测试 mock key

### Metis Review
**Identified Gaps** (addressed):
- `registerSecureIpc` 用于 `CONFIG.FETCH_MODELS`（低风险），新增拒绝逻辑不影响此通道（因为 `FETCH_MODELS` 不需要试用/授权）— 需确认 `FETCH_MODELS` 是否通过 `registerSecureIpc` 注册
- 新增拒绝消息应区分"未开启试用"和"试用过期"— 使用不同 message 但复用 `TRIAL_EXPIRED` error code 保持兼容
- `app.isPackaged` 在 `ensureTrialAccess` 中不被检查 — 开发模式下 `resolveLicenseTier` 返回 `'premium'` 但不影响 `ensureTrialAccess`

---

## Work Objectives

### Core Objective
关闭 `ensureTrialAccess` 中的 Fail-Open 安全缺陷，确保"无有效授权 + 无已消费试用"状态下请求被拒绝。

### Concrete Deliverables
- `electron/services/license-service.ts:393-416` — `ensureTrialAccess` 增加 `trialStatus.available` 兜底拒绝
- `tests/license-gateway.test.js:55` — 修复 `system.machineId` → `system.hardwareMachineId`

### Definition of Done
- [x] `node --test tests/license-gateway.test.js` → 3/3 pass（含之前失败的 Scene A）
- [x] `node --test tests/e2e/permission-lock.test.js` → 7/7 pass（权限锁回归）
- [x] `node --test tests/**/*.test.js` → 全量回归无新增失败
- [x] `npm run build:electron:dev` → 编译成功

### Must Have
- `ensureTrialAccess` 在 `trialStatus.available === true`（无锚点/未消费试用）时返回拒绝响应
- 拒绝响应复用 `TRIAL_EXPIRED` error code（保持前端兼容）
- 拒绝消息区分"未开启试用"：`${operationName}不可用：请先开启试用或完成授权`
- 测试 store mock key 修复为 `system.hardwareMachineId`

### Must NOT Have (Guardrails)
- 不修改 `checkTrialStatus` 函数逻辑
- 不修改 `readAnchor` / `persistAnchor` / 加密系统
- 不修改 `registerSecureFeatureIpc` 逻辑
- 不添加 store 回退读取路径到 `checkTrialStatus`（锚点文件是唯一事实源）
- 不修改其他测试文件（仅 `license-gateway.test.js`）
- 不引入新的 error code（复用 `TRIAL_EXPIRED`）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (Tests-after — 现有测试作为验证)
- **Framework**: `node:test` + `node:assert/strict`

### QA Policy
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Sequential — code fix + test fix):
├── Task 1: 修复 ensureTrialAccess Fail-Closed 兜底 [quick]
└── Task 2: 修复 license-gateway.test.js store mock key [quick]

Wave 2 (Verification):
└── Task 3: 编译 + 全量回归验证 [quick]

Wave FINAL:
├── F1: Plan compliance audit
├── F2: Code quality review
├── F3: Real manual QA
└── F4: Scope fidelity check
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 2 → Task 3 → F1-F4 → user okay
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1    | —         | 2, 3   |
| 2    | 1         | 3      |
| 3    | 1, 2      | F1-F4  |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `quick`, T2 → `quick`
- **Wave 2**: 1 task — T3 → `quick`
- **FINAL**: 4 steps — F1-F4 → `Bash+Read`

---

## TODOs

- [x] 1. 修复 `ensureTrialAccess` Fail-Closed 兜底

  **What to do**:
  - 打开 `electron/services/license-service.ts`
  - 定位 `ensureTrialAccess` 函数（line 393-416）
  - 在现有 `if (!trialStatus.available && trialStatus.isExpired)` 块（line 405-413）之后，`return null`（line 415）之前，增加 Fail-Closed 兜底：

  ```typescript
  // Fail-Closed: 无有效授权 + 试用未消费（无锚点） → 拒绝
  if (trialStatus.available) {
    return {
      success: false,
      error: 'TRIAL_EXPIRED',
      message: `${operationName}不可用：请先开启试用或完成授权`,
      operationName,
      code: 403,
    }
  }
  ```

  - 这使得 `ensureTrialAccess` 的逻辑变为：
    1. 有活跃授权 → 放行 ✅
    2. 试用已消费且过期 → 拒绝 `TRIAL_EXPIRED` ✅
    3. 试用已消费且时间回拨 → 拒绝 `SYSTEM_TIME_ABNORMAL` ✅
    4. **试用未消费（无锚点）→ 拒绝 `TRIAL_EXPIRED`** ✅ (NEW)
    5. 试用已消费且未过期 → 放行 ✅

  **Must NOT do**:
  - 不修改 `checkTrialStatus` 函数
  - 不修改 `readAnchor` / 加密系统
  - 不引入新的 error code

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件、~6 行插入，逻辑清晰
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential with Task 2)
  - **Blocks**: Tasks 2, 3
  - **Blocked By**: None

  **References** (CRITICAL):

  **Pattern References**:
  - `electron/services/license-service.ts:393-416` — `ensureTrialAccess` 完整函数，修改点在 line 413 和 line 415 之间
  - `electron/services/license-service.ts:405-413` — 现有 `isExpired` 拒绝块，新代码应紧跟其后

  **API/Type References**:
  - `electron/services/license-service.ts:428-434` — `buildFeatureDeniedResponse` 的响应形状参考（但本次使用 `TRIAL_EXPIRED` 而非 `FEATURE_DENIED`）
  - `electron/services/license-service.ts:367-391` — `checkTrialStatus` 返回类型，`available: true` 表示无锚点/未消费

  **WHY Each Reference Matters**:
  - line 393-416 是唯一修改点，必须精确理解现有逻辑分支
  - line 367-391 解释了 `available` 字段的语义：`true` = 无锚点（试用未开始），`false` = 有锚点（试用已消费）
  - 响应形状必须与 line 406-412 的现有拒绝响应保持一致

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 编译验证
    Tool: Bash
    Preconditions: 代码已修改
    Steps:
      1. 执行 `npm run build:electron:dev`
      2. 检查退出码为 0
    Expected Result: TypeScript 编译成功
    Failure Indicators: 类型错误或语法错误
    Evidence: .sisyphus/evidence/task-1-build.txt

  Scenario: 新增代码位置验证
    Tool: Grep
    Preconditions: 代码已修改
    Steps:
      1. 在 `electron/services/license-service.ts` 中搜索 `trialStatus.available`
      2. 确认新增代码在 `isExpired` 检查之后、`return null` 之前
    Expected Result: 找到新增的 `if (trialStatus.available)` 块
    Failure Indicators: 代码位置错误或缺失
    Evidence: .sisyphus/evidence/task-1-code-verify.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-build.txt — 编译输出
  - [ ] task-1-code-verify.txt — 代码位置确认

  **Commit**: NO (与 Task 2 合并提交)

- [x] 2. 修复 `license-gateway.test.js` store mock key

  **What to do**:
  - 打开 `tests/license-gateway.test.js`
  - 定位 Scene A 的 `createStoreMock` 调用（约 line 80-90）
  - 将 `'system.machineId': 'device-a'` 修改为 `'system.hardwareMachineId': 'device-a'`
  - 同样检查 Scene B 和 Scene C 的 store mock，如果也使用了 `system.machineId`，一并修复

  **Must NOT do**:
  - 不修改测试的断言逻辑（Scene A 已经正确断言 `TRIAL_EXPIRED`）
  - 不修改其他测试文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件 key 名替换
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (after Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References** (CRITICAL):

  **Pattern References**:
  - `tests/license-gateway.test.js:49-73` — `createStoreMock` 定义和使用
  - `tests/license-gateway.test.js:75-105` — Scene A 完整代码（expired trial）
  - `electron/services/license-service.ts:114-127` — `getPhysicalMachineId` 读取 `system.hardwareMachineId`

  **WHY Each Reference Matters**:
  - line 49-73 是 mock 定义，需要确认 key 名在哪里传入
  - line 114-127 证明源码读 `system.hardwareMachineId` 而非 `system.machineId`

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Scene A 通过（试用过期拦截）
    Tool: Bash
    Preconditions: Task 1 已完成，dist-electron/ 已编译
    Steps:
      1. 执行 `node --test tests/license-gateway.test.js`
      2. 检查退出码为 0
      3. 确认 stdout 包含 3/3 pass
    Expected Result: 3 tests pass, 0 fail
    Failure Indicators: Scene A 仍然 fail
    Evidence: .sisyphus/evidence/task-2-license-gateway.txt

  Scenario: Scene A 断言验证
    Tool: Bash
    Preconditions: 测试通过
    Steps:
      1. 确认 Scene A 输出包含 `handlerExecuted === false`
      2. 确认 Scene A 输出包含 `error === 'TRIAL_EXPIRED'`
      3. 确认 Scene A 输出包含 `code === 403`
    Expected Result: 所有断言匹配
    Failure Indicators: 任何断言不匹配
    Evidence: .sisyphus/evidence/task-2-scene-a-detail.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-license-gateway.txt — 测试执行输出
  - [ ] task-2-scene-a-detail.txt — Scene A 详细断言

  **Commit**: YES
  - Message: `fix(security): close Fail-Open gap in ensureTrialAccess for unconsumed trial state`
  - Files: `electron/services/license-service.ts`, `tests/license-gateway.test.js`
  - Pre-commit: `node --test tests/license-gateway.test.js`

- [x] 3. 编译 + 全量回归验证

  **What to do**:
  - 执行 `npm run build:electron:dev` 确认编译通过
  - 执行全量测试回归：
    - `node --test tests/license-gateway.test.js` → 3/3 pass
    - `node --test tests/e2e/permission-lock.test.js` → 7/7 pass（权限锁回归）
    - `node --test tests/e2e/403-social-fallback.test.js` → 3/3 pass
    - `node --test tests/e2e/icp-blind-score.test.js` → 5/5 pass
    - `node --test tests/e2e/fallback-routing.test.js` → 1/1 pass
    - `node --test tests/circuit-breaker.test.js` → 1/1 pass
    - `node --test tests/e2e-journey.test.js` → 1/1 pass
  - 确认总计 21/21 pass, 0 fail

  **Must NOT do**:
  - 不修改任何代码来修复回归失败（如果有新失败，记录并报告）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯执行和验证
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (solo)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1, 2

  **References**:
  - 所有测试文件路径（见 Execution Strategy）

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全量回归通过
    Tool: Bash
    Preconditions: Tasks 1, 2 已完成
    Steps:
      1. 执行 `npm run build:electron:dev` → 退出码 0
      2. 依次执行所有测试文件
      3. 统计通过/失败数量
    Expected Result: 21/21 pass, 0 fail
    Failure Indicators: 任何测试失败
    Evidence: .sisyphus/evidence/task-3-full-regression.txt

  Scenario: 权限锁回归验证
    Tool: Bash
    Preconditions: 编译完成
    Steps:
      1. 执行 `node --test tests/e2e/permission-lock.test.js`
      2. 确认 7/7 pass
    Expected Result: 权限锁测试无回归
    Failure Indicators: 任何场景 fail
    Evidence: .sisyphus/evidence/task-3-permission-regression.txt
  ```

  **Evidence to Capture:**
  - [ ] task-3-full-regression.txt — 全量测试输出
  - [ ] task-3-permission-regression.txt — 权限锁回归输出

  **Commit**: NO (已在 Task 2 提交)

---

## Final Verification Wave

> 4 个验证步骤。全部通过后提交给用户确认。

- [x] F1. **Plan Compliance Audit**
  **Steps**:
  1. 确认 `ensureTrialAccess` 包含 `if (trialStatus.available)` 兜底拒绝
  2. 确认 `license-gateway.test.js` 使用 `system.hardwareMachineId`
  3. 确认无其他文件被修改
  **Output**: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT`

- [x] F2. **Code Quality Review**
  **Steps**:
  1. 确认新增代码无 `console.log`、空 catch、未使用变量
  2. 确认响应形状与现有 `TRIAL_EXPIRED` 响应一致
  3. 确认 TypeScript 编译无 warning
  **Output**: `Build [PASS/FAIL] | Code [CLEAN/N issues] | VERDICT`

- [x] F3. **Real Manual QA**
  **Steps**:
  1. 从干净编译开始：`npm run build:electron:dev`
  2. 执行 `node --test tests/license-gateway.test.js` → 3/3 pass
  3. 执行全量回归 → 21/21 pass
  **Output**: `Tests [N/N pass] | VERDICT`

- [x] F4. **Scope Fidelity Check**
  **Steps**:
  1. 确认仅修改 2 个文件：`electron/services/license-service.ts` + `tests/license-gateway.test.js`
  2. 确认 `license-service.ts` 变更仅在 `ensureTrialAccess` 函数内（line 393-416 范围）
  3. 确认 `license-gateway.test.js` 变更仅为 key 名替换
  **Output**: `Files [2/2] | Scope [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **Task 2 complete**: `fix(security): close Fail-Open gap in ensureTrialAccess for unconsumed trial state`
  - Files: `electron/services/license-service.ts`, `tests/license-gateway.test.js`
  - Pre-commit: `node --test tests/license-gateway.test.js`

---

## Success Criteria

### Verification Commands
```bash
npm run build:electron:dev                          # Expected: 退出码 0
node --test tests/license-gateway.test.js           # Expected: 3/3 pass (含之前失败的 Scene A)
node --test tests/e2e/permission-lock.test.js       # Expected: 7/7 pass (权限锁回归)
node --test tests/e2e/403-social-fallback.test.js   # Expected: 3/3 pass
node --test tests/e2e/icp-blind-score.test.js       # Expected: 5/5 pass
node --test tests/e2e/fallback-routing.test.js      # Expected: 1/1 pass
node --test tests/circuit-breaker.test.js           # Expected: 1/1 pass
node --test tests/e2e-journey.test.js               # Expected: 1/1 pass
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All 21 tests pass
- [x] Fail-Closed principle enforced
