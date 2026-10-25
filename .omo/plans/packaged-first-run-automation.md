# 计划：打包版「首次运行」自动化 + 本机严谨全量跑批

状态：**已完成**（2026-10-20，commit `39c4318`）
作者：Prometheus
日期：2026-10-20
目标版本：1.4.38

---

## 1. 背景与动机

用户放弃"干净机器 S1–S11 人工验收"路线（认为操作负担过重），要求在**本机**尽可能严谨地自动化验证。

必须诚实告知的边界（不得在交付话术中抹掉）：

| 验收项 | 本机自动化能否证明 | 原因 |
|---|---|---|
| 首次启动渲染 / 激活页 / 试用入口 | ✅ 可以（空 `--user-data-dir`） | 全新 profile ≈ 首次运行 |
| preload 桥接注入 | ✅ 可以 | CDP 页面上下文可探测 |
| 首启白屏 / 崩溃 | ✅ 可以 | 断言 `[data-stage]` + 非空文本 |
| NSIS 安装器行为（快捷方式/卸载项/安装目录） | ❌ 不能 | 属安装器进程，非应用进程 |
| 目标机环境依赖缺失（无 VC++/Chrome） | ❌ 不能 | 本机已具备，无法证伪 |
| 真实第三方 API（SerpApi/LLM/SMTP） | ❌ 不能 | 需真实密钥与配额 |
| "干净"本身（无历史残留） | ⚠️ 仅近似 | 空 profile 不清理系统级痕迹 |

**结论口径**：本机自动化可以覆盖"应用层首次运行"，**不能**覆盖"安装器 + 目标机环境"。发布判定 ① 在规格层面**不被本计划关闭**，只能在 `CLOUD-COLLABORATION-DELIVERY.md §0` 中标注"应用层已自动化覆盖 / 安装层仍未验证"，由 owner 决定是否接受该残余风险。

---

## 2. 交付物一：`scripts/packaged-first-run.cjs`

与 `scripts/packaged-smoke.cjs` 的差异：注入全新 `--user-data-dir`，强制首次运行路径；输出结构化报告 + 截图；如实列出"自动覆盖 / 未覆盖"清单。

纯新增文件，**不改动任何业务代码**，不改 `package.json`（如需入口，再单独加 `"test:first-run": "npm run dist && node ./scripts/packaged-first-run.cjs"`）。

