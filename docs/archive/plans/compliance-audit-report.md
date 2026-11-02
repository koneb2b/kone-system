# Kone V1.3 合规审计报告（完整版 — 含二次深度审查）

基于用户要求进行"全面深度梳理"：将 Phases A-H 所有产出物逐一与 8 份项目规范文档交叉对齐检查，识别隐患、风险及虚假执行。

## First Pass 审计回顾（初始审计）

详见下文中各阶段「First Pass 发现」列。

## Second Pass 深度审查（本轮新增）

| 审查项目 | 规范来源 | 验证结果 | 关键证明 |
|---|---|---|---|
| IPC 渐进式流式合约 | ipc-agent.md §3 | ✅ 完全对齐 | `emitStage('anysearch'/'fetching'/'prefiltering'/'blind_scoring'/'complete')` 全链路覆盖；`search:stream-start` → `search:stage` → `search:lead-scored` → `search:stream-complete` 每个事件都使用正确的 IPC_CHANNELS 常量 |
| 四级弹性搜索协议 UI 文案 | ipc-agent.md §3 / PROJECT-PRD.md | ✅ 完全对齐 | Level 0: `"...AnySearch 正在通过全网海关数据..."` (line 1971)；Level 2: `地图定位受限`；Level 3: `未发现地图商户`；缺失 AI 密钥: 盲评降级 + Amber 提示 |
| 多语言搜索意图扩展 | AGENTS.md(多语言宪法) / ARCH-STANDARDS.md §9-11 | ✅ 完全对齐 | `mutateSearchIntent()` (line 546-642) 通过 LLM 检测国家语言 → 生成本地化产品词变体 → 注入搜索管道；LLM 不可达时降级为英文变体 + `COUNTRY_LANGUAGE_MAP` |
| 合格线索前置过滤 | system-blueprint.md §7.1 | ✅ 完全对齐 | `qualifiesForPipeline()` (agent-pipeline.ts:28) 强制 `matchScore >= 60` ＋ 至少一个可触达资产；`buildAgentTaskQueue()` 内调用筛选 |
| 双管道数据回写 | AGENTS.md(双管道宪法) | ✅ 完全对齐 | `writeBackAgentStatus()` (agent-service.ts:88) 一次性更新 `agentStatusStore`(持久化 Map) + `emitAgentStatus()`(运行时 IPC `AGENT.STATUS_CHANGED`)，二者缺一不可 |
| Agent 日频上限读取 userConfig | AGENTS.md(宪法约束) | ✅ 完全对齐 | `applyLicenseLimits()` (agent-service.ts:438) 优先读 `store.get('user_config').agentDailyLimits`，不存在时才 fallback 到 `DEFAULT_AGENT_DAILY_LIMITS` |
| UI 授权层级显示 | AGENTS.md(本地运行规范) / ui-agent.md §9.1 | ✅ 完全对齐 | `AgentsPanel` 组件的 `isPremium` 门禁 (agents-panel.tsx:180)：非 Premium 渲染升级引导卡 + 激活输入框；Premium 渲染完整 Agent 卡片 |
| Agent 进度从 accountGetList 拉取 | AGENTS.md(本地运行规范) | ✅ 完全对齐 | `isAccountConnected()` (agents-panel.tsx:91) 调 `accountGetList()`；未配置时进度硬编码 `0/0`，状态显示`未连接 / 待配置` |
| 运行日志空状态文案 | AGENTS.md | ✅ 完全对齐 | logEntries.length===0 时渲染: `暂无本地沙箱运行记录，请先激活启动` (agents-panel.tsx:420) |
| Agent 启动前账号检测 | ui-agent.md §9.1 | ✅ 完全对齐 | `handleControl()` (agents-panel.tsx:146) 中 `isAccountConnected()` 阻断未配置账号的启动，弹出 Toast 错误提示 |
| IPC Fail-Closed 安全设计 | ipc-agent.md §2 | ✅ 完全对齐 | `AGENT.CONTROL` 通过 `registerSecureFeatureIpc(..., 'local_autopilot')` 注册；所有 IPC 返回结构化 `{success, error, code}` |
| Temporal Isolation 连续搜索隔离 | AGENTS.md(Temporal 合约) / search-service.ts | ✅ 完全对齐（修复后） | `withPipelineIsolation()` 包裹两处 pipeline 触发点；`isStaleTask(runId)` 在`execute*Agent()`入口和循环中每轮检查；`dispatchAgentsFromPipeline()` 分发前检查 stale |
| Activation Hardening 与 Phase A-H 无冲突 | N/A | ✅ 无冲突 | activation hardening 作用于 `main.ts`/`license-guard.ts`/`license-service.ts`；Phase A-H 作用于搜索管线/Agent 系统/Providers，功能域正交。main.ts 的 `registerIpcHandlers` 已集成 V1.3 的 sandbox/agent/dns handler |
| Schemas/IpcContracts 跨层一致性验证 | 抗回归协议 | ✅ 一致 | `ipc-contracts.ts`(shared) + `lead-mappers.ts`(renderer) + `leads-store.ts`(store) + `channels.ts`(main) 四层 `DataSourceType`/`DecisionMaker`/`CustomsData`/`AgentStatus` 字段结构与命名一致 |

