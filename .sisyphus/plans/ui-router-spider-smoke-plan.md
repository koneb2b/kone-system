# 全站无头 UI 蜘蛛巡航测试搭建计划

## TL;DR
> **Summary**: 在 `tests/e2e-ui/` 下建立一套无头 UI 蜘蛛巡航烟雾测试，核心文件为 `router-spider.spec.ts`。测试将启动 Electron 应用，按左侧导航顺序巡航 7 大核心模块，并在每次跳转后执行“白屏猎手”断言：**无 ErrorBoundary 崩溃 UI，且成功渲染模块骨架锚点**。
> **Deliverables**:
> - `tests/e2e-ui/router-spider.spec.ts`
> - Electron 启动与导航通用 helper（如需要，仅放在 `tests/e2e-ui/`）
> - 7 大模块的骨架锚点映射表
> - DOM 稳定等待策略与失败截图/日志策略
> **Effort**: Medium
> **Parallel**: NO
> **Critical Path**: 1 → 2 → 3 → 4 → 5

## Context
### Original Request
- 当前任务仅限在 `tests/e2e-ui/` 下编写 UI 自动化脚本，严禁触碰 `src/`。
- 目标脚本：`router-spider.spec.ts`
- 框架：Playwright for Electron 或等效 Electron E2E 框架
- 巡航对象：
  1. 智能获客
  2. 数据中心
  3. 线索管理
  4. 知识库
  5. 系统设置
  6. 团队协作
  7. 自动化序列
- 核心断言：
  - 不允许出现 React `ErrorBoundary` 崩溃 UI
  - 页面必须渲染模块特有的基础骨架元素（标题/主面板/data-stage 等）

### Confirmed Facts Already Grounded
1. **导航入口在 `AppSidebar`**
   - 左侧导航由 `AppSidebar` 驱动，模块 id 已知：
     - `search`
     - `leads`
     - `data`
     - `knowledge`
     - `settings`
     - `team-dashboard`
     - `automation`
2. **崩溃由 `ErrorBoundary` 接管**
   - 崩溃 UI 有稳定文案，可作为全局负向断言：
     - `Something went wrong`
     - `Reload App`
     - `Kone Enterprise Recovery`
3. **页面具备骨架锚点 / 阶段锚点**
   - 已确认可用锚点类型：
     - `data-stage`
     - 页面标题
     - 主面板标题
     - PremiumAccessBlocked 文案（对 premium-only 模块尤为重要）

## Work Objectives
### Core Objective
建立一套可重复执行的 Electron UI smoke spider，用于在无头环境中快速证明：
- 基础导航切换不白屏
- 模块级懒加载不崩溃
- ErrorBoundary 未被触发
- 页面至少渲染到“骨架可见”级别

### Deliverables
- `tests/e2e-ui/router-spider.spec.ts`
- （可选）`tests/e2e-ui/helpers/electron-launch.ts`
- （可选）`tests/e2e-ui/helpers/router-assertions.ts`
- 7 大模块锚点清单
- 失败时的截图、控制台日志、页面 HTML 快照策略

### Definition of Done
- Electron 应用可由测试脚本稳定拉起
- 脚本可依次点击 7 大左侧导航入口
- 每次跳转后：
  - 未出现 ErrorBoundary 崩溃 UI
  - 出现该模块的正向骨架锚点
- premium 模块在当前授权状态下，允许两种通过方式：
  - 成功渲染真实模块骨架
  - 成功渲染 `PremiumAccessBlocked` 安全阻断骨架
- 测试失败时自动产出截图与日志证据

### Must Have
- 仅在 `tests/e2e-ui/` 下新增文件
- 使用无头自动化方式，不依赖人工点击
- 使用统一的“导航 → 等待 DOM 稳定 → 白屏猎手断言 → 骨架锚点断言”流程
- 每个模块都有唯一的正向锚点集合
- 每个模块失败时都能定位到具体模块名与失败阶段

### Must NOT Have
- 不修改 `src/` 任何代码
- 不要求增加测试专用 `data-testid` 到业务组件
- 不把 premium 阻断页误判为失败
- 不只做“URL 改变”断言
- 不只做“页面不空白”这种模糊断言

