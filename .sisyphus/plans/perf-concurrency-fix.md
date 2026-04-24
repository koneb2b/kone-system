# 性能铁律审计报告与重构计划

## TL;DR

> **审计结论**: 两条铁律的**核心常量已合规**（并发=2, 截断=3000），但发现 **2 个中等风险违规** 和 **1 个低风险不一致**。
>
> **违规清单**:
> 1. 🟡 **中风险**: `Promise.allSettled` 并发抓取 2 个联系人页面，绕过 `runLimitedConcurrency` (line 773)
> 2. 🟡 **中风险**: `Promise.all` 并发发起 3 个社交源查询，绕过 `runLimitedConcurrency` (line 848)
> 3. 🟢 **低风险**: `analysis:generate` handler 使用 `sanitizePlainText(..., 2600)` 替代 `trimWebsiteTextForLlm`，跳过了 HTML 噪音词清除 (line 1734)
>
> **Deliverables**:
> - `electron/services/search-service.ts` — 3 处精确修复
> - 全量测试通过（21/21）
>
> **Estimated Effort**: Quick（~15 行变更）
> **Parallel Execution**: NO — 顺序（单文件修改）
> **Critical Path**: Task 1 → Task 2 → Task 3

---

## Context

### 铁律原文 (ARCH-STANDARDS.md §9)

**§9.8** (并发):
> Search scoring and website enrichment concurrency is a hard performance law: maximum concurrent jobs must remain fixed at `2`.

**§9.9** (截断):
> Website content sent into LLM must be reduced to high-value plain text only, stripped of HTML/script/style noise, and strictly truncated to no more than `3000` characters before prompt assembly.

**§9.10** (违规定义):
> Any implementation or commit that exceeds the `2` concurrency ceiling or the `3000`-character website-text ceiling is an architecture violation.

### 审计方法
- 扫描 `electron/services/search-service.ts` 全部 1802 行
- 追踪所有 `Promise.all`、`Promise.allSettled`、`runLimitedConcurrency` 调用
- 追踪所有 `trimWebsiteTextForLlm`、`sanitizePlainText`、`MAX_WEBSITE_TEXT_FOR_LLM` 使用
- 验证每个网络请求并发路径

### 审计结果：合规项 ✅

| 检查项 | 源码位置 | 结果 |
|-------|---------|------|
| `SEARCH_LLM_CONCURRENCY` | line 42 | `= 2` ✅ |
| `SEARCH_ENRICH_CONCURRENCY` | line 43 | `= 2` ✅ |
| `MAX_WEBSITE_TEXT_FOR_LLM` | line 47 | `= 3000` ✅ |
| LLM 评分并发 | line 1534 | `runLimitedConcurrency(candidates, SEARCH_LLM_CONCURRENCY, ...)` ✅ |
| 官网深探并发 | line 1608 | `runLimitedConcurrency(baseResults, SEARCH_ENRICH_CONCURRENCY, ...)` ✅ |
| 深探 LLM 文本截断 | line 877 | `trimWebsiteTextForLlm(...)` → `sanitizePlainText(..., 3000)` ✅ |
| 盲评文本截断 | line 930 | `trimWebsiteTextForLlm(...)` ✅ |
| 社交降级文本截断 | line 851 | `trimWebsiteTextForLlm(...)` ✅ |
| `fetchWebsiteContent` body 截断 | line 735 | `sanitizePlainText(bodyText, 2200)` ✅ (< 3000) |
| HTML script/style 去噪 | line 728 | `.replace(/<script...>.../<style...>/gi, ' ')` ✅ |
| `runLimitedConcurrency` 实现 | lines 140-158 | 正确的 worker pool 模式 ✅ |

---

## 违规详细分析

### 违规 1: 联系人页面并发抓取 (中风险 🟡)

**位置**: `search-service.ts:773`
```typescript
const contactResults = await Promise.allSettled(
  contactUrls.map((contactUrl) => fetchWebsiteContent(contactUrl, strictTimeoutMs))
)
```

**违规分析**:
- `buildContactPageUrls` 返回 `['/contact', '/contact-us']` → **2 个并发 HTTP 请求**
- 此并发发生在 `extractWebsiteContent` 内部，而 `extractWebsiteContent` 已被 `runLimitedConcurrency` 控制（在外层 enrichment loop 中限制为 2）
- **叠加效应**: 外层 2 并发 × 内层 2 并发 = 最高 **4 个同时 HTTP 请求** 到不同官网
- 加上主页请求（串行在前），峰值并发为 **4**（超过铁律上限 2）

