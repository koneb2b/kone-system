# KONE V1.3 · 审批门禁端到端验证清单

> 用途：在**干净机器**上一次跑完「Phase 2.9 审批链路验证」+「门禁开启决策」+「交付前人工冒烟」。
> 日期：2026-10-07 ｜ 执行人：____ ｜ 环境：____
> 前置阅读：`KONE-V1.3-干净机器验收手册-2026-09-25.md`（20 项交付冒烟，与本清单第 6 节配套使用）

---

## 为什么必须人工做

以下三项**无法在开发机自动化**，必须在真实环境人工执行：

1. **审批链路端到端**：需要真实 Cloudflare Worker + D1 + Resend 凭据
2. **门禁开启决策**：开启后若链路有遗漏，会导致投递全部被拒（生产事故），需先验证
3. **交付冒烟**：安装包在干净机器的真实行为（依赖、激活、网络）

---

## 0. 部署进展（2026-10-08 已自动完成）

以下步骤已由 AI 使用已登录的 Cloudflare 账号（`hek99481@gmail.com`）**自动执行完毕**：

| # | 步骤 | 结果 |
|---|---|---|
| 0.1 | `wrangler d1 create kone-leads` | ✅ `fab350bd-1772-40ea-8095-7886bdee5024`（WNAM） |
| 0.2 | 补入 `database_id` 到 `wrangler.toml` | ✅ 修复了配置缺口（此前缺失导致从未部署成功） |
| 0.3 | `wrangler d1 migrations apply --remote` | ✅ 5 个 migration 全部应用（001–005） |
| 0.4 | `wrangler deploy` | ✅ `https://kone-cloud.hek99481.workers.dev` |
| 0.5 | 绑定校验 | ✅ D1 `kone-leads` / `SCHEMA_VERSION=1.0.0` / `APPROVAL_GATE_ENABLED=false` |
| 0.6 | 流量校验 | ✅ Version `95de6db9…` 100% 流量 |

### 0.7 Secrets 配置与发信验证（2026-10-08 已完成）

| # | 项目 | 结果 |
|---|---|---|
| 0.7.1 | `wrangler secret put RESEND_API_KEY` | ✅ 已加密写入 Cloudflare |
| 0.7.2 | `wrangler secret put CRON_SECRET` | ✅ 已生成随机值并写入 |
| 0.7.3 | `wrangler secret list` | ✅ 两项均已登记 |
| 0.7.4 | **真实发信验证** | ✅ 通过 Resend API 发出测试邮件，返回 ID `01a11be5-…` |

**发信验证细节**：使用 Resend 的 `onboarding@resend.dev` 测试发信地址，
向账号自有邮箱 `koneb2b@163.com` 发送，Resend 接受并返回邮件 ID →
**证明发信链路（API Key + 网络 + 权限）完全可用**。

> ⚠️ **Resend 账号约束（重要）**：
> 1. 账号注册邮箱为 **`koneb2b@163.com`**（非 gmail）。
> 2. 未验证域名时，**只能发到账号自有邮箱**；发给其他收件人必须先在
>    `resend.com/domains` **验证自有域名**，并把 `from` 改为该域名下的地址。
> 3. 当前 API Key 权限为 `restricted_api_key`（**仅发送邮件**）——这是最小权限的良好实践，
>    但意味着**无法通过 API 查询域名/邮件状态**，需在控制台查看。
>
> → **正式交付前必须完成：验证发信域名**（与 `wrangler.toml` 中预留的
> `SENDER_DOMAIN` 对应）。

### 0.8 待配置：`RESEND_WEBHOOK_SECRET`

Webhook 用于接收「送达 / 退信 / 投诉 / 回复」回执。配置步骤：
1. 在 Resend 控制台 → Webhooks → Add Endpoint
2. URL 填：`https://kone-cloud.hek99481.workers.dev/webhooks/resend`
   （或绑定自定义域名后使用自有域名 —— **推荐**）
