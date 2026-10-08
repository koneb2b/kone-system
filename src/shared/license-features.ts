/**
 * 授权能力集 · **唯一事实源（SSOT）**
 *
 * ── 为什么必须收敛到一处 ─────────────────────────────────────────────
 * 历史上能力集存在**三份手写副本**：
 *   1. `electron/services/license-service.ts` 的 `TRIAL_FEATURES`
 *   2. `src/lib/feature-gate.ts` 的 `FEATURE_ALIASES`
 *   3. `electron/security/license-guard.ts` 的 `BASIC/PREMIUM/ENTERPRISE_FEATURES`
 *
 * 三份副本已导致 **2 次真实缺陷**：
 *   · `TRIAL_FEATURES` 修好了，但 `license-guard.ts` 仍是旧版
 *     → Trial 拿到全部 BASIC 能力（含 `local_autopilot`），
 *       可绕过渲染层升级墙**直连 IPC 启动付费智能体**（商业泄漏）。
 *   · `feature-gate.ts` 认为「basic 无完整导出」，但 `license-guard.ts` 的
 *     BASIC 含 `export_full` → Basic 实际获得完整导出。
 *
 * 两处修复的注释都只提示"同步另一处"，**没人注意到还有第三处**。
 * 根因不是"忘了改"，而是**存在多份可独立演化的副本**。
 *
 * ── 使用约定 ────────────────────────────────────────────────────────
 * · 任何需要判断授权能力的地方，**必须 import 本文件**，不得再手写能力数组。
 * · 本文件位于 `src/shared/`，是主进程（electron/）与渲染层（src/）
 *   共享的类型/常量区（同 `ipc-contracts.ts` 的先例）。
 * · 修改本文件后须跑 `npm run verify:license-gate`（已并入 `verify:consistency`），
 *   它会断言三处消费方确实引用本文件而非自建副本。
 *
 * ── 套餐边界依据 ─────────────────────────────────────────────────────
 * `kone-PRD §5.1.2` + `AGENTS.md`「本地 Autopilot 伴随巡航运行规范」：
 *   · Trial            —— 仅展示升级引导；仅本地搜索与受限导出
 *   · Basic（付费基础）—— 解除搜索限额、开放 AI 分析、低量本地 Autopilot；**无**完整导出与云端
 *   · Premium          —— 追加完整导出、云端投递、团队协作
 *   · Enterprise       —— Premium 全集 + 企业标识
 */

/** 试用版能力集：**仅**本地搜索与受限导出（10 条/次、15 秒间隔、导出限 100 行） */
export const TRIAL_FEATURES = ['search_basic', 'lead_export'] as const

/** 付费基础版：解除搜索限额、开放 AI 分析、低量本地 Autopilot（**不含** export_full / cloud_send） */
export const BASIC_FEATURES = [
  'search_basic',
  'search_deep',
  'analysis_basic',
  'analysis_advanced',
  'lead_export',
  'local_autopilot',
] as const

/**
 * 付费高级版：在 Basic 之上追加完整导出、云端投递、团队协作。
 * 注意 `export_full` 需**显式列出**——它不在 BASIC 中，
 * 若仅依赖展开会漏掉（历史上曾因此把 Premium 的完整导出误删）。
 */
export const PREMIUM_FEATURES = [...BASIC_FEATURES, 'export_full', 'cloud_send', 'team_collaboration'] as const

/** 企业版：Premium 全集 + 企业标识 */
export const ENTERPRISE_FEATURES = ['enterprise', ...PREMIUM_FEATURES] as const

/** 套餐标识（与 `license-service.ts` 的 `StoredLicenseClaims.plan` 对齐） */
export type LicensePlan = 'trial' | 'basic' | 'premium' | 'enterprise'

/**
 * 按套餐取能力集。
 * 单一入口，避免各处再写 `if (plan === ...)` 分支（历史缺陷正源于分支条件写错）。
 */
export const getFeaturesForPlan = (plan: string): readonly string[] => {
  switch (plan) {
    case 'enterprise':
      return ENTERPRISE_FEATURES
    case 'premium':
    case 'pro': // 兼容旧标识
      return PREMIUM_FEATURES
    case 'basic':
      return BASIC_FEATURES
    case 'trial':
      return TRIAL_FEATURES
    default:
      // 未知套餐 → 按最低权限处理（Fail-Closed）
      return TRIAL_FEATURES
  }
}
