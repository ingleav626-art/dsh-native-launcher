/**
 * 模块加载服务（容器协议 v2，dev-notes 一·七）——P2-B7a 自组装根迁入。
 *
 * 职责单一：遍历内置模块做 gating（config.modules[id] 开关，缺省用模块自带
 * defaultEnabled）+ apiVersion 护栏（不一致拒载）→ create(ports) → start()。
 * 端口由组装根注入的工厂创建（官方 ctx 只在组装根被触摸，本层只见端口工厂）；
 * 单模块失败只禁用该模块并记日志——绝不拖垮本体（铁律 1）。
 */
import type { LauncherConfig, LogFn } from '../types.ts';

/** 内置模块的容器侧形状：静态清单 + 工厂（端口形状由各模块 ports.ts 定义，容器以 unknown 传递）。 */
export interface BuiltinModule {
  readonly id: string
  readonly apiVersion: number
  readonly defaultEnabled: boolean
  readonly description?: string
  create(ports: unknown): { start(): unknown }
}

export interface SetupModulesDeps {
  /** 模块端口工厂：组装根闭包官方 ctx 与 launcherDir 后提供（本层不触碰 ctx）。 */
  createPorts: () => unknown
  /** 生效配置（modules 开关；trayNotify 抑制判定已在端口工厂内闭包）。 */
  cfg: LauncherConfig
  builtinModules: readonly BuiltinModule[]
  coreApiVersion: number
  /** notifications 模块实例回传（设置页 RPC 的 pending-report 转发要用）。 */
  onNotificationModule: (instance: { start(): unknown }) => void
  logMsg: LogFn
  logWarn: LogFn
  logFail: LogFn
}

export function setupModules(deps: SetupModulesDeps): void {
  const { createPorts, cfg, builtinModules, coreApiVersion, onNotificationModule, logMsg, logWarn, logFail } = deps;
  try {
    const moduleSwitches = cfg.modules ?? {};
    for (const mod of builtinModules) {
      const enabled = moduleSwitches[mod.id] ?? mod.defaultEnabled;
      // 决策日志带当时的开关实际值——排查"关了为什么还生效/开了为什么不生效"必须有这行
      if (!enabled) { logMsg(`[modules] ${mod.id}: disabled by config (modules.${mod.id}=${JSON.stringify(moduleSwitches[mod.id] ?? null)}), skip`); continue; }
      logMsg(`module ${mod.id}: enabled (modules.${mod.id}=${JSON.stringify(enabled)})`);
      const compat = typeof mod.apiVersion === 'number' && mod.apiVersion === coreApiVersion;
      if (!compat) { logMsg(`[modules] ${mod.id}: apiVersion ${mod.apiVersion} incompatible with core ${coreApiVersion}, refuse to load`); continue; }
      logMsg(`[modules] ${mod.id}: applying (core=v${coreApiVersion})`);
      const ports = createPorts();
      const instance = mod.create(ports);
      // start() 返回的 dispose 暂不持有：dsh 退出即回收（将来支持模块热重载时再收集）
      instance.start();
      if (mod.id === 'notifications') { onNotificationModule(instance); }
      logMsg(`[modules] ${mod.id}: applied`);
    }
  } catch (error) {
    logMsg(`module loading failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
}
