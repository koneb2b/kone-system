# KONE V1.3 商用交付条件与模块交互严谨性 · 深度分析报告

- **日期**：2026-10-13
- **方法**：**静态取证（`文件:行号`）+ 真实门禁实跑 + 交付物实物盘点**。所有结论均附证据，不采信"应该没问题"。
- **范围**：30 个主进程服务模块 · 86 条 IPC 通道定义 · 渲染层 22 个顶级组件 · 17 个交付产物目录 · 14 份既有审计文档
- **本报告遵循**：用户价值取向（拒绝过度工程化；**先问"用户能不能感知"**）；以及本项目铁律
  **「探针报通过 ≠ 渲染正确」「已登记 ≠ 已绑定」「环境阻塞 ≠ 能力缺失」**。

---

## 一、执行摘要

> **代码质量与架构严谨性：已达商用交付水平。**
> **交付治理：尚未达标 —— 存在 2 项真实阻断，但修复成本极低。**

| 维度 | 评价 | 关键依据 |
|---|---|---|
| 渲染稳定性 / 崩溃类缺陷 | ✅ **优秀** | 历史 2 个崩溃级 P0（稀疏数组击穿 `new Map`、密钥不可解密致变砖）**均已修复** |
| 自动化测试 | ✅ **优秀** | `test:unit` **517/517**；`typecheck` 0 error；`verify:consistency` 三绿 |
| 安全门禁（gateway/env/bypass） | ✅ **通过** | 本次实跑 **6/6** |
| 授权分层 | ✅ **扎实** | Fail-Closed 二次校验 + 离线授权 + 机器码绑定 |
| **Agent 真实外发安全** | ✅ **强（商用关键）** | **暂存待人工确认，不自动发送**（见 §三.3） |
| IPC 契约 | ✅ **扎实** | 双事实源 + 启动门禁 + 登记/绑定分离已修正 |
| **版本号一致性** | 🔴 **缺陷（阻断）** | CHANGELOG `1.4.29` ↔ `package.json` **`1.3.15`**（安装包命名取后者） |
| **交付物治理** | 🔴 **缺陷（阻断）** | **17 个 release 目录 ≈ 6.5 GB，全部同一版本号** → 拿错包风险 |
| 安全审计门禁可用性 | ⚠️ 有隐式前置 | 脚本硬依赖 `release/win-unpacked/`，当前产物在 `release-v1xx/` → **跑不起来** |
| 自动更新 | ⚠️ 未端到端验证 | 实现存在，未见更新源与端到端验证记录 |

---

## 二、交付就绪度（逐项证据）

| 项 | 状态 | 证据 |
|---|---|---|
| 安装包可产出 | ✅ | 17 个 `release*/` 各含 `Kone-Intellect-Setup-1.3.15.exe`（≈89.8 MB） |
| 打包版冒烟 | ✅ | `tests/packaged-smoke-report.json`：`booted:true`、激活页可见、preload 桥可见、仪表盘导航可见 |
| 单元测试 | ✅ | **517/517**（0 回归） |
| 类型检查 | ✅ | `tsc --noEmit -p tsconfig.json` → 0 error |
| 文档 / IPC / 云端一致性 | ✅ | `verify:consistency` → 规范文档 ✅ / IPC 契约 ✅ / 云端链路安全 ✅ |
| 安全三件套 | ✅ | `test:gateway` + `test:env` + `test:bypass` → **6/6**（本次实跑） |
| 安全审计（成品级） | ⚠️ | `scripts/security-audit.cjs:24` `ensureExecutable` 硬找 `release/win-unpacked/KoneAI.exe` → **当前不存在** → 门禁不可用 |
| 备份 / 恢复 | ✅ | `backup-service.ts`：`triggerBackup` / `verifyBackup`（SHA-256）/ `getBackupList` |
| 崩溃上报 | ✅ 隐私优先 | `crash-reporter.ts`：默认 `enabled:false`，opt-in 且需 `remoteUrl` |
| 代码签名 | ⚠️ 可选 | 当前为顾问 / 微信渠道分发（信任由人传递）；**仅公开下载才需要** |
| **版本号** | 🔴 | `package.json` = `1.3.15`，而 CHANGELOG 已到 **`1.4.29`**（`[1.4.0]` 起于 2026-10-07） |
| **交付物** | 🔴 | `release-v140`…`release-v150` + `release-verify{,2}` + `release.rar` = **17 项 ≈ 6.5 GB**，**全部 1.3.15** |

---

## 三、模块交互严谨性（逐维度取证）

### 3.1 IPC 契约 —— ✅ 扎实

- **双事实源**：`electron/ipc/channels.ts`（命名/类型 SSOT）+ `electron/ipc/registry.ts`（运行时收敛点）。
- **注册分布**（实测）：`registerIpc` **56** / `registerSecureIpc` **2** / `registerSecureFeatureIpc` **19**。
- **启动门禁**：`main.ts` 在 `whenReady()` 末尾 `registry.assertAllRegistered(...)` + `registry.lock()`。
- **已知坑已修**：**「已登记 ≠ 已绑定」** —— `attach()` 只绑定登记时刻已存在的通道；
  曾致 `AUTOPILOT.SYNC_STATE` 死通道，现有源码顺序守护测试（`autopilot-sync-attach-guard`）。

