<#
dsh-native-launcher tray regression test (reusable)

End-to-end tray lifecycle verification:
  S1  dsh start -> tray spawned, alive, hidden (no visible window),
      launch.cmd no longer spawns the tray itself
  S2  WebUI windows closed (close-to-exit) -> dsh exits, tray SURVIVES
  S3  tray "exit WebUI" menu (UIA) -> browser app windows + dsh + tray all gone
Then self-heals: restarts dsh via launch.cmd so the WebUI comes back.

WARNING: this script KILLS the running dsh instance and closes this site's
PWA/app browser windows (it never touches ordinary browser tabs or the main
browser window), then restarts dsh. The WebUI is unreachable for ~3-4 min.
Designed to be started detached from dsh (e.g. Start-Process) so it keeps
running through the dsh restart cycle.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\test-tray-regression.ps1
  powershell ... -File tools\test-tray-regression.ps1 -Port 3080 -ResultLog D:\tmp\tray-test.log
  powershell ... -File tools\test-tray-regression.ps1 -SkipHeal   # leave dsh down at the end

Parameters:
  -LauncherDir  launcher working dir (default $env:USERPROFILE\.dsh-webui-launcher)
  -Port         WebUI port (default 3080)
  -AppId        installed PWA app id (default: auto-detected from tray.ps1 / pwa-scan.log)
  -ResultLog    results file (default <LauncherDir>\test-results.log)
  -SkipHeal     do not restart dsh at the end (for manual follow-up)

Evidence: result log + <LauncherDir>\launch.log / tray-exit.log / native-launcher.log.
Exit code 0 = all scenarios passed; 1 = failure/abort.
#>
param(
  [string]$LauncherDir = (Join-Path $env:USERPROFILE '.dsh-webui-launcher'),
  [int]$Port = 3080,
  [string]$AppId = '',
  [string]$ResultLog = '',
  [switch]$SkipHeal
)
$ErrorActionPreference = 'Continue'
if (-not $ResultLog) { $ResultLog = Join-Path $LauncherDir 'test-results.log' }
$Url = 'http://127.0.0.1:' + $Port + '/'
$CH_YES  = [string][char]0x662F                                          # 是
$CH_EXIT = [string][char]0x9000 + [string][char]0x51FA + ' WebUI'        # 退出 WebUI
$CH_SHOW = [string][char]0x663E + [string][char]0x793A + [string][char]0x9690 + [string][char]0x85CF + [string][char]0x7684 + [string][char]0x56FE + [string][char]0x6807  # 显示隐藏的图标

# auto-detect PWA app id
if (-not $AppId) {
  $trayPs1 = Join-Path $LauncherDir 'tray.ps1'
  if (Test-Path $trayPs1) {
    $m = [regex]::Match((Get-Content $trayPs1 -Raw -Encoding UTF8), '\$appId = ''([^'']+)''')
    if ($m.Success) { $AppId = $m.Groups[1].Value }
  }
  if (-not $AppId) {
    $scan = Join-Path $LauncherDir 'pwa-scan.log'
    if (Test-Path $scan) {
      $m2 = [regex]::Match((Get-Content $scan -Raw -Encoding UTF8), 'FOUND app_id=([a-z0-9]+)')
      if ($m2.Success) { $AppId = $m2.Groups[1].Value }
    }
  }
}

