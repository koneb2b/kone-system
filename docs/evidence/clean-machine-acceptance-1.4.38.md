# 干净机器验收执行单 — Kone `1.4.38`（NO-GO ① 唯一剩余门禁）

> **性质**：本文件是 `docs/archive/snapshots/KONE-V1.3-干净机器验收手册-2026-09-25.md` §2 的**可填写执行版**，已对齐当前版本 `1.4.38`。
> 手册是**历史时点快照**（保留原义）；本执行单是**每次验收一份的待填证据**。
> **执行前提**：自动化链路已全绿（见 §0）。本单只覆盖**自动化测不到**的部分 —— 真实安装到陌生环境 + 真人走完整业务闭环。
> **判定**：S1–S11 **全部 ☑ 通过** → **PASS（本地能力版可交付）**；任一 ☐ 失败 → 记录「步骤 + 现象 + 截图 + 日志」并反馈。
> **参考 SSOT**：`docs/release-gate.md`（工程质量门禁）、`CLOUD-COLLABORATION-DELIVERY.md §0`（产品级发布判定）。

---

## 待验产物（唯一被验收对象）

| 项 | 值 |
|---|---|
| 安装包 | `Kone-Intellect-Setup-1.4.38.exe` |
| 字节数 | `89962234`（≈ 85.8 MB） |
| **SHA-256** | `6EF8459AA2F70CB5812E852D0426F0C7D20635EDDFAF0BEE2A55538CD7741D4B` |
| 对应代码版本 | `package.json` = `1.4.38`；HEAD `f533ed34abe772f0e86122d43b7b73b634041833` |
| 签名状态 | **未签名**（代码签名证书 / Windows SDK 未接入）→ SmartScreen「未知发布者」属**预期** |

> ⚠️ **先校核再验收**：若你手上安装包的 SHA-256 **不等于**上表，请**停止验收并反馈** ——
> 说明该包与本次已验证代码不一致，验收结论将无效。
>
> 校核命令（PowerShell，与安装包同目录）：
> ```powershell
> Get-FileHash .\Kone-Intellect-Setup-1.4.38.exe -Algorithm SHA256
> ```

### 交付工具包（离线分发单元）

> 安装包随 `kone-acceptance-kit-1.4.38.zip` 离线分发；包内为本执行单、安装包、`.sha256`、`START-HERE.bat`、`clean-machine-collect.ps1` 共 **5** 个根条目（无目录嵌套）。

| 项 | 值 |
|---|---|
| 工具包 | `kone-acceptance-kit-1.4.38.zip` |
| 字节数 | `89980304`（≈ 85.8 MB） |
| **SHA-256** | `7BD5EA43941002FFA0C1170A70134BD9B05C2622794D555AC329127F0BAEB7AE` |
| 根条目数 | `5` |
| 内含执行单 | 与本文件**同版本**（含 §7.1 六场景矩阵与 §7.2 五状态验证）；本指纹小节为打包后追加，故包内副本不含此小节 |

---

## 0. 已通过（自动化，无需重复执行）

| 项 | 结果 |
|---|---|
| 单元测试 | **632 / 632** 通过（1.4.38 打包时基线；此后新增 5 项熔断回归，当前以 `npm run test:unit` 实测为准） |
| 类型检查 / lint | 0 error / 0 error |
| 文档与契约一致性 | `verify:docs` EXIT 0（文档链共 10 份、`ACTIVE_DOCS` 15 份、交叉引用 226 项、版本口径 `1.4.38` 六处对齐；文档链表以 `scripts/verify-doc-consistency.cjs` 的 `ACTIVE_DOCS` 为准） |
| 发布门禁机械子集 | `verify:release-gate` HARD 全绿 |
| 打包态启动冒烟 | `booted` / `activationScreenVisible` / `preloadBridgeVisible` 全 `true`（`dashboardNavVisible=false` 属未激活态**合法分支**） |
| 云端链路安全门禁 | `verify:cloud-safety` 通过 |

