# 商用收尾技术方案：B-2 代码签名 + B-4 持久化规模化

> **日期**：2026-09-25 ｜ **基线**：HEAD（B-1/B-5 已解除）
> **性质**：立项/实施设计（供决策）。B-2 需外部采购，B-4 需排期。
> **前置事实**：B-1（安装包）+ B-5（打包冒烟）已解除；剩余阻断 = B-2 / B-3 / B-4。

---

## 一、B-2 代码签名接入方案

### 1.1 现状（事实）
- `package.json#build` **无任何签名配置**；`build/` 仅含图标，无 `.pem`/`.pfx`。
- 打包日志显示 electron-builder 会调用 `signtool.exe`，但**无证书即无实际签名**。
- 影响：Windows SmartScreen 对未签名安装包/可执行文件告警，降低信任与安装转化。

### 1.2 证书选择

| 类型 | 信任度 | 价格（参考） | 适用 |
|---|---|---|---|
| **OV（Organization Validation）** | 中（需累积声誉，初期仍有告警） | 较低 | 起步阶段 |
| **EV（Extended Validation）** | 高（SmartScreen 立即信任） | 较高 | **推荐商用**（外贸 B2B 客户对信任敏感） |

> 需向 CA（DigiCert / Sectigo / 或国内 CA）采购 **Windows Authenticode 代码签名证书**（.pfx + 密码）。

### 1.3 electron-builder 配置（证书到位后即可接入）

```jsonc
// package.json → build.win 增补
"win": {
  "icon": "build/icon.ico",
  "target": ["nsis"],
  "certificateFile": "build/cert/kone-codesign.pfx",   // 证书文件（勿入库）
  "certificatePassword": "${env.KONE_CERT_PASSWORD}",  // 从环境变量注入
  "signingHashAlgorithms": ["sha256"],
  "rfc3161TimeStampServer": "http://timestamp.digicert.com",  // 时间戳（签名长期有效）
  "signAndEditExecutable": true
}
```

**配套**：
- `.gitignore` 已含 `*.pem`；**追加 `*.pfx` / `build/cert/`**（证书绝不入库）。
- CI（`.github/workflows/ci.yml` 的 packaged job）从 GitHub Secrets 注入 `KONE_CERT_PASSWORD` 与证书 base64（解码到临时路径）。

### 1.4 验证方式（可观测）
```powershell
signtool verify /pa /v "release\win-unpacked\KoneAI.exe"
signtool verify /pa /v "release\Kone-Intellect-Setup-1.3.0.exe"
```
→ 期望输出 `Successfully verified` + 证书主体/时间戳链。**建议纳入 `packaged-smoke` 后的一个 `verify:signature` 步骤**（证书缺失时跳过并告警，不误判红）。

### 1.5 工作量与依赖
| 项 | 依赖 |
|---|---|
| 证书采购 | **外部**（CA 审核，OV 约 1-3 工作日，EV 约 3-7 工作日） |
| 配置接入 | **~0.5 天**（改 `package.json` + CI secret + 验证脚本） |
| 验证 | ~0.5 天 |

**结论**：**唯一外部依赖是证书**；证书到位后接入成本极低（半天内可完成并验证）。

---

## 二、B-4 持久化规模化方案（单 JSON → SQLite）

### 2.1 现状（事实）
- `electron/services/config-service.ts`：**单 JSON 文件**（`$userData/kone-config.json`），原子写（tmp + rename）。
- 关键键：`agent_status`（per-lead 触达状态）、`user_config`（含 providers/ICP）、`autopilot_*` 等。
- `backup-service.ts`：24h 自动备份（MD5 校验 + 7 份轮转）。
- **痛点**：全量 `JSON.stringify` + 全量写；线索池增长后（数千条）写入放大、读取全量反序列化、无索引/查询能力。

### 2.2 目标架构

