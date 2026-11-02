# 41 个 plain `registerIpc` 通道 · 授权分层映射与 Fail-Closed 迁移方案

> 状态：**D1–D6 已落地，D7 待裁决**。本文是"迁移前必须先定策略"的决策文档；§4 中 D1、D6 已裁决并实现（2026-10-19，commit `b019a38`，回归 `tests/ipc-license-gate-d1-d6.test.ts`），D2–D5 亦已裁决并实现（回归 `tests/ipc-license-gate-d2-d5.test.ts`）；仅 **D7** 仍为**确认前不得实现**。
> 生成日期：2026-10-19　范围：`electron/` 主进程 IPC 授权边界
> 唯一权威源引用：`kone-PRD.md §1.2 / §5.1.2 / §六.0`、`ARCH-STANDARDS.md §3 / §6 / §14`、
> `src/shared/license-features.ts`（能力集 SSOT）、`electron/services/license-service.ts`（包装器实现）。

---

## 0. 结论摘要

1. **"41 个 plain `registerIpc`"不等于"41 个越权入口"**。其中 **16 个必须保持免门禁**（启动/激活/配置/密钥，加门禁会造成鸡生蛋死锁）；**22 个需要商业门禁**（其中 4 个已有 in-body 门禁、1 个门禁不完整）；**3 个需条件/参数化门禁**。
2. 真实缺陷 **2 处已确认**（初稿的"2 处待核"已当场核实闭环）：
   - **确认 ①**：`AUTOMATION.QUEUE_OUTREACH` 仅有 `ensureTrialAccess`，**缺 `requireFeature('cloud_send')`**，与 `CLOUD-COLLABORATION-DELIVERY.md` §13.1「premium feature」口径不符 → **活跃 Trial 与 Basic 均可直连云端投递入队**（根因见 §1.1：`ensureTrialAccess` 只拦"过期/未授权"，不构成付费墙）。
   - **确认 ②**：`ACCOUNT.CONNECT` / `ACCOUNT.DISCONNECT` / `ACCOUNT.GET_LIST` **三通道均有 in-body 门禁**（`sandbox-service.ts:270 / 347 / 381`），但**代理键选错**——非高级套餐分支要求 `search_basic`，而 `search_basic` **同时也是 Trial 的能力**（`TRIAL_FEATURES`），故 **Trial 可绑定并查看邮箱账号**，违反 PRD §六.0「Trial 必须熔断、严禁渲染智能体卡片或暴露运行指标」与 `AGENTS.md` 同款约束。正确键应为 `local_autopilot`（Basic+）。该路径**不含任何 Trial 有效期校验**，故对活跃 Trial 完全敞开。
   - **勘误**：初稿标记的"待核"项已消除——已完整读取 `sandbox-service.ts:257-404` 三个 handler，全部含门禁；问题从"缺失门禁"降级/升级为"**门禁键选取错误**"（见 D6）。
3. 迁移**不得机械替换**：`AUTH.*` / `CONFIG.*` / `SECRET.*` / `LICENSE.*` / `SYSTEM.*` 一旦套上 `registerSecureIpc` 会**锁死激活与配置**，属 P0 级回归风险。

---

## 1. 事实基线（可复现）

| 项 | 值 | 证据命令 |
|---|---|---|
| 通道总数 | 72 | `npm run verify:ipc` |
| `registerIpc()` 正式迁移 | **41** | 同上（脚本逐通道列出） |
| `registerSecureIpc` / `registerSecureFeatureIpc` 包装 | **20** | `Get-ChildItem .\electron -Recurse -Filter *.ts \| Select-String 'registerSecure(Ipc\|FeatureIpc)\('` |
| plain `ipcMain.handle` 直挂 | **0** | `npm run verify:ipc` |

**41 个 plain 通道的权威清单**（`verify:ipc` 输出，按注册文件分组）：