> 以上均**已在 1.4.38 上实测**，本单不重复。

---

## 1. 准备物（缺一不可）

| # | 物品 | 说明 |
|---|---|---|
| 1 | **安装包** | `Kone-Intellect-Setup-1.4.38.exe`（SHA-256 见上表） |
| 2 | **干净 Windows 机器** | 从未装过本产品；建议 4G–8G 内存办公机（性能红线场景） |
| 3 | **授权码** 或 **7 天试用** | 试用可在激活页一键开启（每台设备仅一次） |
| 4 | **LLM 密钥 + Base URL** | 如 `https://api.openai.com/v1` 或中转/私有地址（**通常以 `/v1` 结尾**） |
| 5 | **搜索提供商密钥** | SerpApi Key（Google Maps / Organic 均用它） |
| 6 | **测试关键词 + 目标国家** | 例：产品词「golf cart battery」+ 国家「Germany」（**用真实业务词才能验证精准度**） |
| 7 | **高级版授权码（仅 S11 反向验证需要）** | 用于验证 Premium 云端设置表单**可**出现；无则 S11 只跑正向（试用版）分支 |

### 1.1 需要拷到目标机器的文件（U 盘 / 内网共享）

| 文件 | 必带 | 用途 |
|---|---|---|
| `Kone-Intellect-Setup-1.4.38.exe` | ✅ | 被验收对象 |
| `Kone-Intellect-Setup-1.4.38.exe.sha256` | ✅ | 指纹校核文件（与 exe 放同一目录） |
| `START-HERE.bat` | ✅ | **双击即运行**（无需敲命令 / 无需管理员） |
| `clean-machine-collect.ps1` | ✅ | 采集器本体（由 `START-HERE.bat` 调用，勿单独挪走） |
| `docs/evidence/clean-machine-acceptance-1.4.38.md` | ✅ | 本执行单（打印或本地打开） |

> ⚠️ `release/` 被 `.gitignore` 排除（既定策略），**安装包与 `.sha256` 不在 GitHub 仓库内**，必须随 exe 走离线渠道分发。

### 1.2 目标机开机第一件事：双击 `START-HERE.bat`（约 10 秒）

**不敲命令、不要管理员权限。**

在**安装之前**双击一次（记录"干净基线"），完成 S11 后再双击一次（记录"已安装事实"）。

| 窗口显示的结论 | 含义 | 该做什么 |
|---|---|---|
| `RESULT: OK` | 安装包指纹一致 | 继续下一步 |
| `RESULT: FINGERPRINT MISMATCH` | 安装包在传输中被改动 | **立即停止**，截图发回 |
| `RESULT: COLLECTOR ERROR` | 采集器异常 | 窗口截图发回 |

- 每次双击后，同目录会多出 `kone-evidence-1.4.38-<时间戳>` 文件夹，内含 `machine-info.json` / `machine-info.txt` / `logs-tail.txt`。
- **把该文件夹整个发回**。⚠️ `logs-tail.txt` 可能含 API Key / 邮箱，**发回前删除该文件或先脱敏**。
- 采集器**只读**：不写注册表、不动应用数据、不启动应用。

<details>
<summary>双击无反应时的备用方案（命令行）</summary>

```powershell
powershell -ExecutionPolicy Bypass -File .\clean-machine-collect.ps1 `
  -InstallerPath .\Kone-Intellect-Setup-1.4.38.exe -IncludeLogs
```

退出码：`0` 一致 / `2` 指纹不一致 / `9` 采集器异常。
</details>

---

## 2. 验收步骤（逐步判定）

> 每步请截图存档，命名见 §6。**不要跳过 S11** —— 它是本次 `1.4.38` 收口的唯一行为差异。

### S1 安装
- **操作**：双击安装包，按向导完成安装。
- **预期现象**：安装完成；桌面 / 开始菜单出现快捷方式；控制面板「应用和功能」出现 `Kone` 卸载项。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S1-install.png`（快捷方式 + 控制面板卸载项）

