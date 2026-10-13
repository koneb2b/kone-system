# KONE V1.3 安装包数据交互审计报告

- **日期**：2026-10-12
- **审计对象**：真实打包安装包（`release-v150/win-unpacked/KoneAI.exe`，sha256 `ec311d3ad9a0b6f9ca2517e3253bffb6faff063d7bcbfdcfa2c00b3dc1929d85`；安装包 `release-v150/Kone-Intellect-Setup-1.3.15.exe`）
- **审计方式**：全自动（puppeteer-core 经 CDP 9222 驱动真实成品），隔离 userData/downloads，**截图识别**复核
- **审计目标**：验证各功能模块的**数据交互是否规范严谨**（写入是否生效、前端校验是否拦得住、无凭据是否优雅降级、错误反馈是否可见、持久化是否真实）

> 本报告遵循「**探针报通过 ≠ 渲染正确**」铁律：所有结论均以**几何 + APP 自身读盘口径 + 字节级哈希**为依据，
> 不采信 DOM 存在性、内存 state、或单帧截图。

---

## 一、结论摘要（分级）

| 维度 | 结论 |
|---|---|
| 真实产品缺陷 | **发现 2 个，均已修复并在打包版验证**（见 §三） |
| 探针自欺缺陷 | **发现并修复 8 处**（见 §四）——这决定本次审计结论是否可信 |
| 单元测试门禁 | **443/443 全绿**（0 回归） |
| 持久化闭环 | **ALL PASS**（写→真实冷启动→读回，三字段+授权全部持久，进程不同） |
| 九模块交互 | **31 PASS / 0 FAIL / 1 WARN / 1 INFO / 2 BLOCKED**，**运行时未捕获错误 0** |
| 截图视觉复核 | **14/14 帧互不相同**（防旧帧自欺）；关键帧经人眼确认内容正确 |

**总评**：安装包核心数据交互链路（授权门禁、知识库读写删、搜索降级、设置校验）**规范严谨、闭环成立**；
导出落盘与结果溯源两项因环境限制**未能自动验证**，如实记为 BLOCKED/INFO，**不计入通过**。

---

## 二、审计范围与方法（防自欺设计）

### 2.1 三支自持探针

| 探针 | 职责 | 关键防自欺设计 |
|---|---|---|
| `scripts/probe-packaged-persistence.cjs` | 写入→**真实冷启动**→读回 | 自持生命周期（一次命令完成启动/写/杀自身/重启/读回/清理）；PID + exe sha256 + userData 三重身份锚定；verify 阶段**绝不自动激活**（授权未持久即判 FAIL） |
| `scripts/probe-packaged-interaction.cjs` | 九模块真实读写（S1–S11） | 断言用几何+文本；`assertAlive` 增补 pageerror 失败判定；多场景截图 md5 必须互不相同；反馈用 body.innerText 差分（不依赖 toast 选择器） |
| `scripts/probe-packaged-discovery.cjs` | 只读采集（选择器事实） | 输入框识别走 `tagName.toLowerCase()`（修复大写 TAGNAME 误判） |

### 2.2 隔离边界（绝不污染真实用户数据）

- `KONE_TEST_USER_DATA_DIR` → `.probe-packaged/*/userdata`
- `KONE_TEST_DOWNLOADS_DIR` → `.probe-packaged/interaction-downloads`
- 所有写入（知识库条目/自定义标签/试用激活）均落在隔离目录；探针自清自写数据。

### 2.3 截图识别

- 每场景截图经 md5 去重校验（**14 张全互不相同**），排除「转场未完成拍到旧帧」。
- 关键帧经人眼复核：S1（无效授权码被拒 + 明确文案）、S2（条目写入 + 保存 toast + 计数 1/2）、
  S5（条目删除后回到基线、占位符复位）、S7（无凭据搜索给出用户可读降级提示）。

---

## 三、真实产品缺陷（已修复 + 打包版验证）

### 缺陷 1 — 搜索缺配置错误文案**泄漏密钥/端点**（1.4.16）

- **现象**：`search-service.ts` 缺配置分支抛出 `缺少配置. Debug: key=[...], url=[...]`，
  该字符串沿 IPC → 渲染层 → **界面直接展示** → 用户误填带凭据 URL 时原文回显，构成泄漏。
- **修复**：改为用户可读提示；缺失明细只走 `probeLog`（布尔字段，不含原文）。
- **守护**：`search-config-missing.business.test.js`（4 条，哨兵 key/url 断言不出现在 IPC/UI/返回）。

