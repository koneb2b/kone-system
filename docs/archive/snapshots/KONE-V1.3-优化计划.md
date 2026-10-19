# Kone V1.3 规范-功能对齐优化计划（P0/P1/P2 分级）

> 🗄️ **时点执行计划快照（非活规范）**：本计划配套上述对齐审计快照，针对的是**代码层**待办（Email 链路、LinkedIn 断链、双管道读端、IPC 注册中心、Provider 意图透传等），与本次纯文档治理不同轨。**不得作为当前规范裁决依据**；权威以 `kone-PRD.md` 为准。其中 P1-12「文档去矛盾」所列项（8 文档链、重复 `## 六`、`decisionMagers` 笔误、`whatsapp-web.js` 口径、L3 文案、`anysearch` 枚举等）**已在本轮文档治理中完成**。

> 配套文档：《KONE-V1.3-对齐审计分析报告.md》（全部证据与 `file:line` 引用见该报告，本文不再重复列行号）。
> 原则：所有改动须遵守 AGENTS.md（最小安全改动、防回归、改后跑 `tests/` 与 `npm run build`）。每项均标注**验证方式**；受本会话 shell 不可用影响，执行与验证须在可运行环境进行。

---

## P0 — 发布阻断（宪法违例 / 功能实质失效 / 商业边界缺失）

### P0-1 打通 AgentStatus 管道 A 读端（双管道宪法闭环）
- **问题**：`writeBackAgentStatus` 写而不读，`getAgentStatus` 无生产消费者，UI 无触达徽标（报告 A1）。
- **方案**：
  1. 新增只读 IPC（建议走 `registerSecureIpc`/`registerSecureFeatureIpc` 安全包装器）如 `agent:get-status`，按 `leadKey` 返回持久化 `agentStatus`；
  2. `leads-table.tsx` 增加触达状态徽标列（WhatsApp ✓/✗、LinkedIn 只读标记、邮件 stage 0-3），从 `leadMeta.agentStatus` 渲染；`analysis-drawer.tsx:134` 已备数据，直接补渲染；
  3. 搜索完成时由主进程把 `agentStatus` 合并回 `SearchExecuteResult`（已随 `finalResults` 返回，补 renderer 侧持久化即可）。
- **验证**：`tests/e2e/agent-persistence.test.js` 扩断言"UI 徽标数据源 = agent_status 配置键"；新增 `tests/ui-contract-agent-status-badge.test.js`。
- **工作量**：主进程 0.5d + 前端 0.5d。

### P0-2 修复 Email Agent 配置链路（SMTP 全链路断链）
- **问题**：后端读 `user_config.accounts.email.*`，前端无任何写入（报告 A2）。
- **方案**：
  1. `accounts-management.tsx` 邮箱卡片增加 SMTP/IMAP 表单（host/port/user/pass/sender），写入 `user_config.accounts.email`（**pass 走 `secret-manager`，禁止明文**，见 P1-6）；
  2. `UserConfig` 类型补 `accounts?: { email?: {...} }` 边界（`src/lib/user-config.ts`），遵循"模块只 merge 自己边界"约定；
  3. `accountConnect` 的 `credentials` 改为透传表单值而非空对象。
- **验证**：本地配置 SMTP 后 `agent:get-log` 出现 `email_sent`；新增 `tests/business-logic/email-config.business.test.js`。
- **工作量**：1-1.5d。

### P0-3 修复 LinkedIn 管道数据断链
- **问题**：`SearchExecuteResult` 无顶层 `linkedinUrl`，`buildAgentTaskQueue` 永远收不到 LinkedIn 任务（报告 A3）。
- **方案**（二选一，推荐 A）：
  - A（最小改动）：`buildAgentTaskQueue` 的回退逻辑——从 `decisionMakers[].linkedinUrl` 聚合（决策人层已有该字段，`ipc-contracts.ts:330`、`search-service.ts:1757`）；
  - B（契约升级）：`SearchExecuteResult` 增加 `linkedinUrl?: string`，在 `applySchemaDefaults`/`lead-mappers` 透传，并同步 `ipc-contracts.ts` + `preload` 类型（跨 4 文件，改动面大）。