3. 事件勾选：`email.delivered` / `email.bounced` / `email.complained`
4. 复制生成的 **Signing Secret**（`whsec_` 开头）
5. 执行 `wrangler secret put RESEND_WEBHOOK_SECRET`

> 说明：Resend 服务器从**海外**回调本 Worker，**不受国内 DNS 污染影响**，
> 因此用 `workers.dev` 地址也能收到回执；但本机无法直接访问该地址验证。

### 0.9 ✅ 自定义域名绑定 —— 国内可直连（关键突破）

**问题**：`*.workers.dev` 在国内被 DNS 污染，客户端无法连接。

**解决**：绑定账号自有域名 `aigctohuman.com` 的子域名。
该域名已由 Cloudflare 托管，实测解析到**真实 Cloudflare IP**
（`104.21.38.188` / `172.67.137.95`），**未被污染**。

```toml
# wrangler.toml 顶层（必须在任何 [table] 之前，否则被解析进上个表）
routes = [
  { pattern = "kone-cloud.aigctohuman.com", custom_domain = true }
]
```

**验证结果**：
```
GET https://kone-cloud.aigctohuman.com/healthz
→ {"success":true,"data":{"status":"ok","schemaVersion":"1.0.0"}}  HTTP 200 ✅
```

> 踩坑记录：首次部署报
> `Unexpected fields found in d1_databases[0] field: "routes"` ——
> TOML 中表头之后的所有键都归属该表，`routes` 必须放在**顶层**（所有 `[[...]]` 之前）。

### 0.10 ✅ 工作区与 API Token 已创建

| 项 | 值 |
|---|---|
| 工作区 ID | `ws_kone_1791469852` |
| Worker URL（客户端配置用） | `https://kone-cloud.aigctohuman.com` |
| API Token | 见交付私密渠道（**不写入仓库**） |

**鉴权验证**：
```
GET /v1/dashboard/stats  (Bearer <token>)
→ {"success":true,"data":{"leads":{...},"outreach":{...},"syncVersion":0}}  HTTP 200 ✅
```
→ 同时印证了 [1.3.14] 修复的 P0-1：`dashboardStats` 返回字段确为 camelCase
（`pendingApproval` / `syncVersion`），前端可直接消费。

### ⚠️ 阻塞项：`*.workers.dev` 在国内网络被 DNS 污染

实测（2026-10-08）：

```
nslookup kone-cloud.hek99481.workers.dev
→ 2a03:2880:f11c:8083:face:b00c:0:25de   （Meta/Facebook IPv6 段，非 Cloudflare）
→ 211.104.160.39                          （韩国 IP，非 Cloudflare）
curl https://kone-cloud.hek99481.workers.dev/healthz → 000
```

- 换用 `1.1.1.1`（超时）与 `8.8.8.8`（同样返回污染结果）**均无法绕过** → 属网络层拦截。
- `wrangler dev --remote` 建立隧道也失败（`fetch failed`）。
- **结论：国内网络环境必须绑定自定义域名**（如 `wrangler.toml` 中预留的
  `outreach.kone-cloud.com`），`workers.dev` 默认域名不可用。
  这与项目原本的设计方向一致，但此前未作为**硬约束**记录。

> **因此本清单第 5 节的 HTTP 验证，需在绑定自定义域名后、或在可访问
> `workers.dev` 的网络环境中执行。**

---

## 1. 环境准备

| # | 检查项 | 命令 / 操作 | 期望 | ✅ |
|---|---|---|---|---|
| 1.1 | 干净机器（无 Kone 历史安装） | — | 无残留 userData | ☐ |
| 1.2 | Node 版本 | `node -v` | ≥ 22 | ☐ |
| 1.3 | 安装包 | 使用 `release/` 下最新安装包 | 可安装 | ☐ |
| 1.4 | Cloudflare 账号 + D1 数据库 | `wrangler d1 list` | 见 `kone-leads` | ☐ |
| 1.5 | Resend 账号 + 已验证发信域名 | Resend 控制台 | 域名 Verified | ☐ |

