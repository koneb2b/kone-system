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

// 3. 权限映射定义 (需与 electron/services/license-service.ts 保持一致)
const featureMap = {
  trial: ['search_basic'],
  premium: ['search_basic', 'search_deep', 'analysis_basic', 'analysis_advanced', 'lead_export', 'export_full', 'cloud_send'],
  enterprise: ['search_basic', 'search_deep', 'analysis_basic', 'analysis_advanced', 'lead_export', 'export_full', 'cloud_send', 'enterprise'],
};

// 4. 构建声明内容 (Claims)
const claims = {
  licenseKey: licenseKey,
  machineId: machineId,
  plan: plan,
  status: 'active',
  expiresAt: Number(expiresAt),
  features: featureMap[plan] || featureMap.enterprise,
  issuedAt: Date.now(),
};

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