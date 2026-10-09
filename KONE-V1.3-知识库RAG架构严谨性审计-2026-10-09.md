# KONE V1.3 · 知识库模块 RAG 架构严谨性审计

> 审计日期：2026-10-09
> 审计范围：`src/components/knowledge-base.tsx`、`src/lib/user-config.ts`、`electron/services/search/analysis.ts`、`electron/services/search-service.ts`、`electron/services/agents/*`、`electron/services/agent-pipeline.ts`
> 审计方法：全仓取证（每项结论附 `文件:行号`），**无证据即写"未找到"，不推测**

---

## 〇、先给结论

**用户的两个疑问，答案都是否定的：**

| 用户的问题 | 审计结论 |
|---|---|
| 是否严谨规范采用 RAG 技术？ | **否。不是 RAG。** 无 embedding、无向量库、无相似度检索 —— RAG 的三个核心要件**全部缺失** |
| 是否真实有效嵌入获客流程？ | **否。链路是断的。** 关键字段 `aiEmail` **全仓无任何写入点**，从未被赋值 |

**它实际是什么**：一个「本地纯文本条目库 + 硬编码场景关键词匹配 + 全量拼进 LLM prompt」的**提示词注入功能**。它能工作（文本确实进了 prompt），但**不是检索增强生成**，且**未接入触达闭环**。

---

## 一、知识库模块本体（现状）

| # | 维度 | 现状 | 证据 |
|---|---|---|---|
| 1 | 前端组件 | `knowledge-base.tsx`：条目列表、增删、标题/内容/标签编辑、关键词过滤 | `src/components/knowledge-base.tsx` |
| 2 | 后端服务 | **不存在**。`electron/services/` 下无任何 knowledge 专属文件 | Glob 全量核对 |
| 3 | 存储 | **本地 JSON**（`user_config` key 落盘） | `electron/services/config-service.ts:74` |
| 4 | 数据结构 | `{ id, title, content, tags, createdAt, updatedAt }` —— **无向量字段** | `src/lib/user-config.ts:51-65` |
| 5 | 文档格式 | **不支持任何文件解析**。无 `type="file"`，无 pdf/docx 解析库 | `knowledge-base.tsx` 零命中 |
| 6 | 分块 chunking | **未实现**。每条 content 整体作为一个单元 | `knowledge-base.tsx:248-253` |

**结论**：这是一个**手工粘贴纯文本**的条目库。用户**无法上传产品手册/PDF/案例集** —— 而这恰恰是 RAG 最典型的输入。

---

## 二、核心判定：是不是 RAG（重点）

### RAG 三要件逐项核验

| RAG 要件 | 是否具备 | 取证 |
|---|---|---|
| ① **Embedding 向量化** | ❌ **完全缺失** | 全仓 `src/` + `electron/` 搜 `embedding/embed/vector` —— **业务代码零命中**（唯一命中在依赖锁文件与文档） |
| ② **向量存储 + 相似度检索** | ❌ **完全缺失** | 无 pgvector/chroma/faiss/qdrant；无 `cosine`/`similarity` 计算 |
| ③ **检索增强生成** | ⚠️ **仅"拼串注入"** | 条目拼成文本注入 system prompt：`analysis.ts:198-205` |

### 它实际的"检索"是什么

```ts
// electron/services/search/analysis.ts:320-324
const scenarioKnowledgeKeywords = {
  direct_quote:      ['报价', '价格', '方案', '成本', 'quote'],
  competitor_switch: ['竞品', '替代', '对比', '替换', '竞争'],
  factory_strength:  ['工厂', '产能', '交付', '认证', '制造', '实力'],
}
// :334 打分 = 关键词出现次数（text.includes）
// :341-345 排序：命中数降序 → 同分则【按 content 长度降序】
// :338-351 兜底：未命中的条目【按内容长度】填充到 limit=5
```

**三个硬伤：**

1. **硬编码关键词表** —— 只覆盖 3 个场景、共 14 个中文词。用户的产品资料若用「定价」「性价比」「产能规模」等表述，**全部无法命中**。
2. **无相似度概念** —— 用 `String.includes()` 计数，不是检索。
3. **🟠 兜底逻辑有害** —— 未命中关键词的条目，**按"文本长度"决定是否喂给 AI**（`analysis.ts:343-345`）。长文本 ≠ 相关文本。**这会把无关的长条目塞进 prompt，稀释甚至污染 LLM 输入。**

