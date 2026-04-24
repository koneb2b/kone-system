# Kone V1.2 E2E 测试执行计划

## TL;DR

> **Quick Summary**: 为 Kone V1.2 的三大核心商业行为编写完整 E2E 测试：403 多源降级链路、ICP 盲评容错、商业权限锁。测试只读模式，零业务代码修改。
> 
> **Deliverables**:
> - `tests/e2e/403-social-fallback.test.js` — 403 多源降级全路径测试
> - `tests/e2e/icp-blind-score.test.js` — ICP Snippet 盲评隔离测试
> - `tests/e2e/permission-lock.test.js` — 商业权限锁矩阵测试
> - 所有新测试通过 + 现有测试零回归
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Tasks 2/3/4 (parallel) → Task 5

---

## Context

### Original Request
生成完整的 E2E 测试执行计划（只读模式，不允许修改任何业务代码）。重点验证：403 多源降级、ICP 盲评、商业权限锁。输出清晰的测试步骤和通过/失败判定标准。

### Interview Summary
**Key Discussions**:
- 测试必须只读，不修改 `electron/` 或 `src/` 下任何业务代码
- 使用现有 `node:test` 框架 + `Module._load` mock 模式
- 测试运行依赖 `dist-electron/` 编译产物

**Research Findings**:
- 现有测试已部分覆盖三级降级（`mock-search-fallback.js`、`fallback-routing.test.js`）
- 权限锁已有 3 个场景（`license-gateway.test.js`）但缺少自动化双层拦截和 cloud 服务矩阵
- ICP 盲评路径在现有测试中仅作为 403 降级的副产品出现，缺少独立隔离测试
- 熔断器测试已覆盖（`circuit-breaker.test.js`），本次不重复

### Metis Review
**Identified Gaps** (addressed):
- 需确认 `dist-electron/` 使用 CommonJS（已知 tsc 编译为 CJS）
- 需确认 `global.fetch` 是唯一 HTTP 通道（已确认搜索服务使用 `fetch`）
- 错误响应精确字段形状需从源码固定（已从 `license-service.ts` 和 `search-service.ts` 提取）
- 社交源自身 403/超时的级联失败未覆盖（已加入边缘用例）
- 空 snippet 盲评场景未覆盖（已加入边缘用例）

---

## Work Objectives

### Core Objective
为 Kone V1.2 的三大核心商业行为建立可独立运行、可自动化验证、零业务代码侵入的 E2E 测试覆盖。

### Concrete Deliverables
- `tests/e2e/403-social-fallback.test.js`
- `tests/e2e/icp-blind-score.test.js`
- `tests/e2e/permission-lock.test.js`
- `package.json` 中添加对应 npm script（如需要）

### Definition of Done
- [ ] `node --test tests/e2e/403-social-fallback.test.js` → 退出码 0
- [ ] `node --test tests/e2e/icp-blind-score.test.js` → 退出码 0
- [ ] `node --test tests/e2e/permission-lock.test.js` → 退出码 0
- [ ] `node --test tests/**/*.test.js` → 退出码 0（全量回归无新增失败）
- [ ] 新增/变更文件仅在 `tests/` 目录下（通过 `dir /s /b tests\e2e\*.test.js` 确认新文件存在，并人工确认 `electron/` 和 `src/` 无变更）

### Must Have
- 每个测试文件可独立运行（`node --test <file>`）
- 断言使用精确字段名和值类型，不使用模糊 truthiness 判断
- Mock 保真度：模拟真实 API 响应形状（403 response body、timeout 行为）
- 测试间无共享可变状态，`test.after()` 清理所有 hook

