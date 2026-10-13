/**
 * secret-manager-resilience.business.test.js
 *
 * 背景（2026-10-12 真实缺陷，实测复现）：
 * `readSecretMap` 原实现在 `safeStorage.decryptString` 失败时**直接抛错**。
 * 当 `kone-secrets.json` 由**其它机器 / 其它 DPAPI 上下文**写入（或损坏）时无法解密 →
 * 连锁致命：
 *   · `getSecret` 全线抛错 → Provider/搜索取不到密钥；
 *   · `migrateSecrets` 抛错 → `main.ts` whenReady 链中断 → **createMainWindow 不执行 → 应用无窗口、彻底变砖**，
 *     用户连"进设置页重新录入密钥"这条唯一恢复路径都走不到。
 *
 * 修复后语义：**Fail-Closed 作用于单个能力**（取不到密钥 = 未配置），绝不击穿整个应用。
 * 本测试锁定：① 解密失败不抛错、降级为空映射；② 坏文件被**留档**而非静默丢弃；③ 用户重新录入即可恢复。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const secretManagerPath = path.join(ROOT, 'dist-electron', 'electron', 'services', 'secret-manager.js')

const { withModuleMocks, resetModule } = require('./helpers.js')

const BAD_CIPHERTEXT = 'BAD-CIPHERTEXT'

/** 构造一个 userData 目录 + 一个「无法解密」的 kone-secrets.json */
const makeBadProfile = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kone-secret-'))
  const file = path.join(dir, 'kone-secrets.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      v: 1,
      encrypted: true,
      data: Buffer.from(BAD_CIPHERTEXT, 'utf8').toString('base64'),
      updatedAt: 1,
    }),
    'utf8',
  )
  return { dir, file }
}

const loadSecretManager = async (userDataDir) => {
  let mod = null
  await withModuleMocks(
    {
      [`./electron-bridge::${secretManagerPath}`]: {
        app: { getPath: () => userDataDir },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (value) => Buffer.from(String(value), 'utf8'),
          decryptString: (buffer) => {
            const text = buffer.toString('utf8')
            // 模拟 DPAPI 解密失败：仅对"坏密文"抛错，正常密文可还原（保证写入后可读回）
            if (text === BAD_CIPHERTEXT) {
              throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
            }
            return text
          },
        },
      },
    },
    async () => {
      resetModule(secretManagerPath)
      mod = require(secretManagerPath)
    },
  )
  return mod
}

test('解密失败时 getSecret 不抛错、降级为空字符串（Fail-Closed 作用于单个能力）', async () => {
  const { dir } = makeBadProfile()
  const sm = await loadSecretManager(dir)
  assert.doesNotThrow(() => sm.getSecret('secrets.google-leads.apiKey'))
  assert.equal(sm.getSecret('secrets.google-leads.apiKey'), '')
})

test('解密失败时 checkSecret 返回 exists:false（不抛错）', async () => {
  const { dir } = makeBadProfile()
  const sm = await loadSecretManager(dir)
  const res = sm.checkSecret('secrets.llm.apiKey')
  assert.equal(res.exists, false)
})

test('坏文件被**留档**为 .corrupt-*（不静默丢失）', async () => {
  const { dir, file } = makeBadProfile()
  const sm = await loadSecretManager(dir)
  sm.getSecret('x')
  const quarantined = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'))
  assert.equal(quarantined.length, 1, `应有 1 个留档文件，实际 ${JSON.stringify(fs.readdirSync(dir))}`)
  assert.equal(fs.existsSync(file), false, '原坏文件应已改名')
})

test('用户重新录入密钥即可恢复（写入后可读回）', async () => {
  const { dir } = makeBadProfile()
  const sm = await loadSecretManager(dir)
  assert.equal(sm.getSecret('secrets.llm.apiKey'), '', '恢复前应为空')
  sm.setSecret('secrets.llm.apiKey', 'NEW_KEY_123')
  assert.equal(sm.getSecret('secrets.llm.apiKey'), 'NEW_KEY_123', '重新录入后应可读回')
})

test('健康文件路径不受影响（正常读写）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kone-secret-ok-'))
  const sm = await loadSecretManager(dir)
  assert.equal(sm.getSecret('k'), '')
  sm.setSecret('k', 'v1')
  assert.equal(sm.getSecret('k'), 'v1')
  assert.equal(sm.checkSecret('k').exists, true)
})