---

## 各阶段合规审计

### Phase A — LinkedInSearchProvider

**状态: ✅ 基本合规**

| First Pass 发现 | Second Pass 判断 |
|---|---|
| `decisionMakers[].confidenceScore` 硬编码 50 — MEDIUM | **确认：仍为 50，未修复**。但 `mergeDecisionMakers()` (line 652) 对比不同数据源的 confidenceScore 择优保留，在单个数据源时无区别 |
| `contact`/`contactTitle` 语义不够精确 — MEDIUM | **降为 LOW**：SerpApi people_results 本身就是决策人数据，名实相符 |

### Phase B — Agent 审计 + 修复

**状态: ✅ 基本合规（P0 已修复）**

| First Pass 发现 | Second Pass 判断 |
|---|---|
| EmailAgent 硬编码 SMTP — MEDIUM → **已修复** | 确认 `getAgentInstanceForType()` (line 118) 读 `store.get('user_config').accounts.email`；无配置返回 null（graceful error） |
| Agent puppeteer `userDataDir` 而非 Electron `session.fromPartition` — LOW | **确认：仍是 puppeteer userDataDir**。`sandbox-service.ts` 已实现 (10KB) 但 agent 尚未消费它 |

### Phase C — E2E 门禁测试

**状态: ✅ 功能通过，覆盖不足**

| First Pass 发现 | Second Pass 判断 |
|---|---|
| 仅 3 个测试，缺失 temporal isolation/dual-channel/DNS/account Fail-Closed | **确认：覆盖仍不足**。列为 P2 优先级 |
| 使用 `Module._load` mock 方式脆弱 | 与代码库现有模式一致，可接受 |

### Phase D — Agent Pipeline 自动触发

**状态: ✅ 已修复并验证**

| First Pass 发现 | Second Pass 判断 |
|---|---|
| **CRITICAL**: `isStaleTask` 从未被调用 → **已修复** | 确认：`isStaleTask(runId)` 在 `executeWhatsAppAgent`(line 191/224)、`executeLinkedinAgent`(line 256/288)、`executeEmailAgent`(line 320/350) 入口和循环中均调用；`dispatchAgentsFromPipeline`(line 486) 分发前检查 |
| **CRITICAL**: `withPipelineIsolation` 未包裹 `buildAgentTaskQueue` → **已修复** | 确认：search-service.ts line 2214 和 2347 两处 pipeline 触发点均包裹了 `withPipelineIsolation(async (runId) => {...})` |

### Phase E — UI 合约测试

**状态: ✅ 通过但覆盖有限**

| First Pass 发现 | Second Pass 判断 |
|---|---|
| 未覆盖 DNS Health Check Warning UX / AccountsManagement / 徽标颜色 — LOW | **确认：未覆盖**。列为 P2 |

### Phase F, G, H — Customs / Facebook / Trade Show Providers

**状态: ✅ 基本合规，结构化字段空洞**

| First Pass 发现 | Second Pass 判断 |
|---|---|
| CustomsData/ExhibitionFootprints 始终为空对象 — MEDIUM | **确认：仍为空**。SerpApi site-scoped 搜索无法返回结构化海关/展会数据 |
| Facebook 正确使用了 `site:facebook.com` 搜索语法 | **合规**，符合 V1.2 手册界定 |

### YellowPagesProvider

**状态: ⏸️ 占位桩**

始终为 `'Not yet implemented — lower priority'` — P3 优先级。

---

## 综合风险矩阵

