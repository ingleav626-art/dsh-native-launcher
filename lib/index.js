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

export const name = 'native-launcher';
export const inject = ['webServer', 'connection'];

/** 本包内的图标资源（复制到用户目录后作为快捷方式图标）。 */
const ICON_RESOURCE = fileURLToPath(new URL('../assets/dsh-webui.ico', import.meta.url));

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
          '  if ($m.Success) { Start-Process $m.Groups[1].Value -ArgumentList @("--app-id=$appId"); exit 0 }',
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
    "      Start-Process 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + $appItem.Path); exit 0",
    '    }',
    '  }',
    '  # 名字匹配兜底（用户可能改了 PWA 显示名，但 AUMID 前缀匹配失败时仍有希望）。',
    '  # 防误伤：必须同时满足 AUMID 站点指纹前缀（127.0.0.1-*）——名字相同但 AUMID 非本站',
    '  # 的应用（如桌面版 "DeepSeek Harness"，AUMID ai.deepseek.harness.desktop）绝不启动，',
    '  # 否则会拉起桌面版 exe 抢 3080 端口导致 EADDRINUSE。PWA 改名字不影响 AUMID。',
    `  $primaryAppName = '${lnkBase.replace(/'/g, "''")}'`,
    '  foreach ($appItem in $appsFolder.Items()) {',
    '    if ($appItem.Name -eq $primaryAppName -and $appItem.Path -like "$hostFingerprint*") {',
    "      Start-Process 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + $appItem.Path); exit 0",
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
    "      if ($t0 -match 'msedge|chrome') { Start-Process $lnk; exit 0 }",
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
    "      if (($t -match 'msedge|chrome') -and $s.Arguments -match '--app-id=') { Start-Process $lnk.FullName; exit 0 }",
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
    '        if ($m.Success) { Start-Process $m.Groups[1].Value -ArgumentList @("--app-id=$appId"); exit 0 }',
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
    "        Start-Process $exe -ArgumentList @(\"--app=$url\"); exit 0",
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

