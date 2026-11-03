# Release Gate：发布门禁检查项（权威规格）

> **文档角色**：发布门禁唯一事实源（SSOT）
> **机械化入口**：`npm run verify:release-gate`（已接入 `npm test`）
> **边界**：`kone-PRD.md` 是产品需求 SSOT，`CLOUD-COLLABORATION-DELIVERY.md` 是云端领域 SSOT。本文件**只**负责"发版前必须通过的检查项"，不复制产品规则、不重复已有门禁的实现。

## 0. 迁移与成因（2026-10-20）

本文件原位于 `.omo/notepads/project-alignment-optimization/release-gate.md`。

**问题**：`.omo/` 被 `.gitignore:35` 忽略 → 23 项发布门禁长期**不在版本控制内**，既不进 PR 评审，也可能随工作区清理丢失，且从未接入 CI。

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
| `npm run verify:signature`（默认；`--strict` 可选） | 无（默认不依赖证书） | **非阻断（内部分发/顾问交付）**：代码签名经 owner 决策（2026-10-20）推迟为交付后加固项；**公开发行渠道（官网下载/应用商店/公开试用）前 `npm run verify:signature` 必须通过** |
| 干净机器验收 S1–S11（11 步 + §7.1 六场景） | 干净 Windows 机器 | NO-GO ①（明细见 `docs/evidence/clean-machine-acceptance-1.4.38.md`） |

> ℹ️ `verify:signature` 默认**退出 0**（证书未接入属预期），仅在 `--strict` 下退出 1。
> **owner 决策（2026-10-20）：代码签名不作为交付阻断** —— 依据是权威发布判定 `CLOUD-COLLABORATION-DELIVERY.md §0`
> 的 `NO-GO` 四项中**从未包含代码签名**；此前将其写成"硬门禁"属本文件 §4 的**过度约束**，现订正。
> `verify:signature` **保持接线**（`ARCH-STANDARDS.md §17` item 9 的接线断言不变）。待证书采购到位后，
> 可在**公开发行**渠道切回 `--strict` 硬门禁（届时同步本表与 `V1.2-商业版交付与运维手册.md §3`）。

## 5. 与发布判定的关系

- 本文件是**工程质量门禁**；`CLOUD-COLLABORATION-DELIVERY.md §0` 的 `NO-GO` 是**产品级**发布判定。
- **本文件全绿 ≠ 可转 GO**。转 GO 仍需 NO-GO 两项闭环（干净机器验收 / 小流量实发）（打包冒烟已于 2026-10-20 闭环、审批门禁部署开启留证已于 2026-11-03 闭环；签名按要求见下文渠道区分）。
- 审批门禁部署留证机械化入口：`npm run verify:approval-gate-live -- --dry-run`（无网络）或 `npm run verify:approval-gate-live -- --allow-write` → `tests/approval-gate-evidence-<ISO8601>.json`；live 主判据为 `409 DRAFT_VERSION_MISMATCH`（审批 N 不得授权 N+1）与 `403 SUPPRESSED`（全局抑制），`APPROVAL_REQUIRED` 默认 `not_applicable`（公有 API 无法构造 approved/queued 且无审批锚的线索，仅由 `kone-cloud/tests/approval-gate.test.ts:155-161` 覆盖），门禁语义见 `CLOUD-COLLABORATION-DELIVERY.md §8`。**2026-11-03 已在生产 workspace 实测 PASS**，证据 `docs/evidence/approval-gate-live-2026-11-03.json`。
- 该命令会在目标 workspace 创建 fixture 线索/审批/队列行并写入**全局抑制名单**（不可逆）；部署只提供 `POST`/`GET`，无 DELETE 清理路由，请使用 staging workspace，并保留证据 JSON 与退出码（0 PASS / 1 FAIL或INCOMPLETE / 2 配置 / 3 传输）。
- 反之，本文件任一 HARD 项失败即为发版阻断，与 NO-GO 状态无关。

## 6. 授权分级判定：AUTOPILOT / CLOUD.CLOUDFLARE_*（2026-10-20）

门禁分类的**判定依据**（防止第三次过度约束事故）。可执行守护见
`tests/business-logic/autopilot-cloud-gate-classification.business.test.js`（双向断言 + 清单腐烂防护）。

| 通道 | 判定 | 依据 |
|---|---|---|
| `AUTOPILOT.CLEAR_LEGACY` | **门禁**（`local_autopilot`） | 配置删除写动作 |
| `AUTOPILOT.GET_STATE` | 免门禁 | 状态读取；Trial 搜索页 `hydrateFromStorage` 合法调用（同 `AGENT.GET_STATUS` 先例） |
| `AUTOPILOT.SET_STATE` | 免门禁 | 节流持久化底座（随草稿输入触发）——加门禁 = Trial 可见降级 |
| `AUTOPILOT.SYNC_STATE` | 免门禁 | 托盘生命周期遥测；注册顺序已被 `autopilot-sync-attach-guard` 锁定 |
| `CLOUD.CLOUDFLARE_CONFIGURED` | **门禁**（`cloud_send`） | 云端配置探测；渲染层已条件化 |
| `CLOUD.CLOUDFLARE_TEST_CONNECTION` | **门禁**（`cloud_send`，**两处**） | 有效 handler 在 `outreach-sync-service.ts`（后注册覆盖），故两处均加 |
| `CLOUD.CLOUDFLARE_DASHBOARD_STATS` | **门禁**（`cloud_send`） | 云端触达看板聚合；消费方已被 `canUseCloudSend` 条件挂载 |
| `CLOUD.CLOUDFLARE_POLL_OUTREACH_STATUS` | **门禁**（`cloud_send`） | 云端投递明细；同上 |

**关键结论**：AUTOPILOT 的**真实能力边界在搜索层**（`src/lib/autopilot-runner.ts:319` → `searchExecute()`，
Trial 已受 10 条/次、间隔 15 秒限额）。对状态管道加门禁**不关闭任何能力泄漏**，只会降级 UX。

**已锁定陷阱**：`CLOUD.CLOUDFLARE_TEST_CONNECTION` 由 `cloudflare-service.ts` 与 `outreach-sync-service.ts`
**双重注册**，后者**后注册覆盖**（其注释自述此前因此出现"测试连接永远失败"真实缺陷）。该通道的**有效**
handler 在 outreach-sync，故 `registerOutreachSyncHandlers` 已补 `licenseGuard` 参数并在彼处加门禁，
`main.ts` 同步传入；`cloudflare-service.ts` 内亦保留门禁作为**防御纵深**（注册顺序若变动不至静默失守）。

**前置条件已落地**：`system-settings.tsx` 的 cloud 面板改为 `canAccess('cloud_send')` 条件挂载，
非高级版渲染升级引导而非挂载 `CloudSettingsTab`。原因是 `unwrapIpc`（`src/lib/electron-api.ts:117`）
对非 success **直接 throw**，而 `src/components/settings/cloud-settings-tab.tsx:38` 用 `Promise.all` 并发取配置 —— 门禁先行
会让非高级版停在"未配置"空态（误导性降级，P0-2 同类）。该前置条件已被测试反向锁定。
