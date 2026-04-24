# Draft: 智能获客组件深度自查与优化报告

## Requirements (confirmed)
- 用户要求只输出报告与计划，禁止直接改代码。
- 需要追踪 AI 分析链路：从前端报错文案“当前智能分析服务暂不可用”反查 React 组件、IPC 接口、主进程 Handler。
- 需要检查前端传入 Payload 是否与后端 Type 接口严丝合缝。
- 需要检查主进程调用大模型（LLM）处是否有优雅错误捕获。
- 若本地缺失 API Key 导致报错，需要规划本地开发环境的 Mock Fallback：本地无 Key 时返回逼真假分析数据，而不是让 UI 崩溃。
- 需要定位伴随式后台巡航初始化与通讯逻辑，排查状态显示 0/0、未响应的原因。
- 最终输出到 `.sisyphus/plans/` 下，文件名与主题匹配，内容要极其详尽，列出缺失、隐患及具体代码优化方案。

## Technical Decisions
- 本次产物为单一详尽报告/执行计划，不做代码改动。
- 优先从错误文案和状态异常的真实代码路径逆向追踪，而不是先问用户。
- AI 分析链路、IPC 契约、LLM 容错、巡航状态同步将作为四个核心分析面。

## Research Findings
- 待补充：并行 explore / oracle / 直接搜索结果。

## Open Questions
- 暂无阻塞性用户问题；先以代码勘察消除未知。

## Scope Boundaries
- INCLUDE: 分析抽屉/智能分析链路、IPC 契约、主进程 LLM 调用容错、开发环境 mock fallback 规划、伴随式后台巡航状态链路。
- EXCLUDE: 直接实现修复、直接改代码、扩展到无关业务模块。