**top-k = 5**（`search-service.ts:2567`），**无相似度阈值**（因为没有相似度）。

### 生成环节

- 条目拼为 `[KNOWLEDGE BASE DATA:]` 注入 system prompt：`analysis.ts:151-153, 198-205`
- 有来源回传（`usedKnowledgeTitles`）：`search-service.ts:2568`
- **但无 citation 到具体句子**，仅条目标题级

---

## 三、🔴 最严重发现：与获客流程的链路**是断的**

### 用户诉求
> 「知识库…能嵌入精准高效跟新客户的流程中」

即：**用我的产品资料，让 Agent 自动写出有说服力的开发信**。这是知识库对 B2B 获客的**唯一核心价值**。

### 3.1 声称的链路（文档/注释层面）

```
知识库 JSON → pickRelevantKnowledgeEntries 检索 → 拼入 prompt
  → LLM 生成 → 结果回填 aiEmail → Email Agent Stage0 消费
```
证据：`search-service.ts:2556-2573` → `analysis.ts:198` → `email-agent.ts:328-330`

### 3.2 实测结果：**链路在 `aiEmail` 处断开**

**全仓 `aiEmail` 出现处（14 处）无一为"写入"：**

| 文件:行号 | 角色 |
|---|---|
| `agent-pipeline.ts:21, 102` | 类型声明 |
| `agent-pipeline.ts:124-126` | **读取** `lead.aiEmail` |
| `agent-service.ts:241, 707, 767, 939, 979, 1096` | 类型声明 + **透传** |
| `email-agent.ts:320, 328-330` | **消费** `task.aiEmail` |

**关键否证：**

- ❌ `aiEmail` **不在 `LeadItem`**（`src/store/leads-store.ts` 零命中）
- ❌ `aiEmail` **不在 `SearchExecuteResult`**（`src/shared/ipc-contracts.ts` 零命中）
- ❌ `aiEmail` **不在 `src/` 任何位置**（前端全量零命中）

**而 `buildAgentTaskQueue(finalResults)`**（`search-service.ts:2384`）**的入参是搜索结果**：
```ts
// agent-pipeline.ts:125-126
aiEmail: lead.aiEmail?.subject && lead.aiEmail?.body ? {...} : undefined
```

→ `finalResults` 是 `SearchExecuteResult[]`，**不含 `aiEmail` 字段** → **`lead.aiEmail` 恒为 `undefined`**。

### 3.3 结论

**知识库 → AI 分析 → `aiEmail` → Agent 这条链路从未真正接通。**
分析产出的 LLM 结果**没有任何代码把它写回 `aiEmail`**，因此 Email Agent 的 Stage0 分支（`email-agent.ts:328`）**永远走不到**，只能落到兜底模板。

---

## 四、Agent 触达环节：完全不引用知识库

| Agent | 是否引用知识库 | 证据 |
|---|---|---|
| **WhatsApp** | ❌ **否** | `agents/*.ts` 对 `knowledge` **零命中**；兜底为硬编码英文模板：`whatsapp-agent.ts:158-159` |
| **LinkedIn** | ❌ **否** | 同上零命中 |
| **Email** | ⚠️ **名义上间接，实际断链** | 依赖 `task.aiEmail`（见 §三），而该字段恒为 undefined；兜底见 `email-agent.ts:347-358` |

**WhatsApp 兜底文案原文**（`whatsapp-agent.ts:158-159`）：
```ts
const text = message || `Hi ${task.company},\n\nWe noticed your business and would like to connect.\n\nBest regards`
```
**连产品名都没有** —— 用户的产品知识库、ICP 画像、价值主张**一个都没用上**。

---

## 五、数据运作机制（完整链路）

### 5.1 实际数据流

```
① 用户手工粘贴纯文本
   └ knowledge-base.tsx:241/250
② 保存 → user_config.knowledgeBase.entries
   └ knowledge-base.tsx:139-146 → config-service.ts:74（JSON 落盘）
③ 搜索/分析时实时读取全量
   └ search-service.ts:2556-2557
④ 硬编码关键词打分（无向量）
   └ analysis.ts:326-352
⑤ 取 top-5 拼入 system prompt
   └ analysis.ts:198-207
⑥ LLM 调用
   └ search-service.ts:2582-2596
⑦ 结果返回前端展示（usedKnowledgeTitles）
   └ search-service.ts:2568, 2620
⑧ ✗ 【断点】无任何代码写回 aiEmail
   └ 全仓零写入点
⑨ Agent 读 task.aiEmail → undefined → 落兜底模板
   └ agent-pipeline.ts:125 → email-agent.ts:328, 347-358
```

