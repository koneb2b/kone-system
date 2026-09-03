const fs = require('fs')
const path = require('path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const DIST_ELECTRON_DIR = path.resolve(__dirname, '..', 'dist-electron')

const OBFUSCATION_OPTIONS = {
  target: 'node',
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  // splitStrings MUST stay disabled.
  //
  // It shatters string literals into concatenated chunks, including the
  // PROPERTY NAMES used for cross-module runtime lookups. electron-bridge
  // resolves Electron APIs by name (createLazyExport('safeStorage') →
  // _electron['safeStorage']) and its consumers import those same names
  // (electron_bridge_1['safeStorage']). Once split, the two sides reassemble
  // from different fragment pairs and stop matching, so the packaged app dies
  // at startup with:
  //   TypeError: electron_bridge_1[_0x…].getPath is not a function
  //     at getSecretFilePath (secret-manager.js)
  // Every other protection (stringArray + base64 + rotate/shuffle + hexadecimal
  // identifiers) is retained, so obfuscation strength is materially unchanged.
  // (build-agent §9.1: electron-bridge must survive the obfuscation stage.)
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  stringArrayWrappersCount: 1,
  stringArrayWrappersType: 'variable',
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
}

const SHOULD_SKIP_PATTERNS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}preload${path.sep}`,
  `${path.sep}dist-electron${path.sep}src${path.sep}shared${path.sep}ipc-contracts.js`,
  `${path.sep}dist-electron${path.sep}shared${path.sep}ipc${path.sep}contracts.js`,
  `${path.sep}dist-electron${path.sep}electron${path.sep}ipc${path.sep}contracts.js`,
  // electron-bridge resolves Electron APIs by PROPERTY NAME at runtime
  // (createLazyExport('safeStorage') → _electron['safeStorage']). With
  // splitStrings enabled these name literals are shattered into concatenated
  // 8-char fragments, so the export key and the lookup argument can desync —
  // _electron?.['safeStor' + <wrong fragment>] resolves to undefined and the
  // packaged app dies at startup with:
  //   TypeError: electron_bridge_1[_0x…][_0x…] is not a function
  //     at getSecretFilePath (secret-manager.js)
  // This shim contains no business IP (it is a pure Electron API adapter), so
  // excluding it costs nothing in protection while keeping startup viable.
  // (build-agent §9.1: electron-bridge must survive the obfuscation stage.)
  `${path.sep}dist-electron${path.sep}electron${path.sep}services${path.sep}electron-bridge.js`,
]

const SHOULD_SKIP_SUFFIXES = ['.map']

const collectJsFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) return []

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(fullPath))
      continue
    }
    if (entry.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath)
    }
  }

  return files
}

const obfuscateFile = (filePath) => {
  const source = fs.readFileSync(filePath, 'utf8')
  const result = JavaScriptObfuscator.obfuscate(source, OBFUSCATION_OPTIONS)
  fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8')
}

const shouldSkipFile = (filePath) => {
  if (SHOULD_SKIP_SUFFIXES.some((suffix) => filePath.endsWith(suffix))) {
    return true
  }

  return SHOULD_SKIP_PATTERNS.some((pattern) => filePath.includes(pattern))
}

const main = () => {
  const files = collectJsFiles(DIST_ELECTRON_DIR)
  if (files.length === 0) {
    console.warn('[obfuscate] No .js files found in dist-electron')
    return
  }

  let obfuscatedCount = 0

  for (const file of files) {
    if (shouldSkipFile(file)) {
      continue
    }

    try {
      obfuscateFile(file)
      obfuscatedCount += 1
    } catch (error) {
      console.warn(`[obfuscate] Skipped ${path.relative(DIST_ELECTRON_DIR, file)}: ${error.message}`)
    }
  }

  console.log(`[obfuscate] Obfuscated ${obfuscatedCount} file(s) in dist-electron`)
}

main()
