const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const mainFilePath = path.join(process.cwd(), 'electron', 'main.ts')
const source = fs.readFileSync(mainFilePath, 'utf8')

test('electron main entry requests single instance lock before startup', () => {
  assert.match(source, /const hasSingleInstanceLock = app\.requestSingleInstanceLock\(\)/)
  assert.match(source, /if \(!hasSingleInstanceLock\) \{\s*app\.quit\(\)/s)
  assert.match(source, /app\s*\.whenReady\(\)\s*\.then\(async \(\) => \{\s*if \(!hasSingleInstanceLock\) \{\s*return/s)
})

test('electron main entry restores existing window on second instance', () => {
  assert.match(source, /app\.on\('second-instance', \(\) => \{/)
  assert.match(source, /mainWindow\.isMinimized\(\)/)
  assert.match(source, /mainWindow\.restore\(\)/)
  assert.match(source, /mainWindow\.show\(\)/)
  assert.match(source, /mainWindow\.focus\(\)/)
})

test('electron main entry quits on non-macOS window-all-closed', () => {
  assert.match(
    source,
    /app\.on\('window-all-closed', \(\) => \{\s*if \(process\.platform !== 'darwin'\) \{\s*app\.quit\(\)/s,
  )
})
