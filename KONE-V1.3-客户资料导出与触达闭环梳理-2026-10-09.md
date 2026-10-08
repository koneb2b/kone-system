# KONE V1.3 · 客户资料导出与触达闭环 全面梳理

> 日期：2026-10-09 ｜ 触发：用户反馈「下载端样式和数据都不完善，缺少精细化客户核心资料（尤其核心关键人）」
> 目标：让导出的客户资料能直接喂给高级版 WhatsApp / 邮件自动化，形成 CRM 跟进触达闭环
> 方法：数据链路逐段取证（`文件:行号`）→ 对照用户期望 → 标注**真实可得性** → 修复可修项

---

## 〇、结论摘要

| 项 | 结论 |
|---|---|
| **导出缺决策人** | 🔴 已修：CSV 从 8 列 → 26 列，补齐决策人 3 槽位 |
| **决策人字段被丢弃** | 🔴 已修：`emailGrade` / `phoneValid` 映射时静默丢失 |
| **两个导出入口列不一致** | 🟡 待统一（`leads-table` 8 列 vs `leads-management` 14 列） |
| **数据可得性** | ⚠️ 见第三节 —— email / phone / 决策人**并非都有**，取决于数据源 |
| **触达闭环** | ✅ 链路本身是通的（Agent 入队条件明确），前提是字段齐全 |

---

## 一、数据链路全貌（4 段）

```
① 采集          ② 存储              ③ 导出              ④ 触达
Provider   →   LeadItem          →  CSV / PDF      →  Agent 队列
```

### ① 采集：各 Provider 实际产出哪些字段

| Provider | company | website | phone | email | decisionMakers | 其他 |
|---|---|---|---|---|---|---|
| `google_maps` | ✅ | ✅ | ✅(常空) | ❌ | ❌ | address / snippet |
| `google_organic` | ✅ | ✅ | ✅(常空) | ❌ | ❌ | address / snippet |
| `linkedin_search` | ✅ | ✅ | ✅ | ❌(恒 `''`) | ✅ | contact / contactTitle |
| `facebook_search` | ✅ | ✅ | ✅ | ❌ | ❌ | address / snippet |
| `customs_shipment` | ✅ | ✅ | ✅ | ❌ | ❌ | `customsData` |
| `trade_show` | ✅ | ✅ | ✅ | ❌ | ❌ | `exhibitionFootprints` |
| `anysearch` | ✅ | ✅ | ✅ | ✅(决策人) | ✅ | customsData / exhibition |
| `yellow_pages` | — | — | — | — | — | **已弃用，返回空** |

> **关键事实**：**决策人仅 `linkedin_search` 与 `anysearch` 会注入**
> （`search-service.ts:1910-1911`）。其余源不产出决策人。

### ② 存储：字段是否被完整保留

- `LeadItem` 字段齐全（含 `decisionMakers` / `emailGrade` / `phoneValid` 的类型定义）
- 🔴 **但 `normalizeDecisionMakers` 未映射 `emailGrade` / `phoneValid`** → 静默丢失（**已修**）
- 🟡 `city` / `isB2B` / `dataSourceNote` 未从 `SearchExecuteResult` 映射到 `LeadItem`

### ③ 导出：当前 vs 期望

| 用户期望 | 修复前 CSV | 修复后 CSV | 数据可得性 |
|---|---|---|---|
| 公司名 | ✅ | ✅ | 可得 |
| 邮箱 | ✅ | ✅ | **部分**（官网深探 / AnySearch 决策人） |
| 电话 | ✅ | ✅ | **部分**（字段在但常空） |
| 国家 | ❌ | ✅ | 可得 |
| **决策人-姓名** | ❌ | ✅ | **部分**（仅 linkedin / anysearch） |
| **决策人-职位** | ❌ | ✅ | **部分** |
| **决策人-邮箱** | ❌ | ✅ | **部分**（仅 anysearch 非空） |
| **决策人-电话** | ❌ | ✅ | **部分** |
| **邮箱验证等级** | ❌ | ✅ | 部分（采集层仅 risky/invalid） |
| 数据来源 | ❌ | ✅ | 可得 |

### ④ 触达：Agent 消费哪些字段

| Agent | 消费字段 | 入队条件 |
|---|---|---|
| WhatsApp 拓客猎手 | `task.phone` | 有 phone |
| 邮件长效跟随助理 | `task.email` | 有 email |
| LinkedIn 商务猎手 | `task.linkedinUrl` | 有 linkedinUrl |

**统一前置**（`agent-pipeline.ts:65-72`）：`matchScore ≥ 60` 且**有任一联系方式**；
**缺对应字段则不入队**（`:133-135`）。

---

## 二、发现的缺陷（2 个已修 + 1 个待定）