function Log([string]$m) {
  $line = '[' + (Get-Date -Format 'HH:mm:ss.fff') + '] ' + $m
  Add-Content -Path $ResultLog -Value $line -Encoding UTF8
}
function LogRaw([string[]]$lines) { foreach ($l in $lines) { if ($l) { Log ('    ' + $l) } } }
function Test-DshUp {
  try { $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2; return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) } catch { return $false }
}
function Get-DshPid {
  # 匹配任意监听地址上的目标端口（dsh 可能绑 0.0.0.0 或 127.0.0.1）
  $line = netstat -ano | Select-String 'LISTENING' | Select-String (':' + $Port)
  if ($line) { $parts = $line -split '\s+'; return $parts[$parts.Length - 1] }
  return ''
}
function Test-TrayMutexHeld {
  # true = tray mutex owned (tray alive); false = free/abandoned
  try {
    $m = New-Object System.Threading.Mutex($false, 'Local\DshNativeLauncherTray')
    $acquired = $m.WaitOne(0)
    if ($acquired) { try { $m.ReleaseMutex() } catch { } }
    return (-not $acquired)
  } catch { return $false }
}
function Get-TrayProcs {
  $rows = @()
  try {
    $rows = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains($LauncherDir) })
  } catch { Log ('CIM tray scan failed: ' + $_.Exception.Message) }
  return $rows
}
function Get-AppBrowserProcs {
  # this site's PWA/app windows only (msedge --app / pwahelper --app-id / --ip-override-url on $Port)
  $rows = @()
  try {
    $rows = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe' or Name='pwahelper.exe'" -ErrorAction Stop | Where-Object {
      $cl = $_.CommandLine
      if (-not $cl) { return $false }
      ($AppId -ne '' -and $cl.Contains('--app-id=' + $AppId)) -or ($cl -match ('--ip-override-url=http://[^/]*:' + $Port + '/')) -or ($cl -match ('--app=http://[^/]*:' + $Port))
    })
  } catch { Log ('CIM browser scan failed: ' + $_.Exception.Message) }
  return $rows
}
function Wait-DshDown([int]$seconds, [string]$targetPid) {
  # targetPid: 等待「这个 dsh 进程」退出（默认空 = 只等端口空）。
  # 必须盯 PID 而不是端口：用户/其他途径可能提前拉起新 dsh，端口一直有监听。
  $deadline = (Get-Date).AddSeconds($seconds)
  $hb = (Get-Date)
  while ((Get-Date) -lt $deadline) {
    if ($targetPid -ne '') {
      if (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) { return $true }
    } elseif (-not (Test-DshUp) -and (Get-DshPid) -eq '') {
      return $true
    }
    if ((Get-Date) -gt $hb) { Log ('hb waiting for dsh down (remaining ' + [int]($deadline - (Get-Date)).TotalSeconds + 's)'); $hb = (Get-Date).AddSeconds(20) }
    Start-Sleep -Seconds 2
  }
  if ($targetPid -ne '') { return -not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) }
  return (-not (Test-DshUp)) -and ((Get-DshPid) -eq '')
}
function Wait-DshUp([int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  $hb = (Get-Date)
  while ((Get-Date) -lt $deadline) {
    if (Test-DshUp) { return $true }
    if ((Get-Date) -gt $hb) { Log ('hb waiting for dsh up (remaining ' + [int]($deadline - (Get-Date)).TotalSeconds + 's)'); $hb = (Get-Date).AddSeconds(20) }
    Start-Sleep -Seconds 2
  }
  return (Test-DshUp)
}
function Start-Launcher {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', (Join-Path $LauncherDir 'launch.cmd') -WindowStyle Hidden
  Log 'launch.cmd started (async)'
}
function NewLines([string]$path, [int]$baseline) {
  if (-not (Test-Path $path)) { return @() }
  $all = @(Get-Content $path -Encoding UTF8)
  if ($all.Count -le $baseline) { return @() }
  return @($all | Select-Object -Skip $baseline)
}
function Invoke-TrayExitItem {
  # UIA: right-click tray icon -> 退出 WebUI -> Yes. Returns $true on confirm.
  try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
  } catch { Log ('UIA assemblies failed: ' + $_.Exception.Message); return $false }
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $nameCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'DSH WebUI')
    $btn = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nameCond)
    if (-not $btn) {
      Log 'UIA: tray button not found by name; trying overflow chevron'
      $chevCond = New-Object System.Windows.Automation.OrCondition(
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $CH_SHOW)),
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Show hidden icons')))
      $chev = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $chevCond)
      if ($chev) {
        Log 'UIA: overflow chevron found, invoking'
        $ci = $chev.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $ci.Invoke()
        Start-Sleep -Seconds 1
        $btn = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nameCond)
      }
    }
    if (-not $btn) { Log 'UIA: tray button not found (DSH WebUI)'; return $false }
    Log ('UIA: tray button found (class=' + $btn.Current.ClassName + '), invoking')
    $invoke = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    Start-Sleep -Milliseconds 900
    $menuCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $CH_EXIT)
    $item = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $menuCond)
    if (-not $item) { Log 'UIA: menu item not found'; return $false }
    Log ('UIA: menu item found (' + $item.Current.ControlType.ProgrammaticName + '), invoking')
    $mi = $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $mi.Invoke()
    Start-Sleep -Milliseconds 900
    $btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
    $yesPattern = '(' + $CH_YES + '|Yes)'
    foreach ($b in $buttons) {
      $n = $b.Current.Name
      Log ('UIA: dialog button [' + $n + ']')
      if ($n -match $yesPattern) {
        $bi = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $bi.Invoke()
        Log 'UIA: clicked Yes on confirm dialog'
        return $true
      }
    }
    Log 'UIA: confirm dialog Yes button not found'
    return $false
  } catch {
    Log ('UIA error: ' + $_.Exception.Message)
    return $false
  }
}

