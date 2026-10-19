# KONE V1.3 数据源与联系人获取 —— 全局系统梳理与优化计划（Plan-First）

- **日期**：2026-10-12
- **角色视角**：全栈技术架构 + SaaS 产品经理
- **阶段**：**Tier 1 已执行**（见下"执行状态"）；Tier 2/3 暂缓并附理由
- **覆盖问题**：① 谷歌获客引擎 / 谷歌地图两个 API 设置是否有必要；② 后台设置能否更精简；
  ③ 是否加入 B 端属性 + 电话/邮箱高级搜索 + LLM 汇总；④ Apollo 成本偏高，有无更低成本方案。
- **唯一能力事实源**：`PROVIDER-CAPABILITY.md`（本文件不得与之冲突）

---

## 执行状态（2026-10-12 收口）

| 项 | 状态 | 证据 |
|---|---|---|
| **A 官网深探增强**（UA + 联系页 + JSON-LD） | ✅ **已执行** | 新模块 `search/contact-extract.ts` + `tests/business-logic/contact-extract.business.test.js`（9 条，含变异验证） |
| **C 合并 Google 设置 + SerpApi 密钥回退** | ✅ **已执行** | `provider-service.ts` 回退 + 设置 UI 合并 + `provider-serpapi-key-fallback.business.test.js`（5 条） |
| **B 渐进式交付** | ✅ **已核实**（无需改代码） | 首屏 `emitBasicResults`（`search-service.ts:2071`）先于评分（:2133），`emitLeadScored` 逐条流式 |
| **D 联系页发现** | ✅ **已执行（零成本版）** | 改为**解析首页 `<a>` 链接**发现站内联系页真实 URL（**零 API 调用**），而非付费 `site:` 查询；`extractContactLinksFromHtml` + 4 条测试（含变异） |
| E LLM 结构化联系方式汇总 | ⏸ **暂缓** | 增量低 + 编造风险 + prompt 被 4 个 e2e 覆盖 |
| F 低成本邮箱 provider | ⏸ **另立计划** | 需真实账号 + 更新 `PROVIDER-CAPABILITY.md` |

**门禁**：`test:unit` **466/466** · `typecheck` 0 · `verify:consistency` ✅ · **稳定点 S1–S11 零改动**。

### 覆盖率测量：**受阻**（并因此发现一个 P1 缺陷，已修复）
按建议尝试「用真实密钥跑一轮搜索测 `[Probe-ContactRate]`」时，复制真实 profile 启动即失败：
`Error while decrypting the ciphertext provided to safeStorage.decryptString` → **应用无窗口**（dev 与 packaged 均复现）。
- **这本身是一个 P1 缺陷**（密钥不可解密 → `main.ts` 启动链中断 → 彻底变砖），已在 CHANGELOG [1.4.19] 修复
  （根因层 `readSecretMap` 降级 + 启动层 try/catch 兜底）。
- **测量结论**：真实 profile 的 secrets **不可解密**，无法用其发起真实搜索 →
  **须用户在设置页重新录入 SerpApi/LLM 密钥后**，方可继续测量覆盖率并决定是否推进 E/F。

---

## 第 0 部分 · 一页速览

| 问题 | 判定 | 一句话 |
|---|---|---|
| Q1 两个 Google 设置 | **冗余，应合并** | 两者是**同一个 SerpApi 账号**；搜索**只读 google-leads 的 key**，google-maps 是 UX 陷阱 |
| Q2 后台精简 | **可精简 5→4** | 默认只露 2 项（LLM + SerpApi）即可跑通全部搜索 |
| Q3 高级搜索 + LLM 汇总 | **方向对、做法要改** | 不要"把 email/phone 拼进关键词"，应做**联系页发现 + 免费深挖 + LLM 只做汇总去伪** |
| Q4 替代 Apollo | **有，分三层** | L0 免费榨干官网深探 → L1 低成本(邮箱类) → L2 Apollo 放最后 |

---

## 第 1 部分 · 稳定点（**不可动清单** · 任何优化都必须先过这一关）

