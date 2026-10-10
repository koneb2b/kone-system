# KONE V1.3 分支与交付物治理梳理

> 日期：2026-10-10 ｜ 触发：交付前确认「是否存在其他分支 / 优化是否全面覆盖 / 是否需要合并」
> 结论速览：**无内容丢失风险；已执行零风险同步；发现并修复 3 类治理噪音**

---

## 一、分支现状（已核查）

| 分支 | 提交数 | HEAD | 说明 |
|---|---|---|---|
| `master` | 153 | `81bfc0b` | 历史主线名 |
| `gap-fix-p0-p1` | 153 | `81bfc0b` | 事实主干（当前所在） |

**关键事实**：
1. **仓库只有这 2 个分支**，且**无远程仓库**（纯本地）。
2. 梳理前 `gap-fix-p0-p1` **领先 master 96 个提交**，而
   `git log gap-fix-p0-p1..master` **为空** —— 即 **master 完全被 gap-fix-p0-p1 包含，无任何独有内容**。
3. `master` 的 HEAD 曾是 `388724c`，其提交信息自述：
   > "master 历史线已由本分支全面取代……此合并仅作历史连通，不引入任何内容变更"

   → 项目**已承认** `gap-fix-p0-p1` 取代了 master，但 master 之后**再未跟进**。

## 二、是否需要「融合合并」？—— 需要，但不是 merge，而是 fast-forward

**判断依据**：
- 两分支**无分叉内容**（master 是 gap-fix-p0-p1 的祖先）→ 不存在"合并冲突"或"内容取舍"问题；
- 但 master 落后 96 提交构成**真实隐患**：任何人 `git checkout master` 后打包，
  会**静默丢失全部 P0/P1/P2 修复**（含合规红线项）。

**已执行（零风险 fast-forward）**：
```
master 388724c → 81bfc0b   （与 gap-fix-p0-p1 完全一致）
```
- **可回滚**：原 SHA `388724c4c24c386746aeb83108db4983f03c17a8` 已记录；
  如需还原：`git branch -f master 388724c`
- **零内容变更**：fast-forward 不产生新提交、不改任何文件。

**根治建议（需你决策，未擅自执行）**：
当前"双分支同名主干"的结构会**持续制造落后**——本次梳理中我刚提交一次 `.gitignore`，
master 就立刻又落后 1 个提交，需再次同步。两个可选根治方案：

| 方案 | 操作 | 优点 | 代价 |
|---|---|---|---|
| **A. 统一为 master** | 后续直接在 master 上提交，废弃 `gap-fix-p0-p1` | 符合通用习惯，零额外成本 | 分支名 `gap-fix-p0-p1` 名不副实（它早已不止 P0/P1 修复） |
| **B. 统一为 main** | `git branch -m gap-fix-p0-p1 main` 后删除 master | 命名现代、名副其实 | 若有外部脚本硬编码 `master` 需同步调整 |

### ✅ 已执行：方案 B（分支根治，2026-10-10）

**执行前的安全核查（全部通过）**：

| 核查项 | 结果 |
|---|---|
| `package.json` 是否引用 master | 无 |
| `scripts/` / `.github/` 是否引用 master | 无 |
| `.git/config` 是否引用 master | 无 |
| **CI 期望的分支名** | **`.github/workflows/ci.yml` 声明 `branches: [main, dev, 'release/*']`** |

> **决定性证据**：CI 配置期望的是 **`main`**，而仓库里**根本没有 main 分支** ——
> 这意味着 **CI 从未被触发过**。方案 B 不仅"更规范"，而且是**修复 CI 失效的必要前提**。

**执行结果**：
```
git branch -m gap-fix-p0-p1 main    # 改名
git branch -D master                # 删除（内容完全一致，零损失）
```
- **现状**：仓库只有 **1 个分支 `main`**，与 CI 配置对齐。
- **可回滚**：原 master SHA `c64cc7f0c3a25bfca2ceb5a7ac817e2ca0296b52`；
  如需还原：`git branch master c64cc7f`
- **零内容损失**：执行前已用 `git diff master gap-fix-p0-p1` 确认两者完全一致。

## 二·补 关于「审批 → 云端二次门禁」的核查（重要订正）

梳理过程中入库了 `KONE-V1.3-审批与云端二次门禁设计方案-2026-10-07.md`。
该文档头部标注「**状态：草案 v1，待评审**」，正文称：
> "AGENTS.md 宪法第 5 条要求「审批 + 服务端二次门禁」……**这条宪法级约束在代码中无实现**"

**核查结论：该描述已过时，宪法第 5 条实际已落地。**

