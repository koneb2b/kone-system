/**
 * 视觉自动化验证总入口 —— 一次跑完全部 UI 探针。
 *
 * ## 存在的意义
 * 「样式/数据完不完善」这类判断**必须看渲染结果**。本脚本让 AI（或人）
 * 无需人工截图即可自动验证：
 *   1. 设计 token 是否生效（bg-primary 等语义类）
 *   2. 各页面是否正常渲染（不命中 ErrorBoundary）
 *   3. 客户资料下载端的导出内容是否正确（表头 / 决策人 / 可触达渠道）
 *
 * 产出截图落在仓库根 `probe-*.png`，供视觉复核。
 *
 * 用法：`npm run test:visual`（自带 Vite 启停）
 * 前置：需 `npm i -D concurrently wait-on`（若尚未安装）。
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const NODE = process.execPath

const steps = [
  { name: '设计 token 生效性', script: 'probe-design-tokens.cjs' },
  { name: '逐页渲染回归', script: 'probe-regression-visual.cjs' },
  { name: '客户资料下载端', script: 'probe-export-center.cjs' },
]

let failed = 0
for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`)
  const res = spawnSync(NODE, [path.join(__dirname, step.script)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  })
  if (res.status !== 0) {
    failed += 1
    process.stdout.write(`❌ ${step.name} 失败（exit ${res.status}）\n`)
  } else {
    process.stdout.write(`✅ ${step.name} 通过\n`)
  }
}

process.stdout.write(`\n===== 视觉验证汇总：${steps.length - failed}/${steps.length} 通过 =====\n`)
process.exit(failed > 0 ? 1 : 0)
