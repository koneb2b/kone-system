const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')

test('repository ignore rules protect local runtime and tool residue', () => {
  const requiredPatterns = [
    'dist/',
    '.vite/',
    '.tmp-*/',
    '.playwright-mcp/',
    '.codenomad/',
    '*.log',
    '$null',
  ]

  for (const pattern of requiredPatterns) {
    assert.match(gitignore, new RegExp(`(^|\\n)${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`), `${pattern} should be ignored`)
  }
})

test('AGENTS documents pre-commit artifact hygiene', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  assert.match(agents, /Pre-Commit Hygiene/)
  assert.match(agents, /tests\/packaged-smoke-report\.json/)
  assert.match(agents, /dist-electron\/.*explicit cleanup task/s)
})
