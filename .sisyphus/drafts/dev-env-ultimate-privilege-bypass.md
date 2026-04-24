# Draft: Dev Environment Ultimate Privilege Bypass

## Requirements (confirmed)
- 用户要求只输出计划，禁止直接改代码。
- 需要定位 `electron/security/license-guard.ts` 或实际处理拦截的模块中，`requireFeature`、`requireAnyFeature`、`ensureFeature` 等底层核心鉴权函数。
- 计划目标是在开发环境 `!app.isPackaged` 下实现终极特权放行；生产环境 Fail-Closed 逻辑绝对不受影响。
- 用户给出的目标绕过形式是：`if (!app.isPackaged) return;` 或 `return true`，视函数签名决定。
- 计划完成后，交由 Sisyphus (Build) 模式执行。

## Technical Decisions
- 核心鉴权实现位于 `electron/security/license-guard.ts`：`requireActiveClaims`、`requireFeature`、`requireAnyFeature`。
- 实际 IPC 拦截承载层位于 `electron/services/license-service.ts`：`ensureTrialAccess`、`registerSecureIpc`、`registerSecureFeatureIpc`。
- `automation-service.ts` 还存在绕过 `registerSecureFeatureIpc` 的手写 `licenseGuard.requireFeature('cloud_send', '自动化发信')` 调用，需要纳入计划覆盖。
- 放行策略必须优先落在 `license-guard.ts` 的底层函数顶部，再补一处手写直连点，避免仅依赖 Mock Claims。
- 开发放行门控统一使用 `!app.isPackaged`，不新增 `NODE_ENV` 条件。

## Research Findings
- `electron/security/license-guard.ts`: `requireFeature` 与 `requireAnyFeature` 直接基于 `normalizeFeatureSet` 做权限拒绝，是特征鉴权最底层核心。
- `electron/services/license-service.ts`: `registerSecureFeatureIpc` 在 handler 执行前调用 `licenseGuard.requireFeature/requireAnyFeature`；`registerSecureIpc` 在更外层先调用 `ensureTrialAccess`。
- `electron/services/license-service.ts`: `ensureTrialAccess` 已有 `!app.isPackaged` 早退，因此当前 FEATURE_DENIED 更可能来自特征鉴权层而不是 trial 层。
- `electron/services/automation-service.ts`: `automation:start-campaign` 手动调用 `ensureTrialAccess` 与 `licenseGuard.requireFeature`，不完全依赖通用注册器。
- 后台 explore/librarian 任务均失败，因此计划依据本地直接搜索证据生成。

## Open Questions
- 无阻塞性用户问题；执行策略已明确。

## Scope Boundaries
- INCLUDE: 规划 `license-guard.ts`、`license-service.ts`、`automation-service.ts`、测试文件的改动与验证顺序。
- EXCLUDE: 现在直接改代码；扩展到无关业务模块；放宽生产环境授权逻辑。
