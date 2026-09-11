/**
 * 投递编排：标签级去重 + 文案组装 → 调注入的投递端口。
 *
 * 与计划的**有意偏差**（记账）：不引入 2s 合并窗口。理由——上游 client 侧本无窗口，
 * 本项目砍掉浏览器通道后「client/host 竞争同一通知」的动机消失；标签已是 turn / pending 级唯一，
 * 再加窗口只会吞掉合法通知（用户定调「完整度优先」）。改为有界标签去重表。
 *
 * 本文件不碰任何存储：`tray-notify.json` 的唯一写者是启动器投递端（端口背后）。
 */
import { bodyText, pendingTitleFor, titleFor } from '../shared/labels.ts'
import type { NotificationPlan, PendingNotificationPlan, TrayNotification } from '../shared/types.ts'
import type { LoggerPort, NotifyPort } from './ports.ts'

/** 投递编排的依赖（端口注入，测试可直接换 fake）。 */
export interface NotifierDeps {
  readonly notify: NotifyPort
  readonly logger: LoggerPort
}

/** 投递编排选项。 */
export interface NotifierOptions {
  /** 去重表上限（插入序淘汰）——防止长跑进程无界增长。 */
  readonly maxRemembered?: number
  /** 空正文的回退文案。 */
  readonly emptyBody?: string
}

/** 投递编排器（有状态，语义方法访问）。 */
export interface Notifier {
  /** 投递一条任务完成通知；被去重拦下时返回 false。 */
  deliverCompletion(sessionId: string, plan: NotificationPlan): boolean
  /** 投递一条等待交互通知；被去重拦下时返回 false。 */
  deliverPending(sessionId: string, plan: PendingNotificationPlan): boolean
  /** 会话消失时清掉它的去重记录（允许同标签在会话重建后再投递）。 */
  forgetSession(sessionId: string): void
  /** 诊断：当前记住的标签数。 */
  rememberedCount(): number
}

/**
 * 创建投递编排器。
 * @param deps - 投递与日志端口。
 * @param options - 上限与回退文案。
 */
export function createNotifier(deps: NotifierDeps, options: NotifierOptions = {}): Notifier {
  const maxRemembered = options.maxRemembered ?? 500
  const emptyBody = options.emptyBody ?? '（无正文）'
  /** tag → sessionId（Map 保持插入序，超限淘汰最旧）。 */
  const remembered = new Map<string, string>()

  /** 首次见到的标签放行并记下；重复标签返回 false。 */
  const remember = (tag: string, sessionId: string): boolean => {
    if (remembered.has(tag)) return false
    remembered.set(tag, sessionId)
    if (remembered.size > maxRemembered) {
      const oldest = remembered.keys().next()
      if (!oldest.done) remembered.delete(oldest.value)
    }
    return true
  }

  const send = (notification: TrayNotification): void => {
    try {
      deps.notify.notify(notification)
    } catch (error) {
      // 投递失败不得影响决策链（本体红线：通知模块崩溃不拖垮启动器）
      deps.logger.fail(`[notify] 投递失败 tag=${notification.tag}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    deliverCompletion(sessionId, plan) {
      if (!remember(plan.tag, sessionId)) return false
      send({ title: titleFor(plan.reason), body: bodyText(plan.body, emptyBody), tag: plan.tag })
      deps.logger.info(`[notify] 完成通知 reason=${plan.reason} tag=${plan.tag}`)
      return true
    },

    deliverPending(sessionId, plan) {
      if (!remember(plan.tag, sessionId)) return false
      send({ title: pendingTitleFor(plan.kind), body: bodyText(plan.body, emptyBody), tag: plan.tag })
      deps.logger.info(`[notify] 等待通知 kind=${plan.kind} tag=${plan.tag}`)
      return true
    },

    forgetSession(sessionId) {
      for (const [tag, owner] of remembered) {
        if (owner === sessionId) remembered.delete(tag)
      }
    },

    rememberedCount() {
      return remembered.size
    },
  }
}
