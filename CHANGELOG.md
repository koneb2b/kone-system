---
title: KONE 变更日志
status: active
authoritative: true
ssotFor: [changelog]
lastVerifiedAt: 2026-09-22
---

# KONE 变更日志 (CHANGELOG)

> **文档角色：版本变更时间线的唯一事实源。**
> 记录"实现变更 → 规范回写"的对应关系，用于消除历史上反复出现的
> "代码已改、规范未同步"漂移（如备份校验算法 MD5→SHA-256 长期未回写）。
>
> 记录要求：任何改动状态、数据、权限、投递、事件、公开 API 或合规规则的提交，
> 必须在此登记，并注明受影响的 SSOT。

---

## [1.3.1] — 2026-09-22 · 规范治理与 P0 阻断项修复

**基线 commit**：`0925cde`
**发布判定**：仍为 `NO-GO`（依 `CLOUD-COLLABORATION-DELIVERY.md §0`；本次仅修复阻断项，云端协同目标态未落地）
**审计依据**：`KONE-V1.3-规范文档与架构数据交互深度梳理报告.md`

### 修复 · 前端设计系统（P0-1）

| 项 | 变更 |
|---|---|
| 根因 | `src/index.css` 使用 Tailwind v4 CSS-first 模式，但缺少 `@theme` 块；`tailwind.config.cjs` 中的语义色映射在 v4 下**完全不加载**，且 `--secondary` / `--destructive` / `--accent` / `--popover` / `--success` / `--sidebar-*` 在 `:root` 中未定义 |
| 影响 | `bg-card`、`text-foreground`、`border-border`、`text-muted-foreground` 等 **278 处、30 个组件**的语义工具类在构建产物中生成 **0 条 CSS** |
| 修复 | 补齐 `:root` 缺失变量；新增 `@theme inline` 注册全部语义色与圆角刻度；删除死配置 `tailwind.config.cjs`；用 `@custom-variant dark` 固化浅色商业版（停用系统级深色变体） |
| 验证 | 构建产物中上述语义类全部生成；透明度变体（`bg-card/80`）恢复；CSS 体积 94.9KB → 112.4KB（新增即此前缺失的类） |
| 受影响 SSOT | `ARCH-STANDARDS.md`（架构红线不变）、无业务规则变更 |

### 修复 · 规范权威源止血（P0-2）

| 项 | 变更 |
|---|---|
| `kone-PRD.md` | 修正过时函数名 `computeLeadScore`/`enrichLeadWebsite` → `emitLeadScored`/`enrichLeadWithDeepProbe` 并加勘误；`yellow_pages` 从"可用 Provider"清单移除并标注已弃用；§0.3 常量表补入 `SEARCH_LLM_SCORE_LIMIT`(=50，裁定 20 为过时值)、`MAX_SEARCH_CANDIDATES`(200)、`SEARCH_CHANNEL_FETCH_LIMIT`(100)、并发常量名、`MAX_WEBSITE_TEXT_FOR_LLM`(3000)、超时(20s/15s)、熔断(3 次/60s)；补全时点快照清单；文档引用改用全路径 |
| `ARCH-STANDARDS.md` | 消除 IPC SSOT 双定义（§3 与 §16.1）：明确 `channels.ts` 为**命名与类型**事实源、`registry.ts` 为**运行时注册路由**收敛点；补入 2026-09-22 实测迁移数据（60 通道 / 49 注册 / 11 仅推送 / registry 迁移 0（基线；本批次续批后已升至 12，见 §IPC 注册中心迁移）） |
| `AGENTS.md` | 强制读链由 8 份扩为 **10 份**（补 `PROVIDER-CAPABILITY.md`、`CLOUD-COLLABORATION-DELIVERY.md`）；修正 LinkedIn 日频内部矛盾；修正 `dist-electron` 跟踪状态描述 |
| `PROVIDER-CAPABILITY.md` | 补真实校准日期与基线 commit；修正"无 Provider 专项单测"的过时表述（实存 `provider-isolation.business.test.js`，覆盖 2/8 Provider） |
| `.clinerules` | 由规范副本改为**流程 + 指针**文件（见下方"规范治理"） |

### 修复 · 架构与正确性（P0-3 / P0-4 / P0-7 / P0-8）

| 项 | 变更 | 受影响 SSOT |
|---|---|---|
| P0-3 | `isStaleTask` 增加"最近一次成功暂存的 runId"作为暂存窗口关闭后的比较基准；`startAgent` 现在接收真实 `pipelineRunId`。修复前用户在搜索完成后点击"开始触达"时 `currentPipelineRunId` 恒为 null，陈旧任务防重**从未生效** | `AGENTS.md`（Agent 双管道数据流宪法）、`kone-PRD.md §0.3` |
| P0-4 | 接线 `startFollowupScheduler`（此前导出但全仓 0 调用，导致 stage0 发出的跟进计划永不推进）；定时器 `unref()` 避免拖住事件循环；更新邮件 Agent 描述 | `ARCH-STANDARDS.md §9.6.8` |
| P0-7 | `session.defaultSession.webRequest.onBeforeSendHeaders` 由"每次建窗注册"改为模块级一次性安装，消除窗口重建时的监听器累积 | `ARCH-STANDARDS.md` |
| P0-8 | `search-service.ts` 慢源 `Promise.race` 的 120s 定时器补 `clearTimeout`；两处 `withPipelineIsolation` 补 `.catch`，避免 unhandledRejection | `ARCH-STANDARDS.md §9` |

### 修复 · 性能与可靠性（P0-5 / P0-6）

| 项 | 变更 | 验证 |
|---|---|---|
| P0-5 | `NativeStore` 落盘由"每次 `set()` 全量同步写 + fsync"改为**合并 + 250ms 防抖**；新增 `flushSync()` 逃生口并接入退出、备份前、用户可见的 `CONFIG.SET` | 实测 100 次 `set()` 由 100 次落盘降至 **1 次** |
| P0-5 加固 | 构造期确保父目录存在（原先目录缺失会静默降级为**永不落盘**）；`fsync` 失败不再判定整次写入失败（原先在不支持 fsync 的文件系统上会**永久阻断所有配置持久化**） | 新增单测覆盖 |
| P0-6 | `safeFetch` 内置默认 20s 超时；Supabase 通过注入 `global.fetch` 一次性覆盖全部 REST 调用（15s） | 断网场景不再永久 pending |

### 新增 · 治理件与门禁（P0-9 / P1-12）

| 文件 | 角色 |
|---|---|
| `GLOSSARY.md` | 术语唯一事实源（含"常见误用"清单） |
| `STATE-MACHINES.md` | 状态机映射唯一事实源（裁决 4 态 / 6 态 / 7 态混用） |
| `FIELD-DICTIONARY.md` | 字段索引（代码事实源仍为 `src/shared/ipc-contracts.ts`） |
| `CHANGELOG.md` | 本文件 |
| `scripts/verify-doc-consistency.cjs` | 规范一致性门禁：读链完整性、过时函数名、宪法常量↔代码常量、架构红线、归档桩、**66 处交叉引用断链** |
| `scripts/verify-ipc-consistency.cjs` | IPC 契约门禁：通道未定义 / 死通道 / 暴露无实现 / 字面量通道直写 |
| `.github/workflows/ci.yml` | **修复结构非法**（`gate.steps` 原为映射而非数组，GitHub 会判定整份 workflow 非法 → 所有门禁从未执行）；新增 `consistency` / `packaged` / `security` 作业；`gate` 按事件类型动态校验必过项 |

### 规范治理

| 项 | 变更 |
|---|---|
| 归档 | 物理删除两份墓碑桩：KONE-商用成熟度深度审计报告.md、V1.2-to-V1.3-alignment.md（自此不再作为可引用文档） |
| 命名 | kone-.md → `METHODOLOGY-NORTHSTAR.md`（同步更新 `kone-PRD.md` 7 处引用） |
| 去重 | `.clinerules` 由 132 行规范副本改为流程 + 指针文件，消除 24 处数值复述与过期的 8 份读链 |
| 治理件 | 新建 `GLOSSARY.md`（术语 SSOT）、`STATE-MACHINES.md`（三套状态机映射 SSOT）、`FIELD-DICTIONARY.md`（字段索引，代码事实源仍为 `src/shared/ipc-contracts.ts`）、`CHANGELOG.md`（变更时间线） |

### 前端工程化与性能（P1）

