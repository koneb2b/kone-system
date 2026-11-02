# KONE 数据完整性与获取成本专项审计

> **报告性质**：只读审计。本轮**未修改任何业务代码、配置、依赖或现有文档**，未执行任何真实外发。
> **审计时间**：2026-10-16
> **代码基线**：`main` @ `adcc63e`（工作区干净）
> **证据规则**：每条结论标注 `文件:行`。**不以文件存在或函数命名推断功能已执行**；**不引用历史审计文档作为当前代码状态**。
> **分类标记**：`[已证实]` = 有代码/官方文档直接证据；`[待验证]` = 有代码线索但缺真实响应样本或外部文档；`[天然不足]` = 数据源本身不提供。

---

## 0. 结论速览

| # | 结论 | 分类 |
|---|---|---|
| 1 | **决策人姓名/职位从未由富化数据源写入线索**：Prospeo 已解析出 `fullName/title` 但**适配器未对外暴露**，Apollo 的 person 姓名/职位**完全未读取** | `[已证实]` |
| 2 | **Apollo 手机号在当前参数下不可能同步返回**：`reveal_phone_number=true` 时官方**强制要求 `webhook_url`**，号码异步投递；本实现两者都未提供 | `[已证实]`（官方文档 + 代码） |
| 3 | **Apollo 邮箱被无条件标注为 `verified`**，未读取任何邮箱状态字段；Prospeo 注释声称「仅采信 `VERIFIED`」但代码实际接受「非 `INVALID` 的一切」 | `[已证实]` |
| 4 | 主搜索源（SerpApi Maps / Organic）**结构上只产出公司级字段**，不含邮箱/联系人 | `[已证实]` |
| 5 | 富化只对 **`matchScore ≥ 60`** 的线索触发；低分线索永远只有公司级数据 | `[已证实]` |
| 6 | **无任何成本计量落盘**：预算计数器是单轮搜索的内存局部变量；缓存命中统计无任何消费方 | `[已证实]` |
| 7 | `PROVIDER-CAPABILITY.md`（Provider 能力 SSOT）**完全未覆盖 Prospeo / Apollo** | `[已证实]` |
| 8 | 供应商条款（Prospeo / Apollo）能否支撑「嵌入付费产品分发」**未核实** | `[待验证]` |

**一句话根因**：当前链路是「**公司发现 → 官网公开联系方式提取**」，决策人识别与手机获取依赖两个付费富化源；而这两个源的**关键字段（人名/职位）被丢弃**、**Apollo 手机因缺少 `webhook_url` 拿不到**、**Apollo 邮箱被高标为已验证**。

---

## 1. 完整数据链路图

