# Kone P2/P3 体验与覆盖增强执行计划 — ✅ 全部完成（2026-09-03，P2-2 为部分落地+诚实路线图）

> 依据: `KONE-V1.3-深度审计报告与优化执行计划.md` §四 P2（体验与覆盖增强）+ P3（工程与质量）。
> 前置: P0（G1–G4）与 P1 四项已落地。

## 执行清单（Prometheus 输出）

### P2-3 · ICP 机会分 55/35/10 精细化（Stage 2）✅
- [x] `buildUniversalIcpPrompt` 升级为结构化输出：`opportunityScore: { icpFit(0-55), intent(0-35, Why-Now 证据), evidence(0-10), riskPenalty(0-20), finalScore }`；`totalScore` 即 `finalScore`（向后兼容）。
- [x] `normalizeOpportunityScore()` 纯函数（导出供测试）：钳制各维度、finalScore 重算校验、缺失/非法 → undefined（不臆造）。
- [x] `SearchExecuteResult`/`LeadItem` 契约增量 `opportunityScore?`；mapper 透传；leads-table 徽标 tooltip 展示分维度拆解。
- [x] **宪法**：Stage-1 `computeIcpMatchScore` 40/30/20/10 纯函数零改动；LLM 并发 2 / 3000 字红线不变。

### P2-4 · DNS DKIM 选择器可配置 ✅
- [x] `email-agent.ts checkDnsHealth` 与 `dns-service.ts` DKIM 探测 selector 列表支持 `userConfig.dnsShield.dkimSelectors` 注入（合并默认列表，不替换，防误报）。
- [x] 设置页 Base Settings 增加输入（逗号分隔 selector）。
- [x] 误报防护：默认有限 selector 列表保留；软锁逻辑（仅 SPF/黑名单 critical）不变。

### P2-1 · 五级验证差异化队列 ✅
- [x] `automation-service.ts` 新增 `buildVerificationQueues(results)`（导出供测试）：verified/probable → primary；catch_all → throttled（限频靠内容）；risky → deprioritized；invalid → suppression_candidates。
- [x] `EmailAgent.sendEmail` 静态邮箱门禁：disposable/role-account 收件人在发送前拦截（不消耗日频、不计失败），杜绝一次性地址烧域名信誉。
- [x] 前端 automation-workflow：验证结果按五级队列分组计数展示；云端 campaign 仅携带 primary+throttled（risky/invalid 天然被 valid=false 排除，语义显式化）。

### P2-2 · 14 天全渠道协同节律 —— 诚实边界决策
- [x] **落地**：`followup-scheduler.ts` 新增 `describeCadence(stage)` 纯函数（导出供测试），阶段推进日志附带推荐节律（Day0 邮件 → Day3-5 LinkedIn 人工交流 → Day7-10 FU1 → Day12-14 FU2）。
- [x] **保留路线图**：统一编排器（商机卡 Day0 装配、LinkedIn 人工触点 UI、跨渠道队列调度）依赖产品面尚未存在的前端装配范式，不虚报。PRD 对应条款维持 `[路线图]` 并注明本步完成部分。

### P3-1 · Provider 专项单测 ✅
- [x] `tests/business-logic/provider-isolation.business.test.js`：mock `proxy-service.fetchWithRetry` + `search-service` 动态导入；覆盖 trade-show/customs provider 的归一化输出、myJobId 陈旧丢弃、非 200 隔离。

### P3-2 · 多窗口时空隔离升级 ✅
- [x] search-service：`activeJobIds: Map<ownerKey, jobId>`（ownerKey = sender WebContents id）；handler 内全部 `myJobId (===|!==) currentActiveJobId` 检查改走 owner 作用域解析。
- [x] 新增导出 `isKnownActiveJobId(id)`；8 个 provider 陈旧检查由"仅匹配全局最新 job"升级为"匹配任意活跃窗口 job"。
- [x] `getCurrentActiveJobId` 保留（向后兼容）；AGENTS.md / ARCH-STANDARDS 契约文本同步。

### P3-3 · 海关/展会置信标注核查 ✅
- [x] 核查 UI：analysis-drawer 已有"基于公开贸易数据网页的近似海关信息…仅供参考"与展会足迹"近似…仅供参考"徽标；data-center 核查同口径，缺则补。
