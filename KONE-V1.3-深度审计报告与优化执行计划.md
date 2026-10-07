# KONE V1.3 深度审计报告与项目优先级优化执行计划

> **执行状态更新（2026-09-03）**：§四 P0 四项、P1 四项与 P2/P3 各项（P2-2 部分落地）（P0-1 差异化邮件 / P0-2 Eligibility Gate / P0-3 邮箱五级验证 / P0-4 决策人静态验证）已在 `gap-fix-p0-p1` 分支全部落地并回归通过（business-logic 51/51、根目录 81/81、e2e 25/25）。执行细节见 `.omo/plans/p0-precision-differentiation-closure.md`，规范同步见 `ARCH-STANDARDS.md` §9.6 与 `kone-PRD.md` §0.5.1 / §六。制裁国与 CRM 保护期否决、五级差异化队列编排仍为路线图（诚实标注）。
> 审计范围：8 份规范文档链（kone-PRD.md / PROJECT-PRD.md / ARCH-STANDARDS.md / ui-agent.md / ipc-agent.md / system-blueprint.md / build-agent.md / V1.2-商业版交付与运维手册.md）+ PROVIDER-CAPABILITY.md（唯一能力事实源）+ 关键源文件实证（search-service.ts / agent-service.ts / agent-* / email-agent.ts / whatsapp-agent.ts / linkedin-agent.ts / followup-scheduler.ts / email-suppression.ts / automation-service.ts / anysearch-provider.ts / search-engine.tsx / leads-table.tsx / leads-management.tsx / data-center.tsx）。
>
> 审计立场：文档描述 ≠ 代码真相。以下结论以代码实证为准；凡文档宣称而代码未落实的，一律按"未落地"计入缺口。

---

## 一、总体定性结论

### 1.1 工程治理与商业基础设施：✅ 严谨、专业、可用
KONE 在**"工程纪律"**维度达到了商用 SaaS 水准，这也是本项目最扎实的资产：
- **宪法级常量固化**：并发 `2`、官网截断 `3000`、ICP `40/30/20/10`、Trial `7` 天、搜索候选 `200`、目标 `50`、分页 `30` 等硬红线在代码中真实执行，且受宪法保护（kone-PRD §零.3）。
- **数据管道严谨**：JobID 时空隔离（`crypto.randomUUID()` + `currentActiveJobId`）、Agent 管道隔离（`currentPipelineRunId`）、Provider 注册表 `Promise.allSettled` 隔离、HTTP 熔断器（3 次失败/60s）、Crash Reporter、自动备份（MD5+7轮换+50MB）、Auto-Update 骨架——均为真实落地。
- **Auth 防线 Fail-Closed**：所有高价值 IPC（`search:execute` / `analysis:generate` / `automation:verify-emails` / `automation:start-campaign` / `cloud:*`）主进程鉴权，Trial 双锚点（注册表+隐藏目录）+ 时间回拨锁定 + 离线回退——商用级防白嫖。
- **Agent 真实执行**：EmailAgent（Nodemailer SMTP 真实 `verify()`+`sendMail()`、imapflow 真实 IMAP 回复检测、DNS 真实查询）、WhatsAppAgent（Puppeteer 真实 DOM 会话/QR/投递检测+随机节流）、LinkedInAgent（真实只读 Profile 提取）——**无 setTimeout 假成功**，符合 AGENTS.md 宪法。
- **双管道状态**：`agentStatus`（持久化 agent_status 配置键）+ `AgentState`（运行时 IPC 推送）+ 前端持久化缓存按 leadKey 拉取——触达徽标真实可靠。
- **合规抑制清单**：`email-suppression.ts` 持久化、域名级、按 unsubscribe/bounce/complaint/manual 四类，并真实接入 EmailAgent 发送前门禁——业界应有的能力。

### 1.2 数据精准度与差异化触达：⚠️ 核心商用价值尚未闭环
在**"精准获客"这一核心商业承诺**维度，存在 4 个结构性缺口，直接决定"是否满足商用"：

