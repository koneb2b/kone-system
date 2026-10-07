# KONE V1.3 文档一致性与隐患深度审计报告

> 审计日期：2026-10-07
> 审计范围：15 份活规范（门禁 `scripts/verify-doc-consistency.cjs` 认定）+ 20+ 份 `KONE-V1.3-*.md` 一次性报告 + 代码事实交叉验证
> 审计方法：四路并行探查 → 对每条高危结论**回到代码逐行亲自复核**（不采信二手摘要）
> 分级口径：遵循项目价值取向——**以"用户能否感知"为定级准绳**，安全/功能失效 = P0，对客口径失真 = P1，内部工程洁癖 = P2

---

## 〇、结论摘要

**现行文档门禁存在结构性盲区**：`verify-doc-consistency.cjs` 只做「字面值比对 + 引用断链 + 3 条架构红线」，
**无法发现语义矛盾、过期宣称、"已闭环"但代码未完成**。本次 5 项 P0 全部落在门禁盲区内，且门禁全绿。

更严重的是：**审计发现的头号问题不是文档问题，而是文档声称"已闭环"的功能在代码层面实际失效**。
文档写"已落地"→ 代码是坏的 → 门禁查不出来 → 形成"纸面交付"。

| 级别 | 数量 | 性质 |
|---|---|---|
| **P0 阻断** | **5** | 安全越权、功能链路失效、无提交可追溯 |
| **P1 应修** | **10** | 对客口径失真、状态机漂移、元数据过期、前后矛盾 |
| **P2 观察** | **5** | 未闭环待办、文档高估、体验项 |

---

## 一、P0 阻断项（发布前必须处置）

### P0-1 · 云端看板数据链路断裂：snake_case ↔ camelCase 零映射 ⚠️ **影响我前序交付**

**现象**：看板的投递漏斗、30 日趋势、明细表时间戳、CSV 导出时间戳**全部为空**。

**证据链（三处逐一复核）**：
| 位置 | 事实 |
|---|---|
| `kone-cloud/src/worker.ts:622-645` | SQL `SELECT ... sent_at, delivered_at, replied_at, created_at ...`，第 645 行 `data: { outreach: result.results }` **直接返回 D1 原始行，无任何映射** |
| `electron/services/cloudflare-service.ts:348-370` | 本地 `OutreachStatus` 类型全为 **camelCase**（`workspaceId` / `sentAt` / `deliveredAt` / `repliedAt` / `createdAt` ...） |
| `electron/services/cloudflare-service.ts:481` | `return body.data as PollOutreachResult` —— **仅类型强转，不做运行时转换** |

**影响**：TypeScript 的 `as` 只在编译期生效，运行时字段名仍是 `sent_at`。
结果 —— 只有 `id / status / subject / provider / error` 五个两边同名字段能显示；
**全部时间戳字段恒为 `undefined`**。

**连锁后果**（对已交付功能的实际损害）：
- `filteredRecords`（P2.8a）：`r.sentAt` 为空 → 时间戳回落 `0` → 非"全部"时间窗口下**明细表被整表过滤为空**
- 漏斗（P2.7）：`sentCount = filter(r => r.sentAt)` = 0 → **六阶段全 0**
- 趋势（P2.7）：`trend30` 全 0 → 恒显示"当前时间窗口内无投递数据"
- CSV 导出（P2.8a）：时间戳列全空
- **IMAP 回复检测**：`imap-reply-service.ts:215-224` 依赖 messageIndex，恒空 → 轮询恒 `skipped:'no_outstanding_outreach'`

> **自查声明**：本轮审计前的 P2.7 / 2.8a / 2.8d / 2.8e 四轮看板交付，
> 在缺少该映射层的前提下**呈现为空壳**——UI 骨架、交互、60s 刷新、测试连接按钮均可正常工作，
> 但**填不进真实数据**。此前所有门禁（typecheck / 315 单测 / IPC 一致性）均未覆盖跨进程字段命名，故全绿。
> 这不是"文档写错了"，而是"文档说已闭环、实际未闭环"的典型纸面交付。

**建议**：在 `cloudflare-service.ts` 落一层显式 `snake → camel` 映射（`mapOutreachRow()`），
禁止再对跨进程响应使用裸 `as` 强转；并补一条契约测试锁定字段名。

---

### P0-2 · 跨租户越权：任一邮箱退订清空全平台待发队列 🔴 **安全事故**

**位置**：`kone-cloud/src/worker.ts:454-456`

