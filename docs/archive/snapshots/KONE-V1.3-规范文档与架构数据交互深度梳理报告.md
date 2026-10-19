# KONE V1.3 规范文档体系与架构数据交互 深度梳理报告

> **报告性质**：治理级审计 + 优化建议（非时点快照，可作决策依据）
> **审计对象**：`C:\Users\Administrator\Kone-System` 全部规范文档 + `electron/`（56 个 TS）+ `src/`（89 个文件 / 19,712 行）+ `tests/` + CI
> **审计方法**：规范文档逐条精读（16 组文件）+ 代码静态审计（含 grep 复核）+ 构建产物实测
> **证据口径**：所有结论标注 `文件:行号` 或实测命令输出；未能确认项显式标注
> **报告日期**：2026-09-22
> **现行发布判定**：`NO-GO`（依 `CLOUD-COLLABORATION-DELIVERY.md §0`，本报告未改变该判定）

---

## 摘要

项目已具备**远超同阶段产品的规范密度**：13 份活规范 + 4 份审计快照 + 4 份 Agent 蓝图，覆盖并发红线、评分权重、状态机、Provider 能力、云端门禁、发布门禁。**规范的"量"不是问题，问题在"质"与"落地机制"**。本次审计确认三类系统性缺陷：

| 类别 | 核心问题 | 数量 | 严重度 |
|---|---|---|---|
| **规范体系** | 权威源自身存在过时函数名与自相矛盾条款；同一规则在 4–6 处被数值复述；"目标态"被多处当作"已交付"引用 | 25 条冲突 + 35 条歧义 | P0–P2 |
| **架构落地** | 文档声称的 3 项"强制机制"经代码核实**未生效或未开始**（IPC 注册中心迁移率 0%、Agent 管道时空隔离在人工确认后失效、follow-up 调度器从未接线） | 8 条文档-代码偏差 | P0 |
| **前端与性能** | 设计系统实际**未生效**（278 处语义类生成 0 条 CSS）；主进程每次配置写入全量同步落盘；流式评分每帧全量重建数组 | 20+ 条 | P0–P1 |

### 严重度矩阵（Top 12 发现）

| # | 发现 | 域 | 级别 | 证据 |
|---|---|---|---|---|
| 1 | Tailwind v4 缺 `@theme`，`bg-card`/`text-foreground`/`border-border` 等 278 处语义类**未生成任何 CSS**（30 个组件受影响） | 前端/视觉 | **P0** | `src/index.css:1-28` 无 `@theme`；`dist/assets/index-*.css` 中上述类计数均为 0 |
| 2 | IPC 注册中心迁移率 **0%**，`registry.attach()` 实际绑定 0 个通道；`assertAllRegistered()` 未启用 | 架构 | **P0** | `registerIpc()` 生产调用 0 处（`main.ts:92` 仅注释）；`registry.entries` 为空 |
| 3 | Agent 管道 `currentPipelineRunId` 隔离在用户点击"开始触达"后**失效**（`startAgent(..., undefined, ...)`），陈旧任务防重形同虚设 | 架构/正确性 | **P0** | `agent-service.ts:1248/1256`；`agent-pipeline.ts:122-126` 的 `finally` 已清空 |
| 4 | `kone-PRD.md`（权威源）**自身**仍写已废弃函数名 `computeLeadScore`/`enrichLeadWebsite`，且同文件另处写正确名 | 规范 | **P0** | `kone-PRD.md:169-170` vs `:242`；勘误只在 `PROJECT-PRD.md:934`、`AGENTS.md:138` 生效 |
| 5 | `startFollowupScheduler` **导出但全仓 0 调用** → 多轮邮件 follow-up 能力实际从未运行 | 功能 | **P0** | `agent-service.ts:894` 定义；`grep` 全仓仅此一处 |
| 6 | `NativeStore.flushToDisk()` 每次 `set()` 全量 `JSON.stringify` + `writeFileSync` + `fsync` **同步**落盘；Agent 回写一次触发 2 次 | 性能 | **P0** | `config-service.ts:100/136-151`；`agent-service.ts:269-271` |
| 7 | 搜索流式评分**每收到一帧**即对 `searchResults` 全量 `.map()` 重建并整体替换 store 引用 | 性能/UX | **P1** | `use-search-engine.ts:472-528` |
| 8 | 2.5MB PNG（`src/logo.png`）被**活代码** `app-sidebar.tsx` 引用，首屏即加载；另有一份 2.5MB 同名素材仅被死代码引用 | 性能 | **P1** | `app-sidebar.tsx:7`；`kone-logo.tsx:2-3`（0 引用） |
| 9 | `SEARCH_LLM_SCORE_LIMIT` 数值在文档间矛盾（20 vs 50），且**权威源常量表根本没有该常量** | 规范 | **P1** | `ARCH-STANDARDS.md:214`（50）vs 三份审计（20）；`kone-PRD.md §零` 无此项 |
| 10 | `yellow_pages` 在 `kone-PRD.md` **同一文件内**既列为"可用 Provider"又列为"已弃用" | 规范 | **P1** | `kone-PRD.md:100` vs `:161` |
| 11 | 关键词变体层 `Promise.all` **无并发上限**，与"最大并发 Job 强制为 2"的宪法语义冲突 | 架构/性能 | **P1** | `search-service.ts:2788`；`kone-PRD.md:142` |
| 12 | 备份校验算法文档仍写 MD5，实现已改 SHA-256；三份活规范未回写 | 规范/安全 | **P1** | `ARCH-STANDARDS.md:291`、`kone-PRD.md:413`、运维手册 vs `Phase 1-2 实施变更记录.md:705-718` |

---

# 第一部分 · 规范文档体系梳理与精简方案

## 1. 文档资产全景

| # | 文件 | 体积 | 定位 | 声明 SSOT | 现行状态 |
|---|---|---|---|---|---|
| 1 | `kone-PRD.md` | 53KB | V1.3 二次开发规范法典 | ✅ 全局唯一权威需求主源头 | **活规范（权威）** |
| 2 | `PROJECT-PRD.md` | 83KB | 代码扫描生成的全景 PRD | ❌ 自认下位（`L5`） | **活规范（下位）** |
| 3 | `ARCH-STANDARDS.md` | 26KB | 架构/安全/性能硬边界 | ✅ 架构 SSOT（`§16.1`） | **活规范** |
| 4 | `CLOUD-COLLABORATION-DELIVERY.md` | 10KB | 云端协同与投递 | ✅ 云端 SSOT | **活规范（目标态）** |
| 5 | `PROVIDER-CAPABILITY.md` | 4KB | Provider 真实能力 | ✅ Provider 唯一事实源 | **活规范** |
| 6 | `AGENTS.md` | 14KB | 多 Agent 防回归协议 | ❌ | **活规范** |
| 7 | `V1.2-商业版交付与运维手册.md` | 13KB | 交付/运维/发卡 SOP | ✅ operations（`ARCH-STANDARDS.md §16.1`） | **活规范** |
| 8–11 | `.opencode/agents/{ui,ipc,system-blueprint,build}-agent.md` | — | 4 份 Agent 蓝图 | ❌ | **活规范（角色契约）** |
| 12 | `KONE-V1.3-对齐审计分析报告.md` | 39KB | 时点审计快照 | ❌ 自述非活规范 | 快照 |
| 13 | `KONE-V1.3-深度审计报告与优化执行计划.md` | 23KB | 时点审计快照 | ❌ | 快照（**未列入 `kone-PRD.md:21` 快照清单**） |
| 14 | `KONE-V1.3-优化计划.md` | 17KB | 时点执行计划 | ❌ 自述非活规范 | 快照 |
| 15 | `KONE-V1.3-商用上线就绪度审计报告.md` | 17KB | 时点审计快照 | ❌ | 快照 |
| 16 | `KONE-商用成熟度深度审计报告.md` / `V1.2-to-V1.3-alignment.md` | 1.6KB×2 | **墓碑桩** | ❌ | **应物理删除（未执行）** |
| 17 | `kone-.md` | 14KB | 方法论北极星（非实装规格） | ❌ | 活文档（命名异常） |
| 18 | `kone项目使用说明.markdown` / `README.md` | 12KB / 5KB | 用户向营销/上手 | ❌ | 活文档（**含过期宣传口径**） |
| 19 | `2026-09-15/`（4 份）、`2026-09-20/`（2 份） | — | 审计/计划/变更记录 | ❌ | 归档区 |
| 20 | `b2b-content-os-optimization/optimization_report.md` | 35KB | **与项目无关**的内容营销系统报告 | ❌ | 已被 `.gitignore` 排除（本地残留） |

