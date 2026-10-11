# 搜索 API 消耗治理方案（Plan-First）

> 日期：2026-10-11 ｜ 触发：实测发现单次搜索消耗 SerpApi 53 次 + LLM 60 次，
> 用户指出「跑 2 次搜索免费额度就跑完了」
> 依据：`AGENTS.md`（Plan-First / 契约先行 / 规范回写）、`kone-PRD.md §零.3`（宪法常量）

---

## 一、问题陈述（实测数据）

单次搜索（关键词 `solar distributor Germany`）实测：

| 项 | 次数 |
|---|---|
| **SerpApi 请求** | **53** |
| **LLM 请求** | **60** |
| 官网抓取 | 303 |
| 派发关键词变体 | 17（去重后） |

**后果**：SerpApi 免费版 100 次/月 → **2 次搜索即耗尽**。

## 二、根因（已定位到代码行）

### 2.1 变体数 = 产品词数 × 4，而**产品词数无上限**

- `electron/services/search/intent.ts:158`
  ```ts
  keywords: Array.from(new Set(pureEnglishProducts.flatMap((p) =>
    B2B_ROLE_TERMS.map((role) => `${p} ${role}`))))
  ```
  → `flatMap` **无 slice**，产品词有几个就乘几轮

- `electron/services/search-service.ts:361-367`
  ```ts
  const pureEnglishProducts = llmProducts.length > 0 ? llmProducts : fallback.pureEnglishProducts
  ```
  → 对比同段的 `keywords` 有 `slice(0, 4)`，**`pureEnglishProducts` 没有** → **不对称**

### 2.2 低质量产品词混入

实测派发中出现**未清理的原始中文输入**：
```
"请深度 在德国做电动叉车 公司规模人数低于 人 要求有明确的公司信息 邮箱电话网址 dealer Germany"
```
→ 这种查询打出去**必然返回垃圾结果**，是**纯浪费**。

### 2.3 变体重复

```
"solar dealer" / "Solar Germany dealer"     ← 同一产品的两种形态
"electric forklift dealer" / "Electric forklift dealer Germany"
```
→ 大小写 + 国家后缀差异，**语义重叠**，重复消耗。

## 三、规范冲突（必须解决，这是本方案的重点）

### 3.1 现状歧义

| 文档 | 表述 | 问题 |
|---|---|---|
| `AGENTS.md`「多语言多源搜索执行宪法」 | 「搜索变体公式为：`(pureEnglishProducts[] + localizedProducts[].terms[]) × B2B_ROLE_TERMS[0..3] × country/city`」 | `pureEnglishProducts[]` **未定义数量上限** |
| `AGENTS.md` 同节 | 「英文变体始终执行，本地语言变体并行补充。此策略允许约 `2x` API 调用量」 | 「**约 2x**」的**基数未定义** |
| `kone-PRD.md §0.3` | 只规定了**并发**上限（扇出 3 / 评分 2）与**条数**上限（50） | **没有任何"变体总数"或"产品词数"的宪法常量** |
| `kone-PRD.md:98` | 「多语言搜索会使 SerpApi/AnySearch 调用量扩大至约 `2x`。**这是被批准的高价值 B2B 扩面策略**」 | 「2x」是相对**什么**的 2x？未定义 |

**结论**：宪法批准了「多语言扩面」，但**从未定义扩面的绝对上限**——
于是实现只能自由发挥，最终跑到 **17 变体 × 7 Provider**。

**这是真正的规范缺口**：宪法管住了**并发**（防打爆上游），
却漏了**总量**（防烧光用户额度）。

### 3.2 拟新增的宪法常量（写入 `kone-PRD.md §零.3`）

| 常量 | 建议值 | 语义 | 理由 |
|---|---|---|---|
| `SEARCH_PRODUCT_TERM_LIMIT` | **2** | 参与变体生成的**产品词**数量上限 | 覆盖"多产品"场景，同时把变体压回个位数 |
| `SEARCH_VARIANT_LIMIT` | **8** | 单次搜索派发的**关键词变体总数**上限（英文 + 本地语言合计） | 2 产品词 × 4 角色词 = 8，与"英文变体 ≤4/产品词"自洽 |

**与既有常量的关系（不得混读）**：
- `SEARCH_FANOUT_CONCURRENCY = 3` → **同时**打几个请求（并发域）
- `SEARCH_VARIANT_LIMIT = 8` → 一轮**总共**打几个请求（**总量域，新增**）
- `SEARCH_LLM_SCORE_LIMIT = 50` → LLM 评分条数
- 四者维度不同，**不得互相套用**

### 3.3 需同步回写的文档
1. `kone-PRD.md §零.3` —— 新增两行宪法常量
2. `AGENTS.md`「多语言多源搜索执行宪法」—— 把 `pureEnglishProducts[]` 改为
   `pureEnglishProducts[0..SEARCH_PRODUCT_TERM_LIMIT]`，并明确「2x」的**基数是
   "单产品单词变体（4 个角色词）"**，避免继续歧义
3. `CHANGELOG.md` —— 记录变更

## 四、实现改动（契约先行，改动最小化）

| 文件 | 改动 | 说明 |
|---|---|---|
| `electron/services/search/constants.ts` | 新增 2 个常量 | 与 §零.3 同源 |
| `electron/services/search/intent.ts:158` | `pureEnglishProducts.slice(0, LIMIT)` | 产品词封顶 |
| `electron/services/search-service.ts:361-367` | 同上，补 `slice` | 消除与 `keywords` 的不对称 |
| `electron/services/search/intent.ts` | **过滤非英文/含控制词的产品词** | 剔除原始中文输入 |
| 变体生成后 | **去重 + 截断到 `SEARCH_VARIANT_LIMIT`** | 总量兜底 |

## 五、预期效果

| 项 | 现状 | 优化后 |
|---|---|---|
| 关键词变体 | 17 | **≤8** |
| SerpApi 请求 | 53 | **约 20-25**（降 55%+） |
| LLM 请求 | 60 | 50（受评分条数上限约束，不变） |
| **免费额度可支撑搜索次数** | **约 2 次** | **约 4-5 次** |

> 注：LLM 60 次略超 `SEARCH_LLM_SCORE_LIMIT=50`，因含意图变异 + 解析等额外调用，
> 属正常开销，本次不动。

## 六、验证计划（AGENTS.md 要求）

1. **单测**：`npm run test:unit`（含宪法常量守护测试 `verify-doc-consistency.cjs`）
2. **规范一致性**：`npm run verify:consistency`（宪法常量表 ↔ 代码事实源比对）
3. **实测**：打包版跑一次搜索，统计变体数与 SerpApi 调用数，与预期对比
4. **回归**：确认 `四级弹性搜索协议` 未被破坏

## 七、范围声明（不做的事）

- **不改** `SEARCH_FANOUT_CONCURRENCY` / `SEARCH_LLM_CONCURRENCY`（宪法红线）
- **不改** `SEARCH_LLM_SCORE_LIMIT = 50`（宪法裁定值）
- **不做**「搜索档位 UI」（本期先收敛默认值；档位是后续增强）
- **不删**任何 Provider（只收敛**变体数**，Provider 清单不动）
