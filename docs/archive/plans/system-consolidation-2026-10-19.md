# Kone V1.4 全项目系统梳理与文档版本一致性审计报告

> **审计日期**：2026-10-19
> **审计基线**：`main` @ `5dcf509`（本报告与两处文档修复单独提交）
> **版本真相（成文时）**：`package.json` = `1.4.36`（后续已升至 `1.4.37`）
> **审计范围**：491 个受控文件（361 个代码文件 / 75 份 Markdown）、183 次提交、262 个不可达 Git 快照、1 个 stash、本机同名目录与发布归档

---

## 0. 最终判定

| 问题 | 判定 | 关键依据 |
|---|---|---|
| V1.4 是否真实存在？ | **是，且是当前代际** | `package.json 1.4.36`；CHANGELOG `[1.4.29]…[1.4.36]`；`release-v140`…`release-v151` |
| 是否因“之前任务没提交”导致没发现 V1.4？ | **否** | 工作区干净；stash 仅 `boulder.json`；262 个不可达快照中 11 个唯一 PRD 版本全为 `(V1.3)`，0 个 V1.4-current |
| V1.3 是什么？ | **上一代主线（1.3.x）** | `kone-PRD.md §0.1` 已订正；`[V1.3.x]` 仅为历史版本戳 |
| 全部现行文档是否已对齐最新版本？ | **是（本轮修复 2 处残留后）** | 见 §3、§4、§8 |
| 系统是否可交付？ | **本地能力可交付；云端完整闭环仍 `NO-GO`** | `CLOUD-COLLABORATION-DELIVERY.md §0` |

---

## 1. 取证：V1.4 为什么“看起来丢了”

### 1.1 五个假设逐一检验

| # | 假设 | 检验方法 | 结论 |
|---|---|---|---|
| H1 | 未提交的改动藏在工作区 | `git status --porcelain` | **否证**：审计开始时为空 |
| H2 | 藏在 stash | `git stash list` / `git stash show --name-only "stash@{0}"` | **否证**：仅 `.sisyphus/boulder.json`（1 file，+8/−7），是运行时状态，不含任何文档 |
| H3 | 藏在不可达提交 | `git fsck --no-reflogs --unreachable` + 逐快照比对 `kone-PRD.md` blob | **否证**：262 个 unreachable commit 全部是历史 `WIP on` / `index on` 快照；260 个含 `kone-PRD.md`，去重仅 11 个 blob；11/11 标题为 `(V1.3)`，10/11 明写“不存在尚未发布的 V1.4”，**0 个**把 V1.4 写成当前代际 |
| H4 | 在另一条分支 / worktree / 仓库 | `git worktree list`、tag/branch 枚举、本机目录扫描 | **否证**：仅当前 worktree；无 V1.4 tag/branch；本机仅 `Kone-System` 一个源码目录；`Kone-ReleaseArchive-2026-10-13` 只有 `release-v146/v147/v149` 安装产物 |
| H5 | PRD 口径陈旧，代码早已进入 1.4.x | 对照 `package.json`、CHANGELOG、release 目录、V1.4 计划 | **成立**：V1.4 计划在 2026-09-03/04 已存在并已入库 `docs/plans/`，但 `kone-PRD.md §0.1` 仍写“V1.4 仅是 V1.3 内部增量批次” |

### 1.2 结论

**不是“没提交”，而是“规范文档没有随代码代际推进而更新”。** 这也解释了此前多次梳理为何以 PRD 为锚得出“V1.4 不存在”的错误结论——锚点本身是陈旧的。

---

## 2. V1.4 代际证据链

| 证据 | 实测值 |
|---|---|
| `package.json.version` | `1.4.36` |
| CHANGELOG 顶部连续条目 | `[1.4.36]` … `[1.4.29]`（共 52 条版本记录，逆序校验通过） |
| 发布目录 | `release-v140` … `release-v151`（本机 9 个；v146/v147/v149 在 `Kone-ReleaseArchive-2026-10-13`） |
| 最新安装包 | `release-v151/Kone-Intellect-Setup-1.4.32.exe` |
| V1.4 计划 | `docs/plans/kone-v1.4-production-hardening.md`、`kone-v1.4-architectural-improvements.md` |
| 结论 | **V1.4 是 1.4.x 代码线本身，不存在另一套独立的“V1.4 代码库/文档集”** |

---

## 3. 文档全量清点

| 类别 | 数量 | 说明 |
|---|---|---|
| 受控 Markdown | 75 | `git ls-files` |
| 现行文档 | 20 | 根目录规范 + `.opencode/agents` + 运维/报告 |
| 归档快照 | 21 + 1 索引 | `docs/archive/snapshots/` |
| 历史计划 | 31 + 1 索引 | `docs/plans/` |
| 代码文件 | 361 | `.ts/.tsx/.js/.cjs/.mjs` |
| 代码行数 | 75,360 | 含测试 |
| 提交总数 | 183 | 2026-04-24 → 2026-10-19 |