### 5.2 其他机制

| 维度 | 现状 | 证据 |
|---|---|---|
| 增量更新 / 重建索引 | **无索引概念**。每次分析实时读全量重新打分 | `knowledge-base.tsx:139-146` |
| 多租户 / 隔离 | **本地单机**，无 workspace 隔离 | `config-service.ts:74` |
| 性能设计 | **无**。无索引、无缓存、无并发控制 | 未找到 |
| `dev_mock` 假数据 | **存在**。`source: 'dev_mock'`、`usedFallback: true`、硬编码文案 | `analysis.ts:73-118` |
| 声明未实现字段 | `files?: unknown[]` 声明但无实现 | `user-config.ts:53` |

### 5.3 测试覆盖

**RAG / 知识库功能测试：未找到。**
`tests/` 仅有 UI 文案断言（`router-spider.spec.ts:50-54`），无检索逻辑、无注入、无链路测试。

---

## 六、结论表

| 维度 | 现状 | 判定 |
|---|---|---|
| Embedding / 向量化 | 业务代码零命中 | **❌ 未实现** |
| 向量存储 / 相似度检索 | 无任何向量库 | **❌ 未实现** |
| 检索方式 | 硬编码关键词 `includes` 计数，top-5，无阈值 | **⚠️ 关键词匹配（非检索）** |
| 兜底逻辑 | 未命中按**文本长度**填充 | **🔴 有害**（污染 prompt） |
| 分块 Chunking | 无 | **❌ 未实现** |
| 文档解析 / 上传 | 无上传控件、无解析库 | **❌ 未实现**（仅手工文本） |
| 存储 | 本地 JSON | ✅ 已实现（非向量/DB） |
| 提示词注入 | 条目拼入 system prompt + 标题级来源 | ✅ 已实现 |
| **与获客链路** | **`aiEmail` 无写入点 → 链路断裂** | **🔴 断链** |
| Agent 引用知识库 | WA/LinkedIn 零引用；Email 依赖断链字段 | **❌ 未接入** |
| 测试 | 仅 UI 文案断言 | **❌ 未实现** |

---

## 七、对用户诉求的直接回答

**Q：是否严谨规范采用 RAG？**
**不是 RAG。** 判定核心（embedding/向量检索）**完全缺失**。它是「关键词预筛 + 提示词注入」，属 RAG 的**前身形态**（2020 年前的 prompt stuffing），而非检索增强生成。

**Q：是否真实有效嵌入获客流程？**
**未嵌入。** 两个断点：
1. **WA / LinkedIn Agent 完全不读知识库**（代码零引用）
2. **Email Agent 的名义链路因 `aiEmail` 恒为 undefined 而断裂**

**用户真正要的能力**（「用我的产品资料，让 AI 写出有说服力的开发信」）——**目前无法达成**。

---

## 八、待决策：改造方向

> 以下**仅为方案选项，未实施**。请用户明确后再动手。

| 方案 | 内容 | 价值 | 成本 |
|---|---|---|---|
| **A. 打通最小闭环** | 修复 `aiEmail` 写回（分析产出 → 持久化到线索 → Agent 消费）；WA/LinkedIn 接入知识库 | **直击用户诉求**，让「产品资料 → 开发信」真跑通 | 中 |
| **B. 真 RAG 化** | 引入 embedding（可用本地 Ollama / 云端 API）+ 向量存储 + 相似度检索 + 分块 + 文档解析 | 检索质量质变；支持上传产品手册 | **高** |
| **C. 检索质量改良** | 保留无向量方案，但把「硬编码关键词 + 长度兜底」改为 LLM 语义选条（用已有 LLM 做 rerank） | 中等提升；不引入向量基础设施 | 中低 |
| **D. 诚实降级** | UI 明确标注当前能力边界（"手工条目 + 关键词匹配"，非 RAG） | 避免误导客户 | **低** |

**我的建议排序**：**A（闭环）> C（质量）> D（诚实）> B（真 RAG）**

理由：用户的**核心痛点是"能不能用来写开发信"**，而非"是否用了向量"。**A 直接解决痛点**；B 成本最高且需外部依赖（embedding API / 本地模型），宜在 A 跑通后再评估。

---

*本报告所有结论均基于仓库取证。未实施任何代码改动。*