```
用户输入关键词/国家/城市
  │
  ├─[A] 意图解析与变体生成
  │     search/intent.ts · mutateSearchIntent()
  │     上限：SEARCH_PRODUCT_TERM_LIMIT=2 × B2B_ROLE_TERMS × 国家/城市
  │     SEARCH_VARIANT_LIMIT=12（总量域硬顶）  constants.ts:54-59
  │
  ├─[B] 搜索扇出（并发 3）SEARCH_FANOUT_CONCURRENCY  constants.ts:29
  │     ├─ SerpApi 主源（await 优先返回）
  │     │    search-service.ts:1767-1840  逐页 + serpapi-cache 命中即复用
  │     │    └─ engine=google_maps  → company/website/phone/address/snippet
  │     │    └─ engine=google      → company/website/phone/address/snippet
  │     └─ Provider 注册表（并行，后到并入第二波）
  │          search-service.ts:1913-1941 · registry.executeAll(providerIds=undefined)
  │          8 个 Provider 注册于 providers/index.ts:12-24
  │          ├─ google_maps        SerpApiMapsProvider        [需 googleKey]
  │          ├─ google_organic     SerpApiOrganicProvider     [需 googleKey]
  │          ├─ linkedin_search    LinkedinSearchProvider     [需 googleKey] ★唯一产出 decisionMakers 的 SerpApi 源
  │          ├─ customs_shipment   CustomsShipmentProvider    [需 googleKey]
  │          ├─ trade_show         TradeShowProvider          [需 googleKey]
  │          ├─ facebook_search    FacebookSearchProvider     [需 googleKey]
  │          ├─ anysearch          AnySearchProvider          [需 anysearchApiKey+BaseUrl] ★可产出 decisionMakers
  │          └─ yellow_pages       YellowPagesProvider        ⛔ 已弃用（execute 返回 DEPRECATED）
  │
  ├─[C] 归一化 / 去重 / 域名归一
  │     normalizeLocalCandidate / normalizeOrganicCandidate   search-service.ts:276-300
  │     域名去重 search-service.ts:2678-2680 · mergeDecisionMakers :462-473
  │     ★ SerpApi 归一化函数**不读取任何 email 字段**
  │
  ├─[D] 预评分（确定性 40/30/20/10）computeIcpMatchScore  search/scoring.ts:73-96
  │     → matchScore 决定谁能进入富化（阈值 60）
  │
  ├─[E] 富化 enrichLeadWithDeepProbe  search-service.ts:1077-1397
  │     并发 SEARCH_ENRICH_CONCURRENCY=2  search-service.ts:2511
  │     逐条线索串行：
  │       E1 官网抓取 extractWebsiteContent :847-897
  │           首页 + ≤6 个联系页（并行）  contact-extract.ts:25-44
  │           提取：mailto / tel / JSON-LD / 文本正则 / wa.me 直链 / 标签化手机
  │       E2 Prospeo  :1120-1143   条件 highValue && key && 邮箱预算剩余
  │       E3 Apollo   :1145-1160   条件 highValue && key && Apollo预算剩余 && !prospeo.email
  │       E4 LLM 深探  :1162-1216   条件 !skipLlmProbe（= !熔断 && highValue）
  │     ★ 本函数**不写入 decisionMakers**（只 spread candidate 原值）
  │
  ├─[F] 取值与来源标注（取值/标注同源）search/shared/contact-provenance.ts:73-91
  │     emailPick :1225-1232   phonePick :1235-1245   contactProvenance :1252-1261
  │
  ├─[G] 决策人静态验证 validateDecisionMakerContacts  utils/contact-validation.ts:40-59
  │     接线点 search-service.ts:2197-2201（仅当 decisionMakers 非空）
  │
  └─[H] 落地 → IPC → Store → UI → 导出
        applySchemaDefaults  search/scoring.ts:146-206
        → use-search-engine.ts:92-123 → leads-store.ts:70-135
        → search-result-card.tsx:304,326（tier 徽标）
        → data-center.tsx:222（决策人数）· leads-table.tsx:257（筛选）
        → analysis-drawer.tsx:660-666（明细）· lead-export.ts:92-114（CSV）
```

---

## 2. 各数据源的请求、返回字段与调用条件

### 2.1 搜索 Provider（采集层）

| Provider | 请求 | 归一化后**实际产出字段** | 调用条件 | 证据 |
|---|---|---|---|---|
| SerpApi Maps | `engine=google_maps&q=&location=&start=&num=100` | company, website, phone, address, snippet, reason | `googleKey` 非空 + `myJobId` 匹配 | `providers/serpapi-maps-provider.ts:28-37,52-58` |
| SerpApi Organic | `engine=google&q=&start=&num=10` | company, website, phone, address, snippet, reason | 同上 | `providers/serpapi-organic-provider.ts:30-37` |
| LinkedIn Search | `engine=linkedin&q=&start=&num=50` | 上述 + `contact`/`contactTitle`/`decisionMakers[]` | 同上 | `providers/linkedin-search-provider.ts:44-70` |
| Customs / TradeShow | SerpApi **网页近似**（site-scoped） | 公司级 + customsData/exhibitionFootprints | 同上 | `PROVIDER-CAPABILITY.md:20-24` |
| Facebook Search | `engine=google&q=site:facebook.com …` | 公司级 | 同上 | `providers/facebook-search-provider.ts` |
| AnySearch | `POST {baseUrl}/v1/search/entity`，`sources=[customs,trade_shows,yellow_pages,linkedin,facebook,maps]` | 公司级 + **decisionMakers[]** + customsData + exhibitionFootprints + agentStatus | `anysearchApiKey` + `baseUrl` 非空 | `providers/anysearch-provider.ts:58-93`；`search-service.ts:1478-1500` |
| Yellow Pages | — | — | ⛔ 弃用 | `PROVIDER-CAPABILITY.md:36` |

**关键事实**：`SerpApiMapsProvider` / `SerpApiOrganicProvider` 的归一化对象**只列了 6 个字段**，其中**没有任何邮箱字段**。即使上游响应含 `email`/`emails`，也会被静默丢弃。`[待验证]`（需一份真实 `engine=google_maps` 响应样本确认上游是否含该字段）。

### 2.2 富化数据源（联系层）