### Must NOT Have (Guardrails)
- 不修改 `electron/` 或 `src/` 下任何文件
- 不添加 npm 依赖
- 不重构或修改现有测试文件
- 不测试 UI/前端行为（`feature-gate.ts` 属于前端，不在范围内）
- 不扩展到 429、重试、熔断器场景（已有 `circuit-breaker.test.js` 覆盖）
- 不引入 TypeScript 测试文件或类型注解
- 不添加覆盖率报告工具

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (Tests-after, 扩展现有模式)
- **Framework**: `node:test` + `node:assert/strict`（Node.js 内置）
- **Pattern**: 复用 `Module._load` hook + `global.fetch` mock

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Test execution**: Use Bash — `node --test <file>`, assert exit code 0, capture stdout
- **Regression**: Use Bash — `node --test tests/**/*.test.js`, assert no new failures
- **File integrity**: Use Bash — `dir /s /b tests\e2e\*.test.js` 确认新文件存在；grep `electron/` 和 `src/` 目录确认无变更

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Pre-flight — foundation):
└── Task 1: 编译预检 + 源码精确形状提取 [quick]

Wave 2 (Core tests — MAX PARALLEL):
├── Task 2: 403 多源降级 E2E 测试 [deep]
├── Task 3: ICP 盲评隔离 E2E 测试 [deep]
└── Task 4: 商业权限锁矩阵 E2E 测试 [deep]

Wave 3 (Verification):
└── Task 5: 全量回归 + 完整性验证 [quick]

Wave FINAL (After ALL tasks — parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Tasks 2/3/4 → Task 5 → F1-F4 → user okay
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1    | —         | 2, 3, 4 |
| 2    | 1         | 5      |
| 3    | 1         | 5      |
| 4    | 1         | 5      |
| 5    | 2, 3, 4   | F1-F4  |
| F1-F4| 5         | user okay |

### Agent Dispatch Summary

- **Wave 1**: 1 task — T1 → `quick`
- **Wave 2**: 3 tasks — T2 → `deep`, T3 → `deep`, T4 → `deep`
- **Wave 3**: 1 task — T5 → `quick`
- **FINAL**: 4 steps — F1 → `Bash+Read`, F2 → `Bash`, F3 → `Bash`, F4 → `Bash+Read`

---

## TODOs

- [x] 1. 编译预检 + 源码精确形状提取

  **What to do**:
  - 执行 `npm run build:electron:dev` 确保 `dist-electron/` 产物与当前源码同步
  - 确认编译产物使用 CommonJS（检查 `dist-electron/electron/services/search-service.js` 中是否有 `require()` 调用）
  - 确认 `global.fetch` 是搜索服务唯一 HTTP 通道（grep `dist-electron/electron/services/search-service.js` 中的 `fetch(` 调用，排除 `axios`/`got`/`net.request`）
  - 从源码提取精确错误响应形状：
    - `TRIAL_EXPIRED` 响应：`{ success: false, error: 'TRIAL_EXPIRED', message: string, operationName: string, code: 403 }`
    - `FEATURE_DENIED` 响应：`{ success: false, error: 'FEATURE_DENIED', message: string, operationName: string, code: 403 }`
    - `SYSTEM_TIME_ABNORMAL` 响应：`{ success: false, error: 'SYSTEM_TIME_ABNORMAL', message: string, operationName: string, code: 403 }`
  - 从 `search-service.ts:38` 提取 `fallbackStatus?: 'social_blind_score'` 类型定义
  - 从 `search-service.ts:988` 提取 `fallbackStatus` 赋值逻辑：`usedSocialFallback ? 'social_blind_score' : payload.candidate.fallbackStatus`
  - 从 `search-service.ts:449` 提取 `fallbackStatus` 在结果标准化中的传递逻辑
  - 从 `search-service.ts:995` 提取盲评标记精确文案：`'⚠️ 官网访问受限，基于简介轻量评估（官网无法访问）'`

  **Must NOT do**:
  - 不修改任何源码文件
  - 不安装新依赖

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯编译和 grep 操作，无复杂逻辑
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: 不涉及浏览器操作

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (solo)
  - **Blocks**: Tasks 2, 3, 4
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL):

  **Pattern References**:
  - `electron/services/search-service.ts:1286` — `registerSecureFeatureIpc` 注册搜索 handler，包含降级链路入口
  - `electron/services/search-service.ts:38` — `fallbackStatus?: 'social_blind_score'` 类型定义
  - `electron/services/search-service.ts:988` — `fallbackStatus` 赋值逻辑（社交降级判断）
  - `electron/services/search-service.ts:995` — 盲评标记精确文案：`'⚠️ 官网访问受限，基于简介轻量评估（官网无法访问）'`
  - `electron/services/search-service.ts:449` — `fallbackStatus` 在结果标准化中的传递
  - `electron/services/license-service.ts:450` — `registerSecureFeatureIpc` 定义，包含 `TRIAL_EXPIRED` 和 `FEATURE_DENIED` 响应构造

  **API/Type References**:
  - `electron/ipc/channels.ts` — IPC 通道名称单一事实源
  - `src/shared/ipc-contracts.ts` — 前后端共享类型定义

  **Test References**:
  - `tests/e2e/fallback-routing.test.js` — 现有 mock 模式参考（Module._load + global.fetch）
  - `tests/license-gateway.test.js` — 权限测试 mock 模式参考

  **WHY Each Reference Matters**:
  - `search-service.ts:1286` 是降级链路的入口，需要从这里追踪 403 处理路径和盲评分支
  - `license-service.ts:450` 定义了所有权限拦截的错误响应格式，测试断言必须与之精确匹配
  - 现有测试文件提供了经过验证的 mock 模式，新测试必须复用相同模式

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 编译产物同步验证
    Tool: Bash
    Preconditions: 当前工作目录为项目根目录
    Steps:
      1. 执行 `npm run build:electron:dev`
      2. 检查退出码为 0
      3. 检查 `dist-electron/electron/services/search-service.js` 文件存在
    Expected Result: 编译成功，产物文件存在
    Failure Indicators: 退出码非 0，或产物文件不存在
    Evidence: .sisyphus/evidence/task-1-build-check.txt

  Scenario: CommonJS 格式确认
    Tool: Bash
    Preconditions: dist-electron/ 已编译
    Steps:
      1. 在 `dist-electron/electron/services/search-service.js` 中搜索 `require(` 关键字
      2. 确认存在 CommonJS require 调用
      3. 搜索 `import ` 语句确认不存在 ESM 导入
    Expected Result: 文件使用 CommonJS 格式
    Failure Indicators: 找不到 require() 或发现 ESM import 语句
    Evidence: .sisyphus/evidence/task-1-cjs-check.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-build-check.txt — 编译输出
  - [ ] task-1-cjs-check.txt — 模块格式确认
  - [ ] task-1-error-shapes.txt — 提取的精确错误响应形状

  **Commit**: NO (仅预检，无文件变更)

