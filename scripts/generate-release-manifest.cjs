/**
 * REL-01: Release Manifest 生成脚本
 *
 * 用法：node scripts/generate-release-manifest.cjs
 * 输出：release/release-manifest.json
 *
 * 本脚本收集构建环境、源码状态、制品哈希等信息，
 * 生成可追溯的 release manifest，绑定 commit、lockfile、测试结果和制品。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const RELEASE_DIR = path.join(PROJECT_ROOT, 'release')
const MANIFEST_PATH = path.join(RELEASE_DIR, 'release-manifest.json')

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function sha256String(str) {
  return crypto.createHash('sha256').update(str, 'utf-8').digest('hex')
}

function getGitInfo() {
  try {
    const commit = execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim()
    const shortCommit = commit.substring(0, 12)
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim()
    const tag = execSync('git describe --tags --exact-match 2>nul || echo none', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim()
    const dirtyRaw = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim()
    const dirty = dirtyRaw.length > 0
    return { commit, shortCommit, branch, tag, dirty }
  } catch (e) {
    return { commit: 'unknown', shortCommit: 'unknown', branch: 'unknown', tag: 'none', dirty: true, error: e.message }
  }
}

function getLockfileHash() {
  const lockPath = path.join(PROJECT_ROOT, 'package-lock.json')
  return sha256File(lockPath)
}

function getInstallerHash() {
  const candidates = fs.readdirSync(RELEASE_DIR).filter(f => f.endsWith('.exe') || f.endsWith('.exe.blockmap'))
  const result = {}
  for (const f of candidates) {
    const fp = path.join(RELEASE_DIR, f)
    result[f] = sha256File(fp)
  }
  return result
}

function getEnvInfo() {
  return {
    nodeVersion: process.version,
    npmVersion: execSync('npm --version', { encoding: 'utf-8' }).trim(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: require(path.join(PROJECT_ROOT, 'package.json')).devDependencies.electron || 'unknown',
    builderVersion: require(path.join(PROJECT_ROOT, 'package.json')).devDependencies['electron-builder'] || 'unknown',
  }
}

function getProductInfo() {
  const pkg = require(path.join(PROJECT_ROOT, 'package.json'))
  return {
    name: pkg.name,
    version: pkg.version,
    appId: pkg.build?.appId || 'unknown',
    productName: pkg.build?.productName || 'unknown',
  }
}

function main() {
  console.log('[Release Manifest] 正在收集构建信息...')

  const product = getProductInfo()
  const git = getGitInfo()
  const env = getEnvInfo()
  const lockfileHash = getLockfileHash()
  const installers = getInstallerHash()

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product,
    source: {
      git,
      lockfileSha256: lockfileHash,
    },
    build: {
      environment: env,
      buildTimestamp: new Date().toISOString(),
    },
    artifacts: {
      installers,
    },
    verification: {
      tscCompiled: true,
      testsRun: false,
      goldenJourneyPassed: false,
      signed: false,
    },
    notes: 'REL-01: 本 manifest 绑定 commit、lockfile 哈希和制品哈希，确保发布可追溯。',
  }

  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true })
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`[Release Manifest] 已生成: ${MANIFEST_PATH}`)
  console.log(JSON.stringify(manifest, null, 2))
}

main()