**结论**：文档总量约 300KB，其中**真正承担强制约束的只有 7 份**（#1–#7），其余为快照、归档、用户向材料。**"精简"的靶心不是删内容，而是消灭同一规则的多次复述。**

## 2. 权威链现状：声明与实际治理面不符

`AGENTS.md:12-21` 规定强制读链为 **8 份**，但实际 SSOT 集合为 **10 份**——遗漏 `PROVIDER-CAPABILITY.md` 与 `CLOUD-COLLABORATION-DELIVERY.md`，而 `AGENTS.md:114` 又要求"在强制文档链之后"补读后者，形成"链外补充"的结构性漏洞。

```
声明读链（8）                          实际治理面（10）
─────────────────────────              ─────────────────────────
kone-PRD.md          ← 权威            kone-PRD.md          ← 需求 SSOT
PROJECT-PRD.md                         PROJECT-PRD.md
ARCH-STANDARDS.md                      ARCH-STANDARDS.md    ← 架构 SSOT
ui-agent.md                            ui-agent.md
ipc-agent.md                           ipc-agent.md
system-blueprint.md                    system-blueprint.md
build-agent.md                         build-agent.md
V1.2-商业版交付与运维手册.md             V1.2-商业版交付与运维手册.md
                                       + PROVIDER-CAPABILITY.md      ← 遗漏
                                       + CLOUD-COLLABORATION-DELIVERY.md ← 遗漏
```

## 3. 规范冲突清单（25 条，按严重度）

### 3.1 P0 — 权威源自身错误或自相矛盾（4 条）

| ID | 规则 | 冲突 | 证据 |
|---|---|---|---|
| **C-1** | 搜索评分/富化函数名 | `kone-PRD.md:169` 写 `computeLeadScore`、`:170` 写 `enrichLeadWebsite`；同文件 `:242` 写正确的 `emitLeadScored`。勘误只落在 `PROJECT-PRD.md:934`、`AGENTS.md:138`，**权威源漏改**。这直接违反 `ARCH-STANDARDS.md:340`「CI must fail on stale function names」 | `kone-PRD.md:169-170` vs `:242` |
| **C-4** | `yellow_pages` 是否可用 Provider | 同文件内 `:100` 列入"可用的 `yellow_pages` Provider"，`:161` 又列"⛔ 已弃用" | `kone-PRD.md:100` vs `:161`；`PROJECT-PRD.md:747` vs `:183` |
| **C-13** | IPC 注册 SSOT 是谁 | `ARCH-STANDARDS.md:47` 称 `registry.ts` 为 runtime SSOT；同文件 `:334`（§16.1）又称 SSOT 是 `ipc-contracts.ts + channels.ts`；`kone-PRD.md:18` 采用后者 | `ARCH-STANDARDS.md:47` vs `:334` |
| **C-21** | "宪法常量只此一份" | `kone-PRD.md:24` 要求"其余文档只能指针引用、不得改写数值"，但 `kone-PRD.md` 自身在 `:90-94`、`:184-201` 复述权重，`PROJECT-PRD.md:734/749/944-949`、`ARCH-STANDARDS.md:184-186/221`、`system-blueprint.md:87-88`、`build-agent.md:80` 均数值复述 | 6 份文档、10+ 处 |

### 3.2 P1 — 数值/语义直接矛盾（8 条）

| ID | 规则 | 冲突 | 证据 |
|---|---|---|---|
| **C-2** | LLM 评分条数上限 | `ARCH-STANDARDS.md:214` 称 `SEARCH_LLM_SCORE_LIMIT = SEARCH_TARGETED_LEAD_LIMIT = 50`；三份审计均记 `= 20`。**权威源常量表无此常量** | 50 vs 20 |
| **C-3** | 备份校验算法 | 活规范三处写 **MD5**；实现变更记录写已升级 **SHA-256** | `ARCH-STANDARDS.md:291`、`kone-PRD.md:413`、运维手册 vs `Phase 1-2 实施变更记录.md:705-718` |
| **C-5** | Provider 单测 | `PROVIDER-CAPABILITY.md:48` 称"仍无 Provider 专项单测（P2 待办）"；审计记"✅ 已落地 2026-09"；仓库实存 `tests/business-logic/provider-isolation.business.test.js` | SSOT 自述过时 |
| **C-6** | Trial 搜索限制 | `README.md:12/58` 称"10 条/次、间隔 15 秒"；权威源称 Trial = Basic 全量、唯一卡点是 PDF 3 次；审计又记默认态为 `12000ms/10 条` | 三重不一致（15s vs 12000ms） |
| **C-7** | `local_autopilot` 归属 | `kone-PRD.md:54` 列在 **Paid Basic 核心能力集**；`PROJECT-PRD.md:248` 称 Premium/Enterprise **独占** | 归属矛盾 |
| **C-8** | Agent 日频来源 | 宪法要求"以 `userConfig` 为准，代码不得硬编码"；两份审计记"未修：硬编码未读 userConfig"。（代码审计显示**已部分修复**——`agent-service.ts:1000-1006` 先读 `userConfig.agentDailyLimits`，仅缺失时回落硬编码默认值。**规范与审计双方均未同步**） | `kone-PRD.md:34`、`AGENTS.md:96` |
| **C-12** | 状态机 | `PROJECT-PRD.md:519-520` 定义 4 态 `LeadStatus` 且 **`FollowUpStatus = LeadStatus`**；云端 SSOT 定义 6 态 `FollowupStatus`——**同名不同义** | `PROJECT-PRD.md:519-520` vs `CLOUD-COLLABORATION-DELIVERY.md:65` |
| **C-14** | 并发上限 2 的适用范围 | `kone-PRD.md:142` 措辞覆盖"多维多渠道爬取"，但实现仅约束评分/富化；关键词变体层为无界 `Promise.all` | `search-service.ts:2788` |

### 3.3 P2 — 漂移、过期、治理遗漏（13 条）