```
AUTOPILOT.SYNC_STATE                                             (main.ts:241)
AGENT.LIST / AGENT.GET_LOG / AGENT.GET_STATUS
AGENT.SUPPRESS_LIST / AGENT.SUPPRESS_ADD / AGENT.SUPPRESS_REMOVE  (agent-service.ts:1349~1463)
AUTH.LOGIN / AUTH.LOGOUT / AUTH.GET_SESSION                       (auth-service.ts:12~64)
AUTOMATION.START_CAMPAIGN / AUTOMATION.QUEUE_OUTREACH             (automation-service.ts:164/242)
AUTOMATION.IMAP_POLL / IMAP_STATUS / IMAP_RESTART / IMAP_TEST_CONNECTION (imap-reply-service.ts:530~576)
AUTOPILOT.GET_STATE / SET_STATE / CLEAR_LEGACY                    (autopilot-state-service.ts:88~112)
CLOUD.CLOUDFLARE_CONFIGURED / TEST_CONNECTION / DASHBOARD_STATS
CLOUD.CLOUDFLARE_POLL_OUTREACH_STATUS / CREATE_APPROVAL / LIST_APPROVALS (cloudflare-service.ts:800~910)
CONFIG.GET / CONFIG.SET / SECRET.SET / SECRET.CHECK               (config-service.ts:507~576)
PROVIDER.LIST / PROVIDER.STATUS                                   (provider-service.ts:52/57)
ACCOUNT.CONNECT / ACCOUNT.DISCONNECT / ACCOUNT.GET_LIST           (sandbox-service.ts:265/334/379)
SYSTEM.GET_DEVICE_STATUS / SYSTEM.OPEN_EXTERNAL                   (license-service.ts:723/737)
LICENSE.GET_INFO / REQUEST_TRIAL / SUBMIT / VERIFY / CHECK_STATUS  (license-service.ts:757~1024)
```

**门禁基础设施（既有，勿重复实现）**

- `registerSecureIpc(ipcMain, channel, store, licenseGuard, handler, operationName?)` —— 只做 **Trial/过期拦截**（`ensureTrialAccess`），并把通道**登记进 registry（`skipAttach: true`）**。见 `license-service.ts:559-593`。
- `registerSecureFeatureIpc(..., featureName, handler, ...)` —— Trial 拦截 + `licenseGuard.requireFeature(featureName)`（数组则 `requireAnyFeature`），无权返回 `FEATURE_DENIED` 结构化信封。见 `license-service.ts:595-627`。
- 两层包装**自身即 registry-known**，因此迁移后 `verify:ipc` 的"plain"计数会下降，`ARCH-STANDARDS §3` 注记需同步。

### 1.1 关键语义（两处缺陷的共同根因）

`ensureTrialAccess(store, licenseGuard, op)`（`license-service.ts:485-526`）的真实语义是**"有效期/授权状态"门禁，而非付费墙**：

| 输入状态 | 结果 |
|---|---|
| `store` 缺失 | 放行 |
| **开发态**（`!app.isPackaged`）或回归测试 harness | **无条件放行**（`shouldBypassLicenseInDev`，`:483`）→ 门禁在 dev 下不可观测 |
| `claims.status === 'active'` 且未过期 | 放行（**活跃 Trial 亦在此列**） |
| Trial 已过期 / 无活跃 claims | `403 TRIAL_EXPIRED` |

**推论**：`registerSecureIpc`（仅 Trial 门禁）**不是付费墙**；真正的套餐墙只由 `registerSecureFeatureIpc` → `licenseGuard.requireFeature` 提供。因此：

1. 任何"只挂 `ensureTrialAccess`、不挂 `requireFeature`"的 Premium 通道 = **对活跃 Trial 与 Basic 同等敞开**（缺陷 ① 正是此类）。
2. 任何"用 `search_basic` 当 Basic 代理键"的判断 = **对活跃 Trial 同等敞开**，因 `search_basic ∈ TRIAL_FEATURES`（缺陷 ② 正是此类）。