### 3.1 现行文档版本一致性矩阵

| 校验项 | 结果 |
|---|---|
| 当前版本声明 = `1.4.36` | **通过**（0 处冲突） |
| 安装包名 = `1.4.36` | **通过**（唯一历史引用已标注“已过期”，门禁白名单） |
| “V1.3 是当前代际” | **通过**（0 处） |
| Provider 枚举 9 值 ↔ 3 份文档 | **通过**（代码 / kone-PRD / PROJECT-PRD / FIELD-DICTIONARY） |
| Provider 文件数 | **9** |
| IPC 定义 / 注册 / preload | **72 / 61 / 70** |
| 仅推送通道 | **11** |
| 强制读链 | **10/10 存在** |
| 文档交叉引用 | **204 处，0 断链** |
| 快照索引覆盖 | **21/21** |
| 计划索引覆盖 | **31/31** |

### 3.2 历史文档处理规则

- `docs/archive/snapshots/**`：允许保留历史函数名、旧版本号、旧结论，不参与现行裁决。
- `docs/plans/**`：历史计划，允许保留当时口径。
- `CHANGELOG.md`：历史时间线，原文不改写；旧根路径由 `resolveMovedDoc()` 解析到归档位置。
- 现行文档若必须提及旧版本，**同一行**须带“已过期 / 成文时 / 历史 / 旧版”等标注。

---

## 4. 本轮新发现与修复

| 级别 | 问题 | 处置 |
|---|---|---|
| **P1** | `PROVIDER-CAPABILITY.md` 写“其余 **6** 个 Provider”，漏掉新增的 `serper`（实际未覆盖专项单测的是 7 个） | 已改为 **7** 并在清单补 `serper` |
| **P2** | `KONE-V1.3-干净机器验收手册-2026-09-25.md` 正文两处仍把 `Kone-Intellect-Setup-1.3.0.exe` 写成当前安装包 | 已改为 `Kone-Intellect-Setup-<版本号>.exe`，并标注“成文时为 1.3.0” |
| **P0（文档真相）** | `CLOUD-COLLABORATION-DELIVERY.md` 把已实现的服务端二次门禁（⑤–⑨）写成“云端尚无实现” | 已核实 `kone-cloud/src/worker.ts` 代码与 59 项云端测试全部通过；改为“已实现、`APPROVAL_GATE_ENABLED=false`、待部署开启留证” |
| P3 | 审计正则把 `§0.8 Provider`、`3.7.6 Provider`、`0.1 数据源层` 误判为计数 | 人工复核，无文档缺陷 |
| **门禁缺口** | 旧安装包名 / 旧代际只能靠人工发现 | 新增 `checkStaleCurrentClaims()`（第 11 项门禁，扫描 17 份现行文档） |

### 4.1 前序已修复（同一治理周期）

- `kone-PRD.md §0.1` 代际语义重写：V1.4 = 当前代际、V1.3 = 上一代。
- `kone-PRD.md §0.2` 权威链、21 份快照登记、现行计划登记。
- `PROJECT-PRD.md`、`AGENTS.md`、`README.md`、`docs/kone项目使用说明.markdown` 代际与能力口径对齐。
- 两份保留的 V1.3 文档加“版本适用性（2026-10-19 复核）”横幅。
- 21 份根快照、9 张 UI 审计图、3 份弃用代码归档并建立索引。

---

## 5. 系统技术基线核验

### 5.1 搜索与 Provider

- **9 个 Provider**：`google_maps`、`google_organic`、`linkedin_search`、`facebook_search`、`customs_shipment`、`trade_show`、`anysearch`、`serper`、`yellow_pages`（弃用，由 AnySearch 路由）。
- `DataSourceType` **9 值**，与代码、PRD、字段字典三方一致。
- 四级弹性搜索协议保留；Provider 失败互相隔离（`Promise.allSettled`）。
- JobID 时空隔离：`Map<ownerKey, jobId>`，陈旧回调静默丢弃。
- 变体预算：`SEARCH_PRODUCT_TERM_LIMIT = 2`、`SEARCH_VARIANT_LIMIT = 12`；扇出并发 3；LLM 评分/官网富化并发 2（三个维度不可混读）。

### 5.2 双管道与 Agent

- `SearchExecuteResult` → `LeadItem.agentStatus`（持久化）+ `AgentState` → `AGENT.STATUS_CHANGED`（运行时）。
- `writeBackAgentStatus` 同时更新两条管道；旧 `taskRunId` 任务丢弃。
- 日限额优先读取 `userConfig.agentDailyLimits`，缺失才回落默认值。
- LinkedIn 只读、WhatsApp 真实会话检测、Email 先做 SMTP/IMAP/DNS 健康检查——均未被本轮改动触碰。

### 5.3 IPC 与安全

