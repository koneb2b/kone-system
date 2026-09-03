# Kone V1.3 商用上线就绪度审计报告与优化计划

> 📋 **审计定位**：本文是针对"能否商用上线发给用户使用"的专项就绪度审计（第四轮），聚焦运行时数据交互顺畅性/及时性、UX 关键旅程、打包交付可用性。与前两轮《KONE-V1.3-对齐审计分析报告》（规范对齐）与《KONE-V1.3-优化计划》（P0/P1/P2 执行）衔接：本文核验 P0 批次修复后的链路状态，并给出**发布门禁视角**的新结论。
> ⚠️ **可信度声明**：本会话 shell 持续损坏（`STATUS_DLL_INIT_FAILED`），**全部结论为静态分析**，无法运行编译/测试；尤其"本轮所有 P0/P1 代码修改均未经任何运行时验证"本身即是头号发布风险（见 §8 阻断项 1）。所有 `file:line` 证据可在仓库直接复核。

---

## 1. 总体判定：**有条件 Go（Conditional Go）——今日不可直接上线**

Kone V1.3 的架构、商业边界诚实性、错误降级设计、测试资产均达到或接近商用标准；但存在 **3 个发布级硬阻断**（§8），全部修复并跑通验证门禁后方可对外发放：

| # | 阻断项 | 性质 |
|---|---|---|
| B1 | 全部 P0/P1 代码修改未经编译与测试验证（环境无 shell） | 流程阻断——任何未验证的生产路径修改都不可发货 |
| B2 | 打包产物中 Agent 浏览器预期无法启动（puppeteer 无 executablePath，Chromium 不随 NSIS 打包） | 功能阻断——WhatsApp/LinkedIn Agent 在用户干净机器上预期失败 |
| B3 | SMTP 密码明文落盘 `user_config`（P0-2 临时方案，加密未做） | 安全阻断（可降级为知情上线，但商用软件不建议） |

---

## 2. 就绪度评分卡（10 维）

| 维度 | 评分 | 关键依据 |
|---|---|---|
| 架构与数据闭环（后 P0） | 8.0 | 搜索→Agent→徽标全链路纸面闭环（§3.2），运行时未验 |
| 流式交互及时性 | **7.0** | 新发现 F1 合并键缺陷（评分更新静默丢弃路径）+ F2 徽标实时性缺口 |
| Agent 执行与打包可用性 | **5.0** | B2：puppeteer 打包问题（静态高置信，需运行时确认） |
| 持久化与可靠性 | 8.5 | 仅持久化 curated leads（设计正确）；agent_status/日志重启恢复；每日备份 |
| 错误处理与降级 UX | 8.5 | 网络错误 3 次指数退避自动重试+保留已有结果；TRIAL_EXPIRED 四处友好处理 |
| 商业边界诚实性 | 8.5 | P0-5 分层授权落地；Trial 熔断；实验性标注；无假数据 |
| 安全与数据主权 | 7.0 | B3 smtpPass 明文；PDF 100% 本地；secret-manager 体系已存在可承接 |
| 测试资产 / 验证状态 | 8.0 / **2.0** | 41 个测试文件覆盖面优秀（含 agent-pipeline-integration、persistence、suppression、offline-channel）；但当前修改全部未执行 |
| 打包与交付 | 7.0 | NSIS 配置完善（中文快捷名、可选目录）；publish:null 离线口径已文档化；B2 未解 |
| 文档规范 | 9.0 | 三轮治理完成，文档-代码无已知实质矛盾 |

---

## 3. 数据交互链路逐段核验（本轮核心）

### 3.1 搜索流式管道（渲染端消费侧）— 发现关键缺陷

事件链 `stream-start → basic-results → (stage | lead-scored)* → complete | error` 消费逻辑（use-search-engine.ts:470-656）：