# ---------------- main ----------------
$s1Result = 'FAIL'; $s2Result = 'FAIL'; $s3Result = 'FAIL'; $healed = 'no'
$trayLogPath = Join-Path $LauncherDir 'tray-exit.log'
$nlLogPath = Join-Path $LauncherDir 'native-launcher.log'
$trayBase = 0; $nlBase = 0
if (Test-Path $trayLogPath) { $trayBase = @(Get-Content $trayLogPath -Encoding UTF8).Count }
if (Test-Path $nlLogPath) { $nlBase = @(Get-Content $nlLogPath -Encoding UTF8).Count }

# ---- 预检：launch.cmd 必须是新代码产物（不含托盘行）----
$launchCmdRaw = Get-Content (Join-Path $LauncherDir 'launch.cmd') -Raw -ErrorAction SilentlyContinue
if ($launchCmdRaw -and $launchCmdRaw.Contains('tray.ps1')) {
  Log 'FATAL: launch.cmd still contains the tray spawn line (stale generator output).'
  Log '       Restart dsh once with the new plugin code so apply() regenerates launch.cmd, then re-run.'
  Log '=== SUMMARY (aborted: stale launch.cmd) ==='
  exit 1
}
Log 'precheck: launch.cmd has no tray line (new code)'

Log '=================================================='
Log ('tray regression test start (port=' + $Port + ' appId=' + $AppId + ')')
Log ('launcherDir=' + $LauncherDir)
Log ('resultLog=' + $ResultLog)
Log ('pre: dshUp=' + (Test-DshUp) + ' dshPid=' + (Get-DshPid) + ' trayMutex=' + (Test-TrayMutexHeld) + ' trayProcs=' + @(Get-TrayProcs).Count)
Log 'grace 30s (heads-up window), then killing current dsh...'
Start-Sleep -Seconds 30

# ---- Phase 0: cleanup stale trays + current dsh ----
foreach ($t in @(Get-TrayProcs)) { Log ('kill stale tray PID ' + $t.ProcessId); taskkill /PID $t.ProcessId /T /F | Out-Null }
$dpid = Get-DshPid
if ($dpid -ne '') { Log ('kill current dsh PID ' + $dpid); taskkill /PID $dpid /T /F | Out-Null }
Start-Sleep -Seconds 6
Log ('post-kill: dshUp=' + (Test-DshUp) + ' dshPid=[' + (Get-DshPid) + '] trayMutex=' + (Test-TrayMutexHeld) + ' trayProcs=' + @(Get-TrayProcs).Count)
# 杀完托盘后必须确认 mutex 已释放（否则新托盘 spawn 会 'mutex not acquired' 3 连败）
$mdeadline = (Get-Date).AddSeconds(10)
while ((Test-TrayMutexHeld) -and (Get-Date) -lt $mdeadline) {
  Log 'mutex still held after tray kill, waiting for release...'
  Start-Sleep -Seconds 2
}
if (Test-TrayMutexHeld) {
  Log 'FATAL: tray mutex still held after cleanup (stale tray process not killable?)'
  Log '=== SUMMARY (aborted: mutex held) ==='
  exit 1
}
Log 'mutex released after cleanup'