```js
/**
 * Kone 打包版「首次运行」自动化验收（本机可执行，无需干净机器）。
 *
 * 与 packaged-smoke.cjs 的差别：
 *   - smoke 复用当前用户数据，只证明"能启动"；
 *   - 本脚本注入全新 `--user-data-dir`，强制走首次运行路径（无既有授权/配置/线索），
 *     因此能验证激活页、试用入口、桥接注入等"首启才出现"的行为。
 *
 * 它不能替代干净机器验收的部分（报告中如实列出）：
 *   - 目标机是否预装 Chrome/Node/VC++ 运行库等环境依赖；
 *   - 首次安装的 NSIS 安装行为、快捷方式、卸载项；
 *   - 真实第三方 API（SerpApi/LLM/SMTP）联网效果。
 *
 * 用法：
 *   node scripts/packaged-first-run.cjs              // 默认读 release/win-unpacked
 *   node scripts/packaged-first-run.cjs release-build
 *
 * 退出码：0 = PASS；1 = FAIL（详见 tests/packaged-first-run-report.json）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execSync } = require('child_process')
const puppeteer = require('puppeteer-core')

const rootDir = path.resolve(__dirname, '..')
const outputDirOverride = (process.argv[2] || process.env.KONE_PACKAGED_ROOT || 'release').trim()
const unpackedRoot = path.join(rootDir, outputDirOverride, 'win-unpacked')
const executablePath = path.join(unpackedRoot, 'KoneAI.exe')
const reportPath = path.join(rootDir, 'tests', 'packaged-first-run-report.json')
const screenshotPath = path.join(rootDir, 'tests', 'packaged-first-run.png')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ACTIVATION_PATTERN = /软件授权验证|立即验证授权|设备识别码|激活码/
const TRIAL_ENTRY_PATTERN = /免费试用|开启\s*7\s*天|试用/

async function run() {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Unpacked executable not found: ${executablePath}`)
  }

  // 全新用户数据目录 = 首次运行语义
  const profileDir = path.join(os.tmpdir(), `kone-first-run-${Date.now()}`)
  fs.mkdirSync(profileDir, { recursive: true })

  try {
    execSync('taskkill /f /im KoneAI.exe /t', { stdio: 'ignore' })
  } catch {
    /* 无残留进程 */
  }
  await wait(800)

  const childEnv = { ...process.env, CI: '1', KONE_SMOKE_TEST: '1', ELECTRON_ENABLE_LOGGING: '1' }
  delete childEnv.ELECTRON_RUN_AS_NODE

  const electronProc = spawn(executablePath, [`--user-data-dir=${profileDir}`], {
    cwd: unpackedRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  electronProc.stdout.on('data', (c) => {
    stdout += c.toString()
  })
  electronProc.stderr.on('data', (c) => {
    stderr += c.toString()
  })

  const report = {
    scenario: 'packaged-first-run',
    startedAt: new Date().toISOString(),
    executablePath,
    profileDir,
    checks: {},
    bodyTextSample: '',
    screenshotPath,
    stdout: '',
    stderr: '',
    coverage: {
      autoCovered: ['首次启动渲染', '激活页/试用入口', 'preload 桥接注入', '首启不崩溃'],
      notAutoCovered: [
        'NSIS 安装器行为（快捷方式/卸载项/安装目录）',
        '目标机环境依赖缺失场景',
        '真实第三方 API 联网',
        '干净机器无历史残留（本机仅以空 profile 近似）',
      ],
    },
  }

  let browser
  try {
    await wait(4000)
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', protocolTimeout: 60000 })

    let page = null
    const deadline = Date.now() + 20000
    while (!page && Date.now() < deadline) {
      const pages = await browser.pages()
      page = pages.find((p) => !p.url().startsWith('devtools://')) || null
      if (!page) await wait(500)
    }
    if (!page) throw new Error('No Electron app page detected')

    page.setDefaultTimeout(20000)
    await page.bringToFront()
    await page.setViewport({ width: 1440, height: 900 })
    await page.waitForSelector('[data-stage]', { timeout: 20000 })
    await wait(2500)

    const snapshot = await page.evaluate(() => {
      const text = document.body?.innerText || ''
      return {
        bodyText: text,
        hasBridge: typeof window.electronAPI !== 'undefined',
        bridgeKeyCount:
          typeof window.electronAPI === 'object' && window.electronAPI
            ? Object.keys(window.electronAPI).length
            : 0,
        hasStage: Boolean(document.querySelector('[data-stage]')),
        hasNavSettings: Boolean(document.querySelector('[data-nav-id="settings"]')),
        hasNavSearch: Boolean(document.querySelector('[data-nav-id="search"]')),
        hasNavAgents: Boolean(document.querySelector('[data-nav-id="agents"]')),
        visibleTextLength: text.replace(/\s+/g, '').length,
      }
    })

    report.bodyTextSample = snapshot.bodyText.slice(0, 1200)

    report.checks.booted = snapshot.visibleTextLength > 0
    report.checks.stageRendered = snapshot.hasStage
    report.checks.preloadBridgeVisible = snapshot.hasBridge && snapshot.bridgeKeyCount > 0
    report.checks.bridgeKeyCount = snapshot.bridgeKeyCount
    report.checks.activationScreenVisible = ACTIVATION_PATTERN.test(snapshot.bodyText)
    report.checks.trialEntryVisible = TRIAL_ENTRY_PATTERN.test(snapshot.bodyText)
    report.checks.dashboardNavVisible = snapshot.hasNavSettings || snapshot.hasNavSearch
    report.checks.agentsNavVisible = snapshot.hasNavAgents
    report.checks.landedOnKnownScreen =
      report.checks.activationScreenVisible || report.checks.dashboardNavVisible

    try {
      await page.screenshot({ path: screenshotPath })
    } catch {
      await wait(2000)
      await page.screenshot({ path: screenshotPath })
    }
  } finally {
    report.finishedAt = new Date().toISOString()
    report.stdout = stdout
    report.stderr = stderr
    report.verdict =
      report.checks.booted &&
      report.checks.stageRendered &&
      report.checks.preloadBridgeVisible &&
      report.checks.landedOnKnownScreen
        ? 'PASS'
        : 'FAIL'
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    if (browser) await browser.close().catch(() => undefined)
    electronProc.kill()
  }

  console.log(`[first-run] verdict=${report.verdict}`)
  console.log(`[first-run] report=${reportPath}`)
  if (report.verdict !== 'PASS') {
    throw new Error(`Packaged first-run validation failed: ${JSON.stringify(report.checks)}`)
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

---

## 3. 交付物二：本机严谨全量跑批

依次执行并逐项记录退出码（任一步非 0 即停，不掩盖）：

```bash
npm run verify:consistency     # docs + ipc + cloud-safety
npm run verify:release-gate    # HARD 门禁
npm run test:unit              # 期望 632 pass / 0 fail
npm run test:cloud             # 期望 63 passed / 2 files
npm run test:ipc               # 期望 1 pass
npm run test:e2e-smoke         # 期望 7 pass
npm run lint                   # 期望 0 error
npm run typecheck              # 期望 0 error
node ./scripts/packaged-smoke.cjs        # 期望 EXIT 0
node ./scripts/packaged-first-run.cjs    # 新增，期望 verdict=PASS
```

合计耗时约 3–5 分钟（`build:electron:dev` 会被多个脚本重复执行）。

---

## 4. 验收标准

- 上述 10 条命令**全部 EXIT 0**；
- `tests/packaged-first-run-report.json` 中 `verdict = "PASS"`，且 `checks.activationScreenVisible` 或 `checks.dashboardNavVisible` 至少一项为 true；
- `tests/packaged-smoke-report.json` 三项恒真规则成立；
- 报告产出 `tests/packaged-first-run.png`（首启截图）作为证据。

## 5. 回滚

- 删除 `scripts/packaged-first-run.cjs`；
- 删除 `tests/packaged-first-run-report.json` / `tests/packaged-first-run.png`（若已入库需一并回退）；
- 无业务代码改动，无 schema 变更，无迁移。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 9222 端口被残留进程占用 → 连到旧实例误判 | 启动前 `taskkill /f /im KoneAI.exe /t`（沿用 smoke 做法） |
| 空 profile 下应用可能停在某引导页而非激活页 | 断言放宽为"激活页 **或** 主界面"，并要求 `[data-stage]` 存在 |
| `release/win-unpacked` 不存在（仅安装包） | 先 `npm run dist`；或指向 `release-build` |
| 本机自动化被误当"干净机器验收通过" | 报告与文档均显式标注 `notAutoCovered`，不关闭 NO-GO ① |

## 7. 明确不做

- 不改 `CLOUD-COLLABORATION-DELIVERY.md §0` 的 NO-GO 结论（本机自动化不构成 ① 的关闭证据）；
- 不动生产 `APPROVAL_GATE_ENABLED`；
- 不改任何业务代码。

---

## 8. 破坏性操作红线（执行者必须逐条遵守）

> 违反任一条即判定任务失败，即使测试全绿。

1. **禁止** 执行 `npm run dist` / `npm run build` / `npm run clean` / `npm run test:smoke` / `npm run test:e2e-journey`（后者会 `build:electron:dev`，安全，但 `dist` 系列会 `rimraf release/*`）。
   原因：`package.json:12` 的 `build` 脚本以 `npm run clean` 开头，`clean` 会删除 `release/`，**直接销毁已交付的 `Kone-Intellect-Setup-1.4.38.exe` 与验收工具包**。
2. 作业前后各校验一次安装包仍在：`release/Kone-Intellect-Setup-1.4.38.exe`，大小 `89962234`，SHA-256 `6EF8459AA2F70CB5812E852D0426F0C7D20635EDDFAF0BEE2A55538CD7741D4B`。缺失即立即停止并上报。
3. 禁止修改 `src/**`、`electron/**`、`.omo/**`；禁止 `git commit` / `git push`。
4. 打包版必须使用**已存在**的 `release/win-unpacked/KoneAI.exe`，不得重新打包。

## TODOs

- [x] 1. 新增 `scripts/packaged-first-run.cjs`（逐字采用 §2 代码）
- [x] 2. `package.json` 增加 `"test:first-run": "node ./scripts/packaged-first-run.cjs"` 入口
- [x] 3. 按 §3 顺序跑完 10 条命令并逐条记录退出码
- [x] 4. 确认 `tests/packaged-first-run-report.json` 的 `verdict` 与 `tests/packaged-first-run.png` 均已产出

## Final Verification Wave

- [x] F1. 独立复核 `packaged-first-run-report.json` 的 `checks` 与截图存在（不由实施者自证）
- [x] F2. 复核 §3 十条命令退出码全为 0，且安装包指纹未被破坏

## 执行证据（2026-10-20）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `verify:consistency` | 0 | docs + IPC(72 channels) + cloud-safety 通过 |
| `verify:release-gate` | 0 | HARD 9/9 绿，WARN 2 项（非阻断） |
| `test:unit` | 0 | 632 pass / 0 fail |
| `test:cloud` | 0 | 63 passed / 2 files |
| `test:ipc` | 0 | 1 pass |
| `test:e2e-smoke` | 0 | 7 pass |
| `lint` | 0 | 0 error / 278 warning |
| `typecheck` | 0 | 0 error |
| `packaged-smoke.cjs` | 0 | EXIT 0 |
| `packaged-first-run.cjs` | 0 | `verdict=PASS` |

首次运行断言（真实、非空洞）：`booted` / `stageRendered` / `preloadBridgeVisible`(27 个桥接方法) /
`activationScreenVisible` / `trialEntryVisible` / `landedOnKnownScreen` 全为 true；
`bodyTextSample` 含 `软件激活`、`设备识别码`、`立即激活`、`开启 7 天免费试用`；
截图 `tests/packaged-first-run.png` 314829 bytes、1440×900、非空白。

安装包完整性：跑批前后均为 89962234 bytes，SHA-256 一致（未被 `rimraf release/*` 波及）。

独立复核：`confirmed`，confidence 0.95，且由复核者从干净 shell 重跑 `packaged-first-run.cjs` 复现 PASS。

已知薄弱点：脚本连接固定 `127.0.0.1:9222`，未严格校验页面归属进程（沿用 `packaged-smoke.cjs` 的
`taskkill` 前置缓解）。不影响本次结论，但属可加固项。

---

# 阶段二：安装层自动化（收窄 NO-GO ① 的安装面）

## 9. 目标与手段

把 NO-GO ① 中「安装层」这一面也变成自动化断言，使其剩余范围只剩「目标机环境依赖」。

手段：用 NSIS 静默参数把**已交付的同一个安装包**装到临时目录，断言安装产物，再静默卸载并断言清理干净。

```
Kone-Intellect-Setup-1.4.38.exe /S /D=<ASCII 临时目录>
```

> NSIS 约定：`/S` 必须大写且在 `/D` 之前；`/D=` 必须是**最后一个参数**且**不加引号**。

## 10. 断言清单

| 编号 | 断言 | 判据 |
|---|---|---|
| A1 | 安装目录存在 | `<临时目录>\KoneAI.exe` 存在 |
| A2 | 版本正确 | 该 exe 的 `ProductVersion` 或 `FileVersion` 以 `1.4.38` 开头 |
| A3 | 卸载登记项存在**且指向安装目录** | `DisplayName` 含 `Kone`，且 `UninstallString` 指向 `<临时目录>\Uninstall*.exe`；**另**校验 `HKCU\Software\<APP_GUID>` 的 `InstallLocation` = 临时目录 |

> **A3 判据勘误（2026-10-23）**：初版 A3 断言"卸载键的 `InstallLocation` = 临时目录"，实测恒为 `null`。
> 查 `app-builder-lib/templates/nsis/include/installer.nsh:104` 与 `multiUser.nsh:8-9` 证实：
> electron-builder 把 `InstallLocation` 写入 `Software\${APP_GUID}`（`INSTALL_REGISTRY_KEY`），
> 而卸载键（`UNINSTALL_REGISTRY_KEY`）只写 `DisplayName` / `UninstallString` / `QuietUninstallString`（`:119-123`）。
> 初版判据编码了错误的事实假设，属**判据缺陷而非产物缺陷**；已按安装器真实行为修正，不降低严格度
> （仍要求"登记项可定位到确切安装目录"，只是改由 `UninstallString` + 应用键 `InstallLocation` 共同证明）。
| A4 | 快捷方式创建 | 桌面 或 开始菜单存在含 `Kone` 的 `.lnk` |
| A5 | 卸载后清理 | 卸载器 `/S` 执行后：临时目录消失、登记项消失、A4 的快捷方式消失 |

A1–A4 全部成立 → 安装层 **PASS**；A5 不成立 → 判定 `RESIDUE`（比 FAIL 更严重，必须人工清理）。

## 11. 回滚与安全（先于执行）

| 编号 | 措施 |
|---|---|
| R1 | **执行前探测**：若本机已存在任何 `DisplayName` 含 `Kone` 的卸载项，**立即中止**，不得覆盖用户既有安装 |
| R2 | **强制 finally**：一旦安装成功，无论断言是否通过，`finally` 必须执行卸载器 `/S` |
| R3 | **残留上报**：卸载后重新探测目录/登记项/快捷方式，任一残留即在报告中标记 `RESIDUE` 并列出确切路径供人工清理 |
| R4 | 不写系统级目录、不提升权限、不改 `PATH`、不设置开机自启 |

## 12. 本阶段 TODOs

- [x] 5. 新增 `scripts/install-layer-acceptance.cjs`（含 R1 前置探测与 R2 强制卸载）
- [x] 6. 运行脚本并产出 `tests/install-layer-report.json`（规范证据已入库；逐场景 `tests/install-layer-report-<场景>.json` 仍按 `.gitignore` 忽略）
- [x] 7. 仅在 A1–A5 全绿时，把结果写入 `CHANGELOG.md` [1.4.38] 与 `docs/evidence/clean-machine-acceptance-1.4.38.md` §7
- [x] 8. 扩展为 6 场景矩阵（`custom-temp` / `default-path` / `non-ascii` / `reinstall` / `upgrade` / `legacy-migration`），全部 PASS
- [x] 9. 勘误默认安装目录为 `%LOCALAPPDATA%\Programs\KoneAI`，并修正证据采集脚本的错误探测路径
- [x] 10. 实测旧式目录迁移 `migration: REUSED`（1.4.32 → 1.4.38 原地复用，无二次安装）

## 12.1 阶段二执行证据（2026-10-23）

| 断言 | 结果 |
|---|---|
| A1 安装目录 + `KoneAI.exe` 存在 | PASS（等待 1 ms） |
| A2 版本 = 1.4.38 | PASS（ProductVersion `1.4.38.0` / FileVersion `1.4.38`） |
| A3 卸载登记项 + `UninstallString` 指向 targetDir + 恰好 1 个 `InstallLocation` 命中 | PASS（命中键 `HKCU\Software\58ce24dd-…`，等待 871 ms） |
| A4 桌面/开始菜单快捷方式 | PASS（2 个 `Kone 智能获客.lnk`） |
| A5 卸载后目录/登记项/快捷方式全清 | PASS（等待 6 197 ms，`residue: []`） |
| 安装耗时 / 卸载耗时 | 6 720 ms / 6 197 ms |

安装包跑前后：89 962 234 bytes / `6EF8459A…741D4B` 一致。
独立审计：`confirmed`（0.92）—— 核对 `installer.nsh:104`、`multiUser.nsh:8-9` 原文，确认 A3 非空洞、反向控制可失败（路径不符 → 0 命中；双命中 → 失败）。

**仍未覆盖（不得在交付话术中省略）**：默认安装路径（本次用 `/D` 指向临时目录）、非提升上下文（本机仅有 High 完整性令牌）、升级覆盖安装、中文路径安装、缺运行库的目标机。故 NO-GO ① 的剩余范围为**环境层 + 上述安装层残余**。

## 12.2 阶段二扩展：6 场景矩阵（2026-10-25，已完成）

> 执行：`node scripts/install-layer-acceptance.cjs --scenario=<场景名>`。6 场景全部 **PASS**，安装 / 卸载 exit `0`，`residue: []`，卸载登记项 `entryCount: 1`。

| 场景 | 结论 | 关键实测事实 |
|---|---|---|
| `custom-temp` | ✅ PASS | `/D` 指向临时目录，A1–A5 全过；产出规范证据 `tests/install-layer-report.json` |
| `default-path` | ✅ PASS | 实际落盘 `%LOCALAPPDATA%\Programs\KoneAI`，与推导值一致 |
| `non-ascii` | ✅ PASS | 中文路径 `...\Temp\kone-安装层-中文-...` 安装 / 卸载正常，注册表 `InstallLocation` 与中文目录一致 |
| `reinstall` | ✅ PASS | 同版本重装，第二次 exit `0` 且第二遍 A1–A4 通过（**代理实验，非升级**） |
| `upgrade` | ✅ PASS | 1.4.32（89,943,061 B，SHA-256 `ABEF…198C`）→ 1.4.38 原地升级覆盖 |
| `legacy-migration` | ✅ PASS | **`migration: REUSED`**：旧式命名目录 1.4.32 → 1.4.38（不传 `/D`）复用注册表 `InstallLocation` 原地升级；`entryCount` 前后均为 1，单次卸载清理干净，**无第二安装** |

**默认目录勘误**：真实默认目录 = `%LOCALAPPDATA%\Programs\KoneAI`，不是 `kone-system`。
推导链：`build.executableName = "KoneAI"` + `nsis.oneClick=false` + 无 `perMachine` → `NsisTarget.js:165` 取 `APP_FILENAME = productFilename` → `appInfo.js:56-57` sanitize(`executableName`) → `multiUser.nsh:40` `$INSTDIR = "$0\${APP_FILENAME}"`。
git 考古：208 commits，单一根提交 `4b77729`（2026-04-24，1.2.0）；`executableName` / `productName` / `appId` / `oneClick` 在可考历史中从未变更，归档 1.3.0 / 1.3.15 安装包亦含 `KoneAI.exe` → **1.3.x / 1.4.x 可原地升级**；仅 2026-04-24 之前的原型安装未考证。

**未覆盖（明确保留）**：非提升 / 中等完整性上下文（本机仅 High 令牌）；per-machine / Program Files；2026-04 之前旧版构建；Authenticode / 签名；AV / SmartScreen；锁定文件；磁盘写满；安装时应用运行中；需要重启。**NO-GO ① 仍未闭环**。

## 13. 本阶段 Final Verification Wave

- [x] F3. 独立复核：卸载后无残留（目录 / 登记项 / 快捷方式三项逐一确认）—— 6 场景 `residue: []`
- [x] F4. 独立复核：`release/Kone-Intellect-Setup-1.4.38.exe` 指纹未被改动 —— 89,962,234 B / SHA-256 `6EF8459A…741D4B`

## 14. 明确不做

- 不在本阶段关闭 NO-GO ①（环境层面仍未验证）。
- 不宣称「本机安装成功 = 干净机器通过」——本机已具备运行库，缺库场景仍未被覆盖。
- 不使用 `npm run dist` 重新打包。