- 72 定义 / 61 注册（41 个 plain `registerIpc` + 20 个 Fail-Closed 包装器）/ 11 推送 / 70 preload。
- 云端安全门禁：5 个源文件、6 条写操作、4 个类型，**0 处裸 `as`**。
- 剩余风险：41 个 plain `registerIpc` 尚未迁移到统一 Fail-Closed 包装器。

### 5.4 关键常量

| 常量 | 值 |
|---|---|
| `ENRICH_LOOKUP_BUDGET` | `20` |
| `CIRCUIT_OPEN_MS` | `60_000` |
| `FAILURE_STATUSES` | `{429}` |
| `SEARCH_PRODUCT_TERM_LIMIT` | `2` |
| `SEARCH_VARIANT_LIMIT` | `12` |

---

## 6. 文档治理机制评估

### 6.1 已有门禁（`scripts/verify-doc-consistency.cjs`）

1. 强制读链完整性
2. 过时函数名
3. 宪法常量 ↔ 代码
4. 架构红线
5. 归档墓碑桩
6. 文档交叉引用
7. 工具入口文件
8. 版本口径（`package.json` ↔ CHANGELOG）
9. PRD 版本真相
10. `DataSourceType` 枚举一致
11. **现行文档旧版本残留（本轮新增）**

### 6.2 仍无法机械校验的部分

- 叙述性计数（如“其余 N 个 Provider”）——本轮 P1 即属此类，只能靠全量人工审计。
- 宣传口径是否越界（`PROVIDER-CAPABILITY.md` 已定义边界，但语义需人判）。
- 历史文档中的“当时正确、现在过期”的结论。

**建议**：每次 Provider / 版本 / IPC 变更后必须跑 `npm run verify:consistency`；新增 Provider 时同步 4 处文档 + 1 处枚举 + 1 处能力表；每季度执行一次本报告式的全量叙述性审计。

---

## 7. 未完成项与风险（产品级）

| 级别 | 项 | 状态 |
|---|---|---|
| **P0** | 云端投递完整闭环 | `NO-GO`。仍待闭环：① 干净机器 20 项人工冒烟；② 打包冒烟 B2（`app.asar` 被系统进程持有）；③ 服务端二次门禁**已实现**（入队门禁 ⑤–⑨ + `/cron/send` 投递时复核，63 项云端测试通过），但 `APPROVAL_GATE_ENABLED=false`，待部署开启留证；④ 真实 Resend + IMAP 小流量实发 |
| P1 | 41 个 plain `registerIpc` | 未迁移 Fail-Closed 包装器 |
| P2 | 267 条 lint warning | 非阻断（0 error） |
| P3 | `stash@{0}` boulder 运行时状态 | 可清理，也可保留 |
| P3 | `ARCH-STANDARDS.md §1.1/§5` 逐句精修 | 待办 |

> 云端能力对外口径必须遵守：**未完成代码与验收前不得宣称已交付**。

---

## 8. 验收证据与复现

### 8.1 本轮实测

| 命令 | 结果 |
|---|---|
| `npm run verify:consistency` | **EXIT 0**：15 份活规范、204 处引用 0 断链、版本口径 1.4.36、PRD 真相 2 份、枚举 9 值、现行旧版本 17 份 |
| `npm run verify:ipc` | **通过**：72 / 61 / 11 / 70 |
| `npm run verify:cloud-safety` | **通过**：6 条写操作、0 裸 `as` |
| `npm test`（基线 `5dcf509`） | **EXIT 0**：595 unit + 59 cloud + 1 IPC + 7 e2e |
| `npm test`（`kone-cloud`） | **EXIT 0**：63 tests / 2 files（含 `approval-gate.test.ts` 的入队门禁 + 投递时复核负向用例） |
| `npm run typecheck`（`kone-cloud`） | **0 error**（2026-10-19 加固后修复既有 5 项） |
| `npm run typecheck`（基线） | **0 error** |
| `npm run lint`（基线） | **0 error** / 267 warnings |

### 8.2 取证命令

```bash
git status --porcelain
git stash list
git stash show --name-only "stash@{0}"
git fsck --no-reflogs --unreachable
git worktree list
git log -1 --format='%H %ad %s' --date=short
git ls-files | wc -l
npm run verify:consistency
```

---

## 9. 审计口径声明

- 所有计数以**代码/命令实测**为准，不以文档自述为准。
- “现行文档”= 排除 `docs/archive/**`、`docs/plans/**`、`CHANGELOG.md` 的受控 Markdown。
- 历史原文允许保留旧版本，但必须显式标注；未标注即视为漂移。
- 本报告不替代 `kone-PRD.md`（产品需求）、`PROVIDER-CAPABILITY.md`（能力口径）、`CLOUD-COLLABORATION-DELIVERY.md`（云端交付）三份唯一事实源。

---

**审计结论：V1.4 没有丢失，也没有被“未提交”掩盖。此前的错误结论源于 `kone-PRD.md §0.1` 的代际口径陈旧；该口径及全部现行文档已在 2026-10-19 对齐到 `1.4.36`，并由新增门禁持续约束。**
