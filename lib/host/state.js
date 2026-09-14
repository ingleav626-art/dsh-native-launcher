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
  writeFileSync(join(dir, "webui-url.txt"), `${url}
`, "utf-8");
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
export {
  cleanupLegacyTrayTxt,
  readShortcutRegistry,
  readTrayState,
  readWebuiUrl,
  writeShortcutRegistry,
  writeTrayState,
  writeWebuiUrl
};
