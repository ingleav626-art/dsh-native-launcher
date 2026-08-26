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
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, unlinkSync, appendFileSync, readdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
// 模块系统（dev-notes 一·七）：本体之外的功能全部走 lib/modules/<id>，统一 gating
import { CORE_API_VERSION, BUILTIN_MODULES } from './module-registry.js';
// 官方设置卡片（rc.7+）：schema 表单自动渲染；ns 只是字符串校验，直接内联常量
import { SETTINGS_NAMESPACE, LAUNCHER_SETTINGS_SCHEMA } from './settings-schema.js';

export const name = 'native-launcher';
export const inject = ['webServer', 'connection', 'sessionProjections', 'settings'];

/** 日志文件（快捷方式静默启动时 stdout 不可见，所有诊断写盘）。
 *  格式：[本地时间] [级别5] [域] 消息——域从消息前缀 [tag] 自动提取；
 *  apply 启动打分隔线分块；config.set 保存链带 save#N 序号串联因果。
 *  示例：[2026-08-26 14:32:28.101 +08:00] [INFO ] [settings] save#3 begin ... */
let LOG_PATH = null;
let APPLY_SEQ = 0;
let SAVE_SEQ = 0;
// 一键卸载后置标记：dsh 进程退出瞬间清掉残留的功能性生成文件（日志永久保留作为证据）
let pendingExitCleanup = null;
function logWrite(level, msg) {
  try {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const tz = -d.getTimezoneOffset();
    const tzStr = `${tz >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(tz) / 60))}:${p(Math.abs(tz) % 60)}`;
    const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} ${tzStr}`;
    const dm = /^\[([a-z0-9_-]+)\]\s?(.*)$/is.exec(msg);
    const domain = (dm ? dm[1] : 'launcher').padEnd(10);
    const text = dm ? dm[2] : msg;
    const line = `[${ts}] [${level.padEnd(5)}] [${domain}] ${text}`;
    // eslint-disable-next-line no-console
    console.error(line);
    if (LOG_PATH) {
      // 简单轮转：超过 1MB 归档为 .prev.log（覆盖上一代），防止 append 无限膨胀
      try {
        if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > 1024 * 1024) {
          renameSync(LOG_PATH, LOG_PATH.replace(/\.log$/, '.prev.log'));
        }
      } catch {}
      appendFileSync(LOG_PATH, line + '\r\n');
    }
  } catch {}
}
function logMsg(msg) { logWrite('INFO', msg); }
function logWarn(msg) { logWrite('WARN', msg); }
function logFail(msg) { logWrite('ERROR', msg); }

/** 解析 dsh 版本（'0.1.0-rc.8' → {major,minor,patch,rc}）；未知格式返回 null。 */
function parseDshVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/.exec(String(v || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], rc: m[4] === undefined ? Infinity : +m[4] };
}
/** 比较两个版本字符串（含 rc 预发布），v >= target 返回 true。 */
function dshVersionGte(v, target) {
  const a = parseDshVersion(v);
  const b = parseDshVersion(target);
  if (!a || !b) return false;
  for (const key of ['major', 'minor', 'patch', 'rc']) {
    if (a[key] !== b[key]) return a[key] > b[key];
  }
  return true;
}
/** 检测当前 dsh 版本（读 DSH_HOME 下 profile 依赖树里的 dsh 包）；找不到返回 ''。 */
function detectDshVersion() {
  const home = process.env.DSH_HOME;
  if (!home) return '';
  const candidates = [
    join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const v = JSON.parse(readFileSync(p, 'utf8')).version;
        if (v) return String(v);
      }
    } catch {}
  }
  return '';
}

/**
 * 环境诊断快照：apply 时写入日志，让 issue 无需追问即可定位——
 * 启动命令可用性（where dsh）、端口监听状态、托盘进程详情（不只 true/false）、
 * 残留状态文件、快捷方式目标。全部合并进**单个异步** powershell spawn——
 * 绝不阻塞 apply（同步 spawnSync 会拖住 dsh 初始化，是本插件启动回归的根源）。
 */
function logEnvDiagnostics(launcherDir, config) {
  const lc = config.launchCommand ?? 'dsh --profile web --no-open';
  const first = (lc.split(/\s+/)[0] || '').replace(/["']/g, '');
  const desktop = resolveDesktopPath() ?? '';
  const lnk = join(desktop, `${config.shortcutName ?? 'DSH WebUI'}.lnk`).replace(/'/g, "''");
  const verFile = join(launcherDir, 'tray-version.txt').replace(/'/g, "''");
  const ps = [
    "$o = @()",
    `$o += 'node=${process.version} ${process.platform}-${process.arch} DSH_LAUNCHER=${process.env.DSH_LAUNCHER ?? '(unset)'}'`,
    `$o += 'launchCommand=${JSON.stringify(lc)}'`,
    ...(first && !first.includes('\\') && !first.includes('/')
      ? [`$w = & where.exe ${first} 2>$null; $o += 'where ${first}=' + ($(if ($w) { $w -join ';' } else { '(not found)' }))`]
      : []),
    "$n = netstat -ano | Select-String ':3080.*LISTENING'; $o += 'port3080=' + ($(if ($n) { ($n | ForEach-Object { $_.ToString().Trim() }) -join ' | ' } else { '(none)' }))",
    "$p = Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' or Name='pwsh.exe'\" -ErrorAction SilentlyContinue | ForEach-Object { $cl = [string]$_.CommandLine; $cl = $cl -replace '\\s+', ' '; if ($cl.Length -gt 100) { $cl = $cl.Substring(0, 100) }; $_.ProcessId.ToString() + '|' + $cl }; $o += 'procs=' + ($(if ($p) { $p -join ' ; ' } else { '(none)' }))",
    "$tv = [string](Get-Content '${verFile}' -Raw -ErrorAction SilentlyContinue); $o += 'trayver=' + ($(if ($tv) { $tv.Trim() } else { '(missing)' }))",
    "$lnkInfo = '(read failed)'",
    `try { $ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${lnk}'); $lnkInfo = $s.TargetPath + ' args=' + $s.Arguments } catch { }`,
    "$o += 'lnk=' + $lnkInfo",
    "$o -join \"`n\"",
  ].join('; ');
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '';
  child.stdout?.on('data', (chunk) => {
    out = String(out + chunk).slice(-8000);
  });
  child.on('close', () => {
    const rows = String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!rows.length) {
      logMsg('[diag] env snapshot failed (no output)');
      return;
    }
    for (const line of rows) logMsg(`[diag] ${line}`);
  });
}

/** 本包内的图标资源（复制到用户目录后作为快捷方式图标）。 */
const ICON_RESOURCE = fileURLToPath(new URL('../assets/dsh-webui.ico', import.meta.url));

/**
 * 托盘脚本版本号（模块级，writeTrayScript 与 applyInner 共用）：
 * 托盘启动时把此版本写入 launcherDir/tray-version.txt，
 * apply 对比版本，旧托盘进程被自动结束并换新（重启 dsh 也能更新托盘）。
 */
const TRAY_SCRIPT_VERSION = 7;

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

/** 生成启动器：launch.cmd（HTTP 端口探测 + 启动/直连）+ launcher.vbs（静默隐藏窗口）。
 *  注意：托盘不再由 launch.cmd 拉起——改由 apply() 统一管理（windowsHide: true 确保无黑窗）。
 *  launch.cmd 用 start "" 拉起 PowerShell 在部分 Windows 版本上无法隐藏窗口，
 *  且会导致托盘被重复拉起两次（launch.cmd 一次 + apply() 一次），Mutex 虽能互斥但
 *  第一个实例的窗口已可见。 */
