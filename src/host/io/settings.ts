/**
 * 启动器设置：官方设置卡片 schema（rc.7+ settings.register）+ 注册与配置解析（L2）。
 *
 * 渲染端按 schemastery 结构自动生成表单；desc 即设置页文案。
 * 默认值必须与 cordis.patch.yml 注释保持一致——patch base 覆盖默认值，用户文档再覆盖 patch。
 *
 * 有意差异（记账，P2-B1）：原 applyInner 内联的注册段抽成 registerLauncherSettings——
 * settingsScope 属主归本模块（REFACTOR_PLAN B1 表），打点文本逐字保留。
 */
import z from '@deepseek-ai/schemastery';
import type { LauncherConfig, LogFn, SettingsProviderLike, SettingsScopeLike } from '../types.ts';

export const SETTINGS_NAMESPACE = 'native-launcher';

export const LAUNCHER_SETTINGS_SCHEMA = z.object({
  launchCommand: z.string().default('dsh --profile web --no-open').description('桌面快捷方式执行的启动命令（需 PATH 里有 dsh）'),
  port: z.number().default(3080).description('WebUI 端口（需与 webserver 配置一致）'),
  shortcutName: z.string().default('DSH WebUI').description('桌面快捷方式名称'),
  autoOpen: z.boolean().default(true).description('快捷方式启动后自动打开浏览器（PWA 应用窗口优先）'),
  openMode: z.union([
    z.const('app').description('App 独立窗口（推荐）'),
    z.const('new-window').description('浏览器独立窗口'),
    z.const('default').description('浏览器默认行为'),
  ]).default('app').description('浏览器打开方式'),
  tray: z.boolean().default(true).description('系统托盘（打开 WebUI / 任务通知 / 退出）'),
  traySurvivesDsh: z.boolean().default(true).description('托盘在 dsh 退出后保留（关 = 托盘随 dsh 一起退出，适合喜欢完全干净的用户）'),
  trayNotify: z.boolean().default(true).description('任务完成/需要关注时弹系统托盘通知'),
  closeToExit: z.boolean().default(true).description('关闭语义：所有窗口关闭且无任务时自动退出服务（仅快捷方式启动生效）'),
  closeToExitDebounceSeconds: z.number().default(20).description('关窗后无任务的退出防抖秒数（最小 5）'),
  closeToExitFinalConfirmSeconds: z.number().default(2).description('退出前二次确认窗口秒数，防误杀重开请求（最小 1）'),
  force: z.boolean().default(false).description('启动时强制覆盖已存在的快捷方式'),
  modules: z.object({
    notifications: z.boolean().default(true).description('任务通知模块（WebUI 投影通知通道）'),
  }).default({ notifications: true }).description('可插拔功能模块'),
});

export interface LauncherSettingsRegistration {
  /** 官方 scope（用户改设置 → 官方持久化；config.get/set RPC 经它读写）。无 settings 服务时为 null。 */
  scope: SettingsScopeLike<LauncherConfig> | null
  /** 本次生效配置 = patch base（apply 入参）与官方 resolved 的合并。 */
  cfg: LauncherConfig
}

/**
 * 注册官方设置卡片并解析本次生效配置（rc.7+）。
 *
 * resolved = schema 默认值 → patch base（cordis.patch.yml）→ 用户设置文档。
 * 合并结果作为本次生效配置；用户改设置后需重启 dsh 完全生效（脚本/托盘/快捷方式都在 apply 时生成）。
 *
 * 容错（不拖垮本体）：重复注册（fiber 重载竞态）等异常 → 保留 patch 配置继续跑；
 * settings 服务未注入（旧版官方/异常环境）→ 同样只用 patch 配置。
 */
export function registerLauncherSettings(
  ctx: { settings?: SettingsProviderLike },
  config: LauncherConfig,
  log: LogFn,
): LauncherSettingsRegistration {
  try {
    if (ctx.settings) {
      const scope = ctx.settings.register<LauncherConfig>(SETTINGS_NAMESPACE, LAUNCHER_SETTINGS_SCHEMA, { base: config });
      const cfg: LauncherConfig = { ...config, ...scope.get() };
      log(`[settings] registered ns=${SETTINGS_NAMESPACE} (resolved: port=${cfg.port}, launchCommand=${JSON.stringify(cfg.launchCommand)}, tray=${cfg.tray !== false}, traySurvivesDsh=${cfg.traySurvivesDsh !== false}, modules=${JSON.stringify(cfg.modules)})`);
      scope.watch(() => log('settings updated — restart dsh (double-click shortcut) to fully apply'));
      return { scope, cfg };
    }
    log('settings service unavailable, using patch config only');
  } catch (error) {
    // 重复注册（fiber 重载竞态）等场景：保留 patch 配置继续跑，不拖垮本体
    // 取值口径与原实现逐字等价：优先 message 属性，否则值本身（严格 TS 下 catch 入参是 unknown）
    const err = error as { message?: string };
    log(`settings register skipped: ${err?.message ?? error}`);
  }
  return { scope: null, cfg: config };
}