```sql
UPDATE outreach SET status = 'failed', error = 'suppressed' WHERE status = 'pending'
```

**问题**：该语句**既无 `workspace_id` 谓词，也无 email 谓词**。
抑制名单本身是全局设计（`suppressions` 表注释为 `global, workspace_id = NULL`，合理），
但把"全局抑制名单"语义错误地升级成了"全量取消"。

**影响**：**任意一个租户的任意一个邮箱执行 one-click unsubscribe
→ 全平台所有租户的所有 pending outreach 被标记为 failed**。属于跨租户数据破坏。

**建议**：补按收件人邮箱的谓词（需 JOIN `leads` / `contacts` 匹配 `normalized_email`），
并保证取消范围不超出该 suppression 实际命中的收件人。

---

### P0-3 · Webhook 事件去重键错配 → delivered / bounced 永不落库

**位置**：`kone-cloud/migrations/002_outreach_webhook.sql:19-28` + `worker.ts:788`

- 表约束：`UNIQUE(provider, event_id)`
- 代码赋值：`event_id = body.data.id`（Resend 的 **email id**）

**问题**：Resend 对同一封邮件的 `sent / delivered / bounced` **共用同一个 email id**。
首事件插入后，后续同类事件因 UNIQUE 冲突被判为重复直接返回 → **`delivered` / `bounced` 状态永远无法落库**。

**建议**：改用 `svix-id`（Resend 每个事件的唯一投递 ID），或改为 `UNIQUE(provider, event_type, event_id)`。

---

### P0-4 · `event_type` CHECK 枚举缺 `email.replied` → 回复上报直接 500

**位置**：`kone-cloud/migrations/002_outreach_webhook.sql:20-23`

```sql
CHECK (event_type IN ('email.sent','email.delivered','email.bounced',
                      'email.complained','email.opened','email.clicked'))
```

**矛盾**：`CLOUD-COLLABORATION-DELIVERY.md:282` 称 `email.replied` **已支持**；
`003_reply_detection.sql:43` 的 outreach CHECK 也含 `replied`。
但 webhook_events 表枚举**未同步新增** → 插入 `email.replied` 触发 CHECK 失败返回 500。

**建议**：migration 补 `ALTER`/新版本加 `email.replied`；并把「新增状态 → 同步所有相关 CHECK 枚举」写成 checklist。

---

### P0-5 · 73 个文件未提交：11 个"已交付版本"无提交号可追溯 🔴 **交付风险**

**证据**：
- `git log --oneline -3` → HEAD = `bef7db6`（2026-09-25，验收手册）
- `git status --porcelain | wc -l` → **73 个改动未提交**
- 当前分支 `gap-fix-p0-p1`

**影响**：CHANGELOG 中 `[1.3.3]`～`[1.3.13]`（09-28/29）**全部仅存在于工作区**。
无提交号 → 无法定位、无法回滚、无法出 hotfix、换机即丢失。
版本号序列本身连续无跳号、日期单调递增（此项合格），但**版本 ≠ 提交**。

**建议**：立即按版本粒度切分为多次提交落库（`1.3.3`…`1.3.13`），不要合成一个巨型 commit。
注意仓库约定：用 `git add -u` + 显式路径，**不要 `git add -A`**（会纳入 `release.rar` 等生成物）。

---

## 二、P1 应修项

### A. 对客口径失真（违反 PROVIDER-CAPABILITY.md 自定禁令，合规风险）

`PROVIDER-CAPABILITY.md:24` **明确禁止**宣称「官方海关提单数据库」，要求用「基于公开网页的海关线索补位」。但三处 UI 仍在用被禁口径：

| 位置 | 现文案 | 问题 |
|---|---|---|
| `src/lib/data-source-meta.ts:13` | 徽标硬编码 `label:'海关提单'` / `shortLabel:'海关'`（全站线索卡片通用，见 `search-result-card.tsx`、`leads-table.tsx:349`） | 徽标与免责声明不在同一视窗，用户只看到"海关提单" |
| `src/components/settings/base-settings-tab.tsx:51` | 「深度穿透潜客高管**个人邮箱**、海关提单与全球展会足迹」 | `email` 仅为第三方响应透传（`anysearch-provider.ts:57`），**无任何邮箱发掘/校验实现** |
| `src/hooks/use-search-engine.ts:209` | 进度 toast「通过**全网海关数据、全球展会名录**…深度穿透」 | 以权威数据库口吻播报，缺失「近似/仅供参考」限定 |

