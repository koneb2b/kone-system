# N8N 接口对齐修复计划（零隐患版）

## TL;DR

> **目标**: 在 N8N 云端服务部署前，将 Kone 项目端的所有上云 Payload 路径与 PRD 白名单完全对齐，消除所有字段缺失、截断缺失、类型不一致问题，确保 N8N 上线后接口即刻可用。
>
> **Deliverables**:
> - `electron/services/automation-service.ts` — `icpProfile` 子字段裁剪
> - `src/components/dashboard-page.tsx` — 补全缺失字段 + 读取 AI 分析数据
> - `src/components/automation-workflow.tsx` — 清理白名单外字段
> - 全量测试通过（21/21）
>
> **Estimated Effort**: Medium（3 个文件，30 行内变更）
> **Parallel Execution**: NO — 顺序（存在前后依赖）
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4

---

## 审计背景

PRD §3.4.3 规定的 Webhook Payload 白名单：

```
lead_info:
  email, company, domain, website, country, contact, contact_title,
  phone, address, source, inferred_role, match_reasons, risk_flags, snippet
icp_match_score
ai_analysis: { companyProfile, painPoints, valueMapping, confidence, source }
ai_generated_pitch: { emailSubject, emailBody }
user_settings: { templateId, selectedModel, icpProfile }
verification_status
```

裁剪上限：
- company ≤ 200 / country ≤ 50 / contact ≤ 100 / contact_title ≤ 120
- phone ≤ 80 / address ≤ 240 / source ≤ 120 / inferred_role ≤ 120
- snippet ≤ 500 / companyProfile ≤ 800 / painPoints ≤ 800
- valueMapping ≤ 1000 / emailSubject ≤ 200 / emailBody ≤ 2400
- match_reasons ≤ 4 条 / risk_flags ≤ 3 条
- icpProfile 子字段（PRD 未给上限，但需要保护）

---

## 发现的全部隐患

### 隐患 1: icpProfile 子字段无截断（主进程） 🔴 高优先级

**位置**: `electron/services/automation-service.ts:202`

**现状**:
```typescript
icpProfile: typeof userSettings.icpProfile === 'object' && userSettings.icpProfile
  ? userSettings.icpProfile   // ← 整体透传，无任何 slice
  : {},
```

**问题**: `IcpProfile` 的 4 个字段（`targetProduct`、`buyerPersona`、`coreAdvantage`、`negativeIcp`）均为自由文本，无 UI 级 `maxLength` 约束。用户可以输入任意长度的文本，原样推送至 N8N Webhook。

**后果**: N8N 接收到超大 JSON 节点可能导致工作流节点解析异常，或 HTTP Body 超出 Webhook 服务器限制。

**修复**:
```typescript
user_settings: {
  templateId: String(userSettings.templateId || templateId || 'default').trim(),
  selectedModel: String(userSettings.selectedModel || '').trim().slice(0, 120),
  icpProfile: (() => {
    const icp = typeof userSettings.icpProfile === 'object' && userSettings.icpProfile
      ? userSettings.icpProfile as Record<string, unknown>
      : {}
    return {
      targetProduct: String(icp.targetProduct || '').trim().slice(0, 500),
      buyerPersona: String(icp.buyerPersona || '').trim().slice(0, 100),
      coreAdvantage: String(icp.coreAdvantage || '').trim().slice(0, 500),
      negativeIcp: String(icp.negativeIcp || '').trim().slice(0, 300),
    }
  })(),
},
```

---

### 隐患 2: dashboard 单条交接缺少 phone/address/snippet（前端） 🔴 高优先级

**位置**: `src/components/dashboard-page.tsx:108-132`

**现状**:
```typescript
leads: [{
  email, company, website, domain, country, contact, contactTitle,
  source, matchScore, matchReasons, riskFlags, inferredRole, salesStrategy,
  verificationStatus, aiAnalysis: {}, aiGeneratedPitch: {}, userSettings: {}
  // ← 缺少: phone, address, snippet
  // ← aiAnalysis/aiGeneratedPitch 硬编码空对象
}]
```