撰写迁移用例时必须覆盖三态：**活跃 Trial / 已过期 Trial / 付费 Basic**，且不可在 dev 态（门禁被跳过）下断言拒绝行为。

---

## 2. 授权语义（SSOT 推导，不自创）

| 套餐 | 能力集（`src/shared/license-features.ts`） | 依据 |
|---|---|---|
| Trial（7 天） | `search_basic`、`lead_export` | `TRIAL_FEATURES`；PRD §1.1 |
| Basic（付费） | `+ search_deep`、`analysis_basic`、`analysis_advanced`、`local_autopilot` | `BASIC_FEATURES`；PRD §1.1 / §5.1.2 |
| Premium | `+ export_full`、`cloud_send`、`team_collaboration` | `PREMIUM_FEATURES`；PRD §1.1 / §5.1.2 |
| Enterprise | `+ enterprise` | `ENTERPRISE_FEATURES` |

**分层规则（本文档采用的判定顺序）**

1. **启动/激活必需 → 免门禁**（public）。否则未激活用户无法激活（死锁）。
2. **本机配置与 BYOK 密钥 → 免门禁**。Trial 也要配 LLM/SerpApi 密钥才能搜索（PRD §1.1「燃料自理」）。
3. **"看得到"与"用得了"必须同一 feature 键**。PRD §六.0：Trial 仅展示升级引导，**严禁暴露运行指标**；`AGENT.LIST` 的历史缺陷正源于"能看得见指标、却只在 CONTROL 上拦"，因此读端与写端必须同键。
4. **写云端/投递类 → `cloud_send`**。PRD §5.1.2：云端队列、远端自动化属 Premium/Enterprise。
5. **多开沙箱类 → `team_collaboration` + 邮箱白名单例外**。PRD §六.3 多开属高级；但 Basic 需单个企业邮箱通道（`sandbox-service.ts:270-284` 已实现该例外，**保留原判**）。

---

## 3. 41 通道逐条映射

图例：**P**=public（免门禁）｜**F(x)**=feature 门禁（x 为 featureKey）｜✅ 已有门禁 ｜⚠ 缺失/不完整

### 3.1 P — 免门禁（16 个，**禁止**加 `registerSecure*`）

| # | 通道 | 现状 | 目标 | 理由 |
|---|---|---|---|---|
| 1 | `AUTH.LOGIN` | 无 | **P** | 登录先于授权；加门禁→未激活用户无法登录 |
| 2 | `AUTH.LOGOUT` | 无 | **P** | 同上 |
| 3 | `AUTH.GET_SESSION` | 无 | **P** | 会话探测必须可用（前端首屏） |
| 4 | `SYSTEM.GET_DEVICE_STATUS` | 无 | **P** | 激活页需设备识别码，鸡生蛋 |
| 5 | `SYSTEM.OPEN_EXTERNAL` | 无 | **P** | 纯工具（打开链接），无商业溢价 |
| 6 | `LICENSE.GET_INFO` | 无 | **P** | 授权状态查询本身 |
| 7 | `LICENSE.REQUEST_TRIAL` | 无 | **P** | 试用入口，被门禁即无法试用 |
| 8 | `LICENSE.SUBMIT` | 无 | **P** | 激活码提交 |
| 9 | `LICENSE.VERIFY` | 无 | **P** | 激活校验 |
| 10 | `LICENSE.CHECK_STATUS` | 无 | **P** | 同上 |
| 11 | `CONFIG.GET` | 无 | **P** | 设置页首屏读取；加门禁→试用用户看不到设置 |
| 12 | `CONFIG.SET` | 无 | **P**（见 D3） | 写入须按 key 白名单校验，但**不可整通道门禁** |
| 13 | `SECRET.SET` | 无 | **P** | BYOK 密钥（Trial 必需） |
| 14 | `SECRET.CHECK` | 无 | **P** | 密钥存在性探测（Trial 必需） |
| 15 | `PROVIDER.LIST` | 无 | **P** | 信息类枚举，无侧效应 |
| 16 | `PROVIDER.STATUS` | 无 | **P** | 同上 |