---

## 2. 云端部署（含新 migration）

| # | 操作 | 命令 | 期望 | ✅ |
|---|---|---|---|---|
| 2.1 | 应用全部 migration（含 **005_approval_gate**） | `cd kone-cloud && npx wrangler d1 migrations apply kone-leads --remote` | 005 已应用 | ☐ |
| 2.2 | 确认 005 只加了索引 | 查 D1：`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_approvals_lead_decision'` | 返回该索引 | ☐ |
| 2.3 | 配置密钥 | `wrangler secret put RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` / `CRON_SECRET` | 均设置成功 | ☐ |
| 2.4 | **首次部署保持门禁关闭** | 确认 `wrangler.toml` 中 `APPROVAL_GATE_ENABLED = "false"` | 为 false | ☐ |
| 2.5 | 部署 | `npx wrangler deploy` | 部署成功 | ☐ |
| 2.6 | 健康检查 | `curl https://<worker>/healthz` | `200` | ☐ |

---

## 3. 本地配置与激活

| # | 操作 | 期望 | ✅ |
|---|---|---|---|
| 3.1 | 安装并启动客户端 | 正常启动无报错 | ☐ |
| 3.2 | 激活高级版授权（Premium/Enterprise） | 显示已激活 | ☐ |
| 3.3 | 设置 → 云端引擎：填 Worker URL + API Key | 显示"已连接" | ☐ |
| 3.4 | 点击"测试连接" | 返回成功 + 延迟 | ☐ |
| 3.5 | 设置 → 邮箱：填 IMAP 主机/用户/密码 | 保存成功 | ☐ |
| 3.6 | 点击 IMAP"测试连接" | 返回 `INBOX 共 N 封邮件` | ☐ |

---

## 4. 审批链路验证（**门禁关闭时**，先验证链路本身）

> 目的：确认"批准 → 发送"链路通畅，再开门禁。此阶段门禁为 `false`，即使有 bug 也不会阻断投递。

| # | 操作 | 期望 | ✅ |
|---|---|---|---|
| 4.1 | 搜索并保存若干线索到线索库 | 线索出现在线索表 | ☐ |
| 4.2 | 打开筛选 → 勾选「**仅显示待审批线索**」 | 未批准的线索全部显示（**新增功能**） | ☐ |
| 4.3 | 对某线索点「**批准**」 | Toast「已批准」；按钮变「已批准」并置灰 | ☐ |
| 4.4 | 再点「发送至云端」 | 提交成功 | ☐ |
| 4.5 | 取消勾选「仅显示待审批线索」 | 已批准线索仍在列表中 | ☐ |
| 4.6 | 对另一线索点「**驳回**」 | Toast「已驳回」；按钮变「已驳回」 | ☐ |
| 4.7 | 对已驳回线索尝试「发送至云端」 | **按钮置灰不可点**（UI 双保险） | ☐ |
| 4.8 | 云端核对审批记录 | D1：`SELECT decision, draft_version FROM approvals ORDER BY approved_at DESC LIMIT 5` | 有 approved/rejected 记录 | ☐ |
| 4.9 | 云端核对审计事件 | D1：`SELECT type FROM events WHERE type LIKE 'approval%' OR type LIKE 'lead.app%'` | 有 `approval.created` / `lead.approved` | ☐ |

**若 4.x 全绿 → 链路可用，可进入第 5 节。**

---

## 5. 门禁开启验证（**关键决策点**）

> ⚠️ 开启前请确认第 4 节全部通过。开启后未批准的投递会被拒绝。

