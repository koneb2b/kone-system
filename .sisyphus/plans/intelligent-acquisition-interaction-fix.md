# 智能获客深层交互修复执行计划

## TL;DR
> **Summary**: 本计划将《智能获客组件深度自查与优化报告》转化为可执行修复清单，目标是在不破坏生产 Fail-Closed 与商业边界的前提下，修复两条链路：1）分析抽屉的 generic unavailable/配置缺失语义；2）伴随式后台巡航的 0/0 与未响应状态语义。
> **Deliverables**:
> - `analysis:generate` 结构化错误/降级语义
> - dev-only 主进程分析 mock fallback（如启用）
> - 巡航状态语义与 UI 表达修复
> - 针对分析与巡航的自动化验证矩阵
> **Effort**: Large
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 3 → 6 → 7

## Context
### Original Request
- 用户确认搜索列表页已经恢复，但“查看分析”抽屉中的 AI 挖掘/转化动作报 `当前智能分析服务暂不可用`。
- 用户确认伴随式后台巡航组件显示 `0/0` 且未响应。
- 用户要求输出 `.sisyphus/plans/` 下的详尽报告与计划，不直接改代码。
- 当前阶段目标：基于审计报告继续产出一份让 Sisyphus(Build) 可直接执行的实施计划。

### Audit Summary
- `analysis:generate` 的实际 handler 位于 `electron/services/search-service.ts`，当前只返回字符串错误，前端在 `src/components/analysis-drawer.tsx` 中用正则猜测错误类别。
- 真实 Electron dev 下，分析链路没有与纯 dev shell 等价的 main-process mock fallback。
- 巡航 UI 来自 `src/components/search-engine.tsx`，进度数字直接渲染 `autopilotCompletedOrFailed / autopilotRuntime.totalJobs`，没有把空队列、状态不可用、hydrating、cooldown、paused-after-relaunch 等情况语义化区分。
- `autopilot-store.ts` / `autopilot-runner.ts` / `autopilot-state-service.ts` 当前能工作，但契约太弱，容易把多个不同原因折叠成 0/0 与“暂无执行中的任务”。
- `src/main.tsx` 的纯 dev shell 是强环境伪阳性来源：analysis 有 mock，但 autopilot state 为 `null`，search 为空结果。

### Metis Review (gaps addressed)
- 必须先定义**语义状态/契约**，再改 UI，不能先改显示文案。
- 必须显式决定 analysis 的错误类别、autopilot 的状态类别、以及 dev mock 是否默认启用。
- 必须保持 production Fail-Closed，不得把 dev fallback 泄漏到 packaged 运行态。
- 必须区分纯 dev shell 与 Electron dev，不得把环境伪阳性写成真实生产根因。

## Work Objectives
### Core Objective
让实现者在零判断成本下完成两项修复：
1. 分析抽屉不再把配置缺失/可恢复降级统一压扁成 generic unavailable；
2. 巡航面板不再用 `0/0` 作为模糊状态输出，而是以结构化状态表达空队列、hydrating、paused、cooldown、error、state unavailable 等情况。

### Deliverables
- `src/shared/ipc-contracts.ts` 中新增/扩展分析与巡航相关语义类型
- `electron/services/search-service.ts` 中分析 handler 的结构化错误/降级返回
- （可选但推荐）dev-only main-process analysis mock fallback 方案落地
- `src/lib/electron-api.ts` 对新 IPC 语义的适配
- `src/components/analysis-drawer.tsx` 的结构化错误展示逻辑
- `electron/services/autopilot-state-service.ts` 的 richer state envelope
- `src/store/autopilot-store.ts` 的 hydration/empty/unavailable/cooldown/paused 语义修复
- `src/components/search-engine.tsx` 的巡航状态 UI 修复
- 自动化测试与可执行验证证据

### Definition of Done (verifiable conditions with commands)
- 缺失 LLM key/baseUrl/ICP 时，分析抽屉不再只显示 generic unavailable，而是显示精确配置指导或 dev mock 提示
- 生产环境下，无 `analysis_advanced` 权限仍 Fail-Closed
- `0/0` 不再作为默认巡航空状态显示
- 空队列、hydrating、state unavailable、cooldown、paused 等状态在 UI 中可区分
- dev shell 与 Electron dev 的行为差异被显式标注，不再产生误判
- 所有新增测试与既有相关测试通过

