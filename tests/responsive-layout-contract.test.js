const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8')

test('Electron main window fits inside the primary display work area', () => {
  const windowService = read('electron', 'services', 'window-service.ts')

  assert.match(windowService, /screen\.getPrimaryDisplay\(\)/)
  assert.match(windowService, /Math\.min\(1280, workAreaSize\.width\)/)
  assert.match(windowService, /Math\.min\(800, workAreaSize\.height\)/)
  assert.match(windowService, /minWidth/)
  assert.match(windowService, /minHeight/)
})

test('dashboard shell uses responsive flex layout with overflow scrolling', () => {
  const dashboard = read('src', 'components', 'dashboard-page.tsx')
  const sidebar = read('src', 'components', 'app-sidebar.tsx')

  assert.match(dashboard, /flex min-h-screen bg-background/)
  assert.match(dashboard, /flex-1 flex flex-col min-w-0/)
  assert.match(dashboard, /overflow-auto/)
  assert.match(sidebar, /h-screen/)
  assert.match(sidebar, /flex-col gap-1/)
})

test('search workspace uses responsive grid and flex-wrap filters', () => {
  const searchEngine = read('src', 'components', 'search-engine.tsx')

  // Omni-Search removed the legacy data-source column; the workspace now uses a
  // responsive results/analysis grid plus flex-wrap filter rows.
  assert.match(searchEngine, /lg:grid-cols-\[1\.4fr_1fr\]/)
  assert.match(searchEngine, /flex-wrap/)
  assert.match(searchEngine, /flex-col gap-\d/)
})

test('leads recommendation table uses rounded card with padding', () => {
  const leadsTable = read('src', 'components', 'leads-table.tsx')

  assert.match(leadsTable, /bg-white rounded-2xl border border-slate-200 shadow-sm p-6/)
  assert.match(leadsTable, /已评分高潜线索推荐/)
  assert.match(leadsTable, /仅展示已完成评分且最值得优先跟进的线索/)
})
