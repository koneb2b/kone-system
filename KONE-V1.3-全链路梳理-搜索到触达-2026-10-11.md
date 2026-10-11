# KONE 全链路梳理：搜索 → 记录标注 → 资料导出 → 客户触达

> 日期：2026-10-11 ｜ 触发：用户要求「全面提升从搜索到记录标注触达的完整链路体验」
> 依据：`kone-PRD.md`（产品真相）、`AGENTS.md`（宪法）、代码实读

---

## 一、链路全景与现状（代码证据）

| # | 环节 | 实现位置 | 状态 |
|---|---|---|---|
| 1 | **搜索获客** | `electron/services/search-service.ts` + 7 Provider | ✅ 正常 |
| 2 | **AI 分析/检查** | `src/components/analysis-drawer.tsx` | ✅ 正常（Trial 锁定，属预期） |
| 3 | **入库（CMS）** | `src/store/leads-store.ts`（`status: new → saved`） | ✅ 正常 |
| 4 | **导出 CSV** | `src/lib/lead-export.ts`（5 字段组共享构造器） | ⚠️ **缺「地址」** |
| 5 | **导出白皮书 PDF** | `electron/services/export-service.ts`（精美 HTML → PDF） | ⚠️ **缺「地址」** |
| 6 | **触达 · 邮件** | `leads-management.tsx:655 handleLaunchMailClient`（`mailto:`） | ✅ 有（含长度校验） |
| 7 | **触达 · WhatsApp** | —— | ❌ **完全没有** |

---

## 二、缺口清单（按严重度）

### 🔴 缺口 1：地址（店址）**数据有、导不出**

**证据**：
- 数据层**有** `LeadItem.address?: string`（`leads-store.ts:83`）
- 决策人也有 `address?`（`leads-store.ts:131`）
- 但 `lead-export.ts` 的 5 个字段组（`core`/`contact`/`reachability`/`decisionMakers`/`trailing`）
  **均不含 address**
- 白皮书 `buildPdfHtml`（`export-service.ts:44`）的入参也**不含 address**

**后果**：用户在 UI 上能看到地址，**导出后地址消失** —— 与用户明确要求的
「店址」字段直接冲突。这是**数据链路断裂**，不是样式问题。

### 🔴 缺口 2：WhatsApp 无直连入口

**证据**：全仓 `grep 'wa\.me'` **零命中**；只有 `mailto:`（`leads-management.tsx:667`）。

**后果**：用户明确要求「手机号可以直接通过高级版本做直接触达，whatsapp」——
当前**无法从线索一键唤起 WhatsApp 对话**，只能手工复制号码。

**注意**：`AGENTS.md`「Agent 类型与能力矩阵」中 WhatsApp 有两条路径：
- **Basic**：Puppeteer + Web WA DOM 自动化（实验性 Beta）
- **Premium**：WhatsApp Cloud API
两者都是**自动化发送**；而用户此处要的是**人工一键触达**（`wa.me` 唤起），
**两者不冲突、可并存** —— `wa.me` 是「人点了才发」，不涉及自动化风控。

### 🟡 缺口 3：「客户类型」语义未定义

用户要求导出「客户类型」。当前相关字段只有 `industry`（行业）。
**需澄清**：用户要的是「行业」还是「客户角色/类型」（如 分销商/批发商/终端）？
搜索侧 `B2B_ROLE_TERMS`（dealer/distributor/importer/wholesaler…）
以及 `inferredRole` 字段**已经产出角色信息**，但**未进入导出列**。

---

## 三、修复方案

### 方案 A：补齐地址（数据链路修复）

| 文件 | 改动 |
|---|---|
| `src/lib/lead-export.ts` | `core` 组表头加「地址」；行构造读 `lead.address` |
| `electron/services/export-service.ts` | `buildPdfHtml` 入参加 `address`，模板中渲染 |
| `src/components/leads-management.tsx` | 导出调用处透传 `address` |

**兼容性**：`address` 为可选字段，缺失留空字符串（与现有「缺失统一留空」口径一致）。
**注意**：`lead-export.ts` 被单测直接加载，改表头需同步
`tests/business-logic/lead-export-*.test.js` 的列断言。

### 方案 B：补 WhatsApp 一键触达（人工路径，非自动化）

| 文件 | 改动 |
|---|---|
| `leads-management.tsx` | 新增 `handleLaunchWhatsApp`：由 `phone` 归一化为 E.164 → `https://wa.me/<digits>?text=<预填文案>` → `shell.openExternal` |
| 入口 | 与「唤起本地邮箱」并列，仅当 `phone` 存在时可用 |
| 门禁 | 按 `AGENTS.md`：WhatsApp 属高级能力 → 走 `featureGate.canAccess('local_autopilot')` 或对应能力集；Trial 显示升级引导 |

**风险控制**：
- **仅唤起，不自动发送** —— 用户仍需在 WhatsApp 里手动点发送，**不触碰风控红线**
- 号码归一化失败（非手机号/缺国家码）时**明确提示**，不静默失败

### 方案 C：客户类型

**先向用户澄清语义**，再决定：
- 若是「行业」→ 已导出（`industry`）
- 若是「角色/类型」→ 把 `inferredRole` 补进导出列

---

## 四、关于「不过度平衡」的校准（回应本轮反馈）

用户明确指出：**不能为省配额牺牲搜索数量与覆盖深度**。

因此对上一轮 `SEARCH_VARIANT_LIMIT = 8` 做**重新评估**：

| 项 | 当前 | 建议 |
|---|---|---|
| `SEARCH_VARIANT_LIMIT` | 8 | **放宽到 12-16**（保留更多本地语言变体） |
| `SEARCH_PRODUCT_TERM_LIMIT` | 2 | 保持 2（多产品场景够用） |
| **产品词清洗** | 已实现 | **保留**（剔除中文/控制词是纯收益，不损失覆盖） |

**原则**：**砍「垃圾变体」（清洗）保留，砍「有效变体」（总量上限）放宽。**
成本控制应优先靠**清洗**与**缓存复用**，而非压低覆盖。

---

## 五、验证计划

1. `npm run typecheck`（双侧）
2. `npm run test:unit`（407 条，含导出列断言）
3. `npm run verify:consistency`
4. 打包版实测：导出 CSV 含地址 / 白皮书含地址 / WhatsApp 按钮可唤起