| 项 | 变更 | 验证 |
|---|---|---|
| Vite vendor 分包 | 补 `manualChunks` 拆分 `vendor-react` / `vendor-charts` (recharts) / `vendor-icons` (lucide) | chunk 数 51→33；主入口 347KB→324.75KB；`data-center` 414KB→25.71KB（recharts 独立缓存）；`vendor-icons` 31.48KB 消除数十个微型 chunk |
| 死代码与依赖清理 | 删除 0 引用的 `src/components/kone-logo.tsx` 与 2.5MB 的 `src/assets/kone-logo.png`；从 `package.json` 移除 12 个未使用的 `@radix-ui/*` 依赖 | devDeps 59→47 |
| 流式评分增量更新（P1-3） | `leads-store` 新增 `searchResultsByKey: Record<string, LeadSearchResult>` 索引与 `updateScoredLead(scored, {reposition, topCount})` action；`use-search-engine` 评分帧处理器改走单点更新（find by leadKey → merge → 可选 top-K 重排），不再 `map + setSearchResults` 全量重建 | 新增 4 个回归测试全部通过；后续可基于 `searchResultsByKey` 进一步实现按卡 selector 订阅 |
| **顺手修复 UX bug** | `use-search-engine` 中分页 `useEffect` 错误地把 `searchResults` 列为依赖——流式评分期间每帧都会触发重置，导致分页始终停在第 1 页 | 从依赖数组移除，仅过滤条件变化才重置分页 |
| 搜索扇出并发闸（P1-2） | `search-service.ts` 新增 `SEARCH_FANOUT_CONCURRENCY = 3` 与 `mapLimitedConcurrency` 助手；关键词变体层 `Promise.all(allSearchKeywords.map(...))` 改为 `mapLimitedConcurrency(allSearchKeywords, 3, ...)`。与评分/富化的并发 `2` 是**两个独立并发域**（扇出 = 同时打多少个上游搜索请求，受上游限流防护；`2` = LLM/官网富化算力红线），不得混读 | 同步 `kone-PRD.md §0.3` 常量表与 `verify-doc-consistency.cjs` 宪法常量比对（含 `SEARCH_FANOUT_CONCURRENCY`=3）；新增 `tests/business-logic/search-fanout-concurrency.business.test.js`（4 项全过） |
| 重复错误格式化去重（P1-8） | 新建 `src/lib/error-message.ts`（`formatErrorMessage` / `formatSearchErrorMessage` / `escapeCsvValue`），消除 `leads-management.tsx` / `data-center.tsx` / `leads-table.tsx` / `search-engine.tsx` / `use-search-engine.ts` 5 处重复实现；`analysis-drawer.tsx` 保留领域专用版（需解析 `ElectronApiError` 语义元数据） | `npx vite build` 通过 |
| 邮箱验证有界并发（P1-11） | `automation-service.ts` 新增 `EMAIL_VERIFY_CONCURRENCY = 4`（可经 `KONE_EMAIL_VERIFY_CONCURRENCY` 覆盖）与 `mapWithConcurrency`（按索引回填、顺序对齐）；`verifyEmailsBatch` 单次最多 50 个邮箱并走有界并发 | 新增 `tests/business-logic/email-verify-concurrency.business.test.js`（5 项全过） |

### 门禁修复 · lint / format 脚本与全量 prettier 归一（P0-9 续）

| 项 | 变更 | 验证 |
|---|---|---|
| lint 脚本引号 bug | `package.json` 的 `lint` / `lint:fix` glob 原用单引号，在 Windows 下被字面传递导致 `No files matching` —— **lint 门禁长期形同虚设**；改为双引号后真正生效，并清理 12 个真实 error（`URL`/`Response`/`DOM` 全局声明、`preserve-caught-error` 补 `cause`、`prefer-const`、空 catch 补注释、`no-control-regex` 加 eslint-disable、`no-useless-assignment` 改 `let page`） | `npm run lint` exit 0（0 error / 253 warning） |
| format 脚本引号 bug | `format` / `format:fix` 同样用单引号、在 Windows 下匹配 0 文件、长期"假绿"；改为双引号 | `npm run format` 现能真正校验 |
| 全量 prettier 归一 | 工作区 100% CRLF，`.prettierrc` 补 `endOfLine: "auto"` 后仍有 55 个文件存在真实格式漂移（非行尾）；`prettier --write` 一次性归一（含 23 个未改动过的 shadcn `src/components/ui/*` 模板组件，其原格式为默认 prettier 风格 `semi:true`/双引号，与仓库 `semi:false`/单引号配置冲突）。ESLint 仅在 `semi`/`quotes`/`comma-dangle` 三项上做格式化约束，且与 prettier 配置一致，归一未引入新 lint error | `npm run format` → "All matched files use Prettier code style!"；`npm run lint` 仍 0 error |

### IPC 注册中心迁移 · 首批批次（P0-4 续）

| 项 | 变更 | 验证 |
|---|---|---|
| 门禁可观测性修复 | `scripts/verify-ipc-consistency.cjs` 原 `registryMigrated` 计数**硬编码 `return false`**（始终报告 0），属"假可观测"指标，违反"无可观测证据不宣称成功"的宪法原则；改为真实扫描 `registerIpc(IPC_CHANNELS.X.Y, ...)` 调用，如实上报迁移通道数与清单 | 门禁现输出 `经 registry.registerIpc() 注册: 2（已迁移: PROVIDER.LIST, PROVIDER.STATUS）` |
| PROVIDER 服务首批迁移 | `electron/services/provider-service.ts` 的 `PROVIDER.LIST` / `PROVIDER.STATUS` 两个 handler 由直挂 `ipcMain.handle` 改为经 `registerIpc()` 收敛到注册中心（仍由 `main.ts` 的 `registry.attach(ipcMain)` 在 `registerIpcHandlers()` 末尾统一绑定）；新增 `electron/ipc/contracts/provider.contract.ts` 定义请求/响应契约（dev 模式做契约校验，production 跳过保性能）；通道命名仍引用 `IPC_CHANNELS.PROVIDER.*` 单一事实源 | `tsc` 编译通过；`node --test tests/ipc-registry-provider-migration.test.ts` 全过（注册 / 路由 / dev 模式契约校验 / `assertRegistered` 启动门禁断言） |
| 受影响 SSOT | `ARCH-STANDARDS.md §3` 迁移注记（迁移数 0→2）、`verify-ipc-consistency.cjs`（门禁口径） | — |

> **迁移策略**：按 `ARCH-STANDARDS.md §3` 注记"按服务逐批进行（每批附带契约定义 + 单测）"。PROVIDER 为最小自包含服务（2 通道、无外部副作用），作为首批验证迁移机制可行；其余 47 个通道（29 直挂 + 18 包装器 + 11 仅推送）待后续批次。迁移全部完成后 `assertAllRegistered()` 才作为启动门禁启用；当前仍为**目标态**。

### CI 内容一致性门禁（P0-9）

`scripts/verify-doc-consistency.cjs`（6 项校验）与 `scripts/verify-ipc-consistency.cjs`（4 项校验）已接入 npm 与 CI：
- 强制读链 10 份完整性
- 过时函数名白名单（仅勘误行豁免）
- 宪法常量 ↔ 代码常量自动比对
- 架构红线可查
- 归档墓碑桩不得复活
- **97 处文档交叉引用断链校验**（发现并修复 5 处）
- 工具入口文件不得复述数值

`.github/workflows/ci.yml` 已修复**结构非法 bug**（`gate.steps` 原为映射而非数组，整份 workflow 之前无法解析 → 所有门禁从未真正运行），新增 `consistency` / `packaged` / `security` 作业；`gate` 按事件类型动态校验必过项。

### IPC 注册中心迁移 · 第三批批次（P0-4 续）