| 源 | 端点 | 请求体（实际发送） | 读取的响应字段 | 调用条件 | 证据 |
|---|---|---|---|---|---|
| **Prospeo** `search-person` | `POST https://api.prospeo.io/search-person` | `{page:1, filters:{company:{websites:{include:[domain]}}}}` | `results[].person.{person_id, full_name, current_job_title, email.status}` | — | `enrich-prospeo.ts:137-152, 82-110` |
| **Prospeo** `enrich-person` | `POST https://api.prospeo.io/enrich-person` | `{only_verified_email:true, enrich_mobile:wantMobile, data:{person_id}}` | `person.email.{revealed,status,email}`、`person.mobile.{revealed,mobile_international,mobile_country_code}` | 两者同属一次 `enrichFromProspeo` 调用；触发条件：`highValue && getUserProspeoApiKey() && prospeoEmailBudget.used < limit` | `enrich-prospeo.ts:157-194`；`search-service.ts:1123` |
| **Apollo** `people/match` | `POST https://api.apollo.io/api/v1/people/match` | `{api_key, domain, company, reveal_personal_emails:true, reveal_phone_number:true}` | `person.email`、`person.personal_emails[0]`、`person.phone_numbers[]` | `highValue && enrichBudget.used<limit && getUserApolloApiKey() && !prospeo?.email` | `enrich-apollo.ts:107-137`；`search-service.ts:1148-1156` |

**预算常量**（每轮搜索，内存局部变量）：
`ENRICH_LOOKUP_BUDGET=20`（Apollo）、`PROSPEO_EMAIL_BUDGET=10`、`PROSPEO_MOBILE_BUDGET=2` — `search/constants.ts:71,83,91`；计数器实例 `search-service.ts:2506-2510`。

**手机揭示开关**：`wantMobile = mobileBudget 有余额 && !alreadyMobile` — `search-service.ts:1126-1131`。

### 2.3 富化结果如何并入线索

| 线索字段 | 来源优先级 | 证据 |
|---|---|---|
| `email` | candidate.email(`extracted`) → **Prospeo(`verified`)** → **Apollo(`verified`)** → 官网 directEmails(`extracted`) → 正则提取(`extracted`) | `search-service.ts:1225-1232` |
| `phone` | `pickBestPhoneForReach(candidate, apollo, prospeo, wa.me直链, 官网, 正则, country)` —— 内部优先选 mobile | `search-service.ts:1235-1245`；`1012-1023` |
| `phoneKind` | `phonePick.provenance.kind` → 否则 `classifyPhoneKind()` | `search-service.ts:1249-1250` |
| `contact` / `contactTitle` | **仅** candidate.contact / 官网文本正则 —— **富化源不参与** | `search-service.ts:1218-1219, 1256-1261`；正则 `757-770` |
| `decisionMakers` | **不由富化写入**；仅随 candidate 透传（即只可能来自 LinkedIn/AnySearch Provider） | `search-service.ts:1378-1396`（返回对象无该字段）；`2185-2186` |

---

## 3. 决策人 / 工作邮箱 / 手机 缺失的根因分类

### 3.1 决策人（姓名 + 职位）

| 根因 | 说明 | 分类 |
|---|---|---|
| **R1 富化源人名/职位被丢弃** | Prospeo `pickBestPerson()` 已解析出 `fullName` / `title`（`enrich-prospeo.ts:82-110`），但返回类型 `ProspeoEnrichResult`（`:51-63`）**只有 email/phone/phoneKind/phoneReachable/used/source** —— 姓名与职位**在适配器出口被丢弃**；调用方 `search-service.ts:1218-1219` 也不从 `prospeo` 取人名 | `[已证实]` |
| **R2 Apollo 人名/职位完全未读取** | 适配器只读 `person.email` / `personal_emails` / `phone_numbers`（`enrich-apollo.ts:132-137`），**未读取任何姓名/职位字段** | `[已证实]` |
| **R3 主搜索源结构上不提供** | SerpApi Maps/Organic 归一化只产出公司级字段 | `[已证实]` |
| **R4 唯一可能产出决策人的两个 Provider 覆盖窄** | `linkedin_search` 期望 `item.name`/`item.position`/`item.job_title`（`linkedin-search-provider.ts:54-68`）；而 SerpApi `engine=linkedin` 的响应结构是 `organic_results[]`（该 Provider 自身读的就是 `organic_results`，见 `:124-128`），其条目字段为 `title/link/snippet` —— **字段名与归一化期望不匹配，`item.name` 大概率为空 → `decisionMakers` 恒 `undefined`** | `[待验证]`（需真实 `engine=linkedin` 响应样本） |
| **R5 AnySearch 是实验性外部依赖** | 唯一稳定产出 `decisionMakers` 的通道，但 `PROVIDER-CAPABILITY.md:30` 标注为**实验性**，且需用户自备 API Key + Base URL | `[已证实]` |
| **R6 阈值截断** | 只有 `matchScore ≥ 60` 才做富化（`search-service.ts:2516`）；低分线索连尝试机会都没有 | `[已证实]` |