```
electron/services/persistence/
├── db.ts              # better-sqlite3 单例（WAL 模式）
├── migrations/        # 版本化迁移（001_init.sql, 002_*.sql ...）
├── repositories/
│   ├── leads-repo.ts        # 线索池（含 agentStatus）
│   ├── config-repo.ts       # 配置键值
│   └── autopilot-repo.ts    # 巡航状态
└── index.ts           # 门面：保持 config-service 现有 API 不变
```

**表设计（初稿）**：
```sql
CREATE TABLE leads (
  lead_key TEXT PRIMARY KEY,        -- 稳定 UUID
  company TEXT, website TEXT, email TEXT, phone TEXT, address TEXT,
  match_score INTEGER, score_source TEXT,
  data_source_type TEXT, agent_status TEXT,  -- JSON 列（per-lead 触达态）
  created_at INTEGER, updated_at INTEGER
);
CREATE INDEX idx_leads_score ON leads(match_score DESC);
CREATE INDEX idx_leads_updated ON leads(updated_at DESC);

CREATE TABLE kv_config (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER);
```

### 2.3 迁移策略（渐进，零数据丢失）

| 阶段 | 动作 | 回滚点 |
|---|---|---|
| **M1 双写** | 保留 JSON 为 SSOT；每次写入同时落 SQLite（影子写） | 关掉双写即回滚 |
| **M2 读切换** | 读路径切到 SQLite；JSON 仍写（保底） | 切回 JSON 读 |
| **M3 首启迁移** | 首次启动把现有 `kone-config.json` 全量导入 SQLite（幂等 + 校验条数） | 保留 JSON 原件 |
| **M4 收敛** | SQLite 为唯一 SSOT；JSON 仅作导出/兼容 | 从备份恢复 |

**关键保障**：
- **迁移幂等**：`schema_migrations` 表记录已应用版本；重复启动不重复迁移。
- **回滚**：M1-M3 期间 JSON 始终可回退；M4 前保留最近 7 份备份（复用 `backup-service`）。
- **兼容**：`config-service` 对外 API **签名不变**（`get/set/...`），内部换实现 → 调用方零改动。

### 2.4 依赖与风险
| 项 | 说明 |
|---|---|
| 新增依赖 | `better-sqlite3`（同步 API，适合 Electron 主进程；需 `@electron/rebuild` 原生模块重编译——打包链路已含 rebuild 步骤） |
| 打包影响 | 原生模块需进 asar.unpacked（electron-builder 默认处理 native modules） |
| 风险 | 原生模块跨版本编译；WAL 文件锁（单进程场景可控） |
| 测试 | 迁移幂等单测 + 大库（≥5000 线索）读写基准 + 回滚演练 |

### 2.5 工作量估算
| 阶段 | 估算 |
|---|---|
| M1 双写 + 影子表 | ~3 天 |
| M2 读切换 + 兼容层 | ~2 天 |
| M3 首启迁移 + 校验 | ~2 天 |
| M4 收敛 + 基准 + 回滚演练 | ~3 天 |
| **合计** | **~10 人天**（含测试） |

---

## 三、B-3 云协同（简）——另需产品立项
云协同（审批/二次门禁/投递/抑制/Webhook/回写）闭环属**产品功能立项**，非纯技术收尾；`CLOUD-COLLABORATION-DELIVERY.md` 已定义边界与完成门禁。**建议单独立项**，本方案不展开。

---

## 四、建议排期

| 优先级 | 项 | 前置 | 建议 |
|---|---|---|---|
| **P0** | B-2 代码签名 | 证书采购（外部） | **立即启动采购**；证书到位后 0.5 天接入 |
| **P1** | B-4 持久化（M1-M4） | 排期 | 若线索池规模 > 数千则立项；否则可延后 |
| **P2** | B-3 云协同 | 产品立项 | 按商业节奏单独立项 |

---

## 附：本轮已固化的能力
- `npm run dist:alt` —— 绕锁打包（输出 `release-build/`）。
- `npm run test:smoke:alt` —— 绕锁打包 + 冒烟一步到位。
- `node scripts/packaged-smoke.cjs <dir>` —— 位置参数指定输出目录。

---

*本方案为立项/实施设计快照（2026-09-25）。*
