# Kone P0 精准+差异化闭环执行计划（G1–G4）

> 依据: `KONE-V1.3-深度审计报告与优化执行计划.md` §四 P0-1..P0-4（商用阻断项）。
> 分支: `gap-fix-p0-p1`。前置: gap-fix-execution Phase 0-12 已全部完成。

## 规范对齐声明
- `kone-PRD.md` — 全局权威需求源头；宪法常量（40/30/20/10、并发 2、3000 字符）不可触碰。
- 不破坏四级弹性搜索协议、Fail-Closed 授权边界、Agent 双管道数据流宪法。
- 任何 Agent 实现不得以 setTimeout 假成功；LLM 评分并发上限不提高。

## 执行清单（Prometheus 输出）— ✅ 全部完成（2026-09-03）

### P0-2 · Eligibility Gate 准入硬门（G2）✅
- [x] `search-service.ts` 新增 `ELIGIBILITY_HARD_VETO_RULES`（B2C 零售终端 / 维修 / 二手翻新 / 电商平台卖家 / 纯博客论坛资讯）+ `computeEligibilityVeto()`（纯函数，导出供测试）。
- [x] 插入预筛链：`isTrashLead` → `computeScoutRelevance` → **Eligibility Gate**（命中即剔除，`recordDiscard('准入硬否决:<类目>')`，不进 ICP 评分、不进 Agent 管道）。
- [x] 产品词匹配改词边界：`matchesProductTerm()`（ASCII 词 `\bterm\b`，非 ASCII 退回 includes）。
- [x] `coreProductTerms` 纳入 `intentMutation.localizedProducts` 本地语言变体。
- [x] 制裁国/CRM 保护期一票否决：当前层无 CRM 数据，记录为后续任务（诚实标注，不虚报）。

### P0-3 · 邮箱验证五级分级（G3）✅
- [x] 新建 `electron/utils/email-verification.ts`：RFC 5322 子集正则、内置 disposable 域名黑名单、role-account 检测、SMTP 探测（RCPT 结果码 + catch-all 二次 RCPT + 421/450 灰名单退避重试一次）。
- [x] 五级输出: `verified / probable / catch_all / risky / invalid`；valid 映射: verified/probable/catch_all=true，risky/invalid=false。
- [x] `automation-service.ts` `verifyEmail` 重接新引擎，`EmailVerifyResult` 增量加 `grade` 字段（向后兼容）；保持 Premium 保护、串行、50/批上限；前端 automation-workflow 展示 Verified/Probable/Catch-all 徽标。
- [x] 无 MX / RCPT 550 → invalid；灰名单重试后仍 4xx → probable；SMTP 无定论 → probable（不假 verified）。

### P0-1 · 差异化邮件触达闭环（G1）✅
- [x] `AgentTask` 增加 `aiEmail?: { subject; body }`；`buildAgentTaskQueue` 透传；`StagedTarget`/executeEmailAgent 链路透传。
- [x] `EmailAgentConfig` 增加 `emailContentProvider?: (task, stage) => Promise<{subject;body}|null>`（类型已导出）；`executeSequence` 内容来源优先级：task.aiEmail（Stage0）→ provider（LLM 实时生成 150 词定制信）→ 阶段模板兜底；每次发送记录 `email_content_source` 日志。
- [x] `agent-service.ts` 实现 `createLlmEmailContentProvider(store)`（复用 `getUserLlmApiKey`/`buildLlmEndpoint`，20s 超时，任何失败返回 null 降级模板，绝不阻断发送）。
- [x] 不改变 suppression/DNS 软锁/日频门禁的执行顺序。

### P0-4 · 决策人数据验证与可信度降级（G4）✅
- [x] 新建 `electron/utils/contact-validation.ts`：`normalizePhoneE164()`（E.164 规范化校验，不臆造区号）；`validateDecisionMakerContacts()`（email 静态分级 + phone 校验，标注 `emailGrade`/`phoneValid`）。
- [x] `DecisionMaker` 契约增量加 `emailGrade?: string; phoneValid?: boolean`。
- [x] `search-service.ts` 决策人合并后跑静态验证（不发 SMTP——采集层零网络增量）。
- [x] 前端 analysis-drawer 决策人徽标：全员 `confidenceScore<=0` 时渲染灰色 "AI 推测，未验证" 标注；不臆造置信度。

### 测试与回归 ✅
- [x] `tests/business-logic/eligibility-gate.business.test.js`（5/5 场景 + 词边界 3 项，8 pass）
- [x] `tests/business-logic/email-verification-grading.business.test.js`（6 pass，mock-only 零网络）
- [x] `tests/business-logic/email-differentiation.business.test.js`（5 pass，捕获 sendEmail 内容断言来源优先级）
- [x] `tests/business-logic/` 全套 51/51 pass；根目录 81/81 pass；e2e 25/25 pass
- [x] 预存失败修复：`tests/ui-contract-agents-panel.test.js` 断言更新为 P0-5 分层授权现行语义（isTrialOrFree/isPaidBasic），8/8 pass
- [x] `npm run build:electron:dev` exit 0；`npx tsc --noEmit` 0 错误；`npx vite build` 成功

### 文档同步 ✅
- [x] `ARCH-STANDARDS.md` 新增 §9.10：Eligibility Gate / 五级邮箱验证 / 差异化邮件内容链。
- [x] `kone-PRD.md` 精准度与差异化触达章节同步落地状态。
- [x] 审计报告 §四 P0 项勾选。