| 项 | 变更 | 验证 |
|---|---|---|
| autopilot-state-service（3 通道） | `AUTOPILOT.GET_STATE` / `SET_STATE` / `CLEAR_LEGACY` 由直挂 `ipcMain.handle` 改为 `registerIpc()`；新增 `electron/ipc/contracts/autopilot.contract.ts` | 见下方「批量验证」 |
| auth-service（3 通道） | `AUTH.LOGIN` / `LOGOUT` / `GET_SESSION` 改为 `registerIpc()`；新增 `electron/ipc/contracts/auth.contract.ts`。`LOGIN` 需 `event.sender` 驱动授权窗口，handler 签名统一收 `unknown` 后显式收窄（兼容 `strictFunctionTypes`） | 同上 |
| sandbox-service（3 通道） | `ACCOUNT.CONNECT` / `DISCONNECT` / `GET_LIST` 改为 `registerIpc()`；新增 `electron/ipc/contracts/account.contract.ts`。三通道虽无外层包装，handler 内部 Fail-Closed 授权（`hasFeature` + `buildFeatureResult(...,403)`）原样保留，迁移只改注册方式 | 同上 |
| automation-service（1 通道） | `AUTOMATION.START_CAMPAIGN` 改为 `registerIpc()`；新增 `electron/ipc/contracts/automation.contract.ts`。`AUTOMATION.VERIFY_EMAILS` 仍由 `registerSecureFeatureIpc` 包装（不迁移，故不定义其契约，避免产生"定义了却无人消费"的死契约） | 同上 |
| 自绑定兼容层 | 每个迁移的 `register*Handlers` 末尾补 `registry.attach(ipcMain)`，使直接调用该函数而未显式 attach 的历史 e2e / 独立测试仍能经 `ipcMain.getHandler()` 触达迁移通道 | `tests/ipc-registry-plain-batch3-migration.test.ts` 断言四个服务各自的 ipcMain 均拿到绑定 |
| **`attach()` 改为按 ipcMain 实例幂等**（架构修正） | 原 `attach` 用**全局** channel 级 `_attached` Set 去重，导致迁移通道一旦绑到某个 ipcMain，其它 ipcMain 实例（e2e 各自 new 的 mock）再 attach 时会被整体跳过 → `agent-persistence` 模拟重启的第二次加载、`gate-e2e` 的多次注册都拿不到 handler。改为 `WeakMap<ipcMain, Set<channel>>` 按实例去重：同一实例不重复绑定（production 唯一 ipcMain 安全，不会触发 Electron "second handler" 报错），不同实例各自绑定，且后注册的通道会在下次 attach 时补齐 | `npm run test:unit` 由迁移后的 10 fail 收敛回 **1 fail**（仅既存 search 语义） |
| **`register()` 重复注册幂等** | 注册中心是全局单例，测试进程内 `register*Handlers` 被多文件复用（`agent-persistence` 双次加载、`gate-e2e` 4 次调用）会触发"重复注册"抛错并使整批用例崩溃；改为幂等覆盖 + dev 告警。真正的启动后护栏改为 `lock()`（锁定后禁止任何新增注册） | `tests/ipc-contracts-v2.test.ts` 用例改为覆盖"setup 期幂等 + `lock()` 后拒绝"，通过 |
| 死契约 SSOT 修正 | `electron/ipc/contracts/autopilot.contract.ts` 原把通道硬编码为 camelCase（`'autopilot:getState'` / `'autopilot:setState'` / `'autopilot:clearLegacy'` / `'autopilot:syncLifecycle'`），而 `channels.ts` SSOT 实为 kebab-case（`'autopilot:get-state'` / `'autopilot:set-state'` / `'autopilot:clear-legacy'` / `'sync-autopilot-state'`）——两者永不相等，合约事实上失效（审计报告记为"全仓 0 引用 / P2-2"）。改为引用 `IPC_CHANNELS`，并让响应规则匹配 handler 真实返回的 `{ success, data }` 信封 | `tests/ipc-contracts-v2.test.ts` 的 `autopilot contracts validate stateKind` 仍通过（该用例只校验请求侧生命周期枚举，不校验 channel 字符串） |
| 受影响 SSOT | `ARCH-STANDARDS.md §3` 迁移注记（12→22，并修正包装器计数 18→20、直挂 19→7）、`verify-ipc-consistency.cjs`（门禁如实上报 22） | `npm run verify:consistency` 双绿 |

> **批量验证**：`tsc` 编译通过；`node --test tests/ipc-registry-plain-batch3-migration.test.ts` 全过（10 通道注册 / 自绑定 / `dispatch` 路由往返 / dev 契约校验 / `ACCOUNT.DISCONNECT` 空 `accountId` 仍返 400 / `assertRegistered` 启动门禁）；`npm run test:unit` → **246 tests / 245 pass / 1 fail**（仅既存 `search stage payload exposes structured degraded semantic metadata`，非本批引入）；`npm run verify:consistency` → IPC 22 + 文档 101 处交叉引用双绿。
>
> 说明：`ACCOUNT.CONNECT` 与 `AUTOMATION.START_CAMPAIGN` 在测试中**只断言"已登记"而不实际 dispatch**——前者需要 `event.sender`（WebContents）驱动沙箱会话，后者放行后会真实调用 n8n / Supabase（外部副作用）。

### IPC 注册中心迁移 · 第四批批次（P0-4 收口）

| 项 | 变更 | 验证 |
|---|---|---|
| license-service（6 通道） | `SYSTEM.GET_DEVICE_STATUS` / `LICENSE.GET_INFO` / `LICENSE.REQUEST_TRIAL` / `LICENSE.SUBMIT` / `LICENSE.VERIFY` / `LICENSE.CHECK_STATUS` 由直挂 `ipcMain.handle` 改为 `registerIpc()`；新增 `electron/ipc/contracts/license.contract.ts`（6 个契约，信封响应 + `anyRequestRule`，与 agent/autopilot/auth/account/automation 等同构，保留 handler 自带的 400/403 `code` 语义）；`registerHandlers` 末尾补 `registry.attach(ipcMain)` 自绑定 | 见下方「批量验证」 |
| `LICENSE.SUBMIT` / `LICENSE.VERIFY` 签名收窄 | handler 改为 `async (_event: unknown, payload: unknown)`，`SUBMIT` 内部 `const p = (payload \|\| {}) as { licenseKey?: string }` 收窄后取 `p.licenseKey`；`VERIFY` 收 `key: unknown` 后 `String(key)`——兼容 `strictFunctionTypes` 且保持编译干净 | `npm run build:electron:dev` 0 error |
| `SYSTEM.GET_DEVICE_STATUS` 改 async | 该 handler 原为非 async 箭头函数、直接返回对象；`registerIpc` 的 handler 类型要求 `Promise<O>`，故改为 `async () =>`（无外部副作用，仅读 machineId） | `build:electron` 编译通过 |
| `main.ts` `AUTOPILOT.SYNC_STATE` 收口 | 最后一处 plain 直挂迁移到 `registerIpc()`（沿用 `autopilotSyncLifecycleContract`，请求为 `{ lifecycle }` 对象）。preload `syncLifecycle` 把公开 API 收到的 `lifecycle` 字符串包成 `{ lifecycle }` 对象以匹配契约，**渲染层公开 API 与 `electron-api.ts` 调用形态不变**；主进程解包。契约真值化，避免"契约写 `{lifecycle}` 而线协议传裸字符串"的漂移 | `verify-ipc-consistency.cjs` 清单含 `AUTOPILOT.SYNC_STATE`；`tests/ipc-contracts-v2.test.ts` 的 `autopilot contracts validate stateKind` 仍通过 |
| **全部 plain 直挂清零** | 本批迁移 `license-service` 6 通道 + `main.ts` 1 通道后，剩余仅 20 处 Fail-Closed 授权包装器登记点（独立子项目，须保留授权语义 + 负向授权测试）。`verify-ipc` 迁移数 **22 → 29** | `npm run verify:consistency` IPC 29 + 文档 101 双绿 |
| 受影响 SSOT | `ARCH-STANDARDS.md §3` 迁移注记（22→29，并修正直挂计数 7→0、包装器 20 不变） | 同上 |

> **批量验证**：`tsc` 编译通过；`node --test tests/ipc-registry-license-migration.test.ts` 全过（6 通道注册 / 自绑定 / `dispatch` 路由往返 `GET_DEVICE_STATUS` / dev 契约校验 / `SUBMIT` 与 `VERIFY` 空激活码仍返 400 / `assertRegistered` 启动门禁）；`npm run test:unit` → **247 tests / 246 pass / 1 fail**（仅既存 `search stage payload exposes structured degraded semantic metadata`，非本批引入，与第三批基线一致）；`npm run verify:consistency` → IPC 29 + 文档 101 处交叉引用双绿；`npx eslint electron/services/license-service.ts` → 0 error（4 处 `any` 告警均为迁移前既有，与本批无关）。
>
> 说明：本批 `LICENSE.GET_INFO` / `LICENSE.REQUEST_TRIAL` / `LICENSE.CHECK_STATUS` 在测试中**只断言"已登记 + 自绑定"而不实际 dispatch**——三者放行后会真实调用 `refreshTier`（网络）/ `syncTrialAnchor`（注册表 / 文件 IO），属外部副作用，与第三批对 `ACCOUNT.CONNECT` / `AUTOMATION.START_CAMPAIGN` 的保守策略一致。

