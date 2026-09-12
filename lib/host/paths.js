// src/host/core/paths.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
function logsDirOf(launcherDir) {
  return join(launcherDir, "logs");
}
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
export {
  logsDirOf,
  resolveDesktopPath
};