**风险**:
- 在 4G-8G RAM 低配机器上，4 个同时 HTTP 请求 + 响应解析可能导致内存尖峰
- 目标官网可能对同源 IP 的并发请求返回 429

**修复方案**:
将 `Promise.allSettled` 改为串行执行（`for...of` 循环），或使用 `runLimitedConcurrency(contactUrls, 1, ...)`：
```typescript
const contactResults: WebsiteContentProbe[] = []
for (const contactUrl of contactUrls) {
  const result = await fetchWebsiteContent(contactUrl, strictTimeoutMs).catch(() => createEmptyWebsiteContentProbe(contactUrl))
  if (result.ok) contactResults.push(result)
}
```

---

### 违规 2: 社交源查询并发 (中风险 🟡)

**位置**: `search-service.ts:848-850`
```typescript
const snippets = await Promise.all(
  buildSocialFallbackQueries(company, country).map((query) =>
    fetchSocialFallbackSnippet(query, googleKey, timeoutMs).catch(() => '')
  )
)
```

**违规分析**:
- `buildSocialFallbackQueries` 返回 3 个查询 (LinkedIn, Kompass, Europages) → **3 个并发 SerpApi 请求**
- 此并发发生在 `enrichLeadWithDeepProbe` 内部，而该函数已被 `runLimitedConcurrency(baseResults, 2, ...)` 控制
- **叠加效应**: 外层 2 并发 × 内层 3 并发 = 最高 **6 个同时 SerpApi 请求**
- **这是最严重的违规**：6 远超铁律上限 2

**风险**:
- SerpApi 可能对同 API Key 的并发请求限流（429）
- 6 个同时 HTTP 请求在低配机器上造成网络和内存压力
- 可能触发 circuit-breaker（`safeFetch` 在 4 次 429 后熔断）

**修复方案**:
将 `Promise.all` 改为串行执行：
```typescript
const snippets: string[] = []
for (const query of buildSocialFallbackQueries(company, country)) {
  const result = await fetchSocialFallbackSnippet(query, googleKey, timeoutMs).catch(() => '')
  snippets.push(result)
}
```

---

### 违规 3: analysis handler 文本截断不一致 (低风险 🟢)

**位置**: `search-service.ts:1734`
```typescript
const websiteText = sanitizePlainText(
  [...].filter(Boolean).join(' '),
  2600
) || fallbackSnippet
```

**违规分析**:
- 使用 `sanitizePlainText(..., 2600)` 而非 `trimWebsiteTextForLlm(...)`
- `trimWebsiteTextForLlm` 额外执行 HTML 噪音词过滤（home, about, products, blog, cookie, login 等）
- `2600 < 3000` 所以字符上限合规，但**跳过了噪音词清除**
- 这意味着分析 handler 可能把 "home about products services blog" 等无价值词汇送入 LLM

**风险**:
- LLM token 浪费（无价值导航词占用 prompt 空间）
- 分析质量轻微下降（噪音词干扰 ICP 判断）
- 不影响内存/性能，但违反 §9.9 的 "高价值纯文本" 精神

**修复方案**:
替换为 `trimWebsiteTextForLlm`：
```typescript
const websiteText = trimWebsiteTextForLlm(
  [...].filter(Boolean).join(' ')
) || fallbackSnippet
```

---

## Work Objectives

### Core Objective
消除 2 个并发违规和 1 个截断不一致，确保代码 100% 合规 ARCH-STANDARDS §9.8-9.10。

### Concrete Deliverables
- `electron/services/search-service.ts:773` — 联系人页面串行化
- `electron/services/search-service.ts:848-850` — 社交源查询串行化
- `electron/services/search-service.ts:1734` — analysis handler 使用 `trimWebsiteTextForLlm`
- 全量测试通过（21/21）

### Definition of Done
- [ ] `npm run build:electron:dev` → 退出码 0
- [ ] `node --test tests/license-gateway.test.js` → 3/3 pass
- [ ] `node --test tests/e2e/permission-lock.test.js` → 7/7 pass
- [ ] `node --test tests/e2e/403-social-fallback.test.js` → 3/3 pass
- [ ] `node --test tests/e2e/icp-blind-score.test.js` → 5/5 pass
- [ ] `node --test tests/e2e/fallback-routing.test.js` → 1/1 pass
- [ ] `node --test tests/circuit-breaker.test.js` → 1/1 pass
- [ ] `node --test tests/e2e-journey.test.js` → 1/1 pass
- [ ] 全部 21/21 pass, 0 fail

