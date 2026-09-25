# KONE 高级版云端功能模块 · 全面深度梳理

> **日期**：2026-09-25 ｜ **基线**：HEAD `5d3ea48`
> **依据（强制文档链）**：`CLOUD-COLLABORATION-DELIVERY.md`（**领域唯一事实源**）+ `kone-PRD.md §5.1`（**产品真值**）
> **方法**：先读两份 SSOT，再**逐条对照实现**取证，最后给出缺口分级与建议。

---

## 0. 结论（TL;DR）

| 问题 | 结论 |
|---|---|
| 云端模块实现到什么程度？ | **部分落地 + 大量目标态**。本地侧协同脚手架已可用；**审批 → 云端门禁 → 投递 → 事件回写闭环未实现**。 |
| 规格自身的判定？ | `CLOUD-COLLABORATION-DELIVERY.md §0` 明写：**"当前发布判定：`NO-GO`。只有第 13 节门禁全部通过并保留证据后，才可转为 `GO`。"** |
| **最大风险** | ⚠️ **对客夸大**：`README.md` 将"云端邮箱清洗 / N8N 自动化""团队协作 / 防撞单"标为**高级版开放**，**且无"目标态"标注**；前端亦无未实现提示。与规格"不得对外宣称已交付"**直接冲突**。 |
| 建议 | ① **立即对齐对客口径**（加"目标态/路线图"标注）；② 云端闭环**单独立项**；③ 按 §13 门禁清单验收。 |

---

## 1. 规格基线（两份 SSOT 的分工）

| 文档 | 角色 | 关键声明 |
|---|---|---|
| `kone-PRD.md §5.1` | **产品真值** | 8 条产品规则 + 套餐边界：`cloud_send` 只是**授权条件**，**不等于审批通过，不得单独作为发送许可** |
| `CLOUD-COLLABORATION-DELIVERY.md` | **领域真值** | 14 节：状态字典 / 身份幂等 / 邮箱准入 / 审批 / 最小化载荷 / 二次门禁 / 实体 / 抑制 / Webhook / UI 必备 / **发布门禁** / 变更治理。**状态：目标态基线，`NO-GO`** |

**规格自身的三条硬约束**：
1. 「除项目现有明确标注为已落地的能力外，本文件新增的**审批、云端队列、事件与回写能力均为待实现目标态，不得对外宣称已经交付**。」（§0）
2. 「本地不得将'高分'直接等同于'允许发送'；不得绕过云端门禁创建远端投递；不得仅凭前端乐观状态显示'已发送/已送达'。」（§1.1）
3. 「云端不得信任客户端传入的最终授权结论。」（§1.2）

---

## 2. 目标态主链路（PRD §5.1）

```
多源搜索与富化 → Scout 准入 → 确定性评分 → LLM 机会分 → 邮箱验证
  → 商机卡与草稿 → pending_approval → 人工批准 → 最小化上云
  → 云端二次门禁 → 队列/投递 → Webhook/回复事件 → 本地与团队状态回写
```

**三态必须分离**（§5.1.1）：
- 业务状态：`new → scored → pending_approval → approved → queued → sent → replied`（异常 `rejected|suppressed|failed|archived`）
- 投递状态：`pending → accepted → sent → delivered`（异常 `bounced|complained|failed`）
- 跟进状态：`not_started → pending_manual → scheduled → paused → stopped → completed`

---

## 3. 实现审计（逐项对照取证）

### 3.1 ✅ 已落地（本地侧，可对外宣称）