---

- [x] 2. 403 多源降级 E2E 测试 (`tests/e2e/403-social-fallback.test.js`)

  **What to do**:
  - 创建 `tests/e2e/403-social-fallback.test.js`
  - 复用 `fallback-routing.test.js` 的 mock 模式（`Module._load` + `global.fetch`）
  - 编写以下测试场景：

  **场景 A: 官网 403 触发社交源查询**
  - Mock: `global.fetch` 对目标官网 URL 返回 `{ status: 403 }`
  - Mock: LinkedIn/Kompass/Europages 查询返回有效结果
  - Mock: LLM 返回评分结果
  - Assert: handler 调用了 `site:linkedin.com/company`、`site:kompass.com`、`site:europages.com` 查询
  - Assert: 结果包含 `fallbackStatus: 'social_blind_score'`
  - Assert: `matchScore` 为有效数字（`typeof === 'number'`）
  - Assert: `search:stream-complete` 事件被发送

  **场景 B: 社交源自身也返回空结果**
  - Mock: 官网 403 + 所有社交源返回空 `organic_results: []`
  - Assert: 结果仍然返回（不崩溃）
  - Assert: `matchScore` 为 `undefined` 或带有降级标记
  - Assert: `riskFlags` 包含官网受限提示
  - Assert: `search:stream-complete` 仍然被发送（UI 不死锁）

  **场景 C: 三级降级完整链路（location 400 → keyword fallback → organic）**
  - Mock: 一级 `google_maps` + `location` 参数返回 400（UNSUPPORTED_LOCATION）
  - Mock: 二级 keyword fallback 返回 `local_results: []`
  - Mock: 三级 organic 返回有效结果
  - Assert: 调用顺序为 maps-location → maps-keyword → organic-keyword
  - Assert: stage 事件包含 `地图定位受限` 和 `全局网页线索` 文案
  - Assert: 最终结果 source 为 `Google Organic`

  **Must NOT do**:
  - 不测试 429/熔断器场景（已有 circuit-breaker.test.js）
  - 不测试重试/退避逻辑
  - 不修改现有 fallback-routing.test.js

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要理解复杂的降级链路逻辑，精确构造 mock 序列
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References** (CRITICAL):

  **Pattern References**:
  - `tests/e2e/fallback-routing.test.js:1-256` — 完整的 403 降级测试模式，包括 electronMock、secretManagerMock、licenseServiceMock、global.fetch mock、senderEvents 收集
  - `tests/mock-search-fallback.js:1-108` — `resolveSerpSearchPlan` 的三级降级测试模式，包括 `attemptSearch` mock、`onStage`/`onFallback` 回调验证

  **API/Type References**:
  - `electron/services/search-service.ts:1286` — `registerSearchHandlers` 中 `search:execute` handler 的完整降级逻辑
  - `electron/ipc/channels.ts` — `IPC_CHANNELS.SEARCH.STREAM_COMPLETE`、`IPC_CHANNELS.SEARCH.LEAD_SCORED` 等通道名

  **WHY Each Reference Matters**:
  - `fallback-routing.test.js` 提供了经过验证的 mock 骨架，新测试必须复用相同的 `Module._load` 拦截链和 `global.fetch` 替换模式
  - `mock-search-fallback.js` 展示了如何直接测试 `resolveSerpSearchPlan` 函数的三级降级行为
  - `search-service.ts:1286` 是降级链路的实际实现，需要理解 403 如何触发社交源查询

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 403 社交源降级完整路径
    Tool: Bash
    Preconditions: dist-electron/ 已编译
    Steps:
      1. 执行 `node --test tests/e2e/403-social-fallback.test.js`
      2. 检查退出码为 0
      3. 检查 stdout 包含所有子测试通过信息
    Expected Result: 退出码 0，所有子测试 pass
    Failure Indicators: 退出码非 0，任何子测试 fail
    Evidence: .sisyphus/evidence/task-2-403-fallback.txt

  Scenario: 社交源全部失败的降级兜底
    Tool: Bash
    Preconditions: 测试文件已创建
    Steps:
      1. 确认测试中包含"社交源返回空结果"的子测试
      2. 确认该子测试断言 stream-complete 仍被发送
      3. 执行测试确认通过
    Expected Result: 即使社交源全部失败，系统仍正常收尾
    Failure Indicators: stream-complete 未发送，或测试超时
    Evidence: .sisyphus/evidence/task-2-social-empty.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-403-fallback.txt — 测试执行输出
  - [ ] task-2-social-empty.txt — 社交源空结果场景输出

  **Commit**: YES (groups with Tasks 3, 4)
  - Message: `test(e2e): add 403 social fallback degradation tests`
  - Files: `tests/e2e/403-social-fallback.test.js`
  - Pre-commit: `node --test tests/e2e/403-social-fallback.test.js`

