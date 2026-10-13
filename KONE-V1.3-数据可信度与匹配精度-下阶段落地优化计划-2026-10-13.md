# KONE V1.3 下阶段最佳落地优化计划 —— 数据可信度 · 匹配精度 · 策略质量

- **日期**：2026-10-13
- **角色视角**：产品定位 + 全栈架构 + 交付治理
- **定位基线（本计划的前提）**：Kone 是**专业严谨的 B2B 获客工作台**。
  核心价值 = **精准的客户匹配（ICP + 官网证据 + LLM 分析）** + **高转化的差异化话术与跟进策略** + **可控的本地/云端协同**。
  **联系方式只是其中一个环节，不是全部。**
- **唯一能力事实源**：`PROVIDER-CAPABILITY.md`；**宪法常量**见 `kone-PRD.md §零.3`。
- **本文件性质**：规划（Plan-First）。**除已标注的 P0 缺陷外，不直接改代码**；实施须逐阶段过门禁。

---

## 一页速览

| 序 | 主线 | 为什么是它 | 阶段 |
|---|---|---|---|
| **P0-1** | **修复 WhatsApp 管道门禁**（座机不入队） | 已发现真实缺陷：管道对任何电话都入队 WhatsApp，与自身 SSOT 矛盾 | S1 |
| **P0-2** | **数据可信度体系**（已验证 / 官网提取 / 模式推测 三档 + 来源标注 + 管道按档位放行） | 让「严谨」**可见、可控、不可滥用**；这是本阶段核心交付 | S2–S3 |
| **P1-1** | **匹配精度强化**（ICP 证据化评分 + 负向 ICP 生效 + 反馈回路） | 核心价值主线，投入产出比最高 | S4 |
| **P1-2** | **策略质量**（差异化首封 + 跟进序列 + 质量度量） | 同上，直接决定转化 | S5 |
| **P2** | **辅助路径**（模式推测 + 免费弱验证） | 仅作**补充候选**，强制标注、默认不自动使用 | S6 |

**明确不做**：用概率方法追赶付费数据源的覆盖率；把推测数据当核心卖点；为内部洁癖阻断交付。

---

## 二、现状事实（**实测数据**，非推测）

| 事实 | 证据 |
|---|---|
| 真实搜索（`golf cart dealer USA`，50 条，真实 SerpApi+LLM+Prospeo 密钥） | 电话 **98%** · 邮箱 **12%** · **WhatsApp 可触达 1–2%** · 联系人 22% |
| 搜索源（富化**前**） | 电话 **100%**（Google Maps，**以座机为主**）· 邮箱 **0%** |
| 免费官网深探（A/D 增强后） | 邮箱 0% → **12%**（`mailto:` / JSON-LD / 联系页 / 首页链接发现 / 403 简介挖掘） |
| 付费富化实测 | **Prospeo**：已验证邮箱 **1 credit** / 已验证手机 **10 credits**；**Apollo**：同源补全 |
| **已有但未贯通** | `emailGrade`（五级：verified/probable/catch_all/risky/invalid）、`phoneValid`、`confidenceScore` **只存在于 `DecisionMaker`**；**线索主 `email`/`phone` 无来源、无置信度** |
| **已发现缺陷** | `agent-pipeline.ts:133` `if (lead.phone) queue.whatsapp.push(task)` → **座机也入队 WhatsApp**（与 `phone-kind.ts` SSOT 矛盾） |
| 已修复（本会话） | 稀疏数组击穿 `new Map` 致整轮搜索中断；密钥不可解密致应用变砖；`%20` 未解码；结果区不显示邮箱 |
| 宪法稳定点 | 四级弹性搜索协议 · 并发 2/2/3 · 总量域预算 · Fail-Closed · 单源失败隔离 · 双管道回写 |

**结论**：**邮箱与手机号是结构性短板，且「已有搜索结果 + 官网提取」这条主路径尚未被产品化地表达出来**。
用概率方法追覆盖率会牺牲严谨性；正确做法是**把主路径做实 + 把可信度讲清楚**。

---

## 三、P0-1 修复 WhatsApp 管道门禁（**已发现真实缺陷**）

