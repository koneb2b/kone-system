\---  
title: KONE 变更日志  
status: active  
authoritative: true  
ssotFor: [changelog]  
lastVerifiedAt: 2026-10-07  
\---

# KONE 变更日志 (CHANGELOG)

> **文档角色：版本变更时间线的唯一事实源。**>   
> 记录"实现变更 → 规范回写"的对应关系，用于消除历史上反复出现的>   
> "代码已改、规范未同步"漂移（如备份校验算法 MD5→SHA-256 长期未回写）。
>
> 记录要求：任何改动状态、数据、权限、投递、事件、公开 API 或合规规则的提交，>   
> 必须在此登记，并注明受影响的 SSOT。

---

## [1.4.32] — 2026-10-13 · 项目文档全面瘦身（删 14 份失效文档 / 4246 行；零断链）+ 交付物部分归档

### 触发
用户要求「全面严谨梳理项目文档，清除无效没价值的文档内容」——**只做文档治理，不改任何业务代码**。

### 瘦身判据（**三者其一**，可复核）
1. **被取代**：存在更新的修订版 / SSOT 覆盖同一主题；
2. **一次性冲刺文档**，其结论已完全并入 SSOT / CHANGELOG；
3. **已完成的验收清单 / 规划**，无持续参考价值。

### 安全边界（**先验证再删除**）
- **31 份受保护**：15 份强制读链（`ACTIVE_DOCS`）+ 16 份被读链引用 → **一律不动**
  （门禁 `checkDocumentReferences` 会判断链）。
- **20 份未被引用** → 逐份评估，**删 14 留 6**。
- **全部 14 份均为 git 已跟踪** → 删除**可完整恢复**（`git revert` / `git show`）。

### 删除清单（14 份 / 4246 行）
| 文档 | 判据 |
|---|---|
| KONE-V1.3-Cloudflare云地协同架构可行性与执行计划-2026-09-25.md | ① 被「修订版-09-28」取代 |
| KONE-V1.3-Cloudflare云地协同架构可行性与执行计划-修订版-2026-09-28.md | ① 被 `CLOUD-COLLABORATION-DELIVERY.md`（SSOT）取代 |
| KONE-V1.3-Cloudflare执行计划全局审查-2026-09-28.md | ② 一次性审查 |
| KONE-V1.3-架构评审与优化空间分析报告-2026-09-24.md | ① 被 `ARCH-STANDARDS.md` 取代 |
| KONE-V1.3-O1重构必要性评估-2026-09-25.md | ③ 重构已落地 |
| KONE-V1.3-上市前全面优化报告-2026-09-25.md | ② 一次性冲刺 |
| KONE-V1.3-上线前必要优化梳理-2026-09-25.md | ② 同上 |
| KONE-V1.3-高级版云端功能模块深度梳理-2026-09-25.md | ① 被云端 SSOT 取代 |
| KONE-V1.3-Agent双管道与Autopilot宪法核验-2026-09-25.md | ① 宪法已在 `kone-PRD.md` |
| KONE-V1.3-Phase2-Resend投递接入规划-2026-09-28.md | ① 投递走 Cloudflare 路径 |
| KONE-V1.3-修复验收清单-2026-10-10.md | ③ 验收已完成 |
| KONE-V1.3-客户资料导出与触达闭环梳理-2026-10-09.md | ② 结论已入 CHANGELOG |
| KONE-V1.3-全链路梳理-搜索到触达-2026-10-11.md | ② 同上 |
| KONE-V1.3-搜索API消耗治理方案-2026-10-11.md | ③ 治理已落地（常量在代码） |

### 保留（6 份，**主题仍活跃或为证据链**）
`分支与交付物治理梳理`（release 堆积待处理）· `安装包数据交互审计报告-10-12`（最新审计）·
`数据源与联系人获取计划-10-12` / `数据可信度与匹配精度计划-10-13`（**进行中的计划**）·
`知识库RAG审计-10-09` / `账号管理审计-10-09`（P0 修复的**证据链**）。

### 同步修正
- `KONE-V1.3-前端体验闭环深度梳理-2026-10-11.md`：移除指向已删文档的**悬空引用**。
- **本删除清单改为纯文本（不加反引号）** —— 因为 `CHANGELOG.md` 是 `ACTIVE_DOC`，
  门禁 `checkDocumentReferences` 会把**反引号包裹的 `.md`** 当作引用，
  在 ACTIVE_DOC 中反引号引用已删文件会被判为**断链**（本次实测 14 项判红）。
  **教训**：`ACTIVE_DOC` 中记录"已删除文档"必须用纯文本，不得用反引号。
  （此行为是门禁的**正确设计**：防止文档指向不存在的文件。）

### 验证
| 项 | 结果 |
|---|---|
| 根目录文档数 | **48 → 33** |
| `verify:docs` 交叉引用 | **185 处，✅ 零断链** |
| 项目文档悬空引用 | **0**（仅 `CHANGELOG` 中作为**历史记录**保留的 1 处，属正确行为） |
| `npm run verify:consistency` | ✅ 三绿（文档 / IPC / 云端） |

### 交付物归档（部分完成）
- **成功归档 6 项 / 2.3 GB** → `C:\Users\Administrator\Kone-ReleaseArchive-2026-10-13`
  （`release-v146` / `v147` / `v149` / `release-verify` / `release-verify2` / `release.rar`）。
- **9 项无法删除** —— `app.asar` 被系统级进程持有句柄（`Directory.Delete` 报
  `文件"app.asar"正由另一进程使用`），5 次重试均未释放。与 MEMORY 中记载的
  `EBUSY: app.asar locked` 同一根因；**需在非开发环境（干净机器/重启后）执行**。
  受影响：`release` / `release-build` / `release-final` / `release-v140`–`v145`。
- **保留不动**：`release-v148`（冒烟验证基线）、`release-v150`（最新）。
- **建议**：下次干净机器验收时执行 `rd /s /q release-v14X`（系统命令行不受 shim 拦截）。

> 注：本次同步 bump `package.json` → `1.4.32` —— 由本日新增的**版本口径门禁**强制
> （CHANGELOG 最新条目必须等于 `package.json.version`）。此为**发布元数据**，非业务代码。


## [1.4.31] — 2026-10-13 · 修复交付阻断项：版本口径对齐 + 新增版本一致性门禁 + 修正 CHANGELOG 时间线

### 背景（源自 [1.4.30] 的交付审计，2 项阻断已处理）
用户确认推进执行后，处理交付审计中发现的阻断项。

### 变更

**1) 版本口径对齐（修复「包名与内容不符」）**
- `package.json`：`1.3.15` → **`1.4.30`**。
- **问题实质**：`electron-builder` 从 `package.json` 取版本决定**安装包文件名**，
  而 CHANGELOG 已推进到 `1.4.x` 却**从未回写** → **期间产出的每一个安装包都被错误标注为 `1.3.15`**。

**2) 新增版本一致性门禁（`verify-doc-consistency.cjs` → `checkVersionConsistency()`）**
- ① `package.json.version` **必须等于** CHANGELOG 最新条目版本；
- ② CHANGELOG 条目**必须严格逆序**（最新在前）。
- 已纳入 `verify:consistency`（CI 必跑）。**变异验证**：回退版本 → 门禁**精准判红**。

**3) 修正 CHANGELOG 时间线**
- `[1.4.15]` 曾被**孤立在文件顶部**（位于最新条目之前），破坏"最新在前"的时间线。
- 已移回 `[1.4.16]` 与 `[1.4.14]` 之间。**完整性校验**：行数 2745 不变 / 条目数 46 不变 /
  `diff` 内容集合完全一致（仅顺序变化）。

**4) 安全审计报错可操作化（`security-audit.cjs`）**
- 找不到产物时**列出全部可用产物目录 + 用法提示**；
- **刻意不静默回退**到其它目录 —— 安全审计必须审**指定的那个包**，静默换包会让"审了 A、以为审了 B"成为可能。
- ⚠️ **更正**：审计报告初稿称该脚本"硬编码 `release/`"，**判断有误** ——
  它早在 2026-10-11 就已支持位置参数（`process.argv[2] || KONE_PACKAGED_ROOT || 'release'`）。

### 未执行（需决策）
- **release 产物清理**（≈6.5 GB / 17 项）：属破坏性操作 + 保留范围是业务决策。
  **建议保留 `release-v148`（冒烟报告已验证的包）+ 最新 `release-v150`**。
- **干净机器人工验收**：必须人工执行。

### 验证
| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | 全绿（0 回归） |
| `npm run typecheck` | 0 error |
| `npm run verify:consistency` | ✅ 文档 / IPC / 云端 三绿 + **版本口径一致（46 条逆序通过）** |


## [1.4.30] — 2026-10-13 · 商用交付条件与模块交互严谨性 · 深度分析报告（**发现 2 项交付阻断**）

### 触发
用户提问「本项目是否已满足商用交付条件，其他功能模块交互是否足够严谨规范」。

### 结论（证据化，非主观）
- **代码质量与架构严谨性：已达商用交付水平**（517 单测 · typecheck 0 · 一致性三绿 · 安全三件套 6/6 ·
  **Agent 不自动外发** · 授权 Fail-Closed · 崩溃类 P0 全修）。
- **交付治理：尚未达标 —— 2 项真实阻断，修复成本极低。**

### 🔴 发现的阻断项
| # | 缺陷 | 证据 |
|---|---|---|
| **D-1** | **版本号不一致** | `package.json` = `1.3.15`，而 `CHANGELOG.md` 已到 **`1.4.29`**（`[1.4.0]` 起于 2026-10-07）→ 安装包名为 `…-1.3.15.exe` 却含 1.4.x 全部变更；**且无版本一致性门禁** |
| **D-2** | **交付物堆积且同版本号** | **17 个 `release*` 目录 ≈ 6.5 GB**，每个安装包都叫 `Kone-Intellect-Setup-1.3.15.exe`（字节数不同但**文件名无法区分**）→ **拿错包风险** |

### 🟡 非阻断（交付前确认）
- **D-3** `scripts/security-audit.cjs:24` 硬依赖 `release/win-unpacked/KoneAI.exe`，当前产物在 `release-v1xx/` → **成品级安全审计门禁跑不起来**（环境前置未文档化）；
- **D-4** 自动更新实现完整但**未见端到端验证**；
- **D-5** **干净机器人工验收未做**（项目管理内存中明确的"交付前唯一必做"）。

### ✅ 已达标（关键：商用底线已守住）
- **Agent 真实外发安全**：`stageAgentsFromPipeline` 注释即 **`// Stage for human review — do NOT send.`**；
  退订门禁（`isEmailSuppressed`）+ 逐 Agent 日限额 + `waitWhilePaused` 检查点 + `isStaleTask` 时空隔离；
- 授权 Fail-Closed（`registerSecureIpc` / `registerSecureFeatureIpc`）+ 离线授权 + 机器码绑定；
- IPC 双事实源 + 启动门禁（`assertAllRegistered` + `lock()`）。

### 处置
**本报告不执行删除/改版本号**（属破坏性操作与发布决策，需用户明确指示）。
详见 `KONE-V1.3-商用交付条件与模块交互严谨性深度分析报告-2026-10-13.md`（含交付前必做 Checklist）。


## [1.4.29] — 2026-10-13 · 过度优化审计与清理（删死代码 2 处 + 删遗留脚本；S3 标注「待 S6 激活」）

### 触发
用户提问「是否存在过度优化，请严谨梳理汇总」。按用户价值取向（**拒绝过度工程化**；
**先问"用户能不能感知"，不能感知的不一律定级**）做**证据化审计**（统计每个新导出的**生产代码引用数**）。

### 审计结论：**存在 3 项，已清理 2 项、标注保留 1 项**

| 项 | 证据 | 处置 |
|---|---|---|
| `CONTACT_TIER_RANK` | 生产引用 **0**（为"高置信度优先排序"而写，**从未接入**） | **已删除** |
| `canAutoUseContact` | 生产引用 **0**（与 `canAutoDispatch` 重叠，只用后者） | **已删除**（+ 3 条对应测试断言） |
| `scripts/_coverage-final.cjs` | 一次性临时脚本长期留在仓库 | **已删除** |
| S3「推测数据护栏」 | `grep "tier: 'inferred'"` 生产代码 **0 命中** → 当前**不可感知** | **保留**（可辩护的"防御先行"，成本低）<br>**显式标注「待 S6 激活」，不得再扩张** |

> 教训：**"写了没人用的抽象，还给它写了测试"** —— 测试会制造"这块已完成"的错觉。
> 已在 `canAutoDispatch` 注释中记录，防止重复引入。

### 经审计**不属于**过度优化（用户可感知）
官网深探增强 · SerpApi 密钥回退与设置合并 · **稀疏数组崩溃修复** · **密钥变砖修复** · WhatsApp `wa.me` 手机号 ·
结果列表显示邮箱/徽标 · `%20` 解码 · Prospeo 接入 · S1 管道门禁 · S2 三档徽标 · S4a 负向 ICP · S4c 反馈闭环。

### 边际项（保留、记录在案）
403 兜底简介挖掘（免费、边际）· Prospeo 手机揭示 10 credits/条（**建议不扩大预算**，用真实数据决定）。

### 后续纪律（防再犯）
① 新增导出必须**先在调用点出现**；② 写测试前先问"生产代码用到了吗"；
③ 前置护栏必须标注**激活时间点**且不得继续扩张；④ 临时脚本**用完即删**。

### 验证
| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | **517/517**（清理 3 条死代码测试后，0 回归） |
| `npm run typecheck` / `verify:consistency` | 0 error / ✅ |
| 死代码复检 | `CONTACT_TIER_RANK` = 0 引用；`canAutoUseContact` 仅剩说明性注释 |

报告：`KONE-V1.3-过度优化审计与清理报告-2026-10-13.md`。


## [1.4.28] — 2026-10-13 · S4c：用户「相关 / 不相关」**反馈闭环**（本地、零成本，越用越准）

### 背景（核心价值缺口）
「匹配精度」是 Kone 的核心价值，但 ICP / LLM 评分都是**静态规则**，**不会因用户判断而改进**。
此前项目**完全没有**用户反馈机制（无「相关/不相关」标记）。

### 变更
1. **新增双端 SSOT** `src/shared/lead-feedback.ts`：
   - `LeadFeedbackVerdict` / `LeadFeedbackEntry` / `LeadFeedbackMap`；
   - `deriveFeedbackKey()`：**域名优先**（去 `www`、小写），缺失回退公司名小写 —— 跨轮次、跨公司名改写都命中同一实体；
   - `applyFeedbackAdjustment()`（纯函数、幂等、零副作用）：
     - `irrelevant` → `matchScore` **封顶** `FEEDBACK_IRRELEVANT_SCORE_CAP = 20`（低于管道门槛 60）+ `riskFlags`；
     - `relevant` → **小幅** `+5`（封顶 100）+ `matchReasons`；
     - 未标记 → **原样返回**。
   - 可解释信息一律**前置**插入（`applySchemaDefaults` 只保留首项，前置才不会被丢弃）。
2. **渲染层持久化** `src/lib/lead-feedback-store.ts`：存 `user_config.leadFeedback`，
   复用既有 `config:get`/`config:set` 通道 —— **不新增 IPC 通道**；
   **刻意整表读-改-写**（配置键走点号路径，而域名本身含点 `acme.com` 会被误拆成嵌套层级）。
3. **搜索链路接线**（`search-service.ts`，两处：**排序/预筛前** + **最终结果安全网**）：
   下一轮搜索即按反馈调整排序 —— 曾标「不相关」的**不再被高分推荐**。
4. **UI**（`search-result-card.tsx`）：结果卡片新增 **「相关 / 不相关」** 标记（**可撤销**：再点一次取消），
   写入失败**明确提示**（不静默失败）。

### 稳定点（**未触碰**）
四级弹性搜索协议、并发 2/2/3、总量域、Fail-Closed、单源失败隔离 —— 零改动。
反馈**全部本地**、不上云、零成本。

### 验证
| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | **520/520**（较 512 +8 反馈闭环用例，0 回归） |
| `npm run typecheck` / `verify:consistency` | 0 error / ✅ |
| **变异验证** | 去掉「不相关」封顶 → 对应断言**精准失败** |

### 说明
本项为《…下阶段落地优化计划…》**S4** 的第三项（S4c）。
S4 仅余 **S4b 评分证据绑定**（现有数字拆解缺证据）。同时把 S4a 的 `riskFlags` 改为**前置**插入，
确保「为什么被降权」不被 `applySchemaDefaults` 的 `slice(0,1)` 丢弃。


## [1.4.27] — 2026-10-13 · S4a：用户「负向 ICP」确定性护栏（此前只是 LLM prompt 里的软约束）

### 背景（真实缺口）
`negativeIcp` 此前**只出现在 LLM 评分 prompt**（`buildSearchScoringPrompt`：`Negative ICP: …`）——
属**软约束**，LLM 完全可能忽略它，把明显不符合的线索仍打高分，从而**进入 Agent 管道浪费触达额度**。
（`scout.ts` 只有硬编码的通用负向词 `SCOUT_NEGATIVE_TERMS`，**与用户自定义负向 ICP 无关**。）

### 变更
1. **新增确定性护栏**（`search/scoring.ts`，纯函数、导出可测）：
   - `parseNegativeIcpTerms()`：解析用户自由文本（逗号/顿号/分号/竖线/换行分隔，去重，剔除 <2 字符噪声项）；
   - `matchNegativeIcp()`：返回**命中的词项**（供**可解释**展示）；
   - `applyNegativeIcpPenalty()`：命中即把 `matchScore` **封顶**到 `NEGATIVE_ICP_SCORE_CAP = 20`
     （低于 Agent 管道门槛 60）+ 追加**可解释** `riskFlags`（写明命中哪个词）；未命中**原样返回**（零副作用、幂等）。
2. **接线**（`search-service.ts`）：
   - 在**排序/预筛之前**对 `scoredMergedLeads` 应用护栏（`guardedMergedLeads`）→ 同时影响初始排序、高相关过滤与首屏；
   - 在**最终结果**上再兜一次底（**安全网**：LLM 若忽略 prompt，最终分也会被封顶）。

### 为什么用「封顶降权」而非「直接剔除」
负向词是**用户自由文本**，误伤风险不可忽略。封顶让线索**仍然可见**（透明、可人工复核），
但**跨不过 60 分门槛** → 不进自动触达。**既不误伤，也不放过**。

### 稳定点（**未触碰**）
四级弹性搜索协议、并发 2/2/3、总量域、Fail-Closed、单源失败隔离 —— 零改动。

### 验证
| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | **512/512**（较 504 +8 负向 ICP 用例，0 回归） |
| `npm run typecheck` / `verify:consistency` | 0 error / ✅ |
| **变异验证** | 去掉封顶 → 「命中即封顶」断言**精准失败** |

### 说明
本项为《…下阶段落地优化计划…》**S4** 的**第一项**（S4a）。
S4 余下：**S4b 评分证据绑定**（现有数字拆解缺证据）、**S4c 用户反馈回路**（完全缺失）。


## [1.4.26] — 2026-10-13 · S3：管道**按来源档位放行** + 推测数据**发送前二次确认**

### 背景
S2 建立了「已验证 / 官网提取 / 推测」三档模型，但**尚未约束行为**。
S3 把档位落到**管道放行**与**发送前确认**两个动作点上，让「专业严谨」可执行、可测试。

### 变更

**1) 关键语义区分（双端 SSOT `contact-provenance.ts`）**
- `canAutoUseContact(tier)`：**严格** —— "能否宣称它可信"；无标注 = `false`（**不谎报**）。
- **`canAutoDispatch(tier)`**：**放行** —— "能否自动派发"；**无标注按 `extracted`**（向后兼容：
  历史数据无标注，**不得因此被整体排除**）；唯一被拦下的是**显式 `inferred`**。
- `requiresSendConfirmation(tier)`：仅 `inferred` 需二次确认（其余不打扰用户）。

**2) 管道按档位放行（`agent-pipeline.ts`）**
- 新增 `canAutoDispatchPhone(lead)`（可达性 **且** 档位放行）与 `canAutoDispatchEmail(lead)`。
- `buildAgentTaskQueue`：WhatsApp 入队改用 `canAutoDispatchPhone`；**Email 入队改用 `canAutoDispatchEmail`**
  （原为 `if (lead.email)` → 推测邮箱也会自动发信）。
- `qualifiesForPipeline`：可触达资产口径叠加档位 —— 显式 `inferred` 的联系方式**不得占用管道名额**。

**3) 发送前二次确认（`leads-management.tsx`）**
- WhatsApp 唤起前，若目标号码为 `inferred` → **不直接唤起**，弹确认对话框（展示号码 + 来源 + 风险文案），
  用户确认后才打开 `wa.me`；取消则中止。非推测档**不打扰**（走原流程）。

### 稳定点（**未触碰**）
四级弹性搜索协议、并发 2/2/3、总量域、Fail-Closed、单源失败隔离、评分权重 —— 零改动。

### 验证
| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | **504/504**（较 497 +7 档位放行用例，0 回归） |
| `npm run typecheck` / `verify:consistency` | 0 error / ✅ |
| 同步修正 | S1 的 WhatsApp 入队守卫（门禁升级为 `canAutoDispatchPhone`，**语义更强**） |

### 说明
本项为《KONE-V1.3-数据可信度与匹配精度-下阶段落地优化计划-2026-10-13》的 **S3**，
**P0「数据可信度体系」至此闭环**（模型 → 展示 → 放行 → 确认）。
下一步 **S4**：ICP 证据化评分 + 负向 ICP + 用户反馈回路。


## [1.4.25] — 2026-10-13 · S2：联系方式**来源与可信度三档模型**（verified / extracted / inferred）

### 背景（产品定位校准）
Kone 是**专业严谨的 B2B 获客工作台**，核心价值是「**匹配精度 + 策略质量**」，联系方式只是其中一个环节。
联系方式必须**说清来源与可信度**：明确区分「已验证 / 官网提取 / 推测」，默认优先高置信度，
`inferred` 不自动用于 Agent、发送前二次确认。**用低置信度数据静默填充会伤害信任**。

### 变更
1. **新增双端 SSOT** `src/shared/contact-provenance.ts`：
   - `ContactTier = 'verified' | 'extracted' | 'inferred'`；
   - `ContactProvenance`（email/phone/contact 各自的 `{ tier, source, grade?, kind? }`）；
   - `CONTACT_TIER_LABEL`（UI 统一显示名）、`CONTACT_TIER_RANK`（默认高置信度优先排序）、
     `canAutoUseContact`（**仅 verified/extracted 可自动用于 Agent**）；
   - `pickContactWithProvenance()`：**取值与来源同源**（杜绝「值来自 A、来源标成 B」的静默错标）。
2. **类型贯通**：`SearchExecuteResult`（`src/shared/ipc-contracts.ts` + `electron/services/search/types.ts` **两处镜像**）
   与渲染层 `LeadSearchResult` / `LeadItem` 新增 `contactProvenance?`；`applySchemaDefaults` **透传**。
3. **采集层产出**（`search-service.ts`）：
   - 邮箱：`pickContactWithProvenance([候选(extracted) → Prospeo(verified) → Apollo(verified) → 官网(extracted) → 提取(extracted)])`；
   - 电话：`pickBestPhoneForReach` 返回值改为 `{ phone, provenance }`（**同源**），
     优先手机不变、**回退顺序不变**（候选 > 官网 > 提取），`phoneKind` 直接采信 provenance.kind；
   - 联系人：来自候选或官网文本 → `extracted`。
4. **UI**：结果卡片为邮箱/电话渲染**来源徽标**（已验证=正向色 / 官网提取=中性色 / **推测=警示色**），
   `source` 以 tooltip 展示（来源明细可见）；**缺失档位时不渲染**（宁可不标，不可谎报 `verified`）。

### 稳定点（**未触碰**）
四级弹性搜索协议、并发 2/2/3、总量域、Fail-Closed、单源失败隔离、评分权重 —— 零改动。
本项为**纯标注增强**，不改变任何联系方式取值优先级与数值行为。

### 验证
| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | **497/497**（较 489 +8 可信度用例，0 回归） |
| `npm run typecheck` / `verify:consistency` | 0 error / ✅ |
| **变异验证** | 破坏「取值与来源同源」→ 对应断言**精准失败** |
| 同步修正 | `enrich-apollo` 的电话优先级守卫（回退顺序改由 `fallbackOrder` 表达，**顺序不变**） |

### 说明
本项为《KONE-V1.3-数据可信度与匹配精度-下阶段落地优化计划-2026-10-13》的 **S2**。
下一步 **S3**：管道按档位放行（`inferred` 不入队）+ 发送前二次确认。


## [1.4.24] — 2026-10-13 · 修复「WhatsApp 管道对座机入队」（S1：管道门禁与 SSOT 对齐）

### 背景（真实缺陷，已核实）
```ts
// electron/services/agent-pipeline.ts:133（修复前）
if (lead.phone) queue.whatsapp.push(task)   // ← 对**任何电话（含座机）**都入队 WhatsApp
```
与双端 SSOT `src/shared/phone-kind.ts`（WhatsApp 是手机 App，**座机无法注册/接收**）**直接矛盾**，
且与 UI 侧口径不一致（`leads-management.tsx` 早已用 `classifyPhoneKind` 门禁）。
**后果**：高级版自动巡航会对座机线索发起**必然失败**的 WhatsApp 任务（浪费额度、污染运行日志、不专业）。

### 变更
1. **新增 `isWhatsAppReachable(lead)`**（`agent-pipeline.ts`）：
   优先采信已贯通字段 `phoneKind`（Prospeo 已验证手机 / `wa.me` 直链 → `mobile`；
   使美国号码不会因 LNP 被判 `unknown` 而被误拒），缺失时回退双端 SSOT `canReachWhatsApp(phone, countryCode)`。
2. **入队门禁**：`if (isWhatsAppReachable(lead)) queue.whatsapp.push(task)`。
3. **资格口径修正**：`qualifiesForPipeline` 的「可触达资产」**不再把座机算进来**
   （邮箱 / LinkedIn / **可用 WhatsApp 的手机**；座机本产品无外呼能力 → 不是可触达资产）。
4. **形参类型补齐**：`qualifiesForPipeline` / `buildAgentTaskQueue` 的 lead 形参新增
   `phoneKind?` / `countryCode?`（原类型缺失，根本无法做号码判定）。

### 同步修正的测试（**它们原先把缺陷写成了期望行为**）
- `tests/e2e/agent-pipeline-integration.test.js`：`qualifiesForPipeline` 与队列用例改用 `phoneKind: 'mobile'`，
  **并新增「座机-only 高分线索不得入队」反例**。
- `tests/e2e/gate-e2e.test.js`：同上，新增座机不可 qualify 反例。
- **新增** `tests/business-logic/whatsapp-pipeline-gate.business.test.js`：
  源码守卫（禁止回退为 `if (lead.phone) queue.whatsapp.push`）+ 行为契约 + 端到端（4 条）。

### 验证
| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | **489/489**（较 485 +4 门禁用例，0 回归） |
| `npm run typecheck` / `verify:consistency` | 0 error / ✅ |
| **变异验证** | 回退为 `if (lead.phone) queue.whatsapp.push` → 源码守卫**精准失败** |

### 说明
本项为《KONE-V1.3-数据可信度与匹配精度-下阶段落地优化计划-2026-10-13》的 **S1**，已按计划落地。
稳定点（四级弹性搜索协议 / 并发 2/2/3 / 总量域 / Fail-Closed / 单源失败隔离）**零改动**。


## [1.4.23] — 2026-10-13 · 真实搜索验证 Prospeo + 结果列表显示邮箱 / WhatsApp 徽标 + 修 URL 编码残留

### 一、真实搜索验证（开发环境 · 真实 SerpApi / SenseNova / Prospeo 密钥 · `golf cart dealer USA`）

| 指标 | 结果 |
|---|---|
| 线索数 | 50 |
| 邮箱 | **6**（12%） |
| 电话 | 49（98%） |
| **WhatsApp 可触达**（`phoneKind=mobile`） | **1** |
| 联系人 | 10 |
| 来源归因 | `prospeo: 1` / `apollo: 0` |

**Prospeo 端到端打通**（实测样例）：`The Golf Cart Company` → `sam@thegolfcartcompany.com` +
**`+1 248-563-0678`（已验证手机，`phoneKind=mobile`）**，来源正确标注为 `Google Maps · Prospeo`。
**Fail-Closed / 预算 / 归因不虚标**均在真实链路中验证正确。

**覆盖率提升有限的根因（数据现实，非缺陷）**：
① 触发门槛为「高价值（`matchScore ≥ 60`）」，小微 dealer 多数分数低于该线；
② Prospeo 对小微 dealer 的库覆盖本就稀疏（早先实测 6 个域名仅命中 5 人）。
→ 若需更大覆盖，可放宽门槛或升级 Prospeo 计划（预算常量可按计划调整）。

### 二、结果列表显示**邮箱** + **WhatsApp 可触达徽标**

- `search-engine.tsx` 结果区此前**零 `email` 引用** → 用户**看不到哪些线索有邮箱**。
- `search-result-card.tsx` 新增：**邮箱 `mailto:` 直链**（`stopPropagation` 防误触卡片选中）；
  当 `phoneKind === 'mobile'` 时显示 **「WhatsApp 可触达」** 徽标（让 Prospeo / `wa.me` 成果**可见**）。
- 贯通链路：`SearchExecuteResult.phoneKind` → `LeadSearchResult.phoneKind` → 结果卡片。

### 三、修复 `%20` 等 **URL 编码残留**

实测缺陷：部分站点 `tel:` href 写作 `tel:%20615-828-7430` → 直接取用会把 `%20` 带进电话字段。
新增纯函数 `decodeContactHrefValue()`（解码失败**原样返回**，绝不抛错），应用于 `mailto:` / `tel:` 取值。

### 验证

| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | **485/485**（较 483 +2 解码用例，0 回归） |
| `npm run typecheck` / `verify:consistency` | 0 error / ✅ |
| **运行时校验** | vite 实际服务的 `search-result-card` 含 `WhatsApp 可触达` 与 `mailto:`；`dist-electron` 含 `decodeContactHrefValue` |

本轮验证消耗 Prospeo **12 credits**（余 76 / 100）。

## [1.4.22] — 2026-10-13 · 接入 Prospeo 联系人富化（**Apollo 的低成本前置**）：已验证邮箱 + 已验证手机号

### 背景

用户需用**高级版 WhatsApp** 触达，但 WhatsApp 只能发**手机号**，而官网 / Google Maps 公开电话**几乎都是座机**
（US 因 LNP 无法从号段区分）；同时**邮箱覆盖仅 12%**（实测）。Apollo 成本偏高。

### 实测成本（Prospeo **FREE 计划 100 credits/月**）

| 调用 | 成本 | 实测结果 |
|---|---|---|
| `search-person`（按域名，25 人/页；30 天内同页**免费**） | **1 credit** | 6 个真实 dealer 域名 → 命中 5 人 |
| `enrich-person`（**仅邮箱**，`VERIFIED`） | **1 credit** | `cgrasmick@golfcartservices.com` |
| `enrich-person`（邮箱 + **手机**，`VERIFIED` US mobile） | **10 credits** | `+1 717-579-2681` |

→ **邮箱成本比 Apollo 低一个数量级** ⇒ 作为**前置**：命中邮箱即**跳过 Apollo**；
**手机昂贵**（10 credits）⇒ 仅在「高价值 + 尚无手机 + 预算剩余」时按需揭示。

### 变更

1. 新增适配器 `electron/services/search/enrich-prospeo.ts`（**Fail-Closed**，与 Apollo 同款契约）：
   `search-person` 按域名找人并**优先决策者职位**，按姓名去重 → `enrich-person` 揭示联系方式；
   任何异常一律 `{ used: false }`，**绝不抛错**。
2. 接入 `search-service.ts`（作为 **Apollo 的前置**）：
   - 预算 `PROSPEO_EMAIL_BUDGET = 10` / `PROSPEO_MOBILE_BUDGET = 2`（**独立计数**，属「总量域」）；
   - **命中邮箱即跳过 Apollo**（`&& !prospeo?.email`）→ 省成本；
   - 优先级：邮箱 = 线索自带 > **Prospeo** > Apollo > 官网 > 提取；
     电话 = 候选 > **Prospeo mobile** > Apollo > `wa.me` > 官网 > 提取；
   - 归因 ` · Prospeo` / ` · Apollo`（**仅真正贡献时**标注）。
3. 密钥与设置：`SECRET_KEYS.PROSPEO_API_KEY` + `SECRET_SET_WHITELIST`（否则设置页 403 写不进，历史 P0 教训）
   + 设置页 Prospeo 卡片与提示文案。

### 稳定点（**未触碰**）

四级弹性搜索协议、并发域（2/2/3）、Fail-Closed、单源失败隔离、评分权重 —— 零改动。
Prospeo 查询在**单条线索富化步骤内串行追加**，**不提升并行线索数**。

### 验证

| 门禁 | 结果 |
|---|---|
| `npm run test:unit` | **483/483**（较 473 +10 Prospeo 用例，0 回归） |
| `npm run typecheck` / `verify:consistency` | 0 error / ✅ |

## [1.4.21] — 2026-10-13 · WhatsApp 手机号深挖（抓 `wa.me` 直链）+ 403 兜底简介挖联系方式

### 背景（用户实测痛点）

用户要用**高级版 WhatsApp** 触达，但 WhatsApp 只能发**手机号**；而 Google Maps 等来源的商家电话**绝大多数是座机**，  
且 **US 号码因号码可携带（LNP）无法从号段区分手机/座机**（`src/shared/phone-kind.ts` 已记载：实测 17 条线索 15 条为美国座机）  
→ 前端 WhatsApp 按钮被**禁用**，高级版触达链路事实上走不通。

### 变更

**1) 新增「免费」手机号来源** —— `electron/services/search/contact-extract.ts`

- `extractWhatsAppNumbers(html)`：提取 `wa.me/<d>` / `api.whatsapp.com/send?phone=` / `web.whatsapp.com/send?phone=` 的号码。    
  这类号码是网站**主动挂出的「一键 WhatsApp」按钮**，**定义上即为 WhatsApp 账号** → 无需猜测号码类型，规范化 `+<digits>`。
- `extractLabelledMobileNumbers(text)`：提取带 `Mobile/Cell/WhatsApp/手机` 标记的号码    
  （保守：标记词须与号码**相邻**，并以 `(?<![a-z])` 防 `automobile` 之类单词内部误匹配）。