| 能力 | 实现位置 | 证据 |
|---|---|---|
| **团队防撞（域名级）** | `supabase-service.checkDomainCollision` / `checkDomainCollisions` | 按 `normalized_domain` 查询已认领域名；**网络不可达时保守判定"不能假设无碰撞"**（Fail-Closed） |
| **线索上云同步** | `syncLeadToCloud` / `upsertLead` | 按 `(domain, owner_machine_id)` 联合主键防重；**本轮已修复"漏校验 email"**（§L157） |
| **上云 Gold Filter** | `electron/utils/cloud-sync-gate.ts` | 评分门槛 + **email 非空**双条件（本轮新增，含 6 条测试） |
| **最小化载荷（部分）** | `compactLead` | 仅传 domain/email/company/country/ai_tags/score/owner；**不传原始 HTML**（符合 §7.2） |
| **团队线索 / 投递跟踪拉取** | `fetchTeamLeads` / `fetchTrackingStatus` / `fetchClaimedDomains` | 只读拉取 |
| **实时协同订阅** | `CLOUD.SUBSCRIBE_REALTIME` / `REALTIME_LEAD_EVENT` | Supabase Realtime 通道 |
| **活动创建** | `createCampaign` | 写入 Supabase（含重复键回退） |
| **邮箱五级分级** | `automation-service` | `verified/probable/catch_all/risky/invalid` + 队列分级（primary / throttled） |
| **本地抑制名单** | `electron/services/email-suppression.ts` | `isEmailSuppressed` / `addSuppression` / `removeSuppression` / `readSuppressionList`，已注入 Email Agent 发送前门禁 |
| **授权级 Fail-Closed 拦截** | `registerSecureFeatureIpc` | 全部 11 个 CLOUD 通道均经授权校验包装 |

### 3.2 ❌ 未落地（目标态，**不得对外宣称**）

| 规格要求 | 实现状态 | 取证 |
|---|---|---|
| **§2 权威状态字典**（`LeadBusinessStatus` / `OutreachStatus` / `FollowupStatus`） | ❌ **类型不存在** | grep `electron/`+`src/shared/` → **0 文件** |
| **§5 本地待审批准入**（`pending_approval`，7 条件） | ❌ 未实现 | grep `pending_approval` → **0 文件** |
| **§6 审批记录**（`ApprovalRecord` + 草稿版本） | ❌ 未实现 | grep `ApprovalRecord` → **0 文件** |
| **§8 云端二次门禁**（10 步 Fail-Closed） | ❌ 未实现 | `createCampaign` 内**无** approval/suppression/quota 校验，仅直接写入 |
| **§11 Webhook 验签 / 时间窗 / 去重** | ❌ 未实现 | grep `webhookSignature` → **0 文件** |
| **§9 云端事件审计表**（append-only） | ❌ 未实现 | 无 events 表写入 |
| **§3 投递幂等键全链路**（`workspace+campaign+email+sequence_stage`） | 🟡 部分 | `sequenceStage` → **0 文件** |
| **§7 载荷必需字段**（`schemaVersion`/`approvalId`/`draftVersion`/`campaignId`/`sequenceStage`） | 🟡 部分 | 仅 `schemaVersion`/`campaignId` 有少量出现；审批相关字段缺失 |
| **§12 UI 必备状态**（7 项：待审批队列 / 事件时间线 / 团队冲突 / 回复接管…） | ❌ 未实现 | 前端无对应界面 |
| **§13 发布门禁** | ❌ 未通过 | 规格自身判定 `NO-GO` |

---

## 4. 缺口分级（按用户/合规影响）

| 级别 | 缺口 | 影响 |
|---|---|---|
| **P0（合规/信任）** | **README 与前端宣称"高级版开放云端功能"但无目标态标注** | 客户按"完整云端协同"付费 → **预期落空**，构成对客夸大；与规格 §0 直接冲突 |
| **P0（安全）** | **无云端二次门禁**（§8） | 当前 `createCampaign` 直接写库，**无审批/抑制/配额/幂等校验**；一旦启用云端投递，存在**误发/重复发/超配额**风险 |
| **P1（功能闭环）** | 无审批流（§5/§6）、无权威三态（§2）、无事件审计（§9） | 无法回答"这条线索谁批准、何时批准、发了几次、为什么失败" |
| **P1（合规）** | 无 Webhook 验签（§11） | 伪造回执可污染业务状态 |
| **P2（体验）** | UI 必备状态缺失（§12） | 用户看不到同步/投递/失败原因 |

---

## 5. 风险与合规评估

