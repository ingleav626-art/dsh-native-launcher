/**
 * 桌面快捷方式（L2 副作用边界）：.lnk 创建 + 实名登记（卸载定点清除的依据）。
 * 从 index.js 原样搬入（P2-B3）。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
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