## Route Spider Architecture
### Test Runtime Strategy
- 推荐使用 **Playwright Electron** 模式启动应用
- 默认无头执行
- 启动入口建议基于当前开发/构建脚本选择：
  - 首选：拉起已构建好的 Electron 入口
  - 若仓库已有稳定 Electron 启动命令，则在计划实施时复用
- 测试必须等待主窗口 ready，再开始导航

### Core Flow
对 7 个模块逐一执行以下步骤：
1. 点击对应左侧导航按钮
2. 等待 DOM 稳定
3. 执行全局负向断言（白屏猎手）
4. 执行模块正向锚点断言
5. 记录成功/失败

### DOM Stability Policy
每次跳转后执行三段式等待：
1. 等待导航点击后的主容器稳定存在（例如 dashboard 外层容器）
2. 等待当前模块的候选骨架锚点之一出现
3. 对页面进行短暂稳定观察窗口（如 300-800ms），防止刚出现后立刻被崩溃态替换

不要只等固定 sleep；必须优先等待选择器/文本条件成立。

## White-Screen Hunter Assertions
### Negative Assertions (must always hold)
每次跳转后都必须断言页面中**不存在**以下崩溃信号：
- `Something went wrong`
- `Reload App`
- `Kone Enterprise Recovery`

### Positive Assertions (module-specific)
每个模块都必须命中至少一个正向锚点。

## Module Skeleton Anchor Matrix

### 1. 智能获客 (`search`)
**Primary anchors**:
- `data-stage="search"`
- `海外客户智能搜索`
- `智能获客工作台`
- `伴随式后台巡航`

**Pass condition**:
- 至少命中一个主锚点，且未出现 ErrorBoundary UI

### 2. 数据中心 (`data`)
**Primary anchors**:
- 页面标题：`数据中心`
- 副标题：`全面的业务数据分析与洞察`
- 模块文本：`正在加载数据中心...`
- 空态文本：`暂无线索数据`

**Pass condition**:
- 标题存在，且加载骨架/空态/主卡片之一存在

### 3. 线索管理 (`leads`)
**Primary anchors**:
- 页面标题：`线索管理`
- 副标题：`管理和跟踪所有客户线索`
- 空态文本：`暂无线索`

**Pass condition**:
- 标题存在，且空态或主列表区域可见

### 4. 知识库 (`knowledge`)
**Primary anchors**:
- 页面标题：`企业知识库`
- 按钮文本：`保存知识库`
- 加载文本：`正在加载知识库...`

**Pass condition**:
- `企业知识库` 或其加载骨架存在

### 5. 系统设置 (`settings`)
**Primary anchors**:
- `data-stage="settings"`
- 标题：`Kone 系统设置`
- 页面副标题：`API 密钥、搜索配置与账户管理`

**Pass condition**:
- `data-stage="settings"` 或标题存在

### 6. 团队协作 (`team-dashboard`)
**Primary anchors**:
- 页面标题：`团队协作看板`
- 副标题：`实时团队线索协同与防撞单管理`
- 阻断态标题：`团队协作看板暂未开放`
- 阻断组件：`PremiumAccessBlocked`

**Pass condition**:
- 若 premium 已开通：渲染真实团队模块骨架
- 若 premium 未开通：渲染 `团队协作看板暂未开放` 也算通过

### 7. 自动化序列 (`automation`)
**Primary anchors**:
- 页面标题：`智能触达工作流`
- 副标题：`客户清洗、模板配置与云端发送的协同引擎`
- 阻断态标题：`智能触达工作流暂未开放`

**Pass condition**:
- 若 premium 已开通：渲染真实自动化模块骨架
- 若 premium 未开通：渲染 `智能触达工作流暂未开放` 也算通过

## Navigation Selector Strategy
### Preferred selector source
使用 `AppSidebar` 已知选择器：
- `data-nav-id="search"`
- `data-nav-id="leads"`
- `data-nav-id="data"`
- `data-nav-id="knowledge"`
- `data-nav-id="settings"`
- `data-nav-id="team-dashboard"`
- `data-nav-id="automation"`

