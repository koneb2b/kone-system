# Kone 核心业务逻辑测试网 (Business-Logic Evals) 搭建计划

## TL;DR
> **Summary**: 在 `tests/business-logic/` 下建立一套只使用 Mock 数据、绝不直连外部 API 的核心业务逻辑评估测试网，专门固化 Kone 的 4 大护城河：三级搜索降级与过滤、低配 AI 引擎 HTML 去噪与 3000 字符红线、Autopilot Gold Filter、云端交接裁剪。
> **Deliverables**:
> - `tests/business-logic/` 目录下的业务逻辑评估测试套件
> - Search fallback / filtering evals
> - HTML cleanup / truncation evals
> - Autopilot Gold Filter evals
> - Cloud handoff slicing evals
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 3 → 5

## Context
### Original Request
- 先按 AGENTS.md 要求通读强制文档链。
- 当前任务只允许在 `tests/business-logic/` 下新建测试文件。
- 绝对禁止修改任何 `src/`、`electron/` 下的业务代码。
- 测试必须使用 Mock 数据，不直连外部 API。
- 需要对以下 4 大核心护城河做断言：
  1. **三级搜索降级与过滤**：触发 `location 400` 和 `localCount === 0`，验证 `search:stage` 二级/三级文案与 pre-filter 噪音剔除。
  2. **AI 引擎低配红线**：10000 字符脏 HTML 输入时，去噪并裁剪到 `<= 3000` 字符。
  3. **Autopilot Gold Filter**：模拟 80 / 50 / `undefined` 分数线索，仅高潜线索进入 `addLead`。
  4. **云端交接裁剪**：验证 `triggerN8nWorkflow` 的 `.slice()` 长度限制严格执行。

### Grounding Summary
- 已静默读取：`PROJECT-PRD.md`、`ARCH-STANDARDS.md`、`.opencode/agents/ui-agent.md`、`.opencode/agents/ipc-agent.md`、`.opencode/agents/system-blueprint.md`、`.opencode/agents/build-agent.md`、`V1.2-商业版交付与运维手册.md`、`.clinerules`、`AGENTS.md`。
- 已确认业务硬边界：
  - `三级弹性搜索协议` 是宪法级红线
  - 缺失 AI key 属于可恢复降级状态，但本次是业务逻辑评估，不是实现修复
  - 搜索评分/网站正文传给 LLM 之前必须去噪且 `<= 3000` 字符
  - Autopilot 只能保存过阈值高潜线索
  - 云端交接必须做字段白名单与严格 `.slice()` 裁剪
- 已确认可直接命中的关键代码事实：
  - `electron/services/search-service.ts`
    - `MAX_WEBSITE_TEXT_FOR_LLM = 3000`
    - `trimWebsiteTextForLlm(...)`
    - `maps-keyword-fallback` / `organic-fallback`
    - stage 文案：
      - `地图定位受限，正在尝试扩大识别范围...`
      - `未发现地图商户，已自动为您补位全局网页线索...`
    - 负向词包含 `body shop`, `mechanic`
  - `src/lib/autopilot-runner.ts`
    - `filterQualifiedResults(...)`
    - `addLead(...)` 保存链路
  - `electron/services/automation-service.ts`
    - `triggerN8nWorkflow(...)`
    - 各字段 `.slice()` 裁剪上限
- 已确认现有测试样板可复用：
  - `tests/mock-search-fallback.js`
  - `tests/e2e/fallback-routing.test.js`
  - `tests/e2e/403-social-fallback.test.js`
  - `tests/interaction-semantics.test.js`

### Evidence Gaps / Failed Background Tasks
- 两个 explore 任务失败，原因是 API key 无效。
- 本计划不依赖这些失败任务，改为完全基于：
  - 本地 `grep/read` 直接证据
  - Oracle 风险审查
  - Metis 结构补强
- 因此计划中的所有结论都已尽量落到可见代码路径，不使用未验证的远程调研结果。

### Metis Review (gaps addressed)
- 必须显式决定 **Autopilot 阈值比较语义**，否则实现者会在 `50` 是否通过上产生判断分歧。
- 必须区分 3 种测试接入方式：
  1. `dist-electron` 直接导入已导出 helper
  2. 通过 compiled handler harness 间接测试 private logic
  3. 对 `src/lib/autopilot-runner.ts` 使用 in-memory transpile harness