function writeLauncherFiles(launcherDir, launchCommand, port, trayPath, openScriptPath) {
  const url = `http://127.0.0.1:${String(port)}`;
  const openLine = openScriptPath
    ? `  powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${openScriptPath}"`
    : `  start "" "${url}"`;
  const cmd = [
    '@echo off',
    // 启动日志：记录每次双击的分支走向（探测结果 / 走"已运行"还是"启动"），
    // 配合 native-launcher.log 的环境诊断，issue 无需追问即可定位。
    `>> "${join(launcherDir, 'launch.log').replace(/"/g, '\\"')}" echo [%date% %time%] launch.cmd start (probe 127.0.0.1:${String(port)})`,
    // HTTP 探测（而非 TCP）：TCP 通 ≠ 服务活——"托盘退出后立刻双击"时旧 dsh 端口
    // 可能未释放，TCP 探测误判 open → 前端拉起但后端已死 → 白屏（issue: 前端无法正常显示）。
    // HTTP GET / 返回 2xx = 后端活着且页面可服务，才走"已运行"分支。
    `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:${String(port)}/' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { exit 0 } else { exit 1 } } catch { exit 1 }"`,
    'if %errorlevel%==0 (',
    `  >> "${join(launcherDir, 'launch.log').replace(/"/g, '\\"')}" echo [%date% %time%] probe=open - server already running`,
    openLine,
    ') else (',
    `  >> "${join(launcherDir, 'launch.log').replace(/"/g, '\\"')}" echo [%date% %time%] probe=closed, starting via launchCommand`,
    '  set DSH_LAUNCHER=1',
    // launchCommand 依赖 PATH（默认 `dsh --profile web`）。命令缺失时回退 npx（默认 dsh 场景）
    // 并给出明确指引，而不是静默失败（否则表现为"双击只弹命令行、webUI 起不来"）。
    // 含路径分隔符的命令视为绝对/相对路径，跳过检测直接执行。
    ...(launchCommand.split(/\s+/)[0].includes('\\') || launchCommand.split(/\s+/)[0].includes('/')
      ? [`  ${launchCommand}`]
      : launchCommand.split(/\s+/)[0] === 'dsh'
        ? [
            '  where dsh >nul 2>nul',
            '  if errorlevel 1 (',
            `    >> "${join(launcherDir, 'launch.log').replace(/"/g, '\\"')}" echo [%date% %time%] 'dsh' not in PATH, npx fallback`,
            "    echo [native-launcher] 'dsh' not found in PATH, trying npx fallback...",
            `    npx --yes @deepseek-ai/dsh ${launchCommand.split(/\s+/).slice(1).join(' ')}`,
            '    if errorlevel 1 (',
            `      >> "${join(launcherDir, 'launch.log').replace(/"/g, '\\"')}" echo [%date% %time%] npx fallback failed`,
            '      echo [native-launcher] ERROR: both "dsh" and "npx @deepseek-ai/dsh" failed.',
            '      echo [native-launcher] Install dsh globally: npm install -g @deepseek-ai/dsh',
            '      echo [native-launcher] Or set launchCommand in cordis.patch.yml.',
            '      echo [native-launcher] Closing in 15 seconds...',
            '      timeout /t 15 >nul',
            '    )',
            '  ) else (',
            `    ${launchCommand}`,
            '  )',
          ]
        : [
            `  where ${launchCommand.split(/\s+/)[0]} >nul 2>nul`,
            '  if errorlevel 1 (',
            `    >> "${join(launcherDir, 'launch.log').replace(/"/g, '\\"')}" echo [%date% %time%] '${launchCommand.split(/\s+/)[0]}' not found in PATH`,
            `    echo [native-launcher] ERROR: '${launchCommand.split(/\s+/)[0]}' not found in PATH.`,
            '    echo [native-launcher] Install the command or set launchCommand in cordis.patch.yml.',
            '    echo [native-launcher] Closing in 15 seconds...',
            '    timeout /t 15 >nul',
            '  ) else (',
            `    ${launchCommand}`,
            '  )',
          ]),
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
  const exitLogInline = join(launcherDir, 'tray-exit.log').replace(/'/g, "''");
  const pidFileInline = join(launcherDir, 'tray-pid.txt').replace(/'/g, "''");
  const ps = [
    // ── 白箱化：第一行先落出生证明，全局 trap 收尸，PID 实名注册 ──
    `$exitLogPath = '${exitLogInline}'`,
    `try { Set-Content -Path '${pidFileInline}' -Value ($PID.ToString()) -NoNewline -Encoding UTF8 } catch { }`,
    `try { Add-Content -Path $exitLogPath -Value (\'[boot v${TRAY_SCRIPT_VERSION}] pid=\' + $PID + \' at \' + (Get-Date -Format \'HH:mm:ss.fff\')) -Encoding UTF8 } catch { }`,
    `trap { try { Add-Content -Path $exitLogPath -Value (\'[fatal v${TRAY_SCRIPT_VERSION}] pid=\' + $PID + \' :: \' + $_.Exception.Message + \' @ \' + $_.InvocationInfo.PositionMessage) -Encoding UTF8 } catch { }; break }`,
    "$ErrorActionPreference = 'SilentlyContinue'",
    'Add-Type -AssemblyName System.Windows.Forms',
    `try { Add-Content -Path $exitLogPath -Value ('[boot] WinForms loaded') -Encoding UTF8 } catch { }`,
    'Add-Type -AssemblyName System.Drawing',
    `try { Add-Content -Path $exitLogPath -Value ('[boot] Drawing loaded') -Encoding UTF8 } catch { }`,
    '',
    "# 单实例保护：命名互斥体（重复拉起自动退出）",
    "# abandoned 容错：旧托盘被强杀后 mutex 会遗留，此时 WaitOne 抛异常，视为可获取",
    "$mutex = New-Object System.Threading.Mutex($false, 'Local\\DshNativeLauncherTray')",
    '$mutexAcquired = $false',
    'try { $mutexAcquired = $mutex.WaitOne(0) } catch { $mutexAcquired = $true }',
    // mutex 被占（另一托盘实例持有）时留痕再退出——否则日志只有 exit 0，无法区分
    // "spawn 失败"与"正常退出"，也无法定位残留托盘（issue: 双击快捷方式无法启动 webUI）。
    `if (-not $mutexAcquired) { try { Add-Content -Path '${join(launcherDir, 'tray-exit.log').replace(/'/g, "''")}' -Value ('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] mutex not acquired (Local\\DshNativeLauncherTray held), exiting pid=' + $PID) -Encoding UTF8 } catch { }; exit 0 }`,
    `try { Add-Content -Path $exitLogPath -Value ('[boot] mutex acquired by pid=' + $PID) -Encoding UTF8 } catch { }`,
    // 版本标记：拿到互斥体后才写（覆盖写，避免追加累积）；apply 用它做托盘自更新
    "# 版本标记：与 lib/index.js 的 TRAY_SCRIPT_VERSION 一致（apply 用它做托盘自更新）",
    `$trayVersion = ${TRAY_SCRIPT_VERSION}`,
    `try { Set-Content -Path '${join(launcherDir, 'tray-version.txt').replace(/'/g, "''")}' -Value ($trayVersion.ToString()) -NoNewline -Encoding UTF8 } catch { }`,
    'try { Add-Content -Path $exitLogPath -Value (\'[tray started \' + (Get-Date -Format \'HH:mm:ss.fff\') + \']\') -Encoding UTF8 } catch { }',
    '',
    `$url = '${url}'`,
    // 烘焙 dsh PID：插件与 dsh 同进程，生成时 process.pid 即 dsh 的 PID——退出时精确杀，无需端口反查
    `$dshPid = ${process.pid}`,
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
  # 杀 dsh：优先烘焙 PID（apply 与 dsh 同进程，process.pid 即 dsh PID，精确无误杀）；
  # 校验命令行含 --profile 防 PID 复用误杀；校验不过回退按端口扫描（任意监听地址，
  # 兼容 webserver.host=127.0.0.1 的机器），仍不中只记日志不误杀。
  $dshKilled = $false
  if ($dshPid -gt 0) {
    try {
      $dp = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $dshPid) -ErrorAction Stop
      if ($dp -and $dp.CommandLine -and $dp.CommandLine.Contains('--profile')) {
        taskkill /PID $dshPid /T /F | Out-Null
        Log-Exit ('dsh stopped (baked pid): PID ' + $dshPid)
        $dshKilled = $true
      } else {
        Log-Exit ('baked dsh pid ' + $dshPid + ' invalid (dead/reused), fallback to port scan')
      }
    } catch { Log-Exit ('baked pid check error: ' + $_.Exception.Message) }
  }
  if (-not $dshKilled) {
    $line = netstat -ano | Select-String 'LISTENING' | Select-String ':${String(port)}'
    if ($line) {
      $dpid = ($line -split '\\s+')[-1]
      taskkill /PID $dpid /T /F | Out-Null
      Log-Exit ('dsh stopped (port scan): PID ' + $dpid)
    } else {
      Log-Exit 'dsh not listening on :${String(port)}'
    }
  }
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
    // 退出路径留痕：区分"mutex 未获取退出"与"消息循环正常结束退出"，日志不再只有 exit 0
    "try { Log-Exit 'message loop ended (tray exiting normally)' } catch { }",
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
      logMsg('icon copied/updated');
    }
    return target;
  } catch (error) {
    logMsg(`icon copy failed: ${error}`);
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
        logMsg(`shortcut already exists and points to current vbs + icon, skipping: ${lnk}`);
        return;
      }
      logMsg(`shortcut exists but points elsewhere or icon changed, recreating: ${lnk}`);
    } catch {
      // 读失败（权限/损坏）→ 保守重建
      logMsg(`shortcut unreadable, recreating: ${lnk}`);
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
    logMsg(`shortcut created: ${lnk}`);
    // 实名登记：卸载时只定点清除登记过的 lnk，绝不全盘扫描桌面（误删比不删恐怖）
    try {
      const regPath = join(launcherDir, 'shortcut-registry.txt');
      const existing = existsSync(regPath) ? readFileSync(regPath, 'utf-8') : '';
      if (!existing.split(/\r?\n/).map(s => s.trim()).filter(Boolean).includes(lnk)) {
        appendFileSync(regPath, lnk + '\r\n');
      }
    } catch { /* 登记失败不影响快捷方式本身 */ }
  } catch (error) {
    logMsg(`shortcut creation failed: ${error}`);
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
      logMsg('square icon generated (256x256)');
      return readFileSync(outPath);
    }
    logMsg('square icon generation failed, falling back to source png');
  } catch (error) {
    logMsg(`square icon failed: ${error}`);
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
    logMsg('pwa icon extract failed, routes skipped');
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
    logMsg('pwa routes registered');
  } catch (error) {
    logMsg(`pwa route registration failed: ${error}`);
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
    logMsg(`open browser failed: ${error}`);
    return false;
  }
}