| ID | 问题 | 证据 |
|---|---|---|
| **C-9** | `AGENTS.md` 内部对 LinkedIn 日频自相矛盾：`:89` 给 `≤30/day`，`:163` 写 "determined by session" | `AGENTS.md:89` vs `:163` |
| **C-10** | 两套 ICP 权重（Stage-1 40/30/20/10 vs Stage-2 55/35/10/20）虽已裁定"分层共存"，但外部读者需读到 `kone-PRD.md:227` 才能区分 | `kone-PRD.md:205/227` |
| **C-11** | `KONE-V1.3-深度审计报告…md` 同文件 `:68` 判"缺 55/35/10"、`:155` 判"✅ 已落地" | 同文件自相矛盾 |
| **C-15** | `kone项目使用说明.markdown:121` 附录路线图把**已落地**能力列为"核心待实现"，并用易被读成官方直连的"海关进出口提单数据"措辞 | 违反 `PROVIDER-CAPABILITY.md:23` 宣传口径 |
| **C-16** | `README.md:58`/使用说明写 Basic "无限制"；权威源写"单次最高 100 条" | 上限语义冲突 |
| **C-17** | 使用说明内部 60 分 / 80 分阈值并存未说明各自语义 | `:21` vs `:62` |
| **C-18** | `AGENTS.md` 8 文档链漏列 2 份 SSOT | 见 §2 |
| **C-19** | 规范宣称两份墓碑"已清除归档"，物理删除未执行 | `kone-PRD.md:21` vs 实际文件 |
| **C-20** | `kone-PRD.md:21` 快照清单漏列 `KONE-V1.3-深度审计报告与优化执行计划.md` | 治理清单不完整 |
| **C-22** | `PROJECT-PRD.md:3` 自称"唯一权威"与 `:5` 自称"下位引用"矛盾；且 §2 数据字典 / §3.7 Provider 表大段重定义 | 违反 `ARCH-STANDARDS.md:337` |
| **C-23** | `PROJECT-PRD.md:1688` 的 `execute()` 返回类型与 `kone-PRD.md:277` 的 `ProviderExecuteResult` 不一致（已加注"勿据此实现"但未清理） | 草案与正文并存 |
| **C-24** | `build-agent.md:40` 硬编码 `main.ts lines 82-84`，行号必然漂移且无 CI 校验 | 引用脆弱 |
| **C-25** | HTTP 熔断触发条件：`system-blueprint.md:229` 限定 4xx；`kone-PRD.md:411` 未限定（5xx 行为未定义） | 语义不一致 |

> **附带发现**：`AGENTS.md:128` 称 "`dist-electron/` … may be tracked in the current repository history"，但实测 `dist-electron/electron/main.js` **未被跟踪**（`.gitignore` 已排除）。规范描述与仓库现状不符。

## 4. 歧义清单（35 条，无法被 CI 机械校验）

按类型归纳，附可机械化的改写方向：

| 类型 | 条数 | 代表条款 | 机械化改写方向 |
|---|---|---|---|
| **开放式枚举**（"等/如/such as"） | 6 | `kone-PRD.md:143`「Script、Style、SVG、导航栏垃圾、Cookie 弹窗文本**等**」；`:212`「Amazon/eBay/AliExpress/Shopee**等**」 | 改为封闭枚举 + 版本号，新增项须走变更流程 |
| **主观程度词** | 6 | `ui-agent.md:4`「quiet」、`:86`「restrained, low-noise」；`PROJECT-PRD.md:841`「**明显**泛化/偏题」 | 量化为阈值或改为设计评审项，移出可校验规范 |
| **未定义限定词** | 5 | `kone-PRD.md:333`「**有效**审批记录」；`CLOUD-COLLABORATION-DELIVERY.md:98`「**受控例外**」 | 「有效」→ 指针化 `ApprovalRecord` 字段清单；「受控例外」→ 定义审批人角色与记录字段 |
| **建议与硬约束混排** | 4 | `KONE-V1.3-优化计划.md:15/32` 的"建议/推荐"与 P0"必须"同段 | 引入 RFC 2119 关键词（MUST/SHOULD/MAY），CI 只校验 MUST |
| **落地标记体系不统一** | 4 | 同文件并存 `[已落地]`、`[已落地 2026-09]`、`[部分落地 2026-09]`、`[路线图]` 四种，无枚举定义 | 固定四值枚举 + YAML front matter 机器可读 |
| **数值语义歧义** | 5 | `kone-PRD.md:34`「WhatsApp **3-5/day**」（区间）；`:387` 投诉率 `[0.1%,0.3%)` 区间行为未定义 | 区间改 `min/max` 两字段；补区间内行为 |
| **"以 X 为准"但 X 未定义** | 5 | `kone-PRD.md:34`「以 `userConfig` 为准」——**`userConfig` 日频字段 schema 无任何 SSOT 定义** | 补 `user-config.schema.md` 字段字典 |

## 5. 冗余与可精简项

| 冗余群 | 重叠证据 | 处置建议 |
|---|---|---|
| **4 份 KONE-V1.3 审计报告** | 同一批问题（双管道读端缺失、Email 链路、LinkedIn 断链、IPC 注册中心、20/50 评分）在 3–4 份中重复论述 | 合并为单一 `CHANGELOG.md` 时间线；正文转 `archive/` |
| **`PROJECT-PRD.md` ↔ `kone-PRD.md`** | 数据字典（§2 vs §三）、四级搜索（§宪法级 vs §二.2）、Provider 表（§3.7 vs §0.8）、Agent 矩阵（§3.7.7 vs §六）大段重复 | `PROJECT-PRD.md` 降级为"模块实现索引 + 时序图"，删除全部数值与字段定义，改为指针 |
| **4 份 `.opencode/agents/*.md` ↔ `ARCH-STANDARDS.md`** | 并发 2 / 3000 字符 / 四级降级文案 / 状态语义各写一遍（共 4+ 处） | 蓝图只保留"角色职责 + 交付物 + DoD"，数值一律指针 `ARCH-STANDARDS.md` |
| **运维手册 §八 ↔ `kone-PRD.md §七.3`** | V1.4 清单逐条重复 | 运维手册只保留 SOP 与命令，能力清单指针权威源 |
| **2 份墓碑桩** | 内容已清空，物理删除未执行 | 直接 `git rm` |
| **`b2b-content-os-optimization/`** | 与项目零关联，且已被 `.gitignore` 排除 | 移出工作区 |

## 6. 缺失的治理文档（当前以散落形式存在）

| 缺失文档 | 现状散落在 | 直接后果 |
|---|---|---|
| **术语表 Glossary** | 无 | `Stage 0.5/1/2`、`Scout/Brain`、`Gold Filter`、`SSOT`、`四级弹性搜索协议` 无统一定义 |
| **字段字典 Field Dictionary** | `PROJECT-PRD.md §2` + `kone-PRD.md §三` 两处 | 同字段两处定义 → C-12/C-22 类漂移 |
| **状态机总表** | 4 处（`kone-PRD §5.1.1`、云端 SSOT §2、`PROJECT-PRD §2.2`、`ARCH-STANDARDS §15.6`） | 4 态 / 6 态 / 7 态 三套并存无映射表 |
| **CHANGELOG** | 散落 `Phase 1 实施变更记录.md` 等 | 无版本时间线；C-3/C-11 类"实现已改规范未回写"无法被检出 |
| **`user-config.schema.md`** | 无 | C-8 类"以 userConfig 为准"无法校验 |
| **文档状态元数据规范** | 仅 2 份墓碑有 YAML front matter | 活规范与快照无机器可读区分 |

## 7. 规范文档精简优化方案（可直接落地）

### 7.1 目标文档结构（7 份活规范 + 3 份新建治理件）

```
【唯一事实源层 · SSOT】—— 每条规则只允许在此层定义一次
  kone-PRD.md                        产品行为 / 状态 / 用户旅程 / 商业边界
  ARCH-STANDARDS.md                  架构 / 安全 / 性能红线（含全部数值常量）
  CLOUD-COLLABORATION-DELIVERY.md    云端协同 / 投递 / 抑制 / Webhook
  PROVIDER-CAPABILITY.md             Provider 真实能力与宣传口径
  FIELD-DICTIONARY.md            ★新  字段字典（LeadItem/AgentTask/AgentState/userConfig…）
  STATE-MACHINES.md              ★新  状态机总表（本地简化态 ⇄ 云端业务态映射）
  GLOSSARY.md                    ★新  术语表

【流程/角色层 · 只写职责，不写数值】
  AGENTS.md                          多 Agent 协作与防回归协议
  .opencode/agents/*.md ×4           角色契约与交付物

【运维层】
  V1.2-商业版交付与运维手册.md         SOP / 命令 / 发卡 / 回滚

【归档层 · 不参与裁决】
  archive/audits/*.md                4 份审计快照（冻结）
  CHANGELOG.md                   ★新  版本变更时间线（含"实现变更 → 规范回写"记录）
```