- 必须固定精确命令，而不是泛泛的 `npm test`
- 必须把中文 stage 文案、searchMode 值、slice 长度上限写成**精确断言**

## Work Objectives
### Core Objective
在不修改业务代码的前提下，为 Kone 的核心业务护城河建立一个 Mock-based business-logic eval suite，使未来任何回归都能被精确拦截，而不是靠人工追读代码或手工操作验证。

### Deliverables
- `tests/business-logic/search-fallback.business.test.js`
- `tests/business-logic/search-cleanup.business.test.js`
- `tests/business-logic/autopilot-gold-filter.business.test.js`
- `tests/business-logic/cloud-handoff.business.test.js`
- 必要时增加 `tests/business-logic/helpers/*`，但仍只限 tests 目录

### Definition of Done
- 4 大护城河都有独立 eval 套件
- 所有测试仅使用 Mock 数据与本地 stub，不访问真实外部 API
- 断言使用精确中文文案、精确 searchMode 值、精确长度上限
- `npm run build:electron:dev` 后可通过明确命令运行全部 business-logic evals
- 计划不给实现者留下任何关于接入方式、阈值语义、Mock 边界或验收命令的判断空间

### Must Have
- 仅新增 `tests/business-logic/` 文件
- 搜索回退测试同时覆盖 fallback routing 和 pre-filter 剔噪
- HTML 清洗测试必须检查去噪 + 长度上限
- Gold Filter 测试必须检查 saved leads、dropped leads、dedupe 行为
- 云端裁剪测试必须检查白名单字段与所有关键 `.slice()` 上限

### Must NOT Have
- 不修改 `src/` / `electron/`
- 不调用真实 SerpApi / LLM / Webhook / SMTP / Supabase
- 不依赖当前机器上的真实 secret/config/license
- 不使用 hashed `dist/assets` 前端构建产物测试业务逻辑
- 不把 vague “works correctly” 作为验收标准

## Test Access Strategy
### Mode A — Direct compiled-module import
适用于已导出 helper：
- `dist-electron/electron/services/search-service.js`
- 可直接命中：
  - `buildFallbackAwareMapsQuery`
  - `normalizeSearchResponseCandidates`
  - `resolveSerpSearchPlan`
- 用途：验证 fallback routing 与 normalized candidate shape

### Mode B — Compiled handler harness
适用于 private service logic，但能通过 exported registrar 间接触发：
- `registerSearchHandlers(...)`
- `registerAutomationHandlers(...)`
- 通过 `ipcMain.handle` map + mocked sender/fetch/dependencies 来命中 private logic
- 用途：
  - stage 文案
  - pre-filter 剔噪
  - triggerN8nWorkflow slicing

### Mode C — In-memory transpile harness
适用于 `src/lib/autopilot-runner.ts`，因为其目标逻辑在 renderer-side source 且 helper 私有：
- 使用 tests 内部 transpile/VM harness 加载 TS 源码
- Mock：
  - `searchExecute`
  - `useLeadsStore.getState().addLead`
  - `useAutopilotStore`
  - `mapSearchResultToLeadItem`
- 用途：验证 Gold Filter / targetLeads / dedupe / score threshold

## Critical Decision Lock
### Autopilot Threshold Comparator
用户给出的目标是：
- 分数：`80, 50, undefined`
- 默认阈值：`60`
- 只有“得分过阈值”的高潜线索被保存

本计划将阈值规则明确锁定为：
> **只接受 `score >= threshold` 的线索进入候选保存环节；`undefined` 必须丢弃。**

但你给出的示例里 `50` 在阈值 `60` 下本来就应被丢弃，因此当前计划的测试数据将采用：
- `80` → 保存
- `50` → 丢弃
- `undefined` → 丢弃
并额外加入：
- `60` → 是否保留需按**当前实现语义**明确验证

为了不让实现者产生歧义，计划要求：
- **主断言**：`80` 保存，`50` 和 `undefined` 丢弃
- **边界断言**：额外单测 `60`，明确记录当前实现是 `>= threshold` 还是 `> threshold`
- 若当前实现与预期不一致，测试应将其视为“业务规则差异待决”，而不是偷偷改写规则

## Execution Strategy
### Parallel Execution Waves
Wave 1: Search + HTML cleanup evals
Wave 2: Autopilot + cloud handoff evals

### Dependency Matrix
- 1 blocks 2, 3, 4
- 2 independent from 3,4 after build mode is fixed
- 3 independent from 2,4 after transpile harness is chosen
- 4 independent from 2,3 after automation handler harness is fixed