### Secondary fallback
若数据属性不稳定，可退回到可见文本：
- `智能获客`
- `线索管理`
- `数据中心`
- `知识库`
- `系统设置`
- `团队协作`
- `自动化序列`

但首选 `data-nav-id`，因为它比中文文案更稳。

## Failure Artifact Strategy
每个模块失败时必须自动采集：
- 当前页面截图
- 当前 URL / route state（若可见）
- 页面 HTML 片段或 `document.body.innerText`
- 控制台错误日志
- 失败模块名
- 失败阶段：
  - launch_failed
  - nav_click_failed
  - dom_not_stable
  - error_boundary_detected
  - anchor_missing

推荐 evidence 路径：
- `.sisyphus/evidence/ui-spider/<module>-failure.png`
- `.sisyphus/evidence/ui-spider/<module>-console.txt`
- `.sisyphus/evidence/ui-spider/<module>-dom.txt`

## Test File Structure Recommendation
### `tests/e2e-ui/router-spider.spec.ts`
建议结构：
1. Electron 启动封装
2. 全局崩溃文案断言 helper
3. DOM 稳定 helper
4. 导航点击 helper
5. 模块锚点表
6. 单个模块巡航函数
7. 总巡航用例

### Optional helper split
如文件过长，可拆为：
- `tests/e2e-ui/helpers/launch-electron.ts`
- `tests/e2e-ui/helpers/assert-no-crash.ts`
- `tests/e2e-ui/helpers/module-anchors.ts`

## Execution Strategy
### Step 1
搭建 Electron 启动与 page 获取 helper

### Step 2
实现通用“点击导航并等待稳定”逻辑

### Step 3
实现全局 ErrorBoundary 负向断言

### Step 4
实现 7 模块骨架锚点矩阵

### Step 5
在单个 smoke test 中串行巡航 7 模块并汇总结果

## Acceptance Criteria
- [ ] `tests/e2e-ui/router-spider.spec.ts` 存在
- [ ] 测试会拉起 Electron，而不是纯浏览器 shell
- [ ] 7 大模块全部被纳入巡航
- [ ] 每次导航后都执行 ErrorBoundary 负向断言
- [ ] 每次导航后都执行模块骨架锚点正向断言
- [ ] premium 模块支持“真实页或阻断页”双通过标准
- [ ] 失败时自动产出截图与日志证据

## QA Scenarios
```text
Scenario: Router spider covers all core modules
  Tool: Playwright for Electron
  Steps:
    1. Launch Electron app
    2. Click nav-search
    3. Click nav-data
    4. Click nav-leads
    5. Click nav-knowledge
    6. Click nav-settings
    7. Click nav-team-dashboard
    8. Click nav-automation
  Expected:
    - Every module transition settles without crash UI
    - Every module hits at least one module-specific anchor
  Evidence:
    .sisyphus/evidence/ui-spider/router-spider-summary.txt

Scenario: White-screen hunter catches ErrorBoundary fallback
  Tool: Playwright for Electron
  Steps:
    1. After each navigation, query page text for ErrorBoundary fallback markers
  Expected:
    - No page contains 'Something went wrong'
    - No page contains 'Reload App'
    - No page contains 'Kone Enterprise Recovery'
  Evidence:
    .sisyphus/evidence/ui-spider/error-boundary-scan.txt
```

## Guardrails
- 仅新增 `tests/e2e-ui/` 文件
- 不修改 `src/`
- 不要求新增 `data-testid`
- 不将 premium 阻断页判为失败
- 不用人工验收作为通过条件
- 不以“页面不报错”替代“页面有骨架锚点”

## Suggested Verification Commands
实现阶段建议执行：
- Electron 构建/启动所需命令（由执行者结合当前仓库现有脚本选择）
- Playwright/Electron 对应测试命令

本计划阶段不固定命令名，因为当前任务仅要求搭建计划书，不要求立即实现。

## Success Criteria
- Kone 获得一套可无头巡航全站核心模块的 UI smoke 网
- 每次导航都能自动猎杀 ErrorBoundary 崩溃态
- 每次导航都能验证该模块是否真正进入骨架可见态
- 后续模块扩展时，只需往锚点矩阵中追加，不必重写整套测试思路