**问题**:
1. N8N 收到 `lead_info.phone = ""`、`lead_info.address = ""`、`lead_info.snippet = ""` — 若 N8N 模板依赖这些字段做联系方式解析，会静默空值
2. `aiAnalysis: {}`、`aiGeneratedPitch: {}` 硬编码空对象 — N8N 模板若依赖 `ai_analysis.emailBody` 生成邮件正文，会收到空字符串
3. `salesStrategy` 不在 PRD 白名单内，多余透传（主进程丢弃，但语义不清）

**修复**:
```typescript
const handleSendToCloud = async (lead: LeadItem) => {
  // 从 analysisCache 提取最佳分析结果（与 automation-workflow.tsx 保持一致）
  const analysisCache = typeof lead.analysisCache === 'object' && lead.analysisCache
    ? lead.analysisCache as Record<string, any>
    : {}
  const bestAnalysis = analysisCache.direct_quote
    || analysisCache.competitor_switch
    || analysisCache.factory_strength
    || {}

  const response = await startCampaign({
    templateId: "single_lead_handoff",
    leads: [{
      email: lead.email || "",
      company: lead.company,
      website: lead.website || "",
      domain: lead.website || "",
      country: lead.country || "",
      contact: lead.contact || "",
      contactTitle: lead.contactTitle || lead.inferredRole || "",
      phone: lead.phone || "",        // ← 新增
      address: lead.address || "",    // ← 新增
      source: lead.source || "",
      matchScore: typeof lead.matchScore === "number" ? lead.matchScore : undefined,
      matchReasons: lead.matchReasons || [],
      riskFlags: lead.riskFlags || [],
      inferredRole: lead.inferredRole || "",
      snippet: lead.snippet || "",    // ← 新增
      verificationStatus: "unverified",
      aiAnalysis: {                   // ← 替换硬编码空对象
        companyProfile: String(bestAnalysis.companyProfile || "").trim(),
        painPoints: String(bestAnalysis.painPoints || "").trim(),
        valueMapping: String(bestAnalysis.valueMapping || "").trim(),
        confidence: typeof bestAnalysis.confidence === "number" ? bestAnalysis.confidence : undefined,
        source: String(bestAnalysis.source || "").trim(),
      },
      aiGeneratedPitch: {             // ← 替换硬编码空对象
        emailSubject: String(bestAnalysis.emailSubject || "").trim(),
        emailBody: String(bestAnalysis.emailBody || "").trim(),
      },
      userSettings: {},
      // ← 移除: salesStrategy（不在 PRD 白名单）
    }],
  })
  // ...其余逻辑不变
}
```

---

### 隐患 3: automation-workflow 前端 salesStrategy 透传（不在白名单） 🟡 中优先级

**位置**: `src/components/automation-workflow.tsx:142`

**现状**:
```typescript
salesStrategy: String(lead.salesStrategy || "").trim(),  // ← 主进程丢弃，N8N 永远收不到
```

**问题**: `salesStrategy` 不在 PRD 的 `lead_info` 白名单内。主进程 `triggerN8nWorkflow` 不会把它放进 `compactLeads`，所以 N8N 永远收不到。但前端仍然组装并透传，造成语义混乱 — 未来调试时难以发现"为什么 salesStrategy 没效果"。

**修复**: 从 `buildLeadPayloads` 的返回对象中移除 `salesStrategy` 字段。

---

### 隐患 4: domain/website 可能带有完整 URL（非纯域名） 🟡 中优先级

**位置**: `src/components/dashboard-page.tsx:116-117` 和 `automation-workflow.tsx:131-132`

**现状**:
```typescript
domain: lead.website || "",   // 可能是 "https://www.example.com/products/batteries"
website: lead.website || "",  // 同上
```

**问题**: PRD 白名单中 `domain` 语义是纯域名（如 `example.com`），而前端直接传 `lead.website` 可能包含完整 URL（含协议、路径、参数）。主进程对 `domain` 字段只做 `String().trim()`，不提取域名，所以 N8N 收到的 `lead_info.domain` 可能是完整 URL。

