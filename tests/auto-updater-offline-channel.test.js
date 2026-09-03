const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

// ─────────────────────────────────────────────────────────────
// P0-4: Update-source honesty (offline commercial model).
//
// Kone ships WITHOUT an online update feed (package.json#build.publish = null).
// Updates are delivered via the offline advisor/WeChat channel. initAutoUpdater
// MUST NOT run auto-checks when no feed is configured — otherwise it emits
// misleading "checking for update" activity for an auto-update path that does
// not exist. A feed can be enabled later via KONE_UPDATE_FEED_URL with NO code
// change. This test locks both contracts.
//
// electron-updater is mocked deterministically (never touch a real updater).
// ─────────────────────────────────────────────────────────────

const originalLoad = Module._load

const makeUpdaterSpy = () => {
  const spy = {
    autoDownload: undefined,
    autoInstallOnAppQuit: undefined,
    feedUrl: undefined,
    setFeedURLCalls: 0,
    checkForUpdatesCalls: 0,
    handlers: {},
    setFeedURL(cfg) {
      this.setFeedURLCalls += 1
      this.feedUrl = cfg
    },
    on(evt, cb) {
      this.handlers[evt] = cb
    },
    checkForUpdates() {
      this.checkForUpdatesCalls += 1
      return Promise.resolve(null)
    },
  }
  return spy
}

const installMocks = (updaterSpy) => {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron-updater') return { autoUpdater: updaterSpy }
    if (request === 'electron') {
      return {
        app: { isPackaged: true, getPath: () => process.cwd(), on: () => {}, getVersion: () => '1.3.0' },
        dialog: { showMessageBox: async () => ({ response: 1 }) },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
}

const restore = () => {
  Module._load = originalLoad
}

const loadFreshUpdater = () => {
  const modPath = require.resolve('../dist-electron/electron/services/auto-updater.js')
  delete require.cache[modPath]
  // electron-bridge is required transitively; drop it too so the electron mock applies.
  const bridgePath = require.resolve('../dist-electron/electron/services/electron-bridge.js')
  delete require.cache[bridgePath]
  return require(modPath)
}

test('P0-4: no feed configured → skip auto-check (offline WeChat channel, no misleading activity)', () => {
  const prev = process.env.KONE_UPDATE_FEED_URL
  delete process.env.KONE_UPDATE_FEED_URL
  const spy = makeUpdaterSpy()
  installMocks(spy)
  try {
    const { initAutoUpdater } = loadFreshUpdater()
    initAutoUpdater()
    assert.equal(spy.setFeedURLCalls, 0, 'must NOT set a feed URL when none configured')
    assert.equal(spy.checkForUpdatesCalls, 0, 'must NOT auto-check with no feed')
    assert.equal(spy.autoDownload, undefined, 'must NOT enable autoDownload with no feed')
    assert.equal(Object.keys(spy.handlers).length, 0, 'must NOT wire update event handlers with no feed')
  } finally {
    restore()
    if (prev !== undefined) process.env.KONE_UPDATE_FEED_URL = prev
  }
})

test('P0-4: KONE_UPDATE_FEED_URL set → activate feed + autoDownload (no code change needed)', () => {
  const prev = process.env.KONE_UPDATE_FEED_URL
  process.env.KONE_UPDATE_FEED_URL = 'https://updates.example.com/kone'
  const spy = makeUpdaterSpy()
  installMocks(spy)
  try {
    const { initAutoUpdater } = loadFreshUpdater()
    initAutoUpdater()
    assert.equal(spy.setFeedURLCalls, 1, 'feed URL set exactly once when configured')
    assert.deepEqual(
      spy.feedUrl,
      { provider: 'generic', url: 'https://updates.example.com/kone' },
      'feed URL wired from env',
    )
    assert.equal(spy.autoDownload, true, 'autoDownload enabled when feed present')
    assert.equal(spy.autoInstallOnAppQuit, true, 'autoInstallOnAppQuit enabled when feed present')
  } finally {
    restore()
    if (prev !== undefined) process.env.KONE_UPDATE_FEED_URL = prev
    else delete process.env.KONE_UPDATE_FEED_URL
  }
})