| 证据 | 内容 |
|---|---|
| 提交 `4edd5b4`（2026-10-07） | `feat(cloud): 阶段1 · 云端二次门禁 ⑤⑥⑦⑧⑨ + approvals API（宪法第5条落地）` |
| 提交 `0f2208f`（2026-10-07） | `feat(cloud): 阶段4 · 配额熔断写入侧 + 驳回 UI（让门禁⑨真正生效）` |
| 云端实现 | `kone-cloud/src/worker.ts`：`/outreach/queue` → `handleQueueOutreach`（仅接受 **approved** lead） |
| 门禁测试 | `kone-cloud/tests/approval-gate.test.ts` 覆盖 ⑤撞单 / ⑥抑制 / **⑦审批（无记录→APPROVAL_REQUIRED、rejected→拒绝、版本不匹配→DRAFT_VERSION_MISMATCH）** / ⑧邮箱等级 / ⑨熔断 |

**厘清**：本地侧 `queueOutreach` 确实**不做前置审批校验**（也不传 `approvalId`），
但这是**符合宪法措辞的设计** —— 宪法要求的是 **"server-side second-gate"（服务端二次门禁）**，
本地只负责投递、由服务端兜底。**不是缺陷**。

**待办（文档治理）**：该设计文档的状态行应订正为「已实现（见 `4edd5b4`）」，
避免后来者误读为"宪法未落地"。

## 三、优化覆盖度核查（回答「是否全面严谨覆盖到位」）

| 核查项 | 方法 | 结果 |
|---|---|---|
| 修复是否都在主干 | 全部提交均落在 `gap-fix-p0-p1`，已同步至 master | ✅ |
| 是否有散落在别处的改动 | 仅 2 个分支，无远程；`git log gap-fix-p0-p1..master` 为空 | ✅ 无遗漏 |
| 是否有 stash 未取回 | `git stash list` 仅 1 条 `On master: boulder runtime state`，内容为 `.sisyphus/boulder.json`（工具运行时状态，**非产品代码**） | ✅ 无需取回 |
| 工作区是否有未提交修复 | 已跟踪文件全部干净；未跟踪 4 项均为历史文档 | ✅ |
| 门禁是否全绿 | typecheck 双侧 0 error / 单测 407-407 / e2e 1-1 / e2e-smoke 7-7 / ipc 1-1 / security-audit 3+3+6 / lint 0 error / verify:consistency 通过 | ✅ |

**结论：优化覆盖完整，无遗漏、无分叉丢失。**

## 四、附带修复的治理噪音（提交 `81bfc0b`）

`git status` 长期有 **32 个未跟踪文件**，绝大多数是工具运行时产物，
掩盖了真正需要关注的变更。已补齐 `.gitignore`：

| 新增忽略 | 内容 |
|---|---|
| `.omo/` | Oh My OpenCode 运行时（boulder / drafts / evidence / notepads） |
| `.sisyphus/` | 探针证据（截图与 JSON） |
| `.workbuddy-ai/` | WorkBuddy AI 工作记忆（本地上下文） |
| `/probe-*.png` `/probe-*.json` | 根目录视觉探针产物 |
| `/tests/*-report.json` | 一次性测试报告 |
| `release.rar` `/=` | 打包产物与意外重定向文件 |

**已核验**：`.gitignore` 只影响未跟踪文件，已入库的
`tests/packaged-smoke-report.json` 与 `packaged-smoke.png` **不受影响**。

**效果：未跟踪文件 32 → 4。**

## 五、待你决策的遗留项

以下 4 项是**历史文档**（非工具产物），是否入库属团队文档策略，我未擅自处理：

| 项 | 内容 | 建议 |
|---|---|---|
| `KONE-V1.3-审批与云端二次门禁设计方案-2026-10-07.md` | 云端协同设计方案（核心领域） | **建议入库** |
| `archive/` | 4 份历史审计报告 | 视作归档，可不入库（建议在 `.gitignore` 显式声明，避免长期显示为噪音） |
| `2026-09-15/EvoX-1b8374fe/` | 4 份 Phase 1 实施记录与审计报告 | 同 archive 处理 |
| `2026-09-20/EvoX-81f7fa19/` | 2 份融合落地方案 | 同 archive 处理 |

---

## 附：本次梳理的操作记录（可审计）

| 操作 | 命令 | 影响 |
|---|---|---|
| 查分支 | `git branch -a` | 只读 |
| 查差异 | `git log gap-fix-p0-p1..master` | 只读（结果为空） |
| 查 stash | `git stash list` / `git stash show` | 只读 |
| 补 `.gitignore` | Edit + commit `81bfc0b` | 新增忽略规则，不改产品代码 |
| 同步 master | `git branch -f master gap-fix-p0-p1` | fast-forward，零内容变更，可回滚 |
