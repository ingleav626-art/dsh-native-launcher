// dsh-native-launcher
//
// 装进 profile 后：
//   1. 在桌面生成一个快捷方式（默认名 "DSH WebUI"），幂等：已存在则跳过
//   2. 双击快捷方式 → wscript 静默运行 launcher.vbs（隐藏窗口，无 cmd 黑窗）
//   3. launcher.vbs 以 DSH_LAUNCHER=1 环境变量启动 dsh web
//   4. 插件检测到 DSH_LAUNCHER=1 → 等 webServer 就绪 → 自动打开默认浏览器
//   5. 设置页注册 "WebUI 启动器" 增强设置 section（读取配置 / 重新生成快捷方式）
//
// 平时从终端手动启动 dsh web（无 DSH_LAUNCHER）不会触发自动开浏览器。
// 零依赖：只用 node builtins + Windows 自带工具（wscript / powershell / cmd）。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, unlinkSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// 任务通知 host 半区：完整复制自 dsh-notification（MIT, Copyright 2026 DeepSeek）——原样构建产物
import { apply as notificationHostApply } from './notification-host.js';

export const name = 'native-launcher';
export const inject = ['webServer', 'connection', 'sessionProjections'];

/** 日志文件（快捷方式静默启动时 stdout 不可见，所有诊断写盘）。 */
let LOG_PATH = null;
function logMsg(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}`;
    // eslint-disable-next-line no-console
    console.error(line);
    if (LOG_PATH) appendFileSync(LOG_PATH, line + '\r\n');
  } catch {}
}

/** 本包内的图标资源（复制到用户目录后作为快捷方式图标）。 */
const ICON_RESOURCE = fileURLToPath(new URL('../assets/dsh-webui.ico', import.meta.url));

/**
 * 托盘脚本版本号（模块级，writeTrayScript 与 applyInner 共用）：
 * 托盘启动时把此版本写入 launcherDir/tray-version.txt，
 * apply 对比版本，旧托盘进程被自动结束并换新（重启 dsh 也能更新托盘）。
 */
const TRAY_SCRIPT_VERSION = 4;

/** 解析 Windows 桌面路径（优先 OneDrive 重定向的桌面）。 */
function resolveDesktopPath() {
  const profile = process.env.USERPROFILE;
  if (!profile) return null;
  const candidates = [
    join(profile, 'OneDrive', 'Desktop'),
    join(profile, 'Desktop'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

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
function writeOpenScript(launcherDir, port, openMode, shortcutName, pwaAppId) {
  const url = `http://127.0.0.1:${String(port)}`;
  const hostForFingerprint = new URL(url).hostname;
  const lnkBase = shortcutName.replace(/\.lnk$/i, '');
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$url = '${url}'`,
    // 打开诊断日志：写入 launcherDir/open-webui.log（排查"已运行却新开实例/空白窗口"）
    `$openLogPath = '${join(launcherDir, 'open-webui.log').replace(/'/g, "''")}'`,
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

/** 生成启动器：launch.cmd（TCP 端口探测 + 启动/直连逻辑 + 拉起托盘）+ launcher.vbs（静默隐藏窗口）。 */
function writeLauncherFiles(launcherDir, launchCommand, port, trayPath, openScriptPath) {
  const url = `http://127.0.0.1:${String(port)}`;
  const trayLine = trayPath ? `  start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${trayPath}"` : null;
  const openLine = openScriptPath
    ? `  powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${openScriptPath}"`
    : `  start "" "${url}"`;
  const cmd = [
    '@echo off',
    // TCP 连接探测（而非 netstat 文本匹配）：无论服务监听在 0.0.0.0 / 127.0.0.1 / [::]，
    // 用 127.0.0.1 直连都能正确判定"实例已在运行"，杜绝误判导致的重复启动。
    `powershell -NoProfile -NonInteractive -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', ${String(port)}); $c.Close(); exit 0 } catch { exit 1 }"`,
    'if %errorlevel%==0 (',
    ...(trayLine ? [trayLine] : []),
    openLine,
    ') else (',
    ...(trayLine ? [trayLine] : []),
    '  set DSH_LAUNCHER=1',
    `  ${launchCommand}`,
    ')',
  ].join('\r\n');
  mkdirSync(launcherDir, { recursive: true });
  writeFileSync(join(launcherDir, 'launch.cmd'), cmd, 'utf-8');
  const vbs = [
    'Set ws = CreateObject("WScript.Shell")',
    `ws.Run "cmd /c ""${join(launcherDir, 'launch.cmd')}""", 0, False`,
  ].join('\r\n');
  writeFileSync(join(launcherDir, 'launcher.vbs'), vbs, 'utf-8');
}

/** 生成托盘脚本（PowerShell + WinForms NotifyIcon，系统自带零依赖；单实例互斥 + 两项菜单 + 任务通知气泡）。
 *  appId：已装 PWA 的应用 id（可选）——"退出 WebUI"用它精确关闭本站应用窗口；
 *  无 appId 时回退关闭所有 --app-id 特征的应用窗口（普通浏览器标签页不受影响）。 */