### 现状
```ts
// electron/services/agent-pipeline.ts:133
if (lead.phone) queue.whatsapp.push(task)   // ← 座机 / unknown 也会入队
```
- 而 `src/shared/phone-kind.ts`（双端 SSOT）明确：**座机无法使用 WhatsApp**；
- **UI 侧**（`leads-management.tsx`）已用 `classifyPhoneKind` 正确门禁 —— **UI 与管道口径不一致**。

### 影响
高级版自动巡航会对**座机线索**生成 WhatsApp 任务 → Agent 打开 `web.whatsapp.com/send?phone=<座机>` → 必然失败（浪费额度、污染运行日志、损害"专业"观感）。

### 修复
- **前置事实（已核实）**：`agent-pipeline` 的 lead 形参类型为
  `{ email?; phone?; linkedinUrl?; decisionMakers? }` —— **既无 `phoneKind` 也无 `countryCode`**，
  所以无法做号码类型判断。调用方 `search-service.ts:2212` 传的是 `targetedLeads`（`SearchExecuteResult`，**已含 `phoneKind`**）。
- **改法**：
  1. 扩展 `qualifiesForPipeline` / `buildAgentTaskQueue` 的 lead 形参类型，**补 `phoneKind?` 与 `countryCode?`**；
  2. 新增 `isWhatsAppReachable(lead)`：优先 `phoneKind === 'mobile'`；缺失时兜底 `canReachWhatsApp(phone, countryCode)`；
  3. 入队改为：`if (lead.phone && isWhatsAppReachable(lead)) queue.whatsapp.push(task)`。
- **源码守卫测试**：禁止 `agent-pipeline` 出现 `if (lead.phone) queue.whatsapp.push`（防回退）。

### 验收
单测（座机不入队 / mobile 入队 / unknown 不入队）+ 源码反例守卫。

---

## 四、P0-2 数据可信度体系（**本阶段核心交付**）

### 4.1 三档模型（与产品定义一致）

| 档位 | 定义 | 来源示例 | 默认行为 |
|---|---|---|---|
| **`verified` 已验证** | 第三方**验证过** | Prospeo `VERIFIED` 邮箱/手机、Apollo 已验证、SMTP/BOUNCEBAN 回执 | 默认可用于 Agent；**可直接展示** |
| **`extracted` 官网提取** | 从**官网原文**提取 | `mailto:` / `tel:` / JSON-LD / 联系页 / `wa.me` 直链 | 默认可用于 Agent；展示并标来源 |
| **`inferred` 模式推测** | **推断/猜测** | 邮箱模式（`first.last@domain`）、目录站/社交简介旁证 | **默认不自动发送**；仅作候选；**发送前二次确认** |

### 4.2 数据模型（最小侵入，单一结构化字段）

```ts
/* src/shared/ipc-contracts.ts + electron/services/search/types.ts（**两处镜像必须同步**） */
contactProvenance?: {
  email?:   { tier: 'verified' | 'extracted' | 'inferred'; source: string; grade?: string }
  phone?:   { tier: 'verified' | 'extracted' | 'inferred'; source: string; kind?: 'mobile' | 'landline' | 'unknown' }
  contact?: { tier: 'verified' | 'extracted' | 'inferred'; source: string }
}
```

- **兼容性**：可选字段；`applySchemaDefaults` 透传；缺失时前端**诚实降级为 `extracted` 且来源显示「未标注」**（**绝不谎报 `verified`** —— 与 `approval-grade.ts` 的既有诚实默认一脉相承）。
- **复用既有 SSOT，不造轮子**：`phoneKind`（已贯通）· `emailGrade`（`DecisionMaker` 已有五级）· `emailVerificationGrade`（审批单已有）。

### 4.3 产品呈现原则（用户明确要求）
1. **明确区分三档**：结果卡片 / 线索表在每个联系方式后跟**来源徽标**（已验证 / 官网 / 推测）；**推测用中性色**，不诱导。
2. **默认优先高置信度**：默认排序与筛选偏 `verified`/`extracted`；新增「仅看已验证 / 官网」筛选。
3. **用户有选择权**：`inferred` 结果**默认不勾选**，由用户显式启用。
4. **发送前二次提示**：目标是 `inferred` 时必须弹二次确认（含风险文案）。
5. **来源明细可见**：线索详情展示「来自哪个 URL / 哪个数据源」。

