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
  证据包输出目录。默认 .\kone-evidence-1.4.38-<时间戳>。

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

try {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path (Get-Location).Path ("kone-evidence-$expectedAppVersion-$stamp")
  }
  if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  }

  $info = [ordered]@{}
  $info.collectorVersion = '1.0.0'
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
      if (-not $info.installerSha256Match) { $hashExit = 2 }
    } else {
      $info.installerError = "not found: $InstallerPath"
      $hashExit = 2
    }
  } else {
    $info.installerPath = '(未提供，跳过指纹校核)'
  }

  # ── 3. 已安装应用 ────────────────────────────────────────────
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\kone-system\KoneAI.exe'),
    (Join-Path $env:ProgramFiles   'kone-system\KoneAI.exe')
  )
  if ($env:ProgramFiles_x86) { $candidates += (Join-Path $env:ProgramFiles_x86 'kone-system\KoneAI.exe') }
  # 兼容 32 位视图变量
  $pf86 = ${env:ProgramFiles(x86)}
  if ($pf86) { $candidates += (Join-Path $pf86 'kone-system\KoneAI.exe') }

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

  # ── 4. 卸载登记项（证明真实安装）──────────────────────────────
  try {
    $unins = Get-ItemProperty `
      'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', `
      'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', `
      'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' `
      -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like '*Kone*' } | Select-Object -First 1
    if ($unins) {
      $info.uninstallDisplayName = $unins.DisplayName
      $info.uninstallVersion     = $unins.DisplayVersion
      $info.uninstallLocation    = $unins.InstallLocation
    } else {
      $info.uninstallEntryFound  = $false
    }
  } catch {
    $info.uninstallError = $_.Exception.Message
  }

  # ── 5. 日志（可选）───────────────────────────────────────────
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
    if ($info.installerSha256Match) { $lines.Add('- 结论: ✅ 一致') } else { $lines.Add('- 结论: ❌ 不一致 —— 停止验收') }
  }
  $lines.Add('')
  $lines.Add('## 已安装应用')
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
  if ($info.Contains('uninstallDisplayName')) {
    $lines.Add("- 卸载登记: $($info.uninstallDisplayName) / $($info.uninstallVersion)")
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
    Write-Host '❌ 安装包指纹不一致 —— 请停止验收并反馈。' -ForegroundColor Red
  }
  exit $hashExit
} catch {
  Write-Host "采集器异常: $($_.Exception.Message)" -ForegroundColor Red
  exit 9
}
