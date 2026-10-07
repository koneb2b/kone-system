# Kone 云端协同与投递规范

> **文档角色：领域唯一事实源（SSOT）**  
> 本文件唯一负责：本地审批后上云、云端二次门禁、团队防撞、投递队列、抑制、Webhook、回复、配额、熔断、租户隔离及状态回写。  
> 产品定位、套餐与用户旅程以 `kone-PRD.md` 为准；本地 IPC 以 `src/shared/ipc-contracts.ts` 与 `electron/ipc/channels.ts` 为准；Provider 能力以 `PROVIDER-CAPABILITY.md` 为准；运行部署以 `V1.2-商业版交付与运维手册.md` 为准。

## 0. 状态与适用范围

- 规范版本：v1.0
- 规范状态：目标态基线
- 实现状态：除项目现有明确标注为已落地的能力外，本文件新增的审批、云端队列、事件与回写能力均为**待实现目标态**，不得对外宣称已经交付。
- 当前发布判定：`NO-GO`。只有第 13 节门禁全部通过并保留证据后，才可转为 `GO`。

## 1. 一体化职责边界

### 1.1 本地 Kone

负责多源搜索、官网富化、规则准入、确定性评分、LLM 机会分、邮箱验证、证据摘要、草稿生成、人工审批和本地工作台展示。

本地不得：
- 将原始 HTML、未筛选候选池、秘密或会话凭据上传云端；
- 将“高分”直接等同于“允许发送”；
- 绕过云端门禁创建远端投递；
- 仅凭前端乐观状态显示“已发送/已送达”。

### 1.2 云端控制面

负责工作区权限、团队防撞、抑制、审批复核、幂等、配额、熔断、队列、投递提供商适配、事件审计和状态分发。

云端不得：
- 信任客户端传入的最终授权结论；
- 将投递提供商状态直接等同于业务状态；
- 因重新导入或重新评分自动解除抑制；
- 在验签失败时写入 Webhook 事件或修改业务状态。

### 1.3 人工销售

负责复核证据、确认联系人、编辑草稿、批准或驳回、处理人工例外、接管回复、报价与成交。

## 2. 权威状态字典

### 2.1 线索业务状态 `LeadBusinessStatus`

`new -> scored -> pending_approval -> approved -> queued -> sent -> replied`

异常/终止分支：`rejected | suppressed | failed | archived`

语义：
- `approved` 只表示人工批准，不表示云端已接受；
- `queued` 仅在云端完成二次门禁并创建投递任务后产生；
- `sent` 只表示提供商已接受发送或完成发送动作，不表示送达；
- `replied` 只能由真实回复事件触发；
- `suppressed` 优先级最高，覆盖投递和跟进资格。

### 2.2 投递状态 `OutreachStatus`

`pending -> accepted -> sent -> delivered`

异常分支：`bounced | complained | failed`

`delivered` 不得自动映射为 `replied`。临时退信与永久硬退必须区分；只有永久硬退进入全局抑制。

### 2.3 跟进状态 `FollowupStatus`

`not_started -> pending_manual -> scheduled -> paused -> stopped -> completed`

收到回复、退订、投诉、永久硬退或人工停止后，未来自动跟进必须进入 `stopped`。

### 2.4 本地兼容映射

现有 `new | contacting | replied | archived` 是当前实现的简化状态，不得继续扩写承担云端投递语义。迁移前：
- `contacting` 仅作为旧 UI 聚合显示；
- 云端投递与跟进状态存入独立字段/实体；
- 不得把 `bounced`、`complained`、`suppressed` 塞入旧 `LeadStatus` 联合类型后不做迁移。

## 3. 身份、唯一键与幂等

| 层级 | 规范键 | 用途 |
|---|---|---|
| 工作区 | `workspace_id` | 租户隔离与权限边界 |
| 公司 | `normalized_domain` | 公司归并、归属和保护期防撞 |
| 联系人 | `normalized_email`；缺失时 `normalized_name + title + domain` | 联系人身份与验证记录 |
| 投递 | `workspace_id + campaign_id + normalized_email + sequence_stage` | 防止同一序列重复发送 |
| 消息 | provider `message_id` | 回执、回复与事件关联 |
| 请求 | `idempotency_key` | 防止网络重试重复建队列 |