| # | 缺口 | 文档宣称 | 代码现状 | 影响 |
|---|---|---|---|---|
| G1 | **差异化邮件触达未差异化** | "150词定制开发信""多轮差异化跟进" | 本地 EmailAgent `executeSequence` 使用**硬编码通用模板**（`Partnership opportunity with ${company}`），**未消费** AI 生成的 `emailBody`/`analysisCache` | 触达转化率命门，核心卖点落空 |
| G2 | **数据精准度：假高分漏洞** | "穿透决策人/高价值过滤" | `computeIcpMatchScore` 为 `text.includes(term)` 粗粒度关键词匹配；无 Eligibility Gate → 维修店/电商/B2C 仍获高分（40+30+20+10=100）；仅 **20/50** 目标线索进入 LLM 评分富化 | 高潜区混入噪声，浪费销售精力 |
| G3 | **邮箱验证基础化** | "邮箱验证有效性" | 真实 SMTP RCPT+MX 握手，但**无 disposable-domain / role-account(info@sales@) / catch-all / Greylist 检测**，五级分级(Verified/Probable/Catch_all/Risky/Invalid)仍为路线图 | 触达第一通道质量把关不足 |
| G4 | **决策人数据零验证** | "高保密直连邮箱/电话/领英" | 全部依赖实验性 AnySearch 第三方 API，**零独立验证**，`confidenceScore` 缺省为 0 | "决策人穿透"可信度低 |

### 1.3 综合判断

> **KONE 是一款"工程严谨、基础设施扎实、但精准获客核心链路尚未闭环"的专业级本地化工具。**
> - 若定位为**"商用基础设施/获客工作台骨架"**：✅ 已达商用水准，可交付。
> - 若定位为**"专业严谨、精准高效、差异化触达"的成品获客工具**（用户所问的核心诉求）：**⚠️ 暂不满足**。G1–G4 四项必须先闭环，否则"精准""差异化"属宣传与实现的落差，商用交付有转化与口碑风险。

---

## 二、逐项精细化梳理

### 2.1 前端精准客户线索体现
- **已落地**：搜索结果卡 `ICP %` 徽章、`待评估`/`评估中...`/`AI 正在分析该线索...` 渐进态（ui-agent §4 合规）、`matchReasons` 理由、`dataSourceType` 彩色徽标（海关绿/展会琥珀/社媒蓝/网页灰）、决策人数量徽标、海关数据徽标、展会足迹徽标（analysis-drawer / leads-table / data-center）。
- **触达徽标**：`AgentTouchBadges` 真实读取持久化 `agentStatus`（WhatsApp 已送达/已回复、邮件第N轮、LinkedIn），并订阅 `AGENT.LEAD_STATUS_UPDATED` 实时刷新——**前端真实反映后端触达态**。
- **跟进看板**：leads-management 四列 Kanban（待跟进/联系中/已回复/已归档）+ 状态筛选 + 行内下拉改状态；复制开发信时自动置 `contacting`（analysis-drawer §415）。
- **缺口**：① **无法区分"确定性关键词评分"与"LLM 评分"**——20 条 LLM 评分与 30 条仅关键词评分的线索在前端视觉上一致，用户无从判断精度差异（建议增加 `置信等级` 标识）。② 决策人 `confidenceScore` 缺省 0 无视觉降级提示。

### 2.2 数据精准度
- **确定性预筛分**：`computeIcpMatchScore` 宪法 40/30/20/10 真实执行（域名40/产品词30/B2B信号20/联系人10），纯函数、零 LLM、低配友好 ✅。但**产品词命中是 `text.includes(term)`**——子串匹配易误伤（如产品词 `car` 命中 `carpet`），且仅英文主干词参与（本地语言变体未进 `coreProductTerms`）。
- **LLM 评分**：`buildUniversalIcpPrompt` + `buildSearchScoringPrompt`，输出 `totalScore`/`inferredRole`/`salesStrategy`/`riskFlags`/`isB2B`，并发 2、超时 20s。**但仅 20/50 条进入此层**（`SEARCH_LLM_SCORE_LIMIT=20` < `TARGETED_LEAD_LIMIT=50`），其余 30 条止于确定性评分。
- **LLM 评分维度单一**：单一 `totalScore`，**无** Eligibility 准入硬门、**无** Intent/Why-Now 采购意图维度、**无** Evidence 置信分级、**无** 结构化 Risk Penalty。Negative ICP 仅靠 prompt 软约束（"if clearly matches... set dimension 0"）。这正是路线图 §0.5.1 自我承认的"假高分漏洞"。
- **多源增强**：海关/展会/决策人仅作解释徽标与同分排序，不绕开预筛分 ✅（符合宪法）。但海关/展会底层为**网页近似检索**（非官方库），已诚实披露 ✅。

