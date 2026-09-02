# Kone P1 精准增强执行计划（P1-1..P1-4）— ✅ 全部完成（2026-09-03）

> 依据: `KONE-V1.3-深度审计报告与优化执行计划.md` §四 P1（显著增值项）。
> 前置: P0 四项（G1–G4）已落地（`.omo/plans/p0-precision-differentiation-closure.md`）。
> 回归: business-logic 60/60、根目录 81/81、e2e 25/25、electron tsc 0 错误、vite build 通过。

## 规范对齐声明
- LLM 评分与官网富化**并发上限保持 2 不变**（ARCH-STANDARDS §9.9 宪法）。
- 覆盖量提升只增加调用总数，不触碰并发红线与 3000 字红线。
- LinkedIn 只读边界不变：破冰文案仅供人工触达，不自动发送。
- 跟进序列不得向"无法确认回复"的客户盲发（诚实优于假成功）。

## 执行清单（Prometheus 输出）

### P1-1 · LLM 评分全覆盖 50 条 + 置信标识（G2+缺口7）
- [x] `SEARCH_LLM_SCORE_LIMIT` 20 → 50，与 `SEARCH_TARGETED_LEAD_LIMIT` 对齐（并发 2 不变）。
- [x] `SearchExecuteResult` 契约增量加 `scoreSource?: 'deterministic' | 'ai'`；LLM 评分成功的线索标 `ai`，其余保持 `deterministic`。
- [x] `lead-mappers.ts` 透传 `scoreSource`。
- [x] 前端线索卡 ICP 徽标区分：AI 评分（默认样式）/ 确定性评分（次级样式 + title 说明）。

### P1-2 · LinkedIn 破冰文案真 LLM 化（缺口6）
- [x] `linkedin-agent.ts`：`generateIcebreaker` 静态模板改为可选 `icebreakerProvider` 注入（LLM 生成 1-2 句个性化破冰），失败/未注入降级模板；日志记录 `icebreaker_source`。
- [x] `agent-service.ts` LinkedIn 分支注入 LLM provider（复用 EmailAgent 同款配置读取方式）。
- [x] 保持只读边界：文案仅写入运行日志与返回值，不触发任何自动动作。

### P1-3 · 跟进序列 IMAP 依赖与"需人工确认"态（缺口5）
- [x] `followup-scheduler.ts` plan 增量加 `pendingManual?: boolean`。
- [x] `agent-service.ts runFollowupTick`：IMAP 未配置（`reply.configured === false`）时**不再自动推进发送**——标记 `pendingManual`、延后计划、日志 `followup_manual_required`、写回 agentStatus 提示；IMAP 恢复后自动续推。
- [x] 前端触达徽标（AgentTouchBadges）：`emailSequenceStage` 展示不变；"需人工确认"通过运行日志与状态文案体现（避免破坏既有契约）。

### P1-4 · 冷邮件时区感知 + 泊松延时（缺口8）
- [x] 新增 `electron/utils/send-window.ts`：`COUNTRY_IANA_TZ_MAP`（常用国家映射）+ `resolveRecipientLocalHour(country, date)` + `isWithinSendWindow(country, date)`（09:00-18:00）；未知国家不拦截（诚实降级）。
- [x] `AgentTask`/`FollowUpPlan` 增量携带 `country`；`buildAgentTaskQueue` 从 lead 透传。
- [x] `EmailAgent.sendEmail`：收件人当地时间不在 09:00-18:00 → 返回 `{ success: false, error: 'outside_recipient_send_window' }`（不消耗日频、不计失败），调用方 defer 计划到下一轮。
- [x] `followup-scheduler.ts`：轮次间隔叠加 ±20% 随机抖动（可注入随机源以便测试）。

### 测试与回归
- [x] `tests/business-logic/send-window.business.test.js`（时区映射、窗口边界、未知国家放行）
- [x] `tests/business-logic/followup-manual-hold.business.test.js`（IMAP 未配置不发送、恢复后续推、抖动区间断言）
- [x] `tests/business-logic/linkedin-icebreaker.business.test.js`（LLM 优先/模板兜底/只读边界）
- [x] 全量回归：business-logic + 根目录 + e2e；tsc/vite build 通过。

### 文档同步
- [x] `ARCH-STANDARDS.md` §9.6 追加 P1 条款；`kone-PRD.md` 对应章节；审计报告 P1 勾选。