### Must Have
- 联系人页面抓取（`/contact`, `/contact-us`）改为串行，不再 `Promise.allSettled` 并发
- 社交源查询（LinkedIn/Kompass/Europages）改为串行，不再 `Promise.all` 并发
- analysis handler 的 `websiteText` 使用 `trimWebsiteTextForLlm` 替代 `sanitizePlainText(..., 2600)`
- 修复后最大同时 HTTP 请求数 ≤ 2（外层 `runLimitedConcurrency` 限制 + 内层串行 = 最多 2）

### Must NOT Have (Guardrails)
- 不修改 `SEARCH_LLM_CONCURRENCY` 或 `SEARCH_ENRICH_CONCURRENCY` 常量值
- 不修改 `MAX_WEBSITE_TEXT_FOR_LLM` 常量值
- 不修改 `runLimitedConcurrency` 函数实现
- 不修改 `trimWebsiteTextForLlm` 函数实现
- 不修改测试文件
- 不修改 `fetchWebsiteContent` 函数逻辑
- 不引入新的并发控制机制（复用现有 `runLimitedConcurrency` 或串行循环）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (现有测试作为回归验证)
- **Framework**: `node:test` + `node:assert/strict`

---

## Execution Strategy

```
Wave 1 (Code fix):
└── Task 1: 修复 3 处违规 [quick]

Wave 2 (Verification):
└── Task 2: 编译 + 全量回归 [quick]

Wave FINAL:
└── Task 3: Scope fidelity + compliance check [quick]
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 2 → Task 3 → user okay
```

---

## TODOs