### 7.2 五步落地动作

| 步骤 | 动作 | 验收标准 |
|---|---|---|
| **S1 止血** | 修复权威源 4 处 P0：`kone-PRD.md:169-170` 函数名、`:100` 删除 `yellow_pages`、`ARCH-STANDARDS.md:47` 与 `:334` 统一 IPC SSOT 表述、`:21` 快照清单补全 | 权威源内 `grep` 无过时函数名；无同名规则双定义 |
| **S2 去复述** | 在 `kone-PRD.md §零` 建立**唯一常量表**（含当前缺失的 `SEARCH_LLM_SCORE_LIMIT`）；其余文档所有数值改为 `→ 见 kone-PRD.md §零` | 全仓 `grep` 数值型常量（`2`、`3000`、`60`、`20`、`50`、`7`…）仅命中常量表与 CHANGELOG |
| **S3 建治理件** | 新建 `FIELD-DICTIONARY.md` / `STATE-MACHINES.md` / `GLOSSARY.md` / `CHANGELOG.md` | 字段与状态各只有一处定义；三套状态机有明确映射表 |
| **S4 机械化** | 引入 RFC 2119 关键词；文档头统一 YAML front matter（`status`/`authoritative`/`ssotFor`/`lastVerifiedAt`/`asOfCommit`） | CI 可判定活规范/快照；歧义条款归零 |
| **S5 门禁化** | CI 新增 4 个校验 job（见 §21 的 P0-9） | 任一漂移即 CI 红 |

### 7.3 文档头模板（强制）

```yaml
---
title: KONE 架构标准
status: active            # active | target-state | snapshot | archived
authoritative: true       # 是否具裁决权
ssotFor: [architecture, security, performance]
supersedes: null
asOfCommit: <sha>
lastVerifiedAt: 2026-09-22
---
```

> **价值**：`status: target-state` 可让 CI 自动拒绝"把目标态当已交付宣传"的文案（当前 C-6/C-15/C-19 三类问题均由此产生）。

---

# 第二部分 · 架构与数据交互梳理

## 8. 系统分层与真实数据流（代码实测）

```
┌─ Renderer (src/, React 19 + Zustand 5) ──────────────────────────┐
│  dashboard-page.tsx（useState 状态机路由，无 URL 路由）             │
│  12 × React.lazy 页面 chunk  |  leads-store / autopilot-store      │
│  use-search-engine.ts（6 个流式事件订阅，871 行）                   │
│  electron-api.ts（53 个导出函数，唯一 IPC 封装层）                  │
└───────────────────────┬──────────────────────────────────────────┘
                        │ contextBridge（59 个方法/订阅器）
┌───────────────────────▼─ preload/index.ts ───────────────────────┐
│  所有 on* 均返回 removeListener（解绑实现正确）                     │
└───────────────────────┬──────────────────────────────────────────┘
                        │ IPC：60 通道（49 handler + 11 仅推送）
┌───────────────────────▼─ Main (electron/) ───────────────────────┐
│  search-service.ts (3826 行) ← 搜索主链路 + analysis:generate      │
│  agent-service.ts  (1273 行) ← 3 Agent 执行 + 双管道回写           │
│  license-service.ts(1046 行) ← 授权 + registerSecureIpc 包装器      │
│  supabase-service.ts(583 行) ← 云端防撞/上云/Realtime              │
│  config-service.ts (495 行) ← NativeStore（JSON 全量同步落盘）      │
│  providers/ ×8 · agents/ ×4 · utils/ ×5                          │
└──────────────────────────────────────────────────────────────────┘
```

### 8.1 搜索主链路（真实调用链）

```
handleSearchExecute (search-service.ts:2500)
├─ myJobId = crypto.randomUUID()                    :2514
├─ activeJobIds.set(senderId, myJobId)              :2517   ← 多窗口隔离（P3-2 已落地）
├─ mutateSearchIntent() → LLM 意图解构               :2566
├─ searchPlans = await Promise.all(关键词.map(...))  :2788   ⚠ 无并发上限
│   └─ registry.executeAll() → Promise.allSettled    provider-registry.ts:124
├─ normalizeSearchResponseCandidates()              :3042
├─ Scout 预过滤：isTrashLead → computeScoutRelevance  :3063-3069
├─ Eligibility Gate 一票否决                        :3088
├─ computeIcpMatchScore 确定性评分                   :3139-3148
├─ targetedLeads = slice(0,50)                      :3165
├─ emitBasicResults() ← 首屏解锁（matchScore: undefined）:3176
├─ executeScoring()
│   ├─ runLimitedConcurrency(评分, 2)                :3271   ✅ 并发=2
│   └─ runLimitedConcurrency(富化, 2)                :3408   ✅ 并发=2
├─ 慢源二波：Promise.race([lateSources, setTimeout(120s)]) :3498 ⚠ timer 未清理
├─ emitStreamComplete()                             :3569
└─ withPipelineIsolation(runId => stageAgentsFromPipeline(...)) :3571 ⚠ 未 await、无 .catch
```

**实测并发与阈值**：评分并发 `2`（`:187`）、富化并发 `2`（`:188`）、评分条数 `50`（`:186`）、目标线索 `50`（`:182`）、单渠道抓取 `100`（`:181`）、LLM 超时 `20s`、官网探测 `15s`、慢源上限 `120s`。
**`myJobId` 隔离生效点**：`search-service.ts` 13 处 + 7 个活跃 Provider 各 1 处（共 20 处）；`yellow-pages-provider.ts` 无隔离但 `isAvailable()` 恒 `false`、永不派发。
**流式事件**：`stream-start` / `stage` / `basic-results` / `lead-scored` / `stream-complete` / `stream-error`（6 类，闭环完整）。

### 8.2 Agent 双管道

```
AgentTaskQueue { whatsapp, linkedin, email }   agent-pipeline.ts:29-33
buildAgentTaskQueue()  ← matchScore>=60 且有 email|phone|linkedinUrl   :66-117
writeBackAgentStatus()  agent-service.ts:252-285
  ├─ 管道 A 持久化：agentStatusStore.set + persistAgentStatuses() → config.json  :269-270
  ├─ 管道 B 运行时：agents.get('agent-'+type) → emitAgentStatus() → AGENT.STATUS_CHANGED  :281-284
  └─ IPC 推送：AGENT.LEAD_STATUS_UPDATED  :276
```

**判定**：三处回写**真实存在**（与文档一致）；但 `currentPipelineRunId` 隔离在人工确认后失效（见 P0-3）。
**未发现 `setTimeout` 假成功**：`whatsapp-agent.ts:171-186` 仅在探测到真实 tick 时 `delivered`，`agent-service.ts:587` 明确注释 never assume delivered。**此项规范落实良好。**

## 9. 前后端数据交互契约现状