### S2 首次启动（含预期的安全提示）
- **操作**：启动应用。
- **预期现象**：
  - 若出现 **Windows SmartScreen「未知发布者」** → **这是预期**（未签名）；点「更多信息 → 仍要运行」；
  - 应用启动，显示**激活页**（非白屏、非崩溃）。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S2-first-launch.png`

### S3 激活
- **操作**：输入授权码激活；或点「开启 7 天试用」。
- **预期现象**：激活成功，进入主界面（**侧边栏可见**）。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S3-activated.png`

### S4 配置密钥 + 测试连接
- **操作**：**系统设置 → 基础配置** → 填入 LLM 与搜索提供商密钥 + Base URL → 点**「测试连接」**。
- **预期现象**：各提供商显示**连接成功**（**试用版同样应能测试成功** —— 这是既有修复项）。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S4-connection-ok.png`

### S5 描绘 ICP 画像
- **操作**：**系统设置 → ICP 画像** → 填写：目标产品、买家角色、核心优势、**负向 ICP**。
- **预期现象**：保存成功；后续评分体现该画像。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S5-icp-saved.png`

### S6 发起智能搜索（核心：精准获客）
- **操作**：**智能获客** → 输入关键词 / 国家 → 选择数据源 → 点搜索。
- **预期现象（按顺序观察）**：
  1. 出现**阶段进度**（如 `anysearch` / `fetching` / `normalizing` / `prefiltering` / `scoring` / `enriching`）；
  2. **先出骨架列表**（未评分态），随后**逐条流式回填** AI 评分与富化（渐进式发射）；
  3. 结果按**相关度降序**呈现（**高分在前**）。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S6-search-streaming.png`（进度阶段）、`S6-search-sorted.png`（降序结果）

### S7 评分可信度（核心：精准获客）
- **操作**：查看结果卡 / 线索表的评分与徽标。
- **预期现象**：
  - 每条评分旁有 **「AI」或「规则」** 徽标（能区分"AI 评分"与"确定性预筛分"）；
  - 可见 **匹配理由（为何匹配）** 与 **风险提示（为何存疑）**；
  - 分数分布**合理**（不出现大量无差别 100 分）。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S7-score-badges.png`

### S8 保存与导出（核心：客户数据价值）
- **操作**：一键保存高分线索 → 到**线索管理**筛选 → 导出 CSV；再试一次 **PDF 白皮书导出**。
- **预期现象**：
  - 线索保存成功，状态可切换（待跟进 → 跟进中 → 已回复 → 已归档）；
  - CSV 导出成功（**试用版限 100 行**）；
  - **PDF 导出成功**（**试用版限 3 次**，超限提示升级 —— 宪法 PLG 钩子）。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S8-export-csv.png`、`S8-export-pdf.png`

### S9 触达（核心：差异化触达）
- **操作**：在线索上**生成 AI 开发信** → 到 **AI 销售团队**面板 → **必须由你点「开始触达」**（人在回路）。
- **预期现象**：
  - 开发信生成：**试用版应提示不可用**（AI 分析与开发信为付费能力）；
  - 面板**只暂存**待触达队列，**不自动发送**；
  - **试用版访问智能体面板应显示升级引导**（不渲染运行指标、不出现智能体卡片）；
  - 未配置渠道的进度显示 **0**、状态「未连接 / 待配置」（**不出现假数据**）。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S9-agents-trial-upgrade.png`、`S9-agents-zero-progress.png`

