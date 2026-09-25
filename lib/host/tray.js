// src/host/io/tray.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
import { spawn, spawnSync } from "node:child_process";

// src/host/core/paths.ts
import { join } from "node:path";
function logsDirOf(launcherDir) {
  return join(launcherDir, "logs");
}

// src/host/io/state.ts
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join as join2 } from "node:path";
function cleanTxt(raw) {
  return raw.replace(/^\uFEFF/, "").trim();
}
var trayStatePath = (dir) => join2(dir, "tray-state.json");
function readTrayState(dir) {
  const jsonPath = trayStatePath(dir);
  try {
    if (existsSync(jsonPath)) {
      const raw = JSON.parse(cleanTxt(readFileSync(jsonPath, "utf-8")));
      if (Number.isInteger(raw.pid) && (raw.pid ?? 0) > 0 && Number.isInteger(raw.scriptVersion)) {
        return { pid: raw.pid, scriptVersion: raw.scriptVersion, startedAt: String(raw.startedAt ?? "") };
      }
    }
  } catch {
  }
  try {
    const pidTxt = join2(dir, "tray-pid.txt");
    const verTxt = join2(dir, "tray-version.txt");
    if (existsSync(pidTxt) && existsSync(verTxt)) {
      const pid = parseInt(cleanTxt(readFileSync(pidTxt, "utf-8")), 10);
      const scriptVersion = parseInt(cleanTxt(readFileSync(verTxt, "utf-8")), 10);
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(scriptVersion)) {
        return { pid, scriptVersion, startedAt: "" };
      }
    }
  } catch {
  }
  return null;
}
function cleanupLegacyTrayTxt(dir) {
  for (const name of ["tray-pid.txt", "tray-version.txt"]) {
    try {
      unlinkSync(join2(dir, name));
    } catch {
    }
  }
}

