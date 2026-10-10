# Kone UI/UX 深度优化 — 去 AI 痕迹与设计一致性

> 视觉证据：浏览器实测截图 8 个页面（搜索/线索/数据中心/知识库/设置/账号/AI销售团队/自动化/团队协作）。
> 原则：不引入新依赖（lucide-react + shadcn/ui 已覆盖）；不改业务逻辑；宪法与文案边界不动。

## 视觉审计结论

### A. Emoji 痕迹（31 处，最高优先）
| Emoji | 位置 | 语义 | 替换方案 |
|---|---|---|---|
| 🤖 ×4 | search-input 输入框内 / search-progress 阶段文案 ×3 / search-result-card | AI 装饰 | 删除（语义已有文字） |
| 💡 ×4 | search-progress ×2 / location-inputs / icp-settings-tab | 提示 | lucide `Info` |
| 🚀 ×1 | search-engine 伴随式巡航 | 巡航 | lucide `Radar` |
| ✨ ×1 | search-engine 搜索语法模板 | 模板 | lucide `BookMarked` |
| ⚡ ×2 | search-engine 数据源实时徽标 / 智能触达卡 | 实时/工作流 | lucide `Activity` / `Workflow` |
| 🔗 📁 ×2 | search-engine | 链接/导出 | lucide `Link2` / `FolderOpen` |
| 💎 ×1 | app-sidebar 特权港分组 | 特权 | lucide `KeyRound` |
| 📦 🏛️ ×2 | analysis-drawer 海关/展会徽标 | 海关/展会 | lucide `Ship` / `Landmark` |
| ⚠ ✓ ✗ ✉ | leads-management / automation-workflow / base-settings-tab | 状态符号 | lucide `AlertTriangle` / `Check` / `X` / `Mail` |

### B. 泛用 AI 图标收敛（Sparkles ×6 / Zap ×5 / Rocket ×2 / Crown ×4 / Bot ×2）
- 装饰性 Sparkles（团队协作云端引擎、知识库保存等）→ 按语义换 `CloudCog`/`Save`
- Zap 装饰位 → `Workflow`/`Gauge`；Rocket → `Radar`
- Bot 保留于侧边栏"AI 销售团队"导航（功能标识），移除装饰性使用

### C. 开发文案泄漏（正式界面不专业）
- main.tsx devShellApi 文案："开发壳模式：真实自动触达请通过 npm run dev 启动 Electron 主进程" → 改为用户视角文案（"本地引擎未连接，请在桌面应用中使用完整功能"）

### D. 视觉一致性
- 统计卡图标底色随机彩色（蓝/绿/黄/紫/橙）→ 统一品牌化：slate 中性底 + 语义色仅用于状态
- 空状态：虚线框 → 统一居中图标+主次文案
- 动效：统一 `transition` hover 反馈、进度条/加载动画保留并收敛
- 渐变仅保留激活屏品牌主视觉 1 处，其余收敛

## 实施批次
1. 搜索链路（search-input/progress/result-card/location-inputs/search-engine）
2. 侧边栏与抽屉（app-sidebar/analysis-drawer/leads-management/automation-workflow/base-settings-tab/icp-settings-tab）
3. 泛用图标收敛 + 开发文案中性化（main.tsx devShellApi + agents-panel + team-dashboard 等）
4. 统计卡图标底色统一 + 空状态统一
5. 截图复验 + 全量回归 + 入库
