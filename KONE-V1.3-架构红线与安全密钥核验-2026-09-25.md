# KONE 架构红线 · 安全密钥 · 精准度收口 · 核验报告

> **日期**：2026-09-25 ｜ **基线**：HEAD `147129a`
> **依据**：`ARCH-STANDARDS.md` §7（计费隔离）/ §9.5（Agent 真实执行边界）/ §9.6（精准度收口 G1–G4）/ §10（安全与密钥）
> **方法**：逐条抽取条款 → 对照实现取证 → 记录证据与结论；**发现缺口即补门禁**。

---

## 0. 结论

| 核验域 | 结论 |
|---|---|
| §7 计费隔离（云端能力不得泄漏到 Trial/Basic） | ✅ **合规** |
| §9.5 Agent 真实执行边界（7 条） | ✅ **合规**（前轮 AGENTS.md 核验已覆盖，结论一致） |
| §9.6 精准度收口（14 条，抽验 10 条） | ✅ **合规** |
| §10 安全与密钥（4 条） | ✅ **合规** |
| **本轮新发现功能缺陷** | **0 个** |
| **发现门禁缺口并补齐** | **1 处**（架构红线原只校验文档、不校验代码） |

---

## 1. §7 计费隔离

| 条款 | 结论 | 证据 |
|---|---|---|
| 云端执行 / 团队状态 / 远端自动化**绝不得**泄漏到 Trial 或 Basic | ✅ | `license-guard.ts:35`：`PREMIUM_FEATURES = [...BASIC_FEATURES, 'cloud_send', 'team_collaboration']`；11 个 CLOUD 通道经 `registerSecureFeatureIpc(..., 'cloud_send', ...)` 拦截（如 `CHECK_COLLISION`）；`automation-service.ts:392` `licenseGuard.requireFeature('cloud_send', '自动化发信')` |
| Trial 能力边界 | ✅（**附口径歧义待决**） | 实现 = README 试用列（10 条/15 秒、AI 分析不开放、导出限 100 行）。**歧义**：`ARCH-STANDARDS §7.2` 措辞为"Trial is temporary access to Basic-local capabilities only"，而 `kone-PRD §5.1.2` 将 Trial/Basic 合述为"本地搜索、评分、分析…"。**两者均未如 README 那样明确排除 AI 分析** → 建议治理层澄清 §7.2/§5.1.2 措辞 |

---

## 2. §9.5 Agent 真实执行边界（7 条）

| # | 条款 | 结论 |
|---|---|---|
| 1 | 必须执行真实外部动作或平台状态检查后才递增成功计数 | ✅ |
| 2 | 禁止 `setTimeout` 模拟 | ✅ 全仓 grep 0 命中 |
| 3 | LinkedIn 限会话 Cookie 导入 + 只读浏览 + 公开数据提取 + 破冰文案 | ✅ |
| 4 | 禁止自动 Connect / 自动私信 / 批量社交动作 | ✅ `agent-service.ts:688` 显式写 `linkedinContacted: false` |
| 5 | WhatsApp Basic 限低量 Puppeteer + Web DOM（`data-testid`，标注实验性） | ✅ |
| 6 | Email 须 SMTP/IMAP + DNS 可投递性检查；SPF/DKIM/DMARC 高危**软锁** | ✅ `email-agent.ts:93-147` |
| 7 | Agent 完成须同时更新持久化 `agentStatus` 与运行时 `AgentState` | ✅ `agent-service.ts:269-302` 双管道 |

---

## 3. §9.6 精准度收口（抽验 10 条）