### S10 数据中心
- **操作**：进入**数据中心**。
- **预期现象**：
  - 顶部可见 **「需要你处理」**卡（待人工确认 / 待接管回复 / 高潜未触达）；
  - 「数据罗盘转化诊断」内可见 **「评分精度验证」**（分数段 × 回复率；样本不足时会提示"样本不足"）。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S10-data-center.png`

### S11 【`1.4.38` 新增·必测】云端设置面板授权分级（本次收口的唯一行为差异）

> **为什么必测**：本次将 `CLOUD.CLOUDFLARE_*` 四条 IPC 按 `cloud_send` 收口，并把设置页云端面板
> 改为**条件挂载**。若只改了后端而渲染层未条件化，非高级版会停在"未配置"空态（误导性降级）。
> 本步就是验证**这个组合**在真实安装包上成立。

**S11-a 正向（试用版 / 基础版）**
- **操作**：以**试用版或基础版**激活 → 进入 **系统设置 → 云端协同** 面板。
- **预期现象**：
  - 渲染**升级引导面板**（含「高级版能力」类徽标 + 升级按钮），可正常点击唤起升级弹窗；
  - **不出现** Supabase URL / Key 等云端配置输入框；
  - **不出现**「测试连接」按钮；
  - ⚠️ **不得**停留在"未配置 / 空白 / 报错"空态 —— 那是降级失败的表现。
- **判定**：☐ 通过　☐ 失败（现象：__________）
- 📸 截图位：`S11a-cloud-basic-upgrade.png`

**S11-b 反向（高级版，需高级版授权码）**
- **操作**：以**高级版**激活 → 进入同一面板 → 填入云端后端配置 → 点「测试连接」。
- **预期现象**：
  - 面板显示**真实配置表单**（与 11-a 的升级引导形成对照）；
  - 配置正确时「测试连接」**成功**；
  - **未配置/配置错误**时应给出**明确错误信息**，**不得静默报"成功"**。
- **判定**：☐ 通过　☐ 失败　☐ 无高级版授权码（跳过，记录为未覆盖）
- 📸 截图位：`S11b-cloud-premium-form.png`、`S11b-cloud-test-result.png`

**S11-c 可选·进阶（接口级独立验证）**
- **操作**：在试用版下按 `F12` 打开 DevTools → Console 执行
  `window.electronAPI.cloudflareConfigured()`（若 preload 暴露名不同，以实际为准）。
- **预期现象**：调用以 **`FEATURE_DENIED`（HTTP 语义 403）** 形式的**异常**失败，
  **不得**返回 `true` / 正常配置对象。
- **判定**：☐ 通过　☐ 失败　☐ 未执行（非技术人员可跳过）
- 备注：此步为**独立于 UI 的**边界验证，能识破"只藏了 UI 但接口仍放行"的假收口。

---

## 3. 异常处置（常见现象与判读）

| 现象 | 判读 |
|---|---|
| SmartScreen「未知发布者」 | **预期**（未签名）；点「仍要运行」 |
| 「测试连接」失败（密钥类） | 检查 Base URL 是否**以 `/v1` 结尾**、密钥是否正确、网络是否可达 |
| 搜索返回 0 条 | 检查搜索密钥与配额；放宽关键词 / 国家；确认未被"只看高相关"过滤 |
| 评分全是「规则」徽标 | LLM 未配置或不可达 → 此时为**确定性预筛分**（诚实标注，非故障） |
| 邮件序列停在「需人工确认」 | **预期**：IMAP 未配置时**不盲推**，等人工确认（设计如此） |
| 试用版看不到智能体卡片 | **预期**：试用版仅展示升级引导 |
| 客户数据未上云 | **预期**：本地优先设计；云端需显式配置后端并走 Gold Filter |
| **基础版看到云端配置输入框/「测试连接」** | ❌ **失败** —— 授权收口未生效，请反馈 |
| **云端面板停在"未配置"空态或报错** | ❌ **失败** —— 渲染层条件化未生效（本次修复的目标缺陷） |

---

## 4. 留证记录表（建议截图存档）

**验收人**：__________　**日期**：__________　**机器 / OS 版本**：__________
**安装包 SHA-256 已校核**：☐ 一致　☐ 不一致（停止）

| 步骤 | 结果 | 证据（截图 / 日志） | 备注 |
|---|---|---|---|
| S1 安装 | ☐P ☐F | | |
| S2 首次启动 | ☐P ☐F | | |
| S3 激活 | ☐P ☐F | | |
| S4 测试连接 | ☐P ☐F | | |
| S5 ICP 画像 | ☐P ☐F | | |
| S6 搜索（渐进式 + 降序） | ☐P ☐F | | |
| S7 评分可信度 | ☐P ☐F | | |
| S8 导出（CSV / PDF） | ☐P ☐F | | |
| S9 触达（人在回路） | ☐P ☐F | | |
| S10 数据中心 | ☐P ☐F | | |
| **S11 云端授权分级（新增）** | ☐P ☐F | | 11-b 若无高级版码则记「未覆盖」 |

**日志位置**（排查用）：`%APPDATA%\kone-system\logs\kone-YYYYMMDD.log`

---

## 5. 判定标准

> **PASS（可交付）**：S1–S11 **全部通过**（S11-b 无高级版授权码时可标"未覆盖"，不阻断 PASS，但须在备注注明）。
> **FAIL**：任一步失败 → **记录「步骤 + 现象 + 截图 + 日志」**并反馈，立即定位修复。

---

## 6. 证据归档

- 建议目录：`docs/evidence/clean-machine-acceptance-1.4.38/`（人工验收时创建，存放截图证据）
- 命名约定：`S<编号>-<短名>.png`（如 `S11a-cloud-basic-upgrade.png`）
- 一并归档：本文件（填好后）+ `%APPDATA%\kone-system\logs\` 下当日日志
- 归档后请在本节记录最终结论：**PASS / FAIL** + 日期：__________

---

## 7. 本单通过后仍需完成（**不属本单范围**）

| 门禁 | 状态 | 说明 / 依赖 |
|---|---|---|
| NO-GO ① 应用层首次运行 | ✅ **已自动化覆盖（2026-10-23）** | 「应用层首次运行」已由 `npm run test:first-run`（`scripts/packaged-first-run.cjs`，全新 `--user-data-dir`）自动化覆盖（本机可复现）；NO-GO ① 的剩余范围**收窄为安装层与环境层**（NSIS 安装行为、目标机运行库依赖），仍为发布阻断项 |
| NO-GO ② 打包冒烟 | ✅ **已闭环（2026-10-20）** | 打包态冒烟以 `scripts/packaged-smoke.cjs` 显式规则通过（见 §0 与 `tests/packaged-smoke-report.json`）；原 `app.asar` 占用属本机构建环境问题 |
| NO-GO ③ 审批门禁部署开启留证 | ⏳ 待办 | 云端环境设 `APPROVAL_GATE_ENABLED=true` 并留证（生产当前 `false`）；需云端环境 + 产品决策 |
| NO-GO ④ 小流量实发 | ⏳ 待办 | 真实 Resend / IMAP / 域名 DNS 打通小批量投递；需外部账号与域名资源 |
| 代码签名（**非 NO-GO**） | 🔸 已推迟 | 经 owner 决策（2026-10-20）推迟为**交付后加固项**，**不阻断内部分发**；公开发行前建议补齐（需采购证书 + Windows SDK） |

> **安装层自动化补充（2026-10-23）**：「安装层（静默安装 / 快捷方式 / 卸载登记项 / 卸载清理）」已由
> `scripts/install-layer-acceptance.cjs` 自动化覆盖（本机可复现，A1–A5 PASS；静默安装至临时目录 → 静默卸载 → `residue: []`）。
> 据此，**NO-GO ① 的剩余范围收敛为：环境层**（目标机缺运行库 / 纯净机）**+ 安装层残余**（非提升上下文；默认路径 / 升级覆盖 / 中文路径已由 §7.1 的 6 场景矩阵覆盖）。
> ① 仍是唯一真实阻断，签名仍为交付后加固项（判定不变）。

> ③④ 属**环境 / 资源项**（非代码缺陷），但**仍是 `CLOUD-COLLABORATION-DELIVERY.md §0` 与 `docs/release-gate.md §5` 定义的 NO-GO 阻断项**，须闭环后方可转 GO；
> 本单（S1–S11）仅覆盖 NO-GO ① 的环境层部分，**不构成 ③④ 的替代验收**。

### 7.1 安装层 6 场景自动化验收（2026-10-25）

> 执行入口：`node scripts/install-layer-acceptance.cjs --scenario=<场景名>`（每个场景单独执行，报告写入 `tests/install-layer-report-<场景名>.json`；`custom-temp` 额外产出可入库的规范证据 `tests/install-layer-report.json`）。
> 本轮 6 场景均为 **PASS**：安装 / 卸载退出码 `0`、卸载残留 `residue: []`、卸载登记项 `entryCount: 1`。

| 场景 | 结论 | 关键实测事实 |
|---|---|---|
| `custom-temp` | ✅ PASS | `/D` 指向临时目录，A1–A5 全过；该场景产出规范报告 `tests/install-layer-report.json` |
| `default-path` | ✅ PASS | 不传 `/D` 时实际落盘 `%LOCALAPPDATA%\Programs\KoneAI`，与推导值一致（`matchedExpectation: true`） |
| `non-ascii` | ✅ PASS | 中文路径 `...\Temp\kone-安装层-中文-...` 安装 / 卸载正常，注册表 `InstallLocation` 与中文目录一致 |
| `reinstall` | ✅ PASS | 同版本二次静默安装退出码 `0`，第二遍 A1–A4 全过；**这是同版本重装代理，不是升级** |
| `upgrade` | ✅ PASS | 1.4.32（`release-v151/Kone-Intellect-Setup-1.4.32.exe`，**成文时实测产物**，89,943,061 B，SHA-256 `ABEF3A8605E75BDC343CD4EE00D56D2CA5C62E4E46E13B3724105EAC41F9198C`）→ 1.4.38 原地升级覆盖 |
| `legacy-migration` | ✅ PASS | **`migration: REUSED`**：旧式命名目录的 1.4.32 → 1.4.38（不传 `/D`）复用注册表 `InstallLocation` 原地升级，全程仅 1 个卸载项，单次卸载清理干净，**未产生第二次安装** |

**默认安装目录勘误**：真实默认目录是 `%LOCALAPPDATA%\Programs\KoneAI`，**不是** `%LOCALAPPDATA%\Programs\kone-system`。
推导链：`package.json#build.executableName = "KoneAI"` + `nsis.oneClick=false` + 无 `perMachine` → `NsisTarget.js:165` 取 `APP_FILENAME = productFilename` → `appInfo.js:56-57` 对 `executableName` 做 sanitize → `multiUser.nsh:40` 得 `$INSTDIR = "$0\${APP_FILENAME}"`。
git 考古结论：208 个提交、单一根提交 `4b77729`（2026-04-24，版本 1.2.0）；`executableName` / `productName` / `appId` / `oneClick` **在全部可考历史中从未变更**，根提交即为 `KoneAI` / `Kone AI` / `ai.kone.desktop` / `false`；归档的 1.3.0 与 1.3.15 安装包亦从相同配置构建且内含 `KoneAI.exe`。因此 **1.3.x / 1.4.x 用户可原地升级**；唯一无法考证的是 2026-04-24 之前的原型安装（旧版原型曾使用 `kone-system` 目录）。