### 3.2 F — 需商业门禁（22 个；**#19–#22 经 2026-10-19 复核改判为「强制免门禁」** —— 实为 18 个需门禁 + 4 个豁免，理由见 §5.1）

| # | 通道 | 现状门禁 | 现状 | 目标键 | 理由 |
|---|---|---|---|---|---|
| 17 | `AGENT.LIST` | `requireFeature('local_autopilot')`（body，`agent-service.ts:1356`） | ✅ | `local_autopilot` | PRD §六.0 禁暴露运行指标；迁 wrapper 并**移除 body 重复门禁** |
| 18 | `AGENT.GET_LOG` | `requireFeature('local_autopilot')`（`:1380`） | ✅ | `local_autopilot` | 日志=运行指标，与 LIST/CONTROL 同键 |
| 19 | `AGENT.GET_STATUS` | 无（**强制免门禁**，见 §5.1 订正） | ✅ 免门禁 | **不适用** | 线索级触达徽标（P0-1 双管道读端）——**线索是 Trial 合法数据**；权威分级见 `tests/business-logic/agent-gate-classification.business.test.js` |
| 20 | `AGENT.SUPPRESS_LIST` | 无（**强制免门禁**，见 §5.1 订正） | ✅ 免门禁 | **不适用** | 邮件合规：退订名单查询（PROJECT-PRD §3.7.7） |
| 21 | `AGENT.SUPPRESS_ADD` | 无（**强制免门禁**，见 §5.1 订正） | ✅ 免门禁 | **不适用** | 邮件合规：登记退订请求，**任何套餐都必须可用** |
| 22 | `AGENT.SUPPRESS_REMOVE` | 无（**强制免门禁**，见 §5.1 订正） | ✅ 免门禁 | **不适用** | 邮件合规：撤销退订登记，**任何套餐都必须可用** |
| 23 | `AUTOPILOT.GET_STATE` | 无 | ⚠ | `local_autopilot` | Autopilot 属 Basic 能力 |
| 24 | `AUTOPILOT.SET_STATE` | 无 | ⚠ | `local_autopilot` | 同上 |
| 25 | `AUTOPILOT.CLEAR_LEGACY` | 无 | ⚠ | `local_autopilot` | 清理遗留巡航态同域（见 D5） |
| 26 | `AUTOPILOT.SYNC_STATE` | 无（`main.ts:241`） | ⚠ | `local_autopilot` | 同上；**必须与 GET_STATE / SET_STATE 同批收口** —— 单独给状态端加门禁会造成「控制端放行、状态端拦截」的**新不对称**（详见 §5.1） |
| 27 | `AUTOMATION.START_CAMPAIGN` | `ensureTrialAccess` + `requireFeature('cloud_send')`（`:169-184`） | ✅ | `cloud_send` | 推送云端台账=Premium；迁 wrapper 保证信封一致 |
| 28 | `AUTOMATION.QUEUE_OUTREACH` | `ensureTrialAccess` only（`:251`） | ⚠**缺 feature** | `cloud_send` | **确认缺陷**：缺 `requireFeature` → Basic 可直连入队；详见 D1 |
| 29 | `AUTOMATION.IMAP_POLL` | 无 | ⚠ | `local_autopilot` | IMAP 属 Email Agent（Basic，20/day） |
| 30 | `AUTOMATION.IMAP_STATUS` | 无 | ⚠ | `local_autopilot` | 同上（读端） |
| 31 | `AUTOMATION.IMAP_RESTART` | 无 | ⚠ | `local_autopilot` | 同上（写端） |
| 32 | `AUTOMATION.IMAP_TEST_CONNECTION` | 无 | ⚠ | `local_autopilot` | 配置前连通测试仍属 Agent 域（见 D4） |
| 33 | `CLOUD.CLOUDFLARE_CONFIGURED` | 无 | ⚠ | `cloud_send` | 云端配置探测属 Premium 引导链 |
| 34 | `CLOUD.CLOUDFLARE_TEST_CONNECTION` | 无 | ⚠ | `cloud_send` | 同上（会发真实请求） |
| 35 | `CLOUD.CLOUDFLARE_DASHBOARD_STATS` | 无 | ⚠ | `cloud_send` | 云端看板=Premium（PRD §5.1.2） |
| 36 | `CLOUD.CLOUDFLARE_POLL_OUTREACH_STATUS` | 无 | ⚠ | `cloud_send` | 拉取云端投递状态=Premium |
| 37 | `CLOUD.CREATE_APPROVAL` | 无 | ⚠ | `cloud_send`（见 D2） | 云端审批记录是 `cloud_send` 的服务端前置，非本地草稿审批 |
| 38 | `CLOUD.LIST_APPROVALS` | 无 | ⚠ | `cloud_send`（见 D2） | 同上 |

