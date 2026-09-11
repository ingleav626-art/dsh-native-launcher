/**
 * pending 通道（方案 2 接收端）：client 传感器上报「会话正在等待什么」→ 同一决策链 → 投递。
 *
 * 为什么需要这条通道：question / plan-review **不是**会话日志事件，也不是持久事件——
 * 0.1.5-rc.2 沙箱实证：它们是 Host waterfall 请求派发给 client 的活内存态，host 侧无可观测面。
 * client 只做**传感器**（观察 pendingInteraction → 上报），决策与投递全在 host。
 *
 * 播种语义（对齐上游 client pending runner）：首见某会话只播种（fresh=false），
 * 因此页面刚打开时已存在的等待不会补一条历史通知。
 */
import type { NotificationSettings, PendingKind } from '../shared/types.ts'
import type { LoggerPort } from './ports.ts'
import type { Notifier } from './notifier.ts'
import { asPendingKind, pendingNotificationFor } from './planner.ts'
import type { PresenceTracker } from './presence.ts'
import { pendingAdvance } from './signals.ts'

/** client 传感器的一次上报（跨进程输入，字段一律当作不可信）。 */
export interface PendingReport {
  readonly sessionId: string
  /** 等待种类；undefined = 该会话的等待已解除。 */
  readonly kind?: string
  /** 会话标题（传感器侧拿得到，作为通知正文）。 */
  readonly title?: string
  /** 会话来源（传感器侧拿到时透传，用于跳过 subagent）。 */
  readonly origin?: string
}

/** pending 通道依赖。 */
export interface PendingChannelDeps {
  readonly settings: () => NotificationSettings
  /** UI 存在态：审批/提问就摆在眼前时不打扰（同上 `backgroundOnly` 语义）。 */
  readonly presence: PresenceTracker
  readonly notifier: Notifier
  readonly logger: LoggerPort
}

/** pending 通道。 */
export interface PendingChannel {
  /** 处理一次传感器上报。 */
  report(report: PendingReport): void
  /** 会话消失时清状态。 */
  forgetSession(sessionId: string): void
}

/** 校验上报形状：sessionId 必须是非空字符串。 */
export function isPendingReport(value: unknown): value is PendingReport {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.sessionId === 'string' && record.sessionId !== ''
    && (record.kind === undefined || typeof record.kind === 'string')
}

/**
 * 创建 pending 通道。
 * @param deps - 设置/投递/日志端口。
 */
export function createPendingChannel(deps: PendingChannelDeps): PendingChannel {
  /** 每会话上次观察到的等待种类。 */
  const observed = new Map<string, { kind: PendingKind | undefined }>()
  /** 每会话的等待序号（保证 tag 唯一，不被系统吞并）。 */
  const sequences = new Map<string, number>()

  return {
    report(report) {
      const id = report.sessionId
      const { kind: nextKind, fresh } = pendingAdvance(observed.get(id), asPendingKind(report.kind))
      observed.set(id, { kind: nextKind })
      if (!fresh || nextKind === undefined) return
      const current = deps.settings()
      // backgroundOnly：审批/提问就摆在眼前（页面在前台且正在看这个会话）→ 不打扰
      if (deps.presence.suppresses(id, current)) {
        deps.logger.info(`[pending] ${nextKind} 被 backgroundOnly 抑制（会话正在眼前，session=${id}）`)
        return
      }
      const sequence = (sequences.get(id) ?? 0) + 1
      sequences.set(id, sequence)
      const plan = pendingNotificationFor(id, report.origin, report.title, nextKind, sequence, current)
      if (plan === null) {
        deps.logger.info(`[pending] ${nextKind} 被设置/规则抑制 (session=${id})`)
        return
      }
      deps.notifier.deliverPending(id, plan)
    },

    forgetSession(id) {
      observed.delete(id)
      sequences.delete(id)
    },
  }
}
