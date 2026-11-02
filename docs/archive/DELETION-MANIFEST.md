# DELETION-MANIFEST · `docs/plans/` 处置清单（2026-11-02）

> **用途**：本文档是 `docs/plans/`（32 份）、`docs/reports/`（2 份）与 `.omo/plans/packaged-first-run-automation.md`（1 份）共 **35 份**计划/报告的处置审批单。
> **协议**：归档 = `git mv` 至 `docs/archive/plans/`（**不删除**，历史可 `git log` 回溯，回滚 = `git revert`）；删除 = 仅在归档观察期后另行审批。
> **判定标准**：EXECUTED = 交付物在 CHANGELOG 有落地记录且真身文件在产；SUPERSEDED = 被后续方案以不同形态实现；ACTIVE-OPEN = 存在未闭环工作，**必须保留**；UNVERIFIABLE = 无回写记录且无真身可核。
> **权威依据**：`CHANGELOG.md`（"实现变更 → 规范回写"时间线 SSOT，`kone-PRD.md §0.2`）；全部 EXECUTED 判定经 `CHANGELOG [1.3.1]`（2026-09-22）全文通读 + 真身文件存在性核查双重验证。

## 0. 扫描器误报修正（重要）

初期机械扫描报告的"引用不存在文件"中，经真身核查确认 **3 处误报**：

| 扫描报告的死引用 | 真身 | 结论 |
|---|---|---|
| `tests/e2e-ui/helpers/*`（5 个子文件，ui-router-spider-smoke-plan） | `tests/e2e-ui/helpers.js` **单文件在产** | 实现收敛为单文件，计划文本写的是旧拆分设计；**非死引用** |
| `tests/business-logic/followup-manual-hold.business.test.js`（p1-precision-enhancement） | `tests/business-logic/followup-scheduler.business.test.js` 在产 | 测试文件名演进；**非死引用** |
| `tests/e2e-ui/router-spider.spec.ts`（主交付物） | 在产（`tests/e2e-ui/` 目录实存） | **非死引用** |

仍为真实死引用（不影响归档判定）：`search-cleanup.business.test.js`（kone-business-logic-evals，×4）、`electron/dev/dev-mode.ts` + `electron/ipc/validate.ts`（kone-v1.4-architectural-improvements，该计划已被替代方案取代）、`tests/ipc-license-gate-agent-a1.test.ts`（docs/reports/ipc-plain-register，D7 未落地相关）、`tests/ipc-contract-sweep.test.js`（v1-2-blocking-issues-fix，扩展名笔误，真身为 `.ts`）。归档快照 `docs/archive/snapshots/KONE-V1.3-优化计划.md` 内的 2 处（email-config / provider-query-contract）属快照原文，不修正。

## 1. 逐份分类总表（35 份）

