/**
 * electron-builder 代码签名配置（B-2 预备）
 *
 * 用途：在**基础配置**（package.json#build）之上叠加 Windows Authenticode 签名。
 * 独立成文件的目的——**不破坏未签名构建**：未采购证书时 `npm run dist` 照常可用；
 * 证书到位后改用 `npm run dist:signed`（`--config electron-builder.sign.cjs`）即启用签名。
 *
 * 前置（证书到位后）：
 *   1. 将 .pfx 证书放到 build/cert/kone-codesign.pfx（.gitignore 已忽略 build/cert/、*.pfx）
 *   2. 设置环境变量 KONE_CERT_PASSWORD=<证书密码>
 *   3. npm run dist:signed  →  npm run verify:signature
 *
 * 说明：本文件在证书到位前**无法本地验证**（无证书则 electron-builder 会因找不到
 * certificateFile 而报错），属"预备就绪、待证书"状态。
 */
const pkg = require('./package.json')

module.exports = {
  ...pkg.build,
  win: {
    ...pkg.build.win,
    certificateFile: 'build/cert/kone-codesign.pfx',
    certificatePassword: process.env.KONE_CERT_PASSWORD,
    signingHashAlgorithms: ['sha256'],
    // RFC 3161 时间戳：确保签名在证书过期后仍长期有效
    rfc3161TimeStampServer: 'http://timestamp.digicert.com',
    signAndEditExecutable: true,
  },
}