**回答 A（是否真正执行决策人搜索）**：
- **Prospeo `search-person` 是真正的「按域名找人」**（`filters.company.websites.include`），并做了决策者职位加权排序（`DECISION_TITLE` 正则，`enrich-prospeo.ts:75-76, 103`）——**但没有把结果的人名/职位写回线索**。
- **Apollo `people/match` 是「匹配」而非「搜索」**：请求只带 `domain`/`company`，不带任何职位/人名筛选（`enrich-apollo.ts:107-113`）。它无法执行「找采购负责人」这类定向搜索。
- **结论**：系统**执行了「按公司找联系人」**，但**没有交付决策人身份**；且**未实现按职位的定向决策人搜索**。

### 3.2 工作邮箱

| 根因 | 说明 | 分类 |
|---|---|---|
| **E1 主源不提供** | SerpApi Maps/Organic 归一化不含邮箱 | `[已证实]` |
| **E2 官网公开邮箱覆盖率天然低** | 大量商户用联系表单替代公开邮箱；且部分站点 403/503（`search-service.ts:783-791`），虽有 LinkedIn/Kompass/Europages 兜底（`:930-934`，3 次额外 SerpApi 调用） | `[天然不足]` + `[已证实]` 的降级路径 |
| **E3 富化覆盖受阈值+预算双重限制** | `highValue`（≥60）+ 每轮 10 条（Prospeo 邮箱预算）+ 20 条（Apollo） | `[已证实]` |
| **E4 Prospeo 邮箱等级判定弱于注释** | 文件头注释写「`status === 'VERIFIED'` 才采信」（`enrich-prospeo.ts:52`），实际实现为 `emailRevealed && emailStatus !== 'INVALID'`（`:178`）——**`UNKNOWN`/`RISKY`/`CATCH_ALL` 也会被当作可用邮箱**，却被标注为 `verified` | `[已证实]`（注释与代码不一致） |
| **E5 Apollo 邮箱无状态校验** | `enrich-apollo.ts:134-136` 直接取 `person.email` 或 `personal_emails[0]`，**未读 `email_status`**；调用方无条件标 `tier:'verified'`（`search-service.ts:1228`） | `[已证实]` |

### 3.3 手机号

| 根因 | 说明 | 分类 |
|---|---|---|
| **M1 Apollo 手机在当前参数下拿不到** | 官方文档明确：`reveal_phone_number=true` **必须**提供 `webhook_url`，号码**异步**投递（可耗时数分钟）；替代方案是 `poll_only=true` 后轮询 `request_id`。本实现**既无 `webhook_url` 也无 `poll_only`**（`enrich-apollo.ts:107-113`） | `[已证实]`（Apollo 官方 People Enrichment 文档 + 代码） |
| **M2 Prospeo 手机仅 2 条/轮** | `PROSPEO_MOBILE_BUDGET=2`（`constants.ts:91`），且 10 credits/条 | `[已证实]` |
| **M3 商家公开电话绝大多数是座机** | Google Maps 商家电话多为固话；US 号码因 LNP 无法从号段区分（`contact-extract.ts:110-116`、`search-service.ts:1003-1009`） | `[天然不足]` |
| **M4 免费手机来源已被正确利用** | `wa.me` 直链（定义上即可 WhatsApp）+ `Mobile:/Cell:` 标签化号码（`contact-extract.ts:118-168`）——这是当前**唯一零成本**的手机来源 | `[已证实]`（实现正确） |

**回答 C（为什么只有公共邮箱/总机）**：
> 不是「源数据限制」单一原因，而是**三因叠加**：
> ① 主搜索源结构上只给公司级数据（R3/E1）；
> ② 官网公开邮箱/手机覆盖率天然低，且座机居多（E2/M3，`[天然不足]`）；
> ③ **当前实现确实没有继续补全到决策人层级** —— Prospeo 拿到人却丢掉人名职位（R1）、Apollo 手机因缺 `webhook_url` 不可能返回（M1）、Apollo 邮箱被高标（E5）。
> 即：**「没有继续补全」是主因，且补全链路上有确定的实现缺陷**。

---

## 4. 联系人来源与验证规则现状

### 4.1 三档可信度模型（SSOT）

`src/shared/contact-provenance.ts:22-45`

| 档位 | 定义 | 本链路中的实际来源 | 放行规则 |
|---|---|---|---|
| `verified` | 第三方验证过 | Prospeo 邮箱、Apollo 邮箱/手机 | `canAutoDispatch=true` |
| `extracted` | 公开原文提取 | 官网 mailto/tel/JSON-LD、`wa.me` 直链、搜索结果、**联系人姓名/职位** | `canAutoDispatch=true` |
| `inferred` | 推断/猜测 | 当前**生产代码无写入点** | `canAutoDispatch=false` + 发送前二次确认 |

