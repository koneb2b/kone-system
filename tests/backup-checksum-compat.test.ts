/**
 * 备份校验和向后兼容测试（DATA-14 MD5 → SHA-256 迁移的兼容性守卫）
 *
 * 背景：
 *   `backup-service.ts` 的 `computeChecksum` 在 DATA-14 中由 MD5 升级为 SHA-256。
 *   但**升级前生成的历史备份仍带 MD5 校验和** —— 升级后 `verifyBackup` 一律判为
 *   校验失败，导致用户**无法恢复升级前的备份**（数据可恢复性缺陷）。
 *   该问题在 2026-10-07 打包冒烟日志中被发现：
 *     `[BackupService] Checksum mismatch for ...backup-2026-09-11/13/14...json`
 *
 * 修复：SHA-256 不匹配时回退尝试 MD5；两者都不匹配才判为损坏。
 *
 * 本测试锁定四件事：
 *   1. 新格式（SHA-256）正常通过
 *   2. 旧格式（MD5）向后兼容通过
 *   3. 数据被篡改时**两种算法都不匹配** → 拒绝（安全性未被削弱）
 *   4. 文件不存在 → 拒绝
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const modPath = '../dist-electron/electron/services/backup-service.js'
const { verifyBackup } = require(modPath)

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kone-backup-test-'))

/** 构造一个符合 envelope 结构的备份文件 */
function writeBackup(name: string, payload: unknown, algorithm: 'sha256' | 'md5'): string {
  const data = JSON.stringify({ meta: { createdAt: '2026-01-01T00:00:00.000Z' }, data: payload })
  const checksum = crypto.createHash(algorithm).update(data, 'utf-8').digest('hex')
  const filePath = path.join(tmpDir, name)
  fs.writeFileSync(filePath, JSON.stringify({ checksum, data }), 'utf-8')
  return filePath
}

test('新格式备份（SHA-256 校验和）通过', () => {
  const p = writeBackup('sha256.json', { leads: [1, 2, 3] }, 'sha256')
  assert.equal(verifyBackup(p), true, 'SHA-256 备份应通过校验')
})

test('旧格式备份（MD5 校验和，DATA-14 之前）向后兼容通过', () => {
  const p = writeBackup('legacy-md5.json', { leads: [1, 2, 3] }, 'md5')
  assert.equal(verifyBackup(p), true, 'MD5 旧备份应被兼容接受，否则用户无法恢复历史数据')
})

test('数据被篡改时拒绝（两种算法均不匹配，安全性未削弱）', () => {
  const p = writeBackup('tampered.json', { leads: [1, 2, 3] }, 'sha256')
  // 篡改 payload，但保留原 checksum
  const envelope = JSON.parse(fs.readFileSync(p, 'utf-8'))
  envelope.data = JSON.stringify({ meta: { createdAt: 'x' }, data: { leads: [9, 9, 9] } })
  fs.writeFileSync(p, JSON.stringify(envelope), 'utf-8')

  assert.equal(verifyBackup(p), false, '篡改后应拒绝')
})

test('文件不存在时拒绝', () => {
  assert.equal(verifyBackup(path.join(tmpDir, 'not-exist.json')), false)
})

test('结构非法（缺 meta/data）时拒绝', () => {
  const data = JSON.stringify({ onlyMeta: true })
  const checksum = crypto.createHash('sha256').update(data, 'utf-8').digest('hex')
  const p = path.join(tmpDir, 'bad-structure.json')
  fs.writeFileSync(p, JSON.stringify({ checksum, data }), 'utf-8')
  assert.equal(verifyBackup(p), false, '缺少 meta/data 应拒绝')
})

test.after?.(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* 沙箱下删除可能失败，忽略 */
  }
})
