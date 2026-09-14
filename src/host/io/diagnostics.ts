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
import { resolveDesktopPath } from '../core/paths.ts';

/** 检测当前 dsh 版本（读 DSH_HOME 下 profile 依赖树里的 dsh 包）；找不到返回 ''。 */
export function detectDshVersion(): string {
  // DSH_HOME 未设置是常态而非特例（官方语义 = $DSH_HOME 优先，缺省回退 ~/.dsh）——
  // 直接放弃会让版本探测恒空、rc.8 告警永不触发（issue #3，真实用户实测）。
  // 回退逻辑与 launcherRpc 的 resolveDshHome 同源，两处实现保持一致。
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE ?? '', '.dsh');
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
 * 环境诊断快照：apply 时逐行写 `[diag]` 域日志（注入 logMsg——参数名与打点函数统一，
 * log-inventory 按打点文本对账时才能识别；io 同层互不 import 的架构规则不变）。
 * powershell 输出按行拆分；无输出 = 诊断失败（记一行，不影响启动）。
 */
export function logEnvDiagnostics(launcherDir: string, config: LauncherConfig, logMsg: LogFn): void {
  const lc = config.launchCommand ?? 'dsh --profile web --no-open';
  const first = (lc.split(/\s+/)[0] || '').replace(/["']/g, '');
  const desktop = resolveDesktopPath() ?? '';
  const lnk = join(desktop, `${config.shortcutName ?? 'DSH WebUI'}.lnk`).replace(/'/g, "''");
  const verFile = join(launcherDir, 'tray-version.txt').replace(/'/g, "''");
  const stateFile = join(launcherDir, 'tray-state.json').replace(/'/g, "''");
  const ps = [
    "$o = @()",
    `$o += 'node=${process.version} ${process.platform}-${process.arch} DSH_LAUNCHER=${process.env.DSH_LAUNCHER ?? '(unset)'}'`,
    `$o += 'launchCommand=${JSON.stringify(lc)}'`,
    // 进程优先级要留痕：Windows 会对无可见窗口的进程施加节流，本插件靠「优先级高于 Normal」
    // 解除（src/host/io/priority.ts）。**必须读 dsh 自己的 pid**：这里的 $PID 指的是诊断用
    // PowerShell 子进程，读它永远得到 Normal（2026-09-13 真机实测踩到：日志撒谎，差点误判提权失效）。
    `$o += 'priority=' + ([string](Get-Process -Id ${String(process.pid)}).PriorityClass)`,
    ...(first && !first.includes('\\') && !first.includes('/')
      ? [`$w = & where.exe ${first} 2>$null; $o += 'where ${first}=' + ($(if ($w) { $w -join ';' } else { '(not found)' }))`]
      : []),
    "$n = netstat -ano | Select-String ':3080.*LISTENING'; $o += 'port3080=' + ($(if ($n) { ($n | ForEach-Object { $_.ToString().Trim() }) -join ' | ' } else { '(none)' }))",
    "$p = Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' or Name='pwsh.exe'\" -ErrorAction SilentlyContinue | ForEach-Object { $cl = [string]$_.CommandLine; $cl = $cl -replace '\\s+', ' '; if ($cl.Length -gt 100) { $cl = $cl.Substring(0, 100) }; $_.ProcessId.ToString() + '|' + $cl }; $o += 'procs=' + ($(if ($p) { $p -join ' ; ' } else { '(none)' }))",
    // trayver：v22 起读 tray-state.json（旧 txt 回退——升级瞬间旧托盘可能还在写 txt）
    `$st = Get-Content '${stateFile}' -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json; $tv = if ($st -and $st.scriptVersion) { [string]$st.scriptVersion } else { [string](Get-Content '${verFile}' -Raw -ErrorAction SilentlyContinue) }; $o += 'trayver=' + ($(if ($tv) { $tv.Trim() } else { '(missing)' }))`,
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
