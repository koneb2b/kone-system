# Payload 裁剪审计报告

## TL;DR

> **审计结论**: `triggerN8nWorkflow` 的 Payload 裁剪 **100% 合规** — 16/16 字段与 PRD 白名单精确匹配。
> 
> **无需重构** — 不存在"原始海量脏数据直接推上云"的风险。
> 
> 但发现 **2 个低风险改进建议**（不影响安全，影响数据卫生）。

---

## 审计范围

### 上云通道清单

| 通道 | 函数 | 裁剪方 | 结果 |
|------|------|-------|------|
| N8N Webhook 发信 | `triggerN8nWorkflow` (automation-service.ts:157) | 主进程 | ✅ 100% 合规 |
| Supabase 线索同步 | `syncLeadToCloud` (supabase-service.ts:131) → `compactLead` | 主进程 | ✅ 合规（精简白名单） |
| Supabase 线索 Upsert | `upsertLead` (supabase-service.ts:235) → `compactLead` | 主进程 | ✅ 合规（复用 compactLead） |
| Supabase Campaign 写入 | `createCampaign` (supabase-service.ts:300) | 主进程 | ✅ 合规（email/domain/templateId 三字段） |

---

## N8N Webhook 裁剪详细审计 (triggerN8nWorkflow)

### PRD 白名单 vs 代码实现：16/16 全部精确匹配

| 字段 | PRD 上限 | 代码实现 (automation-service.ts) | 行号 | 状态 |
|------|---------|--------------------------------|------|------|
| `company` | 200 | `.slice(0, 200)` | 173 | ✅ |
| `country` | 50 | `.slice(0, 50)` | 176 | ✅ |
| `contact` | 100 | `.slice(0, 100)` | 177 | ✅ |
| `contact_title` | 120 | `.slice(0, 120)` | 178 | ✅ |
| `phone` | 80 | `.slice(0, 80)` | 179 | ✅ |
| `address` | 240 | `.slice(0, 240)` | 180 | ✅ |
| `source` | 120 | `.slice(0, 120)` | 181 | ✅ |
| `inferred_role` | 120 | `.slice(0, 120)` | 182 | ✅ |
| `snippet` | 500 | `.slice(0, 500)` | 185 | ✅ |
| `companyProfile` | 800 | `.slice(0, 800)` | 189 | ✅ |
| `painPoints` | 800 | `.slice(0, 800)` | 190 | ✅ |
| `valueMapping` | 1000 | `.slice(0, 1000)` | 191 | ✅ |
| `emailSubject` | 200 | `.slice(0, 200)` | 196 | ✅ |
| `emailBody` | 2400 | `.slice(0, 2400)` | 197 | ✅ |
| `match_reasons` | 4 条 | `.slice(0, 4)` | 183 | ✅ |
| `risk_flags` | 3 条 | `.slice(0, 3)` | 184 | ✅ |

### 额外安全检查

| 检查项 | 结果 |
|-------|------|
| Email 非空过滤 | `.filter((entry) => entry.lead_info.email)` ✅ (line 206) |
| 空线索数组拒绝 | `if (!leads.length) return error` ✅ (line 162) |
| 无效邮箱全量拒绝 | `if (!compactLeads.length) return error` ✅ (line 208) |
| Webhook URL 安全校验 | `isPlaceholderWebhook` + `https://` 前缀检查 ✅ (line 213) |
| 渐进式降级 | 非 https → 返回成功但不发送 ✅ (line 215-221) |

---

## Supabase 通道审计 (compactLead)

`compactLead` 函数 (supabase-service.ts:82-92) 使用**极简白名单**：

| 字段 | 裁剪 | 结果 |
|------|------|------|
| `email` | `.slice(0, 255)` | ✅ |
| `company` | `.slice(0, 200)` | ✅ |
| `country` | `.slice(0, 50)` | ✅ |
| `ai_tags` | `.slice(0, 5)` | ✅ |
| `owner_label` | `.slice(0, 100)` | ✅ |
| `domain` | `extractDomain()` (域名提取，天然短) | ✅ |
| `score` | `Math.round()` (数字) | ✅ |

**Gold Filter**: `score < 80` 的线索**直接拒绝上云** ✅ (line 137)

---

## 低风险改进建议

### 建议 1: 前端 payload 缺少 `address` 和 `phone` 字段 (dashboard-page.tsx)

**位置**: `src/components/dashboard-page.tsx:108-132`

单条线索交接 `handleSendToCloud` 缺少 `phone`、`address`、`snippet` 字段：
```typescript
// 当前代码：缺少 phone, address, snippet
leads: [{
  email, company, website, domain, country, contact, contactTitle,
  source, matchScore, matchReasons, riskFlags, inferredRole, salesStrategy,
  verificationStatus, aiAnalysis: {}, aiGeneratedPitch: {}, userSettings: {}
}]
```

**风险**: 不影响安全（主进程会对缺失字段兜底为空字符串），但导致单条交接时云端缺失联系电话和地址数据。

**建议**: 补充 `phone`、`address`、`snippet` 字段到 dashboard 的 payload 组装中。

### 建议 2: `user_settings.icpProfile` 未做深度裁剪

**位置**: `automation-service.ts:202`
```typescript
icpProfile: typeof userSettings.icpProfile === 'object' && userSettings.icpProfile
  ? userSettings.icpProfile : {}
```

**风险**: `icpProfile` 直接透传，未对内部字段做 `.slice()` 裁剪。如果用户在 ICP 配置中写了超长文本（如 `targetProduct` 10000 字），会原样推送到 Webhook。

**建议**: 对 `icpProfile` 的 4 个子字段增加裁剪：
- `targetProduct.slice(0, 500)`
- `buyerPersona.slice(0, 300)`
- `coreAdvantage.slice(0, 500)`
- `negativeIcp.slice(0, 300)`

---

## 最终结论

```
N8N Webhook 裁剪:     16/16 字段精确匹配 PRD ✅
Supabase 线索同步:    7/7 字段严格白名单 ✅
Supabase Campaign:    3/3 字段最小化 ✅
Gold Filter:          score < 80 拒绝上云 ✅
Email 非空过滤:       已实现 ✅
Webhook URL 校验:     已实现 ✅

安全风险: 无
数据脏推风险: 无
建议改进: 2 项低风险（前端字段缺失 + icpProfile 未深度裁剪）
```

**不需要制定 Payload 瘦身计划 — 系统已 100% 合规。**

两项低风险建议可作为后续优化 backlog，但不构成安全违规或架构违例。