### 2.3 数据量
- 每渠道每页 `100`（`SEARCH_CHANNEL_FETCH_LIMIT`）→ 去重后上限 `200`（`MAX_SEARCH_CANDIDATES`）→ 截断 `50` 目标（`SEARCH_TARGETED_LEAD_LIMIT`）→ 仅 `20` 进 LLM 评分/官网富化（`SEARCH_LLM_SCORE_LIMIT`）→ 前端 `30/页` 循环分页（`SEARCH_PAGE_SIZE`）。
- **量级合理、低配友好**，但 **"20 真富化 / 50 展示"的非对称**意味着 60% 展示线索未经官网深探与 LLM 角色推断——数据量达标，但**高价值密度**在后者 30 条上偏低。
- Autopilot 默认阈值 60 过滤，仅高潜入库 ✅。

### 2.4 客户数据信息的有效过滤
- **多层过滤真实执行**：normalize（去重，域名/公司+地址键）→ `isTrashLead`（正则黑名单）→ `computeScoutRelevance`（负向词+锚点+B2B信号+官网优先+本土域名 TLD 映射）→ `computeIcpMatchScore` → `highRelevanceOnly`（≥60）→ Agent 管道（≥60 且含触达资产）。过滤链完整、可观测（结构化 `discardReasons` probe）✅。
- **过滤偏"软"**：`computeScoutRelevance` 仅当 `negativeHits>0 && anchorHits==0 && b2bHits==0` 才剔除——只要有一个锚点词命中，含负向信号的候选仍保留。这是"假高分"入口。**缺 Eligibility Gate 一票否决**（B2C/维修/二手/电商卖家/制裁国/黑名单行业）。

### 2.5 邮箱验证有效性
- **已落地**：`automation:verify-emails`（Premium/cloud_send 保护），串行执行（防端口爆发）、上限 50/批、MX 解析 + SMTP `EHLO/MAIL FROM/RCPT TO` 真实握手（8s 超时），返回 `格式无效/无MX/超时/连接失败/RCPT拒绝/验证异常` ✅。真实、诚实。
- **缺口**：① **无 disposable 一次性邮箱域名过滤**（10minutemail 类）。② **无 role-account 检测**（info@/sales@/support@ 应标记 `Risky` 而非 `Valid`）。③ **无 catch-all 检测**（服务器接受任意 RCPT 的域名应标 `Catch_all`）。④ **无 Greylist 处理**。⑤ **五级分级体系**（Verified/Probable/Catch_all/Risky/Invalid）为路线图，未落地。⑥ 邮箱**未做正则格式深度校验**（仅 `includes('@')`）。
- **对比**：达到"基础可用"，但未达 NeverBounce/ZeroBounce 商用级。对"精准获客"而言，这是第一通道的把关短板。

### 2.6 ICP 评分
- **双层架构已就位但分层不全**：Stage1 确定性 40/30/20/10（宪法，受保护）✅；Stage2 LLM `totalScore` ✅。**缺 Stage 0.5 Eligibility Gate**（一票否决）与**缺路线图 Stage 2 精细化 55/35/10 机会分**（ICP Fit 55 / Intent 35 / Evidence 10 + Risk Penalty）。
- **宪法完整性好**：权重不可改、纯函数、无网络、保留为 LLM 回退基线 ✅。
- **精准性不足**：见 2.2。

### 2.7 客户跟进状态标记
- **真实落地**：`LeadStatus = new | contacting | replied | archived` + `FollowUpStatus`（别名），`normalizeLeadStatus` 归一（`contacted/qualified/negotiation→contacting`、`closed→replied`、`lost→archived`）。Kanban 四列 + 行内下拉 + 自动置态 ✅。
- **Agent 触达态**：`emailSequenceStage 0-3`（3/4/7 天序列，followup-scheduler 真实按 `STAGE_INTERVAL_MS` 推进）、`whatsappStatus`（pending/delivered/replied/failed，**真实投递检测，不假成功**）、`linkedinContacted`（只读浏览强制 `false`，诚实）✅。
- **缺口**：跟进序列在 **IMAP 未配置时仍按时间推进**（best-effort cadence）——可能向"已回复但 IMAP 未检测到"的客户重复发送。应要求配置 IMAP 才自动推进，否则标记"需人工确认"。