- 取值与标注**同源产出**（`pickContactWithProvenance`，`:73-91`）——设计正确，杜绝静默错标。
- **注意**：`verified` 档的**实际含金量不一致**（Prospeo 有 `only_verified_email` 服务端约束；Apollo 无任何校验）——**同一档位承载了不同强度的证据**。

### 4.2 邮箱验证：**静态分级**与**深度验证**是两套，未混用

| 层级 | 函数 | 网络成本 | 触发点 |
|---|---|---|---|
| 静态分级 | `classifyEmailStatic()` `utils/email-verification.ts:93-112` | 零 | 采集层：`validateDecisionMakerContacts` `contact-validation.ts:47-50`；前端 `approval-grade.ts` |
| 深度验证（MX + SMTP RCPT + catch-all 探测） | `verifyEmailDetailed()` `utils/email-verification.ts:194-250` | 需 DNS + TCP:25 | **仅发送前门禁** `automation-service.ts:63` |

**结论（回答 D）**：**MX 校验、域名校验、具体邮箱校验没有被混为一谈**——`verifyEmailDetailed` 中顺序为「静态 → 无 MX 判 `invalid` → SMTP RCPT → catch-all 反探测」，且 catch-all 域名**明确不判 `verified`**（`:224-227`）。五级语义（`verified`/`probable`/`catch_all`/`risky`/`invalid`）与 `valid` 映射（`:205`）自洽。
**唯一缺口**：采集层**只做静态分级**（不做 MX/SMTP），因此线索列表里出现的邮箱**未经可投递性验证**——这在文档与 UI 上有体现，但**用户在搜索阶段看到的邮箱等级只是格式/角色判断**。

### 4.3 电话验证

- `normalizePhoneE164()` `contact-validation.ts:17-29`：只校验「是否为可拨号格式」，**不臆造区号**。
- `phoneKind`（`mobile`/`landline`/`unknown`）来自双端 SSOT `src/shared/phone-kind.ts`；Apollo 自报 mobile 时**直接采信**（`enrich-apollo.ts:151`），否则按号段推断。

**回答 E（是否把 AI 推断误认为已验证）**：
> **部分存在，且有两处具体表现**：
> ① **Apollo 邮箱**：未读 `email_status`/`match_confidence`，一律标 `verified`（`search-service.ts:1228`）——**未经校验的邮箱被授予最高可信档**。`[已证实]`
> ② **Apollo 手机**：`phoneKind` 在 Apollo 自报 mobile 时直接采信（`enrich-apollo.ts:151`），而当前请求根本拿不到号码（M1）——若未来补上 webhook，该「直接采信」也需复核。
> **不存在的误标**：决策人姓名/职位**没有被标为 verified**（标为 `extracted`，`search-service.ts:1256-1261`），且 `validateDecisionMakerContacts` **不臆造 `confidenceScore`**（`contact-validation.ts:8`），前端对 `confidenceScore<=0` 渲染「AI 推测，未验证」降级徽标（`analysis-drawer.tsx:666`）——**这部分是诚实的**。

---

## 5. 成本计量与缓存机制

### 5.1 缓存（均已真实接线）

| 缓存 | 实现 | TTL / 容量 | 接线点 | 证据 |
|---|---|---|---|---|
| SerpApi 响应 | `serpapi-cache.ts`（**仅内存，绝不落盘**，因 key 含 `api_key`） | 24h / 200 条 FIFO | 6 个 Provider 各自 `get/set`；403 兜底查询；主源逐页 | `serpapi-cache.ts:1-56`；`providers/*.ts`；`search-service.ts:940,973,1769,1821` |
| LLM 评分 | `llm-score-cache.ts` | 24h / 500 条 FIFO | `search-service.ts:2379,2442`，key = `{ICP指纹 + 关键词 + 公司指纹}` | `llm-score-cache.ts:1-40` |
| 官网抓取 | **无缓存** | — | 同一域名在多轮搜索中会**重复抓取**（首页 + ≤6 联系页） | `extractWebsiteContent` `search-service.ts:847-897` 无 cache 调用 |

**重复调用控制**：域名去重（`search-service.ts:2678-2680`）、SerpApi「第一页命中即停」（`serpapi-maps-provider.ts:104`）、Prospeo 命中邮箱即跳过 Apollo（`search-service.ts:1148`）——**这三项设计有效**。

### 5.2 成本计量（回答 F）