**旧式目录迁移实验（`legacy-migration`）**：先以 1.4.32 安装到旧式命名目录（`...\Temp\kone-system`），再运行 1.4.38 且**不传 `/D`**；安装器读取注册表 `InstallLocation` 指向的旧目录并原地覆盖为 1.4.38，升级前后卸载登记项均为 **1**（`entryCountBeforeUpgrade: 1` → `entryCountAfter: 1`），最终单次卸载后 `residue: []`。结论：**REUSED，无第二安装**。

**本轮未覆盖（明确保留）**：非提升 / 中等完整性上下文（本机仅有 High 完整性令牌）；per-machine / Program Files 安装；2026-04 之前的旧版构建；Authenticode / 代码签名验证；AV / SmartScreen；文件占用锁定；磁盘写满；安装时应用正在运行；需要重启的安装。以上均**不因本轮 PASS 而视为已验证**。

- 交互式（非静默）安装向导：本节全部场景均为 `/S` 静默安装，未验证人工点击向导的路径与文案。
- 官方安装器制造的「真实并存双安装」：安装器对同一 `appId` / 卸载 GUID `58ce24dd-de49-5cd5-8657-5b02091502a0` 强制单实例，新旧版本会先卸载旧版，故未能取得并存样本；采集器的重复检测改由受控残留登记夹具验证（见 §7.2 D′）。

