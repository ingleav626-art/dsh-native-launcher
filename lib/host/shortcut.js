// src/host/io/shortcut.ts
import { appendFileSync, existsSync as existsSync2, readFileSync } from "node:fs";
import { join as join2 } from "node:path";
import { spawnSync } from "node:child_process";

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

// src/host/io/shortcut.ts
function createDesktopShortcut(shortcutName, vbsPath, iconPath, force, launcherDir, logMsg) {
  const desktop = resolveDesktopPath();
  if (!desktop) return;
  const home = process.env.USERPROFILE ?? "";
  const lnk = join2(desktop, `${shortcutName}.lnk`);
  if (!force && existsSync2(lnk)) {
    try {
      const buf = readFileSync(lnk);
      const vbsNeedle = Buffer.from(vbsPath, "utf16le");
      const iconNeedle = iconPath ? Buffer.from(iconPath, "utf16le") : null;
      if (buf.includes(vbsNeedle) && (!iconNeedle || buf.includes(iconNeedle))) {
        logMsg(`shortcut already exists and points to current vbs + icon, skipping: ${lnk}`);
        return;
      }
      logMsg(`shortcut exists but points elsewhere or icon changed, recreating: ${lnk}`);
    } catch {
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
    `$s.Save()`
  ].filter(Boolean).join("; ");
  try {
    spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true });
    logMsg(`shortcut created: ${lnk}`);
    try {
      const regPath = join2(launcherDir, "shortcut-registry.txt");
      const existing = existsSync2(regPath) ? readFileSync(regPath, "utf-8") : "";
      if (!existing.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).includes(lnk)) {
        appendFileSync(regPath, lnk + "\r\n");
      }
    } catch {
    }
  } catch (error) {
    logMsg(`shortcut creation failed: ${error}`);
  }
}
export {
  createDesktopShortcut
};
