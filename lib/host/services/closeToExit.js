// src/host/services/closeToExit.ts
function setupCloseToExit(deps) {
  const { webServer, enabled, cfg, launcherDir, debounceSeconds, debounceMs, finalConfirmSeconds, finalConfirmMs, logMsg, logWarn } = deps;
  let clientsOnline = 0;
  try {
    const clients = /* @__PURE__ */ new Map();
    let exitTimer = null;
    let waitingForIdle = false;
    let idleProbe = null;
    let runningCount = 0;
    const countRunningAgents = () => {
      try {
        const agents = deps.getService("agents");
        const sessions = deps.getService("sessions");
        if (!agents || typeof agents.get !== "function" || !sessions || typeof sessions.list !== "function") return 0;
        let running = 0;
        for (const session of sessions.list()) {
          const agent = agents.get(session?.id ?? "");
          if (agent && agent.status === "running") running += 1;
        }
        return running;
      } catch (error) {
        logWarn(`[close-to-exit] running 探测失败（按 0 处理）：${error?.message ?? error}`);
        return 0;
      }
    };
    const agentsProbe = deps.getService("agents");
    runningCount = countRunningAgents();
    logMsg(`[close-to-exit] running 信号源：ctx.agents ${agentsProbe && typeof agentsProbe.get === "function" ? "ok" : "unavailable"}，当前 running=${runningCount}`);
    const armIdleProbe = () => {
      if (idleProbe) return;
      logMsg("[close-to-exit] 开始复查任务状态（每 5s 一次，仅等待期间）");
      idleProbe = setInterval(() => {
        const running = countRunningAgents();
        if (running > 0) return;
        disarmIdleProbe();
        logMsg("[close-to-exit] 任务已结束，重新评估退出");
        scheduleExitCheck("idle");
      }, 5e3);
    };
    const disarmIdleProbe = () => {
      if (idleProbe === null) return;
      clearInterval(idleProbe);
      idleProbe = null;
    };
    const scheduleExitCheck = (reason) => {
      runningCount = countRunningAgents();
      if (exitTimer) {
        logMsg(`[close-to-exit] schedule skipped (already pending, reason=${reason}): clients=${clients.size}, running=${runningCount}`);
        return;
      }
      logMsg(`[close-to-exit] schedule (${reason}): clients=${clients.size}, running=${runningCount}`);
      if (runningCount > 0) {
        waitingForIdle = true;
        logMsg(`[close-to-exit] tasks running (${runningCount}), waiting for idle (no timer)`);
        armIdleProbe();
        return;
      }
      logMsg(`[close-to-exit] no tasks, ${debounceSeconds}s debounce started`);
      exitTimer = setTimeout(() => {
        exitTimer = null;
        logMsg(`[close-to-exit] ${debounceSeconds}s elapsed: clients=${clients.size}, running=${runningCount}`);
        if (clients.size > 0) return;
        if (runningCount > 0) {
          waitingForIdle = true;
          logMsg("[close-to-exit] tasks still running, will exit when idle (waiting)");
          armIdleProbe();
          return;
        }
        logMsg(`[close-to-exit] idle, starting ${finalConfirmSeconds}s final confirm`);
        setTimeout(() => {
          runningCount = countRunningAgents();
          if (clients.size > 0 || runningCount > 0) {
            logMsg(`[close-to-exit] client/task reappeared (clients=${clients.size}, running=${runningCount}), exit cancelled`);
            if (runningCount > 0) {
              waitingForIdle = true;
              armIdleProbe();
            }
            return;
          }
          const appExit = deps.getService("appExit");
          logMsg("[close-to-exit] final confirm passed (clients=0, running=0) -> appExit(0)");
          if (cfg.traySurvivesDsh === false) {
            logMsg("[close-to-exit] traySurvivesDsh=false -> killing tray before exit");
            deps.killExistingTrays(launcherDir, logMsg);
          }
          if (typeof appExit === "function") {
            try {
              appExit(0);
            } catch (error) {
              logMsg(`[close-to-exit] appExit call failed: ${error}`);
            }
          } else {
            logMsg("[close-to-exit] appExit service unavailable");
          }
        }, finalConfirmMs);
      }, debounceMs);
    };
    const cancelExit = (reason) => {
      if (exitTimer) {
        clearTimeout(exitTimer);
        exitTimer = null;
        logMsg(`[close-to-exit] exit check cancelled (${reason}): clients=${clients.size}, running=${runningCount}`);
      }
      if (waitingForIdle) {
        waitingForIdle = false;
        disarmIdleProbe();
        logMsg(`[close-to-exit] waitingForIdle cleared (${reason}): clients=${clients.size}, running=${runningCount}`);
      }
    };
    const handleClient = (action) => (req, res) => {
      try {
        const u = new URL(req.url ?? "/", "http://localhost");
        const id = u.searchParams.get("client");
        res.writeHead(200, { "Content-Type": "application/json" });
        if (!id) {
          res.end('{"ok":false,"error":"missing client"}');
          return;
        }
        if (action === "online") {
          clients.set(id, true);
          cancelExit("online");
          clientsOnline = clients.size;
          logMsg(`[close-to-exit] online: ${id} (clients=${clients.size})`);
        } else {
          clients.delete(id);
          clientsOnline = clients.size;
          logMsg(`[close-to-exit] offline: ${id} (clients=${clients.size})`);
          if (clients.size === 0) scheduleExitCheck("offline");
        }
        res.end('{"ok":true}');
      } catch {
        try {
          res.writeHead(500);
          res.end('{"ok":false}');
        } catch {
        }
      }
    };
    webServer.register({ kind: "exact", path: "/native-launcher/online", handler: handleClient("online") });
    webServer.register({ kind: "exact", path: "/native-launcher/offline", handler: handleClient("offline") });
    logMsg(`[close-to-exit] armed (closeToExit=${enabled})`);
  } catch (error) {
    logMsg(`tray-notify/close-to-exit setup failed: ${error}`);
  }
  return { getClientsOnline: () => clientsOnline };
}
export {
  setupCloseToExit
};