**证据位置**：规范证据 `tests/install-layer-report.json`（已入库，约 11,884 B）；逐场景报告 `tests/install-layer-report-<场景名>.json`（含机器相关临时路径，按 `.gitignore` 忽略）。复现：`node scripts/install-layer-acceptance.cjs --scenario=custom-temp|default-path|non-ascii|reinstall|upgrade|legacy-migration`。

> 结论边界：本轮只关闭「安装层」中的默认路径 / 中文路径 / 同版本重装 / 1.4.32→1.4.38 升级 / 旧式目录迁移取证；**NO-GO ① 仍未闭环**，环境层（目标机缺运行库 / 纯净机）与非提升上下文仍为发布阻断项。

### 7.2 采集器五状态运行时验证（2026-10-25）

> 对象：`scripts/clean-machine-collect.ps1`（采集器 v1.2.0，只读；证据输出全部位于仓库外的 `%TEMP%`）。
> v1.2.0 新增环境完整性事实（此前全靠人工观察）：`isElevated` / `installScope`（perUser vs perMachine）/ 安装包与主程序 `Authenticode` 状态 / Defender 实时防护与病毒库库龄 / `SmartScreen` 策略与安装包 MOTW / 目标盘余量；并修正 `machine-info.json` 的 UTF-8 BOM（此前 `JSON.parse` / `jq` 会直接解析失败）。
> v1.2.0 实跑证据（本机，提升上下文、未安装应用）：无安装包与带 `1.4.38` 安装包两路均 `exit 0`；`installerSha256Match=true`、`installerSignature.status=NotSigned`（内部未签名构建，符合签名渠道区分）、`installerMarkOfTheWeb=absent`、`machine-info.json` 无 BOM。
> ⚠️ 已交付的 `kone-acceptance-kit-1.4.38.zip` 包内仍为 v1.1.0（无复现构建脚本，故不覆盖已交付产物）：**VM 验收前须用仓库 v1.2.0 覆盖包内同名文件**，否则采不到上述环境完整性事实。
> 本轮以真实 1.4.38 / 1.4.32 安装器完成 A–E 五状态实验，采集退出码均为 `0`，安装包指纹始终一致。

