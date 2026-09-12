// src/host/io/pwa.ts
import { appendFileSync, existsSync as existsSync2, readFileSync as readFileSync2, readdirSync } from "node:fs";
import { join as join3 } from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";

// src/host/core/paths.ts
import { join } from "node:path";
function logsDirOf(launcherDir) {
  return join(launcherDir, "logs");
}

// src/host/io/icon.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
var ICON_RESOURCE = fileURLToPath(new URL("../../assets/dsh-webui.ico", import.meta.url));
function extractPngBuffer(iconPath) {
  try {
    const buf = readFileSync(iconPath);
    const pngMagic = Buffer.from([137, 80, 78, 71]);
    const start = buf.indexOf(pngMagic);
    if (start < 0) return null;
    return buf.subarray(start);
  } catch {
    return null;
  }
}
function pngSize(buf) {
  try {
    if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 2303741511 || buf.readUInt32BE(12) !== 1229472850) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}
function ensureSquareIconPng(launcherDir, pngBuffer, logMsg) {
  try {
    const size = pngSize(pngBuffer);
    if (size && size.w === 256 && size.h === 256) return pngBuffer;
    const outPath = join2(launcherDir, "icon-256.png");
    if (existsSync(outPath)) return readFileSync(outPath);
    const inPath = join2(launcherDir, "icon-source.png");
    writeFileSync(inPath, pngBuffer);
    const ps = [
      "Add-Type -AssemblyName System.Drawing",
      `$src = [System.Drawing.Image]::FromFile('${inPath.replace(/'/g, "''")}')`,
      "$w = $src.Width; $h = $src.Height",
      "if ($w -eq 256 -and $h -eq 256) { $src.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png); exit 0 }",
      "$bmp = New-Object System.Drawing.Bitmap(256, 256)",
      "$g = [System.Drawing.Graphics]::FromImage($bmp)",
      "$g.Clear([System.Drawing.Color]::Transparent)",
      "$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
      "$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality",
      "$ratio = [Math]::Min(256 / $w, 256 / $h)",
      "$nw = [Math]::Floor($w * $ratio); $nh = [Math]::Floor($h * $ratio)",
      "$x = [Math]::Floor((256 - $nw) / 2); $y = [Math]::Floor((256 - $nh) / 2)",
      "$g.DrawImage($src, $x, $y, $nw, $nh)",
      "$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)",
      "$g.Dispose(); $bmp.Dispose(); $src.Dispose()",
      "exit 0"
    ].join("; ");
    const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps, outPath], { stdio: "ignore", windowsHide: true });
    try {
      unlinkSync(inPath);
    } catch {
    }
    if (result.status === 0 && existsSync(outPath)) {
      logMsg("square icon generated (256x256)");
      return readFileSync(outPath);
    }
    logMsg("square icon generation failed, falling back to source png");
  } catch (error) {
    logMsg(`square icon failed: ${error}`);
  }
  return pngBuffer;
}

// src/host/io/pwa.ts
function findInstalledPwaAppId(port, launcherDir) {
  const log = [];
  const writeLog = (msg) => {
    log.push(`[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}`);
    try {
      appendFileSync(join3(logsDirOf(launcherDir), "pwa-scan.log"), log[log.length - 1] + "\r\n");
    } catch {
    }
  };
  try {
    const local = process.env.LOCALAPPDATA;
    writeLog(`LOCALAPPDATA=${local}`);
    if (!local) {
      writeLog("LOCALAPPDATA missing");
      return null;
    }
    const base = join3(local, "Microsoft", "Edge", "User Data");
    writeLog(`base=${base} exists=${existsSync2(base)}`);
    if (!existsSync2(base)) return null;
    const needle = `127.0.0.1:${String(port)}`;
    const profileNames = readdirSync(base).filter((n) => /^(Default|Profile \d+)$/.test(n));
    writeLog(`profiles=${JSON.stringify(profileNames)}`);
    const prefPaths = profileNames.map((n) => join3(base, n, "Preferences")).filter((p) => existsSync2(p));
    writeLog(`prefPaths=${JSON.stringify(prefPaths)}`);
    let urlKnown = false;
    for (const p of prefPaths) {
      try {
        if (readFileSync2(p, "utf-8").includes(needle)) {
          urlKnown = true;
          break;
        }
      } catch (e) {
        writeLog(`pref read fail ${p}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    writeLog(`urlKnown=${urlKnown}`);
    for (const profile of profileNames) {
      const mr = join3(base, profile, "Web Applications", "Manifest Resources");
      writeLog(`check mr=${mr} exists=${existsSync2(mr)}`);
      if (!existsSync2(mr)) continue;
      for (const id of readdirSync(mr)) {
        const icons = join3(mr, id, "Icons");
        writeLog(`  candidate=${id} icons=${existsSync2(icons)}`);
        if (existsSync2(icons)) {
          writeLog(`FOUND app_id=${id}`);
          return id;
        }
      }
    }
    writeLog("RESULT: null (no installed pwa found)");
  } catch (error) {
    writeLog(`EXCEPTION: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
  return null;
}
function registerPwaRoutes(webServer, launcherDir, iconPath, logMsg) {
  const png = ensureSquareIconPng(launcherDir, extractPngBuffer(iconPath) ?? Buffer.alloc(0), logMsg);
  if (!png || png.length === 0) {
    logMsg("pwa icon extract failed, routes skipped");
    return;
  }
  const manifestJson = JSON.stringify({
    id: "/native-launcher",
    name: "DSH WebUI",
    short_name: "DSH WebUI",
    description: "DeepSeek Harness Web UI",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#141414",
    theme_color: "#141414",
    icons: [{ src: "/native-launcher/icon.png", sizes: "256x256", type: "image/png", purpose: "any" }]
  });
  try {
    webServer.register({
      kind: "exact",
      path: "/native-launcher/manifest.webmanifest",
      handler: (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(manifestJson);
      }
    });
    webServer.register({
      kind: "exact",
      path: "/native-launcher/icon.png",
      handler: (_req, res) => {
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
        res.end(png);
      }
    });
    logMsg("pwa routes registered");
  } catch (error) {
    logMsg(`pwa route registration failed: ${error}`);
  }
}
function openBrowser(port, launcherDir, logMsg) {
  try {
    const openScriptPath = join3(launcherDir, "open-webui.ps1");
    if (existsSync2(openScriptPath)) {
      spawnSync2("powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", openScriptPath], { stdio: "ignore", windowsHide: true });
    } else {
      spawnSync2("cmd", ["/c", "start", "", `http://127.0.0.1:${String(port)}`], { stdio: "ignore", windowsHide: true });
    }
    return true;
  } catch (error) {
    logMsg(`open browser failed: ${error}`);
    return false;
  }
}
export {
  findInstalledPwaAppId,
  openBrowser,
  registerPwaRoutes
};