function writeTrayScript(launcherDir, port, iconPath, openScriptPath, appId) {
  const url = `http://127.0.0.1:${String(port)}`;
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '',
    "# 单实例保护：命名互斥体（重复拉起自动退出）",
    "# abandoned 容错：旧托盘被强杀后 mutex 会遗留，此时 WaitOne 抛异常，视为可获取",
    "$mutex = New-Object System.Threading.Mutex($false, 'Local\\DshNativeLauncherTray')",
    '$mutexAcquired = $false',
    'try { $mutexAcquired = $mutex.WaitOne(0) } catch { $mutexAcquired = $true }',
    'if (-not $mutexAcquired) { exit 0 }',
    // 版本标记：拿到互斥体后才写（覆盖写，避免追加累积）；apply 用它做托盘自更新
    "# 版本标记：与 lib/index.js 的 TRAY_SCRIPT_VERSION 一致（apply 用它做托盘自更新）",
    `$trayVersion = ${TRAY_SCRIPT_VERSION}`,
    `try { Set-Content -Path '${join(launcherDir, 'tray-version.txt').replace(/'/g, "''")}' -Value ($trayVersion.ToString()) -NoNewline -Encoding UTF8 } catch { }`,
    'try { Add-Content -Path $exitLogPath -Value (\'[tray started \' + (Get-Date -Format \'HH:mm:ss.fff\') + \']\') -Encoding UTF8 } catch { }',
    '',
    `$url = '${url}'`,
    `$icoPath = '${iconPath.replace(/'/g, "''")}'`,
    `$openScript = '${(openScriptPath || join(launcherDir, 'open-webui.ps1')).replace(/'/g, "''")}'`,
    // 退出诊断日志：写入 launcherDir/tray-exit.log（排查"退出 WebUI 未关闭应用窗口"）
    `$exitLogPath = '${join(launcherDir, 'tray-exit.log').replace(/'/g, "''")}'`,
    'function Log-Exit([string]$msg) {',
    '  try { Add-Content -Path $exitLogPath -Value ((\'[\' + (Get-Date -Format \'HH:mm:ss.fff\') + \'] \') + $msg) -Encoding UTF8 } catch { }',
    '}',
    // 聚焦已运行的 PWA 窗口（user32）：--app-id / AppsFolder 对已运行应用都会再弹一个窗口，只能聚焦。
    // PID 匹配 + 标题匹配双模式 + AttachThreadInput/Alt 键绕过前台锁。
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;public class WinAct { [DllImport(\"user32.dll\")] public static extern bool EnumWindows(WinAct.EnumProc cb, System.IntPtr lp); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid); [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(System.IntPtr h); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(System.IntPtr h, int cmd); [DllImport(\"user32.dll\")] public static extern bool GetWindowText(System.IntPtr h, StringBuilder sb, int max); [DllImport(\"user32.dll\")] public static extern bool AttachThreadInput(uint a, uint b, bool f); [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(System.IntPtr h); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra); [DllImport(\"kernel32.dll\")] public static extern uint GetCurrentThreadId(); public delegate bool EnumProc(System.IntPtr h, System.IntPtr lp); }' -ErrorAction SilentlyContinue",
    'function Focus-AppWindow([int]$targetPid, [string]$titleRegex) {',
    '  try {',
    "    if (-not ('WinAct' -as [type])) { Log-Exit 'focus: WinAct type missing'; return $false }",
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
    "    Log-Exit ('focus scan: ' + $script:scanNote + ' (pid=' + $targetPid + ' title=/' + $titleRegex + '/)')",
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
    '  } catch { Log-Exit (\'focus error: \' + $_.Exception.Message); return $false }',
    '}',
    '',
    '# 图标加载失败用系统图标兜底，保证托盘一定能出现',
    '$icon = $null',
    'try { $icon = New-Object System.Drawing.Icon($icoPath) } catch { }',
    'if (-not $icon) { $icon = [System.Drawing.SystemIcons]::Application }',
    '$notify = New-Object System.Windows.Forms.NotifyIcon',
    '$notify.Icon = $icon',
    "$notify.Text = 'DSH WebUI'",
    '$notify.Visible = $true',
    '',
    '$menu = New-Object System.Windows.Forms.ContextMenuStrip',
    "# 打开 WebUI：应用已在运行 → 聚焦现有窗口（不新开）；未运行 → 启动已装 PWA 应用（AppsFolder），",
    "# 未安装时回退 open-webui.ps1 / 默认浏览器",
    "$openItem = $menu.Items.Add('打开 WebUI')",
    '$openItem.Add_Click({',
    `  $appId = '${(appId || '').replace(/'/g, "''")}'`,
    '  if ($appId) {',
    `    $appProcs = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe' or Name='pwahelper.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and ($_.CommandLine.Contains('--app-id=' + $appId) -or $_.CommandLine -match '--ip-override-url=http://[^/]*:${String(port)}/' -or $_.CommandLine -match '--app=http://[^/]*:${String(port)}') })`,
    "    Log-Exit ('open click: running app procs=' + $appProcs.Count)",
    '    if ($appProcs.Count -gt 0) {',
    "      Log-Exit ('open click: app running PID ' + $appProcs[0].ProcessId + ', focusing...')",
    "      Focus-AppWindow ([int]$appProcs[0].ProcessId) 'DeepSeek Harness|DSH WebUI' | Out-Null",
    "      # 已运行：无论聚焦成败都不再启动（--app-id / AppsFolder 都会弹新窗口）",
    '      return',
    '    }',
    '  }',
    "  Log-Exit 'open click: app not running -> launching'",
    '  $launched = $false',
    "  $bBefore = @(Get-Process msedge,chrome,brave,firefox,pwahelper -ErrorAction SilentlyContinue).Count",
    '  try {',
    '    $shell2 = New-Object -ComObject Shell.Application',
    "    $af = $shell2.Namespace('shell:::{4234d49b-0245-4df3-b780-3893943456e1}')",
    '    if ($af) {',
    '      foreach ($app in $af.Items()) {',
    "        if ($app.Path -like '127.0.0.1-*' -or $app.Path -like 'localhost-*') { Start-Process 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + $app.Path); $launched = $true; break }",
    '      }',
    '    }',
    '  } catch { }',
    '  if ($launched) {',
    "    # 冷启动验证：浏览器已在运行 → 窗口即时激活；完全没起来（explorer 转发可能失败）→ 回退默认打开",
    '    if ($bBefore -gt 0) { return }',
    '    Start-Sleep -Seconds 5',
    '    if ((@(Get-Process msedge,chrome,brave,firefox,pwahelper -ErrorAction SilentlyContinue).Count) -gt 0) { return }',
    '    Start-Process $url',
    '    return',
    '  }',
    '  if (-not $launched) {',
    '    if (Test-Path $openScript) { Start-Process powershell -ArgumentList @(\'-NoProfile\', \'-WindowStyle\', \'Hidden\', \'-ExecutionPolicy\', \'Bypass\', \'-File\', $openScript) -WindowStyle Hidden }',
    '    else { Start-Process $url }',
    '  }',
    '})',
    "# 退出 WebUI：彻底退出——停止 DSH 服务 + 关闭浏览器应用窗口（仅 PWA/--app 窗口，",
    "# 普通浏览器标签页不受影响）+ 关闭托盘；全程写 tray-exit.log 诊断日志",
    "$exitItem = $menu.Items.Add('退出 WebUI')",
    `$exitItem.Add_Click({
  $ask = [System.Windows.Forms.MessageBox]::Show('确定退出 DSH WebUI？将停止服务并关闭应用窗口。', 'DSH WebUI', [System.Windows.Forms.MessageBoxButtons]::YesNo)
  if ($ask -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  $appId = '${(appId || '').replace(/'/g, "''")}'
  Log-Exit ('exit click: appId=[' + $appId + '] url=' + '${url}')
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe' or Name='pwahelper.exe'" -ErrorAction SilentlyContinue)
  Log-Exit ('browser procs found: ' + $procs.Count)
  $killTargets = @()
  foreach ($p in $procs) {
    $cl = $p.CommandLine
    if (-not $cl) { Log-Exit ('  PID ' + $p.ProcessId + ' cmdline=<unreadable>'); continue }
    $short = if ($cl.Length -gt 220) { $cl.Substring(0, 220) + '...' } else { $cl }
    Log-Exit ('  PID ' + $p.ProcessId + ' | ' + $short)
    if ($appId -and $cl.Contains('--app-id=' + $appId)) { $killTargets += $p.ProcessId; Log-Exit '    -> match app-id'; continue }
    if ($cl -match '--ip-override-url=http://[^/]*:${String(port)}/') { $killTargets += $p.ProcessId; Log-Exit '    -> match ip-override-url (any host, config port)'; continue }
    if ($cl -match '--app=http://[^/]*:${String(port)}') { $killTargets += $p.ProcessId; Log-Exit '    -> match --app (any host, config port)'; continue }
    if ((-not $appId) -and $cl.Contains('--app-id=')) { $killTargets += $p.ProcessId; Log-Exit '    -> match fallback app-id' }
  }
  $targets = @($killTargets | Select-Object -Unique)
  Log-Exit ('kill targets: ' + ($targets -join ','))
  foreach ($procId in $targets) {
    taskkill /PID $procId /T /F | Out-Null
    Log-Exit ('  killed PID ' + $procId)
  }
  $after = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe' or Name='pwahelper.exe'" -ErrorAction SilentlyContinue)
  Log-Exit ('remaining browser procs: ' + $after.Count)
  $line = netstat -ano | Select-String 'LISTENING' | Select-String '0.0.0.0:${String(port)}'
  if ($line) { $dpid = ($line -split '\\s+')[-1]; taskkill /PID $dpid /T /F | Out-Null; Log-Exit ('dsh stopped: PID ' + $dpid) }
  else { Log-Exit 'dsh not listening on 0.0.0.0:${String(port)}' }
  $notify.Visible = $false
  $mutex.ReleaseMutex()
  [System.Windows.Forms.Application]::Exit()
  exit 0
})`,
    '$notify.ContextMenuStrip = $menu',
    '',
    '# ── 托盘通知（可靠通道）：host 写 tray-notify.json → 轮询 → 原生 Toast ──',
    '# AUMID 注册（桌面 PowerShell 发 Toast 必需；幂等）',
    "reg add 'HKCU\\Software\\Classes\\AppUserModelId\\DshNativeLauncher' /v DisplayName /d 'DSH WebUI' /f | Out-Null",
    `reg add 'HKCU\\Software\\Classes\\AppUserModelId\\DshNativeLauncher' /v IconUri /d '${join(launcherDir, 'dsh-webui.ico').replace(/'/g, "''")}' /f | Out-Null`,
    `$trayNotifyFile = '${join(launcherDir, 'tray-notify.json').replace(/'/g, "''")}'`,
    `$trayNotifyLog = '${join(launcherDir, 'tray-notify.log').replace(/'/g, "''")}'`,
    'function Show-TrayToast([string]$title, [string]$body) {',
    '  $err = \'\'',
    '  try {',
    '    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '  } catch { $err = \'WinRT load failed: \' + $_.Exception.Message }',
    '  if (-not $err) {',
    '    try {',
    '      $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    "      $textNodes = $template.GetElementsByTagName('text')",
    '      $null = $textNodes.Item(0).AppendChild($template.CreateTextNode($title))',
    '      $null = $textNodes.Item(1).AppendChild($template.CreateTextNode($body))',
    '      $toast = [Windows.UI.Notifications.ToastNotification]::new($template)',
    "      $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DshNativeLauncher')",
    '      $notifier.Show($toast)',
    '      return $true',
    '    } catch { $err = \'toast show failed: \' + $_.Exception.Message }',
    '  }',
    '  try { Add-Content -Path $trayNotifyLog -Value ((\'[\' + (Get-Date -Format \'HH:mm:ss.fff\') + \'] \') + $err) -Encoding UTF8 } catch { }',
    '  return $false',
    '}',
    "# 启动清理：上次强杀（退出 WebUI / 断电）残留的通知不补弹——否则每次重启都会弹'上次任务结束'",
    'Remove-Item $trayNotifyFile -Force -ErrorAction SilentlyContinue',
    '$notifyTimer = New-Object System.Windows.Forms.Timer',
    '$notifyTimer.Interval = 1500',
    '$notifyTimer.Add_Tick({',
    '  try {',
    '    if (-not (Test-Path $trayNotifyFile)) { return }',
    '    $j = $null',
    '    try { $j = Get-Content $trayNotifyFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }',
    '    if ($j) {',
    '      $t = [string]$j.title; $b = [string]$j.body',
    '      $ok = $false',
    '      try { $ok = Show-TrayToast $t $b } catch { }',
    '      if (-not $ok) {',
    '        # Toast 失败兜底：BalloonTip + 系统提示音（各自 try/catch，异常不得杀死消息循环）',
    '        try { $notify.ShowBalloonTip(6000, $t, $b, [System.Windows.Forms.ToolTipIcon]::Info) } catch { }',
    '        try { [System.Media.SystemSounds]::Exclamation.Play() } catch { }',
    '      }',
    '    }',
    '    Remove-Item $trayNotifyFile -Force -ErrorAction SilentlyContinue',
    '  } catch {',
    '    # 任何 tick 异常都只记日志，绝不终止消息循环（否则托盘消失）',
    '    try { Add-Content -Path $trayNotifyLog -Value ((\'[\' + (Get-Date -Format \'HH:mm:ss.fff\') + \'] tick error: \') + $_.Exception.Message) -Encoding UTF8 } catch { }',
    '  }',
    '})',
    '$notifyTimer.Start()',
    '',
    '[System.Windows.Forms.Application]::Run()',
  ].join('\r\n');
  // 带 UTF-8 BOM：同上，Windows PowerShell 5.1 必须靠 BOM 才能正确解码中文。
  writeFileSync(join(launcherDir, 'tray.ps1'), '\uFEFF' + ps, 'utf-8');
}

/** 把包内图标复制到用户目录（快捷方式图标路径需要稳定且长期存在）。内容变化时覆盖更新。 */
function ensureIcon(launcherDir) {
  try {
    const target = join(launcherDir, 'dsh-webui.ico');
    if (!existsSync(target) || readFileSync(target).length !== readFileSync(ICON_RESOURCE).length) {
      mkdirSync(launcherDir, { recursive: true });
      copyFileSync(ICON_RESOURCE, target);
      logMsg('[native-launcher] icon copied/updated');
    }
    return target;
  } catch (error) {
    logMsg(`[native-launcher] icon copy failed: ${error}`);
    return null;
  }
}

/**
 * 在桌面创建指向 launcher.vbs 的快捷方式。
 * 幂等：快捷方式已存在且未开启 force 时跳过（用户手动改过的快捷方式不被覆盖）；
 * 但若现有快捷方式指向的不是当前 vbsPath（项目改名/目录变更后变孤儿），
 * 或图标路径不一致（图标资源更新后），自动重建。
 */
function createDesktopShortcut(shortcutName, vbsPath, iconPath, force) {
  const desktop = resolveDesktopPath();
  if (!desktop) return;
  const home = process.env.USERPROFILE ?? '';
  const lnk = join(desktop, `${shortcutName}.lnk`);
  if (!force && existsSync(lnk)) {
    // 校验现有快捷方式的 Arguments 是否包含当前 vbsPath、IconLocation 是否含当前 iconPath（.lnk 内以 UTF-16LE 存储）
    try {
      const buf = readFileSync(lnk);
      const vbsNeedle = Buffer.from(vbsPath, 'utf16le');
      const iconNeedle = iconPath ? Buffer.from(iconPath, 'utf16le') : null;
      if (buf.includes(vbsNeedle) && (!iconNeedle || buf.includes(iconNeedle))) {
        logMsg(`[native-launcher] shortcut already exists and points to current vbs + icon, skipping: ${lnk}`);
        return;
      }
      logMsg(`[native-launcher] shortcut exists but points elsewhere or icon changed, recreating: ${lnk}`);
    } catch {
      // 读失败（权限/损坏）→ 保守重建
      logMsg(`[native-launcher] shortcut unreadable, recreating: ${lnk}`);
    }
  }
  const ps = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}')`,
    `$s.TargetPath = 'C:\\Windows\\System32\\wscript.exe'`,
    `$s.Arguments = '"${vbsPath.replace(/"/g, '""')}"'`,
    `$s.WorkingDirectory = '${home.replace(/'/g, "''")}'`,
    iconPath ? `$s.IconLocation = '${iconPath.replace(/'/g, "''")}'` : null,
    `$s.Save()`,
  ].filter(Boolean).join('; ');
  try {
    spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true });
    logMsg(`[native-launcher] shortcut created: ${lnk}`);
  } catch (error) {
    logMsg(`[native-launcher] shortcut creation failed: ${error}`);
  }
}