// 托盘进程管理（apply 与设置页保存后的热更新共用）：
// probe 命令：按 cmdline 含 tray.ps1 + launcherDir 计数（排除 $PID 防自杀）
function buildTrayProbeCmd(launcherDir) {
  return [
    "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' or Name='pwsh.exe'\" -ErrorAction SilentlyContinue |",
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
    'Measure-Object | Select-Object -ExpandProperty Count',
  ].join(' ');
}

// 杀掉现有托盘进程并同步等待退出（避免 Mutex 冲突）。返回被杀 PID 列表文本。
function killExistingTrays(launcherDir, logMsg) {
  // 精确优先：tray-pid.txt（托盘出生时实名注册的 PID）；CIM cmdline 扫描兜底
  const pidFile = join(launcherDir, 'tray-pid.txt');
  try {
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      if (Number.isInteger(pid) && pid > 0) {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 8000 });
        logMsg(`[tray] killed registered tray-pid ${pid} (from tray-pid.txt)`);
      }
    }
  } catch { /* pid file unreadable - sweep below still applies */ }
  const killCmd = [
    "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' or Name='pwsh.exe'\" -ErrorAction SilentlyContinue |",
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; 'killed:' + $_.ProcessId }",
  ].join(' ');
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', killCmd], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 10000,
  });
  const out = String(result.stdout ?? '').trim();
  try {
    spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 2000'], {
      stdio: 'ignore', windowsHide: true, timeout: 6000,
    });
  } catch { /* ignore */ }
  logMsg(`[tray] sweep kill result: ${out || '(none)'} exit=${result.status}`);
  return out;
}

