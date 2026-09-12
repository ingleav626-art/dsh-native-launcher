// src/host/io/shortcut.ts
import { appendFileSync, existsSync as existsSync2, readFileSync, unlinkSync } from "node:fs";
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
function startupLnkPath(shortcutName) {
  const appData = process.env.APPDATA ?? "";
  return join2(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${shortcutName}.lnk`);
}
function ensureStartupShortcut(shortcutName, vbsPath, iconPath, enabled, logMsg) {
  const lnk = startupLnkPath(shortcutName);
  try {
    if (!enabled) {
      if (existsSync2(lnk)) {
        try {
          unlinkSync(lnk);
          logMsg(`startup shortcut removed (autoStartBoot=false): ${lnk}`);
        } catch (e) {
          logMsg(`startup shortcut removal failed: ${e}`);
        }
      } else {
        logMsg(`startup shortcut disabled (autoStartBoot=false), nothing to clean`);
      }
      return;
    }
    logMsg(`startup shortcut enabled (autoStartBoot=true)`);
    if (existsSync2(lnk)) {
      const buf = readFileSync(lnk);
      if (buf.includes(Buffer.from(vbsPath, "utf16le"))) {
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
      `$s.WorkingDirectory = '${(process.env.USERPROFILE ?? "").replace(/'/g, "''")}'`,
      iconPath ? `$s.IconLocation = '${iconPath.replace(/'/g, "''")}'` : null,
      `$s.Save()`
    ].filter(Boolean).join("; ");
    const created = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, encoding: "utf8" });
    if (created.status !== 0) {
      const detail = String((created.stderr ?? "") + (created.stdout ?? "")).trim().slice(0, 300);
      logMsg(`startup shortcut creation FAILED (exit=${created.status}): ${detail || "no output"} — lnk=${lnk}`);
      return;
    }
    if (!existsSync2(lnk)) {
      logMsg(`startup shortcut creation FAILED: powershell exited 0 but lnk missing — lnk=${lnk}`);
      return;
    }
    logMsg(`startup shortcut created (autoStartBoot=true): ${lnk}`);
  } catch (error) {
    logMsg(`startup shortcut failed: ${error}`);
  }
}
export {
  createDesktopShortcut,
  ensureStartupShortcut,
  startupLnkPath
};