- [x] 3. ICP 盲评隔离 E2E 测试 (`tests/e2e/icp-blind-score.test.js`)

  **What to do**:
  - 创建 `tests/e2e/icp-blind-score.test.js`
  - 复用 `fallback-routing.test.js` 的 mock 模式
  - 编写以下测试场景：

  **场景 A: 官网超时触发 Snippet 盲评**
  - Mock: `global.fetch` 对官网 URL 抛出网络超时错误（`throw new Error('network timeout')`）
  - Mock: LLM 返回基于 snippet 的评分结果
  - Assert: `matchScore` 为有效数字
  - Assert: `matchReasons` 数组中包含 `基于简介轻量评估（官网无法访问）` 文案
  - Assert: 结果不包含从官网抓取的 `contact`/`email`/`phone` 深探数据
  - Assert: `search:stream-complete` 正常发送

  **场景 B: 官网 DNS 解析失败触发盲评**
  - Mock: `global.fetch` 对官网 URL 抛出 DNS 错误（`throw new Error('getaddrinfo ENOTFOUND')`）
  - Assert: 同场景 A 的盲评断言
  - Assert: `riskFlags` 包含人工复核提示

  **场景 C: 官网返回空白/无价值内容**
  - Mock: `global.fetch` 对官网返回 200 但 body 为空白 HTML（`<html><body></body></html>`）
  - Assert: 系统检测到内容无价值后切换到盲评路径
  - Assert: `matchReasons` 标注为轻量评估

  **场景 D: Snippet 也为空的极端情况**
  - Mock: 官网超时 + 候选的 `snippet` 字段为空字符串
  - Assert: 系统不崩溃
  - Assert: `matchScore` 为 `undefined`（无法评分）或带有明确降级标记
  - Assert: `search:stream-complete` 仍然发送

  **场景 E: 盲评与正常评分的结果差异**
  - Mock: 两个候选 — 一个官网正常（返回丰富内容），一个官网超时
  - Assert: 正常候选有完整 `contact`/`email` 深探数据
  - Assert: 超时候选仅有 snippet 盲评数据
  - Assert: 两者都有 `matchScore`，但盲评候选的 `matchReasons` 包含盲评标记

  **Must NOT do**:
  - 不测试 403 社交源降级（Task 2 覆盖）
  - 不测试 LLM 本身的评分质量
  - 不修改 search-service.ts 的盲评逻辑

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要精确理解 Brain 模块的评分分支逻辑，区分正常评分和盲评路径
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References** (CRITICAL):

  **Pattern References**:
  - `tests/e2e/fallback-routing.test.js:99-101` — LLM mock 响应构造模式（`llmResponse` helper）
  - `tests/e2e/fallback-routing.test.js:103-180` — `global.fetch` 分路由 mock 模式

  **API/Type References**:
  - `electron/services/search-service.ts` — `enrichLeadWithDeepProbe` 函数（官网抓取 + 深探逻辑）
  - `electron/services/search-service.ts` — `extractWebsiteContent` 函数（HTML 提取，失败时触发盲评）
  - `electron/services/search-service.ts` — `buildDeepProbePrompt` / `buildSearchScoringPrompt`（评分 prompt 构造）

  **Test References**:
  - `tests/e2e-journey.test.js:56-79` — 搜索结果中盲评失败候选的 `riskFlags` 字段示例：`['website_403', 'blind_score_failed', '官网访问受限，建议人工复核']`

  **WHY Each Reference Matters**:
  - `fallback-routing.test.js` 的 fetch mock 模式是构造"官网超时"场景的基础
  - `search-service.ts` 中的 `enrichLeadWithDeepProbe` 是盲评分支的入口，需要理解何时触发 snippet-only 路径
  - `e2e-journey.test.js` 展示了盲评失败时的 `riskFlags` 精确值，测试断言需要与之对齐

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 官网超时触发盲评
    Tool: Bash
    Preconditions: dist-electron/ 已编译
    Steps:
      1. 执行 `node --test tests/e2e/icp-blind-score.test.js`
      2. 检查退出码为 0
      3. 检查 stdout 包含 "官网超时触发 Snippet 盲评" 子测试通过
    Expected Result: 退出码 0，盲评路径正确触发
    Failure Indicators: 退出码非 0，matchReasons 不包含盲评标记
    Evidence: .sisyphus/evidence/task-3-blind-score.txt

  Scenario: 空 snippet 极端情况不崩溃
    Tool: Bash
    Preconditions: 测试文件已创建
    Steps:
      1. 确认测试中包含"Snippet 为空"的子测试
      2. 执行测试确认不抛出未捕获异常
      3. 确认 stream-complete 仍被发送
    Expected Result: 系统优雅降级，不崩溃
    Failure Indicators: 未捕获异常，stream-complete 未发送
    Evidence: .sisyphus/evidence/task-3-empty-snippet.txt
  ```

  **Evidence to Capture:**
  - [ ] task-3-blind-score.txt — 盲评测试执行输出
  - [ ] task-3-empty-snippet.txt — 空 snippet 场景输出

  **Commit**: YES (groups with Tasks 2, 4)
  - Message: `test(e2e): add ICP blind scoring isolation tests`
  - Files: `tests/e2e/icp-blind-score.test.js`
  - Pre-commit: `node --test tests/e2e/icp-blind-score.test.js`

- [x] 4. 商业权限锁矩阵 E2E 测试 (`tests/e2e/permission-lock.test.js`)

  **What to do**:
  - 创建 `tests/e2e/permission-lock.test.js`
  - 复用 `license-gateway.test.js` 的 mock 模式
  - 编写以下测试场景：

  **场景 A: Trial 过期拦截搜索**
  - Mock: store 中 `trial.firstActivationTimestamp` 设为 9 天前（超过 7 天试用期）
  - 调用 `search:execute` handler
  - Assert: handler 未执行（`handlerExecuted === false`）
  - Assert: 返回 `{ success: false, error: 'TRIAL_EXPIRED', code: 403, operationName: '海外客户智能搜索' }`

  **场景 B: Trial 过期拦截深度分析**
  - Mock: 同场景 A 的过期 store
  - 调用 `analysis:generate` handler
  - Assert: 返回 `{ success: false, error: 'TRIAL_EXPIRED', code: 403 }`

  **场景 C: Basic 用户访问 cloud_send 被拒**
  - Mock: licenseGuard 返回 active claims 但 features 不含 `cloud_send`
  - Mock: `requireFeature('cloud_send')` 抛出 `{ code: 403, message: '当前授权无权执行自动化发信' }`
  - 调用 `automation:verify-emails` handler
  - Assert: 返回 `{ success: false, error: 'FEATURE_DENIED', code: 403 }`

  **场景 D: automation:start-campaign 双层拦截**
  - Mock: Trial 未过期 + licenseGuard 无 `cloud_send` 特性
  - 调用 `automation:start-campaign` handler
  - Assert: 第一层 `ensureTrialAccess` 通过
  - Assert: 第二层 `requireFeature('cloud_send')` 拒绝
  - Assert: 返回 `FEATURE_DENIED`

  **场景 E: Premium 用户正常通过 cloud_send**
  - Mock: licenseGuard 返回 active claims + features 含 `cloud_send`
  - 调用 `automation:verify-emails` handler（带有效 payload）
  - Assert: handler 被执行（`handlerExecuted === true`）
  - Assert: 返回 `{ success: true, ... }`

  **场景 F: 系统时间回拨锁定**
  - Mock: store 中 `trial.lastKnownGoodTimestamp` 大于当前时间（模拟时间回拨）
  - 调用任意受保护 handler
  - Assert: 返回 `{ success: false, error: 'SYSTEM_TIME_ABNORMAL', code: 403 }`

  **场景 G: Supabase 云服务权限矩阵**
  - Mock: Basic 用户（无 `cloud_send`）
  - 依次调用 `cloud:check-collision`、`cloud:fetch-team-leads`、`cloud:subscribe-realtime`
  - Assert: 全部返回 `FEATURE_DENIED`

  **Must NOT do**:
  - 不测试前端 `feature-gate.ts` 的 UI 拦截
  - 不测试离线授权码激活流程
  - 不修改 license-service.ts 或 license-guard.ts

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要理解多层权限拦截机制，精确构造不同授权状态的 mock
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References** (CRITICAL):

  **Pattern References**:
  - `tests/license-gateway.test.js:1-180` — 完整的权限测试模式，包括 `createIpcMainMock`、`createStoreMock`、`createLicenseGuardMock`、三个场景（expired/denied/success）
  - `tests/license-gateway.test.js:58-73` — `createLicenseGuardMock` 的 `featureError` 注入模式

  **API/Type References**:
  - `electron/services/license-service.ts:450` — `registerSecureFeatureIpc` 完整签名和错误响应构造
  - `electron/services/automation-service.ts:257` — `automation:verify-emails` 的 `registerSecureFeatureIpc` 注册（feature: `cloud_send`）
  - `electron/services/automation-service.ts:13` — `ensureTrialAccess` 导入，用于 `start-campaign` 双层拦截
  - `electron/services/supabase-service.ts:377-508` — 10 个 `registerSecureFeatureIpc` 调用，全部使用 `cloud_send` 或 `team_collaboration`

  **Test References**:
  - `tests/license-gateway.test.js:75-105` — Scene A: expired trial 的精确断言模式
  - `tests/license-gateway.test.js:107-141` — Scene B: feature denied 的精确断言模式

  **WHY Each Reference Matters**:
  - `license-gateway.test.js` 提供了经过验证的权限 mock 骨架，新测试必须复用 `createLicenseGuardMock` 模式
  - `automation-service.ts:257` 展示了 `cloud_send` 特性的实际注册方式，测试需要模拟相同的拦截链
  - `supabase-service.ts` 的 10 个注册点是权限矩阵的完整范围，测试需要覆盖代表性子集

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 权限锁矩阵全场景通过
    Tool: Bash
    Preconditions: dist-electron/ 已编译
    Steps:
      1. 执行 `node --test tests/e2e/permission-lock.test.js`
      2. 检查退出码为 0
      3. 检查 stdout 包含所有 7 个子测试通过
    Expected Result: 退出码 0，7 个场景全部 pass
    Failure Indicators: 退出码非 0，任何场景 fail
    Evidence: .sisyphus/evidence/task-4-permission-lock.txt

  Scenario: 双层拦截验证
    Tool: Bash
    Preconditions: 测试文件已创建
    Steps:
      1. 确认测试中包含 "automation:start-campaign 双层拦截" 子测试
      2. 确认该子测试验证 ensureTrialAccess 通过后 requireFeature 拒绝
      3. 执行测试确认通过
    Expected Result: 双层拦截按序执行，第二层正确拒绝
    Failure Indicators: handler 被执行，或错误类型不是 FEATURE_DENIED
    Evidence: .sisyphus/evidence/task-4-double-guard.txt
  ```

  **Evidence to Capture:**
  - [ ] task-4-permission-lock.txt — 权限锁测试执行输出
  - [ ] task-4-double-guard.txt — 双层拦截场景输出

  **Commit**: YES (groups with Tasks 2, 3)
  - Message: `test(e2e): add commercial permission lock matrix tests`
  - Files: `tests/e2e/permission-lock.test.js`
  - Pre-commit: `node --test tests/e2e/permission-lock.test.js`