- ✅ **basic-results 全量替换**（L486-499）：新搜索立即置换 `searchResults`，无跨搜索残留；受 `maxResults` 与 `OMNI_SEARCH_RESULT_LIMIT` 双重截断。
- 🔴 **F1｜lead-scored 合并键不稳定（本轮最重要新发现）**：评分回填按 `website 全等 OR company 全等` 匹配（L515-521）。三个后果：① 富化阶段公司名规范化差异（空格/大小写/别名）→ `hasMatch=false` → **该线索的评分/邮箱/决策人更新被静默丢弃**；② 同名/同域多行会被同一份评分数据整体覆盖；③ P0-1 已贯通的 `leadKey` 稳定 UUID **未用于合并**——修正路径明确：优先 `leadKey === scoredLead.id`，回退 website/company。
- ⚠️ 承前未修：complete 时 toast"已完成 N 条线索的评分分析"（L597-599）中 N 是**线索总数**而非真实评分数（主进程 `SEARCH_LLM_SCORE_LIMIT=20` 只对 Top20 做 LLM 评分）——口径失真，用户以为全部精评过。
- ✅ **error 路径优秀**（L605-646）：网络类错误 3 次指数退避自动重试（1s/2s/4s）+ toast 进度提示；非网络错误区分"已有基础结果"与"彻底失败"两态文案；重试计数在 complete 时清零。

### 3.2 搜索→Agent→徽标全链路（P0 修复后核验，纸面闭环 ✅）

```
search-service 唯一 UUID 戳记（result.id, crypto.randomUUID）
→ emitBasicResults/emitLeadScored 保留 id
→ withPipelineIsolation 内 buildAgentTaskQueue（leadKey: String(lead.id)）agent-pipeline.ts:66
→ stageAgentsFromPipeline 暂存 StagedTarget.leadKey（agent-service.ts:743）——人工闸门，不自动发
→ 用户 start → consumeStagedTargets → 执行 → writeBackAgentStatus(target.leadKey || target.company)
→ agentStatusStore 持久化（agent_status 键）+ hydrateAgentPersistence 重启恢复
→ 读端：agent:get-status IPC（P0-1 新增，agent-service.ts:778-799）
→ 渲染端：leadKey 透传（use-search-engine.ts:118 / lead-mappers.ts / leads-store.ts 类型）
→ leads-table 徽标：lead.agentStatus || statusMap[lead.leadKey]（leads-table.tsx:262）
```

链路各环节经本轮 file:line 复核**全部对齐**。残余问题：

- 🟠 **F2｜徽标实时性缺口**：`AGENT.STATUS_CHANGED`（管道 B）**仅 agents-panel.tsx:84 一处消费**（面板运行态卡片）。线索表徽标不订阅任何实时事件，仅在 `leads` 数组身份变化时批量拉取 `agent:get-status`（leads-table.tsx:112-131）→ Agent 完成触达后，用户在线索表看到的徽标**滞后**，直到线索池变更或组件重挂载。注：现有 STATUS_CHANGED 推送的是 agent 级运行态，**不含 per-lead 粒度**，实时化需要新增轻量 per-lead 事件通道（见 §9-L1-5）。
- 🟡 **F3｜statusMap 拉取偏 chattiness**（可接受）：effect 依赖 `[leads]`，任意 lead 变更触发全量 leadKey 重拉（有界 ≤50、有 cancelled 防护、无渲染循环）——量级可接受，配合 F2 的实时通道可一并优化。

### 3.3 Email 配置链（P0-2 后核验）✅

- 写端（accounts-management.tsx `handleSaveEmail`）写入 `user_config.accounts.email.{smtpHost,smtpPort,smtpUser,smtpPass,senderEmail,senderName}`；
- 读端（agent-service.ts:247-259）读取同名字段并含 `host/port/user/pass/email/name` 旧字段回退——**形状完全对齐**，且 senderName 缺省回退 `'Kone Agent'`；
- Email Agent 实例化注入 P1-4 抑制名单门（L266-275）；Basic 邮箱账号上限 1 个（accounts-management.tsx:364）。
- 残余：🟡 **F5** 表单不回显已存配置，且保存时全字段覆盖写——二次进入表单直接保存会把空字符串写回、**清掉已配置的凭据**（数据丢失边角路径）；🟠 B3 smtpPass 明文（§8）。