- **验证**：`tests/e2e/agent-pipeline-integration.test.js` 增加"含 DM.linkedinUrl 的线索可进入 linkedin 队列"断言。
- **工作量**：方案 A 0.5d。

### P0-4 激活 IPC 注册中心（ARCH-STANDARDS §3 落地）
- **问题**：`registry.ts` 仅被测试引用，35 处 handler 全走裸 `ipcMain.handle`；`dumpRegistry`/`resetRegistry` 缺失（报告 I1/I2）。
- **方案**：
  1. 先补 `dumpRegistry()`/`resetRegistry()`（registry.ts 职责声明已要求，`ARCH-STANDARDS.md:66`）；
  2. 实现 `registerIpc` 的**真实绑定**：在 `register()` 内部调用 `ipcMain.handle(channel, (e, ...args) => this.dispatch(channel, e, ...args))`（或在 main.ts 启动时统一 `registry.attach(ipcMain)`）；
  3. 分模块迁移：按风险从低到高迁移 `provider:list`、`account:*`、`agent:*`、`search:basic`、`automation:*`，每批跑 `tests/ipc-contracts-v2.test.ts` + `ipc-contract-sweep`；
  4. 迁移完成后启动断言 `assertAllRegistered(核心通道)`（registry.ts:99 已有实现）。
- **验证**：`npm run test:ipc` + 全量 e2e；CI 增加"注册中心覆盖率"检查（grep 断言生产代码不再出现裸 `ipcMain.handle` 新注册）。
- **工作量**：2-3d（分批）。

### P0-5 落地 Agent 面板分层授权（Paid Basic 可用本地 Email/WhatsApp）
- **问题**：`agents-panel.tsx:212-214` 对**所有非 Premium** 用户渲染整页升级墙，直接违反 `PROJECT-PRD §1.4.2 L230` 与 AGENTS.md 的明确授权（Paid Basic 可使用 Email 与低量 WhatsApp Web 本地能力）；`totalLimit === 3` 魔法数（L211）为 premium 分支内死代码（报告 A7）。
- **方案**：
  1. 按 `useLicenseStore` 的 `tier/plan` 三态渲染：Trial 整页升级引导；Paid Basic 渲染 Email + WhatsApp 低量卡片（标注"低频 · 本地 · 需账号配置 · 平台风控边界"），LinkedIn 卡片隐藏或显式禁用（需显式启用才展示）；Premium/Enterprise 全量；
  2. 删除 `totalLimit === 3` 魔法数（L209-211），"今日配额"改为按 Agent 独立展示 `dailyUsed/dailyLimit`；
  3. 后端 `AGENT.LIST` 对 Basic 返回降级能力集（与 `applyLicenseLimits` 联动），不依赖前端判断。
- **验证**：`tests/ui-contract-agents-panel.test.js` 扩展 basic/trial/premium 三态渲染断言；`tests/license-gateway.test.js` 复核。
- **工作量**：1-1.5d。
- **注意**：Trial==Basic 能力集为 `kone-PRD §一.1`/`PROJECT-PRD §1.4.1` 的**既定设计**，本项**不改** TRIAL_FEATURES（原 P0-5 方案撤销）；如需收紧 Trial 搜索上限属产品策略决策，另行立项。

---

## P1 — 重要（上线后 1-2 周内）

### P1-1 LLM 评分数量上限文档化 + 评分状态一致性
- `SEARCH_LLM_SCORE_LIMIT = 20` 写入 `kone-PRD.md`/`PROJECT-PRD.md`（或改为 50 全量评分）；前端 `onSearchStreamComplete` 的 toast"已完成 N 条评分"改为真实评分数（`leadsForScoring.length`），避免误导。
- 验证：`tests/search-semantic-contract.test.js` 增加 scoringCount 断言。工作量：0.5d。