### IPC 注册中心迁移 · 第五批（Fail-Closed 包装器治理登记，P0-4 收口）

| 项 | 变更 | 验证 |
|---|---|---|
| `registerSecureIpc` 治理登记 | 包装器在保留原有 `ipcMain.handle` 真实绑定的同时，额外调用 `registry.register(channel, { contract: secureAnyContract, handler, skipAttach: true, skipValidation: true })`——把 20 处 Fail-Closed 通道也登记进注册中心（供 `assertAllRegistered()` 门禁覆盖）。生产绑定路径零变化（Fail-Closed 授权语义不变） | 见下方「批量验证」 |
| `ContractEntry.skipAttach` + `attach` 跳过 | `electron/ipc/contracts/types.ts` 的 `ContractEntry` 新增 `skipAttach?: boolean`；`registry.attach()` 对标记 `skipAttach` 的通道**不再重复绑定**到 `ipcMain`，避免 production 主进程触发 Electron "second handler" 报错 | `tests/ipc-registry-secure-wrapper.test.ts` 断言条目 `skipAttach === true` |
| `registerIpc` 支持 `skipAttach` + `secureAnyContract` | 便捷函数新增 `skipAttach` 选项；`registry.ts` 导出 `secureAnyContract`（请求/响应均 `any`，因包装器自身已做 401/403 信封，无需 registry 再校验） | `build:electron:dev` 0 error |
| `dumpRegistry` 暴露 `skipAttach` | 调试快照新增 `skipAttach` 字段，便于治理审计 | 同上 |
| `verify-ipc-consistency.cjs` 口径修正 | 报告由"经 `registry.registerIpc()` 注册: 29"改为"经 registry 注册（含包装器治理登记 skipAttach）: 49（29 显式迁移 + 20 包装器治理登记；0 处 plain 直挂）"——如实反映全部 49 invoke 通道已 registry-known | `npm run verify:consistency` 双绿 |
| 受影响 SSOT | `ARCH-STANDARDS.md §3`：明确 49 个 invoke 通道已全部 registry-known（0 plain 直挂），"all IPC must go through registry" 已达成事实态；`assertAllRegistered()` 进入"下一步启用"阶段 | 同上 |

> **批量验证**：`tsc` 编译通过；`node --test tests/ipc-registry-secure-wrapper.test.ts` 全过（通道进 registry + `skipAttach` 标记 + `ipcMain.handle` 绑定保留 + **Fail-Closed 被拒返回 403** + 授权通过放行）；`npm run test:unit` → **248 tests / 247 pass / 1 fail**（唯一失败仍为既存 `search stage payload…` 语义，与本批无关；第五批引入的 `agent-service` 迁移测试断言已同步更新为"CONTROL 治理登记进 registry 且仍 ipcMain 绑定"）；`npm run test:e2e`（`gate-e2e` AGENT.CONTROL Fail-Closed 日限）→ 1/1 通过；`npm run test:security-audit` → 6/6 通过；`npm run verify:consistency` → IPC 49（0 直挂）+ 文档 101 双绿；`npx eslint` 改动文件 0 error。

### IPC 注册中心迁移 · 第六批（启动门禁启用，P0-4 收官）

| 项 | 变更 | 验证 |
|---|---|---|
| `PUSH_CHANNELS` + `collectInvokeChannels()` | `electron/ipc/channels.ts` 新增 SSOT：显式列出 11 个**仅推送**通道（经 `webContents.send` 广播、无 invoke handler），并提供 `collectInvokeChannels()`——递归收集 `IPC_CHANNELS` 全部通道后排除推送集，精确返回 **49 个 invoke 通道**（声明 60 − 推送 11） | `tests/ipc-startup-gate.test.ts` 断言 `collectInvokeChannels().length === 49` |
| `assertAllRegistered()` 启动门禁启用 | `main.ts` 在 `whenReady()` 末尾（`registerIpcHandlers()` + `AUTOPILOT.SYNC_STATE` 登记完成后）调用 `registry.assertAllRegistered(collectInvokeChannels())`，随后 `registry.lock()`——运行期禁止新增注册，漏注册将在启动期即失败而非静默降级 | 同上（门禁通过 + `lock()` 后新增注册被拒） |
| 门禁**非空守卫**测试 | 新增 `tests/ipc-startup-gate.test.ts`：忠实复刻 `main.ts` 注册序列，证明 ①完整序列下 49 通道门禁通过、`lock()` 生效且此后新增注册被拒；②故意跳过 `registerAuthHandlers` 时 `assertAllRegistered` **抛错并指明缺失通道**——证明门禁不是空断言 | 2/2 通过 |
| 既存红灯修复（search 语义契约） | `tests/search-semantic-contract.test.js` 的 `未启用 AI 评分` 断言**停留在已抽离走的旧文件** `search-engine.tsx` 上（文案随组件抽离迁移至 `src/components/search/search-result-card.tsx`），属陈旧断言而非产品回归。已改为断言当前 SSOT **并补充透传链路**：`search-result-card.tsx` 含该文案 + `getLeadSettlementMeta(lead, { isStreaming, aiScoringSkipped })` + `search-engine.tsx` 透传 `aiScoringSkipped={aiScoringSkipped}`（断言数由 1 条增至 3 条，未削弱） | `npm run test:unit` → **250 tests / 250 pass / 0 fail**（既存红灯清零） |
| `main.ts` 迁移状态注释校正 | `registerIpcHandlers()` 末尾注释原称"handler 仍直挂 ipcMain / 门禁待启用"，与收官后事实不符，已改为如实描述（全部 invoke 通道经 registry 登记、plain 直挂清零、门禁在 `whenReady()` 末尾触发） | `npm run format` 全绿 |
| 受影响 SSOT | `ARCH-STANDARDS.md §3`：由"下一步启用门禁"改为"**迁移已完成 + 启动门禁已启用**"，并补充 `PUSH_CHANNELS` 与 `PUSH_RE` 扫描器互为可观测校验的约定 | `npm run verify:consistency` 双绿 |

> **批量验证**：`tsc` 编译 0 error；`npm run test:unit` → **250 tests / 250 pass / 0 fail**（新增 startup-gate 2 条 + 既存 search 语义红灯已修复，全量转绿）；`npm run test:ipc`（契约 sweep）→ 1/1；`npm run test:e2e`（`gate-e2e` AGENT.CONTROL Fail-Closed 日限）→ 1/1；`npm run test:security-audit` → gateway 3/3 + env 3/3 + bypass 6/6 全过；`npm run verify:consistency` → IPC **49（0 直挂）** + 文档交叉引用 **101** 双绿；`npm run lint` → **0 error**（252 warning 为既存）；`npm run format` → 全量 prettier 通过。

### L0 发布阻断修复 · 合并键优先级（L0-4/F1）+ 渲染层漏导入 P0 + src 类型检查门禁

| 项 | 变更 | 验证 |
|---|---|---|
| **P0：`useLeadsStore` 漏导入 → 搜索结果渲染崩溃** | `src/components/search/search-result-card.tsx:113` 调用 `useLeadsStore(...)`，但该文件仅有 `import type { LeadSearchResult } from '@/store/leads-store'`（**类型导入，编译期被擦除**）——渲染该卡片即抛 `ReferenceError: useLeadsStore is not defined`，搜索结果列表整体崩溃（核心功能）。已改为值导入 `import { useLeadsStore, type LeadSearchResult }` 并加注释警示不可改回 `import type` | `npm run typecheck` 相关 2 error → 0 |
| **L0-4/F1：评分合并键改为「条件优先级」** | `findScoredLeadIndex`（`src/store/leads-store.ts`）原为**逐条位置优先**：对同一条 lead 依次试 leadKey → website → company 并立即 return，于是靠前条目的**弱匹配**（company/website）会**遮蔽**靠后条目的**强匹配**（leadKey）——评分被写到错误条目上，真正目标线索的分数始终为 undefined，即审计所述"评分更新静默丢弃路径"（同名公司 / 共用官网的采集场景极易触发）。改为每一级条件先全量扫描（leadKey → website → company），未命中才降级 | 新增 3 条用例，**先红后绿**（证明缺陷真实存在后再修） |
| 死代码清理 | 移除 `use-search-engine.ts` 中自 P1-3 起不再被调用的 `mergeTopRankedResults`（已被 `updateScoredLead` + `reinsertTopRanked` 取代，后者按 leadKey 定位） | eslint warning 252 → 251 |
| **L0-2/B2 补齐回归防护** | `browser-resolver.ts`（KONE_BROWSER_PATH → Chrome → Edge → puppeteer 默认）核心实现虽已落地，但**零单测覆盖**，packaged-smoke 亦缺"Agent 浏览器可启动"断言。新增 `tests/business-logic/agent-browser-resolver.business.test.js`（**9 条**，注入 fs / puppeteer 桩，无需真实浏览器）：env 优先 · 坏路径回退 · Chrome 优先于 Edge · Edge 兜底 · 无浏览器回退默认 · 目录不得当作可执行文件 · **无可用浏览器时抛中文可操作指引（严禁假成功）** · **已定位浏览器时如实抛原始错误（不伪造指引）** · label 可审计 + extraArgs 透传 | 9/9 通过，已并入 `test:unit` |
| **根因治理：新增 src 类型检查门禁** | 上述 P0 之所以逃过全部既有门禁，根因是：**vite build 用 esbuild 仅转译、不做类型检查，而 CI 只对 electron 做 tsc，从不检查 src**。新增 `npm run typecheck`（`tsc --noEmit -p tsconfig.json`）并接入 CI `quality` 关卡，使"漏导入 → 运行时 ReferenceError"这一类缺陷在 CI 即被拦截 | `npm run typecheck` → 0 error；CI `quality` job 已含该步骤 |

