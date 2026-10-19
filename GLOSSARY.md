---
title: KONE 术语表
status: active
authoritative: true
ssotFor: [glossary]
asOfCommit: ef2badd
lastVerifiedAt: 2026-10-19
---

# KONE 术语表 (GLOSSARY)

> **文档角色：术语唯一事实源。**
> 本文件只定义"名词是什么意思"。业务规则、数值、状态机、字段结构一律以对应 SSOT 为准（见各条目 `权威源` 列）。
> 若本文件与任一 SSOT 冲突，以 SSOT 为准，并应在本文件提交勘误。

## 1. 架构与分层术语

| 术语 | 定义 | 权威源 |
|---|---|---|
| **SSOT** | Single Source of Truth，单一事实源：某条规则唯一允许被定义的位置。其他文档只能指针引用，不得重定义 | `ARCH-STANDARDS.md §16` |
| **Scout** | 规则层：多源采集归一化 + 去噪预过滤 + 确定性评分（`computeIcpMatchScore`）。不调用 LLM | `kone-PRD.md §5.0.5` |
| **Brain** | 语义层：LLM 评分、机会分、官网深探富化与文案生成 | `kone-PRD.md §5.0.5` |
| **渐进式发射** | 先发基础候选解锁 UI，再逐条流式回填 AI 评分与富化结果，不等全量完成 | `kone-PRD.md §5.1` |
| **四级弹性搜索协议** | 第 0 级 AnySearch 实体穿透 → 第 1 级 Google Maps → 第 2 级参数容错重试 → 第 3 级 Organic 补位 | `kone-PRD.md §二.2` |
| **Gold Filter** | 最小闭环准入：通过去重、相关度预筛、确定性评分与可选 LLM 评分后才允许进入高潜推荐区或 Agent 管道 | `kone-PRD.md §二.4` |
| **时空隔离 (Temporal Isolation)** | 每次搜索/管道运行生成 `myJobId` / `pipelineRunId`，异步回调与任务消费在入口校验归属，丢弃过期结果 | `kone-PRD.md §二.3`、`AGENTS.md` |
| **双管道回写** | Agent 完成一次触达必须同时更新 `agentStatus`（持久化线索态）与 `AgentState`（运行时内存态 + IPC 推送） | `kone-PRD.md §5.0.7` |
| **Fail-Closed** | 授权/门禁不确定时一律拒绝，绝不默认放行 | `ARCH-STANDARDS.md §7` |
| **Edge-heavy / Cloud-light** | 本地承担搜索归一化、HTML 抽取、ICP 评分与本地 Autopilot；云端只接收精简、已过滤、字段白名单化的载荷 | `ARCH-STANDARDS.md §8` |

## 2. 评分与准入术语

| 术语 | 定义 | 权威源 |
|---|---|---|
| **Stage 0.5 — Eligibility Gate** | 在预筛之后、ICP 评分之前的结构性一票否决（B2C 零售终端、维修服务、二手翻新、平台卖家、纯资讯站等）。被否决者永不进入评分与 Agent 管道 | `ARCH-STANDARDS.md §9.6.1` |
| **Stage 1 — 确定性 ICP 评分** | 纯函数 `computeIcpMatchScore`，权重 域名 40 / 产品词 30 / B2B 信号 20 / 联系人 10，无网络、无 LLM、无随机数 | `kone-PRD.md §零.3` |
| **Stage 2 — LLM 机会分** | 结构化 `opportunityScore`：`icpFit(0-55) + intent(0-35) + evidence(0-10) − riskPenalty(0-20)`，`finalScore` 由公式重算 | `kone-PRD.md §0.5.1` |
| **`matchScore` 三态语义** | `undefined` = 未评分（Scout 骨架态）；有效数字 = 已评分；**`null` = 上游判定无效值（独立第三态，不得并入 `undefined`）**。任何映射层**禁止**将 `undefined`/`null` 静默转为 `0`（0 = 评估过且极差，语义不同） | `kone-PRD.md §三.2`（V1.2 不变红线；原误引 `ARCH-STANDARDS.md §5.3`，该章节为条目引用且当时表述与本法典冲突，已于 2026-09-25 对齐） |
| **`scoreSource`** | 评分来源标识：`'ai'` = LLM 评分；`'deterministic'` = 40/30/20/10 确定性预筛分。用于 UI 区分精度层级 | `src/shared/ipc-contracts.ts` |
| **盲评 (Blind Scoring)** | 官网抓取失败但仍有 snippet/title 时允许的降级评分，理由必须明示"基于简介的轻量判断" | `ARCH-STANDARDS.md §5.10` |
| **五级邮箱验证** | `verified / probable / catch_all / risky / invalid`。映射为可发送：`verified｜probable｜catch_all → true`；`risky｜invalid → false` | `ARCH-STANDARDS.md §9.6.3` |

