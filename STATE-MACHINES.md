---
title: KONE 状态机总表
status: active
authoritative: true
ssotFor: [state-machine-mapping]
asOfCommit: 0925cde
lastVerifiedAt: 2026-09-22
---

# KONE 状态机总表 (STATE MACHINES)

> **文档角色：状态机"映射关系"的唯一事实源。**
> 各状态机的**语义定义**仍归各自 SSOT：本地简化态见 `kone-PRD.md §5.1.1`，云端业务/投递/跟进态见 `CLOUD-COLLABORATION-DELIVERY.md §2`。
> 本文件只解决一件事：**三套状态机并存时，谁在什么层、如何互相映射、哪些写法被禁止**。
> 历史上"4 态 / 6 态 / 7 态混用"造成的歧义，以本文件为裁决依据。

## 1. 三层状态机总览

| 层 | 类型名 | 状态数 | 落地状态 | 权威源 |
|---|---|---|---|---|
| 本地实现层 | `LeadStatus`（`SearchExecuteResult.status`） | 4 | ✅ 已落地 | `kone-PRD.md §5.1.1` |
| 本地持久化层 | `AgentStatus`（线索触达态） | 结构体 | ✅ 已落地 | `kone-PRD.md §5.0.7` |
| 云端业务层 | `LeadBusinessStatus` | 7 + 4 异常 | ⚠️ 目标态（未实现） | `CLOUD-COLLABORATION-DELIVERY.md §2.1` |
| 云端投递层 | `OutreachStatus` | 4 + 3 异常 | ⚠️ 目标态 | `CLOUD-COLLABORATION-DELIVERY.md §2.2` |
| 云端跟进层 | `FollowupStatus` | 6 | ⚠️ 目标态 | `CLOUD-COLLABORATION-DELIVERY.md §2.3` |

> ⚠️ **重要**：`FollowupStatus`（云端 6 态）与本地 `FollowUpStatus` **不是同一个东西**。
> 本地不存在独立的 follow-up 状态机——它复用 `LeadStatus`（4 态）。任何把两者视为同一类型的写法都是错误的。

## 2. 本地实现层 `LeadStatus`（4 态，已落地）

```
new ──→ contacting ──→ replied
  │           │            │
  └───────────┴────────────┴──→ archived
```

| 值 | 语义 | UI 展示 |
|---|---|---|
| `new` | 新线索，尚未触达 | 待跟进 |
| `contacting` | 已进入触达/沟通 | 跟进中 |
| `replied` | 收到回复 | 已回复 |
| `archived` | 归档 | 已归档 |

**遗留值归一化（必须执行）**：

| 遗留/外部值 | 归一化结果 |
|---|---|
| `contacted` / `qualified` / `negotiation` | `contacting` |
| `closed` | `replied` |
| `lost` | `archived` |
| 未知值 | `new` |

## 3. 本地持久化层 `AgentStatus`（已落地）

```ts
type AgentStatus = {
  whatsappSent: boolean
  whatsappStatus?: 'pending' | 'delivered' | 'replied' | 'failed'
  linkedinContacted: boolean
  emailSequenceStage: 0 | 1 | 2 | 3
  emailPendingManual?: boolean
}
```

约束：
- 默认值必须为 `{ whatsappSent: false, linkedinContacted: false, emailSequenceStage: 0 }`。
- `linkedinContacted` **只读浏览不得置 true**（LinkedIn 仅允许只读 Profile 辅助）。
- `emailPendingManual` 仅在 IMAP 未配置时置 true。

## 4. 云端业务层 `LeadBusinessStatus`（7 态 + 4 异常，目标态）

```
new → scored → pending_approval → approved → queued → sent → replied
异常/终止：rejected | suppressed | failed | archived
```

关键语义（不得曲解）：

| 状态 | 准确含义 | 常见误解 |
|---|---|---|
| `approved` | **仅表示人工批准**，不代表云端已接受 | 误当作"可以发送" |
| `queued` | 仅当云端完成二次门禁并创建投递任务后才产生 | 误当作本地排队 |
| `sent` | 仅表示提供商已接受发送动作，**不表示送达** | 误当作"已送达" |
| `replied` | 只能由**真实回复事件**触发 | 误由 `delivered` 推导 |
| `suppressed` | 优先级最高，覆盖投递与跟进资格 | 误当作可被重新导入解除 |

## 5. 云端投递层 `OutreachStatus`（4 态 + 3 异常，目标态）

```
pending → accepted → sent → delivered
异常：bounced | complained | failed
```

硬约束：
- **`delivered` 不得自动映射为 `replied`。**
- 临时退信与永久硬退必须区分；**只有永久硬退进入全局抑制**。

## 6. 云端跟进层 `FollowupStatus`（6 态，目标态）

```
not_started → pending_manual → scheduled → paused → stopped → completed
```

硬约束：收到回复、退订、投诉、永久硬退或人工停止后，未来自动跟进必须进入 `stopped`。

## 7. 本地 ⇄ 云端迁移映射（目标态）

> 迁移完成前，云端语义**不得**写入本地联合类型。

| 本地 | 云端 `LeadBusinessStatus` | 说明 |
|---|---|---|
| `new` | `new` | 直接对应 |
| `contacting` | `scored` / `pending_approval` / `approved` / `queued` / `sent` 的聚合显示 | `contacting` **仅作旧 UI 聚合**，不得承担云端投递语义 |
| `replied` | `replied` | 仅由真实回复事件驱动 |
| `archived` | `archived` | — |
| —（无对应） | `suppressed` / `rejected` / `failed` | 必须存入**独立字段/实体**，禁止塞进本地 `LeadStatus` 联合类型后不做迁移 |

## 8. 禁止写法清单（违反即架构违例）

1. 把 `bounced` / `complained` / `suppressed` 直接加入本地 `LeadStatus` 联合类型。
2. 把云端 `FollowupStatus` 与本地 `FollowUpStatus` 视为同一类型。
3. 由 `delivered` 推导 `replied`，或由 `sent` 推导 `delivered`。
4. 前端乐观显示"已发送/已送达"——必须等待本地真实动作或云端权威事件。
5. 用 `contacting` 表达"已批准"或"已入队"等云端语义。
6. 在无迁移与兼容层的情况下改写既有状态字符串含义。