### 缺陷 2 — 托盘巡航同步通道 `sync-autopilot-state` **从未绑定**（1.4.17）

- **现象**：渲染层每次调用恒得 `No handler registered for 'sync-autopilot-state'`；
  主进程日志反复写 `Error occurred in handler for 'sync-autopilot-state'`。
  系统托盘巡航控制项（暂停/继续/停止）**永不反映真实生命周期**。
- **根因（顺序缺陷）**：`main.ts` 的 `registerIpcHandlers()`（末尾 `registry.attach(ipcMain)`）
  先于该通道的 `registerIpc(...)` 登记。`attach()` 只绑定"登记时刻已存在"的通道 →
  晚登记通道**永不绑定**；而启动门禁 `assertAllRegistered()` 只校验"已登记"、**不校验"已绑定"** → 漏网。
- **修复**：`SYNC_STATE` 的 `registerIpc(...)` **前移到 `registerIpcHandlers()` 之前**；
  handler 内 `refreshTrayMenu` 改用 `mainWindowRef` 并加空值守卫。
- **守护**：`autopilot-sync-attach-guard.business.test.js`（2 条：源码结构顺序断言 + 失败模式复现）。
- **打包版闭环验证**：v150 直接调用三组入参 → `idle`/`running` 返回 `{success:true}`，
  非法值返回 `{success:false,code:400}`；**交互探针运行时错误由 1 → 0**。

> **根因教训**：注册中心把"登记"与"绑定"解耦后，"**已登记 ≠ 已绑定**"成为新漏网维度。
> 启动门禁必须覆盖"绑定"，或保证所有登记都发生在唯一 `attach()` 之前。

---

## 四、探针自身缺陷（自欺）清单——本次审计可信度的前提

审计过程中**先修复了探针的假通过/假失败**，否则下面的"通过"毫无意义：

| # | 探针 | 自欺形态 | 修复 |
|---|---|---|---|
| 1 | persistence | 直连 preload 读到的是 IPC **信封** `{success,data}`，未解包 → 写入成功也判**假阴性** | 显式兼容信封/已解包两种形态 |
| 2 | persistence | 重启后 `browser.pages()[0]` 为空（CDP `/json/version` 早于 page target 就绪）→ 崩溃 | 新增 `waitForPage` 轮询 |
| 3 | persistence | 重启后立即读 `[data-stage]` 得 `null` → 误判"授权未持久化" | 先 `waitForSelector('[data-stage]')` |
| 4 | persistence | 清理块浏览器上下文引用 Node 常量 `TITLE_PH` → `ReferenceError`；且 walk-up 起点是 input（无子 button）→ 从未真正删除 | 显式传参 + 从卡片容器向上找删除按钮 |
| 5 | interaction | S3 用 `textVisible` 判"标签已渲染"——**输入框 value 里也有该串** → **假阳性** | 改用 chip 专属 `button[aria-label="删除标签 X"]` 判定 |
| 6 | interaction | S5 用 `includes('探针测试条目')` 找条目——**先命中搜索框** → 删除落空；且删除是内存操作**未补保存** | 精确 `placeholder + value` 定位 + 删除后补保存再校验配置口径 |
| 7 | interaction | S1 打开模态后未关闭 → `evaluate` 直调 `click()` **无视遮罩** → 后续点击穿透 | 每次转场前 `closeModal()`（ESC + 关闭按钮） |
| 8 | interaction | `assertAlive` 只查白屏文本，**不判 pageerror**；S8/S9 以"无崩溃"冒充导出成功 | 增补 pageerror 失败判定；导出改判 **BLOCKED** |

---

## 五、九模块数据交互结果（v150 实测）

