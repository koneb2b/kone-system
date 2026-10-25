const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn, execFileSync } = require('child_process')

const rootDir = path.resolve(__dirname, '..')
const packageJsonPath = path.join(rootDir, 'package.json')
const installerPath = path.join(rootDir, 'release', 'Kone-Intellect-Setup-1.4.38.exe')
const legacyInstallerPath = path.join(rootDir, 'release-v151', 'Kone-Intellect-Setup-1.4.32.exe')
const legacyReportPath = path.join(rootDir, 'tests', 'install-layer-report.json')

const EXPECTED_SIZE = 89962234
const EXPECTED_SHA256 = '6EF8459AA2F70CB5812E852D0426F0C7D20635EDDFAF0BEE2A55538CD7741D4B'
const VERSION_PREFIX = '1.4.38'
const LEGACY_VERSION_PREFIX = '1.4.32'
const LEGACY_DIR_NAME = 'kone-system'
const CANONICAL_REPORT_MAX_TRACKED_BYTES = 256 * 1024

const INSTALL_TIMEOUT_MS = 300000
const EXE_APPEAR_TIMEOUT_MS = 120000
const REGISTRY_TIMEOUT_MS = 60000
const SHORTCUT_TIMEOUT_MS = 30000
const UNINSTALL_TIMEOUT_MS = 120000
const POLL_MS = 500
const MIN_FREE_BYTES = 1500 * 1024 * 1024

const VALID_SCENARIOS = ['custom-temp', 'default-path', 'non-ascii', 'reinstall', 'upgrade', 'legacy-migration']

const UNINSTALL_ROOTS = [
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
]

const OLDER_INSTALLER_ROOTS = [
  path.join(os.homedir(), 'Kone-ReleaseArchive-2026-10-13'),
  path.join(os.homedir(), 'Downloads'),
  rootDir,
  'D:\\',
]

function parseScenario(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--scenario=')) return arg.slice('--scenario='.length)
    if (arg === '--scenario' && argv[index + 1]) return argv[index + 1]
  }
  return 'custom-temp'
}

const scenario = parseScenario(process.argv.slice(2))
if (!VALID_SCENARIOS.includes(scenario)) {
  console.error(`[install-layer] unknown scenario "${scenario}"; valid: ${VALID_SCENARIOS.join(', ')}`)
  process.exit(2)
}

const reportPath = path.join(rootDir, 'tests', `install-layer-report-${scenario}.json`)

const REPORT = {
  scenario,
  reportPurpose:
    'Install-layer acceptance evidence for the 1.4.38 NSIS per-user installer: silent install, registry/shortcut assertions, silent uninstall and residue checks. Machine-specific paths are recorded verbatim.',
  coverage: {
    coveredScenarios: [...VALID_SCENARIOS],
    notCovered: {
      nonElevatedContext: {
        covered: false,
        reason:
          'The harness only had a High-integrity administrator token in this environment; medium-integrity/non-elevated user behaviour was not exercised.',
      },
      perMachine: {
        covered: false,
        reason:
          'package.json build.perMachine is not true and no Program Files/UAC install was attempted; only the per-user default is covered.',
      },
      preApril2026LegacyBuild: {
        covered: false,
        reason:
          'Only the archived 1.4.32 build (release-v151) was exercised as a legacy baseline; builds older than the April 2026 installer generation were not tested.',
      },
      authenticode: {
        covered: false,
        reason:
          'No signature verification (Get-AuthenticodeSignature / chain trust) is asserted by this harness.',
      },
      antivirusSmartScreen: {
        covered: false,
        reason:
          'No antivirus scan, Defender reputation check or SmartScreen prompt path is exercised; silent mode bypasses interactive reputation UI.',
      },
      lockedFiles: {
        covered: false,
        reason:
          'No test holds target files open during install/uninstall, so locked-file failure handling is not covered.',
      },
      diskFull: {
        covered: false,
        reason:
          'Only a preflight free-space floor is checked; low-disk/disk-full install failure behaviour is not exercised.',
      },
      runningAppDuringInstall: {
        covered: false,
        reason:
          'The app is not launched before install; in-use upgrade behaviour (running KoneAI.exe during install) is not covered.',
      },
      rebootRequired: {
        covered: false,
        reason:
          'Reboot-required flows and post-reboot completion are not exercised; no reboot was performed.',
      },
    },
  },
  a3oracle: {
    criterion:
      'Exactly one Kone uninstall entry exists AND its UninstallString targets targetDir\\Uninstall*.exe AND exactly one HKCU\\Software\\* key has InstallLocation == targetDir',
    sources: [
      'node_modules/app-builder-lib/templates/nsis/include/installer.nsh:104',
      'node_modules/app-builder-lib/templates/nsis/include/installer.nsh:119-123',
      'node_modules/app-builder-lib/templates/nsis/multiUser.nsh:8-9',
    ],
  },
  startedAt: new Date().toISOString(),
  finishedAt: null,
  targetDir: null,
  targetDirPreExisted: null,
  defaultPath: {
    expectedDir: null,
    actualDir: null,
    resolvedFrom: null,
    matchedExpectation: null,
    derivationSource: null,
    derivation: null,
    legacyExpectedDir: null,
    legacyDirPresent: null,
    legacyDirSnapshot: null,
    preInstallSnapshot: [],
  },
  preexistingDefaultDir: null,
  oldInstaller: null,
  upgrade: null,
  reinstall: null,
  installOlder: null,
  secondInstall: null,
  legacyMigration: null,
  evidence: null,
  artifact: {
    path: installerPath,
    expectedSize: EXPECTED_SIZE,
    expectedSha256: EXPECTED_SHA256,
    before: null,
    after: null,
  },
  preflight: {
    existingUninstallEntries: [],
    existingShortcuts: [],
    existingProcesses: [],
  },
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    osTmpdir: os.tmpdir(),
    integrityNote: process.env.KONE_INSTALL_LAYER_NOTE || null,
    targetDriveFreeBytesBefore: null,
    targetDriveFreeBytesAfter: null,
  },
  assertions: {},
  install: {
    label: null,
    installerPath: null,
    args: [],
    exitCode: null,
    signal: null,
    timedOut: false,
    error: null,
    installerDurationMs: null,
    timeToExecutableMs: null,
    stdout: '',
    stderr: '',
  },
  uninstall: {
    attempted: false,
    path: null,
    found: false,
    candidates: [],
    exitCode: null,
    signal: null,
    timedOut: false,
    error: null,
    uninstallerDurationMs: null,
    cleanupDurationMs: null,
    stdout: '',
    stderr: '',
  },
  findings: [],
  residue: [],
  retainedPreExistingDirs: [],
  verdict: null,
  reason: null,
  scriptError: null,
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const truncate = (text, max = 8000) => (text && text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text || '')
const stripDir = (value) => {
  if (!value) return ''
  let text = String(value).trim()
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1)
  return text.replace(/\//g, '\\').replace(/\\+$/, '')
}
const samePath = (a, b) => stripDir(a).toLowerCase() === stripDir(b).toLowerCase()
const normalizeVersion = (value) => (typeof value === 'string' ? value.trim() : '')

function pushFinding(code, message, details = null) {
  REPORT.findings.push({ code, message, details })
  console.error(`[install-layer] FINDING ${code}: ${message}`)
}