| 风险 | 说明 | 处置建议 |
|---|---|---|
| **对客夸大（最高优先）** | README 版本对照表把云端能力标为"高级版开放"，规格却要求"不得对外宣称已交付" | **立即在 README / UI 加"目标态/路线图"标注**，或改为"规划中" |
| **绕过控制面风险** | PRD §5.1 规则 7：本地 Email Agent **不得作为绕过云端控制面的平行批量通道** | 当前本地 Agent 已有抑制门禁 + 授权拦截，但**无审批与配额统一**；需在立项时统一 |
| **误发/重复发** | 无二次门禁 + 无幂等键全链路 | 云端投递**启用前必须**先落地 §8 + §3 |
| **状态污染** | 无三态分离，`delivered` 可能被当成 `replied` | 迁移前禁止把投递语义塞进旧 `LeadStatus`（规格 §2.4 已明令） |

---

## 6. 建议

### 6.1 立即执行（无需立项，低成本）
1. **对齐对客口径**：README 版本对照表中云端两项**加注"（目标态/路线图，需配置云端后端）"**；前端高级版入口同步标注。
2. **保留现状不扩写**：在云端闭环立项前，**不得**把 `bounced/complained/suppressed` 等投递语义写入旧 `LeadStatus`（守住规格 §2.4 红线）。

### 6.2 立项（云端闭环，按 §13 门禁验收）
按依赖顺序推进，**每一步都必须有可出示证据**：

| 阶段 | 内容 | 验收 |
|---|---|---|
| **A. 契约先行** | 落地三态字典（§2）+ 最小化载荷 schema（§7）+ 幂等键（§3） | 类型 SSOT + schema 校验测试 |
| **B. 本地审批** | `pending_approval` 7 条件准入（§5）+ `ApprovalRecord`（§6）+ 草稿版本 | 状态机测试 + 草稿改版后旧批准失效测试 |
| **C. 云端门禁** | 10 步 Fail-Closed（§8）+ 稳定错误码 | 负向测试（未审批/抑制/撞单/版本不一致/超配额/重复请求**全部稳定拒绝**） |
| **D. 投递与事件** | 队列、provider 适配、Webhook 验签+时间窗+去重（§11）、事件审计表（§9） | 端到端测试（永久硬退/投诉写抑制；`delivered ≠ replied`） |
| **E. 回写与 UI** | 跨端状态回写（§10）+ UI 7 项必备状态（§12） | 回写失败进入可观察重试/死信；UI 无假进度 |
| **F. 发布门禁** | §13 全部 10 条 + 制品证据（提交号/依赖锁/哈希/测试结果/签名/灰度阈值/回滚责任人） | 逐条留证 |

### 6.3 暂不做（避免过度工程）
- 在**无真实客户云端需求**前，不投入完整云端闭环实现；
- 当前**顾问渠道分发**模式下，本地能力（搜索/评分/分析/Agent/导出）已构成完整价值闭环，云端是**高级版的增量**而非基础版依赖。

---

## 7. 附录：证据索引

| 证据 | 位置 |
|---|---|
| 领域真值 | `CLOUD-COLLABORATION-DELIVERY.md`（249 行，14 节） |
| 产品真值 | `kone-PRD.md §5.1`（L331-363） |
| 云端客户端 | `electron/services/supabase-service.ts`（622 行，8 个能力函数 + 11 通道） |
| 邮箱分级 | `electron/services/automation-service.ts`（417 行，五级 + 队列分级） |
| 抑制名单 | `electron/services/email-suppression.ts` |
| 上云门槛 | `electron/utils/cloud-sync-gate.ts`（本轮新增，6 条测试） |
| 对客宣称 | `README.md` L54-64 版本能力对照表 |
| 契约 | `src/shared/ipc-contracts.ts`、`electron/ipc/channels.ts`（`CLOUD` 11 通道 / `AUTOMATION` 2 通道） |

---

*本梳理为时点快照（2026-09-25，HEAD `5d3ea48`）。规格状态未变：云端闭环在 §13 门禁全部通过前为 `NO-GO`。*