> 以下均为项目**宪法/架构级不变量**，来源：`kone-PRD.md §零.3`、`ARCH-STANDARDS.md`、`AGENTS.md`。
> **优化计划中的每一条都必须声明"是否触及稳定点"，触及者需走回归验证。**

### S1 搜索韧性：四级弹性搜索协议（**绝对保留**）
`第 0 级 AnySearch → 第 1 级 Maps → 第 2 级参数容错 → 第 3 级 Organic 补位`
（`kone-PRD.md:34`；AGENTS.md 明确"Preserve all validated behavior, especially the mandatory 四级弹性搜索协议"）
→ **本次所有优化只作用于"富化层"，不改变降级链路本身。**

### S2 并发域（三个**独立**上限，**不得混读**）
| 常量 | 值 | 约束对象 |
|---|---|---|
| `SEARCH_LLM_CONCURRENCY` | 2 | LLM 评分的并行线索数 |
| `SEARCH_ENRICH_CONCURRENCY` | 2 | 官网富化的并行线索数 |
| `SEARCH_FANOUT_CONCURRENCY` | 3 | 关键词变体的扇出并发（采集阶段，独立域） |
（`search/constants.ts:22-29`）→ **新增任何富化动作都不得提升"并行线索数"。**

### S3 总量域（额度护栏，防烧光）
`SEARCH_PRODUCT_TERM_LIMIT=2` / `SEARCH_VARIANT_LIMIT=12` / `SEARCH_LLM_SCORE_LIMIT=50` /
`SEARCH_TARGETED_LEAD_LIMIT=50` / `MAX_SEARCH_CANDIDATES=200` / `SEARCH_CHANNEL_FETCH_LIMIT=100` /
`ENRICH_LOOKUP_BUDGET=20` / `MAX_WEBSITE_TEXT_FOR_LLM=3000`（`search/constants.ts`）
→ **新增外部付费调用（Apollo/邮箱类 API）必须纳入总量护栏。**

### S4 Fail-Closed（授权 + 密钥 + 富化，全部默认失败安全）
- 高危能力默认 Fail-Closed 授权（`ARCH-STANDARDS.md:46`）。
- 密钥读取失败 = **未配置**（不得抛错击穿链路）。
- 富化任一外部源失败 → 静默降级到官网抓取，**绝不中断搜索**。

### S5 单源失败隔离
`google_maps / google_organic / AnySearch / linkedin_search / customs_shipment / trade_show / yellow_pages / facebook_search`
的失败**互相隔离**，任何单源失败不得中断整轮搜索（`AGENTS.md:114`）。

### S6 Provider 契约边界
Provider **只负责采集与归一化**：不得写 Zustand、不得发 IPC、不得保存线索；
统一消费 `ProviderQuery`（`keyword/language/country/city/intentProducts/b2bAttributes/myJobId`）。

### S7 宣传口径 SSOT
对外能力声明**只能**引用 `PROVIDER-CAPABILITY.md` 中标注 **✅ 真实可用** 的行；
`customs_shipment`/`trade_show` 为**网页近似检索**，**严禁**宣称"官方海关提单数据库/官方展会名录直连"。

### S8 双管道数据流（Agent 侧）
`writeBackAgentStatus` 必须**同时**更新 `agentStatus`（持久化）与 `AgentState`（运行态），二者不可偏废。

### S9 IPC 注册中心不变量
**「已登记 ≠ 已绑定」**：新增/迁移通道必须登记在 `registerIpcHandlers()`（其末尾唯一 `attach()`）**之前**，
否则永不绑定（2026-10-12 已致 `sync-autopilot-state` 死通道，见 CHANGELOG 1.4.17）。
启动门禁 `assertAllRegistered()` 只校验"已登记"。

### S10 评分权重受宪法保护
Stage-1 权重 `40/30/20/10` 与 Scout 权重**不得改动**；Stage-2 的 `55/35/10` 是**另一套**独立常量，不得互相套用
（`kone-PRD.md:223/241`）。