### Agent Dispatch Summary
- Wave 1 → 2 tasks → deep / quick
- Wave 2 → 2 tasks → deep / unspecified-high
- Final Verification → 4 tasks → oracle / unspecified-high / deep

## TODOs

- [ ] 1. 固定 business-logic eval 测试底座与运行前置

  **What to do**: 在计划中明确所有 business-logic eval 的统一前置：
  - 先执行 `npm run build:electron:dev`
  - Search/Cloud 相关测试从 `dist-electron` compiled module 读取，不直接执行 TS 源码
  - Autopilot 相关测试明确使用 `src/lib/autopilot-runner.ts` 的 in-memory transpile harness
  - 所有外部接口（fetch/webhook/LLM/SMTP/Supabase）必须用 mock/stub
  **Must NOT do**: 不要依赖 `npm test` 默认脚本；不要依赖真实 secrets/config。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 决定整个测试网的可执行形态。
  - Skills: []
  - Omitted: [`playwright`] - 与 UI 无关

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2,3,4 | Blocked By: none

  **References**:
  - `package.json:12,18-25`
  - `tests/mock-search-fallback.js`
  - `tests/e2e/fallback-routing.test.js`
  - `tests/interaction-semantics.test.js`

  **Acceptance Criteria**:
  - [ ] 计划中明确区分 compiled import / handler harness / transpile harness 三种模式
  - [ ] 计划中固定了 build 前置命令
  - [ ] 未给实现者留下“从哪里 import”或“是否可以直接跑源码”的判断题

  **QA Scenarios**:
  ```
  Scenario: Build prerequisite is explicit
    Tool: Bash
    Steps: 1) Read plan file 2) verify `npm run build:electron:dev` appears before any eval command
    Expected: No suite is specified to run against stale or unbuilt dist-electron output
    Evidence: .sisyphus/evidence/task-1-build-prereq.txt

  Scenario: Test access modes are explicit
    Tool: Bash
    Steps: 1) Read plan file 2) verify Mode A / Mode B / Mode C are all explicitly assigned to eval families
    Expected: Implementer can map each suite to a deterministic execution strategy
    Evidence: .sisyphus/evidence/task-1-access-modes.txt
  ```

  **Commit**: NO | Message: `test(business-logic): define eval harness strategy` | Files: `tests/business-logic/*`

- [ ] 2. 设计搜索降级与预筛业务断言套件

  **What to do**: 规划 `tests/business-logic/search-fallback.business.test.js` 与 `tests/business-logic/search-cleanup.business.test.js`，覆盖：
  - level-2 fallback：`location 400` → `maps-keyword-fallback`
  - level-3 fallback：`localCount === 0` → `organic-fallback`
  - 精确 stage 文案：
    - `地图定位受限，正在尝试扩大识别范围...`
    - `未发现地图商户，已自动为您补位全局网页线索...`
  - pre-filter 剔除：
    - `Downtown Body Shop`
    - `Quick Mechanic Service`
  - positive control 保留：
    - `Tokyo Battery Trading`
  **Must NOT do**: 不要只断言 searchMode，不断言中文文案；不要只断言剔除噪音，不设置正向保留对照组。

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 当前已有现成 fallback 测试模式，主要是系统化整理。
  - Skills: []
  - Omitted: [`dev-browser`] - 非 UI

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Final Verification | Blocked By: 1

  **References**:
  - `tests/mock-search-fallback.js`
  - `tests/e2e/fallback-routing.test.js`
  - `tests/e2e/403-social-fallback.test.js`
  - `electron/services/search-service.ts` 中 negative terms / stage 文案 / searchMode

  **Acceptance Criteria**:
  - [ ] level-2 与 level-3 fallback 均有精确文案断言
  - [ ] pre-filter 既有负向剔除，也有正向保留
  - [ ] 所有测试均使用 mock fetch/provider，不触发真实 API

  **QA Scenarios**:
  ```
  Scenario: Search fallback wording is exact
    Tool: Bash
    Steps: 1) Run node --test tests/business-logic/search-fallback.business.test.js
    Expected: TAP output passes and asserts exact stage messages plus exact searchMode values
    Evidence: .sisyphus/evidence/task-2-search-fallback.txt

  Scenario: Pre-filter removes noise and keeps valid dealer
    Tool: Bash
    Steps: 1) Run node --test tests/business-logic/search-cleanup.business.test.js
    Expected: body shop/mechanic candidates are filtered; Tokyo Battery Trading remains
    Evidence: .sisyphus/evidence/task-2-search-filter.txt
  ```

  **Commit**: NO | Message: `test(business-logic): add search downgrade and prefilter evals` | Files: `tests/business-logic/search-fallback.business.test.js`, `tests/business-logic/search-cleanup.business.test.js`