| 项 | 现状 | 分类 |
|---|---|---|
| 每轮搜索的富化预算 | 有硬顶（20 / 10 / 2），但**只是函数内局部变量**，随搜索结束消失 | `[已证实]` |
| 调用次数/额度消耗落盘 | **无**（全仓 `usageCount`/`callCount`/`apiUsage`/`creditUsed` 零命中） | `[已证实]` |
| 缓存命中统计 | `getSerpApiCacheStats()` / `getLlmScoreCacheStats()` 已实现，但**无任何消费方**（UI/IPC/日志均未调用） | `[已证实]` |
| 可预测的单轮成本上界 | **可推导但未呈现**：SerpApi ≤ 12 变体 × 页数；Prospeo ≤ 10×(1+1) + 2×10 = 40 credits；Apollo ≤ 20 次 × 1–9 credits（官方口径：1 credit 人口统计或邮箱，**返回手机号额外 8 credits**） | 推导依据：`constants.ts:54-59,71,83,91` + Apollo 官方文档 |

**结论**：当前**无法追踪实际成本**。用户既看不到本轮消耗了多少 SerpApi/Prospeo/Apollo 调用，也看不到缓存节省了多少。**存在重复调用风险点**：无官网抓取缓存 → 跨轮次重复抓取同一域名（无网络额度成本，但有 wall-time 与 403 风险）。

---

## 6. 前端展示与导出缺口（回答 G）

### 6.1 已具备

| 能力 | 位置 |
|---|---|
| 邮箱/电话**可信度徽标**（含来源名） | `search-result-card.tsx:304,326` + `renderTierBadge` |
| 决策人明细 + 「未验证」降级徽标 | `analysis-drawer.tsx:660-666` |
| 决策人数指标 | `data-center.tsx:222` |
| 「有决策人」筛选 | `leads-table.tsx:257` |
| 导出「核心关键人」字段组（最多 3 位，含邮箱等级） | `lead-export.ts:52-68, 92-114` |
| 可触达渠道列（WhatsApp / 邮件 / LinkedIn / `—`） | `lead-export.ts:79-91` |

### 6.2 缺口

| 缺口 | 说明 | 分类 |
|---|---|---|
| **G1 无「数据完整度漏斗」** | 用户**无法一眼区分**「公司发现 / 决策人已识别 / 可联系」三个阶段的数量。`data-center.tsx` 有 `decisionMakerCount` 等**并列计数**，但没有作为**漏斗/转化**呈现；`getLeadStage` 反映的是**触达状态**（new/contacting/replied/archived），**不是数据完整度** | `[已证实]` |
| **G2 顶层 `contact` 与 `decisionMakers[0]` 语义重叠且未对齐** | 顶层 `contact/contactTitle` 只来自正则/候选（`search-service.ts:1218-1219`）；`decisionMakers[0]` 可能来自 Provider。两者**无一致性保证**，UI 展示哪个不明确 | `[已证实]` |
| **G3 富化贡献不可见** | `source` 字段会追加 ` · Prospeo` / ` · Apollo`（`search-service.ts:1264`），但**未说明贡献了哪个字段**（邮箱？手机？） | `[已证实]` |
| **G4 成本/缓存统计不可见** | 见 §5.2 | `[已证实]` |

---

## 7. 已证实缺陷与待验证风险

### 7.1 已证实缺陷

| ID | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| **D-1** | Apollo 手机揭示**缺 `webhook_url`**（官方强制要求）→ 手机号**结构性拿不到** | `enrich-apollo.ts:107-113` + Apollo 官方 People Enrichment 文档 | 高价值线索的 WhatsApp 触达能力长期缺失，且**每次都白扣 8 credits 的手机费**（若 Apollo 计费按「请求了手机」判定则更严重——**计费口径待验证**） |
| **D-2** | Prospeo 已解析的人名/职位**在适配器出口被丢弃** | `enrich-prospeo.ts:82-110` vs `:51-63` | 决策人姓名/职位永远进不了线索；用户看到「有邮箱但不知道是谁」 |
| **D-3** | Apollo 邮箱**无状态校验**却标 `verified` | `enrich-apollo.ts:134-136`；`search-service.ts:1228` | 信任风险：未验证邮箱被授予最高可信档，可被自动 Agent 触达 |
| **D-4** | Prospeo 邮箱注释（仅 `VERIFIED`）与实现（非 `INVALID`）**不一致** | `enrich-prospeo.ts:52` vs `:178` | 文档/代码漂移；`UNKNOWN`/`RISKY` 邮箱被标 `verified` |
| **D-5** | 成本计量**零落盘、零暴露** | 全仓零命中；缓存统计无消费方 | 用户无法预测/审计 API 支出 |
| **D-6** | `PROVIDER-CAPABILITY.md`（能力 SSOT）**未覆盖 Prospeo/Apollo** | 该文件全文 | 能力口径不完整；宣传/PRD 引用该表时会漏掉两个付费数据源 |