# ---- Phase 1: start dsh via launch.cmd ----
Start-Launcher
if (-not (Wait-DshUp 120)) {
  Log 'FATAL: dsh did not come up after launch.cmd'
  Log 'S1: FAIL (dsh not up)'; Log 'S2: SKIP'; Log 'S3: SKIP'; Log ('HEALED: ' + $healed)
  Log '=== SUMMARY (aborted) ==='
  Log '=== tray regression test end ==='
  exit 1
}
Log ('dsh up after restart: pid=' + (Get-DshPid))
Start-Sleep -Seconds 12   # apply tray spawn + autoOpen PWA window

# ---- S1: tray spawned and alive ----
$mutex1 = Test-TrayMutexHeld
$trays1 = @(Get-TrayProcs)
$verFile = Get-Content (Join-Path $LauncherDir 'tray-version.txt') -ErrorAction SilentlyContinue
$startedNew = @(NewLines $trayLogPath $trayBase | Where-Object { $_ -match 'tray started' })
$nlNew = @(NewLines $nlLogPath $nlBase | Where-Object { $_ -match 'tray|spawn' })
$launchCmd = Get-Content (Join-Path $LauncherDir 'launch.cmd') -Raw
$winTitle = ''; $trayPid = 0
if ($trays1.Count -gt 0) {
  $trayPid = $trays1[0].ProcessId
  $tp = Get-Process -Id $trayPid -ErrorAction SilentlyContinue
  if ($tp) { $winTitle = $tp.MainWindowTitle }
}
Log '--- S1 evidence ---'
Log ('tray mutex held: ' + $mutex1)
Log ('tray procs: ' + $trays1.Count + ' (pid ' + $trayPid + ', MainWindowTitle=[' + $winTitle + '])')
Log ('tray-version.txt: ' + ($verFile -join ''))
Log ('new [tray started] lines: ' + $startedNew.Count)
LogRaw $nlNew
Log ('launch.cmd contains tray.ps1: ' + $launchCmd.Contains('tray.ps1'))
if ($mutex1 -and $trays1.Count -gt 0 -and (-not $launchCmd.Contains('tray.ps1')) -and $winTitle -eq '' -and $startedNew.Count -gt 0) { $s1Result = 'PASS' }
Log ('S1: ' + $s1Result)