### S11 数据落盘边界
线索业务数据**不进磁盘**；`serpapi-cache` / `llm-score-cache` 仅**内存态**。
新增任何缓存/持久化前须先核对本边界。

> **一句话**：优化只能在 **S1–S11 的边界内**做"增量富化"，任何"为了拿联系方式而改搜索/评分/并发/落盘"的方案，
> **一律不采纳**。

---

## 第 2 部分 · 系统全景（现状事实，代码级）

### 2.1 数据源全景：**6 个 Provider 共用 1 个 SerpApi 账号**
| Provider | dataSourceType | 底层 |
|---|---|---|
| SerpApiMapsProvider | `google_maps` | SerpApi `engine=google_maps` |
| SerpApiOrganicProvider | `google_organic` | SerpApi `engine=google` |
| LinkedinSearchProvider | `linkedin_search` | SerpApi `engine=linkedin` |
| CustomsShipmentProvider | `customs_shipment` | SerpApi 网页近似 |
| TradeShowProvider | `trade_show` | SerpApi 网页近似 |
| FacebookSearchProvider | `facebook_search` | SerpApi `site:facebook.com` |
| AnySearchProvider | `anysearch` | 第三方垂直 API（**实验性**） |

### 2.2 设置项全景：前端 5 个密钥槽
`llm` / `google-leads` / `google-maps` / `anysearch` / `apollo`（`base-settings-tab.tsx:23-29`）

### 2.3 搜索管线全景
```
用户输入 → 意图解析(LLM, mutateSearchIntent) → 关键词变体(≤12)
        → 扇出采集(并发 3, SerpApi 多源) → 免费初排(Scout) → LLM 评分(并发 2, ≤50)
        → 目标线索(≤50) → 官网富化(并发 2) → 双管道回写
```

### 2.4 富化三层（**只有一层要钱**）
`search-service.ts:975 enrichLeadWithDeepProbe`
1. **官网深探（免费）**：抓 `首页 + /contact + /contact-us`（`buildContactPageUrls:682`）→ 正则提邮箱/电话 + `mailto:`/`tel:`；
   UA=`Kone-AI/1.0`（**易被 403**）；正文截断 2200 字。
2. **Apollo（付费）**：`people/match`，仅 `matchScore≥60` + 预算未用尽 + 已配置密钥；fail-closed。
3. **LLM 深探**：**只产 `outreachAngle`**（`buildDeepProbeSystemPrompt:714`），且**明令禁止编造**联系方式
   → 联系方式**完全来自第 1 步正则**，LLM 目前不参与联系方式汇总。

### 2.5 成本结构
- **SerpApi**：已为搜索付费，**边际成本低**（复用同一账号）。
- **LLM**：按 token，评分 + 深探。
- **Apollo**：按 credit，**最贵**，仅高价值触发。

---

## 第 3 部分 · 问题诊断（带代码证据）

### Q1：两个 Google 设置有必要吗？→ **没必要**
- 两者同为 SerpApi；搜索管线**只读 `google-leads`**：
  `provider-service.ts:19-20 → getSecret(googleLeads.secretKey)`。
- `secrets.google-maps.apiKey` 在**搜索路径零引用**，仅用于自身"测试连接"（`proxy-service.ts:330`）。
- **UX 陷阱**：只填「谷歌地图」→ 所有 Provider 取不到 key → **整轮搜索无数据**。

### Q2：后台能否更精简？→ **能，5→4**
默认只露 **LLM + SerpApi** 即可跑通全部搜索；AnySearch 折叠为"实验性"；Apollo 置最后并标注计费。

### Q3：加 B 端属性 + 邮箱/电话高级搜索 + LLM 汇总？→ **方向对，做法要改**
- **已做**：B2B 角色词（`intent.ts:132 B2B_ROLE_TERMS`）已乘进关键词。
- **反例（已踩坑）**：`intent.ts:127 stripOmniControlTerms` **刻意剥离** `email|phone|website|contact|info`
  —— 因为**搜索引擎不按字段检索**，塞进关键词 = 垃圾结果 + **纯浪费配额**。