### 7.2 待验证风险

| ID | 风险 | 需要什么证据 |
|---|---|---|
| **V-1** | `linkedin_search` 归一化期望的 `item.name`/`item.position` 与 SerpApi `engine=linkedin` 实际响应字段不匹配 → `decisionMakers` 恒空 | 一份真实 `engine=linkedin` 响应样本 |
| **V-2** | SerpApi Maps/Organic 归一化**未读取任何 email 字段**；若上游确实返回邮箱则被静默丢弃 | 一份真实 `engine=google_maps` / `engine=google` 响应样本 |
| **V-3** | Apollo 手机揭示的**计费触发条件**（是否「请求即计费」还是「返回才计费」） | Apollo 计费文档/账单样本 |
| **V-4** | Apollo 响应中 `person` 的姓名/职位/LinkedIn 字段名与是否可用 | 真实响应样本 |
| **V-5** | `match_confidence` 为 `low`/`none` 时 Apollo 仍返回的邮箱是否可信 | 真实响应样本 + 抽样人工核验 |

### 7.3 供应商条款合规状态（审计纪律要求）

| 供应商 | 现状 | 结论 |
|---|---|---|
| SerpApi | 项目按「用户自备 Key」使用；`PROVIDER-CAPABILITY.md:24` 已就 customs/trade_show 的**宣传口径**作出约束 | 宣传口径已受控；**「嵌入付费产品转售」条款未核实** `[待验证]` |
| Apollo | **未核实** | `[待验证]` |
| Prospeo | 尝试读取 `prospeo.io/terms` 返回的是营销页面，**未能取得条款正文** | `[待验证]` |

> **明确不做假设**：本报告**不假定**「BYOK（用户自备 Key）」或普通订阅自动获得转售/嵌入分发的权利。
> **必须先完成的核实动作**：由法务/商务在各自 ToS、DPA、API 计划条款中确认三件事——
> ① 是否允许将 API 返回的**联系人数据嵌入商业产品**交付给终端客户；
> ② 是否允许**存储**（本项目会持久化到本地 `leads`）与**二次分发**（导出 CSV）；
> ③ 是否要求终端客户**自行持有账号**（BYOK）。
> 在上述确认前，**不得**对外宣称已获得该数据源的商业使用授权。

---

## 8. 下一轮最小改动建议与逐项验收条件

> 排序原则：**先修「已证实且影响用户可感知价值」的缺陷**，先做**零外部依赖**的改动。
> 每条改动均为**最小范围**，不改并发红线（`SEARCH_ENRICH_CONCURRENCY=2`）、不改宪法常量。

### 建议先修 **一个问题**：D-2 —— 交付 Prospeo 已解析出的决策人姓名/职位

**为什么是它**：
- 数据**已经在手里**（`pickBestPerson` 已算出 `fullName`/`title`），**零新增 API 成本**；
- 直接回答用户最核心的诉求「决策人是谁、什么职位」；
- 与既有三档可信度体系天然契合（Prospeo 人名 → 可标注来源，不必标 `verified`）。

| 项 | 内容 |
|---|---|
| 改动 1 | `enrich-prospeo.ts`：`ProspeoEnrichResult` 增 `contactName?: string` / `contactTitle?: string` / `contactLinkedinUrl?: string`，由 `pickBestPerson` 结果回填 |
| 改动 2 | `search-service.ts`：在 `contact`/`contactTitle` 取值链中，**在官网正则之后**追加 Prospeo 候选，并写入 `contactProvenance.contact = { tier: 'extracted', source: 'Prospeo' }` |
| 改动 3 | `search-service.ts`：可选地把该人写入 `decisionMakers[]`（`source: 'Prospeo'`、`confidenceScore: 0` 保持诚实缺省） |
| **验收 1** | 单测：mock Prospeo 响应含 `full_name`/`current_job_title` → 断言 `contact`/`contactTitle` 被填充，且 `contactProvenance.contact.source === 'Prospeo'` |
| **验收 2** | 单测（**反向**）：Prospeo 无命中时，`contact` **不得**被填充（不得臆造） |
| **验收 3** | 端到端：`buildAgentTaskQueue` → `stageAgentsFromPipeline` → `consumeStagedTargets` 全链路断言决策人字段**逐层存活**（吸取 S5b 跨层丢字段教训） |
| **验收 4** | 变异验证：删掉回填逻辑 → 对应用例**精准判红** |
| **验收 5** | 门禁全绿：`test:unit` / `typecheck` / `verify:consistency` / `format` / `lint` |

### 后续建议（按优先级）

