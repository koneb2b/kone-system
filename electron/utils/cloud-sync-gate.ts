/**
 * cloud-sync-gate.ts — 上云 Gold Filter 判定（kone-PRD §L157，宪法红线）
 *
 * 原文：「上云 Payload 严苛裁剪 (Gold Filter)：高级版用户执行云端多轮邮件营销时，
 * 线索上云前必须触发本地 Gold Filter 隐私过滤。……**只有 `email` 非空的合格黄金线索才放行
 * 单向交接，绝不允许 bulk-sync（批量同步）未经筛选的原始垃圾包上云。**」
 *
 * 「合格」= ① 评分达阈值（或人工 `force` 显式覆盖）；② **`email` 非空**
 * （云端用途为多轮邮件营销——无邮箱线索不构成可执行资产）。
 *
 * 纯函数、零依赖，导出供测试。
 */

export type CloudSyncGateResult = { allowed: boolean; reason?: string }

export const evaluateCloudSyncGate = (
  lead: { matchScore?: unknown; score?: unknown; email?: unknown },
  minScore: number,
  force = false,
): CloudSyncGateResult => {
  const score = Math.round(Number(lead.matchScore || lead.score || 0))
  if (!force && score < minScore) {
    return { allowed: false, reason: `评分 ${score} 低于上云阈值 ${minScore}` }
  }

  /* §L157：email 非空是硬性放行条件（人工 force 亦不豁免——云端交接的用途即邮件营销） */
  const email = String(lead.email ?? '').trim()
  if (!email) {
    return { allowed: false, reason: '缺少邮箱，非合格黄金线索，不予上云（§L157）' }
  }

  return { allowed: true }
}