- **正解**：**联系页发现**——对已命中域名追加 **1 次** `site:D (contact OR about OR impressum OR team)`，
  再抓联系页提取（德国 Impressum **法律强制**含电话/邮箱）。
- **LLM 定位**：只做"**汇总 + 去伪**"，**不猜**联系方式（现有"禁编造"口径正确，保持）。

### Q4：Apollo 成本高，有无更低成本方案？→ **有，分三层**
| 层 | 手段 | 成本 | 说明 |
|---|---|---|---|
| **L0 免费** | 官网深探 + 联系页发现 + JSON-LD + 真实 UA | **0** | 先榨干 |
| **L1 低成本** | Hunter / Snov / Prospeo / People Data Labs | ~$0.01–0.05/条 | 邮箱为主，PDL 部分含手机 |
| **L2 高价值** | **Apollo**（现状） | 高 | **放最后** |

> **原则**：Apollo 最贵 → **最后一档**；L0/L1 拿不到且线索高价值时才动用（现有 fail-closed 架构，扩展即可）。

---

## 第 4 部分 · 优化计划（**待评审后执行** · 本阶段不写代码）

> 每条标注：**触及稳定点？**（无 / 需回归）、**验收标准**。

### P0（几乎零成本，立竿见影）
| 编号 | 动作 | 触及稳定点 | 验收标准 |
|---|---|---|---|
| **P0-1** | 两个 Google 设置**合并为单一「SerpApi」**（读取兼容旧 key：google-leads 优先，回退 google-maps） | S9（若新增通道需登记在 attach 前）；不动 S1–S8 | 设置页只剩 1 个 SerpApi 项；只填它即可跑通 maps+organic；旧用户升级不失效（兼容测试） |
| **P0-2** | 官网深探增强：**真实浏览器 UA** + **扩展联系页路径**（+`/about /impressum /kontakt /team /company` 及 locale）+ **解析 JSON-LD**（`Organization.telephone/email`） | **不触及**任何宪法常量（仅富化内部） | 免费邮箱/电话命中率提升（用固定样本对比前后）；403 空结果减少；无新增并发/总量 |

### P1（低成本，价值高）
| 编号 | 动作 | 触及稳定点 | 验收标准 |
|---|---|---|---|
| **P1-1** | 高价值线索：对域名做 **1 次 `site:` 联系页发现查询** | **S3 总量域**（须纳入 SerpApi 总量护栏，防放大） | 每轮额外查询数有硬顶；单源失败隔离；不影响四级降级 |
| **P1-2** | LLM 深探扩展为"**结构化联系方式汇总（禁编造）**" | **S3**（`MAX_WEBSITE_TEXT_FOR_LLM`）；S6（不改 Provider） | LLM 输出仅"复述/结构化已抓到的事实"，注入"编造即判失败"的负向测试 |

### P2（中期）
| 编号 | 动作 | 触及稳定点 | 验收标准 |
|---|---|---|---|
| **P2-1** | 接入 L1 低成本邮箱 provider，作为 **Apollo 的降级前置**（Apollo 放最后） | S3/S4/S5/S6/S7（新 provider 全套）；**须先更新 PROVIDER-CAPABILITY.md** | fail-closed 五态测试；宣传口径合规；未验证不得对外宣称 |
| **P2-2** | 后台设置精简为 4 项，实验性项折叠 | 无 | UI 变更 + 一致性门禁通过 |

### **明确"不动"清单（防过度工程）**
- 不改四级弹性搜索协议、不改并发/总量宪法常量、不改评分权重、不改双管道、不改落盘边界。
- 不把 `email/phone` 拼进搜索关键词（已证伪）。
- 不为"拿联系方式"引入浏览器自动化大规模爬站（成本/合规不划算）。

---

## 第 4.5 部分 · 四目标约束下的优先级重排与精细化数据交互流程

