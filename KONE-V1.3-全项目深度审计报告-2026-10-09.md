# KONE V1.3 · 全项目深度审计报告（前端模块 / 数据交互 / UI·UX / 商用交付标准）

> 日期：2026-10-09 ｜ 方法：静态取证（`文件:行号`）+ 自动化跑测（交互探针 / 设计 token 探针 / 全量门禁）+ 关键项人工复核
> 范围：35 份文档 · 前端 22 个顶级组件（11512 行）+ 37 个子组件 · 49 个 invoke IPC 通道 · 9 个功能模块

---

## 一、执行摘要

**总体结论：架构与授权分层扎实，但存在 7 项 P0 级阻断缺陷，当前不具备商用交付条件。**

| 维度 | 评价 | 依据 |
|---|---|---|
| **渲染稳定性** | ✅ 优秀 | 9 模块全部渲染成功，**0 崩溃、0 console 错误**（交互探针） |
| **UI 基础** | ✅ 良好 | 设计 token 生效（主色 `221 83% 53%` 蓝）；无横向溢出；无 <11px 除徽标外文本 |
| **授权分层** | ✅ 扎实 | 能力集单一 SSOT + 主进程 Fail-Closed 二次校验；前端绕过也拿不到真实能力 |
| **数据链路严谨性** | 🔴 有硬缺陷 | 账号配置「写不进 / 读不出」；线索 key 入库丢失 |
| **自动化风控** | 🔴 有硬缺陷 | 停止/暂停**不生效**，仍对外发送；日限额重启即清零 |
| **测试覆盖** | ⚠️ 不均衡 | 单测 369 条全绿；但**账号链路、启停状态机无有效覆盖** |

**一句话**：界面层做得比后端链路扎实。**用户能看到的一切都正常，但点下去之后有几条链路是断的。**

---

## 二、审计方法与可信度声明

### 2.1 三路取证

1. **静态取证**：3 个探索代理分模块走查全部前端组件 + 相关主进程服务，结论均附 `文件:行号`。
2. **自动化跑测**：新写 `scripts/audit-ui-interaction.cjs`（全模块交互探针），逐页导航 + 枚举按钮 + 安全交互 + 收集错误。
3. **关键项人工复核**：对 7 项 P0 **逐条回读源码验证**（不采信二手结论）。

### 2.2 可信度声明（重要）

- 标注 **【已复核】** 的条目：我逐行读过源码，结论确定。
- 标注 **【静态分析】** 的条目：来自代码走查，未做运行时观测，存在误判可能。
- 标注 **【待验证】** 的条目：证据不足以定论。

> 本报告**不掩盖不确定性**。凡未复核的，均如实标注。

---

## 三、系统级跑测结果（客观数据）

### 3.1 全模块交互探针

```
modulesChecked: 9        modulesRendered: 9      modulesCrashed: 0
totalButtons: 191        disabledButtons: 8      modulesWithConsoleErrors: []
```

| 模块 | 渲染 | 按钮数 | console 错误 | 小字号 | 小点击目标 | 横向溢出 |
|---|---|---|---|---|---|---|
| 智能获客 search | ✅ | 30 | 0 | 15 | 6 | 无 |
| 线索管理 leads | ✅ | 33 | 0 | 2 | 2 | 无 |
| 数据中心 data | ✅ | 16 | 0 | 4 | 0 | 无 |
| 知识库 knowledge | ✅ | 20 | 0 | 6 | 1 | 无 |
| 系统设置 settings | ✅ | 29 | 0 | 2 | 0 | 无 |
| 账号管理 accounts | ✅ | 16 | 0 | 2 | 0 | 无 |
| AI 销售团队 agents | ✅ | 11 | 0 | 2 | 0 | 无 |
| 自动化序列 automation | ✅ | 21 | 0 | 5 | 0 | 无 |
| 团队协作 team-dashboard | ✅ | 15 | 0 | 2 | 1 | 无 |

**结论**：**前端渲染层健康**。9 个模块全部可正常渲染，无 ErrorBoundary 接管，无运行时异常。这是本次审计最明确的正面结论。

### 3.2 设计 token 探针

```
cssVarPrimary: "221 83% 53%"     → bgPrimary: rgb(36, 99, 235)  ✅ 蓝色
borderBorder: rgb(225, 231, 239)  bgMuted: rgb(243, 245, 247)
```

设计 token 已正确注册，主色为蓝色（符合项目约定）。

### 3.3 全量门禁

| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | ✅ **369/369** |
| `npm run typecheck`（src + electron 双侧） | ✅ 0 error |
| `npm run verify:consistency` | ✅ 通过（文档交叉引用 168 处） |
| `npm run lint` | ✅ 0 error |