| # | 文件 | 时代 | 判定 | 取代者 / 证据 | 归档前必须保留的独有内容 |
|---|---|---|---|---|---|
| 1 | `docs/plans/KONE-DATA-PIPELINE-AUDIT.md` | 2026-10-16 | SUPERSEDED | `KONE-DATA-QUALITY-PILOT.md` §二（2026-10-17 承接其审计结论） | Prospeo/Apollo 字段丢弃的 file:line 证据表（PILOT 仅引用未复刻） |
| 2 | `docs/plans/KONE-DATA-QUALITY-APPROVAL-PACK.md` | 2026-10-17 | **ACTIVE-OPEN** | — 负责人 A/B/C/D 四组待办未决（默认 No-Go） | **保留**：ICP 待确认项 + 供应商授权/计费问题清单 |
| 3 | `docs/plans/KONE-DATA-QUALITY-GATE-REPORT.md` | 2026-10-17 | 终态报告（BLOCKED·No-Go），无 CHANGELOG 回写 | 无后续放行记录 | §B 四项 BLOCKED 判定依据（防止误判已放行） |
| 4 | `docs/plans/KONE-DATA-QUALITY-PILOT.md` | 2026-10-17 | **ACTIVE-OPEN** | — 试验设计待批准（状态: 草稿） | **保留**：§二 Step1 数据链审计（Q1–Q7） |
| 5 | `docs/plans/KONE-ENRICHMENT-PHASE1-FIX.md` | 2026-10-17 | EXECUTED | CHANGELOG [1.4.36] 变异验证（"Prospeo 丢弃身份（复现 D-2）"）+ PILOT §1.1「Phase 1 已验收」 | 无 |
| 6 | `docs/plans/KONE-ENRICHMENT-REVIEW-1436.md` | 2026-10-17 | **ACTIVE-OPEN** | R1/R2 已由 Phase1-FIX 修复；**R3/R4/R5 未确认闭环** | **保留**：R3–R5 风险定级与复现方法 |
| 7 | `docs/plans/README.md` | 现行索引 | **ACTIVE-OPEN（索引件）** | — | **保留**；归档后须更新"共 31 份"计数与清单 |
| 8 | `docs/plans/compliance-audit-report.md` | V1.3 早期 | UNVERIFIABLE（维持） | 无 CHANGELOG 条目、无真身可核；后续 [1.4.29]/[1.4.30] 审计已叠加覆盖 | Phase A–H 逐项合规矩阵（时点快照）；建议归档并在标题行标注"无回写记录" |
| 9 | `docs/plans/dev-env-ultimate-privilege-bypass.md` | ~2026-09 | EXECUTED | [1.3.1]:3049 "bypass 6/6" + `tests/dev-bypass.test.ts` 在产 | 无 |
| 10 | `docs/plans/dev-license-bypass-fix.md` | ~2026-09 | EXECUTED | [1.3.1]:3427 `TRIAL_FEATURES` 收窄 + dev 豁免在产 | 无 |
| 11 | `docs/plans/e2e-test-plan.md` | V1.2 | EXECUTED | `tests/e2e/permission-lock.test.js` 在产（[1.4.4] 引用）+ e2e-smoke 7/7 多条记录 | 无 |
| 12 | `docs/plans/full-ipc-automation-barrage.md` | ~2026-09 | EXECUTED | `tests/ipc-contract-sweep.test.ts` 在产 + [1.3.1]:3049 `test:ipc` 1/1 | 无 |
| 13 | `docs/plans/gap-fix-execution.md` | ~2026-09-03 | EXECUTED | `p0-precision-differentiation-closure.md` 头部"gap-fix-execution Phase 0-12 已全部完成" | 无 |
| 14 | `docs/plans/intelligent-acquisition-deep-audit.md` | ~2026-09 | SUPERSEDED | `intelligent-acquisition-interaction-fix.md` 承接其结论 | 环境矩阵（dev shell / Electron dev / packaged 三环境伪阳性对照表） |
| 15 | `docs/plans/intelligent-acquisition-interaction-fix.md` | ~2026-09 | EXECUTED | [1.3.1]:3067 移除 `setInterval`+`Math.random()` 虚构进度条 + :2955 流式评分增量 + :2956 分页 bug | 无（25 个未勾选框为模板残留，交付物全部落地） |
| 16 | `docs/plans/ipc-boundary-crash-hardening.md` | ~2026-09 | EXECUTED | [1.3.1]:2969-3047 IPC 注册中心六批迁移（29 直挂 → **0**）+ `assertAllRegistered` 启动门禁 | 无（29 项缺陷清单即迁移批次清单） |
| 17 | `docs/plans/kone-business-logic-evals.md` | ~2026-09 | EXECUTED | `tests/business-logic/` 套件在产并被 CHANGELOG 多版本引用 | 无（注意：其引用的 `search-cleanup.business.test.js` 真实缺失） |
| 18 | `docs/plans/kone-env-isolation.md` | ~2026-09-22 | EXECUTED | [1.3.1]:3049 "env 3/3" + 全部 [x] | 无 |
| 19 | `docs/plans/kone-v1.4-architectural-improvements.md` | 2026-09-03/04 | SUPERSEDED | [1.3.1] 六批迁移以 `electron/ipc/contracts/*.contract.ts` 形态实现；`dev-mode.ts`/`validate.ts` 被替代方案取代（真身不存在） | 无（历史决策记录） |
| 20 | `docs/plans/kone-v1.4-production-hardening.md` | V1.4 早期 | **ACTIVE-OPEN** | 16/19 勾选；SQLite 持久化待立项（[1.3.1]:3476）、auto-updater 未见端到端验证（[1.4.30] D-4） | **保留**：未勾的 3 项清单（需人工裁定关闭或转入新计划） |
| 21 | `docs/plans/n8n-interface-align.md` | ≤2026-09-25 | SUPERSEDED | [1.3.2] Phase 0: N8N 移除（`triggerN8nWorkflow` 已删除） | 无 |
| 22 | `docs/plans/p0-commercial-honesty-hardening.md` | V1.3 | SUPERSEDED | 4 项 P0 被宪法与批次吸收：`kone-PRD §五` Agent 宪法、[1.3.2] 口径对齐、[1.3.5]–[1.3.12] IMAP、[1.4.13]/[1.4.21] WhatsApp 真实化 | P0-1 WhatsApp 假成功/过时选择器证据清单（历史审计基线） |
| 23 | `docs/plans/p0-precision-differentiation-closure.md` | 2026-09-03 | EXECUTED | 自带"全部完成 2026-09-03"全勾选 + [1.3.1]:3389 §9.6 抽验在产 | 无 |
| 24 | `docs/plans/p1-precision-enhancement.md` | 2026-09-03 | EXECUTED | [1.3.1]:3389 §9.6 抽验（`followup-scheduler.ts:66` `isPlanDue` 排除 `pendingManual` 在产）；计划内旧测试名已演进为 `followup-scheduler.business.test.js` | 无 |
| 25 | `docs/plans/p2-p3-experience-coverage.md` | 2026-09-03 | EXECUTED | `AGENTS.md`"P3-2 升级（已落地）" + [1.3.1]:3389 §9.6 抽验 | 无（P2-2 路线图边界已诚实标注并回写） |
| 26 | `docs/plans/payload-audit-report.md` | V1.3 前 | SUPERSEDED | [1.3.2] N8N 移除——被审通道不复存在 | 无 |
| 27 | `docs/plans/perf-concurrency-fix.md` | ~2026-09 | EXECUTED | [1.3.1]:2957 `SEARCH_FANOUT_CONCURRENCY = 3` + `mapLimitedConcurrency` + :3099 `sanitizePlainText` 外提 `search/text-utils.ts` | 无 |
| 28 | `docs/plans/project-alignment-optimization.md` | ~2026-09-03 | EXECUTED | `gap-fix-execution.md` 头部"5 矩阵已就绪" + `.omo/notepads/project-alignment-optimization/final-report.md` | 无 |
| 29 | `docs/plans/trial-expiry-fix.md` | V1.2/~2026-09 | EXECUTED | [1.3.1]:3360-3368 试用越权修复 + `tests/license-gateway.test.js` 在产 + :3049 "gateway 3/3" + :3430 ARCH §7.2 澄清段 | 无 |
| 30 | `docs/plans/ui-router-spider-smoke-plan.md` | ~2026-10 | EXECUTED | `tests/e2e-ui/router-spider.spec.ts` + `helpers.js` 真身在产（5 个 helpers 子文件系旧设计，实现收敛为单文件）+ `.omo/evidence/ui-spider/` 实跑证据 | 7 大模块骨架锚点映射 |
| 31 | `docs/plans/ui-ux-de-ai-optimization.md` | ~2026-09/10 | EXECUTED | [1.3.2] Phase -1 对客口径整改（upgrade-modal / dashboard-page / automation-workflow / help-dialog 四组件）+ :2953 lucide vendor 分包 | Emoji→lucide 替换映射表（若含未完成项则为唯一施工图） |
| 32 | `docs/plans/v1-2-blocking-issues-fix.md` | V1.2 | EXECUTED | [1.3.1]:3055 `useLeadsStore` 漏导入渲染崩溃 P0 + :3059 src typecheck 门禁 + :3067 伪进度 + :3077 CSV `undefined%` | 无（4 项修复主题全部落地） |
| 33 | `docs/reports/ipc-plain-register-license-mapping-2026-10-19.md` | 2026-10-19 | **ACTIVE-OPEN** | D1–D6 已落地（CHANGELOG [1.4.37]，commit `b019a38`）；**D7 待裁决** | **保留**："16 个必须保持免门禁"负面清单（迁移时防机械替换） |
| 34 | `docs/reports/system-consolidation-2026-10-19.md` | 2026-10-19 | EXECUTED | CHANGELOG [1.4.37]"文档治理归零" + 报告自述两处修复单独提交 | §1.2 结论"H1–H5 取证表"（防同类误判复发） |
| 35 | `.omo/plans/packaged-first-run-automation.md` | 2026-10-20 | EXECUTED | CHANGELOG [1.4.38]（commit `39c4318`，`test:first-run` + `scripts/packaged-first-run.cjs`） | §1 本机自动化边界表（CHANGELOG 仅概述） |

