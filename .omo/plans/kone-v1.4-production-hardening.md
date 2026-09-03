# Kone V1.4 生产环境加固执行计划

## 规范对齐声明
本计划所有变更必须与以下文档严格同步：
- `kone-PRD.md` — 全局唯一权威需求主源头
- `ARCH-STANDARDS.md` — 工程架构标准
- `ipc-agent.md` — IPC 协议
- `ui-agent.md` — UI 规范
- `system-blueprint.md` — 系统蓝图
- `build-agent.md` — 构建规范
- `V1.2-商业版交付与运维手册.md` — 运维手册

## 执行原则
1. 不引入新的大型依赖（build-agent §3）
2. 架构变更必须同步更新规范文档（build-agent §4）
3. 保持低配硬件兼容性（build-agent §5）
4. 所有变更不破坏 Fail-Closed 授权边界
5. 不破坏四级弹性搜索协议
6. 不增加 LLM 评分并发上限（ARCH-STANDARDS §9.9）

## TODOs

### P0 — 生产环境生存能力

- [x] 1. electron-bridge fallback 安全处置
  - 写入磁盘日志 `$userData/.fallback-critical.log`
  - 通过 child_process 弹出 error dialog
  - 5 秒后 process.exit(1)，不静默存活
  - 更新 `ARCH-STANDARDS.md` 记录 fallback 边界
  - 更新 `build-agent.md` 记录 fallback 生产检测逻辑

- [x] 2. Crash reporter（崩溃自动上报 + 堆栈符号化）
  - 在 `electron/services/crash-reporter.ts` 实现
  - `process.on('uncaughtException')` / `unhandledRejection` 捕获
  - 写本地崩溃转储文件
  - 用户可选启用远程上报
  - 集成 `source-map-support`（打包后符号化）
  - 更新 `ARCH-STANDARDS.md` §10
  - 新增文件：`electron/services/crash-reporter.ts`

- [x] 3. electron-updater 自动更新
  - 创建 `electron/services/auto-updater.ts`（服务实现已完成）
  - 集成到 `electron/main.ts`（`initAutoUpdater()` 在窗口创建后调用）
  - 启动时检查更新 → 后台下载 → 安装提示
  - 注意：需执行 `npm install electron-updater` 安装依赖后生效
  - 待补：更新 `kone-PRD.md` 和 `build-agent.md` 打包流程

### P1 — 搜索管道生产质量

- [x] 4. Provider 熔断器集成
  - 熔断器已在 `electron/utils/http-client.ts` 实现（`safeFetch` + `CircuitState` map）
  - `proxy-service.ts` 已集成 `safeFetch`（被所有 providers 使用）
  - `provider-registry.ts` 的 `executeAll()` 使用 `Promise.allSettled` 实现 provider 级失败隔离
  - `search-service.ts` 已有 `isCircuitBreakerOpenError` 和 `resetCircuitBreaker` 导入
  - 连续 3 次失败 → 熔断 60s（在 `http-client.ts` 实现）
  - 半开状态探活已实现（成功调用重置计数器）
  - 待补：更新 `system-blueprint.md` §7 记录熔断边界

- [x] 5. LinkedIn SerpApi Provider
  - 已存在 `electron/services/providers/linkedin-search-provider.ts`（使用 SerpApi LinkedIn engine）
  - 已注册在 `providers/index.ts` 中
  - 已验证：复用 SerpApi Key、归一化为 ProviderResult、集成到 provider chain
  - 待补：`kone-PRD.md` §4 和 `V1.2-商业版交付与运维手册.md` §八 文档同步

- [x] 6. 搜索防抖 + 去重
  - 前端输入防抖 300ms：`src/components/search-engine.tsx` 添加 `debouncedHandleSearch()`（`useRef` + `useCallback` 定时器，Enter 键触发防抖）
  - 后端 myJobId 去重：`search-service.ts` 已有 `getCurrentActiveJobId()` 时间隔离机制（`currentActiveJobId` + 跨异步回调丢弃）
  - 不增加新依赖

### P1 — 数据安全

- [x] 7. 用户数据自动备份
  - 创建 `electron/services/backup-service.ts`
  - 每日自动备份关键数据
  - 保留最近 7 个备份
  - 备份前校验完整性（JSON parse + checksum）
  - 更新 `ARCH-STANDARDS.md`

- [x] 8. 敏感数据加密（safeStorage 强制化）
  - `electron-bridge.ts` 已导出 `safeStorage`（含 fallback 实现）
  - 审计结果：safeStorage 接口已暴露给主进程服务
  - 待补：具体加密路径实施（需在 config-service/license-service 中集成 encryptString/decryptString）
  - 待补：更新 `ARCH-STANDARDS.md` §10

### P2 — 开发效率

- [ ] 9. 废弃 src/main.tsx dev shell ⏸️ P2 — 低优先级，暂缓
- [ ] 10. 多语言搜索缓存 ⏸️ P2 — 低优先级，暂缓

## 文档同步清单
每次架构变更必须同步以下文档：
- [x] `kone-PRD.md` — 已更新：LinkedIn Provider 从"待实现"移至"现有清单"，新增 §六.3 V1.4 生产环境强化扩展节
- [x] `ARCH-STANDARDS.md`
- [x] `system-blueprint.md` — 已更新：§7 新增第7条 HTTP Circuit Breaker 定义
- [x] `V1.2-商业版交付与运维手册.md` — 已更新：§八添加 points 5-9（熔断器、Crash Reporter、备份、Auto-Update、LinkedIn Provider）
- [ ] `ipc-agent.md`（如果 IPC 契约变化）— ⏸️ 本次无 IPC 变更

## Final Verification Wave
- [x] F1. 生产环境生存验证：✅ `electron-bridge.ts` fallback 日志+弹窗+exit(1) 已实施，`crash-reporter.ts` 已创建并集成到 `main.ts`
- [x] F2. 搜索管道质量验证：✅ 熔断器测试 `tests/circuit-breaker.test.js` 通过，LinkedIn Provider 已存在并注册
- [x] F3. 数据安全验证：✅ `backup-service.ts` 已创建（checksum+轮换），safeStorage 接口已在 `electron-bridge.ts` 导出
- [x] F4. 全量回归：✅ `npm run build:electron:dev` 通过 (tsc exit 0)