### 3.4 持久化与重启恢复 ✅

- 设计正确：仅持久化 curated `leads`（`LEADS_CONFIG_KEY`），`searchResults` 永不落盘（leads-store.ts:5-16 注释明示）；fire-and-forget 持久化失败时降级为会话态。
- Agent 侧：日志 + agentStatus 持久化 + `hydrateAgentPersistence(store)`（agent-service.ts:776）重启恢复触达时间线。
- 每日备份（backup-service，MD5 + 7 文件轮换 + 50MB 上限）+ crash-reporter + 403/503/timeout 分类降级——可靠性面扎实。

### 3.5 账号沙箱与 Agent 执行 — 发现发布级阻断 B2

- 🔴 **B2/F4｜打包产物浏览器可用性**：`whatsapp-agent.ts:60-64` 与 `linkedin-agent.ts:59` 的 `puppeteer.launch({ headless:false, args, userDataDir })` **均未指定 `executablePath` 或 `channel`**。完整版 `puppeteer@23`（dependencies）的 Chromium 二进制存于**开发机**用户缓存目录，electron-builder `files` 配置（package.json:42-52）无 extraResources 携带浏览器。静态推断：**NSIS 安装包在用户干净机器上启动 Agent 时找不到浏览器 → WhatsApp/LinkedIn Agent 不可用**（开发机因 postinstall 缓存存在而"看起来正常"）。置信度高，须以 §10 冒烟第 6 步实测确认。
- 正面：WhatsApp 连接流程真实严谨（QR 展示→扫码等待 120s→超时置 expired 不假成功，whatsapp-agent.ts:69-84）；session 状态机符合宪法"断线/验证码/过期必须 paused/error"。

---

## 4. 本轮新发现问题清单

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| F1 | P1-高 | lead-scored 评分回填合并键用 website/company 全等，未用已贯通的 leadKey；公司名漂移场景评分更新**静默丢弃**，同名行整体覆盖 | use-search-engine.ts:515-521 |
| F2 | P1 | 管道 B 运行态仅 agents-panel 消费；线索表触达徽标无实时刷新通道（且 STATUS_CHANGED 无 per-lead 粒度） | agents-panel.tsx:84 全库唯一消费点；leads-table.tsx:112-131 |
| F4 | **P0-launch** | puppeteer 无 executablePath/channel，Chromium 不随包 → 打包产物 Agent 浏览器预期启动失败 | whatsapp-agent.ts:60 / linkedin-agent.ts:59 / package.json:42-52 |
| F5 | P2 | 邮箱配置表单不回显现值 + 全字段覆盖写 → 空保存清凭据 | accounts-management.tsx handleSaveEmail |
| F7 | **P0-launch** | 全部 P0/P1 修改未编译未测试（本环境 shell 损坏）；含 IPC 契约/preload/store 类型等生产路径 | 会话事实 |
| F8 | P2 | Basic 视角"3 大本地原生智能体"文案 vs 实显 2 卡片；今日配额 `totalLimit=agents[0].dailyLimit` 聚合口径误导（A9 承前） | agents-panel.tsx:273-275 |
| F3 | P2 | statusMap 全量重拉 chattiness（有界可接受） | leads-table.tsx:112-131 |

正面确认（无需改动）：错误自动重试与结果保留、TRIAL_EXPIRED 友好化四处覆盖（use-search-engine.ts:199/215/827、search-engine.tsx:29）、leads 持久化设计、41 项测试资产、NSIS/离线交付口径。

## 5. 未决遗留问题盘点（承前两轮，未修复项）