### 4.4 管道门禁（**关键，与 P0-1 合并落地**）

| 队列 | 入队条件 |
|---|---|
| WhatsApp | `phone.provenance.tier !== 'inferred'` **且** `phoneKind === 'mobile'` |
| Email | `verified` / `extracted` 自动入队；`inferred` **默认不入队**（或入「待确认」队列） |
| LinkedIn | 维持只读辅助（不得自动发送好友申请，见 `AGENTS.md`） |

### 4.5 验收
- 单测：三档入队规则（含座机不入 WhatsApp、`inferred` 不自动入队）。
- 真实搜索：卡片每个联系方式均有来源徽标；筛选可用。
- 反例守护：源码守卫禁止「无档位判断的直接入队」。

---

## 五、P1-1 匹配精度（核心价值主线）

1. **ICP 证据化评分**：`opportunityScore` 的四个维度（`icpFit` / `intent` / `evidence` / `riskPenalty`）**逐项绑定证据**（引用官网原文片段 / 搜索命中），使「为什么是 62 分」**可解释、可复核**。
2. **负向 ICP 真正生效**：`icpProfile.negativeIcp` 命中即**降权或剔除**（当前字段已存在，需验证是否参与评分与预筛）。
3. **用户反馈回路（本地、零成本）**：线索标「相关 / 不相关」→ 落库 → 作为下一轮排序信号；形成**越用越准**的闭环。
4. **预筛透明**：展示被剔除的候选与原因（当前只暴露总数）。

> 为什么优先做这个：**联系方式的缺失可以用流程弥补，匹配不准则一切归零。**

---

## 六、P1-2 策略质量

1. **差异化首封**：基于 deep probe 的 `outreachAngle` + ICP 证据生成**非模板**话术，要求**引用具体证据**（可自动校验引用率）。
2. **跟进序列**：首封 → 跟进 1 → 跟进 2 的节奏与触发条件（本地落库，云端协同可选）。
3. **质量度量**：首封「引用证据率」、人工抽检「可用率」。

---

## 七、P2 辅助路径（模式推测 + 免费弱验证）—— **严格边界**

| 允许 | 禁止 | 必须 |
|---|---|---|
| `first.last@domain` 等模式生成**候选** | **自动发送** | 标注 `inferred` |
| MX 记录存在性 + 一次性域名过滤 + 角色账号识别（`info@`）作为**免费弱验证** | 作为**核心卖点**或主要数据来源 | **默认不入 Agent 队列** |
| 目录站/社交简介**旁证** | 隐藏来源或过度依赖 | **发送前二次确认** |

**明确不做**：SMTP `RCPT TO` 探测（易被判定为滥用、导致 IP/域名进入黑名单，**得不偿失**）。

---

## 八、工作流（先匹配 → 再补全 → 人工确认）

```
① 搜索扇出（SerpApi maps/organic，受 SEARCH_VARIANT_LIMIT 约束）
② 预筛 + ICP 证据化评分（主路径：官网证据 + 搜索结果）      ← 价值重心
③ 首屏渐进式展示（emitBasicResults，待评估态）
④ 补全（分层，Fail-Closed）
     官网深探（免费，extracted） → Prospeo 邮箱（低成本，verified）
     → 按需 Prospeo/Apollo 手机（高成本，verified，仅高价值 + 缺手机）
⑤ 分层展示（verified / extracted / inferred）+ 来源标注
⑥ 人工确认（inferred 需二次确认；可批量勾选）
⑦ Agent 执行（仅 verified/extracted 自动；inferred 需确认）
```

---

## 九、分阶段落地（建议顺序）

