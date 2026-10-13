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
 * 说明：本文件在证书到位前**无法本地完成签名**（无证书则 electron-builder 会因找不到
 * certificateFile 而报错），属"预备就绪、待证书"状态。
 *
 * ⚠️ 2026-10-11 修正：electron-builder 26.x 的 schema 把 Authenticode 参数收进了
 * `win.signtoolOptions`。本文件原先把 `certificateFile` / `certificatePassword` /
 * `signingHashAlgorithms` / `rfc3161TimeStampServer` 直接挂在 `win` 下，导致
 * **`npm run dist:signed` 在建包阶段就报 `unknown property` 而完全跑不通**
 * （配置 schema 校验见 app-builder-lib/scheme.json → definitions.WindowsSigntoolConfiguration）。
 * 该缺陷是**静默**的：未签名构建（`npm run dist`）不受影响，签名路径则一直是坏的，
 * 而它恰好是最容易被"没证书所以没法验"掩盖的一条链路。
 * 已按 schema 归位；`signAndEditExecutable` 本身是 `win` 级合法键，保持原位。
 */
const pkg = require('./package.json')

module.exports = {
  ...pkg.build,
  win: {
    ...pkg.build.win,
    signAndEditExecutable: true,
    signtoolOptions: {
      certificateFile: 'build/cert/kone-codesign.pfx',
      certificatePassword: process.env.KONE_CERT_PASSWORD,
      signingHashAlgorithms: ['sha256'],
      // RFC 3161 时间戳：确保签名在证书过期后仍长期有效
      rfc3161TimeStampServer: 'http://timestamp.digicert.com',
    },
  },
}
