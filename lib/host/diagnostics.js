// src/host/io/diagnostics.ts
import { existsSync as existsSync2, readFileSync } from "node:fs";
import { join as join2 } from "node:path";
import { spawn } from "node:child_process";

// src/host/core/paths.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
function resolveDesktopPath() {
  const profile = process.env.USERPROFILE;
  if (!profile) return null;
  const candidates = [
    join(profile, "OneDrive", "Desktop"),
    join(profile, "Desktop")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

// src/host/io/diagnostics.ts
function detectDshVersion() {
  const home = process.env.DSH_HOME || join2(process.env.USERPROFILE ?? "", ".dsh");
  if (!home) return "";
  const candidates = [
    join2(home, "profiles", "node_modules", "@deepseek-ai", "dsh", "package.json"),
    join2(home, "profiles", "web", "node_modules", "@deepseek-ai", "dsh", "package.json")
  ];
  for (const p of candidates) {
    try {
      if (existsSync2(p)) {
        const v = JSON.parse(readFileSync(p, "utf8")).version;
        if (v) return String(v);
      }
    } catch {
    }
  }
  return "";
}
function logEnvDiagnostics(launcherDir, config, logMsg) {
  const lc = config.launchCommand ?? "dsh --profile web --no-open";
  const first = (lc.split(/\s+/)[0] || "").replace(/["']/g, "");
  const desktop = resolveDesktopPath() ?? "";
  const lnk = join2(desktop, `${config.shortcutName ?? "DSH WebUI"}.lnk`).replace(/'/g, "''");
  const verFile = join2(launcherDir, "tray-version.txt").replace(/'/g, "''");
  const stateFile = join2(launcherDir, "tray-state.json").replace(/'/g, "''");
  const ps = [
    "$o = @()",
    `$o += 'node=${process.version} ${process.platform}-${process.arch} DSH_LAUNCHER=${process.env.DSH_LAUNCHER ?? "(unset)"}'`,
    `$o += 'launchCommand=${JSON.stringify(lc)}'`,
    // 进程优先级要留痕：Windows 会对无可见窗口的进程施加节流，本插件靠「优先级高于 Normal」
    // 解除（src/host/io/priority.ts）。**必须读 dsh 自己的 pid**：这里的 $PID 指的是诊断用
    // PowerShell 子进程，读它永远得到 Normal（2026-09-13 真机实测踩到：日志撒谎，差点误判提权失效）。
    `$o += 'priority=' + ([string](Get-Process -Id ${String(process.pid)}).PriorityClass)`,
    ...first && !first.includes("\\") && !first.includes("/") ? [`$w = & where.exe ${first} 2>$null; $o += 'where ${first}=' + ($(if ($w) { $w -join ';' } else { '(not found)' }))`] : [],
    "$n = netstat -ano | Select-String ':3080.*LISTENING'; $o += 'port3080=' + ($(if ($n) { ($n | ForEach-Object { $_.ToString().Trim() }) -join ' | ' } else { '(none)' }))",
    `$p = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' or Name='pwsh.exe'" -ErrorAction SilentlyContinue | ForEach-Object { $cl = [string]$_.CommandLine; $cl = $cl -replace '\\s+', ' '; if ($cl.Length -gt 100) { $cl = $cl.Substring(0, 100) }; $_.ProcessId.ToString() + '|' + $cl }; $o += 'procs=' + ($(if ($p) { $p -join ' ; ' } else { '(none)' }))`,
    // trayver：v22 起读 tray-state.json（旧 txt 回退——升级瞬间旧托盘可能还在写 txt）
    `$st = Get-Content '${stateFile}' -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json; $tv = if ($st -and $st.scriptVersion) { [string]$st.scriptVersion } else { [string](Get-Content '${verFile}' -Raw -ErrorAction SilentlyContinue) }; $o += 'trayver=' + ($(if ($tv) { $tv.Trim() } else { '(missing)' }))`,
    "$lnkInfo = '(read failed)'",
    `try { $ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${lnk}'); $lnkInfo = $s.TargetPath + ' args=' + $s.Arguments } catch { }`,
    "$o += 'lnk=' + $lnkInfo",
    '$o -join "`n"'
  ].join("; ");
  const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let out = "";
  child.stdout?.on("data", (chunk) => {
    out = String(out + chunk).slice(-8e3);
  });
  child.on("close", () => {
    const rows = String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!rows.length) {
      logMsg("[diag] env snapshot failed (no output)");
      return;
    }
    for (const line of rows) logMsg(`[diag] ${line}`);
  });
}
export {
  detectDshVersion,
  logEnvDiagnostics
};