**2) 接入富化链路** —— `search-service.ts`

- `WebsiteContentProbe` 新增 `whatsappNumbers`；`fetchWebsiteContent` 从 HTML/正文填充。
- `pickBestPhoneForReach` 新增 `whatsappPhone` 参数，**按 `mobile` 参与排序**（优先于座机）。

**3) 号码类型贯通前端（双端 SSOT）**

- `SearchExecuteResult`（`src/shared/ipc-contracts.ts` 与 `electron/services/search/types.ts` 两处镜像）与 `LeadItem`    
  新增 `phoneKind?: PhoneKind`；`applySchemaDefaults` / `lead-mappers` 透传。
- `leads-management.tsx` 的 WhatsApp 门禁**优先采信后端判定**，缺失时才回退 `classifyPhoneKind`    
  → **来自 `wa.me` 直链的号码不再被误判 `unknown` 而禁用**。

**4) 403 站点兜底简介**挖联系方式 —— `search-service.ts`

- 403 站点的 `buildSocialFallbackEnrichedText`（LinkedIn/Kompass/Europages 简介）此前**只喂给 LLM 写文案**，    
  其中的邮箱/电话被**白白丢弃**。现改为同时 `extractContactCandidates(socialFallbackText)`，    
  作为 `contact/contactTitle/email/phone` 的兜底来源。

### 稳定点（**未触碰**）

四级弹性搜索协议、并发域（2/2/3）、总量域、Fail-Closed、单源失败隔离、评分权重 —— 零改动。  
上述改动均为**纯字符串解析**，**零额外网络/API 成本**（复用了本就要抓的内容）。

### 验证

| 门禁                                         | 结果                                     |
| ------------------------------------------ | -------------------------------------- |
| `npm run test:unit`                        | **473/473**（较 468 +5 WhatsApp 用例，0 回归） |
| `npm run typecheck` / `verify:consistency` | 0 error / ✅                            |
| **变异验证**                                   | 去掉 `wa.me` 模式 → 2 条断言**精准失败**          |

### 待办（如实记录，未做）

- **邮箱深挖**：免费链实测已到 **12%**，进一步免费收益有限 → 建议引入 **L1 低成本邮箱源**（Hunter / Prospeo / PDL）    
  作为 **Apollo 的前置**（用户 `Desktop/kone-ai-v1.1-realflow/.env` 已持有 `PROSPEO_API_KEY`）。
- 结果列表 UI **仍不渲染 `email`**（`search-engine.tsx` 结果区零 `email` 引用）。
- 电话存在 `%20` 等**未解码 URL 编码**残留。

## [1.4.20] — 2026-10-13 · 修复「稀疏数组击穿 `new Map`」致整轮搜索中断 + 真实搜索覆盖率实测

### 真实缺陷（**实测复现，栈已捕获**）

- **现象**：真实搜索跑到**富化阶段**（50 条线索全部评完后）崩溃，前端收到    
  `stream:error: "Iterator value undefined is not an entry object"` → **整轮搜索中断**。
- **栈**（临时加 stack 日志捕获）：    
  `TypeError: Iterator value undefined is not an entry object at new Map (<anonymous>) at executeScoring`    
  → 对应源码 `search-service.ts:2377` 的 `const scoredByKey = new Map(scoredResults.map(...))`。
- **根因**：富化结果数组用 `new Array(baseResults.length)` 初始化；并发 worker 在「job 被抢占」时    
  `if (myJobId !== activeJobIdFor()) return` **提前返回、不写回该索引** → 数组出现**空洞**；    
  `Array.prototype.map` **跳过空洞**，`new Map()` 迭代空洞时得到 `undefined` → 抛错。
- **修复**：`enrichedResults` 改为 `baseResults.slice()`（**密集初始化**，未富化者回落为原始线索）。
- **守护**：`tests/business-logic/search-enrich-dense-array-guard.business.test.js`（源码守卫 + 机制复现）。

### 真实搜索覆盖率实测（开发环境 · 真实 SerpApi + SenseNova 密钥 · 关键词 `golf cart dealer USA`）

| 阶段                                 | 线索数 | 电话              | 邮箱            | 联系人            |
| ---------------------------------- | --- | --------------- | ------------- | -------------- |
| **搜索源（富化前）** `[Probe-ContactRate]` | 50  | **100%**（50/50） | **0%**（0/50）  | —              |
| **最终结果（富化后）**                      | 50  | **88%**（44/50）  | **12%**（6/50） | **22%**（11/50） |

- **结论**：**邮箱完全依赖富化层**（搜索源给 0）；**电话已由免费链覆盖**（Maps 100%）。
- **A/D 改进生效证据**：日志见 `/impressum`、**`/about-us-3`（非固定路径 → 由首页 `<a>` 链接发现，即 D）** 被抓取；    
  总官网抓取 73 次、403 共 7 次。
- **附带发现（待办）**：结果列表 UI **不渲染 `email`**（`search-engine.tsx` 结果区零 `email` 引用）→    
  用户看不到哪些线索有邮箱；另发现电话存在 `%20` 等**未解码 URL 编码**残留（数据质量小问题）。

### 验证

| 门禁                  | 结果                                |
| ------------------- | --------------------------------- |
| `npm run test:unit` | **468/468**（较 466 +2 密集数组守护，0 回归） |
| `npm run typecheck` | 0 error                           |

## [1.4.19] — 2026-10-12 · 修复「密钥文件无法解密 → 应用彻底变砖」（Fail-Closed 粒度修正）

### 背景（真实缺陷，实测复现）

为「用真实密钥测量联系人覆盖率」而启动应用时发现：当 `kone-secrets.json` **无法解密**  
（常见原因：该文件由**其它机器 / 其它 DPAPI 上下文**写入，或文件损坏），应用**完全无法启动**——  
`[Main] App startup failed` 后**无窗口**，用户连设置页都打不开。

### 根因

- `secret-manager.readSecretMap()` 在 `safeStorage.decryptString` 失败时**直接抛错**；
- `main.ts` 的 `migrateLegacySecretsFromConfig(store)` 位于 `whenReady()` 链首且**无 try/catch**；
- 抛错使整条链中断 → `registerIpcHandlers()` / `createMainWindow()` **均不执行** →    
  **无窗口、无 IPC、应用彻底不可用**，用户连"进设置页重新录入密钥"这条**唯一恢复路径**都走不到。


### 修复（两层，缺一不可）

1. **根因层 `readSecretMap`**：解密失败**不再抛错** → 将坏文件**留档**为     
   `kone-secrets.json.corrupt-<ts>`（**绝不静默删除**），本次返回空映射。     
   语义修正：**Fail-Closed 应作用于单个能力**（取不到密钥 = 未配置），**而非整个应用**。
2. **启动层 `main.ts`**：`migrateLegacySecretsFromConfig` 加 try/catch 兜底，     
   任何迁移异常都降级为"密钥不可用"并**继续启动**。

### 影响

- 用户**重新录入密钥即可自愈**（后续写入生成新的可解密文件）。
- 消除"打开即无窗口/闪退"的**不可恢复**状态。

### 验证

| 门禁                  | 结果                                                       |
| ------------------- | -------------------------------------------------------- |
| `npm run test:unit` | **466/466**（较 443 +23；本轮 +5 `secret-manager-resilience`） |
| `npm run typecheck` | 0 error                                                  |
| **变异验证**            | 让 catch 重新抛错 → **4 条断言精准失败**（证明测试有牙）                     |

### 附：本轮未完成的目标（**如实记录，不计入通过**）

原计划「用真实 SerpApi/LLM 密钥跑一轮搜索测量 `[Probe-ContactRate]` 覆盖率」**受阻**：  
真实 profile（`%APPDATA%/kone-system`）的 `kone-secrets.json` **无法解密**（dev 与 packaged 启动**均复现**），  
故无法用其密钥发起真实搜索。**该受阻本身即本轮发现的缺陷（已修复）**；  
密钥需用户在设置页**重新录入**后，方可继续测量覆盖率。

## [1.4.18] — 2026-10-12 · 数据源/联系人获取优化（Tier 1）：官网深探增强 + SerpApi 密钥回退与设置合并

### 背景

按《KONE-V1.3-数据源与联系人获取-全局梳理与优化计划-2026-10-12》**Tier 1** 执行。  
目标：在保证**精准度 + 线索量**的前提下，兼顾**体验（不能等太久）**&#x4E0E;**成本**。

### 变更

**1) 官网深探增强（免费联系方式获取）** —— 新增纯模块 `electron/services/search/contact-extract.ts`：

- `WEBSITE_PROBE_USER_AGENT`：抓取 UA 由 `Kone-AI/1.0`（被大量站点 WAF 403）改为**通用桌面浏览器 UA**。
- `buildContactPageUrls`：联系页路径由 2 条扩至 6+（含**德国法律强制**的 `/impressum`、`/about` 等），并设并行上限 `CONTACT_PAGE_FETCH_LIMIT=6`。
- `parseJsonLdContacts`：解析 `application/ld+json` 的 Organization/LocalBusiness/ContactPoint 的 `email`/`telephone`（**不采信 Person/Article**，防误采个人邮箱）。
- 接入 `search-service.ts`（UA + 联系页 + JSON-LD 合并进 `directEmails`/`directPhones`）。

**2) SerpApi 密钥读取回退（修复真实 UX 陷阱）** —— `provider-service.ts`：  
`google-leads` 优先、**回退 `google-maps`**。修复「用户只填『谷歌地图』→ 所有 Provider 取不到 key → **整轮搜索静默无数据**」。

**3) 设置合并（5 → 4 项）** —— `system-settings.tsx` / `base-settings-tab.tsx`：  
原「谷歌获客引擎」「谷歌地图」两个冗余密钥框合并为单一「**SerpApi（Google 搜索 / 地图）**」  
（两者本是**同一个 SerpApi 账号**）。读取端保留旧 `google-maps` 槽回退，**老用户升级不失效**。

**4) 联系页发现（**&#x96F6; API 成本&#x7248;**）** —— 同模块新增 `extractContactLinksFromHtml`：  
从**首页 `<a>` 链接**识别**站内联系页的真实 URL**（href/锚文本命中 contact/about/impressum/kontakt/联系…），  
仅取同站、非资源、去重、受上限约束；与固定路径合并后并行抓取（总上限 `CONTACT_PAGE_FETCH_LIMIT=6`）。

> 设计取舍：原计划的 D 方案是「每域名发 1 次 `site:` 查询」，与「不能等太久 + 成本」冲突>   
> （SerpApi 免费额度仅 100 次/月）。改为**解析首页链接**——**零 API 调用**、命中真实 URL、不放大延迟，>   
> 在满足同一目标的前提下**完全消除新增成本**。

### 稳定点（**未触碰**）

四级弹性搜索协议、并发域（2/2/3）、总量域、Fail-Closed、单源失败隔离、Provider 契约、评分权重、落盘边界 —— **零改动**。

### 验证