- [ ] 3. 设计低配 AI 引擎 HTML 去噪与 3000 字符红线套件

  **What to do**: 规划 `tests/business-logic/search-cleanup.business.test.js` 或独立 `html-truncate.business.test.js`，通过 handler harness 或 helper import 验证：
  - 10000 字符脏 HTML 输入
  - 含 `<script>` / `<style>` / nav/footer 噪音
  - 进入 LLM 前内容被去噪
  - 最终内容长度 `<= 3000`
  - 不保留明显 HTML tag 噪音
  - 当清洗后内容很弱时，仍保持 bounded fallback，而不是把原始脏 HTML 整段带入模型
  **Must NOT do**: 不要只测长度；必须同时测去噪效果。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需通过 private logic 的间接观测来证明 prompt assembly 合规。
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - 与 UI 无关

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Final Verification | Blocked By: 1

  **References**:
  - `electron/services/search-service.ts`
  - `MAX_WEBSITE_TEXT_FOR_LLM = 3000`
  - `trimWebsiteTextForLlm(...)`
  - `sanitizePlainText(...)`

  **Acceptance Criteria**:
  - [ ] 测试断言长度 `<= 3000`
  - [ ] 测试断言输出中无 `<script` / `<style` 等原始标签
  - [ ] 测试断言在极端脏 HTML 情况下仍为 bounded plain text

  **QA Scenarios**:
  ```
  Scenario: Dirty HTML is cleaned and capped
    Tool: Bash
    Steps: 1) Run node --test tests/business-logic/html-truncate.business.test.js
    Expected: Captured LLM-bound content is de-noised and length <= 3000
    Evidence: .sisyphus/evidence/task-3-html-truncate.txt

  Scenario: Noise-heavy page does not leak raw tags
    Tool: Bash
    Steps: 1) Run same suite with script/style/nav/footer heavy fixture
    Expected: No raw script/style tags remain in captured text payload
    Evidence: .sisyphus/evidence/task-3-html-denoise.txt
  ```

  **Commit**: NO | Message: `test(business-logic): add low-spec html cleanup evals` | Files: `tests/business-logic/html-truncate.business.test.js`

- [ ] 4. 设计 Autopilot Gold Filter 与云端交接裁剪套件

  **What to do**: 规划两套测试：

  **A. `tests/business-logic/autopilot-gold-filter.business.test.js`**
  - 使用 in-memory transpile harness 加载 `src/lib/autopilot-runner.ts`
  - Mock `searchExecute`, `useLeadsStore.getState().addLead`, `useAutopilotStore`, `mapSearchResultToLeadItem`
  - 样本包含：
    - `88`
    - `60`
    - `50`
    - `undefined`
    - duplicate 高分记录
  - 主断言：
    - `88` 保存
    - `50` 丢弃
    - `undefined` 丢弃
    - duplicate 不触发第二次 `addLead`
    - `targetLeads` cap 生效
  - 边界断言：`60` 的行为必须被精确记录，以锁定当前 comparator 语义

  **B. `tests/business-logic/cloud-handoff.business.test.js`**
  - 通过 `registerAutomationHandlers(...)` 间接命中 `triggerN8nWorkflow(...)`
  - mock license/trial 为 allowed
  - mock `safeFetch`
  - 验证所有关键字段 `.slice()` 上限：
    - company `<= 200`
    - country `<= 50`
    - contact `<= 100`
    - contact_title `<= 120`
    - phone `<= 80`
    - address `<= 240`
    - source `<= 120`
    - inferred_role `<= 120`
    - snippet `<= 500`
    - companyProfile `<= 800`
    - painPoints `<= 800`
    - valueMapping `<= 1000`
    - emailSubject `<= 200`
    - emailBody `<= 2400`
    - targetProduct `<= 500`
    - buyerPersona `<= 100`
    - coreAdvantage `<= 500`
    - negativeIcp `<= 300`
  - 同时验证：
    - `match_reasons <= 4`
    - `risk_flags <= 3`
    - 无 email leads 被剔除
    - placeholder webhook 路径不发起真实推送
  **Must NOT do**: 不要把 threshold 语义写死为未验证规则；不要直连真实 webhook。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 这两套都需要更强 test harness 设计。
  - Skills: []
  - Omitted: [`playwright`] - 与 UI 无关

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Final Verification | Blocked By: 1

  **References**:
  - `src/lib/autopilot-runner.ts`
  - `electron/services/automation-service.ts`
  - `tests/interaction-semantics.test.js`
  - `tests/dev-feature-bypass.test.js`

  **Acceptance Criteria**:
  - [ ] Autopilot suite 覆盖 score threshold、undefined drop、dedupe、targetLeads cap
  - [ ] Cloud handoff suite 覆盖 slice 上限、array caps、email filtering、placeholder webhook
  - [ ] 所有断言为精确长度/精确数量，而不是“差不多”

  **QA Scenarios**:
  ```
  Scenario: Gold Filter keeps only high-potential leads
    Tool: Bash
    Steps: 1) Run node --test tests/business-logic/autopilot-gold-filter.business.test.js
    Expected: Only threshold-qualified, non-duplicate leads trigger addLead; undefined score is dropped
    Evidence: .sisyphus/evidence/task-4-autopilot-filter.txt

  Scenario: Cloud handoff payload obeys slice caps
    Tool: Bash
    Steps: 1) Run node --test tests/business-logic/cloud-handoff.business.test.js
    Expected: Captured payload fields and arrays obey exact PRD slice caps and email filtering rules
    Evidence: .sisyphus/evidence/task-4-cloud-handoff.txt
  ```

  **Commit**: NO | Message: `test(business-logic): add autopilot and cloud handoff evals` | Files: `tests/business-logic/autopilot-gold-filter.business.test.js`, `tests/business-logic/cloud-handoff.business.test.js`