| 维度 | 现状 | 评价 |
|---|---|---|
| IPC 契约定义 | `src/shared/ipc-contracts.ts`（771 行 / 500+ 类型）+ `electron/ipc/channels.ts`（60 通道） | ✅ 命名源唯一 |
| 运行时校验 | `contracts/types.ts:112/124` 仅在 `!app.isPackaged` 时校验，**生产直接 `return { valid: true }`** | ⚠ 线上零校验 |
| 契约文件利用率 | `search-execute.contract.ts` / `analysis-generate.contract.ts` 仅测试引用；`autopilot.contract.ts` **全仓 0 引用** | ⚠ 死代码 |
| 注册 SSOT | 49 个 handler 全部直挂或经包装器，**经 registry 注册的为 0** | ❌ 目标态未启动 |
| 启动门禁 | `assertAllRegistered()` 未启用 | ❌ |
| 渲染层封装 | `electron-api.ts` 53 函数 + `ElectronApiError` + `withTimeout` | ✅ 有统一层 |
| 全局 loading / 重试规范 | **无**（重试仅 `use-search-engine.ts:585-590` 单点，`MAX_RETRIES=3`） | ⚠ 分散 |
| preload 暴露面 | 59 方法/订阅器；`config.save` 与 `config.set` 重复映射同一通道；`PROVIDER.STATUS` 有 handler 但未暴露 | ⚠ 不一致 |
| 窗口安全 | `contextIsolation: true`、`nodeIntegration: false`，但 `sandbox: false` | ⚠ 可加固 |

## 10. 关键数据链路逐条体检

| 链路 | 结论 | 关键证据 |
|---|---|---|
| **搜索链** | 分级渐进、时空隔离、Provider 失败隔离、流式闭环**均已落地且质量高**；缺陷在**无界并发**与**资源清理** | `:2788`、`:3498` |
| **Agent 链** | 三 Agent 真实执行、无假成功、日频读 userConfig；缺陷在**管道隔离失效**与**follow-up 未接线** | `agent-service.ts:1248/1256`、`:894` |
| **云端链** | 本地审批/门禁语义已在规范层定义，**实现为目标态**；代码侧 `supabase-service.ts` 全部调用**无超时** | 9 处 `await client.from(...)` 无 AbortSignal |
| **License 链** | 双锚点 + 时间回拨防护 + Fail-Closed 包装器**已落地** | `license-service.ts:553-605` |
| **持久化链** | 原子写（tmp→fsync→rename）正确；但**每次 set 全量同步落盘** | `config-service.ts:136-151` |

## 11. 文档 vs 代码 事实偏差清单（8 条）

| # | 文档声明 | 代码事实 | 判定 |
|---|---|---|---|
| 1 | `ARCH-STANDARDS.md:63` registry 是 runtime SSOT | `entries` 为空，`attach()` 绑定 0 通道 | 目标态 vs 现状（同文件 `:47/:70-72` 已诚实标注） |
| 2 | 全部 Provider 含 `myJobId` 隔离 | 7/8 有；`yellow-pages` 无（但永不派发） | 表述不精确 |
| 3 | 双管道回写 + 陈旧任务丢弃"强制" | 回写真实；`isStaleTask` 因 `runId===undefined` 恒 false | **部分不成立** |
| 4 | `kone-PRD.md:174` 称管道"监听 `search:stream-complete`" | 实为 handler 内**直接同步调用**，无该 IPC 监听器 | 实现方式描述错误 |
| 5 | `PROJECT-PRD.md:1627` 称 `taskRunId` 为丢弃依据 | 赋值存在但执行期不参与判定 | 依据不生效 |
| 6 | `main.ts:92` 注释"迁移过程中逐步增加" | 迁移进度 = 0 | 与"迁移中"不符（实为未开始） |
| 7 | `kone-PRD.md:157` 称 `provider-registry.ts` 集中管理 | `provider-service.ts:30` 另建单例；`PROVIDER.STATUS` 未在 preload 暴露 | 暴露面不一致 |
| 8 | 隐含多轮邮件 follow-up 能力 | `startFollowupScheduler` 0 调用 | **能力未接线** |

---

# 第三部分 · 框架、组件与性能梳理

## 12. 前端工程化现状

| 项 | 现状 | 问题 |
|---|---|---|
| React | 19.2.4（放 `devDependencies`） | 运行时依赖错位 |
| 状态 | Zustand 5.0.11，4 个 store | 大体按域拆分 |
| 路由 | **无路由库**，`dashboard-page.tsx:73` 用 `useState` 状态机 + 9 页 | 无 URL、无深链、无前进后退、无法直接分享页面 |
| 构建 | Vite 7.3.1 + SWC；**无 `manualChunks`** | 第三方库未拆 vendor |
| 样式 | Tailwind 4.2.1 **CSS-first**，但 `tailwind.config.cjs` 仍在 | 配置与运行时模式冲突（见 §16） |
| 依赖卫生 | 12 个 `@radix-ui/*` **0 引用**；`tailwindcss-animate` 被 require 但**未安装**；`puppeteer` 与 `puppeteer-core` 重复 | 体积与混淆 |
| 懒加载 | `dashboard-page.tsx:14-41` 12 × `React.lazy` + `Suspense` | ✅ 已做页面级分割 |

## 13. 组件层问题

**超大文件 Top 10**（可维护性红线）：

| 文件 | 行数 | 文件 | 行数 |
|---|---|---|---|
| `leads-management.tsx` | 1353 | `automation-workflow.tsx` | 761 |
| `search-engine.tsx` | 1287 | `agents-panel.tsx` | 738 |
| `analysis-drawer.tsx` | 1037 | `ui/sidebar.tsx`（**死代码**） | 726 |
| `data-center.tsx` | 980 | `settings/base-settings-tab.tsx` | 598 |
| `hooks/use-search-engine.ts` | 871 | `leads-table.tsx` | 580 |

**热点渲染**：
- `search-result-card.tsx`（365 行，列表项）**未使用 `React.memo`**
- `leads-table.tsx` **无虚拟化**（`package.json` 无任何虚拟化库）；`displayLeads.map()` 直出 `<tr>`
- `leads-table.tsx:189-208`：`useEffect` 依赖 `[leads]`，**每次 leads 变化即对全部 leadKey 并发拉取 Agent 状态**
- `data-center.tsx` 14 个 `useMemo` 全依赖 `leads` 全量，每次变化全部重算

**状态订阅混用**：`useLicenseStore` 同时存在整对象订阅（`app-sidebar.tsx:165` 订阅 8 字段）与 selector 订阅（`dashboard-page.tsx:80-84`）。实测**整对象订阅 10 处**，其中 `analysis-drawer.tsx:149` 仅用 1 个 action 却订阅全量。

**key 与重复实现**：
- `agents-panel.tsx:680` 纯 `index` 作 key
- 16 处以 `stableHash(\`...-${index}\`)` 让 index 参与 key（内容变更即强制重挂载）
- `formatErrorMessage` 在 **5 个文件**各自实现；`escapeCsvValue` ×2；国家→语言映射表 ×2；数据源标签 ×2

**死代码**：`ui/sidebar.tsx`(726)、`ui/table.tsx`、`ui/chart.tsx`、`ui/toggle.tsx`、`kone-logo.tsx` 均 0 引用。

## 14. 渲染与数据交互性能

| 问题 | 证据 | 影响 |
|---|---|---|
| **流式评分每帧全量重建** | `use-search-engine.ts:472-528`：每收到 1 帧 `onSearchLeadScored` → 对 `searchResults` 全量 `.map()` 展开 ~20 字段 → `setSearchResults(nextResults)` 整体替换引用 | 50 条线索 = 50 次 O(n) 重建 + 50 次全量重渲染；叠加 10 处整对象订阅，主线程压力显著 |
| **6 个事件重复订阅** | `use-search-engine.ts:437` 依赖数组含 `searchKeyword`/`searchCountry`，变化即重订全部 6 个事件 | 搜索期间频繁重订 |
| **toast 依赖循环** | `use-toast.ts:182` `useEffect(..., [state])` | 每次 state 变化重注册监听 |
| **重复请求** | `activation-screen.tsx:74-75` 连续两次 `refreshLicenseStatus(true)` | 启动期重复 IPC |
| **假进度** | `automation-workflow.tsx:121-123` `setInterval` + `Math.random()` 模拟进度条 | 违反"禁止伪进度"规范（云端 SSOT §12） |
| **timer 未清理** | `team-dashboard.tsx:111-129` `setTimeout` 无 cleanup | 卸载后 setState 风险 |

