# Kone V1.4 架构优化执行计划

## ⛓️ P0 — IPC 强制合约与运行时校验
- [x] T1: 在 `electron/ipc/` 下创建 contracts/ 目录，为每个核心 channel 定义 zod/valibot 合约
- [x] T2: 创建 `electron/ipc/validate.ts` 运行时校验层（dev 严格/prod 可跳过）
- [x] T3: 创建 `electron/ipc/registry.ts` channel 注册中心，启动时断言 handler 有合约
- [x] T4: 迁移核心 channel（search:execute, analysis:generate, autopilot.*）到新合约

## 🛡️ P0 — 三层测试护城河 + CI
- [x] T5: 创建 `.github/workflows/ci.yml` GitHub Actions 工作流
- [x] T6: 修复 `package.json` 脚本对齐（已完成）
- [x] T7: 编写 `scripts/security-audit.cjs` 安全审计脚本

## 🔧 P1 — 防御纵深安全层
- [x] T8: IPC channel 白名单（未注册 channel renderer 不能调用）
- [x] T9: 敏感数据加密路由（API Key 不存明文）
- [x] T10: 授权审计日志

## 🏗️ P1 — 统一环境模式
- [x] T11: 创建 `electron/dev/dev-mode.ts` 集中管理 dev-only 行为
- [x] T12: 废弃 `src/main.tsx` dev shell，统一 Electron dev

## 📋 P1 — 工程规范
- [x] T13: ESLint 配置（已完成基线）
- [x] T14: Prettier 配置
- [x] T15: husky + lint-staged git hooks

## 🌐 P2 — 商业成熟度
- [x] T16: 主进程错误文案改用 code + i18n 映射
- [x] T17: electron-updater 自动更新集成 (investigation)
- [x] T18: 崩溃自动上报 + 堆栈符号化

## Final Verification Wave
- [x] F1: Plan Compliance Audit — oracle
- [x] F2: Code Quality Review — unspecified-high
- [x] F3: Real Manual QA — unspecified-high
- [x] F4: Scope Fidelity Check — deep