/**
 * 扫描 Edge 已安装的 PWA：新版 Edge 的应用数据在
 * %LOCALAPPDATA%\Microsoft\Edge\User Data\<profile>\Web Applications\Manifest Resources\<app_id>\Icons\
 * 返回匹配站点的 app_id（供 --app-id 启动已安装应用）。
 * 归属校验：读 Preferences 的 app_banner 段，确认 127.0.0.1:<port> 有安装提示记录。
 * 每一步都写 debug 日志（launcherDir/pwa-scan.log），找不到时原因一目了然。
 */
function findInstalledPwaAppId(port, launcherDir) {
  const log = [];
  const writeLog = (msg) => {
    log.push(`[${new Date().toISOString()}] ${msg}`);
    try {
      appendFileSync(join(launcherDir, 'pwa-scan.log'), log[log.length - 1] + '\r\n');
    } catch {}
  };
  try {
    const local = process.env.LOCALAPPDATA;
    writeLog(`LOCALAPPDATA=${local}`);
    if (!local) {
      writeLog('LOCALAPPDATA missing');
      return null;
    }
    const base = join(local, 'Microsoft', 'Edge', 'User Data');
    writeLog(`base=${base} exists=${existsSync(base)}`);
    if (!existsSync(base)) return null;
    const needle = `127.0.0.1:${String(port)}`;
    const profileNames = readdirSync(base).filter((n) => /^(Default|Profile \d+)$/.test(n));
    writeLog(`profiles=${JSON.stringify(profileNames)}`);
    const prefPaths = profileNames.map((n) => join(base, n, 'Preferences')).filter((p) => existsSync(p));
    writeLog(`prefPaths=${JSON.stringify(prefPaths)}`);
    let urlKnown = false;
    for (const p of prefPaths) {
      try {
        if (readFileSync(p, 'utf-8').includes(needle)) {
          urlKnown = true;
          break;
        }
      } catch (e) {
        writeLog(`pref read fail ${p}: ${e.message}`);
      }
    }
    writeLog(`urlKnown=${urlKnown}`);
    for (const profile of profileNames) {
      const mr = join(base, profile, 'Web Applications', 'Manifest Resources');
      writeLog(`check mr=${mr} exists=${existsSync(mr)}`);
      if (!existsSync(mr)) continue;
      for (const id of readdirSync(mr)) {
        const icons = join(mr, id, 'Icons');
        writeLog(`  candidate=${id} icons=${existsSync(icons)}`);
        if (existsSync(icons)) {
          writeLog(`FOUND app_id=${id}`);
          return id;
        }
      }
    }
    writeLog('RESULT: null (no installed pwa found)');
  } catch (error) {
    writeLog(`EXCEPTION: ${error?.stack ?? error}`);
  }
  return null;
}

