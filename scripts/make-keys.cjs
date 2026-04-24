const crypto = require('crypto');
const fs = require('fs');

console.log('正在锻造 Kone 商业授权密钥对...');

// 生成 2048 位 RSA 密钥对
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// 保存到本地文件
fs.writeFileSync('kone-offline-public.pem', publicKey);
fs.writeFileSync('kone-offline-private.pem', privateKey);

console.log('✅ 成功！已生成 kone-offline-private.pem (私钥) 和 kone-offline-public.pem (公钥)');