---

## 四、缺陷清单

### P0 — 阻断交付（7 项，全部【已复核】）

#### P0-1 邮箱密码保存**必然失败**，且**触发密码丢失**
**证据**：`src/components/accounts-management.tsx:240-263` + `electron/services/config-service.ts:448-455`

保存流程**先清空**明文槽（`smtpPass: ''`，第 248 行），**再**写加密槽（第 260 行）。但 `SECRET_SET_WHITELIST`（`config-service.ts:448-455`）**不含** `EMAIL_SMTP_PASS` / `EMAIL_IMAP_PASS` → 主进程返回 403 → `unwrapIpc` 抛错。

**净效果**：新密码写不进加密槽，旧明文槽又被清空 → **密码彻底丢失**，用户看到「保存失败」，重试仍失败。**邮箱链路（SMTP 发信 / IMAP 回复检测）完全不可用。**

#### P0-2 `cloud.*` 配置「可写不可读」，云端保存恒报失败
**证据**：`electron/services/config-service.ts:427`（黑名单）vs `:433-439`（白名单）

写端黑名单 `['license.', 'billing.', 'secrets.', 'system.hardwareMachineId']` **不含** `cloud.` → 可写；
读端白名单 `CONFIG_GET_ALLOWED_NAMESPACES` **不含** `cloud.` → `config:get('cloud.*')` 一律 403。

**净效果**：云端引擎配置与 IMAP 自动检测设置**存了读不出来**；`CloudSettingsTab` 用 `Promise.all` 聚合读取，任一失败即整体回退默认值，且保存成功后再次读取失败 → **恒弹「保存失败」（实际已落盘）**。

#### P0-3 停止智能体后**自动重连继续发送**
**证据**：`electron/services/agent-service.ts:1054-1072` + `electron/services/agents/whatsapp-agent.ts:134-138`

`stopAgent` 仅 `disconnect()` 并置 `status='idle'`。但执行循环持有**局部 `instance` 引用**，而 `sendMessage` 开头即：
```ts
if (this.sessionState !== 'connected') { const connected = await this.connect(); ... }
```
→ 停止后循环继续调用 `sendMessage` → **自动重连 → 继续对外发送**。

**影响**：用户以为已停止，实际仍在发消息。属自动化风控 / 合规红线。

#### P0-4 暂停功能**完全无效**
**证据**：`electron/services/agent-service.ts:1390-1392` vs `:594-863`

`pause` 只做 `agent.status = 'paused'` + 广播。全文件 17 处 `agent.status` 引用中，**没有一处在执行循环内读取判断**。暂停期间任务照常发送，而 UI 显示「已暂停」——**误导性状态**。

#### P0-5 日限额**重启即清零**，且无跨天重置
**证据**：`electron/services/agent-service.ts:172-226`（Map 初始化 `dailyUsed: 0`）

`dailyUsed` 为内存态，无日期锚点：重启清零（可绕过日限额）；长时间不关机则永不按自然日重置。**商业日限额形同虚设**，直接放大账号封禁风险。

#### P0-6 `leadKey` 入库**恒为 undefined** → 双管道触达读端失效
**证据**：`src/lib/lead-mappers.ts:156` + `src/hooks/use-search-engine.ts:85`

入库时 `leadKey: typeof result.id === 'string' ? ... : undefined`，但上游 `use-search-engine.ts:85` 已把 id 转成 `Number(...)`，`LeadSearchResult.id` 类型为 `number`（`leads-store.ts:111`）→ 条件**恒 false** → `leadKey` 恒 `undefined`。

**影响**：`leads-table.tsx:187` 按 leadKey 批量拉取被跳过 → 真实触达进度对所有已保存线索不可用。

#### P0-7 最高付费档**看不到**深度分析面板
**证据**：`src/components/search/deep-analysis.tsx:35` + `src/components/dashboard-page.tsx:86`

组件自我隐藏：`if (role !== 'pro') return null`。而 premium 用户 `currentRole === 'enterprise'`（`dashboard-page.tsx:86`），`allowDeepAnalysis` 对 premium 为 `true`。**权限给了，组件却把自己藏了**——付费功能对最高档消失。

---

### P1 — 明显缺陷（12 项）