### 3.2 授权分层 —— ✅ 扎实（Fail-Closed）

- `license-service.ts`：`getPhysicalMachineId` / `checkTrialStatus` / `ensureTrialAccess` /
  `registerSecureIpc` / `registerSecureFeatureIpc` / `createLicenseService`；离线授权 `offline-license.ts`
  （`verifyOfflineLicensePayload`）→ **防火墙/离线机器不会因联网失败而不可用**（代码注释已明确）。
- **门禁分级有 SSOT 与守护**：`tests/business-logic/agent-gate-classification.business.test.js`
  的 `GUARDED` / `UNGUARDED`（附豁免理由）/ `PUSH_ONLY` 三张表 —— **新增 `AGENT.*` 通道必须定级，否则测试失败**。
- 历史教训已内化：**"数据源免授权恢复"的通道必须在读取口补门禁**（光靠 UI 入口挡不住直连 IPC）。

### 3.3 Agent 真实外发安全 —— ✅ **强（商用最关键的一条）**

| 机制 | 证据 |
|---|---|
| **暂存待人工确认（不自动发送）** | `agent-service.ts:1254-1256`：`stagedTargets.set(agentId, targets)`，注释 **`// Stage for human review — do NOT send.`**；`consumeStagedTargets` 由用户确认后消费 |
| **退订门禁** | `email-suppression.ts` + `agent-service.ts:551` 注入 `isSuppressed` → **发送前必查退订表** |
| **日限额** | `dailyUsed >= dailyLimit` 逐 Agent 拦截（3 处），限额按套餐（trial/basic/premium）动态取 |
| **启停检查点** | `waitWhilePaused(agent)` 三条循环每轮调用（P0-3 已修）—— **停止/暂停真实生效** |
| **时空隔离** | `isStaleTask(runId)` 防止旧批次在管道重启后误发 |

> **结论**：产品**不会在用户不知情时对真实客户外发**。这是 B2B 商用产品最重要的一条合规底线，**已守住**。

### 3.4 其它模块

| 模块 | 状态 | 说明 |
|---|---|---|
| 搜索链路 | ✅ | 四级弹性协议 + 单源失败隔离 + 总量域预算 + Fail-Closed（本会话持续加固） |
| 云端协同 | ✅ | `verify-cloud-safety` 通过；`supabase-service` / `cloudflare-service` 双通道 |
| 跟进调度 | ✅ | `followup-scheduler.ts` 存在；IMAP 回复检测（`imap-reply-service.ts`）已接 |
| 知识库 | ✅ | 硬编码关键词预筛 + prompt 注入（**非 RAG**，对外口径已校正） |
| 自动更新 | ⚠️ | `auto-updater.ts` 实现完整，但**未见端到端验证**（更新源配置 + 一次真实升级） |

---

## 四、发现的缺陷（分级）

### 🔴 阻断级（建议修复后再交付）

**D-1 · 版本号不一致**
- **证据**：`package.json` → `1.3.15`；`CHANGELOG.md` 最新 → **`[1.4.29]`**（`[1.4.0]` 起于 2026-10-07）。
- **影响**：安装包命名为 `…-1.3.15.exe`，**实际含 1.4.0–1.4.29 的全部变更**。客户/支持/回溯三方口径错位；
  自动更新按版本号比对，**存在升级判定错误风险**。
- **且无门禁**：`verify-doc-consistency.cjs` **不校验版本号** → 漂移不会被自动发现。
- **修复成本**：**极低**（改 1 个字段 + 加 1 条门禁）。

**D-2 · 交付物堆积且同版本号**
- **证据**：`release-v140`…`release-v150`（11 个）+ `release-verify`/`release-verify2` + `release.rar` = **17 项 ≈ 6.5 GB**；
  **每个安装包都叫 `Kone-Intellect-Setup-1.3.15.exe`**（字节数不同 → 内容不同，但**文件名无法区分**）。
- **影响**：**交付时拿错包的风险真实存在**；磁盘与备份成本浪费。
- **修复成本**：**低**（保留最近 1–2 个 + 归档其余；并把版本号治理到位后自然可辨）。
- ⚠️ **本报告不执行删除**（属破坏性操作，需你明确指定保留范围后再做）。

### 🟡 交付前应确认（非阻断）

**D-3 · 安全审计门禁的「默认目录」不可用** —— ⚠️ **本报告初稿的判断有误，此处更正**
- **更正**：`scripts/security-audit.cjs:8-13` **早在 2026-10-11 就已支持位置参数**
  （`process.argv[2] || KONE_PACKAGED_ROOT || 'release'`），与 `packaged-smoke.cjs` 对齐。
  初稿的"脚本硬编码"结论**不成立**（我当时用 `npm run test:security-audit` 未传参，误判为能力缺失）。
- **真实残留问题**：**默认目录** `release/` 下无 `win-unpacked`（当前产物都在 `release-v1xx/`），
  而报错只说 "not found"，**不告诉人该怎么办** → 门禁形同虚设。