# ---- S2: close browser app window -> close-to-exit -> tray must survive ----
$apps = @(Get-AppBrowserProcs)
Log ('S2: app browser windows found: ' + $apps.Count)
foreach ($a in $apps) { Log ('S2: closing browser PID ' + $a.ProcessId); taskkill /PID $a.ProcessId /T /F | Out-Null }
if ($apps.Count -eq 0) {
  Log 'S2: no app window yet, waiting 30s more for PWA boot'
  Start-Sleep -Seconds 30
  $apps = @(Get-AppBrowserProcs)
  foreach ($a in $apps) { Log ('S2: closing browser PID ' + $a.ProcessId); taskkill /PID $a.ProcessId /T /F | Out-Null }
}
Start-Sleep -Seconds 5
$s2DshPid = Get-DshPid
Log ('S2: watching dsh pid=' + $s2DshPid + ' (waiting up to 240s; long tasks extend close-to-exit)')
$down = Wait-DshDown 240 $s2DshPid
Log ('S2: dsh ' + $s2DshPid + ' exited after closing window: ' + $down)
if ($down) {
  $ceNew = @(NewLines $nlLogPath $nlBase | Where-Object { $_ -match 'close-to-exit|appExit' })
  Log '--- S2 close-to-exit log lines ---'
  LogRaw $ceNew
  $mutex2 = Test-TrayMutexHeld
  $trays2 = @(Get-TrayProcs)
  $loopEnd = @(NewLines $trayLogPath $trayBase | Where-Object { $_ -match 'message loop ended' })
  Log ('S2: tray mutex=' + $mutex2 + ' procs=' + $trays2.Count + ' newLoopEndedLines=' + $loopEnd.Count)
  if ($mutex2 -and $trays2.Count -gt 0 -and $loopEnd.Count -eq 0) { $s2Result = 'PASS' }
  Log ('S2: ' + $s2Result)
} else {
  Log 'S2: close-to-exit did NOT fire within 150s (extra client likely reconnected)'
  $dpid2 = Get-DshPid
  if ($dpid2 -ne '') { Log ('S2 fallback: force-kill dsh PID ' + $dpid2); taskkill /PID $dpid2 /T /F | Out-Null }
  Start-Sleep -Seconds 5
  $mutex2 = Test-TrayMutexHeld
  $trays2 = @(Get-TrayProcs)
  Log ('S2 fallback: dshUp=' + (Test-DshUp) + ' tray mutex=' + $mutex2 + ' procs=' + $trays2.Count)
  if ($mutex2 -and $trays2.Count -gt 0) { $s2Result = 'PARTIAL (tray survives dsh death; close-to-exit trigger blocked by extra client - needs manual re-check)' }
  Log ('S2: ' + $s2Result)
}

# ---- S3: tray 退出 WebUI via UIA ----
$uiaOk = Invoke-TrayExitItem
Log ('S3: UIA click result=' + $uiaOk)
Start-Sleep -Seconds 8
$trays3 = @(Get-TrayProcs)
$mutex3 = Test-TrayMutexHeld
$exitNew = @(NewLines $trayLogPath $trayBase | Where-Object { $_ -match 'exit click|kill targets|dsh stopped|message loop ended|remaining browser' })
Log '--- S3 tray-exit.log new lines ---'
LogRaw $exitNew
Log ('S3: tray procs=' + $trays3.Count + ' mutex=' + $mutex3 + ' dshUp=' + (Test-DshUp))
if ($uiaOk -and $trays3.Count -eq 0 -and (-not $mutex3) -and (-not (Test-DshUp)) -and $exitNew.Count -gt 0) { $s3Result = 'PASS' }
elseif ($uiaOk) { $s3Result = 'FAIL (click confirmed but final state wrong)' }
else { $s3Result = 'PARTIAL (UIA click failed; manual tray click needed)' }
Log ('S3: ' + $s3Result)

# ---- Phase 4: self-heal ----
if ($SkipHeal) {
  Log 'HEAL: skipped (-SkipHeal)'
} else {
  Log 'HEAL: restarting dsh...'
  Start-Launcher
  if (Wait-DshUp 120) {
    Start-Sleep -Seconds 10
    $mh = Test-TrayMutexHeld
    Log ('HEAL: dshUp=' + (Test-DshUp) + ' pid=' + (Get-DshPid) + ' trayMutex=' + $mh)
    if ($mh) { $healed = 'yes' }
  } else {
    Log 'HEAL: dsh did not come up!'
  }
}
Log ('HEALED: ' + $healed)

Log '=== SUMMARY ==='
Log ('S1: ' + $s1Result)
Log ('S2: ' + $s2Result)
Log ('S3: ' + $s3Result)
Log ('HEALED: ' + $healed)
Log '=== tray regression test end ==='
if ($s1Result -eq 'PASS' -and $s2Result -eq 'PASS' -and $s3Result -eq 'PASS') { exit 0 } else { exit 1 }
