<#
.SYNOPSIS
  Kone 干净机器验收 — 证据采集器（只读）。

.DESCRIPTION
  在【待验收的干净机器】上运行。用途：把"人工看图描述"变成"可核对的结构化事实"，
  消除截图误读与口径漂移。本脚本：
    1. 采集机器事实（OS 版本/构建/架构/内存/PS 版本）；
    2. 校核安装包 SHA-256 是否等于发布指纹（不匹配即失败退出）；
    3. 读取已安装应用的 FileVersion / ProductVersion；
    4. 定位卸载登记项（证明是真实安装，而非绿色解压运行）；
    5. （可选）导出最新日志尾部，供失败定位。

  **只读**：不写注册表、不写应用数据、不启动应用、不需要管理员权限。
  唯一写入 = 输出目录内的证据文件。

.PARAMETER InstallerPath
  安装包路径。用于 SHA-256 校核。省略则跳过校核（不推荐）。

.PARAMETER ExpectedSha256
  预期 SHA-256。默认内置 1.4.38 发布指纹。

.PARAMETER OutDir
  证据包输出目录。默认 = 本脚本所在目录下的 kone-evidence-1.4.38-<时间戳>；
  脚本目录不可写时回落到 $env:TEMP。显式传入时按原值使用（相对路径按当前目录解析）。
  安全护栏：未显式传入 -OutDir 且解析结果落在含 .git 与 package.json 的仓库根目录内时，
  采集器拒绝执行并以退出码 9 退出，避免证据写进代码仓库。