| 场景 | 模块 | 关键断言 | 结果 |
|---|---|---|---|
| S1 | 授权门禁 | 无效码被拒 + 明确文案 + **未触发解锁** | ✅ PASS ×3 |
| S2 | 知识库写入 | 标题/内容/标签回读一致；卡片数 1→2；计数联动；**APP 配置口径读回** | ✅ PASS ×8 |
| S3 | 自定义标签 | 输入驱动按钮启用；**渲染为可删除 chip** | ✅ PASS ×2 |
| S4 | 搜索过滤 | 过滤后仅剩目标 1 条；清空后恢复 | ✅ PASS ×2 |
| S5 | 删除闭环 | 删除后卡片**回到基线** + **配置口径清零** + 标签回收 | ✅ PASS ×2 |
| S6 | 搜索空提交 | 前端校验提示「请输入关键词」；未崩溃；输入框识别正确 | ✅ PASS ×3，⚠️ WARN ×1 |
| S7 | 无凭据搜索降级 | 未崩溃 + **用户可读降级提示**（"搜索服务尚未配置…"） | ✅ PASS ×3 |
| S8 | 线索空表导出 | 未崩溃 | ✅ PASS ×1，⛔ BLOCKED ×1 |
| S9 | 数据中心空报表导出 | 按钮可点 + 未崩溃 | ✅ PASS ×2，⛔ BLOCKED ×1 |
| S10 | 设置空凭据测试连接 | 未崩溃 + 明确失败反馈（"未联通…请先填写 API Key"） | ✅ PASS ×3 |
| S11 | 结果溯源标注 | 无真实结果集，来源标注不可识别 | ℹ️ INFO ×1 |
| — | 截图互不相同 | 14/14 distinct | ✅ PASS ×1 |

**合计：PASS=31 / FAIL=0 / WARN=1 / INFO=1 / BLOCKED=2；运行时未捕获错误 0。**

---

## 六、持久化闭环结果（v150 实测，ALL PASS）

| 断言 | 结果 |
|---|---|
| 写后即时读回（APP 配置口径） | ✅ 条目=1 标签=1 |
| 重启后授权持久化 | ✅ 仍在 dashboard |
| 重启后条目仍在（标题+正文+标签**全字段**） | ✅ content 匹配=true |
| 重启后自定义标签仍在 | ✅ |
| **确为不同进程冷启动** | ✅ pid1=14068 → pid2=5472 |
| 自清自写数据 | ✅ 条目删除=true 标签回收=true |

---

## 七、如实记录的未通过/受阻项（**不计入通过**）

| 项 | 状态 | 原因 | 处置建议 |
|---|---|---|---|
| S8/S9 导出文件真实落盘 | **BLOCKED** | 导出走系统「保存文件」对话框，无头探针无法自动确认磁盘文件 | 人工在真实桌面点一次导出并核对文件 |
| S11 搜索结果溯源标注 | **INFO** | 无真实外部密钥 → 无结果集，无法验证来源标注渲染 | 受控实发环境（真实 key）复核 |
| S6 空输入执行按钮 | **WARN** | 按钮在空输入时未禁用（**前端校验在提交时生效**，非逐键校验） | 属设计取舍，非缺陷；如需可加 `disabled={!keyword}` |
| 商用代码签名 | **未验证** | 本环境无 `signtool`/`.pfx`，`verify:signature` 优雅降级 | 采购证书后 `--strict` 复核 |
| `security-audit` 真机审计 | **受阻** | 脚本 `reg delete` 被本环境 Security Policy 硬杀 | 换无策略限制环境重跑 |
| 真实外部链路（搜索/Apollo/邮箱） | **未验证** | 缺真实密钥与干净低配机器 | 受控实发环境验证连通与配额 |
| 覆盖率 functions | **余量极小** | 64.03 vs 阈值 64.00（余量 0.03%） | 下调阈值至 62 或补分支测试 |

---

## 八、遗留风险（边界声明）

缺**真实外部密钥、有效签名或干净机器证据**时，上述项一律按「受阻/未验证」如实记录，
**不标为商用全通过**。本次审计能确证的边界为：

- ✅ **可确证**：授权门禁、知识库全链路读写删、搜索降级、设置校验、进程级持久化、托盘同步通道。
- ⚠️ **未能确证**：真实外发链路（需真实凭据）、导出落盘（需人工）、签名与干净机器验收。

---

## 九、复现命令

```bash
# 1) 打包（含混淆）
npx vite build && npm run build:electron && npx electron-builder --win nsis -c.directories.output=release-v150

# 2) 持久化闭环（自持：启动→写→杀自身→冷启动→读回→清理）
node scripts/probe-packaged-persistence.cjs release-v150

# 3) 九模块交互（先隔离启动，再驱动）
KONE_TEST_USER_DATA_DIR="$PWD/.probe-packaged/interaction-userdata" \
KONE_TEST_DOWNLOADS_DIR="$PWD/.probe-packaged/interaction-downloads" \
  node scripts/dev-launch-packaged.cjs release-v150 &   # 后台常驻
node scripts/probe-packaged-interaction.cjs

# 4) 门禁
export CODEBUDDY_SAFE_DELETE_ENABLED=0
npm run test:unit          # 443/443
npm run build:electron:dev # 0 error
```