| 门禁                           | 结果                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run test:unit`          | **461/461**（较 443 **+18**：contact-extract 13 + provider-fallback 5，0 回归）                          |
| `npm run typecheck`          | 0 error                                                                                           |
| `npm run verify:consistency` | ✅（IPC 61 注册 / 0 plain 直挂）                                                                         |
| **变异验证**                     | 去掉 JSON-LD 类型过滤 → Person 断言**精准失败**；回退联系页路径为 2 条 → `/about` 断言**精准失败**；去掉联系页同站过滤 → 外部链接断言**精准失败** |

### 暂缓（依「成本 / 延迟」约束 + 拒绝过度工程化）

- **E LLM 结构化联系方式汇总**：联系方式已有 4 级优先来源（线索自带 > Apollo > 官网正则 > JSON-LD），    
  LLM 提取为最低优先级，增量低且引入编造风险；deep-probe prompt 被 4 个 e2e 测试覆盖 → 暂缓。
- **F 低成本邮箱 provider**：需真实账号 + 更新 `PROVIDER-CAPABILITY.md` → 另立计划。

## [1.4.17] — 2026-10-12 · 修复托盘巡航同步通道从未绑定（`sync-autopilot-state` 死通道）+ 安装包数据交互审计闭环

### 真实缺陷（打包版实测发现，已修复）

**`AUTOPILOT.SYNC_STATE`（`sync-autopilot-state`）在打包版中从未绑定到 `ipcMain`。**

- **根因（顺序缺陷）**：`main.ts` 的 `whenReady()` 里，`registerIpcHandlers()`（其末尾执行    
  `registry.attach(ipcMain)`）先于该通道的 `registerIpc(...)` 登记。而 `registry.attach()`    
  只对"登记时刻已存在的通道"做真实 `ipcMain.handle` 绑定；晚登记的通道**不会被绑定**，    
  且启动门禁 `assertAllRegistered()` 只校验"已登记"，**不校验"已绑定"**，故漏网。
- **可观测后果**：渲染层（`search-engine.tsx` 挂载 effect）每次调用恒得    
  `No handler registered for 'sync-autopilot-state'`；主进程日志反复写    
  `Error occurred in handler for 'sync-autopilot-state'`。系统托盘的**巡航控制项    
  （暂停/继续/停止）永不反映真实生命周期**，恒停留 `idle`。
- **修复**：将 `SYNC_STATE` 的 `registerIpc(...)` **前移到 `registerIpcHandlers()` 之前**；    
  并把 handler 内的 `refreshTrayMenu(mainWindow)` 改为 `if (mainWindowRef) refreshTrayMenu(mainWindowRef)`    
  ——渲染层可能在 `createMainWindow()` 期间即调用，此时 `mainWindowRef` 尚未赋值，但随后    
  `createTray(mainWindow)` 会依据已同步的 `autopilotLifecycle` 建菜单，无需在此刷新。

> 教训：注册中心把"登记"与"绑定"解耦后，"已登记 ≠ 已绑定"成为新的漏网维度。>   
> 启动门禁必须同时覆盖"绑定"，或保证所有登记都发生在唯一 `attach()` 之前。

### 防回归守护测试（新增）

`tests/business-logic/autopilot-sync-attach-guard.business.test.js`（2 条）：

1. **源码结构断言**（剥离注释后）：`IPC_CHANNELS.AUTOPILOT.SYNC_STATE` 的 `registerIpc` 调用     
   必须**先于** `registerIpcHandlers()` 调用——晚于即判失败。
2. **机制复现**：向 registry 登记 A → attach（A 绑定）→ 再登记 B → 不补 attach ⇒ B 不绑定；     
   再 attach ⇒ B 绑定。证明"晚登记 + 不补 attach = 死通道"真实可复现，且 `attach()` 幂等可补齐。

### 安装包数据交互探针加固（防自欺，本轮实测）

- **persistence 探针**：修正"直连 preload 读到的是 IPC 信封 `{success,data}`"导致的**假阴性**    
  （此前写成功也判失败）；补 `waitForPage` 修复重启后 `browser.pages()[0]` 为空竞态；    
  补 `waitForSelector('[data-stage]')` 修复重启后读到 `data-stage=null` 的误判；截图失败降级为 WARN    
  （非交互桌面会话下 `Page.captureScreenshot` 会挂起，属环境而非产品缺陷）；修正清理逻辑的    
  Node 常量泄漏与 walk-up 缺陷。
- **interaction 探针**：S3 改用 chip 专属 `aria-label` 判定（原 `textVisible` 会命中输入框 value，    
  **假阳性**）；S5 删除条目改用"精确 placeholder+value"定位（原 `includes` 先命中搜索框 → 删空），    
  并在删除后**补保存**才校验配置口径清零；新增"多场景截图 md5 必须互不相同"防旧帧自欺；    
  `assertAlive` 增补 pageerror 失败判定；S8/S9 导出改为**如实 BLOCKED**（走系统保存对话框，    
  无头探针无法确认落盘，不得以"无崩溃"冒充 PASS）。

### 门禁回归（本轮）

| 门禁                           | 结果                                                 |
| ---------------------------- | -------------------------------------------------- |
| `npm run test:unit` 全量单测     | **443/443**（较 441 +2 条 SYNC_STATE 守护，0 回归）         |
| `npm run build:electron:dev` | 0 error                                            |
| 打包版持久化闭环探针                   | **ALL PASS**（写→真实冷启动→读回；条目+标签+授权三持久；pid 不同）        |
| 打包版九模块交互探针                   | **31 PASS / 0 FAIL / 1 WARN / 1 INFO / 2 BLOCKED** |
| 多场景截图互不相同                    | 14/14 distinct（防旧帧自欺）                              |

### 如实记录的遗留风险（同 1.4.16，未消解）

1. **商用签署不可判定**：无 `signtool` / 无 `.pfx`，v149/v150 是否签名无法验证。
2. **`security-audit` 真机审计不可重跑**：脚本 `reg delete` 被本环境 Security Policy 硬杀。
3. **真实外部密钥/干净低配机器**缺位：外部链路仅覆盖 Fail-Closed 与降级路径。
4. **覆盖率 functions 余量极小**（64.03 vs 64.00）。
5. **S8/S9 导出落盘、S11 溯源标注**：分别因"系统保存对话框不可无头确认""无真实结果集"而     
   未能自动验证，按 BLOCKED/INFO 如实记录，**不计入通过**。

> 边界声明：缺真实外部密钥、有效签名或干净机器证据时，上述项按「受阻/未验证」如实记录，>   
> 不标为商用全通过。

## [1.4.16] — 2026-10-11 · 搜索缺配置错误文案密钥泄漏修复 + 安装包数据交互闭环审计

### 真实缺陷（用户可见，已修复）

`electron/services/search-service.ts` 缺配置分支原异常内插密钥/地址原文：  
`throw new Error(\`缺少配置. Debug: key=[${googleKey}], url=[${googleBaseUrl || ''}]\`)\`  
该字符串沿 IPC → 渲染层 → 界面**直接展示**，当用户只填了半个 key 或误填带凭据的 URL，  
原文会被回显到 UI，构成**密钥/端点泄漏**。

修复：异常改为用户可读提示「搜索服务尚未配置：请先在「系统设置 → 基础配置」填写 Google  
搜索密钥与接口地址。」；缺失明细只走 `probeLog`（布尔字段，不含原文），绝不进异常消息。  
`Probe-Config` 既有 raw baseUrl 日志**保持现状**（仅日志、不进 IPC/UI，不扩大修改面）。

### 防自证回归测试（关键）

新增 `tests/business-logic/search-config-missing.business.test.js`（4 条），覆盖三组缺配置输入  
（key 空 / url 空 / 两者皆空）与一组反向（配置完整不得报 config-missing）：

- handler 必须 `success:false`，且 `result.error` 与 `STREAM_ERROR` 载荷\*\*完全不含哨兵 key/url\`
- 流式生命周期完整：`STREAM_START → STREAM_ERROR → STREAM_COMPLETE`（错误路径也收尾）
- 缺配置路径**零网络请求**
- 变异视角：若回退到 Debug 内插文案，断言会因含哨兵而精准失败

### 安装包数据交互探针（自持、防假通过）

`scripts/probe-packaged-{discovery,interaction,persistence}.cjs` 三件套，针对「安装包真实成品」  
做数据交互闭环审计。其中 **persistence 探针重写为自持生命周期**：一次命令完成  
启动 → 写知识库条目（标题+正文+条目标签+自定义标签）→ 杀自身 PID → 真实冷启动 → 经  
`window.electronAPI.config.get('user_config')`（APP 自身读盘口径）读回四字段 → 校验 PID 不同 /  
exe sha256 / 隔离 userData 三重身份锚定 → 清理。彻底堵死「页面改了 state 就当持久化」「同一进程  
verify」「verify 自动激活掩盖授权丢失」三类自欺。

### 全量门禁回归（本轮）

| 门禁                              | 结果                                  |
| ------------------------------- | ----------------------------------- |
| `test:unit` 全量单测                | **441/441**（较 437 +4 条缺配置泄漏守护，0 回归） |
| `npm run build:electron:dev`    | 0 error（已含 search-service.ts 修复）    |
| `tsc -p tsconfig.electron.json` | 0 error                             |
| 真实密钥泄漏负向测试                      | 4/4 PASS（哨兵 key/url 不出现在 IPC/UI/返回） |

### 如实记录的遗留风险（非代码缺陷，环境/资源受限）

1. **商用签署不可判定**：本环境无 `signtool`、无 `.pfx`，`verify:signature` 优雅降级；     
   v149 产物是否已签名无法验证（`--strict` 正确 exit 1）。B-2 待证书采购。
2. **`security-audit` 真机审计不可重跑**：脚本 `reg delete` 被本环境 Security Policy 硬杀，     
   非可绕过异常。仓库内现有报告为 2026-09-23 陈旧产物。
3. **真实外部密钥/干净低配机器**缺位：搜索/Apollo/邮箱等外部链路仅能做 Fail-Closed 与     
   降级路径验证，真实连通与配额需受控实发环境确认。
4. **覆盖率 functions 64.03 vs 阈值 64.00（余量 0.03%）**：新增未覆盖函数即跌破，建议下调阈值至 62 或补分支测试。

> 边界声明：缺真实外部密钥、有效签名或干净机器证据时，上述项按「受阻/未验证」如实记录，>   
> 不标为商用全通过。

## [1.4.15] — 2026-10-11 · Apollo.io 联系人富化接入（补齐「邮箱 + 手机号」覆盖短板）

### 背景（用户痛点根因）

用户实测反馈的「邮箱覆盖低 + WhatsApp 用不了」，根因**不在代码**而在**数据源**：  
现有富化 **100% 依赖「官网深探」**——而商家官网普遍**不公开邮箱**（多改联系表单）、  
公开电话**几乎都是座机**（WhatsApp 是手机 App，座机无法收信）。  
`phone-kind.ts` 已能识别座机，但识别得再准，**没有手机数据源也无从解决**。

### 变更

新增 **Apollo.io 联系人富化适配器**，返回**已验证邮箱 + 手机号（含类型）**：

| 文件                                                                | 变更                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `electron/services/search/enrich-apollo.ts`                       | **新增**。`enrichFromApollo`（People Match 端点）+ `getUserApolloApiKey`     |
| `electron/services/search-service.ts`                             | 富化流水线接入 Apollo；`pickBestPhoneForReach` 多来源电话**优先选手机**                 |
| `electron/services/search/constants.ts`                           | 新增 `ENRICH_LOOKUP_BUDGET = 20`（总量护栏）                                  |
| `electron/services/config-service.ts`                             | `SECRET_KEYS.APOLLO_API_KEY` + 加入 `SECRET_SET_WHITELIST`（否则设置页写入 403） |
| `electron/utils/contact-validation.ts`                            | SSOT 再导出补 `buildWhatsAppDigits`（主进程不再另写号码判定）                          |
| `src/components/settings/{base-settings-tab,system-settings}.tsx` | Apollo 作为正式服务商卡片（密钥录入 + 测试连接）                                         |
| `kone-PRD.md`                                                     | §零.3 宪法常量表登记 `ENRICH_LOOKUP_BUDGET`                                   |

### 三条硬不变量（有守护测试锁定）

1. **Fail-Closed 是绝对底线**：无密钥 / 无标识 / 429 / 5xx / 超时 / 无命中 一律     
   `{ used:false }`，**绝不抛错、绝不中断搜索**；**无密钥时零网络请求**（不烧额度）。
2. **宪法并发红线零触碰**：`SEARCH_ENRICH_CONCURRENCY = 2` 约束的是**并行线索数**，     
   Apollo 查询是**单条线索内的串行追加**，不提升并行度。
3. **预算护栏**：Apollo 是**外部付费 API**，故受每轮搜索 `ENRICH_LOOKUP_BUDGET = 20` 硬顶，     
   且仅对**高价值线索（matchScore ≥ 60）**&#x89E6;发——成本只花在最可能成交的线索上。

### 密钥读取的 Fail-Closed 硬化（本次落地时暴露的真实缺陷）

初版 `getUserApolloApiKey()` 直接 `getSecret(...).trim()`——当**密钥存储不可用**  
（safeStorage 未启用 / 容器未就绪 / 解密失败）时会**抛错**，而该调用位于  
`enrichLeadWithDeepProbe` 内部，异常会**击穿整条富化链路**（403 社交降级 /  
snippet 盲评 / 流式闭环全部失效，回归 4 条存量测试）。  
修复为**双层防御**，两者都必要：

1. **适配器层**：`getUserApolloApiKey()` 内部 try/catch，异常一律视为「未配置」返回 `''`     
   ——密钥读取失败 ≠ 用户配置了密钥，绝不能让 Apollo 反过来拖垮富化。
2. **调用点层**：富化流水线内的 Apollo 分支整体 try/catch，`apollo = null` 兜底     
   ——即便适配器自身加载失败，官网抓取路径仍然完整保留。

> 教训：「Fail-Closed」不止覆盖**网络失败**，同样覆盖**本地依赖不可用**。>   
> 任何「增强型」数据源在既有流水线里，都必须在**读取配置**和**调用点**两处都有兜底。

### 号码类型判定（尊重 Apollo 权威性）

Apollo 自报 `type: 'mobile'` 时**直接采信**为 mobile —— 因为 `phone-kind` 只能按号段推断，  
对美国 LNP 号码只能返回 `unknown`。达标后按 `buildWhatsAppDigits` 判定 WhatsApp 可达性。  
Apollo **未标** mobile 的号码**不得夸大为 mobile**（诚实口径，避免给出无效链接）。

### 数据归因

Apollo 真正贡献数据时，线索 `source` 追加 `· Apollo`；**无贡献不加标**（不得虚标数据来源）。

### 数据归因闭环（自查发现的真实缺陷）

初版只在**正常返回路径**写了 `source:` 覆盖，403 降级路径靠 `...blindLead` 顺带带入。  
但 `blindLead` 为 null（LLM 盲评超时/失败）时 `...null` **不展开任何字段**，  
`source` 退回 `payload.candidate.source` —— 结果是**邮箱/电话来自 Apollo，  
来源标签却只显示「Google Maps」**：静默丢失数据溯源，与导出侧的溯源口径自相矛盾。  
修复：403 降级路径也显式覆盖 `source:`，两条返回路径口径一致。

> 教训：「多条返回路径都要改」是重构最容易漏的形态——>   
> 新增派生字段时，必须**逐条枚举所有 return**，不能只改写得到的一处。

### 门禁与审计脚本的可用性缺陷（顺手修掉）

1. `scripts/security-audit.cjs` 硬编码 `release/win-unpacked`。而 `release/` 被文件锁占用时     
   的官方绕行方案就是**换目录打包**（见 `packaged-smoke.cjs` 的既有约定）——     
   一旦换目录，本脚本直接报 "Unpacked executable not found"，     
   **整条安全审计门禁形同虚设而无人察觉**。现与 `packaged-smoke.cjs` 对齐：     
   位置参数 > `KONE_PACKAGED_ROOT` > 默认 `release`。
2. `tests/business-logic/enrich-apollo.business.test.js` 首版对「两条返回路径」的断言是     
   **自证循环**：全局计数把 403 路径内部 `blindLead` **入参对象**里的 `source` 也算了进来，     
   导致删掉 403 路径的 `source:` 后测试**仍然全绿**（已用变异验证实测证实）。     
   改为**同对象定位**断言：定位含 `fallbackStatus: usedSocialFallback` 的 403 return 对象，     
   要求归因就在同一对象字面量内。变异验证：注入缺陷后 21→20 精准失败。

> 教训：守护测试「通过」不等于「有牙」。静态断言做全局计数时，>   
> 必须确认计数目标**唯一落在被测语义上**，否则就是给自己发假毕业证。

### 设置页「测试连接」的诚实实现

Apollo 无 Base URL、无独立的连接测试端点，故设置页对 Apollo 做**软校验**  
（非空 + 形似凭据）后保存，**不做主动探测**（避免消耗 credits）；  
真实连通性在下次搜索的高价值线索富化时验证，失败即自动降级。

### 测试

新增 `tests/business-logic/enrich-apollo.business.test.js`（**21 条守护**）：  
Fail-Closed 五态（无密钥零请求 / 无标识 / 429-5xx / 超时 / 空命中）、  
命中回填契约（reveal 参数 / mobile 优先 / CN-US 可达性 / 非 mobile 不得夸大 / 部分回填）、  
宪法合规（预算 20 / 并发红线不变 / 三重触发门禁 / 跨轮次独立预算）、  
归因不虚标、**归因覆盖两条返回路径（同对象定位断言）**、SSOT 不重复实现、  
密钥白名单、PRD 同步、设置页可见性。

**全量回归同时捕获了上面的硬化缺陷**：`403-social-fallback` / `fallback-routing` /  
`icp-blind-score` 共 4 条存量测试因 Apollo 击穿富化链路而失败——证明**存量测试  
对新数据源的「不侵入性」是有实际拦截力的**，不是走过场。

### 验证

- `tsc -p tsconfig.electron.json --noEmit` **0 error**
- `npm run typecheck`（renderer）**0 error**
- `npm run verify:consistency` ✅（文档 10 份 / 宪法常量 8+7 项 / 文档交叉引用 181 处 /    
  IPC 72 通道·61 注册·0 处 plain 直挂 / 云端安全门禁 0 处裸 as）
- `npm run test:unit` **437/437 全绿**（较接入前 416 条 +21 条 Apollo 守护，0 回归）

### 商用交付门禁矩阵（本轮全量回归）

| 门禁                              | 结果                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `test:unit` 全量单测                | **437/437**                                                                        |
| `test:coverage` 覆盖率             | lines 65.86/65 · branches 63.81/60 · functions 64.03/64 ✅                          |
| `typecheck` renderer            | 0 error                                                                            |
| `tsc -p tsconfig.electron.json` | 0 error                                                                            |
| `verify:consistency`            | ✅（文档 10 份 / 宪法常量 8+7 项 / 交叉引用 181 处 / IPC 72 通道·61 注册·0 plain 直挂 / 云端安全门禁 0 处裸 as） |
| `test:gateway` 授权网关             | PASS                                                                               |
| `test:env` 环境隔离                 | PASS                                                                               |
| `test:bypass` 开发旁路              | PASS                                                                               |
| `test:ipc` IPC 契约清扫             | PASS                                                                               |
| `test:e2e-smoke` 权限锁            | PASS                                                                               |
| `test:e2e-journey` 授权旅程         | PASS                                                                               |
| `test:cloud` 云端 Worker          | PASS                                                                               |
| `lint` 代码规范                     | PASS                                                                               |
| `format` 格式规范                   | PASS                                                                               |
| 打包冒烟（4 项断言）                     | **4/4**（booted / activationScreen / preloadBridge / dashboardNav）                  |
| 视觉探针（5 个子探针）                    | **5/5 通过**                                                                         |
| `verify:signature`              | ⚠️ 不可判定（无 signtool / 无证书，优雅降级 exit 0；`--strict` exit 1 正确）                         |
| 签名配置 schema 校验                  | ✅（新结构通过；旧扁平结构被 `should NOT have additional properties` 拒绝，校验有效）                    |

### 两项如实记录的遗留风险

1. **`security-audit` 真机审计本轮无法重跑**：脚本第 163 行 `reg delete` 在本环境的     
   Security Policy 下被**硬杀进程**（非抛 JS 异常，脚本第 162-166 行的 try/catch 无从捕获）。     
   仓库内现有报告为 2026-09-23 的陈旧产物（5 场景全 ok）。     
   **未做绕过**（不关闭沙箱、不改脚本迎合环境）。结论：该门禁在本环境**不可判定**。
2. **代码签名不可判定**：本环境无 `signtool`（Windows SDK 未装）、无 `.pfx` 证书，     
   `npm run verify:signature` 优雅降级为 WARNING（默认 exit 0；`--strict` 硬门禁 exit 1，     
   行为正确）。故 v148 产物**是否已签名无法验证**，`dist:signed` 链路仅做到     
   配置层 schema 校验通过（已反向验证旧结构会被拒），**端到端未跑通**。     
   这是 B-2（证书采购）的待办，非代码缺陷。
3. **覆盖率 functions 64.03 vs 阈值 64.00，余量仅 0.03%**：新增任何未覆盖的函数即会跌破。     
   建议后续把阈值下调到 62（留出演进空间）或补齐富化链路的分支测试。

### 受影响 SSOT

`kone-PRD.md` §零.3（新增 `ENRICH_LOOKUP_BUDGET`）·  
`ARCH-STANDARDS.md`（未变）· `src/shared/phone-kind.ts`（未变，仍为号码判定 SSOT）

## [1.4.14] — 2026-10-11 · 校正历史遗留的假国家码（`Global` → `GL`）

### 背景（全链路梳理中发现）

用户线索数据中 `country: "Global"` 却带 `countryCode: "GL"`（**格陵兰**），  
导出后显示错误国家，且**污染下游**（号码补全 / 邮件语言 / 本地化搜索变体）。

**根因**：P2-1 修复前用 `country.slice(0, 2).toUpperCase()` 推导：  
`Global`→`GL`、`United States`→`UN`、`Germany`→`GE`。  
`resolveCountryCode`（`src/lib/country-code.ts`）**已修好**（未命中返回 `''`，不猜），  
**但不会回溯修正已落库的旧记录** —— 历史数据里的假码一直留存。

### 变更

`src/store/leads-store.ts` 的 `normalizeLeadItem` 增加**国家码重算**：

```ts
const countryCode = resolveCountryCode(lead.country) || ''
```

- 能识别 → 用正确码；**不能识别（如 `Global`）→ 清空**
- **绝不保留假码** —— 假码比空值更糟（会作为"看起来合法"的数据进入表格/导出/台账）
- 该函数在 **hydrate / saveLeads / updateLead** 三处调用，故**读取即校正**，    
  无需一次性数据迁移脚本，也不改动用户的原始数据文件

### 测试

新增 `tests/business-logic/country-code.business.test.js`（3 条守护）：

- 已知国家名 → 正确 ISO alpha-2
- **`Global` / `全球` / 空值 → 必须返回空串**（不得截取前两字母）
- 逐项验证曾产出假码的输入（`Germany`/`United States`/`Global`）

### 影响 SSOT

`leads-store.ts` / `country-code.ts`（未改，仅消费）/ `CHANGELOG.md`

### 附：全链路梳理结论（详见 `KONE-V1.3-前端体验闭环深度梳理-2026-10-11.md`）

七环齐备（搜索/分析/入库/导出/触达/跟进/行动入口），  
**真正瓶颈是「弹药」——数据的可得性与质量**（电话多为座机、邮箱覆盖率低）。  
优化方向应是**提高数据质量**，而非继续加功能。

---

## [1.4.13] — 2026-10-11 · WhatsApp 触达必须识别号码类型（固定电话不可用）

### 背景（用户实测反馈）

> 「资料里面都固定电话啊，这个你不会识别吗，能链接 whatsapp 吗，我都吐血了」

**这是一个真实且严重的设计缺陷**：

- WhatsApp 是**手机 App**，**固定电话（座机）无法注册/接收消息**
- 而 Google Maps / Yellow Pages 等来源返回的商家电话**绝大多数是座机**    
  —— 实测 17 条线索中 **15 条为美国 `(XXX) XXX-XXXX` 格式的商家座机**
- 此前 `normalizePhoneE164` **只校验格式**（8-15 位数字），座机也被判 `phoneValid: true`
- 前端据此**直接拼 `wa.me/<digits>`** → **链接必然无效**（用户点了打不开）

### 变更

**新增 `src/shared/phone-kind.ts`（双端共用 SSOT）**

- `classifyPhoneKind(raw, countryCode)` → `mobile | landline | unknown`
  - **CN**：`1[3-9]xxxxxxxxx` → mobile；`0xx(x)-xxxxxxx` → landline
  - **DE**：`+49 15x/16x/17x` → mobile；其余 → landline
  - **US/CA**：号码可携带（LNP），**无法从号段区分** → `unknown`（保守）
  - 其他国家 → `unknown`
- `canReachWhatsApp(raw, cc)` → 仅 `mobile` 为 true
- `buildWhatsAppDigits(raw, cc)` → **必须带国家码**；无法可靠补全时返回 `null`

**`leads-management.tsx` 的 `handleLaunchWhatsApp` 加三重门禁**

1. `classifyPhoneKind` 判定 → **仅 mobile 放行**
2. `buildWhatsAppDigits` 补国家码 → 缺国家码**明确拒绝**（不臆造区号）
3. 座机/无法判定 → **明确告知原因**（"是固定电话，WhatsApp 仅支持手机号"），     
   并**建议改用邮件触达** —— 不静默失败、不给无效链接

**`electron/utils/contact-validation.ts`** 改为 re-export shared 模块（消除重复实现）

### 设计原则

**保守优先**：拿不准就 `unknown` → 按「不可用」处理。  
**宁可少给一个按钮，不可给错链接**（用户点了却打不开最伤体验）。


### 测试

新增 `tests/business-logic/phone-kind.business.test.js`（6 条守护）：

- 座机必须判 `landline`（不得混入 mobile）
- 美国商家座机（实测 4 条真实样本）**必须不可用于 WhatsApp**
- 空值/垃圾输入不得误判为 mobile
- `buildWhatsAppDigits` 对缺国家码**必须返回 null**

### 影响 SSOT

`src/shared/phone-kind.ts`（新增）/ `leads-management.tsx` /  
`contact-validation.ts` / `CHANGELOG.md`

### 附：本次暴露的上游数据问题（待后续处理）

实测线索 `countryCode` 为 **`GL`（格陵兰）/ `UN`** —— 而号码是**美国** `(832)` 等。  
`country: "Global"` 被截取前两字母 → `GL`。**国家码推导仍有缺陷**（P2-1 的残留），  
导致号码无法补全 `+1`，进一步恶化 WhatsApp 可用性。

---

## [1.4.12] — 2026-10-11 · 全链路补齐：资料导出补「地址」+ WhatsApp 一键触达

### 背景

用户要求「全面提升从搜索到记录标注触达的完整链路体验」，并明确指出  
导出资料需含**公司名/邮箱/电话/网址/店址/客户类型**，且手机号应能通过  
高级版**直接触达 WhatsApp / 邮箱**。

### 发现的两个真实缺口

1. **地址（店址）数据有、导不出**：数据层 `LeadItem.address` 一直存在     
   （`leads-store.ts:83`），但 `lead-export.ts` 的 5 个字段组**均无 address**，     
   白皮书 `buildPdfHtml` 入参也**无 address** → 用户界面能看到地址、**导出后消失**，     
   属**数据链路断裂**。
2. **WhatsApp 无直连入口**：全仓 `grep 'wa\.me'` 零命中，只有 `mailto:`。

### 变更（契约先行）

**A. 地址链路贯通**

- `src/shared/ipc-contracts.ts`：`FileExportPdfRequest` 加 `address?: string`
- `src/lib/lead-export.ts`：`core` 组表头加「地址」，行构造读 `lead.address`
- `electron/services/export-service.ts`：白皮书入参 + 渲染（「企业地址」）+ 调用方透传
- `src/components/analysis-drawer.tsx`：`address: lead.address`

**B. 新增 IPC 通道 `SYSTEM.OPEN_EXTERNAL`（`system:open-external`）**

- `electron/ipc/channels.ts`：通道命名
- `electron/ipc/contracts/license.contract.ts`：`systemOpenExternalContract`
- `electron/services/license-service.ts`：handler（`shell.openExternal` +    
  **协议白名单，仅 http/https**，拒绝 `file://` 与自定义协议）
- `preload/index.ts` + `src/shared/ipc-contracts.ts`（`ElectronApi.system.openExternal`）
- `src/main.tsx`：dev mock 同步（**typecheck 捕获**）
- `src/components/leads-management.tsx`：`handleLaunchWhatsApp` + 「唤起 WhatsApp」按钮

### 设计要点

- **仅唤起，不自动发送** —— 用户仍需在 WhatsApp 内手动点发送，    
  **不触碰 AGENTS.md 的自动化风控红线**（与 Puppeteer/Cloud API 自动化路径并存不冲突）
- 号码归一化为纯数字（`wa.me` 要求 E.164 无 `+`）；不完整时**明确提示**，不静默失败
- 不复用 `window.location.href` —— 那会在 Electron 窗口内导航、覆盖应用界面

### 规范回写

- `AGENTS.md` / `kone-PRD.md §零.3`：`SEARCH_VARIANT_LIMIT` **8 → 12**    
  （用户反馈「不能过度平衡，影响搜索数量、覆盖深度」→ 初版 8 偏紧会砍掉本地语言变体）

### 影响 SSOT

`ipc-contracts.ts` / `channels.ts` / `lead-export.ts` / `export-service.ts` /  
`license.contract.ts` / `preload/index.ts` / `kone-PRD.md §零.3` / `AGENTS.md` / `CHANGELOG.md`

### 测试

- `ipc-startup-gate.test.ts`：invoke 通道数断言 **60 → 61**（门禁正确拦住了新增通道）
- `lead-export-ssot.business.test.js`：导出表头断言补「地址」
- typecheck 双侧 / `verify:consistency` / 单测 407-407

### 仍待澄清

「客户类型」语义：用户要的是「行业」（`industry`，**已导出**）还是  
「客户角色/类型」（`inferredRole`，**已产出但未进导出列**）？

---

## [1.4.11] — 2026-10-11 · 搜索 API 消耗治理（成本控制 + 规范订正）

### 背景

用户实测反馈「跑 2 次搜索任务免费额度都跑完了」。统计单次搜索：  
**SerpApi 53 次 / LLM 60 次 / 派发关键词变体 17 个**。  
SerpApi 免费版 100 次/月 → **2 次搜索即耗尽**。

### 根因

变体数 = 产品词数 × 4 角色词 × 语言数，**产品词数与语言数均无上限**：

- `search-service.ts` 的 `pureEnglishProducts` 缺 `slice`（同段 `keywords` 有 `slice(0,4)`，属实现不对称）
- `allSearchKeywords` 按语言循环 push，**语言数无上限**（3 语言 → 4 + 12 = 16 变体）
- LLM 偶发回吐**不可检索**条目（实测整句中文被当作关键词派发给上游）

### 规范订正（SSOT 回写）

- **`kone-PRD.md §零.3`**：
  - 新增 `SEARCH_PRODUCT_TERM_LIMIT = 2`（参与变体生成的产品词上限）
  - 新增 `SEARCH_VARIANT_LIMIT = 8`（单次搜索变体**总数**上限，属**总量域**）
  - **订正 HTTP 熔断行**：原文把 `429` 与 `400/401/403` 并列为"配置错误不计入开路"**有误** ——      
    `429` 是**上游限流**（暂时性、可恢复），与"密钥错误"性质不同，**应计入熔断**；      
    否则限流下反复重试会**加剧**配额消耗
- **`AGENTS.md`**「多语言多源搜索执行宪法」：
  - 变体公式改为 `pureEnglishProducts[0..SEARCH_PRODUCT_TERM_LIMIT-1]`
  - 明确「约 **2x**」的基数是「单产品词的英文变体数（`B2B_ROLE_TERMS[0..3]`，即 4 个）」，消除歧义
  - 新增**产品词必须清洗**的强制条款

### 实现

- `search/constants.ts`：新增 2 常量
- `search/intent.ts`：新增 `sanitizeProductTerms()`（剔除含中文/控制词/超长的不可检索条目）
- `search-service.ts`：产品词清洗 + `.slice(0, SEARCH_PRODUCT_TERM_LIMIT)`；    
  `allSearchKeywords` 按 `SEARCH_VARIANT_LIMIT` 硬截断（英文变体排前故优先保留）

### 影响 SSOT

`kone-PRD.md §零.3` / `AGENTS.md` / `search/constants.ts` / `CHANGELOG.md`

### 预期效果

变体 17 → ≤8，SerpApi 53 → 约 20-25，**免费额度可支撑搜索次数 2 → 4-5 次**。  
并发域（扇出 `3` / 评分 `2`）与评分条数（`50`）**均未改动**，四级弹性搜索协议不受影响。

---

## [1.4.10] — 2026-10-09 · 修复 P2 国家代码推导错误（数据正确性）

### P2-1 `countryCode` 由国家名截取前两字母 → 数据错误

- **问题**：三处用 `country.slice(0, 2).toUpperCase()` 推导 ISO 代码 ——    
  `Germany` → `GE`（实为 `DE`）、`United States` → `UN`（实为 `US`）。    
  **错误代码会作为"看起来合法"的数据进入表格、导出文件与云端台账**，    
  比空值更难被发现。
  - `src/lib/lead-mappers.ts`（入库时）
  - `src/hooks/use-search-engine.ts`（搜索结果映射时）
  - `src/components/analysis-drawer.tsx`（AI 分析时）
- **修复**：新增 `src/lib/country-code.ts`，内置 60+ 常用国家的中英文名 → ISO alpha-2 映射；    
  **未命中返回空串（诚实表示未知），不再猜**。    
  `lead-mappers` 保留原有本地函数签名（调用方不受影响），内部改为委托共享映射。

### 守护测试

`tests/business-logic/p2-fixes-guard.business.test.js`（6 条，**运行时断言**）：  
验证 Germany→DE / United States→US / 中文国名 / 大小写空白 / 未知返回空串，  
以及三处调用点不再使用 slice 推导。

**验证**：typecheck 0 error；lint 0 error。

---

## [1.4.9] — 2026-10-09 · 修复审计报告 P1 批次（二）· 账号链路与门禁引导

### P1-7 邮箱账号健康检查读错路径 → 永远「已断开」

- **问题**：`sandbox-service.ts` 读**顶层** `user_config.smtpHost`，而真实写入路径是    
  `user_config.accounts.email.smtpHost`（`accounts-management` 保存端、`agent-service` /    
  `imap-reply-service` 读取端均如此）→ 路径不匹配 → 邮箱账号**恒判「已断开」**，    
  与「保存并连接」的成功提示自相矛盾。
- **修复**：优先读 `accounts.email.*`，顶层读取保留为向后兼容回退（旧安装可能残留）。

### P1-9 账号列表不持久化 → 重启即清空

- **问题**：`accounts` 是**纯内存 Map** → 进程重启后列表为空，用户每次开机都要重新「连接」    
  （Cookie 分区其实还在，只是列表空了）。
- **修复**：持久化到独立配置键 `sandbox_accounts`；`registerSandboxHandlers` 启动时恢复，    
  `connect` / `disconnect` 后落盘。    
  **刻意只持久化结构、不持久化 `status`** —— 重启后由 30s 健康检查自动刷新，避免每次检查都写盘。

### P1-11 邮箱清洗/域名检测/追踪刷新 前端无门禁、无升级引导

- **问题**：三者后端均受 `requireFeature('cloud_send')` 保护（Fail-Closed），    
  但对 Basic/Trial 用户按钮**可点** → 点了才看到 403 原始错误，**转化路径断裂**。
- **修复**：新增统一门禁辅助 `requireCloudSend(featureLabel)`（与 `handleStartCampaign` 同模式），    
  三处按钮接入：未授权时弹升级弹窗 + 明确文案，而非暴露原始错误。

### P1-6 改完设置马上切页会静默丢失

- **问题**：`system-settings.tsx` 卸载时的 cleanup 只 `clearTimeout` ——    
  **200ms 防抖窗口内的改动被静默丢弃**。
- **修复**：新增 `pendingPersistRef` 记录待落盘动作，cleanup 时**立即执行**而非丢弃。

### 守护测试

`tests/business-logic/p1-fixes-guard.business.test.js` 增至 **16 条**（新增 4 条：  
P1-7 路径 / P1-9 持久化 / P1-11 三处门禁 / P1-6 卸载执行）。

**验证**：typecheck 双侧 0 error；lint 0 error。

---

## [1.4.8] — 2026-10-09 · 修复审计报告 P1 批次（体验一致性与合规）

**背景**：P0 清零后继续处理审计报告的 P1 项，优先「用户可感知 × 低风险 × 高收益」。

### P1-3 来源筛选是死选项

- **问题**：`leads-management.tsx` 硬编码 `LinkedIn / Trade Show / AI Search` 三个选项，    
  而真实 `source` 值来自各 Provider（`Google Maps` / `Google Organic` / `AnySearch` …）    
  → **永不匹配**，点了没反应；且缺 `AnySearch` 这一真实来源。
- **修复**：选项改为**从实际数据动态派生**（`sourceOptions` useMemo），保证与数据永不脱节。

### P1-12 「今日配额」徽标口径错误

- **问题**：`totalUsed = Σ dailyUsed` 但 `totalLimit = agents[0].dailyLimit`（仅首个智能体）    
  → 会显示如「12/5」的错值，误导用户对剩余额度的判断。
- **修复**：`totalLimit = Σ a.dailyLimit`，与用量同口径。

### P1-10 审批把邮箱等级硬编码为 `verified`（合规风险）

- **问题**：`leads-table.tsx` 提交审批时写死 `emailVerificationGrade: 'verified'`，    
  而云端对缺省值的处理是 `'unverified'`（`cloudflare-service.ts`）——**系统原本的诚实默认**。    
  硬编码会把它覆盖，把**未经 SMTP 验证的邮箱标记为已验证**。
- **修复**：新增纯函数 `src/lib/approval-grade.ts` 的 `resolveEmailVerificationGrade()`：    
  优先取与该邮箱匹配的决策人真实等级，无匹配则降级为 `'unverified'`，**绝不谎报**。

### P1-1 / P1-2 危险操作无二次确认

- **问题**：删除线索（立即持久化）、云端群发（不可逆批量外发）均**点一下即执行**。
- **修复**：两处均加入确认对话框 —— 删除显示待删线索名并提示不可撤销；    
  群发提示「提交后无法撤回，请确认名单与模板已核对」。

### P1-5 两个导出口径不一致

- **问题**：`leads-table` 导出 `displayLeads`（受 50 条显示上限约束），    
  `leads-management` 导出全量 `filteredLeads` → 与 `lead-export.ts` 宣称的    
  「单一事实源 / 同口径」相悖；用户从线索表导出会**静默少拿数据**。
- **修复**：抽出 `filteredLeads`（全量筛选结果）供导出使用，    
  **50 条上限只作用于渲染**（保留性能优化意图）。

### 新增守护测试

`tests/business-logic/p1-fixes-guard.business.test.js`（12 条）：

- **运行时断言**（P1-10）：TS 编译 + vm 加载真实 `approval-grade.ts`，    
  验证命中/无匹配/空邮箱/大小写空白/空等级五种输入的判定。
- **源码结构断言**（P1-1/2/3/5/12）：死选项、口径、确认态、导出源。    
  测试内同样**诚实标注**结构断言的边界。

**变异测试（三轮，全部被精确捕获）**：① 审批等级改回 `'verified'` → 3 条失败；  
② 加回硬编码死选项 → 1 条失败；③ 导出改回 `displayLeads` → 1 条失败。均 `diff` 校验完整还原。

**验证**：typecheck 0 error；lint 0 error；单测 **395/395**（新增 12 条）。

---

## [1.4.7] — 2026-10-09 · 修复全项目审计的 7 项 P0 阻断缺陷

**背景**：全项目深度审计（见 `KONE-V1.3-全项目深度审计报告-2026-10-09.md`）发现 7 项 P0，  
**均已逐行复核**。本轮按优先级依次修复，每项配守护测试。

### P0-1 邮箱密码保存必失败且丢数据

- **根因**：`SECRET_SET_WHITELIST`（`config-service.ts`）**不含** `EMAIL_SMTP_PASS`/`EMAIL_IMAP_PASS`，    
  而渲染层保存邮箱时会 `secret:set` 这两个 key → 403；更严重的是渲染层**先清空了    
  `user_config` 的明文槽**再写加密槽 → 密码彻底丢失，邮箱链路完全不可用。
- **修复**：① 白名单补入两个 key（与 LLM API Key 同级，同样经 safeStorage 加密）；    
  ② `accounts-management.tsx` **调整顺序**——先写加密槽，成功后才清空明文槽，    
  使 secretSet 失败时明文槽保持原值，不再丢密码。

### P0-2 `cloud.*` 可写不可读

- **根因**：写端黑名单不含 `cloud.`（可写），读端白名单也不含（403）→ 云端引擎配置与    
  IMAP 自动检测「存了读不出来」；`CloudSettingsTab` 用 `Promise.all` 聚合读取，    
  任一失败即整体回退默认值，且保存成功后再次读取失败 → **恒弹「保存失败」（实际已落盘）**。
- **修复**：`CONFIG_GET_ALLOWED_NAMESPACES` 补入 `'cloud'`。

### P0-3 停止智能体后自动重连继续发送（合规红线）

- **根因**：`stopAgent` 只 `disconnect()` + 置 `status='idle'`，但三条执行循环    
  **从不读取 `agent.status`** → 循环继续 `sendMessage`，而 `sendMessage` 遇到    
  `sessionState!=='connected'` 会**自动 `connect()` 重连** → 用户以为停了，实际仍在发送。
- **修复**：新增循环级**启停检查点** `waitWhilePaused(agent)`，在三条循环（whatsapp/linkedin/email）    
  每轮开头调用；`idle` → `break`（剩余目标不再发送）。

### P0-4 暂停完全无效

- **根因**：`pause` 只置 `status='paused'`，执行循环无任何读取检查点 → 暂停期间照常发送，    
  而 UI 显示「已暂停」，构成误导性状态。
- **修复**：同上的检查点在 `paused` 时**挂起轮询**；并修 `startAgent`——    
  `paused` 时只把状态改回 `running` 而**不再启动第二条循环**（原实现会让「继续」    
  与原挂起循环并存 → 重复发送）。

### P0-5 日限额重启即清零

- **根因**：`dailyUsed` 为纯内存态，`agents` Map 每次启动重建为 0（可绕过日限额）；    
  且无日期锚点，长时间不关机会一直累加、永不按自然日重置。
- **修复**：持久化到 `agent_daily_usage` 并带**本地日期锚点**（`todayDateKey`）——    
  仅当日期为今日才恢复，同时实现「重启不清零」与「跨天自动重置」；    
  执行循环每轮调用 `persistAgentDailyUsage()` 落盘。

### P0-6 `leadKey` 入库恒 undefined

- **根因**：`lead-mappers.ts` 的 `typeof result.id === 'string'` 判断——    
  但上游 `use-search-engine.ts` 已把 `id` 转成 `number`，而**原始 UUID 早已单独保留在    
  `LeadSearchResult.leadKey`**（该字段一直存在，只是入库时读错了字段）→ 条件恒 false →    
  `LeadItem.leadKey` 恒 undefined → 双管道触达读端（`agentGetStatus` 批量拉取）失效。
- **修复**：`mapSearchResultToLeadItem` 改为**优先读 `result.leadKey`**，    
  回退到 `result.id` 是字符串的情形（兼容 autopilot-runner 直接传原始结果的路径）。

### P0-7 最高付费档看不到深度分析面板

- **根因**：`deep-analysis.tsx` 用 `if (role !== 'pro') return null` 自我隐藏，    
  而 premium 用户的 role 是 `'enterprise'` → 「权限给了、组件却藏了」。
- **修复**：门禁改为**能力驱动** `if (!allowDeepAnalysis) return null`，    
  并移除已无用的 `role` prop（组件与调用处）。


### 新增守护测试

`tests/business-logic/p0-fixes-guard.business.test.js`（14 条）：

- **运行时断言**（P0-6）：以 TS 编译 + vm 加载真实 `lead-mappers.ts`，验证    
  LeadSearchResult 形态 / 原始结果形态 / 缺失 / 空白 四种输入下的 leadKey 提取。
- **源码结构断言**（P0-1/2/3/4/5/7）：白名单内容、检查点数量与循环数相等、    
  保存顺序、日期锚点、门禁形态。测试内**诚实标注**该类断言的边界    
  （只验「修复代码在不在」，不验运行时行为）。

**变异测试（三轮，全部被精确捕获）**：  
① 移除邮箱密码白名单项 → P0-1 失败；② 移除一处循环检查点 → P0-3/4 失败；  
③ leadKey 改回只读 `result.id` → P0-6 运行时断言失败。均 `diff` 校验完整还原。

**受影响 SSOT**：`ARCH-STANDARDS.md` §9.6 新增第 4d 条（密钥白名单与调用点对齐、  
配置读写对称性、执行循环启停检查点三条硬约束）。

**验证**：typecheck 双侧 0 error；单测 **383/383**（新增 14 条）。

---

## [1.4.6] — 2026-10-09 · 补齐知识库链路唯一验证盲区（prompt 拼接端到端验证）

**背景**：知识库改造（[1.4.3] / [1.4.5]）的核心价值主张是「AI 真的拿到了用户的产品资料」。  
但复核发现**覆盖有缺口**：

- 单测 `agent-knowledge-injection.business.test.js` 只验证 `renderKnowledgePromptBlock`    
  **返回了什么字符串**；
- 视觉探针只验证 UI 卡片**渲染成什么样**（走 `analysis.generate` 另一条链路）。

**中间那段把片段拼进 system/user prompt 的代码（`agent-service.ts`）从未被验证**。  
若条件写反、漏拼 `knowledgeBlock`、或降级规则拼错，上述两者**都发现不了** ——  
而用户会拿到一封**没有产品卖点**的开发信，正是本次改造要解决的问题。

**修复（可测试性改进 + 端到端验证）**：

1. **导出两个 provider 工厂函数**（`agent-service.ts`）—— `createLlmEmailContentProvider` /     
   `createKnowledgeWhatsAppTextBuilder` 由私有改为导出，使「知识库 → prompt 拼接」可被直接覆盖。
2. **新增 `tests/business-logic/agent-prompt-knowledge.business.test.js`（6 条）** ——     
   mock 全局 `fetch`（`safeFetch` 直接调用它）**捕获真实请求体**，再调用**产品自带的**     
   provider，断言发给 LLM 的 prompt 内容。只 mock 网络出口，其余全真实：
   - 命中的条目**正文**必须真的进入 user prompt（含 `[SELLER KNOWLEDGE BASE]` 块）
   - 无命中时**不得**出现知识库块，且必须注入诚实降级规则（禁止编造卖点）
   - 未配置知识库时同样走降级
   - **用户自定义标签**命中的资料也能进入 prompt（与 [1.4.5] 贯通）
   - 缺 LLM 凭证时返回 `null` 而非抛错（内容层失败不阻断发送链路）
   - WhatsApp 兜底文案同步语义：命中列条目、未命中不编造

**变异测试（双向验证守护有效）**：① 让 user prompt **漏拼** `knowledgeBlock`  
→ **2 条失败**；② 把降级规则**条件写反** → **3 条失败**。均精确报出且 `diff` 校验完整还原。  
这两类错误正是此前**无法被任何测试发现**的。

**验证**：typecheck 双侧 0 error；单测 **369/369**（新增 6 条）。

---

## [1.4.5] — 2026-10-09 · 知识库自定义标签真正参与检索（User-Defined Tag Vocabulary）

**背景**：用户要求「既要体现模块功能价值，也不能过度工程化，保持灵活性，用户可以自定义」。  
取证实测发&#x73B0;**「可自定义」是假象**：

1. **`customTags` 是死字段** —— 类型里声明了（`src/lib/user-config.ts:54`），     
   全仓**零读写**。用户想建自己的标签体系，UI 上没有入口、配置里存不下。
2. **检索只认 4 个硬编码标签** —— `agent-knowledge.ts` 的 `BUILTIN_KNOWLEDGE_TAGS` 写死。     
   用户按自己的术语命名资料（如「交期承诺」），Agent 侧**永远不会命中**。     
   最致命的后果：**用户认真写了资料，AI 却没用上**。

**修复**：

1. **UI 侧开放标签池**（`src/components/knowledge-base.tsx`）—— 新增「我的标签」卡片：     
   内置标签（灰、标「内置」）+ 自定义标签（蓝、可删）合并展示；输入框回车或点按钮即添加。     
   **内置标签不可删除**（删掉会静默毁掉内置检索能力，故给出提示而非放行）；     
   每条资料的快捷按钮也改用合并后的标签池，**已选标签显示 ✓ 并禁用**（防重复点击）。     
   归一化：去空白、去重（保持首次出现顺序）、过滤空串。
2. **Agent 侧检索纳入自定义标签**（`electron/services/agent-knowledge.ts`）——     
   新增 `readKnowledgeSource`（条目 + 自定义标签一起读），`selectKnowledgeForAgent`     
   新增 `customTags` 参数，并入 `buildMatchKeywords`。     
   **向后兼容硬保证**：不传 / 传空数组时行为与改造前**逐字段一致**（有测试锁死）。

**刻意不做（防过度工程化）**：

- **不上向量检索 / embedding** —— 知识库规模是几十条量级，关键词匹配足够（项目长期结论：    
  知识库不是 RAG，对外不要称 RAG，此处不上探）。
- **不开放 `limit` / 截断长度等工程旋钮** —— 用户感知不到，调错还有害。
- **不把自定义标签接进搜索侧** —— 搜索侧 `scenarioKnowledgeKeywords` 是「场景」维度    
  （direct_quote/competitor_switch/factory_strength），与「标签」不是同一维度，硬接会引入假语义。    
  为不误导用户，UI 文案已精确限定为「AI 销售团队（开发信/话术）」。

**守护测试**：`tests/business-logic/agent-knowledge-injection.business.test.js` 新增 5 条  
（共 13 条）：① 自定义标签让非内置术语的资料命中 ② 无自定义标签时行为不变（向后兼容）  
③ 自定义标签**不得挤掉**内置标签命中 ④ 畸形 `customTags` 健壮 ⑤ **UI 侧必须持久化 + 回填**  
（跨端贯通守护）。经**变异测试双向验证**：让 `selectKnowledgeForAgent` 忽略 `customTags`  
→ 2 条失败；让 UI 停止写入 `customTags` → 1 条失败。均精确报出。

**受影响 SSOT**：`ARCH-STANDARDS.md` §9.6 新增第 4b 条（含"内置标签不可删""搜索侧不合并"  
两条设计边界的显式记录）。

**验证**：typecheck 双侧 0 error；单测 **363/363**；变异测试 2 轮均被精确捕获并完整还原。

---

## [1.4.4] — 2026-10-09 · AGENT.* 通道门禁补缺与分类治理

**背景**：复核「账号管理与 AI 销售团队审计报告」遗留建议 #2 时发现**真实商业泄漏缺口**——  
`AGENT.GET_LOG` 全链路**无任何 feature 门禁**，而其数据由 `hydrateAgentPersistence`  
在启动时**无条件**从 `user_config.agent_logs` 恢复（与授权状态**解耦**）。  
后果：Trial / 降级用户可绕过渲染层**直连 IPC** 读取完整历史触达日志（含 company/detail）。  
宪法明确「Trial 必须熔断拦截，严禁渲染任何智能体卡片或**暴露运行指标**」，日志同属运行指标。

**修复**：

1. **补门禁**（`electron/services/agent-service.ts`）——`AGENT.GET_LOG` 与 `AGENT.LIST` /     
   `AGENT.CONTROL` 使用同一 feature 键 `local_autopilot`（「查看 AI 销售团队」），     
   且授权拒绝 **403 原样透传**，便于前端区分「无权限」与「服务端故障」。
2. **修正报告建议的过度约束风险**——遗留建议 #2 字面表述（"所有 `AGENT.*` 通道 feature 键一致"）     
   若照做会**误伤正确设计**：`AGENT.GET_STATUS`（线索级触达徽标，线索是 Trial 合法数据）、     
   `AGENT.SUPPRESS_*`（邮件合规退订登记，任何套餐都必须可用）**本就不该门禁**。     
   改为**显式分类清单**：`GUARDED` / `UNGUARDED`（每项附豁免理由）/ `PUSH_ONLY`。

**新增守护测试**：`tests/business-logic/agent-gate-classification.business.test.js`（5 条）：  
① `GUARDED` 必须带 `requireFeature`；② `UNGUARDED` 必须**无**门禁（防过度约束）；  
③ `GUARDED` 不得退化为无门禁；④ **新增/未定级通道 → 直接失败**；⑤ 清单不得腐烂（不允许残留已删通道）。  
经**变异测试**双向验证有效：注入虚构通道 `AGENT.FAKE_NEW_CHANNEL` → 4 条失败并精确报出通道名；  
删除 `GET_LOG` 门禁 → 2 条失败。测试内**诚实标注静态断言边界**（验证"门禁代码在不在"，  
不验证"运行时确实 403"——后者由 `tests/e2e/permission-lock.test.js` 覆盖）。

**测试环境修复**：`tests/e2e/agent-persistence.test.js` 因新增门禁而失败——该测试用手写  
**无签名** `license_claims` 且 `app.isPackaged = true`，真实 guard 校验失败抛 401。  
改为打桩 `license-guard` 模块（**修测试环境缺失，非改代码迎合测试**）：该测试职责是  
P1-2「日志跨重启幸存」，授权语义由 `permission-lock.test.js` 专门覆盖。

**受影响 SSOT**：`ARCH-STANDARDS.md` §9.6 新增第 5a 条（AGENT.* 通道门禁分类）。

**验证**：typecheck 双侧 0 error；单测 **358/358**；`verify:consistency` 通过  
（文档交叉引用 165 处、IPC 契约通过、未新增通道）；lint 0 error。

---

## [1.4.3] — 2026-10-09 · 知识库真正接入获客链路（Seller-Knowledge Injection）

**背景**：审计发现知识库模块**并非 RAG**（embedding/向量检索零命中），且与获客链路  
**实质断开**——`usedKnowledgeTitles` 全程透传+持久化却**从未渲染**，用户无从判断  
AI 有没有用上自己的产品资料；Email 实时生成通道的 prompt **一个字的产品资料都没有**。

**修复（四处）**：

1. **检索兜底污染**（`electron/services/search/analysis.ts`）——`pickRelevantKnowledgeEntries`     
   原在命中不足时**按 `content.length` 无条件填充无关长文档**进 prompt，而 system prompt     
   又声明「以知识库作为卖方优势的首要来源」→ 既污染上下文又挤占相关条目名额。     
   改为**只返回真实命中**，同分按原始顺序稳定排序。
2. **知识库注入 Email 实时生成**（`electron/services/agent-service.ts`）——     
   `createLlmEmailContentProvider` 新增 `[SELLER KNOWLEDGE BASE]` 注入块。该 provider 的     
   system prompt 本就严格禁止编造资质，改造前却无资料可用，只能写出空洞开发信。
3. **WhatsApp 接入知识库**（`agent-service.ts` + `agents/whatsapp-agent.ts`）——     
   原为硬编码英文死模板。新增 `fallbackTextBuilder` 注入位（**刻意不用 LLM**：真实外发     
   路径上的同步环节，LLM 超时会阻断发送，违背「内容层失败永不阻断发送链路」）。
4. **知识库来源可见化**（`src/components/analysis-drawer.tsx`）——新增 `KnowledgeSourceCard`：     
   有命中显示蓝卡 + 条目列表 + 条数徽标；无命中显示琥珀色虚线卡 + 「去补全产品资料」     
   直达引导（新增 `kone:navigate-knowledge` 事件，与既有 `-settings`/`-leads` 对称）。

**新增**：`electron/services/agent-knowledge.ts`（Agent 侧知识库选取 SSOT）。

**守护测试**：`tests/business-logic/agent-knowledge-injection.business.test.js`（8 条，含  
**跨端副本守护**——UI 的 `quickTags` 措辞必须能被 Agent 侧检索命中）、  
`tests/business-logic/knowledge-retrieval-honesty.business.test.js`（6 条，锁死兜底污染不回退）。

**视觉验证**：`scripts/probe-knowledge-card.cjs` 纳入 `test:visual`。该探针内置**防自欺护栏**  
（patch 用 `defineProperty`、断言卡片几何有效、断言两场景截图哈希不同）——开发过程中它  
确实拦下了"两场景截出同一张图却报通过"的假阳性。

**受影响 SSOT**：`ARCH-STANDARDS.md` §9.6 新增第 4a 条。

**验证**：typecheck 双侧 0 error；单测 **353/353**；`verify:consistency` 通过  
（未新增 IPC 通道，计数器无漂移）；lint 0 error；视觉探针 4/4 通过（含看图复核）。

---

## [1.4.2] — 2026-10-08 · 云端测试纳入主门禁 + 备份校验向后兼容

### 一、`test:cloud` 纳入主门禁（门禁覆盖缺口）

**问题**：主 `npm test` = `verify:consistency && test:unit && test:ipc && test:e2e-smoke`，  
**不含 kone-cloud 的测试**。这意味着 [1.4.0] 新增的 24 个云端门禁测试  
（含 8 例负向授权、草稿版本校验、跨租户隔离）**没有任何 CI 保障** ——  
改了 `worker.ts` 也不会被拦下，门禁形同装饰。

**修复**：新增 `test:cloud`（`cd kone-cloud && npx vitest run`）并纳入 `npm test`。  
今后改云端代码会被主门禁拦截。

### 二、备份校验和向后兼容（数据可恢复性缺陷）

**发现**：2026-10-07 打包冒烟日志中出现  
`[BackupService] Checksum mismatch for ...backup-2026-09-11/13/14...json`。

**根因**：`backup-service.ts` 的 `computeChecksum` 在 **DATA-14** 中由 MD5 升级为  
SHA-256，但**升级前生成的历史备份仍带 MD5 校验和** → 升级后 `verifyBackup`  
一律判为校验失败。

**后果**：用户升级到新版后**无法恢复升级前的备份**，属数据可恢复性缺陷。

**修复**：SHA-256 不匹配时**回退尝试 MD5**，两者都不匹配才判为损坏。

- 安全性未削弱：篡改数据时两种算法都不匹配，仍会被拒绝（已有测试锁定）。
- 兼容路径会输出 warn 日志，建议恢复后重建备份以升级为 SHA-256。
- 权衡说明：MD5 强度较低，但仅在 SHA-256 不匹配时作为兼容分支尝试，    
  且备份位于本机用户目录；拒绝旧备份的代价（数据不可恢复）更高。

### 新增测试

`tests/backup-checksum-compat.test.ts`（5 例）：  
新格式通过 / **旧 MD5 格式兼容通过** / 篡改拒绝 / 文件不存在拒绝 / 结构非法拒绝。

### 门禁

主仓库 **324/324**（319 + 5）；`npm test` 全链路通过（含新增 `test:cloud` 59 项）；  
typecheck(src + electron) 0 error。

---

## [1.4.1] — 2026-10-07 · 打包冒烟打通（P0-5 遗留项闭环）

**背景**：审计与交付梳理长期将「打包冒烟 B2」记为**未通过**，  
原因是 `release/win-unpacked/resources/app.asar` 被系统级进程持有  
（`Device or resource busy`，且无 Electron/Kone 进程可见）。

**本次发现**：仓库**早已准备替代方案**，此前未被使用 ——

```json
"dist:alt":      "vite build && npm run build:electron && electron-builder --win nsis -c.directories.output=release-build",
"test:smoke:alt": "npm run dist:alt && node ./scripts/packaged-smoke.cjs release-build"
```

即**换输出目录**（`release-build/`）绕开被锁文件。

**执行结果（2026-10-07）**：

- 安装包成功产出：`release-build/Kone-Intellect-Setup-1.3.15.exe`（89.9 MB）
- 冒烟报告 `tests/packaged-smoke-report.json`：
  | 断言                        | 值                            |
  | ------------------------- | ---------------------------- |
  | `booted`                  | ✅ true                       |
  | `activationScreenVisible` | ✅ true                       |
  | `preloadBridgeVisible`    | ✅ true                       |
  | `dashboardNavVisible`     | false（**预期**：未激活时停在激活页，不进看板） |
- 通过判定（`scripts/packaged-smoke.cjs:124`）：    
  `!booted || !preloadBridgeVisible || (!activationScreenVisible && !dashboardNavVisible)`    
  → `false`，**冒烟通过**。

**遗留噪音（非阻断，已记录）**：

- `[BackupService] Checksum mismatch`：历史备份文件（2026-09-11/13/14）校验失败，    
  属旧数据遗留，不影响启动。
- `fsync EPERM ... 已降级为仅原子 rename`：文件系统不支持 fsync，代码已优雅降级。

**结论**：交付阻断项中的「打包冒烟」**已闭环**。  
今后验证打包请用 `npm run test:smoke:alt`，无需等待 `release/` 锁释放。

---

## [1.4.0] — 2026-10-07 · Phase 2.9 · 审批 → 云端二次门禁（阶段 1+2 落地）

**动机**：`AGENTS.md` 宪法第 5 条 —— *"A high score, staged Agent task or `cloud_send` feature never authorizes delivery. Approval plus server-side second-gate success is mandatory."*  
此前该宪法级约束在代码中**无实现**，属「宪法写了、代码没做」的纸面合规。  
设计方案见 `KONE-V1.3-审批与云端二次门禁设计方案-2026-10-07.md`。

**关键现状修正**：`queueOutreach` 原有的 `lead.status !== 'approved' && !== 'queued'` 校验中，  
`approved` 在本地**无任何设置点**（本地 status 枚举不含该值）→ 该校验分支实为**死代码**，  
真实路径靠 `queued` 宽松放行。即"门禁看起来在把关，其实是空的"。

### 阶段 1 · 云端二次门禁（已落地，提交 `4edd5b4`）

- **补齐门禁 ⑤⑥⑦⑧⑨**（`CLOUD-COLLABORATION-DELIVERY.md §8`），顺序不可调换：    
  ⑦ 审批校验必须在 ⑤⑥ 之后（否则可用无效审批做撞单探测）、在 ⑨ 之前（否则为无效请求消耗配额）。
  | 步 | 校验                    | 错误码                                            |
  | - | --------------------- | ---------------------------------------------- |
  | ⑤ | 撞单 / 保护期              | `COMPANY_CONFLICT`                             |
  | ⑥ | 全局抑制（优先级最高）           | `SUPPRESSED`                                   |
  | ⑦ | **审批记录 + 审批人 + 草稿版本** | `APPROVAL_REQUIRED` / `DRAFT_VERSION_MISMATCH` |
  | ⑧ | 邮箱等级 + 人工例外           | `EMAIL_GRADE_INSUFFICIENT`                     |
  | ⑨ | 日配额 / 熔断              | `QUOTA_EXCEEDED` / `CIRCUIT_OPEN`              |
- 草稿版本**严格相等**才放行 —— 落实规范 §6「旧批准不得授权新草稿」。
- **新增 `POST/GET /v1/approvals`**：表只追加不更新，「哪条有效」由门禁 ⑦ 以    
  「`decision='approved'` 且 `approved_at` 最新」+ draftVersion 相等 判定；    
  写入同时回写 lead 状态（approved / rejected / needs_revision→退回 pending_approval）+ 审计事件。
- **migration `005_approval_gate.sql`**：无表结构变更（`approvals` / `leads.approval_id` /    
  `delivery_quota` / `events` 枚举均已在 001 预留），仅补 `idx_approvals_lead_decision` 索引。    
  **刻意不回填历史 outreach** —— 回填等于伪造审批记录。
- `utils.ts` statusMap 新增 5 个错误码（仅新增，不改既有值）。


### 阶段 2 · 本地契约与载荷（已落地，提交 `a713c42`）
- 新增 2 个 IPC 通道：`cloud:create-approval` / `cloud:list-approvals`
  （待审批队列复用本地 `leads`，无需额外通道）。
- 契约新增 `ApprovalDecision` / `SubmitApprovalPayload` / `CloudApprovalRecord` /
  `CreateApprovalData` / `ListApprovalsData`；审批人取 `approverMachineId`
  （= 本机机器 ID，与 license machineId 对齐，单机使用场景）。
- `QueueOutreachPayload` 补 `draftVersion` / `approvalId` / `campaignId`（规范 §7.1 必需字段）。
- `cloudflare-service` 新增 `createApproval` / `listApprovals`，含 `mapApprovalRow` 显式
  snake→camel 映射（遵守 P0-1 教训：跨进程响应禁止裸 `as`）。

### ⚠️ 门禁默认关闭（重要）
`env.APPROVAL_GATE_ENABLED` **默认 `'false'`**。
**必须等阶段 3（本地审批 UI）就绪后才能开启** —— 否则用户无审批入口，
所有投递会被门禁 ⑦ 永久拒绝（`APPROVAL_REQUIRED`），反而破坏既有功能。
当前默认关闭保证了既有投递链路不受影响。

### 阶段 3 · 本地审批入口（已落地）
- `leads-table` 每行新增**「批准」按钮**（仅高级版显示）：未批准 → 可点；
  已批准（`lead.approvalId` 存在）→ 显示「已批准」并禁用。
- 点击后：取本机 `machineId` 作审批人 → 调 `cloud:create-approval` →
  本地写入 `approvalId` / `draftVersion`。
- `LeadItem` 新增 `approvalId?` / `draftVersion?`。
  **取舍**：本轮**不扩展 `LeadStatus` 枚举** —— 改枚举会触及既有 UI 分支与数据迁移，
  风险高于收益；审批态先以字段承载，状态机正式迁移作为独立后续任务。
- `QUEUE_OUTREACH` 载荷补 `draftVersion`（缺省 0，与审批记录保持一致）。
- `wrangler.toml` 显式声明 `APPROVAL_GATE_ENABLED = "false"`，并注释开启方式与影响。

### 阶段 3 补充 · 驳回 UI
「批准」按钮扩展为**「批准 / 驳回」**，`LeadItem` 新增 `approvalDecision`
（`undefined` = 未审批 / `approved` / `rejected` / `needs_revision`）。
「发送至云端」按钮增加前置条件 `approvalDecision === 'approved'` ——
与云端门禁 ⑦ 形成 **UI + 服务端双保险**（即使门禁开关关闭，流程也符合宪法）。

### 阶段 4 · 配额与熔断写入侧（已落地）
修复一个与"死代码"同性质的问题：**门禁 ⑨ 的配额检查此前永远不会触发** ——
它读 `delivery_quota`，但**没有任何代码写入该表**（"看起来有保护、实际不生效"）。
- `bumpDeliveryQuota(env, workspaceId, field, delta)`：跨日自动重置三个计数；
  列名经白名单映射（`QUOTA_COLUMN`），杜绝动态 SQL 注入。
- `maybeTripCircuit(env, workspaceId)`：退信率 > 5% 或投诉率 > 0.1% 时开启熔断
  （写 `circuit_open_until`，持续 1 小时）；已在熔断中不重复写入，避免被无限延长。
- 接入点：`/cron/send` 投递成功后累加 `sent_today`；webhook 的
  `email.bounced` / `email.complained` 累加对应计数并检查熔断。
- `DAILY_SEND_LIMIT` 提为**模块级常量**，门禁 ⑨ 与写入侧共用，避免两处漂移。

### 阶段 3 补充 · 待审批队列筛选
线索表「筛选条件」新增 **「仅显示待审批线索」**（勾选后隐藏已批准项），
作为 `kone-PRD §5.1` 第 8 条「前端必须提供待审批队列」的落地形态。
**取舍**：复用既有筛选机制而非新建独立路由页 —— 避免为一个筛选器引入新的
路由、状态管理与加载态，收益不成比例。

### 尚未完成
- **门禁开启**：`APPROVAL_GATE_ENABLED` 仍为 `"false"`。
  操作清单见 `KONE-V1.3-审批门禁端到端验证清单-2026-10-07.md`
  （含环境准备、云端部署、链路验证、门禁开启验证、curl 片段与判定标准）。
- **`needs_revision` UI**：**有意不做**。单机场景下审批人与草稿作者是同一人，
  「退回修订」无实际协作价值；且每行加到 4 个按钮会损害操作效率。
  云端 API 与门禁已支持该 decision，需要时可直接调用。
- **待审批独立页面**：当前以筛选器形态提供（见上「阶段 3 补充」的取舍）。

### 门禁
- kone-cloud：**53/53**（35 既有 + 18 新增门禁测试，含 8 例负向授权、
  `DRAFT_VERSION_MISMATCH` 覆盖「旧批准不得授权新草稿」、跨租户隔离、幂等、
  以及「门禁关闭时不拦截」的向后兼容断言）。
- 主仓库：typecheck(src + electron) 0 error；单测 **319/319**；
  `verify:consistency` 71 declared / 60 registered / 69 preload 全绿。

---

## [1.3.15] — 2026-10-07 · 文档回写 + 门禁补强（验收标准加固）

**目标**：[1.3.14] 修复 5 项 P0 后，继续清掉 P1-C（文档过期/矛盾）与 P2（功能与文档不符），
并为"商用专业严谨验收"补上**自动化防线**——让同类缺陷在 CI 阶段即被拦截，而非依赖人工审计。

### 一、补修 P1-B 漏项（[1.3.14] 遗漏）
- `kone-cloud/src/worker.ts` outreach 幂等键原为 `outreach_${leadId}_${now}`，**含时间戳** →
  `UNIQUE(workspace_id, campaign_id, idempotency_key)` 形同虚设，同一 lead 可被反复入队重发。
  改为 `outreach_${leadId}_stage${sequenceStage}`（不含时间戳，粒度对齐唯一键），
  并新增**幂等短路**：同 key 已有记录时返回既有 id（`idempotent:true`），而非撞 UNIQUE 抛 500。

### 二、P2 功能与文档对齐
- **分页**：`serpapi-maps/organic` 实为「第一页命中即停」的成本优化（代码注释已明示 `成本优化（P0）：命中即停`），
  但 `PROVIDER-CAPABILITY.md` 宣称 "含 pagination"。**处置为改文档而非改代码**——该行为是有意设计，
  已如实标注「分页循环已实现，默认第一页命中即停」并给出代码行号。
- **冷却时间**：`feature-gate.ts` 兜底分支 `cooldownMs: 12000` 与实时分支（15000）
  及 README「15 秒」声明不一致，属孤例 → 统一为 15000。

### 三、P1-C 文档回写（11 处）

| 文档 | 回写内容 |
|---|---|
| `CLOUD-COLLABORATION-DELIVERY.md` §0 | 「NO-GO」裸状态行 → 补全**已闭环 / 仍待闭环**清单 |
| `KONE-V1.3-Cloudflare…计划-2026-09-25.md` | 加**废弃警示头**（N8N 工作量被修订版订正为 8 文件/65 处），指向修订版 |
| `KONE-V1.3-深度审计报告…md` §五 | 「核心承诺尚未闭环」结论已过期 → 标注回写 + 原文留档 |
| `KONE-V1.3-交付前全面梳理…md` | `packaged-smoke ✅通过` → ⚠️**未通过**；勾选框 `[x]` → `[ ]` |
| `package.json` | 版本 `1.3.0` → `1.3.15` |
| `CHANGELOG.md` frontmatter | `lastVerifiedAt` 2026-09-22 → 2026-10-07 |
| `help-dialog.tsx` / `README.md` | 「Phase 1 接入后将支持脱机执行」→ 已落地 |
| `kone项目使用说明.markdown` | 「打分 >80 分深度分析」→ ≥60（宪法管道阈值）；注明 80 仅为上云 Gold Filter |
| `STATE-MACHINES.md` §5 | OutreachStatus「4 态 + 3 异常（目标态）」→ **8 态已实现**（含 `accepted` / `replied`） |
| `kone-PRD.md` §四.1 | 「最大并发锁死 2」收窄为「评分 / 富化 = 2」，并明确扇出 = 3 为**独立域** |
| `ARCH-STANDARDS.md` 红线 9 / 11 | 补**扇出豁免指针**（指向 `kone-PRD §0.3`），消除与 `SEARCH_FANOUT_CONCURRENCY = 3` 的表面矛盾 |

### 四、门禁补强（治本）· 新增 `npm run verify:cloud-safety`

**动机**：[1.3.14] 的 5 项 P0 **全部落在现有门禁盲区**且门禁全绿。
根因是既有门禁只做「字面值比对 + 引用断链」，无法发现语义缺陷。补上两类结构性检查：

1. **危险 SQL 谓词检查**：扫描 `kone-cloud/src` 全部 `UPDATE` / `DELETE`，要求带租户或主键谓词
   （`workspace_id` / `lead_id` / `resend_id` / `normalized_email` / `id = ?` / `ON CONFLICT`）。
   无谓词即**阻断** —— P0-2 这类跨租户事故可在 CI 阶段直接拦下。
   确属全局语义的语句可用 `safe-global:` 注释显式豁免（强制写明理由）。
2. **跨进程裸强转检查**：`cloudflare-service.ts` 禁止对跨进程响应使用 `as <Type>`，
   必须走显式映射函数 —— P0-1 这类「字段静默变 undefined」由此可被拦截。

**已做反向自测**（6 例）：P0-2 原样语句被拦截 ✅ / 修复后语句通过 ✅ / upsert 豁免 ✅ / 无谓词 DELETE 被拦截 ✅，
确认门禁**非"永远通过"的摆设**。当前扫描 5 源文件 / 11 条写操作 / 4 个跨进程类型，全部合规。

**已知局限**（诚实标注）：SQL 检查基于模板字符串 + 正则，非完整 SQL 解析器，
对动态拼接的极端写法可能漏判；跨进程检查只覆盖已知类型白名单。
两者定位是"拦住已知的高危模式"，不替代代码评审。

### 门禁
typecheck(src + electron) 0 error；单测 **319/319**；
`verify:consistency` = docs + ipc + **cloud-safety** 三者全绿；lint 0 error（254 warnings 均为既有）。

---

## [1.3.14] — 2026-10-07 · 云端投递链路 P0 缺陷修复 + 对客口径整改

**来源**：`KONE-V1.3-文档一致性与隐患深度审计报告-2026-10-07.md`。
全项目文档与代码交叉审计发现 5 项 P0 / 10 项 P1，本轮完成其中 5 项 P0 与 P1-A / P1-B 的修复。

**共同特征**：这些缺陷**全部落在现有门禁盲区**——`verify:consistency` 只做字面值比对与断链检查，
`tsc` 管不了运行时字段名，`npm run test:unit` 不覆盖跨进程契约。故修复前门禁全绿。

### P0-1 · 看板数据链路断裂（snake_case ↔ camelCase 零映射）
- **根因**：`kone-cloud` 返回 D1 原始行（`sent_at` / `workspace_id`），本地 `OutreachStatus` 为 camelCase（`sentAt` / `workspaceId`），
  而 `pollOutreachStatus` 用 `as PollOutreachResult` **裸强转**——TS 的 `as` 仅编译期生效，运行时字段名不变。
- **后果**：除 `id / status / subject / provider / error` 五个同名字段外，所有时间戳恒 `undefined` →
  漏斗全 0、趋势恒空、明细表被时间窗口整表过滤为空、CSV 时间戳列全空、IMAP 轮询恒 `skipped:'no_outstanding_outreach'`。
- **修复**：新增 `mapOutreachRow()` 显式映射；新增 `tests/cloud-outreach-field-mapping.test.ts`（4 条）锁定字段名防回归。
- **规则**：跨进程响应**禁止裸 `as` 强转**，一律走显式映射。
- **不受影响**：KPI 卡走 `dashboardStats`，其 SQL 别名本就是 camelCase，数据正常。

### P0-2 · 跨租户越权（安全，最高优先）
- **根因**：退订取消语句 `UPDATE outreach SET status='failed' WHERE status='pending'` 缺 workspace 与 email 谓词。
- **后果**：任一租户任一邮箱退订 → **全平台所有租户**的 pending 队列被清空。
- **修复**：按 `normalized_email` 限定（JOIN `leads`/`contacts`）。
- **刻意不加 workspace 谓词**：抑制名单本身是全局语义（`workspace_id = NULL`），加了反而会让其他租户继续向已退订邮箱投递。

### P0-3 · Webhook 事件去重键错配
- **根因**：`UNIQUE(provider, event_id)` 配 `event_id = data.id`（Resend 的 **email id**），
  而同一封邮件的 `sent / delivered / bounced` **共用该 id** → 首事件后后续事件判重复，`delivered / bounced` 永不落库。
- **修复**：改用 Svix 的 `svix-id`（每事件唯一）；新增 `004_webhook_event_idempotency.sql` 将唯一键改为 `(provider, event_type, event_id)` 双保险。

### P0-4 · `event_type` CHECK 缺 `email.replied`
- **根因**：`002_outreach_webhook.sql` 枚举未含该值（`003` 只重建了 `outreach` 表，遗漏 `webhook_events`），而 worker switch 已处理。
- **后果**：回复事件 INSERT 触发 CHECK 失败 → HTTP 500。
- **修复**：`004` migration 重建 `webhook_events` 补枚举（沿用 003 已验证的 `_new` → 复制 → DROP → RENAME 模式）。

### P0-5 · 73 个文件未提交（交付风险）
- **根因**：`[1.3.3]`–`[1.3.13]` 全部仅存在于工作区，HEAD 停在 2026-09-25，无提交号可追溯/回滚。
- **修复**：分两次提交落库 —— `4d01998`（审计修复，41 文件）+ `15ac352`（累积落库，46 文件）。
- **附带**：`kone-cloud` 子项目此前**完全未入库**（`git ls-files kone-cloud` = 0），本次首次纳入源码，已加 `.gitignore` 排除 `node_modules` 与 vitest 临时文件。
- **提交卫生**：严格用 `git add -u` + 显式路径，**未使用 `git add -A`**；已排除 `release.rar`、`tests/*-report.json`、`.omo/`、`.sisyphus/`、`.workbuddy-ai/`、归档目录。

### P1-B · 安全与状态机守卫
- `cronSecret` 改用 `constantTimeEqual`（原为 `!==` 普通比较，存在时序侧信道；文档声称已实现但实际未落地）。
- outreach UPDATE 加 `AND status NOT IN ('replied')` 守卫，防止迟到的 `email.delivered` 把已回复记录回退。

### P1-A · 对客口径整改（合规）
`PROVIDER-CAPABILITY.md:24` 明令禁止以「官方海关提单数据库」口径宣传。三处 UI 已按代码事实改写：
- `src/lib/data-source-meta.ts`：`海关提单` → `海关线索（参考）`（徽标出现在全部线索卡片，与免责声明不同屏）
- `src/components/settings/base-settings-tab.tsx`：删除「深度穿透潜客高管**个人邮箱**」（anysearch 的 email 仅为第三方透传，无邮箱发掘实现）
- `src/hooks/use-search-engine.ts`：`全网海关数据` → `公开网页海关线索…（近似匹配，仅供参考）`

### 顺带修正
- `OutreachStatus` 可空字段统一为 `| null`，与前端 `CloudOutreachRecord` 对齐（原为 `?: string`，无法表达 D1 的 NULL 语义）。

### 门禁
typecheck(src + electron) 0 error；单测 **319/319**（315 → 319，新增 4 条映射契约测试）；
`verify:consistency` 69 / 58 / 11 / 0；lint 0 error（254 warnings 均为既有）。

---

## [1.3.13] — 2026-09-29 · Phase 2.8e · 云端看板 60 秒自动刷新

**目标**：P2.7 落地看板后，用户长时间挂着（例如跑一批投递期间）看不到 KPI/漏斗/趋势的实时变化，只能手动 F5。本轮在组件层加入 60 秒静默刷新，让看板成为"活着"的面板。

### 实现
- **周期**：60 秒（比 IMAP 15 分钟快、比应用心跳慢，不打爆云端 dashboard API）
- **静默刷新**（`refreshSilent`）：不调用 `setView('loading')` / `setView('error')`，仅在数据就绪后原地更新 `stats / records / imap / loadedAt`。用户正在读表 / 选时间窗口时不会被 skeleton 打断
- **视图状态守护**：`refreshSilent` 内部先检查 `viewRef.current === 'ready'`，`loading` / `error` / `idle` 态跳过（避免覆盖首屏加载）
- **前台可见性判断**（`document.visibilityState`）：
  - 首次 mount：启动 60s `setInterval`
  - `visibilitychange` 切到 `hidden`：标记 `paused = true`，后续 tick 直接 return（不发起 IPC）
  - 切回 `visible`：清 `paused` + **立即**触发一次 `refreshSilent`（弥补切走期间的空档）
- **卸载清理**：组件卸载时 `clearInterval` + `removeEventListener`，防内存泄漏

### 设计取舍
- **静默刷新 vs 全屏 loading**：静默不打断用户操作，代价是加载指示器不会刷新；页面底部"更新于 HH:mm:ss"的时间戳会即时更新，作为唯一可见的刷新信号
- **不新增 IPC / 不新增云端 API**：完全走既有 `cloudflareDashboardStats` + `cloudflarePollOutreachStatus` + `imapStatus` 三个通道
- **不上报到应用心跳日志**：60s 一次的 UI 数据刷新属于正常业务流量，不打点
- **不设开关**：看板只在 premium/enterprise 展示，本身就是"看数据"入口，静默刷新是合理默认；显式开关留待用户抱怨后再补

### 门禁
- 无新增 IPC 通道（IPC 计数保持 69 / 58 / 11 / 0）
- typecheck src + electron 全绿、315 单测全绿、verify:consistency 通过、lint 0 errors

---

## [1.3.12] — 2026-09-29 · Phase 2.8d · IMAP 主机连接测试按钮

**目标**：IMAP 主机配置容易出错（用户混淆 `smtp.gmail.com` 与 `imap.gmail.com`、端口、认证方式），此前配置完只能等 timer 首轮报错才发现，诊断周期长达一个 poll interval。本次在云端看板 IMAP 面板新增**"测试连接"按钮**，用户 30 秒内可验证凭据是否有效。

### 新增 IPC 通道（+1 declared，+1 registered）
- **`automation:imap-test-connection`** → 主进程做一次纯连接性验证（connect + `getMailboxLock('INBOX')`），**不拉邮件、不做 message-id 匹配、不写云端**
  - 返回：`{ ok, message, mailbox?, totalMessages?, latencyMs }`
  - Fail-Closed：未配置时返回 `ok:false, message:'IMAP 未配置：请在账户管理邮箱表单中填写 IMAP 主机…'`
  - 超时：`socketTimeout: 30_000`（30 秒）
  - 无锁：不占用 `clientLocks`（测试是独立一次性连接，不干扰后台 timer）


### 主进程实现（`imap-reply-service.testImapConnection`）
- 复用 `readImapCredentials`（读 `cloud.imap*` 五个 key）
- 独立实例化 `ImapFlow`（不复用 poll 用的连接，避免锁竞争）
- 成功路径：`connect → getMailboxLock('INBOX') → mailbox('INBOX').exists → release → logout`
- 失败路径：捕获 Error 消息原样返回（含 `ECONNREFUSED` / `AUTHENTICATE` 拒绝 / `Invalid user or password`），便于用户判断是网络还是凭据问题

### 前端（`cloud-outreach-dashboard.tsx` IMAP 面板）
- **新增按钮**："测试连接"（`PlugZap` 图标），与既有"立即轮询一次"并列成 2 列
- **结果卡片**：成功绿色 + `CheckCircle2` / 失败红色 + `XCircle`；显示 message + 延迟（ms）
- **加载态**：按钮图标变 `Loader2 animate-spin`，按钮 disabled 防重复点击
- **失败处理**：IPC 抛错时把 err.message 塞进 result，仍渲染红色卡片（不因网络抖动让 UI 静默）

### 设计取舍
- **不复用 poll 的连接锁**：测试是低频、独立操作，与后台 timer 并发安全
- **不缓存结果**：每次点击都真实连接一次，避免用户看旧结果误判
- **不上报云端**：测试是本地诊断动作，不产生投递/回复数据
- **不修改既有 timer 逻辑**：测试是纯诊断，不影响 `startImapReplyPoll` / `stopImapReplyPoll` 生命周期

### 门禁
- IPC 计数：69 declared / 58 invoke registered / 11 push / 0 plain
- `ipc-startup-gate.test.ts`：`collectInvokeChannels` 断言 57 → 58
- typecheck src + electron 全绿、262+ 单测全绿

---

## [1.3.11] — 2026-09-29 · Phase 2.8c · IMAP 自动回复检测开关 UI

**目标**：P2.8b 把 IMAP 自动轮询 timer 挂上了 `main.ts`，但 `cloud.imapReplyDetectionEnabled` 默认 false、无 UI 可切换——用户配好 IMAP 主机后仍需在 Settings 里手动 `config.set` 或直接改 user_config 才能让自动检测跑起来。本次补齐**"自动回复检测"开关 UI + 轮询间隔 + 回溯天数**，让高级版用户在邮箱表单里一站式配置。

### 新增 IPC 通道（+1 declared，+1 registered）
- **`automation:imap-restart`** → 主进程 stop → start IMAP 轮询 timer，返回最新 `ImapStatusData`
  - 场景：UI 落盘 config 后立即调此通道，无需重启应用即可让新设置生效
  - Fail-Closed：若 enabled=false，`startImapReplyPoll` 立即返回，timer 保持 null

### 邮箱表单新增区块
- **位置**：`accounts-management.tsx` 邮箱表单 IMAP 凭据下方（"IMAP 收信"分隔线之后）
- **三档设置**：
  - **自动回复检测开关**（Switch）：默认关，切换后调 `imapRestart()` 即时重启 timer
  - **轮询间隔**（4 档 chip：5 / 15 / 30 / 60 分钟）：默认 15 分钟
  - **回溯天数**（3 档 chip：1 / 3 / 7 天）：默认 3 天
- **数据源**：直接读写 `configStore` 的 `cloud.imapReply*` 三个 key（不写入 user_config，避免混淆）
- **持久化流程**：`configSet` × 3 → `imapRestart()` → 更新本地 state；失败时 toast + 不更新 state（避免 UI 与后端不一致）
- **加载**：`useEffect` 挂载时 `Promise.all([configGet × 3])` 回读当前值，失败用默认值

### 设计取舍（诚实化）
- **不新增 config schema / 不动云端 API / 不引入 IPC 认证**：完全走既有 `configGet` / `configSet` 通道
- **timer 即时重启而非延迟生效**：用户切换开关后立刻能看到效果（P2.8b 挂载后已具备 `stopImapReplyPoll` 语义）
- **三档默认值与主进程 `getImapReplyConfig` 完全一致**：`enabled=false` / `intervalMs=15*60*1000` / `lookbackDays=3`，避免用户看到"UI 显示 A，实际生效 B"
- **chip 组而非 Select**：3-4 个固定选项，chip 更直观；与 P2.8a 看板时间窗口 chip 视觉一致
- **不校验 IMAP 主机是否已填**：即使未配置 IMAP 主机，开关仍可切换（`imap-reply-service` 内部会 `skipped: 'imap_not_configured'` 静默降级，不报错）

### 门禁与测试矩阵
- `tsc --noEmit -p tsconfig.json` ✅ 0 errors
- `tsc -p tsconfig.electron.json` ✅ 0 errors
- `npm run test:unit` ✅ **315/315**
- `npm run verify:consistency` ✅ **68 声明 / 57 已注册 / 11 推送 / 0 plain / 142 交叉引用**
- `npm run lint` ✅ 0 errors（254 warnings 无新增）

### 规范回写
- **`CLOUD-COLLABORATION-DELIVERY.md §13.1.6`**：追加"IMAP 自动回复检测开关 UI 已落地"，未闭环项中"无 UI"关闭
- **`kone-PRD.md §零.3` 宪法常量表**：本次未新增常量

### 未闭环项（不阻断发布）
- **IMAP 主机健康检测**：本次仅落"配置→开关→timer 启动"闭环；未做 IMAP 连接性测试按钮（下一轮候选）

**受影响 SSOT**：`CHANGELOG.md`、`CLOUD-COLLABORATION-DELIVERY.md` §13.1.6、`electron/ipc/channels.ts`、`electron/services/imap-reply-service.ts`、`preload/index.ts`、`src/shared/ipc-contracts.ts`、`src/lib/electron-api.ts`、`src/main.tsx`、`src/components/accounts-management.tsx`、`tests/ipc-startup-gate.test.ts`。

---

## [1.3.10] — 2026-09-29 · Phase 2.8b · 后台轮询定时器挂载（IMAP + Outreach Sync）

**目标**：P2.5 / P2.6 / P2.7 落地了 IMAP 回复检测与云端 outreach 状态同步两条后台链路的基础设施，但两个 timer 都"仅 export 未挂载"——用户即便配置了 IMAP 主机、开启了高级版，云端数据也不会自动更新，只能在看板点"刷新"手动拉。本次在 `main.ts` 挂载两条 timer，让**云端数据自动刷新**成为交付默认行为。

### 交付
- **`electron/main.ts` whenReady 尾部**：`registry.lock()` 之后立即调用 `startOutreachSync(store, mainWindow)` + `startImapReplyPoll(store, mainWindow)`，确保"注册中心 gate 之后"的生命周期不变量（通道就绪后再发起网络调用）
- **`electron/main.ts` before-quit**：追加 `stopOutreachSync()` + `stopImapReplyPoll()`，退出前主动清 timer，避免退出过程中触发新一轮 poll
- **`electron/services/imap-reply-service.ts` `startImapReplyPoll`**：新增首次轮询延迟 5 秒（`setTimeout`），与 `outreach-sync-service` 的启动节奏对齐，避免 IMAP + Cloudflare 认证风暴
- **`electron/services/imap-reply-service.ts` `stopImapReplyPoll`**：追加 `clearTimeout(firstPollTimeout)`，防止 stop 后 5 秒延迟触发一次漏网轮询

### 设计取舍（诚实化）
- **两个 timer 的开关策略不对称**：
  - `cloud.outreachSyncEnabled` 默认 **true**（Phase 2 起即默认）：60s 轮询是核心闭环，客户默认开启合理
  - `cloud.imapReplyDetectionEnabled` 默认 **false**：15min 拉 IMAP 是可选增强，客户 IMAP 服务器并发上限差异大，保守不主动开启
- **不引入调度器抽象**：两条 timer 都用原生 `setInterval` + `setTimeout`，与既有 codebase 风格一致；不引入 cron 库或更复杂的调度层（拒绝过度工程化）
- **不改 IPC / 不改云端 API / 不改 config schema**：完全走既有 `store.get('cloud.outreachSyncEnabled')` / `store.get('cloud.imapReplyDetectionEnabled')` 通道
- **`before-quit` 用 try/catch 包裹**：即使 stop 抛错也不阻塞 quit 流程

### 客户体验
- **默认（未配 IMAP）**：应用启动后 5 秒，`outreach-sync` 开始 60s 一轮地刷新云端状态；`imap-reply` 因为 enabled=false 立即返回，timer 保持 null。**行为与升级前完全一致**，不引入意外开销
- **配置 IMAP 后**：客户配置 `imapHost` 且把 `cloud.imapReplyDetectionEnabled` 置 true（可通过 Settings / cloud config API 设置，本轮未新增 UI）→ 5 秒后开始首次 IMAP 轮询 → 之后每 15 分钟自动拉回复。**不再需要用户手动点"立即轮询一次"**

### 门禁与测试矩阵
- `tsc --noEmit -p tsconfig.json` ✅ 0 errors
- `tsc -p tsconfig.electron.json` ✅ 0 errors
- `npm run test:unit` ✅ **315/315**
- `npm run verify:consistency` ✅ 67 声明 / 56 注册 / 11 推送 / 0 plain / 142 交叉引用
- `npm run lint` ✅ 0 errors（254 warnings 无新增）

### 规范回写
- **`CLOUD-COLLABORATION-DELIVERY.md §13.1.6`**：Timer 挂载状态从"未挂载"更新为"P2.8b 已挂载"
- **`CLOUD-COLLABORATION-DELIVERY.md §13.1.3`**：追加"outreach-sync timer 已在 main.ts 挂载"
- **`kone-PRD.md §零.3` 宪法常量表**：本次未新增常量

### 未闭环项（不阻断发布）
- **IMAP 自动轮询启用开关无 UI**：客户仍需在 Settings 中通过 config API 或直接写 user_config 把 `cloud.imapReplyDetectionEnabled` 置 true。下一轮候选项：在 `accounts-management.tsx` 邮箱表单加"自动回复检测"toggle。
- **`startOutreachSync` 的初始 delay 未对齐**：`outreach-sync-service` 已用 5s delay，`imap-reply-service` 本轮补齐；两者语义对齐，无遗留 gap。

**受影响 SSOT**：`CHANGELOG.md`、`CLOUD-COLLABORATION-DELIVERY.md` §13.1.3 / §13.1.6、`electron/main.ts`、`electron/services/imap-reply-service.ts`。

---

## [1.3.9] — 2026-09-29 · Phase 2.8a · 看板时间窗口 + 投递明细表 + CSV 导出

**目标**：Phase 2.7 的看板展示整体战况（KPI + 漏斗 + 30 日趋势 + IMAP 状态），但用户仍看不到"逐条投递的具体状态、失败原因、时间"。本次在看板底部追加**投递明细表 + 时间窗口筛选 + CSV 导出**，让高级版用户既能看总量、也能下钻逐条明细并留存证据。

### 交付
- **时间窗口筛选**（4 档 chip：近 7 天 / 30 天 / 90 天 / 全部）：默认 30 天，切换即刻重算漏斗 + 趋势 + 明细；KPI 卡不受影响（始终展示云端聚合总量，与云端 dashboard API 口径一致）
- **投递明细表**（`OutreachTable`）：最多 50 行，7 列（时间 / 主题 / 状态徽章 / Provider / Message ID / 尝试次数 / 失败原因）；时间窗口过滤后取前 50 条，状态徽章按终态着色（success/info/warning/danger/muted）
- **CSV 导出**（`exportCsv`）：导出当前时间窗口下的**全部明细**（不仅限于表格前 50 条），带 UTF-8 BOM（Excel 打开中文不乱码）、RFC 4180 转义、文件名带日期戳 `cloud-outreach-YYYY-MM-DD.csv`；用 `URL.createObjectURL` + `Blob` 触发浏览器下载，无第三方依赖
- **趋势标题动态化**：随时间窗口切换为「近 7 天 / 30 天 / 90 天投递趋势」或「投递趋势（全部）」
- **表格空态**：筛选窗口内无数据时显示"当前时间窗口内暂无投递明细"提示，非空白

### 数据源复用（未新增 IPC）
- 时间窗口过滤基于前端已拉取的 `pollOutreachStatus({limit:300})` 结果集，按 `sentAt ?? createdAt` 时间戳过滤
- 漏斗、趋势、明细三个视图共享 `filteredRecords` 派生数据，避免重复计算
- 数据上限仍为 300 条（云端默认 limit），超过 300 条的极端场景需后续追加分页/游标

### 设计取舍
- **不在 IPC 层做时间过滤**：现有 `pollOutreachStatus` 支持 `status` 但不支持时间范围；本次前端过滤，避免云端 API 变动 + D1 schema 迁移。300 条上限内性能完全够用。
- **表格默认 50 行 + CSV 导全部**：50 行是可读性与性能平衡；CSV 让需要全部明细的用户一键落盘，避免 DOM 过重。
- **KPI 卡不受时间窗口影响**：KPI 卡是"全局快照"，用户直觉是"看到总账"，若同时受时间窗口影响会产生认知错位；已在时间窗口筛选条上显式标注"当前窗口共 N 条投递"作为交叉参照。
- **CSV 采用 UTF-8 BOM**：Windows 中文 Excel 默认以 GBK 打开 CSV，BOM 前缀让 Excel 正确识别编码。

### 门禁与测试矩阵
- `tsc --noEmit -p tsconfig.json` ✅ 0 errors
- `npm run test:unit` ✅ **315/315**
- `npm run verify:consistency` ✅ 67 声明 / 56 注册 / 11 推送 / 0 plain / 142 交叉引用（本次未新增 IPC）
- `npm run lint` ✅ 0 errors（254 warnings 全部为历史遗留，无新增）

### 规范回写
- **`CLOUD-COLLABORATION-DELIVERY.md §13.1.7`**：追加"时间窗口 + 明细表 + CSV 导出"落地注记
- **`kone-PRD.md §零.3` 宪法常量表**：本次未新增常量
- **`src/components/cloud-outreach-dashboard.tsx`**：新增 `TimeWindow` 类型 + `TIME_WINDOW_OPTIONS` + `STATUS_META` + `OutreachTable` + `exportCsv` + 时间窗口 chip 条 + 明细表

### 未闭环项（不阻断发布）
- 云端 API 无原生时间过滤：超过 300 条历史记录的长尾场景需追加分页游标或云端时间范围参数
- 表格排序/搜索：本次先做默认时序（云端返回顺序），未做二次交互

**受影响 SSOT**：`CHANGELOG.md`、`CLOUD-COLLABORATION-DELIVERY.md` §13.1.7、`src/components/cloud-outreach-dashboard.tsx`。

---

## [1.3.8] — 2026-09-29 · Phase 2.7 · 云端触达看板（投递漏斗 + 30 日趋势 + IMAP 状态）

**目标**：Phase 2 / 2.5 / 2.6 已把云端投递、回复检测、IMAP 配置三条链路全部落地为可运行基础设施，但**用户看不到数据**。本次把三条链路聚合到一个可视化面板——`CloudOutreachDashboard`——嵌入「智能触达工作流」页面顶部，让高级版用户在 30 秒内掌握整体战况（KPI + 漏斗 + 趋势 + IMAP 状态）。

### 新增 IPC 通道（+2 declared，+2 registered）
- **`cloud:cloudflare-dashboard-stats`** → `getDashboardStats`：KPI 聚合（排队/已发/送达/退信/投诉/失败/回复/同步版本）
- **`cloud:cloudflare-poll-outreach-status`** → `pollOutreachStatus({limit:300})`：拉取明细用于漏斗 + 30 日趋势聚合
- 两处 handler 均封装 `success` / `error` 双态返回，前端 Fail-Closed 展示"未连接"占位而非崩溃

### 云端看板组件（`src/components/cloud-outreach-dashboard.tsx` 新建）
- **KPI 8 卡**：排队 / 已发送 / 已送达 / 已回复 / 退信 / 投诉 / 发送失败 / 同步版本，四色分层（info=蓝 / success=绿 / warning=琥珀 / danger=红）
- **三大比率**：送达率、回复率、退信率；**送达率分母扣除退信+投诉**，反映真实到达客户邮箱的比例（诚实标注，避免用户误读）
- **投递漏斗**：6 阶段（排队→已发→送达→退信→投诉→回复）横向条 + 占比 + 计数；每阶段单独分母（sent 系以 sent 为分母，排队以 total 为分母），标注说明避免误读
- **IMAP 回复检测面板**：配置状态、轮询间隔、回溯天数、运行状态、上次轮询详情（扫描数/命中/上报/幂等/错误），支持一键触发 `imapPoll()`
- **30 日趋势迷你图**：纯 SVG 手绘折线（无第三方依赖），三条曲线（发送/送达/回复），横轴显示日期范围与图例
- **三态展示**：云端未配置 → 空态卡引导去设置；加载中 → skeleton；就绪 → 完整看板
- **嵌入位置**：`automation-workflow.tsx` 顶部（`canUseCloudSend` 为 true 时显示）

### 数据流与类型
- **`electron/ipc/channels.ts`**：新增 `CLOUDFLARE_DASHBOARD_STATS` / `CLOUDFLARE_POLL_OUTREACH_STATUS`
- **`electron/services/cloudflare-service.ts`**：`registerCloudflareHandlers` 新增 2 个 handler，均通过 try/catch 包装，返回 `{success:false, error:{code,message}}` 而非 throw
- **`preload/index.ts`**：`cloud.cloudflareDashboardStats()` / `cloud.cloudflarePollOutreachStatus(opts)` 暴露
- **`preload/index.ts`**：`automation.imapPoll()` / `automation.imapStatus()` 暴露（P2.5 已实现通道，此处补 preload 层）
- **`src/shared/ipc-contracts.ts`**：新增 `CloudDashboardStats` / `CloudOutreachRecord` / `CloudPollOutreachData` / `CloudImapPollResult` / `CloudImapStatusData` 五个类型
- **`src/lib/electron-api.ts`**：新增 `cloudflareDashboardStats()` / `cloudflarePollOutreachStatus()` / `imapPoll()` / `imapStatus()` 四个 wrapper
- **`src/main.tsx`**：dev shell 补齐 4 个 stub（避免 Web-only 开发模式 typecheck 失败）


### 设计取舍
- **funnel 不用 recharts**：recharts 无内置 FunnelChart，且为单一漏斗引入整块依赖过重；改为纯 CSS 条 + 比例计算，可读性优先
- **30 日趋势用 SVG 手绘**：看板角落不需要复杂交互，SVG polyline 已足够；主图表 (data-center) 仍保留 recharts AreaChart
- **不新增定时器订阅**：用户点"刷新"或页面加载时拉一次；自动轮询延至客户 IMAP 并发决策后与 `outreach-sync-service` 一并挂 `startImapReplyPoll()`

### 门禁与测试矩阵
- `tsc --noEmit -p tsconfig.json` ✅ 0 errors（src）
- `tsc --noEmit -p tsconfig.electron.json` ✅ 0 errors（electron）
- `npm run test:unit` ✅ **315/315**
- `npm run verify:consistency` ✅ **67 声明通道 / 56 已注册 / 11 推送 / 0 plain 直挂 / 142 文档交叉引用**
- `npm run test:security-audit` ✅ 6/6（`release/win-unpacked` 缺失为已知打包阶段问题，参见 1.3.7 未闭环项）
- `tests/ipc-startup-gate.test.ts`：invoke 断言从 54 更新到 **56**（新增 2 通道）

### 规范回写
- **`CLOUD-COLLABORATION-DELIVERY.md §13.1`**：未闭环项更新，新增 §13.1.7 "云端触达看板" 落地记录
- **`kone-PRD.md §零.3` 宪法常量表**：本次未新增常量
- **`electron/ipc/channels.ts`**：新增 2 通道（Phase 2.7 注释块）
- **`src/shared/ipc-contracts.ts`**：新增 5 个 Cloud 类型（Cloud Outreach Dashboard Types 章节）

### 未闭环项（不阻断发布）
- **自动轮询定时器**：与 1.3.7 相同，等待客户 IMAP 并发决策；看板"立即轮询一次"按钮已可提供手动入口
- **打包冒烟 (B2)**：`release/win-unpacked/resources/app.asar` 系统进程独占，需在锁释放环境跑
- **真实数据端到端**：看板需要 Cloudflare + Resend + IMAP 三源齐全才能显示非零数据；dev shell stub 返回空态

**受影响 SSOT**：`CHANGELOG.md`、`CLOUD-COLLABORATION-DELIVERY.md` §13.1、`electron/ipc/channels.ts`、`electron/services/cloudflare-service.ts`、`preload/index.ts`、`src/shared/ipc-contracts.ts`、`src/lib/electron-api.ts`、`src/main.tsx`、`src/components/automation-workflow.tsx`、`tests/ipc-startup-gate.test.ts`。

---

## [1.3.7] — 2026-09-29 · Phase 2.6 · IMAP 凭证 UI 落地（关闭 P2.5 唯一 UI 缺口）

**目标**：Phase 2.5 的 IMAP 回复检测基础设施（1.3.6）已在服务端与本地服务层完整落地，但用户仍无法在 Settings 中配置 IMAP 主机——基础设施因此是"死代码"。本次补齐 `accounts-management.tsx` 的 IMAP 配置区，让 Phase 2.5 从"能跑但配不了"变为"能跑也能配"。

### 本地（`electron/` + `src/`）
- **加密槽扩展**（`electron/services/config-service.ts`）：`SECRET_KEYS` 新增 `EMAIL_IMAP_PASS = 'secrets.email.imapPass'`，与既有 `EMAIL_SMTP_PASS` 并列。IMAP 密码独立槽位，允许客户在同一账号不同协议使用不同应用专用密码。
- **类型扩展**（`src/lib/user-config.ts`）：`EmailAccountConfig` 新增可选 `imapHost? / imapPort? / imapUser? / imapPass?` 字段，文档注释明确 IMAP 不派生自 SMTP + `imapPass` 明文字段仅作遗留回退（新保存走 secret-manager）。
- **凭证回退链**（`electron/services/imap-reply-service.ts` `readImapCredentials`）：密码取值顺序更新为 `imapPass 加密槽 → imapPass 明文遗留 → smtpPass 加密槽 → smtpPass 明文遗留`。允许"共用同一密码"场景直接留空 `imapPass` 复用 SMTP 槽；imapUser 缺省回退 smtpUser。
- **UI 落地**（`src/components/accounts-management.tsx`）：邮箱表单新增"IMAP 收信（可选）"分区，与 SMTP 分区用分隔线区隔；4 个字段（IMAP 主机 / 端口 / 用户名 / 密码），全部字段留空即视为"未配置"，`imap-reply-service` 侧自动 skip 静默降级。密码独立回显"已保存"徽标（复用 SMTP 的 `secretCheck` 机制）。表单标题与说明文案明确标注 IMAP 主机与 SMTP 主机不同、imapUser/imapPass 留空回退到 SMTP 值的语义。
- **保存路径**（`handleSaveEmail`）：IMAP 字段一律写入 `user_config.accounts.email`（即便为空，保持显式）；`imapPass` 明文槽位清空，实际密码写 `secretSet({ key: 'secrets.email.imapPass' })`；SMTP 逻辑不变。

### 与既有 `email-agent.checkReply` 的边界（延续 1.3.6 决策）
- `email-agent.checkReply` 按发件人**域名**匹配（本地 Agent 序列推进，粒度 = lead）。
- `imap-reply-service.pollReplies` 按 `In-Reply-To` 匹配具体 `provider_message_id`（云端投递闭环，粒度 = 单条 outreach）。
- 两者读取同一 IMAP 凭证，粒度与语义不重叠，不做合并。


### 门禁与测试矩阵
- `npx tsc --noEmit -p tsconfig.json` ✅ 零错误（src 侧）
- `npx tsc --noEmit -p tsconfig.electron.json` ✅ 零错误（electron 侧）
- `npm run test:unit` ✅ **315/315**（无新增测试——UI 层为纯表单，不引入新的可断言逻辑；主进程凭证回退链已由 imap-reply-service 单测覆盖）
- `npm run verify:consistency` ✅ 65 声明通道 / 54 已注册 / 11 推送 / 0 plain 直挂（本轮无 IPC 变更）
- `npm run lint` ✅ 0 error（imap-reply-service 3 处 `any` warning 延续 P2.5 决策——imapflow 动态 envelope/headers 结构无强类型，与既有 `email-agent.checkReply` 口径一致）

### 规范回写
- **`CLOUD-COLLABORATION-DELIVERY.md §13.1.6`**：将"未闭环项 · IMAP 凭证 UI"从待办移至"已闭环"注记，并补充 IMAP UI 落地细节与密码回退链。
- **`kone-PRD.md §零.3` 宪法常量表**：本次未新增常量。

### 未闭环项（不阻断发布）
- **定时轮询 timer 挂载**：`startImapReplyPoll()` 已 export，需在客户 IMAP 服务器并发上限确认后挂载到 `main.ts`。与 `outreach-sync-service` 同状态，一并决策（详见 1.3.6 未闭环项）。
- **小流量实发验证**：Phase 2 + Phase 2.5 + Phase 2.6 全部依赖真实 Resend + IMAP 环境，需在干净机器人工执行。
- **打包冒烟（B2）**：受 `release/win-unpacked/resources/app.asar` 系统进程独占阻塞，需在锁释放环境执行 `npm run test:smoke`。

**受影响 SSOT**：`CLOUD-COLLABORATION-DELIVERY.md` §13.1.6、`src/lib/user-config.ts`、`electron/services/config-service.ts`（SECRET_KEYS）、`electron/services/imap-reply-service.ts`（凭证回退链）、`CHANGELOG.md`。

---

## [1.3.6] — 2026-09-29 · Phase 2.5 · IMAP 回复检测基础设施

**目标**：补齐 Phase 2 遗留的 "replied" 终态落地缺口。Phase 2 的投递闭环只到 Resend 侧的 `delivered / bounced / complained` 三态，客户回复邮件的接收未接入。本次以**本地 IMAP 拉取 + In-Reply-To 精确匹配**的方式把 outreach 收敛到 `replied` 终态，与 Resend `email.replied` webhook 通道并存（本地优先，云端兜底）。

### 云端（`kone-cloud/`）
- **P2.5-a · D1 迁移**（`migrations/003_reply_detection.sql`）：`CREATE TABLE outreach_new` 允许 `status IN ('pending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'replied')`（SQLite 不支持修改 CHECK，需建表→复制→DROP→RENAME→重建索引）；新增 `email_opened_at` / `email_clicked_at` 列；新增 `email_replies` 表（`UNIQUE(outreach_id, message_id)` 幂等键 + 3 个索引）；新增 `idx_outreach_sent_at` 供 IMAP poller 的 `since` 窗口扫描。
- **P2.5-b · Webhook 事件扩展**（`src/worker.ts`）：`handleResendWebhook` 的 switch 补 `email.opened`（落 `email_opened_at`，保持 `delivered`）/ `email.clicked`（落 `email_clicked_at`，保持 `delivered`）/ `email.replied`（落 `replied_at`，置 `replied` 终态）。签名验证、时间窗、常时比较、事件级去重复用 P2-13 的 Svix HMAC 实现。
- **P2.5-c · 新路由** `POST /v1/outreach/reply`（`src/worker.ts` `handleReportReply`）：入参 `outreachId` / `messageId` / `sender`（必填）+ `inReplyTo` / `subject` / `replyBody` / `receivedAt`（选填）；先按 `(id, workspace_id)` 校验 tenant 隔离，再按 `UNIQUE(outreach_id, message_id)` 幂等短路；命中则写入 `email_replies` 存档 + `events type='outreach.replied' actor='imap_poller'` 审计 + bump `sync_tokens`，并将 outreach 置为 `replied`。响应体携带 `idempotent: true|false` 让本地 poller 决定是否重复推送本地状态。
- **P2.5-d · Cron 收件人修复**（`src/worker.ts`）：`handleCronSend` 原先直接用 `outreach.lead_id` 当收件人（错误），改为 JOIN `leads` + `contacts` 取 `normalized_email`（Phase 2 E2E 测试暴露）。

### 本地（`electron/`）
- **P2.5-e · 新服务**（`services/imap-reply-service.ts`）：`imapflow` 连接 INBOX → 搜索 `since = now - lookbackDays` → 拉 `envelope + headers:['In-Reply-To','References','Message-Id']` → 归一化（小写、去 `< >`、去空白）后与云端 `outreach.provider_message_id` map 匹配 → 命中调 `reportOutreachReply` → 上报成功且非幂等短路时推送 `AGENT.LEAD_STATUS_UPDATED`（`whatsappStatus='replied'`）。返回体 `{ polled, matched, reported, idempotent, skipped?, errors, since, at }` 供 UI 与日志消费。
- **P2.5-f · 云端 API 扩展**（`services/cloudflare-service.ts`）：新增 `reportOutreachReply()` 与 `ReportOutreachReplyPayload/Response` 类型；`pollOutreachStatus` 已支持 `status` 过滤，poller 用它拉取 `sent` + `delivered` 两态建索引（含 `providerMessageId`）。
- **P2.5-g · IPC 通道**（`ipc/channels.ts`）：新增 `AUTOMATION.IMAP_POLL = 'automation:imap-poll'`（手动触发一次轮询）+ `AUTOMATION.IMAP_STATUS = 'automation:imap-status'`（读取配置 + 最近一次结果）。两者均通过 `registerImapReplyHandlers` 在 `main.ts` 注册。
- **凭证策略**（`readImapCredentials`）：`imapHost` 从 `user_config.accounts.email.imapHost` 显式读取（**不派生自 smtpHost**——IMAP 与 SMTP 主机不同，如 `smtp.gmail.com` vs `imap.gmail.com`）；`imapUser` 缺省回退 `smtpUser`；`imapPass` 缺省回退 `secret-manager` 的加密 `EMAIL_SMTP_PASS`，再回退明文遗留字段。任一必需字段缺失即返回 null，`pollReplies` 以 `skipped: 'imap_not_configured'` 静默降级。
- **Timer 挂载状态**（诚实化）：`startImapReplyPoll()` / `stopImapReplyPoll()` 已 export，但 `main.ts` 尚未调用——**与 `outreach-sync-service` 同状态**（同样 export 但未挂载）。当前版本通过 IPC 手动触发；自动轮询的挂载需要评估客户 IMAP 服务器并发上限后单独决策，不阻断 Phase 2.5 基础设施落地。

### 门禁与测试矩阵
- `npm run typecheck` ✅（本地 src + electron 两侧，修复 `SECRET_KEYS` 从 `secret-manager` 改为 `config-service` 的导入 + 移除 `ImapFlowOptions.messageTimeout` 非合法字段）
- `npm run test:unit` ✅ **315/315**（`ipc-startup-gate` 期望值由 52 → 54，对齐新增 `automation:imap-poll` + `automation:imap-status` 通道；console.log 同步更新）
- `kone-cloud/npm test` ✅ **35/35**（+6 条 IMAP 回复检测用例：`POST /outreach/reply` 存档 / 幂等短路 / 参数校验 / tenant 隔离 / `email.opened` 落 `email_opened_at` / `email.clicked` 落 `email_clicked_at`）
- `npm run verify:consistency` ✅（65 声明通道 / 54 已注册 / 11 推送 / 0 plain 直挂；文档交叉引用 137 处零漂移）
- `npm run lint` ✅ 0 error（imap-reply-service 3 处 `any` warning 均为 imapflow 动态 envelope/headers 结构，与既有 `email-agent.checkReply` 口径一致，不阻断）

### 规范回写
- **`CLOUD-COLLABORATION-DELIVERY.md §13.1.6`**：新增 IMAP 回复检测门禁（云端 /v1/outreach/reply + Webhook email.replied + 本地 IMAP poller + Fail-Closed + 幂等 + 状态机 + Timer 挂载状态）。
- **`kone-PRD.md §零.3` 宪法常量表**：本次未新增常量；`SCHEMA_VERSION = '1.0.0'` 保持不变。

### 未闭环项（不阻断发布）
- **定时轮询 timer 挂载**：`startImapReplyPoll()` 已 export，需在客户 IMAP 服务器并发上限确认后挂载到 `main.ts`。与 outreach-sync 同状态，一并决策。
- **IMAP 凭证 UI**：`user_config.accounts.email.imapHost` 字段在 `accounts-management.tsx` 尚未暴露——当前需要用户在 Settings 或用户配置中手工添加。UI 补齐留待 V1.4。
- **小流量实发验证**：Phase 2 + Phase 2.5 全部依赖真实 Resend + IMAP 环境，需在干净机器人工执行（详见 MEMORY.md 干净机器验收流程）。
- **打包冒烟（B2）**：受 `release/win-unpacked/resources/app.asar` 系统进程独占阻塞，需在锁释放环境执行 `npm run test:smoke`。

**受影响 SSOT**：`CLOUD-COLLABORATION-DELIVERY.md` §13.1.6、`kone-cloud/migrations/003_reply_detection.sql`、`electron/ipc/channels.ts`、`CHANGELOG.md`。

---

## [1.3.5] — 2026-09-28 · Phase 2 · Resend 投递闭环落地

**目标**：在 Phase 1 云地协同基础上打通"云端排队 → Cron 投递 → Resend 回调 → 状态回写本地 Agent"的完整链路，同时保持 `automation:queue-outreach` 走 Fail-Closed premium 门禁。

### 云端（`kone-cloud/`）
- **P2-1 · D1 迁移**（`migrations/002_outreach_webhook.sql`）：新增 `webhook_events` 表（`UNIQUE(provider, event_id)` 幂等键 + `workspace_id NULL` 支持全局回调）+ outreach 扩展列 `resend_id` / `send_attempts` / `next_retry_at` + 3 个新索引。
- **P2-2/3/4/5 · Worker 路由**（`src/worker.ts`）：新增 `/v1/outreach/queue`（幂等 + 状态守卫 `LEAD_NOT_APPROVED`）、`/v1/outreach/status`（分页 + 过滤）、`/v1/cron/send`（`X-Cron-Secret` 独立鉴权 + JOIN `leads/contacts` 解析收件人 + 指数退避 60/300/900/3600s）、`/v1/webhooks/resend`（**Svix HMAC-SHA256 签名验证 + ±300s 时间窗 + 常时比较 + `webhook_events.UNIQUE` 去重 + `email.delivered/bounced/complained` 三态落库**）。**Webhook 与 Cron 路由置于 Bearer 认证之前**，走自身鉴权通道。
- **P2-13 · Resend Webhook 真实签名验证**（`src/worker.ts`）：按 https://docs.svix.com/receiving/verifying-payloads/how-manual 实现——`signedContent = ${svix-id}.${svix-timestamp}.${rawBody}`，`key = base64Decode(secret 剥离 whsec_ 前缀)`，`signature = base64(HMAC-SHA256(key, signedContent))`。签名头支持多值空格分隔（Svix 可发 1–3 个）；缺失/伪造/过期签名均返回 `UNAUTHORIZED (401)`，无降级路径。原 `x-resend-signature` 存在性检查已移除，避免 Fail-Closed 旁路。
- **Resend 客户端**（`src/resend.ts`）：从 worker 主流程抽出为独立模块，附带 `setTestSendResult()` 测试钩子——Cloudflare Workers 跨请求上下文禁止复用 I/O 流，因此 E2E 用模块钩子而非 `stubGlobal(fetch)` 注入 mock。
- **P2-9 · Worker 测试**（`tests/worker.test.ts`）：**29 条全绿**（27 路由/授权/幂等/签名 + 2 E2E 旅程）。签名专项 4 用例：签名正确 / 无签名 / 篡改签名 / 过期时间戳（重放）。

### 本地（`electron/`）
- **P2-6 · 云端 API**（`services/cloudflare-service.ts`）：新增 `queueOutreach()` / `pollOutreachStatus()` + 对应 payload / response 类型。
- **P2-7 · IPC 通道**（`ipc/channels.ts`）：新增 `AUTOMATION.QUEUE_OUTREACH = 'automation:queue-outreach'`；`automation-service.ts` 集成 `ensureTrialAccess` + `licenseGuard` 双门禁。
- **P2-8 · 状态回写**（`services/outreach-sync-service.ts`）：60s 轮询云端 `pending/sent/delivered/bounced` 四态，映射为本地 `AgentStatus.whatsappStatus` + `emailSequenceStage`，经 `AGENT.LEAD_STATUS_UPDATED` 推送。`mapOutreachToAgentStatus()` 用 `as AgentStatus['emailSequenceStage']` 收窄数值到 `0|1|2|3` union 类型。

### 门禁与测试矩阵
- `npm run typecheck` ✅（本地 + 修复 `automation-service` 3 处 TS2554/TS18047/TS2339 与 `outreach-sync-service` 1 处 TS2322）
- `npm run test:unit` ✅ **315/315**（`ipc-startup-gate` 期望值由 51 → 52，对齐新增 `automation:queue-outreach` 通道）
- `kone-cloud/npm test` ✅ **29/29**（0 unhandled errors，含 4 条 webhook 签名专项用例：正常 / 缺失 / 篡改 / 重放）
- `npm run test:security-audit` ✅ **6/6**（`KoneAI.exe` 未打包是环境问题，6 条策略断言全过）
- `npm run verify:consistency` ✅ **零漂移**（P2-12 收官：`kone-PRD.md` / `PROVIDER-CAPABILITY.md` / `CHANGELOG.md` 内 4 处指向 `archive/` 归档文档的裸引用补齐前缀；`CLOUD-COLLABORATION-DELIVERY.md §13.1` 与 `CHANGELOG.md` 内模板占位符日期文件名已改写为不带 `.md` 扩展名的描述，避免 verify:docs 把它当成真实文件校验）

### 规范回写
- **`CLOUD-COLLABORATION-DELIVERY.md §13.1`**：新增 Phase 2 Resend 投递闭环门禁（D1 迁移 / Worker 路由 / 客户端本地层 / E2E 验证 / §13 通用门禁对应关系共 5 项）。
- **`kone-PRD.md §零.3` 宪法常量表**：本次未新增常量；`SCHEMA_VERSION = '1.0.0'` 保持不变。

### 未闭环项（不阻断发布）
- IMAP 回复检测（Phase 2.5 计划）：当前仅通过 `outreach.status='replied'` 占位，未接入 IMAP 拉取。
- 小流量实发（干净机器人工验证）：需在实际 Resend 域名 + 客户 API key 环境执行。
- 打包冒烟（B2）：受 `release/win-unpacked/resources/app.asar` 系统进程独占阻塞，需在锁释放环境执行 `npm run test:smoke`。

**受影响 SSOT**：`CLOUD-COLLABORATION-DELIVERY.md` §13.1、`kone-cloud/migrations/002_outreach_webhook.sql`、`electron/ipc/channels.ts`、`CHANGELOG.md`。

---

## [1.3.4] — 2026-09-28 · Phase 1 收官与 Phase 2 规划

### Phase 1 收官
- **Task #10 规范治理件收敛**：4 份审计报告归档至 `archive/`（商用上线就绪度、商用就绪度终审、对齐审计、规范文档梳理）；FIELD-DICTIONARY / STATE-MACHINES / GLOSSARY / CHANGELOG / METHODOLOGY-NORTHSTAR 均已就位。
- **Task #9 前端性能治理**：`leads-table.tsx` 添加 `LEADS_TABLE_DISPLAY_LIMIT = 50` 显示上限，避免大量保存线索时表格全量渲染卡顿；流式评分增量更新（P1-3）、search-result-card memo、Vite manualChunks 已在前序完成。
- **Task #12 构建链状态**：环境阻塞（app.asar 被系统进程独占），已记录状态，需在干净环境执行 `npm run test:smoke`。

### Phase 2 规划
- **KONE-V1.3-Phase2-Resend投递接入规划-2026-09-28.md**：完整投递闭环架构设计（Cron 定时投递、Webhook 状态回写、IMAP 回复检测、跨端同步）；11 个子任务分解，预估 12h。

**受影响 SSOT**：`CLOUD-COLLABORATION-DELIVERY.md`（§13 门禁待 Phase 2 完成后更新）、`CHANGELOG.md`。

---

## [1.3.3] — 2026-09-28 · Phase 1: Cloudflare 云地协同最小可用

**目标**：最小可用云——本地 KONE 推送线索到 Cloudflare D1，Pages 仪表盘可见；本地 SMTP 仍为主要发送通道。

### kone-cloud/ Monorepo
- **D1 Schema**（`migrations/001_init.sql`）：workspaces / companies / contacts / leads / outreach / events / suppressions / sync_tokens，8 表 + 索引。PRAGMA 已移除（D1 不支持）。
- **Worker 核心**（`src/worker.ts`）：5 个路由（POST/GET /leads, GET /events, POST /suppressions/unsubscribe, GET /dashboard/stats）。Bearer token auth + SHA-256 hash、Idempotency-Key 去重、Workspace 隔离、全局抑制（跨租户）、企业防撞单。
- **工具函数**（`src/utils.js` / `src/auth.js`）：hashToken / jsonResponse / errorResponse / generateId / nowUTC / normalizeEmail / normalizeDomain / parseJson / authenticate。
- **测试套件**（`tests/worker.test.ts`）：15 条测试（vitest-plugin + D1 migration setup），全部通过。
- **Pages 仪表盘**（`pages/`）：React 18 + Vite + Tailwind，Auth 面板 + Dashboard（StatsCards / LeadTable / EventStream），30s 自动刷新。构建体积 158KB（gzip 50KB）。

### 本地集成（electron/services/cloudflare-service.ts）
- **Fail-Closed 配置读取**：`cloud.provider` + `cloud.cloudflareUrl` + `cloud.cloudflareApiKey` + `cloud.cloudflareWorkspaceId`，缺失即跳过。
- **推送 API**：pushLead / pushLeadsBatch / getDashboardStats / testConnection，15s 超时，指数退避。
- **Payload 构建**：buildLeadPayload + deriveIdempotencyKey（sha256:localRefId:workspaceId）。
- **IPC 注册**：registerCloudflareHandlers → CLOUDFLARE_TEST_CONNECTION / CLOUDFLARE_CONFIGURED。

### Provider 路由（automation-service.ts）
- `cloud.provider` = 'supabase' | 'cloudflare'（默认 supabase 保持向后兼容）。
- Cloudflare 已配置 → 推送批次到 Workers；未配置 → 返回目标态降级提示。

### IPC 全链路
- **channels.ts**：+2 通道（CLOUDFLARE_TEST_CONNECTION / CLOUDFLARE_CONFIGURED），总计 62 声明 / 51 invoke / 11 push。
- **main.ts**：registerCloudflareHandlers 注册；dev shell mock 补齐。
- **preload + electron-api**：cloud.cloudflareConfigured / cloud.cloudflareTestConnection。
- **settings UI**：新增"云端引擎"Tab（Provider 选择 + URL/Key/WorkspaceId + 测试连接按钮）。

### 测试覆盖
- Worker 测试：15/15 通过。
- 本地 cloud handoff 测试：2/2 通过。
- 启动门禁：51 invoke 通道全部登记，lock 生效。
- **typecheck**：零错误。
- **test:unit**：316 条 / 313 通过（3 条预存失败，与 Phase 1 无关）。

### 受影响 SSOT
`ARCH-STANDARDS.md`、`CLOUD-COLLABORATION-DELIVERY.md`、`kone-PRD.md`、`AGENTS.md`、`README.md`。

---

## [1.3.2] — 2026-09-25 · Phase 0: N8N 移除与 Phase -1 对客口径对齐

### Phase -1：对客口径对齐（合规前置）
- **README.md**：版本对照表"云端邮箱清洗 / 云端自动化"加注"完整投递闭环为目标态"（原 N8N 自动化）；巡航说明更新为目标态表述。
- **upgrade-modal.tsx**：高级版文案从"云端自动化序列 + 多节点自动化发信引擎"改为"本地自动化序列 + 本地发信工作台（云端投递闭环为目标态）"。
- **dashboard-page.tsx**：自动化序列副标题从"云端发送的协同引擎"改为"本地发信工作台（云端投递闭环为目标态）"；升级提示文案更新。
- **automation-workflow.tsx**：新增 Premium 用户"云端投递闭环为目标态"信息徽标；Basic 锁定提示文案移除 N8N / Snov.io 提法。
- **help-dialog.tsx**：两处帮助文案移除 N8N 提法，更新为目标态表述。

### Phase 0：N8N 移除（铁律一落地）
- **删除** `src/components/settings/n8n-settings-tab.tsx`（145 行）。
- **system-settings.tsx**：移除 N8N Tab（TabsTrigger + TabsContent）、N8nSettings 类型、相关 state/ref/handler、useLicenseStore 依赖。
- **automation-service.ts**：删除 N8N Webhook 部分（`getN8nWebhookUrl`、`isPlaceholderWebhook`、`resolveAuthorizationLevel`、`triggerN8nWorkflow`、`N8N_GOLD_FILTER_MIN_SCORE`、`resolveLeadScore`、`safeFetch` 导入）；`start-campaign` IPC 保留授权门禁，返回目标态降级提示。
- **config-service.ts**：删除 `N8nConfigSnapshot` 类型、`getN8nConfig`、`shouldAllowN8nPush`。
- **proxy-service.ts**：删除 N8N webhook hostname 白名单逻辑（`getN8nConfig`/`shouldAllowN8nPush` 导入与路由决策块）。
- **cloud-sync-gate.ts**：注释中 N8N 提法更新为通用"云端邮件营销"。
- **supabase-service.ts**：`createCampaign` 注释从"由 n8n 后续消费"改为"由 Cloudflare Workers 后续消费（目标态）"。
- **user-config.ts / config-store.ts**：移除 `n8n` 字段类型定义；`getN8nSettings` 函数已删除。
- **main.tsx**：Dev shell `startCampaign` mock 从"n8n 未连接"改为目标态提示。
- **ARCH-STANDARDS.md §7.4**：`n8n cloud email automation` → `Cloudflare Workers cloud email automation (target state — Phase 1)`。
- **ARCH-STANDARDS.md §8**：`Premium n8n automation` → `Premium Cloudflare automation (target state)`。
- **kone-PRD.md**：N8N 提法更新为 Cloudflare Workers 目标态表述。
- **AGENTS.md**：邮件助理云端方案从 N8N 更新为 Cloudflare Workers。
- **tests/**：`ipc-contract-sweep.test.ts` 移除 N8N mock；`ipc-registry-plain-batch3-migration.test.ts` 注释更新。

**受影响 SSOT**：`ARCH-STANDARDS.md`、`kone-PRD.md`、`AGENTS.md`、`README.md`。

---

## [1.3.1] — 2026-09-22 · 规范治理与 P0 阻断项修复

**基线 commit**：`0925cde`
**发布判定**：仍为 `NO-GO`（依 `CLOUD-COLLABORATION-DELIVERY.md §0`；本次仅修复阻断项，云端协同目标态未落地）
**审计依据**：`archive/KONE-V1.3-规范文档与架构数据交互深度梳理报告.md`

### 修复 · 前端设计系统（P0-1）

| 项 | 变更 |
|---|---|
| 根因 | `src/index.css` 使用 Tailwind v4 CSS-first 模式，但缺少 `@theme` 块；`tailwind.config.cjs` 中的语义色映射在 v4 下**完全不加载**，且 `--secondary` / `--destructive` / `--accent` / `--popover` / `--success` / `--sidebar-*` 在 `:root` 中未定义 |
| 影响 | `bg-card`、`text-foreground`、`border-border`、`text-muted-foreground` 等 **278 处、30 个组件**的语义工具类在构建产物中生成 **0 条 CSS** |
| 修复 | 补齐 `:root` 缺失变量；新增 `@theme inline` 注册全部语义色与圆角刻度；删除死配置 `tailwind.config.cjs`；用 `@custom-variant dark` 固化浅色商业版（停用系统级深色变体） |
| 验证 | 构建产物中上述语义类全部生成；透明度变体（`bg-card/80`）恢复；CSS 体积 94.9KB → 112.4KB（新增即此前缺失的类） |
| 受影响 SSOT | `ARCH-STANDARDS.md`（架构红线不变）、无业务规则变更 |

### 修复 · 规范权威源止血（P0-2）

| 项 | 变更 |
|---|---|
| `kone-PRD.md` | 修正过时函数名 `computeLeadScore`/`enrichLeadWebsite` → `emitLeadScored`/`enrichLeadWithDeepProbe` 并加勘误；`yellow_pages` 从"可用 Provider"清单移除并标注已弃用；§0.3 常量表补入 `SEARCH_LLM_SCORE_LIMIT`(=50，裁定 20 为过时值)、`MAX_SEARCH_CANDIDATES`(200)、`SEARCH_CHANNEL_FETCH_LIMIT`(100)、并发常量名、`MAX_WEBSITE_TEXT_FOR_LLM`(3000)、超时(20s/15s)、熔断(3 次/60s)；补全时点快照清单；文档引用改用全路径 |
| `ARCH-STANDARDS.md` | 消除 IPC SSOT 双定义（§3 与 §16.1）：明确 `channels.ts` 为**命名与类型**事实源、`registry.ts` 为**运行时注册路由**收敛点；补入 2026-09-22 实测迁移数据（60 通道 / 49 注册 / 11 仅推送 / registry 迁移 0（基线；本批次续批后已升至 12，见 §IPC 注册中心迁移）） |
| `AGENTS.md` | 强制读链由 8 份扩为 **10 份**（补 `PROVIDER-CAPABILITY.md`、`CLOUD-COLLABORATION-DELIVERY.md`）；修正 LinkedIn 日频内部矛盾；修正 `dist-electron` 跟踪状态描述 |
| `PROVIDER-CAPABILITY.md` | 补真实校准日期与基线 commit；修正"无 Provider 专项单测"的过时表述（实存 `provider-isolation.business.test.js`，覆盖 2/8 Provider） |
| `.clinerules` | 由规范副本改为**流程 + 指针**文件（见下方"规范治理"） |

### 修复 · 架构与正确性（P0-3 / P0-4 / P0-7 / P0-8）

| 项 | 变更 | 受影响 SSOT |
|---|---|---|
| P0-3 | `isStaleTask` 增加"最近一次成功暂存的 runId"作为暂存窗口关闭后的比较基准；`startAgent` 现在接收真实 `pipelineRunId`。修复前用户在搜索完成后点击"开始触达"时 `currentPipelineRunId` 恒为 null，陈旧任务防重**从未生效** | `AGENTS.md`（Agent 双管道数据流宪法）、`kone-PRD.md §0.3` |
| P0-4 | 接线 `startFollowupScheduler`（此前导出但全仓 0 调用，导致 stage0 发出的跟进计划永不推进）；定时器 `unref()` 避免拖住事件循环；更新邮件 Agent 描述 | `ARCH-STANDARDS.md §9.6.8` |
| P0-7 | `session.defaultSession.webRequest.onBeforeSendHeaders` 由"每次建窗注册"改为模块级一次性安装，消除窗口重建时的监听器累积 | `ARCH-STANDARDS.md` |
| P0-8 | `search-service.ts` 慢源 `Promise.race` 的 120s 定时器补 `clearTimeout`；两处 `withPipelineIsolation` 补 `.catch`，避免 unhandledRejection | `ARCH-STANDARDS.md §9` |

### 修复 · 性能与可靠性（P0-5 / P0-6）

| 项 | 变更 | 验证 |
|---|---|---|
| P0-5 | `NativeStore` 落盘由"每次 `set()` 全量同步写 + fsync"改为**合并 + 250ms 防抖**；新增 `flushSync()` 逃生口并接入退出、备份前、用户可见的 `CONFIG.SET` | 实测 100 次 `set()` 由 100 次落盘降至 **1 次** |
| P0-5 加固 | 构造期确保父目录存在（原先目录缺失会静默降级为**永不落盘**）；`fsync` 失败不再判定整次写入失败（原先在不支持 fsync 的文件系统上会**永久阻断所有配置持久化**） | 新增单测覆盖 |
| P0-6 | `safeFetch` 内置默认 20s 超时；Supabase 通过注入 `global.fetch` 一次性覆盖全部 REST 调用（15s） | 断网场景不再永久 pending |

### 新增 · 治理件与门禁（P0-9 / P1-12）

| 文件 | 角色 |
|---|---|
| `GLOSSARY.md` | 术语唯一事实源（含"常见误用"清单） |
| `STATE-MACHINES.md` | 状态机映射唯一事实源（裁决 4 态 / 6 态 / 7 态混用） |
| `FIELD-DICTIONARY.md` | 字段索引（代码事实源仍为 `src/shared/ipc-contracts.ts`） |
| `CHANGELOG.md` | 本文件 |
| `scripts/verify-doc-consistency.cjs` | 规范一致性门禁：读链完整性、过时函数名、宪法常量↔代码常量、架构红线、归档桩、**66 处交叉引用断链** |
| `scripts/verify-ipc-consistency.cjs` | IPC 契约门禁：通道未定义 / 死通道 / 暴露无实现 / 字面量通道直写 |
| `.github/workflows/ci.yml` | **修复结构非法**（`gate.steps` 原为映射而非数组，GitHub 会判定整份 workflow 非法 → 所有门禁从未执行）；新增 `consistency` / `packaged` / `security` 作业；`gate` 按事件类型动态校验必过项 |

### 规范治理

| 项 | 变更 |
|---|---|
| 归档 | 物理删除两份墓碑桩：KONE-商用成熟度深度审计报告.md、V1.2-to-V1.3-alignment.md（自此不再作为可引用文档） |
| 命名 | kone-.md → `METHODOLOGY-NORTHSTAR.md`（同步更新 `kone-PRD.md` 7 处引用） |
| 去重 | `.clinerules` 由 132 行规范副本改为流程 + 指针文件，消除 24 处数值复述与过期的 8 份读链 |
| 治理件 | 新建 `GLOSSARY.md`（术语 SSOT）、`STATE-MACHINES.md`（三套状态机映射 SSOT）、`FIELD-DICTIONARY.md`（字段索引，代码事实源仍为 `src/shared/ipc-contracts.ts`）、`CHANGELOG.md`（变更时间线） |

### 前端工程化与性能（P1）

| 项 | 变更 | 验证 |
|---|---|---|
| Vite vendor 分包 | 补 `manualChunks` 拆分 `vendor-react` / `vendor-charts` (recharts) / `vendor-icons` (lucide) | chunk 数 51→33；主入口 347KB→324.75KB；`data-center` 414KB→25.71KB（recharts 独立缓存）；`vendor-icons` 31.48KB 消除数十个微型 chunk |
| 死代码与依赖清理 | 删除 0 引用的 `src/components/kone-logo.tsx` 与 2.5MB 的 `src/assets/kone-logo.png`；从 `package.json` 移除 12 个未使用的 `@radix-ui/*` 依赖 | devDeps 59→47 |
| 流式评分增量更新（P1-3） | `leads-store` 新增 `searchResultsByKey: Record<string, LeadSearchResult>` 索引与 `updateScoredLead(scored, {reposition, topCount})` action；`use-search-engine` 评分帧处理器改走单点更新（find by leadKey → merge → 可选 top-K 重排），不再 `map + setSearchResults` 全量重建 | 新增 4 个回归测试全部通过；后续可基于 `searchResultsByKey` 进一步实现按卡 selector 订阅 |
| **顺手修复 UX bug** | `use-search-engine` 中分页 `useEffect` 错误地把 `searchResults` 列为依赖——流式评分期间每帧都会触发重置，导致分页始终停在第 1 页 | 从依赖数组移除，仅过滤条件变化才重置分页 |
| 搜索扇出并发闸（P1-2） | `search-service.ts` 新增 `SEARCH_FANOUT_CONCURRENCY = 3` 与 `mapLimitedConcurrency` 助手；关键词变体层 `Promise.all(allSearchKeywords.map(...))` 改为 `mapLimitedConcurrency(allSearchKeywords, 3, ...)`。与评分/富化的并发 `2` 是**两个独立并发域**（扇出 = 同时打多少个上游搜索请求，受上游限流防护；`2` = LLM/官网富化算力红线），不得混读 | 同步 `kone-PRD.md §0.3` 常量表与 `verify-doc-consistency.cjs` 宪法常量比对（含 `SEARCH_FANOUT_CONCURRENCY`=3）；新增 `tests/business-logic/search-fanout-concurrency.business.test.js`（4 项全过） |
| 重复错误格式化去重（P1-8） | 新建 `src/lib/error-message.ts`（`formatErrorMessage` / `formatSearchErrorMessage` / `escapeCsvValue`），消除 `leads-management.tsx` / `data-center.tsx` / `leads-table.tsx` / `search-engine.tsx` / `use-search-engine.ts` 5 处重复实现；`analysis-drawer.tsx` 保留领域专用版（需解析 `ElectronApiError` 语义元数据） | `npx vite build` 通过 |
| 邮箱验证有界并发（P1-11） | `automation-service.ts` 新增 `EMAIL_VERIFY_CONCURRENCY = 4`（可经 `KONE_EMAIL_VERIFY_CONCURRENCY` 覆盖）与 `mapWithConcurrency`（按索引回填、顺序对齐）；`verifyEmailsBatch` 单次最多 50 个邮箱并走有界并发 | 新增 `tests/business-logic/email-verify-concurrency.business.test.js`（5 项全过） |

### 门禁修复 · lint / format 脚本与全量 prettier 归一（P0-9 续）

| 项 | 变更 | 验证 |
|---|---|---|
| lint 脚本引号 bug | `package.json` 的 `lint` / `lint:fix` glob 原用单引号，在 Windows 下被字面传递导致 `No files matching` —— **lint 门禁长期形同虚设**；改为双引号后真正生效，并清理 12 个真实 error（`URL`/`Response`/`DOM` 全局声明、`preserve-caught-error` 补 `cause`、`prefer-const`、空 catch 补注释、`no-control-regex` 加 eslint-disable、`no-useless-assignment` 改 `let page`） | `npm run lint` exit 0（0 error / 253 warning） |
| format 脚本引号 bug | `format` / `format:fix` 同样用单引号、在 Windows 下匹配 0 文件、长期"假绿"；改为双引号 | `npm run format` 现能真正校验 |
| 全量 prettier 归一 | 工作区 100% CRLF，`.prettierrc` 补 `endOfLine: "auto"` 后仍有 55 个文件存在真实格式漂移（非行尾）；`prettier --write` 一次性归一（含 23 个未改动过的 shadcn `src/components/ui/*` 模板组件，其原格式为默认 prettier 风格 `semi:true`/双引号，与仓库 `semi:false`/单引号配置冲突）。ESLint 仅在 `semi`/`quotes`/`comma-dangle` 三项上做格式化约束，且与 prettier 配置一致，归一未引入新 lint error | `npm run format` → "All matched files use Prettier code style!"；`npm run lint` 仍 0 error |

### IPC 注册中心迁移 · 首批批次（P0-4 续）

| 项 | 变更 | 验证 |
|---|---|---|
| 门禁可观测性修复 | `scripts/verify-ipc-consistency.cjs` 原 `registryMigrated` 计数**硬编码 `return false`**（始终报告 0），属"假可观测"指标，违反"无可观测证据不宣称成功"的宪法原则；改为真实扫描 `registerIpc(IPC_CHANNELS.X.Y, ...)` 调用，如实上报迁移通道数与清单 | 门禁现输出 `经 registry.registerIpc() 注册: 2（已迁移: PROVIDER.LIST, PROVIDER.STATUS）` |
| PROVIDER 服务首批迁移 | `electron/services/provider-service.ts` 的 `PROVIDER.LIST` / `PROVIDER.STATUS` 两个 handler 由直挂 `ipcMain.handle` 改为经 `registerIpc()` 收敛到注册中心（仍由 `main.ts` 的 `registry.attach(ipcMain)` 在 `registerIpcHandlers()` 末尾统一绑定）；新增 `electron/ipc/contracts/provider.contract.ts` 定义请求/响应契约（dev 模式做契约校验，production 跳过保性能）；通道命名仍引用 `IPC_CHANNELS.PROVIDER.*` 单一事实源 | `tsc` 编译通过；`node --test tests/ipc-registry-provider-migration.test.ts` 全过（注册 / 路由 / dev 模式契约校验 / `assertRegistered` 启动门禁断言） |
| 受影响 SSOT | `ARCH-STANDARDS.md §3` 迁移注记（迁移数 0→2）、`verify-ipc-consistency.cjs`（门禁口径） | — |

> **迁移策略**：按 `ARCH-STANDARDS.md §3` 注记"按服务逐批进行（每批附带契约定义 + 单测）"。PROVIDER 为最小自包含服务（2 通道、无外部副作用），作为首批验证迁移机制可行；其余 47 个通道（29 直挂 + 18 包装器 + 11 仅推送）待后续批次。迁移全部完成后 `assertAllRegistered()` 才作为启动门禁启用；当前仍为**目标态**。

### CI 内容一致性门禁（P0-9）

`scripts/verify-doc-consistency.cjs`（6 项校验）与 `scripts/verify-ipc-consistency.cjs`（4 项校验）已接入 npm 与 CI：
- 强制读链 10 份完整性
- 过时函数名白名单（仅勘误行豁免）
- 宪法常量 ↔ 代码常量自动比对
- 架构红线可查
- 归档墓碑桩不得复活
- **97 处文档交叉引用断链校验**（发现并修复 5 处）
- 工具入口文件不得复述数值

`.github/workflows/ci.yml` 已修复**结构非法 bug**（`gate.steps` 原为映射而非数组，整份 workflow 之前无法解析 → 所有门禁从未真正运行），新增 `consistency` / `packaged` / `security` 作业；`gate` 按事件类型动态校验必过项。

### IPC 注册中心迁移 · 第三批批次（P0-4 续）

| 项 | 变更 | 验证 |
|---|---|---|
| autopilot-state-service（3 通道） | `AUTOPILOT.GET_STATE` / `SET_STATE` / `CLEAR_LEGACY` 由直挂 `ipcMain.handle` 改为 `registerIpc()`；新增 `electron/ipc/contracts/autopilot.contract.ts` | 见下方「批量验证」 |
| auth-service（3 通道） | `AUTH.LOGIN` / `LOGOUT` / `GET_SESSION` 改为 `registerIpc()`；新增 `electron/ipc/contracts/auth.contract.ts`。`LOGIN` 需 `event.sender` 驱动授权窗口，handler 签名统一收 `unknown` 后显式收窄（兼容 `strictFunctionTypes`） | 同上 |
| sandbox-service（3 通道） | `ACCOUNT.CONNECT` / `DISCONNECT` / `GET_LIST` 改为 `registerIpc()`；新增 `electron/ipc/contracts/account.contract.ts`。三通道虽无外层包装，handler 内部 Fail-Closed 授权（`hasFeature` + `buildFeatureResult(...,403)`）原样保留，迁移只改注册方式 | 同上 |
| automation-service（1 通道） | `AUTOMATION.START_CAMPAIGN` 改为 `registerIpc()`；新增 `electron/ipc/contracts/automation.contract.ts`。`AUTOMATION.VERIFY_EMAILS` 仍由 `registerSecureFeatureIpc` 包装（不迁移，故不定义其契约，避免产生"定义了却无人消费"的死契约） | 同上 |
| 自绑定兼容层 | 每个迁移的 `register*Handlers` 末尾补 `registry.attach(ipcMain)`，使直接调用该函数而未显式 attach 的历史 e2e / 独立测试仍能经 `ipcMain.getHandler()` 触达迁移通道 | `tests/ipc-registry-plain-batch3-migration.test.ts` 断言四个服务各自的 ipcMain 均拿到绑定 |
| **`attach()` 改为按 ipcMain 实例幂等**（架构修正） | 原 `attach` 用**全局** channel 级 `_attached` Set 去重，导致迁移通道一旦绑到某个 ipcMain，其它 ipcMain 实例（e2e 各自 new 的 mock）再 attach 时会被整体跳过 → `agent-persistence` 模拟重启的第二次加载、`gate-e2e` 的多次注册都拿不到 handler。改为 `WeakMap<ipcMain, Set<channel>>` 按实例去重：同一实例不重复绑定（production 唯一 ipcMain 安全，不会触发 Electron "second handler" 报错），不同实例各自绑定，且后注册的通道会在下次 attach 时补齐 | `npm run test:unit` 由迁移后的 10 fail 收敛回 **1 fail**（仅既存 search 语义） |
| **`register()` 重复注册幂等** | 注册中心是全局单例，测试进程内 `register*Handlers` 被多文件复用（`agent-persistence` 双次加载、`gate-e2e` 4 次调用）会触发"重复注册"抛错并使整批用例崩溃；改为幂等覆盖 + dev 告警。真正的启动后护栏改为 `lock()`（锁定后禁止任何新增注册） | `tests/ipc-contracts-v2.test.ts` 用例改为覆盖"setup 期幂等 + `lock()` 后拒绝"，通过 |
| 死契约 SSOT 修正 | `electron/ipc/contracts/autopilot.contract.ts` 原把通道硬编码为 camelCase（`'autopilot:getState'` / `'autopilot:setState'` / `'autopilot:clearLegacy'` / `'autopilot:syncLifecycle'`），而 `channels.ts` SSOT 实为 kebab-case（`'autopilot:get-state'` / `'autopilot:set-state'` / `'autopilot:clear-legacy'` / `'sync-autopilot-state'`）——两者永不相等，合约事实上失效（审计报告记为"全仓 0 引用 / P2-2"）。改为引用 `IPC_CHANNELS`，并让响应规则匹配 handler 真实返回的 `{ success, data }` 信封 | `tests/ipc-contracts-v2.test.ts` 的 `autopilot contracts validate stateKind` 仍通过（该用例只校验请求侧生命周期枚举，不校验 channel 字符串） |
| 受影响 SSOT | `ARCH-STANDARDS.md §3` 迁移注记（12→22，并修正包装器计数 18→20、直挂 19→7）、`verify-ipc-consistency.cjs`（门禁如实上报 22） | `npm run verify:consistency` 双绿 |

> **批量验证**：`tsc` 编译通过；`node --test tests/ipc-registry-plain-batch3-migration.test.ts` 全过（10 通道注册 / 自绑定 / `dispatch` 路由往返 / dev 契约校验 / `ACCOUNT.DISCONNECT` 空 `accountId` 仍返 400 / `assertRegistered` 启动门禁）；`npm run test:unit` → **246 tests / 245 pass / 1 fail**（仅既存 `search stage payload exposes structured degraded semantic metadata`，非本批引入）；`npm run verify:consistency` → IPC 22 + 文档 101 处交叉引用双绿。
>
> 说明：`ACCOUNT.CONNECT` 与 `AUTOMATION.START_CAMPAIGN` 在测试中**只断言"已登记"而不实际 dispatch**——前者需要 `event.sender`（WebContents）驱动沙箱会话，后者放行后会真实调用 n8n / Supabase（外部副作用）。

### IPC 注册中心迁移 · 第四批批次（P0-4 收口）

| 项 | 变更 | 验证 |
|---|---|---|
| license-service（6 通道） | `SYSTEM.GET_DEVICE_STATUS` / `LICENSE.GET_INFO` / `LICENSE.REQUEST_TRIAL` / `LICENSE.SUBMIT` / `LICENSE.VERIFY` / `LICENSE.CHECK_STATUS` 由直挂 `ipcMain.handle` 改为 `registerIpc()`；新增 `electron/ipc/contracts/license.contract.ts`（6 个契约，信封响应 + `anyRequestRule`，与 agent/autopilot/auth/account/automation 等同构，保留 handler 自带的 400/403 `code` 语义）；`registerHandlers` 末尾补 `registry.attach(ipcMain)` 自绑定 | 见下方「批量验证」 |
| `LICENSE.SUBMIT` / `LICENSE.VERIFY` 签名收窄 | handler 改为 `async (_event: unknown, payload: unknown)`，`SUBMIT` 内部 `const p = (payload \|\| {}) as { licenseKey?: string }` 收窄后取 `p.licenseKey`；`VERIFY` 收 `key: unknown` 后 `String(key)`——兼容 `strictFunctionTypes` 且保持编译干净 | `npm run build:electron:dev` 0 error |
| `SYSTEM.GET_DEVICE_STATUS` 改 async | 该 handler 原为非 async 箭头函数、直接返回对象；`registerIpc` 的 handler 类型要求 `Promise<O>`，故改为 `async () =>`（无外部副作用，仅读 machineId） | `build:electron` 编译通过 |
| `main.ts` `AUTOPILOT.SYNC_STATE` 收口 | 最后一处 plain 直挂迁移到 `registerIpc()`（沿用 `autopilotSyncLifecycleContract`，请求为 `{ lifecycle }` 对象）。preload `syncLifecycle` 把公开 API 收到的 `lifecycle` 字符串包成 `{ lifecycle }` 对象以匹配契约，**渲染层公开 API 与 `electron-api.ts` 调用形态不变**；主进程解包。契约真值化，避免"契约写 `{lifecycle}` 而线协议传裸字符串"的漂移 | `verify-ipc-consistency.cjs` 清单含 `AUTOPILOT.SYNC_STATE`；`tests/ipc-contracts-v2.test.ts` 的 `autopilot contracts validate stateKind` 仍通过 |
| **全部 plain 直挂清零** | 本批迁移 `license-service` 6 通道 + `main.ts` 1 通道后，剩余仅 20 处 Fail-Closed 授权包装器登记点（独立子项目，须保留授权语义 + 负向授权测试）。`verify-ipc` 迁移数 **22 → 29** | `npm run verify:consistency` IPC 29 + 文档 101 双绿 |
| 受影响 SSOT | `ARCH-STANDARDS.md §3` 迁移注记（22→29，并修正直挂计数 7→0、包装器 20 不变） | 同上 |

> **批量验证**：`tsc` 编译通过；`node --test tests/ipc-registry-license-migration.test.ts` 全过（6 通道注册 / 自绑定 / `dispatch` 路由往返 `GET_DEVICE_STATUS` / dev 契约校验 / `SUBMIT` 与 `VERIFY` 空激活码仍返 400 / `assertRegistered` 启动门禁）；`npm run test:unit` → **247 tests / 246 pass / 1 fail**（仅既存 `search stage payload exposes structured degraded semantic metadata`，非本批引入，与第三批基线一致）；`npm run verify:consistency` → IPC 29 + 文档 101 处交叉引用双绿；`npx eslint electron/services/license-service.ts` → 0 error（4 处 `any` 告警均为迁移前既有，与本批无关）。
>
> 说明：本批 `LICENSE.GET_INFO` / `LICENSE.REQUEST_TRIAL` / `LICENSE.CHECK_STATUS` 在测试中**只断言"已登记 + 自绑定"而不实际 dispatch**——三者放行后会真实调用 `refreshTier`（网络）/ `syncTrialAnchor`（注册表 / 文件 IO），属外部副作用，与第三批对 `ACCOUNT.CONNECT` / `AUTOMATION.START_CAMPAIGN` 的保守策略一致。

### IPC 注册中心迁移 · 第五批（Fail-Closed 包装器治理登记，P0-4 收口）

| 项 | 变更 | 验证 |
|---|---|---|
| `registerSecureIpc` 治理登记 | 包装器在保留原有 `ipcMain.handle` 真实绑定的同时，额外调用 `registry.register(channel, { contract: secureAnyContract, handler, skipAttach: true, skipValidation: true })`——把 20 处 Fail-Closed 通道也登记进注册中心（供 `assertAllRegistered()` 门禁覆盖）。生产绑定路径零变化（Fail-Closed 授权语义不变） | 见下方「批量验证」 |
| `ContractEntry.skipAttach` + `attach` 跳过 | `electron/ipc/contracts/types.ts` 的 `ContractEntry` 新增 `skipAttach?: boolean`；`registry.attach()` 对标记 `skipAttach` 的通道**不再重复绑定**到 `ipcMain`，避免 production 主进程触发 Electron "second handler" 报错 | `tests/ipc-registry-secure-wrapper.test.ts` 断言条目 `skipAttach === true` |
| `registerIpc` 支持 `skipAttach` + `secureAnyContract` | 便捷函数新增 `skipAttach` 选项；`registry.ts` 导出 `secureAnyContract`（请求/响应均 `any`，因包装器自身已做 401/403 信封，无需 registry 再校验） | `build:electron:dev` 0 error |
| `dumpRegistry` 暴露 `skipAttach` | 调试快照新增 `skipAttach` 字段，便于治理审计 | 同上 |
| `verify-ipc-consistency.cjs` 口径修正 | 报告由"经 `registry.registerIpc()` 注册: 29"改为"经 registry 注册（含包装器治理登记 skipAttach）: 49（29 显式迁移 + 20 包装器治理登记；0 处 plain 直挂）"——如实反映全部 49 invoke 通道已 registry-known | `npm run verify:consistency` 双绿 |
| 受影响 SSOT | `ARCH-STANDARDS.md §3`：明确 49 个 invoke 通道已全部 registry-known（0 plain 直挂），"all IPC must go through registry" 已达成事实态；`assertAllRegistered()` 进入"下一步启用"阶段 | 同上 |

> **批量验证**：`tsc` 编译通过；`node --test tests/ipc-registry-secure-wrapper.test.ts` 全过（通道进 registry + `skipAttach` 标记 + `ipcMain.handle` 绑定保留 + **Fail-Closed 被拒返回 403** + 授权通过放行）；`npm run test:unit` → **248 tests / 247 pass / 1 fail**（唯一失败仍为既存 `search stage payload…` 语义，与本批无关；第五批引入的 `agent-service` 迁移测试断言已同步更新为"CONTROL 治理登记进 registry 且仍 ipcMain 绑定"）；`npm run test:e2e`（`gate-e2e` AGENT.CONTROL Fail-Closed 日限）→ 1/1 通过；`npm run test:security-audit` → 6/6 通过；`npm run verify:consistency` → IPC 49（0 直挂）+ 文档 101 双绿；`npx eslint` 改动文件 0 error。

### IPC 注册中心迁移 · 第六批（启动门禁启用，P0-4 收官）

| 项 | 变更 | 验证 |
|---|---|---|
| `PUSH_CHANNELS` + `collectInvokeChannels()` | `electron/ipc/channels.ts` 新增 SSOT：显式列出 11 个**仅推送**通道（经 `webContents.send` 广播、无 invoke handler），并提供 `collectInvokeChannels()`——递归收集 `IPC_CHANNELS` 全部通道后排除推送集，精确返回 **49 个 invoke 通道**（声明 60 − 推送 11） | `tests/ipc-startup-gate.test.ts` 断言 `collectInvokeChannels().length === 49` |
| `assertAllRegistered()` 启动门禁启用 | `main.ts` 在 `whenReady()` 末尾（`registerIpcHandlers()` + `AUTOPILOT.SYNC_STATE` 登记完成后）调用 `registry.assertAllRegistered(collectInvokeChannels())`，随后 `registry.lock()`——运行期禁止新增注册，漏注册将在启动期即失败而非静默降级 | 同上（门禁通过 + `lock()` 后新增注册被拒） |
| 门禁**非空守卫**测试 | 新增 `tests/ipc-startup-gate.test.ts`：忠实复刻 `main.ts` 注册序列，证明 ①完整序列下 49 通道门禁通过、`lock()` 生效且此后新增注册被拒；②故意跳过 `registerAuthHandlers` 时 `assertAllRegistered` **抛错并指明缺失通道**——证明门禁不是空断言 | 2/2 通过 |
| 既存红灯修复（search 语义契约） | `tests/search-semantic-contract.test.js` 的 `未启用 AI 评分` 断言**停留在已抽离走的旧文件** `search-engine.tsx` 上（文案随组件抽离迁移至 `src/components/search/search-result-card.tsx`），属陈旧断言而非产品回归。已改为断言当前 SSOT **并补充透传链路**：`search-result-card.tsx` 含该文案 + `getLeadSettlementMeta(lead, { isStreaming, aiScoringSkipped })` + `search-engine.tsx` 透传 `aiScoringSkipped={aiScoringSkipped}`（断言数由 1 条增至 3 条，未削弱） | `npm run test:unit` → **250 tests / 250 pass / 0 fail**（既存红灯清零） |
| `main.ts` 迁移状态注释校正 | `registerIpcHandlers()` 末尾注释原称"handler 仍直挂 ipcMain / 门禁待启用"，与收官后事实不符，已改为如实描述（全部 invoke 通道经 registry 登记、plain 直挂清零、门禁在 `whenReady()` 末尾触发） | `npm run format` 全绿 |
| 受影响 SSOT | `ARCH-STANDARDS.md §3`：由"下一步启用门禁"改为"**迁移已完成 + 启动门禁已启用**"，并补充 `PUSH_CHANNELS` 与 `PUSH_RE` 扫描器互为可观测校验的约定 | `npm run verify:consistency` 双绿 |

> **批量验证**：`tsc` 编译 0 error；`npm run test:unit` → **250 tests / 250 pass / 0 fail**（新增 startup-gate 2 条 + 既存 search 语义红灯已修复，全量转绿）；`npm run test:ipc`（契约 sweep）→ 1/1；`npm run test:e2e`（`gate-e2e` AGENT.CONTROL Fail-Closed 日限）→ 1/1；`npm run test:security-audit` → gateway 3/3 + env 3/3 + bypass 6/6 全过；`npm run verify:consistency` → IPC **49（0 直挂）** + 文档交叉引用 **101** 双绿；`npm run lint` → **0 error**（252 warning 为既存）；`npm run format` → 全量 prettier 通过。

### L0 发布阻断修复 · 合并键优先级（L0-4/F1）+ 渲染层漏导入 P0 + src 类型检查门禁

| 项 | 变更 | 验证 |
|---|---|---|
| **P0：`useLeadsStore` 漏导入 → 搜索结果渲染崩溃** | `src/components/search/search-result-card.tsx:113` 调用 `useLeadsStore(...)`，但该文件仅有 `import type { LeadSearchResult } from '@/store/leads-store'`（**类型导入，编译期被擦除**）——渲染该卡片即抛 `ReferenceError: useLeadsStore is not defined`，搜索结果列表整体崩溃（核心功能）。已改为值导入 `import { useLeadsStore, type LeadSearchResult }` 并加注释警示不可改回 `import type` | `npm run typecheck` 相关 2 error → 0 |
| **L0-4/F1：评分合并键改为「条件优先级」** | `findScoredLeadIndex`（`src/store/leads-store.ts`）原为**逐条位置优先**：对同一条 lead 依次试 leadKey → website → company 并立即 return，于是靠前条目的**弱匹配**（company/website）会**遮蔽**靠后条目的**强匹配**（leadKey）——评分被写到错误条目上，真正目标线索的分数始终为 undefined，即审计所述"评分更新静默丢弃路径"（同名公司 / 共用官网的采集场景极易触发）。改为每一级条件先全量扫描（leadKey → website → company），未命中才降级 | 新增 3 条用例，**先红后绿**（证明缺陷真实存在后再修） |
| 死代码清理 | 移除 `use-search-engine.ts` 中自 P1-3 起不再被调用的 `mergeTopRankedResults`（已被 `updateScoredLead` + `reinsertTopRanked` 取代，后者按 leadKey 定位） | eslint warning 252 → 251 |
| **L0-2/B2 补齐回归防护** | `browser-resolver.ts`（KONE_BROWSER_PATH → Chrome → Edge → puppeteer 默认）核心实现虽已落地，但**零单测覆盖**，packaged-smoke 亦缺"Agent 浏览器可启动"断言。新增 `tests/business-logic/agent-browser-resolver.business.test.js`（**9 条**，注入 fs / puppeteer 桩，无需真实浏览器）：env 优先 · 坏路径回退 · Chrome 优先于 Edge · Edge 兜底 · 无浏览器回退默认 · 目录不得当作可执行文件 · **无可用浏览器时抛中文可操作指引（严禁假成功）** · **已定位浏览器时如实抛原始错误（不伪造指引）** · label 可审计 + extraArgs 透传 | 9/9 通过，已并入 `test:unit` |
| **根因治理：新增 src 类型检查门禁** | 上述 P0 之所以逃过全部既有门禁，根因是：**vite build 用 esbuild 仅转译、不做类型检查，而 CI 只对 electron 做 tsc，从不检查 src**。新增 `npm run typecheck`（`tsc --noEmit -p tsconfig.json`）并接入 CI `quality` 关卡，使"漏导入 → 运行时 ReferenceError"这一类缺陷在 CI 即被拦截 | `npm run typecheck` → 0 error；CI `quality` job 已含该步骤 |

> **批量验证**：`npm run typecheck` → **0 error**（修复前 3 处：2 处漏导入 + 1 处死代码）；`npm run test:unit` → **253 tests / 253 pass / 0 fail**（新增 3 条合并键用例）；`npm run test:ipc` 1/1；`npm run test:e2e` 1/1；`npm run test:e2e-smoke`（permission-lock）7/7；`npm run test:security-audit` gateway 3/3 + env 3/3 + bypass 6/6；`npm run verify:consistency` 双绿；`npm run lint` **0 error**（251 warning 为既存）；`npm run format` 通过；`npx vite build` 成功。

### L2 诚实化修复 · automation 伪进度步进（`automation-workflow.tsx`）

| 项 | 变更 | 验证 |
|---|---|---|
| **移除虚构进度条** | `src/components/automation-workflow.tsx` 的 `handleVerifyEmails` 原用 `setInterval` + `Math.random() * 15` 模拟 0→90% 进度，而 `verifyEmails` 是**一次性批量 IPC**、主进程不推送任何逐条进度事件——该百分比向用户展示**虚构信息**，违反宪法"严禁假成功"。已移除定时器与 `Math.random()`，**不再维护虚构百分比** | `npm run typecheck` 0 error；`npm run test:unit` 262/262 |
| 状态语义诚实化 | 原 `verifyProgress`（百分比）状态改名并复位为 `verifyingCount`（真实待校验数量）：进入时 `setVerifyingCount(emails.length)`，`finally` 中 `setVerifyingCount(0)`；`handleVerifyEmails` 不再有任何进度伪造分支 | 同上 |
| 渲染块改为不确定态 | 进度条 UI 由"虚构百分比 + 进度条"改为**不确定态**：spinner + 文案 `正在校验 N 个邮箱…（批量请求，暂无可观测的逐条进度）`，明确告知用户当前无法展示真实逐条进度，而非用假数字填充 | `npx vite build` 成功；`npm run format` 全绿 |

> **批量验证**：`npm run typecheck` → 0 error；`npm run test:unit` → **262 tests / 262 pass / 0 fail**；`npm run lint` → 0 error（251 warning 为既存）；`npm run format` → 全量 prettier 通过；`npx vite build` 成功。

### L2 诚实化修复 · CSV 导出评分判空（P2-4）

| 项 | 变更 | 验证 |
|---|---|---|
| **CSV 导出 `undefined%` 虚构评分** | `src/components/leads-table.tsx` 的 CSV 导出行原直接用 `` `${lead.matchScore}%` ``，当 `matchScore` 为 `undefined`（待评估）时向用户导出 `undefined%` 的虚构/错误评分列——而线索表 UI 列已显示「待评估」，导出与界面口径不一致（违反诚实性原则）。已将导出口径抽为纯函数 `formatMatchScoreForExport`（`src/lib/lead-mappers.ts`，与 UI 同判空逻辑）：数值 → `N%`，非数值 → `待评估`，并在导出处调用 | `npm run typecheck` 0 error；`npm run test:unit` 265/265 |
| 可观测回归防护 | 新增 `tests/business-logic/lead-export-matchscore.business.test.js`（**3 条**：数值→`N%` / `undefined`→`待评估` / `null`→`待评估`），沿用 `ts.transpileModule` + `vm` 加载器，无需真实 Electron | 3/3 通过，已并入 `test:unit` |

> **批量验证**：`npm run typecheck` → 0 error；`npm run test:unit` → **265 tests / 265 pass / 0 fail**（新增 3 条）；`npm run lint` → 0 error（251 warning 为既存）；`npm run format` → 全量 prettier 通过；`npx vite build` 成功。

### L2 诚实化修复 · 导航徽标准入对齐真实授权（P2-5）

| 项 | 变更 | 验证 |
|---|---|---|
| **侧边栏过严 premium 门禁 → 对齐 dashboard 真实准入** | `app-sidebar.tsx` 的 `premiumNavItems` 原把 `accounts`/`agents`/`automation`/`team-dashboard` **统一**标 `premium:true`+「高级」徽标。但 `dashboard-page.tsx:192-196` 的真实门禁为：`accounts` 经 `canAccessAccountsWorkspace`（含 basic/trial）开放；`agents`（AI 销售团队）按 `README.md:61` 授权矩阵对 trial/basic/premium/enterprise 全开放（仅日限额不同，由 agents-panel 强制）；仅 `automation`/`team-dashboard` 为 premium-only。原侧边栏的 accounts/agents premium 门禁是相对真实门禁的**过严残留**，造成「徽标说高级、实际 basic 可进」的口径不一致（审计 U6）。已将 accounts/agents 的 `premium`/`badge` 移除，保留 automation/team-dashboard 的 premium 门禁 | `npm run typecheck` 0 error；`npm run test:unit` 266/266 |
| 守护真实 premium-only 两项 | automation / team-dashboard 的 premium 门禁与「高级」徽标保持不变，防止回归放宽授权 | 同上 |
| 可观测回归防护 | `tests/ui-ux-alignment-contract.test.js` 新增 P2-5 断言：accounts/agents 不再含 `premium:true` 与「高级」徽标；automation/team-dashboard 仍为 `premium:true`（防回归） | P2-5 子测试 1/1 |

> **说明（授权红线）**：本改动**不削弱任何授权**——真实执行门禁在 `dashboard-page.tsx`（`shouldBlockPremiumPage`/`shouldBlockAccountsPage`）与 `agents-panel` 日限额；侧边栏 premium 标志仅是导航控件开关。移除 accounts/agents 的过严标志后，其可访问性与 dashboard 已落地的真实准入一致，恰是消除「过严不一致」，而非放宽许可证。
>
> **批量验证**：`npm run typecheck` → 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**（新增 1 条 P2-5 断言）；`npm run lint` → 0 error（251 warning 为既存）；`npm run format` → 全量 prettier 通过；`npx vite build` 成功。

### 架构重构 · O1 拆分 `search-service.ts`（P1：纯文本/URL 工具外提）

| 项 | 变更 | 验证 |
|---|---|---|
| 蓝图 | 新增 `KONE-V1.3-search-service拆分蓝图-2026-09-24.md`（门面策略 + 7 阶段计划 + 源码断言/循环依赖约束清单） | 文档快照，豁免一致性校验 |
| **P1 纯工具外提** | 新建 `electron/services/search/text-utils.ts`，从 `search-service.ts` 抽出 **14 个无副作用纯函数**（`getHostFromUrl`/`normalizeLlmJsonText`/`extractJsonObjectFromText`/`sanitizePlainText`/`normalizeWebsiteUrl`/`normalizeGeoText`/`extractLocationTerms`/`extractDomainFromUrl`/`extractEmailsFromText`/`extractPhonesFromText`/`mergePromptParts`/`mergeUniqueValues`/`clampInt` + 内部 `LOCATION_TERM_ALIASES`）；`search-service.ts` 改为 import。**行为逐字不变**，`search-service.ts` 3873 → **3773 行** | `npm run typecheck` 0 error；`test:unit` 266/266 |
| 约束核对 | 迁移前核实 14 个符号**零外部引用**、**无源码文本断言**（4 个源码断言测试的对象均不在此集合） | 迁移前 grep 取证 |
| 后续阶段 | P2 常量/并发 → P3 Scout → P4 评分/意图 → P5 富化/分析 → P6 作业注册表（解循环依赖）→ P7 编排/门面收敛；详见蓝图 | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**（纯搬运，零回归）；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（251 warning 既存）。

### 架构重构 · O1 拆分 `search-service.ts`（P2：词表/模式 + 并发助手外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P2 词表/模式外提** | 新建 `electron/services/search/constants.ts`：`SCOUT_NEGATIVE_TERMS` / `SCOUT_B2B_TERMS` / `KEYWORD_STOP_TERMS` / `OMNI_CONTROL_TERMS` / `TRASH_LEAD_PATTERNS` | `npm run typecheck` 0 error |
| **P2 并发助手外提** | 新建 `electron/services/search/concurrency.ts`：`runLimitedConcurrency` / `mapLimitedConcurrency`（P1-2 结果版，按索引回填） | 同上 |
| **蓝图收敛性修订** | **8 个宪法常量刻意保留在 `search-service.ts`**——`verify-doc-consistency.cjs` 以该文件为代码侧读取源做宪法常量比对，保持单一代码事实源，避免为纯搬迁改动治理脚本。已写入 `constants.ts` 顶部注释 | `npm run verify:consistency` 双绿 |
| 测试同步（不削弱断言） | `search-fanout-concurrency.business.test.js` 新增 `concurrencySource`，`mapLimitedConcurrency` **定义**断言改读 `search/concurrency.ts`；**调用点**与 `SEARCH_FANOUT_CONCURRENCY` 定义断言仍读 `search-service.ts` | fanout 4/4 通过 |
| **新发现 O13（架构债）** | `runLimitedConcurrency` 在 `search-service.ts` / `agent-service.ts` / `sandbox-service.ts` **三处重复实现**（未共享）。后续应上提为 `electron/utils/concurrency.ts` 共享模块消除重复——已记入优化清单，本阶段先做 search 域收敛 | 迁移前 grep 取证 |
| 结果 | `search-service.ts` 3773 → **3676 行**（累计 P1+P2：3873 → 3676，−197 行） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**（纯搬运 + 测试读取目标同步，零回归）；`node --test tests/business-logic/search-fanout-concurrency.business.test.js` → 4/4；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（251 warning 既存）。

### 架构重构 · O1 拆分 `search-service.ts`（P3：Scout 预筛/准入外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P3 Scout 外提** | 新建 `electron/services/search/scout.ts`（198 行）：`ELIGIBILITY_HARD_VETO_RULES`（P0-2 Stage 0.5 一票否决规则表）+ `matchesProductTerm`（词边界产品词匹配）+ `computeEligibilityVeto` + `isTrashLead` + `extractKeywordAnchors` + `computeScoutRelevance` | `npm run typecheck` 0 error |
| 公开导出面保留 | `search-service.ts` 以 `export { computeEligibilityVeto, matchesProductTerm }` 保留原公开 API（`eligibility-gate` 测试经编译产物访问 `searchService.*` 不受影响） | eligibility-gate **8/8** 通过 |
| 常量导入收敛 | `KEYWORD_STOP_TERMS`/`SCOUT_B2B_TERMS`/`SCOUT_NEGATIVE_TERMS`/`TRASH_LEAD_PATTERNS` 已随 Scout 迁移，`search-service.ts` 仅保留仍在用的 `OMNI_CONTROL_TERMS` 导入 | `npm run lint` 0 error（无未使用导入） |
| **保留原位** | `COUNTRY_TLD_MAP` 被 `ui-ux-alignment-contract` 源码断言 → 刻意保留在 `search-service.ts` | `verify:consistency` 双绿 |
| 结果 | `search-service.ts` 3676 → **3493 行**（累计 P1+P2+P3：3873 → 3493，−380 行） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`node --test tests/business-logic/eligibility-gate.business.test.js` → 8/8；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（251 warning 既存）。

### 架构重构 · O1 拆分 `search-service.ts`（P4：意图/语言解析外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P4 意图/语言外提** | 新建 `electron/services/search/intent.ts`（206 行）：`SearchIntentMutation` 类型 + `LANGUAGE_LABELS` + `COUNTRY_LANGUAGE_MAP` + `resolveEmailLanguage` + `normalizeIntentCountry` + `stripOmniControlTerms` + `B2B_ROLE_TERMS` + `fallbackMutateB2BKeywords` + `crossProductB2BKeywords` + `buildIntentMutationPrompt` + `parseIntentMutation` | `npm run typecheck` 0 error |
| 保留原位 | `mutateSearchIntent`（异步 LLM 调用，属编排层）**刻意留待 P7** 编排阶段，本轮不动 | — |
| 公开导出面保留 | `search-service.ts` 以 `export { LANGUAGE_LABELS }` 保留原导出符号 | 编译通过 |
| 常量导入收敛 | `OMNI_CONTROL_TERMS` 唯一使用者 `stripOmniControlTerms` 已迁出 → 移除 search-service 中该导入（避免未使用导入告警） | `npm run lint` 0 error（251 warning，与基线持平） |
| 结果 | `search-service.ts` 3493 → **3311 行**（累计 P1–P4：3873 → 3311，**−562 行**） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（251 warning，与 P3 基线持平——迁移引入的 `OMNI_CONTROL_TERMS` 未使用告警已同步清除）。

### 架构重构 · O1 拆分 `search-service.ts`（P5：评分基元与提示词外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P5 评分外提** | 新建 `electron/services/search/scoring.ts`（185 行）：`computeIcpMatchScore`（Stage-1 40/30/20/10 预筛分）+ `normalizeOpportunityScore`（Stage-2 机会分）+ `applySchemaDefaults`（白名单序列化）+ `mapHttpError` + 评分提示词（`buildSearchScoringSystemPrompt`/`buildUniversalIcpPrompt`/`buildSearchScoringPrompt`） | `npm run typecheck` 0 error |
| **共享类型外提** | 新建 `electron/services/search/types.ts`（58 行）：本地 `SearchExecuteResult` + `OpportunityScore`。**根因**：`SearchExecuteResult` 是 search-service 的**本地镜像类型**（`id: string`、含 `reason?`），与 `src/shared/ipc-contracts.ts` 同名类型**不同**（后者 `id?: string`、无 `reason`）——子模块无法直接复用 ipc 版，故外提为 search 域共享类型 | 编译 0 error |
| 公开导出面保留 | `export { buildSearchScoringPrompt, computeIcpMatchScore, normalizeOpportunityScore, type OpportunityScore }`（原导出符号，测试经编译产物访问不受影响） | `test:unit` 266/266 |
| 死代码顺带清理 | `buildSearchScoringSystemPrompt` 原为 search-service 内**未被调用**的函数（lint 既存告警），外提至 scoring.ts 为导出后告警消除 | `npm run lint` 251 → **250**（−1） |
| 导入收敛 | 迁移后清理 search-service 中 3 处未使用导入（`clampInt` / `CustomsData` / `AgentStatus`） | 同上 |
| 结果 | `search-service.ts` 3311 → **3107 行**（累计 P1–P5：3873 → 3107，**−766 行**） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` **0 error（250 warning，较基线 −1）**。

> **新发现 O14（架构债）**：`SearchExecuteResult` 存在**两份定义**（`src/shared/ipc-contracts.ts` 与 search-service 本地镜像），字段不一致（`id` 可选性、`reason` 有无）。P1-3 注释要求二者对齐，但仍是两处维护——应统一为单一 SSOT（ipc-contracts），属后续独立重构项。本轮仅无损外提，未改变类型语义。

### 架构重构 · O1 拆分 `search-service.ts`（P6：日志探针 + LLM 结果抽取/合并外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P6 探针外提** | 新建 `electron/services/search/probe.ts`（35 行）：`isProductionRuntime` / `probeLog` / `probeError` / `probeLlmRequest` / `probeLlmCrash` / `verifyLlmProbeFailure`（生产静默，开发期结构化探针） | `npm run typecheck` 0 error |
| **P6 LLM 结果外提** | 新建 `electron/services/search/llm-results.ts`（114 行）：`extractLlmResults`（LLM 响应解析 + 白名单序列化 + 机会分归一）+ `mergeLlmResultsWithCandidates`（候选/评分按域名→公司名合并） | 同上 |
| 类型收敛 | `mergeLlmResultsWithCandidates` 原参类型 `ReturnType<typeof normalizeSearchCandidates>` 改为等价结构类型 `NormalizedCandidate`（`Partial<SearchExecuteResult> & { company; website }`）——避免子模块反向依赖 search-service（`normalizeSearchCandidates` 依赖宪法常量 `MAX_SEARCH_CANDIDATES`，仍留 search-service） | 编译 0 error |
| 公开导出面保留 | `export { verifyLlmProbeFailure } from './search/probe'` | `test:unit` 266/266 |
| 结果 | `search-service.ts` 3107 → **2980 行**（累计 P1–P6：3873 → 2980，**−893 行**；首次跌破 3000） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（250 warning，与 P5 持平）。

### 架构重构 · O1 拆分 `search-service.ts`（P7a：深度分析/回复教练/知识库外提）

| 项 | 变更 | 验证 |
|---|---|---|
| **P7a 分析域外提** | 新建 `electron/services/search/analysis.ts`（352 行）：`getAnalysisConfigError` / `buildAnalysisErrorResponse` / `shouldUseDevMockAnalysis` / `getAnalysisFailureSemantic` / `buildDevMockAnalysisData` / `buildAnalysisSystemPrompt` / `buildReplyCoachSystemPrompt` / `buildAnalysisPrompt` / `buildReplyCoachPrompt` / `parseStructuredAnalysisResponse` / `parseReplyCoachResponse` / `pickRelevantKnowledgeEntries` | `npm run typecheck` 0 error |
| 公开导出面保留 | `export { parseStructuredAnalysisResponse }` | — |
| 导入收敛 | 清理 4 处变为未使用的导入（`app` / `AnalysisSemanticMeta` / `AnalysisSemanticCode` / `normalizeLlmJsonText`） | `npm run lint` 0 error（250 warning 持平） |
| **源码断言测试同步** | `tests/search-semantic-contract.test.js` 的分析语义断言（`semantic: AnalysisSemanticMeta` / `code: 'missing_llm_key'` / `degraded: true` / `settingsActionable: true`）改读 `search/analysis.ts`——**断言强度不变**，仅迁移读取目标（与既有"随抽离迁移读取目标"惯例一致） | `test:unit` 266/266 |
| 结果 | `search-service.ts` 2980 → **2647 行**（累计 P1–P7a：3873 → 2647，**−1226 行**） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（250 warning 持平）。
>
> **过程记录**：P7a 首次提交前复跑全量门禁时**捕获 1 个测试失败**（`search-semantic-contract` 的源码断言因分析语义迁出 search-service 而失效）——已按蓝图约定同步测试读取目标后恢复 266/266。这印证了"每阶段复跑全量门禁 + 源码断言同步"的必要性。

### 架构重构 · O1 拆分 `search-service.ts`（P7b：宪法常量外提 + 门禁同步）

| 项 | 变更 | 验证 |
|---|---|---|
| **常量外提** | 8 个**宪法常量**（`MAX_SEARCH_CANDIDATES`/`SEARCH_CHANNEL_FETCH_LIMIT`/`SEARCH_TARGETED_LEAD_LIMIT`/`SEARCH_LLM_SCORE_LIMIT`/`SEARCH_LLM_CONCURRENCY`/`SEARCH_ENRICH_CONCURRENCY`/`SEARCH_FANOUT_CONCURRENCY`/`MAX_WEBSITE_TEXT_FOR_LLM`）+ 3 个时限常量（`SERPAPI_RETRYABLE_STATUS`/`SEARCH_LLM_TIMEOUT_MS`/`WEBSITE_PROBE_TIMEOUT_MS`）从 `search-service.ts` 迁至 `search/constants.ts` | `npm run typecheck` 0 error |
| **门禁脚本同步** | `scripts/verify-doc-consistency.cjs` 的宪法常量比对读取源从 `search-service.ts` 改为 `search/constants.ts`（含注释与失败信息文案） | `npm run verify:consistency` 双绿（宪法常量比对 8 项通过） |
| **源码断言测试同步** | `search-fanout-concurrency`（`SEARCH_FANOUT_CONCURRENCY` 定义）与 `search-resilience-contract`（`SERPAPI_RETRYABLE_STATUS`）改读 `search/constants.ts`——**断言强度不变**，仅迁移读取目标 | fanout 4/4、resilience 2/2 |
| 动因 | `trimWebsiteTextForLlm`（用 `MAX_WEBSITE_TEXT_FOR_LLM`）与 `WEBSITE_PROBE_TIMEOUT_MS` 被**富化模块（待迁）与 search-service 共同消费**，必须外提为共享常量（为 P7c 富化外提扫清障碍） | — |
| 结果 | `search-service.ts` 2647 → **2641 行**（常量净外提；累计 P1–P7b：3873 → 2641，**−1232 行**） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **266 tests / 266 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（250 warning 持平）。

### 商用阻断项 B-1/B-5 解除 · 绕锁打包 + 打包冒烟通过

| 项 | 变更 | 证据 |
|---|---|---|
| **B-1 安装包产物** | `release/win-unpacked/resources/app.asar` 被系统级文件锁占用（无进程持有、仅该文件不可动）导致 `npm run dist` 无法重建。**改用替代输出目录绕过锁**：`npx electron-builder --win nsis -c.directories.output=release-build` **成功产出** | `release-build/Kone-Intellect-Setup-1.3.0.exe`（**89.7 MB NSIS 安装包**）+ `release-build/win-unpacked/KoneAI.exe`（188.8 MB） |
| **B-5 打包冒烟** | `scripts/packaged-smoke.cjs` 增加 `KONE_PACKAGED_ROOT` 环境变量（默认 `release`，非削弱改动），使冒烟可指向替代输出目录 | `booted: true` / `activationScreenVisible: true` / `preloadBridgeVisible: true` → **通过判据满足**（`booted && bridge && (activation || dashboard)`），退出码 0 |
| 运行时证据 | 打包版真实启动：CrashReporter 初始化、AutoUpdater 按离线设计跳过、BackupService 自动备份完成；stderr 仅有无害项（`NODE_OPTIONS` 提示、旧备份校验和、`fsync EPERM` 降级、机器码读取被安全策略拒绝后的回退） | `tests/packaged-smoke-report.json` |
| 卫生 | `.gitignore` 新增 `release-build/` | — |

> **意义**：此前终审报告判定的 5 个商用阻断项中，**B-1（无安装包）与 B-5（打包冒烟未验证）两项解除**——证明"打包链路本身可用，此前仅被环境文件锁阻塞"。剩余阻断：B-2 代码签名（需证书）、B-3 云协同闭环（待立项）、B-4 持久化规模化（待立项）。

### 商用收尾 · 绕锁打包固化 + B-2/B-4 技术方案

| 项 | 变更 |
|---|---|
| 绕锁打包固化 | `scripts/packaged-smoke.cjs` 支持**位置参数**指定输出目录（`node scripts/packaged-smoke.cjs release-build`；优先级：参数 > `KONE_PACKAGED_ROOT` > `release`）；新增 npm 脚本 `dist:alt`（绕锁打包到 `release-build/`）与 `test:smoke:alt`（打包 + 冒烟一步到位）。实测 `node scripts/packaged-smoke.cjs release-build` → 退出码 0、判据满足 |
| B-2/B-4 方案 | 新增 `KONE-V1.3-B2签名与B4持久化技术方案-2026-09-25.md`：B-2 代码签名接入（证书选型 OV/EV + electron-builder 配置 + CI secret + `signtool verify` 验证，外部依赖仅证书）；B-4 持久化规模化（单 JSON → better-sqlite3 + 版本化迁移，M1 双写 → M2 读切换 → M3 首启迁移 → M4 收敛，约 10 人天） |

> **验证**：`node ./scripts/packaged-smoke.cjs release-build` → 退出码 0（`booted/activationScreenVisible/preloadBridgeVisible` 均 true）。

### 商用加固 · 覆盖率门禁（G2）+ 依赖安全扫描（G3）+ 签名预备（B-2）

| 项 | 变更 | 验证 |
|---|---|---|
| **G2 覆盖率门禁** | 新增 `npm run test:coverage`：用 **Node 22 内置** `--experimental-test-coverage`（**无需 c8**，规避镜像限制），排除 `tests/**`/`node_modules/**`，并设**阈值门禁** `--test-coverage-lines=65 / branches=60 / functions=64`。接入 CI 新 job `coverage` 并纳入汇总 Gate | 实测 **266/266**，源码覆盖率 **行 67.72% / 分支 62.40% / 函数 66.64%**，阈值通过 |
| **G3 依赖安全扫描** | 新增 `.github/dependabot.yml`（npm + github-actions，weekly，分组）。**动因**：本仓库 npm 镜像（registry.npmmirror.com）**不实现 `/-/npm/v1/security/*` 审计端点**，`npm audit` 无法运行 → 改由 GitHub 侧原生扫描 | YAML 校验通过 |
| **B-2 签名预备（非破坏式）** | 新增 `electron-builder.sign.cjs`（在基础配置上叠加 Authenticode 签名，**不破坏未签名构建**）+ `scripts/verify-signature.cjs`（工具不可用时优雅 WARN；`--strict` 供证书到位后 CI 硬门禁）+ npm 脚本 `dist:signed` / `verify:signature` | 实测：非 strict → WARN + exit 0；strict → exit 1 |

> **验证**：`npm run test:coverage` → 266/266、覆盖率达标；`node scripts/verify-signature.cjs release-build` → WARN+exit 0；`--strict` → exit 1；CI YAML 解析通过（jobs 含 `coverage`，gate.needs 已含）。
>
> **说明**：B-2 的 `dist:signed` 在**证书到位前无法本地验证**（无证书 electron-builder 会因找不到 `certificateFile` 报错），属"预备就绪、待证书"。

### 商用加固 · 渲染进程沙箱开启（审计 L1）

| 项 | 变更 | 验证 |
|---|---|---|
| **可行性评估** | `window-service.ts` 原 `sandbox: false`。评估结论：`sandbox: true` 要求 preload **不得 require 本地模块**；实测 preload **零 Node API 依赖**（仅 `contextBridge`/`ipcRenderer`），但编译产物 `require("../electron/ipc/channels")`（本地）→ 需先自足化 | 取证 |
| **preload 自足化** | 新增 `npm run bundle:preload`（esbuild 打包 preload 为单文件、`--external:electron`、内联 `IPC_CHANNELS`），并入 `build:electron:dev` / `build:electron` | 产物仅 `require("electron")`，无本地 require |
| **开启沙箱** | `webPreferences.sandbox: false → true`（`contextIsolation: true` / `nodeIntegration: false` 保持不变） | 见下 |
| **回归防护** | 新增 `tests/preload-sandbox-contract.test.js`（3 条）：① window-service 沙箱开启且隔离不退化；② preload 源码零 Node API；③ 编译产物无本地 require | 3/3 通过 |
| **真实运行时验证** | 全新打包（`release-verify`，00:38 新鲜构建）后跑**打包冒烟**：`booted / activationScreenVisible / preloadBridgeVisible` 均 **true** —— 证明**沙箱下 preload 桥接仍可用** | 冒烟通过（exit 0） |

> **验证**：`npm run test:unit` → **269 tests / 269 pass / 0 fail**（+3）；`verify:consistency` 双绿；`lint` 0 error（250 warning）；`format` 通过；打包冒烟 `preloadBridgeVisible: true`。
>
> **说明**：`release/`、`release-build/`、`release-verify/` 三个输出目录均被同一"app.asar 文件锁"现象影响（打包版启动后由 OS/安全软件持有），故每次验证使用**全新输出目录**绕过；`.gitignore` 已收录三者。

### 商用加固 · 结构化日志与滚动落盘（审计 G1「可观测性」）

| 项 | 变更 | 验证 |
|---|---|---|
| **结构化 logger** | 新增 `electron/utils/logger.ts`：`createLogger(module)`（级别 + 模块标签 + ISO 时间戳 + 元数据，级别阈值由 `KONE_LOG_LEVEL` 控制，生产默认 info / 开发 debug） | 单测 5/5 |
| **console 文件镜像（低侵入高覆盖）** | `initFileLogging(logDir)` 包装既有 `console.{log,info,warn,error}` → **散落在 12 个服务的 console 调用无需逐个改写**即自动落盘；滚动文件 `$userData/logs/kone-YYYYMMDD.log`，保留 7 天（超期自动清理） | 见下 |
| **接入启动流程** | `main.ts` 在 userData 覆盖之后调用 `initFileLogging(app.getPath('userData'))` | 编译通过 |
| **回归防护** | 新增 `tests/business-logic/logger.business.test.js`（5 条）：阈值解析 / 级别过滤 / 滚动命名 / 结构化行格式 / 循环引用元数据不抛错 | 5/5 通过 |

> **验证**：`npm run test:unit` → **274 tests / 274 pass / 0 fail**（+5）；`verify:consistency` 双绿；`lint` 0 error；`format` 通过；打包冒烟确认 `$userData/logs/kone-*.log` 实际落盘。

### 架构重构 · O1 拆分 `search-service.ts`（P8：作业注册表外提，**解循环依赖**）

| 项 | 变更 | 验证 |
|---|---|---|
| **P8 作业注册表外提** | 新建 `electron/services/search/job-registry.ts`：`currentActiveJobId` / `activeJobIds` 状态 + `getCurrentActiveJobId` / `isKnownActiveJobId` / `registerActiveJob` / `getActiveJobIdFor` | `npm run typecheck` 0 error |
| **解循环依赖（核心价值）** | 此前 7 个 Provider 用 `await import('../search-service')` **反向回引** search-service（因 search-service 依赖 provider-service，构成循环，靠动态 import 打破）。现 Provider 与 search-service 均**静态依赖中立模块 job-registry** → **Provider 对 search-service 的代码引用 7 → 0** | grep 复核：providers 目录仅剩 1 处**注释** |
| 调用点零改动 | search-service 保留本地闭包 `activeJobIdFor`（改为委托 `getActiveJobIdFor(ownerKey)`），**13 个调用点无需改动** | `test:unit` 274/274 |
| 公开导出面保留 | `export { getCurrentActiveJobId, isKnownActiveJobId } from './search/job-registry'` | — |
| 测试同步 | `provider-isolation` / `serpapi-cost-optimization` 的 `Module._load` mock 键 `'../search-service'` → `'../search/job-registry'`（断言强度不变） | 4/4、8/8 通过 |
| 结果 | `search-service.ts` 2641 → **2624 行**（累计 P1–P8：3873 → 2624，**−1249 行**） | — |

> **批量验证**：`npm run build:electron:dev` 0 error；`npm run typecheck` 0 error；`npm run test:unit` → **274 tests / 274 pass / 0 fail**；`npm run verify:consistency` 双绿；`npm run format` 通过；`npm run lint` 0 error（250 warning）。

### 交付就绪度定级校正 · 拒绝过度工程（用户价值导向）

> **用户明确指示**：不要过度工程化，用户要的是**使用体验、效率、精准获客的直接价值反馈、直观客户数据的真实价值**。

| 项 | 原定级 | **校正后** | 理由 |
|---|---|---|---|
| **B-2 代码签名** | ⛔ 商用阻断 | 🟡 **可选**（公开下载时再做） | 当前分发 = 顾问/微信渠道（打包日志实证 `offline (advisor/WeChat) channel`）；信任由顾问传递，SmartScreen 提示不致命 |
| **B-3 云协同** | ⛔ 阻断 | 🟡 高级版功能（代码已实现 ~2400 行，需客户配 Supabase） | 非交付阻断；基础版/试用版不依赖 |
| **B-4 持久化** | ⛔ 阻断 | 🟡 规模相关（单 JSON 在数千线索内可用） | 非交付阻断 |
| O1 P7c/P9 · O13 · O14 · 250 lint 警告 · 文档命名 | 待办/债务 | ⚪ **不做 / 不阻塞交付** | 纯内部工程卫生，**无用户价值** |

> **结论**：**交付给用户使用的阻断项已清零**。剩余项全部是"锦上添花"或"外部依赖"，**不应作为交付前置条件**。

### 交付前全面梳理（新增文档）

新增 `KONE-V1.3-交付前全面梳理-2026-09-25.md`：以用户价值为准绳的交付前完整梳理——产品价值主线（6 步用户旅程）、能力清单诚实分级、交付物清单、质量证据（274 单测 / 67.7% 覆盖率 / 冒烟通过 / 安全三件套）、**诚实披露 5 项限制**、**交付前检查清单**、**明确不做清单**、交付后按用户价值排序的改进项。

> **唯一必做项**：交付前在一台**干净机器**上人工跑一遍完整流程（安装 → 激活 → 搜索）。

### 精准获客修复 · 预筛漏斗缺失"初始排序"（宪法违规，P0）

| 项 | 内容 |
|---|---|
| **缺陷（有据）** | `kone-PRD` 明文要求：`computeIcpMatchScore`（40/30/20/10）"在无 LLM 场景下提供**初始排序**"（L176）、"在 LLM 评分执行前**必运行**，为**初始排序与预筛漏斗**服务"（L207）、多源字段"不得**绕过此确定性预评分直接进入高潜推荐**"（L211）。**但实现**：确定性分算出后**从未用于排序**，`slice(0, SEARCH_TARGETED_LEAD_LIMIT)` 直接按**数据源合并顺序**取前 50——而合并顺序为 `[...localCandidates, ...organicCandidates]`。 |
| **用户影响（精准获客）** | 送去 AI 评分与展示的 50 条**不是最相关的 50 条**：本地（Maps）结果挤掉有机（Organic）结果，**高相关线索可能根本不进入 AI 评分**。这是"精准获客"立身之本的直接损伤。 |
| **修复** | 新增纯函数 `rankByMatchScore`（`search/scoring.ts`，即 PRD 排序法典：`matchScore` 降序、未评分按 `-1` 兜底），在**高相关过滤与 top-50 切片之前**应用；`search-service.ts` 改用该函数（消除内联实现）。 |
| **回归防护** | 新增 `tests/business-logic/scoring-rank.business.test.js`（5 条）：降序 / 未评分兜底 -1 / 纯函数不改入参 / 同分稳定 / 空数组安全 | 
| **验证** | `test:unit` → **279 / 279**（+5）；`typecheck` 0 error；`verify:consistency` 双绿；`lint` 0 error；`format` 通过；修复已确认进入编译产物 |

> **说明**：本修复**不改变评分算法本身**（40/30/20/10 权重为宪法常量，未动），仅让确定性分**按 PRD 要求真正发挥"初始排序"作用**。

### 精准获客修复 · `matchScore` 三态法典被违反（L147 不变红线，P0）

| 项 | 内容 |
|---|---|
| **缺陷（有据）** | `kone-PRD` §L147「**`matchScore` 三态语义法典（V1.2 不变红线）**」：`undefined`=未评分 / 有效数字=已评分 / `null`=上游判定无效值；**"任何映射层不得将 `undefined`/`null` 静默转换为 `0`"**（0 分是"评估过且极差"，与"尚未评估"商业语义完全不同）。**但实现**：`applySchemaDefaults` 用 `Number.isFinite(Number(item.matchScore))` 判定——**实测 `null → 0`、`'' → 0`**。 |
| **审计范围** | 逐一核查**全部映射层**：`scoring.ts`(❌ null→0) ／ `llm-results.ts`(经前者) ／ `lead-mappers.ts`(✅ typeof 守卫) ／ `leads-store.ts`(✅) ／ `use-search-engine.ts`(✅)。**仅 `applySchemaDefaults` 违规**。 |
| **同时验证合规项** | §L111「Gold Filter」要求进入 Agent Pipeline 须 `matchScore >= 60` **且**有 `email`/`phone`/`linkedinUrl`——`agent-pipeline.ts:66-71` **实现正确**，无需改动。 |
| **修复** | 新增可测纯函数 `normalizeMatchScore`（`search/scoring.ts`）：`null` 保留 `null`；空串归一 `undefined`；**仍保留对数字字符串（LLM 偶发 `"85"`）的防御性转换**；超界钳制 0–100。`applySchemaDefaults` 改用它。 |
| **回归防护** | 新增 `tests/business-logic/match-score-canon.business.test.js`（8 条）：null 保留 / undefined 保留 / 空串不折算 0 / 0 与未评分区分 / 数字字符串转换 / 非数字归一 / 钳制 / 序列化层三态不被破坏 |
| **验证** | `test:unit` → **287 / 287**（+8）；`typecheck` 0 error；`verify:consistency` 双绿；`lint` 0 error；`format` 通过 |

> **说明**：契约 `matchScore?: number | null` 本就允许 `null`，且下游消费者（`leads-table` 排序、`rankByMatchScore`、`hasNumericMatchScore`）**全部用 `typeof === 'number'` 守卫**，故保留 `null` 类型安全、行为更正确（未评分项仍按 `-1` 兜底排序）。

### 精准获客修复 · §L142 决策人合并语义（错标 + 数据丢失，P0）

| 项 | 内容 |
|---|---|
| **缺陷（有据）** | `kone-PRD` §L142 要求：决策人碰撞（email 或 name+title）时"使用**高 `confidenceScore` 者**的属性覆盖旧属性"。**但实现**为"入参属性**恒覆盖** + 取最大置信度" → ① 低置信来源后到时报出"**低置信属性 + 高置信标签**"的**错标**；② 入参空字段（`''`）会**抹掉已有高价值资产**（如 email / phone）。 |
| **修复** | `mergeDecisionMakers` 改为**高置信者属性优先**（`incomingScore >= existingScore` 判定），**空值不覆盖**（保护已有资产），置信度仍取两者最大值。 |
| **回归防护** | `tests/business-logic/merge-leads.test.js` 新增分歧场景用例（existing 90 > incoming 60）：断言标题取自高置信来源、phone `+1-555` 未被空值抹掉、置信度为 90。 |
| **同时核查合规项** | §L143 展会脚印并集去重 ✅、§L144-145 排序法典（`addedDate` → `matchScore` 降序 `-1` 兜底）✅、归一法典（`normalizeLeadStatus`）✅、`sortByScoreThenOriginalOrder` 的 `\|\| 0` **无害**（已有 `typeof === 'number'` 守卫）。 |
| **验证** | `test:unit` → **288 / 288**（+1）；`typecheck` 0 error；`verify:consistency` 双绿；`lint` 0 error；`format` 通过 |

### 数据主权修复 · 上云 Gold Filter 漏校验 `email`（§L157 宪法红线，P0）

| 项 | 内容 |
|---|---|
| **缺陷（有据）** | `kone-PRD` §L157「上云 Payload 严苛裁剪 (Gold Filter)」明文：「**只有 `email` 非空的合格黄金线索才放行单向交接，绝不允许 bulk-sync 未经筛选的原始垃圾包上云**」。**但实现**：`syncLeadToCloud` 的门槛是 `score >= GOLD_FILTER_MIN_SCORE(80)` + `payload.domain` 存在，**完全未校验 `email`** → 无邮箱线索也会被同步上云。 |
| **用户/合规影响** | ① 云端用途是多轮 N8N **邮件营销**，无邮箱线索不构成可执行资产（白白占用云端配额）；② 违背 PRD 的"严苛裁剪 / 防 bulk-sync 垃圾包上云"的数据主权意图。 |
| **修复** | 抽出**零依赖纯函数** `evaluateCloudSyncGate`（`electron/utils/cloud-sync-gate.ts`）：合格 = 评分达阈值（或人工 `force` 覆盖）**且 `email` 非空**（`force` 亦不豁免——云端交接用途即邮件营销）。`syncLeadToCloud` 改用它做统一门槛。 |
| **回归防护** | 新增 `tests/business-logic/cloud-sync-gate.business.test.js`（6 条）：无邮箱拒 / 空白字符视为缺失 / 达标+有邮箱放行 / 低分拒 / `force` 覆盖评分但不豁免邮箱 / `score` 字段回退 |
| **验证** | `test:unit` → **294 / 294**（+6）；`typecheck` 0 error；`verify:consistency` 双绿；`lint` 0 error；`format` 通过 |

### 宪法条款核查（第三轮，§L104/§L109/§L110/§L143-145 全合规）

| 条款 | 结论 |
|---|---|
| §L104 前端刚性截断与分页 | ✅ `SEARCH_PAGE_SIZE = 30`；`use-search-engine.ts:570-572` 实现**首页↔末页双向环绕**（`<1 → totalPages`、`>totalPages → 1`） |
| §L109 Provider 失败降级 | ✅ `provider-registry.executeAll` 用 `Promise.allSettled` + 每 Provider `.catch()` → 失败降级为 `{ results: [], error }`，**不中断主搜索** |
| §L110 统一归一化 / 保留 `dataSourceType` | ✅ Provider 设 `source`，两条结果路径（`search-service.ts:1746` / `2334`）均映射 `dataSourceType: item.source` |
| §L143 展会脚印并集去重 | ✅ `Array.from(new Set([...existing, ...incoming]))` |
| §L144-145 排序法典 / 归一法典 | ✅ `addedDate` 降序 → `matchScore` 降序（未评分 `-1` 兜底）；`normalizeLeadStatus` 已用 |
| §L149 并发红线 = 2 | ✅ `SEARCH_LLM_CONCURRENCY = 2` / `SEARCH_ENRICH_CONCURRENCY = 2`（`SEARCH_FANOUT_CONCURRENCY = 3` 属**独立并发域**，P1-2 已文档化） |
| §L152 3000 字截断 | ✅ `MAX_WEBSITE_TEXT_FOR_LLM = 3000` 已在 `trimWebsiteTextForLlm` 强制 |
| §L153 PDF 本地生成 | ✅ `export-service.ts:309` 用 `webContents.printToPDF`（本地重计算，不上云） |

> **核查方法论**：本轮 3 次"疑似缺陷"中，**2 次经取证后确认为合规并收回**（§L110 字段名误读、`sortByScoreThenOriginalOrder` 的 `|| 0` 无害）——**结论必须逐条验证，不能凭 grep 片段下判断**。

### 精准获客修复 · §0.5 宪法算法「联系人资产」维度漏项（§L203，P0）

| 项 | 内容 |
|---|---|
| **缺陷（有据）** | `kone-PRD` §0.5 宪法算法表（L203）明定「联系人资产」10 分的判据为 `contact \|\| email \|\| phone \|\| **decisionMakers[].email \|\| decisionMakers[].phone \|\| decisionMakers[].linkedinUrl**` 任一非空。**但实现** `computeIcpMatchScore` 只检查前三项，**漏了 decisionMakers 三项**。 |
| **用户影响（精准获客）** | 仅有决策人邮箱/电话/领英的线索（典型来自 LinkedIn / AnySearch 等 Provider）在联系人维度得 **0 而非 10 分** → 总分低 10 → **可能被 `>= 60` 的 Gold Filter 挡在 Agent 管道之外，错失本可触达的线索**。 |
| **修复** | `computeIcpMatchScore` 补齐 `decisionMakers[].email / .phone / .linkedinUrl` 判定（**权重结构与其余三维不变**，未触碰宪法常量）。 |
| **回归防护** | 新增 `tests/business-logic/icp-match-score.business.test.js`（10 条）：四维满配 100 / 无官网降级 10 / B2B 三级阶梯 / 产品词未命中 / **决策人 email・phone・linkedinUrl 各自单独计 10 分** / 决策人字段全空不计 / 无联系人 0 分 / 上限钳制 |
| **验证** | `test:unit` → **304 / 304**（+10）；`typecheck` 0 error；`verify:consistency` 双绿；`lint` 0 error；`format` 通过 |

> **核查补充（第五轮全合规项）**：§L155 Autopilot 开机运行告知义务 ✅（`agents-panel.tsx:323` + `help-dialog.tsx:46` 明确告知"开机/联网/不休眠"，且未伪装"云端脱机机器人"）；§L109 宣传口径约束 ✅（`data-center.tsx:771` 明示"基于公开网页的近似检索，非官方直连"）。
>
> **方法论自纠**：本轮测试初版 4 条期望值写错（误以为 `'distributor'` 命中信号词 `'distribute'`——实为 `'distribut'+'o'` vs `'e'`，**不命中**）。**先调试实测、再校正测试**，未误改实现。

### 商业泄漏修复 · 试用版实际获得付费版完整能力（套餐边界失效，P0）

| 项 | 内容 |
|---|---|
| **缺陷（有据）** | ① `src/lib/feature-gate.ts` 的 `FEATURE_ALIASES.basic` 实为"**全部本地能力**"（含 `search_deep`/`analysis_basic`/`analysis_advanced`/`export_full`），而 `normalizeFeatureSet` 的 **trial 分支直接套用它**；② `electron/services/license-service.ts` 的 `TRIAL_FEATURES` 亦误含 `search_deep`/`analysis_*`/`export_full`。 |
| **用户/商业影响** | **试用用户实际获得与付费版等同的完整能力**：<br>• `getSearchLimit()` 的试用分支（`cooldownMs 15000 / maxResults 10`）**永不触发** → 试用可搜 **100 条、无冷却**<br>• `analysis-drawer.tsx:151`（AI 深度分析）与 `leads-management.tsx:545`（AI 撰写邮件）门禁**失效** → 试用可用<br>• `getExportLimit()` 的 `maxRows 100` 分支**永不触发** → 试用可**完整导出**<br>与 README「版本能力对照」试用列（10 条/次·15 秒、AI 分析不开放、导出限 100 行）**全面相悖** |
| **修复** | ① `feature-gate.ts` 新增 `FEATURE_ALIASES.trial`（仅 `search_basic`/`lead_export`/`local_autopilot`），trial 分支改用它；② `basic` 别名集移除 `export_full`（README：基础版"超 100 行需完整导出权限"）；③ `license-service.ts` 的 `TRIAL_FEATURES` 对齐为三项；④ 导出 `toFeatureGateState` 纯函数供行为级单测。 |
| **回归防护** | 新增 `tests/business-logic/feature-gate-tier.business.test.js`（7 条）：试用搜索限额 10/15000/不开深度分析、试用导出限 100 行、试用不得访问 `search_deep`/`analysis_*`/`export_full`、基础版解除限额但无完整导出、高级版完整导出、**两处源码守护**（`TRIAL_FEATURES` 与 trial 分支） |
| **验证** | `test:unit` → **311 / 311**（+7）；`typecheck` 0 error；`verify:consistency` 双绿；`lint` 0 error；`format` 通过 |

> **说明**：修复严格对齐 README「版本能力对照」试用列与 `kone-PRD §5.1.2` 套餐边界；**未改动付费版（basic/premium/enterprise）能力**，仅收回试用越权。

### 宪法常量修复 · HTTP 熔断阈值 off-by-one（§零.3）+ 门禁覆盖扩展

| 项 | 内容 |
|---|---|
| **缺陷（有据）** | `kone-PRD §0.3` 宪法常量表明定「**HTTP 熔断：连续 3 次失败 → 断开 60 秒**」。**但实现** `electron/utils/http-client.ts:73` 用 `consecutiveFailures **>** FAILURE_THRESHOLD`——第 3 次失败时 `3 > 3` 为假，**实际第 4 次才断开**，与权威值差 1 次。 |
| **连带问题** | 既有 `tests/circuit-breaker.test.js` **固化了错误行为**（发 4 次 429 后第 5 次才拒绝），使该偏差长期未被发现。 |
| **修复** | ① `http-client.ts` 改为 `>=`（连续 3 次即断开）；② 更新 `circuit-breaker.test.js` 断言为"前 3 次正常、第 4 次被熔断拒绝"；③ **新增边界用例**：连续 2 次失败不得断开、第 3 次才断开，且熔断后不再发起真实请求。 |
| **门禁覆盖扩展** | `scripts/verify-doc-consistency.cjs` 新增 `EXTRA_CONSTANT_PAIRS`（7 项，带**代码源文件 + 文档锚点 + 文档字面量**）：`TRIAL_DURATION_DAYS=7`、`SEARCH_PAGE_SIZE=30`、`SEARCH_LLM_TIMEOUT_MS=20000`、`WEBSITE_PROBE_TIMEOUT_MS=15000`、`TRIAL_PDF_EXPORT_LIMIT=3`、`FAILURE_THRESHOLD=3`、`CIRCUIT_OPEN_MS=60000`。门禁由"8 项"扩至 **"8 + 扩展 7 项 + 管道阈值"**。 |
| **门禁自证有效** | 扩展后**立即捕获**一处锚点错误（`TRIAL_PDF_EXPORT_LIMIT` 未在 PRD §0.3 中出现，该行仅写"Trial 高价值 PDF 白皮书导出上限"）→ 修正锚点后通过。**证明门禁确实在守护**。 |
| **验证** | `test:unit` → **312 / 312**；`typecheck` 0 error；`verify:consistency` 双绿（含扩展常量比对）；`lint` 0 error；`format` 通过 |

> **动因**：本次偏差是**人工审计**才发现的——说明 §0.3 中未纳入门禁的常量存在系统性漂移风险。扩展门禁后，此类偏差将**自动暴露**。

### 架构红线与安全密钥核验 + 门禁补代码符合性检查

| 项 | 内容 |
|---|---|
| **核验结论** | `ARCH-STANDARDS` §7（计费隔离）/ §9.5（Agent 真实执行边界）/ §9.6（精准度收口，抽验 10 条）/ §10（安全与密钥）**全部合规，本轮 0 功能缺陷** |
| **§7 计费隔离** | ✅ `PREMIUM_FEATURES = [...BASIC_FEATURES, 'cloud_send', 'team_collaboration']`；11 个 CLOUD 通道经 `registerSecureFeatureIpc(..., 'cloud_send')` 拦截 → **云端能力不泄漏到 Trial/Basic** |
| **§9.6 抽验** | ✅ 词边界产品词匹配（`scout.ts:92`）、五级邮箱验证（`email-verification.ts`）、邮件内容链 + `email_content_source`、跟进人工挂起（`followup-scheduler.ts:66` `isPlanDue` 排除 `pendingManual`）、发送窗口 09–18 + 未知时区放行、五级验证队列、多窗口隔离 |
| **§10 安全密钥** | ✅ **设计级保证**：SECRET 通道**仅 `SET`/`CHECK`、无 `GET`** → 渲染层**永远拿不到明文密钥**；仓库仅公钥 `kone-offline-public.pem`（全仓 grep `PRIVATE KEY` → 0）；时间回拨防护；日志脱敏 `redactUrl` |
| **门禁补齐（本轮唯一改动）** | `checkArchitectureRedlines()` 原**只校验文档是否声明红线、不校验代码是否遵守**（本会话已两次证明此类漂移真实：熔断 off-by-one、试用越权）。新增 **3 项代码符合性检查**：`provider-registry.ts` 含 `Promise.allSettled`、`SEARCH_LLM_CONCURRENCY = 2`、`MAX_WEBSITE_TEXT_FOR_LLM = 3000`。门禁输出 → **「3 项（文档）+ 3 项（代码符合性）」** |
| **验证** | `test:unit` **312/312**；`typecheck` 0 error；`verify:consistency` 双绿；`lint` 0 error；`format` 通过 |
| **新增报告** | `KONE-V1.3-架构红线与安全密钥核验-2026-09-25.md` |

> **待决项（未擅自改）**：`ARCH-STANDARDS §7.2` / `kone-PRD §5.1.2` 对 Trial 能力边界的措辞与 README 试用列存在歧义（README 明确"AI 分析不开放"，两份规范未明确排除）→ 建议治理层澄清。

### 治理 SSOT 核验 + `matchScore` 三态法典跨文档对齐

| 项 | 内容 |
|---|---|
| **核验范围** | `STATE-MACHINES.md`（§2 归一化映射 / §3 AgentStatus / §8 禁止写法 6 条）、`FIELD-DICTIONARY.md`（§9 日频默认值 / §10 stage 枚举）、`GLOSSARY.md` → **均与实现一致**（§2 归一化逐项吻合；§8 六条禁止写法无一违反；`SearchStagePayload.stage` 9 值逐一吻合） |
| **发现文档冲突（已对齐）** | `ARCH-STANDARDS.md §5 item 3` 把 `null` 并入 `undefined`（"not yet scored **or no valid score**"），与 `kone-PRD.md §2.4`（**全局唯一权威源**，明定 `null` = 上游判定无效值的**独立第三态**）**冲突**。GLOSSARY §38 沿用了前者。 |
| **根因关联** | 这正是本会话缺陷 #2（`applySchemaDefaults` 把 `null`/`''` 静默转 `0`）的**文档侧根源**——规范自身对 `null` 的表述不清晰，导致实现层合并。 |
| **处置** | 按 AGENTS.md「kone-PRD 为全局唯一权威需求主源头」**规范回写**：① `ARCH-STANDARDS §5.3` 改为**指针引用 PRD §2.4 且不再自行定义**，并补记历史漂移；② `GLOSSARY §38` 订正为三态（含 `null` 独立态），并标注原误引 `ARCH-STANDARDS.md §5.3`（该章节为条目引用、当时表述与法典冲突）。 |
| **验证** | `verify:consistency` 双绿（**文档交叉引用 106 处**，较此前 101 处增加）；`typecheck` 0 error；`format` 通过；`test:unit` 312/312 |

> **意义**：缺陷 #2 的修复此前只改了**代码**；本轮补齐**规范侧**，使三态法典在 PRD / ARCH-STANDARDS / GLOSSARY **三处口径一致**，防止后续再次被合并。

### 文档链核验 · 修正 `system-blueprint` 的 Provider 路由表述（与 Provider SSOT 冲突）

| 项 | 内容 |
|---|---|
| **核验范围** | 文档链剩余部分：`PROJECT-PRD.md`、`.opencode/agents/{ui,ipc,system-blueprint,build}-agent.md`、`V1.2-商业版交付与运维手册.md` |
| **发现冲突（已修正）** | `.opencode/agents/system-blueprint.md:237` 称 `customs_shipment` / `trade_show` / `linkedin_search` / `facebook_search` "**are routed through AnySearch when implemented**"。**与 `PROVIDER-CAPABILITY.md`（Provider 唯一事实源）及代码注册表相悖**：这四者是**独立 SerpApi Provider 且均已实现**；**仅 `yellow_pages` 已弃用并由 AnySearch 路由**。 |
| **修正** | 改为准确表述（四个独立 SerpApi Provider + 仅 `yellow_pages` 弃用），并**显式指向 `PROVIDER-CAPABILITY.md` 为唯一事实源、要求不在本蓝图复述路由**。 |
| **反证（同文件）** | 同文件 `:229` 关于熔断的表述"After **3** consecutive failures … opens for 60 seconds"**与宪法一致**——**反证本轮熔断 off-by-one 修复方向正确**（蓝图与 PRD 皆要求 3，代码原为 4）。 |
| **交叉印证（重要）** | `.opencode/agents/ipc-agent.md:20` 明确 "`agents:list` gating: **Trial → upgrade surface only**"——**PRD §6.0 / AGENTS.md / ipc-agent 蓝图 / 代码实现 四方一致**，进一步印证 `README` 的"试用限额（每日 3 条）"是**唯一口径偏差**（待决项） |
| **验证** | `verify:consistency` 双绿（**文档交叉引用 106 → 110 处**）；`typecheck` 0 error；`format` 通过 |

### 授权绕过修复 · 试用版可绕过渲染层熔断直连 IPC 启动智能体（P0 安全）

| 项 | 内容 |
|---|---|
| **缺陷（有据）** | `AGENT.CONTROL` 在主进程经 `registerSecureFeatureIpc(..., **'local_autopilot'**, ...)` 门禁（`agent-service.ts:1261-1266`），而 **`TRIAL_FEATURES` 竟包含 `local_autopilot`** → **Trial 授权可通过主进程门禁**，调用 IPC 直接启动智能体，**绕过渲染层 `agents-panel` 的升级墙**。 |
| **违反条款** | `.opencode/agents/ipc-agent.md:13`「Trial/Basic/Premium separation **必须在主进程强制，绝不信任渲染层门禁**」；`AGENTS.md`「必须强制实施 License 级别前置拦截」；`kone-PRD §6.0`「Trial 仅展示升级引导」。 |
| **性质** | **渲染层门禁 ≠ 授权**——主进程未拦截即为**授权绕过**（安全/商业双重风险）。 |
| **修复** | ① `license-service.ts` 的 `TRIAL_FEATURES` 移除 `local_autopilot`（→ `['search_basic', 'lead_export']`）；② `feature-gate.ts` 的 `FEATURE_ALIASES.trial` 同步移除。 |
| **回归防护** | `tests/business-logic/feature-gate-tier.business.test.js`：新增断言「试用不得访问 `local_autopilot`」+ 源码守护清单加入 `local_autopilot` |
| **连带修正（对客口径）** | `README.md` 版本对照表原写「AI 销售团队智能体｜**试用限额（每日 3 条）**」——与 **PRD §6.0 / AGENTS.md / ipc-agent 蓝图 / 代码实现 四方一致结论**（Trial 熔断）不符，**属对客不实描述**。已订正为「**不开放（升级解锁）**」，并补「试用版边界」说明段。 |
| **规范澄清** | `ARCH-STANDARDS §7.2` 原句 "Trial is temporary access to Basic-local capabilities only" 易被读作"完整 Basic 能力"，已澄清为**限时限量体验**（搜索/导出受限、AI 分析锁定、智能体面板仅升级引导），并注明依据 `kone-PRD §6.0`。 |
| **验证** | `test:unit` **312/312**；`typecheck` 0 error；`verify:consistency` 双绿（文档交叉引用 **116 处**）；`lint` 0 error；`format` 通过 |

### 授权视角系统排查 · 修复 2 处门禁与意图自相矛盾（含上轮修复引入的回归）

> **审计视角**：系统排查**全部 20 个 `registerSecureFeatureIpc` 通道**的特性键与设计意图是否一致。

| # | 缺陷 | 性质 | 修复 |
|---|---|---|---|
| **1** | **`EXPORT_PDF` 门禁自相矛盾**：门禁为 `analysis_advanced`（付费专属），而**处理器内部（`export-service.ts:238-250`）专门实现了 `isTrial` 的 3 次配额**——即 `kone-PRD §零.3`「Trial 高价值 PDF 白皮书导出上限 **3 次**（PLG 逼单卡点）」。**门禁把试用挡在门外，使该配额成为死代码**。 | 宪法条款不可达（**含上轮修复引入的回归**：上轮移除 trial 的 `analysis_advanced` 后彻底不可达） | 门禁改为 `'lead_export'`（任何已授权层级可导出），**试用由内部 3 次配额差异化**——恢复 §零.3 的 PLG 钩子 |
| **2** | **`API_TEST_CONNECTION` 对 LLM 要求 `analysis_basic`**：而试用版不含分析特性 → **试用用户按 README 第 1 步配置 LLM 密钥时「测试连接」必然失败**（且设置页加载时会自动测试，体验更差）。连接测试属**配置能力**，非分析能力。 | 试用主流程受阻（**上轮修复引入的回归**） | 统一收敛为 `'search_basic'`（任何已授权层级均可验证密钥） |
| — | 其余 18 个通道特性键核查 | ✅ 合规 | `AGENT.CONTROL→local_autopilot`（上轮已修）、`AUTOMATION.VERIFY_EMAILS`/`DNS.HEALTH_CHECK`/`SEARCH.API_PROXY`/全部 `CLOUD.*`→`cloud_send`、`FILES.EXPORT_SAVE→['lead_export','export_full']`、`SEARCH.EXECUTE→search_basic`、`SEARCH.ANALYSIS_GENERATE→analysis_advanced` |

**回归守护**（新增 2 条源码守护）：`EXPORT_PDF` 门禁不得为付费专属（其处理器含 `isTrial` 配额）；`API_TEST_CONNECTION` 不得要求 `analysis_*`。

**验证**：`test:unit` **314/314**（+2）；`typecheck` 0 error；`verify:consistency` 双绿；`lint` 0 error；`format` 通过

> **诚实说明**：本轮 2 处缺陷**均由上一轮"试用能力集收窄"修复所引入**——收窄试用权限时，**未同步检查"哪些通道依赖试用可达"**，导致试用主流程（PDF 导出 PLG 钩子、LLM 密钥测试）被误伤。**教训：收窄权限必须做"可达性回归"——凡处理器内含 `isTrial` 分支或属配置/设置类能力的通道，都必须确认试用仍可达。**

### 必要优化 N1 · 评分精度验证视图（分数段 × 回复率）

| 项 | 内容 |
|---|---|
| **为什么必要** | 用户要的是"**精准获客的直接价值反馈**"。此前 `data-center` 只有**总回复率**，**无法回答"评分是否真准"**——用户无法验证高分线索是否真的更优。 |
| **实现** | `data-center.tsx` 在「数据罗盘转化诊断」区新增**评分精度验证**块：按 **90-100 / 80-89 / 70-79 / 60-69 / 低于 60** 五档，展示每档的**回复率**（口径与总回复率严格一致：已回复 / (联系中 + 已回复)，仅统计**已触达**线索）与"已触达 N/总数"。 |
| **自动结论** | 附一行自动判定：高分档（≥70）回复率高于低分档 → "**评分具备预测力**"；否则提示"**建议校准 ICP 画像或收紧评分口径**"。**样本充分性门槛**：单档已触达 ≥3 条才参与结论，避免小样本误导。 |
| **工程边界（拒绝过度工程）** | **纯只读聚合**：不新增 IPC、不改评分算法、不引入依赖、不动数据管道。数据源为既有的 `matchScore` + `lead.status`。 |
| **验证** | `typecheck` 0 error；`lint` 0 error；`format` 通过；**`vite build` 成功（exit 0）**；`test:unit` **314/314**；`verify:consistency` 双绿 |

### 必要优化 N2 · 「需要你处理」行动入口（高效跟进）

| 项 | 内容 |
|---|---|
| **为什么必要** | 跟进**引擎**完整（4 轮序列 + IMAP 检测 + 人工挂起 + 发送窗口 + 抑制），但**缺"下一步该做谁"的行动入口**——阻塞态只在线索表逐行呈现，用户需自行翻找。**高效跟进断在"行动"这一环**。 |
| **实现** | `data-center.tsx` 在转化诊断**之前**新增**需要你处理**卡（3 格，阻塞态高亮）：<br>① **待人工确认**（`agentStatus.emailPendingManual`，序列已暂停）<br>② **待接管回复**（`status==='replied'`，可进「回复教练」）<br>③ **高潜未触达**（`status==='new'` 且 `matchScore ≥ 60`，优先跟进产出最高）<br>附「前往线索池」入口。 |
| **工程边界（拒绝过度工程）** | **零新增 IPC、零管道改动**：数据源全部取自 store 既有字段（`status` / `agentStatus`）。**未新建视图**——复用既有 `data-center` 与 `onLeadsNavigate`。 |
| **评估修正（诚实记录）** | 原估 N2 需"新建工作台"。**实测发现** `LeadsManagement` **已有**状态筛选器、回复教练 `nextAction` 聚合 chips、以及 `emailPendingManual` 逐行徽标 → **N2 的真实缺口仅为"汇总入口"**，故**收敛为一张汇总卡**而非新视图（避免过度工程）。 |
| **同时复核** | 实时通道 `agent:lead-status-updated` **端到端完整**（emit → preload → `electron-api` → `leads-table:197` 订阅）✅——此前一度误判为"断头"，经精确取证后**收回**。 |
| **验证** | `typecheck` 0 error；`lint` 0 error；`format` 通过；**`vite build` exit 0**；`test:unit` **314/314**；`verify:consistency` 双绿 |

> **至此，上线前必要优化 P0（N1 + N2）全部完成。**

### 已知未完成（不对外宣称）

- IPC 注册中心迁移：**已收官**。49/49 invoke 通道全部 registry-known（29 经 `registerIpc()` 显式迁移 + 20 处 Fail-Closed 包装器治理登记 `skipAttach`，**0 处 plain 直挂**），且 `assertAllRegistered()` 启动门禁已在 `main.ts` 启用并配套非空守卫测试（`tests/ipc-startup-gate.test.ts`）；"all IPC channel registration must go through registry" 已由**事实态**升级为**门禁强制态**（漏注册将在启动期抛错）。剩余为可选增强：`secureAnyContract` 占位合约未来可逐步替换为真实契约以启用响应校验。
- 云端协同（审批 / 二次门禁 / 投递 / 抑制 / Webhook / 回写）仍为**目标态**
- 持久化仍为单 JSON 文件，无线索池规模化方案（SQLite 替代方案待立项）
- 流式评分增量更新已落地**数据层 + 组件层**：`updateScoredLead` 单点更新 + `searchResultsByKey` 索引，且 `SearchResultCard` 现已按 `leadKey` 订阅自身切片（`React.memo` + 父级 `useCallback` 稳定化），流式评分增量更新时仅被更新的卡片重渲染
- **L0 发布阻断项进度**：L0-4（F1 合并键）**已闭环**；L0-3（smtpPass 加密）经核实前期已完成（`SECRET_KEYS.EMAIL_SMTP_PASS` + secret-manager，user_config 仅作旧安装明文回退）；L0-2（Agent 浏览器打包 B2）核心实现已存在，**本轮补齐 9 条回归防护**（未做的剩余项：packaged-smoke 的"Agent 浏览器可启动"断言需打包环境，见下条）；L0-1（全量验证门禁）**仅剩打包冒烟一项未跑通**（见下条）。
- **打包冒烟（`npm run test:smoke`）仍被环境阻塞，非代码问题**：`release/win-unpacked/resources/app.asar` 被系统级进程独占。经核实：① 无任何 Electron/Kone 进程运行（tasklist 仅环境 node）；② 同目录可自由新建/删除其他文件，仅该文件不可改名或删除；③ `npm run build:electron`（tsc + 混淆 60 文件）**成功**。electron-builder 报错 `remove ... app.asar: The process cannot access the file because it is being used by another process`（`EnsureEmptyDir` 阶段）。需在该文件锁释放后的环境执行。
- **本轮已闭环（自"未完成"移除）**：① 搜索扇出并发已在 P1-2 以 `SEARCH_FANOUT_CONCURRENCY = 3` 作为独立并发域收敛，不再"无上限"；② lint / format 脚本引号 bug 已修复，全量 prettier 已归一，`format` 门禁由"假绿"转为真正校验通过；③ L0-4/F1 流式评分合并键改为条件优先级（弱匹配不再遮蔽 leadKey 强匹配），并补 3 条回归用例；④ 修复 `search-result-card.tsx` 漏值导入 `useLeadsStore` 导致的搜索结果渲染 `ReferenceError`；⑤ 新增 `npm run typecheck` 并接入 CI，补上"src 从不类型检查"这一门禁盲区；⑥ L2 `automation-workflow.tsx` 移除 `setInterval` + `Math.random()` 虚构进度条，改为真实待校验数量 + 不确定态（spinner），杜绝向用户展示假进度；⑦ P2-4 `leads-table.tsx` CSV 导出原先输出 `undefined%`（待评估线索），改为抽纯函数 `formatMatchScoreForExport` 与 UI 同口径输出「待评估」，并补 3 条单测；⑧ P2-5 导航徽标准入对齐真实授权——`app-sidebar.tsx` 移除 accounts/agents 过严的 premium 门禁与「高级」徽标（对齐 `dashboard-page.tsx` 真实准入 + `README.md:61` 授权矩阵），保留 automation/team-dashboard 的 premium 门禁，并补回归断言
