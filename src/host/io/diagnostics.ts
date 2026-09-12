/**
 * 环境诊断与 dsh 版本探测（L2 副作用边界）。
 *
 * 诊断哲学：apply 时写入日志，让 issue 无需追问即可定位——
 * 启动命令可用性（where dsh）、端口监听状态、托盘进程详情（不只 true/false）、
 * 残留状态文件、快捷方式目标。全部合并进**单个异步** powershell spawn——
 * 绝不阻塞 apply（同步 spawnSync 会拖住 dsh 初始化，是本插件启动回归的根源）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { LauncherConfig, LogFn } from '../types.ts';
import { resolveDesktopPath } from './desktop.ts';

/** 检测当前 dsh 版本（读 DSH_HOME 下 profile 依赖树里的 dsh 包）；找不到返回 ''。 */
export function detectDshVersion(): string {
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
 * 环境诊断快照：apply 时逐行写 `[diag]` 域日志（注入 log，避免 io 同层 import）。
 * powershell 输出按行拆分；无输出 = 诊断失败（记一行，不影响启动）。
 */
export function logEnvDiagnostics(launcherDir: string, config: LauncherConfig, log: LogFn): void {
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
      log('[diag] env snapshot failed (no output)');
      return;
    }
    for (const line of rows) log(`[diag] ${line}`);
  });
}
