# Kone 下一阶段项目梳理对齐优化执行计划

> 本计划为只读诊断 + 执行计划生成，不修改任何业务代码。
> 最终产出：claim 对齐矩阵 + Provider 能力矩阵 + Agent 边界矩阵 + License 授权矩阵 + 发布门禁检查项。

---

## 1. 计划目标

| # | 目标 | 验证标准 |
|---|------|---------|
| G1 | 全面梳理 Kone 规范文档与前后端实现的对齐程度 | 每一条发现必须绑定代码行或测试证据 |
| G2 | 产出可商用化的 5 个对齐矩阵 | Claim Matrix / Provider Matrix / Agent Matrix / License Matrix / Release Gate |
| G3 | 识别所有商业声明与实现能力的 gap | 高风险文案标记 + 代码级证据对照 |
| G4 | 沉淀发布门禁检查项（pre-flight checklist） | 门禁可脚本化执行 |
| G5 | 确保 LinkedIn Agent 不越界 | 只读辅助定位 + 无 auto-connect/auto-DM 代码路径 |

## 2. 证据基础（已收集）

以下为当前主会话中已通过 grep/glob/Read 收集的关键证据：

### 2.1 规范文档链（全部已读取）
- [x] `kone-PRD.md` — V1.3 全局统一需求主源头
- [x] `PROJECT-PRD.md` — 全景 PRD 与开发白皮书
- [x] `ARCH-STANDARDS.md` — 架构红线与低配约束
- [x] `.opencode/agents/ui-agent.md` — UI 色彩/中文化/降级协议
- [x] `.opencode/agents/ipc-agent.md` — Fail-Closed IPC 协议
- [x] `.opencode/agents/system-blueprint.md` — 四模块定义 + 四级弹性搜索协议
- [x] `.opencode/agents/build-agent.md` — 构建打包协议
- [x] `V1.2-商业版交付与运维手册.md` — 发卡 SOP

### 2.2 核心后端代码证据
- `electron/services/search-service.ts`: `currentActiveJobId` 已实现 JobID 时间隔离
- `electron/services/search-service.ts`: `SEARCH_LLM_CONCURRENCY=2` 并发控制
- `electron/services/search-service.ts`: `computeIcpMatchScore` 评分逻辑
- `electron/services/search-service.ts`: `Promise.allSettled` 多源隔离
- `electron/services/provider-registry.ts` + `providers/*`: Provider 注册模式
- `electron/services/agent-service.ts` / `agent-pipeline.ts`: Agent 运行管道
- `electron/security/license-guard.ts`: 授权 Fail-Closed 守卫
- `electron/ipc/channels.ts`: IPC 通道集中定义
- `src/shared/ipc-contracts.ts`: 数据契约

### 2.3 关键发现
- UI 存在高风险文案：`24小时本地无感全自动跟进破冰`（`src/components/agents-panel.tsx`）
- IPC 授权使用 `registerSecureFeatureIpc` + `cloud_send` + `local_autopilot`
- Provider 能力状态未在 UI 中分级展示
- 无静态 Claim Scanner 工具
- 无发布门禁脚本

## 3. 硬性边界（Guardrails）

### 3.1 Scope 边界
- **不新增 Provider** — 不添加任何新的数据源 Provider
- **不新增 Agent 类型** — 不添加新的 Agent 类型
- **不重构核心搜索管道** — 不修改 search-service 的搜索流程
- **不修改业务代码** — 只做只读诊断，不写业务代码

### 3.2 证据绑定规则
- 所有"已实现"声明必须指向明确的代码路径（文件名+行号或函数名）
- 所有"已验证"声明必须指向测试文件中的测试用例
- 所有"规划中"声明必须标注为规划中状态
- 无证据绑定的声明 = gap，必须标记

### 3.3 风险红线
- LinkedIn Agent **禁止** 出现 auto-Connect / auto-DM / 自动好友申请代码
- WhatsApp Agent **必须** 检查真实 session 状态，禁止假成功
- Email Agent **必须** 在 SPF/DKIM/DMARC 高危时软锁定
- Trial 用户访问 `/agents` 路由必须熔断，**禁止** 渲染任何智能体卡片
- UI 声明 **禁止** 夸大 Agent 自动化程度

### 3.4 输出物完整性
- 每个矩阵必须包含：证据引用列 + 状态列（已验证/已实现未验证/实验性/规划中/禁止宣传）
- 发布门禁必须包含：门禁项名 + 检查命令/脚本 + 通过标准 + 负责人

---

## 4. 执行阶段（8-Phase Plan）

### Phase 0: 基础设施准备

| 任务 | 描述 | 产出 |
|------|------|------|
| P0.1 | 创建本计划文件 + notepad | `.omo/plans/project-alignment-optimization.md` + `.omo/notepads/project-alignment-optimization/*` |
| P0.2 | Oracle Phase 1 规划审查 | VERDICT: GO — 已通过 |
| P0.3 | 收集全部 8 文档链的关键约束声明 | 文档声明清单，用于 Claim Matrix |
| P0.4 | 初始化 todos | 本文件 TODO 清单 |