- [x] 5. 全量回归 + 完整性验证

  **What to do**:
  - 执行全量测试：`node --test tests/**/*.test.js`
  - 确认所有新增测试通过
  - 确认所有现有测试无回归
  - 执行 `dir /s /b tests\e2e\*.test.js` 确认新文件存在
  - 执行 `dir /s /b /a:-d electron\services\*.ts` 和 `dir /s /b /a:-d src\lib\*.ts` 确认业务文件时间戳未变（无修改）
  - 如果 `package.json` 需要添加新的 test script，在此步骤添加

  **Must NOT do**:
  - 不修改任何业务代码来修复测试失败
  - 如果现有测试因环境问题失败，记录但不修改

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯执行和验证操作
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (solo)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 2, 3, 4

  **References**:
  - `package.json:18-25` — 现有 test scripts 定义

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全量回归通过
    Tool: Bash
    Preconditions: Tasks 2, 3, 4 已完成
    Steps:
      1. 执行 `node --test tests/**/*.test.js`
      2. 检查退出码为 0
      3. 统计通过/失败数量
    Expected Result: 全部通过，零失败
    Failure Indicators: 任何测试失败
    Evidence: .sisyphus/evidence/task-5-full-regression.txt

  Scenario: 文件变更范围验证
    Tool: Bash
    Preconditions: 所有测试文件已创建
    Steps:
      1. 执行 `dir /s /b tests\e2e\*.test.js` 确认 3 个新文件存在
      2. 确认 `electron/` 和 `src/` 下无文件被修改（检查文件时间戳）
    Expected Result: 仅 tests/ 下有新增文件
    Failure Indicators: electron/ 或 src/ 下有变更
    Evidence: .sisyphus/evidence/task-5-scope-check.txt
  ```

  **Evidence to Capture:**
  - [ ] task-5-full-regression.txt — 全量测试输出
  - [ ] task-5-scope-check.txt — 文件变更范围

  **Commit**: YES
  - Message: `test(e2e): add 403 fallback, ICP blind score, and permission lock E2E tests`
  - Files: `tests/e2e/403-social-fallback.test.js`, `tests/e2e/icp-blind-score.test.js`, `tests/e2e/permission-lock.test.js`
  - Pre-commit: `node --test tests/**/*.test.js`

---

## Final Verification Wave

> 4 个验证步骤顺序执行。全部通过后提交给用户确认。
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [x] F1. **Plan Compliance Audit**
  **Tool**: Bash + Read
  **Steps**:
  1. Read `.sisyphus/plans/e2e-test-plan.md`，逐条检查 "Must Have" 是否在测试文件中有对应实现
  2. Grep `electron/` 和 `src/` 目录确认无变更（`findstr /s /m "TODO\|FIXME" tests\e2e\*.test.js` 确认无遗留标记）
  3. 检查 `.sisyphus/evidence/` 下所有 task-N 证据文件是否存在
  4. 对比 Deliverables 列表与实际文件
  **Output**: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review**
  **Tool**: Bash
  **Steps**:
  1. 执行 `node --test tests/**/*.test.js`，记录通过/失败数
  2. Grep 新测试文件中的 `catch {}` 空块、`console.log`、未使用变量
  3. 确认每个测试文件有 `test.after()` 清理 `Module._load` 和 `global.fetch`
  4. 确认断言使用 `assert.strictEqual` / `assert.deepStrictEqual`，不使用松散等式
  **Output**: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA**
  **Tool**: Bash
  **Steps**:
  1. 执行 `npm run build:electron:dev`（从干净编译状态开始）
  2. 独立执行每个测试文件：
     - `node --test tests/e2e/403-social-fallback.test.js` → 记录 stdout/stderr
     - `node --test tests/e2e/icp-blind-score.test.js` → 记录 stdout/stderr
     - `node --test tests/e2e/permission-lock.test.js` → 记录 stdout/stderr
  3. 执行全量回归：`node --test tests/**/*.test.js`
  4. 保存所有输出到 `.sisyphus/evidence/final-qa/`
  **Output**: `Files [N/N pass] | Regression [PASS/FAIL] | VERDICT`

- [x] F4. **Scope Fidelity Check**
  **Tool**: Bash + Read
  **Steps**:
  1. 对每个 Task：读取 "What to do"，读取实际测试文件内容，验证 1:1 对应
  2. 执行 `dir /s /b tests\e2e\*.test.js` 确认仅有计划中的 3 个新文件
  3. 执行 `dir /s /b /a:-d electron\services\*.ts` 和 `dir /s /b /a:-d src\lib\*.ts` 确认无变更（文件时间戳未变）
  4. 检查是否有计划外的额外文件被创建
  **Output**: `Tasks [N/N compliant] | Scope [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **Wave 2 complete**: `test(e2e): add 403 fallback, ICP blind score, and permission lock E2E tests` — tests/e2e/*.test.js, `node --test tests/**/*.test.js`

---

## Success Criteria

### Verification Commands
```bash
npm run build:electron:dev          # Expected: 编译成功，退出码 0
node --test tests/e2e/403-social-fallback.test.js   # Expected: all subtests pass
node --test tests/e2e/icp-blind-score.test.js       # Expected: all subtests pass
node --test tests/e2e/permission-lock.test.js       # Expected: all subtests pass
node --test tests/**/*.test.js      # Expected: 全部通过，零回归
dir /s /b tests\e2e\*.test.js     # Expected: 3 个新测试文件
# 确认 electron/ 和 src/ 下无文件变更（检查文件时间戳）
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Zero business code modifications
