// src/host/io/state.ts
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
function cleanTxt(raw) {
  return raw.replace(/^\uFEFF/, "").trim();
}
var trayStatePath = (dir) => join(dir, "tray-state.json");
function readTrayState(dir) {
  const jsonPath = trayStatePath(dir);
  try {
    if (existsSync(jsonPath)) {
      const raw = JSON.parse(cleanTxt(readFileSync(jsonPath, "utf-8")));
      if (Number.isInteger(raw.pid) && (raw.pid ?? 0) > 0 && Number.isInteger(raw.scriptVersion)) {
        return { pid: raw.pid, scriptVersion: raw.scriptVersion, startedAt: String(raw.startedAt ?? "") };
      }
    }
  } catch {
  }
  try {
    const pidTxt = join(dir, "tray-pid.txt");
    const verTxt = join(dir, "tray-version.txt");
    if (existsSync(pidTxt) && existsSync(verTxt)) {
      const pid = parseInt(cleanTxt(readFileSync(pidTxt, "utf-8")), 10);
      const scriptVersion = parseInt(cleanTxt(readFileSync(verTxt, "utf-8")), 10);
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(scriptVersion)) {
        return { pid, scriptVersion, startedAt: "" };
      }
    }
  } catch {
  }
  return null;
}
function writeTrayState(dir, state) {
  writeFileSync(trayStatePath(dir), JSON.stringify(state), "utf-8");
}
function cleanupLegacyTrayTxt(dir) {
  for (const name of ["tray-pid.txt", "tray-version.txt"]) {
    try {
      unlinkSync(join(dir, name));
    } catch {
    }
  }
}
var webuiUrlPath = (dir) => join(dir, "webui-url.json");
function readWebuiUrl(dir) {
  const jsonPath = webuiUrlPath(dir);
  try {
    if (existsSync(jsonPath)) {
      const raw = JSON.parse(cleanTxt(readFileSync(jsonPath, "utf-8")));
      if (typeof raw.url === "string" && raw.url && Number.isInteger(raw.port)) {
        return { url: raw.url, port: raw.port, capturedAt: String(raw.capturedAt ?? "") };
      }
    }
  } catch {
  }
  try {
    const txt = join(dir, "webui-url.txt");
    if (existsSync(txt)) {
      const url = cleanTxt(readFileSync(txt, "utf-8"));
      if (url) return { url, port: 0, capturedAt: "" };
    }
  } catch {
  }
  return null;
}
function writeWebuiUrl(dir, url, port, capturedAt) {
  writeFileSync(webuiUrlPath(dir), JSON.stringify({ url, port, capturedAt }), "utf-8");
}
var shortcutPath = (dir) => join(dir, "shortcut-registry.json");
function readShortcutRegistry(dir) {
  const jsonPath = shortcutPath(dir);
  try {
    if (existsSync(jsonPath)) {
      const raw = JSON.parse(cleanTxt(readFileSync(jsonPath, "utf-8")));
      if (Array.isArray(raw)) return raw.filter((e) => typeof e?.path === "string" && e.path);
    }
  } catch {
  }
  try {
    const txt = join(dir, "shortcut-registry.txt");
    if (existsSync(txt)) {
      const entries = cleanTxt(readFileSync(txt, "utf-8")).split(/\r?\n/).filter(Boolean).map((p) => ({ path: p, createdAt: "" }));
      if (entries.length) writeShortcutRegistry(dir, entries);
      return entries;
    }
  } catch {
  }
  return [];
}
function writeShortcutRegistry(dir, entries) {
  writeFileSync(shortcutPath(dir), JSON.stringify(entries, null, 2), "utf-8");
  try {
    const txt = join(dir, "shortcut-registry.txt");
    if (existsSync(txt)) unlinkSync(txt);
  } catch {
  }
}
function migrateLegacyStateFiles(dir) {
  const notes = [];
  const hadTrayTxt = existsSync(join(dir, "tray-pid.txt")) || existsSync(join(dir, "tray-version.txt"));
  try {
    const pidTxt = join(dir, "tray-pid.txt");
    const verTxt = join(dir, "tray-version.txt");
    const hasPid = existsSync(pidTxt);
    const hasVer = existsSync(verTxt);
    if ((hasPid || hasVer) && !existsSync(trayStatePath(dir))) {
      const pid = hasPid ? parseInt(cleanTxt(readFileSync(pidTxt, "utf-8")), 10) : NaN;
      const ver = hasVer ? parseInt(cleanTxt(readFileSync(verTxt, "utf-8")), 10) : NaN;
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ver)) {
        writeTrayState(dir, { pid, scriptVersion: ver, startedAt: "" });
        notes.push(`tray-state.json ← tray-pid.txt+tray-version.txt`);
      }
    }
  } catch {
  }
  cleanupLegacyTrayTxt(dir);
  if (hadTrayTxt) {
    notes.push(
      existsSync(join(dir, "tray-pid.txt")) || existsSync(join(dir, "tray-version.txt")) ? "tray txt cleanup deferred (in use)" : "tray-pid.txt/tray-version.txt removed"
    );
  }
  try {
    const urlTxt = join(dir, "webui-url.txt");
    if (existsSync(urlTxt)) {
      if (!existsSync(webuiUrlPath(dir))) {
        const url = cleanTxt(readFileSync(urlTxt, "utf-8"));
        const port = Number(new URL(url).port) || 0;
        if (url) {
          writeWebuiUrl(dir, url, port, "");
          notes.push("webui-url.json ← webui-url.txt");
        }
      }
      unlinkSync(urlTxt);
      notes.push("webui-url.txt removed");
    }
  } catch {
  }
  try {
    const txt = join(dir, "shortcut-registry.txt");
    if (existsSync(txt)) {
      if (!existsSync(shortcutPath(dir))) {
        const entries = readShortcutRegistry(dir);
        notes.push(`shortcut-registry.json ← txt (${String(entries.length)} entries)`);
      }
      if (existsSync(txt)) unlinkSync(txt);
      notes.push(
        existsSync(txt) ? "shortcut-registry.txt cleanup deferred" : "shortcut-registry.txt removed"
      );
    }
  } catch {
  }
  return notes;
}
export {
  cleanupLegacyTrayTxt,
  migrateLegacyStateFiles,
  readShortcutRegistry,
  readTrayState,
  readWebuiUrl,
  writeShortcutRegistry,
  writeTrayState,
  writeWebuiUrl
};
