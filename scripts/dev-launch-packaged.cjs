/* 打包版常驻启动器 —— 供人工/自动化在**打包产物**上做功能与视觉验证。
 *
 * ## 与 packaged-smoke.cjs 的区别
 * 冒烟脚本「启动 → 截图 → 退出」；本脚本「启动 → **保持运行**」，
 * 便于外部用 puppeteer.connect('http://127.0.0.1:9222') 持续交互测试。
 *
 * ## 为什么必须用这种方式启动（踩坑记录）
 * - Git Bash 的 `(cmd &)` 后台进程会**随 shell 结束被终止** → 进程消失、日志为空
 * - Node `spawn(..., {detached:true})` + `unref()` 同样不稳（实测进程僵死、9222 不开）
 * - **可用方式**：前台 spawn + `stdio:['ignore','pipe','pipe']`，由调用方负责保活
 *   （在 Agent 环境里用 run_in_background，或人工开一个终端）
 *
 * ## 调试端口的前置条件
 * 端口**只在** `KONE_SMOKE_TEST=1` 或 `KONE_REGRESSION_TEST=1` 时开启
 * （见 electron/main.ts:55）。否则应用正常启动但**不监听 9222**。
 *
 * 用法：node scripts/dev-launch-packaged.cjs [输出目录，默认 release-v140]
 */
const { spawn, execSync } = require('node:child_process')
const path = require('node:path')

const rootDir = path.join(__dirname, '..')
const outputDir = (process.argv[2] || 'release-v140').trim()
const unpackedRoot = path.join(rootDir, outputDir, 'win-unpacked')
const executablePath = path.join(unpackedRoot, 'KoneAI.exe')

/* 与冒烟脚本一致：先清理残留实例（KoneAI.exe 固定绑定 9222，
   残留进程会导致新实例绑定失败，或让连接指向旧实例）。 */
try {
  execSync('taskkill /F /IM KoneAI.exe', { stdio: 'ignore' })
} catch {
  /* 无残留进程时 taskkill 返回非零，忽略 */
}

const childEnv = {
  ...process.env,
  KONE_SMOKE_TEST: '1',
  ELECTRON_ENABLE_LOGGING: '1',
}
delete childEnv.ELECTRON_RUN_AS_NODE

const proc = spawn(executablePath, [], {
  cwd: unpackedRoot,
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
})

proc.stdout.on('data', (c) => process.stdout.write(`[app] ${c}`))
proc.stderr.on('data', (c) => process.stderr.write(`[app:err] ${c}`))
proc.on('exit', (code) => {
  console.log(`[launcher] 应用已退出，code=${code}`)
  process.exit(0)
})

console.log(`[launcher] 已启动 ${executablePath}`)
console.log('[launcher] 调试端口 http://127.0.0.1:9222 （KONE_SMOKE_TEST=1）')
console.log('[launcher] 保持运行中，Ctrl+C 结束')