## 15. 资源与体积（实测）

| 产物 | 体积 | 说明 |
|---|---|---|
| `dist/` 总计 | **4.0M** | |
| `dist/assets/data-center-*.js` | **414 KB** | 含 Recharts，未拆 vendor |
| `dist/assets/index-*.js` | 347 KB | 主入口 |
| `dist/assets/index-*.css` | 95 KB | |
| `dist/assets/logo-*.png` | **2.6 MB** | 单图占产物 65% |
| 大量 <1KB 单图标 chunk | 数十个 | lucide-react 未做 barrel 优化 |

**源码侧素材**：`src/logo.png` = 2.5MB（**被活代码 `app-sidebar.tsx:7` 引用**）；`src/assets/kone-logo.png` = 2.5MB（仅被 0 引用的 `kone-logo.tsx` 引用）。二者均被 git 跟踪（`.git` 17MB 中占比显著）。

## 16. 视觉设计系统失效（P0，最影响商业观感）

**事实链**：

1. `src/index.css:1` 使用 `@import "tailwindcss" source(none)` + `@source "./"`（Tailwind v4 **CSS-first** 模式）
2. `:root` 中定义了 `--background`、`--card`、`--foreground`、`--border`、`--primary`、`--muted` 等**裸 CSS 变量**
3. **全文无 `@theme` 块**（`grep -c "@theme" src/index.css` → `0`）
4. 因此 Tailwind **不会**由这些变量生成 `bg-card` / `text-foreground` / `border-border` 等工具类
5. 实测 `dist/assets/index-*.css`：`bg-card`、`bg-background`、`text-foreground`、`text-muted-foreground`、`border-border`、`bg-primary`、`bg-muted` **全部为 0 次出现**；`--color-*` 仅含 Tailwind 默认色板（slate/blue/emerald…），**无任何语义色变量**

**影响面量化**（源码实测使用次数）：

| 类名 | 使用次数 | 类名 | 使用次数 |
|---|---|---|---|
| `text-muted-foreground` | 78 | `bg-muted` | 22 |
| `text-foreground` | 50 | `bg-destructive` | 13 |
| `border-border` | 45 | `bg-background` | 11 |
| `bg-card` | 26 | `bg-accent` / `bg-secondary` | 7 / 6 |
| `bg-primary` | 26 | | |

合计 **278 处**，分布于 **30 个组件文件**——**全部未生成 CSS**。当前界面靠 `body` 硬编码渐变（`:31`）+ `aside` 硬编码色（`:40`）+ `!important` 维持基本观感。

> **商业影响**：卡片无背景、边框缺失、次级文字无灰度层次——这是"看起来不像成熟商业软件"的**首要根因**，优先级高于任何功能优化。

**修复**（一次性、低风险）：

```css
@theme {
  --color-background: hsl(210 40% 98%);
  --color-foreground: hsl(217 33% 17%);
  --color-card: hsl(0 0% 100%);
  --color-card-foreground: hsl(217 33% 17%);
  --color-border: hsl(214 32% 91%);
  --color-input: hsl(214 32% 91%);
  --color-muted: hsl(210 20% 96%);
  --color-muted-foreground: hsl(217 16% 46%);
  --color-primary: hsl(92 65% 44%);
  --color-primary-foreground: hsl(0 0% 100%);
  --color-destructive: /* 补定义 */;
  --color-secondary: /* 补定义 */;
  --color-accent: /* 补定义 */;
  --color-ring: hsl(92 65% 44%);
}
```

同时删除 `tailwind.config.cjs`（v4 CSS-first 下不加载）并清理 `tailwindcss-animate` 引用，避免双重配置。

---

# 第四部分 · 性能与可靠性风险

## 17. 主进程阻塞与落盘（P0）

| 风险 | 证据 | 量级 |
|---|---|---|
| **全量同步落盘** | `config-service.ts:100` `set()` → `:136-151` `flushToDisk()`：`JSON.stringify(整个 store)` + `writeFileSync` + `openSync/fsyncSync/closeSync` + `renameSync`，**全部同步** | 配置越大越慢；随线索池增长线性恶化 |
| **放大链** | `agent-service.ts:146-161` 每写一条日志即 `persistAgentLogs()`；`writeBackAgentStatus`（`:269-271`）一次回写 = 2 次全量同步落盘 | 50 条线索 × 每线索多条日志 = 上百次全量写盘 |
| **内存全量驻留** | `NativeStore.data`（`:40`）常驻；`get()` 每次按 key 逐段遍历（`:70-85`）无缓存 | 线索池无上限增长 |
| **串行邮箱验证** | `automation-service.ts:97-104` `for (email of emails.slice(0,50))` 串行；单邮箱最坏 ≈17.5s（SMTP 8s + 灰名单 1.5s + catch-all 8s） | 50 条最坏 **>14 分钟**单次 IPC 不返回 |
| **DNS 串行** | `dns-service.ts:68-113` MX→TXT→DKIM(循环)→DMARC→Spamhaus 全串行 | 每次发信前阻塞 |
| **自旋等待** | `dns-service.ts:11-21` `while (active>=2) await sleep(200)` 忙轮询 | 非信号量，浪费唤醒 |

## 18. 并发与超时

| 项 | 现状 | 判定 |
|---|---|---|
| 关键词变体层 | `search-service.ts:2788` `Promise.all` **无上限**（英语 ≤4 + 各本地语言 ≤4/语言） | ❌ 违反"最大并发 2"语义 |
| Provider 聚合 | `provider-registry.ts:124` 全量并发（`Promise.allSettled` 隔离正确） | ⚠ 无闸 |
| Supabase 全部调用 | 9 处 `await client.from(...)` **无 AbortSignal / 超时** | ❌ 网络挂起即永久 pending |
| `automation-service.ts:301` | `safeFetch(webhookUrl, ...)` 无 timeout | ❌ |
| 超时覆盖 | 搜索 LLM 20s / 富化 15s / Agent LLM 20s **有**；云端**无** | 覆盖不均衡 |
| 重试 | `proxy-service.ts:67-95` 有界退避；SerpApi 重试 2 次 | ✅ 无无限重试 |

## 19. 生命周期与泄漏

| 问题 | 证据 |
|---|---|
| **webRequest 监听器重复注册** | `window-service.ts:63-66` 在每次 `createMainWindow()` 注册 `session.defaultSession.webRequest.onBeforeSendHeaders`；`main.ts:210` 与 `:242`（activate）均会触发 → **逐次累积** |
| **120s timer 未清理** | `search-service.ts:3501` `Promise.race` 中的 `setTimeout` 无 `clearTimeout` |
| **follow-up 调度器死代码** | `startFollowupScheduler`（`agent-service.ts:894`）0 调用，而 `stopFollowupScheduler` 却在 `before-quit` 注册（`:1035`） |
| **未捕获拒绝** | `agent-pipeline.ts:119-127` `withPipelineIsolation(...).finally(...)` **无 `.catch`**，且调用处未 await |
| **静默吞错** | `supabase-service.ts` 多处 `catch { return ... }` |
| **多窗口丢推** | `agent-service.ts:40` `globalSender` 为单值，`writeBackAgentStatus`/`emitAgentStatus` 只推最后窗口 |
| **沙箱轮询未随退出清理** | `sandbox-service.ts:112-149` 仅在前端断开且 `accounts.size===0` 时停止 |

## 20. 数据持久化