### P1-2 关键词变体搜索加并发闸
- `Promise.all(allSearchKeywords...)` 改 `runLimitedConcurrency(..., 2, ...)`（复用现有工具），或在关键字层按 channel 限流；与 `kone-PRD.md:105`"最大并发 Job=2"语义一致。
- 验证：压力脚本 + `tests/search-resilience-contract.test.js`。工作量：0.5-1d。

### P1-3 修复 `applySchemaDefaults` 字段丢失
- 返回对象补 `inferredRole/salesStrategy/country/city/status`（按 `ipc-contracts.ts:201-230` 类型），同步 `lead-mappers` 映射。
- 验证：`tests/business-logic/v1-3-lead-mapper.business.test.js` 增加字段透传断言。工作量：0.5d。

### P1-4 Provider 意图参数与并发治理
- `search-service.ts:2074-2075` 透传 `intentProducts/b2bAttributes`；`ProviderQuery` 增加 `language` 消费点（至少 provider 内保留）；`executeAll` 增加并发池（复用 `runLimitedConcurrency` 模式）。
- 验证：新增 `tests/business-logic/provider-query-contract.business.test.js`。工作量：1d。

### P1-5 Agent 日频上限持久化 + 跨天归零
- `dailyUsed/lastResetDate` 并入 `agent_status` 持久化对象；`applyLicenseLimits` 内按自然日归零；`AGENT.CONTROL` 启动时校验。
- 验证：`tests/e2e/agent-persistence.test.js` 增加"重启后 dailyUsed 保留 + 次日归零"。工作量：0.5-1d。

### P1-6 Agent 计数双写修正 + SMTP 密码加密
- 去掉 `agent-service.ts` 内 `completedCount/failedCount` 二次自增（保留 Agent 实例内唯一计数），`progress` 由唯一来源计算；
- Email SMTP pass 改存 `secret-manager`（`SECRET_KEYS.EMAIL_SMTP_PASS` 新增），`getAgentInstanceForType` 改读密文。
- 验证：`tests/business-logic/email-dns-shield.business.test.js` + 计数断言。工作量：1d。

### P1-7 Agent 实例日志并入 `agent:get-log`
- `execute*Agent` 结束/出错时把实例 `getLogs()` 汇入全局 `agentLogs`（`addLogEntry`），或 `AGENT.GET_LOG` 合并读取。
- 验证：`tests/ui-contract-agents-panel.test.js` 扩展。工作量：0.5d。

### P1-8 管道隔离延至执行期
- `consumeStagedTargets` 返回 `{ runId, targets }`，`startAgent` 携带 runId 执行 `isStaleTask` 校验；或 `withPipelineIsolation` 改为"staging→执行"全程包裹。
- 验证：`tests/e2e/agent-pipeline-integration.test.js` 增加"旧 runId 任务被丢弃"。工作量：0.5-1d。

### P1-9 安全基线补齐
- `window-service.ts`：加 `setWindowOpenHandler`（deny + shell.openExternal 白名单）、`will-navigate` 拦截、`webPreferences.sandbox: true` 评估（需验证 preload 兼容）；`index.html` 增加 CSP meta；UA 改写加域名白名单。
- 验证：`tests/main-lifecycle-guards.test.js` + 手工冒烟。工作量：1d。

### P1-10 Gold Filter 截断 HTML 正文
- `triggerN8nWorkflow` 增加"剥离 HTML 标签/脚本/样式"后的正文长度硬截断（对齐 `MAX_WEBSITE_TEXT_FOR_LLM` 语义，如 500-1000 字符白名单字段）。
- 验证：`tests/business-logic/cloud-handoff.business.test.js` 增加正文剥离断言。工作量：0.5d。

### P1-11 `confidenceScore` / 触达徽标 / 多源徽标 UI 落地
- 决策人条目渲染置信度进度条（`kone-PRD.md:183`）；`analysis-drawer.tsx` 渲染 `agentStatus`；`search-result-card.tsx` 徽标颜色按 `ui-agent.md:141` 修正（海关 emerald/展会 amber/黄页 purple）+ 头部补决策人/海关/展会徽标。
- 验证：`tests/ui-ux-alignment-contract.test.js` 扩展。工作量：1d。

