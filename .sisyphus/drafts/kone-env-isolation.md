# Draft: Kone 生产与开发环境绝对隔离计划

## Requirements (confirmed)
- 目标：彻底打通本地开发验证，且绝对不污染打包后的生产环境代码。
- 在 `.sisyphus/plans/` 生成计划书。
- 审查 `electron/security/license-guard.ts`，不要修改任何业务逻辑；仅在 `getStoredClaims` 或 `requireFeature` 的最底层入口增加判断：如果 `!app.isPackaged`，则直接返回一套全量特性的 Mock Claims（包含 `search_basic`, `analysis_advanced`, `cloud_send` 等全套特权）。
- 审查 `electron/services/license-service.ts` 中的 `writeFileAnchorBlob`；用 `try...catch` 包裹写入逻辑；仅当 `!app.isPackaged` 且捕获到 `EPERM` 时只打印 `console.warn` 并优雅返回；生产环境保持原有抛错熔断。
- 规划在 `tests/` 下新建 `env-isolation.test.ts`。
- 测试必须包含两个断言：(a) 模拟 `app.isPackaged = true` 时权限拦截必须 Fail-Closed；(b) 模拟 `app.isPackaged = false` 时必须返回全量 Mock Claims。
- 当前仅输出 Markdown 计划书，绝对禁止直接修改代码。

## Technical Decisions
- 输出单一执行计划，不做代码实现。
- 优先遵守仓库的生产/开发环境隔离与 fail-closed 约束。

## Research Findings
- 已启动代码路径与测试基础设施探索任务，待回收结果。
- 已按仓库协议读取必需文档链。

## Open Questions
- 无阻塞性用户问题；待根据探索结果确认测试入口与现有模式引用。

## Scope Boundaries
- INCLUDE: `electron/security/license-guard.ts`、`electron/services/license-service.ts`、`tests/env-isolation.test.ts` 的计划与验证策略。
- EXCLUDE: 任意业务逻辑修改、生产行为放宽、计划外目录变更。