/** 从 ICO 文件提取内嵌 PNG（Buffer，用于 /icon.png 路由）。 */
function extractPngBuffer(iconPath) {
  try {
    const buf = readFileSync(iconPath);
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const start = buf.indexOf(pngMagic);
    if (start < 0) return null;
    return buf.subarray(start);
  } catch {
    return null;
  }
}

/** 读 PNG 头部获取尺寸（IHDR：字节 16-23）。非法输入返回 null。 */
function pngSize(buf) {
  try {
    if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(12) !== 0x49484452) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * 确保 PWA 图标是方形：Windows 应用列表/任务栏按方形渲染，非方形图标会被压缩变形（很难看）。
 * 源已是 256×256 方形则直接返回（不落缓存，避免旧缓存污染）；
 * 否则用 PowerShell System.Drawing 做"保真填充"（缩放至 256 宽、上下补透明），不裁切不变形。
 * 结果缓存到 launcherDir/icon-256.png；失败回退原 PNG。
 */
function ensureSquareIconPng(launcherDir, pngBuffer) {
  try {
    const size = pngSize(pngBuffer);
    if (size && size.w === 256 && size.h === 256) return pngBuffer; // 官方图标已是 256×256 方形
    const outPath = join(launcherDir, 'icon-256.png');
    if (existsSync(outPath)) return readFileSync(outPath);
    // 先写临时输入文件
    const inPath = join(launcherDir, 'icon-source.png');
    writeFileSync(inPath, pngBuffer);
    const ps = [
      'Add-Type -AssemblyName System.Drawing',
      `$src = [System.Drawing.Image]::FromFile('${inPath.replace(/'/g, "''")}')`,
      '$w = $src.Width; $h = $src.Height',
      'if ($w -eq 256 -and $h -eq 256) { $src.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png); exit 0 }',
      '$bmp = New-Object System.Drawing.Bitmap(256, 256)',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.Clear([System.Drawing.Color]::Transparent)',
      '$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
      '$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality',
      '$ratio = [Math]::Min(256 / $w, 256 / $h)',
      '$nw = [Math]::Floor($w * $ratio); $nh = [Math]::Floor($h * $ratio)',
      '$x = [Math]::Floor((256 - $nw) / 2); $y = [Math]::Floor((256 - $nh) / 2)',
      '$g.DrawImage($src, $x, $y, $nw, $nh)',
      '$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)',
      '$g.Dispose(); $bmp.Dispose(); $src.Dispose()',
      'exit 0',
    ].join('; ');
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps, outPath], { stdio: 'ignore', windowsHide: true });
    // 清理临时输入
    try { unlinkSync(inPath); } catch {}
    if (result.status === 0 && existsSync(outPath)) {
      logMsg('[native-launcher] square icon generated (256x256)');
      return readFileSync(outPath);
    }
    logMsg('[native-launcher] square icon generation failed, falling back to source png');
  } catch (error) {
    logMsg(`[native-launcher] square icon failed: ${error}`);
  }
  return pngBuffer;
}

