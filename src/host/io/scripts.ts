/**
 * 启动链脚本生成（L2 副作用边界）：open-webui.ps1 / launch.cmd / launcher.vbs。
 * 从 index.js 原样搬入（P2-B2）——脚本内容是多年踩坑沉淀，逐字保留，勿"顺手优化"。
 * 产物被 wscript / cmd / 托盘进程在 dsh 之外执行，改任何一行都要沙箱 + 真机回归。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logsDirOf } from '../core/paths.ts';

/**
 * 生成"打开 WebUI"脚本（openMode）：
 *   优先打开已安装的 PWA 应用（开始菜单/任务栏快捷方式 → Chromium Web Applications 目录兜底）；
 *   未安装时按 openMode：
 *     app        = 桌面 App 模式（默认）：Chromium 系（Edge/Chrome/Brave…）用 --app=URL
 *                  启动独立应用窗口（任务栏独立条目、无地址栏、图标取页面 favicon）；
 *                  Firefox 回退 -new-window
 *     new-window = 默认浏览器独立窗口（--new-window / -new-window）
 *     default    = 浏览器默认行为
 */
export function writeOpenScript(launcherDir: string, port: number, openMode: string, shortcutName: string, pwaAppId: string | null): void {
  const url = `http://127.0.0.1:${String(port)}`;
  const hostForFingerprint = new URL(url).hostname;
  const lnkBase = shortcutName.replace(/\.lnk$/i, '');
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$url = '${url}'`,
    // alpha.2+ 的 Web UI 要求一次性进程 token（无 token 访问返回 401）。dsh 启动后
    // applyInner 会把带 token 的 URL 写入 webui-url.json（v0.4.1 起主格式）；此处仅在同
    // host 同端口时采用，避免 rc.2（无此机制，文件不存在）或多实例场景下用过期/错端口的 token。
    `$tokFile = '${join(launcherDir, 'webui-url.json').replace(/'/g, "''")}'`,
    `try { if (Test-Path $tokFile) { $j = Get-Content $tokFile -Raw -Encoding UTF8 | ConvertFrom-Json; if ($j.url) { $uUri = [System.Uri]$j.url; $bUri = [System.Uri]$url; if ($uUri.Host -eq $bUri.Host -and $uUri.Port -eq $bUri.Port) { $url = $j.url } } } } catch { }`,
    // 打开诊断日志：写入 launcherDir/open-webui.log（排查"已运行却新开实例/空白窗口"）
    `$openLogPath = '${join(logsDirOf(launcherDir), 'open-webui.log').replace(/'/g, "''")}'`,
    // 自建日志目录：open-webui.ps1 可能在 dsh 未运行时被快捷方式链调用
    'try { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $openLogPath) | Out-Null } catch { }',
    'function Log-Open([string]$msg) {',
    '  try { Add-Content -Path $openLogPath -Value ((\'[\' + (Get-Date -Format \'HH:mm:ss.fff\') + \'] \') + $msg) -Encoding UTF8 } catch { }',
    '}',
    // 聚焦已运行的 PWA 窗口（user32）：不再启动新实例——--app-id 和 AppsFolder 对已运行应用都会再开一个窗口。
    // PID 匹配 + 标题匹配双模式（PWA 窗口句柄可能挂在 msedge 主进程而非 pwahelper 下）；
    // AttachThreadInput + Alt 键技巧绕过 Windows 前台锁。
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;public class WinAct { [DllImport(\"user32.dll\")] public static extern bool EnumWindows(WinAct.EnumProc cb, System.IntPtr lp); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid); [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(System.IntPtr h); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(System.IntPtr h, int cmd); [DllImport(\"user32.dll\")] public static extern bool GetWindowText(System.IntPtr h, StringBuilder sb, int max); [DllImport(\"user32.dll\")] public static extern bool AttachThreadInput(uint a, uint b, bool f); [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(System.IntPtr h); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra); [DllImport(\"kernel32.dll\")] public static extern uint GetCurrentThreadId(); public delegate bool EnumProc(System.IntPtr h, System.IntPtr lp); }' -ErrorAction SilentlyContinue",
    'function Focus-AppWindow([int]$targetPid, [string]$titleRegex) {',
    '  try {',
    "    if (-not ('WinAct' -as [type])) { Log-Open 'focus: WinAct type missing'; return $false }",
    '    $script:focused = [IntPtr]::Zero',
    '    $script:scanNote = \'no visible window\'',
    '    $cb = [WinAct+EnumProc]{ param($hWnd, $lp)',
    '      if (-not [WinAct]::IsWindowVisible($hWnd)) { return $true }',
    '      $pid2 = 0',
    '      [WinAct]::GetWindowThreadProcessId($hWnd, [ref]$pid2) | Out-Null',
    '      $sb = New-Object System.Text.StringBuilder 512',
    '      [WinAct]::GetWindowText($hWnd, $sb, 512) | Out-Null',
    '      $title = $sb.ToString()',
    "      if ($targetPid -gt 0 -and $pid2 -eq $targetPid) { $script:focused = $hWnd; $script:scanNote = 'pid-match hwnd=' + $hWnd + ' title=[' + $title + ']'; return $false }",
    "      if ($titleRegex -and $title -match $titleRegex) { $script:focused = $hWnd; $script:scanNote = 'title-match hwnd=' + $hWnd + ' title=[' + $title + ']'; return $false }",
    '      return $true',
    '    }',
    '    [WinAct]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null',
    "    Log-Open ('focus scan: ' + $script:scanNote + ' (pid=' + $targetPid + ' title=/' + $titleRegex + '/)')",
    '    if ($script:focused -eq [IntPtr]::Zero) { return $false }',
    '    [WinAct]::ShowWindow($script:focused, 9) | Out-Null',
    '    [WinAct]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)',
    '    [WinAct]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)',
    '    $cur = [WinAct]::GetCurrentThreadId()',
    '    $tgt = [WinAct]::GetWindowThreadProcessId($script:focused, [ref]0)',
    '    [WinAct]::AttachThreadInput($cur, $tgt, $true) | Out-Null',
    '    [WinAct]::SetForegroundWindow($script:focused) | Out-Null',
    '    [WinAct]::BringWindowToTop($script:focused) | Out-Null',
    '    [WinAct]::SetForegroundWindow($script:focused) | Out-Null',
    '    [WinAct]::AttachThreadInput($cur, $tgt, $false) | Out-Null',
    '    return $true',
    '  } catch { Log-Open (\'focus error: \' + $_.Exception.Message); return $false }',
    '}',
    '',
    "# 冷启动验证（issue：原生浏览器未启动时，--app-id/--app 参数可能被浏览器首进程吞掉，",
    "# 表现为'长时间未启动或启动失败'且脚本已 exit 0 静默放弃）：记录启动前浏览器进程数，",
    "# 浏览器已在运行 → 窗口激活即时完成，直接判定成功；浏览器完全没起来 → 等待首进程出现，",
    "# 超时仍未出现则返回 $false，让调用方继续下一条启动路径，最终回退默认方式打开。",
    '$browserBefore = @(Get-Process msedge,chrome,brave,firefox,pwahelper -ErrorAction SilentlyContinue).Count',
    'function Test-WebUiUp {',
    '  if ($browserBefore -gt 0) { return $true }',
    '  Start-Sleep -Seconds 5',
    '  return ((@(Get-Process msedge,chrome,brave,firefox,pwahelper -ErrorAction SilentlyContinue).Count) -gt 0)',
    '}',
    '',
    "if ('${openMode}' -eq 'default') { Start-Process $url; exit 0 }",
    '',
    "# ── 已安装 PWA 检测：优先打开已安装的应用（独立窗口/图标/任务栏都由系统管理）──",
    '# 0) host 扫描 app_id（主路径）：按当前站点 start_url 匹配 Edge 的 Manifest Resources + Preferences，',
    '#    部署到任何端口/机器都能找到（自适应，不依赖任何随机前缀或应用名）',
    ...(pwaAppId
      ? [
          `$appId = '${pwaAppId}'`,
          "$edgeExe = (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\\MSEdgeHTM\\shell\\open\\command' -ErrorAction SilentlyContinue).'(default)'",
          'if ($edgeExe) {',
          "  $m = [regex]::Match($edgeExe, '\"([^\"]+\\.exe)\"')",
          "  if (-not $m.Success) { $m = [regex]::Match($edgeExe, '^(\\S+\\.exe)') }",
          '  if ($m.Success) {',
          "    # 应用已在运行：唤起现有窗口，不再新开实例（--app-id 对已运行应用会弹新窗口）",
          "    # 枚举必须含 pwahelper.exe：Edge 新版 PWA 应用窗口的宿主进程名是 pwahelper.exe（Web App Helper），不是 msedge.exe",
          "    # 匹配锚点（按可靠性排序，全部是'用户无法在前端修改'或'配置实时同步'的参数）：",
          "    #   1) --app-id=<app_id>：Edge 分配的应用 id（用户改不了）",
          "    #   2) --ip-override-url=/--app= 的 URL：host 任意（127.0.0.1/localhost/局域网 IP 都行），",
          "    #      只匹配配置端口（端口来自插件配置，实时同步）——不依赖域名/应用名/页面标题",
          `    $runningApps = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe' or Name='pwahelper.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and ($_.CommandLine.Contains('--app-id=' + $appId) -or $_.CommandLine -match '--ip-override-url=http://[^/]*:${String(port)}/' -or $_.CommandLine -match '--app=http://[^/]*:${String(port)}') })`,
          "    Log-Open ('appId=[' + $appId + '] running procs: ' + $runningApps.Count)",
          '    if ($runningApps.Count -gt 0) {',
          "      Log-Open ('matching PIDs: ' + (($runningApps | ForEach-Object { $_.ProcessId }) -join ','))",
          "      # 已运行：绝不新开（--app-id / AppsFolder 对已运行应用都会再弹一个窗口）——聚焦现有窗口",
          "      $focusOk = Focus-AppWindow ([int]$runningApps[0].ProcessId) 'DeepSeek Harness|DSH WebUI'",
          "      Log-Open ('focused existing window: ' + $focusOk)",
          '      exit 0',
          '    }',
          "    Log-Open ('app not detected running; dump browser proc cmdlines (window process should be here):')",
          '    foreach ($pd in @(Get-CimInstance Win32_Process -Filter "Name=\'msedge.exe\' or Name=\'chrome.exe\' or Name=\'pwahelper.exe\'" -ErrorAction SilentlyContinue)) {',
          '      $pcl = $pd.CommandLine',
          '      if (-not $pcl) { continue }',
          '      $pshort = if ($pcl.Length -gt 150) { $pcl.Substring(0, 150) + \'...\' } else { $pcl }',
          "      Log-Open ('    PID ' + $pd.ProcessId + ' | ' + $pshort)",
          '    }',
          "    Start-Process $m.Groups[1].Value -ArgumentList @(\"--app-id=$appId\")",
          '    Start-Sleep -Seconds 4',
          `    $afterApps = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe' or Name='pwahelper.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and ($_.CommandLine.Contains('--app-id=' + $appId) -or $_.CommandLine -match '--ip-override-url=http://[^/]*:${String(port)}/' -or $_.CommandLine -match '--app=http://[^/]*:${String(port)}') })`,
          "    $afterPids = if ($afterApps.Count -gt 0) { ' PIDs=' + (($afterApps | ForEach-Object { $_.ProcessId }) -join ',') } else { '' }",
          "    Log-Open ('after --app-id cold start: app procs=' + $afterApps.Count + $afterPids + ' (0 = Edge swallowed the arg / reused main process)')",
          '    if (Test-WebUiUp) { exit 0 }',
          '  }',
          '}',
        ]
      : []),
    '# 0b) AppsFolder（辅助）：AUMID 前缀是站点指纹（127.0.0.1-xxx），同部署位置时最快',
    `$hostFingerprint = '${hostForFingerprint.replace(/[^0-9a-zA-Z.:-]/g, '')}-'`,
    "$appsShell = New-Object -ComObject Shell.Application",
    "$appsFolder = $appsShell.Namespace('shell:::{4234d49b-0245-4df3-b780-3893943456e1}')",
    'if ($appsFolder) {',
    '  foreach ($appItem in $appsFolder.Items()) {',
    "    if ($appItem.Path -like \"$hostFingerprint*\") {",
    "      Start-Process 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + $appItem.Path); if (Test-WebUiUp) { exit 0 }",
    '    }',
    '  }',
    '  # 名字匹配兜底（用户可能改了 PWA 显示名，但 AUMID 前缀匹配失败时仍有希望）。',
    '  # 防误伤：必须同时满足 AUMID 站点指纹前缀（127.0.0.1-*）——名字相同但 AUMID 非本站',
    '  # 的应用（如桌面版 "DeepSeek Harness"，AUMID ai.deepseek.harness.desktop）绝不启动，',
    '  # 否则会拉起桌面版 exe 抢 3080 端口导致 EADDRINUSE。PWA 改名字不影响 AUMID。',
    `  $primaryAppName = '${lnkBase.replace(/'/g, "''")}'`,
    '  foreach ($appItem in $appsFolder.Items()) {',
    '    if ($appItem.Name -eq $primaryAppName -and $appItem.Path -like "$hostFingerprint*") {',
    "      Start-Process 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + $appItem.Path); if (Test-WebUiUp) { exit 0 }",
    '    }',
    '  }',
    '}',
    `$lnkName = '${lnkBase.replace(/'/g, "''")}.lnk'`,
    '# 1) 精确匹配（我们的应用名；注意排除桌面——那是我们自己的启动器快捷方式，',
    '#    TargetPath 是 wscript 而非浏览器，避免自我递归循环）',
    '$lnkCandidates = @(',
    "  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\' + $lnkName),",
    "  (Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\' + $lnkName),",
    "  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\' + $lnkName)",
    ')',
    '$ws0 = New-Object -ComObject WScript.Shell',
    'foreach ($lnk in $lnkCandidates) {',
    '  if (Test-Path $lnk) {',
    '    try {',
    '      $t0 = $ws0.CreateShortcut($lnk).TargetPath.ToLower()',
    "      if ($t0 -match 'msedge|chrome') { Start-Process $lnk; if (Test-WebUiUp) { exit 0 } }",
    '    } catch { }',
    '  }',
    '}',
    '# 2) 通用扫描：任意名字的 PWA 快捷方式（浏览器 exe + --app-id 参数是 PWA 特征，',
    '#    覆盖旧版本/旧名字安装的应用，如 "DeepSeek Harness"）',
    '$ws = New-Object -ComObject WScript.Shell',
    '$scanDirs = @(',
    "  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),",
    "  (Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),",
    "  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'),",
    "  ([Environment]::GetFolderPath('Desktop'))",
    ')',
    'foreach ($d in $scanDirs) {',
    '  if (-not (Test-Path $d)) { continue }',
    '  foreach ($lnk in (Get-ChildItem $d -Filter *.lnk -ErrorAction SilentlyContinue)) {',
    '    try {',
    '      $s = $ws.CreateShortcut($lnk.FullName)',
    "      $t = $s.TargetPath.ToLower()",
    "      if (($t -match 'msedge|chrome') -and $s.Arguments -match '--app-id=') { Start-Process $lnk.FullName; if (Test-WebUiUp) { exit 0 } }",
    '    } catch { }',
    '  }',
    '}',
    '# 3) 兜底：Chromium Web Applications 目录（internal manifest 匹配 start_url/manifest_url；含 System Profile）',
    '$webAppDirs = @(',
    "  (Join-Path $env:LOCALAPPDATA 'Microsoft\\Edge\\User Data\\Default\\Web Applications'),",
    "  (Join-Path $env:LOCALAPPDATA 'Microsoft\\Edge\\User Data\\System Profile\\Web Applications'),",
    "  (Join-Path $env:LOCALAPPDATA 'Google\\Chrome\\User Data\\Default\\Web Applications')",
    ')',
    `$needle = '127.0.0.1:${String(port)}'`,
    'foreach ($dir in $webAppDirs) {',
    '  if (-not (Test-Path $dir)) { continue }',
    '  $found = Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Where-Object {',
    "    $mf = Join-Path $_.FullName 'manifest.json'",
    '    if (Test-Path $mf) {',
    '      $j = Get-Content $mf -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json',
    "      if ($j -and ($j.start_url -match $needle -or $j.manifest_url -match $needle -or ($j.manifest -and $j.manifest.start_url -match $needle))) { $true } else { $false }",
    '    } else { $false }',
    '  } | Select-Object -First 1',
    '  if ($found) {',
    "    $mf = Join-Path $found.FullName 'manifest.json'",
    '    $j = Get-Content $mf -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json',
    '    $appId = $j.app_id',
    '    if ($appId) {',
    '      $exe = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\\MSEdgeHTM\\shell\\open\\command" -ErrorAction SilentlyContinue)."(default)"',
    "      if (-not $exe) { $exe = (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\\ChromeHTML\\shell\\open\\command' -ErrorAction SilentlyContinue).'(default)' }",
    '      if ($exe) {',
    "        $m = [regex]::Match($exe, '\"([^\"]+\\.exe)\"')",
    "        if (-not $m.Success) { $m = [regex]::Match($exe, '^(\\S+\\.exe)') }",
    '        if ($m.Success) { Start-Process $m.Groups[1].Value -ArgumentList @("--app-id=$appId"); if (Test-WebUiUp) { exit 0 } }',
    '      }',
    '    }',
    '  }',
    '}',
    '',
    '# ── 未安装：按 openMode 打开 ──',
    "# 探测系统默认浏览器（http 关联的 ProgId → exe 路径）",
    "$progId = (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice' -Name ProgId -ErrorAction SilentlyContinue).ProgId",
    'if ($progId) {',
    "  $cmd = (Get-ItemProperty ('Registry::HKEY_CLASSES_ROOT\\' + $progId + '\\shell\\open\\command') -Name '(default)' -ErrorAction SilentlyContinue).'(default)'",
    '  if ($cmd) {',
    "    $m = [regex]::Match($cmd, '\"([^\"]+\\.exe)\"')",
    "    if (-not $m.Success) { $m = [regex]::Match($cmd, '^(\\S+\\.exe)') }",
    '    if ($m.Success) {',
    '      $exe = $m.Groups[1].Value',
    '      $exeName = [System.IO.Path]::GetFileNameWithoutExtension($exe).ToLower()',
    "      if ('${openMode}' -eq 'app' -and $exeName -match 'msedge|chrome|brave|opera|vivaldi|chromium|edge') {",
    "        Start-Process $exe -ArgumentList @(\"--app=$url\")",
    '        if (Test-WebUiUp) { exit 0 }',
    "        # 冷启动时 --app 可能被首进程吞掉 → 回退 --new-window 再试",
    "        Start-Process $exe -ArgumentList @('--new-window', $url); exit 0",
    '      }',
    "      if ($exeName -match 'firefox') { Start-Process $exe -ArgumentList @('-new-window', $url); exit 0 }",
    "      else { Start-Process $exe -ArgumentList @('--new-window', $url); exit 0 }",
    '    }',
    '  }',
    '}',
    '',
    '# 回退：默认方式打开',
    'Start-Process $url',
  ].join('\r\n');
  // 必须带 UTF-8 BOM：Windows PowerShell 5.1 默认按 ANSI/GBK 读无 BOM 的 .ps1，
  // 中文会被误读成乱码、破坏字符串引号导致整个脚本解析失败（托盘起不来的根因）。
  writeFileSync(join(launcherDir, 'open-webui.ps1'), '\uFEFF' + ps, 'utf-8');
}

/** 生成启动器：launch.cmd（HTTP 端口探测 + 启动/直连）+ launcher.vbs（静默隐藏窗口）。
 *  注意：托盘不再由 launch.cmd 拉起——改由 apply() 统一管理（windowsHide: true 确保无黑窗）。
 *  launch.cmd 用 start "" 拉起 PowerShell 在部分 Windows 版本上无法隐藏窗口，
 *  且会导致托盘被重复拉起两次（launch.cmd 一次 + apply() 一次），Mutex 虽能互斥但
 *  第一个实例的窗口已可见。 */
export function writeLauncherFiles(launcherDir: string, launchCommand: string, port: number, trayPath: string | null, openScriptPath: string): void {
  const url = `http://127.0.0.1:${String(port)}`;
  const openLine = openScriptPath
    ? `  powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${openScriptPath}"`
    : `  start "" "${url}"`;
  const cmd = [
    '@echo off',
    // 日志目录：launch.cmd 可能在任何 dsh 进程之前跑（首次双击），故自己保证目录存在——
    // 否则 `>>` 重定向到一个不存在的目录会报错并打乱下面的 if/else 分支判断。
    `set "LOGDIR=${join(launcherDir, 'logs')}"`,
    'if not exist "%LOGDIR%" mkdir "%LOGDIR%"',
    // 启动日志：记录每次双击的分支走向（探测结果 / 走"已运行"还是"启动"），
    // 配合 native-launcher.log 的环境诊断，issue 无需追问即可定位。
    '>> "%LOGDIR%\\launch.log" echo [%date% %time%] launch.cmd start (probe 127.0.0.1:' + String(port) + ')',
    // HTTP 探测（而非 TCP）：TCP 通 ≠ 服务活——"托盘退出后立刻双击"时旧 dsh 端口
    // 可能未释放，TCP 探测误判 open → 前端拉起但后端已死 → 白屏（issue: 前端无法正常显示）。
    // 2026-09-12 探测语义对齐（真机实锤修复）：此前裸 / 只认 2xx，而 dsh alpha.2+ 起裸路径
    // 恒 401（token 鉴权）→ 服务运行时永远误判 closed → 双击快捷方式永不唤起、反而试图再
    // 拉起实例（EADDRINUSE 静默失败）。修正两点（与 autoOpen / open-webui.ps1 同一套语义）：
    // 1) 优先 webui-url.txt 的带 token URL（host+port 匹配才采用）
    // 2) 收到任何 HTTP 响应（含 401）都算 alive——能收到响应 = 服务在；连接拒绝/超时才算 closed
    `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "$ErrorActionPreference = 'SilentlyContinue'; $u = 'http://127.0.0.1:${String(port)}/'; $tf = '${join(launcherDir, 'webui-url.txt')}'; if (Test-Path $tf) { $t = (Get-Content $tf -Raw).Trim(); if ($t) { $p2 = [System.Uri]$t; $b2 = [System.Uri]$u; if ($p2.Host -eq $b2.Host -and $p2.Port -eq $b2.Port) { $u = $t } } }; try { $null = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 3; exit 0 } catch { if ($_.Exception.Response) { exit 0 }; exit 1 }"`,
    'if %errorlevel%==0 (',
    `  >> "%LOGDIR%\\launch.log" echo [%date% %time%] probe=open - server already running`,
    openLine,
    ') else (',
    `  >> "%LOGDIR%\\launch.log" echo [%date% %time%] probe=closed, starting via launchCommand`,
    // ⚠️ 此处严禁加"后台解释器轮询/隐藏窗口网络请求"类就绪探测——2026-09-13 实测
    // 被 360 判定 Backdoor/Meterpreter.p 查杀（隐藏 powershell + 循环网络请求 + 落盘的
    // 组合命中后门启发式），launch.cmd 整个被删、快捷方式失效。
    // dsh 就绪轮询留痕（性能数据源）：launchCommand 前台阻塞执行，"spawn→socket ready"
    // 原先是黑盒——改用 **Windows 自带 curl.exe + 纯 cmd 后台**（系统组件，行为=端口探测，
    // 启发式特征远轻于脚本解释器），每秒探测一次，就绪即落 `dsh ready` 行。
    `  start "" /min powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${join(launcherDir, 'launch-ready.ps1')}" ${String(port)} "${join(logsDirOf(launcherDir), 'launch.log')}"`,
    '  set DSH_LAUNCHER=1',
    // launchCommand 依赖 PATH（默认 `dsh --profile web`）。命令缺失时回退 npx（默认 dsh 场景）
    // 并给出明确指引，而不是静默失败（否则表现为"双击只弹命令行、webUI 起不来"）。
    // 含路径分隔符的命令视为绝对/相对路径，跳过检测直接执行。
    ...(launchCommand.split(/\s+/)[0].includes('\\') || launchCommand.split(/\s+/)[0].includes('/')
      ? [`  ${launchCommand} < nul`]
      : launchCommand.split(/\s+/)[0] === 'dsh'
        ? [
            '  where dsh >nul 2>nul',
            '  if errorlevel 1 (',
            `    >> "%LOGDIR%\\launch.log" echo [%date% %time%] 'dsh' not in PATH, npx fallback`,
            "    echo [native-launcher] 'dsh' not found in PATH, trying npx fallback...",
            `    npx --yes @deepseek-ai/dsh ${launchCommand.split(/\s+/).slice(1).join(' ')} >> "%LOGDIR%\\dsh-boot.log" 2>&1`,
            '    if errorlevel 1 (',
            `      >> "%LOGDIR%\\launch.log" echo [%date% %time%] npx fallback failed`,
            '      echo [native-launcher] ERROR: both "dsh" and "npx @deepseek-ai/dsh" failed.',
            '      echo [native-launcher] Install dsh globally: npm install -g @deepseek-ai/dsh',
            '      echo [native-launcher] Or set launchCommand in cordis.patch.yml.',
            '      echo [native-launcher] Closing in 15 seconds...',
            '      timeout /t 15 >nul',
            '    )',
            '  ) else (',
            // stdout/stderr 落盘：dsh 官方启动输出（各 bundle 装配时间戳）留档——
            // 启动性能归因与排错的数据源（快捷方式链 vs CMD 手动的 20s 差异靠它定位）
            `    ${launchCommand} < nul >> "%LOGDIR%\\dsh-boot.log" 2>&1`,
            '  )',
          ]
        : [
            `  where ${launchCommand.split(/\s+/)[0]} >nul 2>nul`,
            '  if errorlevel 1 (',
            `    >> "%LOGDIR%\\launch.log" echo [%date% %time%] '${launchCommand.split(/\s+/)[0]}' not found in PATH`,
            `    echo [native-launcher] ERROR: '${launchCommand.split(/\s+/)[0]}' not found in PATH.`,
            '    echo [native-launcher] Install the command or set launchCommand in cordis.patch.yml.',
            '    echo [native-launcher] Closing in 15 seconds...',
            '    timeout /t 15 >nul',
            '  ) else (',
            `    ${launchCommand} < nul >> "%LOGDIR%\\dsh-boot.log" 2>&1`,
            '  )',
          ]),
    ')',
  ].join('\r\n');
  mkdirSync(launcherDir, { recursive: true });
  // launch.ps1（主入口，2026-09-13 用户拍板）：probe/启动全程可见输出 + 每步耗时落盘。
  // 背景：cmd 形态的两个结构性问题——① 无官方语法解析器（batch 转义错只能真机炸）；
  // ② 隐藏窗口 + 命令链形态被杀软启发式盯上（Backdoor/Meterpreter.p 误报查杀实录）。
  // launch.cmd 保留生成作为回退备份。
  const launchPs = [
    "param(",
    "  [int]$Port = 3080,",
    "  [string]$LauncherDir,",
    "  [string]$OpenScript,",
    "  [string]$LaunchCommand = 'dsh --profile web --no-open'",
    ")",
    "$ErrorActionPreference = 'Continue'",
    "$logPath = Join-Path $LauncherDir 'logs\\launch.log'",
    // dsh 自身的标准输出（官方 banner / 官方告警）必须落盘：旧 launch.cmd 用 `>> dsh-boot.log 2>&1`
    // 采过，迁到 launch.ps1 时漏了（2026-09-13 对账发现 dsh-boot.log 正好停在切换那一刻）。
    // 日志唯一汇点原则：不落盘 = 不存在（用户查不到、维护者也拿不到）。
    "$bootLog = Join-Path $LauncherDir 'logs\\dsh-boot.log'",
    "try { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null } catch { }",
    "function Log-Launch([string]$msg) {",
    "  $line = '[' + (Get-Date -Format 'yyyy/MM/dd HH:mm:ss.fff') + '] ' + $msg",
    "  Write-Host $line",
    "  try { Add-Content -Path $logPath -Value $line -Encoding UTF8 } catch { }",
    "}",
    "Log-Launch ('launch.ps1 start (probe 127.0.0.1:' + $Port + ')')",
    "$sw = [System.Diagnostics.Stopwatch]::StartNew()",
    "$u = 'http://127.0.0.1:' + $Port + '/'",
    // token URL 读取（v0.4.1 起 webui-url.json 主格式；txt 为 launch.cmd 回退兼容双写）
    "$tf = Join-Path $LauncherDir 'webui-url.json'",
    "try { if (Test-Path $tf) { $j = Get-Content $tf -Raw -Encoding UTF8 | ConvertFrom-Json; if ($j.url) { $p2 = [System.Uri]$j.url; $b2 = [System.Uri]$u; if ($p2.Host -eq $b2.Host -and $p2.Port -eq $b2.Port) { $u = $j.url } } } } catch { }",
    // 探测语义必须保持 HTTP（TCP 通 ≠ 服务活：托盘退出后端口未释放时，端口判定会误判 open
    // → 前端拉起但后端已死 → 白屏，2026-09-12 真机实锤修复）；也**只能**是 HTTP——裸 TCP 异步
    // 连接会被 360 静态判成 PS.NetLoader 并删掉脚本本体（2026-09-13 隔离矩阵实锤）。
    // 唯一能安全砍掉的浪费：本机连 loopback 的**关闭端口**要白等 ~2.05s（丢包而非拒绝；
    // 实测 Invoke-WebRequest 2052ms / TcpClient 2040ms）。
    // 判据用 .NET 的**结构化监听表**，不是解析 netstat 文本——文本会踩两个跨机器坑：
    //   ① PATH 里若有 MSYS/Git 版 netstat，状态词是 "LISTEN"（不是 LISTENING）→ 把"在听"
    //      读成"没人听" → 误判 closed → 再起一个 dsh → EADDRINUSE 且页面永不打开；
    //   ② 本地化输出。这正是本项目历史上最痛的故障（"双击永不唤起"），不能为省 2 秒去赌。
    // 失败方向全部朝安全侧：
    //   拿不到**非空**监听表（API 抛错/被限制）→ 逐字回退原 HTTP + token 探测（=今天的行为）
    //   表拿到且该端口无人监听 → 直接 closed（无人监听 ⇒ 不可能有 HTTP 响应，结论必然一致）
    //   表拿到且有人在听（含僵尸端口）→ 逐字走原 HTTP + token 探测，语义不变
    "$table = @()",
    "$listenOk = $false",
    "try { $table = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()); $listenOk = $table.Count -gt 0 } catch { $listenOk = $false }",
    "$listeners = @($table | Where-Object { $_.Port -eq $Port })",
    "$alive = $false",
    "if ($listenOk -and $listeners.Count -eq 0) { $via = 'tcp-table:no-listener' } else {",
    "  if ($listenOk) { $via = 'http:listener-present' } else { $via = 'http:tcp-table-failed' }",
    "  try { $null = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 3; $alive = $true } catch { if ($_.Exception.Response) { $alive = $true } }",
    "}",
    "Log-Launch ('probe=' + $(if ($alive) { 'open - server already running' } else { 'closed, starting via launchCommand' }) + ' (probe took ' + $sw.ElapsedMilliseconds + 'ms, ' + $via + ')')",
    "if ($alive) {",
    "  Log-Launch 'focusing/opening via open-webui.ps1'",
    "  & $OpenScript",
    "  Log-Launch 'launch.ps1 exit (open path)'",
    "  exit 0",
    "}",
    "$env:DSH_LAUNCHER = '1'",
    "Log-Launch ('launching: ' + $LaunchCommand)",
    "$sw.Restart()",
    // 提权**不在这里做**：脚本里「隐藏起子进程」会被 360 静态启发式判成
    // HEUR:TrojanDownloader/PS.NetLoader.ae 并把**脚本本体删掉**（2026-09-13 隔离矩阵实锤：
    // 删掉 Start-Process -WindowStyle Hidden 那一行即存活；保留它、只删 Invoke-Expression 照样被删）。
    // 改由插件在自己的进程里自提（src/host/io/priority.ts，模块导入即执行）。
    // 启动路径仍是 Invoke-Expression（dsh 进程树形状不变），输出按脚本块重定向落 dsh-boot.log——
    // 不往命令串里拼 `>>`，路径含空格/引号也不会被解析坏。
    "try { Add-Content -Path $bootLog -Value (('===== ' + (Get-Date -Format 'yyyy/MM/dd HH:mm:ss') + ' launchCommand start =====')) -Encoding UTF8 } catch { }",
    // 编码必须显式统一成 UTF-8：PS 5.1 的 `*>>` 会把子进程输出按 **UTF-16LE** 落盘
    // （实测每个字符之间夹 \0，文件不可读），而 dsh/node 写出的是 UTF-8；且 PS 按
    // `[Console]::OutputEncoding` 解码子进程输出——不声明就会用本机 ANSI 码页（中文变乱码）。
    // 先声明控制台输出编码为 UTF-8，再用 Out-File -Encoding utf8 追加，才等价于旧
    // launch.cmd 的 `>> dsh-boot.log 2>&1`（原始 UTF-8 落盘）。
    "try { [Console]::OutputEncoding = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false } catch { }",
    "& { Invoke-Expression $LaunchCommand } 2>&1 | Out-File -FilePath $bootLog -Append -Encoding utf8",
    "Log-Launch ('launchCommand exited after ' + $sw.ElapsedMilliseconds + 'ms')",
  ].join('\r\n');
  // 必须带 UTF-8 BOM：Windows PowerShell 5.1 对**无 BOM 的 .ps1** 按 ANSI/GBK 读，
  // 脚本里的中文注释会被误读（字节序列不巧时还会吞掉引号 → 整个脚本解析失败）。
  // open-webui.ps1 早踩过这个坑（见 writeOpenScript），launch.ps1 同样要带——
  // 否则跨机器/跨区域设置就是靠运气（本机 zh-CN 侥幸能跑，不代表别人能跑）。
  writeFileSync(join(launcherDir, 'launch.ps1'), '\uFEFF' + launchPs, 'utf-8');
  // 曾计划在此生成 priority.ps1（认领 dsh 的 node 进程并在启动器侧提权），已删除：
  // 它必须由 launch.ps1 以「隐藏子 PowerShell」方式拉起，而那一行会被 360 静态判定为
  // PS.NetLoader 并删掉 launch.ps1 本体（2026-09-13 隔离矩阵实锤）。提权改为插件自提
  // （src/host/io/priority.ts）。教训记在 AGENTS.md Gotchas：本机不能出现"脚本隐藏起子进程"。
  // launch-ready.ps1（独立产物）：dsh 后台就绪轮询 + 毫秒计时落盘——复杂逻辑放 PS 是因为
  // **cmd 没有官方语法解析器**（batch 转义错只能靠跑真机才能炸出来：单 % 被吞、嵌套引号
  // 截断，2026-09-13 实测），而 PS 有官方 Parser（E2E -1b 强制验证）。launch.cmd 只留一行
  // -File 调用，参数直传，无嵌套引号。
  const readyPs = [
    "param([int]$Port = 3080, [string]$LogPath)",
    "$t0 = Get-Date",
    "for ($i = 0; $i -lt 240; $i++) {",
    "  Start-Sleep -Milliseconds 500",
    "  $ok = $false",
    "  try { $null = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/') -UseBasicParsing -TimeoutSec 1; $ok = $true } catch { if ($_.Exception.Response) { $ok = $true } }",
    "  if ($ok) { break }",
    "}",
    "$ms = [int]((Get-Date) - $t0).TotalMilliseconds",
    "try { Add-Content -Path $LogPath -Value (('[' + (Get-Date -Format 'yyyy/MM/dd HH:mm:ss.fff') + '] dsh socket ready after ' + $ms + 'ms (launchCommand)')) -Encoding UTF8 } catch { }",
  ].join('\r\n');
  writeFileSync(join(launcherDir, 'launch-ready.ps1'), readyPs, 'utf-8');
  writeFileSync(join(launcherDir, 'launch.cmd'), cmd, 'utf-8');
  const vbs = [
    'Set ws = CreateObject("WScript.Shell")',
    // 窗口风格 0 = 完全隐藏（用户要求先验证效率模式假设：隐藏启动后到任务管理器看
    // node.exe 是否被标记"效率模式"；对照 launcher-visible.vbs 风格 1）。
    // 2026-09-13 实测数据（explorer 启动 = 等价双击）：隐藏 33.5s / 最小化 12.7s；
    // 最小化曾是落地形态（避开系统自动后台节流），现按用户要求回隐藏做验证。
    `ws.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""${join(launcherDir, 'launch.ps1')}"" -Port ${String(port)} -LauncherDir ""${launcherDir}"" -OpenScript ""${join(launcherDir, 'open-webui.ps1')}""", 0, False`,
  ].join('\r\n');
  writeFileSync(join(launcherDir, 'launcher.vbs'), vbs, 'utf-8');
  // 排错用显示版：同一 launch.ps1，仅窗口风格不同（1 = 显示，能看到启动全过程）
  writeFileSync(join(launcherDir, 'launcher-visible.vbs'), vbs.replace(', 0, False', ', 1, False'), 'utf-8');
}
