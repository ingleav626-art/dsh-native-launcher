// src/host/services/autoOpen.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import http from "node:http";

// src/host/io/pwa.ts
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// src/host/io/icon.ts
import { fileURLToPath } from "node:url";
var ICON_RESOURCE = fileURLToPath(new URL("../../assets/dsh-webui.ico", import.meta.url));

// src/host/io/pwa.ts
function openBrowser(port, launcherDir, logMsg) {
  try {
    const openScriptPath = join(launcherDir, "open-webui.ps1");
    if (existsSync(openScriptPath)) {
      spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", openScriptPath], { stdio: "ignore", windowsHide: true });
    } else {
      spawnSync("cmd", ["/c", "start", "", `http://127.0.0.1:${String(port)}`], { stdio: "ignore", windowsHide: true });
    }
    return true;
  } catch (error) {
    logMsg(`open browser failed: ${error}`);
    return false;
  }
}

// src/host/services/autoOpen.ts
function setupAutoOpen(deps) {
  const { getService, launcherDir, configPort, getClientsOnline, logMsg } = deps;
  const waitForPageReady = (port, timeoutMs, cb) => {
    const started = Date.now();
    let probeTarget = null;
    try {
      const saved = readFileSync2(join2(launcherDir, "webui-url.txt"), "utf8").trim();
      if (saved.startsWith("http")) probeTarget = saved;
    } catch {
    }
    const probe = () => {
      const req = http.get(probeTarget ?? `http://127.0.0.1:${port}/`, { timeout: 2e3 }, (res) => {
        res.resume();
        if (res.statusCode !== void 0 && res.statusCode >= 200 && res.statusCode < 400) {
          cb(true);
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        cb(false);
        return;
      }
      setTimeout(probe, 500);
    };
    probe();
  };
  const attempt = () => {
    const webServer = getService("webServer");
    const port = webServer?.port;
    if (port === void 0) return false;
    const probeT0 = Date.now();
    waitForPageReady(port, 15e3, (ready) => {
      const online = getClientsOnline();
      if (online > 0) {
        logMsg(`[auto-open] page already online (clients=${online}), skip auto-open (probe took ${Date.now() - probeT0}ms)`);
        return;
      }
      if (!ready) logMsg(`[auto-open] page not ready within 15s (probe took ${Date.now() - probeT0}ms), opening anyway`);
      else logMsg(`[auto-open] page ready (HTTP 2xx) in ${Date.now() - probeT0}ms, opening browser (port=${port})`);
      setTimeout(() => openBrowser(port, launcherDir, logMsg), 200);
    });
    return true;
  };
  const settled = getService("loader")?.await?.();
  if (settled === void 0) {
    attempt();
    return;
  }
  settled.then(
    () => {
      if (attempt()) return;
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (attempt() || tries >= 20) clearInterval(timer);
      }, 500);
    },
    () => {
    }
  );
}
export {
  setupAutoOpen
};
