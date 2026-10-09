/**
 * 客户资料导出 —— **共享列构造器（单一事实源）**。
 *
 * ## 为什么要有这个文件
 * 导出曾有三处**各自手写列定义**的副本：
 *   1. `leads-table.tsx`      —— 搜索结果导出（原 8 列，后扩到 26 列）
 *   2. `leads-management.tsx` —— 线索管理导出（14 列，**无决策人**）
 *   3. `data-center.tsx`      —— 数据中心（仅 `date,leads` 统计，性质不同，不纳入）
 *
 * 后果（已发生）：
 *   - 用户从「搜索结果」导出能拿到决策人，从「线索管理」导出**一个都拿不到** ——
 *     同一份数据、两个入口、两种结果，用户无法预期。
 *   - 扩列时只改了 search 那处，management 那处被遗漏。
 *
 * 与能力集 SSOT（`src/shared/license-features.ts`）同思路：
 * **列定义只有一份，改一处即两处生效。**
 *
 * ## 设计要点
 * - 决策人用**固定槽位**展开（默认 3），保证 CSV 是规整平面表，便于 Excel 透视/筛选。
 * - 所有字段**取自 `LeadItem` 真实拥有的字段**，不臆造；缺失统一留空字符串。
 * - 列顺序：企业主体 → 顶层联系方式 → 决策人槽位 → 溯源。
 *
 * 注意：本文件被测试用 Node 直接加载，**必须用相对路径 import**
 * （Node 不解析 tsconfig 的 `@/` 路径别名）。详见 feature-gate.ts 同类注释。
 */

import type { LeadItem } from '../store/leads-store'
import { escapeCsvValue } from './error-message'
// 匹配度格式化复用既有实现（`lead-mappers.ts`），**不另造一份**：
// 该函数已被 `tests/business-logic/lead-export-matchscore.business.test.js` 锁定口径
// （已评分 → "85%"，未评分 → "待评估"），另写一份会导致两处口径漂移。
import { formatMatchScoreForExport } from './lead-mappers'

/** 决策人展开槽位数（固定，保证平面表结构稳定）。 */
export const DECISION_MAKER_SLOTS = 3

/**
 * 可导出字段组 —— 供「导出中心」让用户按需勾选。
 * 默认全部勾选，行为与收敛前一致（不改变既有导出结果）。
 */
export type LeadExportGroupKey = 'core' | 'contact' | 'reachability' | 'decisionMakers' | 'trailing'

export const LEAD_EXPORT_GROUPS: Array<{ key: LeadExportGroupKey; label: string; hint: string }> = [
  { key: 'core', label: '企业主体', hint: '公司名称 / 行业 / 国家 / 匹配度' },
  { key: 'contact', label: '联系入口', hint: '联系人 / 职位 / 邮箱 / 邮箱等级 / 电话 / 网站' },
  {
    key: 'reachability',
    label: '可触达渠道',
    hint: 'WhatsApp / 邮件 / LinkedIn 是否具备自动化条件',
  },
  {
    key: 'decisionMakers',
    label: '核心关键人',
    hint: `决策人最多 ${DECISION_MAKER_SLOTS} 位（姓名·职位·邮箱·等级·电话）`,
  },
  { key: 'trailing', label: '数据溯源', hint: '数据来源' },
]

/** 默认全选（保持既有行为不变）。 */
export const DEFAULT_EXPORT_GROUPS: LeadExportGroupKey[] = LEAD_EXPORT_GROUPS.map((g) => g.key)

/** 各字段组的表头。 */
const GROUP_HEADERS: Record<LeadExportGroupKey, string[]> = {
  core: ['公司名称', '行业', '国家', '匹配度'],
  contact: ['联系人', '职位', '邮箱', '邮箱等级', '电话', '网站'],
  reachability: ['可触达渠道'],
  decisionMakers: Array.from({ length: DECISION_MAKER_SLOTS }, (_, i) =>
    ['姓名', '职位', '邮箱', '邮箱等级', '电话'].map((field) => `决策人${i + 1}${field}`),
  ).flat(),
  trailing: ['数据来源'],
}

/** 完整表头（默认全选，共享，消费方必须一致）。 */
export const LEAD_EXPORT_HEADERS: string[] = LEAD_EXPORT_GROUPS.flatMap((g) => GROUP_HEADERS[g.key])

