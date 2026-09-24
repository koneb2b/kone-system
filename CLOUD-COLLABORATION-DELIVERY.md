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
