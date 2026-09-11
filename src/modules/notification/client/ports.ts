/**
 * 通知模块 **client 半区**自持的端口接口（与 `host/ports.ts` 同一思路，split-ready 的判据）。
 *
 * 模块不 import 启动器内部实现、也不 import 官方 client 包——官方 client 服务的形状
 * （`ctx.connection.rpc` / `ctx.slots` / `ctx.sessions` / `ctx.uiSession`）只在启动器的
 * client 组装根（`src/client/module-faces.ts`）被触摸并翻译成本文件的窄面。
 *
 * 拆出为独立插件时：模块自带 `client/index.ts` 由官方 loader 拉起，届时自己接 `ctx` 构造同样的面。
 */
import type { NotificationSettings, PendingKind } from '../shared/types.ts'

/** 一节设置卡片的注册参数（启动器转发给官方 `settings.section` 槽位）。 */
export interface SettingsSectionDescriptor {
  /** 槽位内唯一 id（与启动器卡片并列，不能撞）。 */
  readonly id: string
  /** 排序位（启动器卡片为 30，本卡片紧随其后）。 */
  readonly order: number
  /** 设置页导航文案。 */
  readonly label: string
  /** 卡片组件（官方槽位按组件渲染；props 由 `inject` 提供）。 */
  readonly component: (props: never) => unknown
  /** 每次挂载时构造注入面（官方槽位 `inject` 约定）。 */
  readonly inject: () => Record<string, unknown>
}

/** 官方设置页槽位（启动器实现；拆分独立后由模块自己接 `ctx.slots`）。 */
export interface SectionSlotPort {
  register(section: SettingsSectionDescriptor): void
}

/**
 * 模块设置的读写面：启动器经 RPC 转发到 host 侧模块（唯一写者 = host，校验也在 host）。
 * 客户端不直接写官方 settings——写路径只有一条。
 */
export interface SettingsPort {
  /** 读当前设置；模块未装配/未启用时返回 undefined。 */
  get(): Promise<NotificationSettings | undefined>
  /** 写入补丁；host 侧拒绝（非法规则/不可用）时返回 false。 */
  set(patch: Partial<NotificationSettings>): Promise<boolean>
}

/**
 * 一条「会话正在等待什么」的观测：启动器从官方 client store 归一化后喂入。
 * `kind === undefined` 表示该会话当前没有等待（用于上报"等待已解除"）。
 */
export interface PendingObservation {
  readonly sessionId: string
  readonly kind?: PendingKind
  readonly title?: string
  readonly origin?: string
}

/**
 * 等待态观测源（启动器订阅官方 store）。
 * 约定：`subscribe` 时**立即回调一次当前快照**——传感器据此完成首见播种
 * （首见只播种不通知，故页面刚打开时已有的等待不会补历史通知）。
 */
export interface PendingFeedPort {
  subscribe(listener: (items: readonly PendingObservation[]) => void): void
}

/** 上报通道（启动器经 RPC 兜底桥转给 host 模块；决策与投递全在 host）。 */
export interface PendingReportPort {
  report(observation: PendingObservation): void
}

/**
 * 测试通知通道（设置卡片「发送测试通知」用）。
 * 走**真实投递端**：一次点击即可验证「模块 → 投递端 → 托盘文件 → 托盘进程 → 系统」整条链。
 */
export interface NotificationTestPort {
  /** 发一条测试通知；返回是否已交到投递端（不代表系统真的弹了：托盘未运行/勿扰模式都会影响）。 */
  send(): Promise<boolean>
}

/** 日志端口（启动器统一 client logger，带每键去重）。 */
export interface ClientLoggerPort {
  info(message: string): void
  warn(message: string): void
}

/** 模块 client 半区的全部外部依赖。 */
export interface NotificationClientFace {
  readonly settings: SettingsPort
  readonly section: SectionSlotPort
  readonly pendingFeed: PendingFeedPort
  readonly pendingReport: PendingReportPort
  readonly test: NotificationTestPort
  readonly logger: ClientLoggerPort
}