> **批量验证**：`npm run typecheck` → **0 error**（修复前 3 处：2 处漏导入 + 1 处死代码）；`npm run test:unit` → **253 tests / 253 pass / 0 fail**（新增 3 条合并键用例）；`npm run test:ipc` 1/1；`npm run test:e2e` 1/1；`npm run test:e2e-smoke`（permission-lock）7/7；`npm run test:security-audit` gateway 3/3 + env 3/3 + bypass 6/6；`npm run verify:consistency` 双绿；`npm run lint` **0 error**（251 warning 为既存）；`npm run format` 通过；`npx vite build` 成功。

### L2 诚实化修复 · automation 伪进度步进（`automation-workflow.tsx`）

| 项 | 变更 | 验证 |
|---|---|---|
| **移除虚构进度条** | `src/components/automation-workflow.tsx` 的 `handleVerifyEmails` 原用 `setInterval` + `Math.random() * 15` 模拟 0→90% 进度，而 `verifyEmails` 是**一次性批量 IPC**、主进程不推送任何逐条进度事件——该百分比向用户展示**虚构信息**，违反宪法"严禁假成功"。已移除定时器与 `Math.random()`，**不再维护虚构百分比** | `npm run typecheck` 0 error；`npm run test:unit` 262/262 |
| 状态语义诚实化 | 原 `verifyProgress`（百分比）状态改名并复位为 `verifyingCount`（真实待校验数量）：进入时 `setVerifyingCount(emails.length)`，`finally` 中 `setVerifyingCount(0)`；`handleVerifyEmails` 不再有任何进度伪造分支 | 同上 |
| 渲染块改为不确定态 | 进度条 UI 由"虚构百分比 + 进度条"改为**不确定态**：spinner + 文案 `正在校验 N 个邮箱…（批量请求，暂无可观测的逐条进度）`，明确告知用户当前无法展示真实逐条进度，而非用假数字填充 | `npx vite build` 成功；`npm run format` 全绿 |

> **批量验证**：`npm run typecheck` → 0 error；`npm run test:unit` → **262 tests / 262 pass / 0 fail**；`npm run lint` → 0 error（251 warning 为既存）；`npm run format` → 全量 prettier 通过；`npx vite build` 成功。

### L2 诚实化修复 · CSV 导出评分判空（P2-4）

| 项 | 变更 | 验证 |
|---|---|---|
| **CSV 导出 `undefined%` 虚构评分** | `src/components/leads-table.tsx` 的 CSV 导出行原直接用 `` `${lead.matchScore}%` ``，当 `matchScore` 为 `undefined`（待评估）时向用户导出 `undefined%` 的虚构/错误评分列——而线索表 UI 列已显示「待评估」，导出与界面口径不一致（违反诚实性原则）。已将导出口径抽为纯函数 `formatMatchScoreForExport`（`src/lib/lead-mappers.ts`，与 UI 同判空逻辑）：数值 → `N%`，非数值 → `待评估`，并在导出处调用 | `npm run typecheck` 0 error；`npm run test:unit` 265/265 |
| 可观测回归防护 | 新增 `tests/business-logic/lead-export-matchscore.business.test.js`（**3 条**：数值→`N%` / `undefined`→`待评估` / `null`→`待评估`），沿用 `ts.transpileModule` + `vm` 加载器，无需真实 Electron | 3/3 通过，已并入 `test:unit` |

> **批量验证**：`npm run typecheck` → 0 error；`npm run test:unit` → **265 tests / 265 pass / 0 fail**（新增 3 条）；`npm run lint` → 0 error（251 warning 为既存）；`npm run format` → 全量 prettier 通过；`npx vite build` 成功。

### L2 诚实化修复 · 导航徽标准入对齐真实授权（P2-5）

| 项 | 变更 | 验证 |
|---|---|---|
| **侧边栏过严 premium 门禁 → 对齐 dashboard 真实准入** | `app-sidebar.tsx` 的 `premiumNavItems` 原把 `accounts`/`agents`/`automation`/`team-dashboard` **统一**标 `premium:true`+「高级」徽标。但 `dashboard-page.tsx:192-196` 的真实门禁为：`accounts` 经 `canAccessAccountsWorkspace`（含 basic/trial）开放；`agents`（AI 销售团队）按 `README.md:61` 授权矩阵对 trial/basic/premium/enterprise 全开放（仅日限额不同，由 agents-panel 强制）；仅 `automation`/`team-dashboard` 为 premium-only。原侧边栏的 accounts/agents premium 门禁是相对真实门禁的**过严残留**，造成「徽标说高级、实际 basic 可进」的口径不一致（审计 U6）。已将 accounts/agents 的 `premium`/`badge` 移除，保留 automation/team-dashboard 的 premium 门禁 | `npm run typecheck` 0 error；`npm run test:unit` 266/266 |
| 守护真实 premium-only 两项 | automation / team-dashboard 的 premium 门禁与「高级」徽标保持不变，防止回归放宽授权 | 同上 |
| 可观测回归防护 | `tests/ui-ux-alignment-contract.test.js` 新增 P2-5 断言：accounts/agents 不再含 `premium:true` 与「高级」徽标；automation/team-dashboard 仍为 `premium:true`（防回归） | P2-5 子测试 1/1 |

> **说明（授权红线）**：本改动**不削弱任何授权**——真实执行门禁在 `dashboard-page.tsx`（`shouldBlockPremiumPage`/`shouldBlockAccountsPage`）与 `agents-panel` 日限额；侧边栏 premium 标志仅是导航控件开关。移除 accounts/agents 的过严标志后，其可访问性与 dashboard 已落地的真实准入一致，恰是消除「过严不一致」，而非放宽许可证。
>
> **批量验证**：`npm run typecheck` → 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**（新增 1 条 P2-5 断言）；`npm run lint` → 0 error（251 warning 为既存）；`npm run format` → 全量 prettier 通过；`npx vite build` 成功。

### 架构重构 · O1 拆分 `search-service.ts`（P1：纯文本/URL 工具外提）

| 项 | 变更 | 验证 |
|---|---|---|
| 蓝图 | 新增 `KONE-V1.3-search-service拆分蓝图-2026-09-24.md`（门面策略 + 7 阶段计划 + 源码断言/循环依赖约束清单） | 文档快照，豁免一致性校验 |
| **P1 纯工具外提** | 新建 `electron/services/search/text-utils.ts`，从 `search-service.ts` 抽出 **14 个无副作用纯函数**（`getHostFromUrl`/`normalizeLlmJsonText`/`extractJsonObjectFromText`/`sanitizePlainText`/`normalizeWebsiteUrl`/`normalizeGeoText`/`extractLocationTerms`/`extractDomainFromUrl`/`extractEmailsFromText`/`extractPhonesFromText`/`mergePromptParts`/`mergeUniqueValues`/`clampInt` + 内部 `LOCATION_TERM_ALIASES`）；`search-service.ts` 改为 import。**行为逐字不变**，`search-service.ts` 3873 → **3773 行** | `npm run typecheck` 0 error；`test:unit` 266/266 |
| 约束核对 | 迁移前核实 14 个符号**零外部引用**、**无源码文本断言**（4 个源码断言测试的对象均不在此集合） | 迁移前 grep 取证 |
| 后续阶段 | P2 常量/并发 → P3 Scout → P4 评分/意图 → P5 富化/分析 → P6 作业注册表（解循环依赖）→ P7 编排/门面收敛；详见蓝图 | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**（纯搬运，零回归）；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（251 warning 既存）。

