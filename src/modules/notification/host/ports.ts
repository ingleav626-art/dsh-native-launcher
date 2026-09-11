/**
 * 通知模块**消费者自持**的端口接口。
 *
 * 这是 split-ready 的判据（REFACTOR_PLAN 〇·五）：模块不 import 启动器内部实现，
 * 也不 import 官方包（`link:` 安装下 profile 树外解析不到）——只依赖本文件的窄面，
 * 由启动器组装根（L4）把官方 ctx 适配后注入。
 */
import type { SessionEventLike, TrayNotification } from '../shared/types.ts'

/** 投递端：启动器提供（托盘 Toast）；拆分独立时由 BrowserAdapter 顶替。 */
export interface NotifyPort {
  notify(notification: TrayNotification): void
}

/** 日志端口：启动器统一 logger（落 native-launcher.log，带分级与去重责任）。 */
export interface LoggerPort {
  info(message: string): void
  warn(message: string): void
  fail(message: string): void
}

/** 官方 settings 作用域的窄面（get / update / watch 三件套，0.1.5-rc.2 实证）。 */
export interface SettingsScopeLike<T> {
  get(): T
  update(patch: Partial<T>): Promise<void>
  watch(listener: (next: T, prev: T) => void): () => void
}

/** 作用域工厂：启动器经官方 `settings.register(ns, schema, { base })` 实现后注入。 */
export type SettingsScopeFactory = <T>(
  namespace: string,
  schema: unknown,
  base: Partial<T>,
) => SettingsScopeLike<T>

/** schema 的窄面：投影接缝只调用 `parse`（沙箱探针实证）。 */
export interface SchemaLike {
  parse(value: unknown): unknown
}

/** 投影定义（接缝消费者视角）：字段对齐官方 `ProjectionDefinition`。 */
export interface ProjectionDefinitionLike {
  readonly key: string
  readonly stateSchema: SchemaLike
  readonly init: () => unknown
  readonly apply: (state: unknown, event: SessionEventLike) => unknown
  readonly wire: {
    readonly viewSchema: SchemaLike
    readonly view: (state: unknown) => unknown
  }
  readonly stateVersion: number
}

/** 会话标识窄面：`onChanged` 回调里我们实际需要的字段。 */
export interface SessionIdentityLike {
  readonly id: string
  /** 会话来源；`subagent` 不上报（对齐上游 runner.ts）。 */
  readonly origin?: string
}

/** 投影接缝（官方 `ctx.sessionProjections` 的消费者视角）。 */
export interface ProjectionPort {
  register(definition: ProjectionDefinitionLike): void
  /**
   * 变更流订阅：每个 committed event、每个可见 unit 的 view 变化（Object.is）回调一次。
   * @returns 取消订阅函数。
   */
  onChanged(
    listener: (session: SessionIdentityLike, key: string, value: unknown, seq: number) => void,
  ): () => void
  /** 读面：取某会话指定键的当前投影值（用于启动播种）。 */
  snapshot(session: SessionIdentityLike, keys?: readonly string[]): Readonly<Record<string, unknown>>
}

/** 会话摘要窄面（通知决策需要的字段）。 */
export interface SessionSummaryLike {
  readonly id: string
  /** 会话来源；`subagent` 不上报。 */
  readonly origin?: string
  /** 会话标题（规则匹配与通知正文用）。 */
  readonly title?: string
}

/** 会话服务窄面（官方 `ctx.sessions` 的消费者视角，0.1.5-rc.2 已实证 `list` / `get`）。 */
export interface SessionsPort {
  list(): readonly SessionSummaryLike[]
  get(id: string): SessionSummaryLike | undefined
}
