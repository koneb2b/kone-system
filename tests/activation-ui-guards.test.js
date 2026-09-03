const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const activationScreenPath = path.join(process.cwd(), 'src', 'components', 'activation-screen.tsx')
const upgradeModalPath = path.join(process.cwd(), 'src', 'components', 'upgrade-modal.tsx')
const activationSource = fs.readFileSync(activationScreenPath, 'utf8')
const upgradeSource = fs.readFileSync(upgradeModalPath, 'utf8')

test('activation screen uses kone brand gradient on left panel', () => {
  assert.match(activationSource, /bg-gradient-to-br from-blue-900 via-blue-800 to-cyan-500/)
  assert.doesNotMatch(activationSource, /bg-slate-950 p-10 lg:flex/)
  assert.match(activationSource, /text-white\/85/)
  assert.match(activationSource, /text-white\/80/)
})

test('activation screen surfaces destructive toast errors for activation and trial failures', () => {
  assert.match(activationSource, /useToast\(\)/)
  assert.match(
    activationSource,
    /toast\(\{ title: ["']激活失败["'], description: message, variant: ["']destructive["'] \}\)/,
  )
  assert.match(
    activationSource,
    /toast\(\{ title: ["']试用开启失败["'], description: message, variant: ["']destructive["'] \}\)/,
  )
  assert.match(activationSource, /finally \{\s*setActivating\(false\)/s)
  assert.match(activationSource, /finally \{\s*setRequestingTrial\(false\)/s)
})

test('upgrade modal surfaces destructive toast errors and loading state', () => {
  assert.match(
    upgradeSource,
    /toast\(\{ title: ["']激活失败["'], description: message, variant: ["']destructive["'] \}\)/,
  )
  assert.match(upgradeSource, /finally \{\s*setActivating\(false\)/s)
  assert.match(upgradeSource, /isLoading=\{activating\}/)
})
