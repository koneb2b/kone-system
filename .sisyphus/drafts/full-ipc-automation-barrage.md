# Draft: 全量 IPC 轰炸测试网搭建计划

## Requirements (confirmed)
- 用户要求在 `.sisyphus/plans/` 下输出《全量 IPC 轰炸测试网搭建计划》。
- 当前任务仅限编写测试脚本规划，绝对禁止修改任何 `src/` 或 `electron/` 下既有业务代码。
- 需要静默通读 `.clinerules`、`ARCH-STANDARDS.md`、`PROJECT-PRD.md`，特别关注 Fail-Closed 门禁与防退化要求。
- 计划核心文件为 `tests/ipc-contract-sweep.test.ts`。
- 测试目标：遍历并反射调用主进程所有核心 IPC handlers，使用边界值/脏输入轰炸。
- 断言目标：不要求业务成功，但绝不允许未捕获崩溃或服务挂掉；异常必须被 try/catch 或标准 Error Response 吸收。

## Technical Decisions
- 本次仅产出测试底座建设计划，不实现。
- 测试网要覆盖多模块 IPC，而不是只覆盖智能获客。
- 核心验收指标是“无 fatal / 无未捕获崩溃 / 返回标准化失败响应”。
- 优先复用现有 `tests/` 中的 mock electron / mock ipcMain / registerHandlers 模式。

## Research Findings
- 待补充：IPC 通道树、注册点、现有测试基建、Oracle 风险评审。

## Open Questions
- 暂无阻塞性用户问题，先通过仓内勘察消除未知。

## Scope Boundaries
- INCLUDE: `tests/` 下测试底座规划、IPC sweep 策略、边界值设计、模块覆盖矩阵、断言标准。
- EXCLUDE: 修改 `src/` / `electron/` 业务实现、修复业务 bug、重构授权/云端逻辑。
