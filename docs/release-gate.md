# Release Gate：发布门禁检查项（权威规格）

> **文档角色**：发布门禁唯一事实源（SSOT）
> **机械化入口**：`npm run verify:release-gate`（已接入 `npm test`）
> **边界**：`kone-PRD.md` 是产品需求 SSOT，`CLOUD-COLLABORATION-DELIVERY.md` 是云端领域 SSOT。本文件**只**负责"发版前必须通过的检查项"，不复制产品规则、不重复已有门禁的实现。

## 0. 迁移与成因（2026-10-20）

本文件原位于 `.omo/notepads/project-alignment-optimization/release-gate.md`。

**问题**：`.omo/` 被 `.gitignore:35` 忽略 → 21 项发布门禁长期**不在版本控制内**，既不进 PR 评审，也可能随工作区清理丢失，且从未接入 CI。

**处置**：迁移至 `docs/release-gate.md` 纳入版本控制；可机械化子集落成 `scripts/verify-release-gate.cjs` 并接入 `npm test`。

## 1. 执行分层（校准于 2026-10-20）

| 层 | 含义 | 失败后果 |
|---|---|---|
| **HARD** | 确定性静态判定，由 `verify:release-gate` 检查 | **硬失败**，阻断 `npm test` 与发版 |
| **E2E** | 由既有测试套件覆盖；本脚本**只断言其仍被接线**（防静默移除） | 断链即硬失败；套件自身失败由 `npm test` 阻断 |
| **DELIVERY** | 依赖打包产物 / 外部环境，**不可**放进 `npm test`（干净检出无产物会误炸） | 发版前**必须单独执行并留证** |
| **WARN** | 语义判断或自然语言关键词，误报率高 | **绝不作门禁**，仅打印命中供人工裁决 |

## 2. 门禁清单与覆盖矩阵

### G0：Claim Scanner（声明扫描器）

| # | 门禁项 | 检查方式 | 通过标准 | 层 / 执行 |
|---|---|---|---|---|
| C1 | UI 高风险文案检测 | 扫描 `src/components/*.tsx` 的"全自动 / 24小时无感 / 破冰"等词 | **人工裁决**（见 §3 订正：不能按"0 命中"硬卡） | WARN |
| C2 | UI 自动化夸大声明检测 | 同上，"自动跟进 / 自动化交付 / 全自动化" | 仅出现在升级引导中（非能力声明） | WARN |
| C3 | PRD vs UI 声明一致性 | diff `kone-PRD.md` Agent 声明 vs 组件文案 | 无矛盾声明 | 人工（发版前） |

### G1：Provider 能力透明度

| # | 门禁项 | 检查方式 | 通过标准 | 层 / 执行 |
|---|---|---|---|---|
| P1 | Provider ID 去重 | 解析 `electron/services/providers/*-provider.ts` 的 `readonly id` | 9 个 id 全部唯一 | **HARD** |
| P2 | Placeholder / 已弃用 Provider 列表 | 列出含 `DEPRECATED` / 未实现的 Provider | 不在 UI / 营销中宣传 | WARN |
| P3 | Provider 时间隔离 | 每个**已实现** Provider 的 `execute()` 含 `myJobId` + 活跃 job 校验 | 全部包含；**已弃用 provider 豁免** | **HARD** |

### G2：Agent 合规强制

| # | 门禁项 | 检查方式 | 通过标准 | 层 / 执行 |
|---|---|---|---|---|
| A1 | LinkedIn auto-Connect 检测 | 扫描 `linkedin-agent.ts` 的 `clickConnect / sendMessage / sendInvite / addFriend / createConnection` | 无自动加好友 / 私信调用 | WARN（模式过宽必误报，见 §3） |
| A2 | WhatsApp session 验证 | `whatsapp-agent.ts` 含 `qr_ready / expired / rate_limited` 状态 | 状态机完整，断线 / 限流进 `paused` 或 `error` | **HARD**（存在性） |
| A3 | Email DNS 软锁定 | `email-agent.ts` 含 SPF / DKIM / DMARC 判定且 critical 阻断 | critical 时软锁发送 | **HARD**（存在性） |
| A4 | AgentTask 时间隔离 | `agent-pipeline.ts` 含 `taskRunId` + `currentPipelineRunId` | consumer 端丢弃过期任务 | **HARD** |
| A5 | 双管道写回测试 | `agentStatus` 与 `AgentState` 双写断言 | 两条管道均有断言 | E2E（`test:unit`） |

### G3：License 授权校验

