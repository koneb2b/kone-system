const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn, execFileSync } = require('child_process')

const rootDir = path.resolve(__dirname, '..')
const installerPath = path.join(rootDir, 'release', 'Kone-Intellect-Setup-1.4.38.exe')
const reportPath = path.join(rootDir, 'tests', 'install-layer-report.json')

const EXPECTED_SIZE = 89962234
const EXPECTED_SHA256 = '6EF8459AA2F70CB5812E852D0426F0C7D20635EDDFAF0BEE2A55538CD7741D4B'
const VERSION_PREFIX = '1.4.38'

const INSTALL_TIMEOUT_MS = 300000
const EXE_APPEAR_TIMEOUT_MS = 120000
const REGISTRY_TIMEOUT_MS = 60000
const SHORTCUT_TIMEOUT_MS = 30000
const UNINSTALL_TIMEOUT_MS = 120000
const POLL_MS = 500
const MIN_FREE_BYTES = 1500 * 1024 * 1024

const UNINSTALL_ROOTS = [
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
]

const REPORT = {
  scenario: 'install-layer-acceptance',
  version: '1.4.38',
  a3oracle: {
    criterion:
      'Kone uninstall entry exists AND its UninstallString targets targetDir\\Uninstall*.exe AND exactly one HKCU\\Software\\* key has InstallLocation == targetDir',
    sources: [
      'node_modules/app-builder-lib/templates/nsis/include/installer.nsh:104',
      'node_modules/app-builder-lib/templates/nsis/include/installer.nsh:119-123',
      'node_modules/app-builder-lib/templates/nsis/multiUser.nsh:8-9',
    ],
  },
  startedAt: new Date().toISOString(),
  finishedAt: null,
  targetDir: null,
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
  },
  assertions: {},
  install: {
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
  residue: [],
  verdict: null,
  reason: null,
  scriptError: null,
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const truncate = (text, max = 8000) => (text && text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text || '')
const samePath = (a, b) => {
  const norm = (value) => {
    if (!value) return ''
    let text = String(value).trim()
    if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1)
    return text.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  }
  return norm(a) === norm(b)
}