### 3.3 条件/参数化门禁（3 个）

| # | 通道 | 现状 | 目标 | 理由 |
|---|---|---|---|---|
| 39 | `ACCOUNT.CONNECT` | ✅ body 自定义：`team_collaboration`，否则须 `email_smtp/imap` **且** `search_basic`（`sandbox-service.ts:270-284`） | **F**: `local_autopilot`（Basic+），非邮箱类型再叠加 `team_collaboration` | 多开=Premium；Basic 单邮箱通道保留例外；**但 `search_basic` 对 Trial 亦为真 → 现可越权（D6）** |
| 40 | `ACCOUNT.DISCONNECT` | ✅ 与 #39 同构（`:347-355`） | 与 #39 同构 | 已确认两侧一致；须与 #39 同步换键 |
| 41 | `ACCOUNT.GET_LIST` | ✅ `team_collaboration \|\| search_basic`，非高级仅返回邮箱类（`:381-395`） | `local_autopilot`（见 D4 / D6） | Agent 卡片需读真实绑定态；PRD §六.0 要求 Trial 熔断 |

> 计数核对：3.1 = 16，3.2 = 22，3.3 = 3，合计 **41**。

---

## 4. 待裁决项（须产品/合规确认，**确认前不得实现**）

> **落地进度（2026-10-19）**：**D1 ✅ / D6 ✅ 已实现**（commit `b019a38`，回归 `tests/ipc-license-gate-d1-d6.test.ts` 10 项）；**D2 ✅ / D3 ✅ / D4 ✅ / D5 ✅ 已实现**（回归 `tests/ipc-license-gate-d2-d5.test.ts` 21 项；撤销修复后 19 项中 11 项失败）。两套件撤销修复运行均 `exit 1`。
> **2026-10-19 复核补记**：D4 首轮只拦了读端/重启/探测，漏掉**动作端 `AUTOMATION.IMAP_POLL`**（同族门禁不对称，读端拦而动作端放行）——已补齐并补 2 项用例，IMAP 家族（§3.2 #29–#32）现全部收口。
> **仅 D7 仍待裁决**（能力扩张，需产品排期确认）：未裁决前不得改动 `isEmailType` 分支，也不得对其余 plain 通道批量追加门禁。