/** 生成托盘脚本（PowerShell + WinForms NotifyIcon，系统自带零依赖；单实例互斥 + 停止二次确认）。 */
function writeTrayScript(launcherDir, port, iconPath) {
  const url = `http://127.0.0.1:${String(port)}`;
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '',
    "# 单实例保护：命名互斥体（重复拉起自动退出）",
    "$mutex = New-Object System.Threading.Mutex($false, 'Local\\DshNativeLauncherTray')",
    'if (-not $mutex.WaitOne(0)) { exit 0 }',
    '',
    `$url = '${url}'`,
    `$icoPath = '${iconPath.replace(/'/g, "''")}'`,
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
    "$openItem = $menu.Items.Add('打开 WebUI')",
    '$openItem.Add_Click({ Start-Process $url })',
    "$stopItem = $menu.Items.Add('停止 DSH')",
    `$stopItem.Add_Click({ $line = netstat -ano | Select-String 'LISTENING' | Select-String '0.0.0.0:${String(port)}'; if ($line) { $dpid = ($line -split '\\s+')[-1]; if ([System.Windows.Forms.MessageBox]::Show(\"停止 DSH 服务？(PID $dpid)\", 'DSH WebUI', [System.Windows.Forms.MessageBoxButtons]::OKCancel) -eq 'OK') { taskkill /PID $dpid /T /F | Out-Null } } })`,
    "$exitItem = $menu.Items.Add('退出托盘')",
    '$exitItem.Add_Click({ $notify.Visible = $false; $mutex.ReleaseMutex(); [System.Windows.Forms.Application]::Exit(); exit 0 })',
    '$notify.ContextMenuStrip = $menu',
    '',
    '# ── 任务通知：轮询 notify.json（host 在 agent/status running→idle 时写入），托盘气泡提醒 ──',
    `$notifyPath = '${join(launcherDir, 'notify.json').replace(/'/g, "''")}'`,
    '$lastNotifyRaw = ""',
    '$taskTimer = New-Object System.Windows.Forms.Timer',
    '$taskTimer.Interval = 2000',
    '$taskTimer.Add_Tick({',
    '  $raw = ""',
    '  if (Test-Path $notifyPath) { $raw = (Get-Content $notifyPath -Raw -ErrorAction SilentlyContinue) }',
    '  if ($raw -and $raw -ne $lastNotifyRaw) {',
    '    $lastNotifyRaw = $raw',
    '    try {',
    '      $j = $raw | ConvertFrom-Json',
    "      $msg = if ($j.kind -eq 'error') { \"会话 $($j.sessionId) 出错\" } else { \"会话 $($j.sessionId) 已完成\" }",
    '      $notify.ShowBalloonTip(6000, "DSH 任务通知", $msg, [System.Windows.Forms.ToolTipIcon]::Info)',
    '    } catch { }',
    '  }',
    '})',
    '$taskTimer.Start()',
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
      console.error('[native-launcher] icon copied/updated');
    }
    return target;
  } catch (error) {
    console.error(`[native-launcher] icon copy failed: ${error}`);
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
        console.error(`[native-launcher] shortcut already exists and points to current vbs + icon, skipping: ${lnk}`);
        return;
      }
      console.error(`[native-launcher] shortcut exists but points elsewhere or icon changed, recreating: ${lnk}`);
    } catch {
      // 读失败（权限/损坏）→ 保守重建
      console.error(`[native-launcher] shortcut unreadable, recreating: ${lnk}`);
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
    console.error(`[native-launcher] shortcut created: ${lnk}`);
  } catch (error) {
    console.error(`[native-launcher] shortcut creation failed: ${error}`);
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
      console.error('[native-launcher] square icon generated (256x256)');
      return readFileSync(outPath);
    }
    console.error('[native-launcher] square icon generation failed, falling back to source png');
  } catch (error) {
    console.error(`[native-launcher] square icon failed: ${error}`);
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
    console.error('[native-launcher] pwa icon extract failed, routes skipped');
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
    console.error('[native-launcher] pwa routes registered');
  } catch (error) {
    console.error(`[native-launcher] pwa route registration failed: ${error}`);
  }
}

/**
 * 任务检测 + 通知（v0.2 基础组件）：
 * 监听 agent/status（AgentStatus = idle ⇄ running），running→idle 边缘 = 任务完成，
 * 写 notify.json（含 kind: done/error），供托盘轮询气泡 + client 轮询页面内通知。
 * 任何失败只记日志，绝不拖垮宿主。
 */
function setupTaskWatch(ctx, launcherDir, enabled) {
  if (!enabled) return;
  try {
    const agents = ctx.get('agents');
    if (!agents) {
      console.error('[native-launcher] agents service unavailable, task watch skipped');
      return;
    }
    const notifyFile = join(launcherDir, 'notify.json');
    const prevStatus = new Map();
    const onStatus = (payload) => {
      try {
        const agent = payload?.agent;
        const status = payload?.status;
        if (!agent || !status) return;
        const id = agent.id ?? agent.sessionId ?? String(agent);
        const before = prevStatus.get(id);
        prevStatus.set(id, status);
        if (status === 'idle' && before === 'running') {
          const entry = { at: Date.now(), kind: 'done', sessionId: String(id).slice(0, 8) };
          writeFileSync(notifyFile, JSON.stringify(entry), 'utf-8');
          console.error(`[native-launcher] task done: ${id}`);
        }
      } catch (error) {
        console.error(`[native-launcher] task watch handler error: ${error}`);
      }
    };
    ctx.on('agent/status', onStatus);
    // agent/error：任务出错（在 running→idle 前标记 error，通知显示"出错"）
    ctx.on('agent/error', (payload) => {
      try {
        const agent = payload?.agent;
        if (!agent) return;
        const id = agent.id ?? agent.sessionId ?? String(agent);
        const entry = { at: Date.now(), kind: 'error', sessionId: String(id).slice(0, 8) };
        writeFileSync(notifyFile, JSON.stringify(entry), 'utf-8');
        console.error(`[native-launcher] task error: ${id}`);
      } catch (error) {
        console.error(`[native-launcher] task error handler failed: ${error}`);
      }
    });
    console.error('[native-launcher] task watch active');
  } catch (error) {
    console.error(`[native-launcher] task watch setup failed: ${error}`);
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
    console.error(`[native-launcher] open browser failed: ${error}`);
    return false;
  }
}

