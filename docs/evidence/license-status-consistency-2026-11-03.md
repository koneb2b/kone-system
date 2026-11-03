# 授权状态一致性缺陷与修复（2026-11-03）

> 文档角色：一次性缺陷取证记录（evidence），非规范。
> 权威规范仍为 `CLOUD-COLLABORATION-DELIVERY.md`、`kone-PRD.md`；
> 授权能力集 SSOT 为 `src/shared/license-features.ts`。

## 1. 现象

打包版 `1.4.38` 在本机表现为「未激活 / 待激活」，搜索、开发信、保存线索全部被授权 Gate 拦截：

| 观测项 | 值 |
|---|---|
| `license.checkStatus()` | `status: expired` / `tier: unregistered` / `expiresAt: 0` / `features: []` |
| `license.getInfo()` | `plan: trial` / `daysLeft: 6` / `expiresAt: 2026-11-09` / `[search_basic, lead_export]` |
| 打包版真实搜索 | `当前展示 0 / 0`，300s 超时 |
| dev 模式同一查询（授权旁路） | `25 / 25`，5s 完成 |

同一进程内两个 IPC 通道给出相反结论，UI 采用 `checkStatus`，因此渲染「未激活」。

## 2. 根因

### D-1 · 锚点写入静默失败 + 密钥材料漂移

- 试用锚点密文密钥为 `sha256("kone-anchor|${machineId}|${app.name}|v${ANCHOR_VERSION}")`
  （`electron/services/license-service.ts` `getAnchorKey`）。
- `persistAnchor()` 对文件写入（`EPERM`）与注册表写入（`reg add` 失败）均**静默吞掉**，
  而 `persistClaims()` 与 `store.set()` 成功 → 三处状态分裂。
- 本机实测：`2026-11-02` 的试用授予写入了 claims/config（`2026-11-09`），
  但锚点仍停留在 `2026-10-18`；文件锚点（272 B）在后续构建中**无法解密**（密钥材料漂移）。
- 解密失败此前无任何日志，直接按「无锚点」处理 → 合法授权被静默降级。

### D-2 · 两个通道的判定源不同

- `CHECK_STATUS`（`license-service.ts`）只认锚点；trial 分支还要求 `plan !== 'trial'`。
- `GET_INFO`（同文件）读 secrets 中的 claims。
- 二者分裂 → 「剩 6 天」与「未激活」并存。

## 3. 修复（commit `bf93bb5`）

| 项 | 内容 |
|---|---|
| `claimsToTrialAnchor()` | 把有效 trial claims 折算为锚点证据；仅接受 `plan=trial`、`status=active`、`expiresAt>0`、machineId 匹配（缺省兼容历史记录） |
| `reconcileTrialAnchor()` | 到期时间取最大（授权只增不减）、首次试用取最小、任一来源 `time_rollback` 即锁定 |
| `readAnchor()` | 接入对账；密文存在但不可解密时输出 WARN；claims 读取异常降级为 `null`（不升级为硬失败） |

**未改变付费边界**：trial 仍仅 `search_basic` + `lead_export`；Premium/Enterprise 仍需有效离线授权。

## 4. 验证

| 项 | 结果 |
|---|---|
| `tests/license-anchor-claims-reconcile.test.ts` | 9/9 通过 |
| `npm run test:unit` | 653/653（基线 644，+9） |
| typecheck / lint / verify:consistency / verify:release-gate | 全部 0 |
| 修复版打包（`release-build/win-unpacked`，未触碰 `release/`） | 启动正常、页面渲染正常 |
| 修复版运行时 | `checkStatus` 与 `getInfo` **一致**（均 expired / daysLeft 0）；`[License] 检测到试用锚点密文但无法解密…` WARN 已输出 |

## 5. 未闭环项（外部依赖）

本机无有效授权，且 `scripts/kone-offline-private.pem` 与 `KONE_OFFLINE_PRIVATE_KEY` 均不存在，
无法签发激活码；`requestTrial` 因锚点 `trialConsumed=true` 拒绝重发。

- 设备识别码：`79f5bd1889a2ad7c5abf1a907b207df73994ccbbe1190cf436740c1ad636526d`
- 签发命令（由持私钥方执行）：
  `node scripts/generate-offline-license.cjs 79f5bd1889a2ad7c5abf1a907b207df73994ccbbe1190cf436740c1ad636526d premium <expiresAtMs> KONE-PREMIUM`

## 6. 操作说明（重要）

- 诊断期间曾以 dev 模式做对照测试，触发 `syncTrialAnchor()` 正常写入，将 secrets 中
  `2026-11-09` 的 trial claims 覆盖为锚点值 `2026-10-18`。该记录当时已无法通过锚点校验
  （授权本就不可用），但它是 `2026-11-02` 授予的唯一可读证据。
  **教训**：涉及授权状态的对照测试必须先隔离 userData 与锚点根目录。
- 工具修复：`scripts/verify-packaged-premium.cjs` 增加 `KONE_PACKAGED_DIR` /
  `KONE_REMOTE_DEBUGGING_PORT`，并在启动前检测端口占用（此前 9222 被其它调试浏览器占用时
  会**连到别人的页面产生假结果**），结束时显式 `process.exit`（此前会挂起不返回）。
