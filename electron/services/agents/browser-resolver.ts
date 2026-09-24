/**
 * Agent Browser Resolver — L0-2/B2 打包可用性修复
 *
 * 问题背景（商用上线就绪度审计 B2）：
 * 完整版 puppeteer 的 Chromium 二进制存于【开发机】用户缓存目录
 * （~/.cache/puppeteer），electron-builder 的 files 配置不携带它。
 * 打包产物在用户干净机器上调用 puppeteer.launch() 会因
 * "Could not find Chrome" 失败——开发机正常、用户机器失败。
 *
 * 解析顺序（Windows 主战场）：
 *   1. KONE_BROWSER_PATH 环境变量（显式钉死某浏览器可执行文件）
 *   2. Chrome 稳定版标准安装路径
 *   3. Edge 稳定版标准安装路径（Win10/11 几乎必预装）
 *   4. puppeteer 默认解析（开发机缓存，兜底保持 dev 行为不变）
 *
 * 宪法约束：失败必须如实报错并给出可操作指引，严禁假成功。
 */
import * as fs from 'fs'

type BrowserResolution = {
  executablePath?: string
  label: string
}

/** Windows 标准安装路径候选（顺序即优先级：Chrome 优先于 Edge） */
const WINDOWS_BROWSER_CANDIDATES: Array<{ path: string; label: string }> = [
  { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', label: 'Chrome (Program Files)' },
  { path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', label: 'Chrome (Program Files x86)' },
  { path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', label: 'Edge (Program Files x86)' },
  { path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', label: 'Edge (Program Files)' },
]

const fileExists = (candidate: string): boolean => {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

/** 探测当前机器可用的浏览器可执行文件；找不到系统浏览器时返回 undefined（回退 puppeteer 默认） */
export const resolveBrowserExecutable = (): BrowserResolution => {
  const envPath = String(process.env.KONE_BROWSER_PATH || '').trim()
  if (envPath && fileExists(envPath)) {
    return { executablePath: envPath, label: 'custom (KONE_BROWSER_PATH)' }
  }

  for (const candidate of WINDOWS_BROWSER_CANDIDATES) {
    if (fileExists(candidate.path)) {
      return { executablePath: candidate.path, label: candidate.label }
    }
  }

  // 开发机兜底：puppeteer 自身解析（依赖 dev 缓存中的 Chromium）。
  // 打包环境下走到这里意味着用户机器既无 Chrome 也无 Edge。
  return { label: 'puppeteer-default (no system browser found)' }
}

/**
 * 统一的有状态浏览器启动入口（Agent 专用：headless:false + 持久化 userDataDir）。
 * 返回 { browser, label } —— label 供 Agent 写入运行日志，保证浏览器来源可审计。
 * 全部候选失败时抛出带可操作指引的错误（中文，直达终端外贸用户）。
 */
export const launchPersistentBrowser = async (
  userDataDir: string | undefined,
  extraArgs: string[] = [],
): Promise<{ browser: any; label: string }> => {
  const puppeteer = await import('puppeteer')
  const { executablePath, label } = resolveBrowserExecutable()

  const baseOptions: Record<string, unknown> = {
    headless: false,
    // AG-01 威胁模型说明：
    // --no-sandbox / --disable-setuid-sandbox 用于兼容受限 Windows 运行环境
    // （Puppeteer 启动的 Chromium 在部分企业安全策略下无法启用 OS 级沙箱）。
    // 受控边界：
    // 1. 仅由 Agent 专用入口 launchPersistentBrowser 使用；主窗口不受影响
    //    （window-service 未禁用 sandbox，保持 contextIsolation + nodeIntegration:false）。
    // 2. 浏览器使用独立 userDataDir（persist:kone_sandbox_*），与主应用 profile 隔离。
    // 3. 导航目标受 Agent 层 URL 约束；下载、扩展、远程调试默认不启用。
    // 4. 风险接受：正式发布前应评估替代隔离方案（AppContainer / 独立低权限进程），
    //    并在 security-review 中签字确认后方可维持该配置。
    args: ['--no-sandbox', '--disable-setuid-sandbox', ...extraArgs],
    userDataDir,
  }

  try {
    const browser = executablePath
      ? await puppeteer.launch({ ...baseOptions, executablePath } as any)
      : await puppeteer.launch(baseOptions as any)
    return { browser, label }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || '')
    if (!executablePath) {
      throw new Error(
        `未找到可用的浏览器引擎（${message}）。请在本机安装 Google Chrome 或 Microsoft Edge 后重试，` +
          '或设置 KONE_BROWSER_PATH 环境变量指向浏览器可执行文件（如 chrome.exe）。',
        { cause: err },
      )
    }
    throw err
  }
}
