# Provider Capability Matrix (唯一能力事实源 / Single Source of Truth)

> 本文件是各数据源 Provider 真实能力状态的**唯一权威来源**。
> 任何对外宣传、销售话术、PRD 能力声明，只能引用本表中标注为 **✅ 真实可用** 的行。
> `kone-PRD.md §0.8` 的进度描述以本文件为准；若两者冲突，以本文件（对齐代码现状）为准。
> `CLOUD-COLLABORATION-DELIVERY.md` 负责审批、云端门禁、投递、抑制、Webhook 和团队协同规则；本文件不重复定义这些业务规则。Provider 的可用状态不自动等同于“可发送、可自动跟进或可用于商业宣传以外的所有用途”。
>
> 校准依据：直接审计 `electron/services/providers/*.ts` 的 `execute()` 实现。
> 最后核对：2026-09-22（审计基线 commit `0925cde`，见 `archive/KONE-V1.3-规范文档与架构数据交互深度梳理报告.md`）。

## ✅ 真实可用 (Production — 可对外宣传)

以下 Provider 的 `execute()` 发起真实 HTTP 请求、含 retry/timeout、并已接入 `myJobId` 时空隔离检查。

| Provider | 数据源类型 | 底层实现 | 能力说明 | 配置要求 |
|----------|-----------|---------|---------|---------|
| SerpApiMapsProvider | `google_maps` | SerpApi `engine=google_maps` | 本地商户搜索，含 retry/timeout/pagination | SerpApi Key |
| SerpApiOrganicProvider | `google_organic` | SerpApi `engine=google` | Organic 网页搜索，含 retry/pagination | SerpApi Key |
| LinkedinSearchProvider | `linkedin_search` | SerpApi `engine=linkedin` | LinkedIn 公开检索 + 置信度评分归一化 | SerpApi Key |
| CustomsShipmentProvider | `customs_shipment` | SerpApi 网页近似检索（site-scoped） | **注意**：为公开外贸/海关站点的网页近似结果，**非官方海关提单数据库直连**，仅供参考 | SerpApi Key |
| TradeShowProvider | `trade_show` | SerpApi 网页近似检索（site-scoped） | **注意**：为展会目录站点的网页近似结果，**非官方展会名录接口**，仅供参考 | SerpApi Key |
| FacebookSearchProvider | `facebook_search` | SerpApi `site:facebook.com` 限定检索 | Facebook 公开页面检索 | SerpApi Key |

> ⚠️ 宣传口径约束：`customs_shipment` 与 `trade_show` 虽已真实可用，但底层是**网页近似检索**而非官方数据库直连。对外宣传必须使用「基于公开网页的海关/展会线索补位」措辞，**严禁宣称「官方海关提单数据库」或「官方展会名录直连」**。这两个 Provider 的 `dataSourceNote` 字段已在代码中如实标注。

## ⚠️ 实验性 (Experimental — 需标注风险，谨慎宣传)

| Provider | 数据源类型 | 底层实现 | 状态说明 | 配置要求 |
|----------|-----------|---------|---------|---------|
| AnySearchProvider | `anysearch` | AnySearch 垂直 B2B 实体 API | 多源 B2B 实体搜索 (customs/trade_shows/linkedin/facebook/maps)。已使用独立 `anysearch` id（ID 冲突已修复）并含 `myJobId` 隔离。依赖第三方 API 稳定性，标注为实验性 | AnySearch API Key + Base URL |

## ⛔ 已弃用 / 未接入

| Provider | 数据源类型 | 状态 |
|----------|-----------|------|
| YellowPagesProvider | `yellow_pages` | **已弃用**：`execute()` 返回 DEPRECATED 错误。黄页数据由 AnySearch 统一路由，不再作为独立 Provider |

## DataSourceType 枚举

`src/shared/ipc-contracts.ts` 中定义：
`'google_maps' | 'google_organic' | 'customs_shipment' | 'trade_show' | 'yellow_pages' | 'linkedin_search' | 'facebook_search' | 'anysearch'`

`yellow_pages` 仍在枚举中以保持向后兼容，但对应 Provider 已弃用。

## 状态说明与历史修正

1. **ID 冲突（已修复）**：SerpApiMapsProvider 与 AnySearchProvider 曾共用 id `google_maps` 导致静默覆盖。AnySearch 现使用独立 `anysearch` id。
2. **JobID 时空隔离（已落地）**：所有真实可用 Provider 的 `execute()` 入口均已包含 `myJobId !== currentActiveJobId` 隔离检查。
3. **测试覆盖（部分落地）**：`tests/business-logic/provider-isolation.business.test.js`（P3-1，2026-09）已覆盖 `trade_show` 与 `customs_shipment` 两个 Provider 的采集归一化与失败隔离（零网络 mock）。其余 6 个 Provider（maps / organic / linkedin_search / facebook_search / anysearch / 弃用的 yellow_pages）的专项单测仍待补（P2 待办）。
4. **文档修正记录**：本文件先前版本将 linkedin/customs/facebook/trade_show 标注为「placeholder 不可宣传」，与代码现状不符。现已对齐真实实现——它们发起真实 SerpApi 请求，可用但受上述宣传口径约束。