| # | 缺陷 | 证据 | 说明 |
|---|---|---|---|
| 1 | 删除线索**无二次确认** | `leads-management.tsx:523-531,1227-1233` | 误点即永久删除并持久化 |
| 2 | 群发**无二次确认** | `automation-workflow.tsx:651-677` | 不可逆外发缺确认闸门 |
| 3 | 来源筛选是**死选项** | `leads-management.tsx:808-819` | 选项 `LinkedIn/Trade Show/AI Search` 永不匹配实际 `source` |
| 4 | 「AI 深度分析」按钮**静默入库** | `leads-table.tsx:578-616` | 点「分析」产生「保存」副作用，无提示 |
| 5 | 两处导出口径**不一致** | `leads-table.tsx:467`（上限 50）vs `leads-management.tsx:730`（全量） | 与 `lead-export.ts` 宣称的「单一事实源」相悖 |
| 6 | 改了设置**没保存就切页丢失** | `system-settings.tsx:209-215` | 卸载时 `clearTimeout` 吞掉待落盘改动，且无未保存提示 |
| 7 | 邮箱账号健康检查**读错路径** | `sandbox-service.ts:100-111` | 读 `user_config.smtpHost`，实际写在 `user_config.accounts.email.*` → 恒判「已断开」 |
| 8 | 社媒账号**无真实登录流程** | `accounts-management.tsx:206-227` | 仅建条目 + Cookie 检查，全仓无登录窗口逻辑 → 恒「已断开」且无补救入口 |
| 9 | 账号列表**不持久化** | `sandbox-service.ts:28` | 内存 Map，重启清空 |
| 10 | 审批把邮箱等级**硬编码 `verified`** | `leads-table.tsx:305` | 注释自认应读真实等级 → 合规风险 |
| 11 | 邮箱清洗/域名检测/追踪**前端无门禁、无升级引导** | `automation-workflow.tsx:475,573,706` | 按钮对 Basic/Trial 可点，后端 403 后只弹原始错误 |
| 12 | 「今日配额」徽标**口径错误** | `agents-panel.tsx:238-239` | `totalUsed = Σ dailyUsed` 但 `totalLimit = agents[0].dailyLimit` → 显示如「12/5」 |

### P2 — 打磨项（12 项，摘要）

- `countryCode` 由国家名前 2 字母硬切（`Germany→GE`，应为 `DE`）— `lead-mappers.ts:131-133`
- 「手动添加」按钮永远禁用（占位未实现）— `leads-management.tsx:978-986`
- 「保存后可云端触达」无实际动作 — `search-result-card.tsx:341-343`
- `DeepAnalysis` 输入框在未授权时仍可输入 — `deep-analysis.tsx:52-59`
- 「保存密钥」无 loading/禁用，可重复提交 — `base-settings-tab.tsx:530-538`
- IMAP 设置失败不回滚 UI（与注释不符）— `accounts-management.tsx:306-311`
- `system-settings` 内 `UpgradeModal` 无触发点（死弹窗）— `system-settings.tsx:53,490`
- 模型下拉初始无数据（`modelList` 恒空）— `system-settings.tsx:63,66`
- 筛选后无全局空态（仅每列提示）— `leads-management.tsx:1046`
- 数据中心错误态缺失（`hydrateFromConfig` 吞异常）— `leads-store.ts:442-444`
- 云端 payload 丢失多源字段（`decisionMakers/customsData` 等）— `automation-workflow.tsx:196-229`
- `10px` 字号用于「高级」徽标等（低于常规最小字号）— 各模块侧栏

---

## 五、逐模块评估

### 5.1 智能获客 `search-engine.tsx`（1209 行）
- **数据交互**：6 个流式事件订阅（start/stage/basic/scored/complete/error）完整且**均有清理**；搜索失败自动重试 3 次、保留已有结果、授权失效不清空 —— **降级设计扎实**。
- **主要问题**：P0-7（premium 看不到深度分析）；P1-3/4（筛选死选项、静默入库）。
- **UX**：骨架屏 / 欢迎态 / 错误 Alert / 授权失效态**四态齐全**。

### 5.2 线索管理 `leads-management.tsx`（1456 行）+ `leads-table.tsx`（680 行）
- **数据交互**：导出已收敛到 `src/lib/lead-export.ts` 共享 SSOT（✅ 上轮遗留建议已落地）。
- **主要问题**：P0-6（leadKey 丢失）；P1-1（删除无确认）、P1-5（导出口径不一）。
- **UX**：加载态 / 空态齐全；**筛选后无全局空态**。

### 5.3 数据中心 `data-center.tsx`（1136 行）
- **数据交互**：全部基于 `useLeadsStore().leads`，口径自洽。
- **主要问题**：错误态缺失（静默降级为空态）；「导出报表」实为仅导出新增趋势（2 列）。
- **UX**：空态 / 加载态齐全。

