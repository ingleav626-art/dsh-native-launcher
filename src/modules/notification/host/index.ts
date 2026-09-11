/**
 * 通知模块的组装根（L4）：把启动器注入的端口接成完整链路。
 *
 * 模块不 import 官方包、也不 import 启动器内部实现——外部世界（投影接缝、会话、设置、
 * 投递、日志）全部从 deps 进来。这是铁律 1（模块炸本体照跑）与 split-ready 的交汇点：
 * 本文件不做任何越界访问，装配失败由容器隔离，不影响启动器本体。
 */
import { manifest } from '../manifest.ts'
import type { NotificationSettings } from '../shared/types.ts'
import { notificationProjection } from './fold.ts'
import { createNotifier, type Notifier } from './notifier.ts'
import { createPendingChannel, isPendingReport, type PendingChannel } from './pending.ts'
import type { LoggerPort, NotifyPort, ProjectionPort, SessionsPort, SettingsScopeFactory } from './ports.ts'
import { createNotificationSettings, SETTINGS_NAMESPACE } from './settings.ts'
import { createWatcher } from './watch.ts'

/** 模块可调配置（来自启动器设置或 cordis patch）。 */
export interface NotificationModuleConfig {
  /** 投影正文的字符预算。 */
  readonly maxBodyChars?: number
}

/** 模块依赖：全部是窄端口，由启动器组装根适配官方 ctx 后注入。 */
export interface NotificationModuleDeps {
  readonly projections: ProjectionPort
  readonly sessions: SessionsPort
  readonly notify: NotifyPort
  readonly logger: LoggerPort
  readonly settingsScope: SettingsScopeFactory
  readonly config?: NotificationModuleConfig
}

/** 模块实例。 */
export interface NotificationModule {
  readonly id: string
  readonly apiVersion: number
  /** 本模块的设置命名空间（诊断与设置页用）。 */
  readonly settingsNamespace: string
  /** 装配全部链路；返回卸载函数（停订阅，供容器回收）。 */
  start(): () => void
  /** 处理 client 传感器上报；形状非法返回 false（上报来自渲染进程，不可信）。 */
  reportPending(raw: unknown): boolean
}

/** 投影正文缺省预算（与上游 `Config` 默认一致）。 */
const DEFAULT_MAX_BODY_CHARS = 400

/**
 * 创建通知模块。
 * @param deps - 端口注入集合。
 */
export function createNotificationModule(deps: NotificationModuleDeps): NotificationModule {
  const notifier: Notifier = createNotifier({ notify: deps.notify, logger: deps.logger })
  let pending: PendingChannel | undefined

  return {
    id: manifest.id,
    apiVersion: manifest.apiVersion,
    settingsNamespace: SETTINGS_NAMESPACE,

    start() {
      const scope = createNotificationSettings(deps.settingsScope)
      const readSettings = (): NotificationSettings => scope.get()

      // 投影必须先注册：watch 的启动播种要读它的快照
      deps.projections.register(
        notificationProjection({ maxBodyChars: deps.config?.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS }),
      )

      pending = createPendingChannel({ settings: readSettings, notifier, logger: deps.logger })
      const stopWatch = createWatcher({
        projections: deps.projections,
        sessions: deps.sessions,
        settings: readSettings,
        notifier,
        logger: deps.logger,
      }).start()

      deps.logger.info(
        `[notification] 已装配：投影 notification + change feed 订阅 + pending 通道 (ns=${SETTINGS_NAMESPACE})`,
      )

      return () => {
        stopWatch()
        pending = undefined
      }
    },

    reportPending(raw) {
      if (pending === undefined) return false
      if (!isPendingReport(raw)) {
        deps.logger.warn('[notification] 忽略形状非法的 pending 上报')
        return false
      }
      pending.report(raw)
      return true
    },
  }
}