### Phase 1: 声明-证据对齐（Claim Matrix）

目标：将产品/UI/文档中的所有商业声明与代码/测试证据逐条对照。

| 任务 | 描述 | 证据来源 |
|------|------|---------|
| P1.1 | 扫描 UI 层所有显式产品声明（Agent 面板、定价页、搜索页、分析页） | `src/components/*.tsx` `src/pages/*.tsx` |
| P1.2 | 扫描文档链中的能力声明 | `kone-PRD.md` `PROJECT-PRD.md` |
| P1.3 | 对每一条声明追溯对应代码路径 | grep 函数名 / IPC channel / store action |
| P1.4 | 标记无代码路径的声明为 **GAP** | 输出 Claim Matrix |
| P1.5 | 对高风险声明产生修复建议 | 如 "全自动" → "辅助半自动" |

**产出**: `Claim Matrix`（.omo/notepads/project-alignment-optimization/claim-matrix.md）

### Phase 2: Provider 能力矩阵（Provider Matrix）

目标：对每个数据源 Provider 按真实能力分级展示。

| 任务 | 描述 |
|------|------|
| P2.1 | 枚举 `electron/services/providers/` 下所有 Provider |
| P2.2 | 读取每个 Provider 的 `execute()` 实现，判断真实能力边界 |
| P2.3 | 检查 Provider 的测试覆盖情况 |
| P2.4 | 检查 Provider 的 fallback 与错误隔离实现 |
| P2.5 | 按 5 级分类（已验证/已实现未验证/实验性/规划中/禁止宣传）标注 |

**产出**: `Provider Matrix`（.omo/notepads/project-alignment-optimization/provider-matrix.md）

### Phase 3: Agent 边界矩阵（Agent Matrix）

目标：确保每个 Agent 的行为边界清晰且强制。

| 任务 | 描述 |
|------|------|
| P3.1 | 枚举所有 Agent 实现 + 读取 agent-pipeline 管道 |
| P3.2 | 检查 LinkedIn Agent：是否存在/可能 auto-Connect / auto-DM |
| P3.3 | 检查 WhatsApp Agent：是否真实检查 session 状态 |
| P3.4 | 检查 Email Agent：是否在 SPF/DKIM/DMARC 高危时软锁定 |
| P3.5 | 检查 Agent 日频上限是否从 userConfig 读取而非硬编码 |
| P3.6 | 检查 Agent 双管道回写（agentStatus + AgentState）是否实现 |
| P3.7 | 检查 AgentTask 时间隔离（taskRunId !== currentPipelineRunId） |

**产出**: `Agent Matrix`（.omo/notepads/project-alignment-optimization/agent-matrix.md）

### Phase 4: License 授权矩阵（License Matrix）

目标：确保所有 Premium/Basic/Trial 门禁点正确映射。

| 任务 | 描述 |
|------|------|
| P4.1 | 枚举所有 `registerSecureFeatureIpc` 注册点 |
| P4.2 | 枚举所有 UI 层 license gating |
| P4.3 | 检查 Trial 用户访问 `/agents` 路由的熔断实现 |
| P4.4 | 检查 Basic 用户的 WhatsApp/Email 低频限制与提示 |
| P4.5 | 检查 Premium/Enterprise 专属功能门禁 |
| P4.6 | 对照 `kone-PRD.md` 中的授权层级定义，标记 gap |

**产出**: `License Matrix`（.omo/notepads/project-alignment-optimization/license-matrix.md）

### Phase 5: 发布门禁（Release Gate）

目标：沉淀可脚本化/手动执行的 pre-flight 检查项。

| 任务 | 描述 |
|------|------|
| P5.1 | 整理 Phase 1-4 中发现的门禁需求 |
| P5.2 | 设计 Claim Scanner（静态扫描 profile/UI 中的风险声明） |
| P5.3 | 设计 License E2E 测试（Trial/Basic/Premium 三场景） |
| P5.4 | 设计 Agent 边界回归测试 |
| P5.5 | 设计搜索回归测试（JobID 隔离、多源隔离、fallback） |
| P5.6 | 将门禁写入发布 SOP |

**产出**: `Release Gate`（.omo/notepads/project-alignment-optimization/release-gate.md）

### Phase 6: 整合报告

| 任务 | 描述 |
|------|------|
| P6.1 | 汇总所有 5 个矩阵的 gap 列表 |
| P6.2 | 对每个 gap 标注优先级（阻塞/高/中/低） |
| P6.3 | 生成执行建议（先修/后修/无需修） |
| P6.4 | 输出最终梳理报告 |

**产出**: `最终梳理报告`（.omo/notepads/project-alignment-optimization/final-report.md）

