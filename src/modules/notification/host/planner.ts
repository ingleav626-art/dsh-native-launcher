/**
 * 计划生成：把「转场判定 + 会话事实 + 投影值 + 设置」折成一条待投递通知，或 null。
 *
 * 移植自上游 dsh-notification `src/client/runner.ts` 的 `notificationFor` / `pendingNotificationFor`
 * （逐字核对语义）。纯函数、零 IO——上游在 client 侧执行，本项目收归 host（决策权在 host）。
 */
import type {
  NotificationPlan,
  NotificationProjectionValue,
  NotificationSettings,
  PendingKind,
  PendingNotificationPlan,
} from '../shared/types.ts'
import { notificationTag, pendingNotificationTag } from '../shared/labels.ts'
import { asReason, pendingReasonEnabled, ruleSubject, rulesAllow, shouldNotify } from './filter.ts'

/** 把原始字符串窄化为等待交互种类（宿主上报的值不可信）。 */
export function asPendingKind(value: string | undefined): PendingKind | undefined {
  return value === 'approval' || value === 'question' || value === 'plan-review' ? value : undefined
}

/**
 * 决策一次任务完成的通知，不含任何浏览器/宿主读取。
 * @param sessionId - 已完成的会话。
 * @param origin - 会话的持久来源（subagent 跳过）。
 * @param title - 会话的持久标题（宿主投影出标题前缺席）。
 * @param projection - 宿主 `notification` 投影值。
 * @param settings - 当前设置。
 * @returns 计划；不应通知时为 null。
 */
export function notificationFor(
  sessionId: string,
  origin: string | undefined,
  title: string | undefined,
  projection: NotificationProjectionValue | undefined,
  settings: NotificationSettings,
): NotificationPlan | null {
  if (origin === 'subagent') return null
  // 完成边沿可能比投影帧早一拍落定；投影未到时退回"通用完成"文案。
  const reason = projection === undefined || projection.turn === 0
    ? 'completed' as const
    : asReason(projection.reason)
  if (reason === undefined) return null
  const subject = ruleSubject(title, projection?.body ?? '', projection?.tools ?? [])
  if (!shouldNotify(settings, reason, subject)) return null
  return {
    reason,
    body: projection?.body ?? title ?? '',
    tag: notificationTag(sessionId, projection?.turn ?? 0),
  }
}

/**
 * 决策一次等待交互的通知，不含浏览器状态读取。
 * @param sessionId - 阻塞中的会话。
 * @param origin - 会话来源（subagent 跳过）。
 * @param title - 会话标题（作为正文）。
 * @param kind - 等待种类。
 * @param sequence - 该会话内本次等待的序号（保证 tag 唯一，不被系统吞掉）。
 * @param settings - 当前设置。
 * @returns 计划；不应通知时为 null。
 */
export function pendingNotificationFor(
  sessionId: string,
  origin: string | undefined,
  title: string | undefined,
  kind: PendingKind,
  sequence: number,
  settings: NotificationSettings,
): PendingNotificationPlan | null {
  if (origin === 'subagent') return null
  if (!settings.enabled || !pendingReasonEnabled(settings, kind)) return null
  if (!rulesAllow(settings, ruleSubject(title, '', []))) return null
  return { kind, body: title?.trim() ?? '', tag: pendingNotificationTag(sessionId, sequence) }
}