| ID | 问题描述 | 严重度 | 状态 | 影响范围 |
|---|---|---|---|---|
| R1 | **CustomsData/ExhibitionFootprints 结构空洞** — 字段存在但 SerpApi 不返回结构化数据 | P1 — 中等 | ⚠️ 未修复 | 前端线索详情面板如果展示这两个字段会看到空数据 |
| R2 | **LinkedIn confidenceScore 硬编码 50** — 非数据驱动 | P1 — 中等 | ⚠️ 未修复 | 决策人评分无区分度 |
| R3 | **E2E+UI 测试覆盖不足** — 缺少 temporal isolation/dual-channel/DNS/account Fail-Closed 测试 | P2 — 低 | ⏳ 需实施 | 回归风险 |
| R4 | **YellowPagesProvider 占位桩** — 未实现 | P3 — 低 | ⏸️ 可接受 | 少一个数据源 |
| R5 | **Agent 沙箱隔离为 puppeteer userDataDir 而非 Electron session partition** | P3 — 低 | ⏸️ 计划中 | 多账号场景 (Premium 功能) 隔离不够彻底 |
| R6 | **kone-PRD 引用完整性** — `.opencode/agents/*.md` 引用 kone-PRD.md 作为 V1.3 权威源头 | — | ✅ 已对齐 | AGENTS.md line 1 已声明 `kone-PRD.md 是全局唯一权威需求主源头` |

---

## 下一阶段执行计划

### P0 — 无待办（P0 已全量修复）

### P1 — 数据结构完整性（2 项）

| # | 任务 | 文件 | 方案 | 预估工时 |
|---|---|---|---|---|
| 1 | CustomsData/ExhibitionFootprints 启发式填充 | `providers/customs-shipment-provider.ts`, `providers/trade-show-provider.ts` | 基于 SerpApi 搜索摘要正则提取日期/国家/公司名做基本填充；或明确标注"SerpApi 摘要模式"并在前端不展示空字段 | 1-2d |
| 2 | LinkedIn confidenceScore 动态计算 | `providers/linkedin-search-provider.ts` | 基于 `people_results` 字段完整度 (name+position+location+company 等) + 搜索结果中出现的频次，计算 0-100 动态评分 | 0.5d |

### P2 — 测试覆盖 + UI 补全（3 项）

| # | 任务 | 涉及文件 | 目标 | 预估工时 |
|---|---|---|---|---|
| 3 | Agent pipeline temporal isolation E2E 测试 | `tests/e2e/gate-e2e.test.js` | 验证两次搜索快速执行时 Agent 任务隔离；验证 `isStaleTask` 在并行场景下拦截过期任务 | 1d |
| 4 | Dual-channel write-back + account Fail-Closed 测试 | `tests/e2e/gate-e2e.test.js` | 验证 `writeBackAgentStatus` 同时更新 store + IPC；验证 Trial 用户 `AGENT.LIST` 返回 FEATURE_DENIED | 1d |
| 5 | DNS Health Check UX + 徽标颜色 UI 测试 | `tests/ui-contract-agents-panel.test.js` | 验证 ui-agent.md §9.3 DNS 警告渲染；§5.4 数据源徽标颜色常量 | 0.5d |

### P3 — 架构增强 / 非阻塞（3 项）

| # | 任务 | 涉及文件 | 方案 |
|---|---|---|---|
| 6 | Agent 沙箱升级到 Electron session partition | `agent-service.ts`, `sandbox-service.ts`, agents/* | 将 `puppeteer.launch({userDataDir})` 替换为 `session.fromPartition('persist:account_id')`；sandbox-service.ts 已预留接口 |
| 7 | YellowPagesProvider 决策：实现或正式弃用 | `providers/yellow-pages-provider.ts` | 评估真实需求，option A: 调用公开 YP API；option B: 从 codebase 移除并更新所有 provider 注册表 |
| 8 | kone-PRD.md 与 AGENTS.md 之间双重定义清理 | `kone-PRD.md`, `AGENTS.md` | 部分 provider 合约同时在 kone-PRD 和 AGENTS.md 中定义，需明确去重规则：kone-PRD 为权威源头，AGENTS.md 仅引用 |

---

## 执行优先级建议

```
周次 1-2 (P1)
  ├── CustomsData 启发式填充 (1d)
  ├── ExhibitionFootprints 启发式填充 (0.5d)  
  └── LinkedIn confidenceScore 动态计算 (0.5d)

周次 2-3 (P2)
  ├── E2E temporal isolation + dual-channel 测试 (2d)
  └── UI 合约 DNS + 徽标测试 (0.5d)

周次 4+ (P3)
  ├── Agent sandbox Electron partition 迁移 (2-3d)
  ├── YellowPagesProvider 决策 (0.5d)
  └── 文档双重定义清理 (0.5d)
```

当前代码基线:
- **TS compile**: 0 errors ✅ (已验证)
- **E2E 门禁测试**: 3/3 通过 ✅
- **UI 合约测试**: 5/5 通过 ✅
- **Activation 守卫测试**: 3/3 通过 ✅
- **License 网关测试**: 3/3 通过 ✅
- **IPC 合约测试**: 1/1 通过 ✅