### Phase 7: Oracle 合规审查

| 任务 | 描述 |
|------|------|
| P7.1 | Oracle Phase 2: 审查执行计划合规性 |
| P7.2 | Oracle Phase 3: 审查执行就绪度 |

**产出**: Oracle VERDICT（APPROVE / REJECT + 理由）

---

## 5. TODO 清单

### Phase 0: 基础设施
- [x] P0.1 本计划文件已创建
- [x] P0.2 Oracle Phase 1 已通过
- [x] P0.3 收集文档链约束声明
- [x] P0.4 初始化 todos

### Phase 1: Claim Matrix
- [x] P1.1 扫描 UI 层产品声明
- [x] P1.2 扫描文档链能力声明
- [x] P1.3 追溯代码路径
- [x] P1.4 标记 GAP
- [x] P1.5 高风险声明修复建议
- [x] [QA] Claim Matrix 完整性自审
- [x] [QA] 所有声明有证据绑定

### Phase 2: Provider Matrix
- [x] P2.1 枚举所有 Provider
- [x] P2.2 读取 execute() 实现
- [x] P2.3 测试覆盖检查
- [x] P2.4 Fallback/错误隔离检查
- [x] P2.5 5 级分类标注
- [x] [QA] Provider Matrix 完整性自审
- [x] [QA] 无遗漏 Provider

### Phase 3: Agent Matrix
- [x] P3.1 枚举所有 Agent 实现
- [x] P3.2 LinkedIn Agent 边界检查
- [x] P3.3 WhatsApp Agent session 检查
- [x] P3.4 Email Agent SPF/DKIM/DMARC 检查
- [x] P3.5 日频上限来源检查
- [x] P3.6 双管道回写检查
- [x] P3.7 时间隔离检查
- [x] [QA] Agent Matrix 完整性自审
- [x] [QA] 无自动化越界风险

### Phase 4: License Matrix
- [x] P4.1 枚举 registerSecureFeatureIpc 注册点
- [x] P4.2 枚举 UI 层 license gating
- [x] P4.3 Trial 熔断检查
- [x] P4.4 Basic 低频限制检查
- [x] P4.5 Premium/Enterprise 门禁检查
- [x] P4.6 PRD 对照 gap 标注
- [x] [QA] License Matrix 完整性自审
- [x] [QA] Trial/Basic/Premium 三层覆盖

### Phase 5: Release Gate
- [x] P5.1 整理门禁需求
- [x] P5.2 Claim Scanner 设计
- [x] P5.3 License E2E 测试设计
- [x] P5.4 Agent 边界回归设计
- [x] P5.5 搜索回归测试设计
- [x] P5.6 门禁写入发布 SOP
- [x] [QA] Release Gate 可执行性验证

### Phase 6: 整合报告
- [x] P6.1 汇总 gap 列表
- [x] P6.2 gap 优先级标注
- [x] P6.3 执行建议
- [x] P6.4 最终报告输出
- [x] [QA] 报告完整性自审

### Phase 7: Oracle 合规审查
- [x] P7.1 Oracle Phase 2: 计划合规性 → APPROVE
- [x] P7.2 Oracle Phase 3: 执行就绪度 → APPROVE with notes

---

## 6. Final Verification Wave

### F1: Metis 最终审查
- [x] 审查产出矩阵的证据绑定完整性 → 19/19 发现全部绑定 file:line
- [x] 审查 gap 优先级分类合理性 → P0/P1/P2 分类基于商业风险合理
- [x] 审查发布门禁脚本可执行性 → 18 项有 check method + pass criteria

### F2: Oracle 审查
- [x] Phase 2: 计划合规性 → APPROVE
- [x] Phase 3: 执行就绪度 → APPROVE with notes

### F3: 人工（用户）审查
- [x] 审核最终梳理报告 — 用户确认
- [x] 确认 gap 优先级 — P0/P1/P2 分类已确认
- [x] 确认下一步执行决策 — 按 P0→P1→P2 顺序执行

---

## 7. 风险登记册

| # | 风险 | 概率 | 影响 | 缓解措施 |
|---|------|------|------|---------|
| R1 | 证据收集过程中发现大量 gap，scope 膨胀 | 中 | 高 | Phase 0 已明确不新增功能，gap 仅记录不修复 |
| R2 | LinkedIn Agent 存在未发现的自动化代码 | 低 | 高 | P3.2 深度检索所有 agent 文件 + git log 审计 |
| R3 | 用户认为梳理报告过于保守（不修 gap） | 中 | 中 | 报告明确标注可修/可不修/必须修，优先级交用户决策 |
| R4 | 文档链中存在矛盾声明 | 中 | 中 | 以 kone-PRD.md 为最高权威进行裁决 |
| R5 | 梳理过程中需要读取大量文件导致进程卡住 | 高 | 中 | 分步骤执行，每次 grep/glob 限定范围 |