> 新增约束：**在保证「精准度 + 线索量」的前提下，兼顾「体验（不能等太久）」与「成本」**。
> 四者互相拉扯（精准↑常牺牲量；富化↑增加延迟与成本），故按**四目标净收益**重排。

### 4.5.1 四目标评分卡（重排依据）

| 动作 | 精准度 | 线索量 | 延迟 | 成本 | 综合 |
|---|---|---|---|---|---|
| A 官网深探增强（真实 UA + 联系页路径 + JSON-LD） | ↑↑ | ↔ | ↔（并行内） | **0** | **★★★★★** |
| B 渐进式交付（首屏先出、后台精化） | ↔ | ↔ | **↓↓（感知）** | 0 | **★★★★★** |
| C 合并 Google 设置为单一 SerpApi | ↔ | **↑（防"零量"陷阱）** | ↔ | 0 | ★★★★ |
| D 联系页发现（`site:` 二次查询） | ↑↑ | ↔ | ↑（可控） | 小（SerpApi） | ★★★★ |
| E LLM 结构化联系方式汇总（禁编造） | ↑ | ↔ | ↔（复用 LLM 预算） | 小（LLM） | ★★★ |
| F 低成本邮箱 provider 作 Apollo 前置 | ↑ | ↑ | ↑ | **↓（替代 Apollo）** | ★★★ |
| G 后台精简为 4 项 | ↔ | ↔ | ↔ | 0 | ★★ |

### 4.5.2 重排后的优先级（Tier）

- **Tier 1（先做，四目标全正向）**：**A 官网深探增强** · **B 渐进式交付** · **C 合并 Google 设置**。
- **Tier 2（精准度增强，成本/延迟受控）**：**D 联系页发现** · **E LLM 结构化汇总**。
- **Tier 3（成本替代 / 体验）**：**F 低成本邮箱 provider** · **G 后台精简**。

> **相对原计划的变化**：
> 1. **B（渐进式交付）由隐含项升为 Tier 1** —— "不能等太久"是硬约束，且零成本、直接改善体验。
> 2. **D 维持 Tier 2 首位** —— 它同时增加延迟与成本，**必须先有预算护栏 + 并行化**才能进 Tier 1。
> 3. **A 与 C 前置** —— 一个零成本提精准，一个零成本防"零量"。

### 4.5.3 三对矛盾的显式取舍（这是"精细化"的核心）

1. **精准度 × 线索量** → **不硬删，改"排序 + 分层展示"**：
   保留 50 条目标线索，按分**分层**（高/中/低）而非只留高分——既保量又让用户一眼看到精准项。
2. **延迟 × 精准** → **先粗后精**：
   首屏先给"粗结果"（`BASIC_RESULTS`），后台逐步精化（`LEAD_SCORED` 流式 + 富化更新）——**感知延迟骤降，精度不丢**。
3. **成本 × 量** → **免费优先，付费只打 top slice**：
   官网深探（免费）覆盖全部 50 条；Apollo（付费）只打高价值 + 预算内。

### 4.5.4 精细化数据交互流程（分阶段 · 含预算与数据形状）

**阶段与预算**（复用既有通道，不新增协议）

| 阶段 | 动作 | 并发/上限 | 延迟预算 | 成本 | 输出通道 |
|---|---|---|---|---|---|
| S0 意图解析 | LLM 变异 | 1 次 | ≤4s | LLM | `STAGE('normalizing')` |
| S1 扇出采集 | SerpApi 多源 | 扇出 3 / 变体 ≤12 | ≤20s | SerpApi | `STAGE('fetching')` |
| S2 归一化 + 初排 | 纯函数（Scout） | — | ≤1s | **0** | `STAGE('prefiltering')` |
| **S3 首屏交付** | **推基本结果** | ≤50 | **首屏 ≤ ~30s** | **0** | **`BASIC_RESULTS`** |
| S4 LLM 评分 | 并发 2 / ≤50 | 50/2 × ~20s | LLM | **`LEAD_SCORED`（流式）** |
| S5 官网富化 | 并发 2 / ≤50 | 15s/条 | **0** | 流式更新字段 |
| S6 付费富化 | Apollo / 低成本源 | ≤20 + 预算 | credits | 流式更新字段 |
| S7 收尾 | — | — | — | `STREAM_COMPLETE` |

