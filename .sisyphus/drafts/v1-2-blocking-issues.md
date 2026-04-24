# Draft: V1.2 Blocking Issues

## Requirements (confirmed)
- 用户要求对打包后的 V1.2 商业版两个严重阻断问题执行“先自查，后执行”的两步法。
- 阶段一先搜索并分析相关代码，不立即修改。
- 需要先汇报问题节点：anchor.bin / Machine ID 主进程处理、免费试用 IPC 响应链路、激活页品牌色布局。

## Technical Decisions
- 当前阶段仅做自查诊断与计划准备，不做代码修改。
- 先按仓库协议读取强制文档链，并并行委托代码区域探索。
- 诊断结论将优先基于已发现的真实文件与测试入口，不依赖口头假设。

## Research Findings
- `electron/services/license-service.ts`：授权锚点、Machine ID、试用状态恢复、时间回拨校验、`license:*` 与 `system:get-device-status` IPC 的核心实现集中在此文件。
- `src/components/activation-screen.tsx`：首屏激活页，负责展示设备识别码、申请 7 天试用、提交激活码。
- `src/components/upgrade-modal.tsx` / `src/components/contact-modal.tsx` / `src/components/app-sidebar.tsx`：应用内升级、顾问联系、试用倒计时入口等相关展示层节点。
- `tests/env-isolation.test.ts`：已存在与 packaged 环境下锚点写入 EPERM/Fail-Closed 行为直接相关的覆盖，是后续修复计划的重要参考。
- `package.json` 中声明了 `test:security-audit -> node ./scripts/security-audit.cjs`，但实际缺少该脚本；仅在 `docs/deprecated/security-audit.cjs` 发现旧实现，说明正式安全审计入口当前不一致。

## Open Questions
- 第二个严重阻断问题的完整描述是否还有未发送内容。
- 用户是否要求在阶段一结束后直接进入阶段二修复计划生成。
- 用户是否希望阶段一只收敛到“问题节点报告”，还是同时附带“优先级与修复顺序建议”。

## Scope Boundaries
- INCLUDE: 诊断 `anchor.bin`、Machine ID、试用 IPC、激活页布局/品牌色、打包验证与安全审计入口相关实现。
- EXCLUDE: 在阶段一直接修改业务代码。
