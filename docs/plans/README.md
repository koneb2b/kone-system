# docs/plans · 工程执行计划归档

> 本目录收录项目的**工程执行计划**（实施前的方案设计），由工具运行时目录
> （`.omo/plans/`）迁移而来，现作为**正式文档资产**入库。

## 为什么迁移

这些计划原先存放在 `.omo/plans/`（Oh My OpenCode 的运行时目录）。按 `AGENTS.md`
的治理原则，工具运行时目录**不应入库**（与 `.playwright-mcp/`、`.codenomad/` 同类）。
但它们本身是**有价值的工程决策记录** —— 每份含「规范对齐声明」「执行原则」
「分阶段任务」等内容，长度 350–700 行，不应随工具目录一起被忽略。

故迁移至 `docs/` 下正式归档，并把工具目录加入 `.gitignore`。

## 目录内容

共 31 份计划（按主题相关性排序，非时间顺序）。

| 文件 | 主题 |
|---|---|
| `KONE-DATA-PIPELINE-AUDIT.md` | 数据管道审计 |
| `KONE-DATA-QUALITY-APPROVAL-PACK.md` | 数据质量审批包 |
| `KONE-DATA-QUALITY-GATE-REPORT.md` | 数据质量门禁报告 |
| `KONE-DATA-QUALITY-PILOT.md` | 数据质量试点 |
| `KONE-ENRICHMENT-PHASE1-FIX.md` | 富化 Phase 1 修复 |
| `KONE-ENRICHMENT-REVIEW-1436.md` | 1.4.36 富化评审 |
| `kone-v1.4-production-hardening.md` | V1.4 生产环境加固 |
| `kone-v1.4-architectural-improvements.md` | V1.4 架构改进 |
| `p0-commercial-honesty-hardening.md` | P0 商用诚实性加固 |
| `p0-precision-differentiation-closure.md` | P0 精准差异化收口 |
| `p1-precision-enhancement.md` | P1 精准度增强 |
| `p2-p3-experience-coverage.md` | P2/P3 体验覆盖 |
| `project-alignment-optimization.md` | 项目对齐优化 |
| `ui-ux-de-ai-optimization.md` | UI/UX 去 AI 化优化 |
| `gap-fix-execution.md` | 差距修复执行 |
| `intelligent-acquisition-deep-audit.md` | 智能获客深度审计 |
| `intelligent-acquisition-interaction-fix.md` | 智能获客交互修复 |
| `ipc-boundary-crash-hardening.md` | IPC 边界崩溃加固 |
| `full-ipc-automation-barrage.md` | IPC 自动化全量压测 |
| `perf-concurrency-fix.md` | 性能与并发修复 |
| `dev-env-ultimate-privilege-bypass.md` | 开发环境提权绕过（安全） |
| `dev-license-bypass-fix.md` | 开发授权绕过修复（安全） |
| `trial-expiry-fix.md` | 试用到期修复 |
| `v1-2-blocking-issues-fix.md` | V1.2 阻断问题修复 |
| `kone-env-isolation.md` | 环境隔离 |
| `kone-business-logic-evals.md` | 业务逻辑评测 |
| `n8n-interface-align.md` | n8n 接口对齐 |
| `e2e-test-plan.md` | 端到端测试计划 |
| `ui-router-spider-smoke-plan.md` | UI 路由爬虫冒烟计划 |
| `payload-audit-report.md` | 载荷审计报告 |
| `compliance-audit-report.md` | 合规审计报告 |

## 使用说明

- 这些是**历史计划**，反映当时的决策思路与范围界定；
- **当前实现状态以代码与 `CHANGELOG.md` 为准**，不以计划文档为准；
- 新增计划请直接写入本目录，不要再放回工具运行时目录。
