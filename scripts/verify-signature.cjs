#!/usr/bin/env node
/**
 * verify-signature.cjs — 打包产物代码签名校验（B-2）
 *
 * 用法：
 *   node scripts/verify-signature.cjs [输出目录]         # 默认 release
 *   node scripts/verify-signature.cjs release-build --strict
 *
 * 行为：
 *   - 产物已签名 → 打印 signtool 校验输出，退出 0
 *   - 未签名 / signtool 不可用 → 打印 WARNING；默认退出 0（证书尚未接入属预期），
 *     加 --strict 则退出 1（供证书到位后的 CI 硬门禁）
 *
 * 注：signtool 可用性用 `where`/`which` 探测（与本地化报错文案无关——中文 Windows
 * 的 "不是内部或外部命令" 无法用英文正则匹配）。
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const rootDir = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const strict = args.includes('--strict')
const outDir = (args.find((a) => !a.startsWith('--')) || process.env.KONE_PACKAGED_ROOT || 'release').trim()

const exePath = path.join(rootDir, outDir, 'win-unpacked', 'KoneAI.exe')
if (!fs.existsSync(exePath)) {
  console.error(`❌ 未找到可执行文件: ${exePath}`)
  process.exit(1)
}

const hasSigntool = () => {
  for (const probe of ['where signtool', 'which signtool']) {
    try {
      execSync(probe, { stdio: 'ignore' })
      return true
    } catch {
      /* try next */
    }
  }
  return false
}

if (!hasSigntool()) {
  console.warn(`⚠️ signtool 不可用，跳过签名校验（证书/Windows SDK 尚未接入，属预期）— ${exePath}`)
  process.exit(strict ? 1 : 0)
}

try {
  const out = execSync(`signtool verify /pa /v "${exePath}"`, { stdio: 'pipe' }).toString()
  console.log('✅ 代码签名校验通过')
  console.log(out.split('\n').slice(0, 12).join('\n'))
  process.exit(0)
} catch (error) {
  // signtool 可用但校验失败：多为"未签名"。中文/英文文案均覆盖。
  const combined = `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`
  if (/no signature|not signed|unsigned|未签名|没有签名|无签名/i.test(combined)) {
    console.warn(`⚠️ 产物未签名（证书尚未接入，属预期）— ${exePath}`)
    process.exit(strict ? 1 : 0)
  }
  console.error('❌ 签名校验失败:', combined.slice(0, 400))
  process.exit(1)
}