- [ ] 5. 固定执行命令与最终验证顺序

  **What to do**: 计划中固定最终运行顺序：
  1. `npm run build:electron:dev`
  2. `node --test tests/business-logic/search-fallback.business.test.js`
  3. `node --test tests/business-logic/search-cleanup.business.test.js`
  4. `node --test tests/business-logic/html-truncate.business.test.js`
  5. `node --test tests/business-logic/autopilot-gold-filter.business.test.js`
  6. `node --test tests/business-logic/cloud-handoff.business.test.js`
  或实现者可额外提供聚合入口：
  - `node --test tests/business-logic/*.test.js`
  **Must NOT do**: 不要依赖默认 `npm test`；不要用人工 eyeballing 验收。

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 这是收口任务，但必须精确到命令。
  - Skills: []
  - Omitted: [`dev-browser`] - 非 UI

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Final Verification | Blocked By: 2,3,4

  **References**:
  - `package.json`
  - 本计划前述 4 套 suite

  **Acceptance Criteria**:
  - [ ] 计划里列出所有精确命令
  - [ ] 计划里给出 process exit 0 / TAP ok 的明确通过标准
  - [ ] 计划中未给实现者留下命令命名或运行顺序判断题

  **QA Scenarios**:
  ```
  Scenario: Command sequence is explicit
    Tool: Bash
    Steps: 1) Read plan file 2) verify all business-logic eval commands are listed in order
    Expected: No hidden or implied command remains
    Evidence: .sisyphus/evidence/task-5-command-sequence.txt

  Scenario: Final pass criterion is explicit
    Tool: Bash
    Steps: 1) Read plan file 2) verify exit-0/TAP-ok expectations are stated
    Expected: Implementer knows exact success criteria for every suite
    Evidence: .sisyphus/evidence/task-5-pass-criteria.txt
  ```

  **Commit**: NO | Message: `test(business-logic): define eval execution order and acceptance` | Files: tests/evidence only

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- 推荐按“test harness mode → search evals → html cleanup evals → autopilot evals → cloud handoff evals → command wiring”组织提交。
- 若仅一个提交，建议：`test(business-logic): add core moat business-logic eval suites`
- 严禁提交任何 `src/` / `electron/` 业务代码改动。

## Success Criteria
- Kone 4 大核心护城河都获得独立、mock-only、可重复执行的 eval suite
- 测试可以在完全不直连外部 API 的情况下运行
- 关键中文文案、searchMode、长度上限、Gold Filter、slice 裁剪都被精确断言
- 所有工作保持在 `tests/business-logic/` 内，业务代码零改动