| ID | 议题 | 两个选项 | 本文档建议 |
|---|---|---|---|
| **D1** | `AUTOMATION.QUEUE_OUTREACH` 缺 `cloud_send` | (a) 补 `requireFeature('cloud_send')`；(b) 保持仅 Trial 拦截 | **(a)**。PRD §5.1.2 明确云端队列属 Premium；现口径与 `CLOUD-COLLABORATION-DELIVERY.md` 冲突，属**真实商业泄漏**，应作为独立修复提交并补负向测试 |
| **D2** | 云端审批通道归 Trial/Basic 还是 Premium | (a) `cloud_send`；(b) Trial/Basic 放开 | **(a)**。PRD §5.1.2 的"审批"指**本地**草稿审批；云端 `approvals` 记录是 `cloud_send` 的服务端二次门禁前置，脱离 Premium 无业务意义 |
| **D3** | `CONFIG.SET` 是否需 key 级策略 | (a) 整通道 public + key 白名单校验；(b) 门禁 | **(a)**。整通道门禁会锁死 Trial 的 ICP/密钥配置；Premium 专属 key（如 `cloud.*`）应由 key 级校验拦截，而非通道级 |
| **D4** | `AUTOMATION.IMAP_TEST_CONNECTION` / `ACCOUNT.GET_LIST` 的 Trial 行为 | (a) `local_autopilot`；(b) public | **(a)**。两者都暴露 Agent 域状态（PRD §六.0 禁 Trial 见指标/卡片） |
| **D5** | `AUTOPILOT.CLEAR_LEGACY` 是否 public | (a) `local_autopilot`；(b) public（维护操作） | **(a)**，与同族其它 AUTOPILOT 通道保持一致，避免"部分通道可被 Trial 触碰"的认知裂缝 |
| **D6** | `ACCOUNT.*` 代理键误用 `search_basic`（Trial 亦持有） | (a) 换成 `local_autopilot`（Basic+）；(b) 把 `search_basic` 从 `TRIAL_FEATURES` 移除 | **(a)**。`search_basic` 是 Trial 唯一搜索能力，选项 (b) 会直接废掉试点用户的核心体验；且正确语义是"账号绑定属 Agent 域（`local_autopilot`）"，与 `CONNECT/DISCONNECT/GET_LIST` 的真实用途一致 |
| **D7** | Basic 的 WhatsApp Web 被 `team_collaboration` 挡住 | (a) 改代码：Basic 放行**单会话** WhatsApp Web（非邮箱类型仅在多开时要求 `team_collaboration`）；(b) 改 PRD：WhatsApp Web 归 Premium | **(a)**，因 `kone-PRD §六.0` 与 `AGENTS.md` 均明示「Paid Basic 可使用低量本地 Email 与 WhatsApp Web 能力」；但属**能力扩张**，需产品排期确认后再动代码，不得随 D6 顺带修改 |

---

## 5. 迁移配方（D1–D5 已确认；D2–D5 已按本配方执行）

**逐通道替换（单一改动源）**

```ts
// before（plain，无授权）
registerIpc(IPC_CHANNELS.AGENT.GET_STATUS, agentGetStatusContract, handler)
registry-handler...

// after（Fail-Closed，授权与登记一次完成）
registerSecureFeatureIpc(
  ipcMain,
  IPC_CHANNELS.AGENT.GET_STATUS,
  store,
  licenseGuard,
  'local_autopilot',
  handler,
  '查看 Agent 触达状态',
)
```

**强制要求**

1. **先构造 `licenseGuard`**：`config-service.ts` / `provider-service.ts` / `autopilot-state-service.ts` / `cloudflare-service.ts` / `imap-reply-service.ts` / `main.ts` 目前**零** `licenseGuard` 引用（证据：全仓 `licenseGuard\.` 检索仅命中 `agent/automation/export/license/sandbox/search` 六处），迁移前需按既有模式 `createLicenseService(store)` 取用。
2. **不得双重门禁**。#17/#18/#27 已有 body 门禁：迁 wrapper 时**同步删除** body 内 `requireFeature`，避免两处 feature 键漂移（历史上三份能力集副本导致的真实泄漏即为同类根因）。
3. **`assertAllRegistered()` 门禁不受影响**：`registerSecure*` 内部 `registry.register(..., skipAttach: true)`，迁移后 `verify:ipc` 的"plain"计数下降、总 registry-known 数保持 61（20 + 新迁移）。
4. **文档回写**：迁移完成后必须同步 `ARCH-STANDARDS.md §3` 迁移注记的计数与清单（否则新门禁会报"现行文档旧版本残留"同类漂移）。
5. **不得触碰未激活路径**：§3.1 的 16 个通道**必须零改动**。