| 序 | 改动 | 验收条件 |
|---|---|---|
| 2 | **D-1**：Apollo 改为 `poll_only=true`（或接入 webhook）+ 轮询 `request_id`；在拿到号码前**不请求手机**（避免无效扣费） | 真实调用能拿到手机号；无手机时 `phoneReachable=false` 且**不产生手机费用**（以账单核对） |
| 3 | **D-3/D-4**：Apollo 读 `email_status`；Prospeo 严格按 `status === 'VERIFIED'`；不满足者降档为 `extracted`（或 `inferred`） | 单测：`email_status='guessed'` → tier **不得**为 `verified`；Prospeo `status='UNKNOWN'` → 同样降档 |
| 4 | **D-5**：把每轮 SerpApi/Prospeo/Apollo 调用次数与预算消耗写入 `agent_logs` 或新增只读统计；暴露缓存命中统计 | 用户可在运行日志看到本轮消耗；缓存命中数 > 0 时可见 |
| 5 | **V-1/V-2**：用真实响应样本校正 LinkedIn/Maps 归一化字段映射 | 样本驱动的单测（fixture）断言字段不再丢失 |
| 6 | **G1**：数据中心增加「公司 → 决策人 → 可联系」三段漏斗 | 三段数量之和守恒（每段 ⊆ 上一段），且与 `leads-store` 实数据一致 |
| 7 | **D-6**：把 Prospeo/Apollo 纳入 `PROVIDER-CAPABILITY.md` 能力表 | 文档门禁 `verify:consistency` 通过；能力声明与代码一致 |
| 8 | **§7.3**：完成三家供应商条款核实 | 形成书面结论（允许/需 BYOK/需企业协议），并据此调整产品分发方式 |

---

## 附录 A：证据索引

| 主题 | 文件 | 关键位置 |
|---|---|---|
| 宪法常量 / 预算 | `electron/services/search/constants.ts` | `15-30`（并发/总量）、`46`（总超时）、`54-59`（变体）、`71,83,91`（富化预算） |
| 富化主流程 | `electron/services/search-service.ts` | `1077-1397` |
| Prospeo/Apollo 触发条件 | 同上 | `1120-1160` |
| 取值与来源同源 | `src/shared/contact-provenance.ts` | `73-91` |
| Prospeo 适配器 | `electron/services/search/enrich-prospeo.ts` | `51-63`（出口类型）、`75-110`（选人）、`137-194`（请求/解析） |
| Apollo 适配器 | `electron/services/search/enrich-apollo.ts` | `74-84`（选电话）、`107-137`（请求/解析）、`151`（采信 mobile） |
| Provider 注册 | `electron/services/providers/index.ts` | `12-24` |
| Provider 执行 | `electron/services/provider-registry.ts` | `95-97`（可用性过滤）、`110-147`（executeAll） |
| SerpApi Maps 归一化 | `electron/services/providers/serpapi-maps-provider.ts` | `28-37` |
| SerpApi Organic 归一化 | `electron/services/providers/serpapi-organic-provider.ts` | `30-37` |
| LinkedIn 归一化 | `electron/services/providers/linkedin-search-provider.ts` | `44-70` |
| AnySearch 归一化 | `electron/services/providers/anysearch-provider.ts` | `58-93` |
| 官网抓取 | `electron/services/search-service.ts` | `773-897` |
| 联系页发现/提取 | `electron/services/search/contact-extract.ts` | `25-44`、`118-168` |
| 邮箱验证引擎 | `electron/utils/email-verification.ts` | `93-112`（静态）、`194-250`（深度） |
| 电话/决策人校验 | `electron/utils/contact-validation.ts` | `17-29`、`40-59` |
| 深度验证调用点 | `electron/services/automation-service.ts` | `63` |
| 缓存 | `electron/services/serpapi-cache.ts`、`llm-score-cache.ts` | 全文 |
| 前端徽标 | `src/components/search/search-result-card.tsx` | `304,326` |
| 决策人展示 | `src/components/analysis-drawer.tsx` | `660-666` |
| 导出字段组 | `src/lib/lead-export.ts` | `52-68`、`92-114` |
| 能力 SSOT | `PROVIDER-CAPABILITY.md` | 全文（**未含 Prospeo/Apollo**） |

## 附录 B：本轮明确未做

- 未修改任何业务代码、配置、依赖或现有文档；
- 未执行任何真实外发（邮件/WhatsApp/LinkedIn）；
- 未调用任何付费 API（无真实响应样本 → 因此 V-1/V-2/V-4/V-5 标注为 `[待验证]`）；
- 未对供应商条款作任何假设性结论（§7.3 明确列为待核实）；
- 未虚构任何匹配率、准确率或成本数字。