### 🔴 缺陷 1：CSV 导出完全不含决策人（已修）
`leads-table.tsx` 导出仅 8 列，**决策人只在 PDF 里有**。
而决策人层级的数据往往**比顶层更准**（顶层 `email` 常为空，决策人 `email` 才可用）。
→ 已扩展为 26 列，决策人固定 3 槽位展开（姓名·职位·邮箱·邮箱等级·电话）。

### 🔴 缺陷 2：决策人字段映射时被静默丢弃（已修）
`lead-mappers.ts` 的 `normalizeDecisionMakers` 未赋值 `emailGrade` / `phoneValid`，
而 `DecisionMaker` 类型本就包含它们、采集层 `contact-validation.ts` 也已生成。
→ 后果：导出与 Agent 都拿不到「这个邮箱/电话可信吗」的依据。
→ 已补回（含类型校验）。

### 🟡 缺陷 3：两个导出入口列不一致（待统一）
| 入口 | 列数 |
|---|---|
| `leads-table.tsx`（线索表「导出」） | 原 8 列 → 现 26 列 |
| `leads-management.tsx`（线索管理「导出」） | 14 列 |
| `data-center.tsx`（数据中心） | 另一套 |

**同一份数据、三个入口、三套列** —— 用户从不同入口导出会得到不同结果。
建议**抽取共享的导出列构造器**（与 [1.4.2] 的能力集 SSOT 同思路）。

---

## 三、数据可得性（诚实说明，不夸大）

**必须明确**：以下字段**不是每条线索都有**，这是数据源的真实边界：

| 字段 | 真实来源 | 覆盖率 |
|---|---|---|
| `email`（顶层） | 官网深探（`search-service.ts:1023`） | 部分 |
| `email`（决策人） | 仅 `anysearch` | 少量 |
| `phone` | 多数 provider 有字段，但**常为空** | 部分 |
| `decisionMakers` | 仅 `linkedin_search` / `anysearch` | 少量 |
| `emailGrade` | 采集层仅得 `risky` / `invalid`；深度验证需 `automation:verify-emails` | 部分 |

> **对客口径建议**：导出界面应明确标注「部分字段依赖数据源，可能为空」，
> 避免用户误以为"导出了就都有"。这符合 `PROVIDER-CAPABILITY.md` 的诚实口径要求。

---

## 四、触达闭环：现状与缺口

### 现状（链路是通的）

```
线索(matchScore≥60 + 有联系方式)
   ↓ buildAgentTaskQueue
AgentTask { phone?, email?, linkedinUrl? }
   ↓ 缺对应字段则不入队
WhatsApp Agent / Email Agent / LinkedIn Agent
   ↓ writeBackAgentStatus（双管道回写）
agentStatus（持久化）+ AgentState（运行时）
```

**闭环的关键前提**：**线索上必须有 `phone` / `email` / `linkedinUrl`**。

### 缺口

| # | 缺口 | 影响 |
|---|---|---|
| 1 | 导出资料与 Agent 队列**无显式关联** | 用户导出后无法知道"哪些能触达、哪些不能" |
| 2 | 缺少「可触达性」标识 | 用户看不到某条线索**是否满足入队条件** |
| 3 | 邮箱验证需手动触发 | `automation:verify-emails` 未被导出流程调用 |

**建议**（供决策，未实施）：
- 导出增加「**可触达渠道**」列（如 `WhatsApp/Email/LinkedIn` 或 `—`），
  让用户一眼看出哪些线索能进自动化、哪些需要补数据
- 或在导出时提供「**仅导出可触达线索**」筛选

---

## 五、后续建议（按优先级）

| # | 建议 | 价值 | 成本 |
|---|---|---|---|
| 1 | **统一三个导出入口的列**（抽共享构造器） | 消除"同数据不同结果"的困惑 | 中 |
| 2 | **导出增加「可触达渠道」列** | 直接支撑闭环决策 | 低 |
| 3 | 导出时可选字段/格式（当前固定列、无 UI） | 精细化诉求的完整回应 | 中 |
| 4 | 导出界面标注「部分字段依赖数据源」 | 诚实口径，管理预期 | 低 |
| 5 | 决策人槽位可配置（当前固定 3） | 适配不同场景 | 低 |

---

## 六、本次改动

| 文件 | 改动 |
|---|---|
| `src/components/leads-table.tsx` | CSV 导出 8 列 → 26 列（新增国家 / 邮箱等级 / 决策人 3 槽位 / 数据来源） |
| `src/lib/lead-mappers.ts` | `normalizeDecisionMakers` 补回 `emailGrade` / `phoneValid` |

**验证**：typecheck(src) 0 error；单测 **326/326** ｜ 提交 `62edc69`