| # | 门禁项 | 检查方式 | 通过标准 | 层 / 执行 |
|---|---|---|---|---|
| L1 | IPC 注册点审计 | 通道定义 / 注册 / 推送 / preload 四面漂移 | 无漂移；feature key 映射正确 | E2E（`verify:ipc` + `agent-gate-classification`） |
| L2 | Trial 熔断 E2E | Trial 访问 `/agents` 只见升级引导 | 无 agent 卡片、无运行指标 | E2E（`test:gateway`） |
| L3 | Basic 低频限制 E2E | Basic 使用 WhatsApp 受日限约束 | 日限生效 | E2E（`test:unit`） |
| L4 | Premium Cloud E2E | Premium 使用 `cloud_send` | 成功（需云端后端） | DELIVERY（`test:packaged-premium`） |
| L5 | No Dev Bypass in Prod | 生产构建不含 dev 兜底分支 | bundle 分析确认排除 | E2E（`test:bypass`） |

### G4：搜索回归测试

| # | 门禁项 | 检查方式 | 通过标准 | 层 / 执行 |
|---|---|---|---|---|
| S1 | JobID 时间隔离 | 搜索回调入口校验 `myJobId` | 陈旧回调静默丢弃 | **HARD**（存在性） |
| S2 | 多源隔离 | 并行采集处使用 `Promise.allSettled` | 单源失败不中断整轮 | **HARD** |
| S3 | 4 级降级链路 | AnySearch → Maps → 参数容错 → Organic | 降级测试全绿 | E2E（`search-fallback.business.test.js`） |
| S4 | 流式闭环 | `search:stream-complete` 必发 | 无静默终止 | E2E（`test:unit`） |

### G5：安全审计

| # | 门禁项 | 检查方式 | 通过标准 | 层 / 执行 |
|---|---|---|---|---|
| SEC1 | 私钥文件未在 repo | `git ls-files` 过滤 `*.pem` | 无输出 | **HARD** |
| SEC2 | Fail-Closed 默认阻断 | 授权失败返回显式错误负载 | `FEATURE_DENIED` / `TRIAL_EXPIRED` | E2E（授权负向回归套件） |
| SEC3 | 安全审计报告全绿 | `npm run test:security-audit` | ALL APPROVE | DELIVERY（需打包产物） |

## 3. 订正记录（2026-10-20，含过度约束教训）

1. **P1 原注已过期**。原文称"AnySearchProvider 与 SerpApiMapsProvider 都使用 `google_maps`，需修复"。实测当前 9 个 id **全部唯一**：`anysearch`、`google_maps`、`google_organic`、`serper`、`linkedin_search`、`customs_shipment`、`trade_show`、`facebook_search`、`yellow_pages`。该缺陷已修复，注记不再成立。

2. **C1 的"0 个高风险文案命中"必然误报**。`破冰` 在合规提示与风险披露文案中**合法出现**（`src/components/agents-panel.tsx:268/579` 明确说明 LinkedIn 反爬限制与人工确认要求）。按 2026-10-19 `AGENT.GET_STATUS` 过度约束事故的教训，此类自然语言判据**降级为 WARN**。

3. **A1 的裸关键词判据必然误报**。`message` 是通用词，`connect` 出现在合规文案中。故改用具体 API 模式（`clickConnect`/`sendMessage`/`sendInvite`/`addFriend`/`createConnection`），且仍只作 WARN —— 真实约束由 `tests/business-logic/agent-gate-classification.business.test.js` 等行为测试承担。

4. **P3 补注：已弃用 Provider 豁免**。`yellow-pages-provider.ts` 为**显式弃用**（`isAvailable()` 恒 `false`，`execute()` 直接返回 `DEPRECATED` 而不发起任何异步采集），不适用时间隔离要求。若对其硬卡 `myJobId`，即为第二次过度约束。

## 4. DELIVERY：交付前必须单独执行（不在 `npm test` 内）

| 命令 | 依赖 | 用途 |
|---|---|---|
| `npm run test:security-audit` | `release/win-unpacked/KoneAI.exe` | G5-SEC3 全绿 |
| `npm run test:smoke` | 重新打包 | 打包态启动冒烟（booted / preload bridge / 授权页或仪表盘） |
| `npm run test:packaged-premium` | 重新打包 | 打包态 Premium 能力（L4） |
| `npm run verify:signature -- --strict` | 代码签名证书 + Windows SDK | B-2 签名硬门禁 |
| 干净机器 20 项人工验收 | 干净 Windows 机器 | NO-GO ① |

> ⚠️ `verify:signature` 默认**退出 0**（证书未接入属预期），仅在 `--strict` 下退出 1。**交付时必须加 `--strict`**，否则未签名包会被静默放过。

## 5. 与发布判定的关系

- 本文件是**工程质量门禁**；`CLOUD-COLLABORATION-DELIVERY.md §0` 的 `NO-GO` 是**产品级**发布判定。
- **本文件全绿 ≠ 可转 GO**。转 GO 仍需 NO-GO 四项闭环（干净机器验收 / 打包冒烟与签名 / 审批门禁部署开启留证 / 小流量实发）。
- 反之，本文件任一 HARD 项失败即为发版阻断，与 NO-GO 状态无关。
