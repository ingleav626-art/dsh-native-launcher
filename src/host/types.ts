/**
 * 启动器 host 的共享类型（L0）。
 *
 * HostCtx 是官方 cordis ctx 的**窄面**：只声明本项目真正消费的形状，
 * 由组装根（src/host/index.ts）独占真 ctx 并翻译（架构规范〇·五「组装根独占 ctx」）。
 * 随 P2 各批推进逐块补全；形状以 0.1.5-rc.2 官方 .d.ts 实证为准（AGENTS.md 官方契约纪律）。
 */

/** 日志函数（host 统一 logMsg/logWarn/logFail 的窄签名，注入给 io 模块避免同层 import）。 */
export type LogFn = (msg: string) => void

/** 官方 SettingsScope 的消费侧窄面（get/update/watch 三件套，P1·S-C 实证；replace 为卸载重置路径）。 */
export interface SettingsScopeLike<T> {
  get(): T
  update(patch: Partial<T>): Promise<void>
  watch(listener: (next: T, prev: T) => void): () => void
  replace?(section: unknown): Promise<void>
}

/** 官方 settings 服务的消费侧窄面（register 返回 scope）。 */
export interface SettingsProviderLike {
  register<T>(namespace: string, schema: unknown, options: { base?: unknown }): SettingsScopeLike<T>
}

/** 官方 webServer 的消费侧窄面（PWA 路由 / RPC 兜底桥用）。 */
export interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void }) => void
  }): void
}

/**
 * 启动器设置形状（与 src/host/io/settings.ts 的 schemastery schema 字段一一对应）。
 * 全部可选：patch base、用户设置文档、合并结果的宽松度不同——消费端各自收紧。
 */
export interface LauncherConfig {
  launchCommand?: string
  port?: number
  shortcutName?: string
  autoOpen?: boolean
  openMode?: 'app' | 'new-window' | 'default'
  tray?: boolean
  traySurvivesDsh?: boolean
  trayNotify?: boolean
  closeToExit?: boolean
  closeToExitDebounceSeconds?: number
  closeToExitFinalConfirmSeconds?: number
  force?: boolean
  modules?: { notifications?: boolean }
}

/**
 * 官方 cordis ctx 的窄面（随批次补全——当前 B1 只消费 settings）。
 * 语义：字段存在 = 服务已注入且可用；可选 = 官方未注入时降级路径。
 */
export interface HostCtx {
  settings?: SettingsProviderLike
}
