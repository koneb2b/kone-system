# `search-service.ts` 拆分蓝图（O1 执行计划）

> **文档性质**：架构重构方案（Plan-First 产物）｜ **日期**：2026-09-24 ｜ **基线**：HEAD `f57890f`
> **目标文件**：`electron/services/search-service.ts`（**3,873 行 / 75 顶层符号**）
> **约束**：不得改变任何运行时行为；不得破坏四级弹性搜索协议、Fail-Closed 授权、双管道回写；每阶段结束必须全门禁绿。

---

## 1. 拆分动因

| 问题 | 证据 |
|---|---|
| 单体巨文件 | 3,873 行 / 75 顶层符号，混合了常量、纯工具、Scout、评分、富化、编排、IPC 注册 |
| 可维护性差 | 单文件承担 6+ 职责，评审/定位/并行开发成本高 |
| 可测试性受限 | 内部纯函数无法定向单测，只能通过编译产物整体加载 |

---

## 2. 依赖与耦合事实（拆分前必须尊重的约束）

### 2.1 外部依赖
- **生产侧唯一依赖方**：`electron/main.ts` → `registerSearchHandlers`（仅 1 处）。
- **7 个 Provider 动态回引**：`providers/*.ts` 用 `await import('../search-service')` 取 `isKnownActiveJobId`（打破 **search-service ↔ providers 循环依赖**）。
- **24 个测试文件**引用 search-service（编译产物路径 / 源码文本）。

### 2.2 源码文本断言（**硬约束**，移动对应内容必须同步改测试）
| 测试 | 断言的内容所在 | 断言点 |
|---|---|---|
| `search-fanout-concurrency.business.test.js` | `SEARCH_FANOUT_CONCURRENCY`、`mapLimitedConcurrency(allSearchKeywords, SEARCH_FANOUT_CONCURRENCY` | 必须在 `search-service.ts` 源码中 |
| `search-resilience-contract.test.js` | `isSerpApiUnsupportedLocationError`（`status !== 400) return false`、`unsupported`+`location`） | 同上 |
| `search-semantic-contract.test.js` | `getAnalysisConfigError`/`buildAnalysisErrorResponse`（`code: 'missing_llm_key'`、`degraded: true`、`settingsActionable: true`） | 同上 |
| `ui-ux-alignment-contract.test.js` | `COUNTRY_TLD_MAP`（`usa: [".us", ".com"]`） | 同上 |

### 2.3 编译产物 mock 约束
部分测试通过 `Module._load` 按**父文件名 `search-service.js`** 拦截 `./secret-manager`、`./license-service`。→ **门面必须保留 `search-service.ts` 路径**，使编译产物路径不变。

---

## 3. 门面策略（Facade，零破坏对外接口）

```
electron/services/
├── search-service.ts          # 【保留】薄门面：re-export ./search/index（对外接口与路径零变化）
└── search/
    ├── index.ts               # 汇总 re-export
    ├── constants.ts           # 宪法常量 + 词表
    ├── text-utils.ts          # 纯文本/URL 工具
    ├── job-registry.ts        # activeJobIds / isKnownActiveJobId（解循环依赖）
    ├── intent.ts              # 意图突变 / 语言解析
    ├── scout.ts               # 预筛 / 准入否决 / 产品词匹配
    ├── concurrency.ts         # 有界并发调度
    ├── scoring.ts             # ICP 评分 / LLM 提示词 / 机会分
    ├── enrichment.ts          # 官网抓取 / 深度富化 / 社交回退
    ├── analysis.ts            # 深度分析 / 回复教练
    ├── provider-orchestration.ts # 四级协议编排 / AnySearch
    └── handlers.ts            # registerSearchHandlers + emit*
```

**门面收益**：`main.ts`、7 个 Provider、24 个测试的**导入路径全部不变**。

---

## 4. 分阶段执行计划（每阶段独立可验证 + 独立提交 + 可回滚）

> **每阶段验收门禁**：`npm run build:electron:dev` → `npm run typecheck` → `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run test:unit`（266/266）→ `npm run verify:consistency` 双绿。任一判红即回滚本阶段提交。

