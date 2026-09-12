/**
 * 桌面快捷方式（L2 副作用边界）：.lnk 创建 + 实名登记（卸载定点清除的依据）。
 * 从 index.js 原样搬入（P2-B3）。
 */
import { appendFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { LogFn } from '../types.ts';
import { resolveDesktopPath } from '../core/paths.ts';

/**
 * 在桌面创建指向 launcher.vbs 的快捷方式。
 * 幂等：快捷方式已存在且未开启 force 时跳过（用户手动改过的快捷方式不被覆盖）；
 * 但若现有快捷方式指向的不是当前 vbsPath（项目改名/目录变更后变孤儿），
 * 或图标路径不一致（图标资源更新后），自动重建。
 */
export function createDesktopShortcut(shortcutName: string, vbsPath: string, iconPath: string | null, force: boolean, launcherDir: string, logMsg: LogFn): void {
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

/** 当前用户的启动文件夹（shell:startup）里本插件快捷方式的路径。 */
export function startupLnkPath(shortcutName: string): string {
  const appData = process.env.APPDATA ?? '';
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${shortcutName}.lnk`);
}

/**
 * 开机自启动（默认关）：在 shell:startup 建/删指向 launcher.vbs 的快捷方式。
 * 语义 = 开机自动"双击桌面快捷方式"（静默启动 dsh web + 自动打开页面）。
 * 幂等：enabled 时已存在则跳过；disabled 时存在才删——重复 apply 不产生副作用。
 */
export function ensureStartupShortcut(shortcutName: string, vbsPath: string, iconPath: string | null, enabled: boolean, logMsg: LogFn): void {
  const lnk = startupLnkPath(shortcutName);
  try {
    if (!enabled) {
      // 分支日志：关闭时区分"有残留已清理"与"本来就没有"——排查"为什么开机还自启/为什么没自启"都要看得到
      if (existsSync(lnk)) {
        try { unlinkSync(lnk); logMsg(`startup shortcut removed (autoStartBoot=false): ${lnk}`); } catch (e) { logMsg(`startup shortcut removal failed: ${e}`); }
      } else {
        logMsg(`startup shortcut disabled (autoStartBoot=false), nothing to clean`);
      }
      return;
    }
    logMsg(`startup shortcut enabled (autoStartBoot=true)`);
    if (existsSync(lnk)) {
      // 校验现有 lnk 是否仍指向当前 vbs（目录迁移后变孤儿则重建）
      const buf = readFileSync(lnk);
      if (buf.includes(Buffer.from(vbsPath, 'utf16le'))) {
        logMsg(`startup shortcut already exists and points to current vbs, skipping: ${lnk}`);
        return;
      }
      logMsg(`startup shortcut points elsewhere, recreating: ${lnk}`);
    }
    const ps = [
      `$ws = New-Object -ComObject WScript.Shell`,
      `$s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}')`,
      `$s.TargetPath = 'C:\\Windows\\System32\\wscript.exe'`,
      `$s.Arguments = '"${vbsPath.replace(/"/g, '""')}"'`,
      `$s.WorkingDirectory = '${(process.env.USERPROFILE ?? '').replace(/'/g, "''")}'`,
      iconPath ? `$s.IconLocation = '${iconPath.replace(/'/g, "''")}'` : null,
      `$s.Save()`,
    ].filter(Boolean).join('; ');
    // 成败必须以 PowerShell 退出码为准——此前不检查状态，创建失败也报"created"（谎报）
    const created = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, encoding: 'utf8' });
    if (created.status !== 0) {
      const detail = String((created.stderr ?? '') + (created.stdout ?? '')).trim().slice(0, 300);
      logMsg(`startup shortcut creation FAILED (exit=${created.status}): ${detail || 'no output'} — lnk=${lnk}`);
      return;
    }
    // 创建后回读验证 Save 真的落盘（COM 无报错但文件缺失的环境问题也有留痕）
    if (!existsSync(lnk)) {
      logMsg(`startup shortcut creation FAILED: powershell exited 0 but lnk missing — lnk=${lnk}`);
      return;
    }
    logMsg(`startup shortcut created (autoStartBoot=true): ${lnk}`);
  } catch (error) {
    logMsg(`startup shortcut failed: ${error}`);
  }
}