规范化邮箱：`trim().toLowerCase()`。公司去重不得覆盖同一公司的不同合法联系人。

## 4. 邮箱验证与发送准入

保留五级验证：`verified | probable | catch_all | risky | invalid`。

| 等级 | 默认准入 |
|---|---|
| `verified` | 可进入审批，批准后可自动入队 |
| `probable` | 必须人工确认并记录原因后才可入队 |
| `catch_all` | 必须人工确认，进入低频策略并展示风险 |
| `risky` | 默认阻断；仅受控例外可放行 |
| `invalid` | 强制阻断，并作为抑制候选 |

SMTP/DNS 探测是弱信号，不得宣称 100% 真实性。人工例外至少记录：操作人、时间、原因、原验证等级和草稿版本。

## 5. 本地待审批准入

线索同时满足以下条件才可进入 `pending_approval`：

1. 未命中 Eligibility Gate 硬否决；
2. 达到产品定义的评分阈值；
3. 有可触达联系人；
4. 邮箱符合准入等级或具备人工确认条件；
5. 未命中本地已知抑制；
6. 团队撞单/保护期检查无未解决冲突；
7. 证据、风险、验证等级和草稿已生成，或明确记录降级原因。

## 6. 审批记录

每次批准必须形成不可覆盖的 `ApprovalRecord`：

- `approval_id`
- `workspace_id`
- `lead_id` / 本地引用 ID
- `approver_id`
- `decision: approved | rejected | needs_revision`
- `approved_at`
- `draft_version`
- `email_verification_grade`
- `manual_exception_reason?`
- `risk_snapshot`

草稿修改后版本必须变化；旧批准不得自动授权新草稿发送。

## 7. 最小化上云载荷

### 7.1 必需字段

- `schemaVersion`
- `idempotencyKey`
- `workspaceId`
- 本地稳定引用 ID
- 公司、规范化域名
- 联系人、规范化邮箱
- 评分与证据摘要
- 邮箱验证等级及人工例外记录
- `approvalId`、审批人、审批时间、`draftVersion`
- 经批准的主题和正文
- `campaignId`、`sequenceStage`

### 7.2 禁止字段

- 原始网页 HTML 或完整爬虫正文
- 未准入候选列表
- API Key、SMTP 密码、Cookie、Session
- 本地浏览器配置与文件路径
- 与本次投递无关的联系人或团队数据

## 8. 云端二次门禁顺序

云端必须按以下顺序 Fail-Closed：

1. 用户/服务身份鉴权；
2. `workspace_id` 权限与租户隔离；
3. Schema 版本和字段校验；
4. `idempotency_key` 去重；
5. 公司与联系人撞单、保护期校验；
6. 全局抑制检查；
7. 审批记录、审批人和草稿版本校验；
8. 邮箱等级与人工例外审计校验；
9. 发信域名健康、账户授权、日配额和熔断检查；
10. 创建队列任务和审计事件。

任一失败均返回稳定错误码、用户可读原因和可行动建议；不得静默忽略或伪装为已触发。

## 9. 云端核心实体

- `companies`：规范化域名、工作区归属、保护期；
- `contacts`：联系人、规范化邮箱、验证等级、例外；
- `leads`：评分、证据摘要、审批和业务状态；
- `approvals`：不可覆盖的审批记录；
- `outreach`：队列、投递、阶段、provider message ID；
- `events`：审批、同步、发送、回执、退订、回复、失败事件；
- `suppressions`：规范化邮箱、原因、来源、时间和解除审计。

事件表采用追加式写入；业务聚合状态可更新，但不得删除原始审计事件。

## 10. 抑制、退订与回复