| 阶段 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| **S1 (P0-1)** ✅ **已落地（2026-10-13）** | WhatsApp 管道门禁修复 | — | ✅ 座机不入队；源码守卫 + 行为契约测试（4 条，含变异验证） |
| **S2 (P0-2a)** ✅ **已落地（2026-10-13）** | 可信度模型（字段 + 两处镜像 + `applySchemaDefaults` 透传 + 徽标 + 筛选） | S1 | ✅ 三档可见；诚实降级（缺失不渲染） |
| **S3 (P0-2b)** ✅ **已落地（2026-10-13）** | 管道按档位入队 + 发送前二次确认 | S2 | ✅ `inferred` 不自动发送 + 唤起前确认对话框<br>⚠️ **当前不可感知**（生产代码无 `inferred` 数据，待 **S6** 激活）；**不得再扩张** |
| **S4 (P1-1)** ◐ **大部落地（S4a ✅ / S4c ✅）** | ICP 证据化 + 负向 ICP + 反馈回路 | S2 | ✅ 负向 ICP 护栏 + ✅ 反馈闭环；◻ 证据绑定(S4b) |
| **S5 (P1-2)** | 差异化首封 + 跟进序列 + 度量 | S4 | 首封引用证据率可测 |
| **S6 (P2)** | 辅助推测 + 免费弱验证 | S3 | 强制标注 + 不入队 |

### S1 落地记录（2026-10-13）

- `agent-pipeline.ts`：新增 `isWhatsAppReachable(lead)`（优先采信 `phoneKind`，缺失回退 `canReachWhatsApp`）；
  `buildAgentTaskQueue` 入队改为 `if (isWhatsAppReachable(lead)) queue.whatsapp.push(task)`；
  `qualifiesForPipeline` 的「可触达资产」**不再把座机算进来**。
- 形参类型补齐 `phoneKind?` / `countryCode?`（原类型缺失，无法做号码判定）。
- **同步修正 2 个 e2e 测试**（它们原先把「任意 phone → WhatsApp 任务」写成了期望行为）：
  `agent-pipeline-integration.test.js` / `gate-e2e.test.js`，并**新增座机反例**。
- 新增 `tests/business-logic/whatsapp-pipeline-gate.business.test.js`（源码守卫 + 行为契约 + 端到端，4 条，含变异验证）。
- 门禁：`test:unit` **489/489** · `typecheck` 0 · `verify:consistency` ✅。

### S2 落地记录（2026-10-13）
- 新增双端 SSOT `src/shared/contact-provenance.ts`：`ContactTier`（verified/extracted/inferred）、
  `ContactProvenance`、`CONTACT_TIER_LABEL`、`CONTACT_TIER_RANK`、`canAutoUseContact`、
  **`pickContactWithProvenance`（取值与来源同源）**。
- 类型贯通：`SearchExecuteResult`（两处镜像）+ `LeadSearchResult`/`LeadItem` + `applySchemaDefaults` 透传。
- 采集层产出：邮箱走同源助手（候选→Prospeo→Apollo→官网→提取）；电话 `pickBestPhoneForReach`
  返回 `{ phone, provenance }`（**优先手机与回退顺序均不变**）；联系人标 `extracted`。
- UI：结果卡片邮箱/电话渲染**来源徽标**（已验证/官网提取/推测，推测用**警示色**），tooltip 展示来源；
  **缺失档位不渲染**（宁可不标，不谎报 verified）。
- 新增 `tests/business-logic/contact-provenance.business.test.js`（8 条，含变异验证）。
- 门禁：`test:unit` **497/497** · `typecheck` 0 · `verify:consistency` ✅。

### S3 落地记录（2026-10-13）
- 双端 SSOT 新增 **`canAutoDispatch`**（放行语义：无标注按 `extracted`，**仅显式 `inferred` 拦下**）
  与 `requiresSendConfirmation`；并**明确区分** `canAutoUseContact`（严格，"能否宣称可信"）。
- `agent-pipeline.ts`：新增 `canAutoDispatchPhone` / `canAutoDispatchEmail`；
  WhatsApp 与 **Email 入队**均改为档位放行；`qualifiesForPipeline` 叠加档位口径。
- `leads-management.tsx`：WhatsApp 唤起前，若号码为 `inferred` → 弹**二次确认对话框**（号码 + 来源 + 风险文案）。
- 门禁：`test:unit` **504/504** · `typecheck` 0 · `verify:consistency` ✅。
- **P0「数据可信度体系」闭环**（模型 → 展示 → 放行 → 确认）。