| 状态 | 场景 | 关键实测结果 |
|---|---|---|
| A | 未安装 | `appInstalled=false`、`uninstallEntryCount=0`、`uninstallEntryFound=false`、`shortcutCount=0`、`koneProcessRunning=false`、指纹一致 |
| B | 默认路径静默安装 1.4.38 | `appInstalled=true`、版本 `1.4.38`、`uninstallEntryCount=1`、`uninstallEntryFound=true`、`koneProcessRunning=false`；**实际生成 2 个快捷方式（桌面 + 开始菜单），不是 1 个** |
| C | 启动应用后采集 | `koneProcessRunning=true`（Electron 多进程计 4 个进程）；关闭后确认归零 |
| D | 尝试真实双安装 | **真实发现**：在 1.4.38 默认安装之上把 1.4.32 静默安装到临时 legacy 目录时，安装器先卸载了 1.4.38（同一卸载 GUID），最终仍为 1 条登记且 `appInstalled=false` —— 官方安装器不支持并存 |
| D′ | 受控残留夹具 | 在 1.4.38 正常安装之上复制一条真实卸载登记（同一 DisplayName、不同 InstallLocation）→ `uninstallEntryCount=2`、`multipleInstallations=true`，`.txt` 输出 `⚠️ 检测到 2 个 Kone 卸载登记（疑似重复安装/升级残留），需人工核查` |
| E | 卸载两者 + 清理 | 1.4.32 与 1.4.38 卸载退出码均 `0`；`appInstalled=false`、`uninstallEntryCount=0`、`shortcutCount=0`、`koneProcessRunning=false`，无安装目录残留 |