抑制原因：`user_unsubscribe | one_click_unsubscribe | hard_bounce | complaint | manual`。

规则：
- 退订、投诉和永久硬退立即阻断待发送任务和后续跟进；
- 重新导入、重新评分、修改草稿不得解除抑制；
- 解除抑制必须人工授权并保留事件；
- 回复按 `Message-ID` 或 provider 关联键去重；
- 真实回复触发 `LeadBusinessStatus=replied` 和 `FollowupStatus=stopped`，同时通知负责销售。

## 11. Webhook 与事件安全

- Webhook 必须校验签名、时间窗和事件唯一键；
- 验签失败返回未授权，不写库、不改状态；
- 重复事件幂等返回，不重复触发通知或状态迁移；
- `delivered` 仅更新投递状态；
- 临时退信进入受控重试，不消耗新的业务审批；
- 永久硬退和投诉必须写抑制；
- 回写失败进入可观察的重试/死信机制，不得丢失或伪装成功。

## 12. UI/UX 必备状态

前端至少提供：

1. 待审批队列；
2. 证据、评分、风险、邮箱等级和团队冲突详情；
3. 草稿编辑、版本与批准记录；
4. 本地预检、云端拒绝、排队、发送、送达、退订、投诉、硬退、回复状态；
5. 单线索事件时间线；
6. 配额、DNS、熔断、抑制和同步失败的可行动解释；
7. 回复后的人工接管入口。

禁止伪进度、假成功和把未评分渲染为 0 分。

## 13. 发布门禁

以下任一项未满足，发布状态均为 `NO-GO`：

- 未审批、抑制命中、撞单、草稿版本不一致、超配额、重复请求不能被稳定拒绝；
- `idempotency_key` 重试可能重复建任务或重复发送；
- Webhook 验签、时间窗、去重、永久硬退/投诉抑制未通过端到端测试；
- `delivered` 与 `replied` 混写，或回复后仍继续自动跟进；
- 未证明跨工作区读取、写入、撞单查询和事件订阅隔离；
- 密钥出现在普通配置、Renderer、日志或安装包；
- 云端状态不能可靠回写，用户无法理解失败原因；
- 构建、契约、E2E、打包冒烟、小流量实发任一验证缺失；
- 发布制品缺少提交号、依赖锁、哈希、测试结果、签名、灰度阈值或回滚责任人；
- CI 将 `timed_out`、`action_required`、空结果等非成功状态判为通过。

### 13.1 Phase 2 · Resend 投递闭环门禁（V1.3+）

Phase 2 引入云端 Resend 投递闭环后，`NO-GO` 判定额外叠加以下门禁；Phase 1 的 13 条通用门禁在本阶段同样生效。

**1. D1 迁移（`migrations/002_outreach_webhook.sql`）**
- `webhook_events` 表建齐：`UNIQUE(provider, event_id)` 唯一约束生效，`workspace_id` 可为 NULL（Webhook 是全局回调）；
- `outreach` 扩展列 `resend_id` / `send_attempts` / `next_retry_at` 均落表；
- 三个新索引（`idx_outreach_queued`、`idx_outreach_resend_id`、`idx_webhook_events_*`）在 `EXPLAIN QUERY PLAN` 下命中。