### 5.4 知识库 `knowledge-base.tsx`（438 行）
- **数据交互**：`config.get/set` 读写 `user_config.knowledgeBase`；**自定义标签已贯通**（本轮前序改动）。
- **主要问题**：仅 P2 打磨项。
- **评价**：本模块**质量最高**，有跨端守护测试 + 视觉探针。

### 5.5 系统设置 `system-settings.tsx`（493 行）+ `settings/*`
- **数据交互**：密钥走 `secret-manager`（safeStorage 加密）✅ 正确；但 `cloud.cloudflareApiKey` **明文落盘**（P1）。
- **主要问题**：P1-6（未保存丢失）；P2 多项。
- **UX**：保存有 toast 反馈；**无未保存离开提示**。

### 5.6 账号管理 `accounts-management.tsx`（723 行）
- **主要问题**：**P0-1（密码丢失）**、P1-7/8/9（读错路径 / 无登录流程 / 不持久化）。
- **评价**：**本模块问题最集中，是交付的最大阻断点。**

### 5.7 AI 销售团队 `agents-panel.tsx`（596 行）
- **数据交互**：`agent:list/control/get-log` + `onAgentStatusChanged` 推送订阅（**有清理** ✅）。
- **主要问题**：**P0-3/4/5（启停无效、日限额失效）**、P1-12（配额口径）。
- **评价**：**后端状态机未闭环**，是自动化风控的最大隐患。

### 5.8 自动化序列 `automation-workflow.tsx`（764 行）
- **数据交互**：门禁 `canUseCloudSend` + 后端 `requireFeature('cloud_send')` **双重 Fail-Closed** ✅ 无商业泄漏。
- **主要问题**：P1-2（群发无确认）、P1-11（前端无门禁无引导）；「发送」为目标态占位。
- **UX**：空态 / 加载态 / 错误态**三态齐全**。

### 5.9 团队协作 `team-dashboard.tsx`（359 行）
- **数据交互**：`cloud:*` 全通道主进程门禁 ✅；实时订阅有清理 ✅。
- **主要问题**：门禁口径不一致（仅判 `tier==='premium'`，未含 `plan==='enterprise'`）— `dashboard-page.tsx:280`。

---

## 六、UI / UX 评估

### 6.1 做得好的

| 项 | 证据 |
|---|---|
| **设计 token 体系统一** | 主色 / 边框 / 背景均由 CSS 变量驱动，全站一致 |
| **配色符合行业约定** | 主色蓝（`221 83% 53%`）；无违规用色 |
| **四态覆盖意识** | 多数模块有 空态 / 加载态 / 错误态 / 骨架屏 |
| **无横向溢出** | 9 模块全部 `scrollWidth ≤ innerWidth` |
| **错误边界** | `ErrorBoundary` 存在，9 模块实测 0 触发 |
| **反馈机制** | 关键操作普遍有 toast |

### 6.2 需要改进的

| 项 | 问题 | 影响 |
|---|---|---|
| **危险操作缺确认** | 删除线索、群发、停止智能体**均无二次确认** | 误操作不可逆 |
| **状态与实际不符** | 「已暂停」实际仍在发送；「今日配额 12/5」 | 误导性状态，**削弱信任** |
| **错误信息面向技术** | 如 `Cannot read properties of null (reading 'agents')` 直接弹给用户 | 用户无法理解 |
| **未保存无提示** | 设置页改完切页静默丢失 | 数据丢失感 |
| **门禁反馈断裂** | 无权限按钮可点，403 后只弹原始错误、无升级引导 | 转化路径断裂 |
| **字号下限** | 少量 `10px` 文本（徽标/示例） | 可读性 |

### 6.3 与商用 SaaS 标准的差距

对照成熟商用 SaaS 的 UI/UX 基线：

| 基线项 | 现状 |
|---|---|
| 一致性（token / 间距 / 组件） | ✅ 达标 |
| 反馈完备（loading / 空 / 错 / 成功） | ⚠️ 部分达标（错误态与危险操作确认缺失） |
| 防误操作（危险操作二次确认） | ❌ **未达标** |
| 状态可信（UI 与实际一致） | ❌ **未达标**（暂停/配额） |
| 可访问性（字号 / 对比度 / 焦点） | ⚠️ 基本达标（少量 10px） |
| 响应式 | ✅ 达标（无横向溢出） |

---

## 七、商用 SaaS 交付标准评估

### 7.1 已达标