## 2. 保留清单（6 份，ACTIVE-OPEN）

1. `docs/plans/README.md`（索引件，归档后先更新本清单）
2. `docs/plans/KONE-DATA-QUALITY-APPROVAL-PACK.md`（负责人 A/B/C/D 待办 = **用户本人决策项**）
3. `docs/plans/KONE-DATA-QUALITY-PILOT.md`（与 2 配对的设计件）
4. `docs/plans/KONE-ENRICHMENT-REVIEW-1436.md`（R3–R5 未闭环）
5. `docs/plans/kone-v1.4-production-hardening.md`（3 项未勾 + SQLite/auto-updater 待立项）
6. `docs/reports/ipc-plain-register-license-mapping-2026-10-19.md`（D7 待裁决 + 免门禁负面清单）

## 3. 归档候选（29 份 → `docs/archive/plans/`）

- **EXECUTED（19）**：e2e-test-plan、full-ipc-automation-barrage、gap-fix-execution、intelligent-acquisition-interaction-fix、ipc-boundary-crash-hardening、kone-business-logic-evals、kone-env-isolation、p0-precision-differentiation-closure、p1-precision-enhancement、p2-p3-experience-coverage、perf-concurrency-fix、project-alignment-optimization、trial-expiry-fix、ui-router-spider-smoke-plan、ui-ux-de-ai-optimization、v1-2-blocking-issues-fix、dev-env-ultimate-privilege-bypass、dev-license-bypass-fix、KONE-ENRICHMENT-PHASE1-FIX
- **SUPERSEDED（6）**：KONE-DATA-PIPELINE-AUDIT、intelligent-acquisition-deep-audit、kone-v1.4-architectural-improvements、n8n-interface-align、p0-commercial-honesty-hardening、payload-audit-report
- **终态报告（2）**：KONE-DATA-QUALITY-GATE-REPORT（BLOCKED·No-Go 终态）、system-consolidation-2026-10-19
- **UNVERIFIABLE（1）**：compliance-audit-report（建议归档 + 标题行标注"无 CHANGELOG 回写记录"）
- **EXECUTED（1，`.omo/plans/`）**：packaged-first-run-automation（唯一被跟踪的 .omo 文件，迁入后 `.omo/` 恢复纯运行时目录，与 `.gitignore` 语义一致）

## 4. 归档执行时必须同步的动作

1. 归档前把各文件"必须保留的独有内容"核对一遍——若归档目标文件缺失该内容，先补进取代者文档再 `git mv`。
2. `docs/plans/README.md`：更新计数（31→保留 5 份计划）并在顶部加一行指针："历史计划归档见 `docs/archive/plans/`（判定依据：`docs/archive/DELETION-MANIFEST.md`）"。
3. `kone-PRD.md §0.2` 无需改动（plans/ 不在其权威枚举内）。
4. `verify:docs` 复跑必须全绿（`docs/archive/` 路径在 SNAPSHOT_PATTERNS 豁免集内，归档不触发过时符号检查）。
5. 单次 commit 完成（迁移 + 索引更新），回滚 = `git revert <sha>`。