**2. Worker 路由（`/outreach/queue`、`/outreach/status`、`/cron/send`、`/webhooks/resend`）**
- `/outreach/queue` 幂等：同一 lead 已有 `pending` outreach 时返回相同 `id`，`idempotent: true`；
- `/outreach/queue` 状态机守卫：`lead.status` 必须为 `approved` 或 `queued`，否则返回 `LEAD_NOT_APPROVED (400)`；
- `/cron/send` 双重门禁：`X-Cron-Secret` 与 `env.CRON_SECRET` 常量时间比较；密钥不匹配返回 `UNAUTHORIZED (401)`；
- `/cron/send` 批量扫描：`LIMIT 50` 上限；JOIN `leads`+`contacts` 解析收件人 `normalized_email`，缺失即标记 `failed`；
- `/cron/send` 指数退避：失败时 `send_attempts++` 且 `next_retry_at` 按 `60s / 300s / 900s / 3600s` 阶梯推进；
- `/webhooks/resend` **真实 HMAC-SHA256 签名验证（Svix 规范，P2-13 完成）**：读取 raw body → 用 `env.RESEND_WEBHOOK_SECRET`（`whsec_<base64>` 格式，剥离前缀后 base64 解码为 key 字节）计算 `base64(HMAC-SHA256(key, "${svix-id}.${svix-timestamp}.${rawBody}"))`，与 `svix-signature: v1=<base64>` 头逐个做**常时比较**（防时序攻击）；±300s 时间窗拒绝过期重放；`webhook_events.UNIQUE(provider, event_id)` 做事件级幂等去重；
- `/webhooks/resend` 缺失/伪造/过期签名均返回 `UNAUTHORIZED (401)`，无降级路径（`x-resend-signature` 存在性检查已移除，避免 Fail-Closed 旁路）；
- `/webhooks/resend` 状态映射：`email.delivered` / `email.bounced` / `email.complained` 分别落到 `delivered_at` / `bounced_at` / `complained_at`；
- 路由顺序：`/webhooks/resend` 与 `/cron/send` 位于 Bearer 认证之前，独立走自身鉴权通道。

**3. 客户端本地层**
- `cloudflare-service.queueOutreach()` / `pollOutreachStatus()` 通过 `Authorization: Bearer <apiKey>` 与 `X-Schema-Version: 1.0.0` 访问；
- `automation-service` 的 `QUEUE_OUTREACH` 通道经 `registerIpc` 登记至 registry，走 `ensureTrialAccess` + `licenseGuard` 双门禁（premium feature）；
- `outreach-sync-service` 每 60s 轮询 `pending` / `sent` / `delivered` / `bounced` 四种状态，映射到本地 `AgentStatus.whatsappStatus` 与 `emailSequenceStage`，经 `AGENT.LEAD_STATUS_UPDATED` 推送至渲染进程。

**4. 端到端验证（Phase 2 强制门禁）**
- `kone-cloud/tests/worker.test.ts` **29 项全绿**：包含 27 项路由/授权/幂等/签名 + 2 项 E2E 旅程（正常闭环 + 失败退避）；
- 根工程 `npm run test:unit` **315 项全绿**（`ipc-startup-gate` 已按新增 `automation:queue-outreach` 通道更新为 52）；
- `npm run typecheck` 通过（本地 + worker 两侧）；
- E2E 旅程断言序列：`createApprovedLead → queue → cron send (mocked Resend) → outreach.sent event → webhook email.bounced (Svix HMAC 签名) → outreach.status='bounced' + webhook_events 审计 → 二次 cron 不再重发`；
- Webhook 签名专项用例：签名正确→200 / 无签名→401 / 篡改签名→401 / 过期时间戳（重放攻击）→401 / 重复事件→幂等 true。

**5. §13 通用门禁对应关系（Phase 2 覆盖映射）**
- 「未审批/抑制/撞单/重复请求不能被稳定拒绝」→ `/outreach/queue` `LEAD_NOT_APPROVED` + `existing.pending` 幂等短路；
- 「idempotency_key 重试不能重复建任务或重复发送」→ outreach 层按 `leadId + status='pending'` 去重；webhook 层按 `webhook_events.UNIQUE` 去重；
- 「Webhook 验签/时间窗/去重/永久硬退抑制」→ Svix HMAC-SHA256 签名 + ±300s 时间窗 + 常时比较 + `webhook_events` 唯一约束 + `bounced/complained` 状态终态（P2-13 完成）；
- 「`delivered` 与 `replied` 不混写」→ 两者分别落 `delivered_at` / `replied_at`，互不覆盖；
- 「跨工作区读写隔离」→ 所有 SQL 均带 `workspace_id = ?` 谓词；webhook 走 `resend_id` 精确匹配而非全表；
- 「密钥不出现于普通配置/日志」→ `RESEND_API_KEY` / `CRON_SECRET` / `RESEND_WEBHOOK_SECRET` 均通过 `wrangler secret put` 注入；E2E 使用独立的测试常量 `test-resend-key` / `test-cron-secret` / `whsec_<base64>`；
- 「云端状态可靠回写」→ `outreach-sync-service` 60s 轮询 + `AGENT.LEAD_STATUS_UPDATED` 推送；失败原因经 `error` 字段回写；
- 「构建、契约、E2E、打包冒烟、小流量实发」→ 见 §13.1.4 测试矩阵（小流量实发在交付前于干净机器人工执行，见 MEMORY.md）。