### 架构重构 · O1 拆分 `search-service.ts`（P2：词表/模式 + 并发助手外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P2 词表/模式外提** | 新建 `electron/services/search/constants.ts`：`SCOUT_NEGATIVE_TERMS` / `SCOUT_B2B_TERMS` / `KEYWORD_STOP_TERMS` / `OMNI_CONTROL_TERMS` / `TRASH_LEAD_PATTERNS` | `npm run typecheck` 0 error |
| **P2 并发助手外提** | 新建 `electron/services/search/concurrency.ts`：`runLimitedConcurrency` / `mapLimitedConcurrency`（P1-2 结果版，按索引回填） | 同上 |
| **蓝图收敛性修订** | **8 个宪法常量刻意保留在 `search-service.ts`**——`verify-doc-consistency.cjs` 以该文件为代码侧读取源做宪法常量比对，保持单一代码事实源，避免为纯搬迁改动治理脚本。已写入 `constants.ts` 顶部注释 | `npm run verify:consistency` 双绿 |
| 测试同步（不削弱断言） | `search-fanout-concurrency.business.test.js` 新增 `concurrencySource`，`mapLimitedConcurrency` **定义**断言改读 `search/concurrency.ts`；**调用点**与 `SEARCH_FANOUT_CONCURRENCY` 定义断言仍读 `search-service.ts` | fanout 4/4 通过 |
| **新发现 O13（架构债）** | `runLimitedConcurrency` 在 `search-service.ts` / `agent-service.ts` / `sandbox-service.ts` **三处重复实现**（未共享）。后续应上提为 `electron/utils/concurrency.ts` 共享模块消除重复——已记入优化清单，本阶段先做 search 域收敛 | 迁移前 grep 取证 |
| 结果 | `search-service.ts` 3773 → **3676 行**（累计 P1+P2：3873 → 3676，−197 行） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**（纯搬运 + 测试读取目标同步，零回归）；`node --test tests/business-logic/search-fanout-concurrency.business.test.js` → 4/4；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（251 warning 既存）。

### 架构重构 · O1 拆分 `search-service.ts`（P3：Scout 预筛/准入外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P3 Scout 外提** | 新建 `electron/services/search/scout.ts`（198 行）：`ELIGIBILITY_HARD_VETO_RULES`（P0-2 Stage 0.5 一票否决规则表）+ `matchesProductTerm`（词边界产品词匹配）+ `computeEligibilityVeto` + `isTrashLead` + `extractKeywordAnchors` + `computeScoutRelevance` | `npm run typecheck` 0 error |
| 公开导出面保留 | `search-service.ts` 以 `export { computeEligibilityVeto, matchesProductTerm }` 保留原公开 API（`eligibility-gate` 测试经编译产物访问 `searchService.*` 不受影响） | eligibility-gate **8/8** 通过 |
| 常量导入收敛 | `KEYWORD_STOP_TERMS`/`SCOUT_B2B_TERMS`/`SCOUT_NEGATIVE_TERMS`/`TRASH_LEAD_PATTERNS` 已随 Scout 迁移，`search-service.ts` 仅保留仍在用的 `OMNI_CONTROL_TERMS` 导入 | `npm run lint` 0 error（无未使用导入） |
| **保留原位** | `COUNTRY_TLD_MAP` 被 `ui-ux-alignment-contract` 源码断言 → 刻意保留在 `search-service.ts` | `verify:consistency` 双绿 |
| 结果 | `search-service.ts` 3676 → **3493 行**（累计 P1+P2+P3：3873 → 3493，−380 行） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`node --test tests/business-logic/eligibility-gate.business.test.js` → 8/8；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（251 warning 既存）。

### 架构重构 · O1 拆分 `search-service.ts`（P4：意图/语言解析外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P4 意图/语言外提** | 新建 `electron/services/search/intent.ts`（206 行）：`SearchIntentMutation` 类型 + `LANGUAGE_LABELS` + `COUNTRY_LANGUAGE_MAP` + `resolveEmailLanguage` + `normalizeIntentCountry` + `stripOmniControlTerms` + `B2B_ROLE_TERMS` + `fallbackMutateB2BKeywords` + `crossProductB2BKeywords` + `buildIntentMutationPrompt` + `parseIntentMutation` | `npm run typecheck` 0 error |
| 保留原位 | `mutateSearchIntent`（异步 LLM 调用，属编排层）**刻意留待 P7** 编排阶段，本轮不动 | — |
| 公开导出面保留 | `search-service.ts` 以 `export { LANGUAGE_LABELS }` 保留原导出符号 | 编译通过 |
| 常量导入收敛 | `OMNI_CONTROL_TERMS` 唯一使用者 `stripOmniControlTerms` 已迁出 → 移除 search-service 中该导入（避免未使用导入告警） | `npm run lint` 0 error（251 warning，与基线持平） |
| 结果 | `search-service.ts` 3493 → **3311 行**（累计 P1–P4：3873 → 3311，**−562 行**） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（251 warning，与 P3 基线持平——迁移引入的 `OMNI_CONTROL_TERMS` 未使用告警已同步清除）。