### 2.8 差异化跟进自动化邮件触达（★ 核心卖点缺口）
- **已落地（真实执行层）**：EmailAgent Nodemailer 真实发送、`executeSequence` 4 阶段（Stage0 开发信 / Stage1 跟进 / Stage2 案例 / Stage3 收尾）、IMAP 回复检测自动停序列、抑制清单门禁、DNS 高危软锁定、每日限额（Basic 20）、发送前 suppression 检查 ✅。
- **★ 核心缺口：内容非差异化**。`executeSequence` 的 `subjects`/`bodies` 为**硬编码通用英文模板**，仅插 `${task.company}`。而**真正差异化的 AI 开发信**（`emailBody`/`emailSubject`，基于网站分析+知识库+ICP 定制）只存在于 `analysisCache`/`generatedStrategies`，**仅通过 N8N 云端路径**（`ai_generated_pitch.emailBody`）或**人工在 analysis-drawer 复制**发出，**本地 EmailAgent 自动化序列不消费它**。
- **结果**："差异化触达"在实际自动化链路中退化为"模板化群发"，与"基于真实精准数据、高效差异化触达为核心"的产品主张直接矛盾。
- **其他缺口**：无目标客户时区感知、无泊松随机延时（均为路线图 §六.4）。

### 2.9 社媒账号营销防封号触达
- **WhatsApp**：真实 DOM 自动化（实验性·Beta 诚实标注）、真实 session/QR/投递检测（`delivered` 仅真实 tick 才置，否则 `pending`）、随机 30-90s 节流（可配置）、每日限额、`rate_limited` 态、session 断线提示、sandbox 沙箱隔离 ✅。反封号工程**诚实、克制、专业**。
- **LinkedIn**：真实只读 Profile 提取 + 破冰文案，`linkedinContacted` 恒 `false`，禁自动 Connect/私信 ✅。**但"AI 破冰文案"实为静态模板**（`generateIcebreaker` 字符串拼接 name/headline/company），**非 LLM 生成**——宣传与实现落差。
- **沙箱隔离**：`session.fromPartition` 持久化分区（LinkedIn/Facebook/WhatsApp 各隔离）✅。
- **DNS 信誉盾**：真实 DNS 查询 MX/SPF/DKIM/DMARC/Spamhaus-ZEN，`critical`（黑名单/无 SPF）软锁定发送 ✅。**缺口**：DKIM 仅探测有限选择器列表 → 可能误报（代码已注释说明）。
- **抑制清单**：持久化、域名级、四类原因、真实接入发送门禁 ✅。
- **整体**：防封号体系**严谨、诚实、不夸大**，是本项目最可信的卖点之一。

---

## 三、核心缺口汇总（按商业影响排序）

| 排序 | 缺口 | 严重度 | 商业影响 |
|---|---|---|---|
| **1** | G1 差异化邮件未差异化（本地序列用通用模板） | 🔴 阻断 | 核心卖点落空，触达转化无差异化支撑 |
| **2** | G2 假高分漏洞（无 Eligibility Gate + includes 匹配 + 仅20/50 LLM） | 🔴 阻断 | "精准"承诺不成立，销售浪费精力 |
| **3** | G3 邮箱验证基础化（缺 disposable/role/catch-all/五级） | 🟠 高 | 第一触达通道质量把关不足 |
| **4** | G4 决策人数据零验证 | 🟠 高 | "决策人穿透"可信度低 |
| 5 | 跟进序列 IMAP 未配仍自动推进 | 🟡 中 | 可能重复触达已回复客户 |
| 6 | LinkedIn "AI 破冰文案"实为模板 | 🟡 中 | 宣传落差 |
| 7 | 前端无法区分确定性评分 vs LLM 评分 | 🟡 中 | 用户无法判断线索精度 |
| 8 | 差异化触达缺时区/泊松延时 | 🟡 中 | 送达体验与合规性 |
| 9 | 海关/展会数据为网页近似（非官方库） | 🟢 低 | 已诚实披露，仅需口径管控 |

---

## 四、优先级优化执行计划

> 原则：先闭环"精准 + 差异化"核心承诺（G1/G2/G3/G4），再做体验与覆盖增强。每项给出可执行的落地动作。

### 🔴 P0 — 商用阻断项（必须先闭环，约 8-12 人天）

**P0-1 · 差异化邮件触达闭环**（G1，最高优先）✅ 已落地 2026-09
- 落地动作：改造 `EmailAgent.executeSequence`，使其消费线索的 `analysisCache[scenario].emailSubject/emailBody` 或 `generatedStrategies`；当差异化内容缺失时，调用 LLM 以 `buildSearchScoringPrompt`/`buildAnalysisPrompt` 风格的 prompt 实时生成 150 词定制开发信（输入：公司网站文本+ICP+该阶段定位），而非硬编码模板。
- 4 阶段差异化：Stage0 首封（Hook+Bridge+Value+Soft CTA）→ Stage1 跟进（行业白皮书/痛点）→ Stage2 案例 → Stage3 Break-up。
- 验证：单测断言发送内容为动态生成且含公司特定信号；人工抽检 20 封去重率。