**6. IMAP 回复检测（Phase 2.5 · In-Reply-To 精确匹配，V1.3.6+）**

Phase 2 的投递闭环只到 Resend 侧的 `delivered / bounced / complained` 三态；客户回复邮件的接收由本地 IMAP 承担。本节规定"回复检测"这一子闭环的落地条件。

- **D1 迁移**（`migrations/003_reply_detection.sql`）：`outreach.status` CHECK 扩展为 `('pending','sent','delivered','bounced','complained','failed','replied')`（SQLite 不支持修改 CHECK，需建 `_new` 表→INSERT SELECT 复制→DROP 原表→RENAME→重建全部索引）；新增 `email_opened_at` / `email_clicked_at` 列；新增 `email_replies` 表并带 `UNIQUE(outreach_id, message_id)` 幂等键 + 3 个索引；新增 `idx_outreach_sent_at` 供 IMAP poller 的 `since` 窗口扫描。
- **Webhook 事件扩展**（`/v1/webhooks/resend`）：switch 新增 `email.opened`（落 `email_opened_at`，状态保持 `delivered`）/ `email.clicked`（落 `email_clicked_at`，状态保持 `delivered`）/ `email.replied`（落 `replied_at`，置 `replied` 终态）。Svix HMAC-SHA256 签名验证、±300s 时间窗、常时比较、事件级 `UNIQUE(provider, event_id)` 去重复用 §13.1.2 实现。
- **新路由** `POST /v1/outreach/reply`（`handleReportReply`）：入参 `outreachId` + `messageId` + `sender`（必填）+ `inReplyTo` / `subject` / `replyBody` / `receivedAt`（选填）；先按 `(id, workspace_id)` 校验 tenant 隔离，缺失返回 `OUTREACH_NOT_FOUND (404)`；再按 `UNIQUE(outreach_id, message_id)` 幂等短路返回既有 `id + idempotent:true`；命中则写入 `email_replies` 存档 + `events type='outreach.replied' actor='imap_poller'` 审计 + bump `sync_tokens`，并将 outreach 置为 `replied`。响应体携带 `idempotent: true|false` 让本地 poller 决定是否重复推送本地状态。
- **本地 IMAP poller**（`electron/services/imap-reply-service.ts`）：`imapflow` 连接 INBOX → 搜索 `since = now - lookbackDays`（默认 3 天）→ 拉 `envelope + headers:['In-Reply-To','References','Message-Id']` → 归一化（小写、去 `< >` 角括号、去空白）后与云端 `outreach.provider_message_id` map 匹配 → 命中即 `POST /v1/outreach/reply` 上报，且云端 `idempotent:false` 时推送 `AGENT.LEAD_STATUS_UPDATED`（`whatsappStatus='replied'`）。**IMAP 与 `email-agent.checkReply` 不重叠**：前者按 `In-Reply-To` 匹配具体 outreach 的 `provider_message_id`（云端闭环），后者按发件人域名判断 lead 是否回过邮件（本地 Agent 序列推进）。
- **Fail-Closed**：`cloudflare` 未配置即 `skipped: 'cloudflare_not_configured'`；`user_config.accounts.email.imapHost` 未显式设置即 `skipped: 'imap_not_configured'`（**不做 smtpHost → imapHost 派生**——IMAP 与 SMTP 主机名不同，如 `smtp.gmail.com` vs `imap.gmail.com`，派生会产生假阳性）。IMAP 凭证回退链：`imapUser → smtpUser`；`imapPass → secret-manager(EMAIL_SMTP_PASS) → smtpPass(明文遗留)`。skip 均为静默降级，不抛错、不阻塞其他 sync。
- **幂等**：云端 `UNIQUE(outreach_id, message_id)` 保证重复轮询不上报（返回既有 `id + idempotent:true`）；本地 poller 遇 `idempotent:true` 不重复推送本地状态。
- **状态机**：`replied` 是 outreach 终态，Cron 定时投递遇 `replied` 短路跳过（不覆盖 `delivered / bounced / complained`）；`delivered` 与 `replied` 分别落 `delivered_at` 与 `replied_at`，互不覆盖。
- **Timer 挂载状态**：[V1.3.10] P2.8b 已挂载。`startImapReplyPoll()` / `stopImapReplyPoll()` 与 `startOutreachSync()` / `stopOutreachSync()` 均在 `main.ts` 的 `whenReady()` 中 `registry.lock()` 之后调用，并在 `app.on('before-quit')` 中停止。首次轮询延迟 5 秒（对齐两个 service 的启动节奏），`cloud.imapReplyDetectionEnabled` 默认 false（保守，需客户显式开启），`cloud.outreachSyncEnabled` 默认 true。IMAP 未开启时 `startImapReplyPoll` 立即返回，timer 保持 null，无副作用。
- **开关 UI 状态**：[V1.3.11] P2.8c 已落地。`accounts-management.tsx` 邮箱表单新增"自动回复检测"区块：Switch 开关 + 轮询间隔（5/15/30/60 分钟 chip）+ 回溯天数（1/3/7 天 chip）。切换后调 `automation:imap-restart` IPC 让主进程即时重启 timer（`stopImapReplyPoll → startImapReplyPoll`），无需重启应用。三档默认值与主进程 `getImapReplyConfig` 完全一致（`enabled=false / interval=15min / lookback=3d`）。
- **连接测试按钮**：[V1.3.12] P2.8d 已落地。云端看板 IMAP 面板新增 `automation:imap-test-connection` IPC + "测试连接"按钮，与"立即轮询一次"并列 2 列。主进程纯 `connect` + `getMailboxLock('INBOX')`（不拉邮件、不上报云端），30s socketTimeout，未配置时 Fail-Closed 返回引导文案。独立 ImapFlow 实例，不占用 `clientLocks`，与后台 timer 并发安全。用户可在 30 秒内验证 IMAP 主机/端口/凭据是否有效，不再等一个 poll interval 才发现配置错误。
- **未闭环项**：小流量实发验证需真实 Resend + IMAP 环境在干净机器执行；定时轮询 timer 挂载需在客户 IMAP 服务器并发上限确认后决策。以上均不阻断 V1.3.6 发布。
- **V1.3.7 闭环**：`user_config.accounts.email.imapHost` 字段已在 `accounts-management.tsx` 邮箱表单中作为独立"IMAP 收信（可选）"分区暴露；IMAP 密码独立加密槽位 `secrets.email.imapPass` 已加入 `SECRET_KEYS`，回退链 `imapPass 加密 → imapPass 明文遗留 → smtpPass 加密 → smtpPass 明文遗留` 允许共用密码场景直接留空 IMAP 密码字段。用户现已可在 Settings 中零手工完成 IMAP 配置（详见 `CHANGELOG.md` [1.3.7] 条目）。