### P1-12 文档去矛盾（与代码现状对齐）✅ 已完成（2024 文档治理轮）
- **已执行**（本轮实际落点，含外部前置更新合并核算）：
  - `kone-PRD.md` §0.1 Provider 清单对齐 `PROVIDER-CAPABILITY.md`（6 真实可用 + 1 实验性 + 1 弃用 + 宣传口径约束）；§0.3 管道分发层"待实现"→"已落地"（含 P0-3 的 decisionMakers[].linkedinUrl 聚合回退）；§0.4 `writeBackAgentStatus` 签名对齐代码（`leadKeyOrCompany` 键，非 `leadId`）
  - `PROJECT-PRD.md` §3.3.1.a 时空隔离契约函数名勘误（`emitDecisionMakers`/`computeLeadScore`/`enrichLeadWebsite` 为文档臆造名，真实为 `emitLeadScored`/`enrichLeadWithDeepProbe`）；§3.7.2 管道图、§3.7.3 AgentTask 类型（补 `taskRunId`/`leadKey`/`website`，标注 `leadId` 为占位 0）、§3.7.4 管道 A 写回路径对齐 `agent_status` 配置键 + `agent:get-status` 读端机制；§3.7.5 密钥等级表勘误（海关/展会已是 SerpApi 网页补位，无待接入爬虫）
  - `AGENTS.md` 时空隔离契约同步函数名勘误
  - `ARCH-STANDARDS.md` registry 节补 `attach(ipcMain)` 职责 + P0-4 迁移状态注记（基础设施已落地、存量迁移未开始，目标态 vs 现状区分）
  - `V1.2-商业版交付与运维手册.md` Auto-Update 补离线更新渠道真相（默认无 feed 不自动检查、`KONE_UPDATE_FEED_URL` 启用条件）；运维注意 1/2 口径对齐事实源
  - `V1.2-to-V1.3-alignment.md` Pending 表全量刷新为已落地、DataSourceType 补 `anysearch` 8 值（刷新核实完毕后，该历史台账已整体**清除归档**——matchScore 三态语义移植至 `kone-PRD.md §三`，文件仅存墓碑桩待物理删除）
  - `.opencode/agents/ipc-agent.md` stage 列表从"推荐新增"改为已落地全集（9 值对齐 `emitStage` 类型）
  - 其余项（8 文档链统一、重复章节、`decisionMagers` 笔误、`whatsapp-web.js` 口径、L3 文案、商用成熟度报告 §2.2 ICP 权重勘误横幅）经核对已由外部前置更新完成
- 剩余：`tests/repo-hygiene.test.js` 文档断言（随 P2-8 护栏一并实施）。

### P1-13 质量控制开关主进程完整挂载（N1）
- **问题**：`localDomainOnly`（优先本土域名）与 `highRelevanceOnly`（只看高相关）仅前端二次过滤，主进程 Scout/过滤阶段未消费；`COUNTRY_TLD_MAP`（search-service.ts:126）为死代码。
- **方案**：在 `computeScoutRelevance`/过滤路径（L2219-2235）增加 `localDomainOnly`（按 `COUNTRY_TLD_MAP` 校验 website TLD）与 `highRelevanceOnly`（`matchScore >= 60` 或预筛打分阈值）判定；移除前端 L369-373 的重复过滤或保留为兜底；补 `[Probe-Filter]` 审计日志。
- 验证：`tests/business-logic/search-fallback.business.test.js` 增加两开关行为断言。工作量：0.5-1d。

---

## P2 — 优化（2-4 周窗口）