/** 从 ICO 文件提取内嵌 PNG，返回 data URL（用于页面 favicon / --app 窗口任务栏图标）。 */
function extractPngDataUrl(iconPath) {
  const png = extractPngBuffer(iconPath);
  return png ? `data:image/png;base64,${png.toString('base64')}` : null;
}

/**
 * 注册 PWA 静态路由：真实 URL 的 manifest + 方形 PNG 图标。
 * Chromium 的可安装性检查只认能 fetch 到的 http(s) manifest（blob/data URL 均被拒），
 * 且图标需 ≥144px 栅格图（dsh 自带 manifest 只有 SVG，不满足——这就是安装提示一直不出现的根因）。
 */
function registerPwaRoutes(ctx, launcherDir, iconPath) {
  const png = ensureSquareIconPng(launcherDir, extractPngBuffer(iconPath) ?? Buffer.alloc(0));
  if (!png || png.length === 0) {
    logMsg('[native-launcher] pwa icon extract failed, routes skipped');
    return;
  }
  const manifestJson = JSON.stringify({
    id: '/native-launcher',
    name: 'DSH WebUI',
    short_name: 'DSH WebUI',
    description: 'DeepSeek Harness Web UI',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#141414',
    theme_color: '#141414',
    icons: [{ src: '/native-launcher/icon.png', sizes: '256x256', type: 'image/png', purpose: 'any' }],
  });
  try {
    ctx.webServer.register({
      kind: 'exact',
      path: '/native-launcher/manifest.webmanifest',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(manifestJson);
      },
    });
    ctx.webServer.register({
      kind: 'exact',
      path: '/native-launcher/icon.png',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(png);
      },
    });
    logMsg('[native-launcher] pwa routes registered');
  } catch (error) {
    logMsg(`[native-launcher] pwa route registration failed: ${error}`);
  }
}