function runPowerShell(script) {
  const prelude = [
    '$utf8 = New-Object System.Text.UTF8Encoding($false)',
    '$OutputEncoding = $utf8',
    '[Console]::OutputEncoding = $utf8',
  ].join('\n')
  const stdout = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${prelude}\n${script}`],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
  )
  return stdout.replace(/^\uFEFF/, '').trim()
}

function runPowerShellJson(script) {
  const text = runPowerShell(script)
  if (!text) return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function queryKoneUninstallEntries() {
  const paths = UNINSTALL_ROOTS.map((entry) => `'${entry}'`).join(', ')
  const script = [
    '$out = @()',
    `foreach ($p in @(${paths})) {`,
    "  $out += Get-ItemProperty -Path $p -ErrorAction SilentlyContinue |",
    "    Where-Object { $_.DisplayName -like '*Kone*' } |",
    '    Select-Object DisplayName, DisplayVersion, InstallLocation, UninstallString, Publisher, PSPath',
    '}',
    '$out | ConvertTo-Json -Compress -Depth 4',
  ].join('\n')
  return runPowerShellJson(script)
}

function queryKoneProcesses() {
  const script = [
    '$p = @(Get-Process -Name KoneAI -ErrorAction SilentlyContinue | Select-Object Id, Path)',
    '$p | ConvertTo-Json -Compress -Depth 2',
  ].join('\n')
  return runPowerShellJson(script)
}

function queryInstallLocationKeys() {
  const script = [
    '$out = @()',
    "Get-ChildItem -Path 'HKCU:\\Software' -ErrorAction SilentlyContinue | ForEach-Object {",
    '  $props = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue',
    '  if ($props -and $props.InstallLocation) {',
    '    $out += [pscustomobject]@{',
    '      KeyName = $_.PSChildName',
    '      KeyPath = $_.Name',
    '      InstallLocation = $props.InstallLocation',
    '    }',
    '  }',
    '}',
    '$out | ConvertTo-Json -Compress -Depth 3',
  ].join('\n')
  return runPowerShellJson(script)
}

function parseUninstallExecutable(uninstallString) {
  if (typeof uninstallString !== 'string') return null
  const text = uninstallString.trim()
  if (!text) return null
  let executable = ''
  if (text.startsWith('"')) {
    const closing = text.indexOf('"', 1)
    if (closing > 0) executable = text.slice(1, closing)
  } else {
    const match = text.match(/^(.+?\.exe)(?:\s|$)/i)
    executable = match ? match[1] : text.split(/\s+/)[0]
  }
  if (!executable) return null
  return {
    executable,
    directory: path.dirname(executable),
    fileName: path.basename(executable),
  }
}

function matchesInstallTarget(uninstallString, targetDir) {
  const parsed = parseUninstallExecutable(uninstallString)
  if (!parsed) {
    return { pass: false, parsed: null, nameOk: false, directoryOk: false }
  }
  const nameOk = /^Uninstall.*\.exe$/i.test(parsed.fileName)
  const directoryOk = samePath(parsed.directory, targetDir)
  return { pass: nameOk && directoryOk, parsed, nameOk, directoryOk }
}

function queryVersionInfo(exePath) {
  const escaped = exePath.replace(/'/g, "''")
  const script = [
    `$f = Get-Item -LiteralPath '${escaped}' -ErrorAction Stop`,
    '$v = $f.VersionInfo',
    '[pscustomobject]@{',
    '  ProductVersion = $v.ProductVersion',
    '  FileVersion = $v.FileVersion',
    '  ProductName = $v.ProductName',
    '} | ConvertTo-Json -Compress',
  ].join('\n')
  const text = runPowerShell(script)
  return text
    ? JSON.parse(text)
    : { ProductVersion: null, FileVersion: null, ProductName: null }
}

function shortcutRoots() {
  const roots = []
  if (process.env.USERPROFILE) roots.push(path.join(process.env.USERPROFILE, 'Desktop'))
  if (process.env.PUBLIC) roots.push(path.join(process.env.PUBLIC, 'Desktop'))
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  if (process.env.ProgramData) roots.push(path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  return roots
}

function scanKoneShortcuts() {
  const found = new Set()
  const walk = (dir, depth) => {
    if (depth > 6) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.isFile() && /\.lnk$/i.test(entry.name) && /kone/i.test(entry.name)) {
        found.add(full)
      }
    }
  }
  for (const root of shortcutRoots()) {
    if (fs.existsSync(root)) walk(root, 0)
  }
  return [...found].sort()
}

function findUninstallers(dir) {
  const results = []
  const walk = (current, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.isFile() && /^Uninstall.*\.exe$/i.test(entry.name)) {
        results.push(full)
      }
    }
  }
  walk(dir, 0)
  return results.sort((a, b) => a.length - b.length)
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(1024 * 1024)
  try {
    let bytesRead
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex').toUpperCase()
}

function freeBytesFor(filePath) {
  try {
    const stats = fs.statfsSync(path.parse(filePath).root)
    return Number(stats.bfree) * Number(stats.bsize)
  } catch {
    return null
  }
}

function directoryEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
}

function directoryEmpty(dir) {
  const entries = directoryEntries(dir)
  return entries ? entries.length === 0 : null
}

function describeDirectory(dir) {
  const summary = { path: dir, topLevel: [], fileCount: 0, totalBytes: 0, truncated: false }
  const walk = (current, depth) => {
    if (summary.fileCount >= 5000) {
      summary.truncated = true
      return
    }
    const entries = directoryEntries(current)
    if (!entries) return
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (depth === 0) summary.topLevel.push(entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else {
        summary.fileCount += 1
        try {
          summary.totalBytes += fs.statSync(full).size
        } catch {
          /* unreadable file is still counted */
        }
      }
    }
  }
  walk(dir, 0)
  return summary
}

function snapshotDirectory(dir) {
  if (!dir || !fs.existsSync(dir)) return { path: dir, exists: false, empty: null, itemCount: null }
  const entries = directoryEntries(dir)
  const stat = fs.statSync(dir)
  return {
    path: dir,
    exists: true,
    empty: entries ? entries.length === 0 : null,
    itemCount: entries ? entries.length : null,
    itemNames: entries ? entries.map((entry) => entry.name) : [],
    creationTime: stat.birthtime ? stat.birthtime.toISOString() : null,
    lastWriteTime: stat.mtime ? stat.mtime.toISOString() : null,
  }
}

function programsDir() {
  return process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null
}

function sanitizeInstallDirName(value) {
  try {
    const sanitizeFileName = require('sanitize-filename')
    return sanitizeFileName(String(value))
  } catch {
    return String(value)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/[. ]+$/, '')
  }
}

// The real per-user default install dir is NOT "%LOCALAPPDATA%\\Programs\\kone-system".
// electron-builder derives it from APP_FILENAME:
//   node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js:165
//     APP_FILENAME: getWindowsInstallationDirName(appInfo, !oneClick || isPerMachine)
//   NsisTarget.js:137  oneClick = options.oneClick !== false        -> false here
//   NsisTarget.js:146  isPerMachine = options.perMachine === true   -> false here
//   node_modules/app-builder-lib/out/appInfo.js:56-57
//     productFilename = sanitizeFileName(executableName) when executableName is set
//   node_modules/app-builder-lib/templates/nsis/multiUser.nsh:40
//     StrCpy $INSTDIR "$0\${APP_FILENAME}"
// => expected = %LOCALAPPDATA%\\Programs\\<sanitized build.executableName>
// The derivation is read from package.json at runtime so it cannot rot into a hardcoded name.
function readBuildExecutableInfo() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const build = pkg.build || {}
  const candidates = [
    { field: 'build.executableName', value: build.executableName },
    { field: 'build.productName (fallback)', value: build.productName },
    { field: 'package.json productName (fallback)', value: pkg.productName },
    { field: 'package.json name (fallback)', value: pkg.name },
  ]
  const selected = candidates.find((candidate) => typeof candidate.value === 'string' && candidate.value.trim())
  if (!selected) throw new Error('cannot derive install dir name: package.json has no usable executable/product/name field')
  const rawValue = selected.value.trim()
  const installDirName = sanitizeInstallDirName(rawValue)
  if (!installDirName) throw new Error(`sanitized install dir name is empty (from ${selected.field}: "${rawValue}")`)
  return {
    packageVersion: typeof pkg.version === 'string' ? pkg.version : null,
    configField: selected.field,
    usedFallback: selected.field !== 'build.executableName',
    rawValue,
    installDirName,
    evidence: [
      'node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js:137,146,165',
      'node_modules/app-builder-lib/out/appInfo.js:56-57',
      'node_modules/app-builder-lib/templates/nsis/multiUser.nsh:40',
    ],
  }
}

function defaultInstallDirFor(info) {
  const base = programsDir()
  if (!base) throw new Error('LOCALAPPDATA is not defined; cannot resolve the per-user default install path')
  return path.join(base, info.installDirName)
}

function scanProgramsWithKoneExe() {
  const base = programsDir()
  if (!base || !fs.existsSync(base)) return []
  const results = []
  for (const entry of directoryEntries(base) || []) {
    if (!entry.isDirectory()) continue
    const dir = path.join(base, entry.name)
    if (fs.existsSync(path.join(dir, 'KoneAI.exe'))) results.push(dir)
  }
  return results
}

function findInstallerCandidates() {
  const found = new Map()
  const skip = new Set(['node_modules', '.git', '.codegraph', '$Recycle.Bin', 'System Volume Information', 'Windows'])
  const walk = (dir, depth, maxDepth, isRoot) => {
    if (depth > maxDepth) return
    const entries = directoryEntries(dir)
    if (!entries) return
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue
        walk(full, depth + 1, maxDepth, false)
      } else if (entry.isFile() && /^Kone-Intellect-Setup-\d+\.\d+\.\d+\.exe$/i.test(entry.name)) {
        found.set(full.toLowerCase(), full)
      }
    }
    if (isRoot && depth === 0 && dir === rootDir) {
      for (const entry of entries) {
        if (entry.isDirectory() && /^release/i.test(entry.name)) {
          walk(path.join(dir, entry.name), 1, 2, false)
        }
      }
    }
  }
  for (const root of OLDER_INSTALLER_ROOTS) {
    if (!fs.existsSync(root)) continue
    const maxDepth = root === 'D:\\' ? 3 : root === rootDir ? 1 : 5
    walk(root, 0, maxDepth, root === rootDir)
  }
  return [...found.values()]
}

function versionParts(value) {
  const text = normalizeVersion(value)
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return match.slice(1).map((part) => Number(part))
}

function compareVersions(a, b) {
  const left = versionParts(a)
  const right = versionParts(b)
  if (!left || !right) return 0
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function inspectInstaller(filePath) {
  let size = null
  let version = null
  try {
    const stat = fs.statSync(filePath)
    size = stat.size
    version = queryVersionInfo(filePath)
  } catch (error) {
    return { path: filePath, size, version: null, error: error.message }
  }
  const productVersion = normalizeVersion(version.ProductVersion)
  const fileVersion = normalizeVersion(version.FileVersion)
  const effective = productVersion || fileVersion
  return {
    path: filePath,
    size,
    version: effective || null,
    productVersion: version.ProductVersion || null,
    fileVersion: version.FileVersion || null,
    productName: version.ProductName || null,
  }
}

function findOlderInstaller() {
  const candidates = findInstallerCandidates()
  const inspected = candidates.map(inspectInstaller)
  const older = inspected
    .filter((item) => item.version && compareVersions(item.version, VERSION_PREFIX) < 0)
    .sort((a, b) => compareVersions(b.version, a.version))
  REPORT.oldInstaller = {
    searchedRoots: OLDER_INSTALLER_ROOTS,
    candidates: inspected,
    selected: null,
  }
  if (older.length === 0) return null
  const selected = older[0]
  selected.sha256 = sha256File(selected.path)
  selected.mtime = fs.statSync(selected.path).mtime.toISOString()
  REPORT.oldInstaller.selected = selected
  return selected
}

function spawnAndWait(command, args, options, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    let stdout = ''
    let stderr = ''
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ ...result, stdout, stderr })
    }
    let child
    try {
      child = spawn(command, args, options)
    } catch (error) {
      finish({ exitCode: null, signal: null, timedOut: false, error: error.message })
      return
    }
    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      finish({ exitCode: null, signal: null, timedOut: true, error: null })
    }, timeoutMs)
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => finish({ exitCode: null, signal: null, timedOut: false, error: error.message }))
    child.on('close', (code, signal) => finish({ exitCode: code, signal, timedOut: false, error: null }))
  })
}

async function pollUntil(check, timeoutMs, intervalMs = POLL_MS) {
  const startedAt = Date.now()
  let last = null
  while (Date.now() - startedAt <= timeoutMs) {
    last = await check()
    if (last) return { ok: true, value: last, waitedMs: Date.now() - startedAt }
    await wait(intervalMs)
  }
  return { ok: false, value: last, waitedMs: Date.now() - startedAt }
}

async function runInstaller(executable, args, cwd, timeoutMs, label) {
  const startedAt = Date.now()
  const result = await spawnAndWait(
    executable,
    args,
    {
      cwd,
      env: { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir() },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
    timeoutMs,
  )
  return {
    label,
    installerPath: executable,
    args,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    error: result.error,
    installerDurationMs: Date.now() - startedAt,
    timeToExecutableMs: null,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  }
}

async function collectInstallAssertions(targetDir, versionPrefix, baselineShortcuts, label) {
  const exePath = path.join(targetDir, 'KoneAI.exe')
  const appear = await pollUntil(() => fs.existsSync(exePath), EXE_APPEAR_TIMEOUT_MS)
  const a1 = {
    pass: appear.ok,
    expected: `${exePath} exists`,
    observed: {
      path: exePath,
      exists: fs.existsSync(exePath),
      waitedMs: appear.waitedMs,
      label,
    },
  }

  let version = null
  let versionError = null
  if (a1.pass) {
    try {
      version = queryVersionInfo(exePath)
    } catch (error) {
      versionError = error.message
    }
  }
  const productVersion = version ? version.ProductVersion : null
  const fileVersion = version ? version.FileVersion : null
  const versionStrings = [productVersion, fileVersion]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
  const a2 = {
    pass: versionStrings.some((value) => value.startsWith(versionPrefix)),
    expected: `ProductVersion or FileVersion starts with ${versionPrefix}`,
    observed: {
      productVersion,
      fileVersion,
      productName: version ? version.ProductName : null,
      versionError,
      label,
    },
  }

  const collectA3State = () => {
    const entries = queryKoneUninstallEntries()
    const koneEntries = entries.filter((candidate) => candidate.DisplayName && /kone/i.test(candidate.DisplayName))
    const entry = koneEntries[0] || null
    const uninstallStringCheck = entry
      ? matchesInstallTarget(entry.UninstallString, targetDir)
      : { pass: false, parsed: null, nameOk: false, directoryOk: false }
    const installLocationHits = queryInstallLocationKeys().filter((key) => samePath(key.InstallLocation, targetDir))
    return { entries, koneEntries, entry, entryCount: koneEntries.length, uninstallStringCheck, installLocationHits }
  }
  const a3Poll = await pollUntil(() => {
    const state = collectA3State()
    const pass =
      Boolean(state.entry) &&
      state.entryCount === 1 &&
      state.uninstallStringCheck.pass &&
      state.installLocationHits.length === 1
    return pass ? state : null
  }, REGISTRY_TIMEOUT_MS, 1000)
  const a3State = a3Poll.value || collectA3State()
  const a3 = {
    pass: Boolean(a3Poll.value),
    expected: `exactly one Kone uninstall entry exists, its UninstallString targets ${targetDir}\\Uninstall*.exe, and exactly one HKCU\\Software\\* key has InstallLocation == ${targetDir}`,
    observed: {
      uninstallEntry: a3State.entry,
      allKoneEntries: a3State.koneEntries,
      allUninstallEntriesScanned: a3State.entries,
      entryCount: a3State.entryCount,
      entryCountOk: a3State.entryCount === 1,
      uninstallString: a3State.entry ? a3State.entry.UninstallString : null,
      parsedUninstallExecutable: a3State.uninstallStringCheck.parsed,
      uninstallExecutableNameOk: a3State.uninstallStringCheck.nameOk,
      uninstallExecutableDirectoryOk: a3State.uninstallStringCheck.directoryOk,
      installLocationKeyMatches: a3State.installLocationHits,
      installLocationKeyCount: a3State.installLocationHits.length,
      installLocationKeyName:
        a3State.installLocationHits.length === 1 ? a3State.installLocationHits[0].KeyName : null,
      installLocationKeyPath:
        a3State.installLocationHits.length === 1 ? a3State.installLocationHits[0].KeyPath : null,
      installLocationValue:
        a3State.installLocationHits.length === 1 ? a3State.installLocationHits[0].InstallLocation : null,
      waitedMs: a3Poll.waitedMs,
      label,
    },
  }

  const shortcutPoll = await pollUntil(() => {
    const current = scanKoneShortcuts()
    if (current.length === 0) return null
    return {
      current,
      newlyCreated: current.filter((candidate) => !baselineShortcuts.some((base) => samePath(base, candidate))),
    }
  }, SHORTCUT_TIMEOUT_MS, 1000)
  const currentShortcuts = shortcutPoll.value ? shortcutPoll.value.current : scanKoneShortcuts()
  const newlyCreated = shortcutPoll.value
    ? shortcutPoll.value.newlyCreated
    : currentShortcuts.filter((candidate) => !baselineShortcuts.some((base) => samePath(base, candidate)))
  const a4 = {
    pass: Boolean(shortcutPoll.value),
    expected: 'a .lnk containing "Kone" exists in Desktop or Start Menu',
    observed: {
      baseline: baselineShortcuts,
      current: currentShortcuts,
      newlyCreated,
      searchedRoots: shortcutRoots(),
      waitedMs: shortcutPoll.waitedMs,
      label,
    },
  }

  return {
    exePath,
    timeToExecutableMs: appear.ok ? appear.waitedMs : null,
    newlyCreatedShortcuts: newlyCreated,
    assertions: { A1: a1, A2: a2, A3: a3, A4: a4 },
  }
}

function buildTargetDir(prefix) {
  const tempRoot = os.tmpdir()
  REPORT.environment.osTmpdir = tempRoot
  if (/[\s]/.test(tempRoot)) {
    throw new Error(`temp root contains whitespace and cannot be used for unquoted /D=: ${tempRoot}`)
  }
  const targetDir = path.join(tempRoot, `${prefix}${Date.now()}`)
  if (/[\s]/.test(targetDir)) {
    throw new Error(`target directory contains whitespace and cannot be used for unquoted /D=: ${targetDir}`)
  }
  if (fs.existsSync(targetDir)) {
    throw new Error(`target directory already exists: ${targetDir}`)
  }
  fs.mkdirSync(targetDir, { recursive: true })
  return targetDir
}

function setTargetDriveFree() {
  const reference = REPORT.targetDir || installerPath
  REPORT.environment.targetDriveFreeBytesBefore = freeBytesFor(reference)
  if (
    REPORT.environment.targetDriveFreeBytesBefore !== null &&
    REPORT.environment.targetDriveFreeBytesBefore < MIN_FREE_BYTES
  ) {
    throw new Error(
      `insufficient free space on ${path.parse(reference).root} (${REPORT.environment.targetDriveFreeBytesBefore} bytes)`,
    )
  }
}

function prepareDefaultPathScenario() {
  const buildInfo = readBuildExecutableInfo()
  const expectedDir = defaultInstallDirFor(buildInfo)
  // Historical artifact only: the pre-existing EMPTY "%LOCALAPPDATA%\\Programs\\kone-system"
  // directory from earlier builds. It is recorded for context and is never asserted on.
  const legacyExpectedDir = path.join(programsDir(), LEGACY_DIR_NAME)
  const legacySnapshot = snapshotDirectory(legacyExpectedDir)
  const preInstallSnapshot = scanProgramsWithKoneExe().concat([expectedDir, legacyExpectedDir])
  const unique = [...new Set(preInstallSnapshot.map((dir) => path.resolve(dir)))]
  REPORT.defaultPath.expectedDir = expectedDir
  REPORT.defaultPath.derivationSource = buildInfo.configField
  REPORT.defaultPath.derivation = {
    packageJsonPath,
    configField: buildInfo.configField,
    usedFallback: buildInfo.usedFallback,
    rawValue: buildInfo.rawValue,
    sanitizedValue: buildInfo.installDirName,
    formula: '%LOCALAPPDATA%\\Programs\\<sanitized build.executableName || build.productName>',
    evidence: buildInfo.evidence,
  }
  REPORT.defaultPath.legacyExpectedDir = legacyExpectedDir
  REPORT.defaultPath.legacyDirPresent = Boolean(legacySnapshot.exists)
  REPORT.defaultPath.legacyDirSnapshot = legacySnapshot
  REPORT.defaultPath.preInstallSnapshot = unique.map((dir) => snapshotDirectory(dir))
  REPORT.preexistingDefaultDir = snapshotDirectory(expectedDir)
  REPORT.targetDir = expectedDir
  REPORT.targetDirPreExisted = REPORT.preexistingDefaultDir.exists
  REPORT.install.label = 'default-path'
  REPORT.install.installerPath = installerPath
  REPORT.install.args = ['/S']
  setTargetDriveFree()
  return {
    kind: 'default-path',
    targetDir: null,
    expectedDir,
    installArgs: ['/S'],
    preInstallPrograms: unique,
  }
}

function prepareTempScenario(kind, prefix) {
  const targetDir = buildTargetDir(prefix)
  REPORT.targetDir = targetDir
  REPORT.targetDirPreExisted = false
  const freeBefore = freeBytesFor(targetDir)
  REPORT.environment.targetDriveFreeBytesBefore = freeBefore
  if (freeBefore !== null && freeBefore < MIN_FREE_BYTES) {
    throw new Error(`insufficient free space on ${path.parse(targetDir).root} (${freeBefore} bytes)`)
  }
  return {
    kind,
    targetDir,
    expectedDir: null,
    installArgs: ['/S', `/D=${targetDir}`],
    preInstallPrograms: [],
  }
}

async function resolveDefaultTargetDir(context, installStartedAt) {
  const expected = context.expectedDir
  const baseline = new Set(context.preInstallPrograms.map((dir) => dir.toLowerCase()))
  const poll = await pollUntil(() => {
    const entries = queryKoneUninstallEntries()
    const entry = entries.find((candidate) => candidate.InstallLocation)
    if (entry) {
      return { dir: stripDir(entry.InstallLocation), source: 'uninstall-registry', entries }
    }
    const scanned = scanProgramsWithKoneExe().filter((dir) => !baseline.has(dir.toLowerCase()))
    if (scanned.length === 1) return { dir: scanned[0], source: 'programs-exe-scan', entries }
    if (scanned.length > 1) {
      return { dir: scanned.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0], source: 'programs-exe-scan-multiple', entries }
    }
    if (fs.existsSync(path.join(expected, 'KoneAI.exe'))) {
      return { dir: expected, source: 'expected-path-exe', entries }
    }
    return null
  }, EXE_APPEAR_TIMEOUT_MS, 1000)

  REPORT.defaultPath.resolvedFrom = poll.ok ? poll.value.source : null
  if (!poll.ok) {
    REPORT.defaultPath.actualDir = null
    REPORT.defaultPath.matchedExpectation = null
    pushFinding(
      'DEFAULT_PATH_UNRESOLVED',
      `could not resolve the actual default install directory after ${poll.waitedMs}ms`,
      { expected, installStartedAt },
    )
    return null
  }
  const actualDir = stripDir(poll.value.dir)
  REPORT.defaultPath.actualDir = actualDir
  REPORT.defaultPath.matchedExpectation = samePath(actualDir, expected)
  if (!samePath(actualDir, expected)) {
    pushFinding(
      'DEFAULT_PATH_MISMATCH',
      `default install path was ${actualDir}, but package.json-derived expectation is ${expected}`,
      {
        actualDir,
        expectedDir: expected,
        derivationSource: REPORT.defaultPath.derivationSource,
        derivation: REPORT.defaultPath.derivation,
        source: poll.value.source,
      },
    )
  }
  return actualDir
}

async function installPrimary(context) {
  if (context.kind === 'default-path') {
    const installStartedAt = Date.now()
    REPORT.install = await runInstaller(installerPath, context.installArgs, path.dirname(installerPath), INSTALL_TIMEOUT_MS, 'default-path')
    console.log(`[install-layer] installer(default) exit=${REPORT.install.exitCode} durationMs=${REPORT.install.installerDurationMs}`)
    const actualDir = await resolveDefaultTargetDir(context, installStartedAt)
    if (!actualDir) {
      const failed = {
        A1: { pass: false, expected: 'default install directory resolvable', observed: { expected: context.expectedDir } },
        A2: { pass: false, expected: `version ${VERSION_PREFIX}`, observed: { reason: 'target dir unresolved' } },
        A3: { pass: false, expected: 'uninstall registry entry', observed: { reason: 'target dir unresolved' } },
        A4: { pass: false, expected: 'Kone shortcut', observed: { reason: 'target dir unresolved' } },
      }
      return { assertions: failed, targetDir: null, install: REPORT.install }
    }
    context.targetDir = actualDir
    REPORT.targetDir = actualDir
    REPORT.targetDirPreExisted = context.preInstallPrograms.some((dir) => samePath(dir, actualDir))
    if (REPORT.preexistingDefaultDir && samePath(actualDir, REPORT.preexistingDefaultDir.path)) {
      REPORT.targetDirPreExisted = REPORT.preexistingDefaultDir.exists
    }
    const collected = await collectInstallAssertions(actualDir, VERSION_PREFIX, REPORT.preflight.existingShortcuts, 'default-path')
    REPORT.install.timeToExecutableMs = collected.timeToExecutableMs
    return { assertions: collected.assertions, targetDir: actualDir, install: REPORT.install, newlyCreatedShortcuts: collected.newlyCreatedShortcuts }
  }

  const installStartedAt = Date.now()
  REPORT.install = await runInstaller(
    installerPath,
    context.installArgs,
    path.dirname(installerPath),
    INSTALL_TIMEOUT_MS,
    context.kind,
  )
  console.log(`[install-layer] installer(${context.kind}) exit=${REPORT.install.exitCode} durationMs=${REPORT.install.installerDurationMs}`)
  const collected = await collectInstallAssertions(
    context.targetDir,
    VERSION_PREFIX,
    REPORT.preflight.existingShortcuts,
    context.kind,
  )
  REPORT.install.timeToExecutableMs = collected.timeToExecutableMs
  return {
    assertions: collected.assertions,
    targetDir: context.targetDir,
    install: REPORT.install,
    newlyCreatedShortcuts: collected.newlyCreatedShortcuts,
  }
}

async function installOlderVersion(context, older) {
  REPORT.installOlder = await runInstaller(
    older.path,
    context.installArgs,
    path.dirname(older.path),
    INSTALL_TIMEOUT_MS,
    `upgrade-baseline-${older.version}`,
  )
  console.log(`[install-layer] installer(older ${older.version}) exit=${REPORT.installOlder.exitCode} durationMs=${REPORT.installOlder.installerDurationMs}`)
  const collected = await collectInstallAssertions(
    context.targetDir,
    older.version,
    REPORT.preflight.existingShortcuts,
    `upgrade-baseline-${older.version}`,
  )
  REPORT.installOlder.timeToExecutableMs = collected.timeToExecutableMs
  return collected
}

function fileStamp(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return {
      path: filePath,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      ctime: stat.ctime.toISOString(),
      birthtime: stat.birthtime.toISOString(),
    }
  } catch {
    return null
  }
}

function sampleInstallState(dir) {
  const resources = path.join(dir, 'resources')
  return {
    dir: fileStamp(dir),
    exe: fileStamp(path.join(dir, 'KoneAI.exe')),
    resourcesDir: fileStamp(resources),
    appAsar: fileStamp(path.join(resources, 'app.asar')),
    topLevel: (directoryEntries(dir) || []).map((entry) => entry.name).sort(),
  }
}

async function installSecondPass(context) {
  const before = sampleInstallState(context.targetDir)
  REPORT.secondInstall = await runInstaller(
    installerPath,
    context.installArgs,
    path.dirname(installerPath),
    INSTALL_TIMEOUT_MS,
    'reinstall-second-pass',
  )
  console.log(`[install-layer] installer(second pass) exit=${REPORT.secondInstall.exitCode} durationMs=${REPORT.secondInstall.installerDurationMs}`)
  const collected = await collectInstallAssertions(
    context.targetDir,
    VERSION_PREFIX,
    REPORT.preflight.existingShortcuts,
    'reinstall-second-pass',
  )
  REPORT.secondInstall.timeToExecutableMs = collected.timeToExecutableMs
  const after = sampleInstallState(context.targetDir)
  const changedKeys = ['dir', 'exe', 'resourcesDir', 'appAsar'].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  )
  if (JSON.stringify(before.topLevel) !== JSON.stringify(after.topLevel)) changedKeys.push('topLevel')
  const changed = changedKeys.length > 0
  REPORT.reinstall = {
    proxyFor: 'same-version-reinstall',
    isUpgrade: false,
    sameVersion: true,
    artifactVersion: VERSION_PREFIX,
    note: 'NOT an upgrade test',
    firstInstallExitCode: REPORT.install.exitCode,
    secondInstallExitCode: REPORT.secondInstall.exitCode,
    secondInstallTimedOut: REPORT.secondInstall.timedOut,
    secondInstallError: REPORT.secondInstall.error,
    beforeSecondInstall: before,
    afterSecondInstall: after,
    changedMetadata: changedKeys,
    executableChangedBySecondInstall: changedKeys.includes('exe'),
    behavior: !after.exe
      ? 'second install left no executable'
      : REPORT.secondInstall.exitCode !== 0
        ? 'second install failed'
        : changed
          ? `second install exited 0 and rewrote tracked install metadata (${changedKeys.join(', ')})`
          : 'second install exited 0 without rewriting tracked install metadata (the existing same-version install was retained)',
    assertions: {
      A1: collected.assertions.A1,
      A2: collected.assertions.A2,
      A3: collected.assertions.A3,
      A4: collected.assertions.A4,
    },
  }
  return collected
}

function readExeVersion(exePath) {
  if (!fs.existsSync(exePath)) return { path: exePath, exists: false, matches: false, productVersion: null, fileVersion: null }
  try {
    const info = queryVersionInfo(exePath)
    const strings = [info.ProductVersion, info.FileVersion]
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
    return {
      path: exePath,
      exists: true,
      productVersion: info.ProductVersion || null,
      fileVersion: info.FileVersion || null,
      productName: info.ProductName || null,
      matches: strings.some((value) => value.startsWith(VERSION_PREFIX)),
      matchesLegacy: strings.some((value) => value.startsWith(LEGACY_VERSION_PREFIX)),
      strings,
    }
  } catch (error) {
    return { path: exePath, exists: true, matches: false, error: error.message }
  }
}

function describeRegistryEntry(entry) {
  const parsed = parseUninstallExecutable(entry.UninstallString)
  return {
    displayName: entry.DisplayName || null,
    displayVersion: entry.DisplayVersion || null,
    installLocation: entry.InstallLocation || null,
    uninstallString: entry.UninstallString || null,
    uninstallDir: parsed ? parsed.directory : null,
    key: entry.PSPath || null,
  }
}

async function runLegacyMigration(context, buildInfo) {
  const legacyDir = context.targetDir
  const defaultDir = context.expectedDir
  const legacyExe = path.join(legacyDir, 'KoneAI.exe')
  const defaultExe = path.join(defaultDir, 'KoneAI.exe')
  const state = REPORT.legacyMigration
  state.buildInfo = buildInfo
  state.legacyDir = legacyDir
  state.defaultExpectedDir = defaultDir
  if (!fs.existsSync(legacyInstallerPath)) throw new Error(`older installer not found: ${legacyInstallerPath}`)
  state.olderInstaller = {
    path: legacyInstallerPath,
    size: fs.statSync(legacyInstallerPath).size,
    sha256: sha256File(legacyInstallerPath),
    expectedVersion: LEGACY_VERSION_PREFIX,
  }

  const oldRun = await runInstaller(
    legacyInstallerPath,
    ['/S', `/D=${legacyDir}`],
    path.dirname(legacyInstallerPath),
    INSTALL_TIMEOUT_MS,
    `legacy-baseline-${LEGACY_VERSION_PREFIX}`,
  )
  REPORT.installOlder = oldRun
  state.olderInstall = oldRun
  const oldAppear = await pollUntil(() => fs.existsSync(legacyExe), EXE_APPEAR_TIMEOUT_MS)
  state.olderInstallTimeToExecutableMs = oldAppear.ok ? oldAppear.waitedMs : null
  const olderVersion = readExeVersion(legacyExe)
  state.olderExeVersion = olderVersion
  state.olderInstalled = Boolean(oldRun.exitCode === 0 && oldAppear.ok && olderVersion.matchesLegacy)
  if (!state.olderInstalled) {
    pushFinding('LEGACY_BASELINE_FAILED', `older installer ${LEGACY_VERSION_PREFIX} did not produce ${legacyExe} with the expected version`, {
      exitCode: oldRun.exitCode,
      timedOut: oldRun.timedOut,
      error: oldRun.error,
      exeAppeared: oldAppear.ok,
      version: olderVersion,
    })
  }

  const entriesAfterOlder = queryKoneUninstallEntries()
  const installLocationKeysAfterOlder = queryInstallLocationKeys()
  state.afterOlderInstall = {
    entryCount: entriesAfterOlder.length,
    entries: entriesAfterOlder.map(describeRegistryEntry),
    installLocationKeys: installLocationKeysAfterOlder,
    installLocationHitsLegacyDir: installLocationKeysAfterOlder.filter((key) => samePath(key.InstallLocation, legacyDir)),
    installLocationHitsDefaultDir: installLocationKeysAfterOlder.filter((key) => samePath(key.InstallLocation, defaultDir)),
  }
  if (entriesAfterOlder.length !== 1) {
    pushFinding('LEGACY_BASELINE_ENTRY_COUNT', `older install produced ${entriesAfterOlder.length} Kone uninstall entries (expected exactly 1)`, {
      entries: state.afterOlderInstall.entries,
    })
  }

  if (!state.olderInstalled) {
    return {
      assertions: {
        A1: { pass: false, expected: `${legacyExe} exists`, observed: { olderVersion } },
        A2: { pass: false, expected: `version ${VERSION_PREFIX}`, observed: { reason: 'legacy baseline failed; upgrade not attempted' } },
        A3: { pass: false, expected: 'exactly one Kone uninstall entry', observed: { entries: state.afterOlderInstall.entries } },
        A4: { pass: false, expected: 'Kone shortcut', observed: { reason: 'legacy baseline failed; upgrade not attempted' } },
      },
      targetDir: legacyDir,
      install: oldRun,
    }
  }

  const upgradeRun = await runInstaller(
    installerPath,
    ['/S'],
    path.dirname(installerPath),
    INSTALL_TIMEOUT_MS,
    'legacy-upgrade-1.4.38-no-D',
  )
  REPORT.install = upgradeRun
  state.upgradeInstall = upgradeRun
  state.upgradeArgs = ['/S']

  const settle = await pollUntil(() => {
    const currentLegacy = readExeVersion(legacyExe)
    const currentDefault = readExeVersion(defaultExe)
    return currentLegacy.matches || currentDefault.matches ? { currentLegacy, currentDefault } : null
  }, EXE_APPEAR_TIMEOUT_MS, 1000)
  state.upgradeSettleWaitedMs = settle.waitedMs
  await wait(1500)

  const legacyVersionAfter = readExeVersion(legacyExe)
  const defaultVersionAfter = readExeVersion(defaultExe)
  const entriesAfter = queryKoneUninstallEntries()
  const installLocationKeysAfter = queryInstallLocationKeys()
  const entryCountAfter = entriesAfter.length
  const migration = entryCountAfter === 1 ? 'REUSED' : entryCountAfter >= 2 ? 'SECOND_INSTALL' : 'NO_ENTRY'
  const landedOnLegacy = Boolean(legacyVersionAfter.exists && legacyVersionAfter.matches)
  const landedOnDefault = Boolean(defaultVersionAfter.exists && defaultVersionAfter.matches)
  const otherInstallDirs = (scanProgramsWithKoneExe() || []).filter(
    (dir) => !samePath(dir, legacyDir) && !samePath(dir, defaultDir),
  )

  state.installLocationKeysAfter = installLocationKeysAfter
  state.installLocationHitsLegacyDirAfter = installLocationKeysAfter.filter((key) => samePath(key.InstallLocation, legacyDir))
  state.installLocationHitsDefaultDirAfter = installLocationKeysAfter.filter((key) => samePath(key.InstallLocation, defaultDir))
  state.legacyExeVersionAfter = legacyVersionAfter
  state.defaultExeVersionAfter = defaultVersionAfter
  state.whereLanded = {
    legacyDir: landedOnLegacy,
    defaultDir: landedOnDefault,
    both: landedOnLegacy && landedOnDefault,
    otherDirs: otherInstallDirs,
  }
  state.entryCountBeforeUpgrade = entriesAfterOlder.length
  state.entryCountAfter = entryCountAfter
  state.afterUpgrade = {
    entries: entriesAfter.map(describeRegistryEntry),
    installLocations: installLocationKeysAfter,
    migration,
  }
  state.migration = migration

  if (!landedOnLegacy && !landedOnDefault) {
    pushFinding('LEGACY_UPGRADE_NOT_OBSERVED', `1.4.38 was not observed in ${legacyDir} or ${defaultDir} after the no-/D install`, {
      legacyVersionAfter,
      defaultVersionAfter,
      exitCode: upgradeRun.exitCode,
      timedOut: upgradeRun.timedOut,
      error: upgradeRun.error,
    })
  }
  if (migration === 'SECOND_INSTALL') {
    pushFinding(
      'LEGACY_SECOND_INSTALL',
      `upgrading a legacy ${LEGACY_VERSION_PREFIX} install with /S and no /D produced ${entryCountAfter} Kone uninstall entries (SECOND INSTALL, expected 1)`,
      {
        entryCount: entryCountAfter,
        entries: state.afterUpgrade.entries,
        whereLanded: state.whereLanded,
      },
    )
  }
  if (migration === 'NO_ENTRY') {
    pushFinding('LEGACY_NO_UNINSTALL_ENTRY', 'no Kone uninstall entry was present after the 1.4.38 upgrade attempt', {
      exitCode: upgradeRun.exitCode,
      entries: state.afterUpgrade.entries,
    })
  }

  let primaryDir = legacyDir
  if (!landedOnLegacy && landedOnDefault) primaryDir = defaultDir
  const collected = await collectInstallAssertions(
    primaryDir,
    VERSION_PREFIX,
    REPORT.preflight.existingShortcuts,
    'legacy-migration',
  )
  REPORT.install.timeToExecutableMs = collected.timeToExecutableMs
  state.finalTargetDir = primaryDir
  state.finalAssertions = collected.assertions
  return {
    assertions: collected.assertions,
    targetDir: primaryDir,
    install: REPORT.install,
    newlyCreatedShortcuts: collected.newlyCreatedShortcuts,
  }
}

async function performUninstallAll(context) {
  REPORT.uninstall.attempted = true
  try {
    execFileSync('taskkill', ['/f', '/im', 'KoneAI.exe', '/t'], { stdio: 'ignore', windowsHide: true })
  } catch {
    /* no running instance */
  }
  await wait(800)

  const legacyState = REPORT.legacyMigration || {}
  const legacyDir = legacyState.legacyDir || null
  const defaultDir = legacyState.defaultExpectedDir || null
  const defaultPreExisted = Boolean(legacyState.defaultDirSnapshotBefore && legacyState.defaultDirSnapshotBefore.exists)
  const legacyPreExisted = Boolean(legacyState.legacyDirSnapshotBefore && legacyState.legacyDirSnapshotBefore.exists)

  const attempts = []
  const initialEntries = queryKoneUninstallEntries()
  REPORT.uninstall.initialEntryCount = initialEntries.length
  console.log(`[install-layer] legacy cleanup: initial uninstall entries=${initialEntries.length}`)

  for (let index = 0; index < 6; index += 1) {
    const entries = queryKoneUninstallEntries()
    if (entries.length === 0) break
    const entry = entries.find((candidate) => candidate.UninstallString)
    if (!entry) {
      attempts.push({ error: 'Kone uninstall entry has no UninstallString', entry: describeRegistryEntry(entry || {}) })
      break
    }
    const parsed = parseUninstallExecutable(entry.UninstallString)
    if (!parsed || !fs.existsSync(parsed.executable)) {
      attempts.push({
        error: 'uninstaller executable is missing',
        entry: describeRegistryEntry(entry),
        uninstaller: parsed ? parsed.executable : null,
      })
      break
    }
    const startedAt = Date.now()
    const result = await spawnAndWait(
      parsed.executable,
      ['/S'],
      {
        cwd: path.dirname(parsed.executable),
        env: { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir() },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
      UNINSTALL_TIMEOUT_MS,
    )
    attempts.push({
      entry: describeRegistryEntry(entry),
      uninstaller: parsed.executable,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      error: result.error,
      durationMs: Date.now() - startedAt,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    })
    const beforeCount = entries.length
    await pollUntil(() => queryKoneUninstallEntries().length < beforeCount, 30000, 1000)
  }

  REPORT.uninstall.attempts = attempts
  REPORT.uninstall.found = attempts.length > 0
  REPORT.uninstall.path = attempts.length > 0 ? attempts[0].uninstaller || null : null
  REPORT.uninstall.candidates = attempts.map((attempt) => attempt.uninstaller).filter(Boolean)
  if (attempts.length > 0) {
    const last = attempts[attempts.length - 1]
    REPORT.uninstall.exitCode = last.exitCode === undefined ? null : last.exitCode
    REPORT.uninstall.signal = last.signal === undefined ? null : last.signal
    REPORT.uninstall.timedOut = attempts.some((attempt) => Boolean(attempt.timedOut))
    REPORT.uninstall.error = attempts.map((attempt) => attempt.error).filter(Boolean).join('; ') || null
    REPORT.uninstall.uninstallerDurationMs = attempts.reduce((sum, attempt) => sum + (attempt.durationMs || 0), 0)
    console.log(`[install-layer] legacy cleanup: uninstaller attempts=${attempts.length}`)
  } else {
    REPORT.uninstall.error = 'no Kone uninstaller was available during legacy cleanup'
  }

  const evaluate = () => {
    const entries = queryKoneUninstallEntries()
    const legacyExists = legacyDir ? fs.existsSync(legacyDir) : false
    const defaultExists = defaultDir ? fs.existsSync(defaultDir) : false
    const defaultEmpty = defaultExists ? directoryEmpty(defaultDir) : null
    const defaultAcceptable = !defaultExists || (defaultPreExisted && defaultEmpty === true)
    const shortcuts = scanKoneShortcuts()
    const remainingNew = shortcuts.filter(
      (candidate) => !REPORT.preflight.existingShortcuts.some((base) => samePath(base, candidate)),
    )
    return { entries, legacyExists, defaultExists, defaultEmpty, defaultAcceptable, shortcuts, remainingNew }
  }
  const cleanupStartedAt = Date.now()
  const cleanupPoll = await pollUntil(() => {
    const snapshot = evaluate()
    return snapshot.entries.length === 0 &&
      !snapshot.legacyExists &&
      snapshot.defaultAcceptable &&
      snapshot.remainingNew.length === 0
      ? snapshot
      : null
  }, UNINSTALL_TIMEOUT_MS * 2, 1000)
  const finalState = cleanupPoll.ok ? cleanupPoll.value : evaluate()
  REPORT.uninstall.cleanupDurationMs = Date.now() - cleanupStartedAt
  REPORT.assertions.A5 = {
    pass: Boolean(cleanupPoll.ok),
    expected:
      'after silently uninstalling every Kone entry: zero Kone uninstall entries, the legacy temp install dir is gone, any default-dir install is gone, and no new Kone shortcut remains',
    observed: {
      registryEntryGone: finalState.entries.length === 0,
      entryCountRemaining: finalState.entries.length,
      remainingEntries: finalState.entries.map(describeRegistryEntry),
      legacyDir: { path: legacyDir, exists: finalState.legacyExists, preExisted: legacyPreExisted },
      defaultDir: {
        path: defaultDir,
        exists: finalState.defaultExists,
        empty: finalState.defaultEmpty,
        preExisted: defaultPreExisted,
        acceptable: finalState.defaultAcceptable,
      },
      shortcutGone: finalState.remainingNew.length === 0,
      remainingShortcuts: finalState.remainingNew,
      currentShortcuts: finalState.shortcuts,
      waitedMs: cleanupPoll.waitedMs,
    },
  }

  if (finalState.legacyExists && legacyDir) {
    REPORT.residue.push({ type: 'directory', reason: 'legacy install dir survived its uninstaller', ...describeDirectory(legacyDir) })
  }
  if (finalState.defaultExists && !finalState.defaultAcceptable && defaultDir) {
    REPORT.residue.push({
      type: 'directory',
      reason: 'default-dir install survived its uninstaller (not deleted by hand)',
      ...describeDirectory(defaultDir),
    })
  }
  if (finalState.defaultExists && finalState.defaultAcceptable && defaultDir) {
    REPORT.retainedPreExistingDirs.push({ type: 'pre-existing-directory-retained-empty', ...describeDirectory(defaultDir) })
  }
  for (const entry of finalState.entries) {
    REPORT.residue.push({ type: 'registry', ...describeRegistryEntry(entry) })
  }
  for (const shortcut of finalState.remainingNew) {
    REPORT.residue.push({ type: 'shortcut', path: shortcut })
  }
  console.log(
    `[install-layer] legacy cleanup: entriesRemaining=${finalState.entries.length} legacyDirExists=${finalState.legacyExists} defaultDirExists=${finalState.defaultExists} residueItems=${REPORT.residue.length}`,
  )
  for (const item of REPORT.residue) {
    console.error(`[install-layer] RESIDUE ${item.type}: ${item.path || item.key || item.displayName || JSON.stringify(item)}`)
  }
  return finalState
}

async function resolveUninstaller(targetDir) {  const entries = queryKoneUninstallEntries()
  const entry = entries.find((candidate) => candidate.DisplayName && /kone/i.test(candidate.DisplayName)) || null
  if (entry) {
    const parsed = parseUninstallExecutable(entry.UninstallString)
    if (parsed && fs.existsSync(parsed.executable) && (!targetDir || samePath(parsed.directory, targetDir))) {
      return { path: parsed.executable, source: 'uninstall-registry', candidates: [] }
    }
  }
  if (!targetDir) return { path: null, source: null, candidates: [] }
  const candidates = findUninstallers(targetDir)
  return { path: candidates[0] || null, source: candidates[0] ? 'directory-scan' : null, candidates }
}

function checkCleanup(context, baselineShortcuts) {
  const targetDir = context.targetDir
  const targetExists = targetDir ? fs.existsSync(targetDir) : false
  const targetEmpty = targetExists ? directoryEmpty(targetDir) : null
  const targetAcceptable = !targetExists || (context.targetDirPreExisted && targetEmpty === true)
  const entries = queryKoneUninstallEntries()
  const entryGone = entries.length === 0
  const shortcuts = scanKoneShortcuts()
  const remainingNew = shortcuts.filter(
    (candidate) => !baselineShortcuts.some((base) => samePath(base, candidate)),
  )
  const shortcutGone = remainingNew.length === 0
  return {
    targetDir,
    targetExists,
    targetEmpty,
    targetAcceptable,
    targetRetainedAsPreExisting: targetExists && targetAcceptable && context.targetDirPreExisted,
    entryGone,
    shortcutGone,
    entries,
    shortcuts,
    remainingNew,
  }
}

async function performUninstall(context) {
  REPORT.uninstall.attempted = true
  try {
    execFileSync('taskkill', ['/f', '/im', 'KoneAI.exe', '/t'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } catch {
    /* no running instance */
  }
  await wait(800)

  if (!context.targetDir) {
    const entries = queryKoneUninstallEntries()
    const entry = entries.find((candidate) => candidate.InstallLocation)
    if (entry) {
      context.targetDir = stripDir(entry.InstallLocation)
      REPORT.targetDir = context.targetDir
      pushFinding('TARGET_FROM_REGISTRY', `resolved target dir from registry during uninstall: ${context.targetDir}`)
    }
  }

  const resolved = await resolveUninstaller(context.targetDir)
  REPORT.uninstall.candidates = resolved.candidates
  REPORT.uninstall.found = Boolean(resolved.path)
  REPORT.uninstall.path = resolved.path
  REPORT.uninstall.resolvedFrom = resolved.source
  console.log(`[install-layer] uninstaller candidates=${resolved.candidates.length}${resolved.path ? ` path=${resolved.path}` : ''}`)

  if (resolved.path) {
    const uninstallStartedAt = Date.now()
    const uninstallResult = await spawnAndWait(
      resolved.path,
      ['/S'],
      {
        cwd: context.targetDir || path.dirname(resolved.path),
        env: { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir() },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
      UNINSTALL_TIMEOUT_MS,
    )
    REPORT.uninstall.exitCode = uninstallResult.exitCode
    REPORT.uninstall.signal = uninstallResult.signal
    REPORT.uninstall.timedOut = uninstallResult.timedOut
    REPORT.uninstall.error = uninstallResult.error
    REPORT.uninstall.uninstallerDurationMs = Date.now() - uninstallStartedAt
    REPORT.uninstall.stdout = truncate(uninstallResult.stdout)
    REPORT.uninstall.stderr = truncate(uninstallResult.stderr)
    console.log(`[install-layer] uninstaller exit=${uninstallResult.exitCode} durationMs=${REPORT.uninstall.uninstallerDurationMs}`)
  } else {
    REPORT.uninstall.error = `no Uninstall*.exe found under ${context.targetDir || '(unresolved target dir)'}`
  }

  const cleanupStartedAt = Date.now()
  const cleanupPoll = await pollUntil(() => {
    const state = checkCleanup(context, REPORT.preflight.existingShortcuts)
    return state.targetAcceptable && state.entryGone && state.shortcutGone ? state : null
  }, UNINSTALL_TIMEOUT_MS, 1000)
  const finalState = cleanupPoll.ok ? cleanupPoll.value : checkCleanup(context, REPORT.preflight.existingShortcuts)
  REPORT.uninstall.cleanupDurationMs = Date.now() - cleanupStartedAt
  REPORT.assertions.A5 = {
    pass: Boolean(cleanupPoll.ok),
    expected:
      'target dir, uninstall registry entry and created shortcut are all gone (a pre-existing empty target dir may remain empty)',
    observed: {
      targetDirGone: !finalState.targetExists,
      targetDirExists: finalState.targetExists,
      targetDirEmpty: finalState.targetEmpty,
      targetDirRetainedAsPreExisting: finalState.targetRetainedAsPreExisting,
      registryEntryGone: finalState.entryGone,
      shortcutGone: finalState.shortcutGone,
      remainingTargetDir: finalState.targetAcceptable ? null : context.targetDir,
      remainingEntries: finalState.entries,
      remainingShortcuts: finalState.remainingNew,
      currentShortcuts: finalState.shortcuts,
      waitedMs: cleanupPoll.waitedMs,
    },
  }

  if (finalState.targetExists) {
    if (finalState.targetRetainedAsPreExisting) {
      REPORT.retainedPreExistingDirs.push({
        type: 'pre-existing-directory-retained-empty',
        ...describeDirectory(context.targetDir),
      })
    } else {
      REPORT.residue.push({ type: 'directory', ...describeDirectory(context.targetDir) })
    }
  }
  for (const entry of finalState.entries) {
    REPORT.residue.push({
      type: 'registry',
      key: entry.PSPath || null,
      displayName: entry.DisplayName || null,
      displayVersion: entry.DisplayVersion || null,
      installLocation: entry.InstallLocation || null,
      uninstallString: entry.UninstallString || null,
    })
  }
  for (const shortcut of finalState.remainingNew) {
    REPORT.residue.push({ type: 'shortcut', path: shortcut })
  }
  console.log(
    `[install-layer] cleanup: targetGone=${!finalState.targetExists} targetAcceptable=${finalState.targetAcceptable} registryGone=${finalState.entryGone} shortcutGone=${finalState.shortcutGone} residueItems=${REPORT.residue.length} durationMs=${REPORT.uninstall.cleanupDurationMs}`,
  )
  for (const item of REPORT.residue) {
    console.error(`[install-layer] RESIDUE ${item.type}: ${item.path || item.key || item.displayName || JSON.stringify(item)}`)
  }
  return finalState
}

function updatePreexistingDefaultDir() {
  if (scenario !== 'default-path') return
  const before = REPORT.preexistingDefaultDir
  if (!before || !before.path) return
  const after = snapshotDirectory(before.path)
  REPORT.preexistingDefaultDir = {
    ...before,
    stillExists: after.exists,
    emptyAfter: after.empty,
    itemCountAfter: after.itemCount,
    itemNamesAfter: after.itemNames || [],
    removedByUninstall: Boolean(before.exists && !after.exists),
    retainedEmpty: Boolean(after.exists && after.empty === true),
  }
}

function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  const isCanonical = scenario === 'custom-temp'
  REPORT.evidence = {
    canonicalReportPath: legacyReportPath,
    canonicalReportProducedByScenario: 'custom-temp',
    thisReportPath: reportPath,
    thisReportBytes: null,
    canonicalReportBytes: null,
    canonicalReportUnignored: null,
    canonicalReportIgnored: null,
    perScenarioReportsIgnored: true,
    maxTrackedCanonicalBytes: CANONICAL_REPORT_MAX_TRACKED_BYTES,
    note: null,
  }
  let payload = JSON.stringify(REPORT, null, 2)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bytes = Buffer.byteLength(payload, 'utf8')
    const canonicalBytes = isCanonical ? bytes : null
    if (
      REPORT.evidence.thisReportBytes === bytes &&
      REPORT.evidence.canonicalReportBytes === canonicalBytes
    ) {
      break
    }
    const tracked = !isCanonical || bytes <= CANONICAL_REPORT_MAX_TRACKED_BYTES
    REPORT.evidence.thisReportBytes = bytes
    REPORT.evidence.canonicalReportBytes = canonicalBytes
    REPORT.evidence.canonicalReportUnignored = tracked
    REPORT.evidence.canonicalReportIgnored = !tracked
    REPORT.evidence.note = tracked
      ? 'tests/install-layer-report.json is below 256 KB and is deliberately NOT ignored (canonical evidence, like tests/packaged-smoke-report.json). Per-scenario install-layer-report-*.json files remain ignored because they embed machine-specific temp paths.'
      : 'tests/install-layer-report.json is larger than 256 KB, so canonical evidence is UNTRACKED (ignored) to avoid committing machine-specific bulk evidence.'
    payload = JSON.stringify(REPORT, null, 2)
  }
  fs.writeFileSync(reportPath, payload, 'utf8')
  if (isCanonical) {
    fs.writeFileSync(legacyReportPath, payload, 'utf8')
  }
}

function computeVerdict() {
  if (REPORT.scriptError) {
    const a5Failed = REPORT.assertions.A5 && !REPORT.assertions.A5.pass
    if (a5Failed || REPORT.residue.length > 0) {
      return { verdict: 'RESIDUE', reason: `script error with residue: ${REPORT.reason || 'unknown'}`, exit: 2 }
    }
    return { verdict: 'ABORTED', reason: `script error: ${REPORT.reason || 'unknown'}`, exit: 9 }
  }

  const assertions = REPORT.assertions
  const installedAndAsserted =
    assertions.A1 && assertions.A1.pass &&
    assertions.A2 && assertions.A2.pass &&
    assertions.A3 && assertions.A3.pass &&
    assertions.A4 && assertions.A4.pass
  const clean = assertions.A5 && assertions.A5.pass && REPORT.residue.length === 0
  let scenarioSpecificOk = true
  let scenarioReason = ''

  if (scenario === 'reinstall') {
    const second = REPORT.secondInstall
    const secondAssertions = REPORT.reinstall ? REPORT.reinstall.assertions : null
    const secondOk = Boolean(
      second &&
      second.exitCode === 0 &&
      !second.timedOut &&
      !second.error &&
      secondAssertions &&
      secondAssertions.A1 && secondAssertions.A1.pass &&
      secondAssertions.A2 && secondAssertions.A2.pass &&
      secondAssertions.A3 && secondAssertions.A3.pass &&
      secondAssertions.A4 && secondAssertions.A4.pass,
    )
    if (!secondOk) {
      scenarioSpecificOk = false
      scenarioReason = 'second install did not exit 0 or did not pass A1-A4 on the second pass'
    }
  }

  if (scenario === 'upgrade') {
    const upgrade = REPORT.upgrade
    const baselineAssertions = upgrade ? upgrade.olderAssertions : null
    const baselineOk = Boolean(
      baselineAssertions &&
      baselineAssertions.A1 && baselineAssertions.A1.pass &&
      baselineAssertions.A2 && baselineAssertions.A2.pass &&
      baselineAssertions.A3 && baselineAssertions.A3.pass &&
      baselineAssertions.A4 && baselineAssertions.A4.pass,
    )
    const currentAssertions = upgrade ? upgrade.currentAssertions : null
    const currentOk = Boolean(
      currentAssertions &&
      currentAssertions.A1 && currentAssertions.A1.pass &&
      currentAssertions.A2 && currentAssertions.A2.pass &&
      currentAssertions.A3 && currentAssertions.A3.pass &&
      currentAssertions.A4 && currentAssertions.A4.pass,
    )
    const upgradeOk = Boolean(upgrade && upgrade.baselineOk && !upgrade.olderInstallFailed && baselineOk && currentOk)
    if (!upgradeOk) {
      scenarioSpecificOk = false
      scenarioReason = 'upgrade baseline A1-A4 or the 1.4.38 over-install A1-A4 did not all pass'
    }
  }

  if (scenario === 'legacy-migration') {
    const migration = REPORT.legacyMigration || {}
    const legacyOk = Boolean(
      migration.olderInstalled &&
      migration.olderExeVersion &&
      migration.olderExeVersion.matchesLegacy &&
      migration.migration === 'REUSED',
    )
    if (!legacyOk) {
      scenarioSpecificOk = false
      scenarioReason = `legacy migration outcome was ${migration.migration || 'UNKNOWN'} (expected REUSED from a legacy ${LEGACY_VERSION_PREFIX} install)`
    }
  }

  if (!clean) {
    return { verdict: 'RESIDUE', reason: 'A5 failed or residue was detected', exit: 2 }
  }
  if (scenario === 'default-path' && REPORT.defaultPath.matchedExpectation === false) {
    return {
      verdict: 'MISMATCH',
      reason: `default install dir ${REPORT.defaultPath.actualDir} does not match package.json-derived expectation ${REPORT.defaultPath.expectedDir} (${REPORT.defaultPath.derivationSource})`,
      exit: 5,
    }
  }
  if (!installedAndAsserted) {
    return { verdict: 'FAIL', reason: 'one or more install assertions failed', exit: 1 }
  }
  if (!scenarioSpecificOk) {
    return { verdict: 'FAIL', reason: scenarioReason, exit: 1 }
  }
  if (REPORT.install.timedOut || REPORT.install.error || !REPORT.uninstall.found) {
    return { verdict: 'FAIL', reason: 'installer timed out/errored or uninstaller was not found', exit: 1 }
  }
  return { verdict: 'PASS', reason: null, exit: 0 }
}

async function main() {
  let installAttempted = false
  let plannedExit = null
  let context = {
    kind: scenario,
    targetDir: null,
    expectedDir: null,
    installArgs: [],
    preInstallPrograms: [],
  }

  try {
    const registryEntriesBefore = queryKoneUninstallEntries()
    REPORT.preflight.existingShortcuts = scanKoneShortcuts()
    REPORT.preflight.existingUninstallEntries = registryEntriesBefore
    REPORT.preflight.existingProcesses = queryKoneProcesses()
    console.log(
      `[install-layer] scenario=${scenario} preflight: uninstallEntries=${registryEntriesBefore.length} shortcuts=${REPORT.preflight.existingShortcuts.length} processes=${REPORT.preflight.existingProcesses.length}`,
    )

    if (registryEntriesBefore.length > 0) {
      REPORT.verdict = 'ABORTED'
      REPORT.reason = 'R1: an existing Kone uninstall registry entry was detected; refusing to overwrite it'
      console.error('[install-layer] ABORTED: existing Kone uninstall entry detected')
      for (const entry of registryEntriesBefore) {
        console.error(`  ${entry.DisplayName} | ${entry.InstallLocation || '(no InstallLocation)'} | ${entry.PSPath}`)
      }
      plannedExit = 3
    } else if (!fs.existsSync(installerPath)) {
      REPORT.verdict = 'ABORTED'
      REPORT.reason = `installer not found: ${installerPath}`
      plannedExit = 4
    } else {
      const sizeBefore = fs.statSync(installerPath).size
      const shaBefore = sha256File(installerPath)
      REPORT.artifact.before = { size: sizeBefore, sha256: shaBefore }
      if (sizeBefore !== EXPECTED_SIZE || shaBefore !== EXPECTED_SHA256) {
        REPORT.verdict = 'ABORTED'
        REPORT.reason = `installer fingerprint mismatch: size=${sizeBefore}, sha256=${shaBefore}`
        plannedExit = 4
      } else if (scenario === 'default-path') {
        context = prepareDefaultPathScenario()
        installAttempted = true
        const result = await installPrimary(context)
        reportPrimaryResult(result)
      } else if (scenario === 'non-ascii') {
        context = prepareTempScenario('non-ascii', 'kone-安装层-中文-')
        installAttempted = true
        const result = await installPrimary(context)
        reportPrimaryResult(result)
      } else if (scenario === 'reinstall') {
        context = prepareTempScenario('reinstall', 'kone-install-layer-reinstall-')
        installAttempted = true
        const first = await installPrimary(context)
        reportPrimaryResult(first)
        const second = await installSecondPass(context)
        REPORT.secondInstall.newlyCreatedShortcuts = second.newlyCreatedShortcuts
        console.log(
          `[install-layer] reinstall: behavior=${REPORT.reinstall.behavior} secondA1=${REPORT.reinstall.assertions.A1.pass} secondA2=${REPORT.reinstall.assertions.A2.pass} secondA3=${REPORT.reinstall.assertions.A3.pass} secondA4=${REPORT.reinstall.assertions.A4.pass}`,
        )
      } else if (scenario === 'upgrade') {
        const older = findOlderInstaller()
        if (!older) {
          REPORT.verdict = 'ABORTED'
          REPORT.reason = 'no older installer available: searched archive/download/release/D: roots and found no Kone-Intellect-Setup-*.exe older than 1.4.38'
          plannedExit = 4
        } else {
          context = prepareTempScenario('upgrade', 'kone-install-layer-upgrade-')
          installAttempted = true
          const baseline = await installOlderVersion(context, older)
          const baselineOk = Boolean(
            baseline.assertions.A1 && baseline.assertions.A1.pass &&
            baseline.assertions.A2 && baseline.assertions.A2.pass &&
            baseline.assertions.A3 && baseline.assertions.A3.pass &&
            baseline.assertions.A4 && baseline.assertions.A4.pass,
          )
          REPORT.upgrade = {
            olderVersion: older.version,
            olderInstallerPath: older.path,
            olderInstallerSize: older.size,
            olderInstallerSha256: older.sha256,
            olderAssertions: baseline.assertions,
            baselineOk,
            olderInstallFailed: !baselineOk,
            currentAssertions: null,
            versionAfterUpgrade: null,
          }
          if (!baselineOk) {
            pushFinding(
              'UPGRADE_BASELINE_FAILED',
              `older installer ${older.version} did not pass A1-A4; skipping the 1.4.38 over-install`,
              {
                A1: baseline.assertions.A1.pass,
                A2: baseline.assertions.A2.pass,
                A3: baseline.assertions.A3.pass,
                A4: baseline.assertions.A4.pass,
              },
            )
            REPORT.assertions = { ...baseline.assertions }
          } else {
            REPORT.assertions = { ...baseline.assertions }
            const current = await installPrimary(context)
            REPORT.assertions = current.assertions
            REPORT.upgrade.currentAssertions = current.assertions
            if (current.assertions.A1.pass) {
              try {
                const info = queryVersionInfo(path.join(context.targetDir, 'KoneAI.exe'))
                REPORT.upgrade.versionAfterUpgrade = {
                  productVersion: info.ProductVersion,
                  fileVersion: info.FileVersion,
                }
              } catch (error) {
                REPORT.upgrade.versionAfterUpgrade = { error: error.message }
              }
            }
            console.log(
              `[install-layer] upgrade: ${older.version} -> ${VERSION_PREFIX} A1=${current.assertions.A1.pass} A2=${current.assertions.A2.pass}`,
            )
          }
        }
      } else if (scenario === 'legacy-migration') {
        const buildInfo = readBuildExecutableInfo()
        const expectedDir = defaultInstallDirFor(buildInfo)
        const legacyDir = path.join(os.tmpdir(), LEGACY_DIR_NAME)
        const legacySnapshot = snapshotDirectory(legacyDir)
        const expectedSnapshot = snapshotDirectory(expectedDir)
        REPORT.defaultPath.expectedDir = expectedDir
        REPORT.defaultPath.derivationSource = buildInfo.configField
        REPORT.defaultPath.derivation = {
          packageJsonPath,
          configField: buildInfo.configField,
          usedFallback: buildInfo.usedFallback,
          rawValue: buildInfo.rawValue,
          sanitizedValue: buildInfo.installDirName,
          formula: '%LOCALAPPDATA%\\Programs\\<sanitized build.executableName || build.productName>',
          evidence: buildInfo.evidence,
        }
        REPORT.legacyMigration = {
          olderVersion: LEGACY_VERSION_PREFIX,
          legacyDir,
          defaultExpectedDir: expectedDir,
          buildInfo,
          legacyDirSnapshotBefore: legacySnapshot,
          defaultDirSnapshotBefore: expectedSnapshot,
          olderInstalled: false,
          migration: null,
        }
        if (!fs.existsSync(legacyInstallerPath)) {
          REPORT.verdict = 'ABORTED'
          REPORT.reason = `legacy installer not found: ${legacyInstallerPath}`
          plannedExit = 4
        } else if (/[\s]/.test(legacyDir)) {
          REPORT.verdict = 'ABORTED'
          REPORT.reason = `temp root contains whitespace and cannot be used for unquoted /D=: ${legacyDir}`
          plannedExit = 3
        } else if (legacySnapshot.exists || expectedSnapshot.exists) {
          REPORT.verdict = 'ABORTED'
          REPORT.reason = `legacy-migration requires a clean experiment: legacyDir exists=${legacySnapshot.exists}, defaultDir exists=${expectedSnapshot.exists}`
          plannedExit = 3
        } else {
          context = {
            kind: 'legacy-migration',
            targetDir: legacyDir,
            expectedDir,
            installArgs: ['/S', `/D=${legacyDir}`],
            preInstallPrograms: [],
          }
          installAttempted = true
          const result = await runLegacyMigration(context, buildInfo)
          reportPrimaryResult(result)
          const migrationState = REPORT.legacyMigration
          console.log(
            `[install-layer] legacy-migration: older=${LEGACY_VERSION_PREFIX}@${legacyDir} landedLegacy=${migrationState.whereLanded ? migrationState.whereLanded.legacyDir : 'n/a'} landedDefault=${migrationState.whereLanded ? migrationState.whereLanded.defaultDir : 'n/a'} entryCount=${migrationState.entryCountAfter} migration=${migrationState.migration}`,
          )
        }
      } else {
        context = prepareTempScenario('custom-temp', 'kone-install-layer-')
        installAttempted = true
        const result = await installPrimary(context)
        reportPrimaryResult(result)
      }

      if (REPORT.assertions.A1) {
        console.log(
          `[install-layer] install assertions: A1=${REPORT.assertions.A1.pass} A2=${REPORT.assertions.A2.pass} A3=${REPORT.assertions.A3.pass} A4=${REPORT.assertions.A4.pass}`,
        )
      }
    }
  } catch (error) {
    REPORT.scriptError = error.stack || error.message
    REPORT.install.error = REPORT.install.error || error.message
    if (!REPORT.reason) REPORT.reason = error.message
  }

  try {
    if (installAttempted) {
      if (scenario === 'legacy-migration') {
        await performUninstallAll(context)
      } else {
        await performUninstall(context)
      }
    }
  } catch (error) {
    REPORT.uninstall.error = error.message
  } finally {
    try {
      updatePreexistingDefaultDir()
    } catch (error) {
      pushFinding('DEFAULT_DIR_POSTCHECK_FAILED', error.message)
    }

    try {
      if (fs.existsSync(installerPath)) {
        REPORT.artifact.after = {
          size: fs.statSync(installerPath).size,
          sha256: sha256File(installerPath),
        }
      } else {
        REPORT.artifact.after = { size: null, sha256: null }
      }
    } catch (error) {
      REPORT.artifact.after = { size: null, sha256: null, error: error.message }
    }

    try {
      REPORT.environment.targetDriveFreeBytesAfter = freeBytesFor(REPORT.targetDir || installerPath)
    } catch {
      REPORT.environment.targetDriveFreeBytesAfter = null
    }

    if (!REPORT.verdict) {
      const computed = computeVerdict()
      REPORT.verdict = computed.verdict
      REPORT.reason = computed.reason
      plannedExit = computed.exit
    }

    if (plannedExit === null) {
      plannedExit =
        REPORT.verdict === 'PASS' ? 0 :
        REPORT.verdict === 'FAIL' ? 1 :
        REPORT.verdict === 'RESIDUE' ? 2 :
        REPORT.verdict === 'MISMATCH' ? 5 : 9
    }

    REPORT.finishedAt = new Date().toISOString()
    writeReport()
  }

  return plannedExit
}

function reportPrimaryResult(result) {
  REPORT.assertions = { ...result.assertions }
  if (result.targetDir) {
    REPORT.targetDir = result.targetDir
  }
  if (result.newlyCreatedShortcuts) {
    REPORT.install.newlyCreatedShortcuts = result.newlyCreatedShortcuts
  }
}

main()
  .then((code) => {
    console.log(`[install-layer] scenario=${scenario} verdict=${REPORT.verdict} exit=${code}`)
    console.log(`[install-layer] report=${reportPath}`)
    if (scenario === 'custom-temp') console.log(`[install-layer] legacyReport=${legacyReportPath}`)
    process.exit(code)
  })
  .catch((error) => {
    REPORT.scriptError = error.stack || error.message
    REPORT.verdict = 'ABORTED'
    if (!REPORT.reason) REPORT.reason = error.message
    REPORT.finishedAt = new Date().toISOString()
    try {
      writeReport()
    } catch {
      /* report writing is best effort on fatal errors */
    }
    console.error(error)
    process.exit(9)
  })
