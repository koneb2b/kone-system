const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
// 行尾无关：仓库内容为 LF，但 core.autocrlf=true 会在检出时把工作区物化为 CRLF，
// 断言必须基于归一化后的内容，否则随检出环境漂移产生假失败。
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').replace(/\r\n/g, '\n')

test('repository ignore rules protect local runtime and tool residue', () => {
  const requiredPatterns = ['dist/', '.vite/', '.tmp-*/', '.playwright-mcp/', '.codenomad/', '*.log', '$null']

  for (const pattern of requiredPatterns) {
    assert.match(
      gitignore,
      new RegExp(`(^|\\n)${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`),
      `${pattern} should be ignored`,
    )
  }
})

test('AGENTS documents pre-commit artifact hygiene', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  assert.match(agents, /Pre-Commit Hygiene/)
  assert.match(agents, /tests\/packaged-smoke-report\.json/)
  assert.match(agents, /dist-electron\/.*explicit cleanup task/s)
})