## 3. 触达与交付术语

| 术语 | 定义 | 权威源 |
|---|---|---|
| **Agent 管道** | 搜索完成后拾取 `matchScore >= 60` 且含可触达资产的线索，生成 `AgentTask` 队列并暂存待人工确认 | `kone-PRD.md §0.3` |
| **人工确认门 (Human-in-the-loop)** | 管道只暂存目标，任何发送都必须由用户显式触发 `AGENT.CONTROL: start` | `kone-PRD.md §0.3` |
| **收件人发送窗口** | 冷邮件仅在收件人当地 09:00–18:00 投递；窗口外延后且不消耗配额、不计失败 | `ARCH-STANDARDS.md §9.6.9` |
| **人工挂起 (`pendingManual`)** | IMAP 未配置 → 回复状态不可知 → 跟进序列暂停并等待人工确认，**绝不盲推** | `ARCH-STANDARDS.md §9.6.8` |
| **抑制 (Suppression)** | 退订 / 投诉 / 永久硬退 / 人工加入的不可触达名单。优先级高于导入、评分、审批、队列与重试 | `CLOUD-COLLABORATION-DELIVERY.md §10` |
| **DNS 软锁定** | SPF/DKIM/DMARC 高风险时锁定发送按钮，禁止真实发信 | `ARCH-STANDARDS.md §9.5.6` |
| **审批后上云** | 本地人工批准 → 最小载荷上云 → 云端二次门禁 → 队列投递 → 事件回写。高分或 `cloud_send` 权限**不等于**发送授权 | `CLOUD-COLLABORATION-DELIVERY.md §5–§8` |

## 4. 落地状态标记（固定枚举，禁止自造）

| 标记 | 含义 |
|---|---|
| `[已落地]` | 当前代码中已存在并可运行 |
| `[已落地 YYYY-MM]` | 在指定批次落地 |
| `[部分落地 YYYY-MM]` | 仅部分子能力落地，必须写明缺哪一部分 |
| `[路线图]` | 目标态增量，**实现前不得对外宣称已完成** |

> 使用约束：任何文档引用"已落地"标记前，必须能在代码中找到对应实现。CI 的规范一致性门禁会校验引用完整性与常量一致（见 `scripts/verify-doc-consistency.cjs`）。

## 5. 常见误用（历史上真实发生过的歧义）

| 误用 | 正确表述 |
|---|---|
| `computeLeadScore` / `enrichLeadWebsite` | 代码中不存在。真实为 `emitLeadScored` / `enrichLeadWithDeepProbe` |
| 把 Stage-1 的 40/30/20/10 与 Stage-2 的 55/35/10/20 当作冲突 | 二者是**分层错配**：前者为纯函数预筛分，后者为 LLM 机会分，按双层架构共存 |
| `yellow_pages` 当作可用数据源 | 该 Provider **已弃用**（`execute()` 返回 DEPRECATED），黄页能力由 AnySearch 统一路由 |
| 把 Autopilot 描述为"云守护进程" | Autopilot 是**本地伴随式**能力，依赖机器开机、应用运行、系统不休眠、网络可用 |