**验证清单（DoD）**

| 门 | 命令 | 期望 |
|---|---|---|
| 通道账本 | `npm run verify:ipc` | registry-known = 61；plain 计数下降且与文档一致 |
| 能力集单一源 | `npm run test:gateway` | 三处消费方仍引用 `license-features.ts` |
| 文档一致性 | `npm run verify:consistency` | EXIT 0 |
| 负向测试 | `node --test tests/ipc-registry-*-migration.test.ts` | Trial 直连每个新门禁通道 → `403 FEATURE_DENIED` |
| 激活不回归 | 手动/`ipc-startup-gate` | 未激活用户仍可 LOGIN / 配密钥 / 提交激活码 |

---

## 5.1 剩余未收口通道（2026-10-19 复核结论，**下阶段执行清单**）

D1–D6 收口后，§3.2 中仍有通道为 ⚠。复核完成了**渲染层调用方与回归风险实测**，得出两组结论 —— **第一组是本报告自身的订正**：

**（一）#19–#22 属「强制免门禁」，不得收口 —— §3.2 原「目标键」列判断有误。**

§3.2 原把 `AGENT.GET_STATUS` / `AGENT.SUPPRESS_LIST` / `SUPPRESS_ADD` / `SUPPRESS_REMOVE` 的目标键写成 `local_autopilot`，但仓库既有的**权威分级守护测试**（`tests/business-logic/agent-gate-classification.business.test.js` 的 `UNGUARDED` 显式清单）明确要求这四个通道**不得带任何 feature 门禁**：`GET_STATUS` 是线索级触达徽标（**线索是 Trial 的合法数据**）；`SUPPRESS_*` 是邮件合规（PROJECT-PRD §3.7.7，**退订登记/撤销任何套餐都必须可用**）。

> **实证（2026-10-19）**：曾按 §3.2 原判断实施「A1 批次」收口（4 通道补 `requireFeature`，并新增 `tests/ipc-license-gate-agent-a1.test.ts` 8 项，该套件单测自证 **8/8**；撤销修复后 4/8）。随后**全量 `npm run test:unit` 立即暴露 1 项失败** —— `agent-gate-classification` 的「免门禁通道必须真的没有门禁（**防过度约束**）」断言 `AGENT.GET_STATUS 不应有任何 feature 门禁`。已**全部回滚代码与用例**（工作区仅保留本报告订正），回滚后 `test:unit` 恢复全绿。
>
> **教训**：该守护测试的设计意图正是「照字面给所有读/写通道统一加门禁会制造**新的过度约束**」—— 它会阻断 Trial 的合法线索徽标与任意套餐的退订登记。IPC 授权分级的**唯一权威**是 `agent-gate-classification` 的 `GUARDED` / `UNGUARDED` 清单（双向断言 + 源码中新通道未定级即失败）；**文档表格不得与之冲突**，实施任何 AGENT 域门禁前必须先查该清单。
>
> 方法论补充：本次「单元自证通过但全量失败」说明 —— **新增授权用例 8/8 通过不构成收口成立的证据**，必须跑全量 `test:unit`，因为既有的反向守护测试（防过度约束）只存在于全量集合中。

**（二）真正待收口的通道（下阶段执行清单）**

