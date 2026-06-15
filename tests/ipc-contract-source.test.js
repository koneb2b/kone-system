const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8')

test('IPC contracts use src/shared/ipc-contracts as the single type source', () => {
  const legacyShared = read('shared', 'ipc', 'contracts.ts').trim()
  const electronReExport = read('electron', 'ipc', 'contracts.ts').trim()

  assert.equal(legacyShared, "export type * from '../../src/shared/ipc-contracts'")
  assert.equal(electronReExport, "export type * from '../../src/shared/ipc-contracts'")
})