Supabase 通道中 `compactLead` 已正确调用 `extractDomain()` 提取纯域名，N8N Webhook 通道却没有做同样处理。

**修复**: 在主进程 `triggerN8nWorkflow` 中对 `domain` 字段应用 `extractDomain()`（该函数已在 supabase-service.ts 中定义，需要在 automation-service.ts 中复用或内联）：
```typescript
domain: extractDomain(String(lead.website || lead.domain || '').trim()),
website: String(lead.website || lead.domain || '').trim(),
```

---

## Work Objectives

### Core Objective
消除所有 Kone → N8N Webhook 接口的字段缺失、截断缺失、类型不一致问题，使 N8N 上线后可立即稳定接收并处理 Payload。

### Concrete Deliverables
1. `electron/services/automation-service.ts:199-203` — `icpProfile` 子字段精确裁剪（4 字段各自 slice）
2. `electron/services/automation-service.ts:174` — `domain` 字段调用 `extractDomain()` 提取纯域名
3. `src/components/dashboard-page.tsx:108-132` — 补全 `phone/address/snippet` + 填充真实 `aiAnalysis/aiGeneratedPitch` + 移除 `salesStrategy`
4. `src/components/automation-workflow.tsx:142` — 移除 `salesStrategy` 字段（白名单外）
5. 全量测试 21/21 pass

### Definition of Done
- [ ] `npm run build:electron:dev` → 退出码 0（TypeScript 编译通过）
- [ ] Webhook Payload 结构与 PRD §3.4.3 白名单 100% 对齐
- [ ] `icpProfile` 4 个子字段全部有 `.slice()` 上限
- [ ] `domain` 字段使用 `extractDomain()` 输出纯域名
- [ ] `dashboard-page.tsx` 单条交接包含 PRD 白名单全部字段
- [ ] `salesStrategy` 从前端 Payload 移除
- [ ] 全量测试 21/21 pass, 0 fail

### Must Have
- `icpProfile.targetProduct` ≤ 500 字符
- `icpProfile.buyerPersona` ≤ 100 字符
- `icpProfile.coreAdvantage` ≤ 500 字符
- `icpProfile.negativeIcp` ≤ 300 字符
- `domain` 字段为纯域名（不含协议和路径）
- `dashboard-page.tsx` payload 包含 `phone`、`address`、`snippet`
- `dashboard-page.tsx` payload 包含真实 `aiAnalysis`、`aiGeneratedPitch`（从 `analysisCache` 提取）
- `salesStrategy` 从两处前端 payload 移除

### Must NOT Have (Guardrails)
- 不修改 `triggerN8nWorkflow` 的主裁剪白名单（16 字段已合规）
- 不修改 `GOLD_FILTER_MIN_SCORE` 或 Supabase 通道
- 不修改现有测试文件
- 不修改 `buildContactPageUrls`、`runLimitedConcurrency` 等已修复的性能函数
- 不引入新的 npm 依赖

---

## Execution Strategy

```
Wave 1 (主进程修复):
├── Task 1: automation-service.ts — icpProfile 子字段裁剪 + domain extractDomain [quick]

Wave 2 (前端修复):
├── Task 2: dashboard-page.tsx — 补全字段 + 真实 AI 数据 + 移除 salesStrategy [quick]
└── Task 3: automation-workflow.tsx — 移除 salesStrategy [quick]

Wave 3 (验证):
└── Task 4: 编译 + 全量回归验证 [quick]

Wave FINAL:
└── Task 5: 最终接口对齐审计（逐字段 diff PRD 白名单）
→ Present results → Get explicit user okay
```

---

## TODOs