- [x] 1. 修复 3 处性能铁律违规

  **What to do**:

  **修复 1: 联系人页面串行化 (line 773)**
  - 打开 `electron/services/search-service.ts`
  - 定位 `extractWebsiteContent` 函数中的 `Promise.allSettled` (line 773)
  - 将并发 `Promise.allSettled(contactUrls.map(...))` 替换为串行 `for...of` 循环：
  ```typescript
  const successfulContacts: WebsiteContentProbe[] = []
  for (const contactUrl of contactUrls) {
    try {
      const contactResult = await fetchWebsiteContent(contactUrl, strictTimeoutMs)
      if (contactResult.ok) successfulContacts.push(contactResult)
    } catch {
      // ignore individual contact page failures
    }
  }
  ```
  - 同时删除原来的 `contactResults` 变量和 `.filter/.map` 链
  - `if (successfulContacts.length === 0)` 逻辑保持不变

  **修复 2: 社交源查询串行化 (line 848-850)**
  - 定位 `buildSocialFallbackEnrichedText` 函数中的 `Promise.all` (line 848)
  - 将并发 `Promise.all(queries.map(...))` 替换为串行循环：
  ```typescript
  const snippets: string[] = []
  for (const query of buildSocialFallbackQueries(company, country)) {
    const result = await fetchSocialFallbackSnippet(query, googleKey, timeoutMs).catch(() => '')
    snippets.push(result)
  }
  ```

  **修复 3: analysis handler 截断统一 (line 1734)**
  - 定位 `analysis:generate` handler 中的 `websiteText` 赋值 (line 1734)
  - 将 `sanitizePlainText([...].join(' '), 2600)` 替换为 `trimWebsiteTextForLlm([...].join(' '))`
  - 确保 `|| fallbackSnippet` 兜底逻辑保持不变

  **Must NOT do**:
  - 不修改常量值
  - 不修改测试文件
  - 不修改 `fetchWebsiteContent` 内部逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 3 处局部替换，每处 ≤ 8 行变更
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 2
  - **Blocked By**: None

  **References**:
  - `electron/services/search-service.ts:773` — `Promise.allSettled` 修改点
  - `electron/services/search-service.ts:848-850` — `Promise.all` 修改点
  - `electron/services/search-service.ts:1734` — `sanitizePlainText` 修改点
  - `electron/services/search-service.ts:310-316` — `trimWebsiteTextForLlm` 函数定义（修复 3 的替换目标）

  **WHY Each Reference Matters**:
  - line 773 是联系人页面并发的精确位置，需要理解 `contactResults` 变量如何被后续代码使用
  - line 848 是社交源并发的精确位置，结果被 `trimWebsiteTextForLlm` 截断后返回
  - line 1734 是 analysis handler 的文本组装点，需要理解 `|| fallbackSnippet` 的兜底语义

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 编译通过
    Tool: Bash
    Steps:
      1. npm run build:electron:dev → 退出码 0
    Evidence: .sisyphus/evidence/perf-task-1-build.txt

  Scenario: 并发消除验证
    Tool: Grep
    Steps:
      1. 在 search-service.ts 中搜索 Promise.all 和 Promise.allSettled
      2. 确认仅剩 runLimitedConcurrency 内部的 Promise.all (line 157)
      3. 不应有其他 Promise.all/allSettled 用于 HTTP 请求
    Evidence: .sisyphus/evidence/perf-task-1-concurrency-check.txt

  Scenario: 截断统一验证
    Tool: Grep
    Steps:
      1. 搜索 analysis handler 中的 websiteText 赋值
      2. 确认使用 trimWebsiteTextForLlm 而非 sanitizePlainText
    Evidence: .sisyphus/evidence/perf-task-1-truncation-check.txt
  ```

  **Commit**: YES
  - Message: `perf(search): serialize contact/social fetches and unify LLM text truncation per ARCH-STANDARDS §9.8-9.10`
  - Files: `electron/services/search-service.ts`
  - Pre-commit: `npm run build:electron:dev`

- [x] 2. 编译 + 全量回归验证

  **What to do**:
  - 执行 `npm run build:electron:dev` 确认编译通过
  - 执行全量测试回归（所有 7 个测试文件）
  - 确认 21/21 pass, 0 fail

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **QA Scenarios:**
  ```
  Scenario: 全量回归
    Tool: Bash
    Steps:
      1. npm run build:electron:dev → 退出码 0
      2. node --test tests/license-gateway.test.js → 3/3
      3. node --test tests/e2e/permission-lock.test.js → 7/7
      4. node --test tests/e2e/403-social-fallback.test.js → 3/3
      5. node --test tests/e2e/icp-blind-score.test.js → 5/5
      6. node --test tests/e2e/fallback-routing.test.js → 1/1
      7. node --test tests/circuit-breaker.test.js → 1/1
      8. node --test tests/e2e-journey.test.js → 1/1
    Expected: 21/21 pass
    Evidence: .sisyphus/evidence/perf-task-2-regression.txt
  ```

  **Commit**: NO (已在 Task 1 提交)

- [x] 3. Scope fidelity + compliance check

  **What to do**:
  - 确认仅修改 `electron/services/search-service.ts` 1 个文件
  - 确认无测试文件被修改
  - 确认修复后 `search-service.ts` 中仅有 `runLimitedConcurrency` 内部的 `Promise.all` (line 157) 用于并发控制
  - 确认所有送入 LLM 的文本路径都经过 `trimWebsiteTextForLlm` 或 `sanitizePlainText(value, ≤3000)`

  **QA Scenarios:**
  ```
  Scenario: 最终并发合规确认
    Tool: Grep
    Steps:
      1. grep "Promise.all\|Promise.allSettled" search-service.ts
      2. 确认仅 1 处匹配（runLimitedConcurrency 内部 line 157）
    Evidence: .sisyphus/evidence/perf-task-3-final-audit.txt
  ```

  **Commit**: NO

---

## Success Criteria

### Verification Commands
```bash
npm run build:electron:dev
# 全量 21 测试
node --test tests/license-gateway.test.js tests/e2e/permission-lock.test.js tests/e2e/403-social-fallback.test.js tests/e2e/icp-blind-score.test.js tests/e2e/fallback-routing.test.js tests/circuit-breaker.test.js tests/e2e-journey.test.js
# 并发审计
grep -n "Promise.all\|Promise.allSettled" electron/services/search-service.ts
# 期望仅 1 处（runLimitedConcurrency 内部）
```

### Final Checklist
- [ ] 联系人页面抓取串行化 ✅
- [ ] 社交源查询串行化 ✅
- [ ] analysis handler 截断统一 ✅
- [ ] 最大同时 HTTP 请求 ≤ 2 ✅
- [ ] 全量测试 21/21 pass ✅
- [ ] 零测试文件修改 ✅