**P0-2 · Eligibility Gate 准入硬门**（G2，精准度命门）✅ 已落地 2026-09
- 落地动作：在 `computeScoutRelevance` 后、`computeIcpMatchScore` 前插入结构化 0/1 一票否决（对齐路线图 §0.5.1 Stage 0.5）：
  - 硬拒：B2C/Retail 终端、Repair/维修、Used/二手翻新、电商平台卖家（Amazon/eBay/AliExpress/Shopee）、纯博客/论坛/资讯、黑名单行业、制裁国、CRM 保护期内重复企业。
  - 命中即 `matchScore=0` 且 `riskFlags=['准入硬否决: 类目不匹配']`，不进 Agent 管道。
- 同步修正 `includes` 子串误伤：产品词匹配改为**词边界正则** `\bterm\b`，并纳入本地语言变体进 `coreProductTerms`。

**P0-3 · 邮箱验证增强到商用级**（G3）✅ 已落地 2026-09
- 落地动作：在 `verifyEmail` 中补齐：① 正则格式深度校验（RFC 5322 子集）；② disposable 域名黑名单（内置 + 可配置，可接 BlocklistDE/Dispo）；③ role-account 检测（`info/sales/support/contact/admin@` → `Risky`）；④ catch-all 探测（对 RCPT 250 的域名发一个明显不存在的 `verify_nonexist_${rand}@domain` 二次 RCPT）；⑤ Greylist（421/450 退避重试）。
- 输出五级：`Verified / Probable / Catch_all / Risky / Invalid`，写入 `LeadItem.verificationStatus`，前端展示。
- 仍保持 Premium 保护与串行执行。

**P0-4 · 决策人数据验证与可信度降级**（G4）✅ 已落地 2026-09
- 落地动作：① 对 AnySearch 决策人的 `email` 过 P0-3 邮箱验证，`phone` 做格式+E.164 规范化校验；② `confidenceScore` 缺省/低时前端视觉降级（灰色徽标 + "AI 推测，未验证"标注）；③ 验证通过的决策人才高亮进入"高价值推荐"。
- 对齐 `DecisionMaker.confidenceScore` 证据质量 A/B/C/D 分级（路线图 §六.4）。

### 🟠 P1 — 显著增值项（约 5-7 人天）

**P1-1 · LLM 评分全覆盖 50 条 + 置信标识** ✅ 已落地 2026-09
- 将 `SEARCH_LLM_SCORE_LIMIT` 与 `SEARCH_TARGETED_LEAD_LIMIT` 对齐（均 50），或在并发 2 约束下分两批；同时对前端线索卡增加 `确定性评分` vs `AI 评分` 的置信标识（对应 G2+缺口7）。

**P1-2 · LinkedIn AI 破冰文案真 LLM 化**（缺口6）✅ 已落地 2026-09
- `generateIcebreaker` 改为调用 LLM，输入 Profile 提取的 name/headline/industry + ICP + 知识库，输出 1-2 句个性化破冰文案，而非静态模板。

**P1-3 · 跟进序列 IMAP 依赖与"需人工确认"态**（缺口5）✅ 已落地 2026-09
- IMAP 未配置时序列不自动推进，`emailSequenceStage` 标记 `pending_manual`，前端提示"回复检测未启用，请手动确认后推进下一轮"。

**P1-4 · 冷邮件时区感知 + 泊松延时**（缺口8）✅ 已落地 2026-09
- EmailAgent 发送前读取目标客户时区（国家→IANA 时区映射），仅在 09:00-18:00 投递；轮次间隔叠加泊松随机抖动（±20%）。

### 🟡 P2 — 体验与覆盖增强（约 3-5 人天）

**P2-1 · 五级邮箱验证 UI 展示 + 差异化队列** ✅ 已落地 2026-09：Verified 优先主队列、Catch_all 限频靠内容、Risky 降权、Invalid 进抑制列表。

**P2-2 · 14 天全渠道协同触达节律**（路线图 §六.4）🟡 部分落地 2026-09（节律指引纯函数+阶段日志；统一编排器保留路线图）：Day0 商机卡 → Day1 邮件 → Day3-5 LinkedIn 同行交流（人工）→ Day7-10 Follow-up1 → Day12-14 Follow-up2，统一编排器。