/** 在默认浏览器的独立窗口中打开 dsh web（走生成的 open-webui.ps1，new-window 模式）。 */
function openBrowser(port, launcherDir) {
  try {
    const openScriptPath = join(launcherDir, 'open-webui.ps1');
    if (existsSync(openScriptPath)) {
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', openScriptPath], { stdio: 'ignore', windowsHide: true });
    } else {
      spawnSync('cmd', ['/c', 'start', '', `http://127.0.0.1:${String(port)}`], { stdio: 'ignore', windowsHide: true });
    }
    return true;
  } catch (error) {
    logMsg(`[native-launcher] open browser failed: ${error}`);
    return false;
  }
}

// 加固：apply 全程受保护——任何环节失败只记日志，绝不拖垮宿主启动。
export function apply(ctx, config = {}) {
  try {
    applyInner(ctx, config);
  } catch (error) {
    logMsg(`[native-launcher] apply failed (harness continues): ${error?.stack ?? error}`);
  }
}

function applyInner(ctx, config = {}) {
  const launchCommand = config.launchCommand ?? 'dsh --profile web';
  const shortcutName = config.shortcutName ?? 'DSH WebUI';
  const autoOpen = config.autoOpen !== false;
  const force = config.force === true;
  const port = config.port ?? 3080;
  const trayEnabled = config.tray !== false;
  const openMode = config.openMode ?? 'app';

  // 1. 生成静默启动脚本（launch.cmd 端口探测 + launcher.vbs 隐藏窗口）
  const home = process.env.USERPROFILE;
  if (!home) {
    logMsg('[native-launcher] USERPROFILE missing; launcher cannot be installed');
    return;
  }
  const launcherDir = join(home, '.dsh-webui-launcher');
  LOG_PATH = join(launcherDir, 'native-launcher.log');
  logMsg('[native-launcher] apply start');
  const vbsPath = join(launcherDir, 'launcher.vbs');
  // 共享状态：agent 运行计数（托盘通知窗口 + 关闭语义任务检查）与已上报回合（去重）
  let runningCount = 0;
  const reportedKeys = new Set();
  try {
    // 必须先建目录：writeOpenScript 在 writeLauncherFiles 之前执行，
    // 若目录不存在会抛 ENOENT 并中断整个写入链（launcher.vbs 等全部缺失）。
    mkdirSync(launcherDir, { recursive: true });
    const trayPath = trayEnabled ? join(launcherDir, 'tray.ps1') : null;
    const openScriptPath = join(launcherDir, 'open-webui.ps1');
    const pwaAppId = findInstalledPwaAppId(port, launcherDir);
    writeOpenScript(launcherDir, port, openMode, shortcutName, pwaAppId);
    writeLauncherFiles(launcherDir, launchCommand, port, trayPath, openScriptPath);
    if (trayEnabled) writeTrayScript(launcherDir, port, join(launcherDir, 'dsh-webui.ico'), join(launcherDir, 'open-webui.ps1'), pwaAppId);
  } catch (error) {
    logMsg(`[native-launcher] launcher script failed: ${error}`);
  }

  // 2. 图标 + 桌面快捷方式
  const iconPath = ensureIcon(launcherDir);
  createDesktopShortcut(shortcutName, vbsPath, iconPath, force);

  // 3. 注册设置页 RPC：读取配置 / 重新生成快捷方式
  try {
    ctx.connection.rpc.handle(
      '/native-launcher',
      async (endpoint, _payload) => {
        switch (endpoint) {
          case 'config.get':
            return {
              ok: true,
              value: {
                launchCommand,
                shortcutName,
                autoOpen,
                force,
                port,
                launcherDir,
                vbsPath,
                iconPath,
                shortcutExists: existsSync(join(resolveDesktopPath() ?? '', `${shortcutName}.lnk`)),
              },
            };
          case 'shortcut.recreate': {
            createDesktopShortcut(shortcutName, vbsPath, iconPath, true);
            const lnk = join(resolveDesktopPath() ?? '', `${shortcutName}.lnk`);
            return { ok: true, value: { message: `shortcut recreated: ${lnk}`, shortcutExists: existsSync(lnk) } };
          }
          case 'icon.get': {
            const dataUrl = extractPngDataUrl(iconPath);
            return dataUrl
              ? { ok: true, value: { dataUrl } }
              : { ok: false, error: { code: 'icon', message: 'icon extract failed', details: {} } };
          }
          case 'ntf-log':
            // 通知诊断上报（client 决策链）：写 native-launcher.log，不污染浏览器 console
            logMsg(`[ntf] ${JSON.stringify(_payload ?? {})}`);
            return { ok: true };
          case 'tray-notify': {
            // 托盘通知入队：client 决策（规则/防重放）完成后上报，
            // 写 tray-notify.json 供托盘 Timer 轮询弹原生 Toast（可靠通道）
            const p = _payload ?? {};
            const key = String(p.key ?? '');
            if (key) reportedKeys.add(key);
            try {
              const file = join(launcherDir, 'tray-notify.json');
              writeFileSync(file, JSON.stringify({ title: String(p.title ?? '任务完成').slice(0, 64), body: String(p.body ?? '').slice(0, 256), ts: Date.now() }));
              logMsg(`[tray-notify] queued: ${String(p.title)} (${key})`);
              return { ok: true };
            } catch (error) {
              logMsg(`[tray-notify] write failed: ${error}`);
              return { ok: false, error: { code: 'tray-notify', message: String(error), details: {} } };
            }
          }
          default:
            return { ok: false, error: { code: 'unknown', message: `unknown endpoint: ${endpoint}`, details: {} } };
        }
      },
      { authority: 'trusted-host' },
    );
  } catch (error) {
    logMsg(`[native-launcher] rpc registration failed: ${error}`);
  }

  // 3.5 注册 PWA 静态路由（真实 URL manifest + PNG 图标 → 让 Chromium 判定可安装）
  registerPwaRoutes(ctx, launcherDir, iconPath);

  // 4. 拉起系统托盘：无论用户从快捷方式还是终端直接启动 dsh，托盘都会出现
  //    （tray.ps1 内部 Mutex 单实例保护，重复拉起自动退出；失败只记日志）
  //    版本自更新：tray.ps1 启动时写 tray-version.txt（TRAY_SCRIPT_VERSION），
  //    若运行中的托盘版本旧（重启 dsh 不会重启托盘），先结束旧托盘进程再拉起新的——
  //    根治"重启后托盘还是旧逻辑"的反复问题。
  if (trayEnabled) {
    try {
      const trayPath = join(launcherDir, 'tray.ps1');
      if (existsSync(trayPath)) {
        const versionFile = join(launcherDir, 'tray-version.txt');
        let runningVersion = 0;
        try {
          runningVersion = parseInt(readFileSync(versionFile, 'utf-8').trim(), 10) || 0;
        } catch {
          // 无版本文件 = 旧托盘（未写版本）或未运行
        }
        // 先验证托盘进程是否真的在跑（version 文件可能是残留：进程已死但文件还在）
        const probeCmd = [
          "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" -ErrorAction SilentlyContinue |",
          `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
          'Measure-Object | Select-Object -ExpandProperty Count',
        ].join(' ');
        const probe = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', probeCmd], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          timeout: 10000,
        });
        const trayRunning = parseInt(String(probe.stdout ?? '').trim(), 10) > 0;
        logMsg(`[native-launcher] tray process running: ${trayRunning} (versionFile=${runningVersion}, want=${TRAY_SCRIPT_VERSION})`);

        if (trayRunning && runningVersion !== TRAY_SCRIPT_VERSION) {
          logMsg(`[native-launcher] tray version mismatch (running=${runningVersion}, want=${TRAY_SCRIPT_VERSION}), killing old tray`);
          try {
            // 必须排除 $PID（kill 命令自身命令行也含 tray.ps1，不排除会自杀导致旧托盘未被清理）
            const killCmd = [
              "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" -ErrorAction SilentlyContinue |",
              `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
              "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; 'killed:' + $_.ProcessId }",
            ].join(' ');
            const killResult = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', killCmd], {
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
              timeout: 10000,
            });
            logMsg(`[native-launcher] old tray kill result: ${String(killResult.stdout ?? '').trim() || '(none)'} exit=${killResult.status}`);
          } catch (error) {
            logMsg(`[native-launcher] old tray kill failed: ${error}`);
          }
          // 同步等待旧托盘进程退出（避免 Mutex 冲突）
          try {
            spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 1000'], {
              stdio: 'ignore',
              windowsHide: true,
            });
          } catch {
            // ignore
          }
        } else if (trayRunning) {
          logMsg('[native-launcher] tray already running (current version), skip spawn');
        } else {
          logMsg('[native-launcher] no tray process, spawning fresh');
        }
        // 托盘进程不存在（或刚被换新）→ 拉起；进程已在且版本相符 → 跳过
        if (!trayRunning || runningVersion !== TRAY_SCRIPT_VERSION) {
          const child = spawn(
            'powershell',
            ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', trayPath],
            { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true },
          );
          child.unref();
          // 诊断：托盘进程提前退出时记录退出码与 stderr（stdin ignore，stdout/stderr 收尾读取）
          let trayErr = '';
          child.stderr?.on('data', (chunk) => {
            trayErr = String(trayErr + chunk).slice(-2000);
          });
          child.on('exit', (code, signal) => {
            logMsg(`[native-launcher] tray process exited code=${code} signal=${String(signal)} stderr=${trayErr.slice(0, 500) || '(empty)'}`);
          });
          logMsg(`[native-launcher] tray spawned (version=${TRAY_SCRIPT_VERSION})`);
        }
      }
    } catch (error) {
      logMsg(`[native-launcher] tray spawn failed: ${error}`);
    }
  }

  // 4.5 任务通知 host 半区：完整复制自 dsh-notification（投影 seam，client 侧决策）
  try {
    logMsg('[native-launcher] notification host apply: registering projection');
    notificationHostApply(ctx, { maxBodyChars: 400 });
    logMsg('[native-launcher] notification host apply ok');
  } catch (error) {
    logMsg(`[native-launcher] notification host apply failed: ${error?.stack ?? error}`);
  }

  // 4.6 托盘通知 host 兜底 + 4.7 关闭语义（共享 agent 运行状态）
  //   - 4.6：agent running 窗口内出现的 turn 结束 → 2s 确认窗口（client 上报优先）；
  //         无上报（页面关闭/RPC 失败）→ host 直接写 tray-notify.json（全量兜底）
  //   - 4.7：页面 online/offline 上报 → 全部离线 + 20s 防抖 + 任务空闲 → appExit(0) 官方优雅退出
  try {
    const notifyFile = join(launcherDir, 'tray-notify.json');
    const closeToExit = config.closeToExit !== false;
    const reasonTitle = {
      completed: '任务完成',
      error: '任务出错',
      aborted: '任务被中止',
      blocked: '任务被阻塞',
      'max-tokens': '达到 Token 上限',
    };
    const liveTurns = new Set();   // running 期间的 turn/start（sessionId:turn）
    const pendingKeys = new Map(); // key -> 2s 兜底定时器
    const clients = new Map();     // 在线客户端（关闭语义）
    let exitTimer = null;
    let waitingForIdle = false;

    const writeTrayNotify = (title, body, key) => {
      try {
        writeFileSync(notifyFile, JSON.stringify({ title: String(title).slice(0, 64), body: String(body).slice(0, 256), ts: Date.now() }));
        logMsg(`[tray-notify] queued: ${title} (${key})`);
      } catch (error) {
        logMsg(`[tray-notify] write failed: ${error}`);
      }
    };

    // 关闭语义：无客户端且无任务 → 官方优雅退出（appExit = dsh-cmdline 提供的 exit 回调）
    const scheduleExitCheck = () => {
      if (exitTimer) return;
      exitTimer = setTimeout(() => {
        exitTimer = null;
        if (clients.size > 0) return;
        if (runningCount > 0) {
          waitingForIdle = true;
          logMsg('[close-to-exit] tasks still running, will exit when idle');
          return;
        }
        // 二次确认（2s）：给"页面重开请求在途"的毫秒级竞态留窗口——
        // 用户在退出瞬间重开前端时，online 请求可能正在路上
        setTimeout(() => {
          if (clients.size > 0 || runningCount > 0) {
            logMsg('[close-to-exit] client/task reappeared, exit cancelled');
            return;
          }
          const appExit = ctx.get('appExit');
          logMsg('[close-to-exit] no clients & no tasks -> appExit(0)');
          if (typeof appExit === 'function') {
            try {
              appExit(0);
            } catch (error) {
              logMsg(`[close-to-exit] appExit call failed: ${error}`);
            }
          } else {
            logMsg('[close-to-exit] appExit service unavailable');
          }
        }, 2000);
      }, 20000);
    };
    const cancelExit = () => {
      if (exitTimer) {
        clearTimeout(exitTimer);
        exitTimer = null;
      }
      waitingForIdle = false;
    };

    ctx.on('agent/status', (payload) => {
      const status = payload && payload.status;
      if (status === 'running') {
        runningCount += 1;
      } else if (status === 'idle') {
        runningCount = Math.max(0, runningCount - 1);
        if (runningCount === 0) {
          liveTurns.clear();
          if (waitingForIdle && clients.size === 0) scheduleExitCheck();
        }
      }
      logMsg(`[agent-status] ${String(status)} (running=${runningCount})`);
    });

    ctx.on('session/event', (session, event) => {
      const type = event && event.type;
      const data = event && event.data;
      if (!type || !data) return;
      const key = `${String(session && session.id ? session.id : '?')}:${data.turn}`;
      if (type === 'turn/start') {
        if (runningCount > 0) liveTurns.add(key);
      } else if (type === 'turn/end') {
        if (!liveTurns.has(key)) return;
        liveTurns.delete(key);
        if (pendingKeys.has(key)) return;
        const kind = data.reason && data.reason.kind ? data.reason.kind : 'completed';
        const title = reasonTitle[kind] || '任务完成';
        // 2s 确认窗口：client 上报（规则过滤）优先；无上报则 host 兜底
        const timer = setTimeout(() => {
          pendingKeys.delete(key);
          if (reportedKeys.has(key)) return;
          // 有客户端在线但未上报 = 被规则/backgroundOnly 抑制（页面开着，决策在 client）→ 尊重设置，不兜底；
          // 仅当无任何客户端在线（页面全关）时才由 host 补发
          if (clients.size > 0) return;
          let body = '';
          try {
            const snap = ctx.sessionProjections.snapshot(session);
            const ntf = snap && snap.values && snap.values.notification;
            if (ntf && ntf.body) body = String(ntf.body).slice(0, 200);
          } catch {
            // 投影不可用时正文留空
          }
          writeTrayNotify(title, body, key);
          logMsg(`[tray-notify] host fallback (no clients online): ${key}`);
        }, 2000);
        pendingKeys.set(key, timer);
      }
    });

    // 客户端在线/离线（关闭语义信号；pagehide + fetch keepalive 由浏览器保证送达）
    const handleClient = (action) => (req, res) => {
      try {
        const u = new URL(req.url ?? '/', 'http://localhost');
        const id = u.searchParams.get('client');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!id) {
          res.end('{"ok":false,"error":"missing client"}');
          return;
        }
        if (action === 'online') {
          clients.set(id, true);
          cancelExit();
          logMsg(`[close-to-exit] online: ${id} (clients=${clients.size})`);
        } else {
          clients.delete(id);
          logMsg(`[close-to-exit] offline: ${id} (clients=${clients.size})`);
          if (clients.size === 0) scheduleExitCheck();
        }
        res.end('{"ok":true}');
      } catch (error) {
        try {
          res.writeHead(500);
          res.end('{"ok":false}');
        } catch {
          // ignore
        }
      }
    };
    ctx.webServer.register({ kind: 'exact', path: '/native-launcher/online', handler: handleClient('online') });
    ctx.webServer.register({ kind: 'exact', path: '/native-launcher/offline', handler: handleClient('offline') });
    logMsg(`[close-to-exit] armed (closeToExit=${closeToExit})`);
  } catch (error) {
    logMsg(`[native-launcher] tray-notify/close-to-exit setup failed: ${error}`);
  }

  // 5. 仅当通过快捷方式启动（DSH_LAUNCHER=1）时自动打开浏览器
  if (!autoOpen || process.env.DSH_LAUNCHER !== '1') return;

  const attempt = () => {
    const port = ctx.get('webServer')?.port;
    if (port === void 0) return false;
    setTimeout(() => openBrowser(port, launcherDir), config.delayMs ?? 400);
    return true;
  };
  const settled = ctx.get('loader')?.await?.();
  if (settled === void 0) {
    attempt();
    return;
  }
  settled.then(
    () => {
      if (attempt()) return;
      // Fallback poll: runner 可能比 socket 绑定早一步 settle
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (attempt() || tries >= 20) clearInterval(timer);
      }, 500);
    },
    () => {},
  );
}

// 工具性导出：生成/测试脚本（不影响插件本体行为）
export { writeOpenScript, writeTrayScript };