// 拉起托盘（双机制互备，顺序由 preferPersistent 决定）+ 异步存活验证，失败自动降级重试：
//  - WScript.Shell.Run(...,0)（launcher.vbs 同款）：独立存活、隐藏窗口、不随父死——persistent 模式首选
//  - 直 spawn（无 detached）：托盘是 dsh 子进程，dsh 退出时随之退出——with-dsh 模式首选 / 另一模式的兜底
// 不用 detached:true（部分 Windows 配置即退）；不用 cmd start（黑框无法隐藏且关框杀托盘）。
function startTrayProcess(launcherDir, trayPath, preferPersistent, logMsg) {
  const probeCmd = buildTrayProbeCmd(launcherDir);
  const probeAlive = (cb) => {
    const probe = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', probeCmd], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    probe.stdout?.on('data', (chunk) => { out = String(out + chunk).slice(-2000); });
    probe.on('close', () => cb(parseInt(String(out).trim(), 10) > 0));
  };
  const modeLabel = preferPersistent ? 'persistent (wscript first)' : 'with-dsh (direct first)';
  logMsg(`startTrayProcess: mode=${modeLabel}, trayPath=${trayPath}`);
  // 失败取证：把 tray-exit.log 最后几行（托盘的临终遗言）带回主日志，跨文件关联死因
  const exitLogTail = () => {
    try {
      return readFileSync(join(launcherDir, 'tray-exit.log'), 'utf-8').trim().split(/\r?\n/).slice(-3).join(' || ');
    } catch { return '(no tray-exit.log)'; }
  };
  const spawnTray = (attempt) => {
    if (attempt > 3) {
      logFail(`[tray] spawn FAILED after ${attempt - 1} attempts. tray-exit tail: ${exitLogTail()}`);
      return;
    }
    // attempt 1 = 首选机制；attempt 2/3 = 备选机制（任一 alive 即停）
    const useWscript = preferPersistent ? attempt === 1 : attempt !== 1;
    if (useWscript) {
      const runCmd = `(New-Object -ComObject WScript.Shell).Run('powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${trayPath.replace(/'/g, "''")}"', 0, $false)`;
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', runCmd],
        { stdio: 'ignore', windowsHide: true },
      );
      child.unref();
      child.on('exit', (code, signal) => {
        logMsg(`tray attempt ${attempt} (wscript run, ${modeLabel}) launcher exited code=${code} signal=${String(signal)}`);
      });
    } else {
      const child = spawn(
        'powershell',
        ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', trayPath],
        { stdio: 'ignore', windowsHide: true },
      );
      child.unref();
      child.on('exit', (code, signal) => {
        logMsg(`tray attempt ${attempt} (direct spawn, ${modeLabel}) exited code=${code} signal=${String(signal)} (stdio=ignore; see tray-exit.log for script-level reason)`);
      });
    }
    setTimeout(() => {
      probeAlive((alive) => {
        if (alive) {
          // 出生登记核对：读 tray-pid.txt 确认活着的到底是谁（防止僵尸顶替）
          let pidNote = '';
          try {
            const pf = join(launcherDir, 'tray-pid.txt');
            if (existsSync(pf)) {
              const tp = parseInt(readFileSync(pf, 'utf-8').trim(), 10);
              const proc = Number.isInteger(tp) && tp > 0 ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${tp} -ErrorAction SilentlyContinue) -ne $null`], { encoding: 'utf8', windowsHide: true, timeout: 8000 }) : null;
              const isUp = String(proc?.stdout ?? '').trim() === 'True';
              pidNote = `, registered tray-pid=${tp} alive=${isUp}`;
            } else {
              pidNote = ', no tray-pid.txt (pre-v7 tray?)';
            }
          } catch { }
          logMsg(`[tray] attempt ${attempt}: alive=true${pidNote}`);
        } else {
          logWarn(`[tray] attempt ${attempt}: dead. exit-log tail: ${exitLogTail()} -> retrying`);
          spawnTray(attempt + 1);
        }
      });
    }, 1500);
  };
  spawnTray(1);
}

// 加固：apply 全程受保护——任何环节失败只记日志，绝不拖垮宿主启动。
export function apply(ctx, config = {}) {
  try {
    applyInner(ctx, config);
  } catch (error) {
    logFail(`[launcher] apply failed (harness continues): ${error?.stack ?? error}`);
  }
}

function applyInner(ctx, config = {}) {
  // rc.8 适配：官方 dsh web 默认自动打开浏览器（普通标签页），会与我们插件的
  // PWA 应用窗口打开形成双开——启动命令加 --no-open 让官方让位，由插件
  // （autoOpen → open-webui.ps1，PWA 应用优先）负责打开。
  // 版本门槛：--no-open 参数为 rc.8 起支持，旧版本检测到后日志提醒升级。
  const dshVersion = detectDshVersion();
  if (dshVersion && !dshVersionGte(dshVersion, '0.1.0-rc.8')) {
    logMsg(`WARNING: dsh ${dshVersion} is below 0.1.0-rc.8 — the launch command uses --no-open (rc.8+ only). Please upgrade: npm install -g @deepseek-ai/dsh@0.1.0-rc.8`);
  }
  logMsg(`dsh version: ${dshVersion || '(unknown)'}`);
  // 注册官方设置卡片（rc.7+）：resolved = schema 默认值 → patch base（cordis.patch.yml）→ 用户设置文档。
  // 合并结果作为本次生效配置；用户改设置后需重启 dsh 完全生效（脚本/托盘/快捷方式都在 apply 时生成）。
  let settingsScope = null;
  let cfg = config;
  try {
    if (ctx.settings) {
      settingsScope = ctx.settings.register(SETTINGS_NAMESPACE, LAUNCHER_SETTINGS_SCHEMA, { base: config });
      cfg = { ...config, ...settingsScope.get() };
      logMsg(`[settings] registered ns=${SETTINGS_NAMESPACE} (resolved: port=${cfg.port}, launchCommand=${JSON.stringify(cfg.launchCommand)}, tray=${cfg.tray !== false}, traySurvivesDsh=${cfg.traySurvivesDsh !== false}, modules=${JSON.stringify(cfg.modules)})`);
      settingsScope.watch(() => logMsg('settings updated — restart dsh (double-click shortcut) to fully apply'));
    } else {
      logMsg('settings service unavailable, using patch config only');
    }
  } catch (error) {
    // 重复注册（fiber 重载竞态）等场景：保留 patch 配置继续跑，不拖垮本体
    logMsg(`settings register skipped: ${error?.message ?? error}`);
  }
  const launchCommand = cfg.launchCommand ?? 'dsh --profile web --no-open';
  const shortcutName = cfg.shortcutName ?? 'DSH WebUI';
  const autoOpen = cfg.autoOpen !== false;
  const force = cfg.force === true;
  const port = cfg.port ?? 3080;
  // 在线客户端计数（close-to-exit 与 autoOpen 共享）：autoOpen 检测到页面已在用时不再开浏览器
  let clientsOnline = 0;
  const trayEnabled = cfg.tray !== false;
  const openMode = cfg.openMode ?? 'app';
  // 关闭语义参数（设置页可调，含下限保护：防抖至少 5s、确认窗口至少 1s）
  const debounceSeconds = Math.max(5, Number(cfg.closeToExitDebounceSeconds ?? 20) || 20);
  const debounceMs = debounceSeconds * 1000;
  const finalConfirmSeconds = Math.max(1, Number(cfg.closeToExitFinalConfirmSeconds ?? 2) || 2);
  const finalConfirmMs = finalConfirmSeconds * 1000;

  // 1. 生成静默启动脚本（launch.cmd 端口探测 + launcher.vbs 隐藏窗口）
  const home = process.env.USERPROFILE;
  if (!home) {
    logMsg('USERPROFILE missing; launcher cannot be installed');
    return;
  }
  const launcherDir = join(home, '.dsh-webui-launcher');
  LOG_PATH = join(launcherDir, 'native-launcher.log');
  APPLY_SEQ += 1;
  logMsg(`──────────────── apply #${APPLY_SEQ} start (dsh pid=${process.pid}) ────────────────`);
  logEnvDiagnostics(launcherDir, config);
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
    logMsg(`launcher script failed: ${error}`);
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
          case 'config.get': {
            // 实时读官方设置文档（而非 apply 时快照）：否则保存多次后配置页回显旧值，
            // 下次点保存还会把新配置覆盖回旧值（数据回退）
            const live = settingsScope ? { ...config, ...settingsScope.get() } : config;
            return {
              ok: true,
              value: {
                launchCommand: live.launchCommand ?? 'dsh --profile web --no-open',
                shortcutName: live.shortcutName ?? 'DSH WebUI',
                autoOpen: live.autoOpen !== false,
                force: live.force === true,
                port: live.port ?? 3080,
                tray: live.tray !== false,
                trayNotify: live.trayNotify !== false,
                traySurvivesDsh: live.traySurvivesDsh !== false,
                openMode: live.openMode ?? 'app',
                closeToExit: live.closeToExit !== false,
                closeToExitDebounceSeconds: Math.max(5, Number(live.closeToExitDebounceSeconds ?? 20) || 20),
                closeToExitFinalConfirmSeconds: Math.max(1, Number(live.closeToExitFinalConfirmSeconds ?? 2) || 2),
                modules: live.modules ?? {},
                settingsAvailable: !!settingsScope,
                launcherDir,
                vbsPath,
                iconPath,
                shortcutExists: existsSync(join(resolveDesktopPath() ?? '', `${live.shortcutName ?? shortcutName}.lnk`)),
              },
            };
          }
          case 'config.set': {
            // 设置页表单保存：写入官方 settings 用户文档（持久化），重启后完全生效
            if (!settingsScope) { logFail('[settings] config.set rejected: settings service unavailable'); return { ok: false, error: { code: 'config', message: 'settings service unavailable', details: {} } }; };
            try {
              SAVE_SEQ += 1;
              const seq = `save#${SAVE_SEQ}`;
              const values = (_payload && _payload.values) ?? {};
              logMsg(`[settings] ${seq} begin, raw values: ${JSON.stringify(values)}`);
              const patch = {};
              // 值防线：所有字段钳制/过滤后再入库——非法值绝不能动摇 apply（根基）。
              // 空串一律不写 patch（保留原值），避免 undefined 混进 settings 文档。
              if (values.launchCommand !== undefined) {
                const lc = String(values.launchCommand).trim();
                if (lc) patch.launchCommand = lc;
              }
              if (values.shortcutName !== undefined) {
                // 过滤 Windows 文件名非法字符（快捷方式是 .lnk 文件）
                const sn = String(values.shortcutName).trim().replace(/[\\/:*?"<>|]/g, '_');
                if (sn) patch.shortcutName = sn.slice(0, 80);
              }
              if (values.port !== undefined) patch.port = Math.min(65535, Math.max(1, Math.floor(Number(values.port) || 3080)));
              if (values.autoOpen !== undefined) patch.autoOpen = !!values.autoOpen;
              if (values.tray !== undefined) patch.tray = !!values.tray;
              if (values.trayNotify !== undefined) patch.trayNotify = !!values.trayNotify;
              if (values.closeToExit !== undefined) patch.closeToExit = !!values.closeToExit;
              // 上限 3600s：setTimeout delay 超 2^31-1 ms 会立即触发（等于关窗秒退），必须封顶
              if (values.closeToExitDebounceSeconds !== undefined) patch.closeToExitDebounceSeconds = Math.min(3600, Math.max(5, Math.floor(Number(values.closeToExitDebounceSeconds) || 20)));
              if (values.closeToExitFinalConfirmSeconds !== undefined) patch.closeToExitFinalConfirmSeconds = Math.min(60, Math.max(1, Math.floor(Number(values.closeToExitFinalConfirmSeconds) || 2)));
              if (values.openMode !== undefined) patch.openMode = ['app', 'new-window', 'default'].includes(values.openMode) ? values.openMode : 'app';
              if (values.force !== undefined) patch.force = !!values.force;
              if (values.traySurvivesDsh !== undefined) patch.traySurvivesDsh = !!values.traySurvivesDsh;
              if (values.modules && typeof values.modules === 'object') {
                patch.modules = { notifications: values.modules.notifications !== false };
              }
              settingsScope.update(patch);
              // 只对「值真正变化」的字段做后续动作——表单是全量提交，未改动的键不能触发托盘重启等副作用
              const prevValues = settingsScope.get() ?? {};
              const changedKeys = Object.keys(patch).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(prevValues[k]));
              if (changedKeys.length === 0) {
                logMsg(`[settings] ${seq} no actual change, nothing to apply`);
                return { ok: true, value: { message: '配置无变化，无需保存' } };
              }
              logMsg(`[settings] ${seq} validated patch (changed: [${changedKeys.join(', ')}]): ${JSON.stringify(patch)}`);
              // 即时生效（生成物类）：用合并后的新配置重建 launch.cmd/vbs/tray.ps1/open-webui.ps1/快捷方式；
              // 若托盘相关字段变更，顺带热重启托盘进程（新机制/新端口立即生效）。
              let restartHint = '已保存 — 重启 dsh（双击桌面快捷方式）后完全生效';
              try {
                // 注意：scope.update() 是异步提交（write queue），立刻 get() 会拿到旧 resolved——
                // 必须把刚校验过的 patch 显式盖在最顶层，保证本次热应用用的一定是新值。
                const fresh = { ...config, ...settingsScope.get(), ...patch };
                const fPort = fresh.port ?? port;
                const fShortcutName = fresh.shortcutName ?? shortcutName;
                const fOpenMode = fresh.openMode ?? openMode;
                const fTrayEnabled = fresh.tray !== false;
                const fSurvives = fresh.traySurvivesDsh !== false;
                logMsg(`[settings] ${seq} hot-apply with merged config (port=${fPort}, shortcutName=${JSON.stringify(fShortcutName)}, openMode=${fOpenMode}, tray=${fTrayEnabled}, traySurvivesDsh=${fSurvives})`);
                const pwaId = findInstalledPwaAppId(fPort, launcherDir);
                mkdirSync(launcherDir, { recursive: true });
                writeOpenScript(launcherDir, fPort, fOpenMode, fShortcutName, pwaId);
                writeLauncherFiles(launcherDir, fresh.launchCommand ?? launchCommand, fPort, fTrayEnabled ? join(launcherDir, 'tray.ps1') : null, join(launcherDir, 'open-webui.ps1'));
                if (fTrayEnabled) writeTrayScript(launcherDir, fPort, join(launcherDir, 'dsh-webui.ico'), join(launcherDir, 'open-webui.ps1'), pwaId);
                // 改名场景：快捷方式按文件名存在，必须删掉旧名 .lnk，否则桌面双图标残留
                // 旧名以 settings 文档里的上一个值为准（不是 apply 快照——两者可能不一致）
                if (changedKeys.includes('shortcutName')) {
                  const oldName = String(prevValues.shortcutName ?? '').trim();
                  if (oldName && oldName !== fShortcutName) {
                    const oldLnk = join(resolveDesktopPath() ?? '', `${oldName}.lnk`);
                    if (existsSync(oldLnk)) {
                      try { unlinkSync(oldLnk); logMsg(`[settings] ${seq} removed renamed-away shortcut: ${oldLnk}`); } catch (e) { logWarn(`[settings] ${seq} failed to remove old shortcut ${oldLnk}: ${e}`); }
                    }
                  }
                }
                createDesktopShortcut(fShortcutName, vbsPath, ensureIcon(launcherDir), false);
                logMsg(`[settings] ${seq} hot-apply: artifacts regenerated ok`);
                const TRAY_RELATED = ['tray', 'traySurvivesDsh', 'port', 'openMode'];
                const trayChanged = changedKeys.filter(k => TRAY_RELATED.includes(k));
                if (trayChanged.length > 0) {
                  logMsg(`[settings] ${seq} tray-affecting fields changed [${trayChanged.join(', ')}] -> restarting tray (survives=${fSurvives})`);
                  killExistingTrays(launcherDir, logMsg);
                  if (fTrayEnabled) startTrayProcess(launcherDir, join(launcherDir, 'tray.ps1'), fSurvives, logMsg);
                  else logMsg('[settings] tray disabled by config, not respawning');
                  restartHint = '已保存并即时应用（托盘已按新配置重启）— 关闭语义等运行参数仍建议重启一次';
                } else {
                  logMsg(`[settings] ${seq} no tray-affecting change, skip tray restart`);
                }
              } catch (error) {
                logFail(`[settings] ${seq} hot-apply FAILED after save (config persisted, restart dsh to recover): ${error?.stack ?? error}`);
                restartHint = '已保存，但自动应用失败——重启 dsh 即可恢复一致';
              }
              return { ok: true, value: { message: restartHint } };
            } catch (error) {
              logFail(`[settings] config.set failed: ${error?.stack ?? error}`);
              return { ok: false, error: { code: 'config', message: String(error?.message ?? error), details: {} } };
            }
          }
          case 'shortcut.recreate': {
            // 用实时配置（非 apply 时快照）：改名/改端口保存后立即点此按钮，行为应与最新配置一致
            const liveName = settingsScope ? (settingsScope.get().shortcutName ?? shortcutName) : shortcutName;
            createDesktopShortcut(liveName, vbsPath, iconPath, true);
            const lnk = join(resolveDesktopPath() ?? '', `${liveName}.lnk`);
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
          case 'launcher.uninstall': {
            // 一键卸载（dev-notes 一·七 阶段 3）：停托盘 → 删快捷方式 → 清生成物 → 删 AUMID 注册表
            //   → profile 自移除（改 package.json：dependencies + dsh.profile.bundles）。
            // 运行时自杀是安全的：JS 已加载进内存，删条目/目录不影响当前进程；重启后彻底干净。
            // link: 开发安装绝不删除目标目录（那是维护者的 git 工作区），只断开 profile 链接。
            // 独立审计日志：uninstall.log 不在任何清理清单里——卸载失败时它就是唯一的完整证据。
            const ULOG = join(launcherDir, 'uninstall.log');
            const logU = (level, msg) => {
              try {
                const d = new Date();
                const p = (n, w = 2) => String(n).padStart(w, '0');
                const line = `[${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}] [${level.padEnd(5)}] ${msg}`;
                appendFileSync(ULOG, line + '\r\n');
                logMsg(`[uninstall] ${msg}`);
              } catch { }
            };
            const steps = [];
            const manual = [];
            const addStep = (msg) => { steps.push(msg); logU('INFO', msg); };
            const addFail = (msg) => { steps.push(msg); logU('ERROR', msg); };
            const manualAdd = (msg) => { manual.push(msg); logU('MANUAL', msg); };
            const clearSettings = !!(_payload && _payload.clearSettings);
            // 卸载语义包含停止服务：默认 true（6s 后官方优雅退出）；stopAfter=false 仅供特殊调试
            const stopAfter = !(_payload && _payload.stopAfter === false);
            logU('INFO', `════ uninstall session start (dsh pid=${process.pid}, launcherDir=${launcherDir}, clearSettings=${clearSettings}, stopAfter=${stopAfter}) ════`);
            // STEP 0（可选）：彻底重置——清空本 ns 的用户设置段，配置回落 base+默认。
            // 官方定义的重置路径：scope.replace({})（"removal/reset path a merge-only
            // patch cannot express"）。默认不勾选；勾选后重装=全新默认配置。
            if (clearSettings && settingsScope) {
              try {
                await settingsScope.replace({});
                addStep('已清除本插件的全部个性化配置（settings.yaml 中 native-launcher 段已重置）');
                logU('INFO', 'STEP 0/5 settings-reset: user section replaced with {} - reverts to base/defaults');
              } catch (error) {
                addFail(`清除配置失败（不影响卸载本身）: ${error?.stack ?? error}`);
                manualAdd('个性化配置自动清除失败——如需重置，手动编辑 E:\\dsh\\settings.yaml 删除 native-launcher 段');
              }
            } else if (!settingsScope) {
              logWarn('[uninstall] settingsScope unavailable, cannot honor clearSettings');
            }
            logU('INFO', 'STEP 1/5 tray-kill: begin');
            try {
              // 1) 停托盘进程（含其子进程）
              const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'tray\\.ps1' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null; $_.ProcessId }"],
                { encoding: 'utf8', windowsHide: true });
              const killed = String(ps.stdout ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
              addStep(killed.length ? `已停止托盘进程: PID ${killed.join(', ')}` : '没有运行中的托盘进程');
              logU('INFO', `STEP 1/5 tray-kill: taskkill exit=${ps.status}, pids=[${killed.join(',')}]${ps.stderr ? `, stderr=${String(ps.stderr).trim().slice(0, 200)}` : ''}`);
            } catch (error) {
              addFail(`停止托盘失败（继续）: ${error}`);
            }
            try {
              // 2) 删除桌面快捷方式——定点清除：只删「登记文件里记录的」+「当前配置名对应的」lnk。
              //    绝不全盘扫描桌面（误删比不删恐怖）；登记文件由 createDesktopShortcut 成功时写入。
              const desktop = resolveDesktopPath() ?? '';
              const targets = new Set();
              const regFile = join(launcherDir, 'shortcut-registry.txt');
              try {
                if (existsSync(regFile)) {
                  for (const line of readFileSync(regFile, 'utf-8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) targets.add(line);
                }
              } catch { }
              // 实时权威名（settings 文档）优先，启动快照名兜底——两者都纳入定点清除
              const liveCfgU = settingsScope ? (settingsScope.get() ?? {}) : {};
              const liveShortcutName = String(liveCfgU.shortcutName || '').trim() || shortcutName;
              if (desktop) targets.add(join(desktop, `${liveShortcutName}.lnk`));
              let removedLnk = 0;
              const failedLnks = [];
              for (const t of targets) {
                if (!t || !existsSync(t)) continue;
                try { unlinkSync(t); removedLnk++; logU('INFO', `STEP 2/5 removed: ${t}`); } catch (e) {
                  failedLnks.push(t);
                  const code = e?.code ?? '?';
                  const busy = code === 'EBUSY';
                  logU('ERROR', `STEP 2/5 shortcut delete FAILED: ${t} code=${code} :: ${e?.message ?? e}${busy ? ' (hint: file locked - retry after restarting explorer)' : ''}`);
                }
              }
              addStep(removedLnk > 0 ? `已删除 ${removedLnk} 个桌面快捷方式${failedLnks.length ? `（${failedLnks.length} 个失败，详见 uninstall.log）` : ''}` : '桌面无本插件快捷方式（跳过）');
              logU('INFO', `STEP 2/5 shortcut removal summary: removed=${removedLnk}, failed=${failedLnks.length}, candidates=[${Array.from(targets).join(' ; ')}]`);
            } catch (error) {
              addFail(`删除快捷方式失败（继续）: ${error?.stack ?? error}`);
            }
            try {
              // 3) 清理生成物与日志（目录保留：插件仍在运行，避免日志写入报错）
              logU('INFO', 'STEP 3/5 artifacts: begin (uninstall.log is exempt from this list)');
              const artifacts = ['launch.cmd', 'launcher.vbs', 'tray.ps1', 'open-webui.ps1', 'dsh-webui.ico',
                'native-launcher.log', 'launch.log', 'tray-exit.log', 'tray-notify.log', 'tray-notify.json',
                'tray-version.txt', 'pwa-scan.log', 'open-webui.log', 'test-results.log'];
              let removed = 0;
              const failedFiles = [];
              for (const name of artifacts) {
                const p = join(launcherDir, name);
                if (!existsSync(p)) continue;
                try { unlinkSync(p); removed++; } catch (e) {
                  failedFiles.push(name);
                  // 失败原因分级：EBUSY/EPERM = 被占用/权限，附可行动提示
                  const code = e?.code ?? '?';
                  const hint = code === 'EBUSY' ? 'file locked by a running process - will be removable after dsh restarts'
                    : code === 'EPERM' || code === 'EACCES' ? 'permission denied - check file attributes/ACL'
                    : code === 'ENOENT' ? 'already gone'
                    : 'unexpected error';
                  logU('ERROR', `STEP 3/5 artifact delete FAILED: ${name} code=${code} syscall=${e?.syscall ?? '-'} :: ${e?.message ?? e} (hint: ${hint})`);
                }
              }
              addStep(failedFiles.length ? `已清理生成物 ${removed} 个文件，${failedFiles.length} 个失败（${failedFiles.join(', ')}，详见 uninstall.log）` : `已清理生成物 ${removed} 个文件`);
              logU('INFO', `STEP 3/5 artifacts summary: removed=${removed}, failed=[${failedFiles.join(', ') || 'none'}]`);
            } catch (error) {
              addFail(`清理生成物失败（继续）: ${error?.stack ?? error}`);
            }
            try {
              // 4) 删除 AUMID 注册表键（Toast 通知身份）
              logU('INFO', 'STEP 4/5 registry: reg delete HKCU\\...\\AppUserModelId\\DshNativeLauncher');
              const reg = spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Classes\\AppUserModelId\\DshNativeLauncher', '/f'], { encoding: 'utf8', windowsHide: true });
              const regOut = String((reg.stdout ?? '') + ' ' + (reg.stderr ?? '')).trim();
              if (reg.status === 0) {
                addStep('已删除通知标识注册表项 (AUMID DshNativeLauncher)');
                logU('INFO', `STEP 4/5 registry: deleted${regOut ? ' :: ' + regOut.slice(0, 200) : ''}`);
              } else if (/unable to find/i.test(regOut)) {
                addStep('通知注册表项不存在（跳过）');
                logU('INFO', `STEP 4/5 registry: key absent, skip`);
              } else {
                addStep(`注册表删除退出码 ${reg.status}（详见 uninstall.log）`);
                logU('ERROR', `STEP 4/5 registry FAILED: exit=${reg.status} output=${regOut.slice(0, 300)} (hint: access denied means run dsh as the same user that created the key)`);
              }
            } catch (error) {
              addFail(`清理注册表失败（继续）: ${error?.stack ?? error}`);
            }
            try {
              // 5) profile 自移除：扫描 $DSH_HOME/profiles/*/package.json，摘除 dependencies 条目
              //    与 dsh.profile.bundles 数组项（先备份原文件）。link 安装保留目标目录。
              logU('INFO', 'STEP 5/5 profile-edit: scanning profiles for dsh-native-launcher entries');
              const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh');
              const profilesRoot = join(home, 'profiles');
              let touched = false;
              if (existsSync(profilesRoot)) {
                for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
                  if (!entry.isDirectory()) continue;
                  const pkgPath = join(profilesRoot, entry.name, 'package.json');
                  if (!existsSync(pkgPath)) continue;
                  let pkg;
                  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { continue; }
                  const deps = pkg.dependencies ?? {};
                  const spec = deps['dsh-native-launcher'];
                  if (!spec) continue;
                  // 备份后改写：dependencies 摘除 + bundles 过滤
                  copyFileSync(pkgPath, `${pkgPath}.before-uninstall`);
                  logU('INFO', `STEP 5/5 profile-edit: backup written to ${pkgPath}.before-uninstall`);
                  delete deps['dsh-native-launcher'];
                  if (Array.isArray(pkg.dsh?.profile?.bundles)) {
                    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter(b => b !== 'dsh-native-launcher');
                  }
                  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
                  touched = true;
                  logU('INFO', `STEP 5/5 profile-edit: "${entry.name}" package.json rewritten (deps entry + bundles filtered)`);
                  addStep(`已从 profile "${entry.name}" 移除插件条目（备份: package.json.before-uninstall）`);
                  if (String(spec).startsWith('link:')) {
                    addStep('检测到开发链接安装（link:），插件源码目录已保留未删除');
                    logU('INFO', 'link-install detected: source directory preserved (never deleted)');
                  }
                  // 断开 node_modules 链接（pnpm/link symlink 只删链接本身）
                  const linkPath = join(profilesRoot, entry.name, 'node_modules', 'dsh-native-launcher');
                  if (existsSync(linkPath)) {
                    try { unlinkSync(linkPath); steps.push('已断开 node_modules 插件链接'); } catch (e) {
                      manual.push(`未能移除 ${linkPath}（可手动删除或在该 profile 目录执行包管理器安装命令清理）: ${e}`);
                    }
                  }
                }
              }
              if (!touched) manual.push('未在 $DSH_HOME/profiles 找到本插件的安装条目——若装在其他 profile，请手动从其 package.json 移除 "dsh-native-launcher"');
            } catch (error) {
              manual.push('自动移除 profile 条目失败，请手动编辑 profiles/<name>/package.json 删除 "dsh-native-launcher"（dependencies 与 dsh.profile.bundles 两处）: ' + error);
            }
            // lockfile 一致性：只检测+报告，绝不自动跑包管理器——
            // 其他机器的 pnpm/npm/corepack/网络/workspace 配置千差万别，自动 install 风险大于收益
            try {
              const home2 = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh');
              const profilesRoot2 = join(home2, 'profiles');
              if (existsSync(profilesRoot2)) {
                for (const entry of readdirSync(profilesRoot2, { withFileTypes: true })) {
                  if (!entry.isDirectory()) continue;
                  const dir = join(profilesRoot2, entry.name);
                  const pkgPath = join(dir, 'package.json');
                  try {
                    if (!existsSync(pkgPath)) continue;
                    const rawPkg = readFileSync(pkgPath, 'utf-8');
                    if (!rawPkg.includes('"dsh-native-launcher"') && !existsSync(join(dir, 'node_modules', 'dsh-native-launcher'))) continue;
                    for (const lf of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']) {
                      if (existsSync(join(dir, lf))) {
                        manual.push(`profile "${entry.name}" 的 ${lf} 仍含本插件条目（我们绝不自动改动你的包管理文件）——重启若报依赖错误，请在该目录自行执行一次安装命令即可修正`);
                        break;
                      }
                    }
                  } catch { /* 单个 profile 异常不影响整体 */ }
                }
              }
            } catch { /* 检测失败不阻塞卸载 */ }
            manual.push('如安装过 PWA 应用：浏览器 edge://apps 中手动卸载"DSH WebUI"');
            // 进程退出时的收尾：只删「已知的功能性生成物」，日志全部保留作为证据——
            // 运行期间写不掉的文件（native-launcher.log / tray-pid.txt / tray-version.txt）此刻已无主，可安全清除
            pendingExitCleanup = launcherDir;
            process.once('exit', () => {
              const target = pendingExitCleanup; pendingExitCleanup = null;
              if (!target) return;
              try {
                for (const name of ['launch.cmd', 'launcher.vbs', 'tray.ps1', 'open-webui.ps1', 'dsh-webui.ico', 'tray-pid.txt', 'tray-version.txt']) {
                  const p = join(target, name);
                  if (existsSync(p)) { try { unlinkSync(p); } catch { } }
                }
                try { appendFileSync(join(target, 'uninstall.log'), `[${new Date().toISOString()}] [INFO ] dsh exited - post-exit artifact cleanup ran\r\n`); } catch { }
              } catch { }
            });
            manual.push('重启 dsh 后卸载完全生效（启动器不会再生成任何内容）；诊断日志保留在 .dsh-webui-launcher\\uninstall.log 供排查，确认无误后可手动删除整个目录');
            logU('INFO', 'exit hook armed: functional artifacts will be removed when dsh stops; uninstall.log preserved');
            // 卸载语义包含停止服务：延迟 6s 执行官方优雅退出——给前端渲染报告的时间；
            // exit hook（清残留生成物）会在进程退出时自动衔接，无需用户再找 taskkill
            if (stopAfter) {
              setTimeout(() => {
                try {
                  logU('INFO', 'auto-stop: calling appExit(0)');
                  const ae = ctx.get('appExit');
                  if (typeof ae === 'function') { ae(0); logU('INFO', 'auto-stop: appExit(0) issued'); }
                  else logFail('[uninstall] auto-stop failed: appExit service unavailable');
                } catch (e) {
                  logFail(`[uninstall] auto-stop failed: ${e?.stack ?? e}`);
                }
              }, 6000);
              addStep('dsh 服务将在约 6 秒后自动停止（托盘已先行停止）');
            }
            logU('INFO', `════ uninstall session end — steps=${steps.length}, manual=${manual.length} ════`);
            logMsg(`[uninstall] done: ${steps.join(' | ')}`);
            return { ok: true, value: { steps, manual } };
          }
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
          case 'tray-acked': {
            // 托盘消费确认查询（浏览器兜底用）：tray-notify.json 被托盘消费（删除）= 已弹
            try {
              const file = join(launcherDir, 'tray-notify.json');
              return { ok: true, value: { consumed: !existsSync(file) } };
            } catch (error) {
              return { ok: false, error: { code: 'tray-acked', message: String(error), details: {} } };
            }
          }
          default:
            return { ok: false, error: { code: 'unknown', message: `unknown endpoint: ${endpoint}`, details: {} } };
        }
      },
      { authority: 'trusted-host' },
    );
  } catch (error) {
    logMsg(`rpc registration failed: ${error}`);
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
        // 注意：进程名可能是 powershell.exe 或 pwsh.exe（用户可能用 PowerShell 7 手动启动过托盘）
        const probeCmd = [
          "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' or Name='pwsh.exe'\" -ErrorAction SilentlyContinue |",
          `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
          'Measure-Object | Select-Object -ExpandProperty Count',
        ].join(' ');
        const probe = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', probeCmd], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          timeout: 10000,
        });
        const trayRunning = parseInt(String(probe.stdout ?? '').trim(), 10) > 0;
        logMsg(`tray process running: ${trayRunning} (versionFile=${runningVersion}, want=${TRAY_SCRIPT_VERSION})`);

        if (trayRunning && runningVersion !== TRAY_SCRIPT_VERSION) {
          logMsg(`tray version mismatch (running=${runningVersion}, want=${TRAY_SCRIPT_VERSION}), killing old tray`);
          try {
            // 必须排除 $PID（kill 命令自身命令行也含 tray.ps1，不排除会自杀导致旧托盘未被清理）
            const killCmd = [
              "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' or Name='pwsh.exe'\" -ErrorAction SilentlyContinue |",
              `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
              "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; 'killed:' + $_.ProcessId }",
            ].join(' ');
            const killResult = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', killCmd], {
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
              timeout: 10000,
            });
            logMsg(`old tray kill result: ${String(killResult.stdout ?? '').trim() || '(none)'} exit=${killResult.status}`);
          } catch (error) {
            logMsg(`old tray kill failed: ${error}`);
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
            // kill 后验证（异步，不阻塞 apply）：确认旧托盘真的没了
            // （若还有残留 = Stop-Process 失败/权限/其他会话）
            const afterKill = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', probeCmd], {
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
            });
            let afterOut = '';
            afterKill.stdout?.on('data', (chunk) => {
              afterOut = String(afterOut + chunk).slice(-2000);
            });
            afterKill.on('close', () => {
              logMsg(`after-kill probe: ${afterOut.trim() || '(empty)'} tray process(es) remain`);
            });
        } else if (trayRunning) {
          logMsg('tray already running (current version), skip spawn');
        } else {
          logMsg('no tray process, spawning fresh');
        }
        // 托盘进程不存在（或刚被换新）→ 拉起；进程已在且版本相符 → 跳过
        // 双机制互备 + 存活验证逻辑抽为模块级 startTrayProcess（设置页保存后的热更新也用它）。
        // 存活模式：traySurvivesDsh !== false = persistent（WScript 首选，托盘独立存活）；
        //           false = with-dsh（直 spawn 首选，托盘随 dsh 退出）——设置页可调。
        if (!trayRunning || runningVersion !== TRAY_SCRIPT_VERSION) {
          startTrayProcess(launcherDir, trayPath, cfg.traySurvivesDsh !== false, logMsg);
        }
      }
    } catch (error) {
      logMsg(`tray spawn failed: ${error}`);
    }
  }

  // 4.5 模块加载（整合包架构，dev-notes 一·七）：
  //   config.modules[id] 开关（缺省用模块自带 defaultEnabled）；apiVersion 不匹配拒载；
  //   单模块失败只禁用该模块并记日志——绝不拖垮本体。
  try {
    const moduleSwitches = cfg.modules ?? {};
    for (const mod of BUILTIN_MODULES) {
      const enabled = moduleSwitches[mod.id] ?? mod.defaultEnabled;
      if (!enabled) { logMsg(`[modules] ${mod.id}: disabled by config, skip`); continue; }
      const compat = typeof mod.apiVersion === 'number'
        && mod.apiVersion >= 1 && mod.apiVersion <= CORE_API_VERSION;
      if (!compat) { logMsg(`[modules] ${mod.id}: apiVersion ${mod.apiVersion} incompatible with core ${CORE_API_VERSION}, refuse to load`); continue; }
      const core = { apiVersion: CORE_API_VERSION, config: cfg, launcherDir, port, url: `http://127.0.0.1:${String(port)}/`, log: logMsg };
      logMsg(`[modules] ${mod.id}: applying (source=${mod.source ?? 'native'})`);
      const ret = mod.apply(ctx, core);
      // 兼容同步/异步模块：applyInner 是同步流程，异步返回值只挂兜底 catch（不阻塞、不吞错）
      if (ret && typeof ret.catch === 'function') {
        ret.catch((err) => logMsg(`[modules] ${mod.id}: async failure: ${err?.stack ?? err}`));
      }
      logMsg(`[modules] ${mod.id}: applied`);
    }
  } catch (error) {
    logMsg(`module loading failed: ${error?.stack ?? error}`);
  }

  // 4.6 托盘通知 host 兜底 + 4.7 关闭语义（共享 agent 运行状态）
  //   - 4.6：agent running 窗口内出现的 turn 结束 → 2s 确认窗口（client 上报优先）；
  //         无上报（页面关闭/RPC 失败）→ host 直接写 tray-notify.json（全量兜底）
  //   - 4.7：页面 online/offline 上报 → 全部离线 + 20s 防抖 + 任务空闲 → appExit(0) 官方优雅退出
  try {
    const notifyFile = join(launcherDir, 'tray-notify.json');
    // 关闭语义只对"启动器拉起"的会话生效（launch.cmd 设置 DSH_LAUNCHER=1）：
    // 命令行/npx 手动启动 = 传统服务语义（常驻，关窗不退出），与上方 autoOpen 的
    // DSH_LAUNCHER 判断对称——否则命令行启动时浏览器不自动开、却会在关窗后 20s 自杀，
    // 表现为"输入地址栏打不开"。兜底：从未有客户端 online 则本就不触发退出（安全）。
    const closeToExit = config.closeToExit !== false && process.env.DSH_LAUNCHER === '1';
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
      if (cfg.trayNotify === false) { logMsg(`[tray-notify] suppressed by config (trayNotify=false): ${key}`); return; }
      try {
        writeFileSync(notifyFile, JSON.stringify({ title: String(title).slice(0, 64), body: String(body).slice(0, 256), ts: Date.now() }));
        logMsg(`[tray-notify] queued: ${title} (${key})`);
      } catch (error) {
        logMsg(`[tray-notify] write failed: ${error}`);
      }
    };

    // 关闭语义：无客户端且无任务 → 官方优雅退出（appExit = dsh-cmdline 提供的 exit 回调）
    // 关闭语义计时器：全链路留痕——触发原因 / 20s 到期状态 / 挂起 / 2s 确认 / 取消，
    // 定位"任务刚结束就想重开页面却连不上"这类时序问题只看日志即可。
    const scheduleExitCheck = (reason) => {
      if (exitTimer) {
        logMsg(`[close-to-exit] schedule skipped (already pending, reason=${reason}): clients=${clients.size}, running=${runningCount}`);
        return;
      }
      logMsg(`[close-to-exit] schedule (${reason}): clients=${clients.size}, running=${runningCount}`);
      // 任务在跑 → 立即挂起等待（不设 20s 防抖），任务完成（idle）时唤醒重新计时。
      // 否则任务在 20s 防抖窗口内结束时，20s 到期会直接走 2s 确认退出——
      // 用户重开页面只剩 2s 窗口（bug：任务刚结束就想重开页面会连不上）。
      if (runningCount > 0) {
        waitingForIdle = true;
        logMsg(`[close-to-exit] tasks running (${runningCount}), waiting for idle (no timer)`);
        return;
      }
      logMsg(`[close-to-exit] no tasks, ${debounceSeconds}s debounce started`);
      exitTimer = setTimeout(() => {
        exitTimer = null;
        logMsg(`[close-to-exit] ${debounceSeconds}s elapsed: clients=${clients.size}, running=${runningCount}`);
        if (clients.size > 0) return;
        if (runningCount > 0) {
          waitingForIdle = true;
          logMsg('[close-to-exit] tasks still running, will exit when idle (waiting)');
          return;
        }
        logMsg(`[close-to-exit] idle, starting ${finalConfirmSeconds}s final confirm`);
        // 二次确认（默认 2s，可配）：给"页面重开请求在途"的毫秒级竞态留窗口——
        // 用户在退出瞬间重开前端时，online 请求可能正在路上
        setTimeout(() => {
          if (clients.size > 0 || runningCount > 0) {
            logMsg(`[close-to-exit] client/task reappeared (clients=${clients.size}, running=${runningCount}), exit cancelled`);
            return;
          }
          const appExit = ctx.get('appExit');
          logMsg('[close-to-exit] final confirm passed (clients=0, running=0) -> appExit(0)');
          // traySurvivesDsh=false：优雅退出（appExit）不会连带杀子进程，必须显式清托盘，
          // 否则"托盘随 dsh 退出"的承诺在关窗场景失效（强杀路径 taskkill /T 才会连带）
          if (cfg.traySurvivesDsh === false) {
            logMsg('[close-to-exit] traySurvivesDsh=false -> killing tray before exit');
            killExistingTrays(launcherDir, logMsg);
          }
          if (typeof appExit === 'function') {
            try {
              appExit(0);
            } catch (error) {
              logMsg(`[close-to-exit] appExit call failed: ${error}`);
            }
          } else {
            logMsg('[close-to-exit] appExit service unavailable');
          }
        }, finalConfirmMs);
      }, debounceMs);
    };
    const cancelExit = (reason) => {
      if (exitTimer) {
        clearTimeout(exitTimer);
        exitTimer = null;
        logMsg(`[close-to-exit] exit check cancelled (${reason}): clients=${clients.size}, running=${runningCount}`);
      }
      if (waitingForIdle) {
        waitingForIdle = false;
        logMsg(`[close-to-exit] waitingForIdle cleared (${reason}): clients=${clients.size}, running=${runningCount}`);
      }
    };

    ctx.on('agent/status', (payload) => {
      const status = payload && payload.status;
      if (status === 'running') {
        runningCount += 1;
      } else if (status === 'idle') {
        runningCount = Math.max(0, runningCount - 1);
        if (runningCount === 0) {
          liveTurns.clear();
          if (waitingForIdle && clients.size === 0) scheduleExitCheck('idle-resume');
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
          cancelExit('online');
          clientsOnline = clients.size;
          logMsg(`[close-to-exit] online: ${id} (clients=${clients.size})`);
        } else {
          clients.delete(id);
          clientsOnline = clients.size;
          logMsg(`[close-to-exit] offline: ${id} (clients=${clients.size})`);
          if (clients.size === 0) scheduleExitCheck('offline');
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
    logMsg(`tray-notify/close-to-exit setup failed: ${error}`);
  }

  // 5. 仅当通过快捷方式启动（DSH_LAUNCHER=1）时自动打开浏览器
  if (!autoOpen || process.env.DSH_LAUNCHER !== '1') return;

  // 页面就绪（HTTP GET / 返回 2xx）后再开浏览器——socket 绑定 ≠ 静态资源/fallback 就绪，
  // 过早打开会白屏/进不去（"第一次打不开、点刷新就好"的时序根因）。
  // 超时（15s）则仍尝试打开，不阻塞启动。
  const waitForPageReady = (port, timeoutMs, cb) => {
    const started = Date.now();
    const probe = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) { cb(true); return; }
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) { cb(false); return; }
      setTimeout(probe, 500);
    };
    probe();
  };
  const attempt = () => {
    const port = ctx.get('webServer')?.port;
    if (port === void 0) return false;
    waitForPageReady(port, 15000, (ready) => {
      // 已有页面在线（launch.cmd openLine / 用户已手动打开）→ 不再开浏览器，
      // 避免"先起前端再起后端"的双开（日志实锤：online 早于 auto-open）。
      if (clientsOnline > 0) {
        logMsg(`[auto-open] page already online (clients=${clientsOnline}), skip auto-open`);
        return;
      }
      if (!ready) logMsg('[auto-open] page not ready within 15s, opening anyway');
      else logMsg(`[auto-open] page ready (HTTP 2xx), opening browser (port=${port})`);
      setTimeout(() => openBrowser(port, launcherDir), 200);
    });
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