// 加固：apply 全程受保护——任何环节失败只记日志，绝不拖垮宿主启动。
export function apply(ctx, config = {}) {
  try {
    applyInner(ctx, config);
  } catch (error) {
    console.error(`[native-launcher] apply failed (harness continues): ${error?.stack ?? error}`);
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
    console.error('[native-launcher] USERPROFILE missing; launcher cannot be installed');
    return;
  }
  const launcherDir = join(home, '.dsh-webui-launcher');
  const vbsPath = join(launcherDir, 'launcher.vbs');
  try {
    // 必须先建目录：writeOpenScript 在 writeLauncherFiles 之前执行，
    // 若目录不存在会抛 ENOENT 并中断整个写入链（launcher.vbs 等全部缺失）。
    mkdirSync(launcherDir, { recursive: true });
    const trayPath = trayEnabled ? join(launcherDir, 'tray.ps1') : null;
    const openScriptPath = join(launcherDir, 'open-webui.ps1');
    writeOpenScript(launcherDir, port, openMode, shortcutName, findInstalledPwaAppId(port, launcherDir));
    writeLauncherFiles(launcherDir, launchCommand, port, trayPath, openScriptPath);
    if (trayEnabled) writeTrayScript(launcherDir, port, join(launcherDir, 'dsh-webui.ico'));
  } catch (error) {
    console.error(`[native-launcher] launcher script failed: ${error}`);
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
          case 'notify.last': {
            // 任务通知轮询：返回最近一次任务结束记录（client 用 at 游标去重）
            try {
              const nf = join(launcherDir, 'notify.json');
              if (existsSync(nf)) {
                const j = JSON.parse(readFileSync(nf, 'utf-8'));
                return { ok: true, value: { at: Number(j.at) || 0, kind: j.kind || 'done', sessionId: j.sessionId || '' } };
              }
            } catch (error) {
              console.error(`[native-launcher] notify.last failed: ${error}`);
            }
            return { ok: true, value: { at: 0, kind: 'done', sessionId: '' } };
          }
          default:
            return { ok: false, error: { code: 'unknown', message: `unknown endpoint: ${endpoint}`, details: {} } };
        }
      },
      { authority: 'trusted-host' },
    );
  } catch (error) {
    console.error(`[native-launcher] rpc registration failed: ${error}`);
  }

  // 3.5 注册 PWA 静态路由（真实 URL manifest + PNG 图标 → 让 Chromium 判定可安装）
  registerPwaRoutes(ctx, launcherDir, iconPath);

  // 4. 拉起系统托盘：无论用户从快捷方式还是终端直接启动 dsh，托盘都会出现
  //    （tray.ps1 内部 Mutex 单实例保护，重复拉起自动退出；失败只记日志）
  if (trayEnabled) {
    try {
      const trayPath = join(launcherDir, 'tray.ps1');
      if (existsSync(trayPath)) {
        const child = spawn(
          'powershell',
          ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', trayPath],
          { stdio: 'ignore', windowsHide: true, detached: true },
        );
        child.unref();
      }
    } catch (error) {
      console.error(`[native-launcher] tray spawn failed: ${error}`);
    }
  }

  // 4.5 任务检测 + 通知：监听 agent/status（running→idle = 任务完成）→ 写 notify.json，
  //     托盘进程轮询后弹气泡（页面关闭也能提醒）；client 轮询 RPC 做页面内通知
  setupTaskWatch(ctx, launcherDir, config.notify !== false);

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
