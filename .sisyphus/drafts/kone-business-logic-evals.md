# Draft: Kone 核心业务逻辑测试网 (Business-Logic Evals)

## Requirements (confirmed)
- 必须按 AGENTS.md 要求，先通读强制文档链。
- 仅在 `.sisyphus/plans/` 下生成《Kone 核心业务逻辑测试网 (Business-Logic Evals) 搭建计划》。
- 这套测试网必须使用 Mock 数据，不直连外部 API。
- 断言对象包括 4 大核心护城河：
  1. 四级搜索降级与过滤
  2. AI 引擎低配红线（HTML 去噪+<=3000 截断）
  3. Autopilot Gold Filter
  4. 云端交接裁剪
- 只允许在 `tests/business-logic/` 下新建测试文件。
- 绝对禁止修改 `src/` 与 `electron/` 下任何业务代码。

## Technical Decisions
- 本次只产出计划，不实现。
- 测试策略为“业务逻辑 evals”，不是 UI 测试，也不是 IPC barrage。
- 所有断言都应尽量命中可导出的工具函数、纯逻辑函数、或通过 test harness 对编译产物进行 Mock 调用。

## Research Findings
- 待补充：目标函数与现有测试模式。

## Open Questions
- 暂无阻塞性用户问题，先以代码事实收敛。

## Scope Boundaries
- INCLUDE: tests/business-logic/ 下的 mock-based 测试底座规划。
- EXCLUDE: 实现业务修复；修改 src/、electron/、preload/；直连外部 API。
