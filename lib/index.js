// dsh-native-launcher（构建产物——源码 src/index.ts，改这里没用）
//
// 装进 profile 后：
//   1. 在桌面生成一个快捷方式（默认名 "DSH WebUI"），幂等：已存在则跳过
//   2. 双击快捷方式 → wscript 静默运行 launcher.vbs（隐藏窗口，无 cmd 黑窗）
//   3. launcher.vbs 以 DSH_LAUNCHER=1 环境变量启动 dsh web
//   4. 插件检测到 DSH_LAUNCHER=1 → 等 webServer 就绪 → 自动打开默认浏览器
//   5. 设置页注册 "WebUI 启动器" 增强设置 section（读取配置 / 重新生成快捷方式）
//
// 平时从终端手动启动 dsh web（无 DSH_LAUNCHER）不会触发自动开浏览器。
// 零依赖：只用 node builtins + Windows 自带工具（wscript / powershell / cmd）。

// src/index.ts
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import { existsSync, mkdirSync, unlinkSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_API_VERSION, BUILTIN_MODULES } from "./module-registry.js";
import { createNotificationPorts } from "./host-ports.js";
import { logMsg, logWarn, logFail, beginApplyLog, nextSaveSeq } from "./host/logger.js";
import { logsDirOf, resolveDesktopPath } from "./host/paths.js";
import { dshVersionGte } from "./host/version.js";
import { detectDshVersion, logEnvDiagnostics } from "./host/diagnostics.js";
import { registerLauncherSettings } from "./host/settings.js";
import { writeOpenScript, writeLauncherFiles } from "./host/scripts.js";
import { ensureIcon, extractPngDataUrl } from "./host/icon.js";
import { createDesktopShortcut, ensureStartupShortcut, startupLnkPath } from "./host/shortcut.js";
import { readTrayState, writeWebuiUrl, readShortcutRegistry } from "./host/state.js";
import { findInstalledPwaAppId, registerPwaRoutes } from "./host/pwa.js";
import { TRAY_SCRIPT_VERSION, writeTrayScript, killExistingTrays, startTrayProcess } from "./host/tray.js";
import { setupCloseToExit } from "./host/services/closeToExit.js";
import { setupAutoOpen } from "./host/services/autoOpen.js";
import { registerRpcFallbackBridge } from "./host/rpcBridge.js";
import { setupLauncherRpc } from "./host/services/launcherRpc.js";
import { setupModules } from "./host/services/modules.js";
import { raiseOwnPriority, priorityName } from "./host/priority.js";
var priorityRaise = raiseOwnPriority();
var name = "native-launcher";
var inject = ["webServer", "connection", "sessionProjections", "settings"];
var pendingExitCleanup = null;
function armExitCleanup(dir) {
  pendingExitCleanup = dir;
  process.once("exit", () => {
    const target = pendingExitCleanup;
    pendingExitCleanup = null;
    if (!target) return;
    try {
      for (const name2 of ["launch.cmd", "launcher.vbs", "tray.ps1", "open-webui.ps1", "dsh-webui.ico", "tray-pid.txt", "tray-version.txt", "tray-state.json"]) {
        const p = join(target, name2);
        if (existsSync(p)) {
          try {
            unlinkSync(p);
          } catch {
          }
        }
      }
      try {
        appendFileSync(join(logsDirOf(target), "uninstall.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] [INFO ] dsh exited - post-exit artifact cleanup ran\r
`);
      } catch {
      }
    } catch {
    }
  });
}
function apply(ctx, config = {}) {
  try {
    applyInner(ctx, config);
  } catch (error) {
    logFail(`[launcher] apply failed (harness continues): ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}
function applyInner(ctx, config = {}) {
  const home = process.env.USERPROFILE;
  if (!home) {
    logMsg("USERPROFILE missing; launcher cannot be installed");
    return;
  }
  const launcherDir = join(home, ".dsh-webui-launcher");
  const { logsDir, applySeq } = beginApplyLog(launcherDir);
  logMsg(`──────────────── apply #${applySeq} start (dsh pid=${process.pid}) ────────────────`);
  const applyT0 = Date.now();
  const elapsed = () => `+${Date.now() - applyT0}ms`;
  const dshVersion = detectDshVersion();
  if (dshVersion && !dshVersionGte(dshVersion, "0.1.5-rc.2")) {
    logMsg(`WARNING: dsh ${dshVersion} is below 0.1.5-rc.2 — this plugin is adapted and verified against 0.1.5-rc.2 (task notifications rely on its projections/services). Please upgrade: npm install -g @deepseek-ai/dsh@0.1.5-rc.2`);
  }
  logMsg(`dsh version: ${dshVersion || "(unknown)"}`);
  const { scope: settingsScope, cfg: resolvedCfg } = registerLauncherSettings(ctx, config, logMsg);
  logMsg(`timing: settings registered ${elapsed()}`);
  let cfg = resolvedCfg;
  const launchCommand = cfg.launchCommand ?? "dsh --profile web --no-open";
  const shortcutName = cfg.shortcutName ?? "DSH WebUI";
  const autoOpen = cfg.autoOpen !== false;
  const force = cfg.force === true;
  const port = cfg.port ?? 3080;
  const trayEnabled = cfg.tray !== false;
  const openMode = cfg.openMode ?? "app";
  const debounceSeconds = Math.max(5, Number(cfg.closeToExitDebounceSeconds ?? 20) || 20);
  const debounceMs = debounceSeconds * 1e3;
  const finalConfirmSeconds = Math.max(1, Number(cfg.closeToExitFinalConfirmSeconds ?? 2) || 2);
  const finalConfirmMs = finalConfirmSeconds * 1e3;
  let notificationModule = null;
  logEnvDiagnostics(launcherDir, cfg, logMsg);
  const vbsPath = join(launcherDir, "launcher.vbs");
  try {
    mkdirSync(launcherDir, { recursive: true });
    const trayPath = trayEnabled ? join(launcherDir, "tray.ps1") : null;
    const openScriptPath = join(launcherDir, "open-webui.ps1");
    const pwaAppId = findInstalledPwaAppId(port, launcherDir);
    logMsg(`environment: plugin=${"0.4.1"} node=${process.version} os=${os.type()} ${os.release()} (${os.arch()})`);
    logMsg(`environment: launcherDir=${launcherDir} pwaAppId=${pwaAppId ?? "(not installed — toast click will do nothing)"}`);
    logMsg(
      `priority: ${priorityName(priorityRaise.before)} -> ${priorityName(priorityRaise.after)}（模块导入于 node 启动后 ${priorityRaise.atUptimeMs}ms，系统节流点约 3000ms）`
    );
    logMsg(`timing: pwa scan done ${elapsed()}`);
    writeOpenScript(launcherDir, port, openMode, shortcutName, pwaAppId);
    writeLauncherFiles(launcherDir, launchCommand, port, trayPath, openScriptPath);
    if (trayEnabled) writeTrayScript(launcherDir, port, join(launcherDir, "dsh-webui.ico"), join(launcherDir, "open-webui.ps1"), pwaAppId);
    logMsg(`timing: launcher scripts written ${elapsed()}`);
  } catch (error) {
    logMsg(`launcher script failed: ${error}`);
  }
  let authUrlCaptured = false;
  const captureAuthUrl = () => {
    if (authUrlCaptured) return;
    try {
      const conn = ctx.connection;
      if (conn && typeof conn.authenticatedUrl === "function") {
        const authUrl = conn.authenticatedUrl(`http://127.0.0.1:${String(port)}`);
        if (typeof authUrl === "string" && authUrl.startsWith("http")) {
          writeWebuiUrl(launcherDir, authUrl, port, (/* @__PURE__ */ new Date()).toISOString());
          authUrlCaptured = true;
          logMsg("webui token url captured for open-webui.ps1");
        }
      }
    } catch (error) {
      logMsg(`webui token url capture deferred: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  captureAuthUrl();
  if (!authUrlCaptured) {
    try {
      const loader = ctx.get("loader");
      Promise.resolve(loader?.await?.()).then(captureAuthUrl, () => {
      });
    } catch {
    }
  }
  const iconPath = ensureIcon(launcherDir, logMsg);
  createDesktopShortcut(shortcutName, vbsPath, iconPath, force, launcherDir, logMsg);
  ensureStartupShortcut(shortcutName, vbsPath, iconPath, cfg.autoStartBoot === true, logMsg);
  const connection = ctx.connection;
  setupLauncherRpc({
    // 官方形状是 connection.rpc.handle——适配为窄面（connection 缺省时 undefined → 走兜底桥）
    connection: connection ? { handle: (channel, handler, opts) => connection.rpc.handle(channel, handler, opts) } : void 0,
    registerBridge: (channel, handler) => registerRpcFallbackBridge(ctx, channel, handler, logMsg, logFail),
    getService: (name2) => ctx.get(name2),
    settingsScope,
    config,
    launcherDir,
    vbsPath,
    iconPath,
    shortcutName,
    port,
    launchCommand,
    openMode,
    getNotificationModule: () => notificationModule,
    armExitCleanup,
    io: {
      nextSaveSeq,
      findInstalledPwaAppId,
      writeOpenScript,
      writeLauncherFiles,
      writeTrayScript,
      ensureIcon,
      createDesktopShortcut,
      extractPngDataUrl,
      resolveDesktopPath,
      logsDirOf,
      killExistingTrays,
      startTrayProcess,
      ensureStartupShortcut,
      startupLnkPath,
      readShortcutRegistry
    },
    logMsg,
    logWarn,
    logFail
  });
  registerPwaRoutes(ctx.webServer, launcherDir, iconPath, logMsg);
  if (trayEnabled) {
    try {
      const trayPath = join(launcherDir, "tray.ps1");
      if (existsSync(trayPath)) {
        const trayState = readTrayState(launcherDir);
        const runningVersion = trayState?.scriptVersion ?? 0;
        const probeCmd = [
          `Get-CimInstance Win32_Process -Filter "Name='powershell.exe' or Name='pwsh.exe'" -ErrorAction SilentlyContinue |`,
          `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
          "Measure-Object | Select-Object -ExpandProperty Count"
        ].join(" ");
        const probe = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", probeCmd], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          timeout: 1e4
        });
        const trayRunning = parseInt(String(probe.stdout ?? "").trim(), 10) > 0;
        logMsg(`tray process running: ${trayRunning} (versionFile=${runningVersion}, want=${TRAY_SCRIPT_VERSION})`);
        if (trayRunning && runningVersion !== TRAY_SCRIPT_VERSION) {
          logMsg(`tray version mismatch (running=${runningVersion}, want=${TRAY_SCRIPT_VERSION}), killing old tray`);
          try {
            const killCmd = [
              `Get-CimInstance Win32_Process -Filter "Name='powershell.exe' or Name='pwsh.exe'" -ErrorAction SilentlyContinue |`,
              `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('tray.ps1') -and $_.CommandLine.Contains('${launcherDir.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } |`,
              "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; 'killed:' + $_.ProcessId }"
            ].join(" ");
            const killResult = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", killCmd], {
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
              timeout: 1e4
            });
            logMsg(`old tray kill result: ${String(killResult.stdout ?? "").trim() || "(none)"} exit=${killResult.status}`);
          } catch (error) {
            logMsg(`old tray kill failed: ${error}`);
          }
          try {
            spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Milliseconds 1000"], {
              stdio: "ignore",
              windowsHide: true
            });
          } catch {
          }
          const afterKill = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", probeCmd], {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
          });
          let afterOut = "";
          afterKill.stdout?.on("data", (chunk) => {
            afterOut = String(afterOut + chunk).slice(-2e3);
          });
          afterKill.on("close", () => {
            logMsg(`after-kill probe: ${afterOut.trim() || "(empty)"} tray process(es) remain`);
          });
        } else if (trayRunning) {
          logMsg("tray already running (current version), skip spawn");
        } else {
          logMsg("no tray process, spawning fresh");
        }
        if (!trayRunning || runningVersion !== TRAY_SCRIPT_VERSION) {
          startTrayProcess(launcherDir, trayPath, cfg.traySurvivesDsh !== false, logMsg, logWarn, logFail);
        }
        logMsg(`timing: tray ensured ${elapsed()}`);
      }
    } catch (error) {
      logMsg(`tray spawn failed: ${error}`);
    }
  }
  setupModules({
    createPorts: () => createNotificationPorts(ctx, {
      launcherDir,
      log: logMsg,
      logWarn,
      logFail,
      // 托盘自身开关（modules.notifications 由容器 gating：模块不加载即无投递）
      isNotifySuppressed: () => cfg.trayNotify === false
    }),
    cfg,
    builtinModules: BUILTIN_MODULES,
    coreApiVersion: CORE_API_VERSION,
    onNotificationModule: (instance) => {
      notificationModule = instance;
    },
    logMsg,
    logWarn,
    logFail
  });
  logMsg(`timing: modules loaded ${elapsed()}`);
  const closeToExitHandle = setupCloseToExit({
    getService: (name2) => ctx.get(name2),
    webServer: ctx.webServer,
    enabled: config.closeToExit !== false && process.env.DSH_LAUNCHER === "1",
    cfg,
    launcherDir,
    debounceSeconds,
    debounceMs,
    finalConfirmSeconds,
    finalConfirmMs,
    killExistingTrays,
    logMsg,
    logWarn
  });
  if (!autoOpen || process.env.DSH_LAUNCHER !== "1") return;
  setupAutoOpen({
    getService: (name2) => ctx.get(name2),
    launcherDir,
    configPort: port,
    getClientsOnline: closeToExitHandle.getClientsOnline,
    logMsg
  });
}
export {
  apply,
  inject,
  name
};
