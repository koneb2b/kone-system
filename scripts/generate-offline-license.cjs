const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 1. 参数解析
const [, , machineId, plan = 'enterprise', expiresAt, licenseKey = 'KONE-OFFLINE-ENT'] = process.argv;

if (!machineId || !expiresAt) {
  console.error('\n❌ 缺少参数！');
  console.error('用法: node scripts/generate-offline-license.cjs <machineId> <plan> <expiresAtMs> [licenseKey]');
  console.error('示例: node scripts/generate-offline-license.cjs 03000200-0400-0500-0006-000700080009 premium 1807660800000\n');
  process.exit(1);
}

// 2. 增强型私钥读取逻辑：环境变量 -> 物理文件
let privateKey = process.env.KONE_OFFLINE_PRIVATE_KEY;

if (!privateKey) {
  // 尝试从当前目录或 scripts 目录寻找 pem 文件
  const possiblePaths = [
    path.join(__dirname, 'kone-offline-private.pem'),
    path.join(process.cwd(), 'kone-offline-private.pem'),
    path.join(process.cwd(), 'scripts', 'kone-offline-private.pem')
  ];

  for (const pemPath of possiblePaths) {
    if (fs.existsSync(pemPath)) {
      privateKey = fs.readFileSync(pemPath, 'utf8');
      console.log(`✅ 已自动加载私钥文件: ${pemPath}`);
      break;
    }
  }
}

if (!privateKey) {
  console.error('\n❌ 错误: 找不到私钥！');
  console.error('请确保环境变量 KONE_OFFLINE_PRIVATE_KEY 已设置，或 scripts/ 目录下存在 kone-offline-private.pem 文件。');
  console.error('提示: 你可以先运行 node scripts/make-keys.cjs 生成密钥对。\n');
  process.exit(1);
}

// 3. 能力集必须取自唯一事实源（SSOT），不得在本脚本内再维护副本。
//
// 缺陷背景（2026-11-03）：本脚本曾手写 `featureMap`，且**没有 basic 项**，
// 而取值表达式是 `featureMap[plan] || featureMap.enterprise` ——
// 给客户签 `basic` 授权时会**签出 enterprise 能力集**（cloud_send /
// team_collaboration / export_full 全部放行），属商业泄漏。
// 同时 premium 项也漏了 local_autopilot / team_collaboration（靠渲染层
// 按 plan 展开才侥幸补上），trial 项漏了 lead_export。
//
// 正确做法：直接读取 `src/shared/license-features.ts` 的编译产物，
// 与主进程/渲染层使用同一份能力集；找不到编译产物时**明确失败**，
// 绝不回落到本地副本（否则漂移会静默复现）。
const SSOT_CANDIDATES = [
  path.join(__dirname, '..', 'dist-electron', 'src', 'shared', 'license-features.js'),
  path.join(process.cwd(), 'dist-electron', 'src', 'shared', 'license-features.js'),
]

let featureSsot = null
for (const candidate of SSOT_CANDIDATES) {
  if (fs.existsSync(candidate)) {
    featureSsot = require(candidate)
    break
  }
}

if (!featureSsot || typeof featureSsot.getFeaturesForPlan !== 'function') {
  console.error('\n❌ 找不到能力集 SSOT 编译产物（dist-electron/src/shared/license-features.js）。')
  console.error('   请先执行 `npm run build:electron:dev` 后再签发授权。')
  console.error('   本脚本拒绝使用内置副本，以免能力集与客户端漂移。\n')
  process.exit(1)
}

const VALID_PLANS = ['trial', 'basic', 'premium', 'enterprise']
if (!VALID_PLANS.includes(plan)) {
  console.error(`\n❌ 未知套餐: ${plan}`)
  console.error(`   允许值: ${VALID_PLANS.join(' / ')}（未知值不再静默回落 enterprise）\n`)
  process.exit(1)
}

// 4. 构建声明内容 (Claims)
const claims = {
  licenseKey: licenseKey,
  machineId: machineId,
  plan: plan,
  status: 'active',
  expiresAt: Number(expiresAt),
  features: [...featureSsot.getFeaturesForPlan(plan)],
  issuedAt: Date.now(),
}

try {
  // 5. 使用私钥签名
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(JSON.stringify(claims));
  sign.end();

  const signature = sign.sign(privateKey, 'base64');

  // 6. 封装信封并转换为 Base64 激活码
  const envelope = { claims, signature };
  const base64License = Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64');

  console.log('\n================== Kone AI 商业授权中心 ==================');
  console.log(`\n客户机器码: ${machineId}`);
  console.log(`授权方案: ${plan.toUpperCase()}`);
  console.log(`到期时间: ${new Date(Number(expiresAt)).toLocaleString()}`);
  console.log('\n--- 🔑 请完整复制下方激活码 ---');
  console.log('\n' + base64License + '\n');
  console.log('----------------------------------------------------------\n');
} catch (error) {
  console.error('\n❌ 签名失败！请检查私钥格式是否正确。');
  console.error(error.message);
  process.exit(1);
}