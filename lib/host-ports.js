// src/host/io/ports.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// src/host/io/settingsScope.ts
var MAIN_SETTINGS_ENTRY = "native-launcher";
var SETTINGS_SUBPATH = {
  "native-launcher": [],
  "dsh-native-notification": ["notification"]
};
function subPathOf(ns) {
  return SETTINGS_SUBPATH[ns];
}
function isFormsMechanism(settings) {
  return !!settings && typeof settings.register !== "function" && typeof settings.describe === "function";
}
function getSettingsService(ctx) {
  try {
    return ctx.get("settings") ?? void 0;
  } catch {
    return void 0;
  }
}
function pickPath(value, path) {
  let node = value;
  for (const key of path) {
    if (node === null || typeof node !== "object") return void 0;
    node = node[key];
  }
  return node;
}
function nestPath(path, value) {
  let acc = value;
  for (let i = path.length - 1; i >= 0; i--) acc = { [path[i]]: acc };
  return acc ?? {};
}
function createFormsScope(options) {
  const { settings, ctx, ns, base, log } = options;
  const subPath = options.subPath ?? [];
  const readyTimeoutMs = options.readyTimeoutMs ?? 2e3;
  const readRow = () => {
    try {
      return settings.describe?.()?.find((row) => row.ns === ns);
    } catch (error) {
      log(`[settings] describe 失败（按 base 兜底）：${error instanceof Error ? error.message : String(error)}`);
      return void 0;
    }
  };
  const get = () => {
    const row = readRow();
    const live = row ? pickPath(row.value, subPath) : void 0;
    if (live !== void 0 && live !== null) return live;
    const fallback = pickPath(base, subPath);
    return fallback ?? base ?? {};
  };
  const update = async (patch) => {
    if (typeof settings.update !== "function") throw new Error("settings.update 不可用");
    await settings.update(ns, nestPath(subPath, patch));
  };
  const replace = async (section) => {
    if (subPath.length === 0) {
      if (typeof settings.replace !== "function") throw new Error("settings.replace 不可用");
      await settings.replace(ns, section ?? {});
      return;
    }
    await update(section ?? {});
  };
  const watch = (listener) => {
    try {
      const off = ctx.on?.("settings/document-updated", (...args) => {
        if (String(args[0] ?? "") !== ns) return;
        const next = get();
        listener(next, next);
      });
      return typeof off === "function" ? off : () => {
      };
    } catch (error) {
      log(`[settings] document-updated 订阅失败：${error instanceof Error ? error.message : String(error)}`);
      return () => {
      };
    }
  };
  const ready = () => new Promise((resolve) => {
    if (readRow() !== void 0) {
      resolve();
      return;
    }
    let settled = false;
    let timer;
    const done = () => {
      if (settled) return;
      settled = true;
      if (timer !== void 0) clearInterval(timer);
      resolve();
    };
    try {
      const off = ctx.on?.("settings/document-updated", (...args) => {
        if (String(args[0] ?? "") !== ns) return;
        if (typeof off === "function") off();
        done();
      });
    } catch {
    }
    timer = setInterval(() => {
      if (readRow() !== void 0) done();
    }, 100);
    setTimeout(done, readyTimeoutMs);
  });
  return { get, update, watch, replace, ready };
}

// src/host/io/ports.ts
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
      const rawSound = notification?.sound;
      if (rawSound === "none") {
        payload.sound = "none";
      } else if (rawSound !== null && typeof rawSound === "object" && typeof rawSound.path === "string" && rawSound.path.trim() !== "") {
        payload.sound = { path: rawSound.path };
      }
      const soundNote = payload.sound === void 0 ? "" : payload.sound === "none" ? " [sound=none]" : ` [sound=${payload.sound.path}]`;
      writeFileSync(file, JSON.stringify(payload));
      log(`[notify] queued: ${payload.title} (${notification?.tag ?? ""})${payload.persistent ? " [persistent]" : ""}${soundNote}`);
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
    const settings = getSettingsService(ctx);
    if (!settings) {
      throw new Error("settings 服务不可用");
    }
    if (isFormsMechanism(settings)) {
      const subPath = subPathOf(namespace);
      if (!subPath) {
        throw new Error(`settings ns "${namespace}" 在 0.1.7+ 无对应 profile entry`);
      }
      const scope2 = createFormsScope({
        settings,
        ctx,
        ns: MAIN_SETTINGS_ENTRY,
        base,
        subPath,
        log
      });
      log(`[notification] settings 已挂载（forms 机制）ns=${namespace} → entry=${MAIN_SETTINGS_ENTRY} 子段=[${subPath.join(".")}]`);
      return {
        get: () => scope2.get(),
        update: (patch) => scope2.update(patch),
        watch: (listener) => scope2.watch(listener)
      };
    }
    if (typeof settings.register !== "function") {
      throw new Error("settings 服务不可用");
    }
    const scope = settings.register(namespace, schema, { base });
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