function runPowerShell(script) {
  const stdout = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
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

function describeDirectory(dir) {
  const summary = { path: dir, topLevel: [], fileCount: 0, totalBytes: 0, truncated: false }
  const walk = (current, depth) => {
    if (summary.fileCount >= 5000) {
      summary.truncated = true
      return
    }
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
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

function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(REPORT, null, 2), 'utf8')
}

async function main() {
  let installAttempted = false
  let plannedExit = null
  let targetDir = null
  let tempRoot = null
  let baselineShortcuts = []
  let newlyCreatedShortcuts = []

  try {
  const registryEntriesBefore = queryKoneUninstallEntries()
  baselineShortcuts = scanKoneShortcuts()
  REPORT.preflight.existingUninstallEntries = registryEntriesBefore
  REPORT.preflight.existingShortcuts = baselineShortcuts
  REPORT.preflight.existingProcesses = queryKoneProcesses()
  console.log(`[install-layer] preflight: uninstallEntries=${registryEntriesBefore.length} shortcuts=${baselineShortcuts.length} processes=${REPORT.preflight.existingProcesses.length}`)

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
    } else {
      tempRoot = os.tmpdir()
      REPORT.environment.osTmpdir = tempRoot
      if (/[\s]/.test(tempRoot)) {
        throw new Error(`temp root contains whitespace and cannot be used for unquoted /D=: ${tempRoot}`)
      }
      targetDir = path.join(tempRoot, `kone-install-layer-${Date.now()}`)
      REPORT.targetDir = targetDir
      if (/[\s]/.test(targetDir)) {
        throw new Error(`target directory contains whitespace and cannot be used for unquoted /D=: ${targetDir}`)
      }
      const freeBefore = freeBytesFor(targetDir)
      REPORT.environment.targetDriveFreeBytesBefore = freeBefore
      if (freeBefore !== null && freeBefore < MIN_FREE_BYTES) {
        throw new Error(`insufficient free space on ${path.parse(targetDir).root} (${freeBefore} bytes)`)
      }
      if (fs.existsSync(targetDir)) {
        throw new Error(`target directory already exists: ${targetDir}`)
      }
      fs.mkdirSync(targetDir, { recursive: true })

      installAttempted = true
      const exePath = path.join(targetDir, 'KoneAI.exe')
      const installStartedAt = Date.now()
      const installResult = await spawnAndWait(
        installerPath,
        ['/S', `/D=${targetDir}`],
        {
          cwd: path.dirname(installerPath),
          env: { ...process.env, TEMP: tempRoot, TMP: tempRoot },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
        INSTALL_TIMEOUT_MS,
      )
      REPORT.install.exitCode = installResult.exitCode
      REPORT.install.signal = installResult.signal
      REPORT.install.timedOut = installResult.timedOut
      REPORT.install.error = installResult.error
      REPORT.install.installerDurationMs = Date.now() - installStartedAt
      REPORT.install.stdout = truncate(installResult.stdout)
      REPORT.install.stderr = truncate(installResult.stderr)
      console.log(`[install-layer] installer exit=${installResult.exitCode} durationMs=${REPORT.install.installerDurationMs}`)

      const appear = await pollUntil(() => fs.existsSync(exePath), EXE_APPEAR_TIMEOUT_MS)
      REPORT.install.timeToExecutableMs = appear.ok ? Date.now() - installStartedAt : null
      const a1 = {
        pass: appear.ok,
        expected: `${exePath} exists`,
        observed: {
          path: exePath,
          exists: fs.existsSync(exePath),
          waitedMs: appear.waitedMs,
        },
      }
      REPORT.assertions.A1 = a1

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
      REPORT.assertions.A2 = {
        pass: versionStrings.some((value) => value.startsWith(VERSION_PREFIX)),
        expected: `ProductVersion or FileVersion starts with ${VERSION_PREFIX}`,
        observed: {
          productVersion,
          fileVersion,
          productName: version ? version.ProductName : null,
          versionError,
        },
      }

      const collectA3State = () => {
        const entries = queryKoneUninstallEntries()
        const entry = entries.find((candidate) => candidate.DisplayName && /kone/i.test(candidate.DisplayName)) || null
        const uninstallStringCheck = entry
          ? matchesInstallTarget(entry.UninstallString, targetDir)
          : { pass: false, parsed: null, nameOk: false, directoryOk: false }
        const installLocationHits = queryInstallLocationKeys().filter((key) => samePath(key.InstallLocation, targetDir))
        return { entries, entry, uninstallStringCheck, installLocationHits }
      }
      const a3Poll = await pollUntil(() => {
        const state = collectA3State()
        const pass = Boolean(state.entry) && state.uninstallStringCheck.pass && state.installLocationHits.length === 1
        return pass ? state : null
      }, REGISTRY_TIMEOUT_MS, 1000)
      const a3State = a3Poll.value || collectA3State()
      REPORT.assertions.A3 = {
        pass: Boolean(a3Poll.value),
        expected: `uninstall entry with DisplayName containing "Kone" whose UninstallString targets ${targetDir}\\Uninstall*.exe, plus exactly one HKCU\\Software\\* key with InstallLocation == ${targetDir}`,
        observed: {
          uninstallEntry: a3State.entry,
          allKoneEntries: a3State.entries,
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
      if (shortcutPoll.value) newlyCreatedShortcuts = shortcutPoll.value.newlyCreated
      REPORT.assertions.A4 = {
        pass: Boolean(shortcutPoll.value),
        expected: 'a .lnk containing "Kone" exists in Desktop or Start Menu',
        observed: {
          baseline: baselineShortcuts,
          current: shortcutPoll.value ? shortcutPoll.value.current : scanKoneShortcuts(),
          newlyCreated: newlyCreatedShortcuts,
          searchedRoots: shortcutRoots(),
          waitedMs: shortcutPoll.waitedMs,
        },
      }
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
    if (installAttempted && targetDir) {
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

      const uninstallers = findUninstallers(targetDir)
      REPORT.uninstall.candidates = uninstallers
      REPORT.uninstall.found = uninstallers.length > 0
      console.log(`[install-layer] uninstaller candidates=${uninstallers.length}${uninstallers[0] ? ` path=${uninstallers[0]}` : ''}`)
      if (uninstallers.length > 0) {
        const uninstallerPath = uninstallers[0]
        REPORT.uninstall.path = uninstallerPath
        const uninstallStartedAt = Date.now()
        const uninstallResult = await spawnAndWait(
          uninstallerPath,
          ['/S'],
          {
            cwd: targetDir,
            env: { ...process.env, TEMP: tempRoot, TMP: tempRoot },
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
        REPORT.uninstall.error = `no Uninstall*.exe found under ${targetDir}`
      }

      const cleanupStartedAt = Date.now()
      const checkCleanup = () => {
        const targetGone = !fs.existsSync(targetDir)
        const entries = queryKoneUninstallEntries()
        const entryGone = entries.length === 0
        const shortcuts = scanKoneShortcuts()
        const remainingNew = shortcuts.filter(
          (candidate) => !baselineShortcuts.some((base) => samePath(base, candidate)),
        )
        const shortcutGone = remainingNew.length === 0
        return {
          targetGone,
          entryGone,
          shortcutGone,
          entries,
          shortcuts,
          remainingNew,
        }
      }
      const cleanupPoll = await pollUntil(() => {
        const state = checkCleanup()
        return state.targetGone && state.entryGone && state.shortcutGone ? state : null
      }, UNINSTALL_TIMEOUT_MS, 1000)
      const finalState = cleanupPoll.ok ? cleanupPoll.value : checkCleanup()
      REPORT.uninstall.cleanupDurationMs = Date.now() - cleanupStartedAt
      REPORT.assertions.A5 = {
        pass: Boolean(cleanupPoll.ok),
        expected: 'target dir, uninstall registry entry and created shortcut are all gone',
        observed: {
          targetDirGone: finalState.targetGone,
          registryEntryGone: finalState.entryGone,
          shortcutGone: finalState.shortcutGone,
          remainingTargetDir: finalState.targetGone ? null : targetDir,
          remainingEntries: finalState.entries,
          remainingShortcuts: finalState.remainingNew,
          currentShortcuts: finalState.shortcuts,
          waitedMs: cleanupPoll.waitedMs,
        },
      }

      if (fs.existsSync(targetDir)) {
        REPORT.residue.push({ type: 'directory', ...describeDirectory(targetDir) })
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
        `[install-layer] cleanup: targetGone=${finalState.targetGone} registryGone=${finalState.entryGone} shortcutGone=${finalState.shortcutGone} residueItems=${REPORT.residue.length} durationMs=${REPORT.uninstall.cleanupDurationMs}`,
      )
      for (const item of REPORT.residue) {
        console.error(`[install-layer] RESIDUE ${item.type}: ${item.path || item.key || item.displayName || JSON.stringify(item)}`)
      }
    }
  } catch (error) {
    REPORT.uninstall.error = error.message
  } finally {
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

    if (REPORT.scriptError) {
      const a5Failed = REPORT.assertions.A5 && !REPORT.assertions.A5.pass
      if (a5Failed || REPORT.residue.length > 0) {
        REPORT.verdict = 'RESIDUE'
        REPORT.reason = `script error with residue: ${REPORT.reason || 'unknown'}`
        plannedExit = 2
      } else {
        REPORT.verdict = 'ABORTED'
        REPORT.reason = `script error: ${REPORT.reason || 'unknown'}`
        plannedExit = 9
      }
    } else if (!REPORT.verdict) {
      const assertions = REPORT.assertions
      const installedAndAsserted =
        assertions.A1 && assertions.A1.pass &&
        assertions.A2 && assertions.A2.pass &&
        assertions.A3 && assertions.A3.pass &&
        assertions.A4 && assertions.A4.pass
      const clean = assertions.A5 && assertions.A5.pass && REPORT.residue.length === 0
      if (!clean) {
        REPORT.verdict = 'RESIDUE'
        REPORT.reason = 'A5 failed or residue was detected'
      } else if (!installedAndAsserted) {
        REPORT.verdict = 'FAIL'
        REPORT.reason = 'one or more install assertions failed'
      } else if (REPORT.install.timedOut || REPORT.install.error || !REPORT.uninstall.found) {
        REPORT.verdict = 'FAIL'
        REPORT.reason = 'installer timed out/errored or uninstaller was not found'
      } else {
        REPORT.verdict = 'PASS'
      }
    }

    if (plannedExit === null) {
      plannedExit =
        REPORT.verdict === 'PASS' ? 0 :
        REPORT.verdict === 'FAIL' ? 1 :
        REPORT.verdict === 'RESIDUE' ? 2 : 9
    }

    REPORT.finishedAt = new Date().toISOString()
    writeReport()
  }

  return plannedExit
}

main()
  .then((code) => {
    console.log(`[install-layer] verdict=${REPORT.verdict} exit=${code}`)
    console.log(`[install-layer] report=${reportPath}`)
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