| # | 条款 | 结论 | 证据 |
|---|---|---|---|
| 1 | Eligibility Gate 一票否决（`computeEligibilityVeto`） | ✅ | `scout.ts:104` |
| 2 | **词边界**产品词匹配（ASCII 用 `\b`，非 ASCII 退 `includes`） | ✅ | `scout.ts:92-102` |
| 3 | 五级邮箱验证 + 映射（`verified/probable/catch_all→true`，`risky/invalid→false`） | ✅ | `electron/utils/email-verification.ts` |
| 4 | 邮件内容链优先级 + `email_content_source` 审计 | ✅ | `email-agent.ts:320-329` |
| 5 | 决策人零网络静态校验（`emailGrade`/`phoneValid`） | ✅ | `electron/utils/contact-validation.ts` |
| 6 | 全量 LLM 评分 + `scoreSource` 置信标识透传 | ✅ | `SEARCH_LLM_SCORE_LIMIT = SEARCH_TARGETED_LEAD_LIMIT = 50`；`leads-table` AI/规则 徽标 |
| 8 | 跟进人工挂起（`pendingManual` 排除出 `isPlanDue`） | ✅ | `followup-scheduler.ts:66`；`agent-service.ts:851-852`；`leads-table.tsx:122` "邮件需人工确认" |
| 9 | 发送窗口 09:00–18:00 + 未知时区放行 + ±20% jitter | ✅ | `electron/utils/send-window.ts`（`SEND_WINDOW_END_HOUR = 18`） |
| 11 | DKIM selector 可配（**合并**默认列表，非替换） | ✅ | `resolveDkimSelectors` |
| 12 | 五级验证队列（primary/throttled/deprioritized/suppression） | ✅ | `buildVerificationQueues` |
| 13 | 多窗口时空隔离（`activeJobIds: Map<senderId, jobId>`） | ✅ | `search/job-registry.ts`（本轮 P8 外提） |

---

## 4. §10 安全与密钥

| # | 条款 | 结论 | 证据 |
|---|---|---|---|
| 1 | **渲染层不得含密钥** | ✅ **设计级保证** | SECRET 通道**仅有 `SET` / `CHECK`，无 `GET`** → 渲染层只能写入与查询状态，**永远拿不到明文** |
| 2 | 不得发布私钥材料 | ✅ | 仓库仅 `kone-offline-public.pem`（`-----BEGIN PUBLIC KEY-----`，**公钥**）；全仓 grep `PRIVATE KEY` → **0 命中** |
| 3 | 授权校验须加密保护且抗时间回拨 | ✅ | `license-service.ts`：`rollbackDetected` → `SYSTEM_TIME_ABNORMAL`；标准时间源校验 |
| 4 | 敏感日志须脱敏或省略 | ✅ | `http-client.ts` `redactUrl`（URL 参数 `[REDACTED]`） |

---

## 5. 本轮门禁补齐（唯一改动）

**缺口**：`scripts/verify-doc-consistency.cjs` 的 `checkArchitectureRedlines()` **只校验 ARCH-STANDARDS.md 是否"声明"了红线**，不校验代码是否"遵守"——红线可能**写在纸上、代码里却违反**（本会话已两次证明此类漂移真实存在：熔断 off-by-one、试用越权）。

**补齐**：新增 **代码符合性检查**（3 项，可机械判定）：
| 红线 | 校验对象 | 断言 |
|---|---|---|
| Provider 隔离必须用 `Promise.allSettled` | `provider-registry.ts` | 含 `Promise.allSettled` |
| 并发上限为 2 | `search/constants.ts` | `SEARCH_LLM_CONCURRENCY = 2` |
| 正文截断 3000 | `search/constants.ts` | `MAX_WEBSITE_TEXT_FOR_LLM = 3000` |

门禁输出由「架构红线 3 项」→ **「3 项（文档）+ 3 项（代码符合性）」**。

---

## 6. 待决项（未擅自改）

| 项 | 说明 | 建议 |
|---|---|---|
| §7.2 / §5.1.2 措辞歧义 | "Trial = Basic-local capabilities" vs README"试用不含 AI 分析" | 治理层澄清措辞，明确 Trial 能力边界 |
| README 试用口径 | 「AI 销售团队智能体」试用列写"试用限额（每日 3 条）"，而 PRD §6.0/AGENTS.md 要求 Trial **熔断拦截**（实现与 PRD 一致） | README 订正为"不开放（升级解锁）" |
| 云端功能口径 | README 高级版云端能力已加"需配置云端后端 / 完整投递闭环为目标态"注（前轮已修） | 立项前保持 |

---

## 7. 验证

| 门禁 | 结果 |
|---|---|
| `test:unit` | **312 / 312** |
| `typecheck` | 0 error |
| `verify:consistency` | 双绿（宪法常量 8 + 扩展 7 + 管道阈值；架构红线 3 文档 + 3 代码） |
| `lint` / `format` | 0 error / 通过 |

---

*本报告为时点快照（2026-09-25，HEAD `147129a`）。核验结论：§7 / §9.5 / §9.6 / §10 **全部合规**，本轮无功能缺陷。*