建议：徽标改「海关线索（参考）」；密钥说明改「多源 B2B 实体检索（第三方数据，字段以服务商返回为准）」；toast 补「（公开网页近似，仅供参考）」。

### B. 云端状态机与文档漂移

| # | 矛盾 | 建议 |
|---|---|---|
| 6 | `worker.ts:655` `cronSecret !== envSecret` **普通比较** ↔ 文档:247 称「常量时间比较」→ 时序侧信道，门禁标"已闭环"实未闭环 | 改为常量时间比较 |
| 7 | `worker.ts:841-844` UPDATE status **无终态守卫** ↔ 文档:287「replied 为终态、delivered/replied 互不覆盖」→ 迟到的 `email.delivered` 会把 `replied` 回退 | 加 `AND status NOT IN ('replied')` |
| 8 | `STATE-MACHINES.md:88-92` OutreachStatus 记「4+3 态」且 §1 标「未实现」↔ `003_reply_detection.sql:43` CHECK 已含 `replied`、`worker.ts:832` 已实现且多一终态 | 同步 SSOT，去掉"未实现"标注 |
| 9 | `worker.ts:582` `idempotency_key = 'outreach_'+leadId+now` **含时间戳** ↔ `UNIQUE(workspace_id, campaign_id, idempotency_key)` → 去重失效，已 delivered 的 lead 可再次入队重发 | key 去掉时间戳 |

### C. 文档前后矛盾 / 元数据过期

| # | 矛盾 | 建议 |
|---|---|---|
| 10 | `CLOUD-COLLABORATION-DELIVERY.md` **§0 仍写「当前发布判定：NO-GO」** ↔ 同文件 §13.1 已逐条记录 1.3.5/1.3.7/1.3.9/1.3.12/1.3.13 闭环，CHANGELOG 称阻断项清零 | 回写 §0 状态行 |
| 11 | `KONE-V1.3-Cloudflare…执行计划-2026-09-25.md` 称 N8N 移除「1 文件 1 处注释、1 天零风险」↔ 修订版(09-28) 订正为「8 文件/65 处/2306 行、2-3 天中低风险」；**原版无"已废弃"标注** | 原版加废弃头指向修订版 |
| 12 | `KONE-V1.3-深度审计报告…md` §五结论「核心承诺尚未闭环、暂不主打」↔ 同文件首部「执行状态更新 2026-09-03：P0 四项全部落地」 | 结论段回写 |
| 13 | `KONE-V1.3-交付前全面梳理` §6.1 `[x] packaged-smoke 通过` ↔ CHANGELOG 自认被 app.asar 进程锁阻塞 | 改为未通过并注明环境问题 |
| 14 | `help-dialog.tsx:46` / `README §五` 仍写「Phase 1 接入 Cloudflare Workers 后**将**支持脱机执行」↔ 1.3.3 已于 09-28 落地 | 改为已完成 |
| 15 | `package.json` 仍 `1.3.0`；CHANGELOG frontmatter `lastVerifiedAt: 2026-09-22` 但内容已到 09-29 | 同步版本号与校验日期 |
| 16 | `kone项目使用说明.markdown:62`「打分 **>80** 分点击 AI 深度分析」↔ `kone-PRD.md:36` 唯一宪法阈值为 **60**（80 仅存在于 `supabase-service.ts:105` 上云 Gold Filter） | 改为"建议"措辞或注明是上云阈值 |
| 17 | `README.md:12,58,69`「间隔 **15 秒**」↔ `src/lib/feature-gate.ts:82` 兜底 `cooldownMs: 12000`（同文件 :217 实时分支为 15000） | 统一兜底值为 15000 |
| 18 | `kone-PRD.md:151` §四.1「最大并发 Job 强制锁死为 **2**」↔ 同文件:31 搜索扇出 = **3**、`constants.ts:29` `SEARCH_FANOUT_CONCURRENCY = 3`；`ARCH-STANDARDS.md:195,197` 红线「>2 即架构违例」**无扇出豁免指针** | §四.1 收窄为「评分/富化=2」；ARCH-STANDARDS 补一行指向 §零.3 双域划分 |

---

## 三、P2 观察项（不阻断，但需登记）