### Must Have
- 先改契约，再改 UI
- 所有用户可见文案保持简体中文
- 结构化语义优先于字符串正则猜测
- dev-only fallback 仅限 `!app.isPackaged`
- Autopilot 仍然是本地 Basic 能力，不上云

### Must NOT Have
- 不修改搜索排序算法、并发限制、三级降级协议
- 不修改授权/套餐/商业边界
- 不将 Autopilot 迁移到云端
- 不在 renderer 端用英文关键字继续推断错误类型
- 不把 unscored lead 解释成 `0`
- 不让 packaged runtime 使用 dev mock

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + Node/Electron integration + Playwright/UI checks where needed
- QA policy: Every task has agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
Wave 1: 契约与主进程语义（1-4）
Wave 2: Store/UI 与测试验证（5-8）

### Dependency Matrix
- 1 blocks 2,3,4,5,6,7,8
- 2 blocks 4,5,7,8
- 3 blocks 5,6,7,8
- 4 blocks 7,8
- 5 blocks 7,8
- 6 blocks 8
- 7 blocks 8

### Agent Dispatch Summary
- Wave 1 → 4 tasks → deep / unspecified-high / quick
- Wave 2 → 4 tasks → quick / visual-engineering / unspecified-high / deep
- Final Verification → 4 tasks → oracle / unspecified-high / deep

## TODOs

- [ ] 1. 冻结分析与巡航的语义契约

  **What to do**: 在动任何 UI 之前，先在 `src/shared/ipc-contracts.ts` 中定义两套明确语义：
  1) 分析链路错误/降级语义；
  2) 巡航状态/空态/不可用语义。  
  具体决策如下：
  - 分析最小语义集：`missing_llm_key`, `missing_llm_base_url`, `missing_icp_profile`, `provider_timeout`, `provider_unavailable`, `invalid_scenario`, `insufficient_lead_data`, `dev_mock_active`
  - 巡航最小语义集：`hydrating`, `ready_empty`, `queued_idle`, `running`, `paused`, `cooldown`, `completed`, `error`, `state_unavailable`, `environment_mock`
  - `0/0` 不是合法语义，只能是旧渲染副产物，实施后必须被替换成文本状态
  - 对 analysis：推荐保持 `success:false` 用于 blocked generation，但同时返回机器可读语义字段
  - 对 autopilot state：推荐返回 richer envelope，而不是裸 `null`
  **Must NOT do**: 不要在没有共享类型之前直接在组件里写魔法字符串分支；不要新增与当前问题无关的 IPC 类型。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 契约冻结是全任务根基。
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - 当前先不是 UI 设计问题

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2-8 | Blocked By: none

  **References**:
  - Report: `.sisyphus/plans/intelligent-acquisition-deep-audit.md`
  - Pattern: `src/lib/electron-api.ts:150-154` - 当前 analysis wrapper 只认 success/error
  - Pattern: `src/components/analysis-drawer.tsx:16-23` - 当前前端靠字符串正则分类错误
  - Pattern: `src/store/autopilot-store.ts:28-45` - 当前 runtime 只有 totals/lifecycle 无状态语义层
  - Pattern: `src/components/search-engine.tsx:1363-1366` - 当前 0/0 的直接渲染点

  **Acceptance Criteria**:
  - [ ] 共享类型文件中存在明确的 analysis 语义枚举/联合类型
  - [ ] 共享类型文件中存在明确的 autopilot stateKind 语义枚举/联合类型
  - [ ] 后续任务不需要再自行决定状态名/字段名

  **QA Scenarios**:
  ```
  Scenario: Contract types are frozen
    Tool: Bash
    Steps: 1) Read src/shared/ipc-contracts.ts 2) verify analysis semantic categories and autopilot stateKind categories exist exactly as planned
    Expected: No TODO-style placeholders remain; all target categories are concretely declared
    Evidence: .sisyphus/evidence/task-1-contract-freeze.txt

  Scenario: No UI-first drift
    Tool: Bash
    Steps: 1) Inspect modified files 2) confirm shared contracts were changed before/with renderer branching changes
    Expected: Renderer does not invent categories absent from shared types
    Evidence: .sisyphus/evidence/task-1-contract-drift-check.txt
  ```

  **Commit**: NO | Message: `refactor(ipc): define analysis and autopilot semantic contracts` | Files: `src/shared/ipc-contracts.ts`

