// src/host/io/ports.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
function createNotifyPort(launcherDir, log, isSuppressed) {
  const file = join(launcherDir, "tray-notify.json");
  return {
    notify(notification) {
      if (typeof isSuppressed === "function" && isSuppressed()) {
        log(`[notify] suppressed by config (trayNotify=false): ${notification?.tag ?? ""}`);
        return;
      }
      const payload = {
        title: String(notification?.title ?? "任务完成").slice(0, 64),
        body: String(notification?.body ?? "").slice(0, 256),
        ts: Date.now(),
        // 常驻直到手动关闭（上游 requireInteraction 语义）：托盘据此用 scenario="reminder" 呈现
        persistent: notification?.persistent === true
      };
      writeFileSync(file, JSON.stringify(payload));
      log(`[notify] queued: ${payload.title} (${notification?.tag ?? ""})${payload.persistent ? " [persistent]" : ""}`);
    }
  };
}
function toSessionIdentity(session) {
  return { id: String(session?.id ?? ""), origin: session?.header?.origin, handle: session };
}
function createProjectionPort(ctx, log) {
  const seam = ctx?.sessionProjections;
  if (!seam || typeof seam.register !== "function") {
    throw new Error("sessionProjections 服务不可用（inject 未声明或版本不兼容）");
  }
  return {
    register: (definition) => seam.register(definition),
    onChanged: (listener) => {
      if (typeof seam.onChanged !== "function") {
        log("[notification] sessionProjections.onChanged 不可用——变更流未订阅");
        return () => {
        };
      }
      return seam.onChanged((session, key, value, seq) => listener(toSessionIdentity(session), key, value, seq));
    },
    snapshot: (session, keys) => {
      if (typeof seam.snapshot !== "function") return {};
      return seam.snapshot(session?.handle ?? session, keys) ?? {};
    }
  };
}
function createSessionsPort(ctx, log) {
  let store;
  try {
    store = ctx.get("sessions");
  } catch (error) {
    log("[notification] sessions 服务不可达（启动播种跳过，不影响投递）：" + (error instanceof Error ? error.message : String(error)));
    store = void 0;
  }
  const readTitle = (session) => {
    try {
      const values = ctx?.sessionProjections?.snapshot?.(session, ["title"]);
      const raw = values?.title;
      if (typeof raw === "string") return raw;
      if (raw && typeof raw === "object" && typeof raw.title === "string") return raw.title;
    } catch (error) {
      log(`[notification] title 投影读取失败（不影响投递）：${error instanceof Error ? error.message : String(error)}`);
    }
    return void 0;
  };
  const toSummary = (session, withTitle) => ({
    ...toSessionIdentity(session),
    ...withTitle ? { title: readTitle(session) } : {}
  });
  return {
    list: () => {
      if (typeof store?.list !== "function") {
        log("[notification] ctx.sessions.list 不可用——启动播种跳过");
        return [];
      }
      return store.list().map((session) => toSummary(session, false));
    },
    get: (id) => {
      if (typeof store?.get !== "function") return void 0;
      const session = store.get(id);
      return session === void 0 || session === null ? void 0 : toSummary(session, true);
    }
  };
}
function createSettingsScopeFactory(ctx, log) {
  return (namespace, schema, base) => {
    if (!ctx?.settings || typeof ctx.settings.register !== "function") {
      throw new Error("settings 服务不可用");
    }
    const scope = ctx.settings.register(namespace, schema, { base });
    log(`[notification] settings 已注册 ns=${namespace}`);
    return {
      get: () => scope.get(),
      update: (patch) => scope.update(patch),
      watch: (listener) => scope.watch(listener)
    };
  };
}
function createNotificationPorts(ctx, options) {
  const { launcherDir, log, logWarn, logFail, isNotifySuppressed } = options;
  return {
    logger: { info: log, warn: logWarn ?? log, fail: logFail ?? log },
    notify: createNotifyPort(launcherDir, log, isNotifySuppressed),
    projections: createProjectionPort(ctx, log),
    sessions: createSessionsPort(ctx, log),
    settingsScope: createSettingsScopeFactory(ctx, log)
  };
}
export {
  createNotificationPorts,
  createNotifyPort,
  createProjectionPort,
  createSessionsPort,
  createSettingsScopeFactory
};