1. **干净机器人工冒烟未执行**（8 天）：`KONE-V1.3-干净机器验收手册` 20 个判定框**全部 `☐`、0 勾选**；被两份报告定为"交付前唯一必做"。
2. **打包冒烟 B2 未跑通**：`release/.../app.asar` 进程锁，CHANGELOG 自认非代码问题。
3. **审批→二次门禁→事件回写仍未做**：`KONE-V1.3-高级版云端功能模块深度梳理` §3.2 记录了 `pending_approval` / `ApprovalRecord` / `webhookSignature` 代码检索**均为 0 处**；而 AGENTS.md 宪法第 5 条明确「高分、分阶段任务或 cloud_send 功能**永不授权投递**，必须 approval + 服务端二次门禁」。1.3.3–1.3.13 只覆盖投递与看板，**这条宪法级约束在云端链路尚无实现**。
4. **分页实际失效**：`serpapi-maps-provider.ts:104` / `serpapi-organic-provider.ts:92` `if (page === 0 && pageResults.length > 0) break` → 第一页有结果即停，**实际永不翻页**，与 PROVIDER-CAPABILITY.md 宣称的「含 pagination」不符（建议文档标注"默认单页"）。
5. **无后续承接的待办**：`交付前全面梳理` §6.2 三项建议（未知发布者话术、授权码发放流程、上手图文）与 §8 交付后 P0（线索精准度校准、首次上手体验）在 CHANGELOG 中**无任何条目承接**。

---

## 四、已核验无异常项（避免重复劳动）

以下经查证**一致**，不需处置：

- **Agent 日频上限**：`agent-service.ts:1020-1032` 先读 `store.user_config.agentDailyLimits`，缺失才回落默认值（whatsapp 3/5/100、linkedin 3/30/100、email 3/20/200），与 AGENTS.md 矩阵（Basic 5/30/20）吻合，**未违反"不得硬编码"宪法**。
- **评分权重双轨制**：`search/scoring.ts:20-37`（40/30/20/10）与 `:50-54`（55/35/10−20）两套独立实现，kone-PRD:219/237 已清楚分层，**无第三方文档混用**。
- **Provider 失败隔离**：`provider-registry.ts:124`、`search-service.ts:1680/1774` 确用 `Promise.allSettled`，单源失败不中断整轮。
- **Resend Webhook HMAC**：`worker.ts:86-116` 真实 HMAC-SHA256 + ±300s 时间窗 + 常时比较，**非占位**（此前 CHANGELOG 记为已闭环属实）。
- **对客口径 Phase -1**：README 版本表已加"需配置云端后端/目标态"注，UI（automation-workflow / dashboard-page / upgrade-modal / help-dialog）均已标注。
- **门禁已守护的 15 项宪法常量**全部一致（不重复列）。
- **Provider 其余 6 个**（除上述分页与口径问题）宣称与实现基本一致；`yellow_pages` 弃用属实且已标 `available:false`。

---

## 五、建议处置顺序

```
立即（今日）
 ├─ P0-5  提交落库：73 个改动按版本切分提交（git add -u，勿 -A）
 ├─ P0-2  修跨租户 UPDATE（安全，最高优先）
 └─ P0-4  migration 补 email.replied 枚举

本周
 ├─ P0-1  补 snake→camel 映射层 + 契约测试（否则看板永远空）
 ├─ P0-3  webhook 去重键改 svix-id
 ├─ P1-A  三处对客口径整改（合规）
 └─ P1-B  cronSecret 常量时间比较 / replied 终态守卫

交付前
 ├─ P1-C  文档回写（§0 NO-GO、原版废弃标注、结论段、版本号）
 ├─ P2-3  落实审批二次门禁（宪法级约束，云端尚无实现）
 └─ P2-1  干净机器 20 项人工冒烟
```

---

## 六、方法论建议（治本）

本次 5 项 P0 **全部落在现有门禁盲区**，且门禁全绿。建议为 `verify-doc-consistency.cjs` 增加三类检查：

1. **跨进程字段命名一致性**：扫描 `kone-cloud` 的 SQL SELECT 列与本地 TS 契约字段名，强制要求存在显式映射函数，禁止裸 `as` 强转跨进程响应。
2. **"已闭环"宣告 → 代码反证**：对文档中 `已落地/已闭环/已完成` 标记，随机抽查对应符号在代码中是否存在且非 stub。
3. **危险 SQL 模式扫描**：`UPDATE/DELETE` 语句缺失 `workspace_id` 谓词即告警（本次 P0-2 可直接拦下）。

> 说明：本条属内部工程项，**不作为交付阻断**（遵循项目"内部洁癖不阻断"价值取向），
> 但 P0-2 这类安全问题一旦发生即为用户可感知的跨租户事故，故建议尽早补。