.PARAMETER IncludeLogs
  导出最新日志尾部 200 行到 logs-tail.txt。
  ⚠️ 日志可能含 API Key / 邮箱等敏感信息，回传前必须人工检查并脱敏。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\clean-machine-collect.ps1 `
    -InstallerPath .\Kone-Intellect-Setup-1.4.38.exe -IncludeLogs

.NOTES
  退出码：0 = 采集完成且指纹一致；2 = 指纹不一致（停止验收）；9 = 采集器自身异常。
#>
[CmdletBinding()]
param(
  [string]$InstallerPath = '',
  [string]$ExpectedSha256 = '6EF8459AA2F70CB5812E852D0426F0C7D20635EDDFAF0BEE2A55538CD7741D4B',
  [string]$OutDir = '',
  [switch]$IncludeLogs
)

$ErrorActionPreference = 'Continue'
$expectedAppVersion = '1.4.38'
$outDirExplicit = $PSBoundParameters.ContainsKey('OutDir') -and -not [string]::IsNullOrWhiteSpace($OutDir)

function Test-KoneInsideRepo {
  param([string]$Path)
  $dir = $Path
  while (-not [string]::IsNullOrWhiteSpace($dir)) {
    if ((Test-Path -LiteralPath (Join-Path $dir '.git')) -and (Test-Path -LiteralPath (Join-Path $dir 'package.json'))) {
      return $true
    }
    $parent = Split-Path -Parent $dir
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $dir) { break }
    $dir = $parent
  }
  return $false
}

try {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $writable = $false
    if (-not [string]::IsNullOrWhiteSpace($baseDir) -and (Test-Path -LiteralPath $baseDir -PathType Container)) {
      try {
        $probe = Join-Path $baseDir ('.kone-write-probe-' + [guid]::NewGuid().ToString('N'))
        [System.IO.File]::WriteAllText($probe, '')
        Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
        $writable = $true
      } catch {
        $writable = $false
      }
    }
    if (-not $writable) { $baseDir = $env:TEMP }
    $OutDir = Join-Path $baseDir ("kone-evidence-$expectedAppVersion-$stamp")
  }
  $OutDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutDir)
  if ((-not $outDirExplicit) -and (Test-KoneInsideRepo -Path $OutDir)) {
    Write-Host '❌ 默认输出目录位于代码仓库内（检测到 .git 与 package.json），已拒绝写入以避免证据污染。' -ForegroundColor Red
    Write-Host "   解析路径: $OutDir" -ForegroundColor Red
    Write-Host '   请改用 -OutDir <仓库外目录>，或将脚本复制到仓库外运行。' -ForegroundColor Red
    exit 9
  }
  if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  }
  Write-Host "输出目录（绝对路径）: $OutDir" -ForegroundColor Cyan

  $info = [ordered]@{}
  $info.collectorVersion = '1.1.0'
  $info.collectedAt      = (Get-Date).ToString('s')
  $info.expectedAppVersion = $expectedAppVersion

  # ── 1. 操作系统 ──────────────────────────────────────────────
  try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $info.osCaption    = $os.Caption
    $info.osVersion    = $os.Version
    $info.osBuild      = $os.BuildNumber
    $info.osArch       = $os.OSArchitecture
    $info.memoryGB     = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  } catch {
    $info.osError = $_.Exception.Message
  }
  $info.processorArch = $env:PROCESSOR_ARCHITECTURE
  $info.psVersion     = $PSVersionTable.PSVersion.ToString()

  # ── 2. 安装包指纹 ────────────────────────────────────────────
  $hashExit = 0
  if (-not [string]::IsNullOrWhiteSpace($InstallerPath)) {
    if (Test-Path -LiteralPath $InstallerPath) {
      $f = Get-Item -LiteralPath $InstallerPath
      $actual = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash
      $info.installerPath            = $f.FullName
      $info.installerBytes           = $f.Length
      $info.installerSha256          = $actual
      $info.installerSha256Expected  = $ExpectedSha256
      $info.installerSha256Match     = ($actual -eq $ExpectedSha256)
      $info.installerFound           = $true
      if (-not $info.installerSha256Match) { $hashExit = 2 }
    } else {
      $info.installerPath  = $InstallerPath
      $info.installerFound = $false
      $info.installerError = "not found: $InstallerPath"
      $hashExit = 2
    }
  } else {
    $info.installerPath  = '(未提供，跳过指纹校核)'
    $info.installerFound = $false
  }

  # ── 3. 已安装应用 ────────────────────────────────────────────
  # 默认安装目录由 electron-builder 的 build.executableName 决定（当前为 KoneAI）：
  #   %LOCALAPPDATA%\Programs\KoneAI（当前用户）或 %ProgramFiles%\KoneAI（全机）。
  # 旧版原型曾使用 kone-system 目录；1.2.x 之后默认目录由 build.executableName 决定。
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\KoneAI\KoneAI.exe'),
    (Join-Path $env:ProgramFiles   'KoneAI\KoneAI.exe')
  )
  if ($env:ProgramFiles_x86) { $candidates += (Join-Path $env:ProgramFiles_x86 'KoneAI\KoneAI.exe') }
  # 兼容 32 位视图变量
  $pf86 = ${env:ProgramFiles(x86)}
  if ($pf86) { $candidates += (Join-Path $pf86 'KoneAI\KoneAI.exe') }

  $appPath = $null
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { $appPath = $c; break }
  }
  if ($appPath) {
    $fi = Get-Item -LiteralPath $appPath
    $info.appInstalled       = $true
    $info.appPath            = $fi.FullName
    $info.appFileVersion     = $fi.VersionInfo.FileVersion
    $info.appProductVersion  = $fi.VersionInfo.ProductVersion
    $info.appSizeBytes       = $fi.Length
    $info.appVersionMatch    = ($info.appProductVersion -eq $expectedAppVersion) -or ($info.appFileVersion -eq $expectedAppVersion)
  } else {
    $info.appInstalled = $false
  }

  # ── 4. 进程 / 快捷方式（运行时事实，只读）─────────────────────
  $koneProcs = @(Get-Process -Name 'KoneAI' -ErrorAction SilentlyContinue)
  $info.koneProcessRunning = ($koneProcs.Count -gt 0)
  $info.koneProcessCount   = $koneProcs.Count

  $shortcutRoots = @(
    (Join-Path $env:USERPROFILE 'Desktop'),
    (Join-Path $env:PUBLIC 'Desktop'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
  )
  $shortcutSeen  = @{}
  $shortcutPaths = New-Object System.Collections.Generic.List[string]
  foreach ($root in $shortcutRoots) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like '*kone*' } | ForEach-Object {
        $shortcutKey = $_.FullName.ToLowerInvariant()
        if (-not $shortcutSeen.ContainsKey($shortcutKey)) {
          $shortcutSeen[$shortcutKey] = $true
          $shortcutPaths.Add($_.FullName)
        }
      }
  }
  $info.shortcuts     = $shortcutPaths.ToArray()
  $info.shortcutCount = $shortcutPaths.Count

  # ── 5. 卸载登记项（证明真实安装；枚举全部，可检出重复安装）────
  $info.uninstallEntries       = @()
  $info.uninstallEntryCount    = 0
  $info.uninstallEntryFound    = $false
  $info.multipleInstallations  = $false
  try {
    $uninstallRoots = @(
      @{ Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'; Root = 'HKCU' },
      @{ Path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'; Root = 'HKLM' },
      @{ Path = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'; Root = 'HKLM\WOW6432Node' },
      @{ Path = 'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'; Root = 'HKCU\WOW6432Node' }
    )
    $rawEntries = New-Object System.Collections.Generic.List[object]
    $rootReadErrors = New-Object System.Collections.Generic.List[string]
    foreach ($rootSpec in $uninstallRoots) {
      try {
        Get-ItemProperty -Path $rootSpec.Path -ErrorAction SilentlyContinue |
          Where-Object { $_.DisplayName -like '*Kone*' } | ForEach-Object {
            $rawEntries.Add([pscustomobject][ordered]@{
              displayName     = $_.DisplayName
              displayVersion  = $_.DisplayVersion
              installLocation = $_.InstallLocation
              uninstallString = $_.UninstallString
              registryRoot    = $rootSpec.Root
            })
          }
      } catch {
        $rootReadErrors.Add("$($rootSpec.Root): $($_.Exception.Message)")
      }
    }
    if ($rootReadErrors.Count -gt 0) { $info.uninstallReadErrors = $rootReadErrors.ToArray() }
    $dedupSeen = @{}
    $entries   = New-Object System.Collections.Generic.List[object]
    foreach ($entry in $rawEntries) {
      $dedupKey = (@($entry.displayName, $entry.displayVersion, $entry.installLocation, $entry.uninstallString) -join '|').ToLowerInvariant()
      if (-not $dedupSeen.ContainsKey($dedupKey)) {
        $dedupSeen[$dedupKey] = $true
        $entries.Add($entry)
      }
    }
    $info.uninstallEntries      = $entries.ToArray()
    $info.uninstallEntryCount   = $entries.Count
    $info.uninstallEntryFound   = ($entries.Count -ge 1)
    $info.multipleInstallations = ($entries.Count -gt 1)
    if ($entries.Count -ge 1) {
      $info.uninstallDisplayName = $entries[0].displayName
      $info.uninstallVersion     = $entries[0].displayVersion
      $info.uninstallLocation    = $entries[0].installLocation
      $info.uninstallString      = $entries[0].uninstallString
    }
  } catch {
    $info.uninstallError = $_.Exception.Message
  }

  # ── 6. 日志（可选）───────────────────────────────────────────
  $logDir = Join-Path $env:APPDATA 'kone-system\logs'
  $info.logDir = $logDir
  if (Test-Path -LiteralPath $logDir) {
    $logs = @(Get-ChildItem -LiteralPath $logDir -Filter '*.log' -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending)
    $info.logFiles = @($logs | ForEach-Object {
      [ordered]@{ name = $_.Name; sizeBytes = $_.Length; lastWrite = $_.LastWriteTime.ToString('s') }
    })
    if ($IncludeLogs -and $logs.Count -gt 0) {
      $newest = $logs[0]
      $tail = @(Get-Content -LiteralPath $newest.FullName -Tail 200 -ErrorAction SilentlyContinue)
      $header = @(
        '# 日志尾部（最近 200 行）',
        "# 来源: $($newest.FullName)",
        '# ⚠️ 可能含 API Key / 邮箱等敏感信息 —— 回传前必须人工检查并脱敏',
        ''
      )
      ($header + $tail) | Set-Content -LiteralPath (Join-Path $OutDir 'logs-tail.txt') -Encoding UTF8
      $info.logTailFrom  = $newest.Name
      $info.logTailLines = $tail.Count
    }
  } else {
    $info.logDirExists = $false
  }

  # ── 输出 ────────────────────────────────────────────────────
  $jsonPath = Join-Path $OutDir 'machine-info.json'
  ($info | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $jsonPath -Encoding UTF8

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('# Kone 干净机器验收 — 机器事实采集')
  $lines.Add('')
  $lines.Add("采集时间: $($info.collectedAt)  采集器: v$($info.collectorVersion)  目标版本: $expectedAppVersion")
  $lines.Add('')
  $lines.Add('## 操作系统')
  $lines.Add("- 版本: $($info.osCaption)")
  $lines.Add("- 版本号/构建: $($info.osVersion) / $($info.osBuild)")
  $lines.Add("- 架构: $($info.osArch)  内存: $($info.memoryGB) GB")
  $lines.Add("- PowerShell: $($info.psVersion)")
  $lines.Add('')
  $lines.Add('## 安装包指纹')
  $lines.Add("- 路径: $($info.installerPath)")
  $lines.Add("- 字节数: $($info.installerBytes)")
  $lines.Add("- SHA-256: $($info.installerSha256)")
  $lines.Add("- 预期: $($info.installerSha256Expected)")
  if ($info.Contains('installerSha256Match')) {
    if ($info.installerSha256Match) {
      $lines.Add('- 结论: ✅ 一致')
    } else {
      $lines.Add('- 结论: ❌ 指纹不一致（安装包存在，但内容与预期 SHA-256 不符）—— 停止验收')
    }
  } elseif ($info.Contains('installerError')) {
    $lines.Add('- 结论: ❌ 安装包不存在或不可读 —— 无法校核（与「指纹不一致」是两种不同失败）')
  } else {
    $lines.Add('- 结论: ⏭️ 未提供安装包，已跳过指纹校核')
  }
  $lines.Add('')
  $lines.Add('## 已安装应用')
  $lines.Add("- appInstalled: $($info.appInstalled.ToString().ToLowerInvariant())")
  if ($info.appInstalled) {
    $lines.Add("- 路径: $($info.appPath)")
    $lines.Add("- 产品版本: $($info.appProductVersion)  文件版本: $($info.appFileVersion)")
    if ($info.Contains('appVersionMatch') -and $info.appVersionMatch) {
      $lines.Add('- 版本核对: ✅ 与 1.4.38 一致')
    } else {
      $lines.Add('- 版本核对: ⚠️ 与 1.4.38 不一致')
    }
  } else {
    $lines.Add('- 未在常见安装路径找到 KoneAI.exe（若尚未安装 S1，属正常）')
  }
  if ($info.uninstallEntryCount -eq 1) {
    $lines.Add("- 卸载登记: $($info.uninstallDisplayName) / $($info.uninstallVersion)")
  }
  $lines.Add('')
  $lines.Add('## 卸载登记')
  $lines.Add("- uninstallEntryFound: $($info.uninstallEntryFound.ToString().ToLowerInvariant())")
  $lines.Add("- uninstallEntryCount: $($info.uninstallEntryCount)")
  $lines.Add("- multipleInstallations: $($info.multipleInstallations.ToString().ToLowerInvariant())")
  if ($info.uninstallEntryCount -eq 0) {
    $lines.Add('- 未发现任何 Kone 卸载登记（若尚未安装 S1，属正常）')
  } elseif ($info.uninstallEntryCount -gt 1) {
    $lines.Add("⚠️ 检测到 $($info.uninstallEntryCount) 个 Kone 卸载登记（疑似重复安装/升级残留），需人工核查")
    $entryIndex = 1
    foreach ($entry in $info.uninstallEntries) {
      $lines.Add("- [$entryIndex] $($entry.displayName) / $($entry.displayVersion) / 目录: $($entry.installLocation) / 根: $($entry.registryRoot)")
      $entryIndex++
    }
  } else {
    $lines.Add('- 仅 1 个卸载登记，未检出重复安装')
  }
  $lines.Add('')
  $lines.Add('## 进程 / 快捷方式')
  $lines.Add("- koneProcessRunning: $($info.koneProcessRunning.ToString().ToLowerInvariant())")
  $lines.Add("- shortcutCount: $($info.shortcutCount)")
  if ($info.shortcutCount -gt 0) {
    foreach ($shortcutPath in $info.shortcuts) {
      $lines.Add("- 快捷方式: $shortcutPath")
    }
  } else {
    $lines.Add('- 未发现 Kone 快捷方式')
  }
  $lines.Add('')
  $lines.Add('## 日志')
  if ($info.logDirExists -eq $false) {
    $lines.Add('- 日志目录尚不存在（应用未启动过）')
  } else {
    $lines.Add("- 目录: $($info.logDir)  文件数: $($info.logFiles.Count)")
  }
  $lines.Add('')
  $lines.Add('## 归档要求')
  $lines.Add('- 将本目录与本文件、S1–S11 截图一并回传。')
  $lines.Add('- 若 logs-tail.txt 含密钥/邮箱，请先脱敏再回传。')

  $txtPath = Join-Path $OutDir 'machine-info.txt'
  $lines | Set-Content -LiteralPath $txtPath -Encoding UTF8

  Write-Host ''
  Write-Host "证据包已生成: $OutDir" -ForegroundColor Green
  Write-Host "  - machine-info.json"
  Write-Host "  - machine-info.txt"
  if ($IncludeLogs -and (Test-Path -LiteralPath (Join-Path $OutDir 'logs-tail.txt'))) {
    Write-Host "  - logs-tail.txt  (⚠️ 回传前请脱敏)"
  }
  if ($hashExit -eq 2) {
    Write-Host ''
    if ($info.installerFound -eq $true) {
      Write-Host '❌ 安装包指纹不一致（安装包存在但内容不符）—— 请停止验收并反馈。' -ForegroundColor Red
    } else {
      Write-Host '❌ 安装包不存在或不可读 —— 无法校核指纹（与「指纹不一致」不同），请检查路径。' -ForegroundColor Red
    }
  }
  if ($info.multipleInstallations) {
    Write-Host ''
    Write-Host "⚠️ 检测到 $($info.uninstallEntryCount) 个 Kone 卸载登记（疑似重复安装/升级残留），需人工核查。" -ForegroundColor Yellow
  }
  exit $hashExit
} catch {
  Write-Host "采集器异常: $($_.Exception.Message)" -ForegroundColor Red
  exit 9
}
