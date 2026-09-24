// src/host/io/settings.ts
import z from "@deepseek-ai/schemastery";

// src/host/io/settingsScope.ts
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

// src/host/io/settings.ts
var SETTINGS_NAMESPACE = "native-launcher";
var LAUNCHER_FIELDS = {
  launchCommand: z.string().default("dsh --profile web --no-open").description("桌面快捷方式执行的启动命令（需 PATH 里有 dsh）"),
  port: z.number().default(3080).description("WebUI 端口（需与 webserver 配置一致）"),
  shortcutName: z.string().default("DSH WebUI").description("桌面快捷方式名称"),
  autoOpen: z.boolean().default(true).description("快捷方式启动后自动打开浏览器（PWA 应用窗口优先）"),
  openMode: z.union([
    z.const("app").description("App 独立窗口（推荐）"),
    z.const("new-window").description("浏览器独立窗口"),
    z.const("default").description("浏览器默认行为")
  ]).default("app").description("浏览器打开方式"),
  tray: z.boolean().default(true).description("系统托盘（打开 WebUI / 任务通知 / 退出）"),
  traySurvivesDsh: z.boolean().default(true).description("托盘在 dsh 退出后保留（关 = 托盘随 dsh 一起退出，适合喜欢完全干净的用户）"),
  trayNotify: z.boolean().default(true).description("任务完成/需要关注时弹系统托盘通知"),
  closeToExit: z.boolean().default(true).description("关闭语义：所有窗口关闭且无任务时自动退出服务（仅快捷方式启动生效）"),
  closeToExitDebounceSeconds: z.number().default(20).description("关窗后无任务的退出防抖秒数（最小 5）"),
  closeToExitFinalConfirmSeconds: z.number().default(2).description("退出前二次确认窗口秒数，防误杀重开请求（最小 1）"),
  force: z.boolean().default(false).description("启动时强制覆盖已存在的快捷方式"),
  autoStartBoot: z.boolean().default(false).description("开机自动启动 DSH WebUI（在启动文件夹放快捷方式，效果等同开机双击桌面快捷方式）"),
  modules: z.object({
    notifications: z.boolean().default(true).description("任务通知模块（WebUI 投影通知通道）")
  }).default({ notifications: true }).description("可插拔功能模块")
};
var LAUNCHER_SETTINGS_SCHEMA = z.object(LAUNCHER_FIELDS);
async function registerLauncherSettings(ctx, config, logMsg) {
  const settings = getSettingsService(ctx);
  try {
    if (settings) {
      const scope = isFormsMechanism(settings) ? createFormsScope({ settings, ctx, ns: SETTINGS_NAMESPACE, base: config, log: logMsg }) : createLegacyScope(settings, SETTINGS_NAMESPACE, LAUNCHER_SETTINGS_SCHEMA, config);
      if (typeof scope.ready === "function") await scope.ready();
      const cfg = { ...config, ...scope.get() };
      logMsg(`[settings] registered ns=${SETTINGS_NAMESPACE} (resolved: port=${cfg.port}, launchCommand=${JSON.stringify(cfg.launchCommand)}, tray=${cfg.tray !== false}, traySurvivesDsh=${cfg.traySurvivesDsh !== false}, autoOpen=${cfg.autoOpen !== false}, openMode=${cfg.openMode ?? "app"}, autoStartBoot=${cfg.autoStartBoot === true}, force=${cfg.force === true}, modules=${JSON.stringify(cfg.modules)})`);
      scope.watch(() => logMsg("settings updated — restart dsh (double-click shortcut) to fully apply"));
      return { scope, cfg };
    }
    logMsg("settings service unavailable, using patch config only");
  } catch (error) {
    const err = error;
    logMsg(`settings register skipped: ${err?.message ?? error}`);
  }
  return { scope: null, cfg: config };
}
export {
  LAUNCHER_FIELDS,
  LAUNCHER_SETTINGS_SCHEMA,
  SETTINGS_NAMESPACE,
  registerLauncherSettings
};