### S4a 落地记录（2026-10-13）：负向 ICP 确定性护栏
- 侦察发现：`negativeIcp` **只进了 LLM prompt**（软约束）；`scout.ts` 只有**硬编码通用**负向词，与用户配置无关。
- 新增纯函数（`search/scoring.ts`）：`parseNegativeIcpTerms` / `matchNegativeIcp` / `applyNegativeIcpPenalty`；
  命中即**封顶** `matchScore` 到 `NEGATIVE_ICP_SCORE_CAP = 20`（低于管道门槛 60）+ 写入**可解释** `riskFlags`。
- 接线两处：排序/预筛前（`guardedMergedLeads`）+ **最终结果安全网**（防 LLM 忽略 prompt）。
- **设计取舍**：用「封顶降权」而非「直接剔除」—— 负向词是自由文本，误伤风险不可忽略；封顶让线索仍可见（透明可复核），
  但跨不过 60 分门槛。
- 门禁：`test:unit` **512/512** · `typecheck` 0 · `verify:consistency` ✅（含变异验证）。
- **S4 余下**：S4b 评分**证据绑定**（现有数字拆解缺证据）、S4c **用户反馈回路**（完全缺失）。

### S4c 落地记录（2026-10-13）：用户反馈闭环
- 新增双端 SSOT `src/shared/lead-feedback.ts`：`deriveFeedbackKey`（域名优先）/ `applyFeedbackAdjustment`
  （不相关→**封顶 20**；相关→**+5**；未标记→零副作用；可解释信息**前置**插入防被 `slice(0,1)` 丢弃）。
- 渲染层 `src/lib/lead-feedback-store.ts`：存 `user_config.leadFeedback`，**复用既有配置通道**（不新增 IPC）；
  **整表读-改-写**（域名含点，逐键点号路径会被误拆）。
- 搜索链路**两处**接线（排序/预筛前 + 最终结果安全网）→ 下一轮即按反馈调整排序。
- UI：结果卡片新增 **「相关 / 不相关」** 标记（**可撤销**），失败明确提示。
- 门禁：`test:unit` **520/520** · `typecheck` 0 · `verify:consistency` ✅（含变异验证）。
- **S4 余下**：仅 **S4b 评分证据绑定**。

---

## 十、红线（**不得破坏**）

四级弹性搜索协议 · `SEARCH_ENRICH_CONCURRENCY = 2` 与扇出并发 3（**不同维度，不得混读**）· 总量域预算（`ENRICH_LOOKUP_BUDGET` / `PROSPEO_*_BUDGET`）· Fail-Closed · 单源失败隔离 · 双管道回写（`agentStatus` + `AgentState`）· `SECRET` 通道无 `GET` · Provider 只采集不写库。

---

## 十一、度量（可验证，不靠感觉）

| 指标 | 目标 |
|---|---|
| 匹配精度（人工抽检相关率，每周 30 条） | 持续上升 |
| 联系方式可信度分布 | `inferred` 占比 **< 20%**，且**从不自动发送** |
| 首封「引用证据率」 | 持续上升 |
| 每轮成本（SerpApi / LLM / Prospeo credits） | 有硬顶，可预测 |
| 门禁 | `test:unit` / `typecheck` / `verify:consistency` 全绿 |

---

## 十二、明确不做（防止过度工程化）

1. **不用概率方法追赶付费数据源覆盖率** —— 不专业，且伤害信任。
2. **不把推测数据当核心卖点或主要来源**。
3. **不为内部工程洁癖（lint 警告 / 命名 / 类型 SSOT）阻断交付**。
4. **不做 SMTP 探测**（合规风险）。
5. **不隐藏来源**、不虚标 `verified`。

---

## 附：与既有文档的关系

- 能力口径：`PROVIDER-CAPABILITY.md`（本计划不得与之冲突）。
- 宪法常量：`kone-PRD.md §零.3`。
- 云端投递：`CLOUD-COLLABORATION-DELIVERY.md`（S3 的"发送前确认"须与其审批语义对齐）。
- 前序计划：`KONE-V1.3-数据源与联系人获取-全局梳理与优化计划-2026-10-12.md`（本计划是其**定位校准后的下一阶段**）。
