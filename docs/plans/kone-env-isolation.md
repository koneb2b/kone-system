# Kone 生产与开发环境绝对隔离计划

## TODOs
- [x] T1: 在 `electron/security/license-guard.ts` 的最底层入口增加开发环境全量 Mock Claims 豁免，仅在 `!app.isPackaged` 生效，生产环境保持原有 Fail-Closed 行为不变。
- [x] T2: 在 `electron/services/license-service.ts` 的 `writeFileAnchorBlob` 写入路径增加开发环境 `EPERM` 容错，仅在 `!app.isPackaged` 且错误码为 `EPERM` 时 `console.warn` 并优雅返回，生产环境继续抛错熔断。
- [x] T3: 新增 `tests/env-isolation.test.ts`，覆盖两条硬性断言：`app.isPackaged = true` 时权限拦截必须 Fail-Closed；`app.isPackaged = false` 时必须返回全量 Mock Claims。
- [x] T4: 运行 `node --test tests/env-isolation.test.ts` 并确认全绿，通过结果证明开发环境已打通且生产环境防线未被破坏。

## Scope
- 仅允许修改：
  - `electron/security/license-guard.ts`
  - `electron/services/license-service.ts`
  - `tests/env-isolation.test.ts`
- 禁止修改任何其他业务逻辑。
- 禁止放宽生产环境授权校验与熔断逻辑。

## Verification Standards
- 代码审查必须确认：开发环境豁免仅由 `!app.isPackaged` 控制；打包环境仍 Fail-Closed。
- 代码审查必须确认：`EPERM` 容错仅限开发环境；非 `EPERM` 或生产环境仍按原路径抛错。
- 必须运行：`node --test tests/env-isolation.test.ts`
- 如有必要，补充现有相关测试或最小运行验证，但不得替代上述命令。

## Final Verification Wave
- [x] F1: 审核 `license-guard.ts` 变更，确认生产环境 Fail-Closed 未被破坏。
- [x] F2: 审核 `license-service.ts` 变更，确认开发环境 `EPERM` 容错未泄漏到生产环境。
- [x] F3: 审核 `tests/env-isolation.test.ts`，确认断言真实覆盖用户要求而非形式通过。
- [x] F4: 在终端运行 `node --test tests/env-isolation.test.ts`，截图级别记录通过证据并用于最终汇报。