- [x] 1. 修复主进程 icpProfile 裁剪 + domain 纯化

  **What to do**:
  - 打开 `electron/services/automation-service.ts`
  - 定位 `triggerN8nWorkflow` 函数中 `compactLeads` 的映射逻辑

  **修复 A: icpProfile 子字段裁剪 (line 199-203)**
  将 `icpProfile: typeof userSettings.icpProfile === 'object' ...` 整体替换为：
  ```typescript
  user_settings: {
    templateId: String(userSettings.templateId || templateId || 'default').trim(),
    selectedModel: String(userSettings.selectedModel || '').trim().slice(0, 120),
    icpProfile: (() => {
      const icp = typeof userSettings.icpProfile === 'object' && userSettings.icpProfile
        ? userSettings.icpProfile as Record<string, unknown>
        : {}
      return {
        targetProduct: String(icp.targetProduct || '').trim().slice(0, 500),
        buyerPersona: String(icp.buyerPersona || '').trim().slice(0, 100),
        coreAdvantage: String(icp.coreAdvantage || '').trim().slice(0, 500),
        negativeIcp: String(icp.negativeIcp || '').trim().slice(0, 300),
      }
    })(),
  },
  ```

  **修复 B: domain 字段纯化 (line 174)**
  - 在文件顶部导入区，找到现有工具函数引用（或直接内联域名提取逻辑）
  - 将 `domain: String(lead.website || lead.domain || '').trim()` 替换为提取纯域名的版本：
  ```typescript
  domain: (() => {
    const raw = String(lead.website || lead.domain || '').trim()
    try {
      const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`)
      return url.hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].toLowerCase()
    }
  })(),
  ```
  注意：`website` 字段保留完整 URL（保留现状），只有 `domain` 字段提取纯域名。

  **Must NOT do**: 不修改 16 个白名单字段的任何裁剪值

  **References**:
  - `electron/services/automation-service.ts:166-206` — `compactLeads` 映射逻辑
  - `electron/services/supabase-service.ts:82-92` — `compactLead` 中 `extractDomain` 的参考实现
  - `electron/services/automation-service.ts:199-203` — `user_settings` 块（修改点 A）
  - `electron/services/automation-service.ts:174` — `domain` 字段（修改点 B）

  **Acceptance Criteria**:
  - `npm run build:electron:dev` → 退出码 0
  - Grep `automation-service.ts` 确认 `icpProfile` 内有 `.slice(0, 500)` 和 `.slice(0, 100)`
  - Grep `automation-service.ts` 确认 `domain` 不再是简单 `.trim()` 而是有域名提取逻辑

  **Evidence**: `.sisyphus/evidence/align-task-1-mainproc.txt`
  **Commit**: NO (与 Task 2/3 合并提交)

---

- [x] 2. 修复 dashboard-page.tsx 单条交接字段完整性

  **What to do**:
  - 打开 `src/components/dashboard-page.tsx`
  - 定位 `handleSendToCloud` 函数（line 108-146）
  - 在函数开头增加 `analysisCache` 提取逻辑（参考 `automation-workflow.tsx:125-126` 的模式）
  - 补全 payload 字段：

  ```typescript
  const handleSendToCloud = async (lead: LeadItem) => {
    // 从 analysisCache 提取最佳分析结果
    const analysisCache = typeof lead.analysisCache === 'object' && lead.analysisCache
      ? lead.analysisCache as Record<string, any>
      : {}
    const bestAnalysis = analysisCache.direct_quote
      || analysisCache.competitor_switch
      || analysisCache.factory_strength
      || {}

    const response = await startCampaign({
      templateId: "single_lead_handoff",
      leads: [{
        email: lead.email || "",
        company: lead.company,
        website: lead.website || "",
        domain: lead.website || "",
        country: lead.country || "",
        contact: lead.contact || "",
        contactTitle: lead.contactTitle || lead.inferredRole || "",
        phone: lead.phone || "",           // ← 补充
        address: lead.address || "",       // ← 补充
        source: lead.source || "",
        matchScore: typeof lead.matchScore === "number" ? lead.matchScore : undefined,
        matchReasons: lead.matchReasons || [],
        riskFlags: lead.riskFlags || [],
        inferredRole: lead.inferredRole || "",
        snippet: lead.snippet || "",       // ← 补充
        verificationStatus: "unverified",
        aiAnalysis: {                      // ← 替换硬编码 {}
          companyProfile: String(bestAnalysis.companyProfile || "").trim(),
          painPoints: String(bestAnalysis.painPoints || "").trim(),
          valueMapping: String(bestAnalysis.valueMapping || "").trim(),
          confidence: typeof bestAnalysis.confidence === "number" ? bestAnalysis.confidence : undefined,
          source: String(bestAnalysis.source || "").trim(),
        },
        aiGeneratedPitch: {                // ← 替换硬编码 {}
          emailSubject: String(bestAnalysis.emailSubject || "").trim(),
          emailBody: String(bestAnalysis.emailBody || "").trim(),
        },
        userSettings: {},
        // ← 移除 salesStrategy（不在 PRD 白名单）
      }],
    })
    // 以下逻辑不变...
  ```

  **Must NOT do**:
  - 不修改 `if (response.triggered === false && response.error)` 及以下的错误处理逻辑
  - 不修改组件的其他任何 JSX 部分

  **References**:
  - `src/components/dashboard-page.tsx:108-146` — `handleSendToCloud` 完整函数
  - `src/components/automation-workflow.tsx:120-162` — `buildLeadPayloads` 中 `analysisCache` 提取模式参考
  - `src/shared/ipc-contracts.ts` — `CampaignStartRequest` 类型（如存在，确认字段名称）

  **Acceptance Criteria**:
  - Grep `dashboard-page.tsx` 确认包含 `phone: lead.phone` 和 `address: lead.address`
  - Grep `dashboard-page.tsx` 确认包含 `snippet: lead.snippet`
  - Grep `dashboard-page.tsx` 确认 `aiAnalysis` 不再是 `{}`
  - Grep `dashboard-page.tsx` 确认不含 `salesStrategy`
  - `npm run build:electron:dev` → 退出码 0（TypeScript 编译通过）

  **Evidence**: `.sisyphus/evidence/align-task-2-dashboard.txt`
  **Commit**: NO (与 Task 1/3 合并提交)

---

- [x] 3. 移除 automation-workflow.tsx 中的 salesStrategy

  **What to do**:
  - 打开 `src/components/automation-workflow.tsx`
  - 定位 `buildLeadPayloads` 函数内的 `salesStrategy` 字段（line 142）
  - 删除该行：`salesStrategy: String(lead.salesStrategy || "").trim(),`

  **Must NOT do**:
  - 不修改其他任何字段
  - 不修改函数签名或其他逻辑

  **References**:
  - `src/components/automation-workflow.tsx:120-162` — `buildLeadPayloads` 完整映射

  **Acceptance Criteria**:
  - Grep `automation-workflow.tsx` 确认不含 `salesStrategy`
  - `npm run build:electron:dev` → 退出码 0

  **Evidence**: `.sisyphus/evidence/align-task-3-workflow.txt`
  **Commit**: YES
  - Message: `fix(cloud): align N8N webhook payload with PRD whitelist — add missing fields, sanitize icpProfile, purify domain, remove off-spec salesStrategy`
  - Files: `electron/services/automation-service.ts`, `src/components/dashboard-page.tsx`, `src/components/automation-workflow.tsx`
  - Pre-commit: `npm run build:electron:dev`

---

- [x] 4. 编译 + 全量回归验证

  **What to do**:
  - `npm run build:electron:dev` → 退出码 0
  - 执行全量测试回归（7 个测试文件，21 条用例）
  - 确认 21/21 pass, 0 fail

  **QA Scenarios:**
  ```
  Scenario: 编译验证
    Steps: npm run build:electron:dev → 退出码 0
    Evidence: .sisyphus/evidence/align-task-4-build.txt

  Scenario: 全量回归
    Steps: node --test tests/license-gateway.test.js tests/e2e/permission-lock.test.js
           tests/e2e/403-social-fallback.test.js tests/e2e/icp-blind-score.test.js
           tests/e2e/fallback-routing.test.js tests/circuit-breaker.test.js
           tests/e2e-journey.test.js
    Expected: 21/21 pass
    Evidence: .sisyphus/evidence/align-task-4-regression.txt
  ```

  **Commit**: NO (已在 Task 3 提交)

---

- [x] 5. 最终接口对齐审计（逐字段 diff PRD 白名单）

  **What to do**:
  对每个字段逐一确认主进程输出与 PRD 的对齐状态：

  | 字段 | PRD 要求 | 修复后状态 |
  |------|---------|----------|
  | `lead_info.email` | 非空过滤 | ✅ filter |
  | `lead_info.company` | ≤200 | ✅ slice(0,200) |
  | `lead_info.domain` | 纯域名 | ✅ extractDomain |
  | `lead_info.website` | URL | ✅ trim |
  | `lead_info.country` | ≤50 | ✅ slice(0,50) |
  | `lead_info.contact` | ≤100 | ✅ slice(0,100) |
  | `lead_info.contact_title` | ≤120 | ✅ slice(0,120) |
  | `lead_info.phone` | ≤80 | ✅ slice(0,80) |
  | `lead_info.address` | ≤240 | ✅ slice(0,240) |
  | `lead_info.source` | ≤120 | ✅ slice(0,120) |
  | `lead_info.inferred_role` | ≤120 | ✅ slice(0,120) |
  | `lead_info.match_reasons` | ≤4条 | ✅ slice(0,4) |
  | `lead_info.risk_flags` | ≤3条 | ✅ slice(0,3) |
  | `lead_info.snippet` | ≤500 | ✅ slice(0,500) |
  | `ai_analysis.companyProfile` | ≤800 | ✅ slice(0,800) |
  | `ai_analysis.painPoints` | ≤800 | ✅ slice(0,800) |
  | `ai_analysis.valueMapping` | ≤1000 | ✅ slice(0,1000) |
  | `ai_analysis.source` | ≤80 | ✅ slice(0,80) |
  | `ai_generated_pitch.emailSubject` | ≤200 | ✅ slice(0,200) |
  | `ai_generated_pitch.emailBody` | ≤2400 | ✅ slice(0,2400) |
  | `user_settings.templateId` | string | ✅ trim |
  | `user_settings.selectedModel` | ≤120 | ✅ slice(0,120) |
  | `user_settings.icpProfile.targetProduct` | ≤500 | ✅ slice(0,500) (NEW) |
  | `user_settings.icpProfile.buyerPersona` | ≤100 | ✅ slice(0,100) (NEW) |
  | `user_settings.icpProfile.coreAdvantage` | ≤500 | ✅ slice(0,500) (NEW) |
  | `user_settings.icpProfile.negativeIcp` | ≤300 | ✅ slice(0,300) (NEW) |
  | `verification_status` | string | ✅ trim |
  | `salesStrategy` 不在白名单 | 禁止透传 | ✅ 已移除 (NEW) |

  **Evidence**: `.sisyphus/evidence/align-task-5-final-audit.txt`
  **Verdict Output**: `Fields [28/28 aligned] | VERDICT: APPROVE/REJECT`

---

## Success Criteria

```bash
npm run build:electron:dev                     # 退出码 0
node --test tests/license-gateway.test.js ...  # 21/21 pass
grep "salesStrategy" src/components/dashboard-page.tsx     # 无输出
grep "salesStrategy" src/components/automation-workflow.tsx # 无输出
grep "slice(0, 500)" electron/services/automation-service.ts # icpProfile 裁剪存在
grep "extractDomain\|hostname" electron/services/automation-service.ts # domain 纯化存在
```

### Final Checklist
- [ ] icpProfile 4 个子字段全部有 slice 上限
- [ ] domain 字段输出纯域名（非完整 URL）
- [ ] dashboard 单条交接包含 phone/address/snippet
- [ ] dashboard 单条交接包含真实 aiAnalysis/aiGeneratedPitch
- [ ] salesStrategy 从两处前端 payload 移除
- [ ] 全量测试 21/21 pass
- [ ] 零 PRD 白名单外字段透传
