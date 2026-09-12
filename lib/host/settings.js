// src/host/io/settings.ts
import z from "@deepseek-ai/schemastery";
var SETTINGS_NAMESPACE = "native-launcher";
var LAUNCHER_SETTINGS_SCHEMA = z.object({
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
});
function registerLauncherSettings(ctx, config, logMsg) {
  try {
    if (ctx.settings) {
      const scope = ctx.settings.register(SETTINGS_NAMESPACE, LAUNCHER_SETTINGS_SCHEMA, { base: config });
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
  LAUNCHER_SETTINGS_SCHEMA,
  SETTINGS_NAMESPACE,
  registerLauncherSettings
};