- 主存储：**单 JSON 文件**（`kone-config.json`），原子写正确（tmp→fsync→rename），**无 SQLite**
- 独立 JSON：`autopilot-state`、`secret-manager`（safeStorage 加密）、license anchor、crash dump、backup
- **并发写风险**：`NativeStore` 单实例同步写，进程内串行无竞态；单实例锁（`main.ts:48-51`）降低跨进程风险。但**无 WAL / 无事务 / 无版本化查询**，线索池规模化后（>数千条）读放大与写放大都会成为瓶颈
- 缓存：`serpapi-cache`（TTL 24h / FIFO 200）、`llm-score-cache`（TTL 24h / FIFO 500）均为内存实现，**每次命中做 `JSON.parse(JSON.stringify())` 深拷贝**（`serpapi-cache.ts:39`、`llm-score-cache.ts:93`）

---

# 第五部分 · 优化建议与执行路线图

## 21. P0 — 阻断项（建议 2 周内完成，完成后可重判 GO/NO-GO）

| ID | 动作 | 验收标准 | 影响 |
|---|---|---|---|
| **P0-1** | 补 `@theme` 语义色定义，清理 `tailwind.config.cjs` | `dist` CSS 中 `bg-card`/`text-foreground`/`border-border` 等 278 处类全部生成；界面截图走查通过 | 商业观感 |
| **P0-2** | 修复权威源 4 处自相矛盾：`kone-PRD.md:169-170` 函数名、`:100` 删 `yellow_pages`、IPC SSOT 表述统一、`:21` 快照清单补全 | 权威源 `grep` 无过时函数名；无同名规则双定义 | 规范可信度 |
| **P0-3** | 修复 Agent 管道隔离：`startAgent` 传入真实 `pipelineRunId`（或在 `buildAgentTaskQueue` 时冻结 runId 到任务上），移除 `runId &&` 短路 | 单测：注入跨 run 的陈旧任务必须被丢弃 | 数据正确性 |
| **P0-4** | 接线 follow-up 调度器（或在规范中明确标注为"未交付"并从宣传移除） | 二者择一，不得悬空 | 功能真实性 |
| **P0-5** | `NativeStore` 落盘改造：写入合并 + 防抖（如 300ms）+ `setImmediate` 异步写 + 日志单独文件 | 连续 100 次 `set` 落盘次数 ≤ 3；主进程 `set` 调用 P99 < 5ms | 性能 |
| **P0-6** | 补 Supabase / webhook 全链路超时（`AbortSignal.timeout`） | 断网场景 10s 内返回可读错误，不永久 pending | 可靠性 |
| **P0-7** | 修复 `window-service.ts:63` 监听器重复注册（移出 `createMainWindow` 或先 `removeListener`） | 窗口重建 5 次后监听器数量不增长 | 稳定性 |
| **P0-8** | 修复 `search-service.ts:3501` timer 泄漏；`withPipelineIsolation` 补 `.catch` | 静态检查无悬空 timer；无 unhandledRejection | 稳定性 |
| **P0-9** | CI 新增 4 个门禁 job：① 文档漂移（函数名/常量数值一致性）② 契约一致性（`channels.ts` ↔ `ipc-contracts.ts` ↔ preload）③ 打包冒烟 ④ 安全审计 | 任一漂移 CI 红 | 治理闭环 |

## 22. P1 — 高价值（4–6 周）

| ID | 动作 | 收益 |
|---|---|---|
| **P1-1** | 建立唯一常量表（含补 `SEARCH_LLM_SCORE_LIMIT`），其余文档全部改指针 | 消除 10+ 处数值漂移源 |
| **P1-2** | 关键词变体层引入并发闸（如 `runLimitedConcurrency(..., 4)`），并在宪法中明确"搜索扇出"与"评分/富化"两个独立并发域 | 消除限流与 socket 耗尽风险，同时让规范可校验 |
| **P1-3** | 流式评分改为增量更新（按 `leadId` 索引 map + `set` 局部替换，或引入 `Map` 结构 + selector 订阅） | 首屏到完成期间的掉帧与卡顿显著下降 |
| **P1-4** | `leads-table` 引入虚拟化（`@tanstack/react-virtual`）；`search-result-card` 加 `React.memo` | 千级线索渲染稳定 |
| **P1-5** | 收敛 store 订阅：10 处整对象订阅改 selector；`leads-table.tsx:189` 的 Agent 状态拉取改为按需/批量 + 缓存 | 重渲染次数下降 |
| **P1-6** | 图片治理：2.5MB logo 压缩为 WebP（目标 <60KB）；删除死代码引用的重复素材；移除未使用依赖（12 个 Radix + `tailwindcss-animate` + `puppeteer` 重复） | `dist` 预计从 4.0M 降至 ~1.4M |
| **P1-7** | Vite 补 `manualChunks`（vendor 拆分 recharts/radix/react） | 首屏 JS 下降 |
| **P1-8** | 提取公共工具（`formatErrorMessage`×5、`escapeCsvValue`×2、国家→语言表×2、数据源元数据×2）到 `src/lib/` | 消除语义漂移 |
| **P1-9** | 引入 URL 路由（`react-router`）或至少 hash 路由 | 可深链、可分享、可后退；企业采购演示友好 |
| **P1-10** | 建立统一请求层：`electron-api.ts` 增加统一超时/重试/错误码映射/loading 状态机 | 交互一致性 |
| **P1-11** | 邮箱验证改并发（并发 4–6）+ 进度流式回传；DNS 检查并行化 | 50 条验证从 >14 分钟降至 ~2 分钟 |
| **P1-12** | 文档治理件落地：新建 `FIELD-DICTIONARY.md` / `STATE-MACHINES.md` / `GLOSSARY.md` / `CHANGELOG.md`；4 份审计报告转 `archive/` | 治理面收敛为 7+4 份 |
| **P1-13** | 物理删除 2 份墓碑桩；`kone-.md` 重命名为 `METHODOLOGY-NORTHSTAR.md` | 消除噪声与命名歧义 |

## 23. P2/P3 — 中低优先级

| ID | 动作 |
|---|---|
| P2-1 | IPC 注册中心迁移：按服务分批迁入 `registerIpc()`，每批带契约 + 单测；全部迁完后启用 `assertAllRegistered()` 为启动门禁 |
| P2-2 | 契约运行时校验在打包环境启用（或至少对高价值通道启用），删除 `autopilot.contract.ts` 等死契约 |
| P2-3 | preload 暴露面收敛：去掉 `config.save` 重复映射，补齐/移除 `PROVIDER.STATUS` |
| P2-4 | 持久化层演进评估：线索池 > 2000 条时引入 SQLite（`better-sqlite3`）承载线索与日志 |
| P2-5 | 缓存深拷贝改结构化复用或 `structuredClone` 按需；FIFO 逐出改批量 |
| P2-6 | 拆分 5 个 1000+ 行组件（`leads-management` / `search-engine` / `analysis-drawer` / `data-center`）为容器 + 子组件 |
| P2-7 | 清理 16 处 `stableHash(index)` key；`agents-panel.tsx:680` 改稳定 id |
| P2-8 | 统一弹窗组件（Radix Dialog 或自研 Portal），替换 `agents-panel` 手写弹窗与 `knowledge-base.tsx:297` 的原生 `confirm()` |
| P2-9 | 窗口安全加固：评估 `sandbox: true` 可行性 |
| P2-10 | 移除假进度（`automation-workflow.tsx:121`），改真实进度事件 |
| P2-11 | 删除死代码：`ui/sidebar.tsx`(726)、`ui/table.tsx`、`ui/chart.tsx`、`ui/toggle.tsx`、`kone-logo.tsx`、`DEFAULT_FULL_LIMIT` |
| P2-12 | `AGENTS.md` 读链由 8 份扩为 10 份（补两份 SSOT） |
| P3-1 | 引入 RFC 2119 关键词与 YAML front matter 规范，CI 校验 `status`/`authoritative` |
| P3-2 | 补充 Provider 专项单测（同步更新 `PROVIDER-CAPABILITY.md:48` 的过时表述） |
| P3-3 | 建立字段字典与代码类型的一致性校验（`ipc-contracts.ts` ↔ `FIELD-DICTIONARY.md`） |