- [ ] 2. 修复 analysis:generate 主进程语义

  **What to do**: 修改 `electron/services/search-service.ts` 中 `analysis:generate` handler 的失败/降级返回语义：
  - 不再只返回泛化字符串
  - 对以下情况返回精确 machine-readable category：
    - 缺失 LLM key
    - 缺失 LLM baseUrl
    - 缺失 ICP profile
    - provider timeout
    - provider unavailable
    - invalid scenario
    - insufficient lead data
  - 保持 production 下 feature/license 守卫不变
  - reply_coach 与普通策略分析共用同一错误语义表，但可有不同文案映射
  **Must NOT do**: 不要放宽 `analysis_advanced` 权限；不要把 provider 失败假装成成功结果。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需要稳住主进程真实语义且避免破坏现有链路。
  - Skills: []
  - Omitted: [`ai-slop-remover`] - 非必要

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 4,5,7,8 | Blocked By: 1

  **References**:
  - Pattern: `electron/services/search-service.ts:1672-1805`
  - Pattern: `src/components/analysis-drawer.tsx:16-23,224-242,326-344`
  - Pattern: `src/lib/electron-api.ts:150-154`

  **Acceptance Criteria**:
  - [ ] analysis handler 对配置缺失与 provider 故障返回不同的 machine-readable semantics
  - [ ] generic unavailable 不再是所有错误的统一最终语义
  - [ ] production Fail-Closed 未被改变

  **QA Scenarios**:
  ```
  Scenario: Missing LLM key yields typed config error
    Tool: node --test
    Steps: 1) Run integration test with analysis_advanced access enabled and no LLM key 2) invoke analysis IPC with valid lead + scenario
    Expected: success=false with semantic category 'missing_llm_key'; no generic catch-all only response
    Evidence: .sisyphus/evidence/task-2-missing-key.txt

  Scenario: Provider timeout yields retryable semantic
    Tool: node --test
    Steps: 1) Stub analysis provider timeout 2) invoke analysis IPC
    Expected: success=false with semantic category 'provider_timeout' and retry-oriented message
    Evidence: .sisyphus/evidence/task-2-provider-timeout.txt
  ```

  **Commit**: NO | Message: `fix(analysis): add typed failure semantics to analysis IPC` | Files: `electron/services/search-service.ts`, `src/shared/ipc-contracts.ts`

- [ ] 3. 决定并实现 dev-only main-process analysis mock fallback

  **What to do**: 在 `electron/services/search-service.ts` 为真实 Electron dev 增加 dev-only analysis fallback，但只在以下条件同时满足时激活：
  - `!app.isPackaged`
  - feature/license 检查已通过
  - 缺失 LLM key/baseUrl/ICP 等本地分析前置配置
  - 仅用于本地分析能力，绝不用于 cloud/team/premium remote 能力
  具体行为：
  - 返回与正式 `AnalysisGenerateData` 对齐的逼真假结果
  - 标记：`mockMode: true`, `source: 'dev_mock'`, `usedFallback: true`, `degraded: true`, `degradedReason: ...`
  - 内容素材基于 `company/snippet/website/scenario/customerText`
  - 默认建议：**启用此 fallback**，因为报告已确认 dev shell 与真实 Electron dev 行为不一致
  **Must NOT do**: 不得在 packaged 下启用；不得跨入 cloud_send / team 协作路径；不得输出无标记的伪真结果。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 这是开发体验与商业边界之间的敏感平衡点。
  - Skills: []
  - Omitted: [`review-work`] - 统一在最终验证波执行

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 5,7,8 | Blocked By: 1

  **References**:
  - Pattern: `src/main.tsx:29-93,219-232` - 现有 dev shell mock 分析逻辑
  - Pattern: `electron/services/search-service.ts:1672-1805`
  - Guardrail: `.sisyphus/plans/intelligent-acquisition-deep-audit.md` -> Dev-Only Mock Fallback Design

  **Acceptance Criteria**:
  - [ ] 真实 Electron dev 下缺失 LLM 配置时可返回结构化 dev mock 结果
  - [ ] packaged 下绝不进入 dev mock 分支
  - [ ] UI 能识别并显示 dev mock 提示

  **QA Scenarios**:
  ```
  Scenario: Electron dev returns analysis mock payload
    Tool: node --test
    Steps: 1) Mock app.isPackaged=false with missing AI config 2) invoke analysis IPC
    Expected: success=true or agreed degraded payload containing mockMode=true/source=dev_mock and realistic content fields
    Evidence: .sisyphus/evidence/task-3-dev-mock-analysis.txt

  Scenario: Packaged runtime does not use dev mock
    Tool: node --test
    Steps: 1) Mock app.isPackaged=true with missing AI config 2) invoke analysis IPC
    Expected: no dev_mock markers; remains fail-closed/typed config failure
    Evidence: .sisyphus/evidence/task-3-prod-no-mock.txt
  ```

  **Commit**: NO | Message: `feat(analysis): add dev-only main-process mock fallback` | Files: `electron/services/search-service.ts`, `src/shared/ipc-contracts.ts`