| 阶段 | 迁移内容 | 源文本断言影响 | 风险 |
|---|---|---|---|
| **P1（本轮执行）** | 纯内部工具 → `search/text-utils.ts`：`getHostFromUrl`、`normalizeLlmJsonText`、`sanitizePlainText`、`normalizeWebsiteUrl`、`normalizeGeoText`、`extractLocationTerms`、`extractDomainFromUrl`、`extractEmailsFromText`、`extractPhonesFromText`、`mergePromptParts`、`mergeUniqueValues`、`clampInt`、`extractJsonObjectFromText` | **无**（均为内部非导出纯函数，无源码断言） | 极低 |
| **P2（已完成）** | 词表/模式 → `search/constants.ts`；并发调度 → `search/concurrency.ts`。**P2 时修订**：8 个宪法常量暂留 `search-service.ts`。 | **有**：fanout 测试 `mapLimitedConcurrency` 定义断言改读 `search/concurrency.ts` | 低 |
| **P7b（已完成）** | **宪法常量与时限常量 → `search/constants.ts`**（8 宪法 + 3 时限）；同步改 `verify-doc-consistency.cjs` 读取源为 `search/constants.ts`。动因：`trimWebsiteTextForLlm`/`WEBSITE_PROBE_TIMEOUT_MS` 被富化模块与 search-service 共同消费 | **有**：fanout（`SEARCH_FANOUT_CONCURRENCY` 定义）与 resilience（`SERPAPI_RETRYABLE_STATUS`）改读 `search/constants.ts`，断言强度不变 | 中（触及治理脚本） |
| **P3** | Scout/准入 → `search/scout.ts`（`computeScoutRelevance`/`computeEligibilityVeto`/`matchesProductTerm`/`isTrashLead`） | 无源码断言；`eligibility-gate` 走编译产物（门面 re-export 兼容） | 中 |
| **P4** | 评分/提示词 → `search/scoring.ts`；意图 → `search/intent.ts` | 无源码断言 | 中 |
| **P5** | 富化/分析 → `search/enrichment.ts` + `search/analysis.ts` | 无源码断言；注意 `Module._load` mock 目标（secret-manager/license-service）须仍在门面路径可达 | 中 |
| **P6** | 作业注册表 → `search/job-registry.ts`；**更新 7 个 Provider** 改为 `await import('../search/job-registry')` | 无源码断言；**消除循环依赖** | 中 |
| **P7** | 四级协议编排 → `search/provider-orchestration.ts`；IPC 注册 → `search/handlers.ts`；`search-service.ts` 收敛为薄门面 | **有**：resilience/semantic/ui-ux 三个测试需改读新文件 | 高（需最谨慎） |

---

## 4.5 附带发现：架构债 O13（并发调度三处重复）

`runLimitedConcurrency` 在 `search-service.ts` / `agent-service.ts:520` / `sandbox-service.ts:40` **各有一份独立实现**（未共享）。
建议后续阶段上提为 `electron/utils/concurrency.ts` 共享模块（签名统一为 `(item, index) => Promise<...>`，向后兼容忽略 index 的调用方），
一次消除三处重复。本蓝图 P2 先做 search 域收敛，O13 单列后续阶段。

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 迁移中误改行为 | 每阶段「纯搬运 + import 回填」，不重写逻辑；逐阶段跑 266 单测 |
| 源码文本断言漂移 | 断言点所在阶段**同步更新测试**，且只改「读哪个文件」，不改断言强度 |
| 循环依赖 | P6 用 `job-registry.ts` 作为中立依赖点，Provider 不再回引 search-service |
| 编译产物 mock 失效 | 门面保留 `search-service.ts` 路径；P5 迁移后复跑 `html-truncate`/`llm-score-cache`/`search-fallback` 验证 |
| 回滚 | 每阶段独立 commit；判红即 `git revert <sha>` |

---

## 6. 完成判据（DoD）

1. `search-service.ts` ≤ 150 行（纯门面）。
2. 各子模块职责单一、可定向单测。
3. 全部门禁绿：typecheck / test:unit(266) / test:ipc / test:e2e / test:e2e-smoke / security-audit / verify:consistency。
4. 无新增 lint error；`ARCH-STANDARDS.md §3` 增补 `search/` 子模块职责说明（SSOT 同步）。
5. `CHANGELOG.md` 记录分阶段变更与证据。

---

*本蓝图为执行计划；P1 于本轮执行，P2–P7 待逐阶段推进。*