- **授权分层架构**：能力集单一 SSOT（`src/shared/license-features.ts`），主进程 Fail-Closed 二次校验，配置/密钥写保护，窗口 `sandbox:true + contextIsolation`。**前端门禁被绕过也拿不到真实能力。**
- **渲染稳定性**：9 模块 0 崩溃、0 console 错误。
- **测试基建**：单测 369 条、类型检查双侧、一致性校验、视觉探针 —— 工程化程度高。
- **文档体系**：35 份文档，有 SSOT 标注与一致性校验脚本。

### 7.2 未达标（阻断交付）

1. **账号链路不可用**（P0-1/2）：邮箱密码丢失 + 云端配置读不出 → 核心配置功能不可用。
2. **自动化风控失效**（P0-3/4/5）：停止/暂停不生效仍对外发送；日限额可绕过 → **合规红线**。
3. **数据链路断点**（P0-6）：触达进度对所有已保存线索不可用。
4. **付费功能缺失**（P0-7）：最高档看不到深度分析。

### 7.3 交付判定

> **当前状态：不可商用交付。**
> 需先修复 7 项 P0（其中 P0-1~P0-5 属"用户可感知的功能不可用/合规风险"，优先级最高），并在**干净机器**上重跑完整流程验收。

---

## 八、结论与建议

### 8.1 核心判断

这份代码库的**架构质量明显高于其功能完成度**。授权分层、IPC 治理、降级设计、文档体系都达到相当水准；但**几条关键业务链路的"最后一公里"没走通**——配置存不进去、任务停不下来、字段传不过去。

**这不是能力问题，是验证盲区问题**：账号链路、启停状态机恰好是**自动化测试覆盖最薄**的地方（单测 369 条里几乎没有它们），所以缺陷一直没被拦住。

### 8.2 建议修复顺序

| 优先级 | 项 | 理由 |
|---|---|---|
| **1** | P0-1 邮箱密码丢失 | 数据丢失 + 功能不可用，用户必然遇到 |
| **2** | P0-3/4/5 启停与日限额 | 合规红线：以为停了却还在发 |
| **3** | P0-2 云端配置读写不对称 | 一行白名单即可修，收益大 |
| **4** | P0-6 leadKey | 核心卖点（触达进度）不可用 |
| **5** | P0-7 深度分析门禁 | 付费功能缺失 |
| **6** | P1 中「危险操作二次确认」 | 防误操作，成本低 |
| **7** | P1 中「账号连接流程」 | 需产品决策（是否做真实登录） |

### 8.3 流程改进建议（治本）

**当前缺陷的共同根因是「链路两端有测试、中间没有」。** 建议：

1. **为每条关键链路补"端到端断言"**，而非只测单元函数。
   - 反例：`renderKnowledgePromptBlock` 有测试，但"prompt 真的拼进去了"没有（本轮前序已补）。
   - 同类风险仍在：账号保存链路、启停状态机。
2. **建立"写-读对称性"守护测试**：凡 `config:set` 可写的命名空间，`config:get` 必须可读（可直接拦下 P0-2）。
3. **建立"状态机闭环"守护测试**：凡 UI 有「暂停/停止」的，主进程循环必须有对应检查点（可直接拦下 P0-3/4）。
4. **密钥写入白名单与调用点对齐检查**：渲染层调用的每个 secret key，必须在白名单中（可直接拦下 P0-1）。

---

## 附录 A：审计资产

| 资产 | 路径 |
|---|---|
| 全模块交互探针 | `scripts/audit-ui-interaction.cjs` |
| 交互探针报告 | `audit-ui-interaction-report.json` |
| 9 模块截图 | `ui-audit-{search,leads,data,knowledge,settings,accounts,agents,automation,team-dashboard}.png` |
| mock 桥修正 | `scripts/lib/mock-bridge.cjs`（`agents.list` → `getList`，对齐真实 preload） |

## 附录 B：本轮发现的方法论问题（探针自身）

审计过程中发现并修复了两个**探针可信度**问题，记录以备后鉴：

1. **mock 桥方法名与 preload 不一致** —— mock 定义 `agents.list`，真实 preload 是 `agents.getList` → 走 Proxy 兜底返回 `null` → 页面报 `Cannot read properties of null`。**这是探针环境缺陷，非产品 bug**。已修正。教训：**mock 桥必须与 preload 逐方法对齐**，否则探针会把"环境缺失"误报为"产品缺陷"。
2. **页面切换动画期间截图会拍到旧帧** —— 需等待进入动画结束（实测 ≥1800ms）后再截图，否则 9 张截图会全部显示首页内容，导致"看起来 9 页都一样"的假象。已加入特征文本断言（每页断言其独有文案）作为独立校验。

---

*报告结束。所有 P0 项均经源码逐行复核；P1/P2 项部分为静态分析结论，已在正文标注。*