### 架构重构 · O1 拆分 `search-service.ts`（P5：评分基元与提示词外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P5 评分外提** | 新建 `electron/services/search/scoring.ts`（185 行）：`computeIcpMatchScore`（Stage-1 40/30/20/10 预筛分）+ `normalizeOpportunityScore`（Stage-2 机会分）+ `applySchemaDefaults`（白名单序列化）+ `mapHttpError` + 评分提示词（`buildSearchScoringSystemPrompt`/`buildUniversalIcpPrompt`/`buildSearchScoringPrompt`） | `npm run typecheck` 0 error |
| **共享类型外提** | 新建 `electron/services/search/types.ts`（58 行）：本地 `SearchExecuteResult` + `OpportunityScore`。**根因**：`SearchExecuteResult` 是 search-service 的**本地镜像类型**（`id: string`、含 `reason?`），与 `src/shared/ipc-contracts.ts` 同名类型**不同**（后者 `id?: string`、无 `reason`）——子模块无法直接复用 ipc 版，故外提为 search 域共享类型 | 编译 0 error |
| 公开导出面保留 | `export { buildSearchScoringPrompt, computeIcpMatchScore, normalizeOpportunityScore, type OpportunityScore }`（原导出符号，测试经编译产物访问不受影响） | `test:unit` 266/266 |
| 死代码顺带清理 | `buildSearchScoringSystemPrompt` 原为 search-service 内**未被调用**的函数（lint 既存告警），外提至 scoring.ts 为导出后告警消除 | `npm run lint` 251 → **250**（−1） |
| 导入收敛 | 迁移后清理 search-service 中 3 处未使用导入（`clampInt` / `CustomsData` / `AgentStatus`） | 同上 |
| 结果 | `search-service.ts` 3311 → **3107 行**（累计 P1–P5：3873 → 3107，**−766 行**） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` **0 error（250 warning，较基线 −1）**。

> **新发现 O14（架构债）**：`SearchExecuteResult` 存在**两份定义**（`src/shared/ipc-contracts.ts` 与 search-service 本地镜像），字段不一致（`id` 可选性、`reason` 有无）。P1-3 注释要求二者对齐，但仍是两处维护——应统一为单一 SSOT（ipc-contracts），属后续独立重构项。本轮仅无损外提，未改变类型语义。

### 架构重构 · O1 拆分 `search-service.ts`（P6：日志探针 + LLM 结果抽取/合并外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P6 探针外提** | 新建 `electron/services/search/probe.ts`（35 行）：`isProductionRuntime` / `probeLog` / `probeError` / `probeLlmRequest` / `probeLlmCrash` / `verifyLlmProbeFailure`（生产静默，开发期结构化探针） | `npm run typecheck` 0 error |
| **P6 LLM 结果外提** | 新建 `electron/services/search/llm-results.ts`（114 行）：`extractLlmResults`（LLM 响应解析 + 白名单序列化 + 机会分归一）+ `mergeLlmResultsWithCandidates`（候选/评分按域名→公司名合并） | 同上 |
| 类型收敛 | `mergeLlmResultsWithCandidates` 原参类型 `ReturnType<typeof normalizeSearchCandidates>` 改为等价结构类型 `NormalizedCandidate`（`Partial<SearchExecuteResult> & { company; website }`）——避免子模块反向依赖 search-service（`normalizeSearchCandidates` 依赖宪法常量 `MAX_SEARCH_CANDIDATES`，仍留 search-service） | 编译 0 error |
| 公开导出面保留 | `export { verifyLlmProbeFailure } from './search/probe'` | `test:unit` 266/266 |
| 结果 | `search-service.ts` 3107 → **2980 行**（累计 P1–P6：3873 → 2980，**−893 行**；首次跌破 3000） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（250 warning，与 P5 持平）。

### 架构重构 · O1 拆分 `search-service.ts`（P7a：深度分析/回复教练/知识库外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P7a 分析域外提** | 新建 `electron/services/search/analysis.ts`（352 行）：`getAnalysisConfigError` / `buildAnalysisErrorResponse` / `shouldUseDevMockAnalysis` / `getAnalysisFailureSemantic` / `buildDevMockAnalysisData` / `buildAnalysisSystemPrompt` / `buildReplyCoachSystemPrompt` / `buildAnalysisPrompt` / `buildReplyCoachPrompt` / `parseStructuredAnalysisResponse` / `parseReplyCoachResponse` / `pickRelevantKnowledgeEntries` | `npm run typecheck` 0 error |
| 公开导出面保留 | `export { parseStructuredAnalysisResponse }` | — |
| 导入收敛 | 清理 4 处变为未使用的导入（`app` / `AnalysisSemanticMeta` / `AnalysisSemanticCode` / `normalizeLlmJsonText`） | `npm run lint` 0 error（250 warning 持平） |
| **源码断言测试同步** | `tests/search-semantic-contract.test.js` 的分析语义断言（`semantic: AnalysisSemanticMeta` / `code: 'missing_llm_key'` / `degraded: true` / `settingsActionable: true`）改读 `search/analysis.ts`——**断言强度不变**，仅迁移读取目标（与既有"随抽离迁移读取目标"惯例一致） | `test:unit` 266/266 |
| 结果 | `search-service.ts` 2980 → **2647 行**（累计 P1–P7a：3873 → 2647，**−1226 行**） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（250 warning 持平）。
>
> **过程记录**：P7a 首次提交前复跑全量门禁时**捕获 1 个测试失败**（`search-semantic-contract` 的源码断言因分析语义迁出 search-service 而失效）——已按蓝图约定同步测试读取目标后恢复 266/266。这印证了"每阶段复跑全量门禁 + 源码断言同步"的必要性。

### 架构重构 · O1 拆分 `search-service.ts`（P7b：宪法常量外提 + 门禁同步）

| 项 | 变更 | 验证 |
|---|---|---|
| **常量外提** | 8 个**宪法常量**（`MAX_SEARCH_CANDIDATES`/`SEARCH_CHANNEL_FETCH_LIMIT`/`SEARCH_TARGETED_LEAD_LIMIT`/`SEARCH_LLM_SCORE_LIMIT`/`SEARCH_LLM_CONCURRENCY`/`SEARCH_ENRICH_CONCURRENCY`/`SEARCH_FANOUT_CONCURRENCY`/`MAX_WEBSITE_TEXT_FOR_LLM`）+ 3 个时限常量（`SERPAPI_RETRYABLE_STATUS`/`SEARCH_LLM_TIMEOUT_MS`/`WEBSITE_PROBE_TIMEOUT_MS`）从 `search-service.ts` 迁至 `search/constants.ts` | `npm run typecheck` 0 error |
| **门禁脚本同步** | `scripts/verify-doc-consistency.cjs` 的宪法常量比对读取源从 `search-service.ts` 改为 `search/constants.ts`（含注释与失败信息文案） | `npm run verify:consistency` 双绿（宪法常量比对 8 项通过） |
| **源码断言测试同步** | `search-fanout-concurrency`（`SEARCH_FANOUT_CONCURRENCY` 定义）与 `search-resilience-contract`（`SERPAPI_RETRYABLE_STATUS`）改读 `search/constants.ts`——**断言强度不变**，仅迁移读取目标 | fanout 4/4、resilience 2/2 |
| 动因 | `trimWebsiteTextForLlm`（用 `MAX_WEBSITE_TEXT_FOR_LLM`）与 `WEBSITE_PROBE_TIMEOUT_MS` 被**富化模块（待迁）与 search-service 共同消费**，必须外提为共享常量（为 P7c 富化外提扫清障碍） | — |
| 结果 | `search-service.ts` 2647 → **2641 行**（常量净外提；累计 P1–P7b：3873 → 2641，**−1232 行**） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（250 warning 持平）。

### 商用阻断项 B-1/B-5 解除 · 绕锁打包 + 打包冒烟通过

| 项 | 变更 | 证据 |
|---|---|---|
| **B-1 安装包产物** | `release/win-unpacked/resources/app.asar` 被系统级文件锁占用（无进程持有、仅该文件不可动）导致 `npm run dist` 无法重建。**改用替代输出目录绕过锁**：`npx electron-builder --win nsis -c.directories.output=release-build` **成功产出** | `release-build/Kone-Intellect-Setup-1.3.0.exe`（**89.7 MB NSIS 安装包**）+ `release-build/win-unpacked/KoneAI.exe`（188.8 MB） |
| **B-5 打包冒烟** | `scripts/packaged-smoke.cjs` 增加 `KONE_PACKAGED_ROOT` 环境变量（默认 `release`，非削弱改动），使冒烟可指向替代输出目录 | `booted: true` / `activationScreenVisible: true` / `preloadBridgeVisible: true` → **通过判据满足**（`booted && bridge && (activation || dashboard)`），退出码 0 |
| 运行时证据 | 打包版真实启动：CrashReporter 初始化、AutoUpdater 按离线设计跳过、BackupService 自动备份完成；stderr 仅有无害项（`NODE_OPTIONS` 提示、旧备份校验和、`fsync EPERM` 降级、机器码读取被安全策略拒绝后的回退） | `tests/packaged-smoke-report.json` |
| 卫生 | `.gitignore` 新增 `release-build/` | — |

> **意义**：此前终审报告判定的 5 个商用阻断项中，**B-1（无安装包）与 B-5（打包冒烟未验证）两项解除**——证明"打包链路本身可用，此前仅被环境文件锁阻塞"。剩余阻断：B-2 代码签名（需证书）、B-3 云协同闭环（待立项）、B-4 持久化规模化（待立项）。

### 商用收尾 · 绕锁打包固化 + B-2/B-4 技术方案

| 项 | 变更 |
|---|---|
| 绕锁打包固化 | `scripts/packaged-smoke.cjs` 支持**位置参数**指定输出目录（`node scripts/packaged-smoke.cjs release-build`；优先级：参数 > `KONE_PACKAGED_ROOT` > `release`）；新增 npm 脚本 `dist:alt`（绕锁打包到 `release-build/`）与 `test:smoke:alt`（打包 + 冒烟一步到位）。实测 `node scripts/packaged-smoke.cjs release-build` → 退出码 0、判据满足 |
| B-2/B-4 方案 | 新增 `KONE-V1.3-B2签名与B4持久化技术方案-2026-09-25.md`：B-2 代码签名接入（证书选型 OV/EV + electron-builder 配置 + CI secret + `signtool verify` 验证，外部依赖仅证书）；B-4 持久化规模化（单 JSON → better-sqlite3 + 版本化迁移，M1 双写 → M2 读切换 → M3 首启迁移 → M4 收敛，约 10 人天） |

> **验证**：`node ./scripts/packaged-smoke.cjs release-build` → 退出码 0（`booted/activationScreenVisible/preloadBridgeVisible` 均 true）。

### 商用加固 · 覆盖率门禁（G2）+ 依赖安全扫描（G3）+ 签名预备（B-2）

| 项 | 变更 | 验证 |
|---|---|---|
| **G2 覆盖率门禁** | 新增 `npm run test:coverage`：用 **Node 22 内置** `--experimental-test-coverage`（**无需 c8**，规避镜像限制），排除 `tests/**`/`node_modules/**`，并设**阈值门禁** `--test-coverage-lines=65 / branches=60 / functions=64`。接入 CI 新 job `coverage` 并纳入汇总 Gate | 实测 **266/266**，源码覆盖率 **行 67.72% / 分支 62.40% / 函数 66.64%**，阈值通过 |
| **G3 依赖安全扫描** | 新增 `.github/dependabot.yml`（npm + github-actions，weekly，分组）。**动因**：本仓库 npm 镜像（registry.npmmirror.com）**不实现 `/-/npm/v1/security/*` 审计端点**，`npm audit` 无法运行 → 改由 GitHub 侧原生扫描 | YAML 校验通过 |
| **B-2 签名预备（非破坏式）** | 新增 `electron-builder.sign.cjs`（在基础配置上叠加 Authenticode 签名，**不破坏未签名构建**）+ `scripts/verify-signature.cjs`（工具不可用时优雅 WARN；`--strict` 供证书到位后 CI 硬门禁）+ npm 脚本 `dist:signed` / `verify:signature` | 实测：非 strict → WARN + exit 0；strict → exit 1 |

> **验证**：`npm run test:coverage` → 266/266、覆盖率达标；`node scripts/verify-signature.cjs release-build` → WARN+exit 0；`--strict` → exit 1；CI YAML 解析通过（jobs 含 `coverage`，gate.needs 已含）。
>
> **说明**：B-2 的 `dist:signed` 在**证书到位前无法本地验证**（无证书 electron-builder 会因找不到 `certificateFile` 报错），属"预备就绪、待证书"。

### 商用加固 · 渲染进程沙箱开启（审计 L1）

| 项 | 变更 | 验证 |
|---|---|---|
| **可行性评估** | `window-service.ts` 原 `sandbox: false`。评估结论：`sandbox: true` 要求 preload **不得 require 本地模块**；实测 preload **零 Node API 依赖**（仅 `contextBridge`/`ipcRenderer`），但编译产物 `require("../electron/ipc/channels")`（本地）→ 需先自足化 | 取证 |
| **preload 自足化** | 新增 `npm run bundle:preload`（esbuild 打包 preload 为单文件、`--external:electron`、内联 `IPC_CHANNELS`），并入 `build:electron:dev` / `build:electron` | 产物仅 `require("electron")`，无本地 require |
| **开启沙箱** | `webPreferences.sandbox: false → true`（`contextIsolation: true` / `nodeIntegration: false` 保持不变） | 见下 |
| **回归防护** | 新增 `tests/preload-sandbox-contract.test.js`（3 条）：① window-service 沙箱开启且隔离不退化；② preload 源码零 Node API；③ 编译产物无本地 require | 3/3 通过 |
| **真实运行时验证** | 全新打包（`release-verify`，00:38 新鲜构建）后跑**打包冒烟**：`booted / activationScreenVisible / preloadBridgeVisible` 均 **true** —— 证明**沙箱下 preload 桥接仍可用** | 冒烟通过（exit 0） |

> **验证**：`npm run test:unit` → **269 tests / 269 pass / 0 fail**（+3）；`verify:consistency` 双绿；`lint` 0 error（250 warning）；`format` 通过；打包冒烟 `preloadBridgeVisible: true`。
>
> **说明**：`release/`、`release-build/`、`release-verify/` 三个输出目录均被同一"app.asar 文件锁"现象影响（打包版启动后由 OS/安全软件持有），故每次验证使用**全新输出目录**绕过；`.gitignore` 已收录三者。

### 商用加固 · 结构化日志与滚动落盘（审计 G1「可观测性」）

| 项 | 变更 | 验证 |
|---|---|---|
| **结构化 logger** | 新增 `electron/utils/logger.ts`：`createLogger(module)`（级别 + 模块标签 + ISO 时间戳 + 元数据，级别阈值由 `KONE_LOG_LEVEL` 控制，生产默认 info / 开发 debug） | 单测 5/5 |
| **console 文件镜像（低侵入高覆盖）** | `initFileLogging(logDir)` 包装既有 `console.{log,info,warn,error}` → **散落在 12 个服务的 console 调用无需逐个改写**即自动落盘；滚动文件 `$userData/logs/kone-YYYYMMDD.log`，保留 7 天（超期自动清理） | 见下 |
| **接入启动流程** | `main.ts` 在 userData 覆盖之后调用 `initFileLogging(app.getPath('userData'))` | 编译通过 |
| **回归防护** | 新增 `tests/business-logic/logger.business.test.js`（5 条）：阈值解析 / 级别过滤 / 滚动命名 / 结构化行格式 / 循环引用元数据不抛错 | 5/5 通过 |

> **验证**：`npm run test:unit` → **274 tests / 274 pass / 0 fail**（+5）；`verify:consistency` 双绿；`lint` 0 error；`format` 通过；打包冒烟确认 `$userData/logs/kone-*.log` 实际落盘。

### 已知未完成（不对外宣称）

- IPC 注册中心迁移：**已收官**。49/49 invoke 通道全部 registry-known（29 经 `registerIpc()` 显式迁移 + 20 处 Fail-Closed 包装器治理登记 `skipAttach`，**0 处 plain 直挂**），且 `assertAllRegistered()` 启动门禁已在 `main.ts` 启用并配套非空守卫测试（`tests/ipc-startup-gate.test.ts`）；"all IPC channel registration must go through registry" 已由**事实态**升级为**门禁强制态**（漏注册将在启动期抛错）。剩余为可选增强：`secureAnyContract` 占位合约未来可逐步替换为真实契约以启用响应校验。
- 云端协同（审批 / 二次门禁 / 投递 / 抑制 / Webhook / 回写）仍为**目标态**
- 持久化仍为单 JSON 文件，无线索池规模化方案（SQLite 替代方案待立项）
- 流式评分增量更新已落地**数据层 + 组件层**：`updateScoredLead` 单点更新 + `searchResultsByKey` 索引，且 `SearchResultCard` 现已按 `leadKey` 订阅自身切片（`React.memo` + 父级 `useCallback` 稳定化），流式评分增量更新时仅被更新的卡片重渲染
- **L0 发布阻断项进度**：L0-4（F1 合并键）**已闭环**；L0-3（smtpPass 加密）经核实前期已完成（`SECRET_KEYS.EMAIL_SMTP_PASS` + secret-manager，user_config 仅作旧安装明文回退）；L0-2（Agent 浏览器打包 B2）核心实现已存在，**本轮补齐 9 条回归防护**（未做的剩余项：packaged-smoke 的"Agent 浏览器可启动"断言需打包环境，见下条）；L0-1（全量验证门禁）**仅剩打包冒烟一项未跑通**（见下条）。
- **打包冒烟（`npm run test:smoke`）仍被环境阻塞，非代码问题**：`release/win-unpacked/resources/app.asar` 被系统级进程独占。经核实：① 无任何 Electron/Kone 进程运行（tasklist 仅环境 node）；② 同目录可自由新建/删除其他文件，仅该文件不可改名或删除；③ `npm run build:electron`（tsc + 混淆 60 文件）**成功**。electron-builder 报错 `remove ... app.asar: The process cannot access the file because it is being used by another process`（`EnsureEmptyDir` 阶段）。需在该文件锁释放后的环境执行。
- **本轮已闭环（自"未完成"移除）**：① 搜索扇出并发已在 P1-2 以 `SEARCH_FANOUT_CONCURRENCY = 3` 作为独立并发域收敛，不再"无上限"；② lint / format 脚本引号 bug 已修复，全量 prettier 已归一，`format` 门禁由"假绿"转为真正校验通过；③ L0-4/F1 流式评分合并键改为条件优先级（弱匹配不再遮蔽 leadKey 强匹配），并补 3 条回归用例；④ 修复 `search-result-card.tsx` 漏值导入 `useLeadsStore` 导致的搜索结果渲染 `ReferenceError`；⑤ 新增 `npm run typecheck` 并接入 CI，补上"src 从不类型检查"这一门禁盲区；⑥ L2 `automation-workflow.tsx` 移除 `setInterval` + `Math.random()` 虚构进度条，改为真实待校验数量 + 不确定态（spinner），杜绝向用户展示假进度；⑦ P2-4 `leads-table.tsx` CSV 导出原先输出 `undefined%`（待评估线索），改为抽纯函数 `formatMatchScoreForExport` 与 UI 同口径输出「待评估」，并补 3 条单测；⑧ P2-5 导航徽标准入对齐真实授权——`app-sidebar.tsx` 移除 accounts/agents 过严的 premium 门禁与「高级」徽标（对齐 `dashboard-page.tsx` 真实准入 + `README.md:61` 授权矩阵），保留 automation/team-dashboard 的 premium 门禁，并补回归断言
