import { ProviderQuery, type SearchProvider, type ProviderExecuteResult } from '../provider-registry'

/**
 * YellowPagesProvider — 已弃用。
 *
 * 保留 DataSourceType 定义（yellow_pages）但不再维护实现。
 * V1.3 决定：行业黄页搜索通过 AnySearch 多源路由承载，
 * 不再需要独立 site-scoped SerpApi provider。
 *
 * 如需重新激活，需要:
 *   1. 实现真实的 Yellow Pages API 或爬虫
 *   2. 在 search-service.ts sourceMap 中启用
 *   3. 注册到 ProviderRegistry
 *
 * 参见: .omo/plans/compliance-audit-report.md§P3-2
 */
export class YellowPagesProvider implements SearchProvider {
  readonly id = 'yellow_pages' as const
  readonly label = 'Yellow Pages (deprecated)'

  supportedLanguages(): string[] {
    return ['en']
  }

  async execute(_query: ProviderQuery): Promise<ProviderExecuteResult> {
    // Deprecated — yellow pages data is now routed through AnySearch
    return { results: [], error: 'DEPRECATED: Yellow Pages provider has been deprecated. AnySearch handles yellow page data routing.' }
  }
}
