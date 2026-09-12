// src/host/io/logger.ts
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join as join2 } from "node:path";

// src/host/core/paths.ts
import { join } from "node:path";
function logsDirOf(launcherDir) {
  return join(launcherDir, "logs");
}

// src/host/io/logger.ts
var logPath = null;
var applySeq = 0;
var saveSeq = 0;
function logWrite(level, msg) {
  try {
    const d = /* @__PURE__ */ new Date();
    const p = (n, w = 2) => String(n).padStart(w, "0");
    const tz = -d.getTimezoneOffset();
    const tzStr = `${tz >= 0 ? "+" : "-"}${p(Math.floor(Math.abs(tz) / 60))}:${p(Math.abs(tz) % 60)}`;
    const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} ${tzStr}`;
    const dm = /^\[([a-z0-9_-]+)\]\s?(.*)$/is.exec(msg);
    const domain = (dm ? dm[1] : "launcher").padEnd(10);
    const text = dm ? dm[2] : msg;
    const line = `[${ts}] [${level.padEnd(5)}] [${domain}] ${text}`;
    console.error(line);
    if (logPath) {
      try {
        if (existsSync(logPath) && statSync(logPath).size > 1024 * 1024) {
          renameSync(logPath, logPath.replace(/\.log$/, ".prev.log"));
        }
      } catch {
      }
      appendFileSync(logPath, line + "\r\n");
    }
  } catch {
  }
}
function logMsg(msg) {
  logWrite("INFO", msg);
}
function logWarn(msg) {
  logWrite("WARN", msg);
}
function logFail(msg) {
  logWrite("ERROR", msg);
}
function migrateLegacyLogs(launcherDir, logsDir) {
  try {
    for (const name of readdirSync(launcherDir)) {
      if (!/\.log$/i.test(name)) continue;
      const from = join2(launcherDir, name);
      const to = join2(logsDir, name);
      try {
        if (existsSync(to)) {
          unlinkSync(from);
          continue;
        }
        renameSync(from, to);
      } catch {
      }
    }
  } catch {
  }
}
function beginApplyLog(launcherDir) {
  const logsDir = logsDirOf(launcherDir);
  mkdirSync(logsDir, { recursive: true });
  migrateLegacyLogs(launcherDir, logsDir);
  logPath = join2(logsDir, "native-launcher.log");
  applySeq += 1;
  return { logsDir, applySeq };
}
function nextSaveSeq() {
  saveSeq += 1;
  return saveSeq;
}
export {
  beginApplyLog,
  logFail,
  logMsg,
  logWarn,
  migrateLegacyLogs,
  nextSaveSeq
};