**7. 云端触达看板（Phase 2.7 · V1.3.8+）**

Phase 2 / 2.5 / 2.6 三条链路全部落地后，用户仍看不到"投递了多少、送达多少、被谁回复"。本节规定"看板"这一 UI 层的落地条件。

- **新增 IPC 通道**：`cloud:cloudflare-dashboard-stats`（`getDashboardStats`）+ `cloud:cloudflare-poll-outreach-status`（`pollOutreachStatus({limit, status, offset})`）；两处 handler 均封装 `success` / `error` 双态返回，Fail-Closed 展示"未连接"占位而非崩溃。
- **新增类型**（`src/shared/ipc-contracts.ts`）：`CloudDashboardStats` / `CloudOutreachRecord` / `CloudPollOutreachData` / `CloudImapPollResult` / `CloudImapStatusData`，与云端 D1 schema 保持字段对齐。
- **前端 wrapper**（`src/lib/electron-api.ts`）：`cloudflareDashboardStats()` / `cloudflarePollOutreachStatus(opts)` / `imapPoll()` / `imapStatus()` 四个入口。
- **组件**（`src/components/cloud-outreach-dashboard.tsx`）：KPI 8 卡 + 三大比率 + 投递漏斗 6 阶段 + IMAP 状态面板 + 30 日趋势迷你图 + 三态展示（未配置 / 加载 / 就绪）；嵌入 `automation-workflow.tsx` 顶部，仅在 `canUseCloudSend`（tier=premium 或 plan=enterprise）为 true 时显示。
- **诚实标注**：送达率分母 = `sent - bounced - complained`，避免投诉计入送达；漏斗每阶段单独分母（sent 系以 sent 为分母，排队以 total 为分母），页面底部固定一行说明文案。
- **手动入口**：IMAP 面板"立即轮询一次"按钮调用 `imapPoll()`，提供用户主动干预的入口（弥补初次启动到首次自动轮询之间的 5 秒延迟空档）。[V1.3.10] P2.8b 起，`startImapReplyPoll()` 定时器已在 `main.ts` 挂载；未开启自动轮询时，用户仍可通过"立即轮询一次"手动触发。
- **V1.3.9 闭环（Phase 2.8a）**：看板追加"时间窗口筛选（近 7 天 / 30 天 / 90 天 / 全部）+ 投递明细表（50 行预览）+ CSV 导出（含 UTF-8 BOM，Windows Excel 兼容）"。时间窗口仅作用于漏斗 / 趋势 / 明细；KPI 卡仍展示云端聚合总量（与云端 dashboard API 口径一致，避免用户误读）。数据源仍为 `pollOutreachStatus({limit:300})`，无新增 IPC、无云端 API 改动。
- **V1.3.13 闭环（Phase 2.8e）· 60 秒自动刷新**：看板组件在 `ready` 态自动启动 60s `setInterval`，调用 `refreshSilent()`（不切 `view` 到 `loading`，避免打断用户操作；仅原地更新 `stats / records / imap / loadedAt`）。`document.visibilityState` 判断：切到 `hidden` 立即暂停，切回 `visible` 立即拉一次；组件卸载时清理 timer + 事件监听。无新增 IPC，无云端 API 改动。刷新信号唯一可见于页面顶部"更新于 HH:mm:ss"时间戳。
- **未通过门禁时的处置**：看板是"锦上添花"层，非核心门禁。数据源失败仅降级为看板空态，不影响 Phase 2 主链路判定。

**未通过门禁时的处置**：Phase 2 任一子项未通过 → 整体 `NO-GO`，禁止发布 V1.3-RC；已实现子项在 `CHANGELOG.md` 与本地工作日志（`.workbuddy-ai/memory/` 目录下按日期归档）留痕后方可申请复评。Phase 2.5 子项未通过 → V1.3.6 延后至 V1.3.6-rc2 复评。

## 14. 变更治理

涉及本规范中的状态机、字段、权限、投递、事件、API 或合规规则时，变更必须同时提供：

1. 变更动机；
2. 受影响 SSOT；
3. 兼容性影响；
4. 数据/状态迁移；
5. 回滚方案；
6. 测试更新；
7. 验收标准；
8. 责任人；
9. 生效版本。

本文件不重复 Provider 能力、不定义本地 IPC 具体字段、不定义部署命令；相应内容必须引用各自 SSOT。
