import type { DataSourceType } from '@/shared/ipc-contracts'

export type DataSourceMeta = {
  label: string
  shortLabel: string
  color: string
}

export const DATASOURCE_META_MAP: Record<DataSourceType, DataSourceMeta> = {
  google_maps: { label: 'Google Maps', shortLabel: 'Maps', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  google_organic: { label: '网页搜索', shortLabel: '网页', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  customs_shipment: {
    // 对客口径修正（P1-A）：PROVIDER-CAPABILITY.md:24 明确禁止宣称「官方海关提单数据库」，
    // 要求表述为「基于公开网页的海关线索补位」。本徽标会出现在全部线索卡片与列表中，
    // 与 dataSourceNote 的免责声明不在同一视窗，故必须在标签本身带上"参考"语义。
    label: '海关线索（参考）',
    shortLabel: '海关线索',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  trade_show: { label: '展会名录（参考）', shortLabel: '展会', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  yellow_pages: { label: '行业黄页', shortLabel: '黄页', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  linkedin_search: { label: 'LinkedIn', shortLabel: 'LinkedIn', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  facebook_search: { label: 'Facebook', shortLabel: 'FB', color: 'bg-blue-50 text-blue-600 border-blue-200' },
  anysearch: { label: 'AnySearch', shortLabel: 'Any', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  /* 2026-10-17：Serper（自备密钥的可选 Google 网页来源）。与 google_organic 分列，保证来源标注诚实。 */
  serper: {
    label: '网页搜索（Serper）',
    shortLabel: 'Serper',
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
}

export const DATASOURCE_LABEL_LOOKUP: Record<string, DataSourceMeta> = DATASOURCE_META_MAP

export function getDataSourceMeta(source?: string): DataSourceMeta {
  if (!source) return { label: source ?? '', shortLabel: '', color: 'bg-slate-100 text-slate-500' }
  return (
    (DATASOURCE_META_MAP as Record<string, DataSourceMeta>)[source] ?? {
      label: source,
      shortLabel: source.slice(0, 4),
      color: 'bg-slate-100 text-slate-500',
    }
  )
}

export function getDataSourceBadge(source?: string): string {
  const meta = getDataSourceMeta(source)
  return `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${meta.color}`
}