## 24. 规范治理落地机制（防止再次漂移）

```
变更提交
  ├─ 修改任何数值/字段/状态/权限/API/合规
  │    └─ 必须同 PR 更新：SSOT + CHANGELOG + 测试 + 验收证据
  ├─ CI job「doc-drift」
  │    ├─ 函数名白名单校验（源码导出符号 ↔ 文档提及符号）
  │    ├─ 常量一致性校验（§零 常量表 ↔ 全仓文档/源码数值）
  │    ├─ 契约一致性校验（channels.ts ↔ ipc-contracts.ts ↔ preload）
  │    └─ 目标态标注校验（status: target-state 的文档不得被引用为"已交付"）
  └─ 发布门禁
       └─ 沿用 `.github/workflows/ci.yml:106-125` 的 gate 逻辑（已正确拒绝非 success）
```

> 现行 CI 的 gate（`ci.yml:112-125`）**逻辑正确**（显式拒绝 `failure/cancelled/skipped/timed_out/action_required/startup_failure/stale/空`），符合 `ARCH-STANDARDS.md:340` 与运维手册 §九.3。**缺的是"内容一致性"类校验**，这正是 P0-9 的靶心。

## 25. 商业价值与竞品对标提升点

| 维度 | 现状 | 对标建议 | 预期商业收益 |
|---|---|---|---|
| **视觉专业度** | 设计系统未生效（P0-1） | 修复后统一卡片/边框/层级/空态 | **最直接**：直接影响试用转化与采购决策 |
| **首屏速度** | 渐进式发射已优化至 ~5s（git 最新提交） | 叠加 P1-6/P1-7 资源治理 | 首屏再降 40%+ |
| **长列表体验** | 无虚拟化，千级线索卡顿 | P1-4 | 大客户（万级线索池）可用性 |
| **数据可信度** | 五级邮箱验证 + 评分来源标注（AI/规则）+ 未评分三态 | 保持并强化"绝不伪造"叙事 | 差异化卖点 vs 竞品的"假高分" |
| **合规可信度** | LinkedIn 只读边界、DNS 软锁、抑制名单、收件人时区窗口 | 产品化呈现（合规报告导出） | 企业采购合规审计通过率 |
| **多窗口/多账号** | 沙箱 + 按 sender 隔离已落地 | 补齐 `globalSender` 多窗口推送 | 团队版基础 |
| **可深链/可分享** | 无路由（P1-9） | 引入路由 | 演示与协作体验 |
| **云端协同** | 规范完备，实现为目标态 | 按 `2026-09-20` 计划分阶段落地 | 团队版/企业版定价支撑 |

## 26. 验收与度量指标

| 指标 | 现状 | 目标 |
|---|---|---|
| 语义类 CSS 生成覆盖率 | 0% | 100% |
| `dist` 体积 | 4.0 MB | ≤ 1.5 MB |
| 首屏 JS（gzip 前） | 347 KB | ≤ 180 KB |
| 主进程 `set()` P99 耗时 | 未测（同步全量写） | ≤ 5 ms |
| 连续 100 次 `set` 落盘次数 | 100 | ≤ 3 |
| 50 条邮箱验证耗时 | > 14 min | ≤ 2 min |
| 流式评分期间 store 写入次数 | 50（全量重建） | ≤ 50（增量，O(1) 每帧） |
| 文档数值型常量重复定义处 | 10+ | 1（唯一常量表） |
| 权威源自相矛盾条款 | 4 | 0 |
| CI 门禁 job 数 | 6 | 10（+4 内容一致性） |
| IPC registry 迁移率 | 0% | 100%（P2 完成后） |

---

# 附录 A · 关键证据索引

| 主题 | 证据位置 |
|---|---|
| 通道总数 / 注册分布 | `electron/ipc/channels.ts`（60）；`grep ipcMain.handle`（49 注册 + 11 仅推送） |
| registry 迁移率 0 | `main.ts:92`（仅注释）；`registry.ts:116-123`；`tests/ipc-contracts-v2.test.ts:88` |
| `assertAllRegistered` 未启用 | `registry.ts:101` 定义；生产 0 调用 |
| 并发 2 / 3000 字符 | `search-service.ts:187-188`；`ARCH-STANDARDS.md:184-186` |
| 无界并发 | `search-service.ts:2788` |
| 慢源 timer 泄漏 | `search-service.ts:3501` |
| 双管道回写 | `agent-service.ts:252-285` |
| 管道隔离失效 | `agent-service.ts:1248/1256`；`agent-pipeline.ts:122-126/129-132` |
| follow-up 死代码 | `agent-service.ts:894`（定义）；`:1035`（stop 注册） |
| 全量同步落盘 | `config-service.ts:100/136-151` |
| 邮箱验证串行 | `automation-service.ts:97-104` |
| Supabase 无超时 | `supabase-service.ts:111/158/184/207/231/262/294/325/342` |
| 监听器重复注册 | `window-service.ts:63-66`；`main.ts:210/242` |
| 流式每帧全量重建 | `use-search-engine.ts:472-528` |
| 整对象订阅 10 处 | `app-sidebar.tsx:165`、`analysis-drawer.tsx:149` 等 |
| 样式系统失效 | `src/index.css:1-28`（无 `@theme`）；`dist/assets/index-*.css`（语义类 0 次） |
| 2.5MB logo 活引用 | `app-sidebar.tsx:7` → `src/logo.png`（2,555,484 B） |
| CI gate 逻辑 | `.github/workflows/ci.yml:106-125` |
| 权威源函数名过时 | `kone-PRD.md:169-170` vs `:242` |
| `yellow_pages` 自相矛盾 | `kone-PRD.md:100` vs `:161` |

# 附录 B · 建议新增术语表条目（节选）

| 术语 | 定义 | 归属 SSOT |
|---|---|---|
| `四级弹性搜索协议` | 第 0 级 AnySearch 实体穿透 → 第 1 级 Google Maps → 第 2 级参数容错重试 → 第 3 级 Organic 补位 | `kone-PRD.md §二.2` |
| `Scout / Brain` | Scout = 规则层预过滤与确定性评分；Brain = LLM 机会分与富化 | `kone-PRD.md §5.0.5` |
| `Stage 0.5 / 1 / 2` | 0.5 = Eligibility 硬否决；1 = 确定性 ICP 评分（40/30/20/10）；2 = LLM 机会分（55/35/10/20） | `kone-PRD.md §5.0.5` |
| `双管道回写` | `agentStatus`（持久化线索态）+ `AgentState`（运行时内存态 + IPC） | `kone-PRD.md §5.0.7` |
| `目标态 / 已落地` | 固定四值枚举：`[已落地]` / `[已落地 YYYY-MM]` / `[部分落地 YYYY-MM]` / `[路线图]` | 待新建 `GLOSSARY.md` |
| `SSOT` | 单一事实源：某规则唯一允许被定义的位置 | `ARCH-STANDARDS.md §16` |

---

**报告结束**。本报告不修改任何业务代码，仅产出分析结论与建议；建议按 P0 → P1 → P2 顺序推进，其中 **P0-1（设计系统修复）与 P0-2（权威源止血）** 是投入产出比最高的两项。