- [ ] 4. 适配前端 analysis wrapper 与抽屉展示

  **What to do**: 更新 `src/lib/electron-api.ts` 与 `src/components/analysis-drawer.tsx`（以及必要时 `src/components/leads-management.tsx`）以消费结构化 analysis 语义：
  - 停止只靠文本正则判断配置问题
  - 对 config 缺失显示设置引导
  - 对 provider timeout/unavailable 显示重试型文案
  - 对 `mockMode=true` 显示 amber/非致命提示
  - cached path 继续优先命中缓存，不应受新错误语义影响
  **Must NOT do**: 不要破坏 reply_coach 缓存逻辑；不要把 cached path 误判为错误态。

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 渲染适配集中，但必须严格跟随契约。
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - 无需视觉重做，只需语义对齐

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 7,8 | Blocked By: 1,2,3

  **References**:
  - Pattern: `src/lib/electron-api.ts:150-154`
  - Pattern: `src/components/analysis-drawer.tsx:16-23,190-260,315-372`
  - Pattern: `src/components/leads-management.tsx:455`

  **Acceptance Criteria**:
  - [ ] 缺配置时不再只显示 generic unavailable
  - [ ] dev mock 结果有明显但非阻断提示
  - [ ] cached analysis 路径保持工作且不触发新错误分支

  **QA Scenarios**:
  ```
  Scenario: Drawer shows config-guidance banner
    Tool: Playwright
    Steps: 1) Open analysis drawer with missing LLM config 2) trigger generate
    Expected: Banner/toast includes system-settings guidance and does not show generic unavailable as sole output
    Evidence: .sisyphus/evidence/task-4-analysis-config-guidance.png

  Scenario: Cached analysis bypasses generation error path
    Tool: Playwright
    Steps: 1) Seed a lead with analysisCache 2) open drawer 3) request same scenario
    Expected: UI shows cached content and no failure banner
    Evidence: .sisyphus/evidence/task-4-analysis-cache.png
  ```

  **Commit**: NO | Message: `fix(ui): render structured analysis error and mock states` | Files: `src/lib/electron-api.ts`, `src/components/analysis-drawer.tsx`, `src/components/leads-management.tsx`

- [ ] 5. 契约化巡航状态读取与 hydration 语义

  **What to do**: 修改 `electron/services/autopilot-state-service.ts` 与 `src/store/autopilot-store.ts`，使巡航状态读取不再以裸 `null` 暗示所有情况。具体决策如下：
  - `file missing / blank` => `ready_empty`
  - `read/parse error` => `state_unavailable`
  - persisted running on relaunch => hydrate as `paused`（当前已有逻辑，保留并显式语义化）
  - `null` 不再直接作为 renderer 唯一输入语义
  - 丰富 envelope 至少包括：`stateKind`, `statusReason`, `source`, `runtime`, `jobs`
  **Must NOT do**: 不要引入与云端相关的状态字段；不要改变 Autopilot 本地执行边界。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 状态契约修复是巡航问题核心。
  - Skills: []
  - Omitted: [`dev-browser`] - 先修 store/IPC 语义

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 7,8 | Blocked By: 1,3

  **References**:
  - Pattern: `electron/services/autopilot-state-service.ts:17-91`
  - Pattern: `src/store/autopilot-store.ts:89-101,174-184,265-302,334-368`
  - Pattern: `electron/main.ts:173-180`

  **Acceptance Criteria**:
  - [ ] renderer 可区分 empty queue 与 state unavailable
  - [ ] hydration 中有明确语义而不是默认落回 0/0
  - [ ] relaunch 后 running persisted state 仍变成 paused，但语义可见

  **QA Scenarios**:
  ```
  Scenario: Missing state file becomes ready_empty
    Tool: node --test
    Steps: 1) Ensure autopilot state file absent 2) hydrate store/state bridge
    Expected: stateKind=ready_empty (or agreed empty semantic), not generic null ambiguity
    Evidence: .sisyphus/evidence/task-5-empty-state.txt

  Scenario: Corrupt state file becomes state_unavailable
    Tool: node --test
    Steps: 1) Seed invalid autopilot_state.json 2) hydrate
    Expected: stateKind=state_unavailable with explicit reason; not silent 0/0 empty queue
    Evidence: .sisyphus/evidence/task-5-corrupt-state.txt
  ```

  **Commit**: NO | Message: `fix(autopilot): add typed state hydration semantics` | Files: `electron/services/autopilot-state-service.ts`, `src/store/autopilot-store.ts`, `src/shared/ipc-contracts.ts`

