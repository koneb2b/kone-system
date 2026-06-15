const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8')

test('search result cards do not expose fake cloud-send success action', () => {
  const searchEngine = read('src', 'components', 'search-engine.tsx')

  assert.doesNotMatch(searchEngine, /已提交至云端发送队列/)
  assert.doesNotMatch(searchEngine, /正在发送至云端/)
})

test('leads table cloud-send action is explicitly locked by Premium access prop', () => {
  const dashboard = read('src', 'components', 'dashboard-page.tsx')
  const leadsTable = read('src', 'components', 'leads-table.tsx')

  assert.match(dashboard, /canUseCloudSend=\{canAccessPremiumWorkspace\}/)
  assert.match(leadsTable, /canUseCloudSend\?: boolean/)
  assert.match(leadsTable, /!canUseCloudSend/)
  assert.match(leadsTable, /高级版锁定/)
  assert.match(leadsTable, /云端发送队列属于高级版能力/)
})
