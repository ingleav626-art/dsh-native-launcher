// 官方设置卡片 schema（rc.7+ settings.register）。
// 渲染端按 schemastery 结构自动生成表单；desc 即设置页文案。
// 默认值必须与 cordis.patch.yml 注释保持一致——patch base 覆盖默认值，用户文档再覆盖 patch。
import z from 'schemastery';

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
  trayNotify: z.boolean().default(true).description('任务完成/需要关注时弹系统托盘通知'),
  closeToExit: z.boolean().default(true).description('关闭语义：所有窗口关闭且无任务时自动退出服务（仅快捷方式启动生效）'),
  closeToExitDebounceSeconds: z.number().default(20).description('关窗后无任务的退出防抖秒数（最小 5）'),
  closeToExitFinalConfirmSeconds: z.number().default(2).description('退出前二次确认窗口秒数，防误杀重开请求（最小 1）'),
  force: z.boolean().default(false).description('启动时强制覆盖已存在的快捷方式'),
  modules: z.object({
    notifications: z.boolean().default(true).description('任务通知模块（WebUI 投影通知通道）'),
  }).default({ notifications: true }).description('可插拔功能模块'),
});