/**
 * 计算可触达渠道 —— **直接回答「这条线索能不能自动触达」**。
 *
 * 依据宪法（AGENTS.md「Agent 类型与能力矩阵」）：
 *   - WhatsApp 拓客猎手 ← `phone`
 *   - LinkedIn 商务猎手 ← `linkedinUrl`
 *   - 邮件长效跟随助理 ← `email`
 * 且 Agent 入队要求 `matchScore >= 60`（agent-pipeline.ts）。
 *
 * 取值优先级：决策人层级优先（更准），回落到顶层。
 * 无任何渠道 → 返回 `—`，让用户一眼看出「这条要补数据」。
 */
export const buildReachabilityChannel = (lead: LeadItem): string => {
  const dms = lead.decisionMakers ?? []
  const hasPhone = Boolean(lead.phone || dms.some((d) => d.phone))
  const hasEmail = Boolean(lead.email || dms.some((d) => d.email))
  const hasLinkedin = dms.some((d) => d.linkedinUrl)
  const channels: string[] = []
  if (hasPhone) channels.push('WhatsApp')
  if (hasEmail) channels.push('邮件')
  if (hasLinkedin) channels.push('LinkedIn')
  return channels.length > 0 ? channels.join(' / ') : '—'
}

/**
 * 把单条线索摊平成 CSV 行。
 *
 * 关键：**决策人字段取自 `lead.decisionMakers`**（而非顶层 email/phone）——
 * 顶层联系方式经常为空，决策人层级的数据才真正可用（WhatsApp 消费决策人 phone、
 * Email 消费决策人 email）。这也是用户要「核心关键人信息」的落点。
 *
 * @param groups 勾选的字段组（默认全选）。已勾选的组**按固定顺序**输出，
 *               保证同一份勾选组合得到稳定的列序与前缀。
 */
export const buildLeadExportRow = (lead: LeadItem, groups: LeadExportGroupKey[] = DEFAULT_EXPORT_GROUPS): string[] => {
  const dms = lead.decisionMakers ?? []
  const selected = new Set(groups)

  const dmCells = Array.from({ length: DECISION_MAKER_SLOTS }, (_, i) => {
    const dm = dms[i]
    if (!dm) return ['', '', '', '', '']
    return [dm.name ?? '', dm.title ?? '', dm.email ?? '', dm.emailGrade ?? '', dm.phone ?? '']
  }).flat()

  const cells: Record<LeadExportGroupKey, string[]> = {
    core: [lead.company ?? '', lead.industry ?? '', lead.country ?? '', formatMatchScoreForExport(lead.matchScore)],
    contact: [
      lead.contact ?? '',
      lead.contactTitle ?? '',
      lead.email ?? '',
      // 顶层邮箱等级：取首个决策人的等级作为参考（无则留空）
      dms[0]?.emailGrade ?? '',
      lead.phone ?? '',
      lead.website ?? '',
    ],
    reachability: [buildReachabilityChannel(lead)],
    decisionMakers: dmCells,
    trailing: [lead.dataSourceType ?? lead.source ?? ''],
  }

  return LEAD_EXPORT_GROUPS.filter((g) => selected.has(g.key)).flatMap((g) => cells[g.key])
}

/** 按勾选组计算表头（与 `buildLeadExportRow` 严格对应，保证不错位）。 */
export const buildLeadExportHeaders = (groups: LeadExportGroupKey[] = DEFAULT_EXPORT_GROUPS): string[] => {
  const selected = new Set(groups)
  return LEAD_EXPORT_GROUPS.filter((g) => selected.has(g.key)).flatMap((g) => GROUP_HEADERS[g.key])
}

/**
 * 构造完整 CSV 文本（含 UTF-8 BOM，保证 Excel 正确识别中文）。
 *
 * @param leads 待导出的线索（调用方负责筛选与限额切片）
 * @param groups 勾选的字段组（默认全选，行为与既有导出一致）
 */
export const buildLeadExportCsv = (leads: LeadItem[], groups: LeadExportGroupKey[] = DEFAULT_EXPORT_GROUPS): string => {
  const headers = buildLeadExportHeaders(groups)
  const rows = [headers, ...leads.map((lead) => buildLeadExportRow(lead, groups))]
  return '\ufeff' + rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
}