**关键交互序列（数据形状）**
```
渲染层 → IPC search:execute { keyword, country, city, icpProfile }
主进程:
  emitStreamStart(total)                          ← 立即反馈"已开始"（消灭"卡住"错觉）
  STAGE(normalizing) → LLM 意图变异 → { pureEnglishProducts, b2bAttributes, keywords≤12, localizedKeywords }
  STAGE(fetching)    → 扇出 SerpApi（并发 3）→ RawCandidate[]（各源归一化，失败隔离）
  STAGE(prefiltering)→ 去重 + Scout 初排 → Candidate[]（matchScore 暂空）
  ── 首屏 ──
  emitBasicResults(Candidate[≤50])                ← 用户此刻**已看到线索**（未评分）
  STAGE(scoring)     → LLM 评分（并发 2）→ 逐条 emitLeadScored({candidate, completed, total})
  STAGE(enriching)   → 官网深探（免费，并发 2）→ 逐条更新 { email, phone, contact, contactTitle }
                     → Apollo / 低成本源（高价值 + 预算）→ 逐条更新
  emitStreamComplete()
```

**三条保证（对应你的三个诉求）**
- **不能等太久**：首屏 ≤ ~30s（S3）；此后**每条线索就绪即推**（流式），无需等到 S7；
  总时长仍由 `SEARCH_TOTAL_TIMEOUT_MS=5min` 硬顶兜底（防"永久卡住"）。
- **精准度 + 量**：**不硬删候选**；S4 评分是**排序**不是**过滤**；S5/S6 富化只**补字段**、不改集合。
- **成本**：S1 受 SerpApi 总量护栏；S4 受 `SEARCH_LLM_SCORE_LIMIT=50`；S6 受 `ENRICH_LOOKUP_BUDGET=20`。
  **新增动作（D）必须显式纳入总量护栏并并行化**，以免拖累 S3 首屏。

**对既有流程的改动量**：S3（首屏）与 S4/S5/S6（流式）**已存在**，本计划**主要是"调参 + 增强"**，
不新增通道、不改降级链路 → **不触碰 S1–S11 稳定点**。

---

## 第 5 部分 · 执行前置与验收（Plan-First 收口）

任何 P0/P1/P2 落地前必须齐备：
1. **SSOT 同步**：`PROVIDER-CAPABILITY.md`（若新增 provider）、`CHANGELOG.md`、必要时 `kone-PRD.md §零.3`（**若动常量**）。
2. **测试**：负向/变异测试（证明"注入缺陷即失败"）；失败隔离测试；fail-closed 测试。
3. **门禁**：`test:unit` + `typecheck` + `verify:consistency` + 打包冒烟。
4. **回滚条件**：明确"命中即回滚"的指标（如免费命中率未升、搜索时延上升超阈值）。
5. **文档链**：按 AGENTS.md 走 10 份强制文档链，涉 Provider 必读 `PROVIDER-CAPABILITY.md`。

---

## 第 6 部分 · 边界与风险

1. **不得承诺"必然拿到手机号"**——公开渠道手机号覆盖率天然低，只能提高概率。
2. **抓取合规**：遵守目标站 robots/ToS；UA 调整不得用于伪装身份绕过封锁。
3. **第三方数据源**：新增前须先更新 `PROVIDER-CAPABILITY.md`；未接入/未验证**不得对外宣称**。
4. **本文件为梳理与规划**，未改动任何业务代码。

---

### 附：与既有文档的关系
- 本文件**取代**同日的《数据源与联系人获取低成本策略梳理-2026-10-12.md》（草稿），并补齐"稳定点"与"执行前置"。
- 能力口径以 `PROVIDER-CAPABILITY.md` 为准；常量以 `kone-PRD.md §零.3` 为准。