**P2-3 · ICP 机会分 55/35/10 精细化**（Stage 2）✅ 已落地 2026-09：ICP Fit 55 + Intent(Why-Now) 35 + Evidence 10 − Risk Penalty，结构化输出，替换当前单一 `totalScore`。

**P2-4 · DNS DKIM 选择器可配置** ✅ 已落地 2026-09：允许用户配置其域名的 DKIM selector，避免有限列表误报。

### 🟢 P3 — 工程与质量

**P3-1 · Provider 专项单测** ✅ 已落地 2026-09（provider-isolation.business.test.js，4 项）。
**P3-2 · 多 Tab 并发时空隔离升级** ✅ 已落地 2026-09：`activeJobIds: Map<senderId, jobId>` + `isKnownActiveJobId()`，8 个 Provider 陈旧检查升级为任意活跃窗口匹配。
**P3-3 · 海关/展会数据置信标注 UI** ✅ 已核查补全 2026-09（data-center 覆盖面板增加口径说明行）。

---

## 五、结论与建议

1. **工程底座可信**：KONE 的治理纪律（宪法、双管道、隔离、熔断、Fail-Closed、真实 Agent 执行、反白嫖、防封号诚实边界）已达商用 SaaS 水准，可放心作为平台基座。
2. **"精准 + 差异化"核心承诺**：P0 四项（G1 差异化邮件 / G2 准入硬门 / G3 邮箱五级验证 / G4 决策人验证）是"是否满足专业严谨精准高效获客商用工具"的**判定点**。
   > ⚠️ **本节结论已过期（2026-10-07 回写）**：原文写于 P0 未完成时，但文件首部「执行状态更新 2026-09-03」已记录 **P0 四项全部落地**，故"尚未闭环"不再成立。
   > 对外口径现可主打"差异化智能触达"，但必须遵守 `PROVIDER-CAPABILITY.md` 的能力宣称约束（尤其海关/展会为网页近似、不得以官方数据库口径宣传）。
   > 原结论留档备查：*"完成 P0 前，建议对外口径聚焦'获客工作台/精准采集+本地重计算'，暂不主打'差异化智能触达'成品。"*
3. **诚实优于夸大**：项目已正确标注 WhatsApp 实验性·Beta、海关展会网页近似、LinkedIn 只读——这种诚实是商用长期主义的护城河，应继续保持，不应为"达标"而虚报路线图项。
4. **建议节奏**：P0（8-12 天）→ 灰度商用（主打精准采集+基础触达）→ P1/P2（10-12 天）→ 主打"差异化智能获客"全量商用。

---

## 六、工程细节补充发现（第二遍实证，低影响）

以下两处为第二轮深挖 `sandbox-service.ts` 时发现，不改变上述总体结论，仅作工程完善参考：

**E1 · 沙箱邮件账号健康检测为"假连接"**
- `performHealthCheck` 对 `email_smtp`/`email_imap` 类型（第 90 行 `else { entry.status = 'connected' }`）**无条件标 connected，未做真实 SMTP/IMAP 握手验证**。
- 影响：账号管理面板对邮箱可能显示虚假"已连接"，真实断连只在 EmailAgent 发信时才暴露。
- 处置：P3 级——可对邮箱类型补一次轻量 `verify()` 或接入 EmailAgent 的 connect 结果。

**E2 · 沙箱账号凭证明文驻内存、不持久化**
- `accounts` Map 中 `credentials` 字段以**明文**保存（第 118 行 `credentials: payload.credentials`），且不写入 config store——**重启即丢失**。
- 正面：`ACCOUNT.GET_LIST` 返回的 `sessionEntries` **不泄漏 credentials**（仅账号元信息），IPC 面安全 ✅。
- 负面：① 重启后需用户重新填凭证（体验降级）；② 运行期内凭证明文驻内存。
- 处置：P3 级——持久化时经 `secret-manager` 加密（EmailAgent 读取 smtpPass 已用加密路径，此处应统一）。

**E3 · 离线授权签名的规范化细节**
- `offline-license.ts` 用 `RSA-SHA256` 对 `JSON.stringify(claims)` 校验，公钥内嵌、私钥不入包 ✅。但规范化依赖 JS 对象属性插入顺序（此处来自解析，稳定）——若未来 claims 来源变多，建议改用排序后的 canonical JSON 以杜绝签名碰撞绕过风险。属防御性加固，P3 级。

> 以上 E1–E3 均为**体验/防御性加固项**，不影响"P0 四项为商用判定点"的核心判断。