- [ ] 6. 修复巡航 start / cooldown / panel 语义与 UI

  **What to do**: 更新 `src/components/search-engine.tsx` 与必要的 store/runner 逻辑，明确区分：
  - `hydrating`
  - `ready_empty`
  - `queued_idle`
  - `running`
  - `paused`
  - `cooldown`
  - `completed`
  - `error`
  - `state_unavailable`
  - `environment_mock`
  具体 UI 决策：
  - **禁止显示 `0 / 0`**
  - 空队列显示文本状态：`暂无待执行任务`
  - cooldown 必须可见，不能再像卡死
  - paused with pending jobs 不能再显示成“暂无执行中的任务”的假空闲
  - dev shell/main-process unavailable 要有明确 amber 提示
  **Must NOT do**: 不要只换文案而不补状态语义；不要把 empty 与 unavailable 混成一个态。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: 这是 UI 呈现 + 状态语义映射任务。
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - 可不单独调用，执行者直接实现即可

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8 | Blocked By: 1,5

  **References**:
  - Pattern: `src/components/search-engine.tsx:401-421,688-720,1017-1048,1352-1416`
  - Pattern: `src/lib/autopilot-runner.ts:25-39,296-360`
  - Report: `.sisyphus/plans/intelligent-acquisition-deep-audit.md` -> Issue B

  **Acceptance Criteria**:
  - [ ] `0 / 0` 不再出现在默认巡航面板中
  - [ ] 空队列、hydrating、paused、cooldown、state unavailable 都有可区分状态
  - [ ] start 失败原因可见，不再表现成“未响应”

  **QA Scenarios**:
  ```
  Scenario: Empty queue shows text-first state
    Tool: Playwright
    Steps: 1) Open search page with autopilot empty state 2) inspect panel
    Expected: No '0 / 0'; shows '暂无待执行任务' or approved empty-state copy
    Evidence: .sisyphus/evidence/task-6-autopilot-empty.png

  Scenario: Cooldown is visible and not mistaken for freeze
    Tool: node --test + Playwright
    Steps: 1) Simulate 429/rate-limit path 2) let job enter cooldown 3) inspect panel
    Expected: Panel shows cooldown/retrying semantics, not empty or frozen state
    Evidence: .sisyphus/evidence/task-6-autopilot-cooldown.txt
  ```

  **Commit**: NO | Message: `fix(ui): clarify autopilot progress and empty states` | Files: `src/components/search-engine.tsx`, `src/store/autopilot-store.ts`, optionally `src/lib/autopilot-runner.ts`