**新增能力**：采集器现枚举 `HKCU`、`HKLM`、`HKLM\WOW6432Node`、`HKCU\WOW6432Node` 四处全部 Kone 卸载登记并去重，输出 `uninstallEntryCount` / `uninstallEntryFound` / `uninstallEntries[]` / `multipleInstallations`，因此**能检出重复安装与升级残留**（旧版 `Select-Object -First 1` 只能证明「≥1」）。同时新增 `koneProcessRunning` 与 `shortcuts[]` / `shortcutCount`，并把默认输出目录改为脚本所在目录；默认路径若落在含 `.git` 与 `package.json` 的仓库内则拒绝写入并退出 `9`，显式 `-OutDir` 行为不变。

**边界**：D′ 为受控夹具，不是官方安装器制造的并存安装；安装器本身会自清理旧版。以上不改变采集器「只读」语义，也不改变退出码 `0` / `2` / `9`。

## 8. 证据最低要求与判读规则（防"看图主观"）

| 步骤 | 最低证据（缺一即视为**未覆盖**） | PASS 判据 |
|---|---|---|
| S1 | 截图含：桌面/开始菜单快捷方式 **+** 控制面板卸载项；`machine-info.txt` 中 `uninstallDisplayName` 非空 | 两者齐备 |
| S2 | 截图含：激活页完整界面（非白屏、非崩溃） | 激活页可见 |
| S3 | 截图含：侧边栏 | 主界面可达 |
| S4 | 截图含：至少一个提供商「连接成功」字样 | ≥1 成功 |
| S5 | 截图含：ICP 表单已填 + 保存成功反馈 | 保存成功 |
| S6 | 2 张：阶段进度 + 结果列表 | 出现阶段进度 **且** 评分逐条回填 |
| S7 | 截图含：AI/规则 徽标 + 匹配理由/风险提示 | 徽标可区分 **且** 理由可见 |
| S8 | 2 张：CSV 导出成功 + PDF 导出结果（含限额提示） | 两通道均有结果 |
| S9 | 2 张：试用版升级引导 + 渠道进度 `0` / 「未连接」 | 不出现卡片/指标 **且** 无假数据 |
| S10 | 截图含：「需要你处理」+「评分精度验证」 | 两卡可见 |
| S11-a | 截图含：升级引导面板，且**无**配置输入框 /「测试连接」按钮 | 条件化生效、非空态 |
| S11-b | 截图含：真实表单 + 测试连接结果 | 表单可见；错误不得静默报成功 |
| S11-c（可选） | DevTools 控制台含 `FEATURE_DENIED` | 抛异常，非正常返回 |

**判定纪律**

1. 截图必须**可读**；分辨率不足或关键元素被裁掉的，按**未覆盖**处理。
2. 描述性结论（"看起来正常"）**不构成证据** —— 以上表判据为准。
3. 任一 FAIL → 记录「步骤 + 现象 + 截图 + `logs-tail.txt`」；**不要靠重跑掩盖**，先定位。
4. 全部 PASS → 在 §6 归档目录写入 `PASS` + 日期，并回传证据包。

---

*本执行单对齐 `package.json` `1.4.38`（HEAD 以 `git rev-parse HEAD` 为准）。若 `package.json` 版本变更，请重新生成。*