| # | 项目 | 说明 | 验证 |
|---|---|---|---|
| P2-1 | 测试矩阵补全 | Provider 契约测试（customs/trade_show/facebook/anysearch）、Email 配置链路测试 | `tests/business-logic/provider-*` |
| P2-2 | CI 强化 | 增加 lint / format / `test:security-audit` / `vite build` job；`test:unit` glob 改显式文件清单或 `--test` 目录参数（规避 Windows cmd 展开风险，报告 I6） | CI 全绿 |
| P2-3 | 自动化巡航/邮箱验证伪进度 | `automation-workflow.tsx:93-95` 改真实步进 | 手工冒烟 |
| P2-4 | CSV 导出判空 | `leads-table.tsx:171` matchScore 空值输出"待评估" | 单元断言 |
| P2-5 | 导航徽标一致性 | `app-sidebar.tsx:43-44` 按 dashboard 真实准入（basic 可进 accounts）调整 | UI 冒烟 |
| P2-6 | 仓库卫生 | 清理 `.tmp-ipc-sweep-user-data/`、`.tmp-test-user-data/` 残留；明确 `dist-electron/` 与 smoke 产物跟踪策略；**补提交仍未跟踪的源文件**（据已归档的商用成熟度快照勘误：`electron/services/email-suppression.ts`、`electron/services/followup-scheduler.ts`、`electron/ipc/registry.ts`——其中 registry.ts 本轮 P0-4 已有改动，务必 `git add` 提交，否则注册中心激活代码不入库） | `repo-hygiene` |
| P2-7 | Provider 枚举收敛 | `yellow_pages` 从 UI 数据源选择隐藏（枚举保留向后兼容）；`providers.status` 补 preload 绑定或移除死 handler（N4） | 冒烟 |
| P2-8 | 文档链一致性护栏 | 增加"文档-代码对照"CI 检查（关键字符串如"待实现"与实现文件的对照）；`V1.2-商业版交付与运维手册.md:202` 补"`publish:null` 为有意配置，走离线渠道"声明（N8）——**手册声明部分已于文档治理轮完成**，仅剩 CI 检查 | CI |
| P2-9 | 意图解构缓存 | 相同 keyword+country 的 `mutateSearchIntent` 结果做会话级缓存 | 性能冒烟 |
| P2-10 | PDF 计数落盘失败策略 | `setTrialPdfExportCount` 落盘失败时改为阻断本次导出（防 3 次上限绕过，N6）；PDF 预览窗补 `sandbox:true`（N5） | 手工冒烟 |
| P2-11 | Agent handler 授权收口 | `agent:get-log`/`agent:suppress-*` 迁入安全包装器或注册中心（N7，随 P0-4 一并进行） | `test:ipc` |

---

## 执行顺序建议

1. **第 1 批（P0，2 周）**：P0-2（Email 链路）→ P0-3（LinkedIn 断链）→ P0-1（双管道读端）→ P0-4（IPC 注册中心，分批）→ P0-5（Agent 面板分层授权）。
2. **第 2 批（P1，3 周）**：P1-5/P1-6（Agent 限额与计数，防合规风险）→ P1-13（质量控制开关挂载）→ P1-3/P1-4（数据链路）→ P1-9（安全基线）→ 其余按依赖。
3. **第 3 批（P2）**：测试矩阵 → CI → 文档护栏（P2-8 一致性检查；`V1.2-to-V1.3-alignment.md` 已清除归档，无需再刷新）→ 卫生护栏（P2-6 含未跟踪源文件补提交与两个墓碑桩的物理删除）。

每批完成后运行：`npm run test:unit`、`npm run test:ipc`、`npm run test:e2e-smoke`、`npm run build`、`node ./scripts/security-audit.cjs`，并回归 `kone-PRD.md §0.5/§0.6/§0.7/§0.8` 与 `AGENTS.md` 双管道/四层搜索宪法条款。

---

## 风险提示

- 本计划基于静态分析；P0-1/P0-4 涉及主进程 IPC 结构改动，需在可运行环境先跑基线测试再动手。
- P0-4 迁移期间若同时发布，需保证 `registerIpc` 绑定逻辑在打包前完成（否则注册中心仍为空转）。
- P0-5 会改变 Paid Basic 用户可见的 Agent 面板（从"整页升级墙"变为"低量可用"），需与商业化文案（`V1.2-商业版交付与运维手册.md`）与售前口径同步，避免"能力突然出现"的合规疑问；Trial 搜索上限收紧属产品策略决策，不在本计划内。
