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

/** 企业主体 + 顶层联系方式列（与决策人无关的固定列）。 */
const CORE_HEADERS = ['公司名称', '行业', '国家', '匹配度', '联系人', '职位', '邮箱', '邮箱等级', '电话', '网站']

/** 每个决策人槽位对应的列名（逐字段展开）。 */
const DECISION_MAKER_FIELDS = ['姓名', '职位', '邮箱', '邮箱等级', '电话'] as const

/** 溯源列。 */
const TRAILING_HEADERS = ['数据来源']

/** 完整表头（共享，两处导出必须一致）。 */
export const LEAD_EXPORT_HEADERS: string[] = [
  ...CORE_HEADERS,
  ...Array.from({ length: DECISION_MAKER_SLOTS }, (_, i) =>
    DECISION_MAKER_FIELDS.map((field) => `决策人${i + 1}${field}`),
  ).flat(),
  ...TRAILING_HEADERS,
]

/**
 * 把单条线索摊平成 CSV 行。
 *
 * 关键：**决策人字段取自 `lead.decisionMakers`**（而非顶层 email/phone）——
 * 顶层联系方式经常为空，决策人层级的数据才真正可用（WhatsApp 消费决策人 phone、
 * Email 消费决策人 email）。这也是用户要「核心关键人信息」的落点。
 */
export const buildLeadExportRow = (lead: LeadItem): string[] => {
  const dms = lead.decisionMakers ?? []

  const dmCells = Array.from({ length: DECISION_MAKER_SLOTS }, (_, i) => {
    const dm = dms[i]
    if (!dm) return DECISION_MAKER_FIELDS.map(() => '')
    return [dm.name ?? '', dm.title ?? '', dm.email ?? '', dm.emailGrade ?? '', dm.phone ?? '']
  }).flat()

  return [
    lead.company ?? '',
    lead.industry ?? '',
    lead.country ?? '',
    formatMatchScoreForExport(lead.matchScore),
    lead.contact ?? '',
    lead.contactTitle ?? '',
    lead.email ?? '',
    // 顶层邮箱等级：取首个决策人的等级作为参考（无则留空）
    dms[0]?.emailGrade ?? '',
    lead.phone ?? '',
    lead.website ?? '',
    ...dmCells,
    lead.dataSourceType ?? lead.source ?? '',
  ]
}

/**
 * 构造完整 CSV 文本（含 UTF-8 BOM，保证 Excel 正确识别中文）。
 *
 * @param leads 待导出的线索（调用方负责筛选与限额切片）
 */
export const buildLeadExportCsv = (leads: LeadItem[]): string => {
  const rows = [LEAD_EXPORT_HEADERS, ...leads.map(buildLeadExportRow)]
  return '\ufeff' + rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
}