// src/host/io/tray.ts
var TRAY_SCRIPT_VERSION = 23;
function writeTrayScript(launcherDir, port, iconPath, openScriptPath, appId) {
  const url = `http://127.0.0.1:${String(port)}`;
  const logsDirInline = logsDirOf(launcherDir).replace(/'/g, "''");
  const exitLogInline = join3(logsDirOf(launcherDir), "tray-exit.log").replace(/'/g, "''");
  const pidFileInline = join3(launcherDir, "tray-pid.txt").replace(/'/g, "''");
  const stateFileInline = join3(launcherDir, "tray-state.json").replace(/'/g, "''");
  const ps = [
    // ── 白箱化：第一行先落出生证明，全局 trap 收尸，PID 实名注册 ──
    // 自建日志目录：托盘可能由快捷方式链在 dsh 之前/之后拉起，目录缺失时 Add-Content 会失败
    `$logsDir = '${logsDirInline}'`,
    `try { New-Item -ItemType Directory -Force -Path $logsDir | Out-Null } catch { }`,
    `$exitLogPath = '${exitLogInline}'`,
    // 出生登记：写 tray-state.json（v22 起替代 tray-pid.txt；scriptVersion 编译期已知，
    // mutex 拿到后覆盖写全量防双实例竞态）。WriteAllText 无 BOM（txt 时代的 BOM 污染教训）。
    `try { [IO.File]::WriteAllText('${stateFileInline}', (@{ pid = $PID; scriptVersion = ${TRAY_SCRIPT_VERSION}; startedAt = (Get-Date -Format 'o') } | ConvertTo-Json -Compress)) } catch { }`,
    `try { Add-Content -Path $exitLogPath -Value ('[boot v${TRAY_SCRIPT_VERSION}] pid=' + $PID + ' at ' + (Get-Date -Format 'HH:mm:ss.fff')) -Encoding UTF8 } catch { }`,
    `trap { try { Add-Content -Path $exitLogPath -Value ('[fatal v${TRAY_SCRIPT_VERSION}] pid=' + $PID + ' :: ' + $_.Exception.Message + ' @ ' + $_.InvocationInfo.PositionMessage) -Encoding UTF8 } catch { }; break }`,
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Add-Type -AssemblyName System.Windows.Forms",
    `try { Add-Content -Path $exitLogPath -Value ('[boot] WinForms loaded') -Encoding UTF8 } catch { }`,
    "Add-Type -AssemblyName System.Drawing",
    `try { Add-Content -Path $exitLogPath -Value ('[boot] Drawing loaded') -Encoding UTF8 } catch { }`,
    "",
    "# 单实例保护：命名互斥体（重复拉起自动退出）",
    "# abandoned 容错：旧托盘被强杀后 mutex 会遗留，此时 WaitOne 抛异常，视为可获取",
    "$mutex = New-Object System.Threading.Mutex($false, 'Local\\DshNativeLauncherTray')",
    "$mutexAcquired = $false",
    "try { $mutexAcquired = $mutex.WaitOne(0) } catch { $mutexAcquired = $true }",
    // mutex 被占（另一托盘实例持有）时留痕再退出——否则日志只有 exit 0，无法区分
    // "spawn 失败"与"正常退出"，也无法定位残留托盘（issue: 双击快捷方式无法启动 webUI）。
    `if (-not $mutexAcquired) { try { Add-Content -Path '${join3(logsDirOf(launcherDir), "tray-exit.log").replace(/'/g, "''")}' -Value ('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] mutex not acquired (Local\\DshNativeLauncherTray held), exiting pid=' + $PID) -Encoding UTF8 } catch { }; exit 0 }`,
    `try { Add-Content -Path $exitLogPath -Value ('[boot] mutex acquired by pid=' + $PID) -Encoding UTF8 } catch { }`,
    // 版本标记：拿到互斥体后才写（覆盖写，避免追加累积）；apply 用它做托盘自更新
    "# 版本标记：与 lib/index.js 的 TRAY_SCRIPT_VERSION 一致（apply 用它做托盘自更新）",
    `$trayVersion = ${TRAY_SCRIPT_VERSION}`,
    // mutex 拿到后覆盖写 tray-state.json（出生时已写过一次，此处重写防双实例竞态）
    `try { [IO.File]::WriteAllText('${stateFileInline}', (@{ pid = $PID; scriptVersion = $trayVersion; startedAt = (Get-Date -Format 'o') } | ConvertTo-Json -Compress)) } catch { }`,
    "try { Add-Content -Path $exitLogPath -Value ('[tray started ' + (Get-Date -Format 'HH:mm:ss.fff') + ']') -Encoding UTF8 } catch { }",
    "",
    `$url = '${url}'`,
    // 烘焙 dsh PID：插件与 dsh 同进程，生成时 process.pid 即 dsh 的 PID——退出时精确杀，无需端口反查
    `$dshPid = ${process.pid}`,
    `$icoPath = '${iconPath.replace(/'/g, "''")}'`,
    `$openScript = '${(openScriptPath || join3(launcherDir, "open-webui.ps1")).replace(/'/g, "''")}'`,
    // 退出诊断日志：写入 logs/tray-exit.log（排查"退出 WebUI 未关闭应用窗口"）
    `$exitLogPath = '${exitLogInline}'`,
    "function Log-Exit([string]$msg) {",
    "  try { Add-Content -Path $exitLogPath -Value (('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] ') + $msg) -Encoding UTF8 } catch { }",
    "}",
    // 聚焦已运行的 PWA 窗口（user32）：--app-id / AppsFolder 对已运行应用都会再弹一个窗口，只能聚焦。
    // PID 匹配 + 标题匹配双模式 + AttachThreadInput/Alt 键绕过前台锁。
    `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;public class WinAct { [DllImport("user32.dll")] public static extern bool EnumWindows(WinAct.EnumProc cb, System.IntPtr lp); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid); [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int cmd); [DllImport("user32.dll")] public static extern bool GetWindowText(System.IntPtr h, StringBuilder sb, int max); [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f); [DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra); [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId(); public delegate bool EnumProc(System.IntPtr h, System.IntPtr lp); }' -ErrorAction SilentlyContinue`,
    "function Focus-AppWindow([int]$targetPid, [string]$titleRegex) {",
    "  try {",
    "    if (-not ('WinAct' -as [type])) { Log-Exit 'focus: WinAct type missing'; return $false }",
    "    $script:focused = [IntPtr]::Zero",
    "    $script:scanNote = 'no visible window'",
    "    $cb = [WinAct+EnumProc]{ param($hWnd, $lp)",
    "      if (-not [WinAct]::IsWindowVisible($hWnd)) { return $true }",
    "      $pid2 = 0",
    "      [WinAct]::GetWindowThreadProcessId($hWnd, [ref]$pid2) | Out-Null",
    "      $sb = New-Object System.Text.StringBuilder 512",
    "      [WinAct]::GetWindowText($hWnd, $sb, 512) | Out-Null",
    "      $title = $sb.ToString()",
    "      if ($targetPid -gt 0 -and $pid2 -eq $targetPid) { $script:focused = $hWnd; $script:scanNote = 'pid-match hwnd=' + $hWnd + ' title=[' + $title + ']'; return $false }",
    "      if ($titleRegex -and $title -match $titleRegex) { $script:focused = $hWnd; $script:scanNote = 'title-match hwnd=' + $hWnd + ' title=[' + $title + ']'; return $false }",
    "      return $true",
    "    }",
    "    [WinAct]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null",
    "    Log-Exit ('focus scan: ' + $script:scanNote + ' (pid=' + $targetPid + ' title=/' + $titleRegex + '/)')",
    "    if ($script:focused -eq [IntPtr]::Zero) { return $false }",
    "    [WinAct]::ShowWindow($script:focused, 9) | Out-Null",
    "    [WinAct]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)",
    "    [WinAct]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)",
    "    $cur = [WinAct]::GetCurrentThreadId()",
    "    $tgt = [WinAct]::GetWindowThreadProcessId($script:focused, [ref]0)",
    "    [WinAct]::AttachThreadInput($cur, $tgt, $true) | Out-Null",
    "    [WinAct]::SetForegroundWindow($script:focused) | Out-Null",
    "    [WinAct]::BringWindowToTop($script:focused) | Out-Null",
    "    [WinAct]::SetForegroundWindow($script:focused) | Out-Null",
    "    [WinAct]::AttachThreadInput($cur, $tgt, $false) | Out-Null",
    "    return $true",
    "  } catch { Log-Exit ('focus error: ' + $_.Exception.Message); return $false }",
    "}",
    "",
    "# 图标加载失败用系统图标兜底，保证托盘一定能出现",
    "$icon = $null",
    "try { $icon = New-Object System.Drawing.Icon($icoPath) } catch { }",
    "if (-not $icon) { $icon = [System.Drawing.SystemIcons]::Application }",
    "$notify = New-Object System.Windows.Forms.NotifyIcon",
    "$notify.Icon = $icon",
    "$notify.Text = 'DSH WebUI'",
    "$notify.Visible = $true",
    "",
    "$menu = New-Object System.Windows.Forms.ContextMenuStrip",
    "# 打开 WebUI：应用已在运行 → 聚焦现有窗口（不新开）；未运行 → 启动已装 PWA 应用（AppsFolder），",
    "# 未安装时回退 open-webui.ps1 / 默认浏览器",
    "$openItem = $menu.Items.Add('打开 WebUI')",
    "$openItem.Add_Click({",
    `  $appId = '${(appId || "").replace(/'/g, "''")}'`,
    "  if ($appId) {",
    `    $appProcs = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe' or Name='pwahelper.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and ($_.CommandLine.Contains('--app-id=' + $appId) -or $_.CommandLine -match '--ip-override-url=http://[^/]*:${String(port)}/' -or $_.CommandLine -match '--app=http://[^/]*:${String(port)}') })`,
    "    Log-Exit ('open click: running app procs=' + $appProcs.Count)",
    "    if ($appProcs.Count -gt 0) {",
    "      Log-Exit ('open click: app running PID ' + $appProcs[0].ProcessId + ', focusing...')",
    "      Focus-AppWindow ([int]$appProcs[0].ProcessId) 'DeepSeek Harness|DSH WebUI' | Out-Null",
    "      # 已运行：无论聚焦成败都不再启动（--app-id / AppsFolder 都会弹新窗口）",
    "      return",
    "    }",
    "  }",
    "  Log-Exit 'open click: app not running -> launching'",
    "  $launched = $false",
    "  $bBefore = @(Get-Process msedge,chrome,brave,firefox,pwahelper -ErrorAction SilentlyContinue).Count",
    "  try {",
    "    $shell2 = New-Object -ComObject Shell.Application",
    "    $af = $shell2.Namespace('shell:::{4234d49b-0245-4df3-b780-3893943456e1}')",
    "    if ($af) {",
    "      foreach ($app in $af.Items()) {",
    "        if ($app.Path -like '127.0.0.1-*' -or $app.Path -like 'localhost-*') { Start-Process 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + $app.Path); $launched = $true; break }",
    "      }",
    "    }",
    "  } catch { }",
    "  if ($launched) {",
    "    # 冷启动验证：浏览器已在运行 → 窗口即时激活；完全没起来（explorer 转发可能失败）→ 回退默认打开",
    "    if ($bBefore -gt 0) { return }",
    "    Start-Sleep -Seconds 5",
    "    if ((@(Get-Process msedge,chrome,brave,firefox,pwahelper -ErrorAction SilentlyContinue).Count) -gt 0) { return }",
    "    Start-Process $url",
    "    return",
    "  }",
    "  if (-not $launched) {",
    "    if (Test-Path $openScript) { Start-Process powershell -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $openScript) -WindowStyle Hidden }",
    "    else { Start-Process $url }",
    "  }",
    "})",
    "# 退出 WebUI：彻底退出——停止 DSH 服务 + 关闭浏览器应用窗口（仅 PWA/--app 窗口，",
    "# 普通浏览器标签页不受影响）+ 关闭托盘；全程写 tray-exit.log 诊断日志",
    "$exitItem = $menu.Items.Add('退出 WebUI')",
    `$exitItem.Add_Click({
  $ask = [System.Windows.Forms.MessageBox]::Show('确定退出 DSH WebUI？将停止服务并关闭应用窗口。', 'DSH WebUI', [System.Windows.Forms.MessageBoxButtons]::YesNo)
  if ($ask -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  $appId = '${(appId || "").replace(/'/g, "''")}'
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
    "$notify.ContextMenuStrip = $menu",
    "",
    "# ── 托盘通知（可靠通道）：host 写 tray-notify.json → 轮询 → 原生 Toast ──",
    "# AUMID 注册（桌面 PowerShell 发 Toast 必需；幂等）。用注册表 provider 而非 reg.exe：",
    '# reg.exe 会被部分安全策略程序黑名单拦截（实锤：沙箱"拒绝访问"→ 脚本 fatal），',
    "# PS 原生写注册表零外部进程依赖，语义等价。",
    "New-Item -Path 'HKCU:\\Software\\Classes\\AppUserModelId\\DshNativeLauncher' -Force | Out-Null",
    "Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\AppUserModelId\\DshNativeLauncher' -Name 'DisplayName' -Value 'DSH WebUI'",
    `Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\AppUserModelId\\DshNativeLauncher' -Name 'IconUri' -Value '${join3(launcherDir, "dsh-webui.ico")}'`,
    `# 历史遗留清理：v13 曾实验性注册 dsh-webui: 自定义协议（触发杀软"修改系统默认程序"告警，`,
    `# 已废弃改走官方应用激活）——升级用户可能残留，托盘每次启动静默清一次`,
    `try { Remove-Item 'HKCU:\\Software\\Classes\\dsh-webui' -Recurse -Force -ErrorAction SilentlyContinue } catch { }`,
    `$trayNotifyFile = '${join3(launcherDir, "tray-notify.json").replace(/'/g, "''")}'`,
    `$trayNotifyLog = '${join3(logsDirOf(launcherDir), "tray-notify.log").replace(/'/g, "''")}'`,
    `# ==== E2E-EXTRACT-START（行为测试提取段：Get-ToastLaunchTarget。`,
    `#      提取后只替换日志输出边界为 stdout 独立执行——铁律见 AGENTS.md 测试原则三：`,
    `#      被测链路上的函数禁止 mock；段内调用的函数必须已在段前真实定义。`,
    `#      2026-09-12 v18 教训：段内调用了一个从未定义的留痕函数，真机托盘 fatal`,
    `#      三连死，而 stub 前置的 E2E 依然全绿——测了假脚本） ====`,
    "function Get-ToastLaunchTarget {",
    `  # 点击卡片 = 双击快捷方式的完整链路（2026-09-12 实测定案）：`,
    `  # launch = launcher.vbs 路径 → wscript 零窗口 → launch.cmd（HTTP 探测 → 已有窗口`,
    `  # 聚焦 / 未运行才启动）——防双开逻辑全在 launch.cmd 里，直接复用。`,
    `  # 不用 URL（双开）、不用 AppsFolder 激活（--app-id 已运行弹新窗口）、不注册协议（杀软）。`,
    `  # 实测：launch 直接写文件路径会被系统按关联执行（.vbs → wscript），无黑窗。`,
    `  return '${join3(launcherDir, "launcher.vbs").replace(/'/g, "''")}'`,
    "}",
    `# ==== E2E-EXTRACT-END ====`,
    "function Show-TrayToast([string]$title, [string]$body, [bool]$persistent, [bool]$silent) {",
    "  $err = ''",
    "  try {",
    "    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "  } catch { $err = 'WinRT load failed: ' + $_.Exception.Message }",
    "  if (-not $err) {",
    "    try {",
    "      $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    "      $textNodes = $template.GetElementsByTagName('text')",
    "      $null = $textNodes.Item(0).AppendChild($template.CreateTextNode($title))",
    "      $null = $textNodes.Item(1).AppendChild($template.CreateTextNode($body))",
    "      # launch 值落日志：点击无反应时先查这里（系统侧激活失败无任何报错，日志是唯一线索）。",
    "      # 目标计算在 Get-ToastLaunchTarget（脚本顶层定义）——E2E 提取该函数真执行断言返回值。",
    "      try {",
    "        $toastNode = $template.DocumentElement",
    "        $toastNode.SetAttribute('activationType', 'protocol')",
    "        $launchVal = Get-ToastLaunchTarget",
    "        $toastNode.SetAttribute('launch', $launchVal)",
    `        try { Add-Content -Path $trayNotifyLog -Value (('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] [toast] launch=' + $launchVal)) -Encoding UTF8 } catch { }`,
    "      } catch { }",
    "      if ($persistent) {",
    "        # 「需要手动关闭」（上游 requireInteraction 语义）：Windows 侧对应 scenario='reminder'",
    "        # —— 通知停留在屏幕上直到用户处理",
    "        try {",
    "          $toastNode = $template.DocumentElement",
    "          $toastNode.SetAttribute('scenario', 'reminder')",
    "          $toastNode.SetAttribute('duration', 'long')",
    "        } catch { }",
    "      }",
    "      if ($persistent -or $silent) {",
    "        # 静音联动：常驻通知（reminder 的循环提示音必须关）与自定义/静音音效模式下，",
    "        # Toast 自带提示音也要关——否则系统默认音 + 自定义音叠加成双音（v23 音效链路）",
    "        try {",
    "          $audio = $template.CreateElement('audio')",
    "          $audio.SetAttribute('silent', 'true')",
    "          $null = $template.DocumentElement.AppendChild($audio)",
    "        } catch { }",
    "      }",
    "      $toast = [Windows.UI.Notifications.ToastNotification]::new($template)",
    "      $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DshNativeLauncher')",
    "      $notifier.Show($toast)",
    "      return $true",
    "    } catch { $err = 'toast show failed: ' + $_.Exception.Message }",
    "  }",
    "  try { Add-Content -Path $trayNotifyLog -Value (('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] ') + $err) -Encoding UTF8 } catch { }",
    "  return $false",
    "}",
    "",
    "# ── 自定义通知音效（v23）：载荷 sound 指令（none=静音 / {path}=自定义文件）由 host 投递端写入，──",
    "#    本脚本只负责执行。wav 走 SoundPlayer（Play=线程池异步，零生命周期管理）；mp3/wma 走",
    "#    WPF MediaPlayer（PresentationCore 系统自带）。MediaPlayer 异步播放期间被 GC 会中断——",
    "#    挂 script 级列表保活，只留最近几个（不做 MediaEnded 事件清理：事件回调跑在媒体线程，",
    "#    无运行空间的线程执行 PS 脚本块是未实证行为，不赌）。任何失败只落 tray-notify.log。",
    "$script:soundPlayers = New-Object System.Collections.ArrayList",
    "function Play-NotifySound([string]$path) {",
    "  try {",
    "    if ([string]::IsNullOrWhiteSpace($path)) { return }",
    "    if (-not (Test-Path -LiteralPath $path)) {",
    "      try { Add-Content -Path $trayNotifyLog -Value (('[sound] file not found: ') + $path) -Encoding UTF8 } catch { }",
    "      return",
    "    }",
    "    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()",
    "    if ($ext -eq '.wav') {",
    "      try { (New-Object System.Media.SoundPlayer $path).Play(); try { Add-Content -Path $trayNotifyLog -Value (('[sound] playing (wav): ') + $path) -Encoding UTF8 } catch { } } catch { try { Add-Content -Path $trayNotifyLog -Value (('[sound] wav play failed: ') + $_.Exception.Message) -Encoding UTF8 } catch { } }",
    "      return",
    "    }",
    "    try { Add-Type -AssemblyName PresentationCore } catch { }",
    "    try {",
    "      $player = New-Object System.Windows.Media.MediaPlayer",
    "      $player.Open([System.Uri]::new($path))",
    "      $null = $script:soundPlayers.Add($player)",
    "      # 保活列表只留最近 8 个：最旧的 Close 并释放引用（正在播的会被掐断，仅出现在",
    "      # 极端连发场景；通知音被新通知顶掉本就是合理语义）",
    "      while ($script:soundPlayers.Count -gt 8) {",
    "        try { $script:soundPlayers[0].Close() } catch { }",
    "        $script:soundPlayers.RemoveAt(0)",
    "      }",
    "      $player.Play()",
    "      try { Add-Content -Path $trayNotifyLog -Value (('[sound] playing (media): ') + $path) -Encoding UTF8 } catch { }",
    "    } catch { try { Add-Content -Path $trayNotifyLog -Value (('[sound] media play failed: ') + $_.Exception.Message) -Encoding UTF8 } catch { } }",
    "  } catch { }",
    "}",
    "# ==== MAIN-LOOP-START（此后为 WinForms 启动与消息循环——E2E 引用完整性守卫在此截断，",
    "#      dot-source 截断版后用真实 PowerShell Get-Command 校验全文每个函数调用都有定义，",
    "#      臆造函数（v18 的 Log-Notify）不再是语法错误、只有运行时才炸——必须这样抓） ====",
    "# 启动清理：上次强杀（退出 WebUI / 断电）残留的通知不补弹——否则每次重启都会弹'上次任务结束'",
    "Remove-Item $trayNotifyFile -Force -ErrorAction SilentlyContinue",
    "$notifyTimer = New-Object System.Windows.Forms.Timer",
    "$notifyTimer.Interval = 1500",
    "$notifyTimer.Add_Tick({",
    "  try {",
    "    if (-not (Test-Path $trayNotifyFile)) { return }",
    "    $j = $null",
    "    try { $j = Get-Content $trayNotifyFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }",
    "    if ($j) {",
    "      $t = [string]$j.title; $b = [string]$j.body",
    "      $p = [bool]$j.persistent",
    "      # 音效指令解析（v23）：'none'=静音；{path}=静音+播自定义音；缺省/其他形状=系统默认音。",
    "      # 文件可能被手改（形状不可信）：只认两种白名单形状，其余一律按系统默认处理。",
    "      $soundMode = 'default'",
    "      $soundPath = ''",
    "      try {",
    "      if ($j.sound -eq 'none') { $soundMode = 'none' }",
    "      elseif ($j.sound -and $j.sound.path) { $soundMode = 'custom'; $soundPath = [string]$j.sound.path }",
    "      } catch { }",
    "      try { Add-Content -Path $trayNotifyLog -Value (('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] [toast] consuming: ' + $t + $(if ($p) { ' (persistent)' } else { '' }) + $(if ($soundMode -ne 'default') { ' (sound=' + $soundMode + ')' } else { '' })) -replace '\\r\\n', ' ' ) -Encoding UTF8 } catch { }",
    '      # 自定义音在 Toast 之前播：声先于弹更符合"提醒"直觉，且 Toast 静音联动已关系统音',
    "      if ($soundMode -eq 'custom') { Play-NotifySound $soundPath }",
    "      $ok = $false",
    "      try { $ok = Show-TrayToast $t $b $p ($soundMode -ne 'default') } catch { }",
    "      if ($ok) {",
    "        try { Add-Content -Path $trayNotifyLog -Value (('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] [toast] native shown')) -Encoding UTF8 } catch { }",
    "      }",
    "      if (-not $ok) {",
    "        # Toast 失败兜底：BalloonTip（各自 try/catch，异常不得杀死消息循环）",
    "        try { $notify.ShowBalloonTip(6000, $t, $b, [System.Windows.Forms.ToolTipIcon]::Info); try { Add-Content -Path $trayNotifyLog -Value (('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] [toast] balloon fallback')) -Encoding UTF8 } catch { } } catch { }",
    "        # 兜底音只在系统默认音模式下响（none=用户要求静音；custom 已播过自定义音，不叠系统音）",
    "        if ($soundMode -eq 'default') { try { [System.Media.SystemSounds]::Exclamation.Play() } catch { } }",
    "      }",
    "    } else {",
    "      try { Add-Content -Path $trayNotifyLog -Value (('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] [toast] json parse failed')) -Encoding UTF8 } catch { }",
    "    }",
    "    Remove-Item $trayNotifyFile -Force -ErrorAction SilentlyContinue",
    "    if (Test-Path $trayNotifyFile) { try { Add-Content -Path $trayNotifyLog -Value (('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] [toast] WARNING: json remove failed')) -Encoding UTF8 } catch { } }",
    "  } catch {",
    "    # 任何 tick 异常都只记日志，绝不终止消息循环（否则托盘消失）",
    "    try { Add-Content -Path $trayNotifyLog -Value (('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] tick error: ') + $_.Exception.Message) -Encoding UTF8 } catch { }",
    "  }",
    "})",
    "$notifyTimer.Start()",
    "",
    "[System.Windows.Forms.Application]::Run()",
    // 退出路径留痕：区分"mutex 未获取退出"与"消息循环正常结束退出"，日志不再只有 exit 0
    "try { Log-Exit 'message loop ended (tray exiting normally)' } catch { }"
  ].join("\r\n");
  writeFileSync2(join3(launcherDir, "tray.ps1"), "\uFEFF" + ps, "utf-8");
}
function buildTrayProbeCmd(launcherDir) {
  return [
    `Get-CimInstance Win32_Process -Filter "Name='powershell.exe' or Name='pwsh.exe'" -ErrorAction SilentlyContinue |`,
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
    "Measure-Object | Select-Object -ExpandProperty Count"
  ].join(" ");
}
function killExistingTrays(launcherDir, logMsg) {
  let registeredPid = null;
  try {
    const state = readTrayState(launcherDir);
    if (state) registeredPid = state.pid;
  } catch {
  }
  try {
    if (registeredPid !== null && registeredPid > 0) {
      spawnSync("taskkill", ["/PID", String(registeredPid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 8e3 });
      logMsg(`[tray] killed registered tray-pid ${registeredPid} (from tray-state)`);
    }
  } catch {
  }
  if (registeredPid !== null) {
    try {
      if (existsSync2(join3(launcherDir, "tray-state.json"))) cleanupLegacyTrayTxt(launcherDir);
    } catch {
    }
  }
  const killCmd = [
    `Get-CimInstance Win32_Process -Filter "Name='powershell.exe' or Name='pwsh.exe'" -ErrorAction SilentlyContinue |`,
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; 'killed:' + $_.ProcessId }"
  ].join(" ");
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", killCmd], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 1e4
  });
  const out = String(result.stdout ?? "").trim();
  try {
    spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Milliseconds 2000"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 6e3
    });
  } catch {
  }
  logMsg(`[tray] sweep kill result: ${out || "(none)"} exit=${result.status}`);
  return out;
}
function startTrayProcess(launcherDir, trayPath, preferPersistent, logMsg, logWarn, logFail) {
  const probeCmd = buildTrayProbeCmd(launcherDir);
  const probeAlive = (cb) => {
    const probe = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", probeCmd], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let out = "";
    probe.stdout?.on("data", (chunk) => {
      out = String(out + chunk).slice(-2e3);
    });
    probe.on("close", () => cb(parseInt(String(out).trim(), 10) > 0));
  };
  const modeLabel = preferPersistent ? "persistent (wscript first)" : "with-dsh (direct first)";
  logMsg(`startTrayProcess: mode=${modeLabel}, trayPath=${trayPath}`);
  const exitLogTail = () => {
    try {
      return readFileSync2(join3(logsDirOf(launcherDir), "tray-exit.log"), "utf-8").trim().split(/\r?\n/).slice(-3).join(" || ");
    } catch {
      return "(no tray-exit.log)";
    }
  };
  const spawnTray = (attempt) => {
    if (attempt > 3) {
      logFail(`[tray] spawn FAILED after ${attempt - 1} attempts. tray-exit tail: ${exitLogTail()}`);
      return;
    }
    const useWscript = preferPersistent ? attempt === 1 : attempt !== 1;
    if (useWscript) {
      const runCmd = `(New-Object -ComObject WScript.Shell).Run('powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${trayPath.replace(/'/g, "''")}"', 0, $false)`;
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", runCmd],
        { stdio: "ignore", windowsHide: true }
      );
      child.unref();
      child.on("exit", (code, signal) => {
        logMsg(`tray attempt ${attempt} (wscript run, ${modeLabel}) launcher exited code=${code} signal=${String(signal)}`);
      });
    } else {
      const child = spawn(
        "powershell",
        ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", trayPath],
        { stdio: "ignore", windowsHide: true }
      );
      child.unref();
      child.on("exit", (code, signal) => {
        logMsg(`tray attempt ${attempt} (direct spawn, ${modeLabel}) exited code=${code} signal=${String(signal)} (stdio=ignore; see tray-exit.log for script-level reason)`);
      });
    }
    setTimeout(() => {
      probeAlive((alive) => {
        if (alive) {
          let pidNote = "";
          try {
            const pf = join3(launcherDir, "tray-pid.txt");
            if (existsSync2(pf)) {
              const tp = parseInt(readFileSync2(pf, "utf-8").trim(), 10);
              const proc = Number.isInteger(tp) && tp > 0 ? spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${tp} -ErrorAction SilentlyContinue) -ne $null`], { encoding: "utf8", windowsHide: true, timeout: 8e3 }) : null;
              const isUp = String(proc?.stdout ?? "").trim() === "True";
              pidNote = `, registered tray-pid=${tp} alive=${isUp}`;
            } else {
              pidNote = ", no tray-pid.txt (pre-v7 tray?)";
            }
          } catch {
          }
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
export {
  TRAY_SCRIPT_VERSION,
  buildTrayProbeCmd,
  killExistingTrays,
  startTrayProcess,
  writeTrayScript
};