- [ ] 7. 补充分析与巡航的自动化测试矩阵

  **What to do**: 新增/扩展测试，覆盖以下最小矩阵：
  - analysis missing key -> typed config guidance
  - analysis provider timeout -> retryable semantic
  - analysis cached path -> cache read path still works
  - analysis packaged no auth -> fail-closed
  - autopilot missing state file -> ready_empty
  - autopilot corrupt state file -> state_unavailable
  - autopilot relaunch after running -> paused semantics
  - autopilot local-only guard -> 不触发 cloud/automation remote 路径
  **Must NOT do**: 不要只跑一个 happy path；不要用人工目测替代测试；不要依赖字符串猜测没有更新的旧语义。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 跨 renderer/main/store，需要综合测试设计。
  - Skills: []
  - Omitted: [`review-work`] - 最终验证波统一执行

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8 | Blocked By: 2,3,4,5,6

  **References**:
  - Test patterns: `tests/env-isolation.test.ts`, `tests/dev-feature-bypass.test.js`, `tests/license-gateway.test.js`
  - Analysis path: `src/components/analysis-drawer.tsx`, `electron/services/search-service.ts`
  - Autopilot path: `src/store/autopilot-store.ts`, `electron/services/autopilot-state-service.ts`, `src/components/search-engine.tsx`

  **Acceptance Criteria**:
  - [ ] 至少覆盖 analysis 4 个关键分支与 autopilot 4 个关键分支
  - [ ] 本地 Basic/开发链路与 packaged fail-closed 都被验证
  - [ ] 证据输出能明确区分环境伪阳性与真实 Electron 链路

  **QA Scenarios**:
  ```
  Scenario: Analysis semantics matrix passes
    Tool: Bash
    Steps: 1) Run targeted node --test files for analysis semantics 2) capture outputs
    Expected: Missing-key/config/mock/timeout/auth branches all match agreed semantics
    Evidence: .sisyphus/evidence/task-7-analysis-matrix.txt

  Scenario: Autopilot semantics matrix passes
    Tool: Bash
    Steps: 1) Run targeted node --test files for autopilot state/hydration/start/cooldown 2) capture outputs
    Expected: No ambiguous null-only or 0/0 default semantics remain in verified states
    Evidence: .sisyphus/evidence/task-7-autopilot-matrix.txt
  ```

  **Commit**: NO | Message: `test(interaction): cover analysis and autopilot semantics` | Files: `tests/...`

- [ ] 8. 运行 build / diagnostics / end-to-end verification

  **What to do**: 在所有实现完成后，运行 diagnostics、Electron build 和测试矩阵，并对关键 UI 行为做 agent-executed 验证。验证顺序固定为：
  1. `lsp_diagnostics` for touched files
  2. `npm run build:electron:dev`
  3. targeted `node --test ...` suites
  4. 如有需要，Playwright 验证分析抽屉与巡航面板状态表现
  **Must NOT do**: 不要跳过 diagnostics；不要只靠单个命令宣称完成；不要忽略 packaged fail-closed 负向测试。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 最终验证需要整合全部改动面。
  - Skills: []
  - Omitted: [`git-master`] - 非提交阶段

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Final Verification Wave | Blocked By: 2,3,4,5,6,7

  **References**:
  - `package.json` 现有测试/构建脚本
  - 本计划前 7 任务涉及的全部文件

  **Acceptance Criteria**:
  - [ ] Touched files diagnostics clean
  - [ ] `npm run build:electron:dev` 成功
  - [ ] 新旧相关测试全部通过
  - [ ] analysis 与 autopilot 的关键 UI 状态有自动化证据

  **QA Scenarios**:
  ```
  Scenario: Full interaction verification passes
    Tool: Bash
    Steps: 1) run diagnostics 2) run npm run build:electron:dev 3) run targeted node --test suites
    Expected: all commands exit 0
    Evidence: .sisyphus/evidence/task-8-full-verification.txt

  Scenario: UI state verification passes
    Tool: Playwright
    Steps: 1) open target views 2) trigger missing-config analysis case and empty/cooldown autopilot states
    Expected: UI matches agreed semantic states and does not regress to generic unavailable / 0/0
    Evidence: .sisyphus/evidence/task-8-ui-verification.png
  ```

  **Commit**: NO | Message: `test(interaction): verify analysis and autopilot state contracts` | Files: tests and evidence only

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- 优先按“contracts → main-process semantics → renderer/store adapter → UI → tests”组织提交。
- 若仅一个提交，建议：`fix(interaction): add typed analysis and autopilot state semantics`
- 禁止提交无关格式化噪音。

## Success Criteria
- 分析抽屉可稳定区分配置缺失、provider 异常、dev mock、权限拒绝
- 真实 Electron dev 无 key 时分析链路可降级，不再只有 generic unavailable
- packaged 下 analysis 仍 Fail-Closed
- 巡航面板不再默认显示 `0/0`
- 空队列、hydrating、cooldown、paused、state unavailable、environment mock 都可区分
- Autopilot 仍保持本地 Basic 能力，不触发 cloud/premium 行为