| 承前编号 | 状态 | 内容 |
|---|---|---|
| P1-13/N1 | 未修 | `localDomainOnly`/`highRelevanceOnly` 仅前端二次过滤，主进程 Scout 未消费；`COUNTRY_TLD_MAP` 死代码（诚实性：开关语义与实际效果不符） |
| P1-6 | **未修且已真实化** | smtpPass 明文（P0-2 临时方案触发）；secret-manager + SECRET_KEYS 体系已存在，承接成本低 |
| P1-5 | 未修 | Agent 日频上限硬编码，未读 userConfig |
| A9 | 未修 | 配额展示聚合口径（并入 F8） |
| A-scores-toast | 未修 | 完成文案评分计数失真（§3.1） |
| P2 全清单（26 项） | 未动 | 见《KONE-V1.3-优化计划》P2 表 |

## 6. UX 关键旅程走查结论（静态）

1. **首次运行/配置密钥**：未配置 SerpApi/LLM Key 时的搜索前置引导依赖设置页手动配置；缺一个"首次运行向导"强制走查（P2 建议，非阻断）。
2. **搜索旅程**：stage 文案流式渲染 + 降级透明化（四级协议文案已统一）+ 基础结果秒出解锁 Loading——体验设计良好；扣分点集中在 F1（部分行评分永不回填，用户看到"待评估"卡死）与评分数口径。
3. **线索旅程**：筛选 Sheet/排序/导出闭环完整；徽标滞后（F2）是主要体验债。
4. **Agent 旅程**：Trial 熔断海报 / Basic 受限卡片（含低频本地风控标注）/ Premium 全量——分层落地；B2 使 Basic 的 WhatsApp 卡片在真机上点击即失败——**上线前必须解决**。
5. **交付旅程**：NSIS 中文快捷名、可选安装目录、离线激活工具齐备；自动更新离线口径已文档化并禁止误宣传。

## 7. 商用边界与合规确认

- 三级套餐 Fail-Closed 主进程拦截、防回滚、machine-id 绑定、离线 RSA 许可——架构完整。
- 商业诚实性（实验性标注/能力事实源/离线更新真相）经文档治理轮已闭环。
- 残余：smtpPass 明文与"捍卫用户数据资产金库"的产品承诺存在张力（B3）。

---

## 8. 发布阻断项（L0——全部完成才可上线）

1. **B1 验证门禁**：在可用 shell 环境依次执行并全绿：
   `npm run lint` → `npm run test:unit` → `npm run test:ipc` → `npm run test:e2e-smoke` → `npm run test:security-audit` → `npm run build` → `npm run test:smoke`（打包冒烟）。任何红灯回炉修复后重跑。
2. **B2 打包浏览器**（推荐组合方案）：Windows 主战场用 `channel:'chrome'` + `channel:'msedge'` 双回退（Win10/11 预装 Edge 命中率极高）；兜底 `extraResources` 携带 Chromium 并显式 `executablePath` 指向解包路径；两者都不可用时 UI 明确引导"请安装 Chrome/Edge"。验证：packaged-smoke 增加"Agent 浏览器可启动"断言。
3. **B3 smtpPass 加密**：迁移 secret-manager（新增 `SECRET_KEYS.EMAIL_SMTP_PASS`），`handleSaveEmail` 改走 secret.set；读端 agent-service 从 secret-manager 取；顺带实现 F5 表单回显（只回显非密字段，密码留空表示不修改）。

## 9. 优先级执行优化计划

### L0 发布阻断（顺序执行，预估 2-3 天）

