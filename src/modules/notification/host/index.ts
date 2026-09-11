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
import type {
  LoggerPort,
  NotifyPort,
  ProjectionPort,
  SessionsPort,
  SettingsScopeFactory,
  SettingsScopeLike,
} from './ports.ts'
import { firstRuleError } from '../shared/rules.ts'
import { createNotificationSettings, SETTINGS_NAMESPACE } from './settings.ts'
import { createPresenceTracker } from './presence.ts'
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
  /**
   * 处理 client 上报的 UI 存在态（页面是否在前台 / 正在看哪个会话）。
   * `backgroundOnly`（"任务不在眼前才通知"）的判定输入——host 自己看不到浏览器状态。
   * @returns 是否接受（形状非法或未装配返回 false）。
   */
  reportPresence(raw: unknown): boolean
  /** 读当前通知设置（设置卡片回显用）；未装配时为 undefined。 */
  getSettings(): NotificationSettings | undefined
  /**
   * 更新通知设置（设置卡片写入用）。写入前做规则校验（host 侧把关），
   * 非法规则拒绝落库。
   * @returns 是否接受该次更新。
   */
  updateSettings(patch: Partial<NotificationSettings>): Promise<boolean>
  /**
   * 发送一条测试通知（设置卡片「发送测试通知」按钮用）。
   *
   * 为什么需要：托盘通道的排错点是"到底哪一环断了"（模块 → 投递端 → 托盘文件 → 托盘进程 → 系统）。
   * 这条走**与真实通知完全相同的投递端**，一次点击即可验证整条链；刻意不经规则与去重
   * （测试不该被用户规则拦住），但**不绕过配置开关**（用户在设置里关了托盘通知就该没反应，
   * 日志里会留 `[notify] suppressed by config`）。
   * @returns 是否已交到投递端（不代表系统真的弹了：托盘未运行/勿扰模式都会影响）。
   */
  testNotify(): boolean
}

/** 投影正文缺省预算（与上游 `Config` 默认一致）。 */
const DEFAULT_MAX_BODY_CHARS = 400

// 模块自述再导出：容器需要在 `create()` 之前读到 id / apiVersion 做护栏与开关判断
export { manifest } from '../manifest.ts'

/**
 * 创建通知模块。
 * @param deps - 端口注入集合。
 */
export function createNotificationModule(deps: NotificationModuleDeps): NotificationModule {
  // 存在态追踪器在 create 时就建：client 可能在 start 之前就上报（页面先于模块装好）
  const presence = createPresenceTracker()
  /** 测试通知的单调序号（同一毫秒连点两次也要拿到不同 tag，见 testNotify）。 */
  let testSequence = 0
  let pending: PendingChannel | undefined
  let notifier: Notifier | undefined
  let scope: SettingsScopeLike<NotificationSettings> | undefined

  return {
    id: manifest.id,
    apiVersion: manifest.apiVersion,
    settingsNamespace: SETTINGS_NAMESPACE,

    start() {
      const activeScope = createNotificationSettings(deps.settingsScope)
      scope = activeScope
      const readSettings = (): NotificationSettings => activeScope.get()
      // 投递编排在 start 里建：它要读设置（requireInteraction → 托盘常驻呈现），
      // 而设置作用域是 start 的产物
      const activeNotifier = createNotifier({ notify: deps.notify, logger: deps.logger, settings: readSettings })
      notifier = activeNotifier

      // 投影必须先注册：watch 的启动播种要读它的快照
      deps.projections.register(
        notificationProjection({ maxBodyChars: deps.config?.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS }),
      )

      pending = createPendingChannel({ settings: readSettings, presence, notifier: activeNotifier, logger: deps.logger })
      const stopWatch = createWatcher({
        projections: deps.projections,
        sessions: deps.sessions,
        settings: readSettings,
        presence,
        notifier: activeNotifier,
        logger: deps.logger,
      }).start()

      deps.logger.info(
        `[notification] 已装配：投影 notification + change feed 订阅 + pending + presence (ns=${SETTINGS_NAMESPACE})`,
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

    reportPresence(raw) {
      if (!presence.report(raw)) {
        deps.logger.warn('[notification] 忽略形状非法的 presence 上报')
        return false
      }
      return true
    },

    getSettings() {
      return scope?.get()
    },

    async updateSettings(patch) {
      if (scope === undefined) return false
      // 规则写入前把关：非法规则（空 pattern / 坏正则）拒绝落库
      if (Array.isArray(patch.rules)) {
        const invalid = firstRuleError(patch.rules)
        if (invalid !== undefined) {
          deps.logger.warn(`[notification] 拒绝写入：第 ${invalid.index + 1} 条规则非法（${invalid.key}）`)
          return false
        }
      }
      await scope.update(patch)
      deps.logger.info('[notification] 设置已更新（开关/规则即时生效，无需重启）')
      return true
    },

    testNotify() {
      try {
        // tag 必须唯一：Windows 会静默吞掉短时间内同 tag 的后续通知（本项目血泪之一）。
        // 只靠 Date.now() 不够——同一毫秒内连点两次会得到相同 tag（E2E 抓到的真实缺陷），
        // 故再挂一个单调序号，保证"连点多少次都能看到"。
        testSequence += 1
        deps.notify.notify({
          title: '任务通知测试',
          body: '看到这条托盘通知，说明「模块 → 投递端 → 托盘 → 系统」整条链路已打通。',
          tag: `dsh-notification-test-${Date.now()}-${testSequence}`,
          // 测试通知也遵守"需要手动关闭"设置：用户开了它就该在测试里看到常驻效果
          persistent: scope?.get().requireInteraction === true,
        })
        deps.logger.info('[notification] 测试通知已交投递端（来源：设置卡片「发送测试通知」）')
        return true
      } catch (error) {
        deps.logger.fail(`[notification] 测试通知投递失败：${String(error)}`)
        return false
      }
    },
  }
}