| # | 通道 | 目标键 | 渲染层调用方（实测） | 收口前置 | 状态 / 判定 |
|---|---|---|---|---|---|
| 23–24、26 | `AUTOPILOT.GET_STATE / SET_STATE / SYNC_STATE` | `local_autopilot` | `GET_STATE` ← `search-engine.tsx:329` `void hydrateAutopilot()`（**Trial 首屏即调用**）；`SET_STATE` ← `:336-344` 托盘动作 `void pause()/start()/stopAndClear()`（**无 catch**）；`SYNC_STATE` ← `:353`（已 `.catch`） | 渲染层需先加套餐前置判断 / `.catch`；**且三者必须同批收口** | ⏳ 需先改渲染层 |
| 33–36 | `CLOUD.CLOUDFLARE_CONFIGURED / TEST_CONNECTION / DASHBOARD_STATS / POLL_OUTREACH_STATUS` | `cloud_send` | `system-settings.tsx:514` **无条件渲染** `CloudSettingsTab`，其 `:43` 用 `Promise.all` 聚合读取 | 设置页需先做「未解锁 → 渲染升级引导而非发起 IPC」，否则复现 **P0-2 同类缺陷**（任一 403 即整页降级） | ⏳ 需先改渲染层 |

> **为什么 AUTOPILOT 三通道必须同批收口**：`SYNC_STATE` 只是家族的**状态端**（渲染层→主进程上报托盘生命周期，载荷仅 5 值枚举），真正**控制**巡航的是 `SET_STATE`。若只拦状态端，Trial 仍可经托盘/搜索页调用 `SET_STATE` 驱动巡航，只是状态不再回显 —— 这正是 D4 复核中已修复的**「读端拦、动作端放行」同型不对称**。
>
> ⚠ **下阶段首批处理（潜在能力泄漏，非仅可见性）**：`AUTOPILOT.SET_STATE` 未收口可能不止是「Trial 看得到」的问题 —— 若渲染层未按套餐隐藏巡航控制，Trial 可能**实际驱动** Basic+ 的巡航能力。这使其严重度**高于**（一）中经复核判定的 4 个通道（那 4 个恰恰**必须保持免门禁**），需在下一批次**优先确认并连同 `GET_STATE` / `SYNC_STATE` 一并收口**。
>
> **为什么 33–36 不能只加门禁**：`CONFIG_GET_ALLOWED_NAMESPACES` 含 `cloud`（P0-2 修复），设置页依赖读取回显；`CloudSettingsTab` 对**所有套餐**无条件挂载，通道级 403 会让 Trial/Basic 用户的云端页整体降级。正确顺序是**先渲染层降级、后 IPC 门禁**。
>
> **缓解现状**：`cloud.*` 写端已被 D3 按 `cloud_send` 收口，Trial/Basic 无法写入云端配置，因此 #33–#36 的可读数据在其套餐下恒为空 —— 泄漏面被 D3 实质性削弱，故可按「先改渲染层」节奏排期，不构成 P0。

---

## 6. 风险与回滚

| 风险 | 级别 | 缓解 |
|---|---|---|
| 误门禁 §3.1 → 未激活用户无法激活（P0 回归） | 高 | §3.1 清单冻结；DoD 增加"激活不回归"项；PR 描述逐条勾对 |
| Basic 单邮箱通道被 `team_collaboration` 误伤 | 中 | #39 保留 body 例外逻辑，用 `featureName` 函数式表达 |
| 双重门禁导致 feature 键漂移 | 中 | 迁移时同 commit 删除 body 门禁；`test:gateway` 兜底 |
| 计数文档漂移 | 低 | 同 commit 回写 `ARCH-STANDARDS §3` |
| 回滚 | — | 按注册文件粒度 revert（每服务一个 commit），无需数据迁移 |

---

## 7. 审计口径

- 本文所有金额/计数/门禁均来自**代码与命令实测**，不引用文档自述。
- "现状门禁"列的 ✅ 仅表示**已存在门禁**，不代表键选取正确；⚠ 表示**未检出**，不排除间接路径。
- 本文为**决策文档**，不替代 `kone-PRD.md`（产品真值）、`ARCH-STANDARDS.md`（架构真值）、`src/shared/license-features.ts`（能力集真值）。
- 与本文并列的近期治理产出：`docs/archive/plans/system-consolidation-2026-10-19.md`（全项目系统梳理）。