| # | 任务 | 落点 | 验证 |
|---|---|---|---|
| L0-1 | 全量验证门禁（B1） | 无代码改动，跑 §8-1 命令链 | 全绿 |
| L0-2 | Agent 浏览器打包修复（B2） | whatsapp/linkedin-agent.ts launch 选项 + electron-builder extraResources（如走携带方案） | packaged-smoke 新断言 + 真机冒烟 |
| L0-3 | smtpPass 加密 + 表单回显（B3+F5） | accounts-management.tsx / agent-service.ts:247-259 / secret-manager | 单测：密钥不落 user_config；回显不泄密 |
| L0-4 | lead-scored 合并键修复（F1） | use-search-engine.ts:515-521 优先 leadKey 匹配 | 新增用例：公司名漂移场景评分不丢 |

### L1 上线前强烈建议（预估 3-5 天，可与灰度并行）

| # | 任务 | 说明 |
|---|---|---|
| L1-1 | 徽标实时通道（F2） | 新增轻量 per-lead 事件 `agent:lead-status-updated { leadKey, agentStatus }`，writeBackAgentStatus 时 emit；leads-table 订阅按 leadKey 增量更新 statusMap（顺带解决 F3 chattiness） |
| L1-2 | 质量开关主进程挂载（P1-13） | Scout 过滤消费 localDomainOnly（COUNTRY_TLD_MAP 激活）与 highRelevanceOnly，前端过滤降级为兜底 |
| L1-3 | 评分口径诚实化 | complete toast 显示"Top {N} 深度评分 / 共 {M} 条"；SEARCH_LLM_SCORE_LIMIT=20 写入 PRD 常量表 |
| L1-4 | Agent 日频读 userConfig（P1-5）+ 配额展示修正（F8 前半） | applyLicenseLimits 接 userConfig 覆盖；面板配额改逐 Agent 展示 |

### L2 上线后迭代（承接既有 P2 清单）

导航徽标准入、CSV 待评估判空、automation 伪进度步进、Provider 单测矩阵、CI lint/build job、`kone-.md` 重命名、两个墓碑桩物理删除、`email-suppression.ts`/`followup-scheduler.ts`/`registry.ts` 未跟踪文件补提交（**此项实为 L0-1 之前的仓库卫生前置**）。

## 10. 发布前人工冒烟清单（B1 通过后，干净 Win 虚拟机执行）

1. 安装 NSIS 包 → 桌面快捷方式"Kone 智能获客" → 启动无白屏。
2. 离线激活 Trial → 侧边栏特权港显示升级引导；`/agents` 路由熔断为海报。
3. 设置页配置 SerpApi/LLM/AnySearch Key → 保存重开仍存在。
4. 执行一次多源搜索：观察 stage 流式文案、基础列表秒出、Top20 评分逐条回填（**重点核对第 20 名以后行是否有评分漏更**——F1 修复验证）。
5. 保存 2 条线索 → 重启应用 → 线索池与触达徽标仍在。
6. 账号管理 → 配置 SMTP（保存后重进表单**应回显非密字段**、密码留空）→ Email Agent 启动发测试信；账号管理 → WhatsApp 沙箱连接 → **浏览器窗口真实拉起并显示二维码**（B2 修复验证）。
7. Trial PDF 导出 3 次配额递减 → 第 4 次拦截。
8. 断网状态下搜索 → 自动重试 3 次 → 保留基础结果 + 明确报错。
9. 导出 CSV → Excel 打开无乱码；`待评估` 状态正常输出。
10. 任务管理器确认：退出后无残留 electron/Chromium 进程（before-quit 断开 Agent）。

---

## 11. 结论

项目在**架构完整性、商业诚实性、错误韧性、测试资产**四个维度已具备商用底子；数据交互主链路经 P0 批次修复后纸面闭环、配置链形状对齐。距"发给用户使用"还差**一段确定性的收尾**：跑通验证门禁（B1）、让 Agent 浏览器在真机上活过来（B2）、把明文密码送进加密库（B3），再以 F1 合并键修复保住评分体验的完整性。全部为小切口、有既有范式可循的工程动作——不缺架构，缺的是最后一公里的严谨执行与真机验证。

*（本报告为纯评估交付：审计过程未修改任何文档与代码。）*