| # | 操作 | 期望 | ✅ |
|---|---|---|---|
| 5.1 | 改 `wrangler.toml`：`APPROVAL_GATE_ENABLED = "true"` | 已改 | ☐ |
| 5.2 | 重新部署 | `npx wrangler deploy` 成功 | ☐ |
| 5.3 | 对**未批准**线索尝试投递（绕过 UI，用 curl 调 `/v1/outreach/queue`） | 返回 `403` + `APPROVAL_REQUIRED` | ☐ |
| 5.4 | 对**已批准**线索正常投递 | 返回 `200` + `queued: true` | ☐ |
| 5.5 | 构造**草稿版本不符**（curl 传 `draftVersion: 999`） | 返回 `409` + `DRAFT_VERSION_MISMATCH` | ☐ |
| 5.6 | 触发一次真实投递（Resend 实际发信） | 收件人收到邮件 | ☐ |
| 5.7 | 云端核对配额写入 | D1：`SELECT today_key, sent_today FROM delivery_quota` | `sent_today` ≥ 1（**新增写入侧**） | ☐ |
| 5.8 | 等待 Resend webhook 回执 | D1：`SELECT status, delivered_at FROM outreach ORDER BY created_at DESC LIMIT 1` | `delivered` + `delivered_at` 非空（**验证 P0-1/P0-3 修复**） | ☐ |
| 5.9 | 本地看板核对 | 「投递明细」显示该条且**时间戳非空**（**验证 P0-1 映射修复**） | 时间戳有值 | ☐ |
| 5.10 | 回复该邮件后等 IMAP 轮询（或点"立即轮询"） | 状态变 `replied`；本地看板同步 | ☐ |

**5.9 / 5.8 是本清单最有价值的两项** —— 它们直接验证了本次修复的两个 P0（字段映射断裂、webhook 去重键错配）。

---

## 6. 交付前人工冒烟（20 项）

按 `KONE-V1.3-干净机器验收手册-2026-09-25.md` 逐项执行，20 个判定框全部勾选。

| # | 检查 | ✅ |
|---|---|---|
| 6.1 | 20 项判定框全部为 ☑（当前文档中全为 ☐） | ☐ |

---

## 7. 打包冒烟（B2）

| # | 操作 | 期望 | ✅ |
|---|---|---|---|
| 7.1 | 在**无 app.asar 进程锁**的环境执行 `npm run test:smoke` | 通过 | ☐ |
| 7.2 | 确认 `tests/packaged-smoke-report.json` 更新且为通过态 | 通过 | ☐ |

> 已知问题：开发机上 `release/win-unpacked/resources/app.asar` 被系统进程持有，属环境问题。

---

## 8. 判定与留证

### 通过标准
- 第 4 节 **9/9** 通过（审批链路）
- 第 5 节 **10/10** 通过（门禁开启后行为正确）
- 第 6 节 20 项全勾选
- 第 7 节通过（或记录为环境限制）

### 留证要求
1. 本清单填写完整（含执行人、环境、日期）
2. 关键步骤截图：4.3 批准、4.7 置灰、5.3 拒绝响应、5.9 看板时间戳
3. 云端 SQL 查询结果截图（4.8 / 4.9 / 5.7 / 5.8）
4. 归档至 `.workbuddy-ai/memory/` 并更新 `CHANGELOG.md`

### 全部通过后
1. 将 `CLOUD-COLLABORATION-DELIVERY.md` §0 的发布判定由 `NO-GO` 改为 `GO`
2. `APPROVAL_GATE_ENABLED` 保持 `"true"` 并提交
3. 在 `CHANGELOG.md` 记录 `[1.4.0]` 的验收证据

---

## 附：curl 验证片段（第 5.3 / 5.5 用）

```bash
# 5.3 未批准 → 期望 403 APPROVAL_REQUIRED
curl -s -X POST "https://<worker>/v1/outreach/queue" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -H "X-Schema-Version: 1.0.0" \
  -d '{"leadId":"<未批准的leadId>","subject":"t","body":"b","draftVersion":0}'

# 5.5 草稿版本不符 → 期望 409 DRAFT_VERSION_MISMATCH
curl -s -X POST "https://<worker>/v1/outreach/queue" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -H "X-Schema-Version: 1.0.0" \
  -d '{"leadId":"<已批准的leadId>","subject":"t","body":"b","draftVersion":999}'
```