- **本次已修**：报错改为**列出全部可用产物目录 + 用法提示**；
  **刻意不静默回退**到其它目录 —— 安全审计必须审**指定的那个包**，静默换包会让"审了 A、以为审了 B"成为可能。

**D-4 · 自动更新未端到端验证**（若走公开下载渠道才构成阻断）

**D-5 · 干净机器人工验收未做**
- 这是**本项目管理内存中明确写下的「交付前唯一必做」**：安装 → 激活 → 搜索全流程。
- **必须人工执行**，自动化探针不能替代（历史已多次证明探针会自欺）。

### 🟢 已达标（无需动作）

崩溃类 P0 全修 · 授权 Fail-Closed · **Agent 不自动外发** · 517 单测 · 三绿一致性 · 安全三件套 6/6 ·
备份校验 SHA-256 · 崩溃上报 opt-in。

---

## 五、与历史审计的对照（闭环情况）

| 历史审计 | 当时结论 | 现状 |
|---|---|---|
| 2026-10-09 全项目深度审计 | **7 项 P0 阻断，不具备交付条件** | ✅ **7 项已全部修复**（含账号密码丢失、启停失效、日限额清零、`leadKey` 丢失、深析门禁误判） |
| 2026-10-12 安装包数据交互审计 | 2 个真实缺陷，已修并在打包版验证 | ✅ 已闭环 |
| 2026-10-13（本会话） | 新发现：WhatsApp 管道对座机入队 | ✅ 已修复（S1） |

> **趋势判断**：**代码级缺陷已收敛**（本轮新增发现均为"管道口径/标注/治理"类，**无崩溃、无数据丢失**）；
> **交付治理类问题浮现**（版本号、产物堆积）—— 这是项目从"开发期"进入"交付期"的典型信号。

---

## 六、交付前必做清单（Checklist）

| # | 项 | 类型 | 成本 |
|---|---|---|---|
| 1 | **统一版本号**（`package.json` ↔ CHANGELOG），并加**版本一致性门禁** | 阻断 | 低 |
| 2 | **清理 / 归档 release 产物**，只保留最近 1–2 个 | 阻断 | 低 |
| 3 | **干净机器人工验收**：安装 → 激活 → 搜索 → 保存线索 → 生成开发信 | 阻断 | 中 |
| 4 | 让 `security-audit.cjs` 支持位置参数（或文档化其前置） | 建议 | 低 |
| 5 | 自动更新端到端验证（若公开下载） | 条件 | 中 |
| 6 | 代码签名（若公开下载） | 条件 | 中 |

---

## 七、明确不做（避免过度工程化）

- 不为"内部工程洁癖"（lint 警告 / 命名 / 类型 SSOT）阻断交付；
- 不引入新框架 / 重写链路（现有架构已验证可交付）；
- 不为尚不存在的数据继续扩张护栏（见 S3 的「待 S6 激活」标注）。

---

## 八、本次执行结果（2026-10-13 续）

### ✅ 已修复

| 项 | 动作 | 验证 |
|---|---|---|
| **D-1 版本号** | `package.json` `1.3.15` → **`1.4.30`**（与 CHANGELOG 最新条目对齐） | `verify:consistency` ✅ |
| **D-1 门禁缺失** | `verify-doc-consistency.cjs` 新增 **`checkVersionConsistency()`**：<br>① `package.json.version` 必须 = CHANGELOG 最新条目；<br>② CHANGELOG 条目必须**严格逆序**（最新在前） | 变异验证：回退版本 → **精准判红** |
| **CHANGELOG 结构** | `[1.4.15]` 曾被**孤立在文件顶部**（时间线被破坏）→ 移回 `[1.4.16]` 与 `[1.4.14]` 之间 | 行数 2745 不变 / 条目数 46 不变 / `diff` 内容集合一致（仅顺序变化） |
| **D-3 报错可操作性** | `security-audit.cjs` 找不到产物时**列出全部可用目录 + 用法**（**不静默回退**） | 实跑确认输出候选列表 |

### ⏸ 未执行（需你决策）

| 项 | 原因 |
|---|---|
| **D-2 release 产物清理** | 属**破坏性操作**（≈6.5 GB / 17 项）且**保留范围是业务决策**（哪些包需留作客户支持/回溯）。<br>**建议保留**：`release-v148`（**冒烟报告已验证的那个包**）+ 最新 `release-v150`；其余归档或删除。 |
| **D-5 干净机器人工验收** | 必须人工执行，自动化探针不能替代（本项目历史已多次证明探针会自欺）。 |

---

## 九、附录：本报告取证命令
```bash
npm run test:unit          # 517/517
npm run typecheck          # 0 error
npm run verify:consistency # 文档/IPC/云端 三绿
npm run test:security-audit# gateway+env+bypass 6/6（成品级因无 release/win-unpacked 不可用）
node -e "console.log(require('./package.json').version)"   # 1.3.15
grep -nE '^#+ \[[0-9.]+' CHANGELOG.md | head -3            # 1.4.29
ls -d release* | wc -l ; du -sh release*                    # 17 项 / ≈6.5GB
```
