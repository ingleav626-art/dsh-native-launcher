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
function createLegacyScope(settings, ns, schema, base) {
  if (typeof settings.register !== "function") throw new Error("settings.register 不可用");
  const scope = settings.register(ns, schema, { base });
  const out = {
    get: () => scope.get(),
    update: (patch) => scope.update(patch),
    watch: (listener) => scope.watch(listener)
  };
  if (typeof scope.replace === "function") {
    out.replace = (section) => scope.replace(section);
  }
  return out;
}
export {
  MAIN_SETTINGS_ENTRY,
  SETTINGS_SUBPATH,
  createFormsScope,
  createLegacyScope,
  getSettingsService,
  isFormsMechanism,
  subPathOf
};
