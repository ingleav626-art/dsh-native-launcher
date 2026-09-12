// src/host/services/launcherRpc.ts
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
function setupLauncherRpc(deps) {
  const { launcherDir, logMsg, logWarn, logFail, io } = deps;
  const nativeLauncherRpcHandler = async (endpoint, _payload) => {
    switch (endpoint) {
      case "config.get": {
        const live = deps.settingsScope ? { ...deps.config, ...deps.settingsScope.get() } : deps.config;
        return {
          ok: true,
          value: {
            launchCommand: live.launchCommand ?? "dsh --profile web --no-open",
            shortcutName: live.shortcutName ?? "DSH WebUI",
            autoOpen: live.autoOpen !== false,
            force: live.force === true,
            port: live.port ?? 3080,
            tray: live.tray !== false,
            trayNotify: live.trayNotify !== false,
            traySurvivesDsh: live.traySurvivesDsh !== false,
            openMode: live.openMode ?? "app",
            closeToExit: live.closeToExit !== false,
            closeToExitDebounceSeconds: Math.max(5, Number(live.closeToExitDebounceSeconds ?? 20) || 20),
            closeToExitFinalConfirmSeconds: Math.max(1, Number(live.closeToExitFinalConfirmSeconds ?? 2) || 2),
            modules: live.modules ?? {},
            settingsAvailable: !!deps.settingsScope,
            launcherDir,
            vbsPath: deps.vbsPath,
            iconPath: deps.iconPath,
            shortcutExists: existsSync(join(io.resolveDesktopPath() ?? "", `${live.shortcutName ?? deps.shortcutName}.lnk`))
          }
        };
      }
      case "config.set": {
        if (!deps.settingsScope) {
          logFail("[settings] config.set rejected: settings service unavailable");
          return { ok: false, error: { code: "config", message: "settings service unavailable", details: {} } };
        }
        ;
        try {
          const seq = `save#${io.nextSaveSeq()}`;
          const payload = _payload;
          const values = (payload && payload.values) ?? {};
          logMsg(`[settings] ${seq} begin, raw values: ${JSON.stringify(values)}`);
          const patch = {};
          if (values.launchCommand !== void 0) {
            const lc = String(values.launchCommand).trim();
            if (lc) patch.launchCommand = lc;
          }
          if (values.shortcutName !== void 0) {
            const sn = String(values.shortcutName).trim().replace(/[\\/:*?"<>|]/g, "_");
            if (sn) patch.shortcutName = sn.slice(0, 80);
          }
          if (values.port !== void 0) patch.port = Math.min(65535, Math.max(1, Math.floor(Number(values.port) || 3080)));
          if (values.autoOpen !== void 0) patch.autoOpen = !!values.autoOpen;
          if (values.tray !== void 0) patch.tray = !!values.tray;
          if (values.trayNotify !== void 0) patch.trayNotify = !!values.trayNotify;
          if (values.closeToExit !== void 0) patch.closeToExit = !!values.closeToExit;
          if (values.closeToExitDebounceSeconds !== void 0) patch.closeToExitDebounceSeconds = Math.min(3600, Math.max(5, Math.floor(Number(values.closeToExitDebounceSeconds) || 20)));
          if (values.closeToExitFinalConfirmSeconds !== void 0) patch.closeToExitFinalConfirmSeconds = Math.min(60, Math.max(1, Math.floor(Number(values.closeToExitFinalConfirmSeconds) || 2)));
          if (values.openMode !== void 0) patch.openMode = ["app", "new-window", "default"].includes(values.openMode) ? values.openMode : "app";
          if (values.force !== void 0) patch.force = !!values.force;
          if (values.traySurvivesDsh !== void 0) patch.traySurvivesDsh = !!values.traySurvivesDsh;
          if (values.autoStartBoot !== void 0) patch.autoStartBoot = !!values.autoStartBoot;
          if (values.modules && typeof values.modules === "object") {
            patch.modules = { notifications: values.modules.notifications !== false };
          }
          deps.settingsScope.update(patch);
          const prevValues = deps.settingsScope.get() ?? {};
          const changedKeys = Object.keys(patch).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(prevValues[k]));
          if (changedKeys.length === 0) {
            logMsg(`[settings] ${seq} no actual change, nothing to apply`);
            return { ok: true, value: { message: "配置无变化，无需保存" } };
          }
          logMsg(`[settings] ${seq} validated patch (changed: [${changedKeys.join(", ")}]): ${JSON.stringify(patch)}`);
          let restartHint = "已保存 — 重启 dsh（双击桌面快捷方式）后完全生效";
          try {
            const fresh = { ...deps.config, ...deps.settingsScope.get(), ...patch };
            const fPort = fresh.port ?? deps.port;
            const fShortcutName = fresh.shortcutName ?? deps.shortcutName;
            const fOpenMode = fresh.openMode ?? deps.openMode;
            const fTrayEnabled = fresh.tray !== false;
            const fSurvives = fresh.traySurvivesDsh !== false;
            logMsg(`[settings] ${seq} hot-apply with merged config (port=${fPort}, shortcutName=${JSON.stringify(fShortcutName)}, openMode=${fOpenMode}, tray=${fTrayEnabled}, traySurvivesDsh=${fSurvives})`);
            const pwaId = io.findInstalledPwaAppId(fPort, launcherDir);
            mkdirSync(launcherDir, { recursive: true });
            io.writeOpenScript(launcherDir, fPort, String(fOpenMode), fShortcutName, pwaId);
            io.writeLauncherFiles(launcherDir, fresh.launchCommand ?? deps.launchCommand, fPort, fTrayEnabled ? join(launcherDir, "tray.ps1") : null, join(launcherDir, "open-webui.ps1"));
            if (fTrayEnabled) io.writeTrayScript(launcherDir, fPort, join(launcherDir, "dsh-webui.ico"), join(launcherDir, "open-webui.ps1"), pwaId);
            if (changedKeys.includes("shortcutName")) {
              const oldName = String(prevValues.shortcutName ?? "").trim();
              if (oldName && oldName !== fShortcutName) {
                const oldLnk = join(io.resolveDesktopPath() ?? "", `${oldName}.lnk`);
                if (existsSync(oldLnk)) {
                  try {
                    unlinkSync(oldLnk);
                    logMsg(`[settings] ${seq} removed renamed-away shortcut: ${oldLnk}`);
                  } catch (e) {
                    logWarn(`[settings] ${seq} failed to remove old shortcut ${oldLnk}: ${e}`);
                  }
                }
              }
            }
            io.createDesktopShortcut(fShortcutName, deps.vbsPath, io.ensureIcon(launcherDir, logMsg), false, launcherDir, logMsg);
            if (changedKeys.includes("autoStartBoot")) {
              io.ensureStartupShortcut(fShortcutName, deps.vbsPath, io.ensureIcon(launcherDir, logMsg), fresh.autoStartBoot === true, logMsg);
            }
            logMsg(`[settings] ${seq} hot-apply: artifacts regenerated ok`);
            const TRAY_RELATED = ["tray", "traySurvivesDsh", "port", "openMode"];
            const trayChanged = changedKeys.filter((k) => TRAY_RELATED.includes(k));
            if (trayChanged.length > 0) {
              logMsg(`[settings] ${seq} tray-affecting fields changed [${trayChanged.join(", ")}] -> restarting tray (survives=${fSurvives})`);
              io.killExistingTrays(launcherDir, logMsg);
              if (fTrayEnabled) io.startTrayProcess(launcherDir, join(launcherDir, "tray.ps1"), fSurvives, logMsg, logWarn, logFail);
              else logMsg("[settings] tray disabled by config, not respawning");
              restartHint = "已保存并即时应用（托盘已按新配置重启）— 关闭语义等运行参数仍建议重启一次";
            } else {
              logMsg(`[settings] ${seq} no tray-affecting change, skip tray restart`);
            }
          } catch (error) {
            logFail(`[settings] ${seq} hot-apply FAILED after save (config persisted, restart dsh to recover): ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            restartHint = "已保存，但自动应用失败——重启 dsh 即可恢复一致";
          }
          return { ok: true, value: { message: restartHint } };
        } catch (error) {
          logFail(`[settings] config.set failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
          return { ok: false, error: { code: "config", message: String(error.message ?? error), details: {} } };
        }
      }
      case "shortcut.recreate": {
        const liveName = deps.settingsScope ? deps.settingsScope.get().shortcutName ?? deps.shortcutName : deps.shortcutName;
        io.createDesktopShortcut(liveName, deps.vbsPath, deps.iconPath, true, launcherDir, logMsg);
        const lnk = join(io.resolveDesktopPath() ?? "", `${liveName}.lnk`);
        return { ok: true, value: { message: `shortcut recreated: ${lnk}`, shortcutExists: existsSync(lnk) } };
      }
      case "icon.get": {
        const dataUrl = io.extractPngDataUrl(deps.iconPath);
        return dataUrl ? { ok: true, value: { dataUrl } } : { ok: false, error: { code: "icon", message: "icon extract failed", details: {} } };
      }
      case "ntf-log":
        logMsg(`[ntf] ${JSON.stringify(_payload ?? {})}`);
        return { ok: true };
      case "diagnostics.openLogs": {
        const logDir = io.logsDirOf(launcherDir);
        try {
          mkdirSync(logDir, { recursive: true });
          spawn("explorer.exe", [logDir], { detached: true, stdio: "ignore" }).unref();
          logMsg(`[diagnostics] 已打开日志目录：${logDir}`);
          return { ok: true, value: { path: logDir } };
        } catch (error) {
          logFail(`[diagnostics] 打开日志目录失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
          return { ok: false, error: { code: "diagnostics", message: String(error), details: {} } };
        }
      }
      case "presence-report": {
        const mod = deps.getNotificationModule();
        if (!mod) return { ok: false, error: { code: "presence", message: "notification module not loaded", details: {} } };
        const presenceAccepted = mod.reportPresence(_payload ?? {});
        return presenceAccepted ? { ok: true } : { ok: false, error: { code: "presence", message: "report rejected (invalid shape)", details: {} } };
      }
      case "notification.test": {
        const mod = deps.getNotificationModule();
        if (!mod) return { ok: false, error: { code: "notification", message: "notification module not loaded", details: {} } };
        return mod.testNotify() ? { ok: true } : { ok: false, error: { code: "notification", message: "test notify delivery failed", details: {} } };
      }
      case "launcher.uninstall": {
        const ULOG = join(io.logsDirOf(launcherDir), "uninstall.log");
        const logU = (level, msg) => {
          try {
            const d = /* @__PURE__ */ new Date();
            const p = (n, w = 2) => String(n).padStart(w, "0");
            const line = `[${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}] [${level.padEnd(5)}] ${msg}`;
            appendFileSync(ULOG, line + "\r\n");
            logMsg(`[uninstall] ${msg}`);
          } catch {
          }
        };
        const steps = [];
        const manual = [];
        const addStep = (msg) => {
          steps.push(msg);
          logU("INFO", msg);
        };
        const addFail = (msg) => {
          steps.push(msg);
          logU("ERROR", msg);
        };
        const manualAdd = (msg) => {
          manual.push(msg);
          logU("MANUAL", msg);
        };
        const payload = _payload;
        const clearSettings = !!(payload && payload.clearSettings);
        const stopAfter = !(payload && payload.stopAfter === false);
        logU("INFO", `════ uninstall session start (dsh pid=${process.pid}, launcherDir=${launcherDir}, clearSettings=${clearSettings}, stopAfter=${stopAfter}) ════`);
        if (clearSettings && deps.settingsScope?.replace) {
          try {
            await deps.settingsScope.replace({});
            addStep("已清除本插件的全部个性化配置（settings.yaml 中 native-launcher 段已重置）");
            logU("INFO", "STEP 0/5 settings-reset: user section replaced with {} - reverts to base/defaults");
          } catch (error) {
            addFail(`清除配置失败（不影响卸载本身）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            manualAdd("个性化配置自动清除失败——如需重置，手动编辑 E:\\dsh\\settings.yaml 删除 native-launcher 段");
          }
        } else if (!deps.settingsScope) {
          logWarn("[uninstall] settingsScope unavailable, cannot honor clearSettings");
        }
        logU("INFO", "STEP 1/5 tray-kill: begin");
        try {
          const ps = spawnSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'tray\\.ps1' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null; $_.ProcessId }`
            ],
            { encoding: "utf8", windowsHide: true }
          );
          const killed = String(ps.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          addStep(killed.length ? `已停止托盘进程: PID ${killed.join(", ")}` : "没有运行中的托盘进程");
          logU("INFO", `STEP 1/5 tray-kill: taskkill exit=${ps.status}, pids=[${killed.join(",")}]${ps.stderr ? `, stderr=${String(ps.stderr).trim().slice(0, 200)}` : ""}`);
        } catch (error) {
          addFail(`停止托盘失败（继续）: ${error}`);
        }
        try {
          const desktop = io.resolveDesktopPath() ?? "";
          const targets = /* @__PURE__ */ new Set();
          const regFile = join(launcherDir, "shortcut-registry.txt");
          try {
            if (existsSync(regFile)) {
              for (const line of readFileSync(regFile, "utf-8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) targets.add(line);
            }
          } catch {
          }
          const liveCfgU = deps.settingsScope ? deps.settingsScope.get() ?? {} : {};
          const liveShortcutName = String(liveCfgU.shortcutName || "").trim() || deps.shortcutName;
          if (desktop) targets.add(join(desktop, `${liveShortcutName}.lnk`));
          let removedLnk = 0;
          const failedLnks = [];
          for (const t of targets) {
            if (!t || !existsSync(t)) continue;
            try {
              unlinkSync(t);
              removedLnk++;
              logU("INFO", `STEP 2/5 removed: ${t}`);
            } catch (e) {
              failedLnks.push(t);
              const code = e.code ?? "?";
              const busy = code === "EBUSY";
              logU("ERROR", `STEP 2/5 shortcut delete FAILED: ${t} code=${code} :: ${e?.message ?? e}${busy ? " (hint: file locked - retry after restarting explorer)" : ""}`);
            }
          }
          addStep(removedLnk > 0 ? `已删除 ${removedLnk} 个桌面快捷方式${failedLnks.length ? `（${failedLnks.length} 个失败，详见 uninstall.log）` : ""}` : "桌面无本插件快捷方式（跳过）");
          logU("INFO", `STEP 2/5 shortcut removal summary: removed=${removedLnk}, failed=${failedLnks.length}, candidates=[${Array.from(targets).join(" ; ")}]`);
        } catch (error) {
          addFail(`删除快捷方式失败（继续）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }
        try {
          logU("INFO", "STEP 3/5 artifacts: begin (uninstall.log is exempt from this list)");
          const artifacts = [
            "launch.cmd",
            "launcher.vbs",
            "tray.ps1",
            "open-webui.ps1",
            "dsh-webui.ico",
            join("logs", "native-launcher.log"),
            join("logs", "native-launcher.prev.log"),
            join("logs", "launch.log"),
            join("logs", "tray-exit.log"),
            join("logs", "tray-notify.log"),
            join("logs", "pwa-scan.log"),
            join("logs", "open-webui.log"),
            join("logs", "test-results.log"),
            "tray-notify.json",
            "tray-version.txt"
          ];
          let removed = 0;
          const failedFiles = [];
          for (const name of artifacts) {
            const p = join(launcherDir, name);
            if (!existsSync(p)) continue;
            try {
              unlinkSync(p);
              removed++;
            } catch (e) {
              failedFiles.push(name);
              const code = e.code ?? "?";
              const hint = code === "EBUSY" ? "file locked by a running process - will be removable after dsh restarts" : code === "EPERM" || code === "EACCES" ? "permission denied - check file attributes/ACL" : code === "ENOENT" ? "already gone" : "unexpected error";
              logU("ERROR", `STEP 3/5 artifact delete FAILED: ${name} code=${code} syscall=${e.syscall ?? "-"} :: ${e?.message ?? e} (hint: ${hint})`);
            }
          }
          addStep(failedFiles.length ? `已清理生成物 ${removed} 个文件，${failedFiles.length} 个失败（${failedFiles.join(", ")}，详见 uninstall.log）` : `已清理生成物 ${removed} 个文件`);
          logU("INFO", `STEP 3/5 artifacts summary: removed=${removed}, failed=[${failedFiles.join(", ") || "none"}]`);
        } catch (error) {
          addFail(`清理生成物失败（继续）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }
        try {
          logU("INFO", "STEP 4/5 registry: remove HKCU\\...\\AppUserModelId\\DshNativeLauncher");
          const reg = spawnSync(
            "powershell",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$p = 'HKCU:\\Software\\Classes\\AppUserModelId\\DshNativeLauncher'; if (-not (Test-Path $p)) { Write-Output 'absent'; exit 2 }; Remove-Item $p -Recurse -Force -ErrorAction Stop; if (Test-Path $p) { exit 1 }; Write-Output 'deleted'; exit 0`
            ],
            { encoding: "utf8", windowsHide: true }
          );
          const regOut = String((reg.stdout ?? "") + " " + (reg.stderr ?? "")).trim();
          if (reg.status === 0) {
            addStep("已删除通知标识注册表项 (AUMID DshNativeLauncher)");
            logU("INFO", `STEP 4/5 registry: deleted${regOut ? " :: " + regOut.slice(0, 200) : ""}`);
          } else if (reg.status === 2 || /absent/i.test(regOut)) {
            addStep("通知注册表项不存在（跳过）");
            logU("INFO", `STEP 4/5 registry: key absent, skip`);
          } else {
            addStep(`注册表删除退出码 ${reg.status}（详见 uninstall.log）`);
            logU("ERROR", `STEP 4/5 registry FAILED: exit=${reg.status} output=${regOut.slice(0, 300)} (hint: access denied means run dsh as the same user that created the key)`);
          }
        } catch (error) {
          addFail(`清理注册表失败（继续）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }
        try {
          const sLnk = io.startupLnkPath(deps.shortcutName);
          if (existsSync(sLnk)) {
            try {
              unlinkSync(sLnk);
              addStep("已删除开机自启快捷方式（启动文件夹）");
              logU("INFO", `STEP 4/5 startup shortcut removed: ${sLnk}`);
            } catch (e) {
              addStep(`开机自启快捷方式删除失败（继续）: ${e instanceof Error ? e.message : String(e)}`);
              logU("WARN", `STEP 4/5 startup shortcut remove failed: ${e}`);
            }
          } else {
            logU("INFO", "STEP 4/5 startup shortcut absent, skip");
          }
        } catch (error) {
          addFail(`清理开机自启失败（继续）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }
        try {
          logU("INFO", "STEP 4/5 registry: remove HKCU\\...\\Classes\\dsh-webui");
          const reg2 = spawnSync(
            "powershell",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$p = 'HKCU:\\Software\\Classes\\dsh-webui'; if (-not (Test-Path $p)) { Write-Output 'absent'; exit 2 }; Remove-Item $p -Recurse -Force -ErrorAction Stop; if (Test-Path $p) { exit 1 }; Write-Output 'deleted'; exit 0`
            ],
            { encoding: "utf8", windowsHide: true }
          );
          const reg2Out = String((reg2.stdout ?? "") + " " + (reg2.stderr ?? "")).trim();
          if (reg2.status === 0) {
            addStep("已删除 dsh-webui: 协议注册表项");
            logU("INFO", `STEP 4/5 registry: deleted dsh-webui${reg2Out ? " :: " + reg2Out.slice(0, 200) : ""}`);
          } else if (reg2.status === 2 || /absent/i.test(reg2Out)) {
            addStep("dsh-webui: 协议注册表项不存在（跳过）");
            logU("INFO", `STEP 4/5 registry: dsh-webui key absent, skip`);
          } else {
            addStep(`dsh-webui: 协议删除退出码 ${reg2.status}（详见 uninstall.log）`);
            logU("WARN", `STEP 4/5 registry dsh-webui FAILED: exit=${reg2.status} output=${reg2Out.slice(0, 300)}`);
          }
        } catch (error) {
          addFail(`清理 dsh-webui 协议失败（继续）: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }
        try {
          logU("INFO", "STEP 5/5 profile-edit: scanning profiles for dsh-native-launcher entries");
          const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? "", ".dsh");
          const profilesRoot = join(home, "profiles");
          let touched = false;
          if (existsSync(profilesRoot)) {
            for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
              if (!entry.isDirectory()) continue;
              const pkgPath = join(profilesRoot, entry.name, "package.json");
              if (!existsSync(pkgPath)) continue;
              let pkg;
              try {
                pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
              } catch {
                continue;
              }
              const depsMap = pkg.dependencies ?? {};
              const spec = depsMap["dsh-native-launcher"];
              if (!spec) continue;
              copyFileSync(pkgPath, `${pkgPath}.before-uninstall`);
              logU("INFO", `STEP 5/5 profile-edit: backup written to ${pkgPath}.before-uninstall`);
              delete depsMap["dsh-native-launcher"];
              if (Array.isArray(pkg.dsh?.profile?.bundles)) {
                pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== "dsh-native-launcher");
              }
              writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
              touched = true;
              logU("INFO", `STEP 5/5 profile-edit: "${entry.name}" package.json rewritten (deps entry + bundles filtered)`);
              addStep(`已从 profile "${entry.name}" 移除插件条目（备份: package.json.before-uninstall）`);
              if (String(spec).startsWith("link:")) {
                addStep("检测到开发链接安装（link:），插件源码目录已保留未删除");
                logU("INFO", "link-install detected: source directory preserved (never deleted)");
              }
              const linkPath = join(profilesRoot, entry.name, "node_modules", "dsh-native-launcher");
              if (existsSync(linkPath)) {
                try {
                  unlinkSync(linkPath);
                  steps.push("已断开 node_modules 插件链接");
                } catch (e) {
                  manual.push(`未能移除 ${linkPath}（可手动删除或在该 profile 目录执行包管理器安装命令清理）: ${e}`);
                }
              }
            }
          }
          if (!touched) manual.push('未在 $DSH_HOME/profiles 找到本插件的安装条目——若装在其他 profile，请手动从其 package.json 移除 "dsh-native-launcher"');
        } catch (error) {
          manual.push('自动移除 profile 条目失败，请手动编辑 profiles/<name>/package.json 删除 "dsh-native-launcher"（dependencies 与 dsh.profile.bundles 两处）: ' + error);
        }
        try {
          const home2 = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? "", ".dsh");
          const profilesRoot2 = join(home2, "profiles");
          if (existsSync(profilesRoot2)) {
            for (const entry of readdirSync(profilesRoot2, { withFileTypes: true })) {
              if (!entry.isDirectory()) continue;
              const dir = join(profilesRoot2, entry.name);
              const pkgPath = join(dir, "package.json");
              try {
                if (!existsSync(pkgPath)) continue;
                const rawPkg = readFileSync(pkgPath, "utf-8");
                if (!rawPkg.includes('"dsh-native-launcher"') && !existsSync(join(dir, "node_modules", "dsh-native-launcher"))) continue;
                for (const lf of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
                  if (existsSync(join(dir, lf))) {
                    manual.push(`profile "${entry.name}" 的 ${lf} 仍含本插件条目（我们绝不自动改动你的包管理文件）——重启若报依赖错误，请在该目录自行执行一次安装命令即可修正`);
                    break;
                  }
                }
              } catch {
              }
            }
          }
        } catch {
        }
        manualAdd('如安装过 PWA 应用：浏览器 edge://apps 中手动卸载"DSH WebUI"');
        manualAdd("范围说明：本次卸载仅移除桌面化增强组件，dsh 服务本身与数据不受影响。如需连 dsh 一起移除：npm uninstall -g @deepseek-ai/dsh（会话与设置等个人数据请先自行备份）");
        deps.armExitCleanup(launcherDir);
        manual.push("重启 dsh 后卸载完全生效（启动器不会再生成任何内容）；诊断日志保留在 .dsh-webui-launcher\\logs\\uninstall.log 供排查，确认无误后可手动删除整个目录");
        logU("INFO", "exit hook armed: functional artifacts will be removed when dsh stops; uninstall.log preserved");
        if (stopAfter) {
          setTimeout(() => {
            try {
              logU("INFO", "auto-stop: calling appExit(0)");
              const appExit = deps.getService("appExit");
              if (typeof appExit === "function") {
                appExit(0);
                logU("INFO", "auto-stop: appExit(0) issued");
              } else logFail("[uninstall] auto-stop failed: appExit service unavailable");
            } catch (e) {
              logFail(`[uninstall] auto-stop failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
            }
          }, 6e3);
          addStep("dsh 服务将在约 6 秒后自动停止（托盘已先行停止）");
        }
        logU("INFO", `════ uninstall session end — steps=${steps.length}, manual=${manual.length} ════`);
        logMsg(`[uninstall] done: ${steps.join(" | ")}`);
        return { ok: true, value: { steps, manual } };
      }
      case "pending-report": {
        const mod = deps.getNotificationModule();
        if (!mod) return { ok: false, error: { code: "pending", message: "notification module not loaded", details: {} } };
        const accepted = mod.reportPending(_payload ?? {});
        return accepted ? { ok: true } : { ok: false, error: { code: "pending", message: "report rejected (invalid shape)", details: {} } };
      }
      case "notification.get": {
        const mod = deps.getNotificationModule();
        if (!mod) return { ok: false, error: { code: "notification", message: "notification module not loaded", details: {} } };
        const notificationSettings = mod.getSettings();
        return notificationSettings === void 0 ? { ok: false, error: { code: "notification", message: "settings not ready", details: {} } } : { ok: true, value: notificationSettings };
      }
      case "notification.set": {
        const mod = deps.getNotificationModule();
        if (!mod) return { ok: false, error: { code: "notification", message: "notification module not loaded", details: {} } };
        const notificationPatch = _payload && _payload.patch || {};
        const notificationApplied = await mod.updateSettings(notificationPatch);
        return notificationApplied ? { ok: true } : { ok: false, error: { code: "notification", message: "update rejected (invalid rules or settings unavailable)", details: {} } };
      }
      default:
        return { ok: false, error: { code: "unknown", message: `unknown endpoint: ${endpoint}`, details: {} } };
    }
  };
  try {
    deps.connection.handle("/native-launcher", nativeLauncherRpcHandler, { authority: "trusted-host" });
    logMsg("[rpc] /native-launcher registered via connection.rpc.handle");
  } catch (error) {
    const rpcErr = error;
    logMsg(`[rpc] connection.rpc.handle failed: ${rpcErr?.message ?? error} — activating webServer bridge fallback`);
    deps.registerBridge("/native-launcher", nativeLauncherRpcHandler);
  }
}
export {
  setupLauncherRpc
};